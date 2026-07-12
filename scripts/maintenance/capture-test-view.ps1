param(
  [string]$Url = "http://localhost:3000",
  [string]$TestId = "test_857c380d-ecaa-4e15-a6d7-3fcf9631bdde",
  [string]$PageId = "test_page_49173d72-f3f8-41be-8366-6f7dfae6181e",
  [string]$Output = "test-results/test-view.png",
  [string]$PdfCollapsed = "true",
  [string]$SoftAddWord = "",
  [string]$AnswerQuestion = "",
  [string]$AnswerText = "",
  [string]$AnswerEditText = "",
  [string]$CleanupAnswer = "false",
  [string]$DraftAnswerQuestion = "",
  [string]$DraftAnswerText = "",
  [string]$PageWord = "",
  [string]$PageWordNote = "",
  [string]$CleanupPageWord = "false",
  [string]$UnlinkKnownWord = "false",
  [string]$ReturnFromKnownWord = "false",
  [string]$CheckSkillProgress = "false",
  [string]$CheckStickyTools = "false",
  [string]$SplitView = "false",
  [string]$SplitPageId = "",
  [string]$VisualZoom = "",
  [string]$ProgressPageId = "",
  [string]$SkipSelect = "false",
  [ValidateSet("tests", "verbs", "vault")]
  [string]$Section = "tests",
  [int]$Width = 2048,
  [int]$Height = 1536
)

$ErrorActionPreference = "Stop"

function Find-Chrome {
  $candidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "Chrome or Edge was not found."
}

function Receive-CdpMessage {
  param([System.Net.WebSockets.ClientWebSocket]$Socket)

  $buffer = New-Object byte[] 1048576
  $stream = New-Object System.IO.MemoryStream

  do {
    $segment = [ArraySegment[byte]]::new($buffer)
    $result = $Socket.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    if ($result.Count -gt 0) {
      $stream.Write($buffer, 0, $result.Count)
    }
  } until ($result.EndOfMessage)

  $text = [Text.Encoding]::UTF8.GetString($stream.ToArray())
  return $text | ConvertFrom-Json
}

function Send-CdpCommand {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [ref]$NextId,
    [string]$Method,
    [hashtable]$Params = @{}
  )

  $id = $NextId.Value
  $NextId.Value = $NextId.Value + 1

  $payload = @{
    id = $id
    method = $Method
    params = $Params
  } | ConvertTo-Json -Depth 12 -Compress

  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $Socket.SendAsync(
    [ArraySegment[byte]]::new($bytes),
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult() | Out-Null

  while ($true) {
    $message = Receive-CdpMessage -Socket $Socket
    if ($message.id -eq $id) {
      if ($message.error) {
        throw ($message.error | ConvertTo-Json -Depth 6)
      }
      return $message.result
    }
  }
}

function Wait-Http {
  param([string]$Endpoint)

  for ($i = 0; $i -lt 80; $i++) {
    try {
      return Invoke-RestMethod -UseBasicParsing $Endpoint
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }

  throw "Timed out waiting for $Endpoint"
}

$chrome = Find-Chrome
$pdfCollapsedValue = if (@("false", "0", "no", "off").Contains($PdfCollapsed.ToLowerInvariant())) { "false" } else { "true" }
$skipSelectValue = if (@("true", "1", "yes", "on").Contains($SkipSelect.ToLowerInvariant())) { "true" } else { "false" }
$progressScript = ""
if ($ProgressPageId) {
  $progress = @{}
  $progress[$TestId] = @{ pageId = $ProgressPageId; updatedAt = "test" }
  $progressJson = ($progress | ConvertTo-Json -Compress)
  $progressJsonLiteral = $progressJson.Replace("\", "\\").Replace("'", "\'")
  $progressScript = " localStorage.setItem('nationalTestProgress','$progressJsonLiteral');"
}
$visualZoomScript = ""
if ($VisualZoom) {
  $visualZoomLiteral = $VisualZoom.Replace("\", "\\").Replace("'", "\'")
  $visualZoomScript = " localStorage.setItem('testPageVisualZoom','$visualZoomLiteral');"
}
$port = Get-Random -Minimum 42000 -Maximum 49000
$profile = Join-Path $env:TEMP ("codex-chrome-profile-" + [guid]::NewGuid().ToString("N"))
$outputPath = Resolve-Path -LiteralPath (Split-Path -Parent $Output) -ErrorAction SilentlyContinue
if (-not $outputPath) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
}
$resolvedOutput = Join-Path (Resolve-Path -LiteralPath (Split-Path -Parent $Output)) (Split-Path -Leaf $Output)

$chromeArgs = @(
  "--headless=new",
  "--disable-gpu",
  "--disable-background-networking",
  "--remote-debugging-port=$port",
  "--user-data-dir=$profile",
  "--window-size=$Width,$Height",
  "about:blank"
)

$process = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -PassThru -WindowStyle Hidden
$socket = $null

try {
  Wait-Http "http://127.0.0.1:$port/json/version" | Out-Null
  $targets = Wait-Http "http://127.0.0.1:$port/json"
  $target = @($targets | Where-Object { $_.type -eq "page" } | Select-Object -First 1)[0]
  if (-not $target.webSocketDebuggerUrl) {
    throw "No Chrome page target was available."
  }

  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  $nextId = 1

  Send-CdpCommand -Socket $socket -NextId ([ref]$nextId) -Method "Page.enable" | Out-Null
  Send-CdpCommand -Socket $socket -NextId ([ref]$nextId) -Method "Runtime.enable" | Out-Null
  Send-CdpCommand -Socket $socket -NextId ([ref]$nextId) -Method "Emulation.setDeviceMetricsOverride" -Params @{
    width = $Width
    height = $Height
    deviceScaleFactor = 1
    mobile = $false
  } | Out-Null
  Send-CdpCommand -Socket $socket -NextId ([ref]$nextId) -Method "Page.addScriptToEvaluateOnNewDocument" -Params @{
    source = "localStorage.setItem('activeAppSection','$Section'); localStorage.setItem('testPagePdfCollapsed','$pdfCollapsedValue');$progressScript$visualZoomScript"
  } | Out-Null
  Send-CdpCommand -Socket $socket -NextId ([ref]$nextId) -Method "Page.navigate" -Params @{
    url = $Url
  } | Out-Null

  Start-Sleep -Milliseconds 2200

  if ($Section -eq "verbs") {
    $script = @'
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = fn();
      if (value) return value;
      await sleep(100);
    }
    return null;
  };
  document.querySelector("#verbs-section-button")?.click();
  const table = await waitFor(() => document.querySelector(".verb-table"));
  if (!table) return { ok: false, reason: "verb table not found" };
  await sleep(500);

  const workspace = document.querySelector(".workspace");
  const editor = document.querySelector(".editor-panel");
  const library = document.querySelector(".library-panel");
  const tableWrap = document.querySelector(".verb-table-wrap");
  const firstRow = document.querySelector(".verb-table tbody tr");
  const firstHeader = document.querySelector(".verb-table thead th");
  const actionButton = document.querySelector(".verb-actions-cell .icon-button");
  const baseChip = document.querySelector(".verb-table-base .pos-chip");
  const searchInput = document.querySelector("#verb-filter-search");

  const workspaceRect = workspace?.getBoundingClientRect();
  const editorRect = editor?.getBoundingClientRect();
  const libraryRect = library?.getBoundingClientRect();
  const tableWrapRect = tableWrap?.getBoundingClientRect();
  const firstRowRect = firstRow?.getBoundingClientRect();
  const searchRect = searchInput?.getBoundingClientRect();
  const headerStyle = firstHeader ? getComputedStyle(firstHeader) : null;
  const rowStyle = firstRow ? getComputedStyle(firstRow) : null;

  return {
    ok: true,
    sectionTitle: document.querySelector(".topbar h1")?.textContent?.trim() || "",
    countText: document.querySelector("#filtered-verb-count")?.textContent?.trim() || "",
    workspaceWidth: Math.round(workspaceRect?.width || 0),
    editorWidth: Math.round(editorRect?.width || 0),
    libraryWidth: Math.round(libraryRect?.width || 0),
    tableWrapWidth: Math.round(tableWrapRect?.width || 0),
    tableScrollWidth: Math.round(tableWrap?.scrollWidth || 0),
    tableClientWidth: Math.round(tableWrap?.clientWidth || 0),
    rowHeight: Math.round(firstRowRect?.height || 0),
    rowFontSize: rowStyle?.fontSize || "",
    headerFontSize: headerStyle?.fontSize || "",
    headerPosition: headerStyle?.position || "",
    searchHeight: Math.round(searchRect?.height || 0),
    actionOpacity: actionButton ? getComputedStyle(actionButton).opacity : "",
    baseChipOpacity: baseChip ? getComputedStyle(baseChip).opacity : "",
    hasHorizontalScroll: Boolean(tableWrap && tableWrap.scrollWidth > tableWrap.clientWidth + 1),
    visibleRows: document.querySelectorAll(".verb-table tbody tr").length
  };
})()
'@
  } elseif ($Section -eq "vault") {
    $script = @'
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = fn();
      if (value) return value;
      await sleep(100);
    }
    return null;
  };
  const stopWords = new Set(["about", "above", "after", "again", "being", "could", "every", "from", "have", "their", "there", "these", "those", "which", "with", "without", "would", "your"]);
  const words = (await fetch("/api/database").then(response => response.json())).words || [];
  const candidate = words
    .filter(word => word.word && word.definition)
    .map(word => {
      const wordText = String(word.word || "").toLowerCase();
      const clue = String(word.definition || "")
        .toLowerCase()
        .split(/[^a-z]+/)
        .find(token => token.length >= 6 && !stopWords.has(token) && !wordText.includes(token));
      return clue ? { word, clue } : null;
    })
    .find(Boolean);
  if (!candidate) return { ok: false, reason: "no definition-search candidate found" };

  document.querySelector("#vault-section-button")?.click();
  const searchInput = await waitFor(() => document.querySelector("#filter-search"));
  if (!searchInput) return { ok: false, reason: "word search input not found" };
  searchInput.value = candidate.clue;
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));

  const candidateCard = await waitFor(() => [...document.querySelectorAll(".word-card")]
    .find(card => card.querySelector(".word-title h3")?.textContent?.trim() === candidate.word.word), 12000);
  if (!candidateCard) {
    return {
      ok: false,
      reason: "candidate word was not visible after definition clue search",
      candidateWord: candidate.word.word,
      clue: candidate.clue,
      visibleTitles: [...document.querySelectorAll(".word-title h3")].slice(0, 8).map(node => node.textContent?.trim() || "")
    };
  }

  const matchText = candidateCard.querySelector(".word-search-match")?.textContent?.trim().replace(/\s+/g, " ") || "";
  return {
    ok: true,
    sectionTitle: document.querySelector(".topbar h1")?.textContent?.trim() || "",
    clue: candidate.clue,
    candidateWord: candidate.word.word,
    filteredCount: document.querySelector("#filtered-word-count")?.textContent?.trim() || "",
    candidateVisible: true,
    matchText,
    matchedDefinition: matchText.includes("Matched in definition")
  };
})()
'@
  } else {
    $script = @'
(async () => {
  const testId = "__TEST_ID__";
  const pageId = "__PAGE_ID__";
  const softAddWord = __SOFT_ADD_WORD_JSON__;
  const answerQuestion = __ANSWER_QUESTION_JSON__;
  const answerText = __ANSWER_TEXT_JSON__;
  const answerEditText = __ANSWER_EDIT_TEXT_JSON__;
  const cleanupAnswer = __CLEANUP_ANSWER_JSON__;
  const draftAnswerQuestion = __DRAFT_ANSWER_QUESTION_JSON__;
  const draftAnswerText = __DRAFT_ANSWER_TEXT_JSON__;
  const pageWord = __PAGE_WORD_JSON__;
  const pageWordNote = __PAGE_WORD_NOTE_JSON__;
  const cleanupPageWord = __CLEANUP_PAGE_WORD_JSON__;
  const unlinkKnownWord = __UNLINK_KNOWN_WORD_JSON__;
  const returnFromKnownWord = __RETURN_FROM_KNOWN_WORD_JSON__;
  const checkSkillProgress = __CHECK_SKILL_PROGRESS_JSON__;
  const checkStickyTools = __CHECK_STICKY_TOOLS_JSON__;
  const splitView = __SPLIT_VIEW_JSON__;
  const splitPageId = "__SPLIT_PAGE_ID__";
  const skipSelect = __SKIP_SELECT_JSON__;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = fn();
      if (value) return value;
      await sleep(100);
    }
    return null;
  };
  const answerMarkerForText = text => [...document.querySelectorAll("[data-test-page-answer-marker]")]
    .find(marker => marker.getAttribute("title")?.includes(text));

  document.querySelector("#tests-section-button")?.click();
  const studyButton = await waitFor(() => document.querySelector('[data-study-national-test="' + testId + '"]'));
  if (!studyButton) return { ok: false, reason: "test button not found" };
  studyButton.click();

  const pageButton = await waitFor(() => document.querySelector('[data-select-test-page="' + pageId + '"]'));
  if (!pageButton) return { ok: false, reason: "page button not found" };
  if (!skipSelect) {
    pageButton.click();
  } else {
    const activeButton = await waitFor(() => document.querySelector(".test-page-button.active"));
    if (!activeButton) return { ok: false, reason: "active page button not found" };
  }

  const layoutPage = await waitFor(() => document.querySelector(".page-layout-page, .test-page-visual-fallback-frame img"), 12000);
  if (!layoutPage) return { ok: false, reason: "visual page not rendered" };
  await sleep(600);

  let split = { attempted: false };
  if (splitView) {
    document.querySelector("[data-toggle-test-page-split]")?.click();
    const splitSelect = await waitFor(() => document.querySelector("[data-select-test-page-split]"), 12000);
    if (!splitSelect) return { ok: false, reason: "split page selector not found" };
    if (splitPageId) {
      splitSelect.value = splitPageId;
      splitSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await waitFor(() => document.querySelectorAll(".test-page-split-pane").length === 2, 12000);
    await sleep(600);
    split = {
      attempted: true,
      paneCount: document.querySelectorAll(".test-page-split-pane").length,
      selectedSplitPageId: document.querySelector("[data-select-test-page-split]")?.value || "",
      labels: [...document.querySelectorAll(".test-page-split-pane-header")].map(header => header.textContent?.trim().replace(/\s+/g, " ") || ""),
      scrollAreas: document.querySelectorAll(".test-page-visual-split .page-layout-scroll, .test-page-visual-split .test-page-visual-fallback-frame").length
    };
  }

  let skillProgress = { attempted: false };
  if (checkSkillProgress) {
    const skillButton = await waitFor(() => document.querySelector("[data-toggle-test-skill-finished]"), 12000);
    if (!skillButton) return { ok: false, reason: "skill finished button not found" };
    const skillTestId = skillButton.dataset.toggleTestSkillFinished || testId;
    const sectionKey = skillButton.dataset.testSkillSection || "";
    const wasFinished = skillButton.dataset.testSkillFinished === "true";
    const dbBefore = await fetch("/api/database").then(response => response.json());
    const originalPages = (dbBefore.nationalTestPages || [])
      .filter(page => page.testId === skillTestId && page.section === sectionKey)
      .map(page => ({ id: page.id, finishedAt: page.finishedAt || null }));
    if (!originalPages.length) return { ok: false, reason: "no pages found for skill progress restore" };

    skillButton.click();
    const expectedFinished = !wasFinished;
    const updatedButton = await waitFor(() => {
      const button = document.querySelector(`[data-toggle-test-skill-finished="${skillTestId}"][data-test-skill-section="${sectionKey}"]`);
      return button && (button.dataset.testSkillFinished === String(expectedFinished)) ? button : null;
    }, 12000);
    if (!updatedButton) return { ok: false, reason: "skill finished button did not update" };
    await sleep(500);
    const dbAfter = await fetch("/api/database").then(response => response.json());
    const originalIds = new Set(originalPages.map(page => page.id));
    const changedPages = (dbAfter.nationalTestPages || []).filter(page => originalIds.has(page.id));
    const allChanged = changedPages.length === originalPages.length && changedPages.every(page => Boolean(page.finishedAt) === expectedFinished);
    const summaryText = [...document.querySelectorAll(".test-skill-progress-pill")]
      .map(pill => pill.textContent?.trim().replace(/\s+/g, " ") || "");

    for (const page of originalPages) {
      await fetch(`/api/national-test-pages/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finishedAt: page.finishedAt })
      });
    }

    skillProgress = {
      attempted: true,
      sectionKey,
      wasFinished,
      expectedFinished,
      allChanged,
      updatedLabel: updatedButton.textContent?.trim().replace(/\s+/g, " ") || "",
      summaryText
    };
  }

  let draftAnswer = { attempted: false };
  if (draftAnswerText) {
    document.querySelector("[data-open-test-page-answer-compose]")?.click();
    const draftQuestionInput = await waitFor(() => document.querySelector("#test-page-answer-question-input"), 12000);
    const draftTextInput = document.querySelector("#test-page-answer-text-input");
    if (!draftQuestionInput || !draftTextInput) return { ok: false, reason: "draft answer controls not found" };

    draftQuestionInput.value = draftAnswerQuestion || "Draft";
    draftQuestionInput.dispatchEvent(new Event("input", { bubbles: true }));
    draftTextInput.value = draftAnswerText;
    draftTextInput.dispatchEvent(new Event("input", { bubbles: true }));

    const otherPageButton = [...document.querySelectorAll("[data-select-test-page]")]
      .find(button => button.dataset.selectTestPage && button.dataset.selectTestPage !== pageId);
    if (!otherPageButton) return { ok: false, reason: "no alternate page available for draft test" };
    otherPageButton.click();
    await waitFor(() => document.querySelector(".test-page-button.active")?.dataset.selectTestPage === otherPageButton.dataset.selectTestPage, 12000);
    await sleep(300);
    document.querySelector('[data-select-test-page="' + pageId + '"]')?.click();
    const restoredTextInput = await waitFor(() => document.querySelector("#test-page-answer-text-input"), 12000);
    const restoredQuestionInput = document.querySelector("#test-page-answer-question-input");
    draftAnswer = {
      attempted: true,
      restoredQuestion: restoredQuestionInput?.value || "",
      restoredText: restoredTextInput?.value || "",
      composerOpenAfterReturn: Boolean(restoredTextInput),
      restored: (restoredQuestionInput?.value || "") === (draftAnswerQuestion || "Draft") && (restoredTextInput?.value || "") === draftAnswerText
    };
    if (!checkStickyTools) {
      document.querySelector("[data-cancel-test-page-answer-edit]")?.click();
      await sleep(200);
    }
  }

  let stickyTools = { attempted: false };
  if (checkStickyTools) {
    const scrollColumn = document.querySelector(".test-page-main-column, .test-page-study-column");
    const sticky = document.querySelector(".test-page-sticky-tools");
    if (!scrollColumn || !sticky) return { ok: false, reason: "sticky tools not found" };
    const stickyBefore = sticky.getBoundingClientRect();
    scrollColumn.scrollTop = Math.min(520, Math.max(0, scrollColumn.scrollHeight - scrollColumn.clientHeight));
    await sleep(300);
    const stickyAfter = sticky.getBoundingClientRect();
    const columnAfter = scrollColumn.getBoundingClientRect();
    const visualScroll = document.querySelector(".page-layout-scroll, .test-page-visual-fallback-frame");
    if (visualScroll) {
      visualScroll.scrollTop = Math.min(520, Math.max(0, visualScroll.scrollHeight - visualScroll.clientHeight));
      await sleep(250);
    }
    const stickyAfterVisualScroll = sticky.getBoundingClientRect();
    stickyTools = {
      attempted: true,
      scrollTop: Math.round(scrollColumn.scrollTop),
      visualScrollTop: Math.round(visualScroll?.scrollTop || 0),
      beforeTop: Math.round(stickyBefore.top),
      afterTop: Math.round(stickyAfter.top),
      afterVisualScrollTop: Math.round(stickyAfterVisualScroll.top),
      columnTop: Math.round(columnAfter.top),
      searchVisibleAfterScroll: Boolean(document.querySelector(".test-page-search-section")?.getBoundingClientRect().bottom > columnAfter.top),
      controlsVisibleAfterScroll: Boolean(document.querySelector(".test-page-visual-controls-section")?.getBoundingClientRect().bottom > columnAfter.top),
      retainedNearTop: Math.abs(stickyAfter.top - columnAfter.top) <= 2,
      retainedAfterVisualScroll: Math.abs(stickyAfterVisualScroll.top - stickyAfter.top) <= 2
    };
  }

  if (draftAnswerText && checkStickyTools) {
    document.querySelector("[data-cancel-test-page-answer-edit]")?.click();
    await sleep(200);
  }

  let knownReturn = { attempted: false };
  if (returnFromKnownWord) {
    const visualContainerBeforeReturn = document.querySelector("#test-page-visual-content");
    const studyScrollBeforeReturn = document.querySelector(".test-page-study-column, .test-page-main-column");
    const visualScrollBeforeReturn = document.querySelector(
      "#test-page-visual-content .page-layout-scroll, #test-page-visual-content .test-page-visual-fallback-frame"
    );
    if (!visualScrollBeforeReturn) return { ok: false, reason: "visual scroll not found for known-word return test" };

    if (studyScrollBeforeReturn) {
      studyScrollBeforeReturn.scrollTop = Math.min(420, Math.max(0, studyScrollBeforeReturn.scrollHeight - studyScrollBeforeReturn.clientHeight));
    }
    visualScrollBeforeReturn.scrollTop = Math.min(420, Math.max(0, visualScrollBeforeReturn.scrollHeight - visualScrollBeforeReturn.clientHeight));
    visualScrollBeforeReturn.scrollLeft = Math.min(40, Math.max(0, visualScrollBeforeReturn.scrollWidth - visualScrollBeforeReturn.clientWidth));
    await sleep(250);
    const beforeStudyTop = Math.round(studyScrollBeforeReturn?.scrollTop || 0);
    const beforeTop = Math.round(visualScrollBeforeReturn.scrollTop);
    const beforeLeft = Math.round(visualScrollBeforeReturn.scrollLeft);
    const knownButton = await waitFor(() => document.querySelector("[data-open-test-known-word], [data-open-test-known-verb]"), 12000);
    if (!knownButton) return { ok: false, reason: "known word button not found for return test" };

    const token = knownButton.dataset.openTestKnownToken || knownButton.textContent?.trim() || "";
    const openedAs = knownButton.matches("[data-open-test-known-word]") ? "word" : "verb";
    knownButton.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    const leftTest = await waitFor(() => !document.querySelector("#test-page-visual-content"), 12000);
    if (!leftTest) return { ok: false, reason: "known word view did not open" };
    await sleep(300);
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true
    }));
    const restoredVisualScroll = await waitFor(() => document.querySelector(
      "#test-page-visual-content .page-layout-scroll, #test-page-visual-content .test-page-visual-fallback-frame"
    ), 12000);
    if (!restoredVisualScroll) return { ok: false, reason: "test visual did not return after Escape" };
    await sleep(450);
    const afterTop = Math.round(restoredVisualScroll.scrollTop);
    const afterLeft = Math.round(restoredVisualScroll.scrollLeft);
    const restoredStudyScroll = document.querySelector(".test-page-study-column, .test-page-main-column");
    const afterStudyTop = Math.round(restoredStudyScroll?.scrollTop || 0);
    knownReturn = {
      attempted: true,
      token,
      openedAs,
      visualContainerRetained: visualContainerBeforeReturn === document.querySelector("#test-page-visual-content"),
      beforeStudyTop,
      afterStudyTop,
      restoredStudyTop: Math.abs(afterStudyTop - beforeStudyTop) <= 2,
      beforeTop,
      afterTop,
      beforeLeft,
      afterLeft,
      restoredTop: Math.abs(afterTop - beforeTop) <= 2,
      restoredLeft: Math.abs(afterLeft - beforeLeft) <= 2,
      activePageId: document.querySelector(".test-page-button.active")?.dataset?.selectTestPage || ""
    };
  }

  let unlink = { attempted: false };
  if (unlinkKnownWord) {
    const visualContainerBeforeUnlink = document.querySelector("#test-page-visual-content");
    const knownButton = await waitFor(() => document.querySelector("[data-open-test-known-token]"), 12000);
    if (!knownButton) return { ok: false, reason: "known word button not found for unlink test" };
    const token = knownButton.dataset.openTestKnownToken || knownButton.textContent?.trim() || "";
    const matchingBefore = [...document.querySelectorAll("[data-open-test-known-token]")]
      .filter(button => (button.dataset.openTestKnownToken || button.textContent?.trim() || "") === token).length;
    knownButton.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      view: window
    }));
    await sleep(500);
    const matchingAfter = [...document.querySelectorAll("[data-open-test-known-token]")]
      .filter(button => (button.dataset.openTestKnownToken || button.textContent?.trim() || "") === token).length;
    unlink = {
      attempted: true,
      token,
      matchingBefore,
      matchingAfter,
      visualContainerRetained: visualContainerBeforeUnlink === document.querySelector("#test-page-visual-content")
    };
  }

  let answers = { attempted: false };
  if (answerText) {
    document.querySelector("[data-open-test-page-answer-compose]")?.click();
    const questionInput = await waitFor(() => document.querySelector("#test-page-answer-question-input"), 12000);
    const textInput = document.querySelector("#test-page-answer-text-input");
    const addAnswerButton = document.querySelector("[data-add-test-page-answer]");
    if (!questionInput || !textInput || !addAnswerButton) return { ok: false, reason: "answer controls not found" };

    questionInput.value = answerQuestion || "1";
    questionInput.dispatchEvent(new Event("input", { bubbles: true }));
    textInput.value = answerText;
    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    addAnswerButton.click();
    const placementBanner = await waitFor(() => document.querySelector(".test-page-comment-placement-banner"), 12000);
    if (!placementBanner) return { ok: false, reason: "answer placement banner was not shown" };
    const markerSurface = await waitFor(() => document.querySelector("[data-test-page-marker-surface]"), 12000);
    if (!markerSurface) return { ok: false, reason: "answer marker surface not found" };
    const visualContainerBeforePlace = document.querySelector("#test-page-visual-content");
    const markerSurfaceBeforePlace = markerSurface;
    const surfaceRect = markerSurface.getBoundingClientRect();
    markerSurface.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: surfaceRect.left + surfaceRect.width * 0.34,
      clientY: surfaceRect.top + surfaceRect.height * 0.28
    }));
    const placedMarker = await waitFor(() => answerMarkerForText(answerText), 12000);
    if (!placedMarker) return { ok: false, reason: "answer marker was not placed" };
    const visualContainerRetainedAfterPlace = visualContainerBeforePlace === document.querySelector("#test-page-visual-content");
    const markerSurfaceRetainedAfterPlace = markerSurfaceBeforePlace === document.querySelector("[data-test-page-marker-surface]");
    const placementBannerRemovedAfterPlace = !document.querySelector(".test-page-comment-placement-banner");
    await sleep(600);

    const afterAddEditorOpen = Boolean(document.querySelector("[data-test-page-answer-editor]"));
    const pageButtonAgain = document.querySelector('[data-select-test-page="' + pageId + '"]');
    pageButtonAgain?.click();
    await waitFor(() => answerMarkerForText(answerText), 12000);
    await sleep(500);
    const afterReselectEditorOpen = Boolean(document.querySelector("[data-test-page-answer-editor]"));
    const markerToOpen = answerMarkerForText(answerText);
    const markerText = markerToOpen?.textContent?.trim() || "";
    const markerIdToOpen = markerToOpen?.dataset?.testPageAnswerMarker || "";
    if (!markerToOpen) return { ok: false, reason: "answer marker was not found before edit" };
    const visualContainerBeforeMarkerEdit = document.querySelector("#test-page-visual-content");
    const visualScrollBeforeMarkerEdit = markerToOpen.closest(".page-layout-scroll, .test-page-visual-fallback-frame");
    if (visualScrollBeforeMarkerEdit) {
      visualScrollBeforeMarkerEdit.scrollTop = Math.min(120, Math.max(0, visualScrollBeforeMarkerEdit.scrollHeight - visualScrollBeforeMarkerEdit.clientHeight));
    }
    const visualScrollTopBeforeMarkerEdit = visualScrollBeforeMarkerEdit?.scrollTop || 0;
    markerToOpen.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    const editorAfterMarkerClick = await waitFor(() => document.querySelector("[data-test-page-answer-text]"), 12000);
    const visualContainerRetainedAfterMarkerEdit = visualContainerBeforeMarkerEdit === document.querySelector("#test-page-visual-content");
    const visualScrollAfterMarkerEdit = document.querySelector("[data-test-page-answer-marker]")?.closest(".page-layout-scroll, .test-page-visual-fallback-frame") || visualScrollBeforeMarkerEdit;
    const visualScrollRetainedAfterMarkerEdit = Math.abs((visualScrollAfterMarkerEdit?.scrollTop || 0) - visualScrollTopBeforeMarkerEdit) <= 1;
    if (!editorAfterMarkerClick) {
      return {
        ok: false,
        reason: "answer editor did not open from marker",
        markerClickDebug: {
          markerIdToOpen,
          markerConnected: markerToOpen.isConnected,
          markerCount: document.querySelectorAll("[data-test-page-answer-marker]").length,
          commentPanelText: document.querySelector(".test-page-comment-panel")?.textContent?.trim() || "",
          placingBannerVisible: Boolean(document.querySelector(".test-page-comment-placement-banner")),
          markerTitles: [...document.querySelectorAll("[data-test-page-answer-marker]")].map(marker => marker.getAttribute("title") || "")
        }
      };
    }
    await sleep(300);
    const savedAnswers = async () => {
      const db = await fetch("/api/database").then(response => response.json());
      const savedPage = (db.nationalTestPages || []).find(item => item.id === pageId);
      return savedPage?.answers || [];
    };
    await sleep(1000);
    const answersAfterAdd = await savedAnswers();
    const savedAfterAdd = answersAfterAdd.find(answer => answer.answer === answerText);
    const persistedAfterAdd = Boolean(
      savedAfterAdd &&
      Number.isFinite(Number(savedAfterAdd.xPercent)) &&
      Number.isFinite(Number(savedAfterAdd.yPercent))
    );

    let persistedAfterEdit = false;
    if (answerEditText) {
      const editInput = document.querySelector("[data-test-page-answer-text]");
      if (editInput) {
        editInput.value = answerEditText;
        editInput.dispatchEvent(new Event("input", { bubbles: true }));
        editInput.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(1200);
        persistedAfterEdit = (await savedAnswers()).some(answer => answer.answer === answerEditText);
      }
    }

    let removedAfterCleanup = false;
    if (cleanupAnswer) {
      document.querySelector("[data-delete-test-page-answer]")?.click();
      await sleep(1200);
      const textsAfterDelete = (await savedAnswers()).map(answer => answer.answer || "");
      removedAfterCleanup = !textsAfterDelete.includes(answerText) && (!answerEditText || !textsAfterDelete.includes(answerEditText));
    }

    answers = {
      attempted: true,
      placementBannerShown: true,
      visualContainerRetainedAfterPlace,
      markerSurfaceRetainedAfterPlace,
      placementBannerRemovedAfterPlace,
      visualContainerRetainedAfterMarkerEdit,
      visualScrollRetainedAfterMarkerEdit,
      afterAddEditorOpen,
      afterReselectEditorOpen,
      editorOpenedAfterMarkerClick: Boolean(editorAfterMarkerClick),
      markerCount: document.querySelectorAll("[data-test-page-answer-marker]").length,
      pageAnswerMarkerCount: document.querySelectorAll(".test-page-marker--answers").length,
      markerText,
      persistedAfterAdd,
      persistedAfterEdit,
      removedAfterCleanup
    };
  }

  let pageWords = { attempted: false };
  if (pageWord) {
    const wordInput = await waitFor(() => document.querySelector("#test-page-word-input"), 12000);
    const noteInput = document.querySelector("#test-page-word-note-input");
    const addWordButton = document.querySelector("[data-add-test-page-word]");
    if (!wordInput || !noteInput || !addWordButton) return { ok: false, reason: "page word controls not found" };

    const savedPageWords = async () => {
      const db = await fetch("/api/database").then(response => response.json());
      const savedPage = (db.nationalTestPages || []).find(item => item.id === pageId);
      return savedPage?.words || [];
    };
    const pageWordChipForText = text => [...document.querySelectorAll(".test-page-word-chip")]
      .find(chip => chip.querySelector("strong")?.textContent?.trim() === text);

    const visualContainerBeforePageWord = document.querySelector("#test-page-visual-content");
    const layoutPageBeforePageWord = document.querySelector(".page-layout-page, .test-page-visual-fallback-surface");
    wordInput.value = pageWord;
    wordInput.dispatchEvent(new Event("input", { bubbles: true }));
    noteInput.value = pageWordNote || "";
    noteInput.dispatchEvent(new Event("input", { bubbles: true }));
    noteInput.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true
    }));
    const addedChip = await waitFor(() => pageWordChipForText(pageWord), 12000);
    if (!addedChip) return { ok: false, reason: "page word chip was not added" };
    const visualContainerRetainedAfterAdd = visualContainerBeforePageWord === document.querySelector("#test-page-visual-content");
    const layoutPageRetainedAfterAdd = layoutPageBeforePageWord === document.querySelector(".page-layout-page, .test-page-visual-fallback-surface");
    await sleep(1000);
    const persistedAfterAdd = (await savedPageWords()).some(item => item.word === pageWord && (pageWordNote ? item.note === pageWordNote : true));

    const pageButtonAgain = document.querySelector('[data-select-test-page="' + pageId + '"]');
    pageButtonAgain?.click();
    const visibleAfterReselect = Boolean(await waitFor(() => pageWordChipForText(pageWord), 12000));

    let removedAfterCleanup = false;
    if (cleanupPageWord) {
      const chip = pageWordChipForText(pageWord);
      chip?.querySelector("[data-remove-test-page-word]")?.click();
      await sleep(1200);
      removedAfterCleanup = !(await savedPageWords()).some(item => item.word === pageWord);
    }

    pageWords = {
      attempted: true,
      submitMethod: "enter",
      visibleAfterAdd: Boolean(addedChip),
      visualContainerRetainedAfterAdd,
      layoutPageRetainedAfterAdd,
      visibleAfterReselect,
      persistedAfterAdd,
      removedAfterCleanup
    };
  }

  let softAdd = { attempted: false };
  if (softAddWord) {
    const panelBefore = document.querySelector(".test-study-panel");
    const visualContainerBefore = document.querySelector("#test-page-visual-content");
    const knownBefore = document.querySelectorAll(".test-known-word").length;
    const lookupInput = await waitFor(() => document.querySelector("#test-lookup-word-input"));
    const lookupButton = document.querySelector("#test-lookup-word-button");
    if (!lookupInput || !lookupButton) return { ok: false, reason: "test lookup controls not found" };

    lookupInput.value = softAddWord;
    lookupInput.dispatchEvent(new Event("input", { bubbles: true }));
    lookupButton.click();

    const saveButton = await waitFor(() => document.querySelector("[data-test-lookup-save]"), 12000);
    if (!saveButton) return { ok: false, reason: "test lookup save button not found" };
    saveButton.click();
    await waitFor(() => document.querySelector("#toast.visible"), 12000);
    await sleep(900);

    softAdd = {
      attempted: true,
      panelRetained: panelBefore === document.querySelector(".test-study-panel"),
      visualContainerRetained: visualContainerBefore === document.querySelector("#test-page-visual-content"),
      knownBefore,
      knownAfter: document.querySelectorAll(".test-known-word").length,
      activePageText: document.querySelector(".test-page-button.active")?.textContent?.trim() || "",
      toastText: document.querySelector("#toast")?.textContent?.trim() || ""
    };
  }

  const page = document.querySelector(".page-layout-page") || document.querySelector(".test-page-visual-fallback-frame img");
  const scroll = page?.closest(".page-layout-scroll") || page?.closest(".test-page-visual-fallback-frame");
  const stage = document.querySelector(".test-page-stage");
  const listPanel = document.querySelector(".test-page-list-panel");
  const editor = document.querySelector(".test-page-editor");
  const cardHeader = document.querySelector(".test-page-card-header");
  const pdfFrame = document.querySelector(".test-page-pdf-frame");
  const topbar = document.querySelector(".topbar");
  const studyHeader = document.querySelector(".test-study-header");
  const importPanel = document.querySelector(".test-page-import-panel");
  const rect = page?.getBoundingClientRect();
  const scrollRect = scroll?.getBoundingClientRect();
  const stageRect = stage?.getBoundingClientRect();
  const listRect = listPanel?.getBoundingClientRect();
  const editorRect = editor?.getBoundingClientRect();
  const pdfFrameRect = pdfFrame?.getBoundingClientRect();

  return {
    ok: true,
    heading: document.querySelector(".test-page-card h3")?.textContent?.trim() || "",
    pageWidth: Math.round(rect?.width || 0),
    pageHeight: Math.round(rect?.height || 0),
    scrollWidth: Math.round(scrollRect?.width || 0),
    scrollHeight: Math.round(scrollRect?.height || 0),
    emptyRight: Math.round((scrollRect?.right || 0) - (rect?.right || 0)),
    stageWidth: Math.round(stageRect?.width || 0),
    listWidth: Math.round(listRect?.width || 0),
    editorWidth: Math.round(editorRect?.width || 0),
    topbarHeight: Math.round(topbar?.getBoundingClientRect().height || 0),
    studyHeaderHeight: Math.round(studyHeader?.getBoundingClientRect().height || 0),
    importHeight: Math.round(importPanel?.getBoundingClientRect().height || 0),
    saveText: document.querySelector("[data-save-test-page]")?.textContent?.trim() || "",
    pdfToggleText: document.querySelector("[data-toggle-test-page-pdf]")?.textContent?.trim() || "",
    visualZoomText: document.querySelector("[data-test-page-visual-zoom-value]")?.textContent?.trim() || "",
    hasPdfFrame: Boolean(pdfFrame),
    pdfFrameWidth: Math.round(pdfFrameRect?.width || 0),
    pdfFrameHeight: Math.round(pdfFrameRect?.height || 0),
    hasDelete: Boolean(document.querySelector("[data-delete-test-page]")),
    selectedPageText: document.querySelector(".test-page-button.active")?.textContent?.trim() || "",
    activePageId: document.querySelector(".test-page-button.active")?.dataset?.selectTestPage || "",
    markerCounts: {
      last: document.querySelectorAll(".test-page-marker--last").length,
      classified: document.querySelectorAll(".test-page-marker--classified").length,
      words: document.querySelectorAll(".test-page-marker--words").length,
      answers: document.querySelectorAll(".test-page-marker--answers").length,
      activeLast: document.querySelector(".test-page-button.active .test-page-marker--last") ? 1 : 0
    },
    split,
    draftAnswer,
    stickyTools,
    skillProgress,
    answers,
    pageWords,
    unlink,
    knownReturn,
    softAdd
  };
})()
'@
    $cleanupAnswerValue = if (@("true", "1", "yes", "on").Contains($CleanupAnswer.ToLowerInvariant())) { "true" } else { "false" }
    $cleanupPageWordValue = if (@("true", "1", "yes", "on").Contains($CleanupPageWord.ToLowerInvariant())) { "true" } else { "false" }
    $unlinkKnownWordValue = if (@("true", "1", "yes", "on").Contains($UnlinkKnownWord.ToLowerInvariant())) { "true" } else { "false" }
    $returnFromKnownWordValue = if (@("true", "1", "yes", "on").Contains($ReturnFromKnownWord.ToLowerInvariant())) { "true" } else { "false" }
    $checkSkillProgressValue = if (@("true", "1", "yes", "on").Contains($CheckSkillProgress.ToLowerInvariant())) { "true" } else { "false" }
    $checkStickyToolsValue = if (@("true", "1", "yes", "on").Contains($CheckStickyTools.ToLowerInvariant())) { "true" } else { "false" }
    $splitViewValue = if (@("true", "1", "yes", "on").Contains($SplitView.ToLowerInvariant())) { "true" } else { "false" }
    $script = $script.Replace("__TEST_ID__", $TestId).Replace("__PAGE_ID__", $PageId).Replace("__SOFT_ADD_WORD_JSON__", ($SoftAddWord | ConvertTo-Json -Compress)).Replace("__ANSWER_QUESTION_JSON__", ($AnswerQuestion | ConvertTo-Json -Compress)).Replace("__ANSWER_TEXT_JSON__", ($AnswerText | ConvertTo-Json -Compress)).Replace("__ANSWER_EDIT_TEXT_JSON__", ($AnswerEditText | ConvertTo-Json -Compress)).Replace("__CLEANUP_ANSWER_JSON__", $cleanupAnswerValue).Replace("__DRAFT_ANSWER_QUESTION_JSON__", ($DraftAnswerQuestion | ConvertTo-Json -Compress)).Replace("__DRAFT_ANSWER_TEXT_JSON__", ($DraftAnswerText | ConvertTo-Json -Compress)).Replace("__PAGE_WORD_JSON__", ($PageWord | ConvertTo-Json -Compress)).Replace("__PAGE_WORD_NOTE_JSON__", ($PageWordNote | ConvertTo-Json -Compress)).Replace("__CLEANUP_PAGE_WORD_JSON__", $cleanupPageWordValue).Replace("__UNLINK_KNOWN_WORD_JSON__", $unlinkKnownWordValue).Replace("__RETURN_FROM_KNOWN_WORD_JSON__", $returnFromKnownWordValue).Replace("__CHECK_SKILL_PROGRESS_JSON__", $checkSkillProgressValue).Replace("__CHECK_STICKY_TOOLS_JSON__", $checkStickyToolsValue).Replace("__SPLIT_VIEW_JSON__", $splitViewValue).Replace("__SPLIT_PAGE_ID__", $SplitPageId).Replace("__SKIP_SELECT_JSON__", $skipSelectValue)
  }

  $result = Send-CdpCommand -Socket $socket -NextId ([ref]$nextId) -Method "Runtime.evaluate" -Params @{
    expression = $script
    awaitPromise = $true
    returnByValue = $true
  }

  $metrics = $result.result.value
  if (-not $metrics -or -not ($metrics.PSObject.Properties.Name -contains "ok")) {
    throw "Visual check failed: unexpected result $($result | ConvertTo-Json -Depth 8)"
  }
  if ($metrics.ok -ne $true) {
    throw "Visual check failed: $($metrics | ConvertTo-Json -Depth 8)"
  }

  $screenshot = Send-CdpCommand -Socket $socket -NextId ([ref]$nextId) -Method "Page.captureScreenshot" -Params @{
    format = "png"
    fromSurface = $true
  }
  [IO.File]::WriteAllBytes($resolvedOutput, [Convert]::FromBase64String($screenshot.data))
  $metrics | ConvertTo-Json -Depth 6
} finally {
  if ($socket) {
    try {
      $socket.Dispose()
    } catch {}
  }
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  if ($profile -and $profile.StartsWith($env:TEMP) -and (Split-Path -Leaf $profile).StartsWith("codex-chrome-profile-")) {
    Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
  }
}
