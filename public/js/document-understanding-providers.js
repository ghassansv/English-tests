export const DOCUMENT_UNDERSTANDING_PROVIDER_VERSION = "document-understanding-provider/v1";
export const DOCUMENT_PROVIDER_ANALYSIS_SCHEMA_VERSION = "document-provider-analysis/v1";
export const VISION_DOCUMENT_ANALYSIS_SCHEMA_VERSION = "vision-document-analysis/v1";
export const HYBRID_DOCUMENT_ANALYSIS_SCHEMA_VERSION = "hybrid-document-analysis/v1";

const DEFAULT_PROVIDER_TIMEOUT_MS = 2500;
const LOCAL_PROXY_BASE_URL = "";

export function createHeuristicDocumentUnderstandingProvider() {
  return {
    type: "heuristic",
    name: "heuristic-document-understanding",
    version: DOCUMENT_UNDERSTANDING_PROVIDER_VERSION,
    async health() {
      return {
        status: "ready",
        mode: "heuristic",
        providers: {
          heuristic: { available: true, model: "built-in-semantic-heuristics", state: "ready" }
        }
      };
    },
    async getCapabilities() {
      return {
        analyzePage: true,
        analyzeRegion: true,
        classifyElements: true,
        inferReadingOrder: true,
        inferRelationships: true,
        classifyVisualRegions: true,
        validateSemanticInterpretation: true
      };
    },
    async analyzePage(input = {}) {
      return heuristicProviderAnalysis(input);
    },
    async analyzeRegion(input = {}) {
      return heuristicRegionAnalysis(input);
    },
    async classifyElements(input = {}) {
      return heuristicProviderAnalysis(input).elements;
    },
    async inferReadingOrder(input = {}) {
      return heuristicProviderAnalysis(input).readingOrder;
    },
    async inferRelationships(input = {}) {
      return heuristicProviderAnalysis(input).relationships || [];
    },
    async classifyVisualRegions(input = {}) {
      return heuristicProviderAnalysis(input).visualClassifications || [];
    },
    async validateSemanticInterpretation(input = {}) {
      return input.semanticValidation || null;
    }
  };
}

export function createLocalServiceDocumentUnderstandingProvider(options = {}) {
  const baseUrl = String(options.baseUrl ?? LOCAL_PROXY_BASE_URL).replace(/\/+$/u, "");
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const timeoutMs = Math.max(250, Number(options.timeoutMs) || DEFAULT_PROVIDER_TIMEOUT_MS);
  const endpoint = path => `${baseUrl}${path}`;
  const request = async (path, requestOptions = {}) => {
    if (typeof fetchImpl !== "function") {
      return { ok: false, unavailable: true, error: "fetch-unavailable" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint(path), { ...requestOptions, signal: controller.signal });
      const text = await response.text();
      const data = text ? parseProviderJsonOutput(text) : null;
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return {
        ok: false,
        unavailable: true,
        timeout: error?.name === "AbortError",
        error: error?.message || "local-document-service-unavailable"
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    type: "hybrid-local-service-client",
    name: "local-document-intelligence-client",
    version: DOCUMENT_UNDERSTANDING_PROVIDER_VERSION,
    async health() {
      const result = await request("/api/document-understanding/health");
      if (!result.ok || !result.data) {
        return unavailableHealth(result.error, result.timeout);
      }
      return result.data;
    },
    async getCapabilities() {
      const health = await this.health();
      return capabilitiesFromHealth(health);
    },
    async analyzePage(input = {}) {
      const compactInput = compactDocumentUnderstandingInput(input);
      const result = await request("/api/document-understanding/analyze-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compactInput)
      });
      if (!result.ok || !result.data) return unavailableProviderAnalysis(result.error, result.timeout);
      return normalizeHybridDocumentAnalysis(result.data);
    },
    async analyzeRegion(input = {}) {
      const compactInput = compactDocumentUnderstandingInput(input);
      const result = await request("/api/document-understanding/analyze-region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compactInput)
      });
      if (!result.ok || !result.data) return unavailableRegionAnalysis(result.error, result.timeout, input);
      return normalizeHybridDocumentAnalysis(result.data);
    },
    async classifyElements(input = {}) {
      const analysis = await this.analyzePage(input);
      return collectProviderAnalyses(analysis).flatMap(entry => entry.elements || []);
    },
    async inferReadingOrder(input = {}) {
      const analysis = await this.analyzePage(input);
      return collectProviderAnalyses(analysis).flatMap(entry => entry.readingOrder || []);
    },
    async inferRelationships(input = {}) {
      const analysis = await this.analyzePage(input);
      return collectProviderAnalyses(analysis).flatMap(entry => entry.relationships || []);
    },
    async classifyVisualRegions(input = {}) {
      const analysis = await this.analyzePage(input);
      return collectProviderAnalyses(analysis).flatMap(entry => entry.visualClassifications || []);
    },
    async validateSemanticInterpretation(input = {}) {
      const analysis = await this.analyzePage(input);
      return analysis.validation || null;
    }
  };
}

export function createHybridDocumentUnderstandingProvider(options = {}) {
  const heuristicProvider = options.heuristicProvider || createHeuristicDocumentUnderstandingProvider();
  const localProvider = options.localProvider || createLocalServiceDocumentUnderstandingProvider(options.localService || {});
  const logger = options.logger || null;
  return {
    type: "hybrid",
    name: "hybrid-document-understanding",
    version: DOCUMENT_UNDERSTANDING_PROVIDER_VERSION,
    async health() {
      const heuristic = await safeProviderCall(() => heuristicProvider.health(), { status: "ready" });
      const local = await safeProviderCall(() => localProvider.health(), unavailableHealth("local-provider-health-failed"));
      const localReady = localServiceHasAnyProvider(local);
      return {
        status: localReady ? "ready" : "degraded",
        mode: localReady ? "hybrid-local" : "heuristic-fallback",
        providers: {
          heuristic: { available: true, state: "ready", model: "built-in-semantic-heuristics" },
          localService: {
            available: localReady,
            status: local.status || "unavailable",
            providers: local.providers || {}
          }
        },
        local
      };
    },
    async getCapabilities() {
      const health = await this.health();
      return {
        analyzePage: true,
        analyzeRegion: true,
        classifyElements: true,
        inferReadingOrder: true,
        inferRelationships: true,
        classifyVisualRegions: true,
        validateSemanticInterpretation: true,
        localServiceAvailable: localServiceHasAnyProvider(health.local || health)
      };
    },
    async analyzePage(input = {}) {
      const health = await this.health();
      const heuristicAnalysis = await safeProviderCall(() => heuristicProvider.analyzePage(input), heuristicProviderAnalysis(input));
      const localAnalysis = localServiceHasAnyProvider(health.local || health)
        ? await safeProviderCall(() => localProvider.analyzePage(input), unavailableProviderAnalysis("local-provider-analysis-failed"))
        : unavailableProviderAnalysis("local-service-unavailable");
      const analysis = {
        schemaVersion: HYBRID_DOCUMENT_ANALYSIS_SCHEMA_VERSION,
        provider: {
          type: "hybrid",
          name: "hybrid-document-understanding",
          version: DOCUMENT_UNDERSTANDING_PROVIDER_VERSION
        },
        mode: localServiceHasAnyProvider(health.local || health) ? "hybrid-local" : "heuristic-fallback",
        health,
        analyses: {
          heuristic: heuristicAnalysis,
          local: localAnalysis
        },
        diagnostics: {
          localServiceAvailable: localServiceHasAnyProvider(health.local || health)
        }
      };
      if (logger?.info) logger.info(documentUnderstandingModeSummary(analysis));
      return analysis;
    },
    async analyzeRegion(input = {}) {
      const health = await this.health();
      const heuristicAnalysis = await safeProviderCall(() => heuristicProvider.analyzeRegion(input), heuristicRegionAnalysis(input));
      const localAnalysis = localServiceHasAnyProvider(health.local || health)
        ? await safeProviderCall(() => localProvider.analyzeRegion(input), unavailableRegionAnalysis("local-region-analysis-failed", false, input))
        : unavailableRegionAnalysis("local-service-unavailable", false, input);
      return {
        schemaVersion: HYBRID_DOCUMENT_ANALYSIS_SCHEMA_VERSION,
        provider: {
          type: "hybrid",
          name: "hybrid-document-understanding",
          version: DOCUMENT_UNDERSTANDING_PROVIDER_VERSION
        },
        mode: localServiceHasAnyProvider(health.local || health) ? "hybrid-local" : "heuristic-fallback",
        health,
        analyses: { heuristic: heuristicAnalysis, local: localAnalysis },
        region: input.region || null,
        diagnostics: { targeted: true }
      };
    },
    async classifyElements(input = {}) {
      return collectProviderAnalyses(await this.analyzePage(input)).flatMap(entry => entry.elements || []);
    },
    async inferReadingOrder(input = {}) {
      return collectProviderAnalyses(await this.analyzePage(input)).flatMap(entry => entry.readingOrder || []);
    },
    async inferRelationships(input = {}) {
      return collectProviderAnalyses(await this.analyzePage(input)).flatMap(entry => entry.relationships || []);
    },
    async classifyVisualRegions(input = {}) {
      return collectProviderAnalyses(await this.analyzePage(input)).flatMap(entry => entry.visualClassifications || []);
    },
    async validateSemanticInterpretation(input = {}) {
      return input.semanticValidation || null;
    }
  };
}

export function compactDocumentUnderstandingInput(input = {}) {
  const sourceEvidence = input.sourceEvidence || {};
  const semanticPage = input.semanticPage || input.heuristicSemanticPage || {};
  const semanticValidation = input.semanticValidation || {};
  const page = input.page || {};
  const containerSource = page.sourceContainer?.source || {};
  return {
    schemaVersion: "document-understanding-input/v1",
    pageRef: semanticPage.pageRef || sourceEvidence.pageRef || {
      testId: String(page.testId || ""),
      pageId: String(page.id || page.pageId || ""),
      pageNumber: Number.isFinite(Number(page.pageNumber)) ? Number(page.pageNumber) : null
    },
    source: {
      sourcePageImage: sourceEvidence.source?.sourcePageImage || page.sourcePage?.url || containerSource.original?.url || null,
      normalizedPageImage: sourceEvidence.source?.normalizedPageImage || page.normalizedPage?.url || containerSource.normalized?.url || null,
      originalPixelSize: sourceEvidence.source?.originalPixelSize || page.sourcePage || containerSource.original || null,
      normalizedPixelSize: sourceEvidence.source?.normalizedPixelSize || page.normalizedPage || containerSource.normalized || null
    },
    sourceEvidenceSummary: {
      counts: {
        pdfTextEvidence: sourceEvidence.pdfTextEvidence?.length || 0,
        ocrWords: sourceEvidence.ocrEvidence?.words?.length || 0,
        ocrLines: sourceEvidence.ocrEvidence?.lines?.length || 0,
        ocrBlocks: sourceEvidence.ocrEvidence?.blocks?.length || 0,
        imageCandidates: sourceEvidence.visualEvidence?.imageCandidates?.length || 0,
        graphicCandidates: sourceEvidence.visualEvidence?.graphicCandidates?.length || 0
      },
      textUnits: compactTextEvidence(sourceEvidence).slice(0, 80),
      visualRegions: compactVisualEvidence(sourceEvidence).slice(0, 80)
    },
    semanticSummary: {
      pageType: semanticPage.pageType || "unknown",
      styleHints: semanticPage.styleHints || {},
      elements: (semanticPage.elements || []).slice(0, 120).map(element => ({
        id: element.id,
        type: element.type,
        text: truncateText(element.text, 160),
        sourceEvidenceIds: element.sourceEvidenceIds || [],
        layoutIntent: element.layoutIntent || {}
      })),
      relationships: (semanticPage.relationships || []).slice(0, 160).map(relationship => ({
        type: relationship.type,
        from: relationship.from,
        to: relationship.to,
        confidence: relationship.confidence
      })),
      readingOrder: (semanticPage.readingOrder || []).slice(0, 160)
    },
    semanticValidationSummary: {
      status: semanticValidation.status || "unknown",
      score: Number(semanticValidation.score) || 0,
      scores: semanticValidation.scores || {},
      issues: (semanticValidation.issues || []).slice(0, 80).map(issue => ({
        id: issue.id,
        type: issue.type,
        severity: issue.severity,
        sourceEvidenceIds: issue.sourceEvidenceIds || [],
        semanticElementIds: issue.semanticElementIds || [],
        message: truncateText(issue.message, 180)
      }))
    },
    region: input.region || null,
    issue: input.issue || null
  };
}

export function normalizeDocumentProviderAnalysis(value = {}, fallback = {}) {
  const provider = value.provider && typeof value.provider === "object" ? value.provider : {};
  const elements = Array.isArray(value.elements) ? value.elements : [];
  return {
    schemaVersion: DOCUMENT_PROVIDER_ANALYSIS_SCHEMA_VERSION,
    provider: {
      type: String(provider.type || fallback.type || "document-parser"),
      name: String(provider.name || fallback.name || "unknown-provider"),
      model: String(provider.model || fallback.model || ""),
      device: String(provider.device || fallback.device || "unknown")
    },
    pageAnalysis: normalizePageAnalysis(value.pageAnalysis),
    elements: elements.slice(0, 500).map((element, index) => normalizeProviderElement(element, index)).filter(Boolean),
    readingOrder: normalizeStringArray(value.readingOrder),
    relationships: normalizeProviderRelationships(value.relationships),
    visualClassifications: normalizeVisualClassifications(value.visualClassifications),
    diagnostics: value.diagnostics && typeof value.diagnostics === "object" ? value.diagnostics : {}
  };
}

export function normalizeVisionDocumentAnalysis(value = {}, fallback = {}) {
  return {
    schemaVersion: VISION_DOCUMENT_ANALYSIS_SCHEMA_VERSION,
    provider: {
      type: "vision-reasoner",
      name: String(value.provider?.name || fallback.name || "local-vision-reasoner"),
      model: String(value.provider?.model || fallback.model || ""),
      device: String(value.provider?.device || fallback.device || "unknown")
    },
    page: {
      orientation: ["portrait", "landscape", "unknown"].includes(String(value.page?.orientation)) ? String(value.page.orientation) : "unknown",
      pageType: String(value.page?.pageType || "unknown"),
      columnCount: Math.max(0, Math.round(Number(value.page?.columnCount) || 0)),
      confidence: normalizedConfidence(value.page?.confidence)
    },
    elementInterpretations: (Array.isArray(value.elementInterpretations) ? value.elementInterpretations : [])
      .slice(0, 500)
      .map((entry, index) => ({
        providerElementId: String(entry?.providerElementId || `vision-element-${index + 1}`),
        semanticType: String(entry?.semanticType || "unknown"),
        sourceEvidenceIds: normalizeStringArray(entry?.sourceEvidenceIds),
        confidence: normalizedConfidence(entry?.confidence)
      })),
    groups: (Array.isArray(value.groups) ? value.groups : []).slice(0, 200).map((group, index) => ({
      id: String(group?.id || `vision-group-${index + 1}`),
      type: String(group?.type || "visualGroup"),
      memberEvidenceIds: normalizeStringArray(group?.memberEvidenceIds),
      confidence: normalizedConfidence(group?.confidence)
    })),
    relationships: normalizeVisionRelationships(value.relationships),
    readingOrderEvidence: normalizeStringArray(value.readingOrderEvidence),
    visualClassifications: normalizeVisualClassifications(value.visualClassifications),
    disagreements: Array.isArray(value.disagreements) ? value.disagreements.slice(0, 100) : [],
    diagnostics: value.diagnostics && typeof value.diagnostics === "object" ? value.diagnostics : {}
  };
}

export function normalizeHybridDocumentAnalysis(value = {}) {
  if (value.schemaVersion === DOCUMENT_PROVIDER_ANALYSIS_SCHEMA_VERSION) {
    return {
      schemaVersion: HYBRID_DOCUMENT_ANALYSIS_SCHEMA_VERSION,
      provider: { type: "hybrid", name: "single-provider-wrapper", version: DOCUMENT_UNDERSTANDING_PROVIDER_VERSION },
      mode: "single-provider",
      analyses: { local: normalizeDocumentProviderAnalysis(value) },
      diagnostics: {}
    };
  }
  const analyses = value.analyses && typeof value.analyses === "object" ? value.analyses : {};
  return {
    schemaVersion: HYBRID_DOCUMENT_ANALYSIS_SCHEMA_VERSION,
    provider: value.provider || { type: "hybrid", name: "hybrid-document-understanding", version: DOCUMENT_UNDERSTANDING_PROVIDER_VERSION },
    mode: String(value.mode || "heuristic-fallback"),
    health: value.health || null,
    analyses: {
      ...(analyses.heuristic ? { heuristic: normalizeDocumentProviderAnalysis(analyses.heuristic, { type: "heuristic", name: "heuristic" }) } : {}),
      ...(analyses.parser ? { parser: normalizeDocumentProviderAnalysis(analyses.parser, { type: "document-parser", name: "local-document-parser" }) } : {}),
      ...(analyses.vision ? { vision: normalizeVisionDocumentAnalysis(analyses.vision, { name: "local-vision-reasoner" }) } : {}),
      ...(analyses.local ? { local: normalizeNestedLocalAnalysis(analyses.local) } : {})
    },
    region: value.region || null,
    diagnostics: value.diagnostics || {}
  };
}

export function parseProviderJsonOutput(value, options = {}) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  if (!text) throw new Error("Provider output was empty");
  const attempts = [
    text,
    stripMarkdownFences(text),
    extractFirstJsonObject(text),
    repairProviderJsonString(extractFirstJsonObject(text) || stripMarkdownFences(text))
  ].filter(Boolean);
  let lastError = null;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  if (typeof options.repairJson === "function") {
    const repaired = options.repairJson(text);
    if (repaired && repaired !== text) return parseProviderJsonOutput(repaired);
  }
  throw lastError || new Error("Unable to parse provider JSON");
}

export function documentUnderstandingModeSummary(analysis) {
  const mode = analysis?.mode || "unknown";
  const health = analysis?.health?.local || analysis?.health || {};
  const providers = health.providers || {};
  const parser = providers.documentParser || providers.parser || {};
  const vision = providers.visionReasoner || providers.vision || {};
  return [
    "[Document Understanding]",
    `Mode: ${mode}`,
    `Parser: ${parser.state || (parser.available ? "ready" : "unavailable")}`,
    `Vision reasoner: ${vision.state || (vision.available ? "ready" : "unavailable")}`
  ].join("\n");
}

export function collectProviderAnalyses(analysis) {
  if (!analysis) return [];
  if (analysis.schemaVersion === DOCUMENT_PROVIDER_ANALYSIS_SCHEMA_VERSION || analysis.schemaVersion === VISION_DOCUMENT_ANALYSIS_SCHEMA_VERSION) return [analysis];
  const entries = [];
  Object.values(analysis.analyses || {}).forEach(value => {
    if (!value) return;
    if (value.schemaVersion === HYBRID_DOCUMENT_ANALYSIS_SCHEMA_VERSION) entries.push(...collectProviderAnalyses(value));
    else entries.push(value);
  });
  return entries;
}

function heuristicProviderAnalysis(input = {}) {
  const semanticPage = input.semanticPage || input.heuristicSemanticPage || {};
  const sourceEvidence = input.sourceEvidence || {};
  const elements = (semanticPage.elements || []).map((element, index) => ({
    id: `heuristic-element-${index + 1}-${stableSlug(element.id)}`,
    providerType: element.type || "unknown",
    text: element.text || null,
    sourceBBox: sourceBBoxForEvidenceIds(sourceEvidence, element.sourceEvidenceIds || []),
    confidence: normalizedConfidence(element.confidence ?? 0.75),
    sourceEvidenceIds: element.sourceEvidenceIds || [],
    attributes: {
      semanticElementId: element.id,
      layoutIntent: element.layoutIntent || {}
    }
  }));
  return normalizeDocumentProviderAnalysis({
    provider: { type: "heuristic", name: "heuristic-document-understanding", model: "built-in-semantic-heuristics", device: "browser" },
    pageAnalysis: {
      pageTypeCandidates: [{ value: semanticPage.pageType || "unknown", confidence: 0.75 }],
      columnCountCandidates: [{ value: Number(semanticPage.styleHints?.columnCount) || 1, confidence: 0.75 }],
      layoutDescription: "Heuristic interpretation from SourceEvidenceModel and initial SemanticPageModel."
    },
    elements,
    readingOrder: semanticPage.readingOrder || [],
    relationships: semanticPage.relationships || [],
    visualClassifications: (sourceEvidence.visualEvidence?.imageCandidates || []).map(candidate => ({
      sourceRegionId: candidate.id,
      classification: candidate.accepted || candidate.url ? "document-image" : "unknown-image",
      confidence: candidate.accepted || candidate.url ? 0.72 : 0.45
    })),
    diagnostics: { source: "heuristic" }
  }, { type: "heuristic", name: "heuristic-document-understanding" });
}

function heuristicRegionAnalysis(input = {}) {
  return {
    ...heuristicProviderAnalysis(input),
    diagnostics: { source: "heuristic", targeted: true, issueType: input.issue?.type || "" }
  };
}

function unavailableProviderAnalysis(error = "local-service-unavailable", timeout = false) {
  return normalizeDocumentProviderAnalysis({
    provider: { type: "local-service", name: "local-document-intelligence", model: "", device: "unknown" },
    diagnostics: {
      available: false,
      error,
      timeout: Boolean(timeout)
    }
  }, { type: "local-service", name: "local-document-intelligence" });
}

function unavailableRegionAnalysis(error = "local-service-unavailable", timeout = false, input = {}) {
  return {
    ...unavailableProviderAnalysis(error, timeout),
    region: input.region || null,
    diagnostics: { available: false, targeted: true, error, timeout: Boolean(timeout) }
  };
}

function unavailableHealth(error = "local-service-unavailable", timeout = false) {
  return {
    status: "unavailable",
    mode: "heuristic-fallback",
    error,
    timeout: Boolean(timeout),
    providers: {
      documentParser: { available: false, state: "unavailable", model: "" },
      visionReasoner: { available: false, state: "unavailable", model: "" }
    }
  };
}

function localServiceHasAnyProvider(health = {}) {
  const providers = health.providers || {};
  return Object.values(providers).some(provider => Boolean(provider?.available || provider?.state === "ready"));
}

function capabilitiesFromHealth(health = {}) {
  const available = localServiceHasAnyProvider(health);
  return {
    analyzePage: available,
    analyzeRegion: available,
    classifyElements: available,
    inferReadingOrder: available,
    inferRelationships: available,
    classifyVisualRegions: available,
    validateSemanticInterpretation: available,
    localServiceAvailable: available
  };
}

async function safeProviderCall(callback, fallback) {
  try {
    return await callback();
  } catch (error) {
    return {
      ...fallback,
      diagnostics: {
        ...(fallback?.diagnostics || {}),
        providerError: error?.message || "provider-call-failed"
      }
    };
  }
}

function normalizeNestedLocalAnalysis(value) {
  if (value.schemaVersion === HYBRID_DOCUMENT_ANALYSIS_SCHEMA_VERSION) return normalizeHybridDocumentAnalysis(value);
  if (value.schemaVersion === VISION_DOCUMENT_ANALYSIS_SCHEMA_VERSION) return normalizeVisionDocumentAnalysis(value);
  return normalizeDocumentProviderAnalysis(value, { type: "local-service", name: "local-document-intelligence" });
}

function normalizePageAnalysis(value = {}) {
  const pageTypeCandidates = (Array.isArray(value.pageTypeCandidates) ? value.pageTypeCandidates : [])
    .slice(0, 20)
    .map(candidate => ({ value: String(candidate?.value || candidate || "unknown"), confidence: normalizedConfidence(candidate?.confidence ?? 0.5) }));
  const columnCountCandidates = (Array.isArray(value.columnCountCandidates) ? value.columnCountCandidates : [])
    .slice(0, 20)
    .map(candidate => ({ value: Math.max(0, Math.round(Number(candidate?.value ?? candidate) || 0)), confidence: normalizedConfidence(candidate?.confidence ?? 0.5) }));
  return {
    pageTypeCandidates,
    columnCountCandidates,
    layoutDescription: value.layoutDescription === null || value.layoutDescription === undefined ? null : String(value.layoutDescription)
  };
}

function normalizeProviderElement(element, index) {
  if (!element || typeof element !== "object") return null;
  const id = String(element.id || `provider-element-${index + 1}`);
  return {
    id,
    providerType: String(element.providerType || element.type || "unknown"),
    text: element.text === null || element.text === undefined ? null : String(element.text),
    sourceBBox: normalizeSourceBBox(element.sourceBBox || element.bbox),
    confidence: optionalProviderConfidence(element.confidence),
    sourceEvidenceIds: normalizeStringArray(element.sourceEvidenceIds),
    attributes: element.attributes && typeof element.attributes === "object" ? element.attributes : {}
  };
}

function normalizeProviderRelationships(value = []) {
  return (Array.isArray(value) ? value : []).slice(0, 500).map((relationship, index) => ({
    id: String(relationship?.id || `provider-relationship-${index + 1}`),
    type: String(relationship?.type || "relatedTo"),
    from: String(relationship?.from || ""),
    to: String(relationship?.to || ""),
    fromEvidenceIds: normalizeStringArray(relationship?.fromEvidenceIds),
    toEvidenceIds: normalizeStringArray(relationship?.toEvidenceIds),
    confidence: normalizedConfidence(relationship?.confidence)
  }));
}

function normalizeVisionRelationships(value = []) {
  return (Array.isArray(value) ? value : []).slice(0, 500).map((relationship, index) => ({
    id: String(relationship?.id || `vision-relationship-${index + 1}`),
    type: String(relationship?.type || "relatedTo"),
    fromEvidenceIds: normalizeStringArray(relationship?.fromEvidenceIds),
    toEvidenceIds: normalizeStringArray(relationship?.toEvidenceIds),
    confidence: normalizedConfidence(relationship?.confidence)
  }));
}

function normalizeVisualClassifications(value = []) {
  return (Array.isArray(value) ? value : []).slice(0, 500).map((entry, index) => ({
    id: String(entry?.id || `visual-classification-${index + 1}`),
    sourceRegionId: String(entry?.sourceRegionId || entry?.sourceEvidenceId || ""),
    classification: String(entry?.classification || "unknown"),
    confidence: optionalProviderConfidence(entry?.confidence),
    attributes: entry?.attributes && typeof entry.attributes === "object" ? entry.attributes : {}
  })).filter(entry => entry.sourceRegionId);
}

function compactTextEvidence(sourceEvidence = {}) {
  return [
    ...(sourceEvidence.pdfTextEvidence || []).map(item => ({ ...item, evidenceKind: "pdf-text" })),
    ...(sourceEvidence.ocrEvidence?.lines || []).map(item => ({ ...item, evidenceKind: "ocr-line" })),
    ...(sourceEvidence.ocrEvidence?.blocks || []).map(item => ({ ...item, evidenceKind: "ocr-block" }))
  ].filter(item => String(item.text || "").trim()).map(item => ({
    id: item.id,
    kind: item.evidenceKind,
    text: truncateText(item.text, 220),
    bbox: normalizeSourceBBox(item.bbox),
    confidence: normalizedConfidence(item.confidence)
  }));
}

function compactVisualEvidence(sourceEvidence = {}) {
  return [
    ...(sourceEvidence.visualEvidence?.imageCandidates || []).map(item => ({ ...item, kind: "image-candidate" })),
    ...(sourceEvidence.visualEvidence?.graphicCandidates || []).map(item => ({ ...item, kind: item.kind || "graphic-candidate" }))
  ].map(item => ({
    id: item.id,
    kind: item.kind,
    role: item.role || "",
    bbox: normalizeSourceBBox(item.bbox),
    confidence: normalizedConfidence(item.confidence),
    accepted: Boolean(item.accepted),
    artifactRisk: Number(item.artifactRisk) || 0
  }));
}

function sourceBBoxForEvidenceIds(sourceEvidence, ids = []) {
  const all = [
    ...(sourceEvidence.pdfTextEvidence || []),
    ...(sourceEvidence.ocrEvidence?.words || []),
    ...(sourceEvidence.ocrEvidence?.lines || []),
    ...(sourceEvidence.ocrEvidence?.blocks || []),
    ...(sourceEvidence.visualEvidence?.imageCandidates || []),
    ...(sourceEvidence.visualEvidence?.graphicCandidates || [])
  ];
  const boxes = ids.map(id => all.find(item => item.id === id)?.bbox).map(normalizeSourceBBox).filter(Boolean);
  return boxes.reduce(combineBbox, null);
}

function normalizeSourceBBox(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    x: roundRatio(Math.max(0, Math.min(1, x))),
    y: roundRatio(Math.max(0, Math.min(1, y))),
    width: roundRatio(Math.max(0.0001, Math.min(1, width))),
    height: roundRatio(Math.max(0.0001, Math.min(1, height))),
    coordinateSpace: "source-document-plane-normalized"
  };
}

function combineBbox(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return normalizeSourceBBox({ x, y, width: maxX - x, height: maxY - y });
}

function stripMarkdownFences(text) {
  return String(text || "").replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
}

function extractFirstJsonObject(text) {
  const value = String(text || "");
  const start = value.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") inString = !inString;
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return "";
}

function repairProviderJsonString(text) {
  return String(text || "")
    .replace(/,\s*([}\]])/gu, "$1")
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/gu, "$1\"$2\"$3")
    .trim();
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : []).map(item => String(item || "").trim()).filter(Boolean);
}

function normalizedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Math.round((number > 1 ? number / 100 : number) * 1000) / 1000));
}

function optionalProviderConfidence(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, Math.round((number > 1 ? number / 100 : number) * 1000) / 1000));
}

function roundRatio(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function truncateText(text, limit = 120) {
  const value = String(text || "").replace(/\s+/gu, " ").trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function stableSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48) || "unnamed";
}
