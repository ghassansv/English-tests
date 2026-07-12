import {
  displayLayoutForPage,
  layoutTextValues,
  normalizeNationalTestPageLayout,
  pageLayoutFromPageInput,
  shouldPreferPdfScanVisualFallback
} from "./js/page-layout-normalizer.js?v=a4-layout-1";
import {
  classNames,
  emptyStateHtml,
  escapeHtml,
  icon,
  imageMapperStateHtml,
  joinHtml,
  lookupStateHtml,
  pipe
} from "./js/render-utils.js";
import { cardHeaderHtml, iconButtonHtml } from "./js/card-components.js";
import {
  ACTIVE_SECTION_STORAGE_KEY,
  DATABASE_CACHE_SCHEMA_VERSION,
  DATABASE_CACHE_STORAGE_KEY,
  DEFAULT_REVIEW_WORD_COUNT,
  ESSAY_BODY_PARAGRAPH_FIELDS,
  ESSAY_BODY_PARAGRAPH_MAX,
  ESSAY_BODY_PARAGRAPH_MIN,
  ESSAY_BODY_STARTERS,
  ESSAY_SUPPORT_FIELDS,
  ESSAY_SUPPORT_MAX,
  ESSAY_SUPPORT_MIN,
  NATIONAL_TEST_PAGE_GROUP_COLLAPSE_STORAGE_KEY,
  NATIONAL_TEST_PROGRESS_STORAGE_KEY,
  NATIONAL_TEST_SECTIONS,
  NATIONAL_TEST_SOURCE_NAME,
  SEARCH_DEBOUNCE_MS,
  SOURCE_TREE_COLLAPSE_STORAGE_KEY,
  STUDY_AUTOSAVE_DELAY_MS,
  STUDY_TEXT_RENDER_BATCH_SIZE,
  STUDY_TEXT_TYPES,
  STUDY_VIDEO_RENDER_BATCH_SIZE,
  STUDY_VIDEO_TYPES,
  TEST_KNOWN_TOKEN_IGNORE_STORAGE_KEY,
  TEST_PAGE_GROUPING_TOOL_COLLAPSE_STORAGE_KEY,
  TEST_PAGE_GROUPING_TOOL_HIDDEN_STORAGE_KEY,
  TEST_PAGE_LIST_COLLAPSE_STORAGE_KEY,
  TEST_PAGE_LIST_WIDTH_STORAGE_KEY,
  TEST_PAGE_PDF_COLLAPSE_STORAGE_KEY,
  TEST_PAGE_PDF_ZOOM_MAX,
  TEST_PAGE_PDF_ZOOM_MIN,
  TEST_PAGE_PDF_ZOOM_STEP,
  TEST_PAGE_PDF_ZOOM_STORAGE_KEY,
  TEST_PAGE_PRACTICE_WIDTH_STORAGE_KEY,
  TEST_PAGE_TRANSLATION_LANGUAGE_STORAGE_KEY,
  TEST_PAGE_VISUAL_ZOOM_STORAGE_KEY,
  TEST_PAGE_VISUAL_ZOOM_MAX,
  TEST_PAGE_VISUAL_ZOOM_MIN,
  TEST_PAGE_VISUAL_ZOOM_STEP,
  TEST_PAGE_WORD_PRACTICE_HIDDEN_STORAGE_KEY,
  UNGROUPED_NATIONAL_TEST_TOPIC,
  WORD_RENDER_BATCH_SIZE
} from "./js/app-config.js?v=study-workspace-compact-v1";
import {
  normalizedPageSearchText,
  normalizedSearchText,
  pageSearchTokens,
  searchTerms as wordSearchTerms
} from "./js/search-utils.js";
import { IPA_SOUND_MAP, IPA_SOUND_TOKENS } from "./js/ipa-sound-map.js";
import {
  KNOWN_WORD_DERIVATIVE_MIN_BASE_LENGTH,
  KNOWN_WORD_DERIVATIVE_PREFIXES,
  KNOWN_WORD_DERIVATIVE_SUFFIXES,
  KNOWN_WORD_IRREGULAR_BASE_CANDIDATES,
  KNOWN_WORD_PREFIX_MIN_BASE_LENGTH
} from "./js/known-word-config.js";
import { renderPageLayoutToHtml } from "./page-layout.js?v=a4-layout-1";
import { validateStudyDocumentV1 } from "./js/study-document-v1.js?v=canonical-study-document-v1-2";
import { renderStudyDocumentV1ToHtml } from "./js/study-document-v1-renderer.js?v=canonical-study-document-renderer-v1-6";
import {
  studyDocumentPagePrompt,
  validateStudyDocumentPageBinding
} from "./js/study-document-page-binding.js?v=canonical-study-document-binding-v1-3";
import {
  officialStudyDocumentAnswers,
  validateOfficialStudyDocumentAnswerMapping
} from "./js/study-document-official-answers.js?v=canonical-study-document-answers-v1-2";
import {
  applyOfficialAnswerTranslation,
  applyStudyDocumentTranslation,
  studyDocumentArabicPrompt,
  validateStudyDocumentTranslationV1
} from "./js/study-document-translation-v1.js?v=canonical-study-document-translation-v1-2";

let videoEffectsModulePromise = null;

const QUIET_VIDEO_CONSTRAINTS = {
  width: { ideal: 640, max: 1280 },
  height: { ideal: 360, max: 720 },
  frameRate: { ideal: 24, max: 24 }
};

const state = {
  db: { sources: [], words: [], verbs: [], studyTexts: [], studyVideos: [], nationalTests: [], nationalTestPages: [] },
  activeSection: "vault",
  selected: { sourceId: "", branchId: "", unitId: "" },
  filters: { search: "", from: "", to: "", sourceId: "", branchId: "", unitId: "", partOfSpeech: "", arabic: "" },
  verbFilters: { search: "" },
  studyFilters: { search: "", sourceId: "", branchId: "", unitId: "", type: "" },
  videoFilters: { search: "", sourceId: "", branchId: "", unitId: "", type: "" },
  nationalTestFilters: { search: "" },
  renderLimits: { words: 50, studyTexts: 50, studyVideos: 20 },
  activeTab: "single",
  vaultEditorOpen: false,
  activeLibraryTab: "words",
  activeStudyTextId: "",
  activeStudyVideoId: "",
  essayLegacyEditUnlocked: false,
  activeVerbId: "",
  focusedVerbId: "",
  activeNationalTestId: "",
  activeNationalTestPageId: "",
  activeNationalTestListeningTopicKey: "",
  activeNationalTestTranscriptViewer: null,
  nationalTestPagesLoaded: false,
  nationalTestPagesLoading: null,
  listeningMediaFiles: { loaded: false, loading: null, audio: [], transcripts: [] },
  activeNationalTestSectionFilter: "all",
  activeNationalTestPageSearch: "",
  expandedNationalTestSearchMatchIds: new Set(),
  nationalTestRenamingId: "",
  nationalTestRenameSavingId: "",
  nationalTestDetailsEditingId: "",
  nationalTestDetailsSavingId: "",
  nationalTestProgress: {},
  nationalTestFormOpen: false,
  nationalTestFocusMode: false,
  testWordReturn: null,
  studyAutosave: {
    timer: null,
    inFlight: false,
    promise: null,
    dirty: false,
    lastSignature: "",
    lastSavedAt: "",
    token: 0
  },
  vocabularyPractice: {
    wordIds: [],
    status: "No words selected"
  },
  sourceWritingPractice: {
    active: false,
    location: { sourceId: "", branchId: "", unitId: "" },
    label: "",
    mode: "example",
    entries: [],
    input: "",
    acceptedKeys: new Set(),
    acceptedPhrases: [],
    status: "",
    message: "",
    lastFeedback: null
  },
  selectedWordIds: new Set(),
  visibleArabicTranslationWordIds: new Set(),
  visibleIpaPronunciationWordIds: new Set(),
  focusedWordId: "",
  bulkLocation: { sourceId: "", branchId: "", unitId: "" },
  practiceModePicker: {
    active: false,
    words: []
  },
  soundPractice: {
    active: false,
    words: [],
    index: 0,
    completed: false
  },
  pronunciations: {
    refreshing: false,
    loadingIds: new Set(),
    audio: null
  },
  lookup: {
    loading: false,
    query: "",
    candidates: [],
    suggestions: [],
    references: {},
    appliedThesaurus: null
  },
  testLookup: {
    loading: false,
    query: "",
    candidates: [],
    suggestions: [],
    references: {}
  },
  practice: {
    active: false,
    source: "free",
    sessionId: "",
    sessionMeta: null,
    sessionCompleted: false,
    saveProgress: true,
    mode: "choice-write",
    words: [],
    queue: [],
    current: null,
    answered: 0,
    correct: 0,
    total: 0,
    misses: {},
    reviewCount: 0,
    result: null,
    stage: "decide",
    choices: [],
    blankPrompt: null,
    choiceFeedback: null,
    complete: false
  },
  pronunciationRecorder: {
    activeWordId: "",
    recorder: null,
    stream: null,
    chunks: [],
    recordingUrl: "",
    audio: null,
    status: "Ready",
    discardRecording: false
  },
  review: {
    active: false,
    sessionId: "",
    words: [],
    index: 0,
    dueCount: 0,
    weakCount: 0,
    oldCount: 0,
    newCount: 0,
    target: 10,
    resumed: false
  },
  sourceTreeCollapsed: new Set(),
  nationalTestPageGroupsCollapsed: new Set(),
  ignoredKnownTokens: new Set(),
  testPageGroupingToolCollapsed: false,
  testPageGroupingToolHidden: false,
  testPagePdfCollapsed: false,
  testPageWordPracticeHidden: false,
  testPageListCollapsed: true,
  testPageListWidth: 0.42,
  testPagePracticeWidth: 0.5,
  testPagePdfZoom: 1,
  testPageVisualZoom: 1,
  testPageTranslationLanguage: "en",
  testPageOfficialAnswersVisible: false,
  testPageSplitView: false,
  testPageSplitMode: "translation",
  testPageSplitPageId: "",
  testPageAnswerComposerOpen: false,
  testPageAnswerDrafts: new Map(),
  testPageWordPractice: {
    pageId: "",
    input: "",
    acceptedKeys: new Set(),
    acceptedPhrases: [],
    status: "",
    message: ""
  },
  editingTestPageAnswerId: "",
  placingTestPageAnswerId: "",
  testPageAnswerAutosave: {
    timer: null,
    inFlight: false,
    pending: false,
    pageId: ""
  },
  jsonImages: new Map(),
  pendingImageIndex: null,
  videoRecorder: {
    stream: null,
    recorder: null,
    chunks: [],
    blob: null,
    file: null,
    objectUrl: "",
    stopPromise: null,
    stopResolve: null,
    recordingStream: null,
    effect: null,
    backgroundImage: null,
    backgroundImageUrl: ""
  }
};

const TEST_PAGE_PRACTICE_WIDTH_DEFAULT = 0.5;
const TEST_PAGE_PRACTICE_WIDTH_MIN = 0.22;
const TEST_PAGE_PRACTICE_WIDTH_MAX = 0.72;
const TEST_PAGE_LIST_WIDTH_DEFAULT = 0.42;
const TEST_PAGE_LIST_WIDTH_MIN = 0.28;
const TEST_PAGE_LIST_WIDTH_MAX = 0.68;

const nationalTestPdfPreviewCache = new Map();
let pdfJsModulePromise = null;

const els = {
  appShell: document.querySelector(".app-shell"),
  wordCount: document.querySelector("#word-count"),
  workspace: document.querySelector(".workspace"),
  vaultSectionButton: document.querySelector("#vault-section-button"),
  verbsSectionButton: document.querySelector("#verbs-section-button"),
  testsSectionButton: document.querySelector("#tests-section-button"),
  headerSearch: document.querySelector("#header-search"),
  sourcePanel: document.querySelector("#source-panel"),
  sourceToggleButton: document.querySelector("#source-toggle-button"),
  sourceTree: document.querySelector("#source-tree"),
  sourceForm: document.querySelector("#source-form"),
  sourceName: document.querySelector("#source-name"),
  refreshButton: document.querySelector("#refresh-button"),
  editorBackButton: document.querySelector("#editor-back-button"),
  singleTab: document.querySelector("#single-tab"),
  jsonTab: document.querySelector("#json-tab"),
  studyTab: document.querySelector("#study-tab"),
  videoTab: document.querySelector("#video-tab"),
  testTab: document.querySelector("#test-tab"),
  wordForm: document.querySelector("#word-form"),
  wordEntryFields: document.querySelector("#word-entry-fields"),
  wordPathBadge: document.querySelector("#word-path-badge"),
  wordPathBadgeText: document.querySelector("#word-path-badge-text"),
  jsonForm: document.querySelector("#json-form"),
  verbForm: document.querySelector("#verb-form"),
  studyForm: document.querySelector("#study-form"),
  videoForm: document.querySelector("#video-form"),
  testForm: document.querySelector("#test-form"),
  editingId: document.querySelector("#editing-id"),
  editingTextId: document.querySelector("#editing-text-id"),
  editingVideoId: document.querySelector("#editing-video-id"),
  wordSource: document.querySelector("#word-source"),
  wordBranch: document.querySelector("#word-branch"),
  wordUnit: document.querySelector("#word-unit"),
  wordInput: document.querySelector("#word-input"),
  lookupWordButton: document.querySelector("#lookup-word-button"),
  lookupThesaurusInput: document.querySelector("#lookup-thesaurus-input"),
  lookupResults: document.querySelector("#lookup-results"),
  partOfSpeechInput: document.querySelector("#part-of-speech-input"),
  definitionInput: document.querySelector("#definition-input"),
  arabicTranslationInput: document.querySelector("#arabic-translation-input"),
  collocationsInput: document.querySelector("#collocations-input"),
  examplesInput: document.querySelector("#examples-input"),
  synonymsInput: document.querySelector("#synonyms-input"),
  imageInput: document.querySelector("#image-input"),
  singleImageDropBox: document.querySelector("#single-image-drop-box"),
  singleImageStatus: document.querySelector("#single-image-status"),
  removeImageInput: document.querySelector("#remove-image-input"),
  saveLabel: document.querySelector("#save-label"),
  resetFormButton: document.querySelector("#reset-form-button"),
  jsonSource: document.querySelector("#json-source"),
  jsonBranch: document.querySelector("#json-branch"),
  jsonUnit: document.querySelector("#json-unit"),
  studySource: document.querySelector("#study-source"),
  studyBranch: document.querySelector("#study-branch"),
  studyUnit: document.querySelector("#study-unit"),
  studyTitle: document.querySelector("#study-title"),
  studyType: document.querySelector("#study-type"),
  studyContent: document.querySelector("#study-content"),
  studyContentField: document.querySelector("#study-content-field"),
  vocabularyPractice: document.querySelector("#vocabulary-practice"),
  vocabularyPracticeFrom: document.querySelector("#vocabulary-practice-from"),
  vocabularyPracticeTo: document.querySelector("#vocabulary-practice-to"),
  vocabularyPracticeCount: document.querySelector("#vocabulary-practice-count"),
  vocabularyPracticeRandomButton: document.querySelector("#vocabulary-practice-random-button"),
  vocabularyPracticeStartButton: document.querySelector("#vocabulary-practice-start-button"),
  vocabularyPracticeStatus: document.querySelector("#vocabulary-practice-status"),
  vocabularyPracticeWords: document.querySelector("#vocabulary-practice-words"),
  essayBuilder: document.querySelector("#essay-builder"),
  essayProgress: document.querySelector("#essay-progress"),
  essayTotalWordCount: document.querySelector("#essay-total-word-count"),
  essayBodyParagraphCount: document.querySelector("#essay-body-paragraph-count"),
  essayBodyParagraphs: document.querySelector("#essay-body-paragraphs"),
  essaySources: document.querySelector("#essay-sources"),
  essayPlan: document.querySelector("#essay-plan"),
  essayHook: document.querySelector("#essay-hook"),
  essayThesis: document.querySelector("#essay-thesis"),
  essayConclusion: document.querySelector("#essay-conclusion"),
  essayConclusionHint: document.querySelector("#essay-conclusion-hint"),
  studySaveLabel: document.querySelector("#study-save-label"),
  studyAutosaveStatus: document.querySelector("#study-autosave-status"),
  resetStudyFormButton: document.querySelector("#reset-study-form-button"),
  videoSource: document.querySelector("#video-source"),
  videoBranch: document.querySelector("#video-branch"),
  videoUnit: document.querySelector("#video-unit"),
  videoTitle: document.querySelector("#video-title"),
  videoType: document.querySelector("#video-type"),
  videoBackgroundMode: document.querySelector("#video-background-mode"),
  backgroundImageRow: document.querySelector("#background-image-row"),
  pickVideoBackgroundButton: document.querySelector("#pick-video-background-button"),
  clearVideoBackgroundButton: document.querySelector("#clear-video-background-button"),
  videoBackgroundInput: document.querySelector("#video-background-input"),
  videoBackgroundStatus: document.querySelector("#video-background-status"),
  videoPreview: document.querySelector("#video-preview"),
  videoStatus: document.querySelector("#video-status"),
  startVideoRecordingButton: document.querySelector("#start-video-recording-button"),
  stopVideoRecordingButton: document.querySelector("#stop-video-recording-button"),
  pickVideoButton: document.querySelector("#pick-video-button"),
  clearVideoButton: document.querySelector("#clear-video-button"),
  videoInput: document.querySelector("#video-input"),
  videoSaveLabel: document.querySelector("#video-save-label"),
  resetVideoFormButton: document.querySelector("#reset-video-form-button"),
  testLookupPanel: document.querySelector("#test-lookup-panel"),
  testWordLookupPanel: document.querySelector("#test-word-lookup-panel"),
  testTitle: document.querySelector("#test-title"),
  testCourse: document.querySelector("#test-course"),
  testTerm: document.querySelector("#test-term"),
  testYear: document.querySelector("#test-year"),
  testDescription: document.querySelector("#test-description"),
  pickTestPdfButton: document.querySelector("#pick-test-pdf-button"),
  clearTestPdfButton: document.querySelector("#clear-test-pdf-button"),
  testPdfInput: document.querySelector("#test-pdf-input"),
  testPdfStatus: document.querySelector("#test-pdf-status"),
  pickTestListeningAudioButton: document.querySelector("#pick-test-listening-audio-button"),
  clearTestListeningAudioButton: document.querySelector("#clear-test-listening-audio-button"),
  testListeningAudioCreateInput: document.querySelector("#test-listening-audio-create-input"),
  testListeningAudioCreateStatus: document.querySelector("#test-listening-audio-create-status"),
  pickTestListeningTranscriptButton: document.querySelector("#pick-test-listening-transcript-button"),
  clearTestListeningTranscriptButton: document.querySelector("#clear-test-listening-transcript-button"),
  testListeningTranscriptCreateInput: document.querySelector("#test-listening-transcript-create-input"),
  testListeningTranscriptCreateStatus: document.querySelector("#test-listening-transcript-create-status"),
  testSaveLabel: document.querySelector("#test-save-label"),
  resetTestFormButton: document.querySelector("#reset-test-form-button"),
  testLookupWordInput: document.querySelector("#test-lookup-word-input"),
  testLookupThesaurusInput: document.querySelector("#test-lookup-thesaurus-input"),
  testLookupWordButton: document.querySelector("#test-lookup-word-button"),
  testLookupResults: document.querySelector("#test-lookup-results"),
  jsonInput: document.querySelector("#json-input"),
  verbJsonInput: document.querySelector("#verb-json-input"),
  clearVerbJsonButton: document.querySelector("#clear-verb-json-button"),
  jsonBuildImagesButton: document.querySelector("#json-build-images-button"),
  jsonImageFileInput: document.querySelector("#json-image-file-input"),
  jsonImageMapper: document.querySelector("#json-image-mapper"),
  wordsLibraryTab: document.querySelector("#words-library-tab"),
  textsLibraryTab: document.querySelector("#texts-library-tab"),
  videosLibraryTab: document.querySelector("#videos-library-tab"),
  testsLibraryTab: document.querySelector("#tests-library-tab"),
  libraryTabs: document.querySelector(".library-tabs"),
  verbLibraryView: document.querySelector("#verb-library-view"),
  wordLibraryView: document.querySelector("#word-library-view"),
  studyLibraryView: document.querySelector("#study-library-view"),
  videoLibraryView: document.querySelector("#video-library-view"),
  testLibraryView: document.querySelector("#test-library-view"),
  filterSearch: document.querySelector("#filter-search"),
  filterFrom: document.querySelector("#filter-from"),
  filterTo: document.querySelector("#filter-to"),
  filterSource: document.querySelector("#filter-source"),
  filterBranch: document.querySelector("#filter-branch"),
  filterUnit: document.querySelector("#filter-unit"),
  filterPos: document.querySelector("#filter-pos"),
  filterArabic: document.querySelector("#filter-arabic"),
  clearFiltersButton: document.querySelector("#clear-filters-button"),
  filteredWordCount: document.querySelector("#filtered-word-count"),
  reviewPlanSummary: document.querySelector("#review-plan-summary"),
  reviewWordCount: document.querySelector("#review-word-count"),
  startReviewButton: document.querySelector("#start-review-button"),
  startSoundPracticeButton: document.querySelector("#start-sound-practice-button"),
  selectVisibleButton: document.querySelector("#select-visible-button"),
  fetchPronunciationsButton: document.querySelector("#fetch-pronunciations-button"),
  startPracticeButton: document.querySelector("#start-practice-button"),
  bulkActions: document.querySelector("#bulk-actions"),
  bulkSelectedCount: document.querySelector("#bulk-selected-count"),
  bulkSource: document.querySelector("#bulk-source"),
  bulkBranch: document.querySelector("#bulk-branch"),
  bulkUnit: document.querySelector("#bulk-unit"),
  bulkMoveButton: document.querySelector("#bulk-move-button"),
  bulkDeleteButton: document.querySelector("#bulk-delete-button"),
  bulkClearButton: document.querySelector("#bulk-clear-button"),
  wordList: document.querySelector("#word-list"),
  verbFilterSearch: document.querySelector("#verb-filter-search"),
  filteredVerbCount: document.querySelector("#filtered-verb-count"),
  verbList: document.querySelector("#verb-list"),
  studyFilterSearch: document.querySelector("#study-filter-search"),
  studyFilterSource: document.querySelector("#study-filter-source"),
  studyFilterBranch: document.querySelector("#study-filter-branch"),
  studyFilterUnit: document.querySelector("#study-filter-unit"),
  studyFilterType: document.querySelector("#study-filter-type"),
  clearStudyFiltersButton: document.querySelector("#clear-study-filters-button"),
  filteredStudyTextCount: document.querySelector("#filtered-study-text-count"),
  newStudyTextButton: document.querySelector("#new-study-text-button"),
  studyTextList: document.querySelector("#study-text-list"),
  videoFilterSearch: document.querySelector("#video-filter-search"),
  videoFilterSource: document.querySelector("#video-filter-source"),
  videoFilterBranch: document.querySelector("#video-filter-branch"),
  videoFilterUnit: document.querySelector("#video-filter-unit"),
  videoFilterType: document.querySelector("#video-filter-type"),
  clearVideoFiltersButton: document.querySelector("#clear-video-filters-button"),
  filteredStudyVideoCount: document.querySelector("#filtered-study-video-count"),
  newStudyVideoButton: document.querySelector("#new-study-video-button"),
  studyVideoList: document.querySelector("#study-video-list"),
  filteredNationalTestCount: document.querySelector("#filtered-national-test-count"),
  nationalTestToolbar: document.querySelector("#national-test-toolbar"),
  newNationalTestButton: document.querySelector("#new-national-test-button"),
  nationalTestList: document.querySelector("#national-test-list"),
  testStudyWorkspace: document.querySelector("#test-study-workspace"),
  toast: document.querySelector("#toast")
};

let toastTimer;
let headerSearchDebounceTimer;
let practiceProgressQueue = Promise.resolve();

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function focusPracticeAnswerInput() {
  if (!state.practice.active || state.practice.result || state.practice.complete) {
    return;
  }

  requestAnimationFrame(() => {
    if (state.practice.stage === "decide") {
      const button = els.wordList.querySelector("[data-practice-write-direct]");
      if (button && !button.disabled) {
        button.focus();
      }
      return;
    }
    if (state.practice.stage === "choice") {
      const button = els.wordList.querySelector("[data-practice-choice]");
      if (button && !button.disabled) {
        button.focus();
      }
      return;
    }
    const input = els.wordList.querySelector("#practice-answer-input");
    if (input && !input.disabled) {
      input.focus();
    }
  });
}

function wordCardSelector(wordId) {
  const escaped = window.CSS?.escape
    ? window.CSS.escape(wordId)
    : String(wordId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[data-word-card="${escaped}"]`;
}

function wordCardFromElement(element) {
  return element?.closest?.("[data-word-card]") || null;
}

function updateFocusedWordCards() {
  els.wordList.querySelectorAll("[data-word-card]").forEach(card => {
    const focused = card.dataset.wordCard === state.focusedWordId;
    card.classList.toggle("keyboard-focused", focused);
    if (focused) {
      card.setAttribute("aria-current", "true");
    } else {
      card.removeAttribute("aria-current");
    }
  });
}

function focusWordCard(wordId, options = {}) {
  if (!wordId) return;
  requestAnimationFrame(() => {
    const card = els.wordList.querySelector(wordCardSelector(wordId));
    if (!card) return;
    card.focus({ preventScroll: options.preventScroll ?? false });
    if (options.scroll !== false) {
      card.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}

function focusPronunciationTarget(wordId) {
  if (state.soundPractice.active) {
    focusSoundPracticePrimaryButton();
  } else {
    focusWordCard(wordId, { preventScroll: true, scroll: false });
  }
}

function setFocusedWord(wordId, options = {}) {
  if (!wordId || state.practice.active || state.review.active) return;
  if (!getFilteredWords().some(word => word.id === wordId)) return;
  state.focusedWordId = wordId;
  updateFocusedWordCards();
  if (options.focus) {
    focusWordCard(wordId, options);
  }
}

function testVisualScrollAreas() {
  return [...document.querySelectorAll(
    "#test-page-visual-content .page-layout-scroll, #test-page-visual-content .test-page-visual-fallback-frame"
  )];
}

function testVisualScrollPageId(scrollArea) {
  return scrollArea?.querySelector("[data-test-page-marker-page-id]")?.dataset.testPageMarkerPageId
    || scrollArea?.closest("[data-test-page-split-pane]")?.dataset.testPageSplitPane
    || "";
}

function testVisualScrollSnapshot() {
  return testVisualScrollAreas().map((scrollArea, index) => ({
    pageId: testVisualScrollPageId(scrollArea),
    index,
    scrollTop: scrollArea.scrollTop || 0,
    scrollLeft: scrollArea.scrollLeft || 0
  }));
}

function restoreTestVisualScrolls(snapshot = {}) {
  const savedScrolls = Array.isArray(snapshot.visualScrolls) ? snapshot.visualScrolls : [];
  if (!savedScrolls.length) return;

  const scrollAreas = testVisualScrollAreas();
  savedScrolls.forEach((saved, fallbackIndex) => {
    const pageId = String(saved?.pageId || "");
    const savedIndex = Number(saved?.index);
    const index = Number.isInteger(savedIndex) && savedIndex >= 0 ? savedIndex : fallbackIndex;
    const scrollArea = (pageId ? scrollAreas.find(area => testVisualScrollPageId(area) === pageId) : null)
      || scrollAreas[index];
    if (!scrollArea) return;
    const top = Number(saved?.scrollTop);
    const left = Number(saved?.scrollLeft);
    scrollArea.scrollTop = Number.isFinite(top) ? top : 0;
    scrollArea.scrollLeft = Number.isFinite(left) ? left : 0;
  });
}

function resetTestVisualScrolls() {
  testVisualScrollAreas().forEach(scrollArea => {
    scrollArea.scrollTop = 0;
    scrollArea.scrollLeft = 0;
  });
}

function testReaderScrollAreas() {
  return [...document.querySelectorAll(".test-page-study-column, .test-page-main-column")];
}

function testReaderScrollKind(scrollArea) {
  if (scrollArea?.classList.contains("test-page-main-column")) return "main";
  if (scrollArea?.classList.contains("test-page-study-column")) return "study";
  return "";
}

function testReaderScrollSnapshot() {
  return testReaderScrollAreas().map((scrollArea, index) => ({
    kind: testReaderScrollKind(scrollArea),
    index,
    scrollTop: scrollArea.scrollTop || 0,
    scrollLeft: scrollArea.scrollLeft || 0
  }));
}

function restoreTestReaderScrolls(snapshot = {}, preserveScroll = true) {
  const scrollAreas = testReaderScrollAreas();
  if (!preserveScroll) {
    scrollAreas.forEach(scrollArea => {
      scrollArea.scrollTop = 0;
      scrollArea.scrollLeft = 0;
    });
    return;
  }

  const savedScrolls = Array.isArray(snapshot.readerScrolls) ? snapshot.readerScrolls : [];
  if (!savedScrolls.length) {
    const legacyTop = Number(snapshot.mainColumnScrollTop ?? snapshot.studyColumnScrollTop);
    scrollAreas.forEach(scrollArea => {
      scrollArea.scrollTop = Number.isFinite(legacyTop) ? legacyTop : 0;
    });
    return;
  }

  savedScrolls.forEach((saved, fallbackIndex) => {
    const kind = String(saved?.kind || "");
    const savedIndex = Number(saved?.index);
    const index = Number.isInteger(savedIndex) && savedIndex >= 0 ? savedIndex : fallbackIndex;
    const scrollArea = (kind ? scrollAreas.find(area => testReaderScrollKind(area) === kind) : null)
      || scrollAreas[index];
    if (!scrollArea) return;
    const top = Number(saved?.scrollTop);
    const left = Number(saved?.scrollLeft);
    scrollArea.scrollTop = Number.isFinite(top) ? top : 0;
    scrollArea.scrollLeft = Number.isFinite(left) ? left : 0;
  });
}

function testWordReturnSnapshot(wordId) {
  return {
    ...testStudyViewportSnapshot(),
    testId: state.activeNationalTestId,
    pageId: state.activeNationalTestPageId,
    sectionFilter: state.activeNationalTestSectionFilter,
    wordId
  };
}

function restoreTestWordReturn() {
  const snapshot = state.testWordReturn;
  if (!snapshot) return false;
  const testExists = (state.db.nationalTests || []).some(test => test.id === snapshot.testId);
  if (!testExists) {
    state.testWordReturn = null;
    return false;
  }

  state.testWordReturn = null;
  state.activeSection = "tests";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "tests");
  state.activeLibraryTab = "tests";
  state.activeNationalTestId = snapshot.testId;
  state.activeNationalTestPageId = snapshot.pageId;
  state.activeNationalTestSectionFilter = stringValueFromClient(snapshot.sectionFilter) || "all";
  state.nationalTestFocusMode = true;
  state.nationalTestFormOpen = false;
  expandNationalTestPageGroupsForPage((state.db.nationalTestPages || []).find(page => page.id === snapshot.pageId));
  render();
  refreshIcons();

  requestAnimationFrame(() => {
    const readerColumn = document.querySelector(".test-page-study-column, .test-page-main-column");
    if (readerColumn) {
      readerColumn.focus?.({ preventScroll: true });
    }
  });
  restoreTestStudyViewport(snapshot);

  return true;
}

function testStudyViewportSnapshot() {
  return {
    windowScrollTop: window.scrollY || document.documentElement.scrollTop || 0,
    workspaceScrollTop: els.testStudyWorkspace?.scrollTop || 0,
    pageListScrollTop: document.querySelector(".test-page-list")?.scrollTop || 0,
    studyColumnScrollTop: document.querySelector(".test-page-study-column")?.scrollTop || 0,
    mainColumnScrollTop: document.querySelector(".test-page-main-column")?.scrollTop || 0,
    readerScrolls: testReaderScrollSnapshot(),
    visualScrolls: testVisualScrollSnapshot()
  };
}

function restoreTestStudyViewport(snapshot = {}, options = {}) {
  const preserveStudyColumn = options.preserveStudyColumn !== false;
  const keepActivePageVisible = options.keepActivePageVisible === true;
  const applyScroll = () => {
    window.scrollTo({ top: snapshot.windowScrollTop || 0, left: 0, behavior: "auto" });
    if (els.testStudyWorkspace) {
      els.testStudyWorkspace.scrollTop = snapshot.workspaceScrollTop || 0;
    }
    const pageList = document.querySelector(".test-page-list");
    if (pageList) {
      pageList.scrollTop = snapshot.pageListScrollTop || 0;
    }
    restoreTestReaderScrolls(snapshot, preserveStudyColumn);
    if (preserveStudyColumn) {
      restoreTestVisualScrolls(snapshot);
    } else {
      resetTestVisualScrolls();
    }
    if (keepActivePageVisible) {
      document.querySelector(".test-page-list .test-page-button.active")?.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    }
  };
  requestAnimationFrame(() => {
    applyScroll();
    requestAnimationFrame(() => {
      applyScroll();
      setTimeout(applyScroll, 120);
    });
  });
}

function rerenderNationalTestsPreservingViewport(options = {}) {
  saveActiveNationalTestAnswerComposerDraft();
  const snapshot = testStudyViewportSnapshot();
  renderNationalTests();
  refreshIcons();
  restoreTestStudyViewport(snapshot, options);
}

function resizeTestPagePracticeFromPointer(grid, clientX) {
  const rect = grid?.getBoundingClientRect();
  if (!rect || rect.width <= 0) return;
  const minPracticePx = Math.max(300, rect.width * TEST_PAGE_PRACTICE_WIDTH_MIN);
  const maxPracticePx = Math.max(minPracticePx, Math.min(rect.width * TEST_PAGE_PRACTICE_WIDTH_MAX, rect.width - 420));
  const widthPx = Math.max(minPracticePx, Math.min(maxPracticePx, rect.right - clientX));
  setTestPagePracticeWidth(widthPx / rect.width);
}

function resizeTestPageListFromPointer(stage, clientX) {
  const rect = stage?.getBoundingClientRect();
  if (!rect || rect.width <= 0) return;
  const minListPx = Math.max(320, rect.width * TEST_PAGE_LIST_WIDTH_MIN);
  const maxListPx = Math.max(minListPx, Math.min(rect.width * TEST_PAGE_LIST_WIDTH_MAX, rect.width - 360));
  const widthPx = Math.max(minListPx, Math.min(maxListPx, clientX - rect.left));
  setTestPageListWidth(widthPx / rect.width);
}

function startTestPageListResize(event) {
  const handle = event.target.closest("[data-resize-test-page-list]");
  if (!handle) return;
  const stage = handle.closest(".test-page-stage");
  if (!stage) return;

  event.preventDefault();
  handle.focus({ preventScroll: true });
  document.body.classList.add("test-page-list-resizing");
  resizeTestPageListFromPointer(stage, event.clientX);

  const onPointerMove = moveEvent => {
    moveEvent.preventDefault();
    resizeTestPageListFromPointer(stage, moveEvent.clientX);
  };
  const onPointerUp = () => {
    document.body.classList.remove("test-page-list-resizing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    schedulePageLayoutStabilization();
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function startTestPagePracticeResize(event) {
  const handle = event.target.closest("[data-resize-test-page-practice]");
  if (!handle) return;
  const grid = handle.closest(".test-page-grid.pdf-collapsed");
  if (!grid) return;

  event.preventDefault();
  handle.focus({ preventScroll: true });
  document.body.classList.add("test-page-practice-resizing");
  resizeTestPagePracticeFromPointer(grid, event.clientX);

  const onPointerMove = moveEvent => {
    moveEvent.preventDefault();
    resizeTestPagePracticeFromPointer(grid, moveEvent.clientX);
  };
  const onPointerUp = () => {
    document.body.classList.remove("test-page-practice-resizing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    schedulePageLayoutStabilization();
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function resizeTestPagePracticeFromKeyboard(event) {
  const handle = event.target.closest("[data-resize-test-page-practice]");
  if (!handle) return;
  const step = event.shiftKey ? 0.05 : 0.025;
  const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
  if (!direction) return;
  event.preventDefault();
  setTestPagePracticeWidth(normalizedTestPagePracticeWidth(state.testPagePracticeWidth) + (direction * step));
  schedulePageLayoutStabilization();
}

function resizeTestPageListFromKeyboard(event) {
  const handle = event.target.closest("[data-resize-test-page-list]");
  if (!handle) return;
  const step = event.shiftKey ? 0.05 : 0.025;
  const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!direction) return;
  event.preventDefault();
  setTestPageListWidth(normalizedTestPageListWidth(state.testPageListWidth) + (direction * step));
  schedulePageLayoutStabilization();
}

function openKnownWordFromTestText(wordId) {
  const word = (state.db.words || []).find(item => item.id === wordId && isVaultRecordLocation(item));
  if (!word) {
    showToast("Word is no longer in the word list", true);
    return;
  }

  updateNationalTestPageDraftFromEditor();
  state.testWordReturn = testWordReturnSnapshot(wordId);
  state.activeSection = "vault";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "vault");
  state.activeLibraryTab = "words";
  state.filters = {
    search: word.word || "",
    from: "",
    to: "",
    sourceId: "",
    branchId: "",
    unitId: "",
    partOfSpeech: "",
    arabic: ""
  };
  state.focusedWordId = word.id;
  render();
  refreshIcons();
  focusWordCard(word.id);
  showToast("Press Esc to return to the test");
}

function openKnownVerbFromTestText(verbId, form = "") {
  const verb = (state.db.verbs || []).find(item => item.id === verbId);
  if (!verb) {
    showToast("Verb is no longer in the verbs list", true);
    return;
  }

  updateNationalTestPageDraftFromEditor();
  state.testWordReturn = testWordReturnSnapshot(verbId);
  state.activeSection = "verbs";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "verbs");
  state.verbFilters.search = stringValueFromClient(form) || verb.base || "";
  state.focusedVerbId = verb.id;
  render();
  refreshIcons();
  focusVerbCard(verb.id);
  showToast("Press Esc to return to the test");
}

function ignoreKnownTokenFromTestText(button) {
  const token = normalizeKnownWordLookupKey(button?.dataset?.openTestKnownToken || button?.textContent || "");
  if (!token) return;
  state.ignoredKnownTokens.add(token);
  saveKnownTokenIgnoreState();
  softenKnownTokenInCurrentTestView(token);
  showToast(`Removed underline for "${token}"`);
}

function softenKnownTokenInCurrentTestView(token) {
  const key = normalizeKnownWordLookupKey(token);
  if (!key || !els.testStudyWorkspace) return;
  const query = stringValueFromClient(state.activeNationalTestPageSearch);
  const matchingButtons = [...els.testStudyWorkspace.querySelectorAll("[data-open-test-known-token]")]
    .filter(button => normalizeKnownWordLookupKey(button.dataset.openTestKnownToken || button.textContent || "") === key);

  matchingButtons.forEach(button => {
    const rawToken = button.dataset.openTestKnownToken || button.textContent || "";
    const template = document.createElement("template");
    template.innerHTML = interactiveTextSegmentHtml(rawToken, query);
    button.replaceWith(template.content);
  });
}

function currentKeyboardWordId(target = document.activeElement) {
  const targetCard = wordCardFromElement(target);
  if (targetCard?.dataset.wordCard) return targetCard.dataset.wordCard;
  const words = getFilteredWords();
  if (words.some(word => word.id === state.focusedWordId)) return state.focusedWordId;
  return words[0]?.id || "";
}

function isTextEntryTarget(target) {
  if (!target) return false;
  return target.matches?.("input:not([type='checkbox']):not([type='radio']), textarea, select, [contenteditable='true']");
}

function moveKeyboardWordFocus(direction) {
  const words = getFilteredWords();
  if (!words.length) return;
  const activeId = currentKeyboardWordId();
  const activeIndex = Math.max(0, words.findIndex(word => word.id === activeId));
  const nextIndex = Math.min(words.length - 1, Math.max(0, activeIndex + direction));
  setFocusedWord(words[nextIndex].id, { focus: true });
}

function handleWordListKeyboard(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return;
  if (state.soundPractice.active) {
    handleSoundPracticeKeyboard(event);
    return;
  }
  if (state.practice.active) {
    handlePracticeKeyboard(event);
    return;
  }
  if (state.review.active) return;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveKeyboardWordFocus(event.key === "ArrowDown" ? 1 : -1);
    return;
  }

  const key = event.key.toLowerCase();
  if (!["p", "r", "s", "v", "escape"].includes(key)) return;

  const wordId = currentKeyboardWordId(event.target);
  if (!wordId && key !== "escape") return;
  event.preventDefault();

  if (wordId) {
    setFocusedWord(wordId);
  }

  if (key === "p") {
    playPronunciation(wordId).catch(error => showToast(error.message, true));
    return;
  }
  if (key === "r") {
    startWordPronunciationRecording(wordId).catch(error => showToast(error.message, true));
    return;
  }
  if (key === "s") {
    stopWordPronunciationRecording(wordId);
    return;
  }
  if (key === "v") {
    playWordPronunciationRecording(wordId);
    return;
  }
  if (key === "escape") {
    const recording = state.pronunciationRecorder.recorder?.state === "recording";
    if (recording) {
      stopWordPronunciationRecording(state.pronunciationRecorder.activeWordId);
    } else {
      state.focusedWordId = "";
      updateFocusedWordCards();
      document.activeElement?.blur?.();
    }
  }
}

function handlePracticeKeyboard(event) {
  if (state.practice.result || state.practice.complete) return;
  if (state.practice.stage === "decide") {
    const key = event.key.toLowerCase();
    if (key === "w" || key === "2") {
      event.preventDefault();
      startPracticeTypingStage();
      return;
    }
    if (key === "c" || key === "1") {
      event.preventDefault();
      startPracticeChoiceStage();
    }
    return;
  }
  if (state.practice.stage !== "choice") return;
  if (!/^[1-4]$/.test(event.key)) return;
  event.preventDefault();
  choosePracticeChoice(Number(event.key) - 1);
}

function handleSoundPracticeKeyboard(event) {
  if ((event.key === "Enter" || event.key === " ") && event.target.closest?.("button")) return;
  const word = currentSoundPracticeWord();
  const key = event.key.toLowerCase();

  if (event.key === "ArrowRight" || event.key === "Enter") {
    event.preventDefault();
    nextSoundPracticeWord();
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    previousSoundPracticeWord();
    return;
  }

  if (!["p", "r", "s", "v", "escape"].includes(key)) return;
  event.preventDefault();

  if (key === "escape") {
    const recording = state.pronunciationRecorder.recorder?.state === "recording";
    if (recording) {
      stopWordPronunciationRecording(state.pronunciationRecorder.activeWordId);
    } else {
      endSoundPracticeSession();
    }
    return;
  }

  if (!word) return;
  if (key === "p") {
    playPronunciation(word.id).catch(error => showToast(error.message, true));
    return;
  }
  if (key === "r") {
    startWordPronunciationRecording(word.id).catch(error => showToast(error.message, true));
    return;
  }
  if (key === "s") {
    stopWordPronunciationRecording(word.id);
    return;
  }
  if (key === "v") {
    playWordPronunciationRecording(word.id);
  }
}

function setSourcePanelCollapsed(collapsed) {
  state.sourceCollapsed = collapsed;
  els.workspace.classList.toggle("source-collapsed", collapsed);
  els.sourceToggleButton.setAttribute("aria-expanded", String(!collapsed));
  els.sourceToggleButton.setAttribute("title", collapsed ? "Show sources" : "Hide sources");
  els.sourceToggleButton.setAttribute("aria-label", collapsed ? "Show sources" : "Hide sources");
  els.sourceToggleButton.innerHTML = icon(collapsed ? "chevron-right" : "chevron-left");
  localStorage.setItem("sourcePanelCollapsed", collapsed ? "true" : "false");
  refreshIcons();
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.style.background = isError ? "#8a1f17" : "#28231d";
  els.toast.classList.add("visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(payload.error || payload || "Request failed");
  }
  return payload;
}

function normalizeDatabaseShape(db = {}) {
  return {
    sources: Array.isArray(db.sources) ? db.sources : [],
    words: Array.isArray(db.words) ? db.words : [],
    verbs: Array.isArray(db.verbs) ? db.verbs : [],
    studyTexts: Array.isArray(db.studyTexts) ? db.studyTexts : [],
    studyVideos: Array.isArray(db.studyVideos) ? db.studyVideos : [],
    nationalTests: Array.isArray(db.nationalTests) ? db.nationalTests : [],
    nationalTestPages: Array.isArray(db.nationalTestPages) ? db.nationalTestPages : []
  };
}

function hasDatabaseRecords(db = {}) {
  return [
    db.sources,
    db.words,
    db.verbs,
    db.studyTexts,
    db.studyVideos,
    db.nationalTests,
    db.nationalTestPages
  ].some(items => Array.isArray(items) && items.length);
}

function saveDatabaseCache(db = state.db) {
  try {
    const cacheDb = normalizeDatabaseShape(db);
    cacheDb.nationalTestPages = [];
    localStorage.setItem(DATABASE_CACHE_STORAGE_KEY, JSON.stringify({
      version: DATABASE_CACHE_SCHEMA_VERSION,
      savedAt: Date.now(),
      db: cacheDb
    }));
  } catch {
    // Cache is best effort; localStorage may be unavailable or full.
  }
}

function restoreCachedDatabase() {
  try {
    const cached = JSON.parse(localStorage.getItem(DATABASE_CACHE_STORAGE_KEY) || "null");
    if (cached?.version !== DATABASE_CACHE_SCHEMA_VERSION) {
      localStorage.removeItem(DATABASE_CACHE_STORAGE_KEY);
      return false;
    }
    if (!cached?.db || !hasDatabaseRecords(cached.db)) return false;
    state.db = normalizeDatabaseShape(cached.db);
    state.nationalTestPagesLoaded = Boolean(state.db.nationalTestPages.length);
    render();
    return true;
  } catch {
    return false;
  }
}

async function loadDatabase(options = {}) {
  const includeNationalTestPages = options.includeNationalTestPages ?? (state.activeSection === "tests");
  const nextDb = normalizeDatabaseShape(await api(`/api/database?includeNationalTestPages=${includeNationalTestPages ? "true" : "false"}`));
  if (!includeNationalTestPages && state.nationalTestPagesLoaded) {
    nextDb.nationalTestPages = state.db.nationalTestPages || [];
  }
  state.db = nextDb;
  state.nationalTestPagesLoaded = includeNationalTestPages ? true : Boolean(state.db.nationalTestPages.length);
  saveDatabaseCache();
  render();
  if (state.activeSection === "tests" && !state.nationalTestPagesLoaded) {
    ensureNationalTestPagesLoaded().catch(error => showToast(error.message, true));
  }
}

async function ensureNationalTestPagesLoaded() {
  if (state.nationalTestPagesLoaded) return state.db.nationalTestPages || [];
  if (state.nationalTestPagesLoading) return state.nationalTestPagesLoading;
  state.nationalTestPagesLoading = api("/api/national-test-pages")
    .then(result => {
      state.db.nationalTestPages = Array.isArray(result.nationalTestPages) ? result.nationalTestPages : [];
      state.nationalTestPagesLoaded = true;
      saveDatabaseCache();
      if (state.activeSection === "tests") {
        renderNationalTests();
        refreshIcons();
      }
      return state.db.nationalTestPages;
    })
    .finally(() => {
      state.nationalTestPagesLoading = null;
    });
  return state.nationalTestPagesLoading;
}

async function ensureListeningMediaFilesLoaded(options = {}) {
  if (state.listeningMediaFiles.loaded && !options.force) return state.listeningMediaFiles;
  if (state.listeningMediaFiles.loading && !options.force) return state.listeningMediaFiles.loading;
  state.listeningMediaFiles.loading = api("/api/listening-media-files")
    .then(result => {
      state.listeningMediaFiles = {
        loaded: true,
        loading: null,
        audio: Array.isArray(result.audio) ? result.audio : [],
        transcripts: Array.isArray(result.transcripts) ? result.transcripts : []
      };
      return state.listeningMediaFiles;
    })
    .catch(error => {
      state.listeningMediaFiles.loading = null;
      throw error;
    });
  return state.listeningMediaFiles.loading;
}

function normalizedActiveSection(section) {
  return ["tests", "verbs"].includes(section) ? section : "vault";
}

function setActiveSection(section) {
  state.activeSection = normalizedActiveSection(section);
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, state.activeSection);

  if (state.activeSection === "tests") {
    clearSourceWritingPractice({ renderAfter: false });
    state.activeTab = "test";
    state.activeLibraryTab = "tests";
  } else if (state.activeSection === "verbs") {
    clearSourceWritingPractice({ renderAfter: false });
    if (state.activeTab === "test" || state.activeTab === "json") state.activeTab = "single";
  } else {
    if (state.activeTab === "test" || state.activeTab === "json") state.activeTab = "single";
    if (state.activeLibraryTab === "tests") state.activeLibraryTab = "words";
  }

  render();
  if (state.activeSection === "tests") {
    ensureNationalTestPagesLoaded().catch(error => showToast(error.message, true));
  }
}

function normalizeNationalTestFocusMode() {
  if (state.activeSection !== "tests" || !state.nationalTestFocusMode) return;
  if (activeNationalTest()) return;
  state.nationalTestFocusMode = false;
  state.activeNationalTestId = "";
  state.activeNationalTestPageId = "";
  state.activeNationalTestListeningTopicKey = "";
  state.activeNationalTestTranscriptViewer = null;
  state.activeNationalTestSectionFilter = "all";
  state.activeNationalTestPageSearch = "";
}

function isNationalTestFocusMode() {
  return state.activeSection === "tests" && state.nationalTestFocusMode && Boolean(activeNationalTest());
}

function renderActiveSection() {
  const testsActive = state.activeSection === "tests";
  const verbsActive = state.activeSection === "verbs";
  const vaultActive = !testsActive && !verbsActive;
  const testFocusActive = testsActive && isNationalTestFocusMode();
  els.appShell.classList.toggle("tests-section", testsActive);
  els.appShell.classList.toggle("verbs-section", verbsActive);
  els.appShell.classList.toggle("vault-section", vaultActive);
  els.appShell.classList.toggle("test-focus-mode", testFocusActive);
  els.appShell.classList.toggle("test-form-open", testsActive && state.nationalTestFormOpen && !testFocusActive);
  els.vaultSectionButton.classList.toggle("active", vaultActive);
  els.verbsSectionButton.classList.toggle("active", verbsActive);
  els.testsSectionButton.classList.toggle("active", testsActive);
  els.vaultSectionButton.setAttribute("aria-current", vaultActive ? "page" : "false");
  els.verbsSectionButton.setAttribute("aria-current", verbsActive ? "page" : "false");
  els.testsSectionButton.setAttribute("aria-current", testsActive ? "page" : "false");
}

function render() {
  normalizeNationalTestFocusMode();
  renderActiveSection();
  updateTabs();
  renderLibraryTabs();
  syncHeaderSearchControl();
  updateLibraryCounts();

  if (state.activeSection === "tests") {
    renderNationalTests();
    renderTestLookupResults();
    refreshIcons();
    return;
  }

  if (state.activeSection === "verbs") {
    renderVerbs();
    refreshIcons();
    return;
  }

  renderSources();
  renderSelectors();

  if (state.activeLibraryTab === "texts") {
    renderStudyFilters();
    renderStudyTexts();
  } else if (state.activeLibraryTab === "videos") {
    renderVideoFilters();
    renderStudyVideos();
  } else {
    renderFilters();
    renderWords();
  }

  refreshIcons();
}

function findSource(id) {
  return state.db.sources.find(source => source.id === id);
}

function isNationalTestSource(source) {
  return stringValueFromClient(source?.name).toLowerCase() === NATIONAL_TEST_SOURCE_NAME.toLowerCase();
}

function vaultSources() {
  return (state.db.sources || []).filter(source => !isNationalTestSource(source));
}

function findVaultSource(id) {
  return vaultSources().find(source => source.id === id);
}

function isNationalTestLocation(location) {
  return isNationalTestSource(findSource(location?.sourceId));
}

function isVaultRecordLocation(record) {
  const locations = typeof wordLocations === "function" && record?.word ? wordLocations(record) : [record];
  return !locations.length || locations.some(location => !isNationalTestLocation(location));
}

function findBranch(sourceId, branchId) {
  return findSource(sourceId)?.branches.find(branch => branch.id === branchId);
}

function findUnit(sourceId, branchId, unitId) {
  return findBranch(sourceId, branchId)?.units.find(unit => unit.id === unitId);
}

function getPathLabel(record) {
  return locationLabel(record);
}

function locationLabel(location) {
  const source = findSource(location.sourceId);
  const branch = findBranch(location.sourceId, location.branchId);
  const unit = findUnit(location.sourceId, location.branchId, location.unitId);
  return [source?.name, branch?.name, unit?.name].filter(Boolean).join(" / ") || "No source";
}

function wordLocations(word) {
  const locations = Array.isArray(word.locations) ? word.locations : [];
  const normalized = locations
    .map(location => ({
      sourceId: stringValueFromClient(location.sourceId),
      branchId: stringValueFromClient(location.branchId),
      unitId: stringValueFromClient(location.unitId)
    }))
    .filter(location => location.sourceId);

  if (normalized.length) return normalized;
  return word.sourceId ? [{
    sourceId: word.sourceId,
    branchId: word.branchId || "",
    unitId: word.unitId || ""
  }] : [];
}

function wordPrimaryLocation(word) {
  return wordLocations(word)[0] || { sourceId: "", branchId: "", unitId: "" };
}

function getWordLocationLabels(word) {
  const labels = wordLocations(word).map(locationLabel);
  return labels.length ? [...new Set(labels)] : ["No source"];
}

function getWordPathSummary(word) {
  const labels = getWordLocationLabels(word);
  return labels.length <= 2 ? labels.join(" | ") : `${labels[0]} + ${labels.length - 1} more`;
}

function wordMatchesLocationFilter(word, filters) {
  if (!filters.sourceId && !filters.branchId && !filters.unitId) return true;
  return wordLocations(word).some(location =>
    (!filters.sourceId || location.sourceId === filters.sourceId) &&
    (!filters.branchId || location.branchId === filters.branchId) &&
    (!filters.unitId || location.unitId === filters.unitId)
  );
}

function locationFromTreeValue(value) {
  const [sourceId = "", branchId = "", unitId = ""] = String(value || "").split(":");
  return { sourceId, branchId, unitId };
}

function selectedClass(sourceId, branchId = "", unitId = "") {
  return state.selected.sourceId === sourceId &&
    state.selected.branchId === branchId &&
    state.selected.unitId === unitId
    ? " selected"
    : "";
}

function sourceTreeCollapseKey(kind, ...ids) {
  return [kind, ...ids].filter(Boolean).join(":");
}

function isSourceTreeNodeCollapsed(key) {
  return state.sourceTreeCollapsed.has(key);
}

function treeCollapseButtonHtml(key, collapsed, label, hasChildren) {
  if (!hasChildren) return `<span class="tree-collapse-placeholder" aria-hidden="true"></span>`;
  const action = collapsed ? "Expand" : "Collapse";
  const title = `${action} ${label}`;
  return `
    <button class="tree-collapse-button" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" aria-expanded="${String(!collapsed)}" data-toggle-tree-node="${escapeHtml(key)}">
      ${icon(collapsed ? "chevron-right" : "chevron-down")}
    </button>
  `;
}

function toggleSourceTreeNode(key) {
  if (state.sourceTreeCollapsed.has(key)) {
    state.sourceTreeCollapsed.delete(key);
  } else {
    state.sourceTreeCollapsed.add(key);
  }
  saveSourceTreeCollapseState();
  renderSources();
  refreshIcons();
}

function saveSourceTreeCollapseState() {
  localStorage.setItem(SOURCE_TREE_COLLAPSE_STORAGE_KEY, JSON.stringify([...state.sourceTreeCollapsed]));
}

function loadSourceTreeCollapseState() {
  try {
    const keys = JSON.parse(localStorage.getItem(SOURCE_TREE_COLLAPSE_STORAGE_KEY) || "[]");
    state.sourceTreeCollapsed = new Set(Array.isArray(keys) ? keys.filter(key => typeof key === "string") : []);
  } catch {
    state.sourceTreeCollapsed = new Set();
  }
}

function nationalTestPageGroupCollapseKey(kind, testId, sectionKey, topicKey = "") {
  return ["national-test", testId, kind, sectionKey, topicKey].filter(Boolean).join(":");
}

function isNationalTestPageGroupCollapsed(key) {
  return state.nationalTestPageGroupsCollapsed.has(key);
}

function toggleNationalTestPageGroup(key) {
  if (state.nationalTestPageGroupsCollapsed.has(key)) {
    state.nationalTestPageGroupsCollapsed.delete(key);
  } else {
    state.nationalTestPageGroupsCollapsed.add(key);
  }
  saveNationalTestPageGroupCollapseState();
  rerenderNationalTestsPreservingViewport();
}

function nationalTestPageGroupCollapseKeysForGroups(test, groups) {
  if (!test || !Array.isArray(groups)) return [];
  const keys = [];
  groups.forEach(group => {
    if (!group?.section?.key) return;
    keys.push(nationalTestPageGroupCollapseKey("skill", test.id, group.section.key));
    group.topics.forEach(topic => {
      keys.push(nationalTestPageGroupCollapseKey("topic", test.id, group.section.key, topic.key));
    });
  });
  return keys;
}

function areNationalTestPageGroupsCollapsed(keys) {
  return keys.length > 0 && keys.every(key => state.nationalTestPageGroupsCollapsed.has(key));
}

function setNationalTestPageGroupsCollapsed(keys, collapsed) {
  if (!Array.isArray(keys) || !keys.length) return;
  keys.forEach(key => {
    if (collapsed) {
      state.nationalTestPageGroupsCollapsed.add(key);
    } else {
      state.nationalTestPageGroupsCollapsed.delete(key);
    }
  });
  saveNationalTestPageGroupCollapseState();
  rerenderNationalTestsPreservingViewport();
}

function expandNationalTestPageGroupsForPage(page) {
  if (!page?.testId) return;
  const sectionKey = effectiveNationalTestPageSection(page) || "unclassified";
  const topicLabel = normalizedNationalTestPageTopic(page.topic) || UNGROUPED_NATIONAL_TEST_TOPIC;
  const topicKey = normalizePracticeAnswer(topicLabel) || `ungrouped-${sectionKey}`;
  const skillKey = nationalTestPageGroupCollapseKey("skill", page.testId, sectionKey);
  const pageTopicKey = nationalTestPageGroupCollapseKey("topic", page.testId, sectionKey, topicKey);
  const skillChanged = state.nationalTestPageGroupsCollapsed.delete(skillKey);
  const topicChanged = state.nationalTestPageGroupsCollapsed.delete(pageTopicKey);
  const changed = skillChanged || topicChanged;
  if (changed) {
    saveNationalTestPageGroupCollapseState();
  }
}

function saveNationalTestPageGroupCollapseState() {
  localStorage.setItem(
    NATIONAL_TEST_PAGE_GROUP_COLLAPSE_STORAGE_KEY,
    JSON.stringify([...state.nationalTestPageGroupsCollapsed])
  );
}

function loadNationalTestPageGroupCollapseState() {
  try {
    const keys = JSON.parse(localStorage.getItem(NATIONAL_TEST_PAGE_GROUP_COLLAPSE_STORAGE_KEY) || "[]");
    state.nationalTestPageGroupsCollapsed = new Set(Array.isArray(keys) ? keys.filter(key => typeof key === "string") : []);
  } catch {
    state.nationalTestPageGroupsCollapsed = new Set();
  }
}

function loadNationalTestProgressState() {
  try {
    const value = JSON.parse(localStorage.getItem(NATIONAL_TEST_PROGRESS_STORAGE_KEY) || "{}");
    state.nationalTestProgress = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    state.nationalTestProgress = {};
  }
}

function saveNationalTestProgressState() {
  localStorage.setItem(NATIONAL_TEST_PROGRESS_STORAGE_KEY, JSON.stringify(state.nationalTestProgress || {}));
}

function nationalTestProgressEntry(testId) {
  return state.nationalTestProgress?.[testId] || {};
}

function lastWorkedNationalTestPageId(testId) {
  return stringValueFromClient(nationalTestProgressEntry(testId).pageId);
}

function validLastWorkedNationalTestPageId(testId) {
  const pageId = lastWorkedNationalTestPageId(testId);
  if (!pageId) return "";
  return (state.db.nationalTestPages || []).some(page => page.testId === testId && page.id === pageId) ? pageId : "";
}

function rememberNationalTestPageProgress(page) {
  if (!page?.testId || !page?.id) return;
  state.nationalTestProgress = state.nationalTestProgress && typeof state.nationalTestProgress === "object"
    ? state.nationalTestProgress
    : {};
  const previous = state.nationalTestProgress[page.testId] || {};
  if (previous.pageId === page.id) return;
  state.nationalTestProgress[page.testId] = {
    ...previous,
    pageId: page.id,
    updatedAt: new Date().toISOString()
  };
  saveNationalTestProgressState();
}

function isLastWorkedNationalTestPage(testId, pageId) {
  return Boolean(testId && pageId && lastWorkedNationalTestPageId(testId) === pageId);
}

function loadKnownTokenIgnoreState() {
  try {
    const tokens = JSON.parse(localStorage.getItem(TEST_KNOWN_TOKEN_IGNORE_STORAGE_KEY) || "[]");
    state.ignoredKnownTokens = new Set(
      (Array.isArray(tokens) ? tokens : [])
        .map(normalizeKnownWordLookupKey)
        .filter(Boolean)
    );
  } catch {
    state.ignoredKnownTokens = new Set();
  }
}

function saveKnownTokenIgnoreState() {
  localStorage.setItem(
    TEST_KNOWN_TOKEN_IGNORE_STORAGE_KEY,
    JSON.stringify([...state.ignoredKnownTokens].sort())
  );
}

function setTestPageGroupingToolCollapsed(collapsed) {
  state.testPageGroupingToolCollapsed = Boolean(collapsed);
  localStorage.setItem(TEST_PAGE_GROUPING_TOOL_COLLAPSE_STORAGE_KEY, state.testPageGroupingToolCollapsed ? "true" : "false");
}

function setTestPageGroupingToolHidden(hidden) {
  state.testPageGroupingToolHidden = Boolean(hidden);
  localStorage.setItem(TEST_PAGE_GROUPING_TOOL_HIDDEN_STORAGE_KEY, state.testPageGroupingToolHidden ? "true" : "false");
}

function setTestPagePdfCollapsed(collapsed) {
  state.testPagePdfCollapsed = Boolean(collapsed);
  localStorage.setItem(TEST_PAGE_PDF_COLLAPSE_STORAGE_KEY, state.testPagePdfCollapsed ? "true" : "false");
}

function setTestPageWordPracticeHidden(hidden) {
  state.testPageWordPracticeHidden = Boolean(hidden);
  localStorage.setItem(TEST_PAGE_WORD_PRACTICE_HIDDEN_STORAGE_KEY, state.testPageWordPracticeHidden ? "true" : "false");
}

function renderSources() {
  const sources = vaultSources();
  if (!sources.length) {
    els.sourceTree.innerHTML = [
      emptyStateHtml("No sources"),
      renderSourceWritingPracticePanel()
    ].join("");
    return;
  }

  els.sourceTree.innerHTML = [
    sources.map(sourceTreeNodeHtml).join(""),
    renderSourceWritingPracticePanel()
  ].join("");
}

function sourceTreeNodeHtml(source) {
  const key = sourceTreeCollapseKey("source", source.id);
  const collapsed = isSourceTreeNodeCollapsed(key);
  const textList = treeStudyTextList(source.id);
  const videoList = treeStudyVideoList(source.id);
  const branchList = source.branches.map(branch => branchTreeNodeHtml(source, branch)).join("");
  const hasChildren = Boolean(textList || videoList || branchList);

  return `
    <div class="tree-node${collapsed ? " collapsed" : ""}">
      <div class="tree-row${selectedClass(source.id)}" data-select-source="${source.id}">
        <div class="tree-title">
          ${treeCollapseButtonHtml(key, collapsed, `source ${source.name}`, hasChildren)}
          ${icon("book-open", "tree-icon")}
          <span>${escapeHtml(source.name)}</span>
        </div>
        <div class="tree-actions">
          <button class="icon-button" type="button" title="New study text" aria-label="New study text" data-new-study-text="${source.id}::">${icon("file-plus-2")}</button>
          <button class="icon-button" type="button" title="New video" aria-label="New video" data-new-study-video="${source.id}::">${icon("video")}</button>
          <button class="icon-button" type="button" title="Add unit" aria-label="Add unit" data-add-branch="${source.id}">${icon("git-branch-plus")}</button>
          <button class="icon-button" type="button" title="Rename source" aria-label="Rename source" data-rename-source="${source.id}">${icon("pencil")}</button>
          <button class="icon-button danger-button" type="button" title="Delete source" aria-label="Delete source" data-delete-source="${source.id}">${icon("trash-2")}</button>
        </div>
      </div>
      ${collapsed ? "" : `
        ${textList}
        ${videoList}
        <div class="branch-list">${branchList}</div>
      `}
    </div>
  `;
}

function branchTreeNodeHtml(source, branch) {
  const key = sourceTreeCollapseKey("unit", source.id, branch.id);
  const collapsed = isSourceTreeNodeCollapsed(key);
  const textList = treeStudyTextList(source.id, branch.id);
  const videoList = treeStudyVideoList(source.id, branch.id);
  const unitList = branch.units.map(unit => unitTreeNodeHtml(source, branch, unit)).join("");
  const hasChildren = Boolean(textList || videoList || unitList);

  return `
    <div class="tree-node${collapsed ? " collapsed" : ""}">
      <div class="tree-row${selectedClass(source.id, branch.id)}" data-select-branch="${source.id}:${branch.id}">
        <div class="tree-title">
          ${treeCollapseButtonHtml(key, collapsed, `unit ${branch.name}`, hasChildren)}
          ${icon("folder", "tree-icon")}
          <span>${escapeHtml(branch.name)}</span>
        </div>
        <div class="tree-actions">
          <button class="icon-button" type="button" title="New study text" aria-label="New study text" data-new-study-text="${source.id}:${branch.id}:">${icon("file-plus-2")}</button>
          <button class="icon-button" type="button" title="New video" aria-label="New video" data-new-study-video="${source.id}:${branch.id}:">${icon("video")}</button>
          <button class="icon-button" type="button" title="Add topic" aria-label="Add topic" data-add-unit="${source.id}:${branch.id}">${icon("list-plus")}</button>
          <button class="icon-button" type="button" title="Move unit to source" aria-label="Move unit to source" data-move-branch="${source.id}:${branch.id}">${icon("move-right")}</button>
          <button class="icon-button" type="button" title="Rename unit" aria-label="Rename unit" data-rename-branch="${source.id}:${branch.id}">${icon("pencil")}</button>
          <button class="icon-button danger-button" type="button" title="Delete unit" aria-label="Delete unit" data-delete-branch="${source.id}:${branch.id}">${icon("trash-2")}</button>
        </div>
      </div>
      ${collapsed ? "" : `
        ${textList}
        ${videoList}
        <div class="unit-list">${unitList}</div>
      `}
    </div>
  `;
}

function unitTreeNodeHtml(source, branch, unit) {
  const key = sourceTreeCollapseKey("topic", source.id, branch.id, unit.id);
  const collapsed = isSourceTreeNodeCollapsed(key);
  const textList = treeStudyTextList(source.id, branch.id, unit.id);
  const videoList = treeStudyVideoList(source.id, branch.id, unit.id);
  const hasChildren = Boolean(textList || videoList);

  return `
    <div class="tree-node${collapsed ? " collapsed" : ""}">
      <div class="tree-row${selectedClass(source.id, branch.id, unit.id)}" data-select-unit="${source.id}:${branch.id}:${unit.id}">
        <div class="tree-title">
          ${treeCollapseButtonHtml(key, collapsed, `topic ${unit.name}`, hasChildren)}
          ${icon("layers", "tree-icon")}
          <span>${escapeHtml(unit.name)}</span>
        </div>
        <div class="tree-actions">
          <button class="icon-button" type="button" title="New study text" aria-label="New study text" data-new-study-text="${source.id}:${branch.id}:${unit.id}">${icon("file-plus-2")}</button>
          <button class="icon-button" type="button" title="New video" aria-label="New video" data-new-study-video="${source.id}:${branch.id}:${unit.id}">${icon("video")}</button>
          <button class="icon-button" type="button" title="Rename topic" aria-label="Rename topic" data-rename-unit="${source.id}:${branch.id}:${unit.id}">${icon("pencil")}</button>
          <button class="icon-button danger-button" type="button" title="Delete topic" aria-label="Delete topic" data-delete-unit="${source.id}:${branch.id}:${unit.id}">${icon("trash-2")}</button>
        </div>
      </div>
      ${collapsed ? "" : `${textList}${videoList}`}
    </div>
  `;
}

function treeStudyTextList(sourceId, branchId = "", unitId = "") {
  const texts = studyTextsForLocation(sourceId, branchId, unitId);
  if (!texts.length) return "";
  return `
    <div class="tree-text-list">
      ${texts.map(text => `
        <button class="tree-text-row ${state.activeStudyTextId === text.id ? "selected" : ""}" type="button" title="${escapeHtml(text.title)}" data-open-study-text="${text.id}">
          ${icon("file-text", "tree-icon")}
          <span>${escapeHtml(text.title)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function treeStudyVideoList(sourceId, branchId = "", unitId = "") {
  const videos = studyVideosForLocation(sourceId, branchId, unitId);
  if (!videos.length) return "";
  return `
    <div class="tree-text-list">
      ${videos.map(video => `
        <button class="tree-text-row ${state.activeStudyVideoId === video.id ? "selected" : ""}" type="button" title="${escapeHtml(video.title)}" data-open-study-video="${video.id}">
          ${icon("video", "tree-icon")}
          <span>${escapeHtml(video.title)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function studyTextsForLocation(sourceId, branchId = "", unitId = "") {
  return (state.db.studyTexts || [])
    .filter(text => text.sourceId === sourceId && text.branchId === branchId && text.unitId === unitId)
    .sort((a, b) => normalizePracticeAnswer(a.title).localeCompare(normalizePracticeAnswer(b.title)));
}

function studyVideosForLocation(sourceId, branchId = "", unitId = "") {
  return (state.db.studyVideos || [])
    .filter(video => video.sourceId === sourceId && video.branchId === branchId && video.unitId === unitId)
    .sort((a, b) => normalizePracticeAnswer(a.title).localeCompare(normalizePracticeAnswer(b.title)));
}

function optionsHtml(items, selectedId, emptyLabel = "None") {
  const empty = `<option value="">${emptyLabel}</option>`;
  return empty + items.map(item => `
    <option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>
  `).join("");
}

function hasSelectedWordPath() {
  return Boolean(findSource(state.selected.sourceId));
}

function selectedPathLabel() {
  return hasSelectedWordPath() ? locationLabel(state.selected) : "Choose a source, unit, or topic from Sources";
}

function renderWordPathBadge() {
  const ready = hasSelectedWordPath();
  els.wordEntryFields.disabled = !ready;
  els.wordPathBadge.classList.toggle("locked", !ready);
  els.wordPathBadge.classList.toggle("ready", ready);
  els.wordPathBadgeText.textContent = ready ? selectedPathLabel() : "Choose a source, unit, or topic from Sources";
}

function renderSelectors() {
  const selectableSources = vaultSources();
  const sourceOptions = `<option value="">Choose source</option>` + selectableSources.map(source => `
    <option value="${source.id}" ${source.id === state.selected.sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>
  `).join("");

  els.wordSource.innerHTML = sourceOptions;
  els.jsonSource.innerHTML = sourceOptions;
  els.studySource.innerHTML = sourceOptions;
  els.videoSource.innerHTML = sourceOptions;

  const source = selectableSources.find(item => item.id === state.selected.sourceId);
  if (!source && state.selected.sourceId) {
    state.selected = { sourceId: "", branchId: "", unitId: "" };
  }

  const activeSource = source || null;
  const branches = activeSource?.branches || [];
  if (state.selected.branchId && !branches.some(item => item.id === state.selected.branchId)) {
    state.selected.branchId = "";
    state.selected.unitId = "";
  }

  const branch = state.selected.branchId ? branches.find(item => item.id === state.selected.branchId) : null;
  const units = branch?.units || [];
  if (!units.some(item => item.id === state.selected.unitId)) {
    state.selected.unitId = "";
  }

  els.wordSource.value = state.selected.sourceId;
  els.jsonSource.value = state.selected.sourceId;
  els.studySource.value = state.selected.sourceId;
  els.videoSource.value = state.selected.sourceId;
  els.wordBranch.innerHTML = optionsHtml(branches, state.selected.branchId);
  els.jsonBranch.innerHTML = optionsHtml(branches, state.selected.branchId);
  els.studyBranch.innerHTML = optionsHtml(branches, state.selected.branchId);
  els.videoBranch.innerHTML = optionsHtml(branches, state.selected.branchId);
  els.wordUnit.innerHTML = optionsHtml(units, state.selected.unitId);
  els.jsonUnit.innerHTML = optionsHtml(units, state.selected.unitId);
  els.studyUnit.innerHTML = optionsHtml(units, state.selected.unitId);
  els.videoUnit.innerHTML = optionsHtml(units, state.selected.unitId);
  renderWordPathBadge();
}

function renderFilters() {
  els.filterSource.innerHTML = `<option value="">All sources</option>` + vaultSources().map(source => `
    <option value="${source.id}" ${source.id === state.filters.sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>
  `).join("");

  const source = findVaultSource(state.filters.sourceId);
  if (!source && state.filters.sourceId) {
    state.filters.sourceId = "";
    state.filters.branchId = "";
    state.filters.unitId = "";
  }
  const branches = source?.branches || [];
  els.filterBranch.innerHTML = optionsHtml(branches, state.filters.branchId, "All units");

  const branch = source?.branches.find(item => item.id === state.filters.branchId);
  const units = branch?.units || [];
  els.filterUnit.innerHTML = optionsHtml(units, state.filters.unitId, "All topics");
  els.filterPos.innerHTML = `<option value="">All parts</option>` + availablePartsOfSpeech().map(part => `
    <option value="${escapeHtml(part)}" ${part === state.filters.partOfSpeech ? "selected" : ""}>${escapeHtml(part)}</option>
  `).join("");
  els.filterArabic.value = state.filters.arabic || "";
}

function renderStudyFilters() {
  els.studyFilterSource.innerHTML = `<option value="">All sources</option>` + vaultSources().map(source => `
    <option value="${source.id}" ${source.id === state.studyFilters.sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>
  `).join("");

  const source = findVaultSource(state.studyFilters.sourceId);
  if (!source && state.studyFilters.sourceId) {
    state.studyFilters.sourceId = "";
    state.studyFilters.branchId = "";
    state.studyFilters.unitId = "";
  }
  const branches = source?.branches || [];
  els.studyFilterBranch.innerHTML = optionsHtml(branches, state.studyFilters.branchId, "All units");

  const branch = source?.branches.find(item => item.id === state.studyFilters.branchId);
  const units = branch?.units || [];
  els.studyFilterUnit.innerHTML = optionsHtml(units, state.studyFilters.unitId, "All topics");
  els.studyFilterType.innerHTML = `<option value="">All types</option>` + STUDY_TEXT_TYPES.map(type => `
    <option value="${type.value}" ${type.value === state.studyFilters.type ? "selected" : ""}>${type.label}</option>
  `).join("");
}

function renderVideoFilters() {
  els.videoFilterSource.innerHTML = `<option value="">All sources</option>` + vaultSources().map(source => `
    <option value="${source.id}" ${source.id === state.videoFilters.sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>
  `).join("");

  const source = findVaultSource(state.videoFilters.sourceId);
  if (!source && state.videoFilters.sourceId) {
    state.videoFilters.sourceId = "";
    state.videoFilters.branchId = "";
    state.videoFilters.unitId = "";
  }
  const branches = source?.branches || [];
  els.videoFilterBranch.innerHTML = optionsHtml(branches, state.videoFilters.branchId, "All units");

  const branch = source?.branches.find(item => item.id === state.videoFilters.branchId);
  const units = branch?.units || [];
  els.videoFilterUnit.innerHTML = optionsHtml(units, state.videoFilters.unitId, "All topics");
  els.videoFilterType.innerHTML = `<option value="">All types</option>` + STUDY_VIDEO_TYPES.map(type => `
    <option value="${type.value}" ${type.value === state.videoFilters.type ? "selected" : ""}>${type.label}</option>
  `).join("");
}

function renderLibraryTabs() {
  if (state.activeSection === "tests") {
    els.wordsLibraryTab.classList.remove("active");
    els.textsLibraryTab.classList.remove("active");
    els.videosLibraryTab.classList.remove("active");
    els.testsLibraryTab.classList.add("active");
    els.verbLibraryView.classList.add("hidden");
    els.wordLibraryView.classList.add("hidden");
    els.studyLibraryView.classList.add("hidden");
    els.videoLibraryView.classList.add("hidden");
    els.testLibraryView.classList.remove("hidden");
    return;
  }

  if (state.activeSection === "verbs") {
    els.wordsLibraryTab.classList.remove("active");
    els.textsLibraryTab.classList.remove("active");
    els.videosLibraryTab.classList.remove("active");
    els.testsLibraryTab.classList.remove("active");
    els.verbLibraryView.classList.remove("hidden");
    els.wordLibraryView.classList.add("hidden");
    els.studyLibraryView.classList.add("hidden");
    els.videoLibraryView.classList.add("hidden");
    els.testLibraryView.classList.add("hidden");
    return;
  }

  if (state.activeLibraryTab === "tests") {
    state.activeLibraryTab = "words";
  }
  const showingTexts = state.activeLibraryTab === "texts";
  const showingVideos = state.activeLibraryTab === "videos";
  els.wordsLibraryTab.classList.toggle("active", !showingTexts && !showingVideos);
  els.textsLibraryTab.classList.toggle("active", showingTexts);
  els.videosLibraryTab.classList.toggle("active", showingVideos);
  els.testsLibraryTab.classList.remove("active");
  els.verbLibraryView.classList.add("hidden");
  els.wordLibraryView.classList.toggle("hidden", showingTexts || showingVideos);
  els.studyLibraryView.classList.toggle("hidden", !showingTexts);
  els.videoLibraryView.classList.toggle("hidden", !showingVideos);
  els.testLibraryView.classList.add("hidden");
}

function renderVerbs() {
  syncHeaderSearchControl();
  if (els.verbFilterSearch.value !== state.verbFilters.search) {
    els.verbFilterSearch.value = state.verbFilters.search;
  }
  const verbs = getFilteredVerbs();
  els.filteredVerbCount.textContent = verbCountText(verbs.length);
  if (!verbs.length) {
    state.focusedVerbId = "";
    els.verbList.innerHTML = emptyStateHtml("No verbs");
    return;
  }

  if (!verbs.some(verb => verb.id === state.focusedVerbId)) {
    state.focusedVerbId = "";
  }
  els.verbList.innerHTML = verbTableHtml(verbs);
  updateFocusedVerbCards();
}

function getFilteredVerbs() {
  const search = state.verbFilters.search.trim().toLowerCase();
  return [...(state.db.verbs || [])]
    .filter(verb => {
      const haystack = [
        verb.base,
        ...(verb.forms || []),
        ...(verb.past || []),
        ...(verb.pastParticiple || []),
        ...(verb.thirdPerson || []),
        ...(verb.presentParticiple || []),
        verb.note
      ].join(" ").toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => normalizePracticeAnswer(a.base).localeCompare(normalizePracticeAnswer(b.base)));
}

function verbTableHtml(verbs) {
  return `
    <div class="verb-table-wrap">
      <table class="verb-table">
        <thead>
          <tr>
            <th scope="col">Verb</th>
            <th scope="col">Past</th>
            <th scope="col">Past participle</th>
            <th scope="col">Other matched forms</th>
            <th scope="col">Saved</th>
            <th scope="col" class="verb-actions-column">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${joinHtml(verbs, verb => verbTableRowHtml(verb))}
        </tbody>
      </table>
    </div>
  `;
}

function verbTableRowHtml(verb) {
  const created = new Date(verb.createdAt || Date.now()).toLocaleDateString();
  const updated = new Date(verb.updatedAt || verb.createdAt || Date.now()).toLocaleDateString();
  const keyboardFocused = state.focusedVerbId === verb.id;
  return `
    <tr class="${classNames(keyboardFocused ? "keyboard-focused" : "")}" tabindex="0" data-verb-card="${escapeHtml(verb.id)}">
      <th scope="row">
        <div class="verb-table-base">
          <strong>${escapeHtml(verb.base)}</strong>
          <span class="pos-chip">Verb</span>
        </div>
        ${verb.note ? `<p class="verb-note">${escapeHtml(verb.note)}</p>` : ""}
      </th>
      <td>${verbFormsCellHtml(verb.past)}</td>
      <td>${verbFormsCellHtml(verb.pastParticiple)}</td>
      <td>${verbFormsCellHtml(extraVerbForms(verb))}</td>
      <td class="verb-date-cell">
        <span>${created}</span>
        ${updated !== created ? `<small>Updated ${updated}</small>` : ""}
      </td>
      <td class="verb-actions-cell">
        <button class="icon-button danger-button" type="button" title="Delete verb" aria-label="Delete verb" data-delete-verb="${escapeHtml(verb.id)}">${icon("trash-2")}</button>
      </td>
    </tr>
  `;
}

function verbFormsCellHtml(forms) {
  const values = normalizeClientStringArray(forms);
  return values.length
    ? `<div class="chip-row">${values.map(form => `<span class="pos-chip">${escapeHtml(form)}</span>`).join("")}</div>`
    : `<span class="muted-text">-</span>`;
}

function extraVerbForms(verb) {
  const primary = new Set([
    normalizeKnownWordToken(verb.base),
    ...normalizeClientStringArray(verb.past).map(normalizeKnownWordToken),
    ...normalizeClientStringArray(verb.pastParticiple).map(normalizeKnownWordToken)
  ]);
  return normalizeClientStringArray(verb.forms)
    .filter(form => !primary.has(normalizeKnownWordToken(form)));
}

function updateFocusedVerbCards() {
  els.verbList.querySelectorAll("[data-verb-card]").forEach(card => {
    card.classList.toggle("keyboard-focused", card.dataset.verbCard === state.focusedVerbId);
  });
}

function focusVerbCard(verbId, options = {}) {
  if (!verbId) return;
  requestAnimationFrame(() => {
    const card = els.verbList.querySelector(`[data-verb-card="${cssEscape(verbId)}"]`);
    if (!card) return;
    card.focus({ preventScroll: options.preventScroll ?? false });
    if (options.scroll !== false) {
      card.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}

function resetRenderLimit(kind) {
  if (!state.renderLimits) {
    state.renderLimits = { words: WORD_RENDER_BATCH_SIZE, studyTexts: STUDY_TEXT_RENDER_BATCH_SIZE, studyVideos: STUDY_VIDEO_RENDER_BATCH_SIZE };
  }
  if (kind === "words") state.renderLimits.words = WORD_RENDER_BATCH_SIZE;
  if (kind === "studyTexts") state.renderLimits.studyTexts = STUDY_TEXT_RENDER_BATCH_SIZE;
  if (kind === "studyVideos") state.renderLimits.studyVideos = STUDY_VIDEO_RENDER_BATCH_SIZE;
}

function increaseRenderLimit(kind) {
  if (!state.renderLimits) {
    state.renderLimits = { words: WORD_RENDER_BATCH_SIZE, studyTexts: STUDY_TEXT_RENDER_BATCH_SIZE, studyVideos: STUDY_VIDEO_RENDER_BATCH_SIZE };
  }
  if (kind === "words") state.renderLimits.words = (state.renderLimits.words || WORD_RENDER_BATCH_SIZE) + WORD_RENDER_BATCH_SIZE;
  if (kind === "studyTexts") state.renderLimits.studyTexts = (state.renderLimits.studyTexts || STUDY_TEXT_RENDER_BATCH_SIZE) + STUDY_TEXT_RENDER_BATCH_SIZE;
  if (kind === "studyVideos") state.renderLimits.studyVideos = (state.renderLimits.studyVideos || STUDY_VIDEO_RENDER_BATCH_SIZE) + STUDY_VIDEO_RENDER_BATCH_SIZE;
}

function renderBatch(items, kind, batchSize, focusId = "") {
  const configuredLimit = state.renderLimits?.[kind] || batchSize;
  const focusIndex = focusId ? items.findIndex(item => item.id === focusId) : -1;
  const limit = Math.max(configuredLimit, focusIndex >= 0 ? focusIndex + 1 : 0);
  const visible = items.slice(0, Math.min(limit, items.length));
  return {
    visible,
    shown: visible.length,
    total: items.length,
    hasMore: visible.length < items.length
  };
}

function loadMoreButtonHtml(kind, shown, total, label) {
  return `
    <div class="list-more-row">
      <button class="ghost-button list-more-button" type="button" data-load-more-list="${escapeHtml(kind)}">
        <span>Show more ${escapeHtml(label)} (${shown} of ${total})</span>
      </button>
    </div>
  `;
}

function renderWords() {
  const words = getFilteredWords();
  pruneSelectedWords();
  updateLibraryCounts();
  syncHeaderSearchControl();
  els.filteredWordCount.textContent = wordCountText(words.length);
  const activeWordSession = state.practice.active ||
    state.review.active ||
    state.soundPractice.active ||
    state.practiceModePicker.active;
  els.startReviewButton.disabled = !(state.db.words || []).some(isVaultRecordLocation) || activeWordSession;
  els.startSoundPracticeButton.disabled = !words.length || state.review.active || state.practice.active || state.practiceModePicker.active;
  els.startSoundPracticeButton.querySelector("span").textContent = state.soundPractice.active ? "Restart sound" : "Sound practice";
  els.reviewPlanSummary.textContent = state.review.active
    ? `${reviewPlanText(state.review)} - review before practice`
    : state.soundPractice.active
      ? `Sound practice - ${state.soundPractice.index + 1} / ${state.soundPractice.words.length}`
    : `${reviewWordCount()} words - due first, then weak. New only when no reviews are due.`;
  els.selectVisibleButton.disabled = !words.length || activeWordSession;
  els.fetchPronunciationsButton.disabled = !words.length || activeWordSession || state.pronunciations.refreshing;
  els.fetchPronunciationsButton.querySelector("span").textContent = state.pronunciations.refreshing ? "Fetching..." : "Fetch audio";
  els.startPracticeButton.disabled = !words.length || state.review.active || state.soundPractice.active;
  els.startPracticeButton.querySelector("span").textContent = practiceButtonLabel();
  renderBulkActions();

  if (state.practiceModePicker.active) {
    els.wordList.classList.add("practice-active");
    renderPracticeModePickerPanel();
    return;
  }

  if (state.soundPractice.active) {
    els.wordList.classList.add("practice-active");
    renderSoundPracticePanel();
    return;
  }

  if (state.practice.active) {
    els.wordList.classList.add("practice-active");
    renderPracticePanel();
    return;
  }

  if (state.review.active) {
    els.wordList.classList.add("practice-active");
    renderReviewPanel();
    return;
  }

  els.wordList.classList.remove("practice-active");

  if (!words.length) {
    state.focusedWordId = "";
    els.wordList.innerHTML = emptyStateHtml("No matching words");
    return;
  }

  if (!words.some(word => word.id === state.focusedWordId)) {
    state.focusedWordId = "";
  }
  const batch = renderBatch(words, "words", WORD_RENDER_BATCH_SIZE, state.focusedWordId);
  els.wordList.innerHTML = [
    joinHtml(batch.visible, word => wordCardHtml(word)),
    batch.hasMore ? loadMoreButtonHtml("words", batch.shown, batch.total, "words") : ""
  ].join("");
  updateFocusedWordCards();
}

function wordCardHtml(word, options = {}) {
  const created = new Date(word.createdAt).toLocaleDateString();
  const updated = new Date(word.updatedAt).toLocaleDateString();
  const hasImage = Boolean(word.image?.url);
  const selected = options.selected ?? state.selectedWordIds.has(word.id);
  const showControls = options.controls !== false;
  const showPronunciation = options.pronunciation !== false;
  const showPronunciationText = options.pronunciationText ?? showPronunciation;
  const hideIpaPronunciationText = Boolean(options.hideIpaPronunciationText);
  const showRecorder = options.recorder === true || (options.recorder !== false && showControls);
  const focusable = options.focusable ?? showControls;
  const keyboardFocused = focusable && state.focusedWordId === word.id;
  const locationTitle = getWordLocationLabels(word).join(" | ");
  const displayWord = options.displayWord || word.word;
  const definition = options.definition ?? word.definition;
  const arabicTranslation = options.arabicTranslation ?? word.arabicTranslation;
  const arabicTranslationVisible = Boolean(arabicTranslation) && state.visibleArabicTranslationWordIds.has(word.id);
  const collocations = options.collocations ?? word.collocations;
  const examples = options.examples ?? word.examples;
  const thesaurus = options.thesaurus === false ? null : options.thesaurus ?? word.thesaurus;
  const synonyms = options.synonyms ?? (word.synonyms?.length ? word.synonyms : thesaurus?.synonyms);
  const searchMatch = options.searchMatch === false
    ? null
    : options.searchMatch ?? (showControls ? wordSearchMatch(word, state.filters.search) : null);
  const className = classNames(
    "word-card",
    hasImage ? "" : "no-image",
    selected ? "selected" : "",
    keyboardFocused ? "keyboard-focused" : "",
    showControls && isSourceWritingPracticeWordAccepted(word) ? "source-practice-accepted" : "",
    options.className || ""
  );
  const keyboardAttributes = focusable
    ? `tabindex="0" data-word-card="${escapeHtml(word.id)}" aria-label="${escapeHtml(`${displayWord}. Use P to play pronunciation, R to record, S to stop, V to hear your voice.`)}"`
    : "";

  return `
    <article class="${className}" ${keyboardAttributes}>
      <div class="word-content">
        <div class="word-header">
          <div class="word-title">
            <div class="title-line">
              <h3>${escapeHtml(displayWord)}</h3>
              ${showPronunciationText ? pronunciationTextHtml(word, { hideIpaByDefault: hideIpaPronunciationText }) : ""}
              ${showPronunciation ? pronunciationButtonHtml(word, { shortcut: showRecorder ? "P" : "" }) : ""}
              ${showRecorder ? pronunciationRecorderControlsHtml(word) : ""}
              ${partOfSpeechChips(word)}
            </div>
            <div class="meta-line">
              <span title="${escapeHtml(locationTitle)}">${escapeHtml(getWordPathSummary(word))}</span>
              <span>Saved ${created}</span>
              ${updated !== created ? `<span>Updated ${updated}</span>` : ""}
            </div>
            ${wordSearchMatchHtml(searchMatch)}
          </div>
          ${showControls ? wordCardControlsHtml(word, selected) : ""}
        </div>
        ${definition ? `<p class="definition">${escapeHtml(definition)}</p>` : ""}
        ${arabicTranslation ? `
          <div class="arabic-translation-panel">
            <button class="ghost-button arabic-translation-toggle" type="button" data-toggle-arabic-translation="${escapeHtml(word.id)}" aria-expanded="${arabicTranslationVisible ? "true" : "false"}">
              ${icon(arabicTranslationVisible ? "eye-off" : "eye")}
              <span>${arabicTranslationVisible ? "Hide Arabic translation" : "Show Arabic translation"}</span>
            </button>
            ${arabicTranslationVisible ? `<p class="arabic-translation" dir="auto">${escapeHtml(arabicTranslation)}</p>` : ""}
          </div>
        ` : ""}
        <div class="word-sections">
          ${miniSection("Collocations", collocations, "chips")}
          ${miniSection("Examples", examples, "examples")}
          ${miniSection("Synonyms", synonyms, "synonyms")}
          ${thesaurusSectionsHtml(thesaurus)}
        </div>
      </div>
      ${hasImage ? `<div class="word-media"><img src="${word.image.url}" alt="${escapeHtml(options.imageAlt ?? word.word)}" loading="lazy" decoding="async" /></div>` : ""}
    </article>
  `;
}

function wordSearchMatchHtml(match) {
  if (!match) return "";
  return `
    <div class="word-search-match">
      ${icon("search")}
      <span>Matched in ${escapeHtml(match.label)}:</span>
      <strong>${escapeHtml(match.excerpt)}</strong>
    </div>
  `;
}

function wordCardControlsHtml(word, selected) {
  return `
    <div class="row-actions">
      <label class="word-select" title="Select word">
        <input type="checkbox" data-select-word="${word.id}" ${selected ? "checked" : ""} />
        <span>Select</span>
      </label>
      ${iconButtonHtml({ iconName: "pencil", title: "Edit word", data: { "edit-word": word.id } })}
      ${iconButtonHtml({ iconName: "trash-2", title: "Delete word", danger: true, data: { "delete-word": word.id } })}
    </div>
  `;
}

function renderStudyTexts() {
  const texts = getFilteredStudyTexts();
  updateLibraryCounts();
  syncHeaderSearchControl();
  els.filteredStudyTextCount.textContent = studyTextCountText(texts.length);

  if (!texts.length) {
    els.studyTextList.innerHTML = emptyStateHtml("No study texts");
    return;
  }

  const batch = renderBatch(texts, "studyTexts", STUDY_TEXT_RENDER_BATCH_SIZE, state.activeStudyTextId);
  els.studyTextList.innerHTML = [
    joinHtml(batch.visible, text => studyTextCardHtml(text)),
    batch.hasMore ? loadMoreButtonHtml("studyTexts", batch.shown, batch.total, "texts") : ""
  ].join("");
}

function studyTextCardHtml(text) {
  const created = new Date(text.createdAt).toLocaleDateString();
  const updated = new Date(text.updatedAt).toLocaleDateString();
  const preview = studyTextPreview(text.content);
  return `
    <article class="${classNames("study-text-card", state.activeStudyTextId === text.id ? "selected" : "")}">
      ${cardHeaderHtml({
        titleHtml: `<button class="study-title-button" type="button" data-read-study-text="${escapeHtml(text.id)}">${escapeHtml(text.title)}</button>`,
        chips: [studyTextTypeLabel(text.type)],
        meta: [getPathLabel(text), `Saved ${created}`, updated !== created ? `Updated ${updated}` : ""],
        actions: [
          iconButtonHtml({ iconName: "pencil", title: "Edit text", data: { "edit-study-text": text.id } }),
          iconButtonHtml({ iconName: "trash-2", title: "Delete text", danger: true, data: { "delete-study-text": text.id } })
        ]
      })}
      <p class="study-text-preview">${preview ? escapeHtml(preview) : "Empty text"}</p>
    </article>
  `;
}

function openStudyTextReader(text) {
  if (!text) return;
  closeStudyTextReader();
  const reader = document.createElement("div");
  reader.className = "reader-overlay";
  reader.dataset.readerOverlay = "study-text";
  reader.innerHTML = studyTextReaderHtml(text);
  document.body.append(reader);
  refreshIcons();
  reader.querySelector("[data-close-reader]")?.focus();
}

function closeStudyTextReader() {
  document.querySelectorAll("[data-reader-overlay]").forEach(reader => reader.remove());
}

function studyTextReaderHtml(text) {
  const updated = new Date(text.updatedAt || text.createdAt).toLocaleDateString();
  return `
    <div class="reader-backdrop" data-close-reader></div>
    <article class="reader-panel" role="dialog" aria-modal="true" aria-labelledby="study-reader-title">
      <header class="reader-header">
        <div>
          <div class="title-line">
            <h2 id="study-reader-title">${escapeHtml(text.title)}</h2>
            <span class="pos-chip">${escapeHtml(studyTextTypeLabel(text.type))}</span>
          </div>
          <div class="meta-line">
            <span>${escapeHtml(getPathLabel(text))}</span>
            <span>Updated ${updated}</span>
          </div>
        </div>
        <div class="row-actions">
          ${iconButtonHtml({ iconName: "pencil", title: "Edit text", data: { "reader-edit-text": text.id } })}
          ${iconButtonHtml({ iconName: "x", title: "Close", data: { "close-reader": "true" } })}
        </div>
      </header>
      <div class="reader-content">${studyTextReaderContentHtml(text)}</div>
    </article>
  `;
}

function studyTextReaderContentHtml(text) {
  if (text.type === "essay" && essayFieldsHaveContent(text.essay)) {
    return essayReaderContentHtml(text.essay);
  }
  const content = stringValueFromClient(text.content);
  return paragraphsHtml(content) || emptyStateHtml("Empty text");
}

function essayReaderContentHtml(fields) {
  const sections = [
    essayReaderSectionHtml("Introduction", essayIntroductionContent(fields)),
    essayReaderSectionHtml("Body", essayBodyContent(fields)),
    essayReaderSectionHtml("Conclusion", fields?.conclusion),
    essayReaderSectionHtml("Sources/Criticism", essaySourcesContent(fields))
  ].filter(Boolean).join("");
  return sections || emptyStateHtml("Empty text");
}

function essayReaderSectionHtml(title, content) {
  const body = paragraphsHtml(content);
  if (!body) return "";
  return `
    <section class="essay-reader-section">
      <h3>${escapeHtml(title)}</h3>
      ${body}
    </section>
  `;
}

function paragraphsHtml(value) {
  return pipe(
    stringValueFromClient(value),
    text => text.split(/\n{2,}/),
    blocks => blocks.map(block => block.trim()).filter(Boolean),
    blocks => joinHtml(blocks, block => `<p>${escapeHtml(block)}</p>`)
  );
}

function renderStudyVideos() {
  const videos = getFilteredStudyVideos();
  updateLibraryCounts();
  syncHeaderSearchControl();
  els.filteredStudyVideoCount.textContent = studyVideoCountText(videos.length);

  if (!videos.length) {
    els.studyVideoList.innerHTML = emptyStateHtml("No videos");
    return;
  }

  const batch = renderBatch(videos, "studyVideos", STUDY_VIDEO_RENDER_BATCH_SIZE, state.activeStudyVideoId);
  els.studyVideoList.innerHTML = [
    joinHtml(batch.visible, video => studyVideoCardHtml(video)),
    batch.hasMore ? loadMoreButtonHtml("studyVideos", batch.shown, batch.total, "videos") : ""
  ].join("");
}

function studyVideoCardHtml(video) {
  const created = new Date(video.createdAt).toLocaleDateString();
  const updated = new Date(video.updatedAt).toLocaleDateString();
  const videoUrl = video.video?.url || "";
  return `
    <article class="${classNames("study-video-card", state.activeStudyVideoId === video.id ? "selected" : "")}">
      <video class="lazy-study-video" data-video-src="${escapeHtml(videoUrl)}" controls preload="none" aria-label="${escapeHtml(video.title || "Study video")}"></video>
      <div class="study-video-content">
        ${cardHeaderHtml({
          titleHtml: `<h3>${escapeHtml(video.title)}</h3>`,
          chips: [studyVideoTypeLabel(video.type)],
          meta: [getPathLabel(video), formatFileSize(video.video?.size || 0), `Saved ${created}`, updated !== created ? `Updated ${updated}` : ""],
          actions: [
            iconButtonHtml({ iconName: "pencil", title: "Edit video", data: { "edit-study-video": video.id } }),
            iconButtonHtml({ iconName: "trash-2", title: "Delete video", danger: true, data: { "delete-study-video": video.id } })
          ]
        })}
      </div>
    </article>
  `;
}

function renderNationalTests() {
  if (state.activeSection === "tests" && !state.nationalTestPagesLoaded) {
    ensureNationalTestPagesLoaded().catch(error => showToast(error.message, true));
  }
  const tests = getFilteredNationalTests();
  const allTests = state.db.nationalTests || [];
  const focusMode = isNationalTestFocusMode();
  syncHeaderSearchControl();
  els.filteredNationalTestCount.textContent = nationalTestCountText(tests.length);
  els.nationalTestToolbar?.classList.toggle("hidden", focusMode);
  els.nationalTestList.classList.toggle("hidden", focusMode);
  els.testStudyWorkspace.classList.toggle("hidden", !focusMode);

  if (!tests.length) {
    if (!allTests.length) {
      state.nationalTestFocusMode = false;
      state.activeNationalTestId = "";
      state.activeNationalTestPageId = "";
      state.activeNationalTestListeningTopicKey = "";
      state.activeNationalTestSectionFilter = "all";
      state.activeNationalTestPageSearch = "";
    }
    els.nationalTestToolbar?.classList.remove("hidden");
    els.nationalTestList.classList.remove("hidden");
    els.testStudyWorkspace.classList.add("hidden");
    els.nationalTestList.innerHTML = emptyStateHtml(allTests.length ? "No matching tests" : "No tests");
    els.testStudyWorkspace.innerHTML = emptyStateHtml("No test selected");
    return;
  }

  if (focusMode) {
    renderNationalTestStudyWorkspace();
    return;
  }

  els.nationalTestList.innerHTML = nationalTestBrowserLayoutHtml(tests);
  els.testStudyWorkspace.innerHTML = emptyStateHtml("Choose a test to study");
}

let pageLayoutStabilizeFrame = 0;

function schedulePageLayoutStabilization() {
  if (pageLayoutStabilizeFrame) {
    cancelAnimationFrame(pageLayoutStabilizeFrame);
  }
  pageLayoutStabilizeFrame = requestAnimationFrame(() => {
    pageLayoutStabilizeFrame = 0;
    stabilizePageLayoutRenders();
  });
}

function stabilizePageLayoutRenders() {
  document.querySelectorAll(".page-layout-page").forEach(page => {
    fitPageLayoutTextElements(page);
    const originalWidth = Number(page.dataset.layoutWidth) || page.clientWidth || 0;
    const originalHeight = Number(page.dataset.layoutHeight) || page.clientHeight || 0;
    const pageRect = page.getBoundingClientRect();
    const scroll = page.closest(".page-layout-scroll");
    const viewport = page.closest(".page-layout-viewport");
    const currentScale = page.offsetWidth ? pageRect.width / page.offsetWidth : 1;
    const measurementScale = Number.isFinite(currentScale) && currentScale > 0 ? currentScale : 1;
    let maxRight = originalWidth;
    let maxBottom = originalHeight;

    page.querySelectorAll(".page-layout-element").forEach(element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      maxRight = Math.max(maxRight, (rect.right - pageRect.left) / measurementScale);
      maxBottom = Math.max(maxBottom, (rect.bottom - pageRect.top) / measurementScale);
    });

    const stabilizedWidth = Math.max(originalWidth, Math.ceil(maxRight + 12));
    const stabilizedHeight = Math.max(originalHeight, Math.ceil(maxBottom + 12));
    const availableWidth = scroll ? Math.max(320, scroll.clientWidth - 44) : stabilizedWidth;
    const isPdfSidePreview = Boolean(scroll?.closest(".test-page-grid:not(.pdf-collapsed)"));
    const isTestPageReader = Boolean(scroll?.closest(".test-page-study-column, .test-page-main-column"));
    const maxScale = isTestPageReader ? 1.36 : 1.18;
    const minScale = isPdfSidePreview ? 0.38 : 0.72;
    const fitWidthScale = stabilizedWidth ? availableWidth / stabilizedWidth : 1;
    const fitScale = Math.max(minScale, Math.min(maxScale, fitWidthScale || 1));
    const visualZoom = page.closest("#test-page-visual-content")
      ? normalizedTestPageVisualZoom(state.testPageVisualZoom)
      : 1;
    const scale = fitScale * visualZoom;

    page.style.width = `${stabilizedWidth}px`;
    page.style.height = `${stabilizedHeight}px`;
    page.style.setProperty("--page-layout-scale", scale.toFixed(3));
    if (viewport) {
      viewport.style.width = `${Math.ceil(stabilizedWidth * scale)}px`;
      viewport.style.height = `${Math.ceil(stabilizedHeight * scale)}px`;
    }
  });
}

function fitPageLayoutTextElements(page) {
  page.querySelectorAll('.page-layout-text[data-layout-fit-mode="shrink"]').forEach(element => {
    const originalFontSize = Number(element.dataset.layoutFontSize) || Number.parseFloat(getComputedStyle(element).fontSize) || 16;
    const minFontSize = Math.max(6, Number(element.dataset.layoutMinFontSize) || 8);
    const targetLineCount = Math.max(0, Number.parseInt(element.dataset.layoutTargetLines || "", 10) || 0);
    element.style.fontSize = `${originalFontSize}px`;
    if (!textElementOverflows(element) && (!targetLineCount || renderedTextLineCount(element) <= targetLineCount)) {
      element.classList.remove("page-layout-text--overflow");
      return;
    }

    let low = minFontSize;
    let high = originalFontSize;
    for (let index = 0; index < 8; index += 1) {
      const mid = (low + high) / 2;
      element.style.fontSize = `${mid}px`;
      const hasTooManyLines = targetLineCount && renderedTextLineCount(element) > targetLineCount;
      if (textElementOverflows(element) || hasTooManyLines) {
        high = mid;
      } else {
        low = mid;
      }
    }
    element.style.fontSize = `${Math.max(minFontSize, Math.floor(low * 10) / 10)}px`;
    element.classList.toggle("page-layout-text--overflow", textElementOverflows(element));
  });
  page.classList.toggle("page-layout-page--has-overflow", Boolean(page.querySelector(".page-layout-text--overflow")));
}

function textElementOverflows(element) {
  return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
}

function renderedTextLineCount(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const lineTops = new Set([...range.getClientRects()]
    .filter(rect => rect.width > 0 && rect.height > 0)
    .map(rect => Math.round(rect.top * 2) / 2));
  return Math.max(1, lineTops.size);
}

function nationalTestCardHtml(test) {
  const created = new Date(test.createdAt).toLocaleDateString();
  const updated = new Date(test.updatedAt || test.createdAt).toLocaleDateString();
  const searchMatches = nationalTestCardSearchMatches(test);
  const listeningMeta = nationalTestListeningMediaMeta(test);
  const locked = isNationalTestLocked(test);
  const ready = isNationalTestReady(test);
  const finished = isNationalTestFinished(test);
  return `
    <article class="${classNames("national-test-card", state.activeNationalTestId === test.id ? "selected" : "", locked ? "locked" : "", ready ? "ready" : "", finished ? "finished" : "")}" data-national-test-card="${escapeHtml(test.id)}">
      ${cardHeaderHtml({
        titleHtml: `${nationalTestCardTitleHtml(test)}${nationalTestCardDetailsHtml(test)}`,
        chips: [],
        meta: [getPathLabel(test), formatFileSize(test.pdf?.size || 0), listeningMeta, ready ? "Ready" : "", locked ? "Locked" : "", finished ? "Finished" : "", `Saved ${created}`, updated !== created ? `Updated ${updated}` : ""],
        actions: nationalTestCardActionsHtml(test)
      })}
      ${nationalTestCardSearchMatchesHtml(test, searchMatches)}
    </article>
  `;
}

function isNationalTestLocked(test) {
  return Boolean(stringValueFromClient(test?.lockedAt));
}

function isNationalTestReady(test) {
  return Boolean(stringValueFromClient(test?.readyAt));
}

function isNationalTestFinished(test) {
  return Boolean(stringValueFromClient(test?.finishedAt));
}

function nationalTestCardActionsHtml(test) {
  const locked = isNationalTestLocked(test);
  const ready = isNationalTestReady(test);
  const finished = isNationalTestFinished(test);
  if (locked) {
    return [
      `<button class="${classNames("icon-button", "national-test-state-button", "lock-button", "active")}" type="button" title="Unlock test" aria-label="Unlock test" aria-pressed="true" data-toggle-national-test-lock="${escapeHtml(test.id)}">${icon("lock")}</button>`
    ];
  }
  return [
    `<button class="${classNames("icon-button", "national-test-state-button", "ready-button", ready ? "active" : "")}" type="button" title="${escapeHtml(ready ? "Mark test not ready" : "Mark test ready")}" aria-label="${escapeHtml(ready ? "Mark test not ready" : "Mark test ready")}" aria-pressed="${ready ? "true" : "false"}" data-toggle-national-test-ready="${escapeHtml(test.id)}">${icon(ready ? "badge-check" : "badge")}</button>`,
    `<button class="icon-button national-test-state-button lock-button" type="button" title="Lock test" aria-label="Lock test" aria-pressed="false" data-toggle-national-test-lock="${escapeHtml(test.id)}">${icon("unlock")}</button>`,
    `<button class="${classNames("icon-button", "national-test-state-button", "finish-button", finished ? "active" : "")}" type="button" title="${escapeHtml(finished ? "Mark test unfinished" : "Mark test finished")}" aria-label="${escapeHtml(finished ? "Mark test unfinished" : "Mark test finished")}" aria-pressed="${finished ? "true" : "false"}" data-toggle-national-test-finished="${escapeHtml(test.id)}">${icon(finished ? "check-circle-2" : "circle")}</button>`,
    iconButtonHtml({ iconName: "layout-list", title: "Study test", data: { "study-national-test": test.id } }),
    iconButtonHtml({ iconName: "book-open", title: "Open PDF", data: { "open-national-test": test.id } }),
    iconButtonHtml({ iconName: "trash-2", title: "Delete test", danger: true, data: { "delete-national-test": test.id } })
  ];
}

function nationalTestDetailsText(test) {
  return [test.course, test.term, test.year].filter(Boolean).join(" | ");
}

function nationalTestCardDetailsHtml(test) {
  const locked = isNationalTestLocked(test);
  const isEditing = state.nationalTestDetailsEditingId === test.id;
  const isSaving = state.nationalTestDetailsSavingId === test.id;
  if (isEditing) {
    return `
      <form class="national-test-details-form" data-edit-national-test-details-form="${escapeHtml(test.id)}">
        <input class="national-test-details-input" name="course" type="text" value="${escapeHtml(test.course || "")}" aria-label="Course" placeholder="Course" autocomplete="off" ${isSaving ? "disabled" : ""} />
        <input class="national-test-details-input" name="term" type="text" value="${escapeHtml(test.term || "")}" aria-label="Term" placeholder="Term" autocomplete="off" ${isSaving ? "disabled" : ""} />
        <input class="national-test-details-input" name="year" type="text" value="${escapeHtml(test.year || "")}" aria-label="Year" placeholder="Year" autocomplete="off" inputmode="numeric" ${isSaving ? "disabled" : ""} />
        <button class="icon-button accent" type="submit" title="Save test details" aria-label="Save test details" ${isSaving ? "disabled" : ""}>
          ${icon("check")}
        </button>
        <button class="icon-button" type="button" title="Cancel details edit" aria-label="Cancel details edit" data-cancel-national-test-details="${escapeHtml(test.id)}" ${isSaving ? "disabled" : ""}>
          ${icon("x")}
        </button>
      </form>
    `;
  }

  const details = nationalTestDetailsText(test) || "No course";
  return `
    <span class="national-test-details-row">
      <span class="pos-chip">${escapeHtml(details)}</span>
      ${locked ? "" : `
        <button class="icon-button national-test-details-edit-button" type="button" title="Edit course, term, and year" aria-label="Edit course, term, and year" data-edit-national-test-details="${escapeHtml(test.id)}">
          ${icon("pencil")}
        </button>
      `}
    </span>
  `;
}

function nationalTestCardTitleHtml(test) {
  const locked = isNationalTestLocked(test);
  const isRenaming = state.nationalTestRenamingId === test.id;
  const isSaving = state.nationalTestRenameSavingId === test.id;
  if (isRenaming) {
    return `
      <form class="national-test-rename-form" data-rename-national-test-form="${escapeHtml(test.id)}">
        <input
          class="national-test-rename-input"
          type="text"
          value="${escapeHtml(test.title)}"
          aria-label="Test name"
          autocomplete="off"
          required
          ${isSaving ? "disabled" : ""}
        />
        <button class="icon-button accent" type="submit" title="Save name" aria-label="Save name" ${isSaving ? "disabled" : ""}>
          ${icon("check")}
        </button>
        <button class="icon-button" type="button" title="Cancel rename" aria-label="Cancel rename" data-cancel-national-test-rename="${escapeHtml(test.id)}" ${isSaving ? "disabled" : ""}>
          ${icon("x")}
        </button>
      </form>
    `;
  }
  return `
    <span class="national-test-title-row">
      <button class="study-title-button" type="button" ${locked ? "disabled" : `data-study-national-test="${escapeHtml(test.id)}"`}>${escapeHtml(test.title)}</button>
      ${locked ? "" : `
        <button class="icon-button national-test-title-edit-button" type="button" title="Rename test" aria-label="Rename test" data-edit-national-test-title="${escapeHtml(test.id)}">
          ${icon("pencil")}
        </button>
      `}
    </span>
  `;
}

function nationalTestCardSearchMatches(test) {
  const query = stringValueFromClient(state.nationalTestFilters.search);
  return query ? searchNationalTestPages(test, query) : [];
}

function firstNationalTestSearchMatchPageId(testId) {
  const query = stringValueFromClient(state.nationalTestFilters.search);
  if (!query) return "";
  const test = (state.db.nationalTests || []).find(item => item.id === testId);
  if (!test) return "";
  return searchNationalTestPages(test, query)[0]?.page?.id || "";
}

function nationalTestCardSearchMatchesHtml(test, matches) {
  const query = stringValueFromClient(state.nationalTestFilters.search);
  if (!query || !matches.length) return "";
  const expanded = state.expandedNationalTestSearchMatchIds.has(test.id);
  const visibleMatches = expanded ? matches : matches.slice(0, 3);
  const remaining = Math.max(0, matches.length - visibleMatches.length);

  return `
    <div class="national-test-search-matches">
      <div class="national-test-search-matches-heading">
        <strong>${matches.length} ${matches.length === 1 ? "page match" : "page matches"}</strong>
        <span>${escapeHtml(query)}</span>
      </div>
      <div class="national-test-search-match-list">
        ${visibleMatches.map(match => nationalTestCardSearchMatchHtml(test, match, query)).join("")}
      </div>
      ${remaining ? `
        <button class="ghost-button national-test-search-more" type="button" data-toggle-national-test-search-matches="${escapeHtml(test.id)}">
          <span>Show ${remaining} more ${remaining === 1 ? "match" : "matches"}</span>
        </button>
      ` : expanded && matches.length > 3 ? `
        <button class="ghost-button national-test-search-more" type="button" data-toggle-national-test-search-matches="${escapeHtml(test.id)}">
          <span>Show fewer matches</span>
        </button>
      ` : ""}
    </div>
  `;
}

function nationalTestCardSearchMatchHtml(test, match, query) {
  const pageLabel = nationalTestVisualPageLabel(test, match.page);
  const section = nationalTestSectionLabel(effectiveNationalTestPageSection(match.page));
  const title = stringValueFromClient(match.page?.title) || stringValueFromClient(match.page?.topic);
  const label = [section, title].filter(Boolean).join(" | ");
  return `
    <button class="national-test-search-match" type="button" data-open-national-test-page-match="${escapeHtml(match.page.id)}">
      <strong>Page ${escapeHtml(String(pageLabel))}${label ? ` - ${escapeHtml(label)}` : ""}</strong>
      <small>${highlightedQueryTextHtml(truncateText(match.snippet, 170), query)}</small>
    </button>
  `;
}

function nationalTestSectionsHtml(test) {
  const sections = (test.sections || []).length ? test.sections : NATIONAL_TEST_SECTIONS;
  return `
    <div class="national-test-section-list">
      ${sections.map(section => {
        const config = NATIONAL_TEST_SECTIONS.find(item => item.key === section.key) || {};
        return `
          <span title="${escapeHtml(locationLabel(section))}">
            ${icon(config.icon || "layers")}
            ${escapeHtml(section.name || config.name || "Section")}
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function nationalTestListeningMediaMeta(test, options = {}) {
  const media = nationalTestListeningMediaForTarget(test, options);
  const groups = nationalTestListeningMediaGroups(media);
  if (groups.length > 1) return `Listening: ${groups.length} file sets`;
  const target = groups[0] || media;
  const parts = [];
  if (target.audio?.url) parts.push("Audio");
  if (target.transcript?.url) parts.push("Transcript");
  const pageSummary = nationalTestListeningMediaPageSummary(target, options.pages);
  return parts.length ? `Listening: ${parts.join(" + ")}${pageSummary ? ` - ${pageSummary}` : ""}` : "";
}

function nationalTestListeningMediaForTarget(test, options = {}) {
  const rootMedia = test?.listeningMedia || {};
  const topicKey = normalizedListeningTopicKey(options.topicKey);
  if (!topicKey) return rootMedia;
  return (rootMedia.topics || []).find(topic => normalizedListeningTopicKey(topic.key) === topicKey) || {};
}

function nationalTestListeningMediaPageSummary(media, pages = []) {
  const pageIds = Array.isArray(media?.pageIds) ? media.pageIds.map(String).filter(Boolean) : [];
  const topicPages = Array.isArray(pages) ? pages : [];
  if (!pageIds.length || !topicPages.length) return "";
  const labels = topicPages
    .filter(page => pageIds.includes(String(page.id)))
    .map(page => nationalTestVisualPageLabel(activeNationalTest(), page) || nationalTestPdfDisplayLabel(activeNationalTest(), page))
    .filter(Boolean);
  if (!labels.length) return "";
  return labels.length === topicPages.length ? "all pages" : labels.join(", ");
}

function nationalTestListeningMediaGroups(media) {
  const rawGroups = Array.isArray(media?.mediaGroups)
    ? media.mediaGroups
    : Array.isArray(media?.fileSets)
      ? media.fileSets
      : [];
  const groups = rawGroups.map((group, index) => ({
    id: stringValueFromClient(group?.id || group?.groupId || group?.mediaGroupId) || `group-${index + 1}`,
    pageIds: Array.isArray(group?.pageIds) ? group.pageIds.map(String).filter(Boolean) : [],
    audio: group?.audio || null,
    transcript: group?.transcript || null
  })).filter(group => group.audio?.url || group.transcript?.url);
  if (groups.length) return groups;
  if (media?.audio?.url || media?.transcript?.url) {
    return [{
      id: stringValueFromClient(media.id || media.mediaGroupId) || "legacy",
      pageIds: Array.isArray(media.pageIds) ? media.pageIds.map(String).filter(Boolean) : [],
      audio: media.audio || null,
      transcript: media.transcript || null
    }];
  }
  return [];
}

function nationalTestBrowserLayoutHtml(tests) {
  return `
    ${nationalTestSkillProgressSummaryHtml()}
    <div class="national-test-browser-layout">
      <section class="national-test-browser-panel national-test-browser-panel--tests">
        <header class="national-test-browser-panel-header">
          <strong>Tests</strong>
          <span>${escapeHtml(nationalTestCountText(tests.length))}</span>
        </header>
        <div class="national-test-browser-tests-list">
          ${tests.map(test => nationalTestCardHtml(test)).join("")}
        </div>
      </section>
    </div>
  `;
}

function nationalTestPageTextSegments(page) {
  const values = [];
  const pushValue = value => {
    const text = stringValueFromClient(value);
    if (text) values.push(text);
  };

  const extracted = String(page?.extractedText || "")
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  extracted.forEach(pushValue);
  layoutTextValues(page?.pageLayout?.elements || []).forEach(pushValue);
  nationalTestPageTranslationTextSegments(page, "ar").forEach(pushValue);

  const unique = [];
  const seen = new Set();
  values.forEach(value => {
    const normalized = normalizedPageSearchText(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    unique.push(value);
  });
  return unique;
}

function nationalTestPageTranslationTextSegments(page, language = "ar") {
  return Object.values(nationalTestPageTranslationItems(page, language))
    .flatMap(value => String(value || "").split(/\r?\n+/))
    .map(line => line.trim())
    .filter(Boolean);
}

function truncateText(value, maxLength = 160) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}â€¦`;
}

function renderNationalTestStudyWorkspace() {
  const test = activeNationalTest();
  if (!test) {
    els.testStudyWorkspace.innerHTML = emptyStateHtml("No test selected");
    return;
  }

  void ensureNationalTestPdfPreview(test);
  if (!state.nationalTestPagesLoaded) {
    els.testStudyWorkspace.innerHTML = emptyStateHtml("Loading test pages...");
    return;
  }
  const allPages = nationalTestPages(test.id);
  const pages = visibleNationalTestPages(test.id);
  if (!pages.some(page => page.id === state.activeNationalTestPageId)) {
    state.activeNationalTestPageId = pages[0]?.id || "";
  }
  const page = activeNationalTestPage();
  if (page) {
    rememberNationalTestPageProgress(page);
  }
  const transcriptViewer = activeNationalTestListeningTranscriptViewer(test);
  const groupedPages = groupedVisibleNationalTestPages(test);
  const pageGroupCollapseKeys = nationalTestPageGroupCollapseKeysForGroups(test, groupedPages);
  const allPageGroupsCollapsed = areNationalTestPageGroupsCollapsed(pageGroupCollapseKeys);
  const pageListCollapsed = Boolean(state.testPageListCollapsed);
  const details = [test.course, test.term, test.year].filter(Boolean).join(" | ");
  const pageCountLabel = state.activeNationalTestSectionFilter === "all"
    ? `${allPages.length} ${allPages.length === 1 ? "page" : "pages"}`
    : `${pages.length} of ${allPages.length} ${allPages.length === 1 ? "page" : "pages"}`;
  const emptySectionMessage = allPages.length
    ? `No pages in ${nationalTestSectionLabel(state.activeNationalTestSectionFilter).toLowerCase()}`
    : "No page selected";

  els.testStudyWorkspace.innerHTML = `
    <section class="test-study-panel">
      <header class="test-study-header">
        <div class="test-focus-brand">
          ${icon("book-open", "test-focus-brand-icon")}
          <h1>English Word Vault</h1>
        </div>
        <nav class="section-nav test-focus-section-nav" aria-label="App sections">
          <button class="section-nav-button" type="button" data-focus-section-nav="vault">
            ${icon("book-open")}
            <span>
              <strong>Words</strong>
              <small>Vocabulary</small>
            </span>
          </button>
          <button class="section-nav-button" type="button" data-focus-section-nav="verbs">
            ${icon("list-checks")}
            <span>
              <strong>Verbs</strong>
              <small>Forms</small>
            </span>
          </button>
          <button class="section-nav-button active" type="button" data-focus-section-nav="tests" aria-current="page">
            ${icon("file-text")}
            <span>
              <strong>Tests</strong>
              <small>Pages</small>
            </span>
          </button>
        </nav>
        <div class="test-study-title-block">
          <div class="title-line">
            <h2>${escapeHtml(test.title)}</h2>
            ${details ? `<span class="pos-chip">${escapeHtml(details)}</span>` : ""}
          </div>
          <div class="meta-line">
            <span>${nationalTestCountText(1)}</span>
            <span>${pageCountLabel}</span>
            <span>${formatFileSize(test.pdf?.size || 0)}</span>
            ${nationalTestListeningMediaMeta(test) ? `<span>${escapeHtml(nationalTestListeningMediaMeta(test))}</span>` : ""}
          </div>
        </div>
        ${testStudyHeaderLookupHtml()}
        <div class="row-actions test-study-header-actions">
          <button class="ghost-button" type="button" data-close-national-test-study aria-label="All tests" title="All tests">
            ${icon("arrow-left")}
            <span>All tests</span>
          </button>
        </div>
        <div class="topbar-actions test-focus-global-actions">
          <a class="audio-source-chip" href="https://www.merriam-webster.com/" target="_blank" rel="noopener" title="Audio source: Merriam-Webster">
            ${icon("volume-2")}
            <span>Audio</span>
            <strong>Merriam-Webster</strong>
          </a>
          <div class="topbar-utility-actions" aria-label="Secondary actions">
            <button class="ghost-button utility-button" type="button" data-refresh-app aria-label="Refresh" title="Refresh">
              ${icon("refresh-cw")}
              <span>Refresh</span>
            </button>
            <a class="ghost-button utility-button" href="/api/export" download="english-words.json" aria-label="Export" title="Export">
              ${icon("download")}
              <span>Export</span>
            </a>
          </div>
        </div>
      </header>

      <div class="lookup-results test-study-lookup-results test-lookup-results-target hidden"></div>

      <div class="test-page-stage ${pageListCollapsed ? "test-page-stage--list-collapsed" : ""}" ${testPageStageWidthStyleAttribute()}>
        <aside class="test-page-list-panel ${pageListCollapsed ? "is-collapsed" : ""}" aria-label="Page navigation">
          <button
            class="ghost-button test-page-list-toggle"
            type="button"
            data-toggle-test-page-list
            aria-expanded="${pageListCollapsed ? "false" : "true"}"
            title="${pageListCollapsed ? "Show page navigation" : "Hide page navigation"}"
          >
            ${icon(pageListCollapsed ? "chevron-right" : "chevron-left")}
            <span>${pageListCollapsed ? "Pages" : "Hide pages"}</span>
          </button>
          ${pageListCollapsed ? "" : `
            ${testPageSectionFilterHtml()}
            ${testPageGroupingToolControlsHtml(test)}
            ${state.testPageGroupingToolHidden ? "" : testPageGroupingToolHtml(test)}
            <div class="test-page-list-toolbar test-page-list-toolbar--groups">
              <div>
                <strong>Pages</strong>
                <span>${state.activeNationalTestSectionFilter === "all" ? "Skill groups and topics" : `Showing ${nationalTestSectionLabel(state.activeNationalTestSectionFilter)}`}</span>
              </div>
              ${pageGroupCollapseKeys.length ? `
                <button
                  class="ghost-button test-page-collapse-all-button"
                  type="button"
                  data-collapse-all-test-page-groups="${allPageGroupsCollapsed ? "false" : "true"}"
                  title="${escapeHtml(allPageGroupsCollapsed ? "Expand all page groups" : "Collapse all page groups")}"
                  aria-label="${escapeHtml(allPageGroupsCollapsed ? "Expand all page groups" : "Collapse all page groups")}"
                >
                  ${icon(allPageGroupsCollapsed ? "chevrons-down" : "chevrons-up")}
                  <span>${allPageGroupsCollapsed ? "Expand all" : "Collapse all"}</span>
                </button>
              ` : ""}
            </div>
            <nav class="test-page-list" aria-label="Test pages">
              ${groupedPages.length ? groupedPages.map(group => nationalTestPageSectionGroupHtml(test, group)).join("") : `<div class="empty-state">${escapeHtml(emptySectionMessage)}</div>`}
            </nav>
          `}
        </aside>
        ${pageListCollapsed ? "" : `
          <button
            class="test-page-list-resizer"
            type="button"
            aria-label="Resize page list panel"
            title="Drag to resize page list"
            data-resize-test-page-list
          ></button>
        `}
        <div class="test-page-editor" id="test-page-editor">
          ${transcriptViewer
            ? nationalTestListeningTranscriptViewerHtml(test, transcriptViewer)
            : page
              ? nationalTestPageEditorHtml(test, page)
              : `<div class="empty-state">${escapeHtml(emptySectionMessage)}</div>`}
        </div>
      </div>
    </section>
  `;
  if (transcriptViewer) {
    return;
  }
  schedulePageLayoutStabilization();
  void renderActiveNationalTestPageVisualFallback(test, page);
  const splitPage = activeNationalTestSplitPage(test, page);
  if (splitPage) {
    void renderActiveNationalTestPageVisualFallback(test, splitPage);
  }
}

function testStudyHeaderLookupHtml() {
  const query = stringValueFromClient(state.testLookup.query);
  return `
    <div class="test-study-lookup">
      <label class="test-study-lookup-field">
        ${icon("search")}
        <span>Word lookup</span>
        <input
          type="text"
          autocomplete="off"
          placeholder="Dictionary and optional thesaurus"
          value="${escapeHtml(query)}"
          data-test-lookup-word-input
        />
      </label>
      <label class="test-study-lookup-option" title="Include Merriam-Webster thesaurus results">
        <input type="checkbox" data-test-lookup-thesaurus-input />
        <span>Thesaurus</span>
      </label>
      <button class="icon-button accent test-study-lookup-submit" type="button" title="Look up word" aria-label="Look up word" data-test-lookup-submit>
        ${icon("search")}
      </button>
    </div>
  `;
}

function nationalTestListeningMediaPanelHtml(test, options = {}) {
  const topicKey = normalizedListeningTopicKey(options.topicKey);
  const topicLabel = stringValueFromClient(options.topicLabel);
  const media = nationalTestListeningMediaForTarget(test, { topicKey });
  const mediaGroups = nationalTestListeningMediaGroups(media);
  const targetLabel = topicLabel || "whole test";
  const topicPages = Array.isArray(options.pages) ? options.pages : [];
  const usedPageIds = new Set(mediaGroups.flatMap(group => group.pageIds || []));
  const defaultNewPageIds = topicPages
    .map(page => String(page.id))
    .filter(Boolean)
    .filter(pageId => !usedPageIds.has(pageId));
  const selectedPageIds = defaultNewPageIds.length
    ? defaultNewPageIds
    : topicPages.map(page => String(page.id)).filter(Boolean);
  const topicAttributes = topicKey
    ? ` data-test-listening-topic-key="${escapeHtml(topicKey)}" data-test-listening-topic-label="${escapeHtml(topicLabel)}"`
    : "";
  return `
    <details class="test-collapsible-panel test-listening-media-panel" id="test-listening-media-panel" ${options.open ? "open" : ""}>
      <summary class="test-panel-summary">
        <span>${icon("headphones")}Add listening files</span>
        <strong>${escapeHtml(targetLabel)}</strong>
        ${icon("chevron-down")}
      </summary>
      <div class="test-listening-media-body">
        <section class="test-listening-add-card">
          <strong>${escapeHtml(mediaGroups.length ? "Add another file set" : "Add file set")}</strong>
          <div class="test-listening-media-compact-grid">
            <section class="test-listening-compact-card">
              <span>${icon("volume-2")}Audio / video</span>
              <strong>Select the media file for these pages</strong>
              <div class="form-actions test-listening-compact-actions">
                <button class="ghost-button" type="button" data-pick-test-listening-media="audio">${icon("upload")}<span>Upload media</span></button>
              </div>
              <input class="hidden" id="test-listening-audio-input" type="file" accept="audio/*,video/mp4,.mp3,.mp4,.m4a,.wav,.ogg,.webm" />
              <div class="video-status" id="test-listening-audio-status">No media selected</div>
            </section>
            <section class="test-listening-compact-card">
              <span>${icon("file-text")}Transcript PDF</span>
              <strong>Select the transcript for these pages</strong>
              <div class="form-actions test-listening-compact-actions">
                <button class="ghost-button" type="button" data-pick-test-listening-media="transcript">${icon("upload")}<span>Upload PDF</span></button>
              </div>
              <input class="hidden" id="test-listening-transcript-input" type="file" accept="application/pdf,.pdf" />
              <div class="video-status" id="test-listening-transcript-status">No transcript selected</div>
            </section>
          </div>
          ${topicPages.length ? `
            <fieldset class="test-listening-page-fieldset">
              <legend>Pages that use these files</legend>
              <div class="test-listening-page-options">
                ${topicPages.map(page => {
                  const pageId = String(page.id);
                  const checked = selectedPageIds.includes(pageId);
                  const label = nationalTestVisualPageLabel(test, page) || nationalTestPdfDisplayLabel(test, page) || "Page";
                  return `
                    <label class="test-listening-page-option">
                      <input type="checkbox" value="${escapeHtml(pageId)}" data-test-listening-page-id ${checked ? "checked" : ""} />
                      <span>${escapeHtml(label)}</span>
                    </label>
                  `;
                }).join("")}
              </div>
            </fieldset>
          ` : ""}
          <div class="form-actions test-listening-media-actions">
            <button class="primary-button" type="button" data-upload-test-listening-media="${escapeHtml(test.id)}"${topicAttributes}>
              ${icon("save")}
              <span>Add files to selected pages</span>
            </button>
          </div>
        </section>
      </div>
    </details>
  `;
}

function nationalTestListeningAssignmentsHtml(test, options = {}) {
  const topicKey = normalizedListeningTopicKey(options.topicKey);
  const topicLabel = stringValueFromClient(options.topicLabel);
  const media = nationalTestListeningMediaForTarget(test, { topicKey });
  const mediaGroups = nationalTestListeningMediaGroups(media);
  const topicPages = Array.isArray(options.pages) ? options.pages : [];
  const topicAttributes = topicKey
    ? ` data-test-listening-topic-key="${escapeHtml(topicKey)}" data-test-listening-topic-label="${escapeHtml(topicLabel)}"`
    : "";
  if (!mediaGroups.length) return "";
  return `
    <div class="test-listening-assignment-list">
      ${mediaGroups.map((group, index) => {
        const audio = group.audio || null;
        const transcript = group.transcript || null;
        const audioLabel = audio?.originalName || audio?.filename || "Audio/video";
        const transcriptLabel = transcript?.originalName || transcript?.filename || "Transcript PDF";
        const pageSummary = nationalTestListeningMediaPageSummary(group, topicPages) || "No pages selected";
        const groupAttributes = `${topicAttributes} data-test-listening-media-group-id="${escapeHtml(group.id)}"`;
        const attachedKinds = [
          audio ? "Audio/video" : "",
          transcript ? "Transcript" : ""
        ].filter(Boolean).join(" + ") || "No files";
        const playerHtml = audio?.url ? `
          <details class="test-listening-inline-panel">
            <summary>${icon("play")}<span>Play</span></summary>
            ${nationalTestListeningPlayerHtml(audio, audioLabel)}
          </details>
        ` : "";
        const transcriptHtml = transcript?.url ? `
          <button class="ghost-button" type="button" data-open-test-listening-transcript="${escapeHtml(group.id)}"${topicAttributes}>
            ${icon("file-text")}
            <span>Transcript</span>
          </button>
        ` : "";
        return `
          <section class="test-listening-assignment-card">
            <div class="test-listening-assignment-header">
              <strong>File set ${index + 1}</strong>
              <span>${escapeHtml(pageSummary)}</span>
            </div>
            <div class="test-listening-assignment-summary">
              <span>${escapeHtml(attachedKinds)} attached</span>
            </div>
            <div class="test-listening-assignment-actions">
              ${playerHtml}
              ${transcriptHtml}
              <button class="ghost-button" type="button" data-delete-test-listening-media="${escapeHtml(test.id)}" data-test-listening-kind="all"${groupAttributes}>
                ${icon("trash-2")}
                <span>Remove</span>
              </button>
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function nationalTestListeningPlayerHtml(audio, label = "Listening media") {
  const source = escapeHtml(audio?.url || "");
  const title = escapeHtml(label);
  if (!source) return "";
  const mimeType = stringValueFromClient(audio?.mimeType).toLocaleLowerCase();
  const filename = stringValueFromClient(audio?.filename).toLocaleLowerCase();
  const isVideo = mimeType.startsWith("video/") || filename.endsWith(".mp4");
  return isVideo
    ? `<video class="test-listening-audio-player" controls src="${source}" title="${title}"></video>`
    : `<audio class="test-listening-audio-player" controls src="${source}" title="${title}"></audio>`;
}

function openNationalTestListeningTranscript(topicKey, mediaGroupId) {
  const normalizedTopicKey = normalizedListeningTopicKey(topicKey);
  const groupId = stringValueFromClient(mediaGroupId);
  if (!normalizedTopicKey || !groupId) return;
  state.activeNationalTestTranscriptViewer = { topicKey: normalizedTopicKey, mediaGroupId: groupId };
  rerenderNationalTestsPreservingViewport({ preserveStudyColumn: true });
}

function closeNationalTestListeningTranscript() {
  state.activeNationalTestTranscriptViewer = null;
  rerenderNationalTestsPreservingViewport({ preserveStudyColumn: true });
}

function activeNationalTestListeningTranscriptViewer(test = activeNationalTest()) {
  const viewer = state.activeNationalTestTranscriptViewer;
  if (!test || !viewer) return null;
  const topicKey = normalizedListeningTopicKey(viewer.topicKey);
  const mediaGroupId = stringValueFromClient(viewer.mediaGroupId);
  if (!topicKey || !mediaGroupId) return null;
  const topicMedia = nationalTestListeningMediaForTarget(test, { topicKey });
  const group = nationalTestListeningMediaGroups(topicMedia).find(item => item.id === mediaGroupId);
  if (!group?.transcript?.url) return null;
  const groupedPages = groupedVisibleNationalTestPages(test);
  const topic = groupedPages
    .flatMap(section => section.topics || [])
    .find(item => normalizedListeningTopicKey(item.key) === topicKey);
  return {
    topicKey,
    mediaGroupId,
    topicLabel: topic?.label || topicMedia.label || topicKey,
    pages: topic?.pages || [],
    group,
    transcript: group.transcript
  };
}

function nationalTestListeningTranscriptViewerHtml(test, viewer) {
  const transcript = viewer.transcript;
  const transcriptLabel = transcript.originalName || transcript.filename || "Transcript PDF";
  const pageSummary = nationalTestListeningMediaPageSummary(viewer.group, viewer.pages) || "Selected pages";
  return `
    <article class="test-listening-transcript-viewer">
      <header class="test-listening-transcript-viewer-header">
        <div>
          <span>${icon("file-text")}Transcript</span>
          <h3>${escapeHtml(viewer.topicLabel)}</h3>
          <small>${escapeHtml(pageSummary)}</small>
        </div>
        <div class="row-actions">
          <a class="ghost-button" href="${escapeHtml(transcript.url)}" target="_blank" rel="noopener">
            ${icon("external-link")}
            <span>Open PDF</span>
          </a>
          <button class="ghost-button" type="button" data-close-test-listening-transcript>
            ${icon("x")}
            <span>Close</span>
          </button>
        </div>
      </header>
      <iframe class="test-listening-transcript-main-frame" src="${escapeHtml(transcript.url)}" title="${escapeHtml(`${test.title} - ${transcriptLabel}`)}"></iframe>
    </article>
  `;
}

function listeningMediaFileOptionsHtml(files, selectedFilename = "") {
  return (Array.isArray(files) ? files : []).map(file => {
    const filename = stringValueFromClient(file.filename);
    if (!filename) return "";
    const label = `${file.originalName || filename} (${formatFileSize(file.size || 0)})`;
    return `<option value="${escapeHtml(filename)}" ${filename === selectedFilename ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function activeNationalTest() {
  return (state.db.nationalTests || []).find(test => test.id === state.activeNationalTestId) || null;
}

function openNationalTestStudy(testId, options = {}) {
  if (!testId) return;
  saveActiveNationalTestAnswerComposerDraft();
  const requestedPageId = stringValueFromClient(options.pageId);
  const searchQuery = stringValueFromClient(options.searchQuery);
  const pageBelongsToTest = requestedPageId &&
    (state.db.nationalTestPages || []).some(page => page.id === requestedPageId && page.testId === testId);
  state.activeSection = "tests";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "tests");
  state.activeLibraryTab = "tests";
  state.activeNationalTestId = testId;
  state.activeNationalTestPageId = pageBelongsToTest ? requestedPageId : validLastWorkedNationalTestPageId(testId);
  state.activeNationalTestListeningTopicKey = "";
  state.activeNationalTestTranscriptViewer = null;
  state.activeNationalTestSectionFilter = "all";
  state.activeNationalTestPageSearch = searchQuery;
  state.testPageSplitView = false;
  state.testPageSplitPageId = "";
  resetNationalTestAnswerRevealState();
  restoreNationalTestAnswerDraftForPage(state.activeNationalTestPageId);
  state.nationalTestFocusMode = true;
  state.nationalTestFormOpen = false;
  if (els.testWordLookupPanel) {
    els.testWordLookupPanel.open = false;
  }
  const test = activeNationalTest();
  if (test) {
    void ensureNationalTestPdfPreview(test);
  }
  render();
  refreshIcons();
}

function closeNationalTestStudy() {
  saveActiveNationalTestAnswerComposerDraft();
  updateNationalTestPageDraftFromEditor();
  flushNationalTestAnswerAutosave().catch(error => {
    showToast(error.message || "Answer autosave failed", true);
  });
  state.nationalTestFocusMode = false;
  state.nationalTestFormOpen = false;
  state.activeNationalTestId = "";
  state.activeNationalTestPageId = "";
  state.activeNationalTestListeningTopicKey = "";
  state.activeNationalTestSectionFilter = "all";
  state.activeNationalTestPageSearch = "";
  resetNationalTestAnswerRevealState();
  render();
  refreshIcons();
}

function nationalTestPages(testId) {
  return [...(state.db.nationalTestPages || [])]
    .filter(page => page.testId === testId)
    .sort(compareNationalTestPageDisplayOrder);
}

function visibleNationalTestPages(testId = state.activeNationalTestId) {
  const filter = normalizedNationalTestSectionKey(state.activeNationalTestSectionFilter);
  return nationalTestPages(testId).filter(page => testPageMatchesSectionFilter(page, filter));
}

function activeNationalTestPage() {
  const visibleIds = new Set(visibleNationalTestPages().map(page => page.id));
  const page = (state.db.nationalTestPages || []).find(item => item.id === state.activeNationalTestPageId) || null;
  return page && visibleIds.has(page.id) ? page : null;
}

function activeNationalTestSplitPage(test = activeNationalTest(), page = activeNationalTestPage()) {
  if (!state.testPageSplitView || state.testPageSplitMode !== "page" || !test || !page) return null;
  const pages = visibleNationalTestPages(test.id);
  const selected = pages.find(item => item.id === state.testPageSplitPageId && item.id !== page.id);
  if (selected) return selected;
  return nextNationalTestSplitPage(test, page);
}

function nextNationalTestSplitPage(test = activeNationalTest(), page = activeNationalTestPage()) {
  if (!test || !page) return null;
  const pages = visibleNationalTestPages(test.id);
  if (pages.length < 2) return null;
  const index = pages.findIndex(item => item.id === page.id);
  if (index === -1) return pages.find(item => item.id !== page.id) || null;
  return pages[(index + 1) % pages.length]?.id === page.id
    ? pages.find(item => item.id !== page.id) || null
    : pages[(index + 1) % pages.length] || pages.find(item => item.id !== page.id) || null;
}

function ensureNationalTestSplitPage(test = activeNationalTest(), page = activeNationalTestPage()) {
  if (!state.testPageSplitView || state.testPageSplitMode !== "page") return null;
  const splitPage = activeNationalTestSplitPage(test, page);
  state.testPageSplitPageId = splitPage?.id || "";
  return splitPage;
}

function normalizedNationalTestSectionKey(value) {
  const key = normalizePracticeAnswer(value);
  if (key === "vocabulary") return "speaking";
  if (key === "listining") return "listening";
  return key;
}

function testPageMatchesSectionFilter(page, filterKey) {
  if (!filterKey || filterKey === "all") return true;
  return effectiveNationalTestPageSection(page) === filterKey;
}

function inferredNationalTestPageSectionFromTitle(title) {
  const value = normalizePracticeAnswer(String(title || "").replace(/[^A-Za-z\s]/g, " "));
  if (!value) return "";
  if (value.includes("reading section") || value === "reading") return "reading";
  if (value.includes("writing section") || value === "writing") return "writing";
  if (value.includes("listening section") || value.includes("listining section") || value === "listening" || value === "listining") return "listening";
  if (value.includes("speaking section") || value === "speaking") return "speaking";
  return "";
}

function effectiveNationalTestPageSection(page) {
  return normalizedNationalTestSectionKey(page?.section) || inferredNationalTestPageSectionFromTitle(page?.title);
}

function nationalTestSectionLabel(value) {
  const section = NATIONAL_TEST_SECTIONS.find(item => item.key === normalizedNationalTestSectionKey(value));
  return section?.name || value || "Section";
}

function isNationalTestPageFinished(page) {
  return Boolean(stringValueFromClient(page?.finishedAt));
}

function isNationalTestPageLocked(page) {
  return Boolean(stringValueFromClient(page?.lockedAt));
}

function nationalTestSectionPages(testId, sectionKey) {
  const normalizedSection = normalizedNationalTestSectionKey(sectionKey);
  return nationalTestPages(testId).filter(page => effectiveNationalTestPageSection(page) === normalizedSection);
}

function nationalTestSectionProgress(testId, sectionKey) {
  const pages = nationalTestSectionPages(testId, sectionKey);
  const finishedPages = pages.filter(isNationalTestPageFinished).length;
  const lockedPages = pages.filter(isNationalTestPageLocked).length;
  return {
    sectionKey: normalizedNationalTestSectionKey(sectionKey),
    pages,
    totalPages: pages.length,
    finishedPages,
    lockedPages,
    finished: Boolean(pages.length) && finishedPages === pages.length,
    locked: Boolean(pages.length) && lockedPages === pages.length,
    partial: Boolean(finishedPages) && finishedPages < pages.length,
    partiallyLocked: Boolean(lockedPages) && lockedPages < pages.length
  };
}

function nationalTestGlobalSkillProgress() {
  const testIds = new Set((state.db.nationalTests || []).map(test => test.id));
  return NATIONAL_TEST_SECTIONS.map(section => {
    const groups = [...testIds]
      .map(testId => nationalTestSectionProgress(testId, section.key))
      .filter(progress => progress.totalPages > 0);
    const finished = groups.filter(progress => progress.finished).length;
    return {
      ...section,
      total: groups.length,
      finished,
      remaining: Math.max(0, groups.length - finished),
      complete: Boolean(groups.length) && finished === groups.length
    };
  });
}

function nationalTestSkillProgressSummaryHtml() {
  const progress = nationalTestGlobalSkillProgress();
  return `
    <section class="test-skill-progress-summary" aria-label="All test skill progress">
      ${progress.map(item => `
        <div class="${classNames("test-skill-progress-pill", `test-skill-progress-pill--${item.key}`, item.complete ? "complete" : "")}">
          ${icon(item.icon)}
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${item.finished}/${item.total}</span>
          </div>
          <small>${item.remaining ? `${item.remaining} left` : item.total ? "Done" : "No parts"}</small>
        </div>
      `).join("")}
    </section>
  `;
}

function testPageSectionFilterHtml() {
  const current = normalizedNationalTestSectionKey(state.activeNationalTestSectionFilter) || "all";
  const buttons = [
    { key: "all", name: "All", icon: "layers" },
    ...NATIONAL_TEST_SECTIONS
  ];
  return `
    <div class="test-page-section-filter" role="group" aria-label="Filter test pages by section">
      ${buttons.map(section => `
        <button
          class="section-filter-button ${section.key === current ? "active" : ""}"
          type="button"
          aria-pressed="${section.key === current ? "true" : "false"}"
          data-filter-test-page-section="${section.key}"
        >
          ${icon(section.icon)}
          <span>${escapeHtml(section.name)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function nationalTestPageEditorHtml(test, page) {
  const sectionKey = effectiveNationalTestPageSection(page);
  const topic = normalizedNationalTestPageTopic(page.topic) || "";
  const pdfLabel = nationalTestPdfDisplayLabel(test, page);
  const visualLabel = nationalTestVisualPageLabel(test, page);
  const headingLabel = page.pagePart ? `Page ${visualLabel}` : `PDF page ${pdfLabel}`;
  const pdfCollapsed = state.testPagePdfCollapsed;
  const stickyToolsHtml = testPageStickyToolsHtml(test, page);
  const visualSectionHtml = testPageVisualSectionHtml(test, page);
  const wordsSectionHtml = testPageWordsSectionHtml(page, { includePractice: !pdfCollapsed });
  const practiceSectionHtml = testPageWordPracticeSectionHtml(page);
  return `
    <article class="test-page-card" data-test-page-editor="${page.id}">
      <header class="test-page-card-header">
        ${testPageEditorToolbarHtml(test, page, { sectionKey, topic, pdfLabel, headingLabel, pdfCollapsed })}
      </header>

      <div class="${classNames("test-page-search-results", state.activeNationalTestPageSearch ? "" : "hidden")}" id="test-page-search-results">
        ${nationalTestPageSearchResultsHtml(test)}
      </div>

      ${pageProcessingPanelHtml(test, page)}

      <div class="${classNames("test-page-grid", pdfCollapsed ? "pdf-collapsed" : "", pdfCollapsed && state.testPageWordPracticeHidden ? "practice-hidden" : "")}" ${pdfCollapsed ? testPagePracticeWidthStyleAttribute() : ""}>
        ${pdfCollapsed ? `
          <div class="test-page-main-column">
            ${stickyToolsHtml}
            ${visualSectionHtml}
          </div>
          <div
            class="test-page-practice-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize writing practice panel"
            title="Drag to resize writing practice"
            tabindex="0"
            data-resize-test-page-practice
          ></div>
          <aside class="test-page-inspector" aria-label="Page tools">
            ${practiceSectionHtml}
          </aside>
        ` : `
          <div class="test-page-pdf-panel">
            ${testPagePdfControlsHtml()}
            <iframe class="test-page-pdf-frame" src="${escapeHtml(testPagePdfFrameSrc(test, page))}" title="${escapeHtml(`${test.title} PDF page ${pdfLabel}`)}"></iframe>
          </div>
          <div class="test-page-study-column">
            ${stickyToolsHtml}
            ${visualSectionHtml}
            ${wordsSectionHtml}
          </div>
        `}
      </div>
    </article>
  `;
}

function pageProcessingPanelHtml(test, page) {
  const studyDocumentValidation = validateStudyDocumentV1(page?.studyDocument);
  const studyDocument = studyDocumentValidation.valid ? page.studyDocument : null;
  const semanticAnswers = studyDocument
    ? officialStudyDocumentAnswers(studyDocument, page?.questions)
    : [];
  const arabicTranslation = studyDocument
    ? page?.translations?.ar?.studyDocumentTranslation || null
    : null;
  const arabicValidation = arabicTranslation
    ? validateStudyDocumentTranslationV1(arabicTranslation, studyDocument, semanticAnswers)
    : { valid: false, errors: [] };
  const hasArabic = Boolean(studyDocument && arabicValidation.valid);
  const pageLabel = nationalTestVisualPageLabel(test, page);
  const documentMeta = studyDocument
    ? `${studyDocument.documentId} | Page ${pageLabel} | ${studyDocumentNodeCount(studyDocument)} semantic nodes`
    : `Page ${pageLabel} | Paste one canonical study-document/v1 JSON object`;
  return `
    <section class="test-page-section page-processing-panel" aria-label="Semantic study page import">
      <div class="study-document-body">
        <div class="study-document-summary-grid has-arabic-card">
          <section class="study-document-overview ${studyDocument ? "has-document" : ""}">
            <div class="study-document-overview-copy">
              <span class="study-document-status-icon">${icon(studyDocument ? "check" : "file-json")}</span>
              <div>
                <strong>${studyDocument ? "Study page imported" : "Study page JSON"}</strong>
                <p>${escapeHtml(documentMeta)}</p>
              </div>
            </div>
            <div class="study-document-actions">
              <button class="primary-button" type="button" data-copy-study-document-page-prompt="${escapeHtml(page.id)}">
                ${icon("copy")}
                <span>Copy Page Prompt</span>
              </button>
              <button class="ghost-button" type="button" data-open-study-document-json="${escapeHtml(page.id)}">
                ${icon(studyDocument ? "pencil" : "clipboard-paste")}
                <span>${studyDocument ? "Edit JSON" : "Paste JSON"}</span>
              </button>
              <button class="ghost-button" type="button" data-load-study-document-json="${escapeHtml(page.id)}">
                ${icon("file-up")}
                <span>Load JSON file</span>
              </button>
              <input class="hidden" type="file" accept="application/json,.json" data-study-document-json-file="${escapeHtml(page.id)}">
            </div>
          </section>

          <section class="study-document-translation-overview ${hasArabic ? "has-translation" : ""}">
            <div>
              <strong>Arabic semantic page</strong>
              <p>${hasArabic ? "Arabic translation saved for this study page." : studyDocument ? "Translate text values while preserving the English page structure." : "Import the English study page before translating it."}</p>
            </div>
            <div class="study-document-actions">
              <button class="ghost-button" type="button" data-copy-study-document-arabic-prompt="${escapeHtml(page.id)}" ${studyDocument ? "" : "disabled"}>
                ${icon("copy")}
                <span>Copy Arabic Prompt</span>
              </button>
              <button class="ghost-button" type="button" data-open-study-document-arabic-json="${escapeHtml(page.id)}">
                ${icon("languages")}
                <span>Paste Arabic JSON</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function studyDocumentNodeCount(document) {
  let count = 0;
  const visit = nodes => {
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      if (!node || typeof node !== "object") return;
      count += 1;
      visit(node.children);
      (Array.isArray(node.items) ? node.items : []).forEach(item => visit(item?.children));
      (Array.isArray(node.rows) ? node.rows : []).forEach(row => (
        (Array.isArray(row?.cells) ? row.cells : []).forEach(cell => visit(cell?.children))
      ));
    });
  };
  visit(document?.content);
  return count;
}

function studyDocumentPageById(pageId) {
  return (state.db.nationalTestPages || []).find(page => page.id === pageId) || null;
}

function studyDocumentImportKind(document) {
  if (document?.schemaVersion === "study-document/v1") return "english";
  if (document?.schemaVersion === "study-document-translation/v1") return "arabic";
  return "";
}

function studyDocumentImportTarget(document) {
  const documentId = stringValueFromClient(document?.documentId);
  if (!documentId) return { page: null, errors: [{ path: "$.documentId", message: "documentId must identify the destination page." }] };
  const matches = (state.db.nationalTestPages || []).filter(page => (
    page.id === documentId || page?.studyDocument?.documentId === documentId
  ));
  if (!matches.length) {
    return { page: null, errors: [{ path: "$.documentId", message: `No app page matches documentId ${documentId}.` }] };
  }
  if (matches.length > 1) {
    return { page: null, errors: [{ path: "$.documentId", message: `More than one app page matches documentId ${documentId}.` }] };
  }
  return { page: matches[0], errors: [] };
}

function studyDocumentImportPageLabel(page) {
  const test = (state.db.nationalTests || []).find(item => item.id === page?.testId);
  const pageNumber = page?.pagePart ? `${page.pageNumber}-${page.pagePart}` : String(page?.pageNumber || "?");
  return `${test?.title ? `${test.title} · ` : ""}Page ${pageNumber}`;
}

function openImportedStudyDocumentPage(page) {
  if (!page?.testId || !page?.id) return;
  expandNationalTestPageGroupsForPage(page);
  openNationalTestStudy(page.testId, { pageId: page.id });
}

async function copyStudyDocumentPrompt(pageId, kind) {
  const page = studyDocumentPageById(pageId);
  if (!page) {
    showToast("The selected page was not found", true);
    return;
  }
  let prompt = "";
  if (kind === "arabic") {
    const studyDocumentValidation = validateStudyDocumentV1(page.studyDocument);
    if (!studyDocumentValidation.valid) {
      showToast("Import a valid English study page first", true);
      return;
    }
    const semanticAnswers = officialStudyDocumentAnswers(page.studyDocument, page.questions);
    prompt = studyDocumentArabicPrompt(page.studyDocument, semanticAnswers);
  } else {
    prompt = studyDocumentPagePrompt(page);
  }
  try {
    await copyTextToClipboard(prompt);
    showToast(kind === "arabic" ? "Arabic prompt copied" : "Page prompt copied");
  } catch (error) {
    showToast(error.message || "Could not copy the prompt", true);
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const temporary = document.createElement("textarea");
  temporary.value = text;
  temporary.setAttribute("readonly", "");
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  document.body.appendChild(temporary);
  temporary.select();
  const copied = document.execCommand("copy");
  temporary.remove();
  if (!copied) throw new Error("Clipboard is not available");
}

function closeStudyDocumentDialog() {
  const dialog = document.querySelector("[data-study-document-dialog]");
  if (!dialog) return;
  if (dialog.open) dialog.close();
  dialog.remove();
}

function openStudyDocumentDialog(pageId, kind = "english", initialText = "") {
  const page = studyDocumentPageById(pageId);
  if (!page) {
    showToast("The selected page was not found", true);
    return;
  }
  const isArabic = kind === "arabic";
  closeStudyDocumentDialog();
  const existing = isArabic
    ? page?.translations?.ar?.studyDocumentTranslation
    : page.studyDocument;
  const value = initialText || (existing ? JSON.stringify(existing, null, 2) : "");
  const dialog = document.createElement("dialog");
  dialog.className = "study-document-dialog";
  dialog.dataset.studyDocumentDialog = kind;
  dialog.dataset.studyDocumentPageId = page.id;
  dialog.innerHTML = `
    <div class="study-document-dialog-header">
      <div>
        <strong>${isArabic ? "Import Arabic JSON" : existing ? "Edit Study JSON" : "Import Study JSON"}</strong>
        <span>Paste canonical study-document/v1 or study-document-translation/v1 JSON. It will be routed by documentId.</span>
      </div>
      <button class="icon-button" type="button" data-close-study-document-dialog aria-label="Close">${icon("x")}</button>
    </div>
    <div class="study-document-dialog-body">
      <label for="study-document-dialog-input">${isArabic ? "Arabic translation JSON" : "Study document JSON"}</label>
      <textarea id="study-document-dialog-input" data-study-document-dialog-input spellcheck="false" dir="${isArabic ? "auto" : "ltr"}">${escapeHtml(value)}</textarea>
      <div class="study-document-validation" data-study-document-validation></div>
    </div>
    <div class="study-document-dialog-actions">
      <button class="ghost-button" type="button" data-close-study-document-dialog>Cancel</button>
      <button class="primary-button" type="button" data-submit-study-document-dialog="${kind}">
        ${icon("check")}
        ${isArabic ? "<span>Validate &amp; Import Arabic</span>" : "<span>Validate &amp; Import</span>"}
      </button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.addEventListener("click", async event => {
    if (event.target.closest("[data-close-study-document-dialog]")) {
      closeStudyDocumentDialog();
      return;
    }
    const submitButton = event.target.closest("[data-submit-study-document-dialog]");
    if (!submitButton) return;
    submitButton.disabled = true;
    try {
      await submitStudyDocumentDialog(submitButton.dataset.submitStudyDocumentDialog);
    } finally {
      if (submitButton.isConnected) submitButton.disabled = false;
    }
  });
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeStudyDocumentDialog();
  });
  dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector("[data-study-document-dialog-input]")?.focus());
  refreshIcons();
}

function renderStudyDocumentDialogValidation(errors = [], message = "") {
  const target = document.querySelector("[data-study-document-validation]");
  if (!target) return;
  if (!errors.length) {
    target.innerHTML = message
      ? `<div class="study-document-validation-message valid">${icon("check-circle")}<span>${escapeHtml(message)}</span></div>`
      : "";
    refreshIcons();
    return;
  }
  target.innerHTML = `
    <div class="study-document-validation-message invalid">
      ${icon("alert-circle")}
      <div>
        <strong>${errors.length} validation ${errors.length === 1 ? "error" : "errors"}</strong>
        <ul>${errors.map(error => `<li><code>${escapeHtml(error.path || "$")}</code> ${escapeHtml(error.message || String(error))}</li>`).join("")}</ul>
      </div>
    </div>
  `;
  refreshIcons();
}

async function submitStudyDocumentDialog() {
  const dialog = document.querySelector("[data-study-document-dialog]");
  const openedPage = studyDocumentPageById(dialog?.dataset.studyDocumentPageId);
  const raw = dialog?.querySelector("[data-study-document-dialog-input]")?.value || "";
  if (!dialog || !openedPage) return;

  let parsed;
  try {
    parsed = parseImportedPageJson(raw);
  } catch (parseError) {
    try {
      const repaired = await api("/api/json/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw })
      });
      parsed = repaired.value;
      const input = dialog.querySelector("[data-study-document-dialog-input]");
      if (input && typeof repaired.text === "string") input.value = repaired.text;
      showToast("JSON syntax repaired automatically");
    } catch (repairError) {
      renderStudyDocumentDialogValidation([{
        path: "$",
        message: `Invalid JSON: ${parseError.message}. Automatic repair failed: ${repairError.message}`
      }]);
      return;
    }
  }

  const importKind = studyDocumentImportKind(parsed);
  if (!importKind) {
    renderStudyDocumentDialogValidation([{
      path: "$.schemaVersion",
      message: "schemaVersion must equal study-document/v1 or study-document-translation/v1."
    }]);
    return;
  }

  const target = studyDocumentImportTarget(parsed);
  if (!target.page) {
    renderStudyDocumentDialogValidation(target.errors);
    return;
  }
  const targetPage = target.page;
  const targetLabel = studyDocumentImportPageLabel(targetPage);

  if (importKind === "arabic") {
    const studyDocumentValidation = validateStudyDocumentV1(targetPage.studyDocument);
    if (!studyDocumentValidation.valid) {
      renderStudyDocumentDialogValidation([{
        path: "$.documentId",
        message: `${targetLabel} does not have a valid English study document yet.`
      }]);
      return;
    }
    const semanticAnswers = officialStudyDocumentAnswers(targetPage.studyDocument, targetPage.questions);
    const translationValidation = validateStudyDocumentTranslationV1(parsed, targetPage.studyDocument, semanticAnswers);
    if (!translationValidation.valid) {
      renderStudyDocumentDialogValidation(translationValidation.errors);
      return;
    }
    renderStudyDocumentDialogValidation([], `Arabic translation is valid for ${targetLabel}. Saving...`);
    try {
      const saved = await patchNationalTestPage({
        ...targetPage,
        translations: {
          ...(targetPage.translations || {}),
          ar: { studyDocumentTranslation: parsed }
        }
      });
      replaceNationalTestPage(saved);
      state.testPageTranslationLanguage = "ar";
      localStorage.setItem(TEST_PAGE_TRANSLATION_LANGUAGE_STORAGE_KEY, "ar");
      closeStudyDocumentDialog();
      openImportedStudyDocumentPage(saved);
      showToast(`Arabic JSON imported to ${targetLabel}`);
    } catch (error) {
      renderStudyDocumentDialogValidation([{ path: "$", message: error.message || "Server error" }]);
    }
    return;
  }

  const documentValidation = validateStudyDocumentV1(parsed);
  const bindingValidation = documentValidation.valid
    ? validateStudyDocumentPageBinding(parsed, targetPage)
    : { valid: false, errors: [] };
  const answerValidation = documentValidation.valid && bindingValidation.valid
    ? validateOfficialStudyDocumentAnswerMapping(parsed, targetPage.questions)
    : { valid: false, errors: [] };
  const errors = [
    ...documentValidation.errors,
    ...bindingValidation.errors,
    ...answerValidation.errors
  ];
  if (errors.length) {
    renderStudyDocumentDialogValidation(errors);
    return;
  }

  const studyDocumentChanged = JSON.stringify(targetPage.studyDocument || null) !== JSON.stringify(parsed);
  if (studyDocumentChanged && targetPage.studyDocument) {
    const confirmed = window.confirm(`${targetLabel} already has an English study document. Replace it with this JSON?`);
    if (!confirmed) {
      renderStudyDocumentDialogValidation([], "Import cancelled; no page was changed.");
      return;
    }
  }

  renderStudyDocumentDialogValidation([], `Study document is valid for ${targetLabel}. Saving...`);
  try {
    const saved = await patchNationalTestPage({
      ...targetPage,
      studyDocument: parsed,
      ...(studyDocumentChanged ? {
        translations: {
          ...(targetPage.translations || {}),
          ar: null
        }
      } : {})
    });
    replaceNationalTestPage(saved);
    state.testPageTranslationLanguage = "en";
    localStorage.setItem(TEST_PAGE_TRANSLATION_LANGUAGE_STORAGE_KEY, "en");
    closeStudyDocumentDialog();
    openImportedStudyDocumentPage(saved);
    showToast(studyDocumentChanged && targetPage?.translations?.ar
      ? `English JSON imported to ${targetLabel}; previous Arabic translation removed`
      : `English JSON imported to ${targetLabel}`);
  } catch (error) {
    renderStudyDocumentDialogValidation([{ path: "$", message: error.message || "Server error" }]);
  }
}

function testPagePdfFrameSrc(test, page) {
  const url = stringValueFromClient(test?.pdf?.url);
  if (!url) return "";
  const pageNumber = Math.max(1, Math.round(displayNumber(page?.pageNumber, 1)));
  const zoomPercent = Math.round(normalizedTestPagePdfZoom(state.testPagePdfZoom) * 100);
  return `${url}#page=${pageNumber}&zoom=${zoomPercent}`;
}

function testPagePdfControlsHtml() {
  const zoom = normalizedTestPagePdfZoom(state.testPagePdfZoom);
  return `
    <div class="test-page-pdf-controls" aria-label="PDF zoom">
      <span>${icon("file-text")}PDF</span>
      <div class="test-page-pdf-zoom-controls">
        <button class="icon-button" type="button" title="Zoom out PDF" aria-label="Zoom out PDF" data-test-page-pdf-zoom="out" ${zoom <= TEST_PAGE_PDF_ZOOM_MIN ? "disabled" : ""}>${icon("minus")}</button>
        <span class="test-page-pdf-zoom-value" data-test-page-pdf-zoom-value>${escapeHtml(testPagePdfZoomPercent())}</span>
        <button class="icon-button" type="button" title="Zoom in PDF" aria-label="Zoom in PDF" data-test-page-pdf-zoom="in" ${zoom >= TEST_PAGE_PDF_ZOOM_MAX ? "disabled" : ""}>${icon("plus")}</button>
        <button class="ghost-button test-page-pdf-zoom-reset" type="button" data-test-page-pdf-zoom="reset" ${Math.abs(zoom - 1) < 0.001 ? "disabled" : ""}>
          ${icon("rotate-ccw")}
          <span>100%</span>
        </button>
      </div>
    </div>
  `;
}

function testPageEditorToolbarHtml(test, page, details) {
  const section = NATIONAL_TEST_SECTIONS.find(item => item.key === details.sectionKey);
  const sectionLabel = details.sectionKey ? nationalTestSectionLabel(details.sectionKey) : "Unclassified";
  const sectionIcon = section?.icon || "layers";
  const topic = details.topic || "No topic";
  return `
    <div class="test-page-editor-toolbar">
      <div class="test-page-identity">
        <span class="test-page-file-badge">
          ${icon("file-text")}
          <strong>${escapeHtml(details.headingLabel)}</strong>
        </span>
        ${page.pagePart ? `<span class="pos-chip">PDF page ${escapeHtml(details.pdfLabel)}</span>` : ""}
        <span class="${classNames("test-page-skill-badge", details.sectionKey ? `test-page-skill-badge--${details.sectionKey}` : "")}">
          ${icon(sectionIcon)}
          <span>${escapeHtml(sectionLabel)}</span>
        </span>
      </div>
      <div class="test-page-topic-badge">
        <span>Topic</span>
        <strong>${escapeHtml(topic)}</strong>
      </div>
      <label class="test-page-toolbar-search">
        ${icon("search")}
        <input
          id="test-page-search-input"
          type="text"
          autocomplete="off"
          placeholder="Search topic, question, Arabic, or phrase"
          value="${escapeHtml(state.activeNationalTestPageSearch || "")}"
        />
      </label>
      <div class="row-actions test-page-actions">
        <button
          class="ghost-button"
          type="button"
          aria-pressed="${details.pdfCollapsed ? "true" : "false"}"
          title="${details.pdfCollapsed ? "Show page PDF panel" : "Hide page PDF panel"}"
          data-toggle-test-page-pdf
        >
          ${icon(details.pdfCollapsed ? "eye" : "eye-off")}
          <span>${details.pdfCollapsed ? "Show page PDF" : "Hide page PDF"}</span>
        </button>
        <button class="primary-button" type="button" data-save-test-page="${page.id}">
          ${icon("save")}
          <span>Save changes</span>
        </button>
        <button class="icon-button danger-button test-page-delete-button" type="button" title="Delete page" aria-label="Delete page" data-delete-test-page="${page.id}">${icon("trash-2")}</button>
      </div>
    </div>
  `;
}

function testPageStickyToolsHtml(test, page) {
  return `
    <div class="test-page-sticky-tools">
      ${testPageVisualControlsHtml(test, page)}
    </div>
  `;
}

function testPageSearchSectionHtml(test) {
  return `
    <section class="test-page-section test-page-search-section">
      <h4>Search this test</h4>
      <div class="test-page-search-row">
        <input
          id="test-page-search-input"
          type="text"
          autocomplete="off"
          placeholder="Search topic, question, Arabic, or phrase"
          value="${escapeHtml(state.activeNationalTestPageSearch || "")}"
        />
      </div>
      <div class="${classNames("test-page-search-results", state.activeNationalTestPageSearch ? "" : "hidden")}" id="test-page-search-results">
        ${nationalTestPageSearchResultsHtml(test)}
      </div>
    </section>
  `;
}

function testPageVisualSectionHtml(test, page) {
  const splitPage = activeNationalTestSplitPage(test, page);
  const translationSplit = state.testPageSplitView && state.testPageSplitMode === "translation" && hasNationalTestPageTranslation(page, "ar");
  const splitView = translationSplit || splitPage;
  return `
    <section class="test-page-section test-page-visual-section">
      <div id="test-page-visual-content" class="${classNames(shouldShowTestPageAnswerMarkers() && state.placingTestPageAnswerId ? "placing-comment" : "", splitView ? "split-view" : "")}" style="--test-page-visual-zoom:${normalizedTestPageVisualZoom(state.testPageVisualZoom).toFixed(3)}">
        ${translationSplit
          ? testPageVisualTranslationSplitContentHtml(test, page)
          : splitPage
            ? testPageVisualSplitContentHtml(test, page, splitPage)
            : testPageVisualContentHtml(test, page)}
      </div>
    </section>
  `;
}

function testPageVisualTranslationSplitContentHtml(test, page) {
  return `
    <div class="test-page-visual-split" aria-label="Original and translated visual page">
      ${testPageVisualSplitPaneHtml(test, page, "Original", { language: "en" })}
      ${testPageVisualSplitPaneHtml(test, page, "Arabic", { language: "ar", answerMarkers: false })}
    </div>
  `;
}

function testPageVisualSplitContentHtml(test, page, splitPage) {
  return `
    <div class="test-page-visual-split" aria-label="Split visual pages">
      ${testPageVisualSplitPaneHtml(test, page, "Current page")}
      ${testPageVisualSplitPaneHtml(test, splitPage, "Second page")}
    </div>
  `;
}

function testPageVisualSplitPaneHtml(test, page, label, options = {}) {
  return `
    <div class="test-page-split-pane" data-test-page-split-pane="${escapeHtml(page.id)}">
      <div class="test-page-split-pane-header">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(`Page ${nationalTestVisualPageLabel(test, page)}`)}</span>
      </div>
      ${testPageVisualContentHtml(test, page, options)}
    </div>
  `;
}

function testPageVisualControlsHtml(test, page) {
  return `
    <section class="test-page-section test-page-visual-controls-section">
      <div class="test-page-section-heading">
        <h4>Visual page</h4>
        <div class="test-page-visual-tools">
          ${testPageSplitControlsHtml(test, page)}
          ${testPageTranslationToggleHtml(page)}
          ${testPageOfficialAnswersToggleHtml(page)}
          <button class="ghost-button test-page-comment-add-button" type="button" data-open-test-page-answer-compose="${page.id}">
            ${icon("message-square-plus")}
            <span>Add answer</span>
          </button>
          ${testPageVisualZoomControlsHtml()}
        </div>
      </div>
      ${testPageCommentPanelHtml(page)}
    </section>
  `;
}

function testPageOfficialAnswersToggleHtml(page) {
  const answerCount = officialNationalTestPageAnswerDisplayCount(page);
  if (!answerCount) return "";
  const englishPage = activeTestPageTranslationLanguage() === "en";
  const visible = Boolean(state.testPageOfficialAnswersVisible);
  return `
    <button
      class="ghost-button test-page-official-answers-toggle ${englishPage && visible ? "active" : ""}"
      type="button"
      aria-pressed="${englishPage && visible ? "true" : "false"}"
      ${englishPage ? "data-toggle-test-page-official-answers" : "disabled"}
      title="${englishPage ? (visible ? "Hide official answers" : "Show official answers") : "Official answers are available on the English page"}"
    >
      ${icon(englishPage && visible ? "eye-off" : "eye")}
      <span>${englishPage ? (visible ? "Hide answers" : `Show answers (${answerCount})`) : `Answers (${answerCount}) · English`}</span>
    </button>
  `;
}

function officialNationalTestPageAnswerDisplayCount(page) {
  const questionCount = officialNationalTestPageQuestions(page).length;
  if (questionCount) return questionCount;
  const layout = displayLayoutForPage(page);
  return Math.max(
    colorOnlyOfficialAnswerElementCount(layout),
    answerDecorationElementCount(layout)
  );
}

function officialNationalTestPageQuestions(page) {
  return (Array.isArray(page?.questions) ? page.questions : [])
    .filter(question => stringValueFromClient(question?.answer?.value) && !question?.answer?.needsReview);
}

function setTestPageAnswersVisible(visible) {
  state.testPageOfficialAnswersVisible = Boolean(visible);
}

function toggleTestPageOfficialAnswers() {
  setTestPageAnswersVisible(!state.testPageOfficialAnswersVisible);
  rerenderNationalTestsPreservingViewport({ preserveStudyColumn: true });
}

function testPageTranslationToggleHtml(page) {
  const language = activeTestPageTranslationLanguage();
  const hasArabic = hasNationalTestPageTranslation(page, "ar");
  return `
    <div class="test-page-translation-toggle" aria-label="Visual page language">
      <button
        class="ghost-button ${language === "en" ? "active" : ""}"
        type="button"
        aria-pressed="${language === "en" ? "true" : "false"}"
        data-test-page-translation-language="en"
      >
        <span>English</span>
      </button>
      <button
        class="ghost-button ${language === "ar" ? "active" : ""}"
        type="button"
        aria-pressed="${language === "ar" ? "true" : "false"}"
        title="${hasArabic ? "Show Arabic translation" : "Arabic translation has not been imported for this page"}"
        data-test-page-translation-language="ar"
      >
        <span>Arabic${hasArabic ? "" : " empty"}</span>
      </button>
    </div>
  `;
}

function translationTemplateItemsForChatGpt(elements = [], items = []) {
  const groupedGapItems = translationTemplateGroupedGapItems(elements);
  const hiddenTextIds = new Set(
    [...groupedGapItems.values()]
      .flatMap(item => item.hiddenSourceElementIds || [])
      .filter(Boolean)
  );
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    if (element.type === "group" && Array.isArray(element.elements)) {
      translationTemplateItemsForChatGpt(element.elements, items);
      return;
    }
    if (element.type !== "text") return;
    const sourceElementId = stringValueFromClient(element.id);
    const sourceText = translationTemplateSourceTextForElement(element);
    if (hiddenTextIds.has(sourceElementId)) return;
    if (!isTranslationTemplateStandaloneText(element)) return;
    if (!sourceElementId || !sourceText) return;
    const groupedItem = groupedGapItems.get(sourceElementId);
    if (groupedItem) {
      items.push(groupedItem);
      return;
    }
    items.push({
      sourceElementId,
      sourceText,
      text: ""
    });
  });
  return items;
}

function translationTemplateGroupedGapItems(elements = []) {
  const entries = sortedTranslationTemplateFlowEntries(elements);
  const groupedItems = new Map();
  const consumedTextIds = new Set();
  entries.forEach((entry, startIndex) => {
    if (entry.kind !== "text") return;
    const sourceElementId = stringValueFromClient(entry.element?.id);
    if (!sourceElementId || consumedTextIds.has(sourceElementId)) return;

    const scanStartIndex = translationTemplateLeadingGapStartIndex(entries, startIndex);
    const parts = [];
    const sourceElementIds = [];
    const hiddenSourceElementIds = [];
    const gaps = [];
    let hasGap = false;
    let previousEntry = entries[scanStartIndex] || entry;

    for (let index = scanStartIndex; index < entries.length; index += 1) {
      const current = entries[index];
      if (index > scanStartIndex && translationTemplateFlowBreak(previousEntry, current, hasGap)) break;

      if (current.kind === "text") {
        const id = stringValueFromClient(current.element?.id);
        const text = translationTemplateSourceTextForElement(current.element);
        if (!id || !text) continue;
        if (index > startIndex && consumedTextIds.has(id)) break;
        parts.push(text);
        sourceElementIds.push(id);
        if (id !== sourceElementId) hiddenSourceElementIds.push(id);
        previousEntry = current;
        if (hasGap && translationTemplateSentenceEnds(text)) break;
        continue;
      }

      if (current.kind === "gap") {
        const gapId = stringValueFromClient(current.element?.id);
        if (!gapId) continue;
        const placeholder = `{{${gapId}}}`;
        parts.push(placeholder);
        sourceElementIds.push(gapId);
        gaps.push({
          id: gapId,
          placeholder,
          sourceElementId: gapId,
          x: Number(current.absoluteX || 0),
          y: Number(current.absoluteY || 0)
        });
        hasGap = true;
        previousEntry = current;
      }
    }

    if (!hasGap || parts.length < 3) return;
    hiddenSourceElementIds.forEach(id => consumedTextIds.add(id));
    groupedItems.set(sourceElementId, {
      sourceElementId,
      sourceText: translationTemplateSourceTextForElement(entry.element),
      sourceTextWithGaps: normalizedTranslationTemplateSourceText(parts.join(" ")),
      sourceElementIds: [...new Set(sourceElementIds)],
      hiddenSourceElementIds: [...new Set(hiddenSourceElementIds)],
      gaps,
      text: ""
    });
  });
  return groupedItems;
}

function translationTemplateLeadingGapStartIndex(entries, startIndex) {
  if (!Array.isArray(entries) || startIndex <= 0) return startIndex;
  const previous = entries[startIndex - 1];
  const current = entries[startIndex];
  if (!previous || !current || previous.kind !== "gap" || current.kind !== "text") return startIndex;
  if (!translationTemplateSameVisualLine(previous, current)) return startIndex;
  const previousX = Number(previous.absoluteX || 0);
  const previousWidth = Math.max(0, Number(previous.element?.width || 0));
  const currentX = Number(current.absoluteX || 0);
  if (currentX < previousX) return startIndex;
  if (currentX - (previousX + previousWidth) > 42) return startIndex;
  return startIndex - 1;
}

function translationTemplateSameVisualLine(left, right) {
  const leftY = Number(left?.absoluteY || 0);
  const rightY = Number(right?.absoluteY || 0);
  const leftHeight = Math.max(1, Number(left?.element?.height || 1));
  const rightHeight = Math.max(1, Number(right?.element?.height || 1));
  return Math.abs((leftY + leftHeight / 2) - (rightY + rightHeight / 2)) <= 18;
}

function sortedTranslationTemplateFlowEntries(elements = []) {
  return flattenedPositionedLayoutEntries(elements || [])
    .map(entry => {
      if (
        entry.element?.type === "text" &&
        translationTemplateSourceTextForElement(entry.element) &&
        isTranslationTemplateFlowText(entry.element)
      ) {
        return { ...entry, kind: "text" };
      }
      if (isTranslationTemplateGapLine(entry.element)) {
        return { ...entry, kind: "gap" };
      }
      return null;
    })
    .filter(Boolean)
    .sort((left, right) => translationTemplateFlowOrder(left, right));
}

function translationTemplateFlowOrder(left, right) {
  const leftY = Number(left.absoluteY || 0);
  const rightY = Number(right.absoluteY || 0);
  if (Math.abs(leftY - rightY) <= 22) {
    return Number(left.absoluteX || 0) - Number(right.absoluteX || 0);
  }
  return leftY - rightY || Number(left.absoluteX || 0) - Number(right.absoluteX || 0);
}

function translationTemplateFlowBreak(previousEntry, currentEntry, hasGap) {
  if (!previousEntry || !currentEntry) return false;
  const previousBottom = Number(previousEntry.absoluteY || 0) + Math.max(1, Number(previousEntry.element?.height || 1));
  const currentTop = Number(currentEntry.absoluteY || 0);
  const verticalGap = currentTop - previousBottom;
  if (verticalGap > 82) return true;
  if (!hasGap && translationTemplateSentenceEnds(translationTemplateSourceTextForElement(previousEntry.element))) {
    return currentEntry.kind !== "gap";
  }
  return false;
}

function translationTemplateSentenceEnds(text) {
  return /[.!?。؟؛»”"')\]]\s*$/u.test(stringValueFromClient(text));
}

function normalizedTranslationTemplateSourceText(text) {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, "$1-$2")
    .replace(/(\{\{[^}]+\}\})\s+([,.;:!?])/g, "$1$2")
    .trim();
}

function isTranslationTemplateGapLine(element) {
  if (!element || element.type !== "line") return false;
  const id = stringValueFromClient(element.id).toLowerCase();
  const role = stringValueFromClient(element.role).toLowerCase();
  const gapLike = /(^|[-_])(gap|blank|answer-line|inline-gap)([-_]|$)/u.test(id) ||
    /(inline-gap|gap|blank)/u.test(role);
  const decorative = /(top|bottom|yellow|divider|instruction|border|rule)/u.test(id) ||
    /(divider|decorative|border)/u.test(role);
  return gapLike && !decorative;
}

function isTranslationTemplateFlowText(element) {
  if (!element || element.type !== "text") return false;
  const id = stringValueFromClient(element.id).toLowerCase();
  const role = stringValueFromClient(element.role).toLowerCase();
  if (isTranslationAnswerOptionElement(element)) return false;
  if (/(^|[-_])(gap-number|gap-label|answer-number)([-_]|$)/u.test(id)) return false;
  if (/(^|[-_])q\d+[-_]gap[-_]number([-_]|$)/u.test(id)) return false;
  if (/(^|[-_])(gap-number|gap-label|answer-number)([-_]|$)/u.test(role)) return false;
  return true;
}

function isTranslationTemplateStandaloneText(element) {
  if (!element || element.type !== "text") return false;
  const id = stringValueFromClient(element.id).toLowerCase();
  const role = stringValueFromClient(element.role).toLowerCase();
  if (/(^|[-_])(gap-number|gap-label|answer-number)([-_]|$)/u.test(id)) return false;
  if (/(^|[-_])q\d+[-_]gap[-_]number([-_]|$)/u.test(id)) return false;
  if (/(^|[-_])(gap-number|gap-label|answer-number)([-_]|$)/u.test(role)) return false;
  return true;
}

function translationTemplateSourceTextForElement(element) {
  const text = repairTranslationTemplateMojibake(stringValueFromClient(element?.text));
  if (text) return text;
  if (!Array.isArray(element?.lines)) return "";
  const lines = element.lines
    .map(line => stringValueFromClient(line))
    .filter(Boolean)
    .join("\n");
  return repairTranslationTemplateMojibake(lines);
}

function repairTranslationTemplateMojibake(text) {
  return String(text || "")
    .replace(/â€™/g, "’")
    .replace(/â€˜/g, "‘")
    .replace(/â€œ/g, "“")
    .replace(/â€[\u009d\u009c\u009d]/g, "”")
    .replace(/â€/g, "”")
    .replace(/â€“/g, "–")
    .replace(/â€”/g, "—")
    .replace(/Â«/g, "«")
    .replace(/Â»/g, "»")
    .replace(/Â /g, " ");
}

function translationTemplateItemsFromLayout(elements = [], items = {}) {
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    if (element.type === "group" && Array.isArray(element.elements)) {
      translationTemplateItemsFromLayout(element.elements, items);
      return;
    }
    if (element.type !== "text") return;
    const id = stringValueFromClient(element.id);
    if (id) items[id] = arabicTemplateValueForElement(element);
  });
  return items;
}

function arabicTemplateValueForElement(element) {
  const role = stringValueFromClient(element.role).toLowerCase();
  if (role.includes("title")) return "اكتب العنوان بالعربية هنا";
  if (role.includes("heading")) return "اكتب العنوان الفرعي بالعربية هنا";
  if (role.includes("question")) return "اكتب السؤال بالعربية هنا";
  if (role.includes("option") || role.includes("choice")) return "اكتب خيار الإجابة بالعربية هنا";
  if (role.includes("instruction")) return "اكتب التعليمات بالعربية هنا";
  if (role.includes("caption")) return "اكتب التعليق بالعربية هنا";
  return "اكتب ترجمة النص بالعربية هنا";
}

function testPageSplitControlsHtml(test, page) {
  const pages = visibleNationalTestPages(test?.id).filter(item => item.id !== page?.id);
  const splitPage = ensureNationalTestSplitPage(test, page);
  const hasArabic = hasNationalTestPageTranslation(page, "ar");
  const canSplit = hasArabic || pages.length > 0;
  const mode = state.testPageSplitMode === "page" ? "page" : "translation";
  return `
    <div class="test-page-split-controls">
      <button
        class="ghost-button ${state.testPageSplitView ? "active" : ""}"
        type="button"
        aria-pressed="${state.testPageSplitView ? "true" : "false"}"
        data-toggle-test-page-split
        ${canSplit ? "" : "disabled"}
      >
        ${icon("columns-2")}
        <span>${state.testPageSplitView ? "Single page" : "Split view"}</span>
      </button>
      ${state.testPageSplitView && canSplit ? `
        <label class="test-page-split-select">
          <span>Split</span>
          <select data-select-test-page-split-mode>
            <option value="translation" ${mode === "translation" ? "selected" : ""} ${hasArabic ? "" : "disabled"}>Original / Arabic</option>
            <option value="page" ${mode === "page" ? "selected" : ""} ${pages.length ? "" : "disabled"}>Second page</option>
          </select>
        </label>
      ` : ""}
      ${state.testPageSplitView && canSplit && mode === "page" && pages.length ? `
        <label class="test-page-split-select">
          <span>Second page</span>
          <select data-select-test-page-split>
            ${pages.map(item => `
              <option value="${escapeHtml(item.id)}" ${item.id === splitPage?.id ? "selected" : ""}>
                ${escapeHtml(`Page ${nationalTestVisualPageLabel(test, item)}`)}
              </option>
            `).join("")}
          </select>
        </label>
      ` : ""}
    </div>
  `;
}

function testPageCommentPanelHtml(page) {
  const answers = nationalTestPageAnswers(page);
  const editingAnswer = answers.find(answer => answer.id === state.editingTestPageAnswerId) || null;
  const placingAnswer = answers.find(answer => answer.id === state.placingTestPageAnswerId) || null;
  const unplacedAnswers = answers.filter(answer => !hasNationalTestAnswerPlacement(answer));
  const draft = testPageAnswerDraftForPage(page.id);
  const parts = [];

  if (placingAnswer) {
    parts.push(`
      <div class="test-page-comment-placement-banner">
        ${icon("mouse-pointer-2")}
        <span>Click the visual page to place ${escapeHtml(nationalTestAnswerQuestionLabel(placingAnswer))}.</span>
        <button class="ghost-button" type="button" data-cancel-test-page-answer-place>${icon("x")}<span>Cancel</span></button>
      </div>
    `);
  }

  if (state.testPageAnswerComposerOpen) {
    const draftQuestion = stringValueFromClient(draft?.question) || nextNationalTestAnswerQuestion(page);
    parts.push(`
      <div class="test-page-comment-editor test-page-comment-editor--compose">
        <input id="test-page-answer-question-input" type="text" autocomplete="off" placeholder="Q3, Paragraph 2, Main idea" value="${escapeHtml(draftQuestion)}" />
        <textarea id="test-page-answer-text-input" rows="3" placeholder="Write the answer or comment">${escapeHtml(draft?.answer || "")}</textarea>
        <div class="test-page-comment-editor-actions">
          <button class="primary-button" type="button" data-add-test-page-answer="${page.id}">
            ${icon("message-square-plus")}
            <span>Save and place</span>
          </button>
          <button class="ghost-button" type="button" data-cancel-test-page-answer-edit>${icon("x")}<span>Cancel</span></button>
        </div>
      </div>
    `);
  }

  if (editingAnswer) {
    parts.push(`
      <div class="test-page-comment-editor" data-test-page-answer-editor="${escapeHtml(editingAnswer.id)}">
        <label>
          <span>Label</span>
          <input type="text" value="${escapeHtml(editingAnswer.question || "")}" data-test-page-answer-question="${escapeHtml(editingAnswer.id)}" />
        </label>
        <label>
          <span>Answer / comment</span>
          <textarea rows="3" data-test-page-answer-text="${escapeHtml(editingAnswer.id)}">${escapeHtml(editingAnswer.answer || "")}</textarea>
        </label>
        <div class="test-page-comment-editor-actions">
          <button class="ghost-button" type="button" data-place-test-page-answer="${escapeHtml(editingAnswer.id)}">
            ${icon("move")}
            <span>Reposition</span>
          </button>
          <button class="ghost-button" type="button" data-close-test-page-answer-edit>${icon("check")}<span>Done</span></button>
          <button class="ghost-button danger-button" type="button" data-delete-test-page-answer="${escapeHtml(editingAnswer.id)}">
            ${icon("trash-2")}
            <span>Delete</span>
          </button>
        </div>
      </div>
    `);
  }

  if (unplacedAnswers.length && !state.testPageAnswerComposerOpen && !placingAnswer) {
    parts.push(`
      <div class="test-page-unplaced-comments">
        <strong>Unplaced comments</strong>
        ${unplacedAnswers.map(answer => `
          <button class="ghost-button" type="button" data-place-test-page-answer="${escapeHtml(answer.id)}">
            ${icon("map-pin")}
            <span>${escapeHtml(nationalTestAnswerQuestionLabel(answer))}</span>
          </button>
        `).join("")}
      </div>
    `);
  }

  return parts.length ? `<div class="test-page-comment-panel">${parts.join("")}</div>` : "";
}

function testPageWordsSectionHtml(page, options = {}) {
  const includePractice = options.includePractice !== false;
  return `
    <section class="test-page-section test-page-words-section">
      <h4>Page words</h4>
      ${includePractice ? `
        <div class="test-page-word-practice-target">
          ${testPageWordPracticeHtml(page)}
        </div>
      ` : ""}
      <div class="test-page-word-row">
        <input id="test-page-word-input" type="text" autocomplete="off" placeholder="word" />
        <input id="test-page-word-note-input" type="text" autocomplete="off" placeholder="note" />
        <button class="ghost-button" type="button" data-add-test-page-word="${page.id}">
          ${icon("plus")}
          <span>Add</span>
        </button>
      </div>
      <div class="test-page-word-list">
        ${testPageWordListHtml(page)}
      </div>
    </section>
  `;
}

function testPageWordPracticeSectionHtml(page) {
  const hidden = state.testPageWordPracticeHidden;
  return `
    <section class="${classNames("test-page-section", "test-page-word-practice-section", hidden ? "is-hidden" : "")}">
      <div class="test-page-word-practice-section-head">
        <h4>Writing practice</h4>
        <button
          class="icon-button test-page-word-practice-toggle"
          type="button"
          title="${hidden ? "Show writing practice" : "Hide writing practice"}"
          aria-label="${hidden ? "Show writing practice" : "Hide writing practice"}"
          aria-pressed="${hidden ? "true" : "false"}"
          data-toggle-test-page-word-practice
        >
          ${icon(hidden ? "eye" : "eye-off")}
        </button>
      </div>
      <div class="test-page-word-practice-target" ${hidden ? "hidden" : ""}>
        ${testPageWordPracticeHtml(page)}
      </div>
    </section>
  `;
}

function testPageWordListHtml(page) {
  const acceptedKeys = testPageWordPracticeAcceptedKeys(page);
  return (page.words || []).length ? page.words.map(word => `
    <span class="${classNames("test-page-word-chip", acceptedKeys.has(normalizedTestPageWordPracticeKey(word.word)) ? "accepted" : "")}">
      <strong>${escapeHtml(word.word)}</strong>
      ${word.note ? `<small>${escapeHtml(word.note)}</small>` : ""}
      ${acceptedKeys.has(normalizedTestPageWordPracticeKey(word.word)) ? `<span class="test-page-word-chip-status" title="Accepted">${icon("check")}</span>` : ""}
      <button type="button" title="Remove word" aria-label="Remove word" data-remove-test-page-word="${word.id}">${icon("x")}</button>
    </span>
  `).join("") : `<div class="empty-state">No page words</div>`;
}

function normalizedTestPageWordPracticeKey(value) {
  return normalizePracticeAnswer(value)
    .replace(/[^\p{L}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function testPageWordPracticeEntries(page) {
  const entriesByKey = new Map();
  const addEntry = entry => {
    const key = normalizedTestPageWordPracticeKey(entry?.word);
    if (!key || entriesByKey.has(key)) return;
    entriesByKey.set(key, {
      id: entry.id || `practice_word_${key}`,
      word: entry.word,
      note: entry.note || "",
      source: entry.source || "saved",
      key
    });
  };

  (Array.isArray(page?.words) ? page.words : []).forEach(word => addEntry({ ...word, source: "saved" }));
  scannedTestPagePracticeWords(page).forEach(addEntry);
  return [...entriesByKey.values()];
}

function testPageWordPracticeInputWordKeys(input) {
  return scanPracticeWordsFromText(input)
    .map(entry => normalizedTestPageWordPracticeKey(entry.word))
    .filter(Boolean);
}

function testPageWordPracticePhraseExistsOnPage(page, key) {
  if (!key) return false;
  return testPageEnglishTextSegmentsForPractice(page).some(text => {
    const textKey = normalizedTestPageWordPracticeKey(text);
    return textKey === key || textKey.startsWith(`${key} `) || textKey.endsWith(` ${key}`) || textKey.includes(` ${key} `);
  });
}

function testPageWordPracticeMatchesFromInput(input, entries = [], page = null) {
  const entriesByKey = new Map(entries.map(entry => [entry.key, entry]));
  const matchesByKey = new Map();
  const addMatch = key => {
    const match = entriesByKey.get(key);
    if (match) matchesByKey.set(match.key, match);
  };

  const exactKey = normalizedTestPageWordPracticeKey(input);
  addMatch(exactKey);
  const wordKeys = testPageWordPracticeInputWordKeys(input);
  if (wordKeys.length > 1 && page && !testPageWordPracticePhraseExistsOnPage(page, exactKey)) {
    return [];
  }
  wordKeys.forEach(addMatch);

  return [...matchesByKey.values()];
}

function testPageWordPracticeInputTokens(input) {
  return scanPracticeWordsFromText(input)
    .map(entry => ({
      word: entry.word,
      key: normalizedTestPageWordPracticeKey(entry.word)
    }))
    .filter(token => token.key);
}

function testPageWordPracticePageTokenKeys(page) {
  return testPageEnglishTextSegmentsForPractice(page)
    .flatMap(text => scanPracticeWordsFromText(text))
    .map(entry => normalizedTestPageWordPracticeKey(entry.word))
    .filter(Boolean);
}

function testPageWordPracticeClosestPageWindow(page, inputTokens = []) {
  const inputKeys = inputTokens.map(token => token.key);
  const pageKeys = testPageWordPracticePageTokenKeys(page);
  if (!inputKeys.length || !pageKeys.length) return [];

  let bestStart = 0;
  let bestScore = -1;
  const lastStart = Math.max(0, pageKeys.length - inputKeys.length);
  for (let start = 0; start <= lastStart; start += 1) {
    let score = 0;
    inputKeys.forEach((key, index) => {
      if (pageKeys[start + index] === key) score += 1;
    });
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  return pageKeys.slice(bestStart, bestStart + inputKeys.length);
}

function testPageWordPracticeDisplayPhrase(input, matches = []) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (text && matches.length > 1) return text;
  return matches[0]?.word || text;
}

function scannedTestPagePracticeWords(page) {
  const entries = [];
  const seen = new Set();
  testPageEnglishTextSegmentsForPractice(page).forEach(text => {
    scanPracticeWordsFromText(text).forEach(entry => {
      const key = normalizedTestPageWordPracticeKey(entry.word);
      if (!key || seen.has(key)) return;
      seen.add(key);
      entries.push({
        id: `scanned_${key}`,
        word: entry.word,
        note: "",
        source: "scanned"
      });
    });
  });
  return entries;
}

function testPageEnglishTextSegmentsForPractice(page) {
  const values = [];
  const pushValue = value => {
    const text = stringValueFromClient(value);
    if (text) values.push(text);
  };
  String(page?.extractedText || "")
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(pushValue);
  const layout = displayLayoutForPage(page) || page?.pageLayout;
  layoutTextValues(layout?.elements || []).forEach(pushValue);

  const unique = [];
  const seen = new Set();
  values.forEach(value => {
    const key = normalizedPageSearchText(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(value);
  });
  return unique;
}

function scanPracticeWordsFromText(text) {
  const value = String(text || "");
  const tokenPattern = /\p{L}+(?:['\u2019-]\p{L}+)*/gu;
  const entries = [];
  for (const match of value.matchAll(tokenPattern)) {
    const word = String(match[0] || "").trim();
    if (word) entries.push({ word });
  }
  return entries;
}

function ensureTestPageWordPracticeState(page) {
  if (!state.testPageWordPractice || state.testPageWordPractice.pageId !== page?.id) {
    state.testPageWordPractice = {
      pageId: page?.id || "",
      input: "",
      acceptedKeys: new Set(),
      acceptedPhrases: [],
      status: "",
      message: ""
    };
  }
  if (!(state.testPageWordPractice.acceptedKeys instanceof Set)) {
    state.testPageWordPractice.acceptedKeys = new Set();
  }
  if (!Array.isArray(state.testPageWordPractice.acceptedPhrases)) {
    state.testPageWordPractice.acceptedPhrases = [];
  }
  return state.testPageWordPractice;
}

function testPageWordPracticeAcceptedKeys(page) {
  const practice = ensureTestPageWordPracticeState(page);
  const validKeys = new Set(testPageWordPracticeEntries(page).map(word => word.key));
  practice.acceptedKeys = new Set([...practice.acceptedKeys].filter(key => validKeys.has(key)));
  practice.acceptedPhrases = practice.acceptedPhrases
    .map(phrase => ({
      text: stringValueFromClient(phrase?.text),
      keys: Array.isArray(phrase?.keys) ? phrase.keys.filter(key => validKeys.has(key)) : []
    }))
    .filter(phrase => phrase.text && phrase.keys.length);
  return practice.acceptedKeys;
}

function testPageWordPracticeHtml(page) {
  const practice = ensureTestPageWordPracticeState(page);
  const entries = testPageWordPracticeEntries(page);
  const total = new Set(entries.map(word => word.key)).size;
  const accepted = testPageWordPracticeAcceptedKeys(page).size;
  const pageWordCount = entries.filter(entry => entry.source === "scanned").length;
  return `
    <div class="${classNames("test-page-word-practice", practice.status ? `is-${practice.status}` : "")}">
      <div class="test-page-word-practice-head">
        <strong>${icon("pencil-line")}Writing practice</strong>
        <span data-test-page-word-practice-meter>${accepted}/${total}</span>
      </div>
      <div class="test-page-word-practice-status" data-test-page-word-practice-status>
        ${escapeHtml(total ? practice.message || (accepted === total ? "All accepted" : pageWordCount ? `${pageWordCount} words found on this page` : "Ready") : "No words found on this visual page")}
      </div>
      <div
        class="test-page-word-practice-pad"
        data-test-page-word-practice-pad
      >
        <div class="test-page-word-practice-accepted" data-test-page-word-practice-accepted>
          ${testPageWordPracticePadHtml(page, entries)}
        </div>
        <textarea
          class="test-page-word-practice-input"
          rows="3"
          placeholder="Type a word or sentence from the page"
          aria-label="Writing practice answer"
          data-test-page-word-practice-input
          ${total ? "" : "disabled"}
        >${escapeHtml(practice.input)}</textarea>
        <div class="test-page-word-practice-preview" data-test-page-word-practice-preview>
          ${testPageWordPracticeDraftFeedbackHtml(page)}
        </div>
      </div>
    </div>
  `;
}

function testPageWordPracticePadHtml(page, entries = testPageWordPracticeEntries(page)) {
  const practice = ensureTestPageWordPracticeState(page);
  const acceptedKeys = testPageWordPracticeAcceptedKeys(page);
  const phraseKeys = new Set();
  const phraseHtml = practice.acceptedPhrases.map(phrase => {
    phrase.keys.forEach(key => phraseKeys.add(key));
    return `<span class="test-page-word-practice-phrase">${escapeHtml(phrase.text)}</span>`;
  }).join("");
  const acceptedEntries = entries.filter(entry => acceptedKeys.has(entry.key) && !phraseKeys.has(entry.key));
  const acceptedHtml = `${phraseHtml}${acceptedEntries.map(entry => `<span>${escapeHtml(entry.word)}</span>`).join("")}`;
  return acceptedHtml;
}

function testPageWordPracticeDraftFeedbackHtml(page) {
  const practice = ensureTestPageWordPracticeState(page);
  const input = stringValueFromClient(practice.input);
  const tokens = testPageWordPracticeInputTokens(input);
  if (!tokens.length || practice.status !== "rejected" || tokens.length < 2) return "";
  const windowKeys = testPageWordPracticeClosestPageWindow(page, tokens);
  return tokens.map((token, index) => `
    <span class="${windowKeys[index] === token.key ? "" : "wrong"}">${escapeHtml(token.word)}</span>
  `).join("");
}

function filteredWritingPracticeLabel(count) {
  const parts = [
    state.filters.search ? `search: ${state.filters.search}` : "",
    state.filters.sourceId ? locationLabel({
      sourceId: state.filters.sourceId,
      branchId: state.filters.branchId,
      unitId: state.filters.unitId
    }) : "",
    state.filters.from || state.filters.to ? [state.filters.from || "start", state.filters.to || "today"].join(" to ") : "",
    state.filters.partOfSpeech ? state.filters.partOfSpeech : "",
    state.filters.arabic ? `${state.filters.arabic} Arabic` : ""
  ].filter(Boolean);
  const scope = parts.length ? parts.join(" | ") : "All visible words";
  return `${scope} - ${wordCountText(count)}`;
}

function clearSourceWritingPractice(options = {}) {
  state.sourceWritingPractice = {
    active: false,
    location: { sourceId: "", branchId: "", unitId: "" },
    label: "",
    mode: "example",
    entries: [],
    input: "",
    acceptedKeys: new Set(),
    acceptedPhrases: [],
    status: "",
    message: "",
    lastFeedback: null
  };
  if (options.renderAfter !== false) {
    renderSources();
    renderWords();
    refreshIcons();
  }
}

function ensureSourceWritingPracticeState() {
  const practice = state.sourceWritingPractice || {};
  if (!(practice.acceptedKeys instanceof Set)) {
    practice.acceptedKeys = new Set(Array.isArray(practice.acceptedKeys) ? practice.acceptedKeys : []);
  }
  if (!Array.isArray(practice.acceptedPhrases)) {
    practice.acceptedPhrases = [];
  }
  if (!practice.location || typeof practice.location !== "object") {
    practice.location = { sourceId: "", branchId: "", unitId: "" };
  }
  state.sourceWritingPractice = {
    active: Boolean(practice.active),
    location: {
      sourceId: stringValueFromClient(practice.location.sourceId),
      branchId: stringValueFromClient(practice.location.branchId),
      unitId: stringValueFromClient(practice.location.unitId)
    },
    label: stringValueFromClient(practice.label),
    mode: practice.mode === "definition" ? "definition" : "example",
    entries: Array.isArray(practice.entries) ? practice.entries : [],
    input: String(practice.input || ""),
    acceptedKeys: practice.acceptedKeys,
    acceptedPhrases: practice.acceptedPhrases,
    status: stringValueFromClient(practice.status),
    message: stringValueFromClient(practice.message),
    lastFeedback: practice.lastFeedback && typeof practice.lastFeedback === "object"
      ? {
          status: stringValueFromClient(practice.lastFeedback.status),
          word: stringValueFromClient(practice.lastFeedback.word),
          input: stringValueFromClient(practice.lastFeedback.input),
          example: stringValueFromClient(practice.lastFeedback.example)
        }
      : null
  };
  return state.sourceWritingPractice;
}

function sourceWritingPracticeWords(location = ensureSourceWritingPracticeState().location) {
  if (!findVaultSource(location.sourceId)) return [];
  const seen = new Set();
  return (state.db.words || [])
    .filter(word => isVaultRecordLocation(word) && stringValueFromClient(word.word) && wordMatchesLocationFilter(word, location))
    .filter(word => {
      const key = normalizedTestPageWordPracticeKey(word.word);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => normalizePracticeAnswer(a.word).localeCompare(normalizePracticeAnswer(b.word)));
}

function sourceWritingPracticeReferenceTexts(word) {
  const seen = new Set();
  return [
    ...wordSearchStrings(word.examples),
    ...wordSearchStrings(word.collocations)
  ]
    .map(value => String(value || "").replace(/\s+/g, " ").trim())
    .filter(value => {
      const key = normalizedPageSearchText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sourceWritingPracticeExampleTexts(word) {
  const seen = new Set();
  return wordSearchStrings(word.examples)
    .map(value => String(value || "").replace(/\s+/g, " ").trim())
    .filter(value => {
      const key = normalizedPageSearchText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sourceWritingPracticeEntriesFromWords(words = []) {
  return words.map(word => ({
    id: word.id,
    word: word.word,
    key: normalizedTestPageWordPracticeKey(word.word),
    note: word.definition || "",
    definition: word.definition || "",
    examples: sourceWritingPracticeExampleTexts(word),
    references: sourceWritingPracticeReferenceTexts(word)
  })).filter(entry => entry.key);
}

function sourceWritingPracticeEntries(words) {
  if (Array.isArray(words)) return sourceWritingPracticeEntriesFromWords(words);
  const practice = ensureSourceWritingPracticeState();
  if (Array.isArray(practice.entries) && practice.entries.length) return practice.entries;
  practice.entries = sourceWritingPracticeEntriesFromWords(sourceWritingPracticeWords());
  return practice.entries;
}

function sourceWritingPracticeAcceptedKeys(entries = sourceWritingPracticeEntries()) {
  const practice = ensureSourceWritingPracticeState();
  const validKeys = new Set(entries.map(entry => entry.key));
  practice.acceptedKeys = new Set([...practice.acceptedKeys].filter(key => validKeys.has(key)));
  practice.acceptedPhrases = practice.acceptedPhrases
    .map(phrase => ({
      text: stringValueFromClient(phrase?.text),
      keys: Array.isArray(phrase?.keys) ? phrase.keys.filter(key => validKeys.has(key)) : []
    }))
    .filter(phrase => phrase.text && phrase.keys.length);
  return practice.acceptedKeys;
}

function isSourceWritingPracticeWordAccepted(word) {
  const practice = ensureSourceWritingPracticeState();
  const key = normalizedTestPageWordPracticeKey(word?.word);
  return Boolean(key && practice.acceptedKeys instanceof Set && practice.acceptedKeys.has(key));
}

function normalizedPracticeTextContainsKey(textKey, key) {
  if (!textKey || !key) return false;
  if (textKey === key) return true;
  return ` ${textKey} `.includes(` ${key} `);
}

function sourceWritingPracticeMatchesFromInput(input, entries = sourceWritingPracticeEntries()) {
  const entriesByKey = new Map(entries.map(entry => [entry.key, entry]));
  const matchesByKey = new Map();
  const addMatch = key => {
    const match = entriesByKey.get(key);
    if (match) matchesByKey.set(match.key, match);
  };

  addMatch(normalizedTestPageWordPracticeKey(input));
  testPageWordPracticeInputWordKeys(input).forEach(addMatch);
  return [...matchesByKey.values()];
}

function sourceWritingPracticePage(entries = sourceWritingPracticeEntries()) {
  const lines = entries.flatMap(entry => [
    entry.word,
    ...(Array.isArray(entry.references) ? entry.references : [])
  ]);
  return { extractedText: lines.join("\n"), pageLayout: null };
}

function isExactSourceWritingPracticeWord(input, matches = sourceWritingPracticeMatchesFromInput(input)) {
  const key = normalizedTestPageWordPracticeKey(input);
  return Boolean(key && matches.some(match => match.key === key));
}

function sourceWritingPracticeClosestReference(matches, inputTokens) {
  if (!matches.length || !inputTokens.length) return [];
  const inputKeys = inputTokens.map(token => token.key);
  let best = [];
  let bestScore = -1;
  matches.flatMap(match => match.references.slice(0, 6)).slice(0, 24).forEach(reference => {
    const referenceTokens = testPageWordPracticeInputTokens(reference);
    if (!referenceTokens.length) return;
    const referenceKeys = referenceTokens.map(token => token.key);
    const overlapScore = inputKeys.filter(key => referenceKeys.includes(key)).length;
    const positionScore = inputKeys.filter((key, index) => referenceKeys[index] === key).length;
    const score = overlapScore * 2 + positionScore;
    if (score > bestScore) {
      bestScore = score;
      best = referenceKeys;
    }
  });
  return best;
}

function sourceWritingPracticeExampleForEntry(entry) {
  const examples = Array.isArray(entry?.examples) ? entry.examples : [];
  return examples.find(example => normalizedPracticeTextContainsKey(normalizedTestPageWordPracticeKey(example), entry.key)) ||
    examples[0] ||
    "";
}

function sourceWritingPracticeDefinitionForEntry(entry) {
  return stringValueFromClient(entry?.definition || entry?.note);
}

function sourceWritingPracticeMode() {
  return ensureSourceWritingPracticeState().mode === "definition" ? "definition" : "example";
}

function sourceWritingPracticePromptEntry(entries = sourceWritingPracticeEntries()) {
  const acceptedKeys = sourceWritingPracticeAcceptedKeys(entries);
  const mode = sourceWritingPracticeMode();
  const remaining = entries.filter(entry => !acceptedKeys.has(entry.key));
  if (mode === "definition") {
    return remaining.find(entry => sourceWritingPracticeDefinitionForEntry(entry)) ||
      remaining.find(entry => sourceWritingPracticeExampleForEntry(entry)) ||
      remaining[0] ||
      null;
  }
  return remaining.find(entry => sourceWritingPracticeExampleForEntry(entry)) ||
    remaining.find(entry => sourceWritingPracticeDefinitionForEntry(entry)) ||
    remaining[0] ||
    null;
}

function sourceWritingPracticeMaskedExampleHtml(example, word) {
  const text = stringValueFromClient(example);
  const target = stringValueFromClient(word);
  if (!text || !target) return escapeHtml(text);
  const pattern = new RegExp(`(^|[^\\p{L}])(${escapeRegExp(target)})(?=$|[^\\p{L}])`, "iu");
  const match = text.match(pattern);
  if (!match) return escapeHtml(text);
  const start = Number(match.index || 0) + match[1].length;
  const end = start + match[2].length;
  return `${escapeHtml(text.slice(0, start))}<mark>_____</mark>${escapeHtml(text.slice(end))}`;
}

function sourceWritingPracticePromptHtml(entries = sourceWritingPracticeEntries()) {
  const entry = sourceWritingPracticePromptEntry(entries);
  if (!entry) return "";
  const mode = sourceWritingPracticeMode();
  const definition = sourceWritingPracticeDefinitionForEntry(entry);
  if (mode === "definition" && definition) {
    return `
      <div class="source-writing-practice-prompt">
        <span>Definition</span>
        <p>${escapeHtml(definition)}</p>
      </div>
    `;
  }
  const example = sourceWritingPracticeExampleForEntry(entry);
  if (example) {
    return `
      <div class="source-writing-practice-prompt">
        <span>Example</span>
        <p>${sourceWritingPracticeMaskedExampleHtml(example, entry.word)}</p>
      </div>
    `;
  }
  return `
    <div class="source-writing-practice-prompt">
      <span>${mode === "definition" ? "Definition" : "Word"}</span>
      <p>${escapeHtml(definition || "Write one word from the current filters.")}</p>
    </div>
  `;
}

function sourceWritingPracticeDraftFeedbackHtml(entries = sourceWritingPracticeEntries()) {
  const practice = ensureSourceWritingPracticeState();
  const input = stringValueFromClient(practice.input);
  const tokens = testPageWordPracticeInputTokens(input);
  if (practice.lastFeedback?.status) {
    const status = practice.lastFeedback.status === "accepted" ? "correct" : "wrong";
    const label = status === "correct" ? "Correct" : "Not correct";
    const word = practice.lastFeedback.word || practice.lastFeedback.input;
    const example = practice.lastFeedback.example;
    return `
      <span class="${status}">${label}: ${escapeHtml(word)}</span>
      ${example ? `<span class="example">${escapeHtml(example)}</span>` : ""}
    `;
  }
  if (!tokens.length) return "";
  const entriesByKey = new Map(entries.map(entry => [entry.key, entry]));
  return tokens.map((token, index) => `
    <span class="${entriesByKey.has(token.key) ? "correct" : "wrong"}">${escapeHtml(token.word)}</span>
  `).join("");
}

function sourceWritingPracticePadHtml(entries = sourceWritingPracticeEntries()) {
  const practice = ensureSourceWritingPracticeState();
  const acceptedKeys = sourceWritingPracticeAcceptedKeys(entries);
  const phraseKeys = new Set();
  const phraseHtml = practice.acceptedPhrases.map(phrase => {
    phrase.keys.forEach(key => phraseKeys.add(key));
    return `<span class="test-page-word-practice-phrase">${escapeHtml(phrase.text)}</span>`;
  }).join("");
  const acceptedEntries = entries.filter(entry => acceptedKeys.has(entry.key) && !phraseKeys.has(entry.key));
  return `${phraseHtml}${acceptedEntries.map(entry => `<span>${escapeHtml(entry.word)}</span>`).join("")}`;
}

function sourceWritingPracticeModeTabsHtml() {
  const mode = sourceWritingPracticeMode();
  return `
    <div class="source-writing-practice-tabs" role="tablist" aria-label="Writing practice prompt type">
      <button type="button" role="tab" aria-selected="${mode === "example" ? "true" : "false"}" class="${mode === "example" ? "active" : ""}" data-source-writing-practice-mode="example" onclick="window.sourceWritingPracticeMode?.('example')">
        Example
      </button>
      <button type="button" role="tab" aria-selected="${mode === "definition" ? "true" : "false"}" class="${mode === "definition" ? "active" : ""}" data-source-writing-practice-mode="definition" onclick="window.sourceWritingPracticeMode?.('definition')">
        Definition
      </button>
    </div>
  `;
}

function sourceWritingPracticeHtml(entries = sourceWritingPracticeEntries()) {
  const practice = ensureSourceWritingPracticeState();
  const total = entries.length;
  const acceptedKeys = sourceWritingPracticeAcceptedKeys(entries);
  const accepted = acceptedKeys.size;
  const referenceCount = entries.filter(entry => entry.references.length).length;
  const defaultMessage = total
    ? accepted === total
      ? "All accepted"
      : `${total} words from current filters${referenceCount ? `, ${referenceCount} with examples` : ""}`
    : "No words match the current filters";
  return `
    <div class="${classNames("test-page-word-practice", "source-writing-practice", practice.status ? `is-${practice.status}` : "")}">
      <div class="test-page-word-practice-head">
        <strong>${icon("pen-line")}Writing practice</strong>
        <span data-source-writing-practice-meter>${accepted}/${total}</span>
      </div>
      <div class="test-page-word-practice-status" data-source-writing-practice-status>
        ${escapeHtml(practice.message || defaultMessage)}
      </div>
      ${sourceWritingPracticeModeTabsHtml()}
      <div data-source-writing-practice-prompt>
        ${sourceWritingPracticePromptHtml(entries)}
      </div>
      <div class="test-page-word-practice-pad" data-source-writing-practice-pad>
        <textarea
          class="test-page-word-practice-input"
          rows="4"
          placeholder="Write the word, or write a sentence using saved words"
          aria-label="Source writing practice answer"
          data-source-writing-practice-input
          oninput="window.sourceWritingPracticeInput?.(this.value)"
          onkeydown="window.sourceWritingPracticeKeydown?.(event, this)"
          ${total ? "" : "disabled"}
        >${escapeHtml(practice.input)}</textarea>
        <div class="test-page-word-practice-preview" data-source-writing-practice-preview>
          ${sourceWritingPracticeDraftFeedbackHtml(entries)}
        </div>
      </div>
    </div>
  `;
}

function renderSourceWritingPracticePanel() {
  const practice = ensureSourceWritingPracticeState();
  const words = getFilteredWords();
  const entries = sourceWritingPracticeEntries(words);
  practice.entries = entries;
  practice.label = filteredWritingPracticeLabel(words.length);
  return `
    <section class="source-writing-practice-shell">
      <header class="source-writing-practice-toolbar">
        <div>
          <strong>Writing practice</strong>
          <span>${escapeHtml(practice.label)}</span>
        </div>
        <div class="row-actions">
          <button class="ghost-button" type="button" data-reset-source-writing-practice onclick="window.sourceWritingPracticeReset?.()">
            ${icon("rotate-ccw")}
            <span>Reset</span>
          </button>
        </div>
      </header>
      ${sourceWritingPracticeHtml(entries)}
    </section>
  `;
}

function renderSourceWritingPracticeFeedback() {
  const entries = sourceWritingPracticeEntries();
  const practice = ensureSourceWritingPracticeState();
  const total = entries.length;
  const acceptedKeys = sourceWritingPracticeAcceptedKeys(entries);
  const accepted = acceptedKeys.size;
  const referenceCount = entries.filter(entry => entry.references.length).length;
  const latestAcceptedPhrase = practice.acceptedPhrases[practice.acceptedPhrases.length - 1]?.text ||
    entries.find(entry => acceptedKeys.has(entry.key))?.word ||
    "";
  const defaultMessage = total
    ? accepted === total
      ? "All accepted"
      : `${total} words from current filters${referenceCount ? `, ${referenceCount} with examples` : ""}`
    : "No words match the current filters";
  const visibleMessage = practice.message || (latestAcceptedPhrase ? `Correct: ${latestAcceptedPhrase}` : defaultMessage);
  document.querySelectorAll("[data-source-writing-practice-meter]").forEach(meter => {
    meter.textContent = `${accepted}/${total}`;
  });
  document.querySelectorAll("[data-source-writing-practice-status]").forEach(status => {
    status.textContent = visibleMessage;
  });
  document.querySelectorAll("[data-source-writing-practice-accepted]").forEach(list => {
    list.innerHTML = sourceWritingPracticePadHtml(entries);
  });
  document.querySelectorAll("[data-source-writing-practice-prompt]").forEach(prompt => {
    prompt.innerHTML = sourceWritingPracticePromptHtml(entries);
  });
  document.querySelectorAll("[data-source-writing-practice-preview]").forEach(preview => {
    preview.innerHTML = sourceWritingPracticeDraftFeedbackHtml(entries) ||
      (latestAcceptedPhrase ? `<span class="correct">Correct: ${escapeHtml(latestAcceptedPhrase)}</span>` : "");
  });
  document.querySelectorAll(".source-writing-practice").forEach(panel => {
    panel.classList.toggle("is-accepted", practice.status === "accepted");
    panel.classList.toggle("is-pending", practice.status === "pending");
    panel.classList.toggle("is-rejected", practice.status === "rejected");
  });
}

function setSourceWritingPracticeVisibleResult(status, message, previewHtml = "") {
  document.querySelectorAll("[data-source-writing-practice-status]").forEach(statusElement => {
    statusElement.textContent = message || "";
  });
  document.querySelectorAll("[data-source-writing-practice-preview]").forEach(preview => {
    preview.innerHTML = previewHtml || "";
  });
  document.querySelectorAll(".source-writing-practice").forEach(panel => {
    panel.classList.toggle("is-accepted", status === "accepted");
    panel.classList.toggle("is-pending", status === "pending");
    panel.classList.toggle("is-rejected", status === "rejected");
  });
}

function setSourceWritingPracticeMode(mode) {
  const practice = ensureSourceWritingPracticeState();
  const nextMode = mode === "definition" ? "definition" : "example";
  if (practice.mode === nextMode) return;
  practice.mode = nextMode;
  practice.input = "";
  practice.acceptedKeys = new Set();
  practice.acceptedPhrases = [];
  practice.status = "";
  practice.message = "";
  practice.lastFeedback = null;
  renderSources();
  renderWords();
  refreshIcons();
  requestAnimationFrame(() => {
    sourceWritingPracticeInputElement()?.focus?.();
  });
}

function updateSourceWritingPracticeDraft(value) {
  const practice = ensureSourceWritingPracticeState();
  const rawValue = String(value || "");
  const inputKey = normalizedTestPageWordPracticeKey(rawValue);
  const entries = sourceWritingPracticeEntries();
  const matches = sourceWritingPracticeMatchesFromInput(rawValue, entries);
  const newMatches = matches.filter(match => !practice.acceptedKeys.has(match.key));

  practice.input = rawValue;
  practice.lastFeedback = null;
  if (!inputKey) {
    practice.status = "";
    practice.message = "";
  } else if (matches.length) {
    matches.forEach(match => practice.acceptedKeys.add(match.key));
    practice.status = "accepted";
    practice.message = newMatches.length
      ? newMatches.length === 1
        ? `Correct: ${newMatches[0].word}`
        : `Correct: ${newMatches.map(match => match.word).join(", ")}`
      : "Correct";
  } else {
    practice.status = "rejected";
    practice.message = testPageWordPracticeInputWordKeys(rawValue).length > 1
      ? "No saved words found"
      : "Not in current words";
  }
  renderSourceWritingPracticeFeedback();
  if (newMatches.length) {
    renderWords();
    refreshIcons();
  }
  if (practice.status === "accepted") {
    setSourceWritingPracticeVisibleResult(
      "accepted",
      practice.message,
      sourceWritingPracticeDraftFeedbackHtml(entries)
    );
  }
  if (practice.status === "rejected") {
    setSourceWritingPracticeVisibleResult(
      "rejected",
      practice.message,
      `<span class="wrong">${escapeHtml(practice.message)}</span>`
    );
  }
}

function submitSourceWritingPractice(value = null) {
  const practice = ensureSourceWritingPracticeState();
  const entries = sourceWritingPracticeEntries();
  const submittedInput = value === null ? practice.input : String(value || "");
  const matches = sourceWritingPracticeMatchesFromInput(submittedInput, entries);
  const newMatches = matches.filter(match => !practice.acceptedKeys.has(match.key));
  const feedbackInput = stringValueFromClient(submittedInput);
  let visibleResult = null;

  if (!normalizedTestPageWordPracticeKey(submittedInput)) {
    practice.status = "";
    practice.message = "";
    practice.lastFeedback = null;
  } else if (matches.length) {
    const phraseText = testPageWordPracticeDisplayPhrase(submittedInput, matches);
    const phraseKeys = matches.map(match => match.key);
    matches.forEach(match => practice.acceptedKeys.add(match.key));
    practice.acceptedPhrases = [
      ...practice.acceptedPhrases.filter(phrase => phrase.text !== phraseText),
      { text: phraseText, keys: phraseKeys }
    ];
    practice.input = "";
    document.querySelectorAll("[data-source-writing-practice-input]").forEach(input => {
      input.value = "";
    });
    practice.status = "accepted";
    practice.lastFeedback = {
      status: "accepted",
      word: newMatches[0]?.word || matches[0]?.word || phraseText,
      input: feedbackInput,
      example: sourceWritingPracticeExampleForEntry(newMatches[0] || matches[0] || null)
    };
    practice.message = practice.acceptedKeys.size === entries.length
      ? "All accepted"
      : newMatches.length === 1
        ? `Correct: ${newMatches[0].word}`
        : `Accepted ${newMatches.length || matches.length} words`;
    const feedbackWord = practice.lastFeedback.word || feedbackInput;
    const feedbackExample = practice.lastFeedback.example || "";
    visibleResult = {
      status: "accepted",
      message: practice.message,
      previewHtml: `<span class="correct">Correct: ${escapeHtml(feedbackWord)}</span>${feedbackExample ? `<span class="example">${escapeHtml(feedbackExample)}</span>` : ""}`
    };
  } else {
    practice.status = "rejected";
    practice.lastFeedback = {
      status: "rejected",
      word: "",
      input: feedbackInput,
      example: ""
    };
    practice.message = testPageWordPracticeInputWordKeys(submittedInput).length > 1
      ? "Sentence does not match the word examples"
      : "Not in current words";
    visibleResult = {
      status: "rejected",
      message: practice.message,
      previewHtml: `<span class="wrong">${escapeHtml(practice.message)}</span>`
    };
  }

  renderSourceWritingPracticeFeedback();
  if (visibleResult) {
    setSourceWritingPracticeVisibleResult(
      visibleResult.status,
      visibleResult.message,
      visibleResult.previewHtml
    );
  }
  refreshIcons();
}

function resetSourceWritingPractice() {
  const practice = ensureSourceWritingPracticeState();
  practice.input = "";
  practice.acceptedKeys = new Set();
  practice.acceptedPhrases = [];
  practice.status = "";
  practice.message = "";
  practice.lastFeedback = null;
  renderSources();
  renderWords();
  refreshIcons();
  requestAnimationFrame(() => {
    els.sourceTree.querySelector("[data-source-writing-practice-input]")?.focus?.();
  });
}

function sourceWritingPracticeInputElement() {
  return document.querySelector("[data-source-writing-practice-input]");
}

function handleSourceWritingPracticeClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const resetButton = target.closest("[data-reset-source-writing-practice]");
  if (resetButton) {
    event.preventDefault();
    event.stopPropagation();
    event.sourceWritingPracticeHandled = true;
    resetSourceWritingPractice();
    return;
  }

  const modeButton = target.closest("[data-source-writing-practice-mode]");
  if (modeButton) {
    event.preventDefault();
    event.stopPropagation();
    event.sourceWritingPracticeHandled = true;
    setSourceWritingPracticeMode(modeButton.dataset.sourceWritingPracticeMode);
    return;
  }

  const sourceWritingPad = target.closest("[data-source-writing-practice-pad]");
  if (sourceWritingPad && !target.closest("textarea, input, select, a, button")) {
    event.preventDefault();
    event.stopPropagation();
    event.sourceWritingPracticeHandled = true;
    sourceWritingPracticeInputElement()?.focus?.();
  }
}

function handleSourceWritingPracticeInput(event) {
  const target = event.target instanceof Element ? event.target : null;
  const input = target?.closest("[data-source-writing-practice-input]");
  if (!input) return;
  event.sourceWritingPracticeHandled = true;
  updateSourceWritingPracticeDraft(input.value);
}

function handleSourceWritingPracticeKeydown(event) {
  const target = event.target instanceof Element ? event.target : null;
  const input = target?.closest("[data-source-writing-practice-input]");
  if (!input) return;
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    event.sourceWritingPracticeHandled = true;
    input.value = "";
    updateSourceWritingPracticeDraft("");
  }
}

function handleSourceWritingPracticePaste(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest("[data-source-writing-practice-input]")) return;
  const pad = target.closest("[data-source-writing-practice-pad]");
  if (!pad) return;
  const text = event.clipboardData?.getData("text/plain") || "";
  if (!text) return;
  const practice = ensureSourceWritingPracticeState();
  event.preventDefault();
  event.stopPropagation();
  event.sourceWritingPracticeHandled = true;
  updateSourceWritingPracticeDraft(`${practice.input}${text}`);
  const input = sourceWritingPracticeInputElement();
  if (input) input.value = state.sourceWritingPractice.input;
}

window.sourceWritingPracticeInput = value => updateSourceWritingPracticeDraft(value);
window.sourceWritingPracticeKeydown = (event, input) => {
  if (!event || !input) return;
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Escape") {
    event.preventDefault();
    input.value = "";
    updateSourceWritingPracticeDraft("");
  }
};
window.sourceWritingPracticeReset = () => resetSourceWritingPractice();
window.sourceWritingPracticeMode = mode => setSourceWritingPracticeMode(mode);

function nationalTestPageAnswers(page) {
  return [...(Array.isArray(page?.answers) ? page.answers : [])]
    .filter(answer => stringValueFromClient(answer?.answer))
    .sort(compareNationalTestPageAnswers);
}

function hasNationalTestAnswerPlacement(answer) {
  return Number.isFinite(Number(answer?.xPercent)) && Number.isFinite(Number(answer?.yPercent));
}

function normalizedNationalTestAnswerPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 1000) / 1000));
}

function testPageAnswerMarkerOverlayHtml(page) {
  const placedAnswers = nationalTestPageAnswers(page).filter(hasNationalTestAnswerPlacement);
  if (!placedAnswers.length) return "";
  return `
    <div class="test-page-comment-marker-layer" aria-label="Placed answer comments">
      ${placedAnswers.map(answer => {
        const x = normalizedNationalTestAnswerPercent(answer.xPercent) ?? 0;
        const y = normalizedNationalTestAnswerPercent(answer.yPercent) ?? 0;
        const label = nationalTestAnswerQuestionLabel(answer);
        return `
          <button
            class="test-page-comment-marker ${answer.id === state.editingTestPageAnswerId ? "active" : ""}"
            type="button"
            style="left:${x}%;top:${y}%;"
            title="${escapeHtml(`${label}: ${answer.answer}`)}"
            aria-label="${escapeHtml(`${label} answer comment`)}"
            data-test-page-answer-marker="${escapeHtml(answer.id)}"
          >
            ${icon("message-circle")}
            <span>${escapeHtml(label)}</span>
            <span class="test-page-comment-popover" role="tooltip">
              <strong>${escapeHtml(label)}</strong>
              <em>${escapeHtml(answer.answer)}</em>
            </span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function compareNationalTestPageAnswers(left, right) {
  return (
    nationalTestAnswerSortValue(left) - nationalTestAnswerSortValue(right) ||
    String(left?.question || "").localeCompare(String(right?.question || ""), undefined, { numeric: true }) ||
    String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""))
  );
}

function nationalTestAnswerSortValue(answer) {
  const match = String(answer?.question || "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function nationalTestAnswerQuestionLabel(answer) {
  const question = stringValueFromClient(answer?.question);
  if (!question) return "Comment";
  return /^\d+$/u.test(question) ? `Q${question}` : question;
}

function nextNationalTestAnswerQuestion(page) {
  const numericQuestions = nationalTestPageAnswers(page)
    .map(answer => Number(String(answer.question || "").match(/\d+/)?.[0] || 0))
    .filter(value => Number.isFinite(value) && value > 0);
  return String((numericQuestions.length ? Math.max(...numericQuestions) : 0) + 1);
}

function normalizedNationalTestPageTopic(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function nationalTestPageSearchResultsHtml(test) {
  const query = stringValueFromClient(state.activeNationalTestPageSearch);
  if (!query) {
    return "";
  }

  const matches = searchNationalTestPages(test, query);
  if (!matches.length) {
    return `<div class="empty-state">No pages matched "${escapeHtml(query)}"</div>`;
  }

  return `
    <div class="test-page-search-summary">${matches.length} matching ${matches.length === 1 ? "page" : "pages"}</div>
    <div class="test-page-search-match-list">
      ${matches.map(match => `
        <button class="test-page-search-match ${match.page.id === state.activeNationalTestPageId ? "active" : ""}" type="button" data-select-test-page="${match.page.id}">
          <strong>Page ${escapeHtml(String(nationalTestVisualPageLabel(test, match.page)))}</strong>
          <small>${highlightedQueryTextHtml(truncateText(match.snippet, 150), query)}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function searchNationalTestPages(test, query) {
  const normalizedQuery = normalizedPageSearchText(query);
  const queryTokens = pageSearchTokens(query);
  if (!normalizedQuery) return [];

  return nationalTestPages(test.id)
    .map(page => {
      const pageTextSegments = nationalTestPageTextSegments(page);
      const segments = [
        normalizedNationalTestPageTopic(page.topic),
        ...pageTextSegments,
        pageTextSegments.join(" ")
      ].filter(Boolean);
      const normalizedSegments = segments.map(segment => normalizedPageSearchText(segment));
      const firstMatchIndex = normalizedSegments.findIndex(segment => matchesNormalizedQuery(segment, normalizedQuery, queryTokens));
      if (firstMatchIndex === -1) return null;
      const snippet = wordSearchExcerpt(segments[firstMatchIndex], normalizedQuery);
      const score = normalizedSegments[firstMatchIndex].includes(normalizedQuery) ? 2 : 1;
      return { page, snippet, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || compareNationalTestPageDisplayOrder(a.page, b.page));
}

function matchesNormalizedQuery(normalizedText, normalizedQuery, queryTokens) {
  if (!normalizedText || !normalizedQuery) return false;
  if (normalizedText.includes(normalizedQuery)) return true;
  return queryTokens.length > 1 && queryTokens.every(token => normalizedText.includes(token));
}

function renderActiveNationalTestPageSearchUi() {
  const test = activeNationalTest();
  const page = activeNationalTestPage();
  if (!test || !page) return;
  const results = document.querySelector("#test-page-search-results");
  if (results) {
    const html = nationalTestPageSearchResultsHtml(test);
    results.innerHTML = html;
    results.classList.toggle("hidden", !html);
  }
  const visual = document.querySelector("#test-page-visual-content");
  if (visual) {
    const splitPage = activeNationalTestSplitPage(test, page);
    const translationSplit = state.testPageSplitView && state.testPageSplitMode === "translation" && hasNationalTestPageTranslation(page, "ar");
    visual.classList.toggle("split-view", Boolean(translationSplit || splitPage));
    visual.innerHTML = translationSplit
      ? testPageVisualTranslationSplitContentHtml(test, page)
      : splitPage
        ? testPageVisualSplitContentHtml(test, page, splitPage)
        : testPageVisualContentHtml(test, page);
    schedulePageLayoutStabilization();
    void renderActiveNationalTestPageVisualFallback(test, page);
  }
}

function testPageGroupingToolControlsHtml(test) {
  const hidden = state.testPageGroupingToolHidden;
  return `
    <div class="test-page-grouping-controls">
      <div>
        ${icon("list-ordered")}
        <span>Order / Group / Classify</span>
      </div>
      <button
        class="ghost-button test-page-grouping-visibility-button"
        type="button"
        aria-pressed="${hidden ? "true" : "false"}"
        title="${hidden ? "Show order/group/classify panel" : "Hide order/group/classify panel"}"
        data-toggle-test-page-grouping-tool="${escapeHtml(test.id)}"
      >
        ${icon(hidden ? "eye" : "eye-off")}
        <span>${hidden ? "Show panel" : "Hide panel"}</span>
      </button>
    </div>
  `;
}

function testPageGroupingToolHtml(test) {
  const selectedSection = normalizedNationalTestSectionKey(state.activeNationalTestSectionFilter);
  const defaultSection = NATIONAL_TEST_SECTIONS.some(section => section.key === selectedSection)
    ? selectedSection
    : NATIONAL_TEST_SECTIONS[0]?.key || "reading";
  const open = !state.testPageGroupingToolCollapsed;
  return `
    <details class="test-page-grouping-panel" data-test-page-grouping-panel ${open ? "open" : ""}>
      <summary class="test-page-grouping-summary">
        <span>${icon("list-ordered")}Order / Group / Classify</span>
        ${icon("chevron-down")}
      </summary>
      <div class="test-page-grouping-grid">
        <label class="test-page-grouping-field test-page-grouping-field--wide">
          <span>Pages</span>
          <input id="test-page-order-input" type="text" autocomplete="off" placeholder="2, 5, 12-1, 12-2" />
        </label>
        <label class="test-page-grouping-field">
          <span>Skill type</span>
          <select id="test-page-group-section-input">
            ${NATIONAL_TEST_SECTIONS.map(section => `
              <option value="${escapeHtml(section.key)}" ${section.key === defaultSection ? "selected" : ""}>${escapeHtml(section.name)}</option>
            `).join("")}
          </select>
        </label>
        <label class="test-page-grouping-field test-page-grouping-field--wide">
          <span>Topic</span>
          <input id="test-page-group-topic-input" type="text" autocomplete="off" placeholder="Knowledge and skills" />
        </label>
        <button class="primary-button test-page-grouping-submit" type="button" data-group-test-pages="${test.id}">
          ${icon("list-ordered")}
          <span>Order / Group / Classify</span>
        </button>
      </div>
    </details>
  `;
}

function groupedVisibleNationalTestPages(test) {
  const sectionFilter = normalizedNationalTestSectionKey(state.activeNationalTestSectionFilter) || "all";
  const pages = visibleNationalTestPages(test.id);
  const sectionKeys = sectionFilter === "all"
    ? [...NATIONAL_TEST_SECTIONS.map(section => section.key), "unclassified"]
    : [sectionFilter];

  return sectionKeys.map(sectionKey => {
    const sectionPages = pages.filter(page => (effectiveNationalTestPageSection(page) || "unclassified") === sectionKey);
    if (!sectionPages.length) return null;
    const topics = [];
    const topicsByKey = new Map();
    sectionPages.forEach(page => {
      const topicLabel = normalizedNationalTestPageTopic(page.topic) || UNGROUPED_NATIONAL_TEST_TOPIC;
      const topicKey = normalizePracticeAnswer(topicLabel) || `ungrouped-${sectionKey}`;
      let group = topicsByKey.get(topicKey);
      if (!group) {
        group = { key: topicKey, label: topicLabel, pages: [] };
        topicsByKey.set(topicKey, group);
        topics.push(group);
      }
      group.pages.push(page);
    });
    return {
      section: NATIONAL_TEST_SECTIONS.find(item => item.key === sectionKey) || { key: sectionKey, name: sectionKey === "unclassified" ? "Unclassified" : nationalTestSectionLabel(sectionKey), icon: "layers" },
      topics
    };
  }).filter(Boolean);
}

function nationalTestPageSectionGroupHtml(test, group) {
  const skillKey = nationalTestPageGroupCollapseKey("skill", test.id, group.section.key);
  const pageCount = group.topics.reduce((count, topic) => count + topic.pages.length, 0);
  const progress = nationalTestSectionProgress(test.id, group.section.key);
  const skillCollapsed = progress.locked || isNationalTestPageGroupCollapsed(skillKey);
  const pageCountText = `${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
  return `
    <section class="${classNames("test-page-skill-group", `test-page-skill-group--${group.section.key}`, skillCollapsed ? "collapsed" : "", progress.finished ? "finished" : "", progress.locked ? "locked" : "", progress.partial ? "partial" : "", progress.partiallyLocked ? "partially-locked" : "")}">
      <header class="test-page-skill-group-header">
        <button
          class="test-page-group-toggle test-page-skill-toggle"
          type="button"
          aria-expanded="${String(!skillCollapsed)}"
          ${progress.locked ? `disabled title="${escapeHtml(`Unlock ${group.section.name} to open it`)}` : `data-toggle-test-page-group="${escapeHtml(skillKey)}"`}
        >
          <span class="test-page-skill-chip">
            ${icon(group.section.icon)}
            <strong>${escapeHtml(group.section.name)}</strong>
          </span>
          <small>${escapeHtml(progress.totalPages ? `${progress.finishedPages}/${progress.totalPages} done${progress.locked ? " · locked" : progress.partiallyLocked ? ` · ${progress.lockedPages} locked` : ""}` : pageCountText)}</small>
          ${icon(progress.locked ? "lock" : skillCollapsed ? "chevron-right" : "chevron-down", "test-page-collapse-icon")}
        </button>
        <div class="test-page-skill-actions">
          <button
            class="${classNames("ghost-button", "test-page-skill-lock-button", progress.locked ? "locked" : "")}"
            type="button"
            aria-pressed="${String(progress.locked)}"
            title="${escapeHtml(progress.locked ? `Unlock ${group.section.name}` : `Lock ${group.section.name}`)}"
            data-toggle-test-skill-lock="${escapeHtml(test.id)}"
            data-test-skill-section="${escapeHtml(group.section.key)}"
            data-test-skill-locked="${progress.locked ? "true" : "false"}"
          >
            ${icon(progress.locked ? "lock" : "unlock")}
            <span>${progress.locked ? "Locked" : "Lock"}</span>
          </button>
          <button
            class="${classNames("ghost-button", "test-page-skill-finished-button", progress.finished ? "finished" : "")}"
            type="button"
            aria-pressed="${String(progress.finished)}"
            title="${escapeHtml(progress.finished ? `Reopen ${group.section.name}` : `Mark ${group.section.name} finished`)}"
            data-toggle-test-skill-finished="${escapeHtml(test.id)}"
            data-test-skill-section="${escapeHtml(group.section.key)}"
            data-test-skill-finished="${progress.finished ? "true" : "false"}"
          >
            ${icon(progress.finished ? "check-circle-2" : "circle")}
            <span>${progress.finished ? "Finished" : "Mark finished"}</span>
          </button>
        </div>
      </header>
      ${skillCollapsed ? "" : `
        <div class="test-page-topic-stack">
          ${joinHtml(group.topics, topic => nationalTestPageTopicGroupHtml(test, group.section.key, topic))}
        </div>
      `}
    </section>
  `;
}

function nationalTestPageTopicGroupHtml(test, sectionKey, topic) {
  const topicKey = nationalTestPageGroupCollapseKey("topic", test.id, sectionKey, topic.key);
  const topicCollapsed = isNationalTestPageGroupCollapsed(topicKey);
  const pageCountText = `${topic.pages.length} ${topic.pages.length === 1 ? "page" : "pages"}`;
  const listeningTopicKey = normalizedListeningTopicKey(topic.key);
  const showListeningFiles = sectionKey === "listening";
  const topicMediaMeta = showListeningFiles ? nationalTestListeningMediaMeta(test, { topicKey: listeningTopicKey, pages: topic.pages }) : "";
  const topicPanelOpen = showListeningFiles && state.activeNationalTestListeningTopicKey === listeningTopicKey;
  return `
    <section class="${classNames("test-page-topic-group", topicCollapsed ? "collapsed" : "")}">
      <header class="test-page-topic-header">
        <button
          class="test-page-group-toggle test-page-topic-toggle"
          type="button"
          aria-expanded="${String(!topicCollapsed)}"
          data-toggle-test-page-group="${escapeHtml(topicKey)}"
        >
          <strong>${escapeHtml(topic.label)}</strong>
          <small>${escapeHtml(pageCountText)}</small>
          ${icon(topicCollapsed ? "chevron-right" : "chevron-down", "test-page-collapse-icon")}
        </button>
        ${showListeningFiles ? `
          <button
            class="${classNames("ghost-button", "test-page-topic-media-button", topicMediaMeta ? "has-media" : "", topicPanelOpen ? "active" : "")}"
            type="button"
            title="${escapeHtml(topicMediaMeta || `Attach listening files to ${topic.label}`)}"
            data-open-test-topic-listening-media="${escapeHtml(listeningTopicKey)}"
            data-test-topic-label="${escapeHtml(topic.label)}"
          >
            ${icon(topicMediaMeta ? "volume-2" : "headphones")}
            <span>${topicMediaMeta ? "Files" : "Add files"}</span>
          </button>
        ` : ""}
      </header>
      ${!topicCollapsed && showListeningFiles ? nationalTestListeningAssignmentsHtml(test, { topicKey: listeningTopicKey, topicLabel: topic.label, pages: topic.pages }) : ""}
      ${topicPanelOpen ? nationalTestListeningMediaPanelHtml(test, { topicKey: listeningTopicKey, topicLabel: topic.label, pages: topic.pages, open: true }) : ""}
      ${topicCollapsed ? "" : `
        <div class="test-page-topic-pages">
          ${joinHtml(topic.pages, item => nationalTestPageListItemHtml(test, item))}
        </div>
      `}
    </section>
  `;
}

function nationalTestPageDuplicateKeys(test, page) {
  const keys = [];
  const visualLabel = stringValueFromClient(nationalTestVisualPageLabel(test, page)).toLocaleLowerCase();
  if (visualLabel) {
    keys.push(`label:${visualLabel}`);
  }

  const layout = displayLayoutForPage(page) || page?.pageLayout;
  const textKey = normalizedPageSearchText([
    page?.extractedText || "",
    ...layoutTextValues(layout?.elements || [])
  ].join(" "));
  if (textKey.length >= 80) {
    keys.push(`text:${textKey}`);
  }
  return keys;
}

function isDuplicateNationalTestPage(test, page) {
  if (!test || !page) return false;
  const pageKeys = new Set(nationalTestPageDuplicateKeys(test, page));
  if (!pageKeys.size) return false;
  return nationalTestPages(test.id).some(item =>
    item.id !== page.id &&
    nationalTestPageDuplicateKeys(test, item).some(key => pageKeys.has(key))
  );
}

function nationalTestPageListItemHtml(test, page) {
  const visualLabel = nationalTestVisualPageLabel(test, page);
  const pdfLabel = nationalTestPdfDisplayLabel(test, page);
  const active = page.id === state.activeNationalTestPageId;
  const lastWorked = isLastWorkedNationalTestPage(test.id, page.id);
  const duplicate = isDuplicateNationalTestPage(test, page);
  const locked = isNationalTestPageLocked(page);
  const markers = nationalTestPageListMarkersHtml(test, page, { duplicate });
  const deleteTitle = locked ? `Unlock page ${visualLabel} before deleting` : duplicate ? `Delete duplicate page ${visualLabel}` : `Delete page ${visualLabel}`;
  return `
    <div class="${classNames("test-page-list-item", duplicate ? "duplicate" : "", locked ? "locked" : "")}">
      <button class="${classNames("test-page-button", active ? "active" : "", lastWorked ? "last-worked" : "", isNationalTestPageFinished(page) ? "finished" : "", locked ? "locked" : "")}" type="button" ${locked ? `disabled title="${escapeHtml(`Unlock page ${visualLabel} before opening`)}` : `data-select-test-page="${escapeHtml(page.id)}"`}>
        <span class="test-page-button-main">
          <span>${escapeHtml(`Page ${visualLabel}`)}</span>
          ${markers ? `<span class="test-page-marker-list">${markers}</span>` : ""}
        </span>
        ${page.pagePart ? `<small>${escapeHtml(`PDF page ${pdfLabel}`)}</small>` : ""}
      </button>
      <button
        class="icon-button danger-button test-page-list-delete-button"
        type="button"
        title="${escapeHtml(deleteTitle)}"
        aria-label="${escapeHtml(deleteTitle)}"
        ${locked ? "disabled" : ""}
        data-delete-test-page="${escapeHtml(page.id)}"
      >
        ${icon("trash-2")}
      </button>
    </div>
  `;
}

function nationalTestPageListMarkersHtml(test, page, options = {}) {
  const lastWorked = isLastWorkedNationalTestPage(test?.id, page.id);
  const classified = Boolean(effectiveNationalTestPageSection(page) && normalizedNationalTestPageTopic(page.topic));
  const hasWords = Boolean((page.words || []).length);
  const hasAnswers = Boolean(nationalTestPageAnswers(page).length);
  const finished = isNationalTestPageFinished(page);
  const locked = isNationalTestPageLocked(page);
  const duplicate = options.duplicate ?? isDuplicateNationalTestPage(test, page);
  return [
    lastWorked ? `<span class="test-page-marker test-page-marker--last" title="Last worked page" aria-label="Last worked page"></span>` : "",
    duplicate ? `<span class="test-page-marker test-page-marker--duplicate" title="Duplicate page" aria-label="Duplicate page">${icon("copy")}</span>` : "",
    locked ? `<span class="test-page-marker test-page-marker--locked" title="Locked" aria-label="Locked">${icon("lock")}</span>` : "",
    finished ? `<span class="test-page-marker test-page-marker--finished" title="Finished" aria-label="Finished">${icon("check-circle-2")}</span>` : "",
    classified ? `<span class="test-page-marker test-page-marker--classified" title="Classified" aria-label="Classified">${icon("check")}</span>` : "",
    hasWords ? `<span class="test-page-marker test-page-marker--words" title="Has page words" aria-label="Has page words">${icon("tag")}</span>` : "",
    hasAnswers ? `<span class="test-page-marker test-page-marker--answers" title="Has saved answers" aria-label="Has saved answers">${icon("message-square")}</span>` : ""
  ].filter(Boolean).join("");
}

function nationalTestPdfDisplayLabel(test, page) {
  const labels = nationalTestPdfPreviewCache.get(test?.id)?.pageLabels;
  const label = Array.isArray(labels) ? labels[page.pageNumber - 1] : "";
  return String(label || page.pageNumber);
}

function nationalTestVisualPageLabel(test, page) {
  const pdfLabel = nationalTestPdfDisplayLabel(test, page);
  const pagePart = nationalTestPagePartValue(page);
  return pagePart ? `${pdfLabel}-${pagePart}` : String(pdfLabel);
}

function nationalTestPagePartValue(page) {
  const part = displayNumber(page?.pagePart);
  return Number.isInteger(part) && part > 0 ? part : 0;
}

function compareNationalTestPageDisplayOrder(left, right) {
  return (
    displayNumber(left?.sortOrder, left?.pageNumber) - displayNumber(right?.sortOrder, right?.pageNumber) ||
    displayNumber(left?.pageNumber) - displayNumber(right?.pageNumber) ||
    nationalTestPagePartValue(left) - nationalTestPagePartValue(right) ||
    normalizePracticeAnswer(left?.title).localeCompare(normalizePracticeAnswer(right?.title))
  );
}

async function ensureNationalTestPdfPreview(test) {
  if (!test?.id || !test.pdf?.url) return null;
  const cached = nationalTestPdfPreviewCache.get(test.id);
  if (cached?.promise) return cached.promise;
  if (cached?.status === "ready") return cached;

  const entry = cached || { status: "loading", pageLabels: [], thumbnails: new Map() };
  entry.promise = (async () => {
    const pdfjs = await loadPdfJsModule();
    const loadingTask = pdfjs.getDocument(test.pdf.url);
    const pdf = await loadingTask.promise;
    const pageLabels = await pdf.getPageLabels().catch(() => null);
    entry.status = "ready";
    entry.pdf = pdf;
    entry.pageLabels = Array.isArray(pageLabels) ? pageLabels : [];
    nationalTestPdfPreviewCache.set(test.id, entry);
    if (state.activeNationalTestId === test.id) {
      renderNationalTests();
      refreshIcons();
    }
    return entry;
  })().catch(error => {
    entry.status = "error";
    entry.error = error;
    console.error(error);
    return entry;
  });
  nationalTestPdfPreviewCache.set(test.id, entry);
  return entry.promise;
}

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("/vendor/pdfjs/build/pdf.mjs").then(module => {
      module.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/build/pdf.worker.mjs";
      return module;
    });
  }
  return pdfJsModulePromise;
}

function nationalTestPageLookupTokens(test, page) {
  const tokens = new Set([String(page.pageNumber)]);
  const pdfLabel = nationalTestPdfDisplayLabel(test, page);
  const visualLabel = nationalTestVisualPageLabel(test, page);
  if (pdfLabel) {
    tokens.add(String(pdfLabel).trim());
  }
  if (visualLabel) {
    tokens.add(String(visualLabel).trim());
  }
  return tokens;
}

function groupedNationalTestPageOrder(test, targetPages, sectionKey, topic) {
  const targetIds = targetPages.map(page => page.id);
  const targetIdSet = new Set(targetIds);
  const pageById = new Map(nationalTestPages(test.id).map(page => [page.id, page]));
  const buckets = new Map([...NATIONAL_TEST_SECTIONS.map(section => [section.key, []]), ["unclassified", []]]);

  nationalTestPages(test.id).forEach(page => {
    if (targetIdSet.has(page.id)) return;
    const bucketKey = effectiveNationalTestPageSection(page) || "unclassified";
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey).push(page.id);
  });

  const destinationBucket = buckets.get(sectionKey) || [];
  const destinationTopicKey = normalizePracticeAnswer(topic);
  let insertIndex = destinationBucket.length;
  if (destinationTopicKey) {
    destinationBucket.forEach((pageId, index) => {
      const page = pageById.get(pageId);
      if (normalizePracticeAnswer(page?.topic) === destinationTopicKey) {
        insertIndex = index + 1;
      }
    });
  }
  destinationBucket.splice(insertIndex, 0, ...targetIds);
  buckets.set(sectionKey, destinationBucket);

  return [
    ...NATIONAL_TEST_SECTIONS.flatMap(section => buckets.get(section.key) || []),
    ...(buckets.get("unclassified") || [])
  ];
}

function displayNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizedTestPageVisualZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(TEST_PAGE_VISUAL_ZOOM_MIN, Math.min(TEST_PAGE_VISUAL_ZOOM_MAX, zoom));
}

function normalizedTestPagePdfZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return 1;
  const ratio = zoom > 10 ? zoom / 100 : zoom;
  return Math.max(TEST_PAGE_PDF_ZOOM_MIN, Math.min(TEST_PAGE_PDF_ZOOM_MAX, ratio));
}

function normalizedTestPagePracticeWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return TEST_PAGE_PRACTICE_WIDTH_DEFAULT;
  const ratio = width > 1 ? width / 100 : width;
  return Math.max(TEST_PAGE_PRACTICE_WIDTH_MIN, Math.min(TEST_PAGE_PRACTICE_WIDTH_MAX, ratio));
}

function normalizedTestPageListWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return TEST_PAGE_LIST_WIDTH_DEFAULT;
  const ratio = width > 1 ? width / 100 : width;
  return Math.max(TEST_PAGE_LIST_WIDTH_MIN, Math.min(TEST_PAGE_LIST_WIDTH_MAX, ratio));
}

function testPageListWidthPercent() {
  return `${(normalizedTestPageListWidth(state.testPageListWidth) * 100).toFixed(2)}%`;
}

function testPageStageWidthStyleAttribute() {
  return `style="--test-page-list-width:${testPageListWidthPercent()}"`;
}

function setTestPageListCollapsed(collapsed) {
  state.testPageListCollapsed = Boolean(collapsed);
  localStorage.setItem(TEST_PAGE_LIST_COLLAPSE_STORAGE_KEY, state.testPageListCollapsed ? "true" : "false");
  rerenderNationalTestsPreservingViewport({ preserveStudyColumn: true });
}

function setTestPageListWidth(value) {
  const width = normalizedTestPageListWidth(value);
  state.testPageListWidth = width;
  localStorage.setItem(TEST_PAGE_LIST_WIDTH_STORAGE_KEY, width.toFixed(4));
  applyTestPageListWidth();
}

function applyTestPageListWidth() {
  const width = testPageListWidthPercent();
  document.querySelectorAll(".test-page-stage").forEach(stage => {
    stage.style.setProperty("--test-page-list-width", width);
  });
}

function testPagePracticeWidthPercent() {
  return `${(normalizedTestPagePracticeWidth(state.testPagePracticeWidth) * 100).toFixed(2)}%`;
}

function testPagePracticeWidthStyleAttribute() {
  return `style="--test-page-practice-width:${testPagePracticeWidthPercent()}"`;
}

function setTestPagePracticeWidth(value) {
  const width = normalizedTestPagePracticeWidth(value);
  state.testPagePracticeWidth = width;
  localStorage.setItem(TEST_PAGE_PRACTICE_WIDTH_STORAGE_KEY, width.toFixed(4));
  applyTestPagePracticeWidth();
}

function applyTestPagePracticeWidth() {
  const width = testPagePracticeWidthPercent();
  document.querySelectorAll(".test-page-grid.pdf-collapsed").forEach(grid => {
    grid.style.setProperty("--test-page-practice-width", width);
  });
}

function testPagePdfZoomPercent() {
  return `${Math.round(normalizedTestPagePdfZoom(state.testPagePdfZoom) * 100)}%`;
}

function setTestPagePdfZoom(value) {
  const zoom = normalizedTestPagePdfZoom(value);
  state.testPagePdfZoom = zoom;
  localStorage.setItem(TEST_PAGE_PDF_ZOOM_STORAGE_KEY, zoom.toFixed(2));
  applyTestPagePdfZoom();
}

function adjustTestPagePdfZoom(action) {
  const current = normalizedTestPagePdfZoom(state.testPagePdfZoom);
  const next = action === "in"
    ? current + TEST_PAGE_PDF_ZOOM_STEP
    : action === "out"
      ? current - TEST_PAGE_PDF_ZOOM_STEP
      : 1;
  setTestPagePdfZoom(next);
}

function applyTestPagePdfZoom() {
  const zoom = normalizedTestPagePdfZoom(state.testPagePdfZoom);
  document.querySelectorAll("[data-test-page-pdf-zoom-value]").forEach(element => {
    element.textContent = testPagePdfZoomPercent();
  });
  document.querySelectorAll("[data-test-page-pdf-zoom='out']").forEach(button => {
    button.disabled = zoom <= TEST_PAGE_PDF_ZOOM_MIN;
  });
  document.querySelectorAll("[data-test-page-pdf-zoom='in']").forEach(button => {
    button.disabled = zoom >= TEST_PAGE_PDF_ZOOM_MAX;
  });
  document.querySelectorAll("[data-test-page-pdf-zoom='reset']").forEach(button => {
    button.disabled = Math.abs(zoom - 1) < 0.001;
  });

  const test = activeNationalTest();
  const page = activeNationalTestPage();
  const frame = document.querySelector(".test-page-pdf-frame");
  if (test && page && frame) {
    frame.src = testPagePdfFrameSrc(test, page);
  }
}

function testPageVisualZoomPercent() {
  return `${Math.round(normalizedTestPageVisualZoom(state.testPageVisualZoom) * 100)}%`;
}

function testPageVisualZoomControlsHtml() {
  const zoom = normalizedTestPageVisualZoom(state.testPageVisualZoom);
  return `
    <div class="test-page-visual-zoom-controls" aria-label="Visual page zoom">
      <button class="icon-button" type="button" title="Zoom out visual page" aria-label="Zoom out visual page" data-test-page-visual-zoom="out" ${zoom <= TEST_PAGE_VISUAL_ZOOM_MIN ? "disabled" : ""}>${icon("minus")}</button>
      <span class="test-page-visual-zoom-value" data-test-page-visual-zoom-value>${escapeHtml(testPageVisualZoomPercent())}</span>
      <button class="icon-button" type="button" title="Zoom in visual page" aria-label="Zoom in visual page" data-test-page-visual-zoom="in" ${zoom >= TEST_PAGE_VISUAL_ZOOM_MAX ? "disabled" : ""}>${icon("plus")}</button>
      <button class="ghost-button test-page-visual-zoom-reset" type="button" data-test-page-visual-zoom="reset" ${Math.abs(zoom - 1) < 0.001 ? "disabled" : ""}>
        ${icon("rotate-ccw")}
        <span>Reset</span>
      </button>
    </div>
  `;
}

function setTestPageVisualZoom(value) {
  const zoom = normalizedTestPageVisualZoom(value);
  state.testPageVisualZoom = zoom;
  localStorage.setItem(TEST_PAGE_VISUAL_ZOOM_STORAGE_KEY, zoom.toFixed(2));
  applyTestPageVisualZoom();
}

function adjustTestPageVisualZoom(action) {
  const current = normalizedTestPageVisualZoom(state.testPageVisualZoom);
  const next = action === "in"
    ? current + TEST_PAGE_VISUAL_ZOOM_STEP
    : action === "out"
      ? current - TEST_PAGE_VISUAL_ZOOM_STEP
      : 1;
  setTestPageVisualZoom(next);
}

function applyTestPageVisualZoom() {
  const zoom = normalizedTestPageVisualZoom(state.testPageVisualZoom);
  document.querySelectorAll("#test-page-visual-content").forEach(container => {
    container.style.setProperty("--test-page-visual-zoom", zoom.toFixed(3));
  });
  document.querySelectorAll("[data-test-page-visual-zoom-value]").forEach(element => {
    element.textContent = testPageVisualZoomPercent();
  });
  document.querySelectorAll("[data-test-page-visual-zoom='out']").forEach(button => {
    button.disabled = zoom <= TEST_PAGE_VISUAL_ZOOM_MIN;
  });
  document.querySelectorAll("[data-test-page-visual-zoom='in']").forEach(button => {
    button.disabled = zoom >= TEST_PAGE_VISUAL_ZOOM_MAX;
  });
  document.querySelectorAll("[data-test-page-visual-zoom='reset']").forEach(button => {
    button.disabled = Math.abs(zoom - 1) < 0.001;
  });
  schedulePageLayoutStabilization();
}

function testPageVisualContentHtml(test, page, options = {}) {
  const query = stringValueFromClient(state.activeNationalTestPageSearch);
  const language = normalizeTranslationLanguage(options.language || activeTestPageTranslationLanguage(), "en");
  const studyDocumentValidation = validateStudyDocumentV1(page?.studyDocument);
  if (studyDocumentValidation?.valid) {
    const studyDocument = page.studyDocument;
    let semanticAnswers = officialStudyDocumentAnswers(studyDocument, page.questions);
    const arabicTranslation = page?.translations?.ar?.studyDocumentTranslation || null;
    if (language === "ar" && !arabicTranslation) {
      return `<div class="empty-state">Arabic semantic page is empty. Use Copy Arabic Prompt, then paste the translated JSON.</div>`;
    }
    if (language === "ar") {
      const translationValidation = validateStudyDocumentTranslationV1(arabicTranslation, studyDocument, semanticAnswers);
      if (!translationValidation.valid) {
        return `<div class="empty-state">The saved Arabic semantic page no longer matches this English page. Import its Arabic JSON again.</div>`;
      }
    }
    const displayDocument = language === "ar"
      ? applyStudyDocumentTranslation(studyDocument, arabicTranslation)
      : studyDocument;
    if (language === "ar") {
      semanticAnswers = applyOfficialAnswerTranslation(semanticAnswers, arabicTranslation);
    }
    const overlays = options.answerMarkers === false
      ? ""
      : shouldShowTestPageAnswerMarkers() ? testPageAnswerMarkerOverlayHtml(page) : "";
    return `
      <div class="test-page-visual-layout test-page-visual-layout--study-document">
        ${renderStudyDocumentV1ToHtml(displayDocument, {
          language,
          answers: semanticAnswers,
          showAnswers: state.testPageOfficialAnswersVisible,
          markerPageId: page.id,
          overlayHtml: overlays,
          editGraphics: true,
          resolveAsset: node => studyDocumentAssetUrl(page, node),
          renderText: (text, node) => visualPageInteractiveTextHtml(text, query, { language, element: node })
        })}
      </div>
    `;
  }

  const layout = displayLayoutForPage(page);
  const displayLayout = translatedPageLayoutForLanguage(page, layout, language);
  const renderLanguage = displayLayout !== layout ? language : "en";
  const answerLayout = shouldShowOfficialTestPageAnswers(page, renderLanguage)
    ? pageLayoutWithOfficialChoiceAnswers(page, displayLayout)
    : pageLayoutWithHiddenOfficialAnswers(page, displayLayout, renderLanguage);
  const hasActiveTranslation = language !== "en" && hasNationalTestPageTranslation(page, language);
  if (((shouldPreferPdfScanVisualFallback(page) && !hasActiveTranslation) || !layout) && test?.pdf?.url) {
    return testPageVisualPdfFallbackHtml(test, page);
  }
  if (layout) {
    const overlays = [
      shouldShowOfficialTestPageAnswers(page, renderLanguage) ? testPageOfficialAnswerOverlayHtml(page, answerLayout) : "",
      options.answerMarkers === false ? "" : shouldShowTestPageAnswerMarkers() ? testPageAnswerMarkerOverlayHtml(page) : ""
    ].filter(Boolean).join("");
    return `
      <div class="test-page-visual-layout">
        ${renderPageLayoutToHtml(answerLayout, {
          renderText: (text, element) => visualPageInteractiveTextHtml(text, query, { language: renderLanguage, element }),
          overlayHtml: overlays,
          markerPageId: page.id,
          language: renderLanguage
        })}
      </div>
    `;
  }
  return `
    <div class="empty-state">No visual layout saved</div>
  `;
}

function studyDocumentAssetUrl(page, node) {
  const assetId = stringValueFromClient(node?.assetId);
  if (!assetId) return "";
  const image = (Array.isArray(page?.sourceImages) ? page.sourceImages : [])
    .find(item => stringValueFromClient(item?.id) === assetId);
  return stringValueFromClient(image?.url);
}

function studyDocumentNodeById(document, nodeId) {
  const targetId = stringValueFromClient(nodeId);
  let match = null;
  const visit = nodes => {
    (Array.isArray(nodes) ? nodes : []).some(node => {
      if (!node || typeof node !== "object") return false;
      if (stringValueFromClient(node.id) === targetId) {
        match = node;
        return true;
      }
      if (visit(node.children)) return true;
      if ((Array.isArray(node.items) ? node.items : []).some(item => visit(item?.children))) return true;
      if ((Array.isArray(node.rows) ? node.rows : []).some(row => (
        (Array.isArray(row?.cells) ? row.cells : []).some(cell => visit(cell?.children))
      ))) return true;
      return false;
    });
    return Boolean(match);
  };
  visit(document?.content);
  return match;
}

function studyDocumentGraphicAsset(page, node) {
  const assetId = stringValueFromClient(node?.assetId);
  if (!assetId) return null;
  return (Array.isArray(page?.sourceImages) ? page.sourceImages : [])
    .find(item => stringValueFromClient(item?.id) === assetId) || null;
}

function closeStudyDocumentGraphicDialog() {
  const dialog = document.querySelector("[data-study-document-graphic-dialog]");
  if (!dialog) return;
  if (dialog.open) dialog.close();
  dialog.remove();
}

async function openStudyDocumentGraphicDialog(nodeId) {
  const test = activeNationalTest();
  const page = activeNationalTestPage();
  const node = studyDocumentNodeById(page?.studyDocument, nodeId);
  if (!test || !page || node?.type !== "graphic") {
    showToast("The selected graphic was not found", true);
    return;
  }
  if (!test.pdf?.url) {
    showToast("This test has no original PDF to crop", true);
    return;
  }
  closeStudyDocumentGraphicDialog();
  const asset = studyDocumentGraphicAsset(page, node);
  const dialog = document.createElement("dialog");
  dialog.className = "study-document-dialog study-document-graphic-dialog";
  dialog.dataset.studyDocumentGraphicDialog = node.id;
  dialog.dataset.studyDocumentPageId = page.id;
  dialog.innerHTML = `
    <div class="study-document-dialog-header">
      <div>
        <strong>${asset ? "Adjust graphic crop" : "Crop graphic from original page"}</strong>
        <span>${escapeHtml(`${node.role} | Page ${nationalTestVisualPageLabel(test, page)} | ${node.id}`)}</span>
      </div>
      <button class="icon-button" type="button" data-close-study-document-graphic-dialog aria-label="Close">${icon("x")}</button>
    </div>
    <div class="study-document-graphic-dialog-body">
      <div class="study-document-graphic-source-column">
        <p>Drag over the map, photo, or diagram on the original PDF page.</p>
        <div class="study-document-graphic-crop-stage" data-study-document-graphic-crop-stage>
          <canvas data-study-document-graphic-source-canvas></canvas>
          <div class="study-document-graphic-crop-selection hidden" data-study-document-graphic-crop-selection></div>
          <div class="study-document-graphic-crop-loading" data-study-document-graphic-crop-loading>Loading original PDF page...</div>
        </div>
      </div>
      <aside class="study-document-graphic-preview-column">
        <strong>Crop preview</strong>
        <div class="study-document-graphic-crop-preview-frame">
          <canvas data-study-document-graphic-crop-preview></canvas>
          <span data-study-document-graphic-crop-preview-empty>Select an area on the page</span>
        </div>
        <div class="study-document-validation" data-study-document-graphic-status></div>
      </aside>
    </div>
    <div class="study-document-dialog-actions">
      ${asset ? `<button class="ghost-button danger-button" type="button" data-remove-study-document-graphic>${icon("trash-2")}<span>Remove image</span></button>` : ""}
      <span class="study-document-dialog-action-spacer"></span>
      <button class="ghost-button" type="button" data-close-study-document-graphic-dialog>Cancel</button>
      <button class="primary-button" type="button" data-save-study-document-graphic disabled>${icon("crop")}<span>Save crop</span></button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeStudyDocumentGraphicDialog();
  });
  dialog.addEventListener("click", async event => {
    if (event.target.closest("[data-close-study-document-graphic-dialog]")) {
      closeStudyDocumentGraphicDialog();
      return;
    }
    const saveButton = event.target.closest("[data-save-study-document-graphic]");
    if (saveButton) {
      saveButton.disabled = true;
      try {
        await saveStudyDocumentGraphicCrop(dialog, page, node);
      } finally {
        if (saveButton.isConnected) saveButton.disabled = !dialog._studyDocumentGraphicCrop?.crop;
      }
      return;
    }
    const removeButton = event.target.closest("[data-remove-study-document-graphic]");
    if (removeButton) {
      if (!window.confirm("Remove this cropped image and return to the placeholder?")) return;
      removeButton.disabled = true;
      try {
        await removeStudyDocumentGraphic(page, node);
      } finally {
        if (removeButton.isConnected) removeButton.disabled = false;
      }
    }
  });
  dialog.showModal();
  refreshIcons();
  await initializeStudyDocumentGraphicCrop(dialog, test, page, node, asset);
}

async function initializeStudyDocumentGraphicCrop(dialog, test, page, node, asset) {
  const stage = dialog.querySelector("[data-study-document-graphic-crop-stage]");
  const canvas = dialog.querySelector("[data-study-document-graphic-source-canvas]");
  const loading = dialog.querySelector("[data-study-document-graphic-crop-loading]");
  const state = {
    crop: normalizedStudyDocumentGraphicCrop(asset?.crop),
    dragging: false,
    start: null,
    canvas
  };
  dialog._studyDocumentGraphicCrop = state;
  try {
    const preview = await ensureNationalTestPdfPreview(test);
    if (!preview?.pdf || preview.status !== "ready") throw new Error(preview?.error?.message || "The PDF could not be opened");
    const sourcePageIndex = Math.max(0, Number(page.studyDocument?.source?.sourcePageIndex) || 0);
    if (sourcePageIndex >= preview.pdf.numPages) throw new Error("The source PDF page is outside this document");
    const pdfPage = await preview.pdf.getPage(sourcePageIndex + 1);
    const naturalViewport = pdfPage.getViewport({ scale: 1 });
    const scale = Math.max(1.35, Math.min(2.6, 1600 / Math.max(1, naturalViewport.width)));
    const viewport = pdfPage.getViewport({ scale });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    stage.style.setProperty("--study-graphic-source-aspect", `${canvas.width} / ${canvas.height}`);
    await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    loading.remove();
    installStudyDocumentGraphicCropInteraction(dialog);
    updateStudyDocumentGraphicCropUi(dialog);
  } catch (error) {
    loading.textContent = error.message || "Could not render the original PDF page";
    loading.classList.add("error");
    renderStudyDocumentGraphicStatus(dialog, error.message || "Could not render the original PDF page", true);
  }
}

function installStudyDocumentGraphicCropInteraction(dialog) {
  const state = dialog._studyDocumentGraphicCrop;
  const stage = dialog.querySelector("[data-study-document-graphic-crop-stage]");
  if (!state || !stage) return;
  const pointFromEvent = event => {
    const rect = state.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    };
  };
  const updateDrag = event => {
    const point = pointFromEvent(event);
    state.crop = normalizedStudyDocumentGraphicCrop({
      x: Math.min(state.start.x, point.x),
      y: Math.min(state.start.y, point.y),
      width: Math.abs(point.x - state.start.x),
      height: Math.abs(point.y - state.start.y)
    });
    updateStudyDocumentGraphicCropUi(dialog);
  };
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !state.canvas.width) return;
    event.preventDefault();
    state.dragging = true;
    state.start = pointFromEvent(event);
    state.crop = null;
    stage.setPointerCapture?.(event.pointerId);
    updateStudyDocumentGraphicCropUi(dialog);
  });
  stage.addEventListener("pointermove", event => {
    if (!state.dragging) return;
    updateDrag(event);
  });
  const finish = event => {
    if (!state.dragging) return;
    updateDrag(event);
    state.dragging = false;
    state.start = null;
    stage.releasePointerCapture?.(event.pointerId);
    if (!state.crop || state.crop.width < 0.005 || state.crop.height < 0.005) {
      state.crop = null;
      renderStudyDocumentGraphicStatus(dialog, "Select a larger area on the source page.", true);
    } else {
      renderStudyDocumentGraphicStatus(dialog, "Crop selected. Review the preview, then save.");
    }
    updateStudyDocumentGraphicCropUi(dialog);
  };
  stage.addEventListener("pointerup", finish);
  stage.addEventListener("pointercancel", () => {
    state.dragging = false;
    state.start = null;
  });
}

function normalizedStudyDocumentGraphicCrop(crop) {
  if (!crop || typeof crop !== "object") return null;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) return null;
  return { x, y, width, height };
}

function updateStudyDocumentGraphicCropUi(dialog) {
  const state = dialog._studyDocumentGraphicCrop;
  if (!state) return;
  const selection = dialog.querySelector("[data-study-document-graphic-crop-selection]");
  const preview = dialog.querySelector("[data-study-document-graphic-crop-preview]");
  const empty = dialog.querySelector("[data-study-document-graphic-crop-preview-empty]");
  const saveButton = dialog.querySelector("[data-save-study-document-graphic]");
  const crop = state.crop;
  selection.classList.toggle("hidden", !crop);
  if (crop) {
    selection.style.left = `${crop.x * 100}%`;
    selection.style.top = `${crop.y * 100}%`;
    selection.style.width = `${crop.width * 100}%`;
    selection.style.height = `${crop.height * 100}%`;
  }
  if (saveButton) saveButton.disabled = !crop || !state.canvas.width;
  if (!crop || !state.canvas.width) {
    preview.width = 0;
    preview.height = 0;
    preview.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  const sourceWidth = Math.max(1, Math.round(crop.width * state.canvas.width));
  const sourceHeight = Math.max(1, Math.round(crop.height * state.canvas.height));
  const previewScale = Math.min(1, 420 / sourceWidth, 280 / sourceHeight);
  preview.width = Math.max(1, Math.round(sourceWidth * previewScale));
  preview.height = Math.max(1, Math.round(sourceHeight * previewScale));
  preview.getContext("2d").drawImage(
    state.canvas,
    Math.round(crop.x * state.canvas.width),
    Math.round(crop.y * state.canvas.height),
    sourceWidth,
    sourceHeight,
    0,
    0,
    preview.width,
    preview.height
  );
  preview.classList.remove("hidden");
  empty.classList.add("hidden");
}

function renderStudyDocumentGraphicStatus(dialog, message, isError = false) {
  const target = dialog.querySelector("[data-study-document-graphic-status]");
  if (!target) return;
  target.innerHTML = message
    ? `<div class="study-document-validation-message ${isError ? "invalid" : "valid"}">${icon(isError ? "alert-circle" : "check-circle")}<span>${escapeHtml(message)}</span></div>`
    : "";
  refreshIcons();
}

async function saveStudyDocumentGraphicCrop(dialog, page, node) {
  const state = dialog._studyDocumentGraphicCrop;
  const crop = state?.crop;
  if (!crop || !state.canvas.width) {
    renderStudyDocumentGraphicStatus(dialog, "Select an image area first.", true);
    return;
  }
  const sourceX = Math.round(crop.x * state.canvas.width);
  const sourceY = Math.round(crop.y * state.canvas.height);
  const sourceWidth = Math.max(1, Math.round(crop.width * state.canvas.width));
  const sourceHeight = Math.max(1, Math.round(crop.height * state.canvas.height));
  const output = document.createElement("canvas");
  output.width = sourceWidth;
  output.height = sourceHeight;
  output.getContext("2d").drawImage(state.canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  const blob = await new Promise(resolve => output.toBlob(resolve, "image/jpeg", 0.94));
  if (!blob) {
    renderStudyDocumentGraphicStatus(dialog, "The cropped image could not be created.", true);
    return;
  }
  const form = new FormData();
  form.append("image", blob, `${node.id}.jpg`);
  form.append("crop", JSON.stringify(crop));
  form.append("pixelWidth", String(sourceWidth));
  form.append("pixelHeight", String(sourceHeight));
  renderStudyDocumentGraphicStatus(dialog, "Saving the cropped image...");
  try {
    const saved = await api(`/api/national-test-pages/${encodeURIComponent(page.id)}/study-document-graphics/${encodeURIComponent(node.id)}`, {
      method: "POST",
      body: form
    });
    replaceNationalTestPage(saved);
    closeStudyDocumentGraphicDialog();
    renderNationalTests();
    refreshIcons();
    showToast("Graphic crop saved");
  } catch (error) {
    renderStudyDocumentGraphicStatus(dialog, error.message || "The graphic crop could not be saved.", true);
  }
}

async function removeStudyDocumentGraphic(page, node) {
  try {
    const saved = await api(`/api/national-test-pages/${encodeURIComponent(page.id)}/study-document-graphics/${encodeURIComponent(node.id)}`, {
      method: "DELETE"
    });
    replaceNationalTestPage(saved);
    closeStudyDocumentGraphicDialog();
    renderNationalTests();
    refreshIcons();
    showToast("Graphic image removed");
  } catch (error) {
    const dialog = document.querySelector("[data-study-document-graphic-dialog]");
    if (dialog) renderStudyDocumentGraphicStatus(dialog, error.message || "The graphic image could not be removed.", true);
  }
}

function shouldShowOfficialTestPageAnswers(page, renderLanguage = activeTestPageTranslationLanguage()) {
  return state.testPageOfficialAnswersVisible && renderLanguage === "en" && officialNationalTestPageAnswerDisplayCount(page) > 0;
}

function officialQuestionAnswerTargetId(question, layout = null) {
  const value = stringValueFromClient(question?.answer?.value).toUpperCase();
  return stringValueFromClient(
    question?.answer?.targetElementId ||
    question?.optionElementIds?.[value] ||
    inferOfficialQuestionAnswerTargetId(question, layout) ||
    question?.promptElementId
  );
}

function pageLayoutWithOfficialChoiceAnswers(page, layout) {
  if (!layout?.elements?.length) return layout;
  const choiceTargetIds = new Set(officialNationalTestPageQuestions(page)
    .filter(question => isOfficialMultipleChoiceAnswer(question, layout))
    .map(question => officialQuestionAnswerTargetId(question, layout))
    .filter(Boolean));
  if (!choiceTargetIds.size) return layout;

  const apply = elements => (Array.isArray(elements) ? elements : []).map(element => {
    if (!element || typeof element !== "object") return element;
    const next = { ...element, style: element.style ? { ...element.style } : element.style };
    if (choiceTargetIds.has(element.id) && element.type === "text") {
      next.style = { ...(next.style || {}), color: "#1565c0", fontWeight: "bold" };
    }
    if (element.type === "group" && Array.isArray(element.elements)) {
      next.elements = apply(element.elements);
    }
    return next;
  });

  return { ...layout, elements: apply(layout.elements) };
}

function isOfficialMultipleChoiceAnswer(question, layout = null) {
  if (question?.type === "multiple-choice") return true;
  const targetId = officialQuestionAnswerTargetId(question, layout);
  return Boolean(targetId && Object.values(question?.optionElementIds || {}).map(stringValueFromClient).includes(targetId));
}

function inferOfficialQuestionAnswerTargetId(question = {}, layout = null) {
  if (!layout?.elements?.length) return "";
  const entries = flattenedPositionedLayoutEntries(layout.elements || []);
  if (!entries.length) return "";
  const number = stringValueFromClient(question.number || question.questionNumber || question.label).replace(/^q(?:uestion)?\.?\s*/i, "").trim();
  const answerValue = stringValueFromClient(question?.answer?.value || question.correctAnswer || question.correctOption || question.solution).trim();
  const optionLetter = /^[a-d]$/i.test(answerValue) ? answerValue.toLowerCase() : "";
  const candidates = [];
  if (number && optionLetter) {
    candidates.push(
      `q${number}-option-${optionLetter}`,
      `q${number}_option_${optionLetter}`,
      `question-${number}-option-${optionLetter}`,
      `question_${number}_option_${optionLetter}`,
      `${number}-option-${optionLetter}`,
      `${number}_option_${optionLetter}`
    );
  }
  if (number) {
    candidates.push(
      `q${number}-answer`,
      `q${number}_answer`,
      `q${number}-answer-line`,
      `q${number}_answer_line`,
      `q${number}-gap`,
      `q${number}_gap`,
      `question-${number}-answer`,
      `question_${number}_answer`
    );
  }
  const byId = new Map(entries
    .map(entry => [normalizedElementIdForOfficialAnswerMatch(entry.element?.id), stringValueFromClient(entry.element?.id)])
    .filter(([id, value]) => id && value));
  for (const candidate of candidates) {
    const match = byId.get(normalizedElementIdForOfficialAnswerMatch(candidate));
    if (match) return match;
  }
  if (number && optionLetter) {
    const match = entries.find(entry => {
      const id = stringValueFromClient(entry.element?.id).toLowerCase();
      const text = stringValueFromClient(entry.element?.text);
      return (id.includes(`q${number}`) && id.includes("option") && id.endsWith(optionLetter)) ||
        (id.includes(`q${number}`) && new RegExp(`\\b${escapeRegExp(optionLetter)}\\s+`, "i").test(text));
    });
    if (match?.element?.id) return stringValueFromClient(match.element.id);
  }
  if (answerValue.length > 1) {
    const answerKey = answerValue.toLowerCase();
    const match = entries.find(entry => {
      const text = stringValueFromClient(entry.element?.text).toLowerCase();
      return text === answerKey || text.includes(answerKey);
    });
    if (match?.element?.id) return stringValueFromClient(match.element.id);
  }
  return "";
}

function normalizedElementIdForOfficialAnswerMatch(value) {
  return stringValueFromClient(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pageLayoutWithHiddenOfficialAnswers(page, layout, renderLanguage = activeTestPageTranslationLanguage()) {
  if (renderLanguage !== "en" || !layout?.elements?.length) return layout;
  const targetIds = new Set(officialNationalTestPageQuestions(page)
    .map(question => officialQuestionAnswerTargetId(question, layout))
    .filter(Boolean));
  const hasHiddenAnswerStyling = colorOnlyOfficialAnswerElementCount(layout) ||
    answerDecorationElementCount(layout) ||
    flattenedPositionedLayoutEntries(layout.elements).some(entry =>
      (targetIds.has(entry.element?.id) || isLikelyHighlightedAnswerControl(entry.element)) &&
      hasAnswerHighlightBackground(entry.element?.style)
    );
  if (!hasHiddenAnswerStyling) return layout;

  const apply = elements => (Array.isArray(elements) ? elements : []).map(element => {
    if (!element || typeof element !== "object") return element;
    const next = { ...element, style: element.style ? { ...element.style } : element.style };
    if (isColorOnlyOfficialAnswerElement(element)) {
      next.style = {
        ...(next.style || {}),
        color: "#222222",
        fontWeight: "normal"
      };
    }
    if (isAnswerDecorationElement(element)) {
      next.style = {
        ...(next.style || {}),
        backgroundColor: "transparent",
        fillColor: "transparent",
        strokeColor: "transparent",
        opacity: 0
      };
    } else if ((targetIds.has(element.id) || isLikelyHighlightedAnswerControl(element)) && hasAnswerHighlightBackground(element.style)) {
      next.style = {
        ...(next.style || {}),
        backgroundColor: "transparent",
        fillColor: "transparent"
      };
    }
    if (element.type === "group" && Array.isArray(element.elements)) {
      next.elements = apply(element.elements);
    }
    return next;
  });

  return { ...layout, elements: apply(layout.elements) };
}

function colorOnlyOfficialAnswerElementCount(layout) {
  return flattenedPositionedLayoutEntries(layout?.elements || [])
    .filter(entry => isColorOnlyOfficialAnswerElement(entry.element))
    .length;
}

function answerDecorationElementCount(layout) {
  return flattenedPositionedLayoutEntries(layout?.elements || [])
    .filter(entry => isAnswerDecorationElement(entry.element))
    .length;
}

function isAnswerDecorationElement(element) {
  if (!element || typeof element !== "object") return false;
  const id = stringValueFromClient(element.id).toLowerCase();
  const role = stringValueFromClient(element.role).toLowerCase();
  return /(?:^|[-_])(?:highlight[-_]*answer|answer[-_]*highlight|correct[-_]*answer|answer[-_]*correct|selected[-_]*answer|answer[-_]*selected)(?:[-_]|$)/u.test(id) ||
    /(?:answer[-_ ]*highlight|correct[-_ ]*answer|selected[-_ ]*answer)/u.test(role);
}

function isLikelyHighlightedAnswerControl(element) {
  const id = stringValueFromClient(element?.id).toLowerCase();
  return /(?:^|[-_])q\d+(?:[-_])(?:option|checkbox|choice)(?:[-_])[a-d](?:[-_]|$)/u.test(id);
}

function hasAnswerHighlightBackground(style = {}) {
  return [style?.backgroundColor, style?.fillColor]
    .map(normalizedCssColor)
    .some(color => [
      "#f6d94a",
      "#d6d13b",
      "#ffeb3b",
      "#fff176",
      "#fff59d",
      "#c8e6c9",
      "#a5d6a7",
      "#bbdefb",
      "#90caf9",
      "#4fc3f7",
      "#d9ecff",
      "#dbeafe",
      "#e3f2fd",
      "#e0f2fe",
      "#cfe8ff"
    ].includes(color));
}

function isColorOnlyOfficialAnswerElement(element) {
  if (!element || element.type !== "text" || !isOfficialAnswerDisplayColor(element.style?.color)) return false;
  const id = stringValueFromClient(element.id).toLowerCase();
  const role = stringValueFromClient(element.role).toLowerCase();
  const text = stringValueFromClient(element.text);
  if (/(^|[-_])(answer|correct|gap|blank|fill|option)([-_]|$)/u.test(id)) return true;
  if (/(answer|correct|gap|blank|fill|option)/u.test(role)) return true;
  return /^[A-D]\s+/u.test(text);
}

function isOfficialAnswerDisplayColor(value) {
  const color = normalizedCssColor(value);
  return [
    "#1565c0",
    "#4fc3f7",
    "#38bdf8",
    "#0ea5e9",
    "#0284c7",
    "#2563eb",
    "#1d4ed8",
    "#2196f3",
    "#03a9f4"
  ].includes(color) || color === "blue";
}

function normalizedCssColor(value) {
  const color = stringValueFromClient(value).trim().toLowerCase();
  if (!color) return "";
  if (/^#[0-9a-f]{3}$/iu.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toLowerCase();
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/iu);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map(part => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return color;
}

function testPageOfficialAnswerOverlayHtml(page, layout) {
  const entries = flattenedPositionedLayoutEntries(layout?.elements || []);
  const byId = new Map(entries.map(entry => [stringValueFromClient(entry.element?.id), entry]));
  const answers = officialNationalTestPageQuestions(page).map(question => {
    const answer = question.answer || {};
    const targetId = officialQuestionAnswerTargetId(question, layout);
    const target = byId.get(targetId);
    const placement = officialAnswerPlacement(answer, target, question.type);
    if (!placement) return "";
    const number = stringValueFromClient(question.number || question.id);
    if (isOfficialMultipleChoiceAnswer(question, layout)) {
      return `<span class="test-page-official-answer-choice" style="left:${placement.x}px;top:${placement.y}px;" aria-label="Question ${escapeHtml(number)} correct answer">&#10003;</span>`;
    }
    const kindClass = question.type === "fill-gap" ? "test-page-official-answer-text--gap" : "test-page-official-answer-text--short";
    return `
      <span
        class="test-page-official-answer-text ${kindClass}"
        data-official-answer-question="${escapeHtml(number)}"
        style="left:${placement.x}px;top:${placement.y}px;width:${placement.width}px;min-height:${placement.height}px;"
      >${escapeHtml(answer.value)}</span>
    `;
  }).filter(Boolean).join("");
  return answers ? `<div class="test-page-official-answer-layer" aria-label="Official answers">${answers}</div>` : "";
}

function officialAnswerPlacement(answer, target, type) {
  const explicit = answer?.placement;
  if (explicit && Number.isFinite(Number(explicit.x)) && Number.isFinite(Number(explicit.y))) {
    return {
      x: Number(explicit.x),
      y: Number(explicit.y),
      width: Math.max(40, Number(explicit.width) || (type === "short-answer" ? 520 : 160)),
      height: Math.max(22, Number(explicit.height) || (type === "short-answer" ? 54 : 26))
    };
  }
  if (!target) return null;
  const element = target.element || {};
  const width = Math.max(40, Number(element.width || 0) || (type === "short-answer" ? 520 : 160));
  if (type === "multiple-choice") {
    return {
      x: Math.max(2, target.absoluteX - 24),
      y: target.absoluteY + Math.max(0, (Number(element.height || 24) - 22) / 2),
      width: 22,
      height: 22
    };
  }
  const targetHeight = Number(element.height || 0);
  const isTextTarget = element.type === "text";
  const y = isTextTarget
    ? target.absoluteY + targetHeight + 4
    : target.absoluteY - (type === "short-answer" ? 42 : 24);
  return {
    x: target.absoluteX,
    y: Math.max(0, y),
    width,
    height: type === "short-answer" ? Math.max(48, targetHeight || 0) : 26
  };
}

function flattenedPositionedLayoutEntries(elements = [], parentX = 0, parentY = 0) {
  const output = [];
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    const absoluteX = parentX + Number(element.x || 0);
    const absoluteY = parentY + Number(element.y || 0);
    output.push({ element, absoluteX, absoluteY });
    if (element.type === "group") {
      output.push(...flattenedPositionedLayoutEntries(element.elements, absoluteX, absoluteY));
    }
  });
  return output;
}

function activeTestPageTranslationLanguage() {
  return state.testPageTranslationLanguage === "ar" ? "ar" : "en";
}

function shouldShowTestPageAnswerMarkers() {
  return activeTestPageTranslationLanguage() === "en";
}

function setTestPageTranslationLanguage(language) {
  const normalized = normalizeTranslationLanguage(language);
  state.testPageTranslationLanguage = normalized === "ar" ? "ar" : "en";
  localStorage.setItem(TEST_PAGE_TRANSLATION_LANGUAGE_STORAGE_KEY, state.testPageTranslationLanguage);
  rerenderNationalTestsPreservingViewport({ preserveStudyColumn: true });
}

function normalizeTranslationLanguage(value, fallback = "ar") {
  const language = stringValueFromClient(value).toLowerCase();
  if (language.startsWith("ar")) return "ar";
  if (language.startsWith("en")) return "en";
  return fallback;
}

function nationalTestPageTranslationItems(page, language = "ar") {
  const record = nationalTestPageTranslationRecord(page, language);
  const items = record?.studyDocumentTranslation?.items || record?.items || record?.translations || {};
  if (!items || typeof items !== "object" || Array.isArray(items)) return {};
  return Object.fromEntries(Object.entries(items)
    .map(([id, text]) => [stringValueFromClient(id), stringValueFromClient(text)])
    .filter(([id, text]) => id && text));
}

function nationalTestPageTranslationRecord(page, language = "ar") {
  const normalizedLanguage = normalizeTranslationLanguage(language);
  const record = page?.translations?.[normalizedLanguage];
  return record && typeof record === "object" && !Array.isArray(record) ? record : null;
}

function hasNationalTestPageTranslation(page, language = "ar") {
  return Object.keys(nationalTestPageTranslationItems(page, language)).length > 0;
}

function translatedPageLayoutForLanguage(page, layout, language) {
  const normalizedLanguage = normalizeTranslationLanguage(language, "en");
  if (normalizedLanguage === "en" || !layout) return layout;
  const record = nationalTestPageTranslationRecord(page, normalizedLanguage);
  const items = nationalTestPageTranslationItems(page, normalizedLanguage);
  const translatedLayout = record?.pageLayout;
  if (Object.keys(items).length) {
    const layoutItems = translationItemsForLayout(layout, items);
    const inlineGapIds = translationGapPlaceholderIdsFromItems(layoutItems);
    const hiddenElementIds = translationHiddenElementIdSetForLayout(layout, record, inlineGapIds);
    const expansionBounds = translationExpansionBoundsByAnchor(layout.elements, layoutItems, hiddenElementIds, inlineGapIds);
    return {
      ...layout,
      elements: translatePageLayoutElements(layout.elements, layoutItems, normalizedLanguage, inlineGapIds, hiddenElementIds, expansionBounds)
    };
  }
  if (translatedLayout?.elements?.length) {
    return normalizedLanguage === "ar"
      ? alignTranslatedParagraphLayout(layout, translatedLayout)
      : translatedLayout;
  }
  return layout;
}

const translatedParagraphLineCountCache = new Map();

function alignTranslatedParagraphLayout(sourceLayout, translatedLayout) {
  const sourceEntries = flattenedPositionedTextLayoutEntries(sourceLayout?.elements || [])
    .filter(entry => isParagraphLayoutTextElement(entry.element));
  const translatedEntries = flattenedPositionedTextLayoutEntries(translatedLayout?.elements || [])
    .filter(entry => isParagraphLayoutTextElement(entry.element));
  if (!translatedEntries.length) return translatedLayout;

  const sourceSize = pageLayoutPixelSize(sourceLayout);
  const translatedSize = pageLayoutPixelSize(translatedLayout);
  const matches = sourceEntries.length === translatedEntries.length
    ? matchedTranslatedParagraphEntries(sourceEntries, translatedEntries, sourceSize, translatedSize)
    : new Map();

  const alignElements = (elements = [], parentX = 0, parentY = 0) => (Array.isArray(elements) ? elements : []).map(element => {
    if (!element || typeof element !== "object") return element;
    const next = { ...element, style: element.style ? { ...element.style } : element.style };
    const match = matches.get(element);
    if (element.type === "text" && isParagraphLayoutTextElement(element)) {
      next.text = normalizedArabicParagraphText(next.text);
      next.lines = [next.text];
      next.fitMode = "shrink";
      if (match) {
        const desiredX = match.absoluteX * translatedSize.width / sourceSize.width;
        const desiredY = match.absoluteY * translatedSize.height / sourceSize.height;
        next.x = desiredX - parentX;
        next.y = desiredY - parentY;
        next.width = Math.max(1, Number(match.element.width || 0) * translatedSize.width / sourceSize.width);
        next.height = Math.max(1, Number(match.element.height || 0) * translatedSize.height / sourceSize.height);
        next.targetLineCount = measuredPageLayoutTextLineCount(match.element);
      }
    }
    if (element.type === "group" && Array.isArray(element.elements)) {
      const childParentX = parentX + Number(next.x || 0);
      const childParentY = parentY + Number(next.y || 0);
      next.elements = alignElements(element.elements, childParentX, childParentY);
    }
    return next;
  });

  return {
    ...translatedLayout,
    elements: alignElements(translatedLayout.elements)
  };
}

function flattenedPositionedTextLayoutEntries(elements = [], parentX = 0, parentY = 0) {
  const output = [];
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    const absoluteX = parentX + Number(element.x || 0);
    const absoluteY = parentY + Number(element.y || 0);
    if (element.type === "text") output.push({ element, absoluteX, absoluteY });
    if (element.type === "group") {
      output.push(...flattenedPositionedTextLayoutEntries(element.elements, absoluteX, absoluteY));
    }
  });
  return output;
}

function isParagraphLayoutTextElement(element) {
  const role = stringValueFromClient(element?.role).toLowerCase();
  if (["body", "lead", "quote", "quote-continuation"].includes(role)) return true;
  if (["question", "options", "title", "section-title", "instruction", "footer", "caption", "image-caption", "source", "footnote"].includes(role)) return false;
  const id = stringValueFromClient(element?.id).toLowerCase();
  if (!id || /(question|option|answer|title|instruction|footer|caption|source|footnote|copyright)/.test(id)) return false;
  return /(paragraph|(^|[-_])body|column|(^|[-_])lead|quote)/.test(id);
}

function pageLayoutPixelSize(layout) {
  return {
    width: Math.max(1, Number(layout?.pageSize?.width || layout?.width || 1)),
    height: Math.max(1, Number(layout?.pageSize?.height || layout?.height || 1))
  };
}

function matchedTranslatedParagraphEntries(sourceEntries, translatedEntries, sourceSize, translatedSize) {
  const matches = new Map();
  const available = new Set(sourceEntries);
  translatedEntries.forEach(translatedEntry => {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    available.forEach(sourceEntry => {
      const score = translatedParagraphMatchScore(sourceEntry, translatedEntry, sourceSize, translatedSize);
      if (score > bestScore) {
        best = sourceEntry;
        bestScore = score;
      }
    });
    if (!best) return;
    matches.set(translatedEntry.element, best);
    available.delete(best);
  });
  return matches;
}

function translatedParagraphMatchScore(sourceEntry, translatedEntry, sourceSize, translatedSize) {
  const source = sourceEntry.element;
  const translated = translatedEntry.element;
  const sourceId = stringValueFromClient(source.id).toLowerCase();
  const translatedId = stringValueFromClient(translated.id).toLowerCase();
  const sourceSide = layoutEntrySide(sourceEntry, sourceSize);
  const translatedSide = layoutEntrySide(translatedEntry, translatedSize);
  const sourceOrdinal = layoutElementOrdinal(sourceId);
  const translatedOrdinal = layoutElementOrdinal(translatedId);
  const sourceRole = stringValueFromClient(source.role).toLowerCase();
  const translatedRole = stringValueFromClient(translated.role).toLowerCase();
  const sourceX = sourceEntry.absoluteX / sourceSize.width;
  const sourceY = sourceEntry.absoluteY / sourceSize.height;
  const translatedX = translatedEntry.absoluteX / translatedSize.width;
  const translatedY = translatedEntry.absoluteY / translatedSize.height;

  let score = sourceId === translatedId ? 1000 : 0;
  if (sourceSide === translatedSide) score += 100;
  if (sourceOrdinal && translatedOrdinal && sourceOrdinal === translatedOrdinal) score += 80;
  if (sourceRole && translatedRole && sourceRole === translatedRole) score += 40;
  if (layoutElementKind(sourceId, sourceRole) === layoutElementKind(translatedId, translatedRole)) score += 30;
  score -= Math.abs(sourceX - translatedX) * 35;
  score -= Math.abs(sourceY - translatedY) * 90;
  return score;
}

function layoutEntrySide(entry, pageSize) {
  const declared = stringValueFromClient(entry.element?.column).toLowerCase();
  const id = stringValueFromClient(entry.element?.id).toLowerCase();
  if (declared === "left" || /(^|[-_])left($|[-_])/.test(id)) return "left";
  if (declared === "right" || /(^|[-_])right($|[-_])/.test(id)) return "right";
  const center = (entry.absoluteX + Number(entry.element?.width || 0) / 2) / pageSize.width;
  if (center < 0.45) return "left";
  if (center > 0.55) return "right";
  return "center";
}

function layoutElementOrdinal(id) {
  return id.match(/(?:^|[-_])(\d+)(?:$|[-_])/)?.[1] || "";
}

function layoutElementKind(id, role) {
  if (role) return role;
  if (id.includes("quote")) return "quote";
  if (id.includes("lead")) return "lead";
  return "body";
}

function normalizedArabicParagraphText(text) {
  return String(text || "").replace(/\s*\r?\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

function measuredPageLayoutTextLineCount(element) {
  const text = String(element?.text || "");
  if (!text) return 1;
  const style = element.style || {};
  const cacheKey = JSON.stringify([text, element.width, style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.lineHeight]);
  if (translatedParagraphLineCountCache.has(cacheKey)) return translatedParagraphLineCountCache.get(cacheKey);

  const probe = document.createElement("div");
  Object.assign(probe.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${Math.max(1, Number(element.width || 1))}px`,
    padding: "0",
    border: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "normal",
    wordBreak: "normal",
    hyphens: "manual",
    fontFamily: style.fontFamily || getComputedStyle(document.body).fontFamily,
    fontSize: `${Math.max(1, Number(style.fontSize || 16))}px`,
    fontWeight: style.fontWeight || "normal",
    fontStyle: style.fontStyle || "normal",
    lineHeight: String(style.lineHeight || 1.25)
  });
  probe.textContent = text;
  document.body.appendChild(probe);
  const count = renderedTextLineCount(probe);
  probe.remove();
  translatedParagraphLineCountCache.set(cacheKey, count);
  return count;
}

function translationItemsForLayout(layout, items = {}) {
  const mapped = { ...items };
  const textElements = flattenedTextLayoutElements(layout?.elements || []);
  const textElementIds = new Set(textElements.map(element => stringValueFromClient(element.id)).filter(Boolean));
  const consumedItemIds = new Set();
  const aliasCandidates = {
    intro: ["instruction"],
    instruction: ["intro"],
    "section-title": ["text-1-heading"],
    "text-1-heading": ["section-title"],
    "lead-right": ["left-column-lead"],
    "left-column-lead": ["lead-right"],
    "right-column-p1": ["body-left-1", "left-column-lead"],
    "right-column-p2": ["body-left-2", "left-column-p1"],
    "right-column-p3": ["body-left-3", "left-column-p2"],
    "left-column-p1": ["body-right-1", "right-column-lead-continuation"],
    "left-column-p2": ["quote-right", "body-right-2", "right-column-quote"],
    "left-column-p3": ["body-right-3"],
    "info-box-text": ["info-box", "note", "sidebar"],
    "body-left-1": ["right-column-p1", "right-column-lead-continuation"],
    "body-left-2": ["right-column-p2"],
    "body-left-3": ["right-column-p3"],
    "body-right-1": ["left-column-p1", "left-column-lead"],
    "body-right-2": ["left-column-p2"],
    "body-right-3": ["left-column-p3"],
    "quote-left": ["right-column-quote"],
    "quote-right": ["left-column-p2", "left-column-quote"],
    "right-column-quote": ["quote-left"],
    "left-column-quote": ["quote-right"]
  };
  Object.entries(aliasCandidates).forEach(([from, candidates]) => {
    const text = stringValueFromClient(items[from]);
    if (!text) return;
    const target = candidates.find(candidate => textElementIds.has(candidate) && !mapped[candidate]);
    if (!target) return;
    mapped[target] = text;
    consumedItemIds.add(from);
  });
  const untranslated = textElements.filter(element => !mapped[element.id]);
  const unusedTranslations = Object.entries(items)
    .filter(([id]) => !textElementIds.has(id) && !consumedItemIds.has(id));
  untranslated.forEach((element, index) => {
    const [, text] = unusedTranslations[index] || [];
    if (text && !mapped[element.id]) mapped[element.id] = text;
  });
  return mapped;
}

function flattenedTextLayoutElements(elements = []) {
  const output = [];
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    if (element.type === "text") output.push(element);
    if (element.type === "group") output.push(...flattenedTextLayoutElements(element.elements));
  });
  return output.sort((left, right) => Number(left.y || 0) - Number(right.y || 0) || Number(left.x || 0) - Number(right.x || 0));
}

function translationGapPlaceholderIdsFromItems(items = {}) {
  const ids = new Set();
  Object.values(items || {}).forEach(text => {
    for (const match of String(text || "").matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) {
      if (match[1]) ids.add(match[1]);
    }
  });
  return ids;
}

function translationHiddenElementIdSetForLayout(layout, record = null, inlineGapIds = new Set()) {
  const entries = flattenedPositionedLayoutEntries(layout?.elements || []);
  const elementsById = new Map(entries
    .map(entry => [stringValueFromClient(entry.element?.id), entry.element])
    .filter(([id]) => id));
  const importedIds = Array.isArray(record?.hiddenElementIds)
    ? record.hiddenElementIds.map(stringValueFromClient).filter(Boolean)
    : [];
  const ids = new Set(importedIds.filter(id => !isTranslationAnswerOptionElement(elementsById.get(id))));
  entries.forEach(entry => {
    const element = entry.element;
    const id = stringValueFromClient(element?.id);
    if (!id) return;
    if (isTranslationInlineGapNumberElement(element, inlineGapIds)) ids.add(id);
  });
  return ids;
}

function isTranslationInlineGapNumberElement(element, inlineGapIds = new Set()) {
  if (!element || element.type !== "text") return false;
  const id = stringValueFromClient(element.id);
  const normalizedId = id.toLowerCase();
  const role = stringValueFromClient(element.role).toLowerCase();
  if (/(^|[-_])(gap-number|gap-label|answer-number)([-_]|$)/u.test(normalizedId)) return true;
  if (/(^|[-_])q\d+[-_]gap[-_]number([-_]|$)/u.test(normalizedId)) return true;
  if (/(^|[-_])(gap-number|gap-label|answer-number)([-_]|$)/u.test(role)) return true;
  for (const gapId of inlineGapIds) {
    if (normalizedId === `${stringValueFromClient(gapId).toLowerCase()}-number`) return true;
  }
  return false;
}

function translationExpansionBoundsByAnchor(elements = [], items = {}, hiddenElementIds = new Set(), inlineGapIds = new Set()) {
  const allEntries = flattenedPositionedLayoutEntries(elements || []);
  const entries = allEntries
    .map((entry, index) => ({ ...entry, index }))
    .filter(entry => entry.element?.type === "text" || entry.element?.type === "line")
    .filter(entry => !isTranslationInlineGapNumberElement(entry.element, inlineGapIds))
    .sort((left, right) => translationTemplateFlowOrder(left, right));
  const translatedIndexes = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      entry.element?.type === "text" &&
      stringValueFromClient(items[entry.element.id]) &&
      !hiddenElementIds.has(stringValueFromClient(entry.element.id)) &&
      isTranslationParagraphExpansionAnchor(entry.element, items[entry.element.id])
    )
    .map(item => ({
      ...item,
      startIndex: translationExpansionStartIndex(entries, item.index)
    }));
  const bounds = new Map();

  translatedIndexes.forEach(({ entry, index }, translatedIndex) => {
    const anchorId = stringValueFromClient(entry.element?.id);
    const anchorFamily = translationFlowFamily(anchorId);
    const anchorGapIds = translationGapPlaceholderIdsFromItems({ [anchorId]: items[anchorId] });
    const startIndex = translatedIndexes[translatedIndex]?.startIndex ?? index;
    const nextTranslatedIndex = translatedIndexes[translatedIndex + 1]?.startIndex ?? entries.length;
    const related = entries.slice(startIndex, nextTranslatedIndex).filter(candidate => {
      const id = stringValueFromClient(candidate.element?.id);
      if (candidate === entry) return true;
      if (isTranslationAnswerOptionElement(candidate.element)) return false;
      if (candidate.element?.type === "line") return anchorGapIds.has(id);
      if (!hiddenElementIds.has(id)) return false;
      const candidateFamily = translationFlowFamily(id);
      return !anchorFamily || !candidateFamily || candidateFamily === anchorFamily;
    });
    if (related.length <= 1) return;
    const box = related.reduce((acc, candidate) => unionLayoutEntryBounds(acc, candidate), null);
    const constrainedBox = constrainTranslationExpansionBounds(box, entry, allEntries);
    if (constrainedBox && anchorId) bounds.set(anchorId, constrainedBox);
  });

  return bounds;
}

function translationFlowFamily(idValue) {
  const id = stringValueFromClient(idValue).toLowerCase();
  if (!id) return "";
  const patterns = [
    /^(p\d+)(?:[-_]|$)/u,
    /^(paragraph[-_]?\d+)(?:[-_]|$)/u,
    /^((?:left|right)[-_](?:column[-_])?(?:paragraph|body|quote|lead)[-_]?\d*)(?:[-_]|$)/u,
    /^((?:body|quote|lead)[-_](?:left|right)[-_]?\d*)(?:[-_]|$)/u
  ];
  for (const pattern of patterns) {
    const match = id.match(pattern);
    if (match?.[1]) return match[1].replace(/_/g, "-");
  }
  return "";
}

function translationExpansionStartIndex(entries = [], anchorIndex = 0) {
  if (!Array.isArray(entries) || anchorIndex <= 0) return anchorIndex;
  const previous = entries[anchorIndex - 1];
  const current = entries[anchorIndex];
  if (!previous || !current || previous.element?.type !== "line" || current.element?.type !== "text") return anchorIndex;
  if (!isTranslationTemplateGapLine(previous.element)) return anchorIndex;
  if (!translationTemplateSameVisualLine(previous, current)) return anchorIndex;
  const previousX = Number(previous.absoluteX || 0);
  const previousWidth = Math.max(0, Number(previous.element?.width || 0));
  const currentX = Number(current.absoluteX || 0);
  if (currentX < previousX) return anchorIndex;
  if (currentX - (previousX + previousWidth) > 42) return anchorIndex;
  return anchorIndex - 1;
}

function isTranslationParagraphExpansionAnchor(element, translatedText = "") {
  if (!element || element.type !== "text") return false;
  if (!String(translatedText || "").includes("{{")) return false;
  const id = stringValueFromClient(element.id).toLowerCase();
  const role = stringValueFromClient(element.role).toLowerCase();
  if (isTranslationAnswerOptionElement(element)) return false;
  if (/(^|[-_])(instruction|title|heading|caption|footer|source|footnote)([-_]|$)/u.test(role)) return false;
  return true;
}

function isTranslationAnswerOptionElement(element) {
  if (!element || element.type !== "text") return false;
  const id = stringValueFromClient(element.id).toLowerCase();
  const role = stringValueFromClient(element.role).toLowerCase();
  const optionPattern = /(^|[-_])(options?|choices?|checkbox(?:es)?)([-_]|$)/u;
  return optionPattern.test(id) || optionPattern.test(role) ||
    /(^|[-_])q\d+[-_](options?|choices?|checkbox(?:es)?)([-_]|$)/u.test(id);
}

function constrainTranslationExpansionBounds(bounds, anchorEntry, allEntries = []) {
  if (!bounds || !anchorEntry) return bounds;
  const anchorX = Number(anchorEntry.absoluteX || 0);
  const anchorY = Number(anchorEntry.absoluteY || 0);
  const anchorWidth = Math.max(1, Number(anchorEntry.element?.width || 1));
  const anchorHeight = Math.max(1, Number(anchorEntry.element?.height || 1));
  const anchorCenterX = anchorX + anchorWidth / 2;
  const anchorCenterY = anchorY + anchorHeight / 2;
  let left = bounds.x;
  let right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const gutter = 8;

  (Array.isArray(allEntries) ? allEntries : []).forEach(candidate => {
    const element = candidate.element;
    if (!element || !["box", "rectangle", "image"].includes(element.type)) return;
    const x = Number(candidate.absoluteX || 0);
    const y = Number(candidate.absoluteY || 0);
    const width = Math.max(0, Number(element.width || 0));
    const height = Math.max(0, Number(element.height || 0));
    if (width < 48 || height < 32) return;
    const candidateRight = x + width;
    const candidateBottom = y + height;
    const verticalOverlap = Math.min(bottom, candidateBottom) - Math.max(top, y);
    if (verticalOverlap < 8) return;
    const anchorInside = anchorCenterX >= x && anchorCenterX <= candidateRight &&
      anchorCenterY >= y && anchorCenterY <= candidateBottom;
    if (anchorInside) return;

    if (x > anchorCenterX && x < right) {
      right = Math.max(anchorX + 40, x - gutter);
    } else if (candidateRight < anchorCenterX && candidateRight > left) {
      left = Math.min(anchorX + anchorWidth - 40, candidateRight + gutter);
    }
  });

  return {
    ...bounds,
    x: left,
    width: Math.max(40, right - left)
  };
}

function unionLayoutEntryBounds(bounds, entry) {
  const x = Number(entry.absoluteX || 0);
  const y = Number(entry.absoluteY || 0);
  const width = Math.max(1, Number(entry.element?.width || 1));
  const height = Math.max(1, Number(entry.element?.height || 1));
  const next = {
    x1: x,
    y1: y,
    x2: x + width,
    y2: y + height
  };
  if (!bounds) {
    return {
      x: next.x1,
      y: next.y1,
      width: Math.max(1, next.x2 - next.x1),
      height: Math.max(1, next.y2 - next.y1)
    };
  }
  const x1 = Math.min(bounds.x, next.x1);
  const y1 = Math.min(bounds.y, next.y1);
  const x2 = Math.max(bounds.x + bounds.width, next.x2);
  const y2 = Math.max(bounds.y + bounds.height, next.y2);
  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1)
  };
}

function translatePageLayoutElements(
  elements = [],
  items = {},
  language = "ar",
  inlineGapIds = new Set(),
  hiddenElementIds = new Set(),
  expansionBounds = new Map(),
  parentX = 0,
  parentY = 0
) {
  return (Array.isArray(elements) ? elements : []).map(element => {
    if (!element || typeof element !== "object") return element;
    const translatedText = stringValueFromClient(items[element.id]);
    const next = {
      ...element,
      style: element.style ? { ...element.style } : element.style
    };
    const hiddenInArabic = language === "ar" && hiddenElementIds.has(stringValueFromClient(element.id));
    if (hiddenInArabic) {
      next.style = {
        ...(next.style || {}),
        opacity: 0
      };
      if (element.type === "text") {
        next.text = "";
        next.lines = [""];
      }
    }
    if (language === "ar" && element.type === "line" && inlineGapIds.has(stringValueFromClient(element.id))) {
      next.style = {
        ...(next.style || {}),
        opacity: 0,
        strokeColor: "transparent"
      };
    }
    if (element.type === "text" && translatedText && !hiddenInArabic) {
      next.text = language === "ar" ? normalizedArabicLayoutText(translatedText, element) : translatedText;
      next.lines = [next.text];
      if (language === "ar") {
        const bounds = expansionBounds.get(stringValueFromClient(element.id));
        const expanded = Boolean(bounds);
        if (bounds) {
          next.x = bounds.x - parentX;
          next.y = bounds.y - parentY;
          next.width = bounds.width;
          next.height = bounds.height;
        }
        next.fitMode = "shrink";
        if (expanded) {
          next.minFontSize = Math.min(Number(next.minFontSize || 11), 10);
        } else {
          next.minFontSize = Math.min(Number(next.minFontSize || 8), 6.5);
        }
        next.style = {
          ...(next.style || {}),
          direction: "rtl",
          textAlign: "right",
          fontFamily: next.style?.fontFamily || "Arial, Tahoma, 'Noto Naskh Arabic', 'Segoe UI', sans-serif",
          fontSize: expanded
            ? Math.max(12, Math.min(Number(next.style?.fontSize || 16), 16))
            : next.style?.fontSize,
          lineHeight: expanded ? 1.35 : Math.min(Number(next.style?.lineHeight || 1.16), 1.1),
          backgroundColor: expanded ? undefined : next.style?.backgroundColor,
          fillColor: expanded ? undefined : next.style?.fillColor
        };
      }
    }
    if (element.type === "group" && Array.isArray(element.elements)) {
      const childParentX = parentX + Number(next.x || 0);
      const childParentY = parentY + Number(next.y || 0);
      next.elements = translatePageLayoutElements(
        element.elements,
        items,
        language,
        inlineGapIds,
        hiddenElementIds,
        expansionBounds,
        childParentX,
        childParentY
      );
    }
    return next;
  });
}

function testPageVisualPdfFallbackHtml(test, page) {
  const pdfLabel = nationalTestPdfDisplayLabel(test, page);
  const visualLabel = nationalTestVisualPageLabel(test, page);
  const repairedFallback = shouldPreferPdfScanVisualFallback(page);
  return `
    <div class="test-page-visual-fallback">
      ${repairedFallback ? `<div class="test-page-visual-fallback-note">Showing the original PDF page because the imported visual layout is incomplete.</div>` : ""}
      <div
        class="test-page-visual-fallback-frame"
        data-active-test-pdf-fallback="${page.id}"
        aria-label="Page ${escapeHtml(visualLabel)} visual preview"
      >
        <div class="test-page-visual-fallback-status">Loading page ${escapeHtml(visualLabel)}...</div>
      </div>
    </div>
  `;
}

async function renderActiveNationalTestPageVisualFallback(test = activeNationalTest(), page = activeNationalTestPage()) {
  if (!test?.pdf?.url || !page?.pageNumber) return;
  const frame = document.querySelector(`[data-active-test-pdf-fallback="${cssEscape(page.id)}"]`);
  if (!frame) return;

  try {
    const entry = await ensureNationalTestPdfPreview(test);
    if (!frame.isConnected || !entry?.pdf) return;

    let dataUrl = entry.fullPages instanceof Map ? entry.fullPages.get(page.pageNumber) : "";
    if (!dataUrl) {
      const pdfPage = await entry.pdf.getPage(page.pageNumber);
      const viewport = pdfPage.getViewport({ scale: 1.25 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await pdfPage.render({ canvasContext: context, viewport }).promise;
      dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      if (!(entry.fullPages instanceof Map)) {
        entry.fullPages = new Map();
      }
      entry.fullPages.set(page.pageNumber, dataUrl);
    }

    if (!frame.isConnected) return;
    const visualLabel = nationalTestVisualPageLabel(test, page);
    frame.innerHTML = `
      <div class="test-page-visual-fallback-surface" data-test-page-marker-surface data-test-page-marker-page-id="${escapeHtml(page.id)}">
        <img src="${escapeHtml(dataUrl)}" alt="Page ${escapeHtml(visualLabel)}" loading="lazy" />
        ${shouldShowTestPageAnswerMarkers() ? testPageAnswerMarkerOverlayHtml(page) : ""}
      </div>
    `;
  } catch (error) {
    console.error(error);
    if (!frame.isConnected) return;
    const visualLabel = nationalTestVisualPageLabel(test, page);
    frame.innerHTML = `<div class="empty-state">Unable to render page ${escapeHtml(visualLabel)}</div>`;
  }
}

function highlightedQueryTextHtml(text, query) {
  const value = String(text || "");
  const needle = stringValueFromClient(query);
  if (!needle) {
    return escapeHtml(value);
  }

  const pattern = new RegExp(escapeRegExp(needle), "gi");
  let html = "";
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index || 0;
    html += escapeHtml(value.slice(lastIndex, index));
    html += `<mark class="page-layout-search-hit">${escapeHtml(match[0])}</mark>`;
    lastIndex = index + match[0].length;
  }
  html += escapeHtml(value.slice(lastIndex));
  return html;
}

function visualPageInteractiveTextHtml(text, query = "", options = {}) {
  const queryValue = stringValueFromClient(query);
  const language = normalizeTranslationLanguage(options.language, "en");
  if (language === "ar") {
    if (isTranslationAnswerOptionElement(options.element)) {
      return arabicAnswerOptionsHtml(text, queryValue);
    }
    const html = arabicTextWithInlineGapsHtml(text, queryValue);
    return `<span class="page-layout-translated-text" lang="ar" dir="rtl">${html}</span>`;
  }
  const knownWords = knownWordIndex();
  if (!queryValue && !knownWords.size) {
    return escapeHtml(text || "").replace(/\r?\n/g, "<br>");
  }

  return interactiveKnownWordsHtml(text, {
    knownWords,
    query: queryValue,
    preserveLineBreaks: true
  });
}

function normalizedArabicLayoutText(text, element = null) {
  if (!isTranslationAnswerOptionElement(element)) return normalizedArabicParagraphText(text);
  const value = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+(?=(?:\d+\s*)?[A-D](?:\s|[.):-]))/g, "\n");
  return value.split("\n").map(line => line.trim()).filter(Boolean).join("\n");
}

function arabicAnswerOptionsHtml(text, query = "") {
  const optionElement = { type: "text", role: "options" };
  const lines = normalizedArabicLayoutText(text, optionElement).split("\n").filter(Boolean);
  const rows = lines.map(line => {
    const match = line.match(/^(?:(\d+)\s*)?([A-D])(?:\s+|[.):-]*\s*)(.*)$/u);
    if (!match) {
      return `<span class="page-layout-translated-option-row page-layout-translated-option-row--plain"><span dir="rtl">${arabicTextSegmentHtml(line, query)}</span></span>`;
    }
    const prefix = [match[1], match[2]].filter(Boolean).join(" ");
    return `<span class="page-layout-translated-option-row"><bdi class="page-layout-translated-option-label" dir="ltr">${escapeHtml(prefix)}</bdi><span dir="rtl">${arabicTextSegmentHtml(match[3], query)}</span></span>`;
  }).join("");
  return `<span class="page-layout-translated-options" lang="ar">${rows}</span>`;
}

function arabicTextWithInlineGapsHtml(text, query = "") {
  const value = String(text || "");
  const pattern = /(\{\{\s*([^{}\s]+)\s*\}\}|_{3,})/g;
  let html = "";
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index || 0;
    html += arabicTextSegmentHtml(value.slice(lastIndex, index), query);
    const gapId = stringValueFromClient(match[2] || "gap");
    html += `<span class="page-layout-inline-gap" data-gap-placeholder="${escapeHtml(gapId)}" aria-label="gap"></span>`;
    lastIndex = index + match[0].length;
  }
  html += arabicTextSegmentHtml(value.slice(lastIndex), query);
  return html.replace(/\r?\n/g, "<br>");
}

function arabicTextSegmentHtml(text, query = "") {
  return query
    ? interactiveTextSegmentHtml(text, query)
    : escapeHtml(text || "");
}

function interactiveKnownWordsHtml(text, options = {}) {
  const value = String(text || "");
  const knownWords = options.knownWords instanceof Map ? options.knownWords : knownWordIndex();
  const query = stringValueFromClient(options.query);
  const tokenPattern = /\p{L}+(?:['\u2019-]\p{L}+)*/gu;
  const tokens = [...value.matchAll(tokenPattern)].map(match => ({
    value: match[0],
    index: match.index || 0,
    end: (match.index || 0) + match[0].length
  }));
  let html = "";
  let lastIndex = 0;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    html += interactiveTextSegmentHtml(value.slice(lastIndex, token.index), query);
    const phraseMatch = resolveKnownPhraseFromTokens(value, tokens, tokenIndex, knownWords);
    if (phraseMatch) {
      const phraseText = value.slice(phraseMatch.start, phraseMatch.end);
      html += knownWordInlineButtonHtml(phraseText, phraseMatch.match, query);
      lastIndex = phraseMatch.end;
      tokenIndex = phraseMatch.endTokenIndex;
      continue;
    }

    const knownMatch = resolveKnownWordFromToken(token.value, knownWords);
    html += knownMatch
      ? knownWordInlineButtonHtml(token.value, knownMatch, query)
      : interactiveTextSegmentHtml(token.value, query);
    lastIndex = token.end;
  }

  html += interactiveTextSegmentHtml(value.slice(lastIndex), query);
  return options.preserveLineBreaks ? html.replace(/\r?\n/g, "<br>") : html;
}

function interactiveTextSegmentHtml(text, query) {
  const value = String(text || "");
  const needle = stringValueFromClient(query);
  if (!needle) return escapeHtml(value);

  const pattern = new RegExp(escapeRegExp(needle), "gi");
  let html = "";
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index || 0;
    html += escapeHtml(value.slice(lastIndex, index));
    html += `<mark class="page-layout-search-hit">${escapeHtml(match[0])}</mark>`;
    lastIndex = index + match[0].length;
  }
  html += escapeHtml(value.slice(lastIndex));
  return html;
}

function resolveKnownWordFromToken(token, knownWords) {
  const key = normalizeKnownWordLookupKey(token);
  if (!key) return null;
  if (state.ignoredKnownTokens.has(key)) return null;

  const wordIndex = knownWords?.wordIndex instanceof Map ? knownWords.wordIndex : knownWords;
  const verbIndex = knownWords?.verbIndex instanceof Map ? knownWords.verbIndex : new Map();

  const exactWord = wordIndex.get(key);
  if (exactWord) return exactWord;

  for (const candidate of knownWordDerivativeCandidates(key)) {
    if (!isKnownWordDerivativeCandidate(candidate)) continue;
    const word = wordIndex.get(candidate);
    if (word) return word;
  }

  const exactVerb = verbIndex.get(key);
  if (exactVerb) return exactVerb;

  for (const candidate of knownWordDerivativeCandidates(key)) {
    if (!isKnownWordDerivativeCandidate(candidate)) continue;
    const verb = verbIndex.get(candidate);
    if (verb) return verb;
  }

  return null;
}

function resolveKnownPhraseFromTokens(text, tokens, startIndex, knownWords) {
  const phraseIndex = knownWords?.phraseIndex instanceof Map ? knownWords.phraseIndex : new Map();
  const maxPhraseWords = Number(knownWords?.maxPhraseWords) || 1;
  if (!phraseIndex.size || maxPhraseWords < 2) return null;

  const maxEndIndex = Math.min(tokens.length - 1, startIndex + maxPhraseWords - 1);
  for (let endIndex = maxEndIndex; endIndex > startIndex; endIndex -= 1) {
    if (!knownPhraseTokensHaveWhitespaceSeparators(text, tokens, startIndex, endIndex)) continue;
    const phraseTokens = tokens.slice(startIndex, endIndex + 1).map(token => token.value);
    const match = resolveKnownPhraseMatch(phraseTokens, phraseIndex);
    if (!match) continue;
    const start = tokens[startIndex].index;
    const end = tokens[endIndex].end;
    const displayText = tokens
      .slice(startIndex, endIndex + 1)
      .map(token => token.value)
      .join(" ");
    const ignoredKey = normalizeKnownWordLookupKey(displayText);
    if (ignoredKey && state.ignoredKnownTokens.has(ignoredKey)) continue;
    return { match, start, end, endTokenIndex: endIndex };
  }

  return null;
}

function knownPhraseTokensHaveWhitespaceSeparators(text, tokens, startIndex, endIndex) {
  for (let index = startIndex; index < endIndex; index += 1) {
    const separator = String(text || "").slice(tokens[index].end, tokens[index + 1].index);
    if (!/^[\s\u00a0]+$/u.test(separator)) return false;
  }
  return true;
}

function resolveKnownPhraseMatch(tokens, phraseIndex) {
  const exactKey = normalizeKnownWordLookupKey(tokens.join(" "));
  if (exactKey && phraseIndex.has(exactKey)) return phraseIndex.get(exactKey);

  const firstKey = normalizeKnownWordLookupKey(tokens[0]);
  if (!firstKey) return null;
  for (const candidate of knownWordDerivativeCandidates(firstKey)) {
    if (!isKnownWordDerivativeCandidate(candidate)) continue;
    const phraseKey = normalizeKnownWordLookupKey([candidate, ...tokens.slice(1)].join(" "));
    const match = phraseIndex.get(phraseKey);
    if (match) return match;
  }

  return null;
}

function knownWordDerivativeCandidates(key) {
  const candidates = [];
  const append = (value, minLength = KNOWN_WORD_DERIVATIVE_MIN_BASE_LENGTH) => {
    const candidate = normalizeKnownWordLookupKey(value);
    if (
      candidate &&
      candidate.length >= minLength &&
      /^\p{L}+$/u.test(candidate) &&
      !candidates.includes(candidate)
    ) {
      candidates.push(candidate);
    }
  };

  appendKnownWordSuffixCandidates(key, append);

  KNOWN_WORD_DERIVATIVE_PREFIXES.forEach(prefix => {
    if (!key.startsWith(prefix) || key.length <= prefix.length) return;
    const stem = key.slice(prefix.length);
    append(stem, KNOWN_WORD_PREFIX_MIN_BASE_LENGTH);
    if (stem.length >= KNOWN_WORD_PREFIX_MIN_BASE_LENGTH) {
      appendKnownWordSuffixCandidates(stem, append);
    }
  });

  return candidates;
}

function appendKnownWordSuffixCandidates(key, append) {
  (KNOWN_WORD_IRREGULAR_BASE_CANDIDATES.get(key) || []).forEach(candidate => {
    append(candidate);
  });

  KNOWN_WORD_DERIVATIVE_SUFFIXES.forEach(suffix => {
    if (!key.endsWith(suffix) || key.length <= suffix.length) return;
    const stem = key.slice(0, -suffix.length);

    if (suffix === "ies" || suffix === "ied") {
      append(`${stem}y`);
      return;
    }

    append(stem);
    if (!stem.endsWith("e")) append(`${stem}e`);
    append(removeDoubledFinalLetter(stem));
    append(replaceTrailingIWithY(stem));
  });
}

function isKnownWordDerivativeCandidate(value) {
  return value.length >= KNOWN_WORD_DERIVATIVE_MIN_BASE_LENGTH && /^\p{L}+$/u.test(value);
}

function removeDoubledFinalLetter(value) {
  return /(\p{L})\1$/u.test(value) ? value.slice(0, -1) : value;
}

function replaceTrailingIWithY(value) {
  return value.endsWith("i") ? `${value.slice(0, -1)}y` : value;
}

function knownWordInlineButtonHtml(token, match, query) {
  const wordLabel = knownMatchLabel(match) || token;
  const isDerivedMatch = normalizeKnownWordLookupKey(token) !== normalizeKnownWordLookupKey(wordLabel);
  const targetName = match.kind === "verb" ? "verbs list" : "word list";
  const title = isDerivedMatch
    ? `Open ${wordLabel} from ${token} in ${targetName}. Ctrl+click removes this underline.`
    : `Open ${wordLabel} in ${targetName}. Ctrl+click removes this underline.`;
  const actionAttribute = match.kind === "verb"
    ? `data-open-test-known-verb="${escapeHtml(match.id)}" data-open-test-known-form="${escapeHtml(token)}"`
    : `data-open-test-known-word="${escapeHtml(match.id)}"`;
  return `<button class="test-known-word" type="button" ${actionAttribute} data-open-test-known-token="${escapeHtml(token)}" title="${escapeHtml(title)}">${interactiveTextSegmentHtml(token, query)}</button>`;
}

function knownWordIndex() {
  const index = new Map();
  const wordIndex = new Map();
  const verbIndex = new Map();
  const phraseIndex = new Map();
  let maxPhraseWords = 1;
  (state.db.words || []).forEach(word => {
    if (!isVaultRecordLocation(word)) return;
    const key = normalizeKnownWordLookupKey(word.word);
    if (!key) return;
    if (!wordIndex.has(key)) {
      const entry = { kind: "word", id: word.id, label: word.word, word };
      wordIndex.set(key, entry);
      index.set(key, entry);
      const phraseWords = knownWordPhraseLength(word.word);
      if (phraseWords > 1) {
        phraseIndex.set(key, entry);
        maxPhraseWords = Math.max(maxPhraseWords, phraseWords);
      }
    }
  });
  (state.db.verbs || []).forEach(verb => {
    verbKnownForms(verb).forEach(form => {
      const key = normalizeKnownWordLookupKey(form);
      if (!key || verbIndex.has(key)) return;
      const entry = { kind: "verb", id: verb.id, label: verb.base, form, verb };
      verbIndex.set(key, entry);
      if (!index.has(key)) {
        index.set(key, entry);
      }
    });
  });
  index.wordIndex = wordIndex;
  index.verbIndex = verbIndex;
  index.phraseIndex = phraseIndex;
  index.maxPhraseWords = maxPhraseWords;
  return index;
}

function knownWordPhraseLength(value) {
  return (String(value || "").match(/\p{L}+(?:['\u2019-]\p{L}+)*/gu) || []).length;
}

function knownMatchLabel(match) {
  if (match?.kind === "verb") return match.label || match.verb?.base || match.form || "";
  return match?.label || match?.word?.word || "";
}

function verbKnownForms(verb) {
  return [
    verb.base,
    ...(verb.forms || []),
    ...(verb.past || []),
    ...(verb.pastParticiple || []),
    ...(verb.thirdPerson || []),
    ...(verb.presentParticiple || [])
  ].filter(Boolean);
}

function normalizeKnownWordToken(value) {
  return normalizePracticeAnswer(value)
    .replace(/[\u2019']s$/i, "")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
}

function normalizeKnownWordLookupKey(value) {
  return normalizeKnownWordToken(value).replace(/[^\p{L}]+/gu, "");
}

function openNationalTestReader(test) {
  if (!test?.pdf?.url) return;
  closeStudyTextReader();
  state.activeNationalTestId = test.id;
  renderSources();
  renderNationalTests();
  const reader = document.createElement("div");
  reader.className = "reader-overlay";
  reader.dataset.readerOverlay = "national-test";
  reader.innerHTML = nationalTestReaderHtml(test);
  document.body.append(reader);
  refreshIcons();
  reader.querySelector("[data-close-reader]")?.focus();
  void renderNationalTestReaderThumbnails(reader, test);
}

function nationalTestReaderHtml(test) {
  const updated = new Date(test.updatedAt || test.createdAt).toLocaleDateString();
  const details = [test.course, test.term, test.year].filter(Boolean).join(" | ");
  const pages = nationalTestPages(test.id);
  return `
    <div class="reader-backdrop" data-close-reader></div>
    <article class="reader-panel national-test-reader-panel" role="dialog" aria-modal="true" aria-labelledby="national-test-reader-title">
      <header class="reader-header">
        <div>
          <div class="title-line">
            <h2 id="national-test-reader-title">${escapeHtml(test.title)}</h2>
            ${details ? `<span class="pos-chip">${escapeHtml(details)}</span>` : ""}
          </div>
          <div class="meta-line">
            <span>${escapeHtml(getPathLabel(test))}</span>
            <span>${formatFileSize(test.pdf?.size || 0)}</span>
            <span>Updated ${updated}</span>
          </div>
        </div>
        <div class="row-actions">
          <a class="icon-button" href="${escapeHtml(test.pdf.url)}" target="_blank" rel="noopener" title="Open in browser" aria-label="Open in browser">${icon("external-link")}</a>
          <button class="icon-button" type="button" title="Close" aria-label="Close" data-close-reader>${icon("x")}</button>
        </div>
      </header>
      <div class="reader-content national-test-reader-content">
        <div class="national-test-scan-browser">
          <div class="national-test-scan-intro">
            <strong>PDF scans</strong>
            <span>Click any scanned page to open its visual page.</span>
          </div>
          <div class="national-test-scan-list" data-national-test-scan-list="${test.id}">
            ${pages.length ? pages.map(page => nationalTestReaderThumbnailShellHtml(test, page)).join("") : `<div class="empty-state">No extracted pages</div>`}
          </div>
        </div>
      </div>
    </article>
  `;
}

function nationalTestReaderThumbnailShellHtml(test, page) {
  const pdfLabel = nationalTestPdfDisplayLabel(test, page);
  const visualLabel = nationalTestVisualPageLabel(test, page);
  const title = page.pagePart
    ? `Open page ${visualLabel} from PDF page ${pdfLabel}`
    : `Open PDF page ${pdfLabel}`;
  return `
    <button
      class="national-test-scan-card ${page.id === state.activeNationalTestPageId ? "active" : ""}"
      type="button"
      data-reader-select-test-page="${page.id}"
      data-reader-page-shell="${page.id}"
      title="${escapeHtml(title)}"
    >
      <div class="national-test-scan-image">
        <span class="national-test-scan-placeholder">Loading page ${escapeHtml(visualLabel)}</span>
      </div>
      <span class="national-test-scan-label" data-reader-page-label="${page.id}">${escapeHtml(visualLabel)}</span>
    </button>
  `;
}

async function renderNationalTestReaderThumbnails(reader, test) {
  const entry = await ensureNationalTestPdfPreview(test);
  if (!reader?.isConnected || !entry?.pdf) return;
  const pages = nationalTestPages(test.id);
  for (const page of pages) {
    if (!reader.isConnected) return;
    try {
      await renderNationalTestReaderThumbnail(reader, test, page, entry);
    } catch (error) {
      console.error(error);
      const shell = reader.querySelector(`[data-reader-page-shell="${cssEscape(page.id)}"] .national-test-scan-image`);
      if (shell) {
        shell.innerHTML = `<span class="national-test-scan-placeholder">Unable to render page ${escapeHtml(nationalTestVisualPageLabel(test, page))}</span>`;
      }
    }
  }
}

async function renderNationalTestReaderThumbnail(reader, test, page, entry) {
  const shell = reader.querySelector(`[data-reader-page-shell="${cssEscape(page.id)}"]`);
  if (!shell) return;
  const imageContainer = shell.querySelector(".national-test-scan-image");
  const labelNode = shell.querySelector(`[data-reader-page-label="${cssEscape(page.id)}"]`);
  const visualLabel = nationalTestVisualPageLabel(test, page);
  if (labelNode) {
    labelNode.textContent = visualLabel;
  }

  let dataUrl = entry.thumbnails?.get(page.pageNumber);
  if (!dataUrl) {
    const pdfPage = await entry.pdf.getPage(page.pageNumber);
    const viewport = pdfPage.getViewport({ scale: 0.32 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    if (!(entry.thumbnails instanceof Map)) {
      entry.thumbnails = new Map();
    }
    entry.thumbnails.set(page.pageNumber, dataUrl);
  }

  if (!imageContainer) return;
  imageContainer.innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="Page ${escapeHtml(visualLabel)}" loading="lazy" />`;
}

function wordCountText(count) {
  return `${count} ${count === 1 ? "word" : "words"}`;
}

function verbCountText(count) {
  return `${count} ${count === 1 ? "verb" : "verbs"}`;
}

function studyTextCountText(count) {
  return `${count} ${count === 1 ? "text" : "texts"}`;
}

function studyVideoCountText(count) {
  return `${count} ${count === 1 ? "video" : "videos"}`;
}

function nationalTestCountText(count) {
  return `${count} ${count === 1 ? "test" : "tests"}`;
}

function pronunciationButtonHtml(word, options = {}) {
  const pronunciation = word.pronunciation;
  const loading = state.pronunciations.loadingIds.has(word.id);
  const cached = pronunciation?.audioUrl?.startsWith("/pronunciations/");
  const ipaOnly = Boolean(pronunciation?.exact && pronunciation?.phonetic && !pronunciation?.audioUrl);
  const formText = cached
    ? pronunciation.exact
      ? "recorded pronunciation"
      : `base-form pronunciation${pronunciation.entryWord ? ` for ${pronunciation.entryWord}` : ""}`
    : ipaOnly
      ? "IPA only, no recorded word audio available"
    : "download pronunciation audio";
  const phonetic = pronunciation?.phonetic ? `, ${pronunciation.phonetic}` : "";
  const shortcut = options.shortcut || "";
  const shortcutText = shortcut ? ` (${shortcut})` : "";
  const title = loading
    ? "Fetching pronunciation audio"
    : ipaOnly
      ? `${formText}${phonetic}`
      : `${cached ? "Play" : "Fetch"} ${formText}${phonetic}${shortcutText}`;
  return `
    <button class="icon-button shortcut-button pronunciation-button ${cached ? "" : "missing"}" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-play-pronunciation="${word.id}" ${loading || ipaOnly ? "disabled" : ""}>
      ${icon(loading ? "loader-2" : ipaOnly ? "volume-x" : "volume-2")}
      ${shortcutHint(shortcut)}
    </button>
  `;
}

function pronunciationRecorderControlsHtml(word) {
  const recorder = state.pronunciationRecorder;
  const active = recorder.activeWordId === word.id;
  const recording = active && recorder.recorder?.state === "recording";
  const hasRecording = active && Boolean(recorder.recordingUrl);
  const supported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const recordTitle = !supported
    ? "Audio recording is not supported in this browser"
    : hasRecording ? "Record pronunciation again (R)" : "Record pronunciation (R)";
  return `
    <span class="pronunciation-inline-controls" aria-label="Pronunciation recording controls">
      <button class="icon-button shortcut-button pronunciation-record-button ${active ? "active" : ""} ${recording ? "recording" : ""}" type="button" title="${escapeHtml(recordTitle)}" aria-label="${escapeHtml(recordTitle)}" data-word-recorder-record="${word.id}" ${recording || !supported ? "disabled" : ""}>
          ${icon("mic")}
          ${shortcutHint("R")}
      </button>
      <button class="icon-button shortcut-button pronunciation-stop-button ${recording ? "active" : ""}" type="button" title="Stop recording (S)" aria-label="Stop recording (S)" data-word-recorder-stop="${word.id}" ${recording ? "" : "disabled"}>
        ${icon("square")}
        ${shortcutHint("S")}
      </button>
      <button class="icon-button shortcut-button pronunciation-playback-button ${hasRecording ? "active" : ""}" type="button" title="Play my voice (V)" aria-label="Play my voice (V)" data-word-recorder-play="${word.id}" ${hasRecording && !recording ? "" : "disabled"}>
        ${icon("headphones")}
        ${shortcutHint("V")}
      </button>
    </span>
  `;
}

function shortcutHint(key) {
  return key ? `<span class="shortcut-hint" aria-hidden="true">${escapeHtml(key)}</span>` : "";
}

function clampWordCount(value, fallback = DEFAULT_REVIEW_WORD_COUNT) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(1, Math.min(50, number));
}

function reviewWordCount() {
  return clampWordCount(els.reviewWordCount.value, DEFAULT_REVIEW_WORD_COUNT);
}

function reviewPlanText(review) {
  const due = review.dueCount || 0;
  const weak = review.weakCount || Math.max(0, (review.oldCount || 0) - due);
  const fresh = review.newCount || 0;
  return `${due} due, ${weak} weak, ${fresh} new`;
}

function setReviewWordCount(value) {
  const count = clampWordCount(value, DEFAULT_REVIEW_WORD_COUNT);
  els.reviewWordCount.value = String(count);
  localStorage.setItem("reviewWordCount", String(count));
  return count;
}

function wordCountInputValue(selector, fallback = reviewWordCount()) {
  const input = els.wordList.querySelector(selector);
  return clampWordCount(input?.value, fallback);
}

function selectedCountText(count) {
  return `${count} ${count === 1 ? "word" : "words"} selected`;
}

function pruneSelectedWords() {
  const ids = new Set(state.db.words.map(word => word.id));
  [...state.selectedWordIds].forEach(id => {
    if (!ids.has(id)) {
      state.selectedWordIds.delete(id);
    }
  });
}

function selectedWordIds() {
  pruneSelectedWords();
  return [...state.selectedWordIds];
}

function practiceButtonLabel() {
  if (state.practice.active) return "Restart practice";
  if (state.practiceModePicker.active) return "Choose practice";
  const count = selectedWordIds().length;
  return count ? `Practice ${count} selected` : "Practice visible words";
}

function renderBulkActions() {
  const ids = state.practice.active || state.review.active || state.soundPractice.active || state.practiceModePicker.active ? [] : selectedWordIds();
  els.bulkActions.classList.toggle("hidden", !ids.length);
  els.bulkSelectedCount.textContent = selectedCountText(ids.length);
  if (!ids.length) return;

  ensureBulkLocation();
  els.bulkSource.innerHTML = state.db.sources.map(source => `
    <option value="${source.id}" ${source.id === state.bulkLocation.sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>
  `).join("");

  const source = findSource(state.bulkLocation.sourceId);
  const branches = source?.branches || [];
  els.bulkBranch.innerHTML = optionsHtml(branches, state.bulkLocation.branchId);

  const branch = findBranch(state.bulkLocation.sourceId, state.bulkLocation.branchId);
  const units = branch?.units || [];
  els.bulkUnit.innerHTML = optionsHtml(units, state.bulkLocation.unitId);

  els.bulkMoveButton.disabled = !state.bulkLocation.sourceId;
  els.bulkDeleteButton.disabled = !ids.length;
}

function ensureBulkLocation() {
  const source = findSource(state.bulkLocation.sourceId) ||
    findSource(state.selected.sourceId) ||
    findSource(state.filters.sourceId) ||
    state.db.sources[0];
  state.bulkLocation.sourceId = source?.id || "";

  const branches = source?.branches || [];
  if (state.bulkLocation.branchId && !branches.some(branch => branch.id === state.bulkLocation.branchId)) {
    state.bulkLocation.branchId = "";
    state.bulkLocation.unitId = "";
  }

  const branch = state.bulkLocation.branchId ? branches.find(item => item.id === state.bulkLocation.branchId) : null;
  const units = branch?.units || [];
  if (!units.some(unit => unit.id === state.bulkLocation.unitId)) {
    state.bulkLocation.unitId = "";
  }
}

function miniSection(title, items, mode) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) {
    return `<section class="mini-section"><h4>${title}</h4><span class="chip">Empty</span></section>`;
  }
  if (mode === "examples") {
    return `<section class="mini-section"><h4>${title}</h4><ol class="example-list">${values.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol></section>`;
  }
  if (mode === "synonyms") {
    return synonymsSection(title, values);
  }
  return `<section class="mini-section"><h4>${title}</h4><div class="chip-list">${values.map(item => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div></section>`;
}

function optionalMiniSection(title, items, mode) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) return "";
  if (mode === "definitions") {
    return `<section class="mini-section full-width"><h4>${title}</h4><div class="thesaurus-definition-list">${values.map(item => `<p>${escapeHtml(item)}</p>`).join("")}</div></section>`;
  }
  if (mode === "examples") {
    return `<section class="mini-section full-width"><h4>${title}</h4><ol class="example-list">${values.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol></section>`;
  }
  return `<section class="mini-section"><h4>${title}</h4><div class="chip-list">${values.map(item => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div></section>`;
}

function thesaurusSectionsHtml(thesaurus) {
  if (!thesaurus || typeof thesaurus !== "object") return "";
  return [
    optionalMiniSection("Thesaurus sense", thesaurus.definitions, "definitions"),
    optionalMiniSection("Related words", thesaurus.relatedWords, "chips"),
    optionalMiniSection("Antonyms", thesaurus.antonyms, "chips"),
    optionalMiniSection("Near antonyms", thesaurus.nearAntonyms, "chips"),
    optionalMiniSection("Idiomatic phrases", thesaurus.phrases, "chips"),
    optionalMiniSection("Thesaurus examples", thesaurus.examples, "examples")
  ].join("");
}

function synonymsSection(title, values) {
  const hasComparisons = values.some(item => item && typeof item === "object" && item.comparison);
  const rendered = values.map(item => {
    if (item && typeof item === "object") {
      const word = item.word ? String(item.word).trim() : "";
      const comparison = item.comparison ? String(item.comparison).trim() : "";
      if (!word) return "";
      return comparison
        ? `<article class="synonym-card"><strong>${escapeHtml(word)}</strong><p>${escapeHtml(comparison)}</p></article>`
        : `<span class="chip">${escapeHtml(word)}</span>`;
    }
    return `<span class="chip">${escapeHtml(item)}</span>`;
  }).filter(Boolean).join("");

  const contentClass = hasComparisons ? "synonym-list" : "chip-list";
  return `<section class="mini-section ${hasComparisons ? "full-width" : ""}"><h4>${title}</h4><div class="${contentClass}">${rendered}</div></section>`;
}

async function startReviewSession(options = {}) {
  const target = clampWordCount(options.target ?? reviewWordCount(), DEFAULT_REVIEW_WORD_COUNT);
  setReviewWordCount(target);
  const session = await api("/api/review/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, maxNew: target })
  });

  if (!session.words?.length) {
    showToast("No review words are due and no new words are waiting");
    return;
  }

  cleanupWordPronunciationRecorder();
  state.practice.active = false;
  state.soundPractice.active = false;
  state.review = {
    active: true,
    sessionId: session.sessionId,
    words: session.words,
    index: 0,
    dueCount: session.dueWordIds?.length || 0,
    weakCount: session.weakWordIds?.length || 0,
    oldCount: session.oldWordIds?.length || 0,
    newCount: session.newWordIds?.length || 0,
    target: session.target || 10,
    resumed: Boolean(session.resumed)
  };
  renderWords();
  refreshIcons();
}

function endReviewSession() {
  state.review.active = false;
  renderWords();
  refreshIcons();
}

function renderReviewPanel() {
  const review = state.review;
  const word = review.words[review.index];
  if (!word) {
    els.wordList.innerHTML = `<div class="empty-state">No review words</div>`;
    return;
  }

  const progress = review.words.length ? Math.round(((review.index + 1) / review.words.length) * 100) : 0;
  const resumeText = review.resumed ? "Continuing your last review" : "Review these words before practice";
  const planText = reviewPlanText(review);
  els.wordList.innerHTML = `
    <section class="practice-panel">
      <div class="practice-header">
        <div>
          <h3>Today&apos;s review</h3>
          <p>${resumeText} - ${planText}</p>
        </div>
        <button class="ghost-button" type="button" data-end-review>
          ${icon("list")}
          <span>Back to list</span>
        </button>
      </div>
      <div class="practice-progress-track" aria-hidden="true">
        <span style="width: ${progress}%"></span>
      </div>
      <article class="review-card">
        ${wordCardHtml(word, { controls: false, hideIpaPronunciationText: true, className: "review-word-card" })}
        <div class="review-footer">
          <span>${review.index + 1} / ${review.words.length}</span>
          <div class="practice-actions">
            <button class="ghost-button" type="button" data-review-prev ${review.index === 0 ? "disabled" : ""}>
              ${icon("arrow-left")}
              <span>Previous</span>
            </button>
            ${review.index === review.words.length - 1
              ? `<button class="primary-button" type="button" data-review-practice>
                  ${icon("brain")}
                  <span>Start practice</span>
                </button>`
              : `<button class="primary-button" type="button" data-review-next>
                  ${icon("arrow-right")}
                  <span>Next</span>
                </button>`}
          </div>
        </div>
      </article>
    </section>
  `;
}

function nextReviewWord() {
  state.review.index = Math.min(state.review.words.length - 1, state.review.index + 1);
  renderWords();
  refreshIcons();
}

function previousReviewWord() {
  state.review.index = Math.max(0, state.review.index - 1);
  renderWords();
  refreshIcons();
}

function startReviewPractice() {
  const review = state.review;
  const words = review.words;
  const options = {
    source: "review",
    sessionId: review.sessionId,
    saveProgress: true,
    sessionMeta: {
      dueCount: review.dueCount,
      weakCount: review.weakCount,
      oldCount: review.oldCount,
      newCount: review.newCount,
      target: review.target,
      resumed: review.resumed
    }
  };
  state.review.active = false;
  startPracticeSession(words, options).catch(error => showToast(error.message, true));
}

function startSoundPracticeSession(words = practiceSourceWords(), options = {}) {
  const target = clampWordCount(options.target ?? reviewWordCount(), DEFAULT_REVIEW_WORD_COUNT);
  setReviewWordCount(target);
  const practiceWords = uniquePracticeWords(shuffle(words)).slice(0, target);
  if (!practiceWords.length) {
    showToast("No words match the current filters", true);
    return;
  }

  cleanupWordPronunciationRecorder();
  state.practice.active = false;
  state.review.active = false;
  state.soundPractice = {
    active: true,
    words: practiceWords,
    index: 0,
    completed: false
  };
  renderWords();
  refreshIcons();
  focusSoundPracticePrimaryButton();
}

function endSoundPracticeSession() {
  cleanupWordPronunciationRecorder();
  state.soundPractice.active = false;
  renderWords();
  refreshIcons();
}

function currentSoundPracticeWord() {
  return state.soundPractice.words[state.soundPractice.index] || null;
}

function nextSoundPracticeWord() {
  cleanupWordPronunciationRecorder();
  if (state.soundPractice.index >= state.soundPractice.words.length - 1) {
    state.soundPractice.completed = true;
  } else {
    state.soundPractice.index += 1;
  }
  renderWords();
  refreshIcons();
  focusSoundPracticePrimaryButton();
}

function previousSoundPracticeWord() {
  cleanupWordPronunciationRecorder();
  state.soundPractice.index = Math.max(0, state.soundPractice.index - 1);
  state.soundPractice.completed = false;
  renderWords();
  refreshIcons();
  focusSoundPracticePrimaryButton();
}

function renderSoundPracticePanel() {
  const session = state.soundPractice;
  if (session.completed) {
    els.wordList.innerHTML = soundPracticeSummaryHtml();
    return;
  }

  const word = currentSoundPracticeWord();
  if (!word) {
    els.wordList.innerHTML = `<div class="empty-state">No sound practice words</div>`;
    return;
  }

  const progress = session.words.length ? Math.round(((session.index + 1) / session.words.length) * 100) : 0;
  const isLast = session.index >= session.words.length - 1;
  els.wordList.innerHTML = `
    <section class="practice-panel sound-practice-panel">
      <div class="practice-header">
        <div>
          <h3>Sound practice</h3>
          <p>${session.index + 1} / ${session.words.length} words</p>
        </div>
        <div class="practice-header-actions">
          ${practiceEditButtonHtml(word)}
          <button class="ghost-button" type="button" data-end-sound-practice>
            ${icon("list")}
            <span>Back to list</span>
          </button>
        </div>
      </div>
      <div class="practice-progress-track" aria-hidden="true">
        <span style="width: ${progress}%"></span>
      </div>
      <article class="practice-card sound-practice-card">
        ${wordCardHtml(word, { controls: false, pronunciation: false, pronunciationText: true, hideIpaPronunciationText: true, className: "sound-practice-word-card" })}
        ${soundPracticeControlsHtml(word)}
        <div class="review-footer">
          <span>${session.index + 1} / ${session.words.length}</span>
          <div class="practice-actions">
            <button class="ghost-button" type="button" data-sound-practice-prev ${session.index === 0 ? "disabled" : ""}>
              ${icon("arrow-left")}
              <span>Previous</span>
            </button>
            <button class="primary-button" type="button" data-sound-practice-next>
              ${icon(isLast ? "check" : "arrow-right")}
              <span>${isLast ? "Finish" : "Next"}</span>
            </button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function soundPracticeControlsHtml(word) {
  const recorder = state.pronunciationRecorder;
  const active = recorder.activeWordId === word.id;
  const recording = active && recorder.recorder?.state === "recording";
  const hasRecording = active && Boolean(recorder.recordingUrl);
  const supported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const loadingOriginal = state.pronunciations.loadingIds.has(word.id);
  const status = active ? recorder.status : "Ready";
  return `
    <section class="sound-compare-panel">
      <div class="sound-compare-status">
        <strong>Compare pronunciation</strong>
        <span>${escapeHtml(status)}</span>
      </div>
      <div class="sound-compare-actions">
        <button class="ghost-button shortcut-button" type="button" title="Play original pronunciation (P)" aria-label="Play original pronunciation (P)" data-play-pronunciation="${word.id}" ${loadingOriginal ? "disabled" : ""}>
          ${icon(loadingOriginal ? "loader-2" : "volume-2")}
          <span>${loadingOriginal ? "Loading" : "Original"}</span>
          ${shortcutHint("P")}
        </button>
        <button class="primary-button shortcut-button pronunciation-record-button ${active ? "active" : ""} ${recording ? "recording" : ""}" type="button" title="Record my voice (R)" aria-label="Record my voice (R)" data-word-recorder-record="${word.id}" ${recording || !supported ? "disabled" : ""}>
          ${icon("mic")}
          <span>${hasRecording ? "Record again" : "Record"}</span>
          ${shortcutHint("R")}
        </button>
        <button class="ghost-button shortcut-button pronunciation-stop-button ${recording ? "active" : ""}" type="button" title="Stop recording (S)" aria-label="Stop recording (S)" data-word-recorder-stop="${word.id}" ${recording ? "" : "disabled"}>
          ${icon("square")}
          <span>Stop</span>
          ${shortcutHint("S")}
        </button>
        <button class="ghost-button shortcut-button pronunciation-playback-button ${hasRecording ? "active" : ""}" type="button" title="Play my voice (V)" aria-label="Play my voice (V)" data-word-recorder-play="${word.id}" ${hasRecording && !recording ? "" : "disabled"}>
          ${icon("headphones")}
          <span>My voice</span>
          ${shortcutHint("V")}
        </button>
      </div>
      ${supported ? "" : `<p class="sound-compare-warning">Audio recording is not supported in this browser.</p>`}
    </section>
  `;
}

function soundPracticeSummaryHtml() {
  const total = state.soundPractice.words.length;
  return `
    <section class="practice-panel">
      <div class="practice-summary">
        <span>${icon("mic")}</span>
        <h3>Sound practice complete</h3>
        <p>${total} ${total === 1 ? "word" : "words"} practiced</p>
        <div class="practice-actions">
          <button class="primary-button" type="button" data-repeat-sound-practice>
            ${icon("rotate-ccw")}
            <span>Practice again</span>
          </button>
          <button class="ghost-button" type="button" data-end-sound-practice>
            ${icon("list")}
            <span>Back to list</span>
          </button>
        </div>
      </div>
    </section>
  `;
}

function repeatSoundPracticeSession() {
  cleanupWordPronunciationRecorder();
  state.soundPractice.words = shuffle(state.soundPractice.words);
  state.soundPractice.index = 0;
  state.soundPractice.completed = false;
  renderWords();
  refreshIcons();
  focusSoundPracticePrimaryButton();
}

function focusSoundPracticePrimaryButton() {
  requestAnimationFrame(() => {
    const button = els.wordList.querySelector("[data-play-pronunciation], [data-repeat-sound-practice]");
    button?.focus?.({ preventScroll: true });
  });
}

function openPracticeModePicker(words = practiceSourceWords()) {
  const practiceWords = uniquePracticeWords(words);
  if (!practiceWords.length) {
    showToast("No words match the current filters", true);
    return;
  }
  state.practiceModePicker = {
    active: true,
    words: practiceWords
  };
  state.practice.active = false;
  state.review.active = false;
  state.soundPractice.active = false;
  renderWords();
  refreshIcons();
  focusPracticeModeButton();
}

function closePracticeModePicker() {
  state.practiceModePicker.active = false;
  state.practiceModePicker.words = [];
  renderWords();
  refreshIcons();
}

function renderPracticeModePickerPanel() {
  const words = state.practiceModePicker.words;
  const blankReadyCount = words.filter(word => blankExamplePromptForWord(word)).length;
  const listeningReadyCount = words.filter(hasPracticeAudio).length;
  els.wordList.innerHTML = `
    <section class="practice-panel">
      <div class="practice-mode-panel">
        <div class="practice-mode-heading">
          <div>
            <h3>Practice visible words</h3>
            <p>${wordCountText(words.length)} available. Choose how to practice this set.</p>
          </div>
          <button class="ghost-button" type="button" data-close-practice-mode-picker>
            ${icon("list")}
            <span>Back to list</span>
          </button>
        </div>
        <div class="practice-mode-grid">
          <button class="practice-mode-button" type="button" data-start-practice-mode="choice-write">
            ${icon("list-checks")}
            <strong>Choose + write</strong>
            <span>Pick the word from four choices, then type it from memory.</span>
          </button>
          <button class="practice-mode-button" type="button" data-start-practice-mode="blank-example" ${blankReadyCount ? "" : "disabled"}>
            ${icon("text-cursor-input")}
            <strong>Blank example</strong>
            <span>Fill the missing word in an example sentence with the definition shown.</span>
            <em>${blankReadyCount ? `${wordCountText(blankReadyCount)} with usable examples` : "No usable examples in this set"}</em>
          </button>
          <button class="practice-mode-button" type="button" data-start-practice-mode="listen-write" ${listeningReadyCount ? "" : "disabled"}>
            ${icon("headphones")}
            <strong>Listen + write</strong>
            <span>Hear the pronunciation, then type the word you heard.</span>
            <em>${listeningReadyCount ? `${wordCountText(listeningReadyCount)} with audio` : "Fetch audio for this set first"}</em>
          </button>
        </div>
      </div>
    </section>
  `;
}

function focusPracticeModeButton() {
  requestAnimationFrame(() => {
    els.wordList.querySelector("[data-start-practice-mode]")?.focus?.({ preventScroll: true });
  });
}

function startSelectedPracticeMode(mode) {
  if (!["choice-write", "blank-example", "listen-write"].includes(mode)) return;
  const words = state.practiceModePicker.words.length ? state.practiceModePicker.words : practiceSourceWords();
  state.practiceModePicker.active = false;
  state.practiceModePicker.words = [];
  startPracticeSession(words, { mode }).catch(error => showToast(error.message, true));
}

function practiceSourceWords() {
  const ids = selectedWordIds();
  if (!ids.length) return getFilteredWords();
  const selectedIds = new Set(ids);
  return state.db.words.filter(word => selectedIds.has(word.id));
}

async function startPracticeSession(words = practiceSourceWords(), options = {}) {
  const isReviewPractice = options.source === "review";
  const mode = options.mode || "choice-write";
  const includeDue = options.includeDue === true;
  const dueWords = includeDue ? await duePracticeWords() : [];
  let practiceWords = isReviewPractice
    ? uniquePracticeWords(words)
    : includeDue ? buildPracticeWords(words, dueWords) : uniquePracticeWords(shuffle(words));
  if (mode === "blank-example") {
    practiceWords = practiceWords.filter(word => blankExamplePromptForWord(word));
  } else if (mode === "listen-write") {
    practiceWords = practiceWords.filter(hasPracticeAudio);
  }
  if (!practiceWords.length) {
    const message = mode === "blank-example"
      ? "No words with usable examples match this set"
      : mode === "listen-write"
        ? "No words with pronunciation audio match this set"
        : isReviewPractice ? "No review words to practice" : "No words match the current filters";
    showToast(message, true);
    return;
  }

  const dueWordIds = new Set(dueWords.map(word => word.id));
  cleanupWordPronunciationRecorder();
  state.soundPractice.active = false;
  state.practiceModePicker.active = false;
  state.practiceModePicker.words = [];
  state.practice = {
    active: true,
    source: options.source || "free",
    sessionId: options.sessionId || "",
    sessionMeta: options.sessionMeta || null,
    sessionCompleted: false,
    saveProgress: options.saveProgress !== false,
    mode,
    words: practiceWords,
    queue: [...practiceWords],
    current: null,
    answered: 0,
    correct: 0,
    total: practiceWords.length,
    misses: {},
    reviewCount: practiceWords.filter(word => dueWordIds.has(word.id)).length,
    result: null,
    stage: "choice",
    choices: [],
    blankPrompt: null,
    choiceFeedback: null,
    complete: false
  };
  nextPracticeWord();
  renderWords();
  refreshIcons();
  focusPracticeAnswerInput();
  playCurrentListeningWord();
}

async function duePracticeWords() {
  const { dueWordIds = [] } = await api("/api/practice/due");
  const dueIds = new Set(dueWordIds);
  return state.db.words.filter(word => dueIds.has(word.id));
}

function buildPracticeWords(baseWords, dueWords) {
  return uniquePracticeWords([
    ...shuffle(dueWords),
    ...shuffle(baseWords)
  ]);
}

function uniquePracticeWords(words) {
  const seen = new Set();
  return words
    .filter(word => {
      if (!word?.word || seen.has(word.id)) return false;
      seen.add(word.id);
      return true;
    });
}

function hasPracticeAudio(word) {
  return Boolean(word?.pronunciation?.audioUrl?.startsWith("/pronunciations/"));
}

function buildPracticeChoices(word, sessionWords = []) {
  const correctKey = normalizePracticeAnswer(word.word);
  const usedAnswerKeys = new Set([correctKey]);
  const samePartCandidates = [];
  const otherCandidates = [];

  uniquePracticeWords([...sessionWords, ...state.db.words]).forEach(candidate => {
    const answerKey = normalizePracticeAnswer(candidate.word);
    if (!answerKey || usedAnswerKeys.has(answerKey) || candidate.id === word.id) return;
    if (wordsSharePartOfSpeech(word, candidate)) {
      samePartCandidates.push(candidate);
    } else {
      otherCandidates.push(candidate);
    }
  });

  const distractors = [];
  [...shuffle(samePartCandidates), ...shuffle(otherCandidates)].forEach(candidate => {
    if (distractors.length >= 3) return;
    const answerKey = normalizePracticeAnswer(candidate.word);
    if (usedAnswerKeys.has(answerKey)) return;
    usedAnswerKeys.add(answerKey);
    distractors.push({
      id: candidate.id,
      label: candidate.word,
      correct: false
    });
  });

  return shuffle([
    {
      id: word.id,
      label: word.word,
      correct: true
    },
    ...distractors
  ]);
}

function blankExamplePromptForWord(word) {
  const answer = String(word?.word || "").trim();
  if (!answer) return null;
  const pattern = blankAnswerPattern(answer);
  const examples = practiceExampleStrings(word);

  for (const example of examples) {
    const match = pattern.exec(example);
    if (!match) continue;
    const prefix = match[1] || "";
    const matchedAnswer = match[2] || "";
    const start = (match.index || 0) + prefix.length;
    const end = start + matchedAnswer.length;
    return {
      answer,
      fullExample: example,
      blankedHtml: `${escapeHtml(example.slice(0, start))}<span class="blank-placeholder">________</span>${escapeHtml(example.slice(end))}`
    };
  }

  return null;
}

function practiceExampleStrings(word) {
  return Array.isArray(word?.examples)
    ? word.examples.map(example => {
      if (example && typeof example === "object") {
        return stringValueFromClient(example.text || example.example || example.sentence || "");
      }
      return stringValueFromClient(example);
    }).filter(Boolean)
    : [];
}

function blankAnswerPattern(answer) {
  const escaped = escapeRegExp(answer).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Za-z0-9])(${escaped})(?=$|[^A-Za-z0-9])`, "i");
}

function wordsSharePartOfSpeech(a, b) {
  const first = partOfSpeechSet(a);
  if (!first.size) return false;
  return [...partOfSpeechSet(b)].some(part => first.has(part));
}

function partOfSpeechSet(word) {
  const parts = normalizePartOfSpeech(word)
    .flatMap(part => String(part).split(/[,;/]/))
    .map(part => part.trim().toLocaleLowerCase())
    .filter(Boolean);
  return new Set(parts);
}

function endPracticeSession() {
  state.practice.active = false;
  renderWords();
  refreshIcons();
}

function renderPracticePanel() {
  const practice = state.practice;
  if (practice.complete) {
    els.wordList.innerHTML = practiceSummaryHtml();
    return;
  }

  if (!practice.current) {
    els.wordList.innerHTML = `<div class="empty-state">No practice words</div>`;
    return;
  }

  const progress = practice.total ? Math.min(100, Math.round((practice.answered / practice.total) * 100)) : 0;
  const title = practice.mode === "blank-example"
    ? "Blank example practice"
    : practice.mode === "listen-write"
      ? "Listen + write practice"
      : practice.source === "review" ? "Review practice" : "Practice";
  const stageText = practice.result
    ? "Result"
    : practice.mode === "blank-example" ? "Fill the missing word"
      : practice.mode === "listen-write" ? "Listen and type"
      : practice.stage === "decide" ? "Read, then choose a path"
        : practice.stage === "choice" ? "Choose the word" : "Write the word";
  const detail = practice.source === "review" && practice.sessionMeta
    ? `${practice.sessionMeta.dueCount || 0} due, ${practice.sessionMeta.weakCount || 0} weak, ${practice.sessionMeta.newCount || 0} new - ${practice.correct} correct`
    : `${practice.correct} correct`;
  els.wordList.innerHTML = `
    <section class="practice-panel">
      <div class="practice-header">
        <div>
          <h3>${title}</h3>
          <p>${practice.answered} / ${practice.total} answered - ${stageText} - ${detail}</p>
        </div>
        <div class="practice-header-actions">
          ${practiceEditButtonHtml(practice.current)}
          <button class="ghost-button" type="button" data-end-practice>
            ${icon("list")}
            <span>Back to list</span>
          </button>
        </div>
      </div>
      <div class="practice-progress-track" aria-hidden="true">
        <span style="width: ${progress}%"></span>
      </div>
      <article class="practice-card">
        ${practiceWordCardHtml(practice.current)}
        ${practiceAnswerControlsHtml(practice.current)}
        ${practiceResultHtml()}
      </article>
    </section>
  `;
}

function practiceEditButtonHtml(word) {
  if (!word?.id) return "";
  return `
    <button class="ghost-button" type="button" data-edit-word="${escapeHtml(word.id)}" title="Edit current word" aria-label="Edit current word">
      ${icon("pencil")}
      <span>Edit word</span>
    </button>
  `;
}

function practiceWordCardHtml(word) {
  if (state.practice.mode === "blank-example") {
    return blankExampleWordCardHtml(word);
  }
  if (state.practice.mode === "listen-write") {
    return listeningPracticeWordCardHtml(word);
  }

  const reveal = Boolean(state.practice.result);
  return wordCardHtml(word, {
    controls: false,
    pronunciation: reveal,
    className: `practice-word-card ${reveal ? "answer-revealed" : "answer-hidden"}`,
    hideIpaPronunciationText: true,
    displayWord: reveal ? word.word : "Find the word",
    definition: reveal ? word.definition : maskAnswer(word.definition, word.word),
    collocations: reveal ? word.collocations : maskStringItems(word.collocations, word.word),
    examples: reveal ? word.examples : maskStringItems(word.examples, word.word),
    synonyms: reveal ? word.synonyms : maskSynonymItems(word.synonyms, word.word),
    thesaurus: reveal ? word.thesaurus : false,
    imageAlt: reveal ? word.word : ""
  });
}

function listeningPracticeWordCardHtml(word) {
  if (state.practice.result) {
    return wordCardHtml(word, {
      controls: false,
      pronunciation: false,
      hideIpaPronunciationText: true,
      className: "practice-word-card answer-revealed"
    });
  }

  return `
    <section class="listening-practice-card" aria-label="Listening spelling prompt">
      <div class="listening-practice-icon">${icon("headphones")}</div>
      <div>
        <h3>What word do you hear?</h3>
        <p>Play the sound again as many times as you need.</p>
      </div>
      <button class="primary-button listening-play-button" type="button" data-play-pronunciation="${escapeHtml(word.id)}">
        ${icon("volume-2")}
        <span>Play word</span>
      </button>
      ${wordHasIpaPronunciation(word) ? `
        <div class="listening-ipa-reveal">
          ${pronunciationTextHtml(word, { hideIpaByDefault: true })}
        </div>
      ` : ""}
    </section>
  `;
}

function blankExampleWordCardHtml(word) {
  const prompt = state.practice.blankPrompt || blankExamplePromptForWord(word);
  const reveal = Boolean(state.practice.result);
  return `
    <article class="blank-example-card">
      <div class="blank-example-header">
        <h3>${reveal ? escapeHtml(word.word) : "Fill the blank"}</h3>
        ${reveal ? pronunciationTextHtml(word, { hideIpaByDefault: true }) : ""}
        ${reveal ? partOfSpeechChips(word) : ""}
      </div>
      <section class="blank-example-section">
        <h4>Explanation</h4>
        <p>${escapeHtml(word.definition || "No definition saved")}</p>
      </section>
      <section class="blank-example-section">
        <h4>Example</h4>
        <p class="blank-example-text">${prompt?.blankedHtml || "No usable example found."}</p>
      </section>
      ${reveal && prompt?.fullExample ? `
        <section class="blank-example-section">
          <h4>Full example</h4>
          <p>${escapeHtml(prompt.fullExample)}</p>
        </section>
      ` : ""}
    </article>
  `;
}

function maskStringItems(items, answer) {
  return Array.isArray(items)
    ? items.map(item => maskAnswer(item, answer)).filter(Boolean)
    : [];
}

function maskSynonymItems(items, answer) {
  return Array.isArray(items)
    ? items.map(item => {
      if (item && typeof item === "object") {
        return {
          ...item,
          word: maskAnswer(item.word, answer),
          comparison: maskAnswer(item.comparison, answer)
        };
      }
      return maskAnswer(item, answer);
    }).filter(Boolean)
    : [];
}

function practiceAnswerControlsHtml() {
  if (state.practice.result) return "";
  if (state.practice.mode === "blank-example") return blankExampleAnswerHtml();
  if (state.practice.mode === "listen-write") return listeningPracticeAnswerHtml();
  if (state.practice.stage === "decide") return practiceDecisionHtml();
  return state.practice.stage === "choice" ? choicePracticeHtml() : typingPracticeHtml();
}

function practiceDecisionHtml() {
  const canShowChoices = state.practice.choices.length > 1;
  return `
    <section class="practice-decision-panel" aria-label="Choose practice path">
      <div class="practice-decision-heading">
        <strong>Ready?</strong>
        <span>Read first, then choose</span>
      </div>
      <div class="practice-decision-actions">
        <button class="primary-button shortcut-button" type="button" data-practice-write-direct title="Write directly (W)" aria-label="Write directly (W)">
          ${icon("keyboard")}
          <span>Write directly</span>
          ${shortcutHint("W")}
        </button>
        <button class="ghost-button shortcut-button" type="button" data-practice-show-choices ${canShowChoices ? "" : "disabled"} title="Show choices (C)" aria-label="Show choices (C)">
          ${icon("list-checks")}
          <span>Show choices</span>
          ${shortcutHint("C")}
        </button>
      </div>
      ${canShowChoices ? "" : `<p class="practice-decision-note">Not enough saved words to build choices for this card.</p>`}
    </section>
  `;
}

function choicePracticeHtml() {
  const practice = state.practice;
  const feedback = practice.choiceFeedback;
  const feedbackHtml = feedback
    ? `<p class="choice-feedback ${feedback.correct ? "correct" : "incorrect"}">${escapeHtml(feedback.message)}</p>`
    : "";
  return `
    <section class="choice-practice-panel" aria-label="Choose the word">
      <div class="choice-practice-heading">
        <strong>Choose the word</strong>
        <span>Use keys 1-4</span>
      </div>
      <div class="choice-grid">
        ${practice.choices.map((choice, index) => `
          <button class="choice-button ${feedback?.index === index ? "incorrect" : ""}" type="button" data-practice-choice="${index}">
            <span class="choice-key">${index + 1}</span>
            <span>${escapeHtml(choice.label)}</span>
          </button>
        `).join("")}
      </div>
      ${feedbackHtml}
    </section>
  `;
}

function typingPracticeHtml() {
  const disabled = state.practice.result ? "disabled" : "";
  return `
    <form class="practice-answer-row" data-practice-typing-form>
      <input id="practice-answer-input" type="text" autocomplete="off" placeholder="Type the word" ${disabled} />
      <button class="primary-button" type="submit" ${disabled}>
        ${icon("check")}
        <span>Check</span>
      </button>
    </form>
  `;
}

function blankExampleAnswerHtml() {
  const disabled = state.practice.result ? "disabled" : "";
  return `
    <form class="practice-answer-row" data-practice-typing-form>
      <input id="practice-answer-input" type="text" autocomplete="off" placeholder="Type the missing word" ${disabled} />
      <button class="primary-button" type="submit" ${disabled}>
        ${icon("check")}
        <span>Check</span>
      </button>
    </form>
  `;
}

function listeningPracticeAnswerHtml() {
  const disabled = state.practice.result ? "disabled" : "";
  return `
    <form class="practice-answer-row listening-answer-row" data-practice-typing-form>
      <input id="practice-answer-input" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Write the word you hear" aria-label="Write the word you hear" ${disabled} />
      <button class="primary-button" type="submit" ${disabled}>
        ${icon("check")}
        <span>Check</span>
      </button>
    </form>
  `;
}

function practiceResultHtml() {
  const result = state.practice.result;
  if (!result) return "";
  const word = state.practice.current;
  const resultClass = result.correct ? "correct" : "incorrect";
  const title = result.correct ? "Correct" : "Not yet";
  const guidance = state.practice.source === "review"
    ? result.correct ? "This word will come back later." : "This word stays in practice."
    : "";
  const buttonLabel = state.practice.queue.length ? "Next" : "Finish";
  const given = result.given ? `<span>Your answer: ${escapeHtml(result.given)}</span>` : "";
  return `
    <div class="practice-result ${resultClass}">
      <div>
        <strong>${title}</strong>
        <span>Answer: ${escapeHtml(word.word)}</span>
        ${pronunciationButtonHtml(word)}
        ${guidance ? `<span>${guidance}</span>` : ""}
        ${partOfSpeechChips(word)}
        ${given}
      </div>
      <button class="primary-button" type="button" data-practice-next>
        ${icon("arrow-right")}
        <span>${buttonLabel}</span>
      </button>
    </div>
  `;
}

function practiceSummaryHtml() {
  const practice = state.practice;
  const missed = Object.keys(practice.misses).length;
  const reviewPractice = practice.source === "review";
  const extraPractice = practice.source === "extra";
  const clean = Math.max(0, practice.words.length - missed);
  const modeTitle = practice.mode === "blank-example"
    ? "Blank example practice complete"
    : practice.mode === "listen-write" ? "Listen + write practice complete" : "Practice complete";
  const title = reviewPractice ? "Review complete" : extraPractice ? "Extra practice complete" : modeTitle;
  const summary = reviewPractice
    ? `${clean} ${clean === 1 ? "word is" : "words are"} ready for later`
    : `${practice.correct} correct from ${practice.answered} answers`;
  const addMoreValue = reviewWordCount();
  return `
    <section class="practice-panel">
      <div class="practice-summary">
        <span>${icon("trophy")}</span>
        <h3>${title}</h3>
        <p>${summary}</p>
        <p>${missed} ${missed === 1 ? "word" : "words"} repeated</p>
        <div class="practice-actions">
          <button class="primary-button" type="button" data-practice-same>
            ${icon("rotate-ccw")}
            <span>Practice same words</span>
          </button>
          ${missed ? `
            <button class="ghost-button" type="button" data-practice-weak>
              ${icon("target")}
              <span>Practice weak words</span>
            </button>
          ` : ""}
          <label class="number-control summary-number-control">
            <span>Add words</span>
            <input id="add-more-count" type="number" min="1" max="50" step="1" value="${addMoreValue}" />
          </label>
          <button class="ghost-button" type="button" data-add-more-review>
            ${icon("plus")}
            <span>Add more</span>
          </button>
          <button class="ghost-button" type="button" data-end-practice>
            ${icon("list")}
            <span>Back to list</span>
          </button>
        </div>
      </div>
    </section>
  `;
}

function submitPracticeAnswer(answer) {
  const word = state.practice.current;
  if (!word || state.practice.result) return;
  if (!["typing", "blank"].includes(state.practice.stage)) return;
  const correct = normalizePracticeAnswer(answer) === normalizePracticeAnswer(word.word);
  completePracticeAnswer(correct, answer);
}

function startPracticeChoiceStage() {
  const practice = state.practice;
  if (!practice.current || practice.result || practice.stage !== "decide") return;
  if (practice.choices.length < 2) {
    showToast("Not enough choices for this word", true);
    return;
  }
  practice.stage = "choice";
  practice.choiceFeedback = null;
  renderWords();
  refreshIcons();
  focusPracticeAnswerInput();
}

function startPracticeTypingStage() {
  const practice = state.practice;
  if (!practice.current || practice.result || !["decide", "choice"].includes(practice.stage)) return;
  practice.stage = "typing";
  practice.choiceFeedback = null;
  renderWords();
  refreshIcons();
  focusPracticeAnswerInput();
}

function choosePracticeChoice(index) {
  const practice = state.practice;
  if (!practice.current || practice.result || practice.stage !== "choice") return;
  const choice = practice.choices[index];
  if (!choice) return;

  if (choice.correct) {
    practice.stage = "typing";
    practice.choiceFeedback = null;
    renderWords();
    refreshIcons();
    focusPracticeAnswerInput();
    return;
  }

  practice.choiceFeedback = {
    index,
    correct: false,
    message: "Not this one. Try another choice."
  };
  renderWords();
  refreshIcons();
  focusPracticeChoiceButton(index);
}

function focusPracticeChoiceButton(index = 0) {
  requestAnimationFrame(() => {
    const button = els.wordList.querySelector(`[data-practice-choice="${index}"]`) ||
      els.wordList.querySelector("[data-practice-choice]");
    button?.focus?.({ preventScroll: true });
  });
}

function completePracticeAnswer(correct, given = "") {
  const practice = state.practice;
  if (!practice.current || practice.result) return;

  const word = practice.current;
  practice.answered += 1;
  if (correct) {
    practice.correct += 1;
  } else {
    requeuePracticeWord(word);
  }
  practice.result = { correct, given };
  if (practice.saveProgress) {
    recordPracticeAnswer(word.id, correct);
  }
  renderWords();
  refreshIcons();
}

function recordPracticeAnswer(wordId, correct) {
  practiceProgressQueue = practiceProgressQueue
    .catch(() => {})
    .then(() => api("/api/practice/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordId, correct }),
      keepalive: true
    }));

  practiceProgressQueue.catch(() => {
    showToast("Practice progress was not saved", true);
  });
}

function nextPracticeWord() {
  const practice = state.practice;
  if (!practice.queue.length) {
    practice.current = null;
    practice.result = null;
    practice.complete = true;
    completeReviewPracticeSession();
    return;
  }

  practice.current = practice.queue.shift();
  practice.result = null;
  practice.stage = practice.mode === "blank-example"
    ? "blank"
    : practice.mode === "listen-write" ? "typing" : "decide";
  practice.choices = practice.mode === "choice-write" ? buildPracticeChoices(practice.current, practice.words) : [];
  practice.blankPrompt = practice.mode === "blank-example" ? blankExamplePromptForWord(practice.current) : null;
  practice.choiceFeedback = null;
  practice.complete = false;
}

function playCurrentListeningWord() {
  if (!state.practice.active || state.practice.complete || state.practice.result || state.practice.mode !== "listen-write") return;
  const word = state.practice.current;
  if (!word || !hasPracticeAudio(word)) return;
  requestAnimationFrame(() => {
    if (state.practice.current?.id !== word.id || state.practice.result) return;
    playAudioUrl(word.pronunciation.audioUrl);
  });
}

function completeReviewPracticeSession() {
  const practice = state.practice;
  if (practice.source !== "review" || !practice.sessionId || practice.sessionCompleted) return;
  practice.sessionCompleted = true;
  practiceProgressQueue = practiceProgressQueue
    .catch(() => {})
    .then(() => api(`/api/review/sessions/${practice.sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true
    }));
  practiceProgressQueue.catch(() => {
    showToast("Review session was not saved", true);
  });
}

function extraPracticeOptions() {
  return {
    source: "extra",
    sessionMeta: state.practice.sessionMeta,
    mode: state.practice.mode || "choice-write",
    saveProgress: false
  };
}

function practiceSameWordsAgain() {
  startPracticeSession(state.practice.words, extraPracticeOptions()).catch(error => showToast(error.message, true));
}

function practiceWeakWordsAgain() {
  const practice = state.practice;
  const missedIds = new Set(Object.keys(practice.misses));
  const words = practice.words.filter(word => missedIds.has(word.id));
  if (!words.length) {
    showToast("No weak words in this practice");
    return;
  }
  startPracticeSession(words, extraPracticeOptions()).catch(error => showToast(error.message, true));
}

async function addMoreReviewWords() {
  const target = wordCountInputValue("#add-more-count", reviewWordCount());
  await practiceProgressQueue.catch(() => {});
  await startReviewSession({ target });
}

function requeuePracticeWord(word) {
  const practice = state.practice;
  const misses = practice.misses[word.id] || 0;
  if (misses >= 2) return;
  practice.misses[word.id] = misses + 1;
  const index = Math.min(practice.queue.length, 2 + Math.floor(Math.random() * 3));
  practice.queue.splice(index, 0, word);
  practice.total += 1;
}

function normalizePracticeAnswer(value) {
  return String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function maskAnswer(text, answer) {
  const value = String(text || "");
  const target = String(answer || "").trim();
  if (!target) return value;
  return value.replace(new RegExp(escapeRegExp(target), "gi"), "_____");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringValueFromClient(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedListeningTopicKey(value) {
  return stringValueFromClient(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function wordSearchStrings(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(item => wordSearchStrings(item));
  if (typeof value === "object") return Object.values(value).flatMap(item => wordSearchStrings(item));
  return [String(value)];
}

function wordSearchSegments(word) {
  const thesaurus = word.thesaurus && typeof word.thesaurus === "object" ? word.thesaurus : {};
  const synonyms = word.synonyms?.length ? word.synonyms : thesaurus.synonyms;
  return [
    { label: "word", text: word.word },
    { label: "definition", text: word.definition },
    { label: "Arabic translation", text: word.arabicTranslation },
    { label: "part of speech", text: normalizePartOfSpeech(word).join(" ") },
    { label: "collocations", text: wordSearchStrings(word.collocations).join(" ") },
    { label: "examples", text: wordSearchStrings(word.examples).join(" ") },
    { label: "synonyms", text: wordSearchStrings(synonyms).join(" ") },
    { label: "thesaurus", text: wordSearchStrings(thesaurus).join(" ") }
  ].filter(segment => stringValueFromClient(segment.text));
}

function wordSearchHaystack(word) {
  return normalizedSearchText(wordSearchSegments(word).map(segment => segment.text).join(" "));
}

function wordMatchesSearchQuery(word, query) {
  const normalizedQuery = normalizedSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = wordSearchHaystack(word);
  return haystack.includes(normalizedQuery) || wordSearchTerms(normalizedQuery).every(term => haystack.includes(term));
}

function wordSearchMatch(word, query) {
  const normalizedQuery = normalizedSearchText(query);
  if (!normalizedQuery) return null;
  const terms = wordSearchTerms(normalizedQuery);
  const segments = wordSearchSegments(word);

  const exactSegment = segments.find(segment => normalizedSearchText(segment.text).includes(normalizedQuery));
  if (exactSegment) {
    return {
      label: exactSegment.label,
      excerpt: wordSearchExcerpt(exactSegment.text, normalizedQuery)
    };
  }

  const termSegment = segments
    .map(segment => ({
      segment,
      score: terms.filter(term => normalizedSearchText(segment.text).includes(term)).length
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.segment;

  return termSegment
    ? { label: termSegment.label, excerpt: wordSearchExcerpt(termSegment.text, terms) }
    : null;
}

function wordSearchScore(word, query) {
  const normalizedQuery = normalizedSearchText(query);
  if (!normalizedQuery) return 0;
  const terms = wordSearchTerms(normalizedQuery);
  const segmentWeights = {
    word: 700,
    definition: 420,
    "Arabic translation": 390,
    collocations: 340,
    examples: 300,
    synonyms: 260,
    thesaurus: 180,
    "part of speech": 120
  };

  return wordSearchSegments(word).reduce((score, segment) => {
    const text = normalizedSearchText(segment.text);
    if (!text) return score;
    const weight = segmentWeights[segment.label] || 100;
    let nextScore = score;
    if (segment.label === "word" && text === normalizedQuery) nextScore += 1200;
    if (segment.label === "word" && text.startsWith(normalizedQuery)) nextScore += 900;
    if (text.includes(normalizedQuery)) nextScore += weight;
    nextScore += terms.filter(term => text.includes(term)).length * Math.round(weight / 6);
    return nextScore;
  }, 0);
}

function wordSearchExcerpt(text, queryOrTerms) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= 170) return value;

  const normalizedValue = normalizedSearchText(value);
  const terms = Array.isArray(queryOrTerms) ? queryOrTerms : [queryOrTerms];
  const matchIndex = terms
    .map(term => normalizedValue.indexOf(term))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, matchIndex - 54);
  const end = Math.min(value.length, start + 170);
  return `${start > 0 ? "... " : ""}${value.slice(start, end).trim()}${end < value.length ? " ..." : ""}`;
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function hasArabicTranslation(word) {
  return Boolean(String(word?.arabicTranslation || "").trim());
}

function getFilteredWords() {
  const search = state.filters.search.trim();
  const from = state.filters.from ? new Date(`${state.filters.from}T00:00:00`) : null;
  const to = state.filters.to ? new Date(`${state.filters.to}T23:59:59`) : null;

  return [...state.db.words]
    .filter(word => {
      if (!isVaultRecordLocation(word)) return false;
      const createdAt = new Date(word.createdAt);

      return wordMatchesSearchQuery(word, search) &&
        (!from || createdAt >= from) &&
        (!to || createdAt <= to) &&
        wordMatchesLocationFilter(word, state.filters) &&
        (!state.filters.partOfSpeech || normalizePartOfSpeech(word).includes(state.filters.partOfSpeech)) &&
        (!state.filters.arabic ||
          (state.filters.arabic === "with" ? hasArabicTranslation(word) : !hasArabicTranslation(word)));
    })
    .sort((a, b) => {
      const scoreDiff = wordSearchScore(b, search) - wordSearchScore(a, search);
      if (scoreDiff) return scoreDiff;
      const wordDiff = normalizePracticeAnswer(a.word).localeCompare(normalizePracticeAnswer(b.word));
      return wordDiff || new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function getFilteredStudyTexts() {
  const search = state.studyFilters.search.trim().toLowerCase();
  return [...(state.db.studyTexts || [])]
    .filter(text => {
      if (!isVaultRecordLocation(text)) return false;
      const searchable = [
        text.title,
        text.content,
        studyTextTypeLabel(text.type),
        getPathLabel(text)
      ].join(" ").toLowerCase();

      return (!search || searchable.includes(search)) &&
        (!state.studyFilters.sourceId || text.sourceId === state.studyFilters.sourceId) &&
        (!state.studyFilters.branchId || text.branchId === state.studyFilters.branchId) &&
        (!state.studyFilters.unitId || text.unitId === state.studyFilters.unitId) &&
        (!state.studyFilters.type || text.type === state.studyFilters.type);
    })
    .sort((a, b) => {
      const updatedDiff = new Date(b.updatedAt) - new Date(a.updatedAt);
      return updatedDiff || normalizePracticeAnswer(a.title).localeCompare(normalizePracticeAnswer(b.title));
    });
}

function getFilteredStudyVideos() {
  const search = state.videoFilters.search.trim().toLowerCase();
  return [...(state.db.studyVideos || [])]
    .filter(video => {
      if (!isVaultRecordLocation(video)) return false;
      const searchable = [
        video.title,
        studyVideoTypeLabel(video.type),
        getPathLabel(video),
        video.video?.originalName
      ].join(" ").toLowerCase();

      return (!search || searchable.includes(search)) &&
        (!state.videoFilters.sourceId || video.sourceId === state.videoFilters.sourceId) &&
        (!state.videoFilters.branchId || video.branchId === state.videoFilters.branchId) &&
        (!state.videoFilters.unitId || video.unitId === state.videoFilters.unitId) &&
        (!state.videoFilters.type || video.type === state.videoFilters.type);
    })
    .sort((a, b) => {
      const updatedDiff = new Date(b.updatedAt) - new Date(a.updatedAt);
      return updatedDiff || normalizePracticeAnswer(a.title).localeCompare(normalizePracticeAnswer(b.title));
    });
}

function getFilteredNationalTests() {
  const search = isNationalTestFocusMode() ? "" : normalizedSearchText(state.nationalTestFilters.search);
  return [...(state.db.nationalTests || [])]
    .filter(test => {
      if (!search) return true;
      const searchableMetadata = [
        test.title,
        test.description,
        test.course,
        test.term,
        test.year,
        getPathLabel(test)
      ].join(" ");
      const normalizedSearchable = normalizedSearchText(searchableMetadata);
      if (normalizedSearchable.includes(search)) return true;
      const terms = wordSearchTerms(search);
      if (terms.length > 1 && terms.every(term => normalizedSearchable.includes(term))) return true;
      return searchNationalTestPages(test, search).length > 0;
    })
    .sort((a, b) => {
      const yearDiff = Number(b.year || 0) - Number(a.year || 0);
      const createdDiff = new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return yearDiff || createdDiff || normalizePracticeAnswer(a.title).localeCompare(normalizePracticeAnswer(b.title));
    });
}

function studyTextTypeLabel(value) {
  return STUDY_TEXT_TYPES.find(type => type.value === value)?.label || "Note";
}

function studyVideoTypeLabel(value) {
  return STUDY_VIDEO_TYPES.find(type => type.value === value)?.label || "Assignment";
}

function essayFieldInputs() {
  return {
    sources: els.essaySources,
    plan: els.essayPlan,
    hook: els.essayHook,
    thesis: els.essayThesis,
    conclusion: els.essayConclusion
  };
}

function essayBodyParagraphTextareas() {
  return Array.from(els.essayBodyParagraphs?.querySelectorAll("[data-essay-body-field]") || []);
}

function essayAllFieldInputs() {
  return [
    ...Object.values(essayFieldInputs()).filter(Boolean),
    ...essayBodyParagraphTextareas()
  ];
}

function essayBodyParagraphCountFromValue(value, fallback = ESSAY_BODY_PARAGRAPH_MIN) {
  const parsed = Number.parseInt(value, 10);
  const count = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(ESSAY_BODY_PARAGRAPH_MAX, Math.max(ESSAY_BODY_PARAGRAPH_MIN, count));
}

function essayBodyParagraphCountFromForm() {
  return essayBodyParagraphCountFromValue(els.essayBodyParagraphCount?.value);
}

function essaySupportCountFromValue(value, fallback = ESSAY_SUPPORT_MIN) {
  const parsed = Number.parseInt(value, 10);
  const count = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(ESSAY_SUPPORT_MAX, Math.max(ESSAY_SUPPORT_MIN, count));
}

function emptyEssaySupport() {
  return {
    ownWords: "",
    source: "",
    comment: ""
  };
}

function normalizeEssaySupport(value = {}) {
  const support = value && typeof value === "object" ? value : {};
  return {
    ownWords: stringValueFromClient(support.ownWords || support.supportOwn),
    source: stringValueFromClient(support.source || support.supportSource),
    comment: stringValueFromClient(support.comment || support.supportComment || support.yourWords)
  };
}

function essaySupportHasContent(support = {}) {
  return ESSAY_SUPPORT_FIELDS.some(key => stringValueFromClient(support[key]));
}

function essaySupportsHaveContent(supports = []) {
  return Array.isArray(supports) && supports.some(essaySupportHasContent);
}

function essaySupportListForCount(supports = [], count = ESSAY_SUPPORT_MIN) {
  const normalizedCount = essaySupportCountFromValue(count, supports.length || ESSAY_SUPPORT_MIN);
  return Array.from({ length: normalizedCount }, (_, index) => normalizeEssaySupport(supports[index] || {}));
}

function emptyEssayBodyParagraph() {
  return {
    idea: "",
    sourceExample: "",
    anotherReason: "",
    wrapUp: ""
  };
}

function normalizeEssayBodyParagraph(value = {}) {
  const paragraph = value && typeof value === "object" ? value : {};
  const savedSupports = Array.isArray(paragraph.supports)
    ? paragraph.supports.map(normalizeEssaySupport)
    : [];
  const legacySupport = normalizeEssaySupport({
    ownWords: paragraph.supportOwn,
    source: paragraph.supportSource,
    comment: paragraph.supportComment
  });
  const supportSource = essaySupportsHaveContent(savedSupports)
    ? savedSupports
    : essaySupportHasContent(legacySupport)
      ? [legacySupport]
      : savedSupports;
  const supportCount = essaySupportCountFromValue(paragraph.supportCount, supportSource.length || ESSAY_SUPPORT_MIN);
  const firstSupport = essaySupportListForCount(supportSource, supportCount)[0] || emptyEssaySupport();
  return {
    idea: stringValueFromClient(paragraph.idea || paragraph.topicSentence),
    sourceExample: stringValueFromClient(paragraph.sourceExample || paragraph.supportExample || firstSupport.source || firstSupport.ownWords || paragraph.supportSource),
    anotherReason: stringValueFromClient(paragraph.anotherReason || paragraph.secondExample || paragraph.explain || firstSupport.comment || paragraph.supportComment),
    wrapUp: stringValueFromClient(paragraph.wrapUp || paragraph.bodyConclusion)
  };
}

function essayBodyParagraphHasContent(paragraph = {}) {
  return ESSAY_BODY_PARAGRAPH_FIELDS.some(key => stringValueFromClient(paragraph[key]))
    || Boolean(stringValueFromClient(paragraph.topicSentence))
    || Boolean(stringValueFromClient(paragraph.explain))
    || Boolean(stringValueFromClient(paragraph.bodyConclusion))
    || essaySupportsHaveContent(paragraph.supports)
    || Boolean(stringValueFromClient(paragraph.supportOwn))
    || Boolean(stringValueFromClient(paragraph.supportSource))
    || Boolean(stringValueFromClient(paragraph.supportComment));
}

function essayBodyParagraphsHaveContent(paragraphs = []) {
  return Array.isArray(paragraphs) && paragraphs.some(essayBodyParagraphHasContent);
}

function essayBodyParagraphListForCount(paragraphs = [], count = ESSAY_BODY_PARAGRAPH_MIN) {
  const normalizedCount = essayBodyParagraphCountFromValue(count, paragraphs.length || ESSAY_BODY_PARAGRAPH_MIN);
  return Array.from({ length: normalizedCount }, (_, index) => normalizeEssayBodyParagraph(paragraphs[index] || {}));
}

function essayBodyParagraphValuesFromForm() {
  const count = essayBodyParagraphCountFromForm();
  const paragraphs = essayBodyParagraphListForCount([], count);
  essayBodyParagraphTextareas().forEach(input => {
    const index = Number.parseInt(input.dataset.essayBodyIndex, 10);
    if (!Number.isInteger(index)) return;
    paragraphs[index] = paragraphs[index] || emptyEssayBodyParagraph();
    const bodyKey = input.dataset.essayBodyField;
    if (ESSAY_BODY_PARAGRAPH_FIELDS.includes(bodyKey)) {
      paragraphs[index][bodyKey] = stringValueFromClient(input.value);
    }
  });
  return paragraphs;
}

function essayFieldsFromForm() {
  const fields = Object.fromEntries(Object.entries(essayFieldInputs())
    .map(([key, input]) => [key, stringValueFromClient(input?.value)]));
  const bodyParagraphCount = essayBodyParagraphCountFromForm();
  return {
    ...fields,
    bodyParagraphCount,
    bodyParagraphs: essayBodyParagraphValuesFromForm()
  };
}

function essayHasStructuredFields(fields = {}) {
  const values = fields && typeof fields === "object" ? fields : {};
  return [
    "sources",
    "plan",
    "hook",
    "thesis",
    "idea",
    "sourceExample",
    "anotherReason",
    "wrapUp",
    "supportOwn",
    "supportSource",
    "supportComment",
    "topicSentence",
    "explain",
    "bodyConclusion",
    "conclusion"
  ].some(key => stringValueFromClient(values[key])) || essayBodyParagraphsHaveContent(values.bodyParagraphs);
}

function essayLegacyFieldsFromContent(content = "") {
  const paragraphs = stringValueFromClient(content)
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .filter(Boolean);
  const bodyBlocks = paragraphs.slice(2);
  let conclusion = "";
  let legacyBodyBlockSize = 4;
  if (bodyBlocks.length % 4 !== 0 && bodyBlocks.length % 6 === 0) {
    legacyBodyBlockSize = 6;
  } else if (bodyBlocks.length > 4 && bodyBlocks.length % 4 !== 1 && bodyBlocks.length % 6 === 1) {
    legacyBodyBlockSize = 6;
  }
  if (bodyBlocks.length > legacyBodyBlockSize && bodyBlocks.length % legacyBodyBlockSize === 1) {
    conclusion = bodyBlocks.pop();
  }
  const bodyParagraphs = [];
  for (let index = 0; index < bodyBlocks.length; index += legacyBodyBlockSize) {
    const chunk = bodyBlocks.slice(index, index + legacyBodyBlockSize);
    if (!chunk.length) continue;
    const bodyParagraph = legacyBodyBlockSize === 6
      ? {
          idea: chunk[0] || "",
          sourceExample: chunk[3] || chunk[2] || "",
          anotherReason: [chunk[1], chunk[4]].filter(Boolean).join("\n\n"),
          wrapUp: chunk[5] || ""
        }
      : {
          idea: chunk[0] || "",
          sourceExample: chunk[1] || "",
          anotherReason: chunk[2] || "",
          wrapUp: chunk[3] || ""
        };
    bodyParagraphs.push(normalizeEssayBodyParagraph({
      ...bodyParagraph
    }));
  }
  const firstBodyParagraph = bodyParagraphs[0] || emptyEssayBodyParagraph();
  return {
    hook: paragraphs[0] || "",
    thesis: paragraphs[1] || "",
    idea: firstBodyParagraph.idea,
    sourceExample: firstBodyParagraph.sourceExample,
    anotherReason: firstBodyParagraph.anotherReason,
    wrapUp: firstBodyParagraph.wrapUp,
    bodyParagraphCount: bodyParagraphs.length || ESSAY_BODY_PARAGRAPH_MIN,
    bodyParagraphs: bodyParagraphs.length ? bodyParagraphs : [emptyEssayBodyParagraph()],
    conclusion
  };
}

function essayBodyParagraphsFromFields(values = {}, legacyContentValues = {}, legacyBody = {}) {
  const savedParagraphs = Array.isArray(values.bodyParagraphs)
    ? values.bodyParagraphs.map(normalizeEssayBodyParagraph)
    : [];
  if (essayBodyParagraphsHaveContent(savedParagraphs)) return savedParagraphs;
  if (essayBodyParagraphsHaveContent(legacyContentValues.bodyParagraphs)) {
    return legacyContentValues.bodyParagraphs.map(normalizeEssayBodyParagraph);
  }
  const legacyParagraph = normalizeEssayBodyParagraph({
    idea: values.idea || values.topicSentence || legacyBody.state || legacyContentValues.idea || legacyContentValues.topicSentence,
    sourceExample: values.sourceExample || values.supportSource || legacyBody.supportSource || legacyContentValues.sourceExample || legacyContentValues.supportSource || values.research,
    anotherReason: values.anotherReason || values.explain || values.supportOwn || legacyBody.explain || legacyBody.supportBefore || legacyBody.supportAfter || legacyContentValues.anotherReason || legacyContentValues.explain || legacyContentValues.supportOwn || values.body,
    wrapUp: values.wrapUp || values.bodyConclusion || legacyBody.conclude || legacyContentValues.wrapUp || legacyContentValues.bodyConclusion,
    supportOwn: values.supportOwn || legacyBody.supportBefore || legacyContentValues.supportOwn || values.body,
    supportSource: values.supportSource || legacyBody.supportSource || legacyContentValues.supportSource || values.research,
    supportComment: values.supportComment || legacyBody.supportAfter || legacyContentValues.supportComment,
    bodyConclusion: values.bodyConclusion || legacyBody.conclude || legacyContentValues.bodyConclusion
  });
  return essayBodyParagraphHasContent(legacyParagraph) ? [legacyParagraph] : [emptyEssayBodyParagraph()];
}

function essayStarterChipsHtml(index, key) {
  const starters = ESSAY_BODY_STARTERS[key] || [];
  if (!starters.length) return "";
  return `
    <div class="essay-starter-row" aria-label="${escapeHtml(labelForEssayStarterKey(key))} starters">
      <span>Starters</span>
      <div>
        ${starters.map(starter => `
          <button type="button" data-essay-starter="${escapeHtml(starter)}" data-essay-body-index="${index}" data-essay-body-field-key="${escapeHtml(key)}">${escapeHtml(starter)}</button>
        `).join("")}
      </div>
    </div>
  `;
}

function labelForEssayStarterKey(key) {
  if (key === "idea") return "Write your idea";
  if (key === "sourceExample") return "Source or example";
  if (key === "anotherReason") return "Another reason or example";
  if (key === "wrapUp") return "Summarize and wrap up";
  return "Body paragraph";
}

function essayBodyParagraphFieldHtml(index, key, label, hint, rows, placeholder, value, options = {}) {
  const classes = classNames("essay-body-frame-field", options.className || "");
  return `
    <label class="${classes}">
      <span>${escapeHtml(label)}</span>
      ${hint ? `<p class="essay-field-hint">${escapeHtml(hint)}</p>` : ""}
      ${essayStarterChipsHtml(index, key)}
      <small class="essay-word-count" data-essay-body-word-count-for="${escapeHtml(key)}" data-essay-body-index="${index}">${essayWordCountText(value)}</small>
      <textarea data-essay-body-index="${index}" data-essay-body-field="${escapeHtml(key)}" rows="${rows}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
    </label>
  `;
}

function essayBodyParagraphHtml(paragraph, index) {
  const values = normalizeEssayBodyParagraph(paragraph);
  return `
    <details class="essay-structure-section essay-structure-body" data-essay-body-paragraph="${index}" open>
      <summary class="essay-section-summary essay-body-summary">
        <span>Paragraph ${index + 1}</span>
        <small data-essay-section-status="body-${index}">0/4 steps</small>
      </summary>
      <div class="essay-section-content essay-body-frame-content">
        <div class="essay-body-frame" aria-label="Body paragraph writing frame">
          <div class="essay-body-frame-label">Body</div>
          <div class="essay-body-frame-paragraph-label">paragraph ${index + 1}</div>
          <div class="essay-body-frame-grid">
            <div class="essay-body-frame-top">
              ${essayBodyParagraphFieldHtml(
                index,
                "idea",
                "Write your idea",
                "",
                2,
                "Write your idea.",
                values.idea,
                { className: "essay-body-frame-idea" }
              )}
            </div>
            ${essayBodyParagraphFieldHtml(
              index,
              "sourceExample",
              "Source or example",
              "",
              3,
              "Give source or example to support your idea.",
              values.sourceExample,
              { className: "essay-body-frame-wide" }
            )}
            ${essayBodyParagraphFieldHtml(
              index,
              "anotherReason",
              "Another reason or example",
              "",
              3,
              "Give another reason or example to support your idea.",
              values.anotherReason,
              { className: "essay-body-frame-wide" }
            )}
            <div class="essay-body-frame-bottom">
              ${essayBodyParagraphFieldHtml(
                index,
                "wrapUp",
                "Summarize and wrap up sentence",
                "",
                2,
                "Start clearly, ... etc.",
                values.wrapUp,
                { className: "essay-body-frame-wrap" }
              )}
            </div>
          </div>
        </div>
      </div>
    </details>
  `;
}

function renderEssayBodyParagraphFields(paragraphs = [], count = paragraphs.length || ESSAY_BODY_PARAGRAPH_MIN) {
  if (!els.essayBodyParagraphs) return;
  const bodyParagraphs = essayBodyParagraphListForCount(paragraphs, count);
  els.essayBodyParagraphs.innerHTML = bodyParagraphs
    .map((paragraph, index) => essayBodyParagraphHtml(paragraph, index))
    .join("");
  if (els.essayBodyParagraphCount) {
    els.essayBodyParagraphCount.value = String(bodyParagraphs.length);
  }
}

function setEssayFields(fields = {}, fallbackContent = "", options = {}) {
  const values = fields && typeof fields === "object" ? fields : {};
  const hasStructuredFields = essayHasStructuredFields(values);
  const legacyContentValues = !hasStructuredFields && fallbackContent
    ? essayLegacyFieldsFromContent(fallbackContent)
    : {};
  const legacyBody = essayBodyPositionMap(values.body);
  const bodyParagraphs = essayBodyParagraphsFromFields(values, legacyContentValues, legacyBody);
  const bodyParagraphCount = essayBodyParagraphCountFromValue(
    values.bodyParagraphCount || legacyContentValues.bodyParagraphCount || bodyParagraphs.length,
    bodyParagraphs.length || ESSAY_BODY_PARAGRAPH_MIN
  );
  const normalizedValues = {
    sources: values.sources || legacyContentValues.sources,
    plan: values.plan || legacyContentValues.plan,
    hook: values.hook || values.introduction || legacyContentValues.hook,
    thesis: values.thesis || legacyContentValues.thesis,
    bodyParagraphCount,
    bodyParagraphs: essayBodyParagraphListForCount(bodyParagraphs, bodyParagraphCount),
    conclusion: values.conclusion || legacyContentValues.conclusion
  };
  state.essayLegacyEditUnlocked = Boolean(options.editing && !hasStructuredFields && fallbackContent);
  Object.entries(essayFieldInputs()).forEach(([key, input]) => {
    input.value = stringValueFromClient(normalizedValues[key]);
  });
  renderEssayBodyParagraphFields(normalizedValues.bodyParagraphs, normalizedValues.bodyParagraphCount);
  refreshStudyTextareaSizes();
  renderEssayReadiness();
}

function clearEssayFields() {
  state.essayLegacyEditUnlocked = false;
  Object.values(essayFieldInputs()).forEach(input => {
    input.value = "";
  });
  renderEssayBodyParagraphFields([emptyEssayBodyParagraph()], ESSAY_BODY_PARAGRAPH_MIN);
  refreshStudyTextareaSizes();
  renderEssayReadiness();
}

function essayFieldsHaveContent(fields) {
  const values = fields && typeof fields === "object" ? fields : {};
  return [
    "sources",
    "hook",
    "thesis",
    "idea",
    "sourceExample",
    "anotherReason",
    "wrapUp",
    "topicSentence",
    "explain",
    "supportOwn",
    "supportSource",
    "supportComment",
    "bodyConclusion",
    "conclusion"
  ].some(key => stringValueFromClient(values[key])) || essayBodyParagraphsHaveContent(values.bodyParagraphs);
}

function essayWordCount(value) {
  return stringValueFromClient(value).split(/\s+/).filter(Boolean).length;
}

function essayWordCountText(value) {
  const count = essayWordCount(value);
  return `${count} ${count === 1 ? "word" : "words"}`;
}

function renderEssayWordCounts(fields = essayFieldsFromForm()) {
  if (!els.essayBuilder) return;
  els.essayBuilder.querySelectorAll("[data-essay-word-count-for]").forEach(counter => {
    const key = counter.dataset.essayWordCountFor;
    counter.textContent = essayWordCountText(fields[key]);
  });
  els.essayBuilder.querySelectorAll("[data-essay-body-word-count-for]").forEach(counter => {
    const index = Number.parseInt(counter.dataset.essayBodyIndex, 10);
    const key = counter.dataset.essayBodyWordCountFor;
    counter.textContent = essayWordCountText(fields.bodyParagraphs?.[index]?.[key]);
  });
  if (els.essayTotalWordCount) {
    els.essayTotalWordCount.textContent = essayWordCountText(essayContentFromFields(fields));
  }
  els.essayBuilder.querySelectorAll("[data-essay-planning-status]").forEach(counter => {
    const key = counter.dataset.essayPlanningStatus;
    counter.textContent = essayWordCountText(fields[key]);
  });
}

function essayHasTemplatePlaceholders(value) {
  return /\.{3}|\[[^\]]+\]/.test(stringValueFromClient(value));
}

function essayValueReady(value) {
  const text = stringValueFromClient(value);
  return Boolean(text) && !essayHasTemplatePlaceholders(text);
}

function essayThesisReady(fields) {
  return essayValueReady(fields?.thesis);
}

function essayIntroLeadReady(fields) {
  return essayValueReady(fields?.hook);
}

function essayConclusionReady(fields) {
  return essayValueReady(fields?.conclusion);
}

function essayBodyParagraphReady(paragraph) {
  return ESSAY_BODY_PARAGRAPH_FIELDS.every(key => essayValueReady(paragraph?.[key]));
}

function essayBodyParagraphProgress(paragraph) {
  const normalized = normalizeEssayBodyParagraph(paragraph);
  const values = ESSAY_BODY_PARAGRAPH_FIELDS.map(key => normalized[key]);
  const complete = values.filter(essayValueReady).length;
  return {
    complete,
    total: values.length,
    ready: values.length > 0 && complete === values.length,
    touched: values.some(value => Boolean(stringValueFromClient(value)))
  };
}

function essayBodyParagraphsReady(fields) {
  const paragraphs = essayBodyParagraphListForCount(
    fields?.bodyParagraphs,
    fields?.bodyParagraphCount || fields?.bodyParagraphs?.length || ESSAY_BODY_PARAGRAPH_MIN
  );
  return paragraphs.every(essayBodyParagraphReady);
}

function essayWorkflowState(fields = essayFieldsFromForm()) {
  const thesisReady = essayThesisReady(fields);
  const introReady = thesisReady && essayIntroLeadReady(fields);
  const bodyReady = introReady && essayBodyParagraphsReady(fields);
  const conclusionReady = bodyReady && essayConclusionReady(fields);
  return {
    thesisReady,
    introReady,
    bodyReady,
    conclusionReady
  };
}

function essayCurrentStepKey(fields = essayFieldsFromForm()) {
  if (!essayValueReady(fields?.hook)) return "field:hook";
  if (!essayValueReady(fields?.thesis)) return "field:thesis";
  const paragraphs = essayBodyParagraphListForCount(
    fields?.bodyParagraphs,
    fields?.bodyParagraphCount || fields?.bodyParagraphs?.length || ESSAY_BODY_PARAGRAPH_MIN
  );
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    for (const key of ESSAY_BODY_PARAGRAPH_FIELDS) {
      if (!essayValueReady(paragraph[key])) return `body:${paragraphIndex}:${key}`;
    }
  }
  if (!essayValueReady(fields?.conclusion)) return "field:conclusion";
  return "";
}

function essayInputStepKey(input) {
  if (!input) return "";
  if (input === els.essayThesis) return "field:thesis";
  if (input === els.essayHook) return "field:hook";
  if (input === els.essayConclusion) return "field:conclusion";
  const paragraphIndex = Number.parseInt(input.dataset.essayBodyIndex, 10);
  if (!Number.isInteger(paragraphIndex)) return "";
  const bodyKey = input.dataset.essayBodyField;
  if (bodyKey) return `body:${paragraphIndex}:${bodyKey}`;
  const supportIndex = Number.parseInt(input.dataset.essaySupportIndex, 10);
  const supportKey = input.dataset.essaySupportField;
  if (Number.isInteger(supportIndex) && supportKey) {
    return `support:${paragraphIndex}:${supportIndex}:${supportKey}`;
  }
  return "";
}

function essayStatusText(status) {
  if (status === "complete") return "Complete";
  if (status === "current") return "Current step";
  if (status === "locked") return "Locked";
  return "Not started";
}

function essayProgressSteps(fields = essayFieldsFromForm()) {
  const workflow = essayWorkflowState(fields);
  const paragraphs = essayBodyParagraphListForCount(
    fields?.bodyParagraphs,
    fields?.bodyParagraphCount || fields?.bodyParagraphs?.length || ESSAY_BODY_PARAGRAPH_MIN
  );
  const firstIncompleteBodyIndex = paragraphs.findIndex(paragraph => !essayBodyParagraphReady(paragraph));
  const steps = [{
    key: "introduction",
    label: "Introduction",
    status: workflow.introReady ? "complete" : "current",
    detail: workflow.introReady ? "Hook + thesis done" : essayIntroLeadReady(fields) ? "Write the thesis" : "Write the hook"
  }];
  paragraphs.forEach((paragraph, index) => {
    const progress = essayBodyParagraphProgress(paragraph);
    const locked = !workflow.introReady;
    const complete = workflow.introReady && progress.ready;
    const current = workflow.introReady && !complete && index === firstIncompleteBodyIndex;
    steps.push({
      key: `body-${index}`,
      label: `Body ${index + 1}`,
      status: locked ? "locked" : complete ? "complete" : current ? "current" : "waiting",
      detail: locked ? "Finish introduction first" : `${progress.complete}/${progress.total} body steps done`
    });
  });
  steps.push({
    key: "conclusion",
    label: "Conclusion",
    status: !workflow.bodyReady ? "locked" : workflow.conclusionReady ? "complete" : "current",
    detail: !workflow.bodyReady ? "Finish body paragraphs first" : workflow.conclusionReady ? "Final ending done" : "Write the final ending"
  });
  return steps;
}

function renderEssayProgress(fields = essayFieldsFromForm()) {
  if (!els.essayProgress) return;
  els.essayProgress.innerHTML = essayProgressSteps(fields).map(step => `
    <div class="${classNames("essay-progress-step", `essay-progress-step--${step.status}`)}" ${step.status === "current" ? "aria-current=\"step\"" : ""}>
      <strong>${escapeHtml(step.label)}</strong>
      <span>${escapeHtml(step.detail)}</span>
    </div>
  `).join("");
}

function setEssayDetailsState(details, status, message) {
  if (!details) return;
  ["complete", "current", "locked", "waiting"].forEach(value => {
    details.classList.toggle(`essay-section--${value}`, status === value);
  });
  const statusNode = details.querySelector("[data-essay-section-status]");
  if (statusNode) statusNode.textContent = message;
  const shouldOpen = status === "current";
  if (shouldOpen || !details.contains(document.activeElement)) {
    details.open = shouldOpen;
  }
}

function renderEssaySectionStates(fields = essayFieldsFromForm()) {
  if (!els.essayBuilder) return;
  const workflow = essayWorkflowState(fields);
  const introStatus = workflow.introReady ? "complete" : "current";
  setEssayDetailsState(
    els.essayBuilder.querySelector(".essay-structure-introduction"),
    introStatus,
    workflow.introReady ? "Complete - hook + thesis done" : essayIntroLeadReady(fields) ? "Current step - write the thesis" : "Current step - write the hook"
  );

  const paragraphs = essayBodyParagraphListForCount(
    fields?.bodyParagraphs,
    fields?.bodyParagraphCount || fields?.bodyParagraphs?.length || ESSAY_BODY_PARAGRAPH_MIN
  );
  const firstIncompleteBodyIndex = paragraphs.findIndex(paragraph => !essayBodyParagraphReady(paragraph));
  paragraphs.forEach((paragraph, index) => {
    const progress = essayBodyParagraphProgress(paragraph);
    const locked = !workflow.introReady;
    const complete = workflow.introReady && progress.ready;
    const current = workflow.introReady && !complete && index === firstIncompleteBodyIndex;
    const status = locked ? "locked" : complete ? "complete" : current ? "current" : "waiting";
    setEssayDetailsState(
      els.essayBodyParagraphs?.querySelector(`[data-essay-body-paragraph="${index}"]`),
      status,
      `${essayStatusText(status)} - ${progress.complete}/${progress.total} body steps`
    );
  });

  const conclusionStatus = !workflow.bodyReady ? "locked" : workflow.conclusionReady ? "complete" : "current";
  setEssayDetailsState(
    els.essayBuilder.querySelector(".essay-structure-final-conclusion"),
    conclusionStatus,
    !workflow.bodyReady ? "Locked - finish the body first" : workflow.conclusionReady ? "Complete - final ending done" : "Current step - write the final ending"
  );
}

function renderEssayFieldStates(fields = essayFieldsFromForm()) {
  const currentStepKey = essayCurrentStepKey(fields);
  essayAllFieldInputs().forEach(input => {
    const label = input.closest("label");
    if (!label) return;
    const ready = essayValueReady(input.value);
    const locked = input.disabled;
    const current = !locked && essayInputStepKey(input) === currentStepKey;
    label.classList.toggle("essay-step-complete", ready);
    label.classList.toggle("essay-step-current", current);
    label.classList.toggle("essay-step-pending", !ready && !locked && !current);
  });
}

function insertEssayStarter(button) {
  const starter = button?.dataset?.essayStarter;
  const field = button?.closest(".essay-body-frame-field");
  const textarea = field?.querySelector("[data-essay-body-field]");
  if (!starter || !textarea || textarea.disabled) return;
  const phrase = starter.endsWith("...") ? starter : `${starter} `;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const prefix = start > 0 && !/\s$/.test(textarea.value.slice(0, start)) ? " " : "";
  const suffix = textarea.value.slice(end).startsWith(" ") || !textarea.value.slice(end) ? "" : " ";
  textarea.focus();
  textarea.setRangeText(`${prefix}${phrase}${suffix}`, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function essayMissingForConclusion(fields = essayFieldsFromForm()) {
  const checks = [
    ["Thesis", fields.thesis],
    ["Hook", fields.hook]
  ];
  essayBodyParagraphListForCount(fields.bodyParagraphs, fields.bodyParagraphCount).forEach((paragraph, index) => {
    checks.push(
      [`Body ${index + 1} idea`, paragraph.idea],
      [`Body ${index + 1} source or example`, paragraph.sourceExample],
      [`Body ${index + 1} another reason or example`, paragraph.anotherReason],
      [`Body ${index + 1} wrap-up sentence`, paragraph.wrapUp]
    );
  });
  return checks
    .filter(([, value]) => !stringValueFromClient(value))
    .map(([label]) => label);
}

function setEssayStepLocked(input, locked, message) {
  if (!input) return;
  input.disabled = Boolean(locked);
  input.title = locked ? message : "";
  input.closest("label")?.classList.toggle("essay-step-locked", Boolean(locked));
}

function updateEssayWorkflowLocks(fields = essayFieldsFromForm()) {
  if (state.essayLegacyEditUnlocked) {
    essayAllFieldInputs().forEach(input => setEssayStepLocked(input, false, ""));
    if (els.essayConclusionHint) {
      els.essayConclusionHint.textContent = "Old essay loaded. All fields are unlocked for editing.";
    }
    return;
  }
  const workflow = essayWorkflowState(fields);
  const needsIntro = "Write the thesis and hook first.";
  const needsBody = "Finish a SESC body paragraph before writing the conclusion.";

  setEssayStepLocked(els.essayHook, false, "");
  setEssayStepLocked(els.essayThesis, false, "");
  essayBodyParagraphTextareas().forEach(input => setEssayStepLocked(input, !workflow.introReady, needsIntro));
  setEssayStepLocked(els.essayConclusion, !workflow.bodyReady, needsBody);
  if (els.essayConclusionHint) {
    const missing = essayMissingForConclusion(fields);
    els.essayConclusionHint.textContent = workflow.bodyReady
      ? "Final conclusion is unlocked."
      : `No special keywords are required. Complete: ${missing.join(", ") || "the body paragraph"}.`;
  }
}

function renderEssayReadiness() {
  const fields = essayFieldsFromForm();
  updateEssayWorkflowLocks(fields);
  renderEssayWordCounts(fields);
  renderEssayProgress(fields);
  renderEssaySectionStates(fields);
  renderEssayFieldStates(fields);
}

function essayIntroductionContent(fields) {
  return [
    stringValueFromClient(fields?.hook),
    stringValueFromClient(fields?.thesis)
  ].filter(Boolean).join("\n\n");
}

function essayBodyParagraphContent(paragraph) {
  const normalized = normalizeEssayBodyParagraph(paragraph);
  return [
    normalized.idea,
    normalized.sourceExample,
    normalized.anotherReason,
    normalized.wrapUp
  ]
    .map(value => stringValueFromClient(value))
    .filter(Boolean)
    .join("\n\n");
}

function essayBodyContent(fields) {
  const paragraphs = Array.isArray(fields?.bodyParagraphs) && fields.bodyParagraphs.length
    ? fields.bodyParagraphs
    : [normalizeEssayBodyParagraph({
      idea: fields?.idea || fields?.topicSentence,
      sourceExample: fields?.sourceExample || fields?.supportSource,
      anotherReason: fields?.anotherReason || fields?.explain || fields?.supportOwn || fields?.supportComment,
      wrapUp: fields?.wrapUp || fields?.bodyConclusion
    })];
  return paragraphs
    .map(essayBodyParagraphContent)
    .filter(Boolean)
    .join("\n\n");
}

function essaySourcesContent(fields) {
  return stringValueFromClient(fields?.sources);
}

function essaySourcesBlockContent(fields) {
  const sources = essaySourcesContent(fields);
  return sources ? `Sources/Criticism\n\n${sources}` : "";
}

function essayBodyPositionMap(value) {
  const positions = {
    state: "",
    explain: "",
    supportBefore: "",
    supportSource: "",
    supportAfter: "",
    conclude: "",
    freeText: ""
  };
  const leftovers = [];
  let activeKey = "";
  stringValueFromClient(value).split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;
    if (/^support section formula:/i.test(line)) return;
    const matchers = [
      ["state", /^State:\s*(.*)$/i],
      ["explain", /^Explain:\s*(.*)$/i],
      ["supportBefore", /^Support\s*-\s*my words:\s*(.*)$/i],
      ["supportSource", /^Support\s*-\s*source:\s*(.*)$/i],
      ["supportAfter", /^Support\s*-\s*(?:my comment|my words after source):\s*(.*)$/i],
      ["conclude", /^Conclude:\s*(.*)$/i]
    ];
    const matched = matchers.find(([, pattern]) => pattern.test(line));
    if (matched) {
      activeKey = matched[0];
      const content = line.match(matched[1])?.[1]?.trim() || "";
      if (content) positions[activeKey] = positions[activeKey] ? `${positions[activeKey]}\n${content}` : content;
      return;
    }
    if (activeKey) {
      positions[activeKey] = positions[activeKey] ? `${positions[activeKey]}\n${line}` : line;
      return;
    }
    if (!/^Body paragraph\s+\d+\s*-\s*SESC\b/i.test(line)) leftovers.push(line);
  });
  positions.freeText = leftovers.join("\n");
  return positions;
}

function focusEssayThesisField() {
  const target = !stringValueFromClient(els.essayHook?.value) ? els.essayHook : els.essayThesis;
  if (els.studyType.value !== "essay" || !target || target.disabled) return;
  requestAnimationFrame(() => {
    target.focus();
    const end = target.value.length;
    target.setSelectionRange(end, end);
  });
}

function essayContentFromFields(fields) {
  return [
    essayIntroductionContent(fields),
    essayBodyContent(fields),
    fields.conclusion,
    essaySourcesBlockContent(fields)
  ]
    .map(value => stringValueFromClient(value))
    .filter(Boolean)
    .join("\n\n");
}

function syncEssayContentPreview() {
  if (els.studyType.value !== "essay") return;
  const fields = essayFieldsFromForm();
  els.studyContent.value = essayContentFromFields(fields);
  autoResizeTextarea(els.studyContent);
}

function updateStudyTextMode() {
  const isEssay = els.studyType.value === "essay";
  const isVocabulary = els.studyType.value === "vocabulary";
  if (isEssay && !essayFieldsHaveContent(essayFieldsFromForm()) && stringValueFromClient(els.studyContent.value)) {
    setEssayFields({}, els.studyContent.value);
  } else if (isEssay && !essayBodyParagraphTextareas().length) {
    renderEssayBodyParagraphFields([emptyEssayBodyParagraph()], ESSAY_BODY_PARAGRAPH_MIN);
  }
  els.essayBuilder.classList.toggle("hidden", !isEssay);
  els.vocabularyPractice?.classList.toggle("hidden", !isVocabulary);
  els.studyContentField?.classList.toggle("hidden", isEssay);
  els.studyContent.readOnly = isEssay;
  els.studyContent.classList.toggle("generated-content", isEssay);
  const label = els.studyContent.closest("label")?.querySelector("span");
  if (label) label.textContent = isEssay ? "Essay draft" : isVocabulary ? "Sentences" : "Text";
  if (isEssay) syncEssayContentPreview();
  renderVocabularyPracticeUi();
  renderEssayReadiness();
  refreshStudyTextareaSizes();
}

function vocabularyPracticeSelectedWords() {
  const ids = Array.isArray(state.vocabularyPractice.wordIds) ? state.vocabularyPractice.wordIds : [];
  const byId = new Map((state.db.words || []).map(word => [word.id, word]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

function vocabularyPracticeCount() {
  const count = Number.parseInt(els.vocabularyPracticeCount?.value || "10", 10);
  if (!Number.isFinite(count)) return 10;
  return Math.max(1, Math.min(50, count));
}

function dateRangeValue(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function vocabularyPracticeCandidateWords() {
  const from = dateRangeValue(els.vocabularyPracticeFrom?.value || "");
  const to = dateRangeValue(els.vocabularyPracticeTo?.value || "", true);
  const locationFilter = {
    sourceId: els.studySource?.value || "",
    branchId: els.studyBranch?.value || "",
    unitId: els.studyUnit?.value || ""
  };
  const seen = new Set();
  return (state.db.words || [])
    .filter(word => {
      if (!isVaultRecordLocation(word)) return false;
      if (!stringValueFromClient(word.word)) return false;
      if (!wordMatchesLocationFilter(word, locationFilter)) return false;
      const createdAt = new Date(word.createdAt || 0);
      if (Number.isNaN(createdAt.getTime())) return false;
      if (from && createdAt < from) return false;
      if (to && createdAt > to) return false;
      const key = normalizePracticeAnswer(word.word);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function randomizeVocabularyPracticeWords() {
  const candidates = vocabularyPracticeCandidateWords();
  const count = vocabularyPracticeCount();
  const selected = shuffle(candidates).slice(0, count);
  state.vocabularyPractice.wordIds = selected.map(word => word.id);
  state.vocabularyPractice.status = selected.length
    ? `${selected.length} ${selected.length === 1 ? "word" : "words"} selected`
    : "No matching words";
  if (!stringValueFromClient(els.studyTitle.value) && selected.length) {
    els.studyTitle.value = vocabularyPracticeTitle(selected);
    scheduleStudyTextAutosave();
  }
  renderVocabularyPracticeUi();
  refreshIcons();
  if (selected.length) {
    els.studyContent.focus();
  } else {
    showToast("No matching vocabulary found", true);
  }
}

function vocabularyPracticeTitle(words = vocabularyPracticeSelectedWords()) {
  const dateLabel = [
    els.vocabularyPracticeFrom?.value,
    els.vocabularyPracticeTo?.value
  ].filter(Boolean).join(" to ");
  return dateLabel ? `Vocabulary practice ${dateLabel}` : `Vocabulary practice ${new Date().toLocaleDateString()}`;
}

function vocabularySentenceTemplate(words = vocabularyPracticeSelectedWords()) {
  if (!words.length) return "";
  return [
    vocabularyPracticeTitle(words),
    "",
    `Words: ${words.map(word => word.word).join(", ")}`,
    "",
    ...words.map((word, index) => `${index + 1}. ${word.word}: `)
  ].join("\n");
}

function insertVocabularySentenceStarter() {
  const words = vocabularyPracticeSelectedWords();
  if (!words.length) {
    showToast("Choose random words first", true);
    return;
  }
  const template = vocabularySentenceTemplate(words);
  const current = els.studyContent.value;
  els.studyContent.value = stringValueFromClient(current)
    ? `${current.replace(/\s+$/u, "")}\n\n${template}`
    : template;
  if (!stringValueFromClient(els.studyTitle.value)) {
    els.studyTitle.value = vocabularyPracticeTitle(words);
  }
  autoResizeTextarea(els.studyContent);
  renderVocabularyPracticeUi();
  scheduleStudyTextAutosave();
  els.studyContent.focus();
}

function insertVocabularyWordAtCursor(wordId) {
  const word = (state.db.words || []).find(item => item.id === wordId);
  const value = stringValueFromClient(word?.word);
  if (!value) return;
  const textarea = els.studyContent;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before && !/\s$/u.test(before) ? " " : "";
  const suffix = after && !/^\s/u.test(after) ? " " : "";
  textarea.value = `${before}${prefix}${value}${suffix}${after}`;
  const cursor = before.length + prefix.length + value.length;
  textarea.setSelectionRange(cursor, cursor);
  autoResizeTextarea(textarea);
  renderVocabularyPracticeUi();
  scheduleStudyTextAutosave();
  textarea.focus();
}

function vocabularyWordUsedInText(word) {
  const target = normalizePracticeAnswer(word?.word);
  if (!target) return false;
  const text = normalizePracticeAnswer(els.studyContent?.value || "");
  if (!text) return false;
  if (target.includes(" ")) return text.includes(target);
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(target)}([^\\p{L}]|$)`, "u").test(text);
}

function renderVocabularyPracticeUi() {
  if (!els.vocabularyPracticeWords || !els.vocabularyPracticeStatus) return;
  const words = vocabularyPracticeSelectedWords();
  els.vocabularyPracticeStatus.textContent = state.vocabularyPractice.status || "No words selected";
  els.vocabularyPracticeStartButton.disabled = !words.length;
  els.vocabularyPracticeWords.innerHTML = words.length
    ? words.map(word => {
      const used = vocabularyWordUsedInText(word);
      return `
        <button class="vocabulary-word-chip ${used ? "used" : ""}" type="button" data-vocabulary-practice-word="${escapeHtml(word.id)}">
          <strong>${escapeHtml(word.word)}</strong>
          ${normalizePartOfSpeech(word).slice(0, 1).map(part => `<small>${escapeHtml(part)}</small>`).join("")}
          ${used ? icon("check") : ""}
        </button>
      `;
    }).join("")
    : "";
}

function clearVocabularyPractice() {
  clearVocabularyPracticeSelection();
  if (els.vocabularyPracticeFrom) els.vocabularyPracticeFrom.value = "";
  if (els.vocabularyPracticeTo) els.vocabularyPracticeTo.value = "";
  if (els.vocabularyPracticeCount) els.vocabularyPracticeCount.value = "10";
  renderVocabularyPracticeUi();
}

function clearVocabularyPracticeSelection(status = "No words selected") {
  state.vocabularyPractice.wordIds = [];
  state.vocabularyPractice.status = status;
  renderVocabularyPracticeUi();
}

function autoResizeTextarea(textarea) {
  if (!textarea || textarea.tagName !== "TEXTAREA") return;
  textarea.style.height = "auto";
  const minHeight = parseFloat(window.getComputedStyle(textarea).minHeight) || 0;
  textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
}

function refreshStudyTextareaSizes() {
  requestAnimationFrame(() => {
    autoResizeTextarea(els.studyContent);
    essayAllFieldInputs().forEach(autoResizeTextarea);
  });
}

function studyTextPreview(content) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function partOfSpeechChips(word) {
  const values = normalizePartOfSpeech(word);
  if (!values.length) return "";
  return `<div class="pos-chip-list">${values.map(part => `
    <span class="pos-chip">${escapeHtml(part)}</span>
  `).join("")}</div>`;
}

function pronunciationTextHtml(word, options = {}) {
  const pronunciation = word.pronunciation;
  const phonetic = stringValueFromClient(pronunciation?.phonetic);
  if (!phonetic) return "";

  const type = stringValueFromClient(pronunciation.phoneticType).toUpperCase();
  const label = type || "PRON";
  const isIpa = type === "IPA";
  const toggleIpa = Boolean(options.hideIpaByDefault && isIpa);
  const ipaVisible = !toggleIpa || state.visibleIpaPronunciationWordIds.has(word.id);
  if (toggleIpa && !ipaVisible) {
    return ipaPronunciationToggleHtml(word, false);
  }

  const value = type === "IPA" ? `/${phonetic}/` : phonetic;
  const valueHtml = type === "IPA" ? ipaPronunciationValueHtml(phonetic) : escapeHtml(value);
  const entryWord = stringValueFromClient(pronunciation.entryWord);
  const title = [
    "Pronunciation",
    entryWord && entryWord !== word.word ? `for ${entryWord}` : "",
    label
  ].filter(Boolean).join(" - ");

  return `
    <span class="pronunciation-text-wrap">
      <span class="pronunciation-text" title="${escapeHtml(title)}">
        <span class="pronunciation-text-value">${valueHtml}</span>
        <span class="pronunciation-text-type">${escapeHtml(label)}</span>
      </span>
      ${toggleIpa ? ipaPronunciationToggleHtml(word, true) : ""}
    </span>
  `;
}

function wordHasIpaPronunciation(word) {
  const pronunciation = word?.pronunciation;
  return Boolean(
    stringValueFromClient(pronunciation?.phonetic) &&
    stringValueFromClient(pronunciation?.phoneticType).toUpperCase() === "IPA"
  );
}

function ipaPronunciationToggleHtml(word, visible) {
  const label = visible ? "Hide IPA" : "Show IPA";
  return `
    <button class="ghost-button ipa-pronunciation-toggle" type="button" data-toggle-ipa-pronunciation="${escapeHtml(word.id)}" aria-expanded="${visible ? "true" : "false"}">
      ${icon(visible ? "eye-off" : "eye")}
      <span>${label}</span>
    </button>
  `;
}

function ipaPronunciationValueHtml(phonetic) {
  return `/${tokenizeIpaPronunciation(phonetic).map(ipaTokenHtml).join("")}/`;
}

function ipaTokenHtml(token) {
  const audioUrl = IPA_SOUND_MAP[token];
  if (!audioUrl) return `<span class="ipa-token">${escapeHtml(token)}</span>`;
  const title = `Play IPA sound ${token}`;
  return `
    <button class="ipa-token ipa-token-button" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-play-ipa-sound="${escapeHtml(token)}">
      ${escapeHtml(token)}
    </button>
  `;
}

function tokenizeIpaPronunciation(phonetic) {
  const tokens = [];
  let index = 0;
  while (index < phonetic.length) {
    const match = IPA_SOUND_TOKENS.find(token => phonetic.startsWith(token, index));
    if (match) {
      tokens.push(match);
      index += match.length;
      continue;
    }
    tokens.push(phonetic[index]);
    index += 1;
  }
  return tokens;
}

function normalizePartOfSpeech(wordOrValue) {
  const value = wordOrValue && typeof wordOrValue === "object" && !Array.isArray(wordOrValue)
    ? wordOrValue.partOfSpeech ?? wordOrValue.classification
    : wordOrValue;
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n|,|;/) : [];
  return [...new Set(values.map(item => String(item).trim()).filter(Boolean))];
}

function parsePartOfSpeechInput(value) {
  const values = normalizePartOfSpeech(value);
  if (values.length <= 1) return values[0] || "";
  return values;
}

function availablePartsOfSpeech() {
  return [...new Set(state.db.words.filter(isVaultRecordLocation).flatMap(word => normalizePartOfSpeech(word)))]
    .sort((a, b) => a.localeCompare(b));
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n|;/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeClientStringArray(value) {
  if (Array.isArray(value)) {
    return value.flatMap(item => normalizeClientStringArray(item));
  }
  if (typeof value === "string") {
    return value.split(/\r?\n|;|,/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function parseSynonymsInput(value) {
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    return JSON.parse(text);
  }
  return splitLines(text);
}

function formatSynonymsForInput(value) {
  const values = Array.isArray(value) ? value : [];
  if (values.some(item => item && typeof item === "object")) {
    return JSON.stringify(values, null, 2);
  }
  return values.join("\n");
}

function renderLookupResults() {
  const lookup = state.lookup;
  if (!lookup.loading && !lookup.candidates.length && !lookup.suggestions.length) {
    els.lookupResults.classList.add("hidden");
    els.lookupResults.innerHTML = "";
    return;
  }

  els.lookupResults.classList.remove("hidden");
  if (lookup.loading) {
    els.lookupResults.innerHTML = lookupStateHtml("Looking up Merriam-Webster entries...");
    return;
  }

  if (lookup.suggestions.length) {
    els.lookupResults.innerHTML = `
      <div class="lookup-heading">
        <strong>No exact entry found</strong>
        <span>Try one of these suggestions</span>
      </div>
      <div class="lookup-suggestions">
        ${lookup.suggestions.map(suggestion => `
          <button class="ghost-button" type="button" data-lookup-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>
        `).join("")}
      </div>
    `;
    refreshIcons();
    return;
  }

  els.lookupResults.innerHTML = `
    <div class="lookup-heading">
      <strong>${lookup.candidates.length} ${lookup.candidates.length === 1 ? "meaning" : "meanings"} found</strong>
      <span>Select the meaning you want to save</span>
      ${lookupReferenceTagsHtml(lookup.references)}
    </div>
    <div class="lookup-candidate-list">
      ${lookup.candidates.map((candidate, index) => lookupCandidateHtml(candidate, index)).join("")}
    </div>
  `;
  refreshIcons();
}

function lookupReferenceTagsHtml(references = {}) {
  const tags = [
    references.learners ? "Learner" : "",
    references.thesaurusUsed ? "Thesaurus" : ""
  ].filter(Boolean);
  return tags.length ? `<div class="lookup-reference-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
}

function lookupCandidateHtml(candidate, index, options = {}) {
  const examples = (candidate.examples || []).slice(0, 2);
  const synonyms = (candidate.synonyms || []).slice(0, 5);
  const thesaurusPreview = lookupThesaurusPreviewHtml(candidate.thesaurus);
  const formLabel = candidate.exact ? "" : `<span class="lookup-tag">Base form: ${escapeHtml(candidate.entryWord || candidate.headword || "")}</span>`;
  const thesaurusLabel = candidate.thesaurus ? `<span class="lookup-tag">Thesaurus</span>` : "";
  const actionHtml = lookupCandidateActionHtml(index, options);
  return `
    <article class="lookup-candidate">
      <div>
        <div class="lookup-candidate-title">
          <strong>${escapeHtml(candidate.entryWord || candidate.headword || candidate.word)}</strong>
          ${candidate.partOfSpeech ? `<span>${escapeHtml(candidate.partOfSpeech)}</span>` : ""}
          ${formLabel}
          ${thesaurusLabel}
        </div>
        <p>${escapeHtml(candidate.definition)}</p>
        ${examples.length ? `<ul>${examples.map(example => `<li>${escapeHtml(example)}</li>`).join("")}</ul>` : ""}
        ${synonyms.length ? `<div class="lookup-mini-list">${synonyms.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
        ${thesaurusPreview}
      </div>
      ${actionHtml}
    </article>
  `;
}

function lookupCandidateActionHtml(index, options = {}) {
  if (options.showUseButton === false && !options.actionAttribute) return "";
  const actionAttribute = options.actionAttribute || "data-lookup-use";
  const actionLabel = options.actionLabel || "Use";
  const actionIcon = options.actionIcon || "check";
  const actionClass = options.actionClass || "primary-button";
  return `
    <button class="${actionClass}" type="button" ${actionAttribute}="${index}">
      ${icon(actionIcon)}
      <span>${escapeHtml(actionLabel)}</span>
    </button>
  `;
}

function lookupThesaurusPreviewHtml(thesaurus) {
  if (!thesaurus || typeof thesaurus !== "object") return "";
  const groups = [
    ["Related", thesaurus.relatedWords],
    ["Antonyms", thesaurus.antonyms],
    ["Near antonyms", thesaurus.nearAntonyms],
    ["Phrases", thesaurus.phrases]
  ]
    .map(([label, items]) => [label, Array.isArray(items) ? items.slice(0, 4).filter(Boolean) : []])
    .filter(([, items]) => items.length);
  if (!groups.length) return "";
  return `
    <div class="lookup-thesaurus-preview">
      ${groups.map(([label, items]) => `
        <div>
          <strong>${escapeHtml(label)}</strong>
          <div class="lookup-mini-list">${items.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderTestLookupResults() {
  const lookup = state.testLookup;
  const targets = testLookupResultTargets();
  if (!lookup.loading && !lookup.candidates.length && !lookup.suggestions.length) {
    targets.forEach(target => {
      target.classList.add("hidden");
      target.innerHTML = "";
    });
    return;
  }

  targets.forEach(target => target.classList.remove("hidden"));
  if (lookup.loading) {
    setTestLookupResultsHtml(lookupStateHtml("Looking up Merriam-Webster entries..."));
    return;
  }

  if (lookup.suggestions.length) {
    setTestLookupResultsHtml(`
      <div class="lookup-heading">
        <strong>No exact match</strong>
        <span>Try one of these suggestions</span>
      </div>
      <div class="lookup-suggestions">
        ${lookup.suggestions.map(suggestion => `
          <button class="ghost-button" type="button" data-test-lookup-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>
        `).join("")}
      </div>
    `);
    refreshIcons();
    return;
  }

  setTestLookupResultsHtml(`
    <div class="lookup-heading">
      <strong>${lookup.candidates.length} ${lookup.candidates.length === 1 ? "meaning" : "meanings"} found</strong>
      <span>Choose one meaning to add to this test word list</span>
      ${lookupReferenceTagsHtml(lookup.references)}
    </div>
    <div class="lookup-candidate-list test-lookup-candidate-list">
      ${lookup.candidates.map((candidate, index) => lookupCandidateHtml(candidate, index, {
        actionAttribute: "data-test-lookup-save",
        actionLabel: "Add to word list",
        actionIcon: "plus"
      })).join("")}
    </div>
  `);
  refreshIcons();
}

function testLookupResultTargets() {
  const targets = [...document.querySelectorAll(".test-lookup-results-target")];
  if (els.testLookupResults && !targets.includes(els.testLookupResults)) {
    targets.push(els.testLookupResults);
  }
  return targets;
}

function setTestLookupResultsHtml(html) {
  testLookupResultTargets().forEach(target => {
    target.innerHTML = html;
  });
}

async function lookupCurrentWord() {
  if (!hasSelectedWordPath()) {
    showToast("Choose a source, unit, or topic from Sources first", true);
    return;
  }
  const word = els.wordInput.value.trim();
  if (!word) {
    showToast("Type a word first", true);
    return;
  }
  const includeThesaurus = Boolean(els.lookupThesaurusInput?.checked);

  state.lookup = { loading: true, query: word, candidates: [], suggestions: [], references: {}, appliedThesaurus: null };
  els.lookupWordButton.disabled = true;
  renderLookupResults();
  refreshIcons();
  try {
    const result = await api(`/api/lookup?word=${encodeURIComponent(word)}&thesaurus=${includeThesaurus ? "1" : "0"}`);
    state.lookup = {
      loading: false,
      query: result.query || word,
      candidates: result.candidates || [],
      suggestions: result.suggestions || [],
      references: result.references || {},
      appliedThesaurus: null
    };
    if (!state.lookup.candidates.length && !state.lookup.suggestions.length) {
      showToast("No Merriam-Webster meanings found", true);
    }
  } catch (error) {
    state.lookup = { loading: false, query: word, candidates: [], suggestions: [], references: {}, appliedThesaurus: null };
    throw error;
  } finally {
    els.lookupWordButton.disabled = false;
    renderLookupResults();
    refreshIcons();
  }
}

async function lookupTestWord() {
  const activeInput = document.activeElement?.matches?.("[data-test-lookup-word-input]")
    ? document.activeElement
    : null;
  const visibleInput = activeInput || document.querySelector("[data-test-lookup-word-input]") || els.testLookupWordInput;
  const word = visibleInput?.value.trim() || "";
  if (!word) {
    showToast("Type a word first", true);
    return;
  }

  const scope = visibleInput?.closest(".test-study-lookup") || null;
  const scopedThesaurusInput = scope?.querySelector("[data-test-lookup-thesaurus-input]");
  const includeThesaurus = scopedThesaurusInput
    ? Boolean(scopedThesaurusInput.checked)
    : Boolean(els.testLookupThesaurusInput?.checked);
  state.testLookup = { loading: true, query: word, candidates: [], suggestions: [], references: {} };
  const buttons = [...document.querySelectorAll("[data-test-lookup-submit]"), els.testLookupWordButton].filter(Boolean);
  buttons.forEach(button => {
    button.disabled = true;
  });
  renderTestLookupResults();

  try {
    const result = await api(`/api/lookup?word=${encodeURIComponent(word)}&thesaurus=${includeThesaurus ? "1" : "0"}`);
    state.testLookup = {
      loading: false,
      query: word,
      candidates: result.candidates || [],
      suggestions: result.suggestions || [],
      references: result.references || {}
    };
    if (!state.testLookup.candidates.length && !state.testLookup.suggestions.length) {
      showToast("No dictionary entry found", true);
    }
  } catch (error) {
    state.testLookup = { loading: false, query: word, candidates: [], suggestions: [], references: {} };
    throw error;
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
    });
    renderTestLookupResults();
  }
}

async function saveTestLookupCandidate(index) {
  const candidate = state.testLookup.candidates[index];
  const test = activeNationalTest();
  if (!candidate) return;
  if (!test) {
    showToast("Open a test first", true);
    return;
  }

  const result = await api(`/api/national-tests/${test.id}/lookup-words`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(candidate)
  });
  applyTestLookupSaveResult(result);
  showToast(result.alreadyLinked ? `Word already saved under ${result.source.name}` : `Saved under ${result.source.name}`);
}

function applyTestLookupSaveResult(result) {
  if (!result || typeof result !== "object") return;
  replaceSourceRecord(result.source);
  replaceWordRecord(result.word);
  saveDatabaseCache();
  renderActiveNationalTestPageSearchUi();
  refreshIcons();
}

function replaceSourceRecord(source) {
  if (!source?.id) return;
  state.db.sources = Array.isArray(state.db.sources) ? state.db.sources : [];
  const index = state.db.sources.findIndex(item => item.id === source.id);
  if (index === -1) {
    state.db.sources.push(source);
  } else {
    state.db.sources[index] = source;
  }
}

function replaceWordRecord(word) {
  if (!word?.id) return;
  state.db.words = Array.isArray(state.db.words) ? state.db.words : [];
  if (!word.arabicTranslation) state.visibleArabicTranslationWordIds.delete(word.id);
  const index = state.db.words.findIndex(item => item.id === word.id);
  if (index === -1) {
    state.db.words.push(word);
  } else {
    state.db.words[index] = word;
  }
}

function removeWordRecord(wordId) {
  state.db.words = (state.db.words || []).filter(word => word.id !== wordId);
  state.selectedWordIds.delete(wordId);
  state.visibleArabicTranslationWordIds.delete(wordId);
  state.visibleIpaPronunciationWordIds.delete(wordId);
  if (state.focusedWordId === wordId) state.focusedWordId = "";
}

function replaceStudyTextRecord(text) {
  if (!text?.id) return;
  state.db.studyTexts = Array.isArray(state.db.studyTexts) ? state.db.studyTexts : [];
  const index = state.db.studyTexts.findIndex(item => item.id === text.id);
  if (index === -1) {
    state.db.studyTexts.push(text);
  } else {
    state.db.studyTexts[index] = text;
  }
}

function removeStudyTextRecord(textId) {
  state.db.studyTexts = (state.db.studyTexts || []).filter(text => text.id !== textId);
  if (state.activeStudyTextId === textId) state.activeStudyTextId = "";
}

function replaceStudyVideoRecord(video) {
  if (!video?.id) return;
  state.db.studyVideos = Array.isArray(state.db.studyVideos) ? state.db.studyVideos : [];
  const index = state.db.studyVideos.findIndex(item => item.id === video.id);
  if (index === -1) {
    state.db.studyVideos.push(video);
  } else {
    state.db.studyVideos[index] = video;
  }
}

function removeStudyVideoRecord(videoId) {
  state.db.studyVideos = (state.db.studyVideos || []).filter(video => video.id !== videoId);
  if (state.activeStudyVideoId === videoId) state.activeStudyVideoId = "";
}

function replaceVerbRecord(verb) {
  if (!verb?.id) return;
  state.db.verbs = Array.isArray(state.db.verbs) ? state.db.verbs : [];
  const index = state.db.verbs.findIndex(item => item.id === verb.id);
  if (index === -1) {
    state.db.verbs.push(verb);
  } else {
    state.db.verbs[index] = verb;
  }
}

function removeVerbRecord(verbId) {
  state.db.verbs = (state.db.verbs || []).filter(verb => verb.id !== verbId);
  if (state.focusedVerbId === verbId) state.focusedVerbId = "";
}

function removeNationalTestRecord(testId) {
  state.db.nationalTests = (state.db.nationalTests || []).filter(test => test.id !== testId);
  state.db.nationalTestPages = (state.db.nationalTestPages || []).filter(page => page.testId !== testId);
  if (state.nationalTestRenamingId === testId) state.nationalTestRenamingId = "";
  if (state.nationalTestRenameSavingId === testId) state.nationalTestRenameSavingId = "";
  if (state.nationalTestDetailsEditingId === testId) state.nationalTestDetailsEditingId = "";
  if (state.nationalTestDetailsSavingId === testId) state.nationalTestDetailsSavingId = "";
  if (state.activeNationalTestId === testId) {
    state.activeNationalTestId = "";
    state.activeNationalTestPageId = "";
    state.activeNationalTestListeningTopicKey = "";
    state.nationalTestFocusMode = false;
  }
}

function replaceNationalTestRecord(test) {
  if (!test?.id) return;
  state.db.nationalTests = Array.isArray(state.db.nationalTests) ? state.db.nationalTests : [];
  const index = state.db.nationalTests.findIndex(item => item.id === test.id);
  if (index === -1) {
    state.db.nationalTests.push(test);
  } else {
    state.db.nationalTests[index] = test;
  }
}

function refreshWordLibraryAfterLocalChange() {
  saveDatabaseCache();
  renderSources();
  renderWords();
  refreshIcons();
}

function refreshStudyTextLibraryAfterLocalChange() {
  saveDatabaseCache();
  renderSources();
  renderStudyTexts();
  updateLibraryCounts();
  refreshIcons();
}

function refreshStudyVideoLibraryAfterLocalChange() {
  saveDatabaseCache();
  renderSources();
  renderStudyVideos();
  updateLibraryCounts();
  refreshIcons();
}

function refreshVerbLibraryAfterLocalChange() {
  saveDatabaseCache();
  updateLibraryCounts();
  renderVerbs();
  refreshIcons();
}

function refreshNationalTestLibraryAfterLocalChange() {
  saveDatabaseCache();
  render();
}

function useLookupCandidate(index) {
  const candidate = state.lookup.candidates[index];
  if (!candidate) return;

  if (!els.wordInput.value.trim()) {
    els.wordInput.value = candidate.word || candidate.entryWord || "";
  }
  els.partOfSpeechInput.value = candidate.partOfSpeech || "";
  els.definitionInput.value = candidate.definition || "";
  if (candidate.examples?.length) {
    els.examplesInput.value = candidate.examples.join("\n");
  }
  if (candidate.collocations?.length) {
    els.collocationsInput.value = candidate.collocations.join("\n");
  }
  if (candidate.synonyms?.length) {
    els.synonymsInput.value = candidate.synonyms.join("\n");
  }
  state.lookup.appliedThesaurus = candidate.thesaurus || null;
  showToast("Meaning applied");
}

function clearLookupResults() {
  state.lookup = { loading: false, query: "", candidates: [], suggestions: [], references: {}, appliedThesaurus: null };
  renderLookupResults();
}

function setSelected(sourceId, branchId = "", unitId = "") {
  state.selected = { sourceId, branchId, unitId };
  state.vaultEditorOpen = true;
  state.activeTab = "single";
  state.activeLibraryTab = "words";
  render();
}

function updateSelectedFromForm(prefix) {
  const source = els[`${prefix}Source`].value;
  const branch = els[`${prefix}Branch`].value;
  const unit = els[`${prefix}Unit`].value;
  state.selected = { sourceId: source, branchId: branch, unitId: unit };
  state.vaultEditorOpen = true;
  renderSelectors();
  refreshIcons();
}

async function saveWord(event) {
  event.preventDefault();
  if (!hasSelectedWordPath()) {
    showToast("Choose a source, unit, or topic from Sources first", true);
    return;
  }

  const payload = {
    sourceId: state.selected.sourceId,
    branchId: state.selected.branchId,
    unitId: state.selected.unitId,
    word: els.wordInput.value.trim(),
    definition: els.definitionInput.value.trim(),
    arabicTranslation: els.arabicTranslationInput.value.trim(),
    partOfSpeech: parsePartOfSpeechInput(els.partOfSpeechInput.value),
    collocations: splitLines(els.collocationsInput.value),
    examples: splitLines(els.examplesInput.value),
    synonyms: parseSynonymsInput(els.synonymsInput.value),
    thesaurus: state.lookup.appliedThesaurus,
    removeImage: els.removeImageInput.checked
  };

  const formData = new FormData();
  formData.append("payload", JSON.stringify(payload));
  if (els.imageInput.files[0]) {
    formData.append("image", els.imageInput.files[0]);
  }

  const id = els.editingId.value;
  const path = id ? `/api/words/${id}` : "/api/words";
  const method = id ? "PATCH" : "POST";
  const result = await api(path, { method, body: formData });
  const changedWords = savedWordsFromWordSaveResult(result, Boolean(id));
  changedWords.forEach(replaceWordInState);
  if (changedWords[0]?.id) {
    state.focusedWordId = changedWords[0].id;
  }
  resetWordForm(false);
  refreshWordLibraryAfterLocalChange();
  showToast(id ? "Word updated" : "Word saved");
}

function savedWordsFromWordSaveResult(result, editing = false) {
  if (!result) return [];
  if (editing && result.id) return [result];
  const byId = new Map();
  [
    ...(Array.isArray(result.created) ? result.created : []),
    ...(Array.isArray(result.linked) ? result.linked : []),
    result.word
  ].forEach(word => {
    if (word?.id) byId.set(word.id, word);
  });
  return [...byId.values()];
}

async function saveStudyText(event) {
  event.preventDefault();
  clearStudyAutosaveTimer();
  if (state.studyAutosave.promise) {
    await state.studyAutosave.promise.catch(() => {});
  }
  await saveStudyTextNow({ manual: true });
}

function studyTextPayloadFromForm(options = {}) {
  const type = els.studyType.value;
  const essayFields = type === "essay" ? essayFieldsFromForm() : null;
  const essayContent = type === "essay" ? essayContentFromFields(essayFields) : "";
  if (type === "essay") {
    els.studyContent.value = essayContent;
    autoResizeTextarea(els.studyContent);
  }

  const payload = {
    sourceId: els.studySource.value,
    branchId: els.studyBranch.value,
    unitId: els.studyUnit.value,
    title: els.studyTitle.value.trim(),
    type,
    content: type === "essay" ? essayContent : els.studyContent.value
  };
  if (type === "essay") {
    payload.essay = essayFields;
  }
  if (options.autosave && !payload.title) {
    payload.title = autosaveStudyTextTitle(payload);
  }
  return payload;
}

function autosaveStudyTextTitle(payload) {
  const candidates = [
    firstContentLine(payload.content)
  ].map(stringValueFromClient).filter(Boolean);
  if (!candidates.length) return "";
  const title = candidates[0].replace(/\s+/g, " ");
  return title.length > 70 ? `${title.slice(0, 67)}...` : title;
}

function firstContentLine(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || "";
}

async function saveStudyTextNow(options = {}) {
  const payload = studyTextPayloadFromForm();
  const wasEditing = Boolean(els.editingTextId.value);
  const saved = await persistStudyTextPayload(payload);
  applySavedStudyText(saved);
  rememberStudyAutosaveSignature(payload);
  setStudyAutosaveStatus("saved", options.manual ? "Text saved" : "Saved");
  if (options.manual) showToast(wasEditing ? "Text updated" : "Text saved");
  return saved;
}

async function persistStudyTextPayload(payload) {
  const id = els.editingTextId.value;
  const path = id ? `/api/study-texts/${id}` : "/api/study-texts";
  const method = id ? "PATCH" : "POST";
  return api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function applySavedStudyText(saved) {
  state.activeStudyTextId = saved.id;
  state.activeLibraryTab = "texts";
  els.editingTextId.value = saved.id;
  els.studySaveLabel.textContent = "Update text";
  replaceStudyTextRecord(saved);
  saveDatabaseCache();
  renderLibraryTabs();
  renderSources();
  renderStudyTexts();
  updateLibraryCounts();
  refreshIcons();
}

function headerCountNumber(count) {
  return Number(count || 0).toLocaleString();
}

function headerStatChipHtml({ count, label, active = false }) {
  const chipAttributes = active ? `aria-current="true"` : "";
  return `
    <span class="${classNames("header-stat-chip", active ? "active" : "")}" ${chipAttributes}>
      <strong>${headerCountNumber(count)}</strong>
      <span>${escapeHtml(label)}</span>
    </span>
  `;
}

function updateLibraryCounts() {
  if (state.activeSection === "tests") {
    els.wordCount.innerHTML = headerStatChipHtml({
      count: (state.db.nationalTests || []).length,
      label: "Tests",
      active: true,
      disabled: true
    });
    return;
  }

  if (state.activeSection === "verbs") {
    els.wordCount.innerHTML = headerStatChipHtml({
      count: (state.db.verbs || []).length,
      label: "Verbs",
      active: true,
      disabled: true
    });
    return;
  }

  const vaultWordCount = (state.db.words || []).filter(isVaultRecordLocation).length;
  const vaultTextCount = (state.db.studyTexts || []).filter(isVaultRecordLocation).length;
  const vaultVideoCount = (state.db.studyVideos || []).filter(isVaultRecordLocation).length;
  const activeLibraryTab = ["texts", "videos"].includes(state.activeLibraryTab) ? state.activeLibraryTab : "words";
  els.wordCount.innerHTML = [
    headerStatChipHtml({
      count: vaultWordCount,
      label: "Words",
      active: activeLibraryTab === "words"
    }),
    headerStatChipHtml({
      count: vaultTextCount,
      label: "Texts",
      active: activeLibraryTab === "texts"
    }),
    headerStatChipHtml({
      count: vaultVideoCount,
      label: "Videos",
      active: activeLibraryTab === "videos"
    })
  ].join("");
}

function scheduleStudyTextAutosave() {
  state.studyAutosave.dirty = true;
  const payload = studyTextPayloadFromForm({ autosave: true });
  const readiness = studyAutosaveReadiness(payload);
  if (!readiness.ready) {
    clearStudyAutosaveTimer();
    setStudyAutosaveStatus("waiting", readiness.message);
    return;
  }

  const signature = studyTextSignature(payload);
  if (signature === state.studyAutosave.lastSignature) {
    state.studyAutosave.dirty = false;
    setStudyAutosaveStatus("saved", state.studyAutosave.lastSavedAt ? `Saved ${state.studyAutosave.lastSavedAt}` : "Saved");
    return;
  }

  clearStudyAutosaveTimer();
  setStudyAutosaveStatus("dirty", "Unsaved changes");
  state.studyAutosave.timer = window.setTimeout(() => {
    runStudyTextAutosave().catch(error => {
      setStudyAutosaveStatus("error", "Autosave failed");
      console.error("Study text autosave failed:", error);
    });
  }, STUDY_AUTOSAVE_DELAY_MS);
}

async function runStudyTextAutosave() {
  clearStudyAutosaveTimer();
  const payload = studyTextPayloadFromForm({ autosave: true });
  const readiness = studyAutosaveReadiness(payload);
  if (!readiness.ready) {
    setStudyAutosaveStatus("waiting", readiness.message);
    return;
  }

  const signature = studyTextSignature(payload);
  if (signature === state.studyAutosave.lastSignature) {
    state.studyAutosave.dirty = false;
    setStudyAutosaveStatus("saved", "Saved");
    return;
  }

  if (state.studyAutosave.inFlight) {
    state.studyAutosave.dirty = true;
    setStudyAutosaveStatus("dirty", "Save queued");
    return;
  }

  state.studyAutosave.inFlight = true;
  state.studyAutosave.dirty = false;
  const token = state.studyAutosave.token;
  setStudyAutosaveStatus("saving", "Saving...");
  const promise = persistStudyTextPayload(payload);
  state.studyAutosave.promise = promise;
  try {
    const saved = await promise;
    if (token !== state.studyAutosave.token) return;
    applySavedStudyText(saved);
    rememberStudyAutosaveSignature(studyTextPayloadFromForm({ autosave: true }));
    const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    state.studyAutosave.lastSavedAt = savedAt;
    setStudyAutosaveStatus("saved", `Saved ${savedAt}`);
  } finally {
    if (token === state.studyAutosave.token) {
      state.studyAutosave.inFlight = false;
      state.studyAutosave.promise = null;
    }
  }

  if (token !== state.studyAutosave.token) return;
  if (state.studyAutosave.dirty || studyTextSignature(studyTextPayloadFromForm({ autosave: true })) !== state.studyAutosave.lastSignature) {
    scheduleStudyTextAutosave();
  }
}

function studyAutosaveReadiness(payload) {
  if (!payload.sourceId) return { ready: false, message: "Autosave waits for a source" };
  if (els.editingTextId.value) {
    return payload.title || stringValueFromClient(payload.content)
      ? { ready: true, message: "" }
      : { ready: false, message: "Autosave waits for text" };
  }
  if (stringValueFromClient(payload.content)) return { ready: true, message: "" };
  return { ready: false, message: "Autosave waits for text" };
}

function studyTextSignature(payload) {
  return JSON.stringify({
    id: els.editingTextId.value || "",
    payload
  });
}

function rememberStudyAutosaveSignature(payload = studyTextPayloadFromForm()) {
  state.studyAutosave.lastSignature = studyTextSignature(payload);
  state.studyAutosave.dirty = false;
}

function resetStudyAutosave(signaturePayload = null) {
  clearStudyAutosaveTimer();
  state.studyAutosave.token += 1;
  state.studyAutosave.inFlight = false;
  state.studyAutosave.promise = null;
  state.studyAutosave.dirty = false;
  state.studyAutosave.lastSavedAt = "";
  state.studyAutosave.lastSignature = signaturePayload ? studyTextSignature(signaturePayload) : "";
  setStudyAutosaveStatus(signaturePayload ? "saved" : "idle", signaturePayload ? "Saved" : "Autosave ready");
}

function clearStudyAutosaveTimer() {
  if (!state.studyAutosave.timer) return;
  window.clearTimeout(state.studyAutosave.timer);
  state.studyAutosave.timer = null;
}

function setStudyAutosaveStatus(status, message) {
  els.studyAutosaveStatus.textContent = message;
  els.studyAutosaveStatus.dataset.status = status;
}

async function saveStudyVideo(event) {
  event.preventDefault();

  const payload = {
    sourceId: els.videoSource.value,
    branchId: els.videoBranch.value,
    unitId: els.videoUnit.value,
    title: els.videoTitle.value.trim(),
    type: els.videoType.value
  };

  const id = els.editingVideoId.value;
  const file = await currentVideoFile();
  if (!id && !file) {
    throw new Error("Record or upload a video first");
  }

  const formData = new FormData();
  formData.append("payload", JSON.stringify(payload));
  if (file) {
    formData.append("video", file, file.name || recordingFilename(file.type));
  }

  const path = id ? `/api/study-videos/${id}` : "/api/study-videos";
  const method = id ? "PATCH" : "POST";
  const saved = await api(path, { method, body: formData });

  state.activeStudyVideoId = saved.id;
  state.activeLibraryTab = "videos";
  els.editingVideoId.value = saved.id;
  els.videoSaveLabel.textContent = "Update video";
  replaceStudyVideoRecord(saved);
  clearVideoBlob();
  els.videoInput.value = "";
  setVideoPreview(saved.video?.url || "", studyVideoStatus(saved));
  refreshStudyVideoLibraryAfterLocalChange();
  showToast(id ? "Video updated" : "Video saved");
}

async function saveNationalTest(event) {
  event.preventDefault();
  const file = els.testPdfInput.files[0];
  const listeningAudioFile = els.testListeningAudioCreateInput?.files?.[0];
  const listeningTranscriptFile = els.testListeningTranscriptCreateInput?.files?.[0];
  if (!file) {
    throw new Error("Choose a PDF test file first");
  }
  if (!isPdfFile(file)) {
    throw new Error("Only PDF files are accepted");
  }
  if (listeningAudioFile && !isListeningAudioFile(listeningAudioFile)) {
    throw new Error("Only MP3/MP4 listening audio is accepted");
  }
  if (listeningTranscriptFile && !isPdfFile(listeningTranscriptFile)) {
    throw new Error("Only PDF transcript files are accepted");
  }

  const formData = new FormData();
  formData.append("title", els.testTitle.value.trim());
  formData.append("course", els.testCourse.value.trim());
  formData.append("term", els.testTerm.value.trim());
  formData.append("year", els.testYear.value.trim());
  formData.append("description", els.testDescription.value.trim());
  formData.append("pdf", file, file.name || "national-test.pdf");
  if (listeningAudioFile) {
    formData.append("listeningAudio", listeningAudioFile, listeningAudioFile.name || "listening-audio.mp3");
  }
  if (listeningTranscriptFile) {
    formData.append("listeningTranscript", listeningTranscriptFile, listeningTranscriptFile.name || "listening-transcript.pdf");
  }

  const saved = await api("/api/national-tests", {
    method: "POST",
    body: formData
  });

  state.activeSection = "tests";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "tests");
  state.activeNationalTestId = saved.id;
  state.activeNationalTestPageId = "";
  state.activeNationalTestSectionFilter = "all";
  state.activeNationalTestPageSearch = "";
  state.nationalTestFocusMode = true;
  state.nationalTestFormOpen = false;
  state.activeLibraryTab = "tests";
  if (els.testWordLookupPanel) {
    els.testWordLookupPanel.open = false;
  }
  clearNationalTestFields();
  await loadDatabase();
  showToast("Test saved");
}

async function renameNationalTest(testId, title) {
  const cleanTitle = stringValueFromClient(title).trim();
  if (!cleanTitle) {
    throw new Error("Test title is required");
  }

  state.nationalTestRenameSavingId = testId;
  renderNationalTests();
  refreshIcons();

  try {
    const saved = await api(`/api/national-tests/${encodeURIComponent(testId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: cleanTitle })
    });
    replaceNationalTestRecord(saved);
    state.nationalTestRenamingId = "";
    showToast("Test name updated");
  } finally {
    state.nationalTestRenameSavingId = "";
    refreshNationalTestLibraryAfterLocalChange();
  }
}

async function saveNationalTestDetails(testId, form) {
  const formData = new FormData(form);
  const payload = {
    course: stringValueFromClient(formData.get("course")).trim(),
    term: stringValueFromClient(formData.get("term")).trim(),
    year: stringValueFromClient(formData.get("year")).trim()
  };

  state.nationalTestDetailsSavingId = testId;
  renderNationalTests();
  refreshIcons();

  try {
    const saved = await api(`/api/national-tests/${encodeURIComponent(testId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    replaceNationalTestRecord(saved);
    state.nationalTestDetailsEditingId = "";
    showToast("Test details updated");
  } finally {
    state.nationalTestDetailsSavingId = "";
    refreshNationalTestLibraryAfterLocalChange();
  }
}

async function updateNationalTestState(testId, payload, message) {
  const saved = await api(`/api/national-tests/${encodeURIComponent(testId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  replaceNationalTestRecord(saved);
  refreshNationalTestLibraryAfterLocalChange();
  showToast(message);
}

async function uploadNationalTestListeningMedia(testId, options = {}) {
  const audioInput = document.querySelector("#test-listening-audio-input");
  const transcriptInput = document.querySelector("#test-listening-transcript-input");
  const audioSelect = document.querySelector("#test-listening-audio-existing-select");
  const transcriptSelect = document.querySelector("#test-listening-transcript-existing-select");
  const audioFile = audioInput?.files?.[0];
  const transcriptFile = transcriptInput?.files?.[0];
  const audioFilename = stringValueFromClient(audioSelect?.value);
  const transcriptFilename = stringValueFromClient(transcriptSelect?.value);
  const topicKey = normalizedListeningTopicKey(options.topicKey);
  const mediaGroupId = stringValueFromClient(options.mediaGroupId);
  const selectedPageIds = [...document.querySelectorAll("[data-test-listening-page-id]:checked")]
    .map(input => stringValueFromClient(input.value))
    .filter(Boolean);
  const selectedPageLabels = [...document.querySelectorAll("[data-test-listening-page-id]:checked")]
    .map(input => stringValueFromClient(input.closest(".test-listening-page-option")?.querySelector("span")?.textContent))
    .filter(Boolean);
  if (topicKey && !selectedPageIds.length) {
    throw new Error("Choose at least one page for these listening files");
  }
  if (!audioFile && !transcriptFile && !audioFilename && !transcriptFilename) {
    throw new Error("Choose listening audio or transcript PDF first");
  }
  if (audioFile && !isListeningAudioFile(audioFile)) {
    throw new Error("Only MP3/MP4 listening audio is accepted");
  }
  if (transcriptFile && !isPdfFile(transcriptFile)) {
    throw new Error("Only PDF transcript files are accepted");
  }

  const formData = new FormData();
  if (audioFile) {
    formData.append("listeningAudio", audioFile, audioFile.name || "listening-audio.mp3");
  }
  if (transcriptFile) {
    formData.append("listeningTranscript", transcriptFile, transcriptFile.name || "listening-transcript.pdf");
  }
  if (!audioFile && audioFilename) {
    formData.append("audioFilename", audioFilename);
  }
  if (!transcriptFile && transcriptFilename) {
    formData.append("transcriptFilename", transcriptFilename);
  }
  if (topicKey) {
    formData.append("topicKey", topicKey);
    formData.append("topicLabel", stringValueFromClient(options.topicLabel) || topicKey);
    formData.append("pageIds", JSON.stringify(selectedPageIds));
    formData.append("pageLabels", JSON.stringify(selectedPageLabels));
  }
  if (mediaGroupId) {
    formData.append("mediaGroupId", mediaGroupId);
  }

  const saved = await api(`/api/national-tests/${testId}/listening-media`, {
    method: "POST",
    body: formData
  });
  replaceNationalTestRecord(saved);
  if (audioFile || transcriptFile) {
    await ensureListeningMediaFilesLoaded({ force: true });
  }
  refreshNationalTestLibraryAfterLocalChange();
  showToast("Listening files saved");
}

async function deleteNationalTestListeningMedia(testId, kind, options = {}) {
  const label = kind === "audio" ? "listening audio" : kind === "transcript" ? "timestamp transcript" : "this file set";
  if (!window.confirm(`Remove ${label} from this test?`)) return;
  const topicKey = normalizedListeningTopicKey(options.topicKey);
  const mediaGroupId = stringValueFromClient(options.mediaGroupId);
  const params = new URLSearchParams();
  if (topicKey) {
    params.set("topicKey", topicKey);
    params.set("topicLabel", stringValueFromClient(options.topicLabel) || topicKey);
  }
  if (mediaGroupId) {
    params.set("mediaGroupId", mediaGroupId);
  }
  const saved = await api(`/api/national-tests/${testId}/listening-media/${kind}${params.toString() ? `?${params}` : ""}`, { method: "DELETE" });
  replaceNationalTestRecord(saved);
  if (
    mediaGroupId &&
    normalizedListeningTopicKey(state.activeNationalTestTranscriptViewer?.topicKey) === topicKey &&
    stringValueFromClient(state.activeNationalTestTranscriptViewer?.mediaGroupId) === mediaGroupId
  ) {
    state.activeNationalTestTranscriptViewer = null;
  }
  refreshNationalTestLibraryAfterLocalChange();
  showToast("Listening file removed");
}

function updateSelectedTestListeningMediaStatus(kind) {
  const input = document.querySelector(kind === "audio" ? "#test-listening-audio-input" : "#test-listening-transcript-input");
  const status = document.querySelector(kind === "audio" ? "#test-listening-audio-status" : "#test-listening-transcript-status");
  if (!status) return;
  const file = input?.files?.[0];
  if (!file) {
    status.textContent = kind === "audio" ? "No media selected" : "No transcript selected";
    return;
  }
  status.textContent = `${file.name || "Selected file"} (${formatFileSize(file.size)})`;
}

function parseImportedPageJson(raw) {
  const input = stripClientBom(String(raw || "")).trim();
  if (!input) {
    throw new Error("empty input");
  }

  const candidates = new Set();
  const enqueue = value => {
    const normalized = String(value || "").trim();
    if (normalized) candidates.add(normalized);
  };

  enqueue(input);
  enqueue(unwrapJsonCodeFence(input));
  enqueue(extractLikelyJsonEnvelope(input));
  enqueue(extractLikelyJsonEnvelope(unwrapJsonCodeFence(input)));

  const errors = [];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      errors.push(error);
    }

    const sanitized = sanitizeJsonLikeText(candidate);
    if (sanitized !== candidate) {
      try {
        return JSON.parse(sanitized);
      } catch (error) {
        errors.push(error);
      }
    }
  }

  const message = errors.find(error => error?.message)?.message || "unexpected format";
  throw new Error(message);
}

function sanitizeJsonLikeText(value) {
  return stripTrailingJsonCommas(
    stripJsonComments(
      normalizeBrokenNumericTokens(
        normalizeSmartJsonQuotes(
          extractLikelyJsonEnvelope(
            unwrapJsonCodeFence(
              stripClientBom(value)
            )
          )
        )
      )
    )
  ).trim();
}

function stripClientBom(value) {
  return String(value || "").replace(/^\uFEFF/, "");
}

function unwrapJsonCodeFence(value) {
  const match = String(value || "").match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : String(value || "");
}

function extractLikelyJsonEnvelope(value) {
  const text = String(value || "").trim();
  const objectIndex = text.indexOf("{");
  const arrayIndex = text.indexOf("[");
  const indexes = [objectIndex, arrayIndex].filter(index => index >= 0).sort((a, b) => a - b);
  if (!indexes.length) return text;

  const start = indexes[0];
  const opener = text[start];
  const closer = opener === "[" ? "]" : "}";
  const end = text.lastIndexOf(closer);
  if (end <= start) return text;
  return text.slice(start, end + 1).trim();
}

function normalizeSmartJsonQuotes(value) {
  return String(value || "")
    .replace(/([{\[,]\s*)[\u201C\u201D]([^"\u201C\u201D\r\n]+)[\u201C\u201D](\s*:)/g, "$1\"$2\"$3")
    .replace(/(:\s*)[\u201C\u201D]([^"\u201C\u201D\r\n]*)[\u201C\u201D](\s*[,}\]])/g, "$1\"$2\"$3");
}

function normalizeBrokenNumericTokens(value) {
  return String(value || "").replace(
    /("[^"]+"\s*:\s*)(-?\d+(?:\.\d+)?)"(?=\s*[,}\]])/g,
    "$1$2"
  );
}

function stripJsonComments(value) {
  const text = String(value || "");
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingJsonCommas(value) {
  const text = String(value || "");
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1;
      if (text[lookahead] === "}" || text[lookahead] === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function nationalTestPagePatchPayload(page) {
  return {
    ...page,
    words: Array.isArray(page?.words) ? page.words : [],
    answers: Array.isArray(page?.answers) ? page.answers : []
  };
}

async function patchNationalTestPage(page) {
  if (!page?.id) return null;
  return api(`/api/national-test-pages/${page.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nationalTestPagePatchPayload(page))
  });
}

async function deleteNationalTestPage(pageId) {
  const page = (state.db.nationalTestPages || []).find(item => item.id === pageId);
  const test = page ? (state.db.nationalTests || []).find(item => item.id === page.testId) || activeNationalTest() : null;
  const label = page && test ? nationalTestVisualPageLabel(test, page) : "";
  const duplicate = page && test ? isDuplicateNationalTestPage(test, page) : false;
  const message = duplicate
    ? `Delete duplicate page ${label}? This removes only this page record.`
    : `Delete page ${label}?`;
  if (!page || !window.confirm(message)) return;
  await api(`/api/national-test-pages/${pageId}`, { method: "DELETE" });
  state.db.nationalTestPages = (state.db.nationalTestPages || []).filter(item => item.id !== pageId);
  if (state.activeNationalTestPageId === pageId) {
    state.activeNationalTestPageId = "";
  }
  renderNationalTests();
  refreshIcons();
  showToast("Page deleted");
}

function replaceNationalTestPage(page) {
  state.db.nationalTestPages = Array.isArray(state.db.nationalTestPages) ? state.db.nationalTestPages : [];
  const index = state.db.nationalTestPages.findIndex(item => item.id === page.id);
  if (index === -1) {
    state.db.nationalTestPages.push(page);
  } else {
    state.db.nationalTestPages[index] = page;
  }
}

function replaceNationalTestPages(pages) {
  (pages || []).forEach(replaceNationalTestPage);
}

async function persistNationalTestPageProgress(pageId, successMessage) {
  const page = (state.db.nationalTestPages || []).find(item => item.id === pageId);
  if (!page) return null;

  if (state.testPageAnswerAutosave.inFlight) {
    state.testPageAnswerAutosave.pending = true;
    state.testPageAnswerAutosave.pageId = page.id;
  } else {
    clearNationalTestAnswerAutosaveTimer();
    state.testPageAnswerAutosave.pending = false;
    state.testPageAnswerAutosave.pageId = "";
  }

  const saved = await patchNationalTestPage(page);
  if (saved) {
    replaceNationalTestPage(saved);
  }
  if (successMessage) {
    showToast(successMessage);
  }
  return saved;
}

function renderActiveNationalTestPageWordsUi(page = activeNationalTestPage()) {
  if (!page) return;
  document.querySelectorAll(".test-page-word-list").forEach(list => {
    list.innerHTML = testPageWordListHtml(page);
  });
  document.querySelectorAll(".test-page-word-practice-target").forEach(target => {
    target.innerHTML = testPageWordPracticeHtml(page);
  });
  renderNationalTestPageListMarkerUi(page);
  refreshIcons();
}

function renderActiveNationalTestPageWordPracticeFeedback(page = activeNationalTestPage()) {
  if (!page) return;
  const practice = ensureTestPageWordPracticeState(page);
  const entries = testPageWordPracticeEntries(page);
  const total = new Set(entries.map(word => word.key)).size;
  const accepted = testPageWordPracticeAcceptedKeys(page).size;
  const pageWordCount = entries.filter(entry => entry.source === "scanned").length;
  document.querySelectorAll("[data-test-page-word-practice-meter]").forEach(meter => {
    meter.textContent = `${accepted}/${total}`;
  });
  document.querySelectorAll("[data-test-page-word-practice-status]").forEach(status => {
    status.textContent = total
      ? practice.message || (accepted === total ? "All accepted" : pageWordCount ? `${pageWordCount} words found on this page` : "Ready")
      : "No words found on this visual page";
  });
  document.querySelectorAll("[data-test-page-word-practice-accepted]").forEach(list => {
    list.innerHTML = testPageWordPracticePadHtml(page, entries);
  });
  document.querySelectorAll("[data-test-page-word-practice-input]").forEach(input => {
    if (document.activeElement !== input) {
      input.value = practice.input;
    }
  });
  document.querySelectorAll("[data-test-page-word-practice-preview]").forEach(preview => {
    preview.innerHTML = testPageWordPracticeDraftFeedbackHtml(page);
  });
  document.querySelectorAll(".test-page-word-practice").forEach(panel => {
    panel.classList.toggle("is-accepted", practice.status === "accepted");
    panel.classList.toggle("is-pending", practice.status === "pending");
    panel.classList.toggle("is-rejected", practice.status === "rejected");
  });
}

function updateNationalTestPageWordPracticeDraftState(page, value) {
  const practice = ensureTestPageWordPracticeState(page);
  const rawValue = String(value || "");
  const key = normalizedTestPageWordPracticeKey(rawValue);
  const wordKeys = testPageWordPracticeInputWordKeys(rawValue);
  const entries = testPageWordPracticeEntries(page);
  const possibleMatch = key && (
    entries.some(word => word.key.startsWith(key)) ||
    testPageWordPracticeMatchesFromInput(rawValue, entries, page).length > 0
  );

  practice.input = rawValue;
  if (!key) {
    practice.status = "";
    practice.message = "";
  } else if (possibleMatch) {
    practice.status = "pending";
    practice.message = "";
  } else if (wordKeys.length > 1) {
    practice.status = "rejected";
    practice.message = "Sentence does not match the page";
  } else {
    practice.status = "";
    practice.message = "";
  }
}

function renderActiveNationalTestPageWordPracticeDraftFeedback(page = activeNationalTestPage()) {
  if (!page) return;
  const practice = ensureTestPageWordPracticeState(page);
  const entries = testPageWordPracticeEntries(page);
  const total = new Set(entries.map(word => word.key)).size;
  const accepted = testPageWordPracticeAcceptedKeys(page).size;
  const pageWordCount = entries.filter(entry => entry.source === "scanned").length;
  document.querySelectorAll("[data-test-page-word-practice-status]").forEach(status => {
    status.textContent = total
      ? practice.message || (accepted === total ? "All accepted" : pageWordCount ? `${pageWordCount} words found on this page` : "Ready")
      : "No words found on this visual page";
  });
  document.querySelectorAll("[data-test-page-word-practice-preview]").forEach(preview => {
    preview.innerHTML = testPageWordPracticeDraftFeedbackHtml(page);
  });
  document.querySelectorAll(".test-page-word-practice").forEach(panel => {
    panel.classList.toggle("is-accepted", practice.status === "accepted");
    panel.classList.toggle("is-pending", practice.status === "pending");
    panel.classList.toggle("is-rejected", practice.status === "rejected");
  });
}

function setNationalTestPageWordPracticeDraft(value) {
  const page = activeNationalTestPage();
  if (!page) return;
  updateNationalTestPageWordPracticeDraftState(page, value);

  renderActiveNationalTestPageWordPracticeFeedback(page);
}

function submitNationalTestPageWordPractice() {
  const page = activeNationalTestPage();
  if (!page) return;
  const practice = ensureTestPageWordPracticeState(page);
  const key = normalizedTestPageWordPracticeKey(practice.input);
  const entries = testPageWordPracticeEntries(page);
  const matches = testPageWordPracticeMatchesFromInput(practice.input, entries, page);
  const newMatches = matches.filter(match => !practice.acceptedKeys.has(match.key));

  if (!key) {
    practice.status = "";
    practice.message = "";
  } else if (matches.length) {
    const phraseText = testPageWordPracticeDisplayPhrase(practice.input, matches);
    const phraseKeys = matches.map(match => match.key);
    matches.forEach(match => practice.acceptedKeys.add(match.key));
    practice.acceptedPhrases = [
      ...practice.acceptedPhrases.filter(phrase => phrase.text !== phraseText),
      { text: phraseText, keys: phraseKeys }
    ];
    practice.input = "";
    document.querySelectorAll("[data-test-page-word-practice-input]").forEach(input => {
      input.value = "";
    });
    practice.status = "accepted";
    const total = new Set(entries.map(word => word.key)).size;
    const acceptedCount = newMatches.length || matches.length;
    practice.message = practice.acceptedKeys.size === total
      ? "All accepted"
      : acceptedCount === 1
        ? `Accepted: ${matches[0].word}`
        : `Accepted ${acceptedCount} words`;
    document.querySelectorAll(".test-page-word-list").forEach(list => {
      list.innerHTML = testPageWordListHtml(page);
    });
    refreshIcons();
  } else {
    practice.status = "rejected";
    practice.message = testPageWordPracticeInputWordKeys(practice.input).length > 1
      ? "Sentence does not match the page"
      : "Not on this page";
  }

  renderActiveNationalTestPageWordPracticeFeedback(page);
}

function handleNationalTestPageWordPracticeKeydown(event) {
  const pad = event.target.closest("[data-test-page-word-practice-pad]");
  if (!pad) return false;
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
  const page = activeNationalTestPage();
  if (!page || !testPageWordPracticeEntries(page).length) return false;
  const practiceInput = event.target.closest("[data-test-page-word-practice-input]");

  if (event.key === "Enter") {
    event.preventDefault();
    submitNationalTestPageWordPractice();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    setNationalTestPageWordPracticeDraft("");
    if (practiceInput) practiceInput.value = "";
    return true;
  }

  return Boolean(practiceInput);
}

function handleNationalTestPageWordPracticePaste(event) {
  if (event.target.closest("[data-test-page-word-practice-input]")) return false;
  const pad = event.target.closest("[data-test-page-word-practice-pad]");
  if (!pad) return false;
  const page = activeNationalTestPage();
  if (!page || !testPageWordPracticeEntries(page).length) return false;
  const text = event.clipboardData?.getData("text/plain") || "";
  if (!text) return false;
  const practice = ensureTestPageWordPracticeState(page);
  event.preventDefault();
  setNationalTestPageWordPracticeDraft(`${practice.input}${text}`);
  return true;
}

function renderNationalTestPageListMarkerUi(page) {
  const test = page ? (state.db.nationalTests || []).find(item => item.id === page.testId) || activeNationalTest() : null;
  if (!page || !test) return;
  const button = document.querySelector(`[data-select-test-page="${cssEscape(page.id)}"]`);
  const main = button?.querySelector(".test-page-button-main");
  if (!main) return;

  const label = main.querySelector(":scope > span:first-child")?.textContent || `Page ${nationalTestVisualPageLabel(test, page)}`;
  const markers = nationalTestPageListMarkersHtml(test, page);
  main.innerHTML = `
    <span>${escapeHtml(label)}</span>
    ${markers ? `<span class="test-page-marker-list">${markers}</span>` : ""}
  `;
}

function renderActiveNationalTestAnswerUi(page = activeNationalTestPage(), options = {}) {
  if (!page) return;
  const visualContent = document.querySelector("#test-page-visual-content");
  if (visualContent) {
    visualContent.classList.toggle("placing-comment", shouldShowTestPageAnswerMarkers() && Boolean(state.placingTestPageAnswerId));
  }

  const controls = document.querySelector(".test-page-visual-controls-section");
  const currentPanel = controls?.querySelector(".test-page-comment-panel");
  const nextPanelHtml = testPageCommentPanelHtml(page);
  if (currentPanel) {
    if (nextPanelHtml) {
      const template = document.createElement("template");
      template.innerHTML = nextPanelHtml.trim();
      currentPanel.replaceWith(template.content);
    } else {
      currentPanel.remove();
    }
  } else if (controls && nextPanelHtml) {
    controls.insertAdjacentHTML("beforeend", nextPanelHtml);
  }

  renderActiveNationalTestAnswerMarkersUi(page, options.surface);
  renderNationalTestPageListMarkerUi(page);
  refreshIcons();
}

function renderActiveNationalTestAnswerMarkersUi(page = activeNationalTestPage(), targetSurface = null) {
  if (!page) return;
  const surfaces = targetSurface
    ? [targetSurface]
    : [...document.querySelectorAll("[data-test-page-marker-surface]")]
      .filter(surface => !surface.dataset.testPageMarkerPageId || surface.dataset.testPageMarkerPageId === page.id);
  const markerHtml = shouldShowTestPageAnswerMarkers() ? testPageAnswerMarkerOverlayHtml(page) : "";
  surfaces.forEach(surface => {
    surface.querySelector(".test-page-comment-marker-layer")?.remove();
    if (markerHtml) {
      surface.insertAdjacentHTML("beforeend", markerHtml);
    }
  });
}

function updateNationalTestPageDraftFromEditor() {
  const page = activeNationalTestPage();
  if (!page) return null;
  const topicInput = document.querySelector("#test-page-topic-input");
  if (topicInput) {
    const topic = normalizedNationalTestPageTopic(topicInput.value);
    if (topic) {
      page.topic = topic;
    } else {
      delete page.topic;
    }
  }
  const sectionInput = document.querySelector("#test-page-section-input");
  if (sectionInput) {
    const nextSection = normalizedNationalTestSectionKey(sectionInput.value);
    if (nextSection) {
      page.section = nextSection;
    } else {
      delete page.section;
    }
  }
  updateNationalTestPageAnswersFromEditors(page);
  return page;
}

async function groupNationalTestPagesFromInput(testId) {
  const test = (state.db.nationalTests || []).find(item => item.id === testId);
  if (!test) return;
  updateNationalTestPageDraftFromEditor();

  const orderInput = document.querySelector("#test-page-order-input");
  const sectionInput = document.querySelector("#test-page-group-section-input");
  const topicInput = document.querySelector("#test-page-group-topic-input");
  const topic = normalizedNationalTestPageTopic(topicInput?.value);
  const sectionKey = normalizedNationalTestSectionKey(sectionInput?.value);
  const pageTokens = String(orderInput?.value || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  if (!pageTokens.length) {
    showToast("Write the pages first", true);
    return;
  }
  if (!NATIONAL_TEST_SECTIONS.some(section => section.key === sectionKey)) {
    showToast("Choose a skill type", true);
    return;
  }
  if (!topic) {
    showToast("Write the topic name", true);
    return;
  }

  const pages = nationalTestPages(testId);
  const usedIds = new Set();
  const matchedPages = [];
  const missingTokens = [];

  pageTokens.forEach(token => {
    const page = pages.find(item =>
      !usedIds.has(item.id) &&
      [...nationalTestPageLookupTokens(test, item)].some(candidate => candidate.toLocaleLowerCase() === token.toLocaleLowerCase())
    );
    if (!page) {
      missingTokens.push(token);
      return;
    }
    usedIds.add(page.id);
    matchedPages.push(page);
  });

  if (!matchedPages.length) {
    showToast("No matching pages were found", true);
    return;
  }
  if (missingTokens.length) {
    showToast(`These pages were not found: ${missingTokens.join(", ")}`, true);
    return;
  }

  const orderedPageIds = groupedNationalTestPageOrder(test, matchedPages, sectionKey, topic);
  const result = await api(`/api/national-tests/${testId}/pages/group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageIds: matchedPages.map(page => page.id),
      orderedPageIds,
      section: sectionKey,
      topic
    })
  });

  replaceNationalTestPages(result.pages || []);
  state.activeNationalTestId = testId;
  state.activeNationalTestPageId = matchedPages[0]?.id || state.activeNationalTestPageId;
  const activeGroupedPage = (state.db.nationalTestPages || []).find(page => page.id === state.activeNationalTestPageId);
  rememberNationalTestPageProgress(activeGroupedPage);
  expandNationalTestPageGroupsForPage(activeGroupedPage);
  if (state.activeNationalTestSectionFilter !== "all" && state.activeNationalTestSectionFilter !== sectionKey) {
    state.activeNationalTestSectionFilter = sectionKey;
  }
  if (orderInput) orderInput.value = "";
  if (topicInput) topicInput.value = "";
  rerenderNationalTestsPreservingViewport();
  showToast(`${matchedPages.length} ${matchedPages.length === 1 ? "page" : "pages"} grouped under ${topic}`);
}

async function setNationalTestSkillFinished(testId, sectionKey, finished) {
  const test = (state.db.nationalTests || []).find(item => item.id === testId);
  const section = NATIONAL_TEST_SECTIONS.find(item => item.key === normalizedNationalTestSectionKey(sectionKey));
  if (!test || !section) return;
  if (!window.confirm(`${finished ? "Mark" : "Reopen"} ${section.name} in "${test.title}"?`)) return;

  saveActiveNationalTestAnswerComposerDraft();
  updateNationalTestPageDraftFromEditor();
  await flushNationalTestAnswerAutosave();

  const result = await api(`/api/national-tests/${testId}/sections/${section.key}/finished`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ finished })
  });

  replaceNationalTestPages(result.pages || []);
  rerenderNationalTestsPreservingViewport({ keepActivePageVisible: true });
  showToast(`${section.name} ${finished ? "marked finished" : "reopened"}`);
}

async function setNationalTestSkillLocked(testId, sectionKey, locked) {
  const test = (state.db.nationalTests || []).find(item => item.id === testId);
  const section = NATIONAL_TEST_SECTIONS.find(item => item.key === normalizedNationalTestSectionKey(sectionKey));
  if (!test || !section) return;
  if (!window.confirm(`${locked ? "Lock" : "Unlock"} ${section.name} in "${test.title}"?`)) return;

  saveActiveNationalTestAnswerComposerDraft();
  updateNationalTestPageDraftFromEditor();
  await flushNationalTestAnswerAutosave();

  const result = await api(`/api/national-tests/${testId}/sections/${section.key}/locked`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locked })
  });

  replaceNationalTestPages(result.pages || []);
  const activePage = (state.db.nationalTestPages || []).find(page => page.id === state.activeNationalTestPageId);
  if (locked && activePage?.testId === testId && effectiveNationalTestPageSection(activePage) === section.key) {
    state.activeNationalTestPageId = "";
  }
  rerenderNationalTestsPreservingViewport({ keepActivePageVisible: true });
  showToast(`${section.name} ${locked ? "locked" : "unlocked"}`);
}

function focusNationalTestPageFromReader(pageId) {
  const page = (state.db.nationalTestPages || []).find(item => item.id === pageId);
  if (!page) return;
  saveActiveNationalTestAnswerComposerDraft();
  updateNationalTestPageDraftFromEditor();
  resetNationalTestAnswerRevealState();
  if (!state.nationalTestFocusMode || state.activeNationalTestId !== page.testId) {
    openNationalTestStudy(page.testId);
  }
  const sectionKey = effectiveNationalTestPageSection(page);
  if (sectionKey) {
    if (normalizedNationalTestSectionKey(state.activeNationalTestSectionFilter) !== "all" && normalizedNationalTestSectionKey(state.activeNationalTestSectionFilter) !== sectionKey) {
      state.activeNationalTestSectionFilter = sectionKey;
    }
  } else if (normalizedNationalTestSectionKey(state.activeNationalTestSectionFilter) !== "all") {
    state.activeNationalTestSectionFilter = "all";
  }
  state.activeNationalTestId = page.testId;
  state.activeNationalTestPageId = page.id;
  restoreNationalTestAnswerDraftForPage(page.id);
  rememberNationalTestPageProgress(page);
  expandNationalTestPageGroupsForPage(page);
  closeStudyTextReader();
  renderNationalTests();
  refreshIcons();
}

async function addNationalTestPageWord() {
  const page = activeNationalTestPage();
  if (!page) return;
  updateNationalTestPageDraftFromEditor();
  const wordInput = document.querySelector("#test-page-word-input");
  const noteInput = document.querySelector("#test-page-word-note-input");
  const word = wordInput?.value.trim() || "";
  if (!word) {
    showToast("Type a word first", true);
    return;
  }
  page.words = Array.isArray(page.words) ? page.words : [];
  page.words.push({
    id: `page_word_${crypto.randomUUID?.() || Date.now()}`,
    word,
    note: noteInput?.value.trim() || "",
    createdAt: new Date().toISOString()
  });
  if (wordInput) wordInput.value = "";
  if (noteInput) noteInput.value = "";
  renderActiveNationalTestPageWordsUi(page);
  document.querySelector("#test-page-word-input")?.focus();
  try {
    await persistNationalTestPageProgress(page.id, "Page word saved");
  } catch (error) {
    showToast(error.message || "Page word save failed", true);
  }
}

async function removeNationalTestPageWord(wordId) {
  const page = activeNationalTestPage();
  if (!page) return;
  updateNationalTestPageDraftFromEditor();
  page.words = (page.words || []).filter(word => word.id !== wordId);
  renderActiveNationalTestPageWordsUi(page);
  try {
    await persistNationalTestPageProgress(page.id, "Page word removed");
  } catch (error) {
    showToast(error.message || "Page word save failed", true);
  }
}

function clearNationalTestAnswerAutosaveTimer() {
  if (state.testPageAnswerAutosave.timer) {
    clearTimeout(state.testPageAnswerAutosave.timer);
    state.testPageAnswerAutosave.timer = null;
  }
}

function testPageAnswerDraftForPage(pageId) {
  return state.testPageAnswerDrafts instanceof Map ? state.testPageAnswerDrafts.get(pageId) || null : null;
}

function setTestPageAnswerDraft(pageId, draft) {
  if (!pageId) return;
  if (!(state.testPageAnswerDrafts instanceof Map)) {
    state.testPageAnswerDrafts = new Map();
  }
  state.testPageAnswerDrafts.set(pageId, {
    question: String(draft?.question || ""),
    answer: String(draft?.answer || ""),
    open: Boolean(draft?.open)
  });
}

function clearTestPageAnswerDraft(pageId = state.activeNationalTestPageId) {
  if (!pageId || !(state.testPageAnswerDrafts instanceof Map)) return;
  state.testPageAnswerDrafts.delete(pageId);
}

function saveActiveNationalTestAnswerComposerDraft() {
  const page = activeNationalTestPage();
  if (!page || !state.testPageAnswerComposerOpen) return;
  const questionInput = document.querySelector("#test-page-answer-question-input");
  const answerInput = document.querySelector("#test-page-answer-text-input");
  const existing = testPageAnswerDraftForPage(page.id) || {};
  setTestPageAnswerDraft(page.id, {
    question: questionInput ? questionInput.value : existing.question || nextNationalTestAnswerQuestion(page),
    answer: answerInput ? answerInput.value : existing.answer || "",
    open: true
  });
}

function updateActiveNationalTestAnswerComposerDraftFromInput() {
  const page = activeNationalTestPage();
  if (!page) return;
  const questionInput = document.querySelector("#test-page-answer-question-input");
  const answerInput = document.querySelector("#test-page-answer-text-input");
  setTestPageAnswerDraft(page.id, {
    question: questionInput?.value || "",
    answer: answerInput?.value || "",
    open: true
  });
}

function restoreNationalTestAnswerDraftForPage(pageId = state.activeNationalTestPageId) {
  const draft = testPageAnswerDraftForPage(pageId);
  state.testPageAnswerComposerOpen = Boolean(draft?.open);
}

function scheduleNationalTestAnswerAutosave(delay = 500) {
  const page = activeNationalTestPage();
  if (!page) return;
  updateNationalTestPageAnswersFromEditors(page);
  const autosave = state.testPageAnswerAutosave;
  autosave.pageId = page.id;
  autosave.pending = true;
  clearNationalTestAnswerAutosaveTimer();
  autosave.timer = setTimeout(() => {
    autosave.timer = null;
    flushNationalTestAnswerAutosave().catch(error => {
      showToast(error.message || "Answer autosave failed", true);
    });
  }, delay);
}

async function flushNationalTestAnswerAutosave(pageId = state.testPageAnswerAutosave.pageId) {
  const autosave = state.testPageAnswerAutosave;
  clearNationalTestAnswerAutosaveTimer();
  if (!pageId) return null;
  const page = (state.db.nationalTestPages || []).find(item => item.id === pageId);
  if (!page) return null;

  if (state.activeNationalTestPageId === page.id) {
    updateNationalTestPageAnswersFromEditors(page);
  }

  if (autosave.inFlight) {
    autosave.pending = true;
    autosave.pageId = page.id;
    return null;
  }

  autosave.inFlight = true;
  autosave.pending = false;
  autosave.pageId = page.id;
  try {
    const saved = await patchNationalTestPage(page);
    if (saved && !autosave.pending) {
      replaceNationalTestPage(saved);
    }
    return saved;
  } finally {
    autosave.inFlight = false;
    if (autosave.pending) {
      const pendingPageId = autosave.pageId;
      autosave.pending = false;
      clearNationalTestAnswerAutosaveTimer();
      autosave.timer = setTimeout(() => {
        autosave.timer = null;
        flushNationalTestAnswerAutosave(pendingPageId).catch(error => {
          showToast(error.message || "Answer autosave failed", true);
        });
      }, 150);
    } else {
      autosave.pageId = "";
    }
  }
}

function resetNationalTestAnswerRevealState() {
  state.testPageAnswerComposerOpen = false;
  state.editingTestPageAnswerId = "";
  state.placingTestPageAnswerId = "";
}

function closeNationalTestPageAnswerEditor(options = {}) {
  updateNationalTestPageDraftFromEditor();
  const page = activeNationalTestPage();
  state.testPageAnswerComposerOpen = false;
  state.editingTestPageAnswerId = "";
  if (options.cancelPlacement) {
    state.placingTestPageAnswerId = "";
  }
  flushNationalTestAnswerAutosave().catch(error => {
    showToast(error.message || "Answer autosave failed", true);
  });
  renderActiveNationalTestAnswerUi(page);
}

function editNationalTestPageAnswer(answerId, options = {}) {
  if (!answerId) return;
  saveActiveNationalTestAnswerComposerDraft();
  updateNationalTestPageDraftFromEditor();
  const page = activeNationalTestPage();
  state.testPageAnswerComposerOpen = false;
  state.placingTestPageAnswerId = "";
  state.editingTestPageAnswerId = answerId;
  renderActiveNationalTestAnswerUi(page, { surface: options.surface });
}

function openNationalTestPageAnswerComposer() {
  updateNationalTestPageDraftFromEditor();
  const page = activeNationalTestPage();
  if (page && !testPageAnswerDraftForPage(page.id)) {
    setTestPageAnswerDraft(page.id, {
      question: nextNationalTestAnswerQuestion(page),
      answer: "",
      open: true
    });
  } else if (page) {
    const draft = testPageAnswerDraftForPage(page.id);
    setTestPageAnswerDraft(page.id, { ...draft, open: true });
  }
  state.testPageAnswerComposerOpen = true;
  state.editingTestPageAnswerId = "";
  state.placingTestPageAnswerId = "";
  rerenderNationalTestsPreservingViewport();
}

function startPlacingNationalTestPageAnswer(answerId) {
  if (!answerId) return;
  saveActiveNationalTestAnswerComposerDraft();
  updateNationalTestPageDraftFromEditor();
  state.testPageAnswerComposerOpen = false;
  state.editingTestPageAnswerId = "";
  state.placingTestPageAnswerId = answerId;
  rerenderNationalTestsPreservingViewport();
}

function placeNationalTestPageAnswerFromEvent(event) {
  const answerId = state.placingTestPageAnswerId;
  if (!answerId) return false;
  if (!shouldShowTestPageAnswerMarkers()) return false;
  if (event.target.closest("[data-test-page-answer-marker], input, textarea, select, a")) return false;
  const surface = event.target.closest("[data-test-page-marker-surface]");
  if (!surface) return false;
  const page = activeNationalTestPage();
  const answer = (page?.answers || []).find(item => item.id === answerId);
  if (!page || !answer) return false;
  if (surface.dataset.testPageMarkerPageId && surface.dataset.testPageMarkerPageId !== page.id) return false;

  const rect = surface.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  answer.xPercent = normalizedNationalTestAnswerPercent(((event.clientX - rect.left) / rect.width) * 100);
  answer.yPercent = normalizedNationalTestAnswerPercent(((event.clientY - rect.top) / rect.height) * 100);
  answer.updatedAt = new Date().toISOString();
  state.placingTestPageAnswerId = "";
  state.editingTestPageAnswerId = "";
  flushNationalTestAnswerAutosave(page.id).catch(error => {
    showToast(error.message || "Answer autosave failed", true);
  });
  renderActiveNationalTestAnswerUi(page, { surface });
  showToast("Answer marker placed");
  return true;
}

function addNationalTestPageAnswer() {
  const page = activeNationalTestPage();
  if (!page) return;
  updateNationalTestPageDraftFromEditor();
  const questionInput = document.querySelector("#test-page-answer-question-input");
  const answerInput = document.querySelector("#test-page-answer-text-input");
  const question = normalizedNationalTestAnswerQuestion(questionInput?.value || nextNationalTestAnswerQuestion(page));
  const answer = stringValueFromClient(answerInput?.value);
  if (!answer) {
    showToast("Write the answer first", true);
    return;
  }
  const answerId = `page_answer_${crypto.randomUUID?.() || Date.now()}`;
  const now = new Date().toISOString();
  page.answers = Array.isArray(page.answers) ? page.answers : [];
  page.answers.push({
    id: answerId,
    question,
    answer,
    createdAt: now,
    updatedAt: now
  });
  if (questionInput) questionInput.value = nextNationalTestAnswerQuestion(page);
  if (answerInput) answerInput.value = "";
  clearTestPageAnswerDraft(page.id);
  state.testPageAnswerComposerOpen = false;
  state.editingTestPageAnswerId = "";
  state.placingTestPageAnswerId = answerId;
  rerenderNationalTestsPreservingViewport();
  flushNationalTestAnswerAutosave(page.id).catch(error => {
    showToast(error.message || "Answer autosave failed", true);
  });
}

function removeNationalTestPageAnswer(answerId) {
  const page = activeNationalTestPage();
  if (!page) return;
  updateNationalTestPageDraftFromEditor();
  page.answers = (page.answers || []).filter(answer => answer.id !== answerId);
  if (state.editingTestPageAnswerId === answerId) state.editingTestPageAnswerId = "";
  if (state.placingTestPageAnswerId === answerId) state.placingTestPageAnswerId = "";
  rerenderNationalTestsPreservingViewport();
  flushNationalTestAnswerAutosave(page.id).catch(error => {
    showToast(error.message || "Answer autosave failed", true);
  });
}

function updateNationalTestPageAnswersFromEditors(page) {
  const editors = [...document.querySelectorAll("[data-test-page-answer-editor]")];
  if (!editors.length) return;
  const answers = Array.isArray(page.answers) ? page.answers : [];
  editors.forEach(editor => {
    const answerId = editor.dataset.testPageAnswerEditor;
    const answer = answers.find(item => item.id === answerId);
    if (!answer) return;
    const questionInput = editor.querySelector("[data-test-page-answer-question]");
    const answerInput = editor.querySelector("[data-test-page-answer-text]");
    const nextQuestion = normalizedNationalTestAnswerQuestion(questionInput?.value);
    const nextAnswer = stringValueFromClient(answerInput?.value);
    const changed = answer.question !== nextQuestion || answer.answer !== nextAnswer;
    answer.question = nextQuestion;
    answer.answer = nextAnswer;
    if (changed) {
      answer.updatedAt = new Date().toISOString();
    }
  });
}

function normalizedNationalTestAnswerQuestion(value) {
  return stringValueFromClient(value)
    .replace(/^q(?:uestion)?\.?\s*/i, "")
    .trim();
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function setWordSelected(wordId, selected) {
  if (selected) {
    state.selectedWordIds.add(wordId);
  } else {
    state.selectedWordIds.delete(wordId);
  }
  renderWords();
  refreshIcons();
}

function selectVisibleWords() {
  getFilteredWords().forEach(word => state.selectedWordIds.add(word.id));
  renderWords();
  refreshIcons();
}

function clearSelectedWords() {
  state.selectedWordIds.clear();
  renderWords();
  refreshIcons();
}

async function deleteSelectedWords() {
  const ids = selectedWordIds();
  if (!ids.length) return;
  if (!window.confirm(`Delete ${selectedCountText(ids.length)}?`)) return;

  const result = await api("/api/bulk/words", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  });
  state.selectedWordIds.clear();
  ids.forEach(removeWordRecord);
  refreshWordLibraryAfterLocalChange();
  showToast(`${result.count} ${result.count === 1 ? "word" : "words"} deleted`);
}

async function deleteVerb(verbId) {
  const verb = (state.db.verbs || []).find(item => item.id === verbId);
  if (!verb || !window.confirm(`Delete "${verb.base}"?`)) return;
  await api(`/api/verbs/${verb.id}`, { method: "DELETE" });
  removeVerbRecord(verb.id);
  refreshVerbLibraryAfterLocalChange();
  showToast("Verb deleted");
}

async function moveSelectedWords() {
  const ids = selectedWordIds();
  if (!ids.length) return;
  ensureBulkLocation();

  const result = await api("/api/bulk/words/location", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ids,
      location: {
        sourceId: state.bulkLocation.sourceId,
        branchId: state.bulkLocation.branchId,
        unitId: state.bulkLocation.unitId
      }
    })
  });
  state.selectedWordIds.clear();
  (result.updated || []).forEach(replaceWordRecord);
  refreshWordLibraryAfterLocalChange();
  showToast(`${result.count} ${result.count === 1 ? "word" : "words"} moved`);
}

async function fetchPronunciationsForVisibleWords() {
  const selectedIds = selectedWordIds();
  const ids = selectedIds.length ? selectedIds : getFilteredWords().map(word => word.id);
  if (!ids.length) return;

  state.pronunciations.refreshing = true;
  renderWords();
  refreshIcons();
  try {
    const result = await api("/api/pronunciations/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    (result.words || []).forEach(replaceWordRecord);
    if (Array.isArray(result.words) && result.words.length) {
      refreshWordLibraryAfterLocalChange();
    }
    const updated = result.updated || 0;
    const missing = result.missing || 0;
    const errors = result.errors || 0;
    const details = [
      `${updated} ${updated === 1 ? "audio file" : "audio files"} added`,
      missing ? `${missing} missing` : "",
      errors ? `${errors} failed` : ""
    ].filter(Boolean).join(", ");
    showToast(details || "No pronunciation audio needed");
  } finally {
    state.pronunciations.refreshing = false;
    renderWords();
    refreshIcons();
  }
}

async function importJson(event) {
  event.preventDefault();
  const items = parseJsonImportItems();
  const location = jsonImportLocation();
  const body = { items, location };
  const imageEntries = jsonImageEntriesForItems(items);
  const options = imageEntries.length
    ? {
        method: "POST",
        body: jsonImportFormData(body, imageEntries)
      }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      };

  const result = await api("/api/words", options);
  els.jsonInput.value = "";
  state.jsonImages.clear();
  els.jsonImageMapper.innerHTML = imageMapperStateHtml("Paste word JSON to create image boxes.");
  (result.created || []).forEach(replaceWordRecord);
  refreshWordLibraryAfterLocalChange();
  showToast(`${result.created.length} ${result.created.length === 1 ? "word" : "words"} imported`);
}

async function importVerbs(event) {
  event.preventDefault();
  const items = parseVerbImportItems();
  const result = await api("/api/verbs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
  els.verbJsonInput.value = "";
  (result.verbs || []).forEach(replaceVerbRecord);
  refreshVerbLibraryAfterLocalChange();
  showToast(`${result.verbs.length} ${result.verbs.length === 1 ? "verb" : "verbs"} imported`);
}

function parseVerbImportItems() {
  const jsonText = els.verbJsonInput.value.trim();
  if (!jsonText) {
    throw new Error("Paste one verb or a list of verbs as JSON first");
  }
  const parsed = JSON.parse(jsonText);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.verbs)) return parsed.verbs;
  if (Array.isArray(parsed.items)) return parsed.items;
  return [parsed];
}

function jsonImportLocation() {
  const location = {
    sourceId: els.jsonSource.value,
    branchId: els.jsonBranch.value,
    unitId: els.jsonUnit.value
  };
  if (!location.sourceId) {
    els.jsonSource.focus();
    throw new Error("Choose a source before importing JSON");
  }
  return location;
}

function parseJsonImportItems() {
  const jsonText = els.jsonInput.value.trim();
  if (!jsonText) {
    throw new Error("Paste one word or a list of words as JSON first");
  }
  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function jsonImageEntriesForItems(items) {
  return [...state.jsonImages.entries()]
    .filter(([index]) => index >= 0 && index < items.length)
    .sort(([left], [right]) => left - right);
}

function jsonImportFormData(body, imageEntries) {
  const formData = new FormData();
  const payload = {
    ...body,
    imageIndexes: imageEntries.map(([index]) => index)
  };
  formData.append("payload", JSON.stringify(payload));
  imageEntries.forEach(([, file]) => formData.append("images", file));
  return formData;
}

function updateSingleImageControl() {
  const file = els.imageInput.files[0];
  const label = file ? file.name || "Pasted image" : "Paste, drop, or click image";
  els.singleImageStatus.textContent = label;
  els.singleImageDropBox.classList.toggle("has-image", Boolean(file));
  els.singleImageDropBox.setAttribute("title", label);
}

function setSingleImage(file) {
  if (!hasSelectedWordPath()) {
    showToast("Choose a source, unit, or topic from Sources first", true);
    return;
  }
  if (!file || !file.type.startsWith("image/")) {
    showToast("Only image files are accepted", true);
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  els.imageInput.files = transfer.files;
  els.removeImageInput.checked = false;
  updateSingleImageControl();
}

function updateJsonImageMapper() {
  let items;
  try {
    items = parseJsonImportItems();
  } catch {
    state.jsonImages.clear();
    els.jsonImageMapper.innerHTML = imageMapperStateHtml("Paste valid word JSON to create image boxes.");
    return;
  }

  [...state.jsonImages.keys()].forEach(index => {
    if (index >= items.length) state.jsonImages.delete(index);
  });

  if (!items.length) {
    els.jsonImageMapper.innerHTML = imageMapperStateHtml("No words found in the JSON.");
    return;
  }

  els.jsonImageMapper.innerHTML = items.map((item, index) => {
    const file = state.jsonImages.get(index);
    const word = String(item?.word || `Word ${index + 1}`).trim() || `Word ${index + 1}`;
    const partsOfSpeech = normalizePartOfSpeech(item);
    return `
      <div class="json-image-slot ${file ? "has-image" : ""}" data-image-index="${index}" tabindex="0">
        <div class="json-image-word">
          <strong>${index + 1}. ${escapeHtml(word)}</strong>
          ${partsOfSpeech.length ? `<span>${escapeHtml(partsOfSpeech.join(", "))}</span>` : ""}
        </div>
        <button class="image-drop-box" type="button" data-pick-json-image="${index}">
          ${file ? `<span class="image-file-name">${escapeHtml(file.name)}</span>` : `<span>Paste, drop, or click image</span>`}
        </button>
        ${file ? `<button class="icon-button danger-button" type="button" title="Remove image" aria-label="Remove image" data-clear-json-image="${index}">${icon("x")}</button>` : ""}
      </div>
    `;
  }).join("");
  refreshIcons();
}

function setJsonImage(index, file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Only image files are accepted", true);
    return;
  }
  state.jsonImages.set(index, file);
  updateJsonImageMapper();
}

function findWordInState(wordId) {
  return state.db.words.find(item => item.id === wordId) ||
    state.practice.words.find(item => item.id === wordId) ||
    state.practice.queue.find(item => item.id === wordId) ||
    state.review.words.find(item => item.id === wordId) ||
    state.soundPractice.words.find(item => item.id === wordId) ||
    (state.practice.current?.id === wordId ? state.practice.current : null);
}

async function playPronunciation(wordId) {
  const word = findWordInState(wordId);
  if (!word) return;

  if (word.pronunciation?.exact && word.pronunciation?.phonetic && !word.pronunciation?.audioUrl) {
    showToast("No recorded word audio for this IPA", true);
    return;
  }

  if (!word.pronunciation?.audioUrl || !word.pronunciation.audioUrl.startsWith("/pronunciations/")) {
    await fetchPronunciationForWord(wordId);
  }

  const updatedWord = findWordInState(wordId);
  const audioUrl = updatedWord?.pronunciation?.audioUrl;
  if (!audioUrl) {
    showToast("No pronunciation audio for this word", true);
    return;
  }

  playAudioUrl(audioUrl);
}

async function fetchPronunciationForWord(wordId) {
  if (state.pronunciations.loadingIds.has(wordId)) return;
  state.pronunciations.loadingIds.add(wordId);
  renderWords();
  refreshIcons();
  focusPronunciationTarget(wordId);
  try {
    const result = await api(`/api/words/${wordId}/pronunciation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (result.word) {
      replaceWordInState(result.word);
    }
  } finally {
    state.pronunciations.loadingIds.delete(wordId);
    renderWords();
    refreshIcons();
    focusPronunciationTarget(wordId);
  }
}

function replaceWordInState(word) {
  if (!word?.id) return;
  if (!wordHasIpaPronunciation(word)) state.visibleIpaPronunciationWordIds.delete(word.id);
  replaceWordRecord(word);
  replaceWordInList(state.practice.words, word);
  replaceWordInList(state.practice.queue, word);
  replaceWordInList(state.review.words, word);
  replaceWordInList(state.soundPractice.words, word);
  if (state.practice.current?.id === word.id) {
    state.practice.current = word;
  }
}

function replaceWordInList(words, replacement) {
  const index = words.findIndex(word => word.id === replacement.id);
  if (index !== -1) {
    words[index] = replacement;
  }
}

function playAudioUrl(audioUrl) {
  if (state.pronunciations.audio) {
    state.pronunciations.audio.pause();
  }
  const audio = new Audio(audioUrl);
  state.pronunciations.audio = audio;
  audio.play().catch(() => {
    showToast("Pronunciation audio could not play", true);
  });
}

function playIpaSound(token) {
  const audioUrl = IPA_SOUND_MAP[token];
  if (!audioUrl) {
    showToast("No IPA sound file connected yet", true);
    return;
  }
  playAudioUrl(audioUrl);
}

async function startWordPronunciationRecording(wordId) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("Audio recording is not supported in this browser", true);
    return;
  }
  setFocusedWord(wordId);
  const recorderState = state.pronunciationRecorder;
  if (recorderState.recorder?.state === "recording") return;
  if (recorderState.activeWordId !== wordId) {
    cleanupWordPronunciationRecorder();
    recorderState.activeWordId = wordId;
  } else {
    clearWordPronunciationRecording({ keepOpen: true });
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = audioRecordingMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  recorderState.stream = stream;
  recorderState.recorder = recorder;
  recorderState.chunks = [];
  recorderState.status = "Recording...";
  recorderState.discardRecording = false;

  recorder.addEventListener("dataavailable", event => {
    if (event.data?.size) recorderState.chunks.push(event.data);
  });
  recorder.addEventListener("stop", () => {
    if (recorderState.discardRecording) {
      recorderState.discardRecording = false;
      recorderState.chunks = [];
      stopWordPronunciationStream(stream);
      return;
    }
    const type = recorder.mimeType || mimeType || "audio/webm";
    const blob = new Blob(recorderState.chunks, { type });
    if (recorderState.recordingUrl) URL.revokeObjectURL(recorderState.recordingUrl);
    recorderState.recordingUrl = URL.createObjectURL(blob);
    recorderState.status = "Recorded. Play your voice to compare.";
    stopWordPronunciationStream(stream);
    renderWords();
    refreshIcons();
    focusPronunciationTarget(wordId);
  });

  recorder.start();
  renderWords();
  refreshIcons();
  focusPronunciationTarget(wordId);
}

function stopWordPronunciationRecording(wordId = "") {
  if (wordId && state.pronunciationRecorder.activeWordId !== wordId) return;
  const recorder = state.pronunciationRecorder.recorder;
  if (recorder?.state === "recording") {
    recorder.stop();
    state.pronunciationRecorder.status = "Finishing recording...";
    renderWords();
    refreshIcons();
    focusPronunciationTarget(wordId || state.pronunciationRecorder.activeWordId);
  }
}

function playWordPronunciationRecording(wordId = "") {
  if (wordId && state.pronunciationRecorder.activeWordId !== wordId) return;
  const url = state.pronunciationRecorder.recordingUrl;
  if (!url) return;
  if (state.pronunciationRecorder.audio) {
    state.pronunciationRecorder.audio.pause();
  }
  const audio = new Audio(url);
  state.pronunciationRecorder.audio = audio;
  state.pronunciationRecorder.status = "Playing your voice...";
  audio.addEventListener("ended", () => {
    state.pronunciationRecorder.status = "Recorded. Play again or record again.";
    renderWords();
    refreshIcons();
    focusPronunciationTarget(wordId || state.pronunciationRecorder.activeWordId);
  });
  audio.play().catch(() => {
    state.pronunciationRecorder.status = "Your recording could not play";
    renderWords();
    refreshIcons();
    focusPronunciationTarget(wordId || state.pronunciationRecorder.activeWordId);
  });
  renderWords();
  refreshIcons();
  focusPronunciationTarget(wordId || state.pronunciationRecorder.activeWordId);
}

function clearWordPronunciationRecording(options = {}) {
  const recorderState = state.pronunciationRecorder;
  if (recorderState.recorder?.state === "recording") {
    recorderState.discardRecording = true;
    recorderState.recorder.stop();
  }
  if (recorderState.audio) {
    recorderState.audio.pause();
    recorderState.audio = null;
  }
  if (recorderState.recordingUrl) {
    URL.revokeObjectURL(recorderState.recordingUrl);
  }
  recorderState.recordingUrl = "";
  recorderState.chunks = [];
  recorderState.recorder = null;
  stopWordPronunciationStream();
  recorderState.status = "Ready";
  if (!options.keepOpen) {
    recorderState.activeWordId = "";
  }
}

function cleanupWordPronunciationRecorder() {
  clearWordPronunciationRecording();
}

function stopWordPronunciationStream(targetStream = state.pronunciationRecorder.stream) {
  const stream = targetStream;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  if (state.pronunciationRecorder.stream === stream) {
    state.pronunciationRecorder.stream = null;
  }
}

function audioRecordingMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];
  return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function imageFromClipboard(event) {
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find(item => item.type.startsWith("image/"));
  return imageItem?.getAsFile() || null;
}

function editWord(word) {
  state.activeSection = "vault";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "vault");
  clearLookupResults();
  state.activeTab = "single";
  state.vaultEditorOpen = true;
  updateTabs();
  const location = wordPrimaryLocation(word);
  state.selected = {
    sourceId: location.sourceId,
    branchId: location.branchId,
    unitId: location.unitId
  };
  renderSelectors();
  els.editingId.value = word.id;
  els.wordInput.value = word.word || "";
  els.partOfSpeechInput.value = normalizePartOfSpeech(word).join(", ");
  els.definitionInput.value = word.definition || "";
  els.arabicTranslationInput.value = word.arabicTranslation || "";
  els.collocationsInput.value = (word.collocations || []).join("\n");
  els.examplesInput.value = (word.examples || []).join("\n");
  els.synonymsInput.value = formatSynonymsForInput(word.synonyms);
  els.imageInput.value = "";
  els.removeImageInput.checked = false;
  updateSingleImageControl();
  els.saveLabel.textContent = "Update word";
  document.querySelector(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function startNewStudyText(location = state.selected) {
  state.activeSection = "vault";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "vault");
  state.vaultEditorOpen = true;
  state.selected = {
    sourceId: location.sourceId || state.selected.sourceId,
    branchId: location.branchId || "",
    unitId: location.unitId || ""
  };
  state.activeTab = "study";
  state.activeLibraryTab = "texts";
  state.activeStudyTextId = "";
  clearStudyTextFields();
  render();
  updateTabs();
  focusStudyTitle();
}

function editStudyText(text) {
  state.activeSection = "vault";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "vault");
  state.activeTab = "study";
  state.vaultEditorOpen = true;
  state.activeLibraryTab = "texts";
  state.activeStudyTextId = text.id;
  state.selected = {
    sourceId: text.sourceId,
    branchId: text.branchId,
    unitId: text.unitId
  };
  render();
  updateTabs();
  els.editingTextId.value = text.id;
  els.studyTitle.value = text.title || "";
  els.studyType.value = STUDY_TEXT_TYPES.some(type => type.value === text.type) ? text.type : "note";
  setEssayFields(text.type === "essay" ? text.essay : {}, text.content || "", { editing: true });
  els.studyContent.value = text.content || "";
  clearVocabularyPracticeSelection();
  updateStudyTextMode();
  resetStudyAutosave(studyTextPayloadFromForm());
  els.studySaveLabel.textContent = "Update text";
  document.querySelector(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetStudyTextForm(renderAfter = true) {
  state.activeStudyTextId = "";
  clearStudyTextFields();
  renderSelectors();
  if (renderAfter) {
    renderSources();
    renderStudyTexts();
    refreshIcons();
  }
}

function clearStudyTextFields() {
  els.studyForm.reset();
  els.editingTextId.value = "";
  els.studyTitle.value = "";
  els.studyType.value = "note";
  els.studyContent.value = "";
  clearEssayFields();
  clearVocabularyPractice();
  updateStudyTextMode();
  resetStudyAutosave();
  els.studySaveLabel.textContent = "Save text";
}

function focusStudyTitle() {
  document.querySelector(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  requestAnimationFrame(() => els.studyTitle.focus());
}

function startNewStudyVideo(location = state.selected) {
  state.activeSection = "vault";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "vault");
  state.vaultEditorOpen = true;
  state.selected = {
    sourceId: location.sourceId || state.selected.sourceId,
    branchId: location.branchId || "",
    unitId: location.unitId || ""
  };
  state.activeTab = "video";
  state.activeLibraryTab = "videos";
  state.activeStudyVideoId = "";
  clearVideoFields();
  render();
  updateTabs();
  focusVideoTitle();
}

function editStudyVideo(video) {
  state.activeSection = "vault";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "vault");
  state.activeTab = "video";
  state.vaultEditorOpen = true;
  state.activeLibraryTab = "videos";
  state.activeStudyVideoId = video.id;
  state.selected = {
    sourceId: video.sourceId,
    branchId: video.branchId,
    unitId: video.unitId
  };
  render();
  updateTabs();
  clearVideoBlob();
  els.editingVideoId.value = video.id;
  els.videoTitle.value = video.title || "";
  els.videoType.value = STUDY_VIDEO_TYPES.some(type => type.value === video.type) ? video.type : "assignment";
  els.videoSaveLabel.textContent = "Update video";
  setVideoPreview(video.video?.url || "", studyVideoStatus(video));
  document.querySelector(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetVideoForm(renderAfter = true) {
  state.activeStudyVideoId = "";
  clearVideoFields();
  renderSelectors();
  if (renderAfter) {
    renderSources();
    renderStudyVideos();
    refreshIcons();
  }
}

function clearVideoFields() {
  stopVideoStream();
  clearVideoBlob();
  clearVideoBackgroundImage();
  els.videoForm.reset();
  els.editingVideoId.value = "";
  els.videoTitle.value = "";
  els.videoType.value = "assignment";
  els.videoBackgroundMode.value = "none";
  updateVideoBackgroundControls();
  els.videoSaveLabel.textContent = "Save video";
  setVideoPreview("", "No video selected");
  els.videoInput.value = "";
  updateVideoRecorderControls(false);
}

function focusVideoTitle() {
  document.querySelector(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  requestAnimationFrame(() => els.videoTitle.focus());
}

function startNewNationalTest() {
  state.activeSection = "tests";
  localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "tests");
  state.activeTab = "test";
  state.activeLibraryTab = "tests";
  state.activeNationalTestId = "";
  state.nationalTestFormOpen = true;
  clearNationalTestFields();
  state.activeNationalTestPageId = "";
  state.activeNationalTestSectionFilter = "all";
  state.activeNationalTestPageSearch = "";
  state.nationalTestFocusMode = false;
  render();
  updateTabs();
  focusNationalTestTitle();
}

function resetNationalTestForm(renderAfter = true) {
  state.activeNationalTestId = "";
  state.activeNationalTestPageId = "";
  state.activeNationalTestSectionFilter = "all";
  state.activeNationalTestPageSearch = "";
  state.nationalTestFocusMode = false;
  state.nationalTestFormOpen = false;
  clearNationalTestFields();
  if (renderAfter) {
    renderSources();
    renderNationalTests();
    refreshIcons();
  }
}

function clearNationalTestFields() {
  els.testForm.reset();
  els.testCourse.value = "English 6";
  els.testSaveLabel.textContent = "Save test";
  updateTestPdfControl();
  updateTestListeningAudioCreateControl();
  updateTestListeningTranscriptCreateControl();
}

function focusNationalTestTitle() {
  document.querySelector(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  requestAnimationFrame(() => els.testTitle.focus());
}

function updateTestPdfControl() {
  const file = els.testPdfInput.files[0];
  if (!file) {
    els.testPdfStatus.textContent = "No PDF selected";
    return;
  }
  els.testPdfStatus.textContent = `${file.name || "Selected PDF"} (${formatFileSize(file.size)})`;
}

function isPdfFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function updateTestListeningAudioCreateControl() {
  const file = els.testListeningAudioCreateInput?.files?.[0];
  if (!els.testListeningAudioCreateStatus) return;
  if (!file) {
    els.testListeningAudioCreateStatus.textContent = "No audio selected";
    return;
  }
  els.testListeningAudioCreateStatus.textContent = `${file.name || "Selected audio"} (${formatFileSize(file.size)})`;
}

function updateTestListeningTranscriptCreateControl() {
  const file = els.testListeningTranscriptCreateInput?.files?.[0];
  if (!els.testListeningTranscriptCreateStatus) return;
  if (!file) {
    els.testListeningTranscriptCreateStatus.textContent = "No transcript selected";
    return;
  }
  els.testListeningTranscriptCreateStatus.textContent = `${file.name || "Selected transcript"} (${formatFileSize(file.size)})`;
}

function isListeningAudioFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return type.startsWith("audio/")
    || type === "video/mp4"
    || [".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".webm"].some(extension => name.endsWith(extension));
}

async function startVideoRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error("Video recording is not supported in this browser");
  }

  stopVideoStream();
  clearVideoBlob();
  const stream = await navigator.mediaDevices.getUserMedia({ video: QUIET_VIDEO_CONSTRAINTS, audio: true });
  state.videoRecorder.stream = stream;
  state.videoRecorder.chunks = [];
  const recordingStream = await recordingStreamForCurrentBackground(stream);
  state.videoRecorder.recordingStream = recordingStream;

  const mimeType = preferredVideoMimeType();
  const recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
  state.videoRecorder.recorder = recorder;

  recorder.addEventListener("dataavailable", event => {
    if (event.data?.size) {
      state.videoRecorder.chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", () => {
    const type = recorder.mimeType || mimeType || "video/webm";
    const blob = new Blob(state.videoRecorder.chunks, { type });
    state.videoRecorder.blob = blob;
    state.videoRecorder.file = null;
    stopVideoStream();
    setVideoObjectUrl(blob, `Recording ready (${formatFileSize(blob.size)})`);
    updateVideoRecorderControls(false);
    state.videoRecorder.stopResolve?.();
    state.videoRecorder.stopPromise = null;
    state.videoRecorder.stopResolve = null;
  });

  els.videoPreview.src = "";
  els.videoPreview.srcObject = recordingStream;
  els.videoPreview.muted = true;
  els.videoPreview.controls = false;
  els.videoPreview.play().catch(() => {});
  els.videoStatus.textContent = "Recording...";
  recorder.start();
  state.videoRecorder.stopPromise = new Promise(resolve => {
    state.videoRecorder.stopResolve = resolve;
  });
  updateVideoRecorderControls(true);
}

async function stopVideoRecording() {
  const recorder = state.videoRecorder.recorder;
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
    await state.videoRecorder.stopPromise;
    return;
  }
  stopVideoStream();
  updateVideoRecorderControls(false);
}

function preferredVideoMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

async function createBackgroundEffectStreamLazy(stream, options) {
  if (!videoEffectsModulePromise) {
    videoEffectsModulePromise = import("./video-effects.js");
  }
  const module = await videoEffectsModulePromise;
  return module.createBackgroundEffectStream(stream, options);
}

async function recordingStreamForCurrentBackground(stream) {
  const mode = els.videoBackgroundMode.value;
  if (mode === "none") return stream;
  const effect = await createBackgroundEffectStreamLazy(stream, {
    mode,
    backgroundImage: state.videoRecorder.backgroundImage,
    onError: message => showToast(message, true)
  });
  state.videoRecorder.effect = effect;
  return effect.stream;
}

function setVideoFile(file) {
  if (!file || !file.type.startsWith("video/")) {
    showToast("Only video files are accepted", true);
    return;
  }
  stopVideoStream();
  clearVideoBlob();
  state.videoRecorder.file = file;
  setVideoObjectUrl(file, `${file.name || "Selected video"} (${formatFileSize(file.size)})`);
}

async function currentVideoFile() {
  const recorder = state.videoRecorder.recorder;
  if (recorder && recorder.state === "recording") {
    els.videoStatus.textContent = "Finishing recording...";
    await stopVideoRecording();
  }
  if (state.videoRecorder.file) return state.videoRecorder.file;
  if (state.videoRecorder.blob) {
    return state.videoRecorder.blob;
  }
  return null;
}

function recordingFilename(type = "") {
  const extension = String(type).includes("mp4") ? "mp4" : "webm";
  return `recording-${Date.now()}.${extension}`;
}

function setVideoObjectUrl(value, status) {
  if (state.videoRecorder.objectUrl) {
    URL.revokeObjectURL(state.videoRecorder.objectUrl);
  }
  const objectUrl = URL.createObjectURL(value);
  state.videoRecorder.objectUrl = objectUrl;
  setVideoPreview(objectUrl, status);
}

function setVideoPreview(src, status) {
  els.videoPreview.pause();
  els.videoPreview.srcObject = null;
  els.videoPreview.src = src || "";
  els.videoPreview.muted = false;
  els.videoPreview.controls = Boolean(src);
  els.videoPreview.load();
  els.videoStatus.textContent = status;
}

function clearVideoSelection() {
  stopVideoRecording();
  clearVideoBlob();
  els.videoInput.value = "";
  const existing = (state.db.studyVideos || []).find(video => video.id === els.editingVideoId.value);
  if (existing) {
    setVideoPreview(existing.video?.url || "", studyVideoStatus(existing));
  } else {
    setVideoPreview("", "No video selected");
  }
}

function clearVideoBlob() {
  if (state.videoRecorder.objectUrl) {
    URL.revokeObjectURL(state.videoRecorder.objectUrl);
  }
  state.videoRecorder.objectUrl = "";
  state.videoRecorder.blob = null;
  state.videoRecorder.file = null;
  state.videoRecorder.chunks = [];
  state.videoRecorder.recorder = null;
  state.videoRecorder.stopPromise = null;
  state.videoRecorder.stopResolve = null;
  state.videoRecorder.recordingStream = null;
  disposeVideoEffect();
}

function stopVideoStream() {
  disposeVideoEffect();
  if (state.videoRecorder.stream) {
    state.videoRecorder.stream.getTracks().forEach(track => track.stop());
  }
  if (state.videoRecorder.recordingStream && state.videoRecorder.recordingStream !== state.videoRecorder.stream) {
    state.videoRecorder.recordingStream.getTracks().forEach(track => track.stop());
  }
  state.videoRecorder.stream = null;
  state.videoRecorder.recordingStream = null;
}

function disposeVideoEffect() {
  state.videoRecorder.effect?.dispose?.();
  state.videoRecorder.effect = null;
}

function updateVideoRecorderControls(recording) {
  els.startVideoRecordingButton.disabled = recording;
  els.stopVideoRecordingButton.disabled = !recording;
  els.pickVideoButton.disabled = recording;
  els.clearVideoButton.disabled = recording;
  els.videoBackgroundMode.disabled = recording;
  els.pickVideoBackgroundButton.disabled = recording;
  els.clearVideoBackgroundButton.disabled = recording;
}

function stopVideoRecordingIfHidden() {
  const recorder = state.videoRecorder.recorder;
  if (recorder && recorder.state !== "inactive") {
    stopVideoRecording().catch(error => showToast(error.message, true));
    return;
  }
  stopVideoStream();
}

function studyVideoStatus(video) {
  return `${video.video?.originalName || "Saved video"} (${formatFileSize(video.video?.size || 0)})`;
}

function updateVideoBackgroundControls() {
  const wantsImage = els.videoBackgroundMode.value === "image";
  els.backgroundImageRow.classList.toggle("hidden", !wantsImage);
  if (!wantsImage) {
    els.videoBackgroundStatus.textContent = "No image selected";
  }
}

function setVideoBackgroundImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Only image files are accepted", true);
    return;
  }

  clearVideoBackgroundImage();
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    state.videoRecorder.backgroundImage = image;
    state.videoRecorder.backgroundImageUrl = url;
    els.videoBackgroundStatus.textContent = file.name || "Background image selected";
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("Background image could not load", true);
  };
  image.src = url;
}

function clearVideoBackgroundImage() {
  if (state.videoRecorder.backgroundImageUrl) {
    URL.revokeObjectURL(state.videoRecorder.backgroundImageUrl);
  }
  state.videoRecorder.backgroundImage = null;
  state.videoRecorder.backgroundImageUrl = "";
  els.videoBackgroundInput.value = "";
  els.videoBackgroundStatus.textContent = "No image selected";
}

function resetWordForm(renderAfter = true) {
  els.wordForm.reset();
  clearLookupResults();
  els.editingId.value = "";
  els.removeImageInput.checked = false;
  updateSingleImageControl();
  els.saveLabel.textContent = "Save word";
  renderSelectors();
  if (renderAfter) {
    refreshIcons();
  }
}

function updateTabs() {
  if (state.activeSection === "tests") {
    stopVideoRecordingIfHidden();
    const focusMode = isNationalTestFocusMode();
    els.appShell.classList.remove("word-editor-empty");
    els.singleTab.classList.remove("active");
    els.jsonTab.classList.remove("active");
    els.studyTab.classList.remove("active");
    els.videoTab.classList.remove("active");
    els.testTab.classList.add("active");
    els.wordForm.classList.add("hidden");
    els.jsonForm.classList.add("hidden");
    els.verbForm.classList.add("hidden");
    els.studyForm.classList.add("hidden");
    els.videoForm.classList.add("hidden");
    els.testForm.classList.toggle("hidden", focusMode || !state.nationalTestFormOpen);
    els.testLookupPanel?.classList.toggle("hidden", focusMode || !state.nationalTestFormOpen);
    return;
  }

  if (state.activeSection === "verbs") {
    stopVideoRecordingIfHidden();
    els.appShell.classList.remove("word-editor-empty");
    els.singleTab.classList.remove("active");
    els.jsonTab.classList.remove("active");
    els.studyTab.classList.remove("active");
    els.videoTab.classList.remove("active");
    els.testTab.classList.remove("active");
    els.wordForm.classList.add("hidden");
    els.jsonForm.classList.add("hidden");
    els.verbForm.classList.remove("hidden");
    els.studyForm.classList.add("hidden");
    els.videoForm.classList.add("hidden");
    els.testForm.classList.add("hidden");
    els.testLookupPanel?.classList.add("hidden");
    return;
  }

  if (state.activeTab === "test" || state.activeTab === "json") {
    state.activeTab = "single";
  }
  const isSingle = state.activeTab === "single";
  const isStudy = state.activeTab === "study";
  const isVideo = state.activeTab === "video";
  if (!isVideo) stopVideoRecordingIfHidden();
  const wordEditorEmpty = !state.vaultEditorOpen || (isSingle && !hasSelectedWordPath() && !els.editingId.value);
  els.appShell.classList.toggle("word-editor-empty", wordEditorEmpty);
  els.singleTab.classList.toggle("active", isSingle);
  els.jsonTab.classList.remove("active");
  els.studyTab.classList.toggle("active", isStudy);
  els.videoTab.classList.toggle("active", isVideo);
  els.testTab.classList.remove("active");
  els.wordForm.classList.toggle("hidden", !isSingle);
  els.jsonForm.classList.add("hidden");
  els.jsonForm.setAttribute("aria-hidden", "true");
  els.verbForm.classList.add("hidden");
  els.studyForm.classList.toggle("hidden", !isStudy);
  els.videoForm.classList.toggle("hidden", !isVideo);
  els.testForm.classList.add("hidden");
  els.testLookupPanel?.classList.add("hidden");
}

function activeHeaderSearchConfig() {
  if (state.activeSection === "verbs") {
    return {
      placeholder: "Search verbs",
      value: state.verbFilters.search,
      ariaLabel: "Search verbs"
    };
  }

  if (state.activeSection === "tests") {
    const focusMode = isNationalTestFocusMode();
    return {
      placeholder: focusMode ? "Search test pages or Arabic" : "Search tests or Arabic",
      value: focusMode ? state.activeNationalTestPageSearch : state.nationalTestFilters.search,
      ariaLabel: focusMode ? "Search pages and Arabic in the selected test" : "Search tests and Arabic"
    };
  }

  if (state.activeLibraryTab === "texts") {
    return {
      placeholder: "Search texts",
      value: state.studyFilters.search,
      ariaLabel: "Search study texts"
    };
  }

  if (state.activeLibraryTab === "videos") {
    return {
      placeholder: "Search videos",
      value: state.videoFilters.search,
      ariaLabel: "Search videos"
    };
  }

  return {
    placeholder: "Search words or Arabic",
    value: state.filters.search,
    ariaLabel: "Search words and Arabic"
  };
}

function syncHeaderSearchControl() {
  if (!els.headerSearch) return;
  const config = activeHeaderSearchConfig();
  if (els.headerSearch.placeholder !== config.placeholder) {
    els.headerSearch.placeholder = config.placeholder;
  }
  if (els.headerSearch.getAttribute("aria-label") !== config.ariaLabel) {
    els.headerSearch.setAttribute("aria-label", config.ariaLabel);
  }
  if (document.activeElement !== els.headerSearch && els.headerSearch.value !== config.value) {
    els.headerSearch.value = config.value;
  }
}

function applyHeaderSearch(query) {
  if (state.activeSection === "verbs") {
    state.verbFilters.search = query;
    renderVerbs();
    refreshIcons();
    return;
  }

  if (state.activeSection === "tests") {
    if (isNationalTestFocusMode()) {
      state.activeNationalTestPageSearch = query;
      renderActiveNationalTestPageSearchUi();
    } else {
      state.expandedNationalTestSearchMatchIds.clear();
      state.nationalTestFilters.search = query;
      renderNationalTests();
    }
    refreshIcons();
    return;
  }

  if (state.activeLibraryTab === "texts") {
    resetRenderLimit("studyTexts");
    state.studyFilters.search = query;
    if (els.studyFilterSearch.value !== query) {
      els.studyFilterSearch.value = query;
    }
    renderStudyTexts();
    refreshIcons();
    return;
  }

  if (state.activeLibraryTab === "videos") {
    resetRenderLimit("studyVideos");
    state.videoFilters.search = query;
    if (els.videoFilterSearch.value !== query) {
      els.videoFilterSearch.value = query;
    }
    renderStudyVideos();
    refreshIcons();
    return;
  }

  resetRenderLimit("words");
  state.filters.search = query;
  if (els.filterSearch.value !== query) {
    els.filterSearch.value = query;
  }
  renderWords();
  refreshIcons();
}

function scheduleHeaderSearch(query) {
  window.clearTimeout(headerSearchDebounceTimer);
  headerSearchDebounceTimer = window.setTimeout(() => {
    applyHeaderSearch(query);
  }, SEARCH_DEBOUNCE_MS);
}

function closeVaultEditorToLibrary() {
  state.vaultEditorOpen = false;
  if (state.activeSection !== "vault") {
    state.activeSection = "vault";
    localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, "vault");
  }
  render();
  requestAnimationFrame(() => {
    document.querySelector(".library-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function loadStudyVideoElement(videoElement) {
  if (!videoElement?.dataset?.videoSrc || videoElement.src) return;
  videoElement.src = videoElement.dataset.videoSrc;
  videoElement.load();
}

function promptName(label, current = "") {
  const name = window.prompt(label, current);
  return name === null ? null : name.trim();
}

function promptSourceChoice(label, sources) {
  const choices = sources.map((source, index) => `${index + 1}. ${source.name}`).join("\n");
  const value = window.prompt(`${label}\n\n${choices}\n\nEnter source number`);
  if (value === null) return null;
  const index = Number(value.trim()) - 1;
  return Number.isInteger(index) && sources[index] ? sources[index] : null;
}

function parseTreeLocation(value) {
  const [sourceId = "", branchId = "", unitId = ""] = String(value || "").split(":");
  return { sourceId, branchId, unitId };
}

function handleEnterShortcut(event) {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
    return;
  }

  const active = document.activeElement;
  const tagName = active?.tagName;
  if (active?.isContentEditable || tagName === "TEXTAREA" || tagName === "BUTTON") {
    return;
  }

  if (state.practice.active) {
    const nextButton = els.wordList.querySelector("[data-practice-next]");
    if (nextButton && !nextButton.disabled) {
      event.preventDefault();
      nextButton.click();
      return;
    }

    const answerInput = els.wordList.querySelector("#practice-answer-input");
    const answerForm = els.wordList.querySelector("[data-practice-typing-form]");
    if (answerInput && answerForm && !answerInput.disabled) {
      event.preventDefault();
      answerForm.requestSubmit();
      return;
    }
  }

  if (state.review.active) {
    const reviewPrimaryButton = els.wordList.querySelector("[data-review-practice], [data-review-next]");
    if (reviewPrimaryButton && !reviewPrimaryButton.disabled) {
      event.preventDefault();
      reviewPrimaryButton.click();
      return;
    }
  }

  if (active === els.wordInput && els.wordInput.value.trim() && !els.lookupWordButton.disabled && hasSelectedWordPath()) {
    event.preventDefault();
    els.lookupWordButton.click();
    return;
  }

  if (active === els.testLookupWordInput && els.testLookupWordInput.value.trim() && !els.testLookupWordButton.disabled) {
    event.preventDefault();
    els.testLookupWordButton.click();
    return;
  }

  if (active?.matches?.("[data-test-lookup-word-input]") && active.value.trim()) {
    const button = active.closest(".test-study-lookup")?.querySelector("[data-test-lookup-submit]");
    if (button && !button.disabled) {
      event.preventDefault();
      button.click();
      return;
    }
  }

  const form = active?.closest("form");
  if (form === els.wordForm || form === els.jsonForm || form === els.verbForm || form === els.studyForm || form === els.videoForm || form === els.testForm) {
    event.preventDefault();
    form.requestSubmit();
  }
}

function bindEvents() {
  document.addEventListener("keydown", handleEnterShortcut);
  document.addEventListener("click", handleSourceWritingPracticeClick, true);
  document.addEventListener("input", handleSourceWritingPracticeInput, true);
  document.addEventListener("keydown", handleSourceWritingPracticeKeydown, true);
  document.addEventListener("paste", handleSourceWritingPracticePaste, true);
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (restoreTestWordReturn()) {
      event.preventDefault();
      return;
    }
    closeStudyTextReader();
  });

  document.addEventListener("click", event => {
    const closeButton = event.target.closest("[data-close-reader]");
    const editButton = event.target.closest("[data-reader-edit-text]");
    const selectReaderPageButton = event.target.closest("[data-reader-select-test-page]");
    if (editButton) {
      const text = (state.db.studyTexts || []).find(item => item.id === editButton.dataset.readerEditText);
      closeStudyTextReader();
      if (text) editStudyText(text);
      return;
    }
    if (selectReaderPageButton) {
      focusNationalTestPageFromReader(selectReaderPageButton.dataset.readerSelectTestPage);
      return;
    }
    if (closeButton) {
      closeStudyTextReader();
    }
  });

  els.sourceToggleButton.addEventListener("click", () => {
    setSourcePanelCollapsed(!state.sourceCollapsed);
  });

  els.headerSearch.addEventListener("input", () => {
    scheduleHeaderSearch(els.headerSearch.value);
  });

  els.editorBackButton.addEventListener("click", closeVaultEditorToLibrary);

  els.refreshButton.addEventListener("click", () => loadDatabase().catch(error => showToast(error.message, true)));

  els.vaultSectionButton.addEventListener("click", () => setActiveSection("vault"));
  els.verbsSectionButton.addEventListener("click", () => setActiveSection("verbs"));
  els.testsSectionButton.addEventListener("click", () => setActiveSection("tests"));

  els.startReviewButton.addEventListener("click", () => {
    startReviewSession({ target: reviewWordCount() }).catch(error => showToast(error.message, true));
  });

  els.startSoundPracticeButton.addEventListener("click", () => {
    startSoundPracticeSession(practiceSourceWords(), { target: reviewWordCount() });
  });

  els.reviewWordCount.addEventListener("change", () => {
    setReviewWordCount(els.reviewWordCount.value);
    renderWords();
    refreshIcons();
  });

  els.wordsLibraryTab.addEventListener("click", () => {
    state.activeLibraryTab = "words";
    resetRenderLimit("words");
    renderLibraryTabs();
    renderFilters();
    renderWords();
    refreshIcons();
  });

  els.textsLibraryTab.addEventListener("click", () => {
    state.activeLibraryTab = "texts";
    resetRenderLimit("studyTexts");
    renderLibraryTabs();
    renderStudyFilters();
    renderStudyTexts();
    refreshIcons();
  });

  els.videosLibraryTab.addEventListener("click", () => {
    state.activeLibraryTab = "videos";
    resetRenderLimit("studyVideos");
    renderLibraryTabs();
    renderVideoFilters();
    renderStudyVideos();
    refreshIcons();
  });

  els.testsLibraryTab.addEventListener("click", () => {
    setActiveSection("tests");
  });

  els.newStudyTextButton.addEventListener("click", () => {
    startNewStudyText(state.selected);
  });

  els.newStudyVideoButton.addEventListener("click", () => {
    startNewStudyVideo(state.selected);
  });

  els.newNationalTestButton.addEventListener("click", () => {
    startNewNationalTest();
  });

  els.selectVisibleButton.addEventListener("click", () => selectVisibleWords());
  els.fetchPronunciationsButton.addEventListener("click", () => {
    fetchPronunciationsForVisibleWords().catch(error => showToast(error.message, true));
  });
  els.startPracticeButton.addEventListener("click", () => {
    openPracticeModePicker(practiceSourceWords());
  });

  els.bulkSource.addEventListener("change", () => {
    state.bulkLocation.sourceId = els.bulkSource.value;
    state.bulkLocation.branchId = "";
    state.bulkLocation.unitId = "";
    renderBulkActions();
  });

  els.bulkBranch.addEventListener("change", () => {
    state.bulkLocation.branchId = els.bulkBranch.value;
    state.bulkLocation.unitId = "";
    renderBulkActions();
  });

  els.bulkUnit.addEventListener("change", () => {
    state.bulkLocation.unitId = els.bulkUnit.value;
    renderBulkActions();
  });

  els.bulkMoveButton.addEventListener("click", () => {
    moveSelectedWords().catch(error => showToast(error.message, true));
  });

  els.bulkDeleteButton.addEventListener("click", () => {
    deleteSelectedWords().catch(error => showToast(error.message, true));
  });

  els.bulkClearButton.addEventListener("click", () => clearSelectedWords());

  els.sourceForm.addEventListener("submit", async event => {
    event.preventDefault();
    const name = els.sourceName.value.trim();
    if (!name) return;
    await api("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    els.sourceForm.reset();
    await loadDatabase();
    showToast("Source added");
  });

  els.sourceTree.addEventListener("click", async event => {
    if (event.sourceWritingPracticeHandled) return;
    const toggleButton = event.target.closest("[data-toggle-tree-node]");
    const button = event.target.closest("button");
    const sourceWritingPad = event.target.closest("[data-source-writing-practice-pad]");
    const row = event.target.closest(".tree-row");

    if (toggleButton) {
      event.stopPropagation();
      toggleSourceTreeNode(toggleButton.dataset.toggleTreeNode);
      return;
    }

    if (button) {
      event.stopPropagation();
      await handleTreeButton(button);
      return;
    }

    if (sourceWritingPad && !event.target.closest("textarea, input, select, a")) {
      els.sourceTree.querySelector("[data-source-writing-practice-input]")?.focus?.();
      return;
    }

    if (!row) return;
    if (row.dataset.selectSource) setSelected(row.dataset.selectSource);
    if (row.dataset.selectBranch) {
      const [sourceId, branchId] = row.dataset.selectBranch.split(":");
      setSelected(sourceId, branchId);
    }
    if (row.dataset.selectUnit) {
      const [sourceId, branchId, unitId] = row.dataset.selectUnit.split(":");
      setSelected(sourceId, branchId, unitId);
    }
  });

  els.sourceTree.addEventListener("input", event => {
    if (event.sourceWritingPracticeHandled) return;
    const input = event.target.closest("[data-source-writing-practice-input]");
    if (!input) return;
    updateSourceWritingPracticeDraft(input.value);
  });

  els.sourceTree.addEventListener("keydown", event => {
    if (event.sourceWritingPracticeHandled) return;
    const input = event.target.closest("[data-source-writing-practice-input]");
    if (!input) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      input.value = "";
      updateSourceWritingPracticeDraft("");
    }
  });

  els.sourceTree.addEventListener("paste", event => {
    if (event.sourceWritingPracticeHandled) return;
    if (event.target.closest("[data-source-writing-practice-input]")) return;
    const pad = event.target.closest("[data-source-writing-practice-pad]");
    if (!pad) return;
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    const practice = ensureSourceWritingPracticeState();
    event.preventDefault();
    updateSourceWritingPracticeDraft(`${practice.input}${text}`);
    const input = els.sourceTree.querySelector("[data-source-writing-practice-input]");
    if (input) input.value = state.sourceWritingPractice.input;
  });

  [els.wordSource, els.wordBranch, els.wordUnit].forEach(select => {
    select.addEventListener("change", () => updateSelectedFromForm("word"));
  });

  [els.jsonSource, els.jsonBranch, els.jsonUnit].forEach(select => {
    select.addEventListener("change", () => updateSelectedFromForm("json"));
  });

  [els.studySource, els.studyBranch, els.studyUnit].forEach(select => {
    select.addEventListener("change", () => {
      updateSelectedFromForm("study");
      if (els.studyType.value === "vocabulary") {
        clearVocabularyPracticeSelection();
      }
      scheduleStudyTextAutosave();
    });
  });

  els.studyTitle.addEventListener("input", scheduleStudyTextAutosave);
  els.studyContent.addEventListener("input", () => {
    autoResizeTextarea(els.studyContent);
    renderVocabularyPracticeUi();
    scheduleStudyTextAutosave();
  });
  els.studyType.addEventListener("change", () => {
    updateStudyTextMode();
    focusEssayThesisField();
    scheduleStudyTextAutosave();
  });
  [els.vocabularyPracticeFrom, els.vocabularyPracticeTo, els.vocabularyPracticeCount].forEach(input => {
    input?.addEventListener("input", () => clearVocabularyPracticeSelection());
  });
  els.vocabularyPracticeRandomButton?.addEventListener("click", randomizeVocabularyPracticeWords);
  els.vocabularyPracticeStartButton?.addEventListener("click", insertVocabularySentenceStarter);
  els.vocabularyPracticeWords?.addEventListener("click", event => {
    const wordButton = event.target.closest("[data-vocabulary-practice-word]");
    if (!wordButton) return;
    insertVocabularyWordAtCursor(wordButton.dataset.vocabularyPracticeWord);
  });
  Object.values(essayFieldInputs()).forEach(input => {
    input.addEventListener("input", () => {
      autoResizeTextarea(input);
      syncEssayContentPreview();
      renderEssayReadiness();
      scheduleStudyTextAutosave();
    });
  });
  els.essayBodyParagraphCount.addEventListener("input", () => {
    const fields = essayFieldsFromForm();
    renderEssayBodyParagraphFields(fields.bodyParagraphs, fields.bodyParagraphCount);
    syncEssayContentPreview();
    renderEssayReadiness();
    refreshStudyTextareaSizes();
    scheduleStudyTextAutosave();
  });
  els.essayBodyParagraphs.addEventListener("input", event => {
    const input = event.target.closest("[data-essay-body-field]");
    if (!input) return;
    if (input.tagName === "TEXTAREA") autoResizeTextarea(input);
    syncEssayContentPreview();
    renderEssayReadiness();
    scheduleStudyTextAutosave();
  });
  els.essayBodyParagraphs.addEventListener("click", event => {
    const starterButton = event.target.closest("[data-essay-starter]");
    if (!starterButton) return;
    event.preventDefault();
    insertEssayStarter(starterButton);
  });
  [els.videoSource, els.videoBranch, els.videoUnit].forEach(select => {
    select.addEventListener("change", () => updateSelectedFromForm("video"));
  });

  els.singleTab.addEventListener("click", () => {
    state.activeTab = "single";
    updateTabs();
  });

  els.jsonTab.addEventListener("click", () => {
    state.activeTab = "single";
    updateTabs();
  });

  els.studyTab.addEventListener("click", () => {
    state.activeTab = "study";
    updateTabs();
  });

  els.videoTab.addEventListener("click", () => {
    state.activeTab = "video";
    updateTabs();
  });

  els.testTab.addEventListener("click", () => {
    setActiveSection("tests");
  });

  els.wordForm.addEventListener("submit", event => {
    saveWord(event).catch(error => showToast(error.message, true));
  });

  els.verbForm.addEventListener("submit", event => {
    importVerbs(event).catch(error => showToast(error.message, true));
  });

  els.clearVerbJsonButton.addEventListener("click", () => {
    els.verbJsonInput.value = "";
    els.verbJsonInput.focus();
  });

  els.studyForm.addEventListener("submit", event => {
    saveStudyText(event).catch(error => {
      setStudyAutosaveStatus("error", "Save failed");
      showToast(error.message, true);
    });
  });

  els.videoForm.addEventListener("submit", event => {
    saveStudyVideo(event).catch(error => showToast(error.message, true));
  });

  els.testForm.addEventListener("submit", event => {
    saveNationalTest(event).catch(error => showToast(error.message, true));
  });

  els.lookupWordButton.addEventListener("click", () => {
    lookupCurrentWord().catch(error => showToast(error.message, true));
  });

  els.lookupThesaurusInput.addEventListener("change", () => {
    if (els.lookupThesaurusInput.checked) return;
    state.lookup.appliedThesaurus = null;
  });

  els.wordInput.addEventListener("input", () => {
    if (state.lookup.query && normalizePracticeAnswer(state.lookup.query) !== normalizePracticeAnswer(els.wordInput.value)) {
      clearLookupResults();
    }
  });

  els.lookupResults.addEventListener("click", event => {
    const useButton = event.target.closest("[data-lookup-use]");
    const suggestionButton = event.target.closest("[data-lookup-suggestion]");
    if (useButton) {
      useLookupCandidate(Number(useButton.dataset.lookupUse));
      return;
    }
    if (suggestionButton) {
      els.wordInput.value = suggestionButton.dataset.lookupSuggestion;
      lookupCurrentWord().catch(error => showToast(error.message, true));
    }
  });

  els.testLookupWordButton.addEventListener("click", () => {
    lookupTestWord().catch(error => showToast(error.message, true));
  });

  els.testLookupWordInput.addEventListener("input", () => {
    if (state.testLookup.query && normalizePracticeAnswer(state.testLookup.query) !== normalizePracticeAnswer(els.testLookupWordInput.value)) {
      state.testLookup = { loading: false, query: "", candidates: [], suggestions: [], references: {} };
      renderTestLookupResults();
    }
  });

  els.testLookupResults.addEventListener("click", event => {
    const saveButton = event.target.closest("[data-test-lookup-save]");
    const suggestionButton = event.target.closest("[data-test-lookup-suggestion]");
    if (saveButton) {
      saveTestLookupCandidate(Number(saveButton.dataset.testLookupSave)).catch(error => showToast(error.message, true));
      return;
    }
    if (!suggestionButton) return;
    els.testLookupWordInput.value = suggestionButton.dataset.testLookupSuggestion;
    lookupTestWord().catch(error => showToast(error.message, true));
  });

  els.wordForm.addEventListener("paste", event => {
    const file = imageFromClipboard(event);
    if (!file) return;
    event.preventDefault();
    setSingleImage(file);
  });

  els.singleImageDropBox.addEventListener("click", () => {
    els.imageInput.click();
  });

  els.singleImageDropBox.addEventListener("dragover", event => {
    event.preventDefault();
  });

  els.singleImageDropBox.addEventListener("drop", event => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    setSingleImage(file);
  });

  els.imageInput.addEventListener("change", () => {
    if (els.imageInput.files[0]) {
      els.removeImageInput.checked = false;
    }
    updateSingleImageControl();
  });

  els.removeImageInput.addEventListener("change", () => {
    if (!els.removeImageInput.checked) return;
    els.imageInput.value = "";
    updateSingleImageControl();
  });

  els.jsonForm.addEventListener("submit", event => {
    importJson(event).catch(error => showToast(error.message, true));
  });

  els.verbFilterSearch.addEventListener("input", () => {
    state.verbFilters.search = els.verbFilterSearch.value;
    renderVerbs();
    refreshIcons();
  });

  els.verbList.addEventListener("click", event => {
    const deleteButton = event.target.closest("[data-delete-verb]");
    if (deleteButton) {
      deleteVerb(deleteButton.dataset.deleteVerb).catch(error => showToast(error.message, true));
    }
  });

  els.jsonBuildImagesButton.addEventListener("click", () => updateJsonImageMapper());

  els.jsonInput.addEventListener("input", () => {
    if (els.jsonInput.value.trim()) {
      updateJsonImageMapper();
    } else {
      state.jsonImages.clear();
      els.jsonImageMapper.innerHTML = imageMapperStateHtml("Paste word JSON to create image boxes.");
    }
  });

  els.jsonImageMapper.addEventListener("click", event => {
    const pickButton = event.target.closest("[data-pick-json-image]");
    const clearButton = event.target.closest("[data-clear-json-image]");
    if (pickButton) {
      state.pendingImageIndex = Number(pickButton.dataset.pickJsonImage);
      els.jsonImageFileInput.value = "";
      els.jsonImageFileInput.click();
    }
    if (clearButton) {
      state.jsonImages.delete(Number(clearButton.dataset.clearJsonImage));
      updateJsonImageMapper();
    }
  });

  els.jsonImageFileInput.addEventListener("change", () => {
    const file = els.jsonImageFileInput.files[0];
    if (Number.isInteger(state.pendingImageIndex) && file) {
      setJsonImage(state.pendingImageIndex, file);
    }
    state.pendingImageIndex = null;
    els.jsonImageFileInput.value = "";
  });

  els.jsonImageMapper.addEventListener("paste", event => {
    const slot = event.target.closest("[data-image-index]");
    if (!slot) return;
    const file = imageFromClipboard(event);
    if (!file) return;
    event.preventDefault();
    setJsonImage(Number(slot.dataset.imageIndex), file);
  });

  els.jsonImageMapper.addEventListener("dragover", event => {
    if (event.target.closest("[data-image-index]")) {
      event.preventDefault();
    }
  });

  els.jsonImageMapper.addEventListener("drop", event => {
    const slot = event.target.closest("[data-image-index]");
    const file = event.dataTransfer?.files?.[0];
    if (!slot || !file) return;
    event.preventDefault();
    setJsonImage(Number(slot.dataset.imageIndex), file);
  });

  els.resetFormButton.addEventListener("click", () => resetWordForm());
  els.resetStudyFormButton.addEventListener("click", () => resetStudyTextForm());
  els.resetVideoFormButton.addEventListener("click", () => resetVideoForm());
  els.resetTestFormButton.addEventListener("click", () => resetNationalTestForm());

  els.startVideoRecordingButton.addEventListener("click", () => {
    startVideoRecording().catch(error => showToast(error.message, true));
  });

  els.stopVideoRecordingButton.addEventListener("click", () => stopVideoRecording());
  els.pickVideoButton.addEventListener("click", () => els.videoInput.click());
  els.clearVideoButton.addEventListener("click", () => clearVideoSelection());
  els.videoBackgroundMode.addEventListener("change", () => updateVideoBackgroundControls());
  els.pickVideoBackgroundButton.addEventListener("click", () => els.videoBackgroundInput.click());
  els.clearVideoBackgroundButton.addEventListener("click", () => clearVideoBackgroundImage());

  els.videoInput.addEventListener("change", () => {
    const file = els.videoInput.files[0];
    if (file) setVideoFile(file);
  });

  els.videoBackgroundInput.addEventListener("change", () => {
    const file = els.videoBackgroundInput.files[0];
    if (file) setVideoBackgroundImage(file);
  });

  els.pickTestPdfButton.addEventListener("click", () => els.testPdfInput.click());
  els.clearTestPdfButton.addEventListener("click", () => {
    els.testPdfInput.value = "";
    updateTestPdfControl();
  });
  els.testPdfInput.addEventListener("change", () => {
    const file = els.testPdfInput.files[0];
    if (file && !isPdfFile(file)) {
      showToast("Only PDF files are accepted", true);
      els.testPdfInput.value = "";
    }
    updateTestPdfControl();
  });
  els.pickTestListeningAudioButton?.addEventListener("click", () => els.testListeningAudioCreateInput?.click());
  els.clearTestListeningAudioButton?.addEventListener("click", () => {
    if (els.testListeningAudioCreateInput) els.testListeningAudioCreateInput.value = "";
    updateTestListeningAudioCreateControl();
  });
  els.testListeningAudioCreateInput?.addEventListener("change", () => {
    const file = els.testListeningAudioCreateInput.files[0];
    if (file && !isListeningAudioFile(file)) {
      showToast("Only MP3/MP4 listening audio is accepted", true);
      els.testListeningAudioCreateInput.value = "";
    }
    updateTestListeningAudioCreateControl();
  });
  els.pickTestListeningTranscriptButton?.addEventListener("click", () => els.testListeningTranscriptCreateInput?.click());
  els.clearTestListeningTranscriptButton?.addEventListener("click", () => {
    if (els.testListeningTranscriptCreateInput) els.testListeningTranscriptCreateInput.value = "";
    updateTestListeningTranscriptCreateControl();
  });
  els.testListeningTranscriptCreateInput?.addEventListener("change", () => {
    const file = els.testListeningTranscriptCreateInput.files[0];
    if (file && !isPdfFile(file)) {
      showToast("Only PDF transcript files are accepted", true);
      els.testListeningTranscriptCreateInput.value = "";
    }
    updateTestListeningTranscriptCreateControl();
  });

  els.wordList.addEventListener("focusin", event => {
    const card = wordCardFromElement(event.target);
    if (card) setFocusedWord(card.dataset.wordCard);
  });

  els.wordList.addEventListener("keydown", event => handleWordListKeyboard(event));

  els.wordList.addEventListener("click", async event => {
    const loadMoreButton = event.target.closest("[data-load-more-list]");
    if (loadMoreButton) {
      increaseRenderLimit(loadMoreButton.dataset.loadMoreList);
      renderWords();
      refreshIcons();
      return;
    }

    const wordCard = wordCardFromElement(event.target);
    if (wordCard) {
      setFocusedWord(wordCard.dataset.wordCard);
    }

    const nextButton = event.target.closest("[data-practice-next]");
    const practiceModeButton = event.target.closest("[data-start-practice-mode]");
    const closePracticeModeButton = event.target.closest("[data-close-practice-mode-picker]");
    const showChoicesButton = event.target.closest("[data-practice-show-choices]");
    const writeDirectButton = event.target.closest("[data-practice-write-direct]");
    const choiceButton = event.target.closest("[data-practice-choice]");
    const sameWordsButton = event.target.closest("[data-practice-same]");
    const weakWordsButton = event.target.closest("[data-practice-weak]");
    const addMoreButton = event.target.closest("[data-add-more-review]");
    const endButton = event.target.closest("[data-end-practice]");
    const reviewPrevButton = event.target.closest("[data-review-prev]");
    const reviewNextButton = event.target.closest("[data-review-next]");
    const reviewPracticeButton = event.target.closest("[data-review-practice]");
    const endReviewButton = event.target.closest("[data-end-review]");
    const soundPrevButton = event.target.closest("[data-sound-practice-prev]");
    const soundNextButton = event.target.closest("[data-sound-practice-next]");
    const soundRepeatButton = event.target.closest("[data-repeat-sound-practice]");
    const endSoundButton = event.target.closest("[data-end-sound-practice]");
    const recorderRecordButton = event.target.closest("[data-word-recorder-record]");
    const recorderStopButton = event.target.closest("[data-word-recorder-stop]");
    const recorderPlayButton = event.target.closest("[data-word-recorder-play]");
    const ipaPronunciationToggleButton = event.target.closest("[data-toggle-ipa-pronunciation]");
    const ipaSoundButton = event.target.closest("[data-play-ipa-sound]");
    const arabicTranslationButton = event.target.closest("[data-toggle-arabic-translation]");

    if (practiceModeButton) {
      startSelectedPracticeMode(practiceModeButton.dataset.startPracticeMode);
      return;
    }

    if (closePracticeModeButton) {
      closePracticeModePicker();
      return;
    }

    if (showChoicesButton) {
      startPracticeChoiceStage();
      return;
    }

    if (writeDirectButton) {
      startPracticeTypingStage();
      return;
    }

    if (choiceButton) {
      choosePracticeChoice(Number(choiceButton.dataset.practiceChoice));
      return;
    }

    if (soundPrevButton) {
      previousSoundPracticeWord();
      return;
    }

    if (soundNextButton) {
      nextSoundPracticeWord();
      return;
    }

    if (soundRepeatButton) {
      repeatSoundPracticeSession();
      return;
    }

    if (endSoundButton) {
      endSoundPracticeSession();
      return;
    }

    if (recorderRecordButton) {
      startWordPronunciationRecording(recorderRecordButton.dataset.wordRecorderRecord).catch(error => showToast(error.message, true));
      return;
    }

    if (recorderStopButton) {
      stopWordPronunciationRecording(recorderStopButton.dataset.wordRecorderStop);
      return;
    }

    if (recorderPlayButton) {
      playWordPronunciationRecording(recorderPlayButton.dataset.wordRecorderPlay);
      return;
    }

    if (ipaPronunciationToggleButton) {
      const wordId = ipaPronunciationToggleButton.dataset.toggleIpaPronunciation;
      if (state.visibleIpaPronunciationWordIds.has(wordId)) {
        state.visibleIpaPronunciationWordIds.delete(wordId);
      } else {
        state.visibleIpaPronunciationWordIds.add(wordId);
      }
      renderWords();
      refreshIcons();
      return;
    }

    if (ipaSoundButton) {
      playIpaSound(ipaSoundButton.dataset.playIpaSound);
      return;
    }

    if (arabicTranslationButton) {
      const wordId = arabicTranslationButton.dataset.toggleArabicTranslation;
      if (state.visibleArabicTranslationWordIds.has(wordId)) {
        state.visibleArabicTranslationWordIds.delete(wordId);
      } else {
        state.visibleArabicTranslationWordIds.add(wordId);
      }
      renderWords();
      refreshIcons();
      return;
    }

    if (reviewPrevButton) {
      previousReviewWord();
      return;
    }

    if (reviewNextButton) {
      nextReviewWord();
      return;
    }

    if (reviewPracticeButton) {
      startReviewPractice();
      return;
    }

    if (endReviewButton) {
      endReviewSession();
      return;
    }

    if (nextButton) {
      nextPracticeWord();
      renderWords();
      refreshIcons();
      focusPracticeAnswerInput();
      playCurrentListeningWord();
      return;
    }

    if (sameWordsButton) {
      practiceSameWordsAgain();
      return;
    }

    if (weakWordsButton) {
      practiceWeakWordsAgain();
      return;
    }

    if (addMoreButton) {
      addMoreReviewWords().catch(error => showToast(error.message, true));
      return;
    }

    if (endButton) {
      endPracticeSession();
      return;
    }

    const pronunciationButton = event.target.closest("[data-play-pronunciation]");
    if (pronunciationButton) {
      playPronunciation(pronunciationButton.dataset.playPronunciation).catch(error => showToast(error.message, true));
      return;
    }

    const editButton = event.target.closest("[data-edit-word]");
    const deleteButton = event.target.closest("[data-delete-word]");
    if (editButton) {
      const word = findWordInState(editButton.dataset.editWord);
      if (word) editWord(word);
    }
    if (deleteButton) {
      const word = state.db.words.find(item => item.id === deleteButton.dataset.deleteWord);
      if (!word || !window.confirm(`Delete "${word.word}"?`)) return;
      await api(`/api/words/${word.id}`, { method: "DELETE" });
      removeWordRecord(word.id);
      if (els.editingId.value === word.id) {
        resetWordForm(false);
      }
      refreshWordLibraryAfterLocalChange();
      showToast("Word deleted");
    }
  });

  els.wordList.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-select-word]");
    if (!checkbox) return;
    setWordSelected(checkbox.dataset.selectWord, checkbox.checked);
  });

  els.studyTextList.addEventListener("click", async event => {
    const loadMoreButton = event.target.closest("[data-load-more-list]");
    if (loadMoreButton) {
      increaseRenderLimit(loadMoreButton.dataset.loadMoreList);
      renderStudyTexts();
      refreshIcons();
      return;
    }

    const readButton = event.target.closest("[data-read-study-text]");
    const editButton = event.target.closest("[data-edit-study-text]");
    const deleteButton = event.target.closest("[data-delete-study-text]");

    if (readButton) {
      const text = (state.db.studyTexts || []).find(item => item.id === readButton.dataset.readStudyText);
      if (text) openStudyTextReader(text);
      return;
    }

    if (editButton) {
      const text = (state.db.studyTexts || []).find(item => item.id === editButton.dataset.editStudyText);
      if (text) editStudyText(text);
      return;
    }

    if (deleteButton) {
      const text = (state.db.studyTexts || []).find(item => item.id === deleteButton.dataset.deleteStudyText);
      if (!text || !window.confirm(`Delete "${text.title}"?`)) return;
      await api(`/api/study-texts/${text.id}`, { method: "DELETE" });
      if (state.activeStudyTextId === text.id) {
        resetStudyTextForm(false);
      }
      removeStudyTextRecord(text.id);
      refreshStudyTextLibraryAfterLocalChange();
      showToast("Text deleted");
    }
  });

  els.studyVideoList.addEventListener("click", async event => {
    const loadMoreButton = event.target.closest("[data-load-more-list]");
    if (loadMoreButton) {
      increaseRenderLimit(loadMoreButton.dataset.loadMoreList);
      renderStudyVideos();
      refreshIcons();
      return;
    }

    const videoElement = event.target.closest("video[data-video-src]");
    if (videoElement) {
      loadStudyVideoElement(videoElement);
    }

    const editButton = event.target.closest("[data-edit-study-video]");
    const deleteButton = event.target.closest("[data-delete-study-video]");

    if (editButton) {
      const video = (state.db.studyVideos || []).find(item => item.id === editButton.dataset.editStudyVideo);
      if (video) editStudyVideo(video);
      return;
    }

    if (deleteButton) {
      const video = (state.db.studyVideos || []).find(item => item.id === deleteButton.dataset.deleteStudyVideo);
      if (!video || !window.confirm(`Delete "${video.title}"?`)) return;
      await api(`/api/study-videos/${video.id}`, { method: "DELETE" });
      if (state.activeStudyVideoId === video.id) {
        resetVideoForm(false);
      }
      removeStudyVideoRecord(video.id);
      refreshStudyVideoLibraryAfterLocalChange();
      showToast("Video deleted");
    }
  });

  els.studyVideoList.addEventListener("pointerdown", event => {
    const videoElement = event.target.closest("video[data-video-src]");
    if (videoElement) {
      loadStudyVideoElement(videoElement);
    }
  });

  els.studyVideoList.addEventListener("focusin", event => {
    const videoElement = event.target.closest("video[data-video-src]");
    if (videoElement) {
      loadStudyVideoElement(videoElement);
    }
  });

  els.testStudyWorkspace.addEventListener("pointerdown", startTestPageListResize);
  els.testStudyWorkspace.addEventListener("pointerdown", startTestPagePracticeResize);
  els.testStudyWorkspace.addEventListener("keydown", resizeTestPageListFromKeyboard);
  els.testStudyWorkspace.addEventListener("keydown", resizeTestPagePracticeFromKeyboard);

  els.nationalTestList.addEventListener("click", async event => {
    const card = event.target.closest("[data-national-test-card]");
    const cardTestId = card?.dataset.nationalTestCard || "";
    const editTitleButton = event.target.closest("[data-edit-national-test-title]");
    const cancelRenameButton = event.target.closest("[data-cancel-national-test-rename]");
    const editDetailsButton = event.target.closest("[data-edit-national-test-details]");
    const cancelDetailsButton = event.target.closest("[data-cancel-national-test-details]");
    const toggleLockButton = event.target.closest("[data-toggle-national-test-lock]");
    const toggleReadyButton = event.target.closest("[data-toggle-national-test-ready]");
    const toggleFinishedButton = event.target.closest("[data-toggle-national-test-finished]");
    const studyButton = event.target.closest("[data-study-national-test]");
    const searchMatchButton = event.target.closest("[data-open-national-test-page-match]");
    const toggleSearchMatchesButton = event.target.closest("[data-toggle-national-test-search-matches]");
    const openButton = event.target.closest("[data-open-national-test]");
    const deleteButton = event.target.closest("[data-delete-national-test]");

    if (editTitleButton) {
      state.nationalTestRenamingId = cardTestId || editTitleButton.dataset.editNationalTestTitle;
      state.nationalTestDetailsEditingId = "";
      renderNationalTests();
      refreshIcons();
      requestAnimationFrame(() => {
        const input = els.nationalTestList.querySelector(".national-test-rename-input");
        input?.focus();
        input?.select();
      });
      return;
    }

    if (editDetailsButton) {
      state.nationalTestDetailsEditingId = cardTestId || editDetailsButton.dataset.editNationalTestDetails;
      state.nationalTestRenamingId = "";
      renderNationalTests();
      refreshIcons();
      requestAnimationFrame(() => {
        const input = els.nationalTestList.querySelector(".national-test-details-input");
        input?.focus();
        input?.select();
      });
      return;
    }

    if (cancelRenameButton) {
      state.nationalTestRenamingId = "";
      state.nationalTestRenameSavingId = "";
      renderNationalTests();
      refreshIcons();
      return;
    }

    if (cancelDetailsButton) {
      state.nationalTestDetailsEditingId = "";
      state.nationalTestDetailsSavingId = "";
      renderNationalTests();
      refreshIcons();
      return;
    }

    if (toggleLockButton) {
      const testId = cardTestId || toggleLockButton.dataset.toggleNationalTestLock;
      const test = (state.db.nationalTests || []).find(item => item.id === testId);
      if (!test) return;
      const locked = !isNationalTestLocked(test);
      if (!window.confirm(`${locked ? "Lock" : "Unlock"} "${test.title}"?`)) return;
      await updateNationalTestState(test.id, { locked }, locked ? "Test locked" : "Test unlocked");
      return;
    }

    const lockedCard = event.target.closest(".national-test-card.locked");
    if (lockedCard) {
      showToast("Unlock the test first", true);
      return;
    }

    if (toggleReadyButton) {
      const testId = cardTestId || toggleReadyButton.dataset.toggleNationalTestReady;
      const test = (state.db.nationalTests || []).find(item => item.id === testId);
      if (!test) return;
      const ready = !isNationalTestReady(test);
      if (!window.confirm(`${ready ? "Mark" : "Unmark"} "${test.title}" as ready?`)) return;
      await updateNationalTestState(test.id, { ready }, ready ? "Test marked ready" : "Test marked not ready");
      return;
    }

    if (toggleFinishedButton) {
      const testId = cardTestId || toggleFinishedButton.dataset.toggleNationalTestFinished;
      const test = (state.db.nationalTests || []).find(item => item.id === testId);
      if (!test) return;
      const finished = !isNationalTestFinished(test);
      if (!window.confirm(`${finished ? "Mark" : "Unmark"} "${test.title}" as finished?`)) return;
      await updateNationalTestState(test.id, { finished }, finished ? "Test marked finished" : "Test marked unfinished");
      return;
    }

    if (toggleSearchMatchesButton) {
      const testId = toggleSearchMatchesButton.dataset.toggleNationalTestSearchMatches;
      if (state.expandedNationalTestSearchMatchIds.has(testId)) {
        state.expandedNationalTestSearchMatchIds.delete(testId);
      } else {
        state.expandedNationalTestSearchMatchIds.add(testId);
      }
      renderNationalTests();
      refreshIcons();
      return;
    }

    if (searchMatchButton) {
      const page = (state.db.nationalTestPages || []).find(item => item.id === searchMatchButton.dataset.openNationalTestPageMatch);
      if (page) {
        openNationalTestStudy(page.testId, {
          pageId: page.id,
          searchQuery: state.nationalTestFilters.search
        });
      }
      return;
    }

    if (studyButton) {
      const testId = cardTestId || studyButton.dataset.studyNationalTest;
      openNationalTestStudy(testId, {
        pageId: firstNationalTestSearchMatchPageId(testId),
        searchQuery: state.nationalTestFilters.search
      });
      return;
    }

    if (openButton) {
      const testId = cardTestId || openButton.dataset.openNationalTest;
      const test = (state.db.nationalTests || []).find(item => item.id === testId);
      if (test) openNationalTestReader(test);
      return;
    }

    if (deleteButton) {
      const testId = cardTestId || deleteButton.dataset.deleteNationalTest;
      const test = (state.db.nationalTests || []).find(item => item.id === testId);
      if (!test || !window.confirm(`Delete "${test.title}"?`)) return;
      await api(`/api/national-tests/${test.id}`, { method: "DELETE" });
      if (state.activeNationalTestId === test.id) {
        resetNationalTestForm(false);
        state.nationalTestFocusMode = false;
      }
      removeNationalTestRecord(test.id);
      refreshNationalTestLibraryAfterLocalChange();
      showToast("Test deleted");
    }
  });

  els.nationalTestList.addEventListener("submit", async event => {
    const renameForm = event.target.closest("[data-rename-national-test-form]");
    const detailsForm = event.target.closest("[data-edit-national-test-details-form]");
    if (!renameForm && !detailsForm) return;
    event.preventDefault();

    if (renameForm) {
      const input = renameForm.querySelector(".national-test-rename-input");
      try {
        await renameNationalTest(renameForm.dataset.renameNationalTestForm, input?.value || "");
      } catch (error) {
        showToast(error.message, true);
        state.nationalTestRenameSavingId = "";
        renderNationalTests();
        refreshIcons();
      }
      return;
    }

    if (detailsForm) {
      try {
        await saveNationalTestDetails(detailsForm.dataset.editNationalTestDetailsForm, detailsForm);
      } catch (error) {
        showToast(error.message, true);
        state.nationalTestDetailsSavingId = "";
        renderNationalTests();
        refreshIcons();
      }
    }
  });

  els.nationalTestList.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (
      !event.target.closest("[data-rename-national-test-form]") &&
      !event.target.closest("[data-edit-national-test-details-form]")
    ) return;
    state.nationalTestRenamingId = "";
    state.nationalTestRenameSavingId = "";
    state.nationalTestDetailsEditingId = "";
    state.nationalTestDetailsSavingId = "";
    renderNationalTests();
    refreshIcons();
  });

  els.testStudyWorkspace.addEventListener("click", async event => {
    const knownWordButton = event.target.closest("[data-open-test-known-word]");
    const knownVerbButton = event.target.closest("[data-open-test-known-verb]");
    const closeStudyButton = event.target.closest("[data-close-national-test-study]");
    const focusSectionButton = event.target.closest("[data-focus-section-nav]");
    const refreshAppButton = event.target.closest("[data-refresh-app]");
    const pickListeningMediaButton = event.target.closest("[data-pick-test-listening-media]");
    const clearListeningMediaSelectionButton = event.target.closest("[data-clear-test-listening-media-selection]");
    const uploadListeningMediaButton = event.target.closest("[data-upload-test-listening-media]");
    const deleteListeningMediaButton = event.target.closest("[data-delete-test-listening-media]");
    const openListeningTranscriptButton = event.target.closest("[data-open-test-listening-transcript]");
    const closeListeningTranscriptButton = event.target.closest("[data-close-test-listening-transcript]");
    const openTopicListeningMediaButton = event.target.closest("[data-open-test-topic-listening-media]");
    const copyStudyDocumentPagePromptButton = event.target.closest("[data-copy-study-document-page-prompt]");
    const copyStudyDocumentArabicPromptButton = event.target.closest("[data-copy-study-document-arabic-prompt]");
    const openStudyDocumentJsonButton = event.target.closest("[data-open-study-document-json]");
    const openStudyDocumentArabicJsonButton = event.target.closest("[data-open-study-document-arabic-json]");
    const loadStudyDocumentJsonButton = event.target.closest("[data-load-study-document-json]");
    const editStudyDocumentGraphicButton = event.target.closest("[data-edit-study-document-graphic]");
    const pageListToggleButton = event.target.closest("[data-toggle-test-page-list]");
    const groupingToolToggleButton = event.target.closest("[data-toggle-test-page-grouping-tool]");
    const testLookupSubmitButton = event.target.closest("[data-test-lookup-submit]");
    const testLookupSaveButton = event.target.closest("[data-test-lookup-save]");
    const testLookupSuggestionButton = event.target.closest("[data-test-lookup-suggestion]");
    const sectionFilterButton = event.target.closest("[data-filter-test-page-section]");
    const groupPagesButton = event.target.closest("[data-group-test-pages]");
    const skillLockButton = event.target.closest("[data-toggle-test-skill-lock]");
    const skillFinishedButton = event.target.closest("[data-toggle-test-skill-finished]");
    const collapseAllPageGroupsButton = event.target.closest("[data-collapse-all-test-page-groups]");
    const groupToggleButton = event.target.closest("[data-toggle-test-page-group]");
    const pdfToggleButton = event.target.closest("[data-toggle-test-page-pdf]");
    const wordPracticeToggleButton = event.target.closest("[data-toggle-test-page-word-practice]");
    const splitToggleButton = event.target.closest("[data-toggle-test-page-split]");
    const pdfZoomButton = event.target.closest("[data-test-page-pdf-zoom]");
    const visualZoomButton = event.target.closest("[data-test-page-visual-zoom]");
    const officialAnswersToggleButton = event.target.closest("[data-toggle-test-page-official-answers]");
    const translationLanguageButton = event.target.closest("[data-test-page-translation-language]");
    const selectPageButton = event.target.closest("[data-select-test-page]");
    const savePageButton = event.target.closest("[data-save-test-page]");
    const deletePageButton = event.target.closest("[data-delete-test-page]");
    const addWordButton = event.target.closest("[data-add-test-page-word]");
    const removeWordButton = event.target.closest("[data-remove-test-page-word]");
    const addAnswerButton = event.target.closest("[data-add-test-page-answer]");
    const openAnswerComposeButton = event.target.closest("[data-open-test-page-answer-compose]");
    const answerMarkerButton = event.target.closest("[data-test-page-answer-marker]");
    const placeAnswerButton = event.target.closest("[data-place-test-page-answer]");
    const cancelPlaceButton = event.target.closest("[data-cancel-test-page-answer-place]");
    const closeAnswerEditButton = event.target.closest("[data-close-test-page-answer-edit]");
    const cancelAnswerEditButton = event.target.closest("[data-cancel-test-page-answer-edit]");
    const deleteAnswerButton = event.target.closest("[data-delete-test-page-answer]");
    const openButton = event.target.closest("[data-open-national-test]");

    if (placeNationalTestPageAnswerFromEvent(event)) {
      event.preventDefault();
      return;
    }

    if (knownWordButton || knownVerbButton) {
      if (event.ctrlKey) {
        event.preventDefault();
        ignoreKnownTokenFromTestText(knownWordButton || knownVerbButton);
        return;
      }
    }

    if (knownWordButton) {
      openKnownWordFromTestText(knownWordButton.dataset.openTestKnownWord);
      return;
    }
    if (knownVerbButton) {
      openKnownVerbFromTestText(
        knownVerbButton.dataset.openTestKnownVerb,
        knownVerbButton.dataset.openTestKnownForm
      );
      return;
    }
    if (closeStudyButton) {
      closeNationalTestStudy();
      return;
    }
    if (focusSectionButton) {
      setActiveSection(focusSectionButton.dataset.focusSectionNav);
      return;
    }
    if (refreshAppButton) {
      loadDatabase().catch(error => showToast(error.message, true));
      return;
    }
    if (pickListeningMediaButton) {
      const kind = pickListeningMediaButton.dataset.pickTestListeningMedia;
      document.querySelector(kind === "audio" ? "#test-listening-audio-input" : "#test-listening-transcript-input")?.click();
      return;
    }
    if (clearListeningMediaSelectionButton) {
      const kind = clearListeningMediaSelectionButton.dataset.clearTestListeningMediaSelection;
      const input = document.querySelector(kind === "audio" ? "#test-listening-audio-input" : "#test-listening-transcript-input");
      if (input) input.value = "";
      updateSelectedTestListeningMediaStatus(kind);
      return;
    }
    if (uploadListeningMediaButton) {
      await uploadNationalTestListeningMedia(uploadListeningMediaButton.dataset.uploadTestListeningMedia, {
        topicKey: uploadListeningMediaButton.dataset.testListeningTopicKey,
        topicLabel: uploadListeningMediaButton.dataset.testListeningTopicLabel,
        mediaGroupId: uploadListeningMediaButton.dataset.testListeningMediaGroupId
      });
      return;
    }
    if (deleteListeningMediaButton) {
      await deleteNationalTestListeningMedia(
        deleteListeningMediaButton.dataset.deleteTestListeningMedia,
        deleteListeningMediaButton.dataset.testListeningKind,
        {
          topicKey: deleteListeningMediaButton.dataset.testListeningTopicKey,
          topicLabel: deleteListeningMediaButton.dataset.testListeningTopicLabel,
          mediaGroupId: deleteListeningMediaButton.dataset.testListeningMediaGroupId
        }
      );
      return;
    }
    if (openListeningTranscriptButton) {
      openNationalTestListeningTranscript(
        openListeningTranscriptButton.dataset.testListeningTopicKey,
        openListeningTranscriptButton.dataset.openTestListeningTranscript
      );
      return;
    }
    if (closeListeningTranscriptButton) {
      closeNationalTestListeningTranscript();
      return;
    }
    if (openTopicListeningMediaButton) {
      const topicKey = normalizedListeningTopicKey(openTopicListeningMediaButton.dataset.openTestTopicListeningMedia);
      await ensureListeningMediaFilesLoaded();
      state.activeNationalTestListeningTopicKey = state.activeNationalTestListeningTopicKey === topicKey ? "" : topicKey;
      rerenderNationalTestsPreservingViewport({ preserveStudyColumn: true });
      return;
    }
    if (pageListToggleButton) {
      setTestPageListCollapsed(!state.testPageListCollapsed);
      return;
    }
    if (groupingToolToggleButton) {
      setTestPageGroupingToolHidden(!state.testPageGroupingToolHidden);
      rerenderNationalTestsPreservingViewport({ preserveStudyColumn: true });
      return;
    }
    if (copyStudyDocumentPagePromptButton) {
      await copyStudyDocumentPrompt(copyStudyDocumentPagePromptButton.dataset.copyStudyDocumentPagePrompt, "english");
      return;
    }
    if (copyStudyDocumentArabicPromptButton) {
      await copyStudyDocumentPrompt(copyStudyDocumentArabicPromptButton.dataset.copyStudyDocumentArabicPrompt, "arabic");
      return;
    }
    if (openStudyDocumentJsonButton) {
      openStudyDocumentDialog(openStudyDocumentJsonButton.dataset.openStudyDocumentJson, "english");
      return;
    }
    if (openStudyDocumentArabicJsonButton) {
      openStudyDocumentDialog(openStudyDocumentArabicJsonButton.dataset.openStudyDocumentArabicJson, "arabic");
      return;
    }
    if (loadStudyDocumentJsonButton) {
      document.querySelector(`[data-study-document-json-file="${CSS.escape(loadStudyDocumentJsonButton.dataset.loadStudyDocumentJson)}"]`)?.click();
      return;
    }
    if (editStudyDocumentGraphicButton) {
      await openStudyDocumentGraphicDialog(editStudyDocumentGraphicButton.dataset.editStudyDocumentGraphic);
      return;
    }
    if (testLookupSubmitButton) {
      lookupTestWord().catch(error => showToast(error.message, true));
      return;
    }
    if (testLookupSaveButton) {
      saveTestLookupCandidate(Number(testLookupSaveButton.dataset.testLookupSave)).catch(error => showToast(error.message, true));
      return;
    }
    if (testLookupSuggestionButton) {
      const input = document.querySelector("[data-test-lookup-word-input]") || els.testLookupWordInput;
      if (input) input.value = testLookupSuggestionButton.dataset.testLookupSuggestion || "";
      lookupTestWord().catch(error => showToast(error.message, true));
      return;
    }
    if (sectionFilterButton) {
      state.activeNationalTestSectionFilter = sectionFilterButton.dataset.filterTestPageSection || "all";
      state.activeNationalTestTranscriptViewer = null;
      rerenderNationalTestsPreservingViewport();
      return;
    }
    if (groupPagesButton) {
      await groupNationalTestPagesFromInput(groupPagesButton.dataset.groupTestPages);
      return;
    }
    if (skillLockButton) {
      await setNationalTestSkillLocked(
        skillLockButton.dataset.toggleTestSkillLock,
        skillLockButton.dataset.testSkillSection,
        skillLockButton.dataset.testSkillLocked !== "true"
      );
      return;
    }
    if (skillFinishedButton) {
      await setNationalTestSkillFinished(
        skillFinishedButton.dataset.toggleTestSkillFinished,
        skillFinishedButton.dataset.testSkillSection,
        skillFinishedButton.dataset.testSkillFinished !== "true"
      );
      return;
    }
    if (collapseAllPageGroupsButton) {
      const test = activeNationalTest();
      if (!test) return;
      const keys = nationalTestPageGroupCollapseKeysForGroups(test, groupedVisibleNationalTestPages(test));
      setNationalTestPageGroupsCollapsed(
        keys,
        collapseAllPageGroupsButton.dataset.collapseAllTestPageGroups === "true"
      );
      return;
    }
    if (groupToggleButton) {
      toggleNationalTestPageGroup(groupToggleButton.dataset.toggleTestPageGroup);
      return;
    }
    if (pdfToggleButton) {
      setTestPagePdfCollapsed(!state.testPagePdfCollapsed);
      rerenderNationalTestsPreservingViewport();
      return;
    }
    if (wordPracticeToggleButton) {
      setTestPageWordPracticeHidden(!state.testPageWordPracticeHidden);
      rerenderNationalTestsPreservingViewport({ preserveStudyColumn: true });
      return;
    }
    if (splitToggleButton) {
      const page = activeNationalTestPage();
      state.testPageSplitView = !state.testPageSplitView;
      if (state.testPageSplitView) {
        state.testPageSplitMode = hasNationalTestPageTranslation(page, "ar") ? "translation" : "page";
        state.testPageSplitPageId = state.testPageSplitMode === "page" ? nextNationalTestSplitPage()?.id || "" : "";
      }
      rerenderNationalTestsPreservingViewport();
      return;
    }
    if (pdfZoomButton) {
      adjustTestPagePdfZoom(pdfZoomButton.dataset.testPagePdfZoom);
      return;
    }
    if (visualZoomButton) {
      adjustTestPageVisualZoom(visualZoomButton.dataset.testPageVisualZoom);
      return;
    }
    if (officialAnswersToggleButton) {
      toggleTestPageOfficialAnswers();
      return;
    }
    if (translationLanguageButton) {
      setTestPageTranslationLanguage(translationLanguageButton.dataset.testPageTranslationLanguage);
      return;
    }
    if (selectPageButton) {
      const requestedPage = (state.db.nationalTestPages || []).find(page => page.id === selectPageButton.dataset.selectTestPage);
      if (isNationalTestPageLocked(requestedPage)) {
        showToast("Unlock this skill before opening its pages", true);
        return;
      }
      saveActiveNationalTestAnswerComposerDraft();
      updateNationalTestPageDraftFromEditor();
      await flushNationalTestAnswerAutosave();
      resetNationalTestAnswerRevealState();
      state.activeNationalTestListeningTopicKey = "";
      state.activeNationalTestTranscriptViewer = null;
      state.activeNationalTestPageId = selectPageButton.dataset.selectTestPage;
      restoreNationalTestAnswerDraftForPage(state.activeNationalTestPageId);
      if (state.testPageSplitView) {
        state.testPageSplitPageId = activeNationalTestSplitPage()?.id || "";
      }
      const selectedPage = requestedPage;
      rememberNationalTestPageProgress(selectedPage);
      expandNationalTestPageGroupsForPage(selectedPage);
      rerenderNationalTestsPreservingViewport({
        preserveStudyColumn: false,
        keepActivePageVisible: true
      });
      return;
    }
    if (savePageButton) {
      await saveActiveNationalTestPage();
      return;
    }
    if (deletePageButton) {
      await deleteNationalTestPage(deletePageButton.dataset.deleteTestPage);
      return;
    }
    if (addWordButton) {
      await addNationalTestPageWord();
      return;
    }
    if (removeWordButton) {
      await removeNationalTestPageWord(removeWordButton.dataset.removeTestPageWord);
      return;
    }
    if (addAnswerButton) {
      addNationalTestPageAnswer();
      return;
    }
    if (openAnswerComposeButton) {
      openNationalTestPageAnswerComposer();
      return;
    }
    if (answerMarkerButton) {
      editNationalTestPageAnswer(answerMarkerButton.dataset.testPageAnswerMarker, {
        surface: answerMarkerButton.closest("[data-test-page-marker-surface]")
      });
      return;
    }
    if (placeAnswerButton) {
      startPlacingNationalTestPageAnswer(placeAnswerButton.dataset.placeTestPageAnswer);
      return;
    }
    if (cancelPlaceButton) {
      state.placingTestPageAnswerId = "";
      rerenderNationalTestsPreservingViewport();
      return;
    }
    if (closeAnswerEditButton) {
      closeNationalTestPageAnswerEditor();
      return;
    }
    if (cancelAnswerEditButton) {
      clearTestPageAnswerDraft();
      state.testPageAnswerComposerOpen = false;
      state.editingTestPageAnswerId = "";
      rerenderNationalTestsPreservingViewport();
      return;
    }
    if (deleteAnswerButton) {
      removeNationalTestPageAnswer(deleteAnswerButton.dataset.deleteTestPageAnswer);
      return;
    }
    if (openButton) {
      const test = (state.db.nationalTests || []).find(item => item.id === openButton.dataset.openNationalTest);
      if (test) openNationalTestReader(test);
    }
  });

  els.testStudyWorkspace.addEventListener("toggle", event => {
    const groupingPanel = event.target.closest("[data-test-page-grouping-panel]");
    if (!groupingPanel || event.target !== groupingPanel) return;
    setTestPageGroupingToolCollapsed(!groupingPanel.open);
  }, true);

  els.testStudyWorkspace.addEventListener("keydown", async event => {
    const graphic = event.target.closest("[data-edit-study-document-graphic]");
    if (graphic && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      await openStudyDocumentGraphicDialog(graphic.dataset.editStudyDocumentGraphic);
      return;
    }
    if (handleNationalTestPageWordPracticeKeydown(event)) return;
    if (event.key !== "Enter" || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!event.target.matches("#test-page-word-input, #test-page-word-note-input")) return;
    event.preventDefault();
    await addNationalTestPageWord();
  });

  els.testStudyWorkspace.addEventListener("paste", event => {
    handleNationalTestPageWordPracticePaste(event);
  });

  els.testStudyWorkspace.addEventListener("input", event => {
    const practiceInput = event.target.closest("[data-test-page-word-practice-input]");
    if (practiceInput) {
      const page = activeNationalTestPage();
      if (page) {
        updateNationalTestPageWordPracticeDraftState(page, practiceInput.value);
        renderActiveNationalTestPageWordPracticeDraftFeedback(page);
      }
      return;
    }
    if (event.target.matches("[data-test-lookup-word-input]")) {
      if (state.testLookup.query && normalizePracticeAnswer(state.testLookup.query) !== normalizePracticeAnswer(event.target.value)) {
        state.testLookup = { loading: false, query: "", candidates: [], suggestions: [], references: {} };
        renderTestLookupResults();
      }
      return;
    }
    if (event.target.matches("#test-page-search-input")) {
      state.activeNationalTestPageSearch = event.target.value;
      renderActiveNationalTestPageSearchUi();
      return;
    }
    if (event.target.matches("#test-page-topic-input, #test-page-word-input, #test-page-word-note-input")) {
      updateNationalTestPageDraftFromEditor();
    }
    if (event.target.matches("#test-page-answer-question-input, #test-page-answer-text-input")) {
      updateActiveNationalTestAnswerComposerDraftFromInput();
    }
    if (event.target.matches("[data-test-page-answer-question], [data-test-page-answer-text]")) {
      updateNationalTestPageDraftFromEditor();
      scheduleNationalTestAnswerAutosave();
    }
  });

  els.testStudyWorkspace.addEventListener("change", async event => {
    const studyDocumentFileInput = event.target.closest("[data-study-document-json-file]");
    if (studyDocumentFileInput) {
      const file = studyDocumentFileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        openStudyDocumentDialog(studyDocumentFileInput.dataset.studyDocumentJsonFile, "english", text);
      } catch (error) {
        showToast(error.message || "Could not read the JSON file", true);
      } finally {
        studyDocumentFileInput.value = "";
      }
      return;
    }

    const splitModeInput = event.target.closest("[data-select-test-page-split-mode]");
    if (splitModeInput) {
      state.testPageSplitMode = splitModeInput.value === "page" ? "page" : "translation";
      state.testPageSplitView = true;
      state.testPageSplitPageId = state.testPageSplitMode === "page" ? nextNationalTestSplitPage()?.id || state.testPageSplitPageId || "" : "";
      rerenderNationalTestsPreservingViewport();
      return;
    }

    const splitPageInput = event.target.closest("[data-select-test-page-split]");
    if (splitPageInput) {
      state.testPageSplitPageId = splitPageInput.value || "";
      state.testPageSplitMode = "page";
      state.testPageSplitView = Boolean(state.testPageSplitPageId);
      rerenderNationalTestsPreservingViewport();
      return;
    }

    if (event.target.matches("#test-listening-audio-input")) {
      const file = event.target.files?.[0];
      if (file && !isListeningAudioFile(file)) {
        showToast("Only MP3/MP4 listening audio is accepted", true);
        event.target.value = "";
      }
      updateSelectedTestListeningMediaStatus("audio");
      return;
    }

    if (event.target.matches("#test-listening-transcript-input")) {
      const file = event.target.files?.[0];
      if (file && !isPdfFile(file)) {
        showToast("Only PDF transcript files are accepted", true);
        event.target.value = "";
      }
      updateSelectedTestListeningMediaStatus("transcript");
      return;
    }

    const sectionInput = event.target.closest("#test-page-section-input");
    if (sectionInput) {
      updateNationalTestPageDraftFromEditor();
    }
    if (event.target.matches("[data-test-page-answer-question], [data-test-page-answer-text]")) {
      flushNationalTestAnswerAutosave().catch(error => {
        showToast(error.message || "Answer autosave failed", true);
      });
    }
  });

  els.wordList.addEventListener("submit", event => {
    const form = event.target.closest("[data-practice-typing-form]");
    if (!form) return;
    event.preventDefault();
    submitPracticeAnswer(form.querySelector("#practice-answer-input")?.value || "");
  });

  [els.filterSearch, els.filterFrom, els.filterTo].forEach(input => {
    input.addEventListener("input", () => {
      resetRenderLimit("words");
      state.filters.search = els.filterSearch.value;
      state.filters.from = els.filterFrom.value;
      state.filters.to = els.filterTo.value;
      renderSources();
      renderWords();
      refreshIcons();
    });
  });

  els.filterSource.addEventListener("change", () => {
    resetRenderLimit("words");
    state.filters.sourceId = els.filterSource.value;
    state.filters.branchId = "";
    state.filters.unitId = "";
    render();
  });

  els.filterBranch.addEventListener("change", () => {
    resetRenderLimit("words");
    state.filters.branchId = els.filterBranch.value;
    state.filters.unitId = "";
    render();
  });

  els.filterUnit.addEventListener("change", () => {
    resetRenderLimit("words");
    state.filters.unitId = els.filterUnit.value;
    renderSources();
    renderWords();
    refreshIcons();
  });

  els.filterPos.addEventListener("change", () => {
    resetRenderLimit("words");
    state.filters.partOfSpeech = els.filterPos.value;
    renderSources();
    renderWords();
    refreshIcons();
  });

  els.filterArabic.addEventListener("change", () => {
    resetRenderLimit("words");
    state.filters.arabic = els.filterArabic.value;
    renderSources();
    renderWords();
    refreshIcons();
  });

  els.clearFiltersButton.addEventListener("click", () => {
    resetRenderLimit("words");
    state.filters = { search: "", from: "", to: "", sourceId: "", branchId: "", unitId: "", partOfSpeech: "", arabic: "" };
    els.filterSearch.value = "";
    els.filterFrom.value = "";
    els.filterTo.value = "";
    els.filterArabic.value = "";
    render();
  });

  els.studyFilterSearch.addEventListener("input", () => {
    resetRenderLimit("studyTexts");
    state.studyFilters.search = els.studyFilterSearch.value;
    renderStudyTexts();
    refreshIcons();
  });

  els.studyFilterSource.addEventListener("change", () => {
    resetRenderLimit("studyTexts");
    state.studyFilters.sourceId = els.studyFilterSource.value;
    state.studyFilters.branchId = "";
    state.studyFilters.unitId = "";
    renderStudyFilters();
    renderStudyTexts();
    refreshIcons();
  });

  els.studyFilterBranch.addEventListener("change", () => {
    resetRenderLimit("studyTexts");
    state.studyFilters.branchId = els.studyFilterBranch.value;
    state.studyFilters.unitId = "";
    renderStudyFilters();
    renderStudyTexts();
    refreshIcons();
  });

  els.studyFilterUnit.addEventListener("change", () => {
    resetRenderLimit("studyTexts");
    state.studyFilters.unitId = els.studyFilterUnit.value;
    renderStudyTexts();
    refreshIcons();
  });

  els.studyFilterType.addEventListener("change", () => {
    resetRenderLimit("studyTexts");
    state.studyFilters.type = els.studyFilterType.value;
    renderStudyTexts();
    refreshIcons();
  });

  els.clearStudyFiltersButton.addEventListener("click", () => {
    resetRenderLimit("studyTexts");
    state.studyFilters = { search: "", sourceId: "", branchId: "", unitId: "", type: "" };
    els.studyFilterSearch.value = "";
    renderStudyFilters();
    renderStudyTexts();
    refreshIcons();
  });

  els.videoFilterSearch.addEventListener("input", () => {
    resetRenderLimit("studyVideos");
    state.videoFilters.search = els.videoFilterSearch.value;
    renderStudyVideos();
    refreshIcons();
  });

  els.videoFilterSource.addEventListener("change", () => {
    resetRenderLimit("studyVideos");
    state.videoFilters.sourceId = els.videoFilterSource.value;
    state.videoFilters.branchId = "";
    state.videoFilters.unitId = "";
    renderVideoFilters();
    renderStudyVideos();
    refreshIcons();
  });

  els.videoFilterBranch.addEventListener("change", () => {
    resetRenderLimit("studyVideos");
    state.videoFilters.branchId = els.videoFilterBranch.value;
    state.videoFilters.unitId = "";
    renderVideoFilters();
    renderStudyVideos();
    refreshIcons();
  });

  els.videoFilterUnit.addEventListener("change", () => {
    resetRenderLimit("studyVideos");
    state.videoFilters.unitId = els.videoFilterUnit.value;
    renderStudyVideos();
    refreshIcons();
  });

  els.videoFilterType.addEventListener("change", () => {
    resetRenderLimit("studyVideos");
    state.videoFilters.type = els.videoFilterType.value;
    renderStudyVideos();
    refreshIcons();
  });

  els.clearVideoFiltersButton.addEventListener("click", () => {
    resetRenderLimit("studyVideos");
    state.videoFilters = { search: "", sourceId: "", branchId: "", unitId: "", type: "" };
    els.videoFilterSearch.value = "";
    renderVideoFilters();
    renderStudyVideos();
    refreshIcons();
  });
}

async function handleTreeButton(button) {
  if (button.dataset.resetSourceWritingPractice !== undefined) {
    resetSourceWritingPractice();
    return;
  }

  if (button.dataset.newStudyText) {
    startNewStudyText(parseTreeLocation(button.dataset.newStudyText));
    return;
  }

  if (button.dataset.newStudyVideo) {
    startNewStudyVideo(parseTreeLocation(button.dataset.newStudyVideo));
    return;
  }

  if (button.dataset.openStudyText) {
    const text = (state.db.studyTexts || []).find(item => item.id === button.dataset.openStudyText);
    if (text) editStudyText(text);
    return;
  }

  if (button.dataset.openStudyVideo) {
    const video = (state.db.studyVideos || []).find(item => item.id === button.dataset.openStudyVideo);
    if (video) editStudyVideo(video);
    return;
  }

  if (button.dataset.openNationalTest) {
    const test = (state.db.nationalTests || []).find(item => item.id === button.dataset.openNationalTest);
    if (test) openNationalTestReader(test);
    return;
  }

  if (button.dataset.addBranch) {
    const sourceId = button.dataset.addBranch;
    const name = promptName("Unit name");
    if (!name) return;
    await api(`/api/sources/${sourceId}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    await loadDatabase();
    showToast("Unit added");
  }

  if (button.dataset.addUnit) {
    const [sourceId, branchId] = button.dataset.addUnit.split(":");
    const name = promptName("Topic name");
    if (!name) return;
    await api(`/api/sources/${sourceId}/branches/${branchId}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    await loadDatabase();
    showToast("Topic added");
  }

  if (button.dataset.renameSource) {
    const source = findSource(button.dataset.renameSource);
    const name = promptName("Source name", source?.name || "");
    if (!name) return;
    await api(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    await loadDatabase();
    showToast("Source renamed");
  }

  if (button.dataset.renameBranch) {
    const [sourceId, branchId] = button.dataset.renameBranch.split(":");
    const branch = findBranch(sourceId, branchId);
    const name = promptName("Unit name", branch?.name || "");
    if (!name) return;
    await api(`/api/sources/${sourceId}/branches/${branchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    await loadDatabase();
    showToast("Unit renamed");
  }

  if (button.dataset.moveBranch) {
    const [sourceId, branchId] = button.dataset.moveBranch.split(":");
    const branch = findBranch(sourceId, branchId);
    if (!branch) return;
    const targets = state.db.sources.filter(source => source.id !== sourceId);
    if (!targets.length) {
      showToast("Create another source before moving a unit", true);
      return;
    }
    const target = promptSourceChoice(`Move "${branch.name}" to source`, targets);
    if (!target) return;
    await api(`/api/sources/${sourceId}/branches/${branchId}/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: target.id })
    });
    if (state.selected.sourceId === sourceId && state.selected.branchId === branchId) {
      state.selected.sourceId = target.id;
    }
    state.sourceTreeCollapsed.delete(sourceTreeCollapseKey("source", target.id));
    saveSourceTreeCollapseState();
    await loadDatabase();
    showToast("Unit moved");
  }

  if (button.dataset.renameUnit) {
    const [sourceId, branchId, unitId] = button.dataset.renameUnit.split(":");
    const unit = findUnit(sourceId, branchId, unitId);
    const name = promptName("Topic name", unit?.name || "");
    if (!name) return;
    await api(`/api/sources/${sourceId}/branches/${branchId}/units/${unitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    await loadDatabase();
    showToast("Topic renamed");
  }

  if (button.dataset.deleteSource) {
    const source = findSource(button.dataset.deleteSource);
    if (!source || !window.confirm(`Delete "${source.name}"?`)) return;
    await api(`/api/sources/${source.id}`, { method: "DELETE" });
    state.selected = { sourceId: "", branchId: "", unitId: "" };
    await loadDatabase();
    showToast("Source deleted");
  }

  if (button.dataset.deleteBranch) {
    const [sourceId, branchId] = button.dataset.deleteBranch.split(":");
    const branch = findBranch(sourceId, branchId);
    if (!branch || !window.confirm(`Delete "${branch.name}"?`)) return;
    await api(`/api/sources/${sourceId}/branches/${branchId}`, { method: "DELETE" });
    state.selected.branchId = "";
    state.selected.unitId = "";
    await loadDatabase();
    showToast("Unit deleted");
  }

  if (button.dataset.deleteUnit) {
    const [sourceId, branchId, unitId] = button.dataset.deleteUnit.split(":");
    const unit = findUnit(sourceId, branchId, unitId);
    if (!unit || !window.confirm(`Delete "${unit.name}"?`)) return;
    await api(`/api/sources/${sourceId}/branches/${branchId}/units/${unitId}`, { method: "DELETE" });
    state.selected.unitId = "";
    await loadDatabase();
    showToast("Topic deleted");
  }
}

bindEvents();
window.addEventListener("resize", schedulePageLayoutStabilization);
window.addEventListener("pagehide", stopVideoRecordingIfHidden);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopVideoRecordingIfHidden();
});
state.activeSection = normalizedActiveSection(localStorage.getItem(ACTIVE_SECTION_STORAGE_KEY));
if (state.activeSection === "tests") {
  state.activeTab = "test";
  state.activeLibraryTab = "tests";
}
updateTabs();
updateSingleImageControl();
updateVideoBackgroundControls();
updateTestPdfControl();
els.jsonImageMapper.innerHTML = imageMapperStateHtml("Paste word JSON to create image boxes.");
setReviewWordCount(localStorage.getItem("reviewWordCount") || DEFAULT_REVIEW_WORD_COUNT);
setSourcePanelCollapsed(localStorage.getItem("sourcePanelCollapsed") === "true");
loadSourceTreeCollapseState();
loadNationalTestPageGroupCollapseState();
loadNationalTestProgressState();
loadKnownTokenIgnoreState();
state.testPageGroupingToolCollapsed = localStorage.getItem(TEST_PAGE_GROUPING_TOOL_COLLAPSE_STORAGE_KEY) === "true";
state.testPageGroupingToolHidden = localStorage.getItem(TEST_PAGE_GROUPING_TOOL_HIDDEN_STORAGE_KEY) === "true";
state.testPagePdfCollapsed = localStorage.getItem(TEST_PAGE_PDF_COLLAPSE_STORAGE_KEY) === "true";
state.testPageWordPracticeHidden = localStorage.getItem(TEST_PAGE_WORD_PRACTICE_HIDDEN_STORAGE_KEY) === "true";
state.testPageListCollapsed = localStorage.getItem(TEST_PAGE_LIST_COLLAPSE_STORAGE_KEY) !== "false";
state.testPageListWidth = normalizedTestPageListWidth(localStorage.getItem(TEST_PAGE_LIST_WIDTH_STORAGE_KEY));
state.testPagePracticeWidth = normalizedTestPagePracticeWidth(localStorage.getItem(TEST_PAGE_PRACTICE_WIDTH_STORAGE_KEY));
state.testPagePdfZoom = normalizedTestPagePdfZoom(localStorage.getItem(TEST_PAGE_PDF_ZOOM_STORAGE_KEY));
state.testPageVisualZoom = normalizedTestPageVisualZoom(localStorage.getItem(TEST_PAGE_VISUAL_ZOOM_STORAGE_KEY));
state.testPageTranslationLanguage = normalizeTranslationLanguage(localStorage.getItem(TEST_PAGE_TRANSLATION_LANGUAGE_STORAGE_KEY), "en") === "ar" ? "ar" : "en";
state.testPageOfficialAnswersVisible = false;
restoreCachedDatabase();
loadDatabase().catch(error => showToast(error.message, true));


