import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { jsonrepair } from "jsonrepair";
import {
  formatNationalTestTextValue,
  normalizeNationalTestPageLayout,
  pageLayoutFromPageInput
} from "./public/js/page-layout-normalizer.js";
import { validateStudyDocumentV1 } from "./public/js/study-document-v1.js";
import { validateStudyDocumentPageBinding } from "./public/js/study-document-page-binding.js";
import {
  officialStudyDocumentAnswers,
  validateOfficialStudyDocumentAnswerMapping
} from "./public/js/study-document-official-answers.js";
import { validateStudyDocumentTranslationV1 } from "./public/js/study-document-translation-v1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const IMAGE_DIR = path.join(DATA_DIR, "images");
const VIDEO_DIR = path.join(DATA_DIR, "videos");
const NATIONAL_TEST_DIR = path.join(DATA_DIR, "national-tests");
const NATIONAL_TEST_PAGE_IMAGE_DIR = path.join(DATA_DIR, "national-test-page-images");
const LISTENING_MEDIA_DIR = path.join(DATA_DIR, "listening-media");
const LISTENING_UPLOAD_TMP_DIR = path.join(LISTENING_MEDIA_DIR, ".tmp");
const LEGACY_LISTENING_AUDIO_DIR = path.join(DATA_DIR, "listening-audio");
const LEGACY_LISTENING_TRANSCRIPT_DIR = path.join(DATA_DIR, "listening-transcripts");
const PRONUNCIATION_DIR = path.join(DATA_DIR, "pronunciations");
const DB_PATH = path.join(DATA_DIR, "words.json");
const VERBS_PATH = path.join(DATA_DIR, "verbs.json");
const STUDY_TEXTS_PATH = path.join(DATA_DIR, "study-texts.json");
const STUDY_VIDEOS_PATH = path.join(DATA_DIR, "study-videos.json");
const NATIONAL_TESTS_PATH = path.join(DATA_DIR, "national-tests.json");
const NATIONAL_TEST_PAGES_PATH = path.join(DATA_DIR, "national-test-pages.json");
const NATIONAL_TEST_OFFICIAL_ANSWERS_PATH = path.join(DATA_DIR, "national-test-official-answers.json");
const NATIONAL_TEST_PAGE_TRANSLATIONS_PATH = path.join(DATA_DIR, "national-test-page-translations.json");
const PRACTICE_PROGRESS_PATH = path.join(DATA_DIR, "practice-progress.json");
const MERRIAM_WEBSTER_KEY_PATH = path.join(DATA_DIR, "merriam-webster-key.txt");
const MERRIAM_WEBSTER_LEARNERS_KEY_PATH = path.join(DATA_DIR, "merriam-webster-learners-key.txt");
const MERRIAM_WEBSTER_THESAURUS_KEY_PATH = path.join(DATA_DIR, "merriam-webster-thesaurus-key.txt");
const PUBLIC_DIR = path.join(__dirname, "public");
const PDFJS_DIST_DIR = path.join(__dirname, "node_modules", "pdfjs-dist");
const TESSERACT_DIST_DIR = path.join(__dirname, "node_modules", "tesseract.js", "dist");
const TESSERACT_CORE_DIR = path.join(__dirname, "node_modules", "tesseract.js-core");
const TESSERACT_ENG_DATA_DIR = path.join(__dirname, "node_modules", "@tesseract.js-data", "eng", "4.0.0");
const DOCUMENT_UNDERSTANDING_SERVICE_URL = process.env.DOCUMENT_UNDERSTANDING_SERVICE_URL || "http://127.0.0.1:8765";
const DOCUMENT_UNDERSTANDING_TIMEOUT_MS = Math.max(500, Number(process.env.DOCUMENT_UNDERSTANDING_TIMEOUT_MS) || 2500);
const DOCUMENT_UNDERSTANDING_AUTO_START = process.env.DOCUMENT_UNDERSTANDING_AUTO_START !== "0";
const DOCUMENT_UNDERSTANDING_STARTUP_TIMEOUT_MS = Math.max(1000, Number(process.env.DOCUMENT_UNDERSTANDING_STARTUP_TIMEOUT_MS) || 45000);
const DOCUMENT_UNDERSTANDING_SERVICE_SCRIPT = process.env.DOCUMENT_UNDERSTANDING_SERVICE_SCRIPT || path.join(__dirname, "services", "document_intelligence_service.py");
const DOCUMENT_UNDERSTANDING_SERVICE_PYTHON = process.env.DOCUMENT_UNDERSTANDING_SERVICE_PYTHON || path.join(__dirname, ".venv-document-intelligence", "Scripts", "python.exe");
const DOCUMENT_INTELLIGENCE_CACHE_DIR = process.env.DOCUMENT_INTELLIGENCE_CACHE_DIR || path.join(__dirname, ".cache", "document-intelligence");
const DEFAULT_REVIEW_TARGET = 10;
const DEFAULT_MAX_NEW_WORDS = 5;
const DEFAULT_PRONUNCIATION_REFERENCE = "learners";
const STUDY_TEXT_TYPES = new Set(["note", "summary", "assignment", "reflection", "vocabulary", "draft", "essay"]);
const STUDY_VIDEO_TYPES = new Set(["assignment", "presentation", "practice", "reflection", "draft"]);
const ESSAY_BODY_PARAGRAPH_MIN = 1;
const ESSAY_BODY_PARAGRAPH_MAX = 6;
const ESSAY_BODY_PARAGRAPH_FIELDS = [
  "idea",
  "sourceExample",
  "anotherReason",
  "wrapUp"
];
const ESSAY_SUPPORT_MIN = 1;
const ESSAY_SUPPORT_MAX = 6;
const ESSAY_SUPPORT_FIELDS = [
  "ownWords",
  "source",
  "comment"
];
const NATIONAL_TEST_SOURCE_NAME = "National Tests";
const NATIONAL_TEST_SECTIONS = [
  { key: "reading", name: "Reading" },
  { key: "writing", name: "Writing" },
  { key: "listening", name: "Listening" },
  { key: "speaking", name: "Speaking" }
];
const NATIONAL_TEST_SECTION_ALIASES = new Map([
  ["vocabulary", "speaking"],
  ["listining", "listening"]
]);
const LISTENING_AUDIO_EXTENSIONS = new Set([".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".webm"]);
const MERRIAM_WEBSTER_API_BASE = "https://www.dictionaryapi.com/api/v3/references";
const MERRIAM_WEBSTER_AUDIO_BASE = "https://media.merriam-webster.com/audio/prons";
const INITIAL_EASE_FACTOR = 2.5;
const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 3.0;
const MAX_STRENGTH_LEVEL = 10;
const WRONG_REVIEW_DELAY_MINUTES = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

const app = express();
let documentUnderstandingServiceProcess = null;
let documentUnderstandingServiceStartPromise = null;
let documentUnderstandingLastStartupDiagnostic = null;

await ensureStorage();
await migrateNationalTestListeningMediaStorage();
await cleanupUnreferencedListeningMediaStorage();
await removeEmptyLegacyListeningFolders();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMAGE_DIR),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase() || ".img";
      cb(null, `${Date.now()}-${randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image uploads are accepted"));
      return;
    }
    cb(null, true);
  }
});

const VIDEO_UPLOAD_LIMIT_BYTES = 1024 * 1024 * 1024;
const VIDEO_OUTPUT_MIME_TYPE = "video/mp4";
const VIDEO_OUTPUT_EXTENSION = ".mp4";

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VIDEO_DIR),
    filename: (_req, file, cb) => {
      const extension = videoExtension(file);
      cb(null, `${Date.now()}-${randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: VIDEO_UPLOAD_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isAcceptedVideoUpload(file)) {
      cb(new Error("Only video uploads are accepted"));
      return;
    }
    cb(null, true);
  }
});

const nationalTestUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      if (file.fieldname === "listeningAudio") {
        cb(null, LISTENING_UPLOAD_TMP_DIR);
        return;
      }
      if (file.fieldname === "listeningTranscript") {
        cb(null, LISTENING_UPLOAD_TMP_DIR);
        return;
      }
      cb(null, NATIONAL_TEST_DIR);
    },
    filename: (_req, file, cb) => {
      const extension = nationalTestUploadExtension(file);
      cb(null, `${Date.now()}-${randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAcceptedNationalTestUpload(file)) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF files and MP3/MP4 listening audio are accepted"));
  }
});

const studyDocumentGraphicUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, NATIONAL_TEST_PAGE_IMAGE_DIR),
    filename: (_req, file, cb) => {
      const requested = path.extname(file.originalname).toLowerCase();
      const extension = [".jpg", ".jpeg", ".png", ".webp"].includes(requested) ? requested : ".jpg";
      cb(null, `${Date.now()}-${randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Only JPG, PNG, and WebP graphic crops are accepted"));
  }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/images", express.static(IMAGE_DIR));
app.use("/videos", express.static(VIDEO_DIR));
app.use("/national-tests", express.static(NATIONAL_TEST_DIR));
app.use("/national-test-page-images", express.static(NATIONAL_TEST_PAGE_IMAGE_DIR));
app.use("/listening-media", express.static(LISTENING_MEDIA_DIR));
app.use("/vendor/pdfjs", express.static(PDFJS_DIST_DIR));
app.use("/vendor/tesseract", express.static(TESSERACT_DIST_DIR));
app.use("/vendor/tesseract-core", express.static(TESSERACT_CORE_DIR));
app.use("/vendor/tessdata", express.static(TESSERACT_ENG_DATA_DIR));
app.use("/pronunciations", express.static(PRONUNCIATION_DIR));

app.post("/api/json/repair", (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) throw httpError(400, "JSON text is required");
    if (text.length > 2_000_000) throw httpError(413, "JSON text is too large to repair");

    const normalized = stripBom(text).trim();
    const candidates = [normalized, ...repairedStoredJsonTextCandidates(normalized)];
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(candidate);
        res.json({ value, text: JSON.stringify(value, null, 2) });
        return;
      } catch {}
    }
    throw httpError(400, "The JSON structure could not be repaired safely");
  } catch (error) {
    next(error);
  }
});

app.get("/api/database", async (_req, res, next) => {
  try {
    const includeNationalTestPages = _req.query.includeNationalTestPages === "true";
    res.json(await readDatabase({ includeNationalTestPages }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/national-test-pages", async (_req, res, next) => {
  try {
    res.json({ nationalTestPages: await readNationalTestPagesWithTranslations() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/document-understanding/health", async (_req, res) => {
  res.json(await documentUnderstandingServiceHealth());
});

app.post("/api/document-understanding/analyze-page", async (req, res) => {
  const payload = sanitizeDocumentUnderstandingPayload(req.body);
  res.json(await documentUnderstandingServicePost("/analyze-page", payload));
});

app.post("/api/document-understanding/analyze-region", async (req, res) => {
  const payload = sanitizeDocumentUnderstandingPayload(req.body);
  res.json(await documentUnderstandingServicePost("/analyze-region", payload));
});

app.get("/api/listening-media-files", async (_req, res, next) => {
  try {
    res.json({
      audio: await listListeningAudioFiles(),
      transcripts: await listListeningTranscriptFiles()
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/practice/due", async (_req, res, next) => {
  try {
    const db = await readDatabase();
    const progress = await readPracticeProgress();
    const validWordIds = new Set(db.words.map(word => word.id));
    const pruned = prunePracticeProgress(progress, validWordIds);
    if (pruned) {
      await writePracticeProgress(progress);
    }

    const now = Date.now();
    const dueWordIds = Object.values(progress.words)
      .filter(record => validWordIds.has(record.wordId) && isReviewDue(record, now))
      .sort((a, b) => {
        const dueDiff = reviewTime(a) - reviewTime(b);
        return dueDiff ||
          b.mistakesCount - a.mistakesCount ||
          a.strengthLevel - b.strengthLevel ||
          a.wordId.localeCompare(b.wordId);
      })
      .map(record => record.wordId);

    res.json({ dueWordIds });
  } catch (error) {
    next(error);
  }
});

app.post("/api/review/session", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const progress = await readPracticeProgress();
    const validWordIds = new Set(db.words.map(word => word.id));
    const pruned = prunePracticeProgress(progress, validWordIds);

    let session = progress.reviewSession;
    if (session && !session.completedAt) {
      const pendingIds = pendingReviewWordIds(session, progress, validWordIds);
      if (pendingIds.length) {
        if (pruned) await writePracticeProgress(progress);
        res.json(reviewSessionResponse(session, db.words, progress, { resumed: true }));
        return;
      }

      session.completedAt = nowIso();
    }

    session = createReviewSession(db.words, progress, reviewOptions(req.body));
    progress.reviewSession = session;
    await writePracticeProgress(progress);
    res.json(session ? reviewSessionResponse(session, db.words, progress) : emptyReviewSessionResponse());
  } catch (error) {
    next(error);
  }
});

app.post("/api/review/sessions/:sessionId/complete", async (req, res, next) => {
  try {
    const sessionId = stringValue(req.params.sessionId);
    const progress = await readPracticeProgress();
    if (progress.reviewSession?.id === sessionId && !progress.reviewSession.completedAt) {
      progress.reviewSession.completedAt = nowIso();
      await writePracticeProgress(progress);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/practice/answer", async (req, res, next) => {
  try {
    const wordId = stringValue(req.body.wordId);
    if (!wordId) throw httpError(400, "Word id is required");

    const db = await readDatabase();
    if (!db.words.some(word => word.id === wordId)) {
      throw httpError(404, "Word not found");
    }

    const progress = await readPracticeProgress();
    const record = updatePracticeRecord(progress.words[wordId], wordId, Boolean(req.body.correct));
    progress.words[wordId] = record;
    await writePracticeProgress(progress);
    res.json({ record });
  } catch (error) {
    next(error);
  }
});

app.get("/api/pronunciations/status", async (_req, res, next) => {
  try {
    const apiKey = await merriamWebsterLearnersApiKey();
    const thesaurusApiKey = await merriamWebsterThesaurusApiKey();
    res.json({
      provider: "merriam-webster",
      reference: merriamWebsterReference(),
      configured: Boolean(apiKey),
      references: {
        learners: Boolean(apiKey),
        thesaurus: Boolean(thesaurusApiKey)
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/pronunciations/refresh", async (req, res, next) => {
  try {
    const apiKey = await merriamWebsterLearnersApiKey();
    if (!apiKey) {
      res.status(400).json({
        error: "Merriam-Webster API key is not configured",
        configured: false
      });
      return;
    }

    const db = await readDatabase();
    const ids = normalizeIdList(req.body.ids);
    const idSet = ids.length ? new Set(ids) : null;
    const force = Boolean(req.body.force);
    const words = db.words.filter(word => {
      if (idSet && !idSet.has(word.id)) return false;
      if (!word.word) return false;
      return force || !hasPronunciationResult(word);
    });

    const result = await refreshWordPronunciations(words, { apiKey });
    if (result.updated) {
      await writeDatabase(db);
    }
    res.json({
      configured: true,
      total: words.length,
      ...result,
      words: result.updatedWordIds.map(id => db.words.find(word => word.id === id)).filter(Boolean)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/words/:wordId/pronunciation", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const word = db.words.find(item => item.id === req.params.wordId);
    if (!word) throw httpError(404, "Word not found");

    const force = Boolean(req.body.force);
    if (!force && hasPronunciationResult(word)) {
      res.json({ configured: Boolean(await merriamWebsterLearnersApiKey()), cached: true, word, pronunciation: word.pronunciation });
      return;
    }

    const apiKey = await merriamWebsterLearnersApiKey();
    if (!apiKey) {
      res.status(400).json({
        error: "Merriam-Webster API key is not configured",
        configured: false
      });
      return;
    }

    const previousFilename = word.pronunciation?.filename || "";
    const pronunciation = await fetchAndCacheMerriamWebsterPronunciation(word, apiKey);
    if (!pronunciation) {
      throw httpError(404, "Pronunciation audio was not found");
    }

    word.pronunciation = pronunciation;
    word.updatedAt = nowIso();
    await writeDatabase(db);
    if (previousFilename && previousFilename !== pronunciation.filename) {
      await removePronunciationFile(previousFilename);
    }
    res.json({ configured: true, cached: false, word, pronunciation });
  } catch (error) {
    next(error);
  }
});

app.get("/api/lookup", async (req, res, next) => {
  try {
    const query = stringValue(req.query.word);
    if (!query) throw httpError(400, "Word is required");
    const includeThesaurus = req.query.thesaurus !== "0" && req.query.thesaurus !== "false";

    const learnersApiKey = await merriamWebsterLearnersApiKey();
    const thesaurusApiKey = await merriamWebsterThesaurusApiKey();
    if (!learnersApiKey && !thesaurusApiKey) {
      res.status(400).json({
        error: "Merriam-Webster API key is not configured",
        configured: false
      });
      return;
    }

    const reference = merriamWebsterReference();
    const [payload, thesaurusPayload] = await Promise.all([
      learnersApiKey ? fetchMerriamWebsterPayload(query, learnersApiKey, reference) : Promise.resolve([]),
      includeThesaurus && thesaurusApiKey ? fetchMerriamWebsterPayload(query, thesaurusApiKey, "thesaurus") : Promise.resolve([])
    ]);
    const lookup = lookupCandidatesFromMerriamWebster(payload, query, reference);
    const thesaurus = thesaurusEntriesFromMerriamWebster(thesaurusPayload, query);
    const candidates = enrichLookupCandidatesWithThesaurus(lookup.candidates, thesaurus);
    const suggestions = uniqueStrings([
      ...normalizeStringArray(lookup.suggestions),
      ...merriamWebsterSuggestions(thesaurusPayload)
    ]);
    res.json({
      configured: true,
      provider: "merriam-webster",
      reference,
      references: {
        learners: Boolean(learnersApiKey),
        thesaurus: Boolean(thesaurusApiKey),
        thesaurusUsed: Boolean(includeThesaurus && thesaurusApiKey)
      },
      query,
      ...lookup,
      candidates,
      suggestions,
      thesaurus
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/export", async (_req, res, next) => {
  try {
    res.download(DB_PATH, "english-words.json");
  } catch (error) {
    next(error);
  }
});

app.patch("/api/bulk/words/location", bulkMoveWords);
app.delete("/api/bulk/words", bulkDeleteWords);

app.post("/api/sources", async (req, res, next) => {
  try {
    const name = cleanName(req.body.name, "Source name is required");
    const db = await readDatabase();
    const source = { id: `source_${randomUUID()}`, name, branches: [] };
    db.sources.push(source);
    await writeDatabase(db);
    res.status(201).json(source);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/sources/:sourceId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const source = requireSource(db, req.params.sourceId);
    source.name = cleanName(req.body.name, "Source name is required");
    await writeDatabase(db);
    res.json(source);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/sources/:sourceId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const index = db.sources.findIndex(source => source.id === req.params.sourceId);
    if (index === -1) throw httpError(404, "Source not found");
    db.sources.splice(index, 1);
    const updatedAt = nowIso();
    db.words.forEach(word => {
      clearWordLocations(word, location => location.sourceId === req.params.sourceId, () => null, updatedAt);
    });
    db.studyTexts.forEach(text => {
      if (text.sourceId === req.params.sourceId) {
        text.sourceId = "";
        text.branchId = "";
        text.unitId = "";
        text.updatedAt = updatedAt;
      }
    });
    db.studyVideos.forEach(video => {
      if (video.sourceId === req.params.sourceId) {
        video.sourceId = "";
        video.branchId = "";
        video.unitId = "";
        video.updatedAt = updatedAt;
      }
    });
    db.nationalTests.forEach(test => {
      clearNationalTestLocations(
        test,
        location => location.sourceId === req.params.sourceId,
        () => null,
        updatedAt
      );
    });
    await writeDatabase(db);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sources/:sourceId/branches", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const source = requireSource(db, req.params.sourceId);
    const branch = { id: `branch_${randomUUID()}`, name: cleanName(req.body.name, "Unit name is required"), units: [] };
    source.branches.push(branch);
    await writeDatabase(db);
    res.status(201).json(branch);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/sources/:sourceId/branches/:branchId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const branch = requireBranch(db, req.params.sourceId, req.params.branchId);
    branch.name = cleanName(req.body.name, "Unit name is required");
    await writeDatabase(db);
    res.json(branch);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/sources/:sourceId/branches/:branchId/location", async (req, res, next) => {
  try {
    const targetSourceId = stringValue(req.body.sourceId);
    if (!targetSourceId) throw httpError(400, "Target source is required");
    if (targetSourceId === req.params.sourceId) throw httpError(400, "Unit is already under that source");

    const db = await readDatabase();
    const source = requireSource(db, req.params.sourceId);
    const targetSource = requireSource(db, targetSourceId);
    const branchIndex = source.branches.findIndex(branch => branch.id === req.params.branchId);
    if (branchIndex === -1) throw httpError(404, "Unit not found");
    if (targetSource.branches.some(branch => branch.id === req.params.branchId)) {
      throw httpError(400, "Target source already has this unit");
    }

    const [branch] = source.branches.splice(branchIndex, 1);
    targetSource.branches.push(branch);

    const updatedAt = nowIso();
    db.words.forEach(word => {
      clearWordLocations(
        word,
        location => location.sourceId === req.params.sourceId && location.branchId === req.params.branchId,
        location => ({ sourceId: targetSourceId, branchId: location.branchId, unitId: location.unitId }),
        updatedAt
      );
    });
    db.studyTexts.forEach(text => {
      if (text.sourceId === req.params.sourceId && text.branchId === req.params.branchId) {
        text.sourceId = targetSourceId;
        text.updatedAt = updatedAt;
      }
    });
    db.studyVideos.forEach(video => {
      if (video.sourceId === req.params.sourceId && video.branchId === req.params.branchId) {
        video.sourceId = targetSourceId;
        video.updatedAt = updatedAt;
      }
    });
    db.nationalTests.forEach(test => {
      clearNationalTestLocations(
        test,
        location => location.sourceId === req.params.sourceId && location.branchId === req.params.branchId,
        location => ({ sourceId: targetSourceId, branchId: location.branchId, unitId: location.unitId }),
        updatedAt
      );
    });

    await writeDatabase(db);
    res.json({ branch, sourceId: targetSourceId });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/sources/:sourceId/branches/:branchId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const source = requireSource(db, req.params.sourceId);
    const index = source.branches.findIndex(branch => branch.id === req.params.branchId);
    if (index === -1) throw httpError(404, "Unit not found");
    source.branches.splice(index, 1);
    const updatedAt = nowIso();
    db.words.forEach(word => {
      clearWordLocations(
        word,
        location => location.sourceId === req.params.sourceId && location.branchId === req.params.branchId,
        location => ({ sourceId: location.sourceId, branchId: "", unitId: "" }),
        updatedAt
      );
    });
    db.studyTexts.forEach(text => {
      if (text.sourceId === req.params.sourceId && text.branchId === req.params.branchId) {
        text.branchId = "";
        text.unitId = "";
        text.updatedAt = updatedAt;
      }
    });
    db.studyVideos.forEach(video => {
      if (video.sourceId === req.params.sourceId && video.branchId === req.params.branchId) {
        video.branchId = "";
        video.unitId = "";
        video.updatedAt = updatedAt;
      }
    });
    db.nationalTests.forEach(test => {
      clearNationalTestLocations(
        test,
        location => location.sourceId === req.params.sourceId && location.branchId === req.params.branchId,
        location => ({ sourceId: location.sourceId, branchId: "", unitId: "" }),
        updatedAt
      );
    });
    await writeDatabase(db);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sources/:sourceId/branches/:branchId/units", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const branch = requireBranch(db, req.params.sourceId, req.params.branchId);
    const unit = { id: `unit_${randomUUID()}`, name: cleanName(req.body.name, "Topic name is required") };
    branch.units.push(unit);
    await writeDatabase(db);
    res.status(201).json(unit);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/sources/:sourceId/branches/:branchId/units/:unitId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const unit = requireUnit(db, req.params.sourceId, req.params.branchId, req.params.unitId);
    unit.name = cleanName(req.body.name, "Topic name is required");
    await writeDatabase(db);
    res.json(unit);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/sources/:sourceId/branches/:branchId/units/:unitId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const branch = requireBranch(db, req.params.sourceId, req.params.branchId);
    const index = branch.units.findIndex(unit => unit.id === req.params.unitId);
    if (index === -1) throw httpError(404, "Topic not found");
    branch.units.splice(index, 1);
    const updatedAt = nowIso();
    db.words.forEach(word => {
      clearWordLocations(
        word,
        location => location.sourceId === req.params.sourceId &&
          location.branchId === req.params.branchId &&
          location.unitId === req.params.unitId,
        location => ({ sourceId: location.sourceId, branchId: location.branchId, unitId: "" }),
        updatedAt
      );
    });
    db.studyTexts.forEach(text => {
      if (text.sourceId === req.params.sourceId && text.branchId === req.params.branchId && text.unitId === req.params.unitId) {
        text.unitId = "";
        text.updatedAt = updatedAt;
      }
    });
    db.studyVideos.forEach(video => {
      if (video.sourceId === req.params.sourceId && video.branchId === req.params.branchId && video.unitId === req.params.unitId) {
        video.unitId = "";
        video.updatedAt = updatedAt;
      }
    });
    db.nationalTests.forEach(test => {
      clearNationalTestLocations(
        test,
        location => location.sourceId === req.params.sourceId &&
          location.branchId === req.params.branchId &&
          location.unitId === req.params.unitId,
        location => ({ sourceId: location.sourceId, branchId: location.branchId, unitId: "" }),
        updatedAt
      );
    });
    await writeDatabase(db);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/study-texts", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const createdAt = nowIso();
    const text = normalizeStudyText(req.body, db, { createdAt });
    db.studyTexts.push(text);
    await writeDatabase(db);
    res.status(201).json(text);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/study-texts/:textId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const existing = db.studyTexts.find(text => text.id === req.params.textId);
    if (!existing) throw httpError(404, "Study text not found");

    const updated = normalizeStudyText(req.body, db, {
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    });
    Object.assign(existing, updated);
    await writeDatabase(db);
    res.json(existing);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/study-texts/:textId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const index = db.studyTexts.findIndex(text => text.id === req.params.textId);
    if (index === -1) throw httpError(404, "Study text not found");
    db.studyTexts.splice(index, 1);
    await writeDatabase(db);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/study-videos", videoUpload.single("video"), async (req, res, next) => {
  let preparedVideo = null;
  try {
    if (!req.file) throw httpError(400, "Video file is required");
    const db = await readDatabase();
    const createdAt = nowIso();
    const body = studyVideoRequestBody(req);
    const title = cleanName(body.title, "Study video title is required");
    const targetFilename = await uniqueTitleVideoFilename(title, db.studyVideos);
    preparedVideo = await prepareVideoUpload(req.file, targetFilename);
    const video = normalizeStudyVideo(body, db, { createdAt, video: videoRecord(preparedVideo) });
    db.studyVideos.push(video);
    await writeDatabase(db);
    res.status(201).json(video);
  } catch (error) {
    await removeUploadedVideo(preparedVideo?.filename || req.file?.filename);
    next(error);
  }
});

app.patch("/api/study-videos/:videoId", videoUpload.single("video"), async (req, res, next) => {
  let preparedVideo = null;
  try {
    const db = await readDatabase();
    const existing = db.studyVideos.find(video => video.id === req.params.videoId);
    if (!existing) throw httpError(404, "Study video not found");

    const body = studyVideoRequestBody(req);
    const title = cleanName(body.title, "Study video title is required");
    const previousFilename = existing.video?.filename || "";
    const targetFilename = req.file
      ? await uniqueTitleVideoFilename(title, db.studyVideos, { excludeVideoId: existing.id })
      : "";
    preparedVideo = req.file ? await prepareVideoUpload(req.file, targetFilename) : null;
    const replacementVideo = preparedVideo ? videoRecord(preparedVideo) : existing.video;
    const updated = normalizeStudyVideo(body, db, {
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
      video: replacementVideo
    });
    if (!preparedVideo) {
      updated.video = await retitleExistingVideo(updated.video, updated.title, db.studyVideos, existing.id);
    }
    Object.assign(existing, updated);
    await writeDatabase(db);
    if (req.file && previousFilename && previousFilename !== existing.video?.filename) {
      await removeUploadedVideo(previousFilename);
    }
    res.json(existing);
  } catch (error) {
    await removeUploadedVideo(preparedVideo?.filename || req.file?.filename);
    next(error);
  }
});

app.delete("/api/study-videos/:videoId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const index = db.studyVideos.findIndex(video => video.id === req.params.videoId);
    if (index === -1) throw httpError(404, "Study video not found");
    const [video] = db.studyVideos.splice(index, 1);
    await writeDatabase(db);
    if (video.video?.filename) {
      await removeUploadedVideo(video.video.filename);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/national-tests", nationalTestUpload.fields([
  { name: "pdf", maxCount: 1 },
  { name: "listeningAudio", maxCount: 1 },
  { name: "listeningTranscript", maxCount: 1 }
]), async (req, res, next) => {
  const movedListeningFiles = [];
  try {
    const pdfFile = uploadedFiles(req, ["pdf"])[0];
    const audioFile = uploadedFiles(req, ["listeningAudio"])[0];
    const transcriptFile = uploadedFiles(req, ["listeningTranscript"])[0];
    if (!pdfFile) throw httpError(400, "PDF test file is required");
    const db = await readDatabase();
    const tests = await readNationalTests();
    const createdAt = nowIso();
    const title = cleanName(req.body.title, "Test title is required");
    const location = ensureNationalTestLocation(db, title);
    const test = normalizeNationalTest({
      title,
      course: req.body.course,
      term: req.body.term,
      year: req.body.year,
      description: req.body.description,
      sourceId: location.sourceId,
      branchId: location.branchId,
      sections: location.sections,
      pdf: nationalTestPdfRecord(pdfFile),
      listeningMedia: normalizeNationalTestListeningMedia()
    }, { createdAt });
    const rootTopic = { key: "general", label: "General" };
    const rootAudio = audioFile
      ? await listeningAudioRecordFromOrganizedUpload(audioFile, { test, topic: rootTopic, mediaGroupId: "General" })
      : null;
    const rootTranscript = transcriptFile
      ? await listeningTranscriptRecordFromOrganizedUpload(transcriptFile, { test, topic: rootTopic, mediaGroupId: "General" })
      : null;
    if (rootAudio?.filename) movedListeningFiles.push({ kind: "audio", filename: rootAudio.filename });
    if (rootTranscript?.filename) movedListeningFiles.push({ kind: "transcript", filename: rootTranscript.filename });
    test.listeningMedia = normalizeNationalTestListeningMedia({ audio: rootAudio, transcript: rootTranscript });
    tests.push(test);
    await writeDatabase(db);
    await writeNationalTests(tests);
    res.status(201).json(test);
  } catch (error) {
    await removeNationalTestUploadFiles(req);
    await Promise.all(movedListeningFiles.map(file => (
      file.kind === "audio"
        ? removeListeningAudioFile(file.filename)
        : removeListeningTranscriptFile(file.filename)
    )));
    next(error);
  }
});

app.patch("/api/national-tests/:testId", async (req, res, next) => {
  try {
    const tests = await readNationalTests();
    const test = tests.find(item => item.id === req.params.testId);
    if (!test) throw httpError(404, "National test not found");

    const updates = req.body || {};
    const previousTitle = test.title;
    const updatedAt = nowIso();
    let contentChanged = false;

    if (Object.prototype.hasOwnProperty.call(updates, "title")) {
      test.title = cleanName(updates.title, "Test title is required");
      contentChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "course")) {
      test.course = stringValue(updates.course);
      contentChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "term")) {
      test.term = stringValue(updates.term);
      contentChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "year")) {
      test.year = stringValue(updates.year);
      contentChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "description")) {
      test.description = stringValue(updates.description);
      contentChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "locked")) {
      if (updates.locked) {
        test.lockedAt = test.lockedAt || updatedAt;
      } else {
        delete test.lockedAt;
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "finished")) {
      if (updates.finished) {
        test.finishedAt = test.finishedAt || updatedAt;
      } else {
        delete test.finishedAt;
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "ready")) {
      if (updates.ready) {
        test.readyAt = test.readyAt || updatedAt;
      } else {
        delete test.readyAt;
      }
    }
    if (contentChanged) {
      test.updatedAt = updatedAt;
    }

    if (test.title !== previousTitle && test.sourceId && test.branchId) {
      const db = await readDatabase();
      const source = db.sources.find(item => item.id === test.sourceId);
      const branch = source?.branches?.find(item => item.id === test.branchId);
      if (branch) {
        branch.name = test.title;
        await writeDatabase(db);
      }
    }

    await writeNationalTests(tests);
    res.json(test);
  } catch (error) {
    next(error);
  }
});

app.post("/api/national-tests/:testId/listening-media", nationalTestUpload.fields([
  { name: "listeningAudio", maxCount: 1 },
  { name: "listeningTranscript", maxCount: 1 }
]), async (req, res, next) => {
  const movedListeningFiles = [];
  try {
    const audioFile = uploadedFiles(req, ["listeningAudio"])[0];
    const transcriptFile = uploadedFiles(req, ["listeningTranscript"])[0];

    const tests = await readNationalTests();
    const test = tests.find(item => item.id === req.params.testId);
    if (!test) throw httpError(404, "National test not found");

    const topic = nationalTestListeningMediaTopicFromBody(req.body);
    const selectedPageIds = normalizeListeningMediaPageIds(req.body.pageIds);
    const storageTopic = topic || { key: "general", label: "General" };
    const mediaGroupId = stringValue(req.body?.mediaGroupId) || (topic
      ? await listeningMediaGroupIdForSelectedPages(test, topic, selectedPageIds, req.body.pageLabels)
      : "General");
    const uploadedAudio = audioFile
      ? await listeningAudioRecordFromOrganizedUpload(audioFile, { test, topic: storageTopic, mediaGroupId })
      : null;
    const uploadedTranscript = transcriptFile
      ? await listeningTranscriptRecordFromOrganizedUpload(transcriptFile, { test, topic: storageTopic, mediaGroupId })
      : null;
    if (uploadedAudio?.filename) movedListeningFiles.push({ kind: "audio", filename: uploadedAudio.filename });
    if (uploadedTranscript?.filename) movedListeningFiles.push({ kind: "transcript", filename: uploadedTranscript.filename });
    const existingAudio = uploadedAudio ? null : await listeningAudioRecordFromFilename(req.body?.audioFilename);
    const existingTranscript = uploadedTranscript ? null : await listeningTranscriptRecordFromFilename(req.body?.transcriptFilename);
    const previousMedia = topic
      ? nationalTestListeningTopicMedia(test.listeningMedia, topic.key)
      : test.listeningMedia || {};
    const previousGroupById = topic
      ? nationalTestListeningTopicMediaGroup(test.listeningMedia, topic.key, mediaGroupId)
      : {};
    const previousGroupByPages = topic && !previousGroupHasFiles(previousGroupById)
      ? nationalTestListeningTopicMediaGroupByPages(test.listeningMedia, topic.key, selectedPageIds)
      : {};
    const previousGroup = topic
      ? previousGroupHasFiles(previousGroupById) ? previousGroupById : previousGroupByPages || {}
      : previousMedia;
    if (!uploadedAudio && !uploadedTranscript && !existingAudio && !existingTranscript && !previousGroup.audio && !previousGroup.transcript) {
      throw httpError(400, "Choose listening audio or transcript PDF first");
    }
    const nextMedia = {
      groupId: mediaGroupId,
      audio: uploadedAudio || existingAudio || previousGroup.audio,
      transcript: uploadedTranscript || existingTranscript || previousGroup.transcript,
      pageIds: selectedPageIds
    };
    test.listeningMedia = topic
      ? upsertNationalTestListeningTopicMedia(test.listeningMedia, topic, nextMedia)
      : normalizeNationalTestListeningMedia({ ...test.listeningMedia, ...nextMedia });
    test.updatedAt = nowIso();
    await writeNationalTests(tests);
    await cleanupUnreferencedListeningMediaStorage(tests);

    res.json(test);
  } catch (error) {
    await removeNationalTestUploadFiles(req);
    await Promise.all(movedListeningFiles.map(file => (
      file.kind === "audio"
        ? removeListeningAudioFile(file.filename)
        : removeListeningTranscriptFile(file.filename)
    )));
    next(error);
  }
});

app.delete("/api/national-tests/:testId/listening-media/:kind", async (req, res, next) => {
  try {
    const tests = await readNationalTests();
    const test = tests.find(item => item.id === req.params.testId);
    if (!test) throw httpError(404, "National test not found");
    const kind = stringValue(req.params.kind).toLocaleLowerCase();
    const topic = nationalTestListeningMediaTopicFromBody(req.query);
    const mediaGroupId = stringValue(req.query?.mediaGroupId);
    const previousMedia = topic
      ? nationalTestListeningTopicMedia(test.listeningMedia, topic.key)
      : test.listeningMedia || {};
    const previousGroup = topic && mediaGroupId
      ? nationalTestListeningTopicMediaGroup(test.listeningMedia, topic.key, mediaGroupId)
      : previousMedia;
    if (kind !== "audio" && kind !== "transcript" && kind !== "all") {
      throw httpError(400, "Unknown listening media type");
    }

    const nextMedia = {
      groupId: mediaGroupId,
      audio: kind === "audio" || kind === "all" ? null : previousGroup.audio,
      transcript: kind === "transcript" || kind === "all" ? null : previousGroup.transcript,
      pageIds: previousGroup.pageIds || []
    };
    test.listeningMedia = topic
      ? upsertNationalTestListeningTopicMedia(test.listeningMedia, topic, nextMedia)
      : normalizeNationalTestListeningMedia({ ...test.listeningMedia, ...nextMedia });
    test.updatedAt = nowIso();
    await writeNationalTests(tests);
    await removeDeletedListeningMediaFiles(previousGroup, kind);
    if (topic && mediaGroupId && kind === "all") {
      await removeListeningMediaGroupDirectory(previousGroup);
    }
    await cleanupUnreferencedListeningMediaStorage(tests);

    res.json(test);
  } catch (error) {
    next(error);
  }
});

app.post("/api/national-tests/:testId/pages/reorder", async (req, res, next) => {
  try {
    const tests = await readNationalTests();
    if (!tests.some(test => test.id === req.params.testId)) {
      throw httpError(404, "National test not found");
    }

    const pageIds = normalizeIdList(req.body?.pageIds);
    const pages = await readNationalTestPages();
    const testPages = pages
      .filter(page => page.testId === req.params.testId)
      .sort(compareNationalTestPages);
    if (!testPages.length) {
      throw httpError(404, "No pages found for this national test");
    }

    if (pageIds.length !== testPages.length) {
      throw httpError(400, "Reorder request must include every page for the test");
    }

    const pageById = new Map(testPages.map(page => [page.id, page]));
    if (pageIds.some(pageId => !pageById.has(pageId))) {
      throw httpError(400, "Reorder request includes a page outside this test");
    }

    const updatedAt = nowIso();
    const reorderedPages = pageIds.map((pageId, index) => {
      const page = pageById.get(pageId);
      page.sortOrder = index + 1;
      page.updatedAt = updatedAt;
      return page;
    });

    await writeNationalTestPages(pages);
    res.json({ pages: reorderedPages });
  } catch (error) {
    next(error);
  }
});

app.post("/api/national-tests/:testId/pages/group", async (req, res, next) => {
  try {
    const tests = await readNationalTests();
    if (!tests.some(test => test.id === req.params.testId)) {
      throw httpError(404, "National test not found");
    }

    const section = normalizeNationalTestPageSection(req.body?.section);
    if (!NATIONAL_TEST_SECTIONS.some(item => item.key === section)) {
      throw httpError(400, "A valid skill type is required");
    }

    const topic = normalizeNationalTestPageTopic(req.body?.topic);
    if (!topic) {
      throw httpError(400, "A topic name is required");
    }

    const pageIds = normalizeIdList(req.body?.pageIds);
    if (!pageIds.length) {
      throw httpError(400, "At least one page is required");
    }

    const orderedPageIds = normalizeIdList(req.body?.orderedPageIds);
    const pages = await readNationalTestPages();
    const testPages = pages
      .filter(page => page.testId === req.params.testId)
      .sort(compareNationalTestPages);
    if (!testPages.length) {
      throw httpError(404, "No pages found for this national test");
    }
    if (orderedPageIds.length !== testPages.length) {
      throw httpError(400, "Group request must include every page for the test");
    }

    const pageById = new Map(testPages.map(page => [page.id, page]));
    if (pageIds.some(pageId => !pageById.has(pageId))) {
      throw httpError(400, "Group request includes a page outside this test");
    }
    if (orderedPageIds.some(pageId => !pageById.has(pageId))) {
      throw httpError(400, "Order request includes a page outside this test");
    }

    const updatedAt = nowIso();
    pageIds.forEach(pageId => {
      const page = pageById.get(pageId);
      page.section = section;
      page.topic = topic;
      page.updatedAt = updatedAt;
    });

    const orderedPages = orderedPageIds.map((pageId, index) => {
      const page = pageById.get(pageId);
      page.sortOrder = index + 1;
      page.updatedAt = updatedAt;
      return page;
    });

    await writeNationalTestPages(pages);
    res.json({ pages: orderedPages });
  } catch (error) {
    next(error);
  }
});

app.post("/api/national-tests/:testId/sections/:section/finished", async (req, res, next) => {
  try {
    const tests = await readNationalTests();
    if (!tests.some(test => test.id === req.params.testId)) {
      throw httpError(404, "National test not found");
    }

    const section = normalizeNationalTestPageSection(req.params.section);
    if (!NATIONAL_TEST_SECTIONS.some(item => item.key === section)) {
      throw httpError(400, "A valid skill type is required");
    }

    const pages = await readNationalTestPages();
    const testPages = pages.filter(page =>
      page.testId === req.params.testId &&
      (normalizeNationalTestPageSection(page.section) || inferNationalTestPageSectionFromTitle(page.title)) === section
    );
    if (!testPages.length) {
      throw httpError(404, "No pages found for this skill");
    }

    const finished = req.body?.finished !== false;
    const updatedAt = nowIso();
    testPages.forEach(page => {
      if (finished) {
        page.finishedAt = updatedAt;
      } else {
        delete page.finishedAt;
      }
      page.updatedAt = updatedAt;
    });

    await writeNationalTestPages(pages);
    res.json({ pages: testPages });
  } catch (error) {
    next(error);
  }
});

app.post("/api/national-tests/:testId/sections/:section/locked", async (req, res, next) => {
  try {
    const tests = await readNationalTests();
    if (!tests.some(test => test.id === req.params.testId)) {
      throw httpError(404, "National test not found");
    }

    const section = normalizeNationalTestPageSection(req.params.section);
    if (!NATIONAL_TEST_SECTIONS.some(item => item.key === section)) {
      throw httpError(400, "A valid skill type is required");
    }

    const pages = await readNationalTestPages();
    const testPages = pages.filter(page =>
      page.testId === req.params.testId &&
      (normalizeNationalTestPageSection(page.section) || inferNationalTestPageSectionFromTitle(page.title)) === section
    );
    if (!testPages.length) {
      throw httpError(404, "No pages found for this skill");
    }

    const locked = req.body?.locked !== false;
    const updatedAt = nowIso();
    testPages.forEach(page => {
      if (locked) {
        page.lockedAt = page.lockedAt || updatedAt;
      } else {
        delete page.lockedAt;
      }
      page.updatedAt = updatedAt;
    });

    await writeNationalTestPages(pages);
    res.json({ pages: testPages });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/national-test-pages/:pageId/study-document-graphics/:nodeId",
  studyDocumentGraphicUpload.single("image"),
  async (req, res, next) => {
    let pageWasSaved = false;
    try {
      const pages = await readNationalTestPages();
      const page = pages.find(item => item.id === req.params.pageId);
      if (!page) throw httpError(404, "National test page not found");
      if (!validateStudyDocumentV1(page.studyDocument).valid) {
        throw httpError(400, "A valid study-document/v1 is required before attaching a graphic");
      }
      if (!validateStudyDocumentPageBinding(page.studyDocument, page).valid) {
        throw httpError(400, "The study document does not belong to this page");
      }
      const node = studyDocumentNodeById(page.studyDocument, req.params.nodeId);
      if (!node || node.type !== "graphic") throw httpError(404, "Study document graphic node not found");
      if (!req.file) throw httpError(400, "A cropped graphic image is required");
      const crop = normalizedStudyDocumentGraphicCrop(req.body?.crop);
      if (!crop) throw httpError(400, "A valid normalized crop is required");

      const previousAssetId = stringValue(node.assetId);
      const assetId = previousAssetId || `study-graphic-${node.id}`;
      const previousAsset = (Array.isArray(page.sourceImages) ? page.sourceImages : [])
        .find(item => item.id === assetId);
      const asset = {
        id: assetId,
        kind: "study-document-graphic",
        nodeId: node.id,
        crop,
        accepted: true,
        filename: req.file.filename,
        url: `/national-test-page-images/${req.file.filename}`,
        mimeType: req.file.mimetype,
        size: req.file.size,
        sourcePageIndex: Math.max(0, Number(page.studyDocument.source?.sourcePageIndex) || 0),
        pixelWidth: positiveInteger(req.body?.pixelWidth),
        pixelHeight: positiveInteger(req.body?.pixelHeight)
      };
      node.assetId = assetId;
      node.placeholder = false;
      if (asset.pixelWidth && asset.pixelHeight) {
        node.aspectRatio = asset.pixelWidth / asset.pixelHeight;
      }
      page.sourceImages = [
        ...(Array.isArray(page.sourceImages) ? page.sourceImages : []).filter(item => item.id !== assetId),
        asset
      ];
      page.updatedAt = nowIso();

      const documentValidation = validateStudyDocumentV1(page.studyDocument);
      if (!documentValidation.valid) {
        const firstError = documentValidation.errors[0];
        throw httpError(400, `Invalid study-document/v1 at ${firstError.path}: ${firstError.message}`);
      }
      await writeNationalTestPages(pages);
      pageWasSaved = true;
      if (previousAsset?.filename && previousAsset.filename !== req.file.filename) {
        await rm(path.join(NATIONAL_TEST_PAGE_IMAGE_DIR, path.basename(previousAsset.filename)), { force: true }).catch(() => {});
      }
      const translationStore = await readNationalTestPageTranslations();
      res.status(201).json(nationalTestPageWithStoredTranslations(page, translationStore));
    } catch (error) {
      if (!pageWasSaved && req.file?.path) await rm(req.file.path, { force: true }).catch(() => {});
      next(error);
    }
  }
);

app.delete("/api/national-test-pages/:pageId/study-document-graphics/:nodeId", async (req, res, next) => {
  try {
    const pages = await readNationalTestPages();
    const page = pages.find(item => item.id === req.params.pageId);
    if (!page) throw httpError(404, "National test page not found");
    if (!validateStudyDocumentV1(page.studyDocument).valid) {
      throw httpError(400, "A valid study-document/v1 is required before removing a graphic");
    }
    if (!validateStudyDocumentPageBinding(page.studyDocument, page).valid) {
      throw httpError(400, "The study document does not belong to this page");
    }
    const node = studyDocumentNodeById(page.studyDocument, req.params.nodeId);
    if (!node || node.type !== "graphic") throw httpError(404, "Study document graphic node not found");
    const assetId = stringValue(node.assetId);
    const asset = (Array.isArray(page.sourceImages) ? page.sourceImages : [])
      .find(item => item.id === assetId);
    node.assetId = null;
    node.placeholder = true;
    page.sourceImages = (Array.isArray(page.sourceImages) ? page.sourceImages : [])
      .filter(item => item.id !== assetId);
    page.updatedAt = nowIso();
    await writeNationalTestPages(pages);
    if (asset?.filename) {
      await rm(path.join(NATIONAL_TEST_PAGE_IMAGE_DIR, path.basename(asset.filename)), { force: true }).catch(() => {});
    }
    const translationStore = await readNationalTestPageTranslations();
    res.json(nationalTestPageWithStoredTranslations(page, translationStore));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/national-test-pages/:pageId", async (req, res, next) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "studyDocument") && req.body.studyDocument !== null) {
      const studyDocumentValidation = validateStudyDocumentV1(req.body.studyDocument);
      if (!studyDocumentValidation.valid) {
        const firstError = studyDocumentValidation.errors[0];
        throw httpError(400, `Invalid study-document/v1 at ${firstError?.path || "$"}: ${firstError?.message || "Validation failed."}`);
      }
    }
    const pages = await readNationalTestPages();
    const translationStore = await readNationalTestPageTranslations();
    const existing = pages.find(page => page.id === req.params.pageId);
    if (!existing) throw httpError(404, "National test page not found");
    const studyDocumentWasSubmitted = Object.prototype.hasOwnProperty.call(req.body || {}, "studyDocument");
    const studyDocumentChanged = studyDocumentWasSubmitted && !isDeepStrictEqual(
      req.body.studyDocument ?? null,
      existing.studyDocument ?? null
    );
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "studyDocument") && req.body.studyDocument !== null) {
      const pageBinding = validateStudyDocumentPageBinding(req.body.studyDocument, existing);
      if (!pageBinding.valid) {
        const firstError = pageBinding.errors[0];
        throw httpError(400, `Study document does not belong to this page at ${firstError.path}: ${firstError.message}`);
      }
      const answerMapping = validateOfficialStudyDocumentAnswerMapping(req.body.studyDocument, existing.questions);
      if (!answerMapping.valid) {
        throw httpError(400, answerMapping.errors[0].message);
      }
    }
    const submittedStudyTranslation = req.body?.translations?.ar?.studyDocumentTranslation;
    let validSubmittedStudyTranslation = false;
    if (submittedStudyTranslation) {
      const effectiveStudyDocument = req.body.studyDocument || existing.studyDocument;
      if (!effectiveStudyDocument) {
        if (!studyDocumentChanged) {
          throw httpError(400, "A study document is required before importing its Arabic translation.");
        }
      } else {
        const officialAnswers = officialStudyDocumentAnswers(effectiveStudyDocument, existing.questions);
        const translationValidation = validateStudyDocumentTranslationV1(
          submittedStudyTranslation,
          effectiveStudyDocument,
          officialAnswers
        );
        if (translationValidation.valid) {
          validSubmittedStudyTranslation = true;
        } else if (!studyDocumentChanged) {
          const firstError = translationValidation.errors[0];
          throw httpError(400, `Invalid study-document Arabic translation at ${firstError.path}: ${firstError.message}`);
        }
      }
    }
    const existingWithTranslations = nationalTestPageWithStoredTranslations(existing, translationStore);

    const updated = normalizeNationalTestPage({
      ...existingWithTranslations,
      ...req.body,
      id: existing.id,
      testId: existing.testId,
      pageNumber: existing.pageNumber,
      pagePart: existing.pagePart,
      createdAt: existing.createdAt
    }, {
      id: existing.id,
      createdAt: existing.createdAt,
      pagePart: existing.pagePart,
      updatedAt: nowIso()
    });
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "translations")) {
      const rawTranslations = req.body.translations && typeof req.body.translations === "object" && !Array.isArray(req.body.translations)
        ? req.body.translations
        : {};
      const submittedTranslationLanguages = Object.keys(rawTranslations);
      const translationLanguagesToDelete = submittedTranslationLanguages
        .filter(language => rawTranslations[language] === null)
        .map(normalizeTranslationLanguage);
      const updatedTranslations = normalizeNationalTestPageTranslations(req.body.translations);
      let nextTranslations = submittedTranslationLanguages.length
        ? mergeNationalTestPageTranslationsPreservingLayouts(
          translationStore[existing.id],
          updatedTranslations
        )
        : {};
      translationLanguagesToDelete.forEach(language => delete nextTranslations[language]);
      if (Object.keys(nextTranslations).length) {
        translationStore[existing.id] = nextTranslations;
      } else {
        delete translationStore[existing.id];
      }
    }
    if (studyDocumentChanged && !validSubmittedStudyTranslation) {
      const nextTranslations = translationStore[existing.id];
      if (nextTranslations?.ar) delete nextTranslations.ar;
      if (nextTranslations && !Object.keys(nextTranslations).length) delete translationStore[existing.id];
    }
    delete updated.translations;
    Object.assign(existing, updated);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "answers") && !updated.answers) {
      delete existing.answers;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "questions") && !updated.questions) {
      delete existing.questions;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "words") && !updated.words) {
      delete existing.words;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "sourceImages") && !updated.sourceImages) {
      delete existing.sourceImages;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "pageLayout") && !updated.pageLayout) {
      delete existing.pageLayout;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "sourceContainer") && !updated.sourceContainer) {
      delete existing.sourceContainer;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "englishExtraction") && !updated.englishExtraction) {
      delete existing.englishExtraction;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "studyDocument") && !updated.studyDocument) {
      delete existing.studyDocument;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "topic") && !updated.topic) {
      delete existing.topic;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "section") && !updated.section) {
      delete existing.section;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "finishedAt") && !updated.finishedAt) {
      delete existing.finishedAt;
    }
    await writeNationalTestPages(pages);
    await writeNationalTestPageTranslations(translationStore);
    res.json(nationalTestPageWithStoredTranslations(existing, translationStore));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/national-test-pages/:pageId", async (req, res, next) => {
  try {
    const pages = await readNationalTestPages();
    const index = pages.findIndex(page => page.id === req.params.pageId);
    if (index === -1) throw httpError(404, "National test page not found");
    pages.splice(index, 1);
    await writeNationalTestPages(pages);
    const translationStore = await readNationalTestPageTranslations();
    if (translationStore[req.params.pageId]) {
      delete translationStore[req.params.pageId];
      await writeNationalTestPageTranslations(translationStore);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/national-tests/:testId", async (req, res, next) => {
  try {
    const tests = await readNationalTests();
    const index = tests.findIndex(test => test.id === req.params.testId);
    if (index === -1) throw httpError(404, "National test not found");
    const [test] = tests.splice(index, 1);
    await writeNationalTests(tests);
    const pages = await readNationalTestPages();
    const removedPageIds = new Set(pages.filter(page => page.testId === test.id).map(page => page.id));
    await writeNationalTestPages(pages.filter(page => page.testId !== test.id));
    const translationStore = await readNationalTestPageTranslations();
    let translationsChanged = false;
    removedPageIds.forEach(pageId => {
      if (translationStore[pageId]) {
        delete translationStore[pageId];
        translationsChanged = true;
      }
    });
    if (translationsChanged) {
      await writeNationalTestPageTranslations(translationStore);
    }
    if (test.pdf?.filename) {
      await removeNationalTestFile(test.pdf.filename);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/national-tests/:testId/lookup-words", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const test = db.nationalTests.find(item => item.id === req.params.testId);
    if (!test) throw httpError(404, "National test not found");

    const source = ensureSourceByName(db, cleanName(test.title, "National test title is required"));
    const lookupWord = normalizeLookupCandidateWord(req.body);
    const createdAt = nowIso();
    const word = normalizeWord({
      ...lookupWord,
      sourceId: source.id,
      branchId: "",
      unitId: ""
    }, {}, db, { createdAt });

    const existing = findWordByKey(db.words, word.word);
    const alreadyLinked = existing
      ? wordLocations(existing).some(location => location.sourceId === source.id)
      : false;

    let saved = word;
    let created = true;
    if (existing) {
      mergeWordIntoCanonical(existing, word, { preserveExistingText: true });
      saved = existing;
      created = false;
    } else {
      db.words.push(word);
    }

    await enrichWordsWithPronunciations([saved]);
    await writeDatabase(db);
    res.status(created ? 201 : 200).json({ word: saved, source, created, alreadyLinked });
  } catch (error) {
    next(error);
  }
});

app.post("/api/words", upload.fields([
  { name: "image", maxCount: 1 },
  { name: "images", maxCount: 100 }
]), async (req, res, next) => {
  try {
    const db = await readDatabase();
    const { items, location, imageIndexes } = parseWordRequest(req);
    const imageFiles = uploadedFiles(req, ["image", "images"]);
    const imagesByWordIndex = assignImagesToWords(imageFiles, items.length, imageIndexes);
    const createdAt = nowIso();
    const unusedImageFilenames = [];
    const changedWords = [];
    const created = items.map((item, index) => {
      const image = imagesByWordIndex.has(index) ? imageRecord(imagesByWordIndex.get(index)) : null;
      const word = normalizeWord(item, location, db, { createdAt, image });
      const existing = findWordByKey(db.words, word.word);
      if (existing) {
        const mergeResult = mergeWordIntoCanonical(existing, word, { preserveExistingText: true });
        unusedImageFilenames.push(...mergeResult.unusedImageFilenames);
        if (mergeResult.changed) changedWords.push(existing);
        return existing;
      }
      db.words.push(word);
      changedWords.push(word);
      return word;
    });
    await enrichWordsWithPronunciations(changedWords);
    await writeDatabase(db);
    await removeUploadedImageFilenames(unusedImageFilenames);
    res.status(201).json({ created: uniqueWordsById(created), linked: created.filter(word => db.words.some(item => item.id === word.id)) });
  } catch (error) {
    await removeUploadedFiles(uploadedFiles(req, ["image", "images"]));
    next(error);
  }
});

app.patch("/api/words/bulk-location", bulkMoveWords);
app.delete("/api/words/bulk", bulkDeleteWords);

app.patch("/api/words/:wordId", upload.single("image"), async (req, res, next) => {
  try {
    const db = await readDatabase();
    const existing = db.words.find(word => word.id === req.params.wordId);
    if (!existing) throw httpError(404, "Word not found");

    const { items, location } = parseWordRequest(req);
    if (items.length !== 1) throw httpError(400, "Update accepts one word only");

    const previousImage = existing.image;
    const previousPronunciationFilename = existing.pronunciation?.filename || "";
    const replacementImage = req.file ? imageRecord(req.file) : existing.image;
    const previousWordKey = wordKey(existing.word);
    const newWordKey = wordKey(items[0].word);
    if (newWordKey !== previousWordKey && db.words.some(word => word.id !== existing.id && wordKey(word.word) === newWordKey)) {
      throw httpError(400, "This word already exists. Add it to a new place instead of renaming another word to it.");
    }
    const updated = normalizeWord(items[0], location, db, {
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
      image: items[0].removeImage ? null : replacementImage,
      pronunciation: existing.pronunciation,
      thesaurus: existing.thesaurus
    });
    updated.locations = dedupeLocations([...wordLocations(existing), ...wordLocations(updated)]);
    syncPrimaryLocation(updated);
    if (wordKey(updated.word) !== previousWordKey) {
      updated.pronunciation = null;
    }

    Object.assign(existing, updated);
    await enrichWordsWithPronunciations([existing]);
    await writeDatabase(db);
    if ((req.file || items[0].removeImage) && previousImage?.filename) {
      await removeUploadedImage(previousImage.filename);
    }
    if (previousPronunciationFilename && previousPronunciationFilename !== existing.pronunciation?.filename) {
      await removePronunciationFile(previousPronunciationFilename);
    }
    res.json(existing);
  } catch (error) {
    if (req.file) await removeUploadedImage(req.file.filename);
    next(error);
  }
});

app.delete("/api/words/:wordId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const index = db.words.findIndex(word => word.id === req.params.wordId);
    if (index === -1) throw httpError(404, "Word not found");
    const [word] = db.words.splice(index, 1);
    await writeDatabase(db);
    await removePracticeProgressForWordIds([word.id]);
    if (word.image?.filename) {
      await removeUploadedImage(word.image.filename);
    }
    if (word.pronunciation?.filename) {
      await removePronunciationFile(word.pronunciation.filename);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/verbs", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const items = parseVerbImportItems(req.body);
    const createdAt = nowIso();
    const saved = items.map(item => {
      const verb = normalizeVerb(item, { createdAt });
      const existing = findVerbByBase(db.verbs, verb.base);
      if (existing) {
        mergeVerbIntoExisting(existing, verb);
        return existing;
      }
      db.verbs.push(verb);
      return verb;
    });
    await writeDatabase(db);
    res.status(201).json({ verbs: uniqueVerbsById(saved) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/verbs/:verbId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const existing = db.verbs.find(verb => verb.id === req.params.verbId);
    if (!existing) throw httpError(404, "Verb not found");

    const updated = normalizeVerb(req.body, {
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    });
    const duplicate = findVerbByBase(db.verbs, updated.base, existing.id);
    if (duplicate) {
      throw httpError(400, "This verb already exists");
    }
    Object.assign(existing, updated);
    await writeDatabase(db);
    res.json(existing);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/verbs/:verbId", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const index = db.verbs.findIndex(verb => verb.id === req.params.verbId);
    if (index === -1) throw httpError(404, "Verb not found");
    db.verbs.splice(index, 1);
    await writeDatabase(db);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Uploaded file is too large."
      : error.message;
    res.status(400).json({ error: message });
    return;
  }

  const status = error.status || 500;
  res.status(status).json({ error: status === 500 ? "Server error" : error.message });
  if (status === 500) {
    console.error(error);
  }
});

app.listen(PORT, () => {
  console.log(`English Word Vault is running at http://localhost:${PORT}`);
});

async function ensureStorage() {
  await mkdir(IMAGE_DIR, { recursive: true });
  await mkdir(VIDEO_DIR, { recursive: true });
  await mkdir(NATIONAL_TEST_DIR, { recursive: true });
  await mkdir(NATIONAL_TEST_PAGE_IMAGE_DIR, { recursive: true });
  await mkdir(LISTENING_MEDIA_DIR, { recursive: true });
  await mkdir(LISTENING_UPLOAD_TMP_DIR, { recursive: true });
  await mkdir(PRONUNCIATION_DIR, { recursive: true });
  try {
    await access(DB_PATH);
  } catch {
    await writeDatabase({
      sources: [
        {
          id: "source_general",
          name: "General",
          branches: [
            {
              id: "branch_vocabulary",
              name: "Vocabulary",
              units: [{ id: "unit_1", name: "Topic 1" }]
            }
          ]
        }
      ],
      words: []
    });
  }
  try {
    await access(STUDY_TEXTS_PATH);
  } catch {
    await writeStudyTexts([]);
  }
  try {
    await access(VERBS_PATH);
  } catch {
    await writeVerbs([]);
  }
  try {
    await access(STUDY_VIDEOS_PATH);
  } catch {
    await writeStudyVideos([]);
  }
  try {
    await access(NATIONAL_TESTS_PATH);
  } catch {
    await writeNationalTests([]);
  }
  try {
    await access(NATIONAL_TEST_PAGES_PATH);
  } catch {
    await writeNationalTestPages([]);
  }
  try {
    await access(NATIONAL_TEST_OFFICIAL_ANSWERS_PATH);
  } catch {
    await writeNationalTestOfficialAnswers([]);
  }
  try {
    await access(NATIONAL_TEST_PAGE_TRANSLATIONS_PATH);
  } catch {
    await writeNationalTestPageTranslations({});
  }
  await migrateEmbeddedNationalTestOfficialAnswers();
  await migrateStudyTextsFromWordDatabase();
  try {
    await access(PRACTICE_PROGRESS_PATH);
  } catch {
    await writePracticeProgress({ words: {} });
  }
}

async function readDatabase(options = {}) {
  const includeNationalTestPages = options.includeNationalTestPages !== false;
  const db = await readJsonStore(DB_PATH, { sources: [], words: [] });
  db.sources = Array.isArray(db.sources) ? db.sources : [];
  db.words = Array.isArray(db.words) ? db.words : [];
  db.verbs = await readVerbs();
  db.studyTexts = await readStudyTexts();
  db.studyVideos = await readStudyVideos();
  db.nationalTests = await readNationalTests();
  db.nationalTestPages = includeNationalTestPages ? await readNationalTestPagesWithTranslations() : [];
  db.words.forEach(word => {
    word.pronunciation = normalizePronunciationRecord(word.pronunciation);
  });
  db.sources.forEach(source => {
    source.branches = Array.isArray(source.branches) ? source.branches : [];
    source.branches.forEach(branch => {
      branch.units = Array.isArray(branch.units) ? branch.units : [];
    });
  });
  const migration = await normalizeAndMigrateWords(db);
  if (migration.changed) {
    await writeDatabase(db);
  }
  return db;
}

async function writeDatabase(db) {
  const wordDb = {
    sources: Array.isArray(db.sources) ? db.sources : [],
    words: Array.isArray(db.words)
      ? db.words.map(word => normalizeStoredWordRecord(word).word).filter(Boolean)
      : []
  };
  await writeJsonStore(DB_PATH, wordDb);
  if (Array.isArray(db.verbs)) {
    await writeVerbs(db.verbs);
  }
  if (Array.isArray(db.studyTexts)) {
    await writeStudyTexts(db.studyTexts);
  }
  if (Array.isArray(db.studyVideos)) {
    await writeStudyVideos(db.studyVideos);
  }
  if (Array.isArray(db.nationalTests)) {
    await writeNationalTests(db.nationalTests);
  }
  if (Array.isArray(db.nationalTestPages)) {
    await persistEmbeddedNationalTestPageTranslations(db.nationalTestPages);
    await writeNationalTestPages(db.nationalTestPages);
  }
}

function jsonStoreTempPath(filePath) {
  return `${filePath}.tmp`;
}

function jsonStoreBackupPath(filePath) {
  return `${filePath}.backup`;
}

function jsonStoreRepairBackupPath(filePath) {
  return `${filePath.replace(/\.json$/i, "")}.repair-backup-${nowIso().replace(/[:.]/g, "-")}.json`;
}

function normalizeStoredJsonOutput(text) {
  const value = stripBom(text);
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function readJsonStore(filePath, fallbackValue) {
  const primaryPath = path.resolve(filePath);
  const candidates = [
    { path: primaryPath, restore: false },
    { path: jsonStoreTempPath(primaryPath), restore: true },
    { path: jsonStoreBackupPath(primaryPath), restore: true }
  ];
  let firstError = null;

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate.path, "utf8");
      const parsed = parseStoredJsonText(raw);
      if (candidate.restore) {
        await restoreJsonStore(primaryPath, raw);
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      firstError ||= error;
    }
  }

  if (firstError && firstError.code !== "ENOENT") {
    throw firstError;
  }
  if (arguments.length > 1) {
    return fallbackValue;
  }
  throw firstError || Object.assign(new Error(`Unable to read JSON store ${path.basename(primaryPath)}`), { code: "ENOENT" });
}

async function restoreJsonStore(filePath, raw) {
  const normalized = normalizeStoredJsonOutput(raw);
  try {
    const currentRaw = await readFile(filePath, "utf8");
    const currentNormalized = normalizeStoredJsonOutput(currentRaw);
    if (currentNormalized !== normalized) {
      await writeFile(jsonStoreRepairBackupPath(filePath), currentNormalized, "utf8");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Unable to snapshot damaged JSON store ${path.basename(filePath)}: ${error.message}`);
    }
  }

  await writeFile(filePath, normalized, "utf8");
  await writeFile(jsonStoreBackupPath(filePath), normalized, "utf8");
}

async function writeJsonStore(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = jsonStoreTempPath(filePath);
  const backupPath = jsonStoreBackupPath(filePath);
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    await copyFile(filePath, backupPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
  await writeFile(backupPath, content, "utf8");
}

async function readStudyTexts() {
  try {
    const parsed = await readJsonStore(STUDY_TEXTS_PATH, { studyTexts: [] });
    const texts = Array.isArray(parsed) ? parsed : Array.isArray(parsed.studyTexts) ? parsed.studyTexts : [];
    return texts.map(normalizeStoredStudyText).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeStudyTexts(studyTexts) {
  const payload = {
    studyTexts: Array.isArray(studyTexts) ? studyTexts.map(normalizeStoredStudyText).filter(Boolean) : []
  };
  await writeJsonStore(STUDY_TEXTS_PATH, payload);
}

async function readVerbs() {
  try {
    const parsed = await readJsonStore(VERBS_PATH, { verbs: [] });
    const verbs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.verbs) ? parsed.verbs : [];
    return verbs.map(normalizeStoredVerb).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeVerbs(verbs) {
  const payload = {
    verbs: Array.isArray(verbs) ? verbs.map(normalizeStoredVerb).filter(Boolean) : []
  };
  await writeJsonStore(VERBS_PATH, payload);
}

async function readStudyVideos() {
  try {
    const parsed = await readJsonStore(STUDY_VIDEOS_PATH, { studyVideos: [] });
    const videos = Array.isArray(parsed) ? parsed : Array.isArray(parsed.studyVideos) ? parsed.studyVideos : [];
    return videos.map(normalizeStoredStudyVideo).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeStudyVideos(studyVideos) {
  const payload = {
    studyVideos: Array.isArray(studyVideos) ? studyVideos.map(normalizeStoredStudyVideo).filter(Boolean) : []
  };
  await writeJsonStore(STUDY_VIDEOS_PATH, payload);
}

async function readNationalTests() {
  try {
    const parsed = await readJsonStore(NATIONAL_TESTS_PATH, { nationalTests: [] });
    const tests = Array.isArray(parsed) ? parsed : Array.isArray(parsed.nationalTests) ? parsed.nationalTests : [];
    return tests.map(normalizeNationalTest).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeNationalTests(nationalTests) {
  const payload = {
    nationalTests: Array.isArray(nationalTests) ? nationalTests.map(normalizeNationalTest).filter(Boolean) : []
  };
  await writeJsonStore(NATIONAL_TESTS_PATH, payload);
}

async function readNationalTestPages() {
  try {
    const parsed = await readJsonStore(NATIONAL_TEST_PAGES_PATH, { nationalTestPages: [] });
    const pages = Array.isArray(parsed) ? parsed : Array.isArray(parsed.nationalTestPages) ? parsed.nationalTestPages : [];
    const normalizedPages = pages.map(normalizeStoredNationalTestPage).filter(Boolean);
    const officialAnswers = await readNationalTestOfficialAnswers();
    return hydrateNationalTestPagesWithOfficialAnswers(normalizedPages, officialAnswers);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeNationalTestPages(nationalTestPages) {
  const normalizedPages = Array.isArray(nationalTestPages)
    ? nationalTestPages.map(normalizeStoredNationalTestPage).filter(Boolean)
    : [];
  await synchronizeNationalTestOfficialAnswersFromPages(normalizedPages);
  const payload = {
    nationalTestPages: normalizedPages
      .map(stripNationalTestPageTranslations)
      .map(stripNationalTestPageOfficialQuestions)
  };
  await writeJsonStore(NATIONAL_TEST_PAGES_PATH, payload);
}

async function readNationalTestOfficialAnswers() {
  try {
    const parsed = await readJsonStore(NATIONAL_TEST_OFFICIAL_ANSWERS_PATH, { nationalTestOfficialAnswers: [] });
    const records = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.nationalTestOfficialAnswers) ? parsed.nationalTestOfficialAnswers : [];
    return records.map(normalizeStoredNationalTestOfficialAnswerRecord).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeNationalTestOfficialAnswers(records) {
  await writeJsonStore(NATIONAL_TEST_OFFICIAL_ANSWERS_PATH, {
    nationalTestOfficialAnswers: Array.isArray(records)
      ? records.map(normalizeStoredNationalTestOfficialAnswerRecord).filter(Boolean)
      : []
  });
}

async function readNationalTestPageTranslations() {
  try {
    const parsed = await readJsonStore(NATIONAL_TEST_PAGE_TRANSLATIONS_PATH, { nationalTestPageTranslations: {} });
    return normalizeNationalTestPageTranslationStore(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeNationalTestPageTranslations(translations) {
  await writeJsonStore(NATIONAL_TEST_PAGE_TRANSLATIONS_PATH, {
    nationalTestPageTranslations: normalizeNationalTestPageTranslationStore(translations)
  });
}

function normalizeStoredNationalTestOfficialAnswerRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const testId = stringValue(input.testId);
  const pageId = stringValue(input.pageId);
  const questionId = stringValue(input.questionId || input.id);
  const questionNumber = normalizeNationalTestQuestionLabel(input.questionNumber || input.number || input.label);
  if (!testId || !pageId || !questionId) return null;
  const optionElementIds = normalizeNationalTestQuestionOptionElementIds(input.optionElementIds, input.options);
  const answer = normalizeNationalTestPageOfficialAnswer(input.answer, {
    ...input,
    number: questionNumber,
    optionElementIds
  });
  if (!answer) return null;
  const createdAt = validIso(input.createdAt) || nowIso();
  const submittedUpdatedAt = validIso(input.updatedAt) || createdAt;
  const normalized = {
    id: stringValue(input.id)?.startsWith("official_answer_") ? stringValue(input.id) : `official_answer_${randomUUID()}`,
    testId,
    pageId,
    questionId,
    questionNumber: questionNumber || questionId,
    type: officialQuestionTypeForAnswerTarget(
      normalizeNationalTestPageQuestionType(input.type || input.questionType, input),
      optionElementIds,
      answer
    ),
    answer,
    createdAt,
    updatedAt: Date.parse(submittedUpdatedAt) < Date.parse(createdAt) ? createdAt : submittedUpdatedAt
  };
  const prompt = stringValue(input.prompt || input.question || input.text);
  const promptElementId = stringValue(input.promptElementId || input.questionElementId);
  if (prompt) normalized.prompt = prompt;
  if (promptElementId) normalized.promptElementId = promptElementId;
  if (Object.keys(optionElementIds).length) normalized.optionElementIds = optionElementIds;
  return normalized;
}

function nationalTestOfficialAnswerRecordKey(testId, pageId, questionId) {
  return `${stringValue(testId)}\u0000${stringValue(pageId)}\u0000${stringValue(questionId)}`;
}

function nationalTestQuestionIdentity(question, index = 0) {
  const explicitId = stringValue(question?.id || question?.questionId);
  if (explicitId) return explicitId;
  const number = normalizeNationalTestQuestionLabel(question?.number || question?.questionNumber || question?.label || index + 1);
  return `q${String(number || index + 1).toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || index + 1}`;
}

function officialAnswerRecordFromPageQuestion(page, question, index, existingRecord = null) {
  if (!page || !question || !question.answer) return null;
  const questionId = nationalTestQuestionIdentity(question, index);
  const base = {
    id: existingRecord?.id || `official_answer_${randomUUID()}`,
    testId: page.testId,
    pageId: page.id,
    questionId,
    questionNumber: question.number || question.questionNumber || question.label || String(index + 1),
    type: question.type,
    prompt: question.prompt,
    promptElementId: question.promptElementId,
    optionElementIds: question.optionElementIds,
    answer: question.answer,
    createdAt: existingRecord?.createdAt || page.createdAt || page.updatedAt || nowIso(),
    updatedAt: page.updatedAt || existingRecord?.updatedAt || nowIso()
  };
  const normalized = normalizeStoredNationalTestOfficialAnswerRecord(base);
  if (!normalized) return null;
  if (existingRecord) {
    const previousComparable = JSON.stringify(officialAnswerRecordComparable(existingRecord));
    const nextComparable = JSON.stringify(officialAnswerRecordComparable(normalized));
    if (previousComparable === nextComparable) {
      const existingUpdatedAt = validIso(existingRecord.updatedAt) || normalized.createdAt;
      normalized.updatedAt = Date.parse(existingUpdatedAt) < Date.parse(normalized.createdAt)
        ? normalized.createdAt
        : existingUpdatedAt;
    } else {
      const changedAt = validIso(page.updatedAt) || nowIso();
      normalized.updatedAt = Date.parse(changedAt) < Date.parse(normalized.createdAt)
        ? normalized.createdAt
        : changedAt;
    }
  }
  return normalized;
}

function officialAnswerRecordComparable(record) {
  return {
    testId: record?.testId,
    pageId: record?.pageId,
    questionId: record?.questionId,
    questionNumber: record?.questionNumber,
    type: record?.type,
    prompt: record?.prompt,
    promptElementId: record?.promptElementId,
    optionElementIds: record?.optionElementIds,
    answer: record?.answer
  };
}

async function synchronizeNationalTestOfficialAnswersFromPages(pages) {
  const existingRecords = await readNationalTestOfficialAnswers();
  const existingByKey = new Map(existingRecords.map(record => [
    nationalTestOfficialAnswerRecordKey(record.testId, record.pageId, record.questionId),
    record
  ]));
  const records = [];
  (Array.isArray(pages) ? pages : []).forEach(page => {
    (Array.isArray(page?.questions) ? page.questions : []).forEach((question, index) => {
      const questionId = nationalTestQuestionIdentity(question, index);
      const key = nationalTestOfficialAnswerRecordKey(page.testId, page.id, questionId);
      const record = officialAnswerRecordFromPageQuestion(page, question, index, existingByKey.get(key));
      if (record) records.push(record);
    });
  });
  await writeNationalTestOfficialAnswers(records);
}

function officialQuestionFromStoredAnswerRecord(record) {
  const question = {
    id: record.questionId,
    number: record.questionNumber,
    type: record.type,
    answer: record.answer
  };
  if (record.prompt) question.prompt = record.prompt;
  if (record.promptElementId) question.promptElementId = record.promptElementId;
  if (record.optionElementIds && Object.keys(record.optionElementIds).length) {
    question.optionElementIds = record.optionElementIds;
  }
  return question;
}

function hydrateNationalTestPagesWithOfficialAnswers(pages, records) {
  const recordsByPage = new Map();
  (Array.isArray(records) ? records : []).forEach(record => {
    if (!recordsByPage.has(record.pageId)) recordsByPage.set(record.pageId, []);
    recordsByPage.get(record.pageId).push(record);
  });
  return (Array.isArray(pages) ? pages : []).map(page => {
    const storedQuestions = (recordsByPage.get(page.id) || [])
      .filter(record => record.testId === page.testId)
      .map(officialQuestionFromStoredAnswerRecord);
    const questions = mergeNationalTestPageQuestionCollections(page.questions, storedQuestions);
    const hydrated = { ...page };
    if (questions.length) hydrated.questions = questions;
    else delete hydrated.questions;
    return hydrated;
  });
}

function mergeNationalTestPageQuestionCollections(existingQuestions, incomingQuestions) {
  const merged = [];
  const indexes = new Map();
  const add = (question, index) => {
    if (!question || typeof question !== "object") return;
    const identity = nationalTestQuestionIdentity(question, index);
    const numberKey = `number:${normalizeNationalTestQuestionLabel(question.number || question.questionNumber || question.label)}`;
    const existingIndex = indexes.has(identity)
      ? indexes.get(identity)
      : indexes.has(numberKey) ? indexes.get(numberKey) : -1;
    const normalized = { ...question, id: identity };
    if (existingIndex >= 0) {
      merged[existingIndex] = normalized;
    } else {
      indexes.set(identity, merged.length);
      if (numberKey !== "number:") indexes.set(numberKey, merged.length);
      merged.push(normalized);
    }
  };
  (Array.isArray(existingQuestions) ? existingQuestions : []).forEach(add);
  (Array.isArray(incomingQuestions) ? incomingQuestions : []).forEach(add);
  return merged;
}

async function migrateEmbeddedNationalTestOfficialAnswers() {
  const parsed = await readJsonStore(NATIONAL_TEST_PAGES_PATH, { nationalTestPages: [] });
  const rawPages = Array.isArray(parsed) ? parsed : Array.isArray(parsed.nationalTestPages) ? parsed.nationalTestPages : [];
  const normalizedPages = rawPages.map(normalizeStoredNationalTestPage).filter(Boolean);
  if (!normalizedPages.some(page => Array.isArray(page.questions) && page.questions.length)) return;
  const existingRecords = await readNationalTestOfficialAnswers();
  const hydratedPages = hydrateNationalTestPagesWithOfficialAnswers(normalizedPages, existingRecords);
  await synchronizeNationalTestOfficialAnswersFromPages(hydratedPages);
  await writeJsonStore(NATIONAL_TEST_PAGES_PATH, {
    nationalTestPages: hydratedPages
      .map(stripNationalTestPageTranslations)
      .map(stripNationalTestPageOfficialQuestions)
  });
}

async function readNationalTestPagesWithTranslations() {
  const pages = await readNationalTestPages();
  let translationStore = await readNationalTestPageTranslations();
  const embeddedTranslations = translationsFromNationalTestPages(pages);
  if (Object.keys(embeddedTranslations).length) {
    translationStore = mergeNationalTestPageTranslationStores(translationStore, embeddedTranslations);
    await writeNationalTestPageTranslations(translationStore);
    await writeNationalTestPages(pages);
  }
  return pages.map(page => nationalTestPageWithStoredTranslations(page, translationStore)).filter(Boolean);
}

async function persistEmbeddedNationalTestPageTranslations(pages) {
  const embeddedTranslations = translationsFromNationalTestPages(pages);
  if (!Object.keys(embeddedTranslations).length) return;
  const translationStore = await readNationalTestPageTranslations();
  await writeNationalTestPageTranslations(mergeNationalTestPageTranslationStores(translationStore, embeddedTranslations));
}

function stripNationalTestPageTranslations(page) {
  if (!page || typeof page !== "object") return page;
  const stripped = { ...page };
  delete stripped.translations;
  return stripped;
}

function stripNationalTestPageOfficialQuestions(page) {
  if (!page || typeof page !== "object") return page;
  const stripped = { ...page };
  delete stripped.questions;
  return stripped;
}

function nationalTestPageWithStoredTranslations(page, translationStore = {}) {
  if (!page || typeof page !== "object") return null;
  const normalizedTranslations = mergeNationalTestPageTranslations(
    page.translations,
    translationStore[stringValue(page.id)]
  );
  const result = { ...page };
  if (Object.keys(normalizedTranslations).length) {
    result.translations = normalizedTranslations;
  } else {
    delete result.translations;
  }
  return result;
}

function translationsFromNationalTestPages(pages) {
  const translations = {};
  (Array.isArray(pages) ? pages : []).forEach(page => {
    const pageId = stringValue(page?.id);
    const pageTranslations = normalizeNationalTestPageTranslations(page?.translations);
    if (!pageId || !Object.keys(pageTranslations).length) return;
    translations[pageId] = pageTranslations;
  });
  return translations;
}

function normalizeNationalTestPageTranslationStore(value) {
  const rawStore = value && typeof value === "object" && !Array.isArray(value)
    ? value.nationalTestPageTranslations || value.pageTranslations || value.translations || value
    : value;
  const store = {};
  if (Array.isArray(rawStore)) {
    rawStore.forEach(record => {
      const pageId = stringValue(record?.pageId || record?.nationalTestPageId || record?.id);
      const translations = normalizeNationalTestPageTranslations(
        record?.translations || record?.pageTranslations || (record?.language ? { [record.language]: record } : null)
      );
      if (!pageId || !Object.keys(translations).length) return;
      store[pageId] = mergeNationalTestPageTranslations(store[pageId], translations);
    });
    return store;
  }
  if (!rawStore || typeof rawStore !== "object") return store;
  Object.entries(rawStore).forEach(([pageId, translations]) => {
    const normalizedPageId = stringValue(pageId);
    const normalizedTranslations = normalizeNationalTestPageTranslations(translations);
    if (!normalizedPageId || !Object.keys(normalizedTranslations).length) return;
    store[normalizedPageId] = normalizedTranslations;
  });
  return store;
}

function mergeNationalTestPageTranslations(...values) {
  return values.reduce((merged, value) => ({
    ...merged,
    ...normalizeNationalTestPageTranslations(value)
  }), {});
}

function mergeNationalTestPageTranslationsPreservingLayouts(existing, incoming) {
  const existingTranslations = normalizeNationalTestPageTranslations(existing);
  const incomingTranslations = normalizeNationalTestPageTranslations(incoming);
  const merged = { ...existingTranslations };
  Object.entries(incomingTranslations).forEach(([language, record]) => {
    const previous = existingTranslations[language] || {};
    merged[language] = {
      ...previous,
      ...record,
      items: Object.keys(record.items || {}).length ? record.items : previous.items || {},
      ...(record.hiddenElementIds?.length || previous.hiddenElementIds?.length
        ? { hiddenElementIds: record.hiddenElementIds?.length ? record.hiddenElementIds : previous.hiddenElementIds || [] }
        : {}),
      ...(record.pageLayout || previous.pageLayout ? { pageLayout: record.pageLayout || previous.pageLayout } : {}),
      ...(record.studyDocumentTranslation || previous.studyDocumentTranslation
        ? { studyDocumentTranslation: record.studyDocumentTranslation || previous.studyDocumentTranslation }
        : {})
    };
  });
  return merged;
}

function mergeNationalTestPageTranslationStores(...stores) {
  const mergedStore = {};
  stores.forEach(store => {
    const normalizedStore = normalizeNationalTestPageTranslationStore(store);
    Object.entries(normalizedStore).forEach(([pageId, translations]) => {
      mergedStore[pageId] = mergeNationalTestPageTranslations(mergedStore[pageId], translations);
    });
  });
  return mergedStore;
}

async function migrateStudyTextsFromWordDatabase() {
  const db = await readJsonStore(DB_PATH, { sources: [], words: [] });
  if (!Object.prototype.hasOwnProperty.call(db, "studyTexts")) return;

  const embeddedTexts = Array.isArray(db.studyTexts) ? db.studyTexts.map(normalizeStoredStudyText).filter(Boolean) : [];
  if (embeddedTexts.length) {
    const currentTexts = await readStudyTexts();
    const merged = [...currentTexts];
    const existingIds = new Set(merged.map(text => text.id));
    embeddedTexts.forEach(text => {
      if (existingIds.has(text.id)) return;
      merged.push(text);
      existingIds.add(text.id);
    });
    await writeStudyTexts(merged);
  }

  delete db.studyTexts;
  await writeDatabase(db);
}

async function readPracticeProgress() {
  try {
    const progress = await readJsonStore(PRACTICE_PROGRESS_PATH, { words: {} });
    return normalizePracticeProgress(progress);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { words: {} };
    }
    throw error;
  }
}

async function writePracticeProgress(progress) {
  await writeJsonStore(PRACTICE_PROGRESS_PATH, normalizePracticeProgress(progress));
}

function normalizePracticeProgress(progress) {
  const words = progress && typeof progress === "object" && progress.words && typeof progress.words === "object"
    ? progress.words
    : {};
  const normalizedWords = Object.fromEntries(Object.entries(words)
    .map(([wordId, record]) => [wordId, normalizePracticeRecord(wordId, record)])
    .filter(([, record]) => record));

  return {
    words: normalizedWords,
    reviewSession: normalizeReviewSession(progress?.reviewSession)
  };
}

function normalizePracticeRecord(wordId, record = {}) {
  const id = stringValue(record.wordId || wordId);
  if (!id) return null;
  const correctCount = nonNegativeInteger(record.correctCount ?? record.successfulReviews);
  const wrongCount = nonNegativeInteger(record.wrongCount ?? record.mistakesCount);
  const successfulReviews = nonNegativeInteger(record.successfulReviews ?? correctCount);
  const mistakesCount = nonNegativeInteger(record.mistakesCount ?? wrongCount);
  const lastReviewDate = validIso(record.lastReviewDate || record.lastPracticedAt);
  const nextReviewDate = validIso(record.nextReviewDate || record.nextReviewAt);
  const intervalDays = normalizeIntervalDays(record.intervalDays, lastReviewDate, nextReviewDate, record.streak);
  const strengthLevel = clampInteger(
    record.strengthLevel ?? record.streak ?? strengthLevelFromInterval(intervalDays, successfulReviews, mistakesCount),
    0,
    MAX_STRENGTH_LEVEL
  );
  const easeFactor = clampNumber(
    record.easeFactor ?? INITIAL_EASE_FACTOR - mistakesCount * 0.12,
    MIN_EASE_FACTOR,
    MAX_EASE_FACTOR,
    INITIAL_EASE_FACTOR
  );

  return {
    wordId: id,
    strengthLevel,
    mistakesCount,
    successfulReviews,
    lastReviewDate,
    intervalDays,
    easeFactor,
    nextReviewDate,
    correctCount,
    wrongCount,
    streak: nonNegativeInteger(record.streak ?? strengthLevel),
    lastPracticedAt: lastReviewDate,
    nextReviewAt: nextReviewDate,
    lastResult: record.lastResult === "wrong" ? "wrong" : record.lastResult === "correct" ? "correct" : ""
  };
}

function normalizeReviewSession(session) {
  if (!session || typeof session !== "object") return null;
  const id = stringValue(session.id);
  const wordIds = normalizeIdList(session.wordIds);
  if (!id || !wordIds.length) return null;
  return {
    id,
    wordIds,
    dueWordIds: normalizeIdList(session.dueWordIds),
    weakWordIds: normalizeIdList(session.weakWordIds),
    newWordIds: normalizeIdList(session.newWordIds),
    createdAt: validIso(session.createdAt) || nowIso(),
    completedAt: validIso(session.completedAt),
    target: positiveInteger(session.target, DEFAULT_REVIEW_TARGET),
    maxNew: positiveInteger(session.maxNew, DEFAULT_MAX_NEW_WORDS)
  };
}

function reviewOptions(body = {}) {
  const target = Math.min(50, positiveInteger(body.target, DEFAULT_REVIEW_TARGET));
  return {
    target,
    maxNew: Math.min(50, positiveInteger(body.maxNew, target))
  };
}

function createReviewSession(words, progress, options) {
  const selection = selectReviewWords(words, progress, options);
  if (!selection.wordIds.length) return null;
  return {
    id: `review_${randomUUID()}`,
    wordIds: selection.wordIds,
    dueWordIds: selection.dueWordIds,
    weakWordIds: selection.weakWordIds,
    newWordIds: selection.newWordIds,
    createdAt: nowIso(),
    completedAt: "",
    target: options.target,
    maxNew: options.maxNew
  };
}

function selectReviewWords(words, progress, options) {
  const target = options.target;
  const maxNew = Math.min(options.maxNew, target);
  const validWordIds = new Set(words.map(word => word.id));
  const now = Date.now();

  const records = Object.values(progress.words)
    .filter(record => validWordIds.has(record.wordId));

  const dueWordIds = records
    .filter(record => isReviewDue(record, now))
    .sort((a, b) => sortDueRecords(a, b))
    .slice(0, target)
    .map(record => record.wordId);

  const dueSet = new Set(dueWordIds);
  const weakWordIds = records
    .filter(record => !dueSet.has(record.wordId) && isWeakReview(record, now))
    .sort((a, b) => sortWeakRecords(a, b, now))
    .slice(0, Math.max(0, target - dueWordIds.length))
    .map(record => record.wordId);

  const usedSet = new Set([...dueWordIds, ...weakWordIds]);
  const newWordIds = dueWordIds.length ? [] : words
    .filter(word => word.id && !progress.words[word.id] && !usedSet.has(word.id))
    .sort((a, b) => {
      const createdDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      return createdDiff || wordKey(a.word).localeCompare(wordKey(b.word));
    })
    .slice(0, Math.min(maxNew, Math.max(0, target - weakWordIds.length)))
    .map(word => word.id);

  return {
    wordIds: [...dueWordIds, ...weakWordIds, ...newWordIds],
    dueWordIds,
    weakWordIds,
    newWordIds
  };
}

function reviewSessionResponse(session, words, progress, options = {}) {
  const validWordIds = new Set(words.map(word => word.id));
  const wordById = new Map(words.map(word => [word.id, word]));
  const wordIds = pendingReviewWordIds(session, progress, validWordIds);
  const wordIdSet = new Set(wordIds);
  const dueWordIds = session.dueWordIds.filter(wordId => wordIdSet.has(wordId));
  const weakWordIds = session.weakWordIds.filter(wordId => wordIdSet.has(wordId));
  const oldWordIds = [...dueWordIds, ...weakWordIds];
  const newWordIds = session.newWordIds.filter(wordId => wordIdSet.has(wordId));
  return {
    sessionId: session.id,
    createdAt: session.createdAt,
    resumed: Boolean(options.resumed),
    target: session.target,
    maxNew: session.maxNew,
    wordIds,
    dueWordIds,
    weakWordIds,
    oldWordIds,
    newWordIds,
    words: wordIds.map(wordId => wordById.get(wordId)).filter(Boolean)
  };
}

function emptyReviewSessionResponse() {
  return {
    sessionId: "",
    createdAt: "",
    resumed: false,
    target: DEFAULT_REVIEW_TARGET,
    maxNew: DEFAULT_MAX_NEW_WORDS,
    wordIds: [],
    dueWordIds: [],
    weakWordIds: [],
    oldWordIds: [],
    newWordIds: [],
    words: []
  };
}

function pendingReviewWordIds(session, progress, validWordIds) {
  if (!session || session.completedAt) return [];
  const createdAt = Date.parse(session.createdAt) || 0;
  return session.wordIds.filter(wordId => {
    if (!validWordIds.has(wordId)) return false;
    const record = progress.words[wordId];
    if (!record?.lastReviewDate) return true;

    const lastReviewDate = Date.parse(record.lastReviewDate);
    if (Number.isNaN(lastReviewDate) || lastReviewDate < createdAt) return true;
    if (record.lastResult === "correct" && !isReviewDue(record)) return false;
    return true;
  });
}

function updatePracticeRecord(existingRecord, wordId, correct) {
  const record = normalizePracticeRecord(wordId, existingRecord) || normalizePracticeRecord(wordId);
  const reviewedAt = new Date();
  const previousSuccessfulReviews = record.successfulReviews;
  const retention = forgettingCurveRetention(record, reviewedAt.getTime());

  if (correct) {
    record.correctCount += 1;
    record.successfulReviews += 1;
    record.strengthLevel = Math.min(MAX_STRENGTH_LEVEL, record.strengthLevel + 1);
    record.easeFactor = nextEaseFactor(record.easeFactor, retention, true);
    record.intervalDays = nextCorrectInterval(record, previousSuccessfulReviews, retention);
    record.streak = record.strengthLevel;
    record.lastResult = "correct";
  } else {
    record.wrongCount += 1;
    record.mistakesCount += 1;
    record.strengthLevel = Math.max(0, Math.floor(record.strengthLevel / 2) - 1);
    record.easeFactor = nextEaseFactor(record.easeFactor, retention, false);
    record.intervalDays = roundIntervalDays(WRONG_REVIEW_DELAY_MINUTES / (24 * 60));
    record.streak = 0;
    record.lastResult = "wrong";
  }

  record.lastReviewDate = reviewedAt.toISOString();
  record.lastPracticedAt = record.lastReviewDate;
  record.nextReviewDate = addDays(reviewedAt, record.intervalDays).toISOString();
  record.nextReviewAt = record.nextReviewDate;
  return record;
}

function nextCorrectInterval(record, previousSuccessfulReviews, retention) {
  if (previousSuccessfulReviews <= 0) return 1;

  const baseInterval = Math.max(1, record.intervalDays);
  const retrievalBonus = retention < 0.45 ? 1.18 : retention < 0.75 ? 1.08 : 1;
  const nextInterval = previousSuccessfulReviews === 1
    ? Math.max(3, baseInterval * record.easeFactor)
    : baseInterval * record.easeFactor * retrievalBonus;
  return roundIntervalDays(Math.min(365, nextInterval));
}

function nextEaseFactor(easeFactor, retention, correct) {
  const adjustment = correct
    ? retention < 0.45 ? 0.08 : retention > 0.9 ? 0.02 : 0.04
    : retention < 0.5 ? -0.24 : -0.18;
  return roundFactor(clampNumber(easeFactor + adjustment, MIN_EASE_FACTOR, MAX_EASE_FACTOR, INITIAL_EASE_FACTOR));
}

function forgettingCurveRetention(record, at = Date.now()) {
  const lastReviewTime = Date.parse(record.lastReviewDate);
  if (Number.isNaN(lastReviewTime)) return 0.25;
  const elapsedDays = Math.max(0, (at - lastReviewTime) / MS_PER_DAY);
  const memoryStrengthDays = Math.max(0.25, record.intervalDays || 1);
  return Math.exp(-elapsedDays / memoryStrengthDays);
}

function isReviewDue(record, now = Date.now()) {
  const time = reviewTime(record);
  return time <= now;
}

function isWeakReview(record, now = Date.now()) {
  if (!record.lastReviewDate) return false;
  const lastReviewTime = Date.parse(record.lastReviewDate);
  const hoursSinceReview = Number.isNaN(lastReviewTime) ? Infinity : (now - lastReviewTime) / MS_PER_HOUR;
  const forgettingRisk = 1 - forgettingCurveRetention(record, now);
  return record.lastResult === "wrong" ||
    (record.mistakesCount > record.successfulReviews && forgettingRisk >= 0.2) ||
    (record.strengthLevel <= 2 && hoursSinceReview >= 8 && forgettingRisk >= 0.3) ||
    (record.easeFactor <= 1.8 && hoursSinceReview >= 8 && forgettingRisk >= 0.3);
}

function sortDueRecords(a, b) {
  const resultDiff = (a.lastResult === "wrong" ? 0 : 1) - (b.lastResult === "wrong" ? 0 : 1);
  const dueDiff = reviewTime(a) - reviewTime(b);
  return resultDiff ||
    dueDiff ||
    a.strengthLevel - b.strengthLevel ||
    b.mistakesCount - a.mistakesCount ||
    a.easeFactor - b.easeFactor ||
    a.wordId.localeCompare(b.wordId);
}

function sortWeakRecords(a, b, now = Date.now()) {
  const riskDiff = forgettingCurveRetention(a, now) - forgettingCurveRetention(b, now);
  return riskDiff ||
    a.strengthLevel - b.strengthLevel ||
    b.mistakesCount - a.mistakesCount ||
    a.easeFactor - b.easeFactor ||
    reviewTime(a) - reviewTime(b) ||
    a.wordId.localeCompare(b.wordId);
}

function reviewTime(record) {
  const time = Date.parse(record.nextReviewDate || record.nextReviewAt);
  return Number.isNaN(time) ? 0 : time;
}

function normalizeIntervalDays(value, lastReviewDate, nextReviewDate, streak) {
  const explicit = Number(value);
  if (Number.isFinite(explicit) && explicit >= 0) return roundIntervalDays(explicit);

  const lastReviewTime = Date.parse(lastReviewDate);
  const nextReviewTime = Date.parse(nextReviewDate);
  if (!Number.isNaN(lastReviewTime) && !Number.isNaN(nextReviewTime) && nextReviewTime >= lastReviewTime) {
    return roundIntervalDays((nextReviewTime - lastReviewTime) / MS_PER_DAY);
  }

  const reviewStreak = nonNegativeInteger(streak);
  if (reviewStreak <= 0) return 0;
  if (reviewStreak === 1) return 1;
  if (reviewStreak === 2) return 3;
  if (reviewStreak === 3) return 7;
  if (reviewStreak === 4) return 14;
  return 30;
}

function strengthLevelFromInterval(intervalDays, successfulReviews, mistakesCount) {
  const intervalScore = intervalDays > 0 ? Math.max(0, Math.floor(Math.log2(Math.max(1, intervalDays))) + 1) : 0;
  const reviewScore = Math.min(MAX_STRENGTH_LEVEL, successfulReviews);
  const mistakePenalty = Math.min(3, Math.floor(mistakesCount / 2));
  return clampInteger(Math.max(intervalScore, reviewScore) - mistakePenalty, 0, MAX_STRENGTH_LEVEL);
}

function roundIntervalDays(days) {
  return Math.round(days * 1000) / 1000;
}

function roundFactor(value) {
  return Math.round(value * 100) / 100;
}

function clampNumber(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampInteger(value, min, max) {
  return Math.round(clampNumber(value, min, max, min));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function prunePracticeProgress(progress, validWordIds) {
  let changed = false;
  Object.keys(progress.words).forEach(wordId => {
    if (!validWordIds.has(wordId)) {
      delete progress.words[wordId];
      changed = true;
    }
  });

  if (progress.reviewSession) {
    ["wordIds", "dueWordIds", "weakWordIds", "newWordIds"].forEach(key => {
      const values = progress.reviewSession[key].filter(wordId => validWordIds.has(wordId));
      if (values.length !== progress.reviewSession[key].length) {
        progress.reviewSession[key] = values;
        changed = true;
      }
    });

    if (!progress.reviewSession.wordIds.length) {
      progress.reviewSession = null;
      changed = true;
    }
  }

  return changed;
}

async function removePracticeProgressForWordIds(wordIds) {
  const ids = [...new Set(wordIds.filter(Boolean))];
  if (!ids.length) return;
  const progress = await readPracticeProgress();
  let changed = false;
  ids.forEach(wordId => {
    if (progress.words[wordId]) {
      delete progress.words[wordId];
      changed = true;
    }
  });
  if (progress.reviewSession) {
    ["wordIds", "dueWordIds", "weakWordIds", "newWordIds"].forEach(key => {
      const values = progress.reviewSession[key].filter(wordId => !ids.includes(wordId));
      if (values.length !== progress.reviewSession[key].length) {
        progress.reviewSession[key] = values;
        changed = true;
      }
    });
    if (!progress.reviewSession.wordIds.length) {
      progress.reviewSession = null;
      changed = true;
    }
  }
  if (changed) {
    await writePracticeProgress(progress);
  }
}

function parseWordRequest(req) {
  const body = typeof req.body?.payload === "string" ? parsePayload(req.body.payload) : req.body;
  if (Array.isArray(body)) {
    return { items: body, location: {}, imageIndexes: null };
  }
  if (Array.isArray(body.items)) {
    return { items: body.items, location: body.location || {}, imageIndexes: body.imageIndexes || null };
  }
  return { items: [body], location: {}, imageIndexes: null };
}

function studyVideoRequestBody(req) {
  return typeof req.body?.payload === "string" ? parsePayload(req.body.payload) : req.body;
}

function parsePayload(payload) {
  try {
    return JSON.parse(stripBom(payload || "{}"));
  } catch {
    throw httpError(400, "Invalid payload JSON");
  }
}

function stripBom(value) {
  return String(value || "").replace(/^\uFEFF/, "");
}

function parseStoredJsonText(raw) {
  const text = stripBom(raw);
  try {
    return JSON.parse(text);
  } catch (error) {
    for (const repaired of repairedStoredJsonTextCandidates(text)) {
      if (!repaired || repaired === text) continue;
      try {
        return JSON.parse(repaired);
      } catch {
        continue;
      }
    }
    throw error;
  }
}

function repairedStoredJsonTextCandidates(text) {
  const normalized = stripBom(text).trim();
  const candidates = [];
  const addCandidate = value => {
    const next = String(value || "").trim();
    if (!next || candidates.includes(next)) return;
    candidates.push(next);
  };

  const newlineRepaired = extractFirstJsonDocument(
    stripLiteralNewlinesInsideJsonStrings(normalized)
  ).trim();
  addCandidate(newlineRepaired);

  try {
    addCandidate(jsonrepair(normalized));
  } catch {}

  try {
    addCandidate(jsonrepair(newlineRepaired));
  } catch {}

  return candidates;
}

function stripLiteralNewlinesInsideJsonStrings(text) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of String(text || "")) {
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === "\"") {
        output += char;
        inString = false;
        continue;
      }
      if (char === "\r" || char === "\n") {
        continue;
      }
      output += char;
      continue;
    }

    output += char;
    if (char === "\"") {
      inString = true;
    }
  }

  return output;
}

function extractFirstJsonDocument(text) {
  const value = String(text || "").trim();
  const objectIndex = value.indexOf("{");
  const arrayIndex = value.indexOf("[");
  const start = [objectIndex, arrayIndex].filter(index => index >= 0).sort((a, b) => a - b)[0];
  if (start == null) return value;

  const opener = value[start];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
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
      continue;
    }
    if (char === opener) {
      depth += 1;
      continue;
    }
    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return value;
}

function normalizeWord(input, location, db, options = {}) {
  const requestLocation = normalizeRequestLocation({
    sourceId: input.sourceId || location.sourceId,
    branchId: input.branchId || location.branchId,
    unitId: input.unitId || location.unitId
  }, db);
  const locations = dedupeLocations([
    ...normalizeRequestLocations(input.locations, db),
    requestLocation
  ]);

  const word = cleanName(input.word, "Word is required");
  const normalized = {
    id: options.id || `word_${randomUUID()}`,
    word,
    definition: stringValue(input.definition),
    arabicTranslation: stringValue(input.arabicTranslation ?? input.translationArabic ?? input.arabic) || undefined,
    partOfSpeech: normalizePartOfSpeech(input.partOfSpeech ?? input.classification),
    collocations: normalizeStringArray(input.collocations),
    examples: normalizeStringArray(input.examples),
    synonyms: normalizeSynonyms(input.synonyms),
    locations,
    sourceId: requestLocation.sourceId,
    branchId: requestLocation.branchId,
    unitId: requestLocation.unitId,
    image: options.image || null,
    pronunciation: normalizePronunciationRecord(input.pronunciation || options.pronunciation),
    thesaurus: normalizeThesaurusRecord(input.thesaurus || options.thesaurus),
    createdAt: options.createdAt || nowIso(),
    updatedAt: options.updatedAt || options.createdAt || nowIso()
  };
  syncPrimaryLocation(normalized);
  return normalized;
}

function normalizeLookupCandidateWord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "Lookup word payload is required");
  }

  return {
    word: cleanName(
      stringValue(input.entryWord) ||
        stringValue(input.headword) ||
        stringValue(input.word) ||
        stringValue(input.query),
      "Lookup word is required"
    ),
    definition: cleanName(input.definition, "Lookup definition is required"),
    partOfSpeech: input.partOfSpeech,
    collocations: normalizeStringArray(input.collocations),
    examples: normalizeStringArray(input.examples),
    synonyms: normalizeSynonyms(input.synonyms),
    thesaurus: normalizeThesaurusRecord(input.thesaurus)
  };
}

function parseVerbImportItems(body) {
  const value = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : body?.verbs;
  const items = Array.isArray(value) ? value : body && typeof body === "object" ? [body] : [];
  if (!items.length) throw httpError(400, "Paste one verb or a list of verbs as JSON first");
  return items;
}

function normalizeVerb(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "Verb payload is required");
  }

  const base = cleanName(
    input.base ?? input.verb ?? input.word ?? input.infinitive,
    "Verb is required"
  );
  const createdAt = options.createdAt || nowIso();
  const past = normalizeVerbForms(input.past || input.simplePast || input.pastSimple || input.pastTense);
  const pastParticiple = normalizeVerbForms(input.pastParticiple || input.participle || input.pp);
  const thirdPerson = normalizeVerbForms(input.thirdPerson || input.thirdPersonSingular);
  const presentParticiple = normalizeVerbForms(input.presentParticiple || input.ing);
  const forms = uniqueStrings([
    base,
    ...normalizeVerbForms(input.forms),
    ...normalizeVerbForms(input.inflections),
    ...past,
    ...pastParticiple,
    ...thirdPerson,
    ...presentParticiple
  ]);

  return {
    id: options.id || stringValue(input.id) || `verb_${randomUUID()}`,
    base,
    past,
    pastParticiple,
    thirdPerson,
    presentParticiple,
    forms,
    note: stringValue(input.note),
    createdAt,
    updatedAt: options.updatedAt || options.createdAt || createdAt
  };
}

function normalizeVerbForms(value) {
  if (Array.isArray(value)) {
    return value.flatMap(item => normalizeVerbForms(item));
  }
  if (typeof value === "string") {
    return value.split(/\r?\n|;|,/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeStoredVerb(input) {
  if (!input || typeof input !== "object") return null;
  try {
    const createdAt = validIso(input.createdAt) || nowIso();
    return normalizeVerb(input, {
      id: stringValue(input.id) || `verb_${randomUUID()}`,
      createdAt,
      updatedAt: validIso(input.updatedAt) || createdAt
    });
  } catch {
    return null;
  }
}

function findVerbByBase(verbs, base, exceptId = "") {
  const key = wordKey(base);
  return (verbs || []).find(verb => verb.id !== exceptId && wordKey(verb.base) === key) || null;
}

function mergeVerbIntoExisting(target, incoming) {
  const nextPast = mergeStringValues(target.past, incoming.past);
  const nextPastParticiple = mergeStringValues(target.pastParticiple, incoming.pastParticiple);
  const nextThirdPerson = mergeStringValues(target.thirdPerson, incoming.thirdPerson);
  const nextPresentParticiple = mergeStringValues(target.presentParticiple, incoming.presentParticiple);
  const nextForms = uniqueStrings([
    target.base,
    ...normalizeStringArray(target.forms),
    ...normalizeStringArray(incoming.forms),
    ...nextPast,
    ...nextPastParticiple,
    ...nextThirdPerson,
    ...nextPresentParticiple
  ]);

  const changed = JSON.stringify(nextPast) !== JSON.stringify(target.past) ||
    JSON.stringify(nextPastParticiple) !== JSON.stringify(target.pastParticiple) ||
    JSON.stringify(nextThirdPerson) !== JSON.stringify(target.thirdPerson) ||
    JSON.stringify(nextPresentParticiple) !== JSON.stringify(target.presentParticiple) ||
    JSON.stringify(nextForms) !== JSON.stringify(target.forms) ||
    (!target.note && incoming.note);

  target.past = nextPast;
  target.pastParticiple = nextPastParticiple;
  target.thirdPerson = nextThirdPerson;
  target.presentParticiple = nextPresentParticiple;
  target.forms = nextForms;
  target.note = target.note || incoming.note;
  if (changed) {
    target.updatedAt = nowIso();
  }
  return target;
}

function uniqueVerbsById(verbs) {
  const seen = new Set();
  return (verbs || []).filter(verb => {
    if (!verb?.id || seen.has(verb.id)) return false;
    seen.add(verb.id);
    return true;
  });
}

async function normalizeAndMigrateWords(db) {
  const progress = await readPracticeProgress();
  const groups = new Map();
  let changed = false;

  db.words.forEach(rawWord => {
    const { word, changed: wordChanged } = normalizeStoredWordRecord(rawWord);
    if (!word) {
      changed = true;
      return;
    }
    changed = changed || wordChanged;
    const key = wordKey(word.word);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(word);
  });

  const mergedWords = [];
  let progressChanged = false;
  groups.forEach(words => {
    if (words.length === 1) {
      mergedWords.push(words[0]);
      return;
    }

    changed = true;
    const canonical = chooseCanonicalWord(words, progress);
    const removedIds = [];
    words.forEach(word => {
      if (word.id === canonical.id) return;
      mergeWordIntoCanonical(canonical, word);
      removedIds.push(word.id);
    });
    syncPrimaryLocation(canonical);
    mergedWords.push(canonical);
    progressChanged = remapMergedPracticeProgress(progress, canonical.id, removedIds) || progressChanged;
  });

  if (mergedWords.length !== db.words.length) changed = true;
  db.words = mergedWords;

  if (progressChanged) {
    await writePracticeProgress(progress);
  }

  return { changed, progressChanged };
}

function normalizeStoredWordRecord(input) {
  if (!input || typeof input !== "object") return { word: null, changed: true };
  const word = stringValue(input.word);
  if (!word) return { word: null, changed: true };

  const createdAt = validIso(input.createdAt) || nowIso();
  const locations = normalizeStoredWordLocations(input);
  const normalized = {
    id: stringValue(input.id) || `word_${randomUUID()}`,
    word,
    definition: stringValue(input.definition),
    arabicTranslation: stringValue(input.arabicTranslation ?? input.translationArabic ?? input.arabic) || undefined,
    partOfSpeech: normalizePartOfSpeech(input.partOfSpeech ?? input.classification),
    collocations: normalizeStringArray(input.collocations),
    examples: normalizeStringArray(input.examples),
    synonyms: normalizeSynonyms(input.synonyms),
    thesaurus: normalizeThesaurusRecord(input.thesaurus),
    locations,
    sourceId: "",
    branchId: "",
    unitId: "",
    image: normalizeStoredImage(input.image),
    pronunciation: normalizePronunciationRecord(input.pronunciation),
    createdAt,
    updatedAt: validIso(input.updatedAt) || createdAt
  };
  syncPrimaryLocation(normalized);

  const existingLocations = Array.isArray(input.locations) ? dedupeLocations(input.locations) : [];
  const changed = !Array.isArray(input.locations) ||
    locationsSignature(existingLocations) !== locationsSignature(normalized.locations) ||
    stringValue(input.sourceId) !== normalized.sourceId ||
    stringValue(input.branchId) !== normalized.branchId ||
    stringValue(input.unitId) !== normalized.unitId;

  return { word: normalized, changed };
}

function normalizeStoredImage(value) {
  if (!value || typeof value !== "object") return null;
  const filename = safeImageFilename(value.filename || path.basename(stringValue(value.url)));
  if (!filename) return null;
  return {
    filename,
    originalName: stringValue(value.originalName),
    mimeType: stringValue(value.mimeType) || "image/png",
    size: nonNegativeInteger(value.size),
    url: `/images/${filename}`
  };
}

function safeImageFilename(value) {
  const filename = path.basename(stringValue(value));
  return filename && filename === stringValue(value) ? filename : "";
}

function normalizeStoredWordLocations(word) {
  const locations = Array.isArray(word.locations) ? dedupeLocations(word.locations) : [];
  if (locations.length) return locations;
  const legacyLocation = coerceLocation(word);
  return legacyLocation.sourceId ? [legacyLocation] : [];
}

function normalizeRequestLocation(input, db) {
  const location = coerceLocation(input);
  validateLocation(db, location.sourceId, location.branchId, location.unitId);
  return location;
}

function normalizeRequestLocations(value, db) {
  if (!Array.isArray(value)) return [];
  return value.map(location => normalizeRequestLocation(location, db));
}

function coerceLocation(value = {}) {
  const sourceId = stringValue(value.sourceId);
  const branchId = sourceId ? stringValue(value.branchId) : "";
  const unitId = sourceId && branchId ? stringValue(value.unitId) : "";
  return { sourceId, branchId, unitId };
}

function wordLocations(word) {
  const locations = Array.isArray(word.locations) ? dedupeLocations(word.locations) : [];
  if (locations.length) return locations;
  const legacyLocation = coerceLocation(word);
  return legacyLocation.sourceId ? [legacyLocation] : [];
}

function dedupeLocations(locations) {
  const unique = [];
  const seen = new Set();
  (Array.isArray(locations) ? locations : []).forEach(value => {
    const location = coerceLocation(value);
    if (!location.sourceId) return;
    const key = locationKey(location);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(location);
  });
  return unique;
}

function syncPrimaryLocation(word) {
  const locations = dedupeLocations(word.locations);
  word.locations = locations;
  const primary = locations[0] || { sourceId: "", branchId: "", unitId: "" };
  word.sourceId = primary.sourceId;
  word.branchId = primary.branchId;
  word.unitId = primary.unitId;
  return word;
}

function clearWordLocations(word, predicate, replacement, updatedAt) {
  const before = locationsSignature(wordLocations(word));
  const next = [];
  wordLocations(word).forEach(location => {
    if (!predicate(location)) {
      next.push(location);
      return;
    }
    const replacementLocation = replacement(location);
    if (replacementLocation) next.push(replacementLocation);
  });
  word.locations = dedupeLocations(next);
  syncPrimaryLocation(word);
  if (locationsSignature(wordLocations(word)) !== before) {
    word.updatedAt = updatedAt;
    return true;
  }
  return false;
}

function locationKey(location) {
  return [location.sourceId, location.branchId, location.unitId].join("|");
}

function locationsSignature(locations) {
  return dedupeLocations(locations).map(locationKey).join("||");
}

function findWordByKey(words, word, exceptId = "") {
  const key = wordKey(word);
  return words.find(item => item.id !== exceptId && wordKey(item.word) === key) || null;
}

function uniqueWordsById(words) {
  const seen = new Set();
  return words.filter(word => {
    if (!word?.id || seen.has(word.id)) return false;
    seen.add(word.id);
    return true;
  });
}

function chooseCanonicalWord(words, progress) {
  return [...words].sort((a, b) => {
    const scoreDiff = canonicalWordScore(b, progress) - canonicalWordScore(a, progress);
    if (scoreDiff) return scoreDiff;
    const createdDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return createdDiff || a.id.localeCompare(b.id);
  })[0];
}

function canonicalWordScore(word, progress) {
  const record = progress.words[word.id];
  let score = record ? 10000 : 0;
  if (record) {
    score += record.correctCount * 10;
    score += record.successfulReviews * 5;
    score += record.strengthLevel * 3;
  }
  score += Math.min(stringValue(word.definition).length, 500);
  score += partOfSpeechValues(word.partOfSpeech).length * 25;
  score += (word.collocations || []).length * 10;
  score += (word.examples || []).length * 10;
  score += (word.synonyms || []).length * 10;
  score += thesaurusItemCount(word.thesaurus) * 8;
  if (word.image) score += 50;
  if (hasCachedPronunciation(word)) score += 50;
  return score;
}

function mergeWordIntoCanonical(target, incoming, options = {}) {
  const preserveExistingText = Boolean(options.preserveExistingText);
  const unusedImageFilenames = [];
  let changed = false;

  const beforeLocations = locationsSignature(wordLocations(target));
  target.locations = dedupeLocations([...wordLocations(target), ...wordLocations(incoming)]);
  syncPrimaryLocation(target);
  changed = changed || locationsSignature(wordLocations(target)) !== beforeLocations;

  const nextDefinition = preserveExistingText
    ? target.definition || incoming.definition
    : richerString(target.definition, incoming.definition);
  if (nextDefinition !== target.definition) {
    target.definition = nextDefinition;
    changed = true;
  }

  const nextArabicTranslation = preserveExistingText
    ? target.arabicTranslation || incoming.arabicTranslation
    : richerString(target.arabicTranslation, incoming.arabicTranslation);
  if (!nextArabicTranslation && !target.arabicTranslation) {
    // Leave empty translation fields absent so existing word records do not churn.
  } else if (nextArabicTranslation) {
    target.arabicTranslation = nextArabicTranslation;
    changed = true;
  } else {
    delete target.arabicTranslation;
    changed = true;
  }

  const nextPartOfSpeech = formatPartOfSpeech(mergeStringValues(
    partOfSpeechValues(target.partOfSpeech),
    partOfSpeechValues(incoming.partOfSpeech)
  ));
  if (JSON.stringify(nextPartOfSpeech) !== JSON.stringify(target.partOfSpeech)) {
    target.partOfSpeech = nextPartOfSpeech;
    changed = true;
  }

  const nextCollocations = mergeStringValues(target.collocations, incoming.collocations);
  if (JSON.stringify(nextCollocations) !== JSON.stringify(target.collocations)) {
    target.collocations = nextCollocations;
    changed = true;
  }

  const nextExamples = mergeStringValues(target.examples, incoming.examples);
  if (JSON.stringify(nextExamples) !== JSON.stringify(target.examples)) {
    target.examples = nextExamples;
    changed = true;
  }

  const nextSynonyms = mergeSynonymValues(target.synonyms, incoming.synonyms);
  if (JSON.stringify(nextSynonyms) !== JSON.stringify(target.synonyms)) {
    target.synonyms = nextSynonyms;
    changed = true;
  }

  const nextThesaurus = chooseThesaurusRecord(target.thesaurus, incoming.thesaurus);
  if (JSON.stringify(nextThesaurus) !== JSON.stringify(target.thesaurus)) {
    target.thesaurus = nextThesaurus;
    changed = true;
  }

  if (!target.image && incoming.image) {
    target.image = incoming.image;
    changed = true;
  } else if (incoming.image?.filename && incoming.image.filename !== target.image?.filename) {
    unusedImageFilenames.push(incoming.image.filename);
  }

  const pronunciation = choosePronunciation(target.pronunciation, incoming.pronunciation);
  if (JSON.stringify(pronunciation) !== JSON.stringify(target.pronunciation)) {
    target.pronunciation = pronunciation;
    changed = true;
  }

  const createdAt = earliestIsoValue(target.createdAt, incoming.createdAt) || target.createdAt;
  if (createdAt !== target.createdAt) {
    target.createdAt = createdAt;
    changed = true;
  }

  if (changed) {
    target.updatedAt = latestIsoValue(target.updatedAt, incoming.updatedAt) || nowIso();
  }

  return { changed, unusedImageFilenames };
}

function richerString(current, candidate) {
  const currentValue = stringValue(current);
  const candidateValue = stringValue(candidate);
  return candidateValue.length > currentValue.length ? candidateValue : currentValue;
}

function partOfSpeechValues(value) {
  const normalized = normalizePartOfSpeech(value);
  return Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
}

function formatPartOfSpeech(values) {
  return values.length > 1 ? values : values[0] || "";
}

function mergeStringValues(current = [], incoming = []) {
  const values = [];
  const seen = new Set();
  [...normalizeStringArray(current), ...normalizeStringArray(incoming)].forEach(value => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(value);
  });
  return values;
}

function mergeSynonymValues(current = [], incoming = []) {
  const values = [];
  const seen = new Set();
  [...normalizeSynonyms(current), ...normalizeSynonyms(incoming)].forEach(value => {
    const key = synonymKey(value);
    if (seen.has(key)) return;
    seen.add(key);
    values.push(value);
  });
  return values;
}

function synonymKey(value) {
  if (typeof value === "string") return value.toLocaleLowerCase();
  return `${stringValue(value.word).toLocaleLowerCase()}|${stringValue(value.comparison).toLocaleLowerCase()}`;
}

function choosePronunciation(current, candidate) {
  const currentRecord = normalizePronunciationRecord(current);
  const candidateRecord = normalizePronunciationRecord(candidate);
  if (!currentRecord) return candidateRecord;
  if (!candidateRecord) return currentRecord;
  if (!hasCachedPronunciation({ pronunciation: currentRecord }) && hasCachedPronunciation({ pronunciation: candidateRecord })) {
    return candidateRecord;
  }
  if (!currentRecord.exact && candidateRecord.exact) return candidateRecord;
  return currentRecord;
}

function remapMergedPracticeProgress(progress, canonicalId, removedIds) {
  if (!removedIds.length) return false;
  let changed = false;
  const ids = [canonicalId, ...removedIds];
  const records = ids.map(id => progress.words[id]).filter(Boolean);

  if (records.length) {
    const merged = mergePracticeRecords(canonicalId, records);
    if (JSON.stringify(progress.words[canonicalId]) !== JSON.stringify(merged)) {
      progress.words[canonicalId] = merged;
      changed = true;
    }
  }

  removedIds.forEach(id => {
    if (progress.words[id]) {
      delete progress.words[id];
      changed = true;
    }
  });

  if (progress.reviewSession) {
    const replacementIds = new Set(removedIds);
    ["wordIds", "dueWordIds", "weakWordIds", "newWordIds"].forEach(key => {
      const current = progress.reviewSession[key] || [];
      const remapped = dedupeIds(current.map(id => replacementIds.has(id) ? canonicalId : id));
      if (JSON.stringify(current) !== JSON.stringify(remapped)) {
        progress.reviewSession[key] = remapped;
        changed = true;
      }
    });
  }

  return changed;
}

function mergePracticeRecords(canonicalId, records) {
  const normalized = records
    .map(record => normalizePracticeRecord(record.wordId, record))
    .filter(Boolean);
  const latestRecord = [...normalized].sort((a, b) => isoTime(b.lastReviewDate) - isoTime(a.lastReviewDate))[0];
  return normalizePracticeRecord(canonicalId, {
    wordId: canonicalId,
    strengthLevel: Math.max(0, ...normalized.map(record => record.strengthLevel)),
    mistakesCount: sumNumbers(normalized, "mistakesCount"),
    successfulReviews: sumNumbers(normalized, "successfulReviews"),
    lastReviewDate: latestIsoValue(...normalized.map(record => record.lastReviewDate)),
    intervalDays: Math.max(0, ...normalized.map(record => record.intervalDays)),
    easeFactor: Math.max(MIN_EASE_FACTOR, ...normalized.map(record => record.easeFactor)),
    nextReviewDate: earliestIsoValue(...normalized.map(record => record.nextReviewDate)),
    correctCount: sumNumbers(normalized, "correctCount"),
    wrongCount: sumNumbers(normalized, "wrongCount"),
    streak: Math.max(0, ...normalized.map(record => record.streak)),
    lastResult: latestRecord?.lastResult || ""
  });
}

function sumNumbers(records, key) {
  return records.reduce((sum, record) => sum + nonNegativeInteger(record[key]), 0);
}

function dedupeIds(ids) {
  return [...new Set(ids.map(id => stringValue(id)).filter(Boolean))];
}

function isoTime(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function latestIsoValue(...values) {
  const dates = values.map(validIso).filter(Boolean);
  if (!dates.length) return "";
  return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function earliestIsoValue(...values) {
  const dates = values.map(validIso).filter(Boolean);
  if (!dates.length) return "";
  return dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function normalizeStudyText(input, db, options = {}) {
  const sourceId = stringValue(input.sourceId);
  const branchId = stringValue(input.branchId);
  const unitId = stringValue(input.unitId);
  validateLocation(db, sourceId, branchId, unitId);
  const type = normalizeStudyTextType(input.type);
  const essay = type === "essay" ? normalizeEssayFields(input.essay) : null;
  const submittedContent = studyTextContent(input.content);
  const generatedEssayContent = type === "essay" && essayHasContent(essay) ? essayContentFromFields(essay) : "";
  const content = type === "essay" && essayHasContent(essay)
    ? richerEssayContent(generatedEssayContent, submittedContent)
    : submittedContent;

  const text = {
    id: options.id || `text_${randomUUID()}`,
    title: cleanName(input.title, "Study text title is required"),
    type,
    content,
    sourceId,
    branchId,
    unitId,
    createdAt: options.createdAt || nowIso(),
    updatedAt: options.updatedAt || options.createdAt || nowIso()
  };
  if (essay) text.essay = essay;
  return text;
}

function normalizeStoredStudyText(input) {
  if (!input || typeof input !== "object") return null;
  const createdAt = validIso(input.createdAt) || nowIso();
  const type = normalizeStudyTextType(input.type);
  const essay = type === "essay" ? normalizeEssayFields(input.essay) : null;
  const content = studyTextContent(input.content) || (essayHasContent(essay) ? essayContentFromFields(essay) : "");
  const text = {
    id: stringValue(input.id) || `text_${randomUUID()}`,
    title: stringValue(input.title) || "Untitled text",
    type,
    content,
    sourceId: stringValue(input.sourceId),
    branchId: stringValue(input.branchId),
    unitId: stringValue(input.unitId),
    createdAt,
    updatedAt: validIso(input.updatedAt) || createdAt
  };
  if (essay) text.essay = essay;
  return text;
}

function normalizeStudyTextType(value) {
  const type = stringValue(value).toLocaleLowerCase();
  return STUDY_TEXT_TYPES.has(type) ? type : "note";
}

function studyTextContent(value) {
  return typeof value === "string" ? value.trim() : "";
}

function contentWordCount(value) {
  return stringValue(value).split(/\s+/).filter(Boolean).length;
}

function richerEssayContent(generated, submitted) {
  const generatedText = studyTextContent(generated);
  const submittedText = studyTextContent(submitted);
  if (!generatedText) return submittedText;
  if (!submittedText) return generatedText;
  return contentWordCount(submittedText) > contentWordCount(generatedText) ? submittedText : generatedText;
}

function normalizeEssayFields(value) {
  const fields = value && typeof value === "object" ? value : {};
  const bodyParagraphs = normalizeEssayBodyParagraphs(fields);
  return {
    sources: stringValue(fields.sources),
    plan: stringValue(fields.plan),
    hook: stringValue(fields.hook || fields.introduction),
    thesis: stringValue(fields.thesis),
    bodyParagraphCount: normalizeEssayBodyParagraphCount(fields.bodyParagraphCount, bodyParagraphs.length),
    bodyParagraphs,
    conclusion: stringValue(fields.conclusion)
  };
}

function normalizeEssayBodyParagraphCount(value, fallback = ESSAY_BODY_PARAGRAPH_MIN) {
  const parsed = Number.parseInt(value, 10);
  const count = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(ESSAY_BODY_PARAGRAPH_MAX, Math.max(ESSAY_BODY_PARAGRAPH_MIN, count));
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
  const supportSource = savedSupports.some(essaySupportHasContent)
    ? savedSupports
    : essaySupportHasContent(legacySupport)
      ? [legacySupport]
      : savedSupports;
  const supportCount = normalizeEssaySupportCount(paragraph.supportCount, supportSource.length || ESSAY_SUPPORT_MIN);
  const firstSupport = Array.from({ length: supportCount }, (_, index) => normalizeEssaySupport(supportSource[index] || {}))[0] || normalizeEssaySupport();
  return {
    idea: stringValue(paragraph.idea || paragraph.topicSentence),
    sourceExample: stringValue(paragraph.sourceExample || paragraph.supportExample || firstSupport.source || firstSupport.ownWords || paragraph.supportSource),
    anotherReason: stringValue(paragraph.anotherReason || paragraph.secondExample || paragraph.explain || firstSupport.comment || paragraph.supportComment),
    wrapUp: stringValue(paragraph.wrapUp || paragraph.bodyConclusion)
  };
}

function normalizeEssaySupportCount(value, fallback = ESSAY_SUPPORT_MIN) {
  const parsed = Number.parseInt(value, 10);
  const count = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(ESSAY_SUPPORT_MAX, Math.max(ESSAY_SUPPORT_MIN, count));
}

function normalizeEssaySupport(value = {}) {
  const support = value && typeof value === "object" ? value : {};
  return {
    ownWords: stringValue(support.ownWords || support.supportOwn),
    source: stringValue(support.source || support.supportSource),
    comment: stringValue(support.comment || support.supportComment || support.yourWords)
  };
}

function essaySupportHasContent(support = {}) {
  return ESSAY_SUPPORT_FIELDS.some(key => stringValue(support[key]));
}

function essayBodyParagraphHasContent(paragraph = {}) {
  return ESSAY_BODY_PARAGRAPH_FIELDS.some(key => stringValue(paragraph[key]))
    || Boolean(stringValue(paragraph.topicSentence))
    || Boolean(stringValue(paragraph.explain))
    || Boolean(stringValue(paragraph.bodyConclusion))
    || (Array.isArray(paragraph.supports) && paragraph.supports.some(essaySupportHasContent))
    || Boolean(stringValue(paragraph.supportOwn))
    || Boolean(stringValue(paragraph.supportSource))
    || Boolean(stringValue(paragraph.supportComment));
}

function normalizeEssayBodyParagraphs(fields = {}) {
  const savedParagraphs = Array.isArray(fields.bodyParagraphs)
    ? fields.bodyParagraphs.map(normalizeEssayBodyParagraph)
    : [];
  const hasSavedParagraphContent = savedParagraphs.some(essayBodyParagraphHasContent);
  const legacyParagraph = normalizeEssayBodyParagraph({
    idea: fields.idea || fields.topicSentence,
    sourceExample: fields.sourceExample || fields.supportSource || fields.research,
    anotherReason: fields.anotherReason || fields.explain || fields.supportOwn || fields.supportComment || fields.body,
    wrapUp: fields.wrapUp || fields.bodyConclusion
  });
  const sourceParagraphs = hasSavedParagraphContent
    ? savedParagraphs
    : essayBodyParagraphHasContent(legacyParagraph)
      ? [legacyParagraph]
      : savedParagraphs;
  const count = normalizeEssayBodyParagraphCount(fields.bodyParagraphCount, sourceParagraphs.length || ESSAY_BODY_PARAGRAPH_MIN);
  return Array.from({ length: count }, (_, index) => normalizeEssayBodyParagraph(sourceParagraphs[index] || {}));
}

function essayHasContent(essay) {
  return Boolean(essay && (
    stringValue(essay.sources) ||
    stringValue(essay.plan) ||
    stringValue(essay.hook) ||
    stringValue(essay.thesis) ||
    stringValue(essay.conclusion) ||
    (Array.isArray(essay.bodyParagraphs) && essay.bodyParagraphs.some(essayBodyParagraphHasContent))
  ));
}

function essayIntroductionContent(essay) {
  return [
    stringValue(essay?.hook),
    stringValue(essay?.thesis)
  ].filter(Boolean).join("\n\n");
}

function essayBodyContent(essay) {
  const paragraphs = Array.isArray(essay?.bodyParagraphs) && essay.bodyParagraphs.length
    ? essay.bodyParagraphs
    : [normalizeEssayBodyParagraph({
      idea: essay?.idea || essay?.topicSentence,
      sourceExample: essay?.sourceExample || essay?.supportSource,
      anotherReason: essay?.anotherReason || essay?.explain || essay?.supportOwn || essay?.supportComment,
      wrapUp: essay?.wrapUp || essay?.bodyConclusion
    })];
  return paragraphs
    .map(paragraph => {
      const normalized = normalizeEssayBodyParagraph(paragraph);
      return [
        normalized.idea,
        normalized.sourceExample,
        normalized.anotherReason,
        normalized.wrapUp
      ]
        .map(value => stringValue(value))
        .filter(Boolean)
        .join("\n\n");
    })
      .filter(Boolean)
    .join("\n\n");
}

function essaySourcesContent(essay) {
  return stringValue(essay?.sources);
}

function essaySourcesBlockContent(essay) {
  const sources = essaySourcesContent(essay);
  return sources ? `Sources/Criticism\n\n${sources}` : "";
}

function essayContentFromFields(essay) {
  return [
    essayIntroductionContent(essay),
    essayBodyContent(essay),
    essay.conclusion,
    essaySourcesBlockContent(essay)
  ]
    .map(value => stringValue(value))
    .filter(Boolean)
    .join("\n\n");
}

function normalizeStudyVideo(input, db, options = {}) {
  const sourceId = stringValue(input.sourceId);
  const branchId = stringValue(input.branchId);
  const unitId = stringValue(input.unitId);
  validateLocation(db, sourceId, branchId, unitId);
  const video = normalizeStudyVideoFile(options.video || input.video);
  if (!video) throw httpError(400, "Video file is required");

  return {
    id: options.id || `video_${randomUUID()}`,
    title: cleanName(input.title, "Study video title is required"),
    type: normalizeStudyVideoType(input.type),
    sourceId,
    branchId,
    unitId,
    video,
    createdAt: options.createdAt || nowIso(),
    updatedAt: options.updatedAt || options.createdAt || nowIso()
  };
}

function normalizeStoredStudyVideo(input) {
  if (!input || typeof input !== "object") return null;
  const video = normalizeStudyVideoFile(input.video);
  if (!video) return null;
  const createdAt = validIso(input.createdAt) || nowIso();
  return {
    id: stringValue(input.id) || `video_${randomUUID()}`,
    title: stringValue(input.title) || "Untitled video",
    type: normalizeStudyVideoType(input.type),
    sourceId: stringValue(input.sourceId),
    branchId: stringValue(input.branchId),
    unitId: stringValue(input.unitId),
    video,
    createdAt,
    updatedAt: validIso(input.updatedAt) || createdAt
  };
}

function normalizeStudyVideoType(value) {
  const type = stringValue(value).toLocaleLowerCase();
  return STUDY_VIDEO_TYPES.has(type) ? type : "assignment";
}

function normalizeStudyVideoFile(value) {
  if (!value || typeof value !== "object") return null;
  const filename = safeVideoFilename(value.filename);
  if (!filename) return null;
  return {
    filename,
    originalName: stringValue(value.originalName),
    mimeType: stringValue(value.mimeType) || "video/webm",
    size: nonNegativeInteger(value.size),
    url: `/videos/${filename}`
  };
}

function normalizeNationalTest(input, options = {}) {
  if (!input || typeof input !== "object") return null;
  const pdf = normalizeNationalTestPdf(input.pdf || options.pdf);
  if (!pdf) return null;
  const createdAt = validIso(input.createdAt) || options.createdAt || nowIso();
  const lockedAt = validIso(input.lockedAt);
  const readyAt = validIso(input.readyAt);
  const finishedAt = validIso(input.finishedAt);
  const sourceId = stringValue(input.sourceId);
  const branchId = stringValue(input.branchId);
  const sections = normalizeNationalTestSections(input.sections, sourceId, branchId);
  const listeningMedia = normalizeNationalTestListeningMedia(input.listeningMedia);
  const normalized = {
    id: stringValue(input.id) || options.id || `test_${randomUUID()}`,
    title: stringValue(input.title) || "Untitled national test",
    course: stringValue(input.course) || "English 6",
    term: stringValue(input.term),
    year: stringValue(input.year),
    description: stringValue(input.description),
    sourceId,
    branchId,
    sections,
    pdf,
    listeningMedia,
    createdAt,
    updatedAt: validIso(input.updatedAt) || options.updatedAt || createdAt
  };
  if (lockedAt) normalized.lockedAt = lockedAt;
  if (readyAt) normalized.readyAt = readyAt;
  if (finishedAt) normalized.finishedAt = finishedAt;
  return normalized;
}

function normalizeNationalTestSections(value, sourceId = "", branchId = "") {
  const incoming = Array.isArray(value) ? value : [];
  return NATIONAL_TEST_SECTIONS.map(section => {
    const match = incoming.find(item => {
      const key = canonicalNationalTestSectionKey(item?.key);
      const name = canonicalNationalTestSectionKey(item?.name);
      return key === section.key || name === section.key || name === section.name.toLocaleLowerCase();
    }) || {};
    return {
      id: stringValue(match.id) || `section_${section.key}`,
      key: section.key,
      name: section.name,
      sourceId: stringValue(match.sourceId) || sourceId,
      branchId: stringValue(match.branchId) || branchId,
      unitId: stringValue(match.unitId)
    };
  });
}

function normalizeNationalTestPdf(value) {
  if (!value || typeof value !== "object") return null;
  const filename = safeNationalTestFilename(value.filename);
  if (!filename) return null;
  return {
    filename,
    originalName: stringValue(value.originalName),
    mimeType: stringValue(value.mimeType) || "application/pdf",
    size: nonNegativeInteger(value.size),
    url: `/national-tests/${filename}`
  };
}

function normalizeNationalTestListeningMedia(value) {
  const audio = normalizeNationalTestListeningAudio(value?.audio || value?.listeningAudio);
  const transcript = normalizeNationalTestTranscript(value?.transcript || value?.listeningTranscript);
  const topics = Array.isArray(value?.topics)
    ? value.topics.map(normalizeNationalTestListeningTopicMedia).filter(Boolean)
    : [];
  return { audio, transcript, topics };
}

function normalizeNationalTestListeningTopicMedia(value) {
  if (!value || typeof value !== "object") return null;
  const key = normalizedListeningTopicKey(value.key || value.topicKey || value.label || value.topicLabel);
  if (!key) return null;
  const pageIds = normalizeListeningMediaPageIds(value.pageIds || value.pages);
  const audio = normalizeNationalTestListeningAudio(value.audio || value.listeningAudio);
  const transcript = normalizeNationalTestTranscript(value.transcript || value.listeningTranscript);
  const rawGroups = Array.isArray(value.mediaGroups)
    ? value.mediaGroups
    : Array.isArray(value.fileSets)
      ? value.fileSets
      : [];
  const mediaGroups = rawGroups
    .map((group, index) => normalizeNationalTestListeningMediaGroup(group, `group-${index + 1}`))
    .filter(Boolean);
  if (!mediaGroups.length && (audio || transcript)) {
    const legacyGroup = normalizeNationalTestListeningMediaGroup({
      id: value.mediaGroupId || "legacy",
      pageIds,
      audio,
      transcript
    }, "legacy");
    if (legacyGroup) mediaGroups.push(legacyGroup);
  }
  const firstGroup = mediaGroups[0] || {};
  return {
    key,
    label: stringValue(value.label || value.topicLabel) || key,
    pageIds: pageIds.length ? pageIds : firstGroup.pageIds || [],
    audio: audio || firstGroup.audio || null,
    transcript: transcript || firstGroup.transcript || null,
    mediaGroups
  };
}

function normalizeNationalTestListeningMediaGroup(value, fallbackId = "") {
  if (!value || typeof value !== "object") return null;
  const audio = normalizeNationalTestListeningAudio(value.audio || value.listeningAudio);
  const transcript = normalizeNationalTestTranscript(value.transcript || value.listeningTranscript);
  if (!audio && !transcript) return null;
  return {
    id: stringValue(value.id || value.groupId || value.mediaGroupId) || fallbackId || `media_${randomUUID()}`,
    pageIds: normalizeListeningMediaPageIds(value.pageIds || value.pages),
    audio,
    transcript
  };
}

function normalizeListeningMediaPageIds(value) {
  let rawValues = value;
  if (typeof value === "string") {
    try {
      rawValues = JSON.parse(value);
    } catch {
      rawValues = value.split(",").map(item => item.replace(/^[\s"'[\]]+|[\s"'[\]]+$/g, ""));
    }
  }
  if (!Array.isArray(rawValues)) return [];
  return [...new Set(rawValues.map(item => stringValue(item)).filter(Boolean))];
}

function normalizeNationalTestListeningAudio(value) {
  if (!value || typeof value !== "object") return null;
  const filename = safeListeningAudioFilename(value.filename);
  if (!filename) return null;
  return {
    filename,
    originalName: stringValue(value.originalName),
    mimeType: stringValue(value.mimeType) || listeningAudioMimeType(filename),
    size: nonNegativeInteger(value.size),
    url: listeningAudioUrl(filename, value.url)
  };
}

function normalizeNationalTestTranscript(value) {
  if (!value || typeof value !== "object") return null;
  const filename = safeNationalTestTranscriptFilename(value.filename);
  if (!filename) return null;
  return {
    filename,
    originalName: stringValue(value.originalName),
    mimeType: stringValue(value.mimeType) || "application/pdf",
    size: nonNegativeInteger(value.size),
    url: listeningTranscriptUrl(filename, value.url)
  };
}

function nationalTestListeningMediaTopicFromBody(value) {
  const key = normalizedListeningTopicKey(value?.topicKey);
  if (!key) return null;
  return {
    key,
    label: stringValue(value?.topicLabel) || key
  };
}

function nationalTestListeningTopicMedia(media, topicKey) {
  const normalizedKey = normalizedListeningTopicKey(topicKey);
  return normalizeNationalTestListeningMedia(media).topics.find(topic => topic.key === normalizedKey) || {};
}

function nationalTestListeningTopicMediaGroup(media, topicKey, mediaGroupId) {
  const normalizedGroupId = stringValue(mediaGroupId);
  if (!normalizedGroupId) return {};
  const topic = nationalTestListeningTopicMedia(media, topicKey);
  return (topic.mediaGroups || []).find(group => group.id === normalizedGroupId) || {};
}

function nationalTestListeningTopicMediaGroupByPages(media, topicKey, pageIds) {
  const topic = nationalTestListeningTopicMedia(media, topicKey);
  return (topic.mediaGroups || []).find(group => sameListeningMediaPages(group.pageIds, pageIds)) || {};
}

function previousGroupHasFiles(group) {
  return Boolean(group?.audio || group?.transcript);
}

function upsertNationalTestListeningTopicMedia(media, topic, nextMedia) {
  const normalized = normalizeNationalTestListeningMedia(media);
  const index = normalized.topics.findIndex(item => item.key === topic.key);
  const previousTopic = index === -1 ? {} : normalized.topics[index];
  const groups = Array.isArray(previousTopic.mediaGroups) ? [...previousTopic.mediaGroups] : [];
  const groupId = stringValue(nextMedia.groupId);
  const groupIndexById = groupId ? groups.findIndex(group => group.id === groupId) : -1;
  const groupIndexByPages = groups.findIndex(group => sameListeningMediaPages(group.pageIds, nextMedia.pageIds));
  const groupIndex = groupIndexById === -1 ? groupIndexByPages : groupIndexById;
  const previousGroup = groupIndex === -1 ? {} : groups[groupIndex];
  const nextGroup = normalizeNationalTestListeningMediaGroup({
    id: groupId || `media_${randomUUID()}`,
    pageIds: nextMedia.pageIds || previousGroup.pageIds || previousTopic.pageIds || [],
    audio: Object.hasOwn(nextMedia, "audio") ? nextMedia.audio : previousGroup.audio,
    transcript: Object.hasOwn(nextMedia, "transcript") ? nextMedia.transcript : previousGroup.transcript
  });
  if (nextGroup) {
    if (groupIndex === -1) {
      groups.push(nextGroup);
    } else {
      groups[groupIndex] = nextGroup;
    }
  } else if (groupIndex !== -1) {
    groups.splice(groupIndex, 1);
  }
  const nextGroups = dedupeListeningMediaGroups(groups);
  const nextTopic = normalizeNationalTestListeningTopicMedia({
    key: topic.key,
    label: topic.label,
    mediaGroups: nextGroups
  });
  if (nextTopic && (nextTopic.mediaGroups.length || nextTopic.audio || nextTopic.transcript)) {
    if (index === -1) {
      normalized.topics.push(nextTopic);
    } else {
      normalized.topics[index] = nextTopic;
    }
  } else if (index !== -1) {
    normalized.topics.splice(index, 1);
  }
  return normalized;
}

function sameListeningMediaPages(left, right) {
  const leftIds = normalizeListeningMediaPageIds(left).slice().sort();
  const rightIds = normalizeListeningMediaPageIds(right).slice().sort();
  return Boolean(leftIds.length || rightIds.length) &&
    leftIds.length === rightIds.length &&
    leftIds.every((value, index) => value === rightIds[index]);
}

function dedupeListeningMediaGroups(groups = []) {
  const byPages = new Map();
  groups.forEach(group => {
    if (!group?.audio && !group?.transcript) return;
    const key = normalizeListeningMediaPageIds(group.pageIds).slice().sort().join("|") || group.id;
    byPages.set(key, group);
  });
  return [...byPages.values()];
}

function normalizeStoredNationalTestPage(input) {
  return normalizeNationalTestPage(input);
}

function parseNationalTestPageReference(input, options = {}) {
  const pagePart = normalizeNationalTestPagePart(
    options.pagePart ?? input?.pagePart ?? input?.part ?? input?.segment
  );
  const candidates = [
    options.pageLabel,
    input?.pageLabel,
    input?.pageRef,
    input?.pageKey,
    input?.label,
    options.pageNumber,
    input?.pdfPage,
    input?.pageNumber,
    input?.page?.pageNumber,
    input?.page,
    input?.number
  ];

  for (const candidate of candidates) {
    const parsed = parseNationalTestPageReferenceValue(candidate);
    if (!parsed?.pageNumber) continue;
    return {
      pageNumber: parsed.pageNumber,
      pagePart: pagePart || parsed.pagePart || 0
    };
  }

  return null;
}

function parseNationalTestPageReferenceValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalizedText = text
    .replace(/^(?:pdf\s*)?(?:page|p)\.?\s*[-#:]*\s*/i, "")
    .trim();

  const splitMatch = normalizedText.match(/^(\d+)\s*-\s*(\d+)$/);
  if (splitMatch) {
    return {
      pageNumber: Number(splitMatch[1]),
      pagePart: Number(splitMatch[2])
    };
  }

  const pageNumber = positiveInteger(normalizedText);
  return pageNumber ? { pageNumber, pagePart: 0 } : null;
}

function normalizeNationalTestPage(input, options = {}) {
  if (!input || typeof input !== "object") return null;
  const testId = stringValue(options.testId || input.testId);
  const reference = parseNationalTestPageReference(input, options);
  const pageNumber = reference?.pageNumber;
  if (!testId || !pageNumber) return null;
  const pagePart = normalizeNationalTestPagePart(options.pagePart ?? input.pagePart ?? reference?.pagePart);
  const sortOrder = positiveInteger(options.sortOrder ?? input.sortOrder ?? input.order, pageNumber);
  const createdAt = validIso(input.createdAt) || options.createdAt || nowIso();
  const normalized = {
    id: stringValue(options.id || input.id) || `test_page_${randomUUID()}`,
    testId,
    pageNumber,
    sortOrder,
    extractedText: normalizeNationalTestPageExtractedText(input),
    createdAt,
    updatedAt: validIso(input.updatedAt) || options.updatedAt || createdAt
  };
  if (pagePart) normalized.pagePart = pagePart;
  const rawPageLayout = input.pageLayout || pageLayoutFromPageInput(input.sourceContainer) || pageLayoutFromPageInput(input);
  const pageLayout = normalizeNationalTestPageLayout(rawPageLayout, input, {
    createId: prefix => `${prefix}_${randomUUID()}`
  });
  const title = stringValue(input.title);
  const section = normalizeNationalTestPageSection(input.section) || inferNationalTestPageSectionFromTitle(title);
  const topic = normalizeNationalTestPageTopic(input.topic);
  const words = normalizeNationalTestPageWords(input.words || input.savedWords);
  const answers = normalizeNationalTestPageAnswers(
    looksLikeOfficialAnswerImportCollection(input.answers) ? input.savedAnswers : (input.answers || input.savedAnswers)
  );
  const questions = normalizeNationalTestPageQuestions(
    officialQuestionInputsFromNationalTestPageImport(input),
    { pageNumber, pagePart, pageLayout }
  );
  const translations = normalizeNationalTestPageTranslations(input.translations || input.pageTranslations);
  if (pageLayout) normalized.pageLayout = pageLayout;
  if (section) normalized.section = section;
  if (topic) normalized.topic = topic;
  if (title) normalized.title = title;
  if (words.length) normalized.words = words;
  if (answers.length) normalized.answers = answers;
  if (questions.length) normalized.questions = questions;
  const passageId = stringValue(input.passageId || input.passageKey || input.textId);
  if (passageId) normalized.passageId = passageId;
  const sourcePages = normalizeNationalTestQuestionSourcePages(input.sourcePages || input.readingPages);
  if (sourcePages.length) normalized.sourcePages = sourcePages;
  const sourceSelection = normalizeNationalTestPageSourceSelection(input.sourceSelection);
  if (sourceSelection) normalized.sourceSelection = sourceSelection;
  const sourceProcessing = normalizeNationalTestPageSourceProcessing(input.sourceProcessing);
  if (sourceProcessing) normalized.sourceProcessing = sourceProcessing;
  const englishExtraction = normalizeNationalTestPageEnglishExtraction(input.englishExtraction);
  if (englishExtraction) normalized.englishExtraction = englishExtraction;
  const sourceContainer = normalizeNationalTestPageSourceContainer(input.sourceContainer);
  if (sourceContainer) normalized.sourceContainer = sourceContainer;
  const studyDocument = normalizeNationalTestPageStudyDocument(input.studyDocument);
  if (studyDocument) normalized.studyDocument = studyDocument;
  const sourcePage = normalizeNationalTestPageSourcePage(input.sourcePage);
  if (sourcePage) normalized.sourcePage = sourcePage;
  const normalizedPage = normalizeNationalTestPageNormalizedPage(input.normalizedPage);
  if (normalizedPage) normalized.normalizedPage = normalizedPage;
  const sourceImages = normalizeNationalTestPageSourceImages(input.sourceImages);
  if (sourceImages.length) normalized.sourceImages = sourceImages;
  if (Object.keys(translations).length) normalized.translations = translations;
  const lockedAt = validIso(input.lockedAt);
  if (lockedAt) normalized.lockedAt = lockedAt;
  const finishedAt = validIso(input.finishedAt);
  if (finishedAt) normalized.finishedAt = finishedAt;
  return normalized;
}

function normalizeNationalTestPageSourceSelection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const mode = ["whole", "detected", "manual"].includes(stringValue(value.mode))
    ? stringValue(value.mode)
    : "manual";
  const rawCrop = value.crop && typeof value.crop === "object" ? value.crop : value;
  const clampRatio = input => Math.max(0, Math.min(1, Number(input) || 0));
  const x = clampRatio(rawCrop.x);
  const y = clampRatio(rawCrop.y);
  const width = Math.min(1 - x, clampRatio(rawCrop.width));
  const height = Math.min(1 - y, clampRatio(rawCrop.height));
  if (width <= 0 || height <= 0) return null;
  return {
    mode,
    crop: { x, y, width, height },
    confirmedAt: validIso(value.confirmedAt) || nowIso()
  };
}

function normalizeNationalTestPageSourceProcessing(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const clamp = (input, minimum, maximum, fallback) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  };
  const preset = ["original", "clean", "grayscale", "high-contrast", "black-white", "custom"].includes(stringValue(value.preset))
    ? stringValue(value.preset)
    : "clean";
  return {
    preset,
    rotation: clamp(value.rotation, -15, 15, 0),
    brightness: clamp(value.brightness, 60, 160, 100),
    contrast: clamp(value.contrast, 60, 220, 110),
    sharpen: clamp(value.sharpen, 0, 3, 1),
    updatedAt: validIso(value.updatedAt) || nowIso()
  };
}

function normalizeNationalTestPageEnglishExtraction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pageStructure = normalizeNationalTestPageStructure(value.pageStructure);
  const evidence = normalizeNationalTestPageExtractionEvidence(value.evidence);
  const items = (Array.isArray(value.items) ? value.items : [])
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const text = stringValue(item.text);
      if (!text) return null;
      const role = stringValue(item.role) || "paragraph";
      const confidence = Math.max(0, Math.min(100, Number(item.confidence) || 0));
      const bbox = item.bbox && typeof item.bbox === "object" ? {
        x: Math.max(0, Math.min(1, Number(item.bbox.x) || 0)),
        y: Math.max(0, Math.min(1, Number(item.bbox.y) || 0)),
        width: Math.max(0, Math.min(1, Number(item.bbox.width) || 0)),
        height: Math.max(0, Math.min(1, Number(item.bbox.height) || 0))
      } : null;
      const uncertainWords = (Array.isArray(item.uncertainWords) ? item.uncertainWords : [])
        .slice(0, 100)
        .map(word => ({
          text: stringValue(word?.text),
          confidence: Math.max(0, Math.min(100, Number(word?.confidence) || 0)),
          candidates: normalizeStringArray(word?.candidates).slice(0, 5)
        }))
        .filter(word => word.text);
      const gaps = (Array.isArray(item.gaps) ? item.gaps : []).slice(0, 20).map(gap => ({
        x: Math.max(0, Math.min(1, Number(gap?.x) || 0)),
        width: Math.max(0, Math.min(1, Number(gap?.width) || 0))
      })).filter(gap => gap.width > 0);
      return {
        id: stringValue(item.id) || `extracted-${index + 1}`,
        role,
        text,
        rawText: stringValue(item.rawText) || text,
        confidence,
        needsReview: Boolean(item.needsReview || confidence < 82),
        confirmed: Boolean(item.confirmed),
        ...(bbox ? { bbox } : {}),
        ...(uncertainWords.length ? { uncertainWords } : {}),
        ...(gaps.length ? { gaps } : {})
      };
    })
    .filter(Boolean);
  if (!items.length) return null;
  return {
    source: ["pdf-text", "ocr", "combined"].includes(stringValue(value.source)) ? stringValue(value.source) : "ocr",
    language: "en",
    extractedAt: validIso(value.extractedAt) || nowIso(),
    averageConfidence: Math.max(0, Math.min(100, Number(value.averageConfidence) || 0)),
    template: ["auto", "single-column", "two-column", "questions", "mirror"].includes(stringValue(value.template))
      ? stringValue(value.template)
      : "auto",
    strategy: ["whole-page", "regional"].includes(stringValue(value.strategy)) ? stringValue(value.strategy) : "whole-page",
    regionPasses: (Array.isArray(value.regionPasses) ? value.regionPasses : []).slice(0, 20).map((region, index) => ({
      id: stringValue(region?.id) || `ocr-region-${index + 1}`,
      role: stringValue(region?.role) || "text-region",
      bbox: {
        x: Math.max(0, Math.min(1, Number(region?.bbox?.x) || 0)),
        y: Math.max(0, Math.min(1, Number(region?.bbox?.y) || 0)),
        width: Math.max(0, Math.min(1, Number(region?.bbox?.width) || 0)),
        height: Math.max(0, Math.min(1, Number(region?.bbox?.height) || 0))
      }
    })).filter(region => region.bbox.width > 0 && region.bbox.height > 0),
    ...(validIso(value.reviewedAt) ? { reviewedAt: validIso(value.reviewedAt) } : {}),
    ...(pageStructure ? { pageStructure } : {}),
    ...(evidence ? { evidence } : {}),
    items
  };
}

function normalizeNationalTestPageExtractionEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const clampRatio = input => Math.max(0, Math.min(1, Number(input) || 0));
  const bbox = input => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const x = clampRatio(input.x);
    const y = clampRatio(input.y);
    const width = Math.min(1 - x, Math.max(0, Math.min(1, Number(input.width) || 0)));
    const height = Math.min(1 - y, Math.max(0, Math.min(1, Number(input.height) || 0)));
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  };
  const confidence = input => Math.max(0, Math.min(100, Number(input) || 0));
  const textEvidence = (entry, index, fallbackPrefix) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const text = stringValue(entry.text);
    const box = bbox(entry.bbox || entry);
    if (!text || !box) return null;
    return {
      id: stringValue(entry.id) || `${fallbackPrefix}-${index + 1}`,
      text,
      bbox: box,
      confidence: confidence(entry.confidence),
      source: stringValue(entry.source),
      ...(stringValue(entry.sourceItemId) ? { sourceItemId: stringValue(entry.sourceItemId) } : {}),
      ...(stringValue(entry.lineId) ? { lineId: stringValue(entry.lineId) } : {}),
      ...(stringValue(entry.blockId) ? { blockId: stringValue(entry.blockId) } : {})
    };
  };
  const pdfTextItems = (Array.isArray(value.pdfTextItems) ? value.pdfTextItems : [])
    .slice(0, 2500)
    .map((entry, index) => textEvidence(entry, index, "pdf-text-source"))
    .filter(Boolean);
  const ocrWords = (Array.isArray(value.ocrWords) ? value.ocrWords : [])
    .slice(0, 5000)
    .map((entry, index) => textEvidence(entry, index, "ocr-word-source"))
    .filter(Boolean);
  const ocrLines = (Array.isArray(value.ocrLines) ? value.ocrLines : [])
    .slice(0, 2500)
    .map((entry, index) => textEvidence(entry, index, "ocr-line-source"))
    .filter(Boolean);
  const ocrBlocks = (Array.isArray(value.ocrBlocks) ? value.ocrBlocks : [])
    .slice(0, 1000)
    .map((entry, index) => textEvidence(entry, index, "ocr-block-source"))
    .filter(Boolean);
  const ocrCandidates = (Array.isArray(value.ocrCandidates) ? value.ocrCandidates : [])
    .slice(0, 20)
    .map((candidate, index) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
      return {
        id: stringValue(candidate.id) || `ocr-candidate-source-${index + 1}`,
        name: stringValue(candidate.name) || `OCR candidate ${index + 1}`,
        engine: stringValue(candidate.engine) || "tesseract.js",
        language: stringValue(candidate.language) || "eng",
        score: Number(candidate.score) || 0,
        averageConfidence: confidence(candidate.averageConfidence ?? candidate.confidence),
        itemCount: Math.max(0, Math.min(10000, Math.round(Number(candidate.itemCount) || 0))),
        selected: Boolean(candidate.selected),
        processing: candidate.processing && typeof candidate.processing === "object" && !Array.isArray(candidate.processing)
          ? candidate.processing
          : null
      };
    })
    .filter(Boolean);
  const normalized = {};
  if (pdfTextItems.length) normalized.pdfTextItems = pdfTextItems;
  if (ocrCandidates.length) normalized.ocrCandidates = ocrCandidates;
  if (ocrWords.length) normalized.ocrWords = ocrWords;
  if (ocrLines.length) normalized.ocrLines = ocrLines;
  if (ocrBlocks.length) normalized.ocrBlocks = ocrBlocks;
  const ocrEngine = stringValue(value.ocrEngine);
  if (ocrEngine) normalized.ocrEngine = ocrEngine;
  if (value.processing && typeof value.processing === "object" && !Array.isArray(value.processing)) {
    normalized.processing = value.processing;
  }
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeNationalTestPageStructure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = ["article", "questions", "questions-with-blanks", "fill-blanks", "mixed", "unknown"].includes(stringValue(value.type))
    ? stringValue(value.type)
    : "unknown";
  const templateHint = ["auto", "single-column", "two-column", "questions", "mirror"].includes(stringValue(value.templateHint))
    ? stringValue(value.templateHint)
    : "auto";
  const rawFeatures = value.features && typeof value.features === "object" && !Array.isArray(value.features) ? value.features : {};
  const boundedCount = input => Math.max(0, Math.min(10000, Math.round(Number(input) || 0)));
  return {
    type,
    templateHint,
    features: {
      textBlockCount: boundedCount(rawFeatures.textBlockCount),
      questionCount: boundedCount(rawFeatures.questionCount),
      optionCount: boundedCount(rawFeatures.optionCount),
      gapCount: boundedCount(rawFeatures.gapCount),
      blankTextCount: boundedCount(rawFeatures.blankTextCount),
      instructionCount: boundedCount(rawFeatures.instructionCount),
      imageCount: boundedCount(rawFeatures.imageCount),
      columnCount: Math.max(1, Math.min(8, boundedCount(rawFeatures.columnCount) || 1)),
      source: stringValue(rawFeatures.source || value.source || "unknown"),
      strategy: stringValue(rawFeatures.strategy || value.strategy || "whole-page")
    }
  };
}

function normalizeNationalTestPageSourceContainer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function normalizeNationalTestPageStudyDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return validateStudyDocumentV1(value).valid ? value : null;
}

function studyDocumentNodeById(document, nodeId) {
  const targetId = stringValue(nodeId);
  let match = null;
  const visit = nodes => {
    (Array.isArray(nodes) ? nodes : []).some(node => {
      if (!node || typeof node !== "object") return false;
      if (node.id === targetId) {
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

function normalizedStudyDocumentGraphicCrop(value) {
  let crop = value;
  if (typeof value === "string") {
    try {
      crop = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!crop || typeof crop !== "object" || Array.isArray(crop)) return null;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) return null;
  return { x, y, width, height };
}

function normalizeNationalTestPageSourcePage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const filename = path.basename(stringValue(value.filename));
  const url = stringValue(value.url);
  const pixelWidth = positiveInteger(value.pixelWidth);
  const pixelHeight = positiveInteger(value.pixelHeight);
  if (!filename || !url || !pixelWidth || !pixelHeight) return null;
  const crop = value.sourceCrop && typeof value.sourceCrop === "object" ? value.sourceCrop : {};
  const x = Math.max(0, Math.min(1, Number(crop.x) || 0));
  const y = Math.max(0, Math.min(1, Number(crop.y) || 0));
  const width = Math.min(1 - x, Math.max(0.01, Math.min(1, Number(crop.width) || 1)));
  const height = Math.min(1 - y, Math.max(0.01, Math.min(1, Number(crop.height) || 1)));
  return {
    kind: "pdf-render",
    filename,
    url,
    mimeType: stringValue(value.mimeType) || "image/jpeg",
    size: Math.max(0, Number(value.size) || 0),
    pageNumber: positiveInteger(value.pageNumber),
    pixelWidth,
    pixelHeight,
    sourceCrop: { x, y, width, height },
    capturedAt: validIso(value.capturedAt) || nowIso()
  };
}

function normalizeNationalTestPageNormalizedPage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const filename = path.basename(stringValue(value.filename));
  const url = stringValue(value.url);
  const pixelWidth = positiveInteger(value.pixelWidth);
  const pixelHeight = positiveInteger(value.pixelHeight);
  const corners = value.sourceCorners && typeof value.sourceCorners === "object" ? value.sourceCorners : {};
  const point = key => ({
    x: Math.max(0, Math.min(1, Number(corners[key]?.x) || 0)),
    y: Math.max(0, Math.min(1, Number(corners[key]?.y) || 0))
  });
  if (!filename || !url || !pixelWidth || !pixelHeight) return null;
  return {
    kind: "normalized-page",
    filename,
    url,
    mimeType: stringValue(value.mimeType) || "image/jpeg",
    size: Math.max(0, Number(value.size) || 0),
    pixelWidth,
    pixelHeight,
    sourceCorners: {
      topLeft: point("topLeft"), topRight: point("topRight"),
      bottomRight: point("bottomRight"), bottomLeft: point("bottomLeft")
    },
    transform: value.transform && typeof value.transform === "object" ? value.transform : {},
    normalizedAt: validIso(value.normalizedAt) || nowIso()
  };
}

function normalizeNationalTestPageSourceImages(value) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    if (!item || typeof item !== "object") return null;
    const crop = item.crop && typeof item.crop === "object" ? item.crop : {};
    const x = Math.max(0, Math.min(1, Number(crop.x) || 0));
    const y = Math.max(0, Math.min(1, Number(crop.y) || 0));
    const width = Math.min(1 - x, Math.max(0, Math.min(1, Number(crop.width) || 0)));
    const height = Math.min(1 - y, Math.max(0, Math.min(1, Number(crop.height) || 0)));
    if (width <= 0 || height <= 0) return null;
    const normalized = {
      id: stringValue(item.id) || `page-image-${index + 1}`,
      crop: { x, y, width, height },
      caption: stringValue(item.caption),
      accepted: Boolean(item.accepted),
      ...(stringValue(item.url) ? { url: stringValue(item.url) } : {}),
      ...(stringValue(item.filename) ? { filename: path.basename(stringValue(item.filename)) } : {})
    };
    const kind = stringValue(item.kind);
    const nodeId = stringValue(item.nodeId);
    const mimeType = stringValue(item.mimeType);
    const sourcePageIndex = nonNegativeInteger(item.sourcePageIndex);
    const pixelWidth = positiveInteger(item.pixelWidth);
    const pixelHeight = positiveInteger(item.pixelHeight);
    if (kind) normalized.kind = kind;
    if (nodeId) normalized.nodeId = nodeId;
    if (mimeType) normalized.mimeType = mimeType;
    if (Number.isFinite(Number(item.size)) && Number(item.size) >= 0) normalized.size = Number(item.size);
    if (sourcePageIndex !== null) normalized.sourcePageIndex = sourcePageIndex;
    if (pixelWidth) normalized.pixelWidth = pixelWidth;
    if (pixelHeight) normalized.pixelHeight = pixelHeight;
    return normalized;
  }).filter(Boolean);
}

function normalizeNationalTestPageTranslations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([language, record]) => {
      const normalizedLanguage = normalizeTranslationLanguage(language || record?.language);
      const normalizedRecord = normalizeNationalTestPageTranslationRecord(record, normalizedLanguage);
      return normalizedRecord ? [normalizedLanguage, normalizedRecord] : null;
    })
    .filter(Boolean));
}

function normalizeTranslationLanguage(value) {
  const language = stringValue(value).toLocaleLowerCase();
  if (language.startsWith("ar")) return "ar";
  if (language.startsWith("en")) return "en";
  return language || "ar";
}

function normalizeNationalTestPageTranslationRecord(value, language) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const studyDocumentTranslationCandidate = record.studyDocumentTranslation || (
    record.schemaVersion === "study-document-translation/v1" ? record : null
  );
  const studyDocumentTranslation = studyDocumentTranslationCandidate &&
    validateStudyDocumentTranslationV1(studyDocumentTranslationCandidate).valid
    ? studyDocumentTranslationCandidate
    : null;
  const rawItems = studyDocumentTranslation?.items || record.items || record.translations || record;
  const items = normalizeNationalTestPageTranslationItems(rawItems);
  const pageLayout = normalizeNationalTestPageTranslationLayout(record);
  const hiddenElementIds = normalizeTranslationHiddenElementIds(record);
  if (!Object.keys(items).length && !pageLayout && !hiddenElementIds.length && !studyDocumentTranslation) return null;
  const updatedAt = validIso(record.updatedAt) || nowIso();
  const normalized = {
    language,
    direction: language === "ar" ? "rtl" : "ltr",
    updatedAt,
    items
  };
  if (hiddenElementIds.length) normalized.hiddenElementIds = hiddenElementIds;
  if (pageLayout) normalized.pageLayout = pageLayout;
  if (studyDocumentTranslation) normalized.studyDocumentTranslation = studyDocumentTranslation;
  return normalized;
}

function normalizeTranslationHiddenElementIds(record) {
  const ids = new Set();
  const add = value => {
    const id = stringValue(value);
    if (id) ids.add(id);
  };
  const addMany = values => {
    (Array.isArray(values) ? values : []).forEach(add);
  };
  const collectFromItems = value => {
    (Array.isArray(value) ? value : []).forEach(item => {
      if (!item || typeof item !== "object") return;
      addMany(item.hiddenElementIds);
      addMany(item.hiddenSourceElementIds);
      addMany(item.hideElementIds);
      addMany(item.hideSourceElementIds);
      collectFromItems(item.elements);
      collectFromItems(item.blocks);
    });
  };
  addMany(record?.hiddenElementIds);
  addMany(record?.hiddenSourceElementIds);
  addMany(record?.hideElementIds);
  addMany(record?.hideSourceElementIds);
  collectFromItems(record?.items);
  collectFromItems(record?.blocks);
  collectFromItems(record?.elements);
  return [...ids];
}

function normalizeNationalTestPageTranslationLayout(record) {
  const rawLayout = record?.pageLayout || record?.layout || pageLayoutFromPageInput(record);
  return normalizeNationalTestPageLayout(rawLayout, record, {
    createId: prefix => `${prefix}_${randomUUID()}`
  });
}

function normalizeNationalTestPageTranslationItems(value) {
  const items = {};
  const add = (id, text) => {
    const key = stringValue(id);
    const translated = stringValue(text);
    if (key && translated) items[key] = translated;
  };
  if (Array.isArray(value)) {
    value.forEach(item => {
      if (!item || typeof item !== "object") return;
      const lineText = Array.isArray(item.lines) ? item.lines.map(stringValue).filter(Boolean).join("\n") : "";
      add(item.id || item.elementId || item.key || item.name, item.text || item.translation || item.ar || item.value || lineText);
      if (Array.isArray(item.elements)) {
        Object.assign(items, normalizeNationalTestPageTranslationItems(item.elements));
      }
      if (Array.isArray(item.blocks)) {
        Object.assign(items, normalizeNationalTestPageTranslationItems(item.blocks));
      }
    });
    return items;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([id, text]) => {
      if (["language", "direction", "updatedAt", "items", "translations", "pageLayout", "layout"].includes(id)) return;
      if (text && typeof text === "object") {
        const lineText = Array.isArray(text.lines) ? text.lines.map(stringValue).filter(Boolean).join("\n") : "";
        add(id, text.text || text.translation || text.ar || text.value || lineText);
      } else {
        add(id, text);
      }
    });
  }
  return items;
}

function normalizeNationalTestPageExtractedText(input) {
  const instructions = stringValue(input.instructions || input.instruction);
  const body = formatNationalTestTextValue(input.extractedText || input.fullText || input.text || input.content) ||
    visualPageTextFromInput(input);
  return [instructions, body].filter(Boolean).join("\n\n");
}

function visualPageTextFromInput(input) {
  const values = [];
  const pushValue = value => {
    const text = stringValue(value);
    if (text) values.push(text);
  };

  (Array.isArray(input?.readingOrder) ? input.readingOrder : []).forEach(pushValue);
  (Array.isArray(input?.elements) ? input.elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    pushValue(element.text || element.prompt || element.question || element.title || element.label);
    (Array.isArray(element.options) ? element.options : []).forEach(option => {
      const label = stringValue(option?.label);
      const text = stringValue(option?.text);
      pushValue([label, text].filter(Boolean).join(" "));
    });
  });
  (Array.isArray(input?.textBlocks) ? input.textBlocks : []).forEach(block => {
    (Array.isArray(block?.paragraphs) ? block.paragraphs : []).forEach(paragraph => pushValue(paragraph?.text));
    (Array.isArray(block?.segments) ? block.segments : []).forEach(segment => pushValue(segment?.text));
  });

  return values.filter(Boolean).join("\n\n");
}

function normalizeNationalTestPageSection(value) {
  const key = canonicalNationalTestSectionKey(value);
  const match = NATIONAL_TEST_SECTIONS.find(section =>
    section.key === key || section.name.toLocaleLowerCase() === key
  );
  return match?.key || key;
}

function normalizeNationalTestPageTopic(value) {
  return stringValue(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNationalTestPagePart(value) {
  return positiveInteger(value);
}

function canonicalNationalTestSectionKey(value) {
  const key = stringValue(value).toLocaleLowerCase();
  return NATIONAL_TEST_SECTION_ALIASES.get(key) || key;
}

function inferNationalTestPageSectionFromTitle(title) {
  const value = String(title || "")
    .toLocaleLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  if (value.includes("reading section") || value === "reading") return "reading";
  if (value.includes("writing section") || value === "writing") return "writing";
  if (value.includes("listening section") || value.includes("listining section") || value === "listening" || value === "listining") return "listening";
  if (value.includes("speaking section") || value === "speaking") return "speaking";
  return "";
}

function normalizeNationalTestPageWords(value) {
  const words = Array.isArray(value) ? value : [];
  return words.map(normalizeNationalTestPageWord).filter(Boolean);
}

function normalizeNationalTestPageWord(input) {
  const value = typeof input === "string" ? { word: input } : input;
  if (!value || typeof value !== "object") return null;
  const word = stringValue(value.word || value.text);
  if (!word) return null;
  const createdAt = validIso(value.createdAt) || nowIso();
  return {
    id: stringValue(value.id) || `page_word_${randomUUID()}`,
    word,
    note: stringValue(value.note || value.definition),
    createdAt
  };
}

function normalizeNationalTestPageAnswers(value) {
  const answers = Array.isArray(value) ? value : [];
  return answers.map(normalizeNationalTestPageAnswer).filter(Boolean);
}

function normalizeNationalTestPageAnswer(input) {
  const value = typeof input === "string" ? { answer: input } : input;
  if (!value || typeof value !== "object") return null;
  const answer = stringValue(value.answer || value.text || value.response || value.note);
  if (!answer) return null;
  const createdAt = validIso(value.createdAt) || nowIso();
  const updatedAt = validIso(value.updatedAt) || createdAt;
  const normalized = {
    id: stringValue(value.id) || `page_answer_${randomUUID()}`,
    question: normalizeNationalTestQuestionLabel(value.question || value.questionNumber || value.label),
    answer,
    createdAt,
    updatedAt
  };
  const xPercent = percentNumber(value.xPercent ?? value.x ?? value.left);
  const yPercent = percentNumber(value.yPercent ?? value.y ?? value.top);
  if (xPercent !== null && yPercent !== null) {
    normalized.xPercent = xPercent;
    normalized.yPercent = yPercent;
  }
  return normalized;
}

function officialQuestionInputsFromNationalTestPageImport(input) {
  const sources = [
    input?.questions,
    input?.officialQuestions,
    input?.officialAnswers,
    input?.answerKey,
    input?.correctAnswers,
    input?.solutions,
    input?.page?.questions,
    input?.page?.officialQuestions,
    input?.page?.answerKey,
    input?.document?.questions,
    input?.document?.answerKey
  ];
  if (looksLikeOfficialAnswerImportCollection(input?.answers)) {
    sources.push(input.answers);
  }
  if (looksLikeOfficialAnswerImportCollection(input?.page?.answers)) {
    sources.push(input.page.answers);
  }
  return sources.flatMap(normalizeOfficialQuestionInputCollection);
}

function looksLikeOfficialAnswerImportCollection(value) {
  const items = normalizeOfficialQuestionInputCollection(value);
  return items.some(item => {
    if (!item || typeof item !== "object") return false;
    if (item.value || item.targetElementId || item.answerElementId || item.promptElementId || item.optionElementIds || item.correctOption || item.correctAnswer || item.correctChoice || item.choice || item.option || item.solution) return true;
    const answer = item.answer && typeof item.answer === "object" && !Array.isArray(item.answer) ? item.answer : {};
    return Boolean(answer.value || answer.targetElementId || answer.targetId || answer.correctAnswer || answer.correctOption || answer.placement);
  });
}

function normalizeOfficialQuestionInputCollection(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeOfficialQuestionInputItem(item, index + 1)).filter(Boolean);
  }
  if (typeof value === "object") {
    if (looksLikeSingleOfficialQuestionInput(value)) {
      return [normalizeOfficialQuestionInputItem(value, value.number || value.questionNumber || value.label || 1)].filter(Boolean);
    }
    return Object.entries(value)
      .map(([key, item], index) => normalizeOfficialQuestionInputItem(item, key || index + 1))
      .filter(Boolean);
  }
  return [];
}

function looksLikeSingleOfficialQuestionInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Boolean(
    value.answer || value.value || value.correctAnswer || value.correctOption || value.correctChoice ||
    value.choice || value.option || value.solution || value.targetElementId || value.answerElementId ||
    value.optionElementIds || value.number || value.questionNumber || value.questionNo || value.q
  );
}

function normalizeOfficialQuestionInputItem(item, key) {
  const number = normalizeNationalTestQuestionLabel(key);
  if (typeof item === "string" || typeof item === "number") {
    return {
      number,
      answer: { value: stringValue(item) }
    };
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const normalized = { ...item };
  if (!normalized.number && !normalized.questionNumber && !normalized.label && number) {
    normalized.number = number;
  }
  if (!normalized.answer) {
    const answerValue = stringValue(
      normalized.value || normalized.text || normalized.correctAnswer || normalized.correctOption ||
        normalized.correctChoice || normalized.choice || normalized.option || normalized.solution
    );
    if (answerValue || normalized.targetElementId || normalized.targetId || normalized.answerElementId || normalized.placement || normalized.needsReview) {
      normalized.answer = {
        value: answerValue,
        targetElementId: normalized.targetElementId || normalized.targetId || normalized.answerElementId,
        placement: normalized.placement,
        needsReview: normalized.needsReview
      };
    }
  }
  return normalized;
}

function normalizeNationalTestPageQuestions(value, options = {}) {
  const questions = normalizeOfficialQuestionInputCollection(value);
  const usedIds = new Set();
  return questions.map((input, index) => {
    const question = normalizeNationalTestPageQuestion(input, index, options);
    if (!question) return null;
    let id = question.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${question.id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return { ...question, id };
  }).filter(Boolean);
}

function normalizeNationalTestPageQuestion(input, index, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const number = normalizeNationalTestQuestionLabel(
    input.number || input.questionNumber || input.questionNo || input.q || input.item || input.gapNumber || input.label || index + 1
  ) || String(index + 1);
  const type = normalizeNationalTestPageQuestionType(
    input.type || input.questionType || input.kind,
    input
  );
  const optionElementIds = normalizeNationalTestQuestionOptionElementIds(input.optionElementIds || input.optionIds, input.options);
  const answer = normalizeNationalTestPageOfficialAnswer(input.answer, { ...input, number, optionElementIds }, options);
  if (!answer) return null;
  const effectiveType = officialQuestionTypeForAnswerTarget(type, optionElementIds, answer);
  const generatedId = `q${String(number).toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || index + 1}`;
  const normalized = {
    id: stringValue(input.id || input.questionId) || generatedId,
    number,
    type: effectiveType,
    answer
  };
  const prompt = stringValue(input.prompt || input.question || input.text);
  const promptElementId = stringValue(input.promptElementId || input.questionElementId);
  if (prompt) normalized.prompt = prompt;
  if (promptElementId) normalized.promptElementId = promptElementId;
  if (Object.keys(optionElementIds).length) normalized.optionElementIds = optionElementIds;
  return normalized;
}

function officialQuestionTypeForAnswerTarget(type, optionElementIds = {}, answer = {}) {
  const target = stringValue(answer.targetElementId);
  if (target && Object.values(optionElementIds || {}).map(stringValue).includes(target)) return "multiple-choice";
  return type;
}

function normalizeNationalTestPageQuestionType(value, input = {}) {
  const type = stringValue(value).toLocaleLowerCase().replace(/[\s_]+/g, "-");
  if (["multiple-choice", "multiplechoice", "choice", "mcq", "select-one"].includes(type)) return "multiple-choice";
  if (["fill-gap", "fill-in", "gap", "one-word-gap", "missing-word"].includes(type)) return "fill-gap";
  if (["short-answer", "text-answer", "written-answer", "reading-answer", "free-text"].includes(type)) return "short-answer";
  if (input.optionElementIds || input.optionIds || Array.isArray(input.options) || input.correctOption || input.correctChoice || input.choice || input.option) return "multiple-choice";
  const answer = input.answer && typeof input.answer === "object" ? input.answer : {};
  if (Array.isArray(answer.acceptedValues) || Array.isArray(input.acceptedValues)) return "fill-gap";
  return "short-answer";
}

function normalizeNationalTestPageOfficialAnswer(value, question = {}, options = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const answerValue = stringValue(
    typeof value === "string" ? value :
      raw.value || raw.text || raw.answer || raw.correctAnswer || raw.correctOption ||
      raw.correctChoice || raw.choice || raw.option ||
      question.correctAnswer || question.correctOption || question.correctChoice || question.choice || question.option || question.solution
  );
  const needsReview = Boolean(raw.needsReview ?? question.needsReview);
  if (!answerValue && !needsReview) return null;
  const normalized = { value: answerValue };
  const targetElementId = stringValue(
    raw.targetElementId || raw.targetId || question.targetElementId || question.answerElementId ||
      question.optionElementIds?.[answerValue.toUpperCase()] ||
      (question.correctOption && question.optionElementIds?.[stringValue(question.correctOption).toUpperCase()]) ||
      (question.correctChoice && question.optionElementIds?.[stringValue(question.correctChoice).toUpperCase()]) ||
      inferNationalTestOfficialAnswerTargetElementId(question, answerValue, options.pageLayout)
  );
  if (targetElementId) normalized.targetElementId = targetElementId;
  const acceptedValues = uniqueStringValues(raw.acceptedValues || raw.alternatives || question.acceptedValues);
  if (acceptedValues.length) normalized.acceptedValues = acceptedValues;
  const sourceElementIds = uniqueStringValues(raw.sourceElementIds || raw.sources || question.sourceElementIds);
  if (sourceElementIds.length) normalized.sourceElementIds = sourceElementIds;
  const placement = normalizeNationalTestOfficialAnswerPlacement(raw.placement || question.placement);
  if (placement) normalized.placement = placement;
  if (needsReview) normalized.needsReview = true;
  return normalized;
}

function normalizeNationalTestQuestionOptionElementIds(value, options = []) {
  const ids = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value).forEach(([label, elementId]) => {
      const key = stringValue(label).toUpperCase();
      const id = stringValue(elementId);
      if (key && id) ids[key] = id;
    });
  }
  if (options && typeof options === "object" && !Array.isArray(options)) {
    Object.entries(options).forEach(([label, option]) => {
      const key = stringValue(label).toUpperCase();
      const id = stringValue(option?.elementId || option?.targetElementId || option?.id || option);
      if (key && id && !ids[key]) ids[key] = id;
    });
  }
  (Array.isArray(options) ? options : []).forEach((option, index) => {
    if (!option || typeof option !== "object") return;
    const key = stringValue(option.label || option.letter || option.choice || option.value || option.id || String.fromCharCode(65 + index)).toUpperCase();
    const id = stringValue(option.elementId || option.targetElementId);
    if (key && id && !ids[key]) ids[key] = id;
  });
  return ids;
}

function inferNationalTestOfficialAnswerTargetElementId(question = {}, answerValue = "", pageLayout = null) {
  const entries = flattenedNationalTestPageLayoutElements(pageLayout?.elements || []);
  if (!entries.length) return "";
  const number = normalizeNationalTestQuestionLabel(question.number || question.questionNumber || question.label);
  const answer = stringValue(answerValue).trim();
  const answerKey = answer.toLocaleLowerCase();
  const optionLetter = /^[a-d]$/i.test(answer) ? answer.toLocaleLowerCase() : "";
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
  const byNormalizedId = new Map(entries
    .map(entry => [normalizedElementIdForMatch(entry.element?.id), entry.element])
    .filter(([id]) => id));
  for (const candidate of candidates) {
    const match = byNormalizedId.get(normalizedElementIdForMatch(candidate));
    if (match?.id) return stringValue(match.id);
  }
  if (number && optionLetter) {
    const optionRegex = new RegExp(`(?:^|[^0-9])q(?:uestion)?\\s*${escapeRegExpForServer(number)}[^\\n]*\\b${optionLetter}\\b|\\b${optionLetter}\\s+`, "i");
    const optionMatch = entries.find(entry => {
      const id = stringValue(entry.element?.id).toLocaleLowerCase();
      const text = stringValue(entry.element?.text);
      return id.includes(`q${number}`) && id.includes("option") && id.endsWith(optionLetter) ||
        (id.includes(`q${number}`) && optionRegex.test(text));
    });
    if (optionMatch?.element?.id) return stringValue(optionMatch.element.id);
  }
  if (answerKey && answerKey.length > 1) {
    const textMatch = entries.find(entry => {
      const text = stringValue(entry.element?.text).toLocaleLowerCase();
      return text === answerKey || text.includes(answerKey);
    });
    if (textMatch?.element?.id) return stringValue(textMatch.element.id);
  }
  return "";
}

function flattenedNationalTestPageLayoutElements(elements = []) {
  const output = [];
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    output.push({ element });
    if (element.type === "group" && Array.isArray(element.elements)) {
      output.push(...flattenedNationalTestPageLayoutElements(element.elements));
    }
  });
  return output;
}

function normalizedElementIdForMatch(value) {
  return stringValue(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeRegExpForServer(value) {
  return stringValue(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeNationalTestOfficialAnswerPlacement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = Number(value.x ?? value.left);
  const y = Number(value.y ?? value.top);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const placement = { x, y };
  const width = positiveNumber(value.width);
  const height = positiveNumber(value.height);
  if (width) placement.width = width;
  if (height) placement.height = height;
  return placement;
}

function normalizeNationalTestQuestionSourcePages(value) {
  return uniqueStringValues(value).map(page => page.replace(/^page\s*/i, "").trim()).filter(Boolean);
}

function uniqueStringValues(value) {
  const source = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return [...new Set(source.map(stringValue).filter(Boolean))];
}

function normalizeNationalTestQuestionLabel(value) {
  return stringValue(value)
    .replace(/^q(?:uestion)?\.?\s*/i, "")
    .trim();
}

function percentNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 1000) / 1000));
}

function nationalTestPagePartValue(page) {
  return normalizeNationalTestPagePart(page?.pagePart) || 0;
}

function compareNationalTestPages(left, right) {
  return (
    positiveInteger(left?.sortOrder, left?.pageNumber) - positiveInteger(right?.sortOrder, right?.pageNumber) ||
    positiveInteger(left?.pageNumber) - positiveInteger(right?.pageNumber) ||
    nationalTestPagePartValue(left) - nationalTestPagePartValue(right) ||
    stringValue(left?.title).localeCompare(stringValue(right?.title))
  );
}

function ensureNationalTestLocation(db, title) {
  const source = ensureSourceByName(db, NATIONAL_TEST_SOURCE_NAME);
  const branch = ensureBranchByName(source, title);
  const sections = NATIONAL_TEST_SECTIONS.map(section => {
    const unit = ensureUnitByName(branch, section.name);
    return {
      id: `section_${section.key}`,
      key: section.key,
      name: section.name,
      sourceId: source.id,
      branchId: branch.id,
      unitId: unit.id
    };
  });
  return { sourceId: source.id, branchId: branch.id, sections };
}

function ensureSourceByName(db, name) {
  db.sources = Array.isArray(db.sources) ? db.sources : [];
  let source = db.sources.find(item => stringValue(item.name).toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!source) {
    source = { id: `source_${randomUUID()}`, name, branches: [] };
    db.sources.push(source);
  }
  source.branches = Array.isArray(source.branches) ? source.branches : [];
  return source;
}

function ensureBranchByName(source, name) {
  let branch = source.branches.find(item => stringValue(item.name).toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!branch) {
    branch = { id: `branch_${randomUUID()}`, name, units: [] };
    source.branches.push(branch);
  }
  branch.units = Array.isArray(branch.units) ? branch.units : [];
  return branch;
}

function ensureUnitByName(branch, name) {
  let unit = branch.units.find(item => stringValue(item.name).toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!unit) {
    unit = { id: `unit_${randomUUID()}`, name };
    branch.units.push(unit);
  }
  return unit;
}

function clearNationalTestLocations(test, predicate, replacement, updatedAt) {
  const before = JSON.stringify({
    sourceId: test.sourceId,
    branchId: test.branchId,
    sections: test.sections
  });
  const primaryLocation = coerceLocation(test);
  if (predicate(primaryLocation)) {
    const nextPrimary = coerceLocation(replacement(primaryLocation) || {});
    test.sourceId = nextPrimary.sourceId;
    test.branchId = nextPrimary.branchId;
  }

  test.sections = normalizeNationalTestSections(test.sections, test.sourceId, test.branchId).map(section => {
    const sectionLocation = coerceLocation(section);
    if (!predicate(sectionLocation)) return section;
    const nextLocation = coerceLocation(replacement(sectionLocation, section) || {});
    return {
      ...section,
      sourceId: nextLocation.sourceId,
      branchId: nextLocation.branchId,
      unitId: nextLocation.unitId
    };
  });

  const after = JSON.stringify({
    sourceId: test.sourceId,
    branchId: test.branchId,
    sections: test.sections
  });
  if (after !== before) {
    test.updatedAt = updatedAt;
    return true;
  }
  return false;
}

function normalizePronunciationRecord(value) {
  if (!value || typeof value !== "object") return null;
  const audioUrl = stringValue(value.audioUrl);
  const phonetic = stringValue(value.phonetic);
  if (audioUrl && !isPronunciationUrl(audioUrl)) return null;
  if (!audioUrl && !phonetic) return null;
  const remoteAudioUrl = stringValue(value.remoteAudioUrl);
  const localFilename = audioUrl.startsWith("/pronunciations/")
    ? safePronunciationFilename(decodeURIComponent(path.basename(audioUrl)))
    : "";
  return {
    source: stringValue(value.source) || "merriam-webster",
    reference: stringValue(value.reference) || DEFAULT_PRONUNCIATION_REFERENCE,
    accent: stringValue(value.accent) || "us",
    audioUrl,
    remoteAudioUrl: isHttpUrl(remoteAudioUrl) ? remoteAudioUrl : isHttpUrl(audioUrl) ? audioUrl : "",
    filename: safePronunciationFilename(value.filename) || localFilename,
    audioBase: stringValue(value.audioBase),
    phonetic,
    phoneticType: stringValue(value.phoneticType),
    query: stringValue(value.query),
    entryWord: stringValue(value.entryWord),
    exact: Boolean(value.exact),
    fetchedAt: validIso(value.fetchedAt) || nowIso(),
    cachedAt: validIso(value.cachedAt)
  };
}

function isPronunciationUrl(value) {
  return isHttpUrl(value) || String(value || "").startsWith("/pronunciations/");
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function enrichWordsWithPronunciations(words) {
  const apiKey = await merriamWebsterApiKey();
  if (!apiKey) return { updated: 0, missing: 0, errors: 0 };
  return refreshWordPronunciations(words.filter(word => !hasPronunciationResult(word)), { apiKey });
}

async function refreshWordPronunciations(words, { apiKey }) {
  const result = {
    updated: 0,
    missing: 0,
    errors: 0,
    updatedWordIds: [],
    missingWordIds: [],
    errorWordIds: []
  };

  for (const word of words) {
    try {
      const previousFilename = word.pronunciation?.filename || "";
      const pronunciation = await fetchAndCacheMerriamWebsterPronunciation(word, apiKey);
      if (pronunciation) {
        word.pronunciation = pronunciation;
        word.updatedAt = nowIso();
        if (previousFilename && previousFilename !== pronunciation.filename) {
          await removePronunciationFile(previousFilename);
        }
        result.updated += 1;
        result.updatedWordIds.push(word.id);
      } else {
        result.missing += 1;
        result.missingWordIds.push(word.id);
      }
    } catch (error) {
      result.errors += 1;
      result.errorWordIds.push(word.id);
      console.error(`Pronunciation lookup failed for "${word.word}":`, error.message);
    }
  }

  return result;
}

async function fetchMerriamWebsterPronunciation(word, apiKey) {
  const query = stringValue(word);
  if (!query) return null;

  const reference = merriamWebsterReference();
  const payload = await fetchMerriamWebsterPayload(query, apiKey, reference);
  return pronunciationFromMerriamWebster(payload, query, reference);
}

async function fetchMerriamWebsterPayload(query, apiKey, reference = merriamWebsterReference()) {
  const url = `${MERRIAM_WEBSTER_API_BASE}/${reference}/json/${encodeURIComponent(query)}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Merriam-Webster returned ${response.status}`);
  }
  return response.json();
}

async function fetchAndCacheMerriamWebsterPronunciation(word, apiKey) {
  const pronunciation = await fetchMerriamWebsterPronunciation(word.word, apiKey);
  if (!pronunciation) return null;
  return cachePronunciationAudio(word, pronunciation);
}

async function cachePronunciationAudio(word, pronunciation) {
  const remoteAudioUrl = pronunciation.remoteAudioUrl || pronunciation.audioUrl;
  if (!isHttpUrl(remoteAudioUrl)) return pronunciation;

  await mkdir(PRONUNCIATION_DIR, { recursive: true });
  const filename = pronunciationFilename(word, pronunciation);
  const targetPath = path.join(PRONUNCIATION_DIR, filename);
  const response = await fetch(remoteAudioUrl);
  if (!response.ok) {
    throw new Error(`Pronunciation audio returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.includes("audio") && !contentType.includes("octet-stream")) {
    throw new Error("Pronunciation URL did not return audio");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, bytes);
  return {
    ...pronunciation,
    audioUrl: `/pronunciations/${filename}`,
    remoteAudioUrl,
    filename,
    cachedAt: nowIso()
  };
}

function hasCachedPronunciation(word) {
  return Boolean(word.pronunciation?.filename && word.pronunciation?.audioUrl?.startsWith("/pronunciations/"));
}

function hasPronunciationResult(word) {
  return hasCachedPronunciation(word) || Boolean(word.pronunciation?.exact && word.pronunciation?.phonetic);
}

function lookupCandidatesFromMerriamWebster(payload, query, reference) {
  if (!Array.isArray(payload)) return { candidates: [], suggestions: [] };
  if (payload.every(item => typeof item === "string")) {
    return { candidates: [], suggestions: merriamWebsterSuggestions(payload) };
  }

  const candidates = [];
  payload
    .filter(entry => entry && typeof entry === "object")
    .forEach(entry => {
      const context = {
        query,
        reference,
        entryId: stringValue(entry.meta?.id),
        entryWord: entryWordFromMerriamWebsterEntry(entry) || query,
        partOfSpeech: stringValue(entry.fl),
        stems: normalizeStringArray(entry.meta?.stems)
      };

      collectLookupCandidatesFromDefs(entry.def, context, candidates);
      collectLookupCandidatesFromRunOns(entry.dros, context, candidates);
      collectLookupCandidatesFromRunOns(entry.uros, context, candidates);
      collectShortDefinitionCandidates(entry, context, candidates);
    });

  return {
    candidates: uniqueLookupCandidates(candidates).slice(0, 24),
    suggestions: []
  };
}

function merriamWebsterSuggestions(payload) {
  return Array.isArray(payload) && payload.every(item => typeof item === "string")
    ? uniqueStrings(payload.map(item => stringValue(item))).slice(0, 12)
    : [];
}

function collectLookupCandidatesFromRunOns(items, parentContext, candidates) {
  if (!Array.isArray(items)) return;
  items.forEach(item => {
    if (!item || typeof item !== "object") return;
    const phrase = cleanMerriamWebsterText(item.drp || item.ure || item.va || item.hw);
    const context = {
      ...parentContext,
      entryWord: phrase || parentContext.entryWord,
      partOfSpeech: stringValue(item.fl) || parentContext.partOfSpeech,
      runOn: Boolean(phrase)
    };
    collectLookupCandidatesFromDefs(item.def, context, candidates);
  });
}

function collectLookupCandidatesFromDefs(definitions, context, candidates) {
  if (!Array.isArray(definitions)) return;
  definitions.forEach(definition => walkMerriamWebsterSseq(definition?.sseq, context, candidates));
}

function walkMerriamWebsterSseq(value, context, candidates) {
  if (!Array.isArray(value)) return;
  value.forEach(item => {
    if (Array.isArray(item) && typeof item[0] === "string" && item[1] && typeof item[1] === "object") {
      collectLookupCandidateFromSense(item[1], context, candidates);
      walkMerriamWebsterSseq(item[1].sseq, context, candidates);
      return;
    }
    if (Array.isArray(item)) {
      walkMerriamWebsterSseq(item, context, candidates);
    }
  });
}

function collectLookupCandidateFromSense(sense, context, candidates) {
  if (!Array.isArray(sense?.dt)) return;
  const details = lookupDetailsFromDt(sense.dt);
  const definition = details.definitions.find(Boolean);
  if (!definition || isCrossReferenceDefinition(definition)) return;

  candidates.push({
    id: `${context.entryId || context.entryWord}-${candidates.length + 1}`,
    provider: "merriam-webster",
    reference: context.reference,
    query: context.query,
    word: context.query,
    entryWord: context.entryWord,
    headword: context.entryWord,
    partOfSpeech: context.partOfSpeech,
    definition,
    examples: uniqueStrings(details.examples).slice(0, 4),
    collocations: uniqueStrings(details.collocations).slice(0, 6),
    synonyms: uniqueStrings([...details.synonyms, ...lookupSynonymsFromSense(sense)]).slice(0, 8),
    exact: pronunciationKey(context.entryWord) === pronunciationKey(context.query),
    sourceEntryId: context.entryId,
    runOn: Boolean(context.runOn)
  });
}

function collectShortDefinitionCandidates(entry, context, candidates) {
  const definitions = normalizeStringArray(entry.shortdef || entry.meta?.["app-shortdef"]?.def);
  definitions.forEach(definition => {
    const cleaned = cleanMerriamWebsterText(definition);
    if (!cleaned || isCrossReferenceDefinition(cleaned)) return;
    candidates.push({
      id: `${context.entryId || context.entryWord}-short-${candidates.length + 1}`,
      provider: "merriam-webster",
      reference: context.reference,
      query: context.query,
      word: context.query,
      entryWord: context.entryWord,
      headword: context.entryWord,
      partOfSpeech: context.partOfSpeech,
      definition: cleaned,
      examples: [],
      collocations: [],
      synonyms: [],
      exact: pronunciationKey(context.entryWord) === pronunciationKey(context.query),
      sourceEntryId: context.entryId,
      runOn: false
    });
  });
}

function lookupDetailsFromDt(dt) {
  return dt.reduce((details, item) => {
    if (!Array.isArray(item)) return details;
    const [type, value] = item;
    if (type === "text") {
      const text = cleanMerriamWebsterText(value);
      if (text) details.definitions.push(text);
    }
    if (type === "vis") {
      lookupExamplesFromVis(value).forEach(example => details.examples.push(example));
    }
    if (type === "uns" || type === "snote") {
      collectNestedLookupDetails(value, details);
    }
    return details;
  }, { definitions: [], examples: [], collocations: [], synonyms: [] });
}

function collectNestedLookupDetails(value, details) {
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && value[0] === "vis") {
      lookupExamplesFromVis(value[1]).forEach(example => details.examples.push(example));
      return;
    }
    if (typeof value[0] === "string" && value[0] === "text") {
      const text = cleanMerriamWebsterText(value[1]);
      if (text && !isCrossReferenceDefinition(text)) details.collocations.push(text);
      return;
    }
    value.forEach(item => collectNestedLookupDetails(item, details));
  }
}

function lookupExamplesFromVis(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => cleanMerriamWebsterText(item?.t))
    .filter(Boolean);
}

function lookupSynonymsFromSense(sense) {
  const lists = [
    ...(Array.isArray(sense.syn_list) ? sense.syn_list : []),
    ...(Array.isArray(sense.rel_list) ? sense.rel_list : [])
  ];
  return lists.flatMap(group => Array.isArray(group)
    ? group.map(item => cleanMerriamWebsterText(item?.wd))
    : []
  ).filter(Boolean);
}

function thesaurusEntriesFromMerriamWebster(payload, query) {
  if (!Array.isArray(payload) || !payload.length || typeof payload[0] === "string") return [];

  const entries = [];
  payload
    .filter(entry => entry && typeof entry === "object")
    .forEach(entry => {
      const context = {
        query,
        queryKey: pronunciationKey(query),
        entryId: stringValue(entry.meta?.id),
        entryWord: entryWordFromMerriamWebsterEntry(entry) || query,
        partOfSpeech: stringValue(entry.fl),
        stems: normalizeStringArray(entry.meta?.stems),
        shortDefinitions: normalizeStringArray(entry.shortdef)
      };
      collectThesaurusEntriesFromDefs(entry.def, context, entries);
    });

  return uniqueThesaurusEntries(entries)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || thesaurusItemCount(b) - thesaurusItemCount(a))
    .slice(0, 12);
}

function collectThesaurusEntriesFromDefs(definitions, context, entries) {
  if (!Array.isArray(definitions)) return;
  definitions.forEach(definition => walkThesaurusSseq(definition?.sseq, context, entries));
}

function walkThesaurusSseq(value, context, entries) {
  if (!Array.isArray(value)) return;
  value.forEach(item => {
    if (Array.isArray(item) && typeof item[0] === "string" && item[1] && typeof item[1] === "object") {
      collectThesaurusEntryFromSense(item[1], context, entries);
      walkThesaurusSseq(item[1].sseq, context, entries);
      return;
    }
    if (Array.isArray(item)) {
      walkThesaurusSseq(item, context, entries);
    }
  });
}

function collectThesaurusEntryFromSense(sense, context, entries) {
  if (!sense || typeof sense !== "object") return;
  const details = Array.isArray(sense.dt) ? lookupDetailsFromDt(sense.dt) : { definitions: [], examples: [] };
  const definitions = uniqueStrings([
    ...details.definitions,
    ...context.shortDefinitions
  ]).slice(0, 4);
  const record = normalizeThesaurusRecord({
    source: "merriam-webster",
    reference: "thesaurus",
    query: context.query,
    entryWord: context.entryWord,
    partOfSpeech: context.partOfSpeech,
    sourceEntryId: context.entryId,
    definitions,
    synonyms: thesaurusWordsFromList(sense.syn_list).slice(0, 24),
    relatedWords: thesaurusWordsFromList(sense.rel_list).slice(0, 24),
    nearAntonyms: thesaurusWordsFromList(sense.near_list).slice(0, 24),
    antonyms: thesaurusWordsFromList(sense.ant_list).slice(0, 24),
    phrases: thesaurusWordsFromList(sense.phrase_list).slice(0, 16),
    examples: uniqueStrings(details.examples).slice(0, 4),
    exact: [
      context.entryWord,
      ...(Array.isArray(context.stems) ? context.stems : [])
    ].some(value => pronunciationKey(value) === context.queryKey),
    fetchedAt: nowIso()
  });
  if (record) entries.push(record);
}

function thesaurusWordsFromList(value) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.flatMap(group => Array.isArray(group)
    ? group.map(item => formatThesaurusWord(item))
    : []
  ));
}

function formatThesaurusWord(item) {
  const word = cleanMerriamWebsterText(item?.wd);
  if (!word) return "";
  const notes = [
    ...thesaurusWordVariants(item?.wvrs, "wvl", "wva"),
    ...thesaurusWordVariants(item?.wvbvrs, "wvbvl", "wvbva"),
    ...thesaurusWordLabels(item?.wsls)
  ];
  return notes.length ? `${word} (${notes.join("; ")})` : word;
}

function thesaurusWordVariants(value, labelKey, wordKeyName) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => [stringValue(item?.[labelKey]), cleanMerriamWebsterText(item?.[wordKeyName])].filter(Boolean).join(" "))
    .filter(Boolean);
}

function thesaurusWordLabels(value) {
  if (!value || typeof value !== "object") return [];
  return normalizeStringArray(value.wsl);
}

function uniqueThesaurusEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = [
      pronunciationKey(entry.entryWord),
      entry.partOfSpeech,
      entry.definitions[0] || "",
      entry.synonyms.slice(0, 5).join(",")
    ].join("|").toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enrichLookupCandidatesWithThesaurus(candidates, thesaurusEntries) {
  const entries = Array.isArray(thesaurusEntries) ? thesaurusEntries : [];
  if (!entries.length) return candidates;
  const normalizedCandidates = Array.isArray(candidates) ? candidates : [];
  if (!normalizedCandidates.length) {
    return entries.map((entry, index) => lookupCandidateFromThesaurusEntry(entry, index));
  }
  return normalizedCandidates.map(candidate => {
    const entry = bestThesaurusEntryForCandidate(candidate, entries);
    if (!entry) return candidate;
    return {
      ...candidate,
      synonyms: uniqueStrings([
        ...normalizeStringArray(candidate.synonyms),
        ...entry.synonyms
      ]).slice(0, 16),
      thesaurus: entry
    };
  });
}

function lookupCandidateFromThesaurusEntry(entry, index) {
  return {
    id: `${entry.sourceEntryId || entry.entryWord || "thesaurus"}-${index + 1}`,
    provider: "merriam-webster",
    reference: "thesaurus",
    query: entry.query,
    word: entry.query || entry.entryWord,
    entryWord: entry.entryWord,
    headword: entry.entryWord,
    partOfSpeech: entry.partOfSpeech,
    definition: entry.definitions[0] || "Thesaurus entry",
    examples: entry.examples,
    collocations: [],
    synonyms: entry.synonyms,
    thesaurus: entry,
    exact: entry.exact,
    sourceEntryId: entry.sourceEntryId,
    thesaurusOnly: true
  };
}

function bestThesaurusEntryForCandidate(candidate, entries) {
  const candidatePart = stringValue(candidate.partOfSpeech).toLocaleLowerCase();
  return entries.find(entry => entry.exact && stringValue(entry.partOfSpeech).toLocaleLowerCase() === candidatePart) ||
    entries.find(entry => stringValue(entry.partOfSpeech).toLocaleLowerCase() === candidatePart) ||
    entries.find(entry => entry.exact) ||
    entries[0] ||
    null;
}

function uniqueStrings(values) {
  const seen = new Set();
  return values
    .map(value => stringValue(value))
    .filter(value => {
      const key = value.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function uniqueLookupCandidates(candidates) {
  const seen = new Set();
  return candidates.filter(candidate => {
    const key = [
      pronunciationKey(candidate.entryWord),
      candidate.partOfSpeech,
      candidate.definition.toLocaleLowerCase()
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isCrossReferenceDefinition(value) {
  return /^see\s+/i.test(String(value || "").trim());
}

function pronunciationFilename(word, pronunciation) {
  const base = safeFilenamePart(pronunciation.audioBase || pronunciation.entryWord || word.word || "audio");
  return `${safeFilenamePart(word.id)}-${base}.mp3`;
}

function safeFilenamePart(value) {
  return String(value || "")
    .replace(/[^a-z0-9_-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || randomUUID();
}

function safePronunciationFilename(value) {
  const filename = path.basename(stringValue(value));
  return filename && filename === stringValue(value) ? filename : "";
}

function pronunciationFromMerriamWebster(payload, query, reference) {
  if (!Array.isArray(payload) || !payload.length || typeof payload[0] === "string") return null;

  const candidates = [];
  payload.forEach(entry => collectMerriamWebsterPronunciations(entry, {
    query,
    queryKey: pronunciationKey(query),
    reference,
    entry,
    entryWord: entryWordFromMerriamWebsterEntry(entry),
    stems: normalizeStringArray(entry?.meta?.stems)
  }, candidates));

  const exactCandidates = candidates.filter(candidate => candidate.exact);
  return exactCandidates.find(candidate => isPronunciationUrl(candidate.audioUrl)) || exactCandidates[0] || null;
}

function collectMerriamWebsterPronunciations(value, context, candidates) {
  if (Array.isArray(value)) {
    value.forEach(item => collectMerriamWebsterPronunciations(item, context, candidates));
    return;
  }
  if (!value || typeof value !== "object") return;

  const localTerm = merriamWebsterTerm(value) || context.term;
  const nextContext = localTerm ? { ...context, term: localTerm } : context;

  if (Array.isArray(value.prs)) {
    value.prs.forEach(pronunciation => {
      const audioBase = stringValue(pronunciation?.sound?.audio);
      const phonetic = stringValue(pronunciation.ipa || pronunciation.mw || pronunciation.wod);
      if (!audioBase && !phonetic) return;

      const language = context.entry?.meta?.lang === "es" ? "es" : "en";
      const accent = language === "es" ? "me" : "us";
      const term = localTerm || context.entryWord || context.query;
      const exact = [
        term,
        context.entryWord,
        ...(Array.isArray(context.stems) ? context.stems : [])
      ].some(value => pronunciationKey(value) === context.queryKey);
      const remoteAudioUrl = audioBase ? merriamWebsterAudioUrl(audioBase, language, accent) : "";
      candidates.push({
        source: "merriam-webster",
        reference: context.reference,
        accent,
        audioUrl: remoteAudioUrl,
        remoteAudioUrl,
        audioBase,
        phonetic,
        phoneticType: pronunciation.ipa ? "ipa" : pronunciation.mw ? "mw" : pronunciation.wod ? "wod" : "",
        query: context.query,
        entryWord: context.entryWord || term,
        exact,
        fetchedAt: nowIso()
      });
    });
  }

  Object.entries(value).forEach(([key, child]) => {
    if (key === "prs") return;
    collectMerriamWebsterPronunciations(child, nextContext, candidates);
  });
}

function merriamWebsterTerm(value) {
  return ["hw", "if", "va", "ure", "altname", "pname"]
    .map(key => stringValue(value[key]))
    .find(Boolean) || "";
}

function entryWordFromMerriamWebsterEntry(entry) {
  const headword = stringValue(entry?.hwi?.hw);
  if (headword) return cleanMerriamWebsterTerm(headword);
  const id = stringValue(entry?.meta?.id);
  return id ? cleanMerriamWebsterTerm(id.split(":")[0]) : "";
}

function pronunciationKey(value) {
  return cleanMerriamWebsterTerm(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9']/g, "");
}

function cleanMerriamWebsterTerm(value) {
  return String(value || "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMerriamWebsterText(value) {
  return String(value || "")
    .replace(/\{bc\}/g, ": ")
    .replace(/\{dx\}|\{\/dx\}|\{p_only\}|\{\/p_only\}/g, "")
    .replace(/\{dxt?\|([^|{}]+)(?:\|[^{}]*)*\}/g, "$1")
    .replace(/\{[^{}|]+\|([^|{}]+)(?:\|[^{}]*)*\}/g, "$1")
    .replace(/\{\/?[a-z_]+\}/gi, "")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\s+/g, " ")
    .replace(/(?:^|\s):\s*/g, ": ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^\s*[:;,-]\s*/, "")
    .trim();
}

function merriamWebsterAudioUrl(audioBase, language = "en", country = "us") {
  const audio = stringValue(audioBase);
  const subdirectory = merriamWebsterAudioSubdirectory(audio);
  return `${MERRIAM_WEBSTER_AUDIO_BASE}/${language}/${country}/mp3/${subdirectory}/${audio}.mp3`;
}

function merriamWebsterAudioSubdirectory(audio) {
  if (audio.startsWith("bix")) return "bix";
  if (audio.startsWith("gg")) return "gg";
  const first = audio.charAt(0).toLocaleLowerCase();
  if (!/[a-z]/.test(first)) return "number";
  return first;
}

async function merriamWebsterApiKey() {
  return merriamWebsterLearnersApiKey();
}

async function merriamWebsterLearnersApiKey() {
  const envKey = stringValue(
    process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY ||
    process.env.MW_LEARNERS_API_KEY ||
    process.env.MERRIAM_WEBSTER_API_KEY ||
    process.env.MW_API_KEY
  );
  if (envKey) return envKey;
  const learnersFileKey = await readOptionalTextFile(MERRIAM_WEBSTER_LEARNERS_KEY_PATH);
  if (learnersFileKey) return learnersFileKey;
  return readOptionalTextFile(MERRIAM_WEBSTER_KEY_PATH);
}

async function merriamWebsterThesaurusApiKey() {
  const envKey = stringValue(
    process.env.MERRIAM_WEBSTER_THESAURUS_API_KEY ||
    process.env.MW_THESAURUS_API_KEY
  );
  if (envKey) return envKey;
  return readOptionalTextFile(MERRIAM_WEBSTER_THESAURUS_KEY_PATH);
}

async function readOptionalTextFile(filePath) {
  try {
    return stringValue(stripBom(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function merriamWebsterReference() {
  const value = stringValue(process.env.MERRIAM_WEBSTER_REFERENCE || process.env.MW_REFERENCE).toLocaleLowerCase();
  return /^[a-z0-9-]+$/.test(value) ? value : DEFAULT_PRONUNCIATION_REFERENCE;
}

function validateLocation(db, sourceId, branchId, unitId) {
  const source = sourceId ? db.sources.find(item => item.id === sourceId) : null;
  if (!source) throw httpError(400, "A valid source is required");
  if (!branchId && unitId) throw httpError(400, "A topic requires a unit");
  const branch = branchId ? source.branches.find(item => item.id === branchId) : null;
  if (branchId && !branch) throw httpError(400, "Unit does not belong to the source");
  if (unitId && !branch.units.some(item => item.id === unitId)) {
    throw httpError(400, "Topic does not belong to the unit");
  }
}

function requireSource(db, sourceId) {
  const source = db.sources.find(item => item.id === sourceId);
  if (!source) throw httpError(404, "Source not found");
  return source;
}

function requireBranch(db, sourceId, branchId) {
  const source = requireSource(db, sourceId);
  const branch = source.branches.find(item => item.id === branchId);
  if (!branch) throw httpError(404, "Unit not found");
  return branch;
}

function requireUnit(db, sourceId, branchId, unitId) {
  const branch = requireBranch(db, sourceId, branchId);
  const unit = branch.units.find(item => item.id === unitId);
  if (!unit) throw httpError(404, "Topic not found");
  return unit;
}

function cleanName(value, message) {
  const cleaned = stringValue(value);
  if (!cleaned) throw httpError(400, message);
  return cleaned;
}

async function documentUnderstandingServiceHealth() {
  if (!isLocalDocumentUnderstandingServiceUrl(DOCUMENT_UNDERSTANDING_SERVICE_URL)) {
    return documentUnderstandingUnavailableHealth("service-url-not-localhost");
  }
  const startup = await ensureDocumentUnderstandingServiceStarted();
  const result = await fetchDocumentUnderstandingService("/health", { method: "GET" });
  if (!result.ok || !result.data) {
    return documentUnderstandingUnavailableHealth(result.error || "local-service-unavailable", result.timeout, { startup });
  }
  return {
    ...result.data,
    proxy: {
      status: "connected",
      serviceUrl: DOCUMENT_UNDERSTANDING_SERVICE_URL,
      timeoutMs: DOCUMENT_UNDERSTANDING_TIMEOUT_MS,
      startup
    }
  };
}

async function documentUnderstandingServicePost(servicePath, payload) {
  if (!isLocalDocumentUnderstandingServiceUrl(DOCUMENT_UNDERSTANDING_SERVICE_URL)) {
    return documentUnderstandingUnavailableAnalysis("service-url-not-localhost");
  }
  const startup = await ensureDocumentUnderstandingServiceStarted();
  const result = await fetchDocumentUnderstandingService(servicePath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!result.ok || !result.data) {
    return documentUnderstandingUnavailableAnalysis(result.error || "local-service-unavailable", result.timeout, { startup });
  }
  return result.data;
}

async function ensureDocumentUnderstandingServiceStarted() {
  if (!DOCUMENT_UNDERSTANDING_AUTO_START) {
    return { attempted: false, state: "auto-start-disabled" };
  }
  if (!isLocalDocumentUnderstandingServiceUrl(DOCUMENT_UNDERSTANDING_SERVICE_URL)) {
    return { attempted: false, state: "service-url-not-localhost" };
  }
  const probe = await fetchDocumentUnderstandingService("/health", { method: "GET" }, 900);
  if (probe.ok) {
    documentUnderstandingLastStartupDiagnostic = { attempted: false, state: "already-running" };
    return documentUnderstandingLastStartupDiagnostic;
  }
  if (documentUnderstandingServiceProcess && !documentUnderstandingServiceProcess.killed) {
    return waitForDocumentUnderstandingService("already-starting");
  }
  if (documentUnderstandingServiceStartPromise) {
    return documentUnderstandingServiceStartPromise;
  }
  documentUnderstandingServiceStartPromise = startDocumentUnderstandingServiceProcess();
  try {
    documentUnderstandingLastStartupDiagnostic = await documentUnderstandingServiceStartPromise;
    return documentUnderstandingLastStartupDiagnostic;
  } finally {
    documentUnderstandingServiceStartPromise = null;
  }
}

async function startDocumentUnderstandingServiceProcess() {
  const pythonPath = path.resolve(DOCUMENT_UNDERSTANDING_SERVICE_PYTHON);
  const scriptPath = path.resolve(DOCUMENT_UNDERSTANDING_SERVICE_SCRIPT);
  const pythonInfo = await stat(pythonPath).catch(() => null);
  const scriptInfo = await stat(scriptPath).catch(() => null);
  if (!pythonInfo?.isFile()) {
    return {
      attempted: false,
      state: "service-python-not-found",
      pythonPath,
      expectedSetup: "Run npm run setup:document-intelligence to create the project-local environment."
    };
  }
  if (!scriptInfo?.isFile()) {
    return { attempted: false, state: "service-script-not-found", scriptPath };
  }
  const serviceUrl = new URL(DOCUMENT_UNDERSTANDING_SERVICE_URL);
  const env = {
    ...process.env,
    DOCUMENT_INTELLIGENCE_HOST: serviceUrl.hostname === "localhost" ? "127.0.0.1" : serviceUrl.hostname,
    DOCUMENT_INTELLIGENCE_PORT: serviceUrl.port || "8765",
    HF_HOME: process.env.HF_HOME || path.join(DOCUMENT_INTELLIGENCE_CACHE_DIR, "huggingface"),
    PADDLE_HOME: process.env.PADDLE_HOME || path.join(DOCUMENT_INTELLIGENCE_CACHE_DIR, "paddle"),
    PADDLEOCR_HOME: process.env.PADDLEOCR_HOME || path.join(DOCUMENT_INTELLIGENCE_CACHE_DIR, "paddleocr"),
    TORCH_HOME: process.env.TORCH_HOME || path.join(DOCUMENT_INTELLIGENCE_CACHE_DIR, "torch"),
    PYTHONUNBUFFERED: "1"
  };
  documentUnderstandingServiceProcess = spawn(pythonPath, [scriptPath], {
    cwd: __dirname,
    env,
    stdio: "ignore",
    windowsHide: true
  });
  documentUnderstandingServiceProcess.once("exit", (code, signal) => {
    documentUnderstandingLastStartupDiagnostic = {
      ...(documentUnderstandingLastStartupDiagnostic || {}),
      state: "service-process-exited",
      exitCode: code,
      signal
    };
    documentUnderstandingServiceProcess = null;
  });
  documentUnderstandingServiceProcess.once("error", error => {
    documentUnderstandingLastStartupDiagnostic = {
      attempted: true,
      state: "service-process-error",
      error: error?.message || "spawn-failed"
    };
  });
  return waitForDocumentUnderstandingService("started");
}

async function waitForDocumentUnderstandingService(startState) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DOCUMENT_UNDERSTANDING_STARTUP_TIMEOUT_MS) {
    const result = await fetchDocumentUnderstandingService("/health", { method: "GET" }, 1200);
    if (result.ok) {
      return {
        attempted: startState === "started",
        state: "ready-for-proxy",
        waitMs: Date.now() - startedAt,
        processId: documentUnderstandingServiceProcess?.pid || null
      };
    }
    await delay(500);
  }
  return {
    attempted: startState === "started",
    state: "startup-timeout",
    timeoutMs: DOCUMENT_UNDERSTANDING_STARTUP_TIMEOUT_MS,
    processId: documentUnderstandingServiceProcess?.pid || null
  };
}

async function fetchDocumentUnderstandingService(servicePath, options = {}, timeoutMs = DOCUMENT_UNDERSTANDING_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(servicePath, DOCUMENT_UNDERSTANDING_SERVICE_URL).toString();
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      timeout: error?.name === "AbortError",
      error: error?.message || "document-understanding-service-error"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isLocalDocumentUnderstandingServiceUrl(value) {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function documentUnderstandingUnavailableHealth(error = "local-service-unavailable", timeout = false, extra = {}) {
  return {
    status: "unavailable",
    mode: "heuristic-fallback",
    error,
    timeout: Boolean(timeout),
    device: "unknown",
    diagnostics: {
      ...extra,
      lastStartup: documentUnderstandingLastStartupDiagnostic
    },
    providers: {
      documentParser: {
        available: false,
        model: process.env.DOCUMENT_PARSER_MODEL || "PaddleOCR-VL",
        state: "unavailable",
        failureReason: error
      },
      visionReasoner: {
        available: false,
        model: process.env.VISION_REASONER_MODEL || "Qwen/Qwen3-VL-8B-Instruct",
        state: "unavailable",
        failureReason: error
      }
    }
  };
}

function documentUnderstandingUnavailableAnalysis(error = "local-service-unavailable", timeout = false, extra = {}) {
  return {
    schemaVersion: "hybrid-document-analysis/v1",
    provider: {
      type: "local-service",
      name: "local-document-intelligence",
      version: "document-understanding-provider/v1"
    },
    mode: "heuristic-fallback",
    analyses: {},
    diagnostics: {
      available: false,
      error,
      timeout: Boolean(timeout),
      ...extra,
      lastStartup: documentUnderstandingLastStartupDiagnostic
    }
  };
}

function sanitizeDocumentUnderstandingPayload(value) {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {};
  if (!payload.source || typeof payload.source !== "object") payload.source = {};
  payload.source.sourcePageImage = safeDocumentImageReference(payload.source.sourcePageImage);
  payload.source.normalizedPageImage = safeDocumentImageReference(payload.source.normalizedPageImage);
  if (Array.isArray(payload.sourceEvidenceSummary?.textUnits)) {
    payload.sourceEvidenceSummary.textUnits = payload.sourceEvidenceSummary.textUnits.slice(0, 120).map(unit => ({
      id: stringValue(unit?.id),
      kind: stringValue(unit?.kind),
      text: stringValue(unit?.text).slice(0, 500),
      bbox: sanitizeNormalizedBbox(unit?.bbox),
      confidence: Math.max(0, Math.min(1, Number(unit?.confidence) || 0))
    })).filter(unit => unit.id || unit.text);
  }
  if (Array.isArray(payload.sourceEvidenceSummary?.visualRegions)) {
    payload.sourceEvidenceSummary.visualRegions = payload.sourceEvidenceSummary.visualRegions.slice(0, 120).map(region => ({
      id: stringValue(region?.id),
      kind: stringValue(region?.kind),
      role: stringValue(region?.role),
      bbox: sanitizeNormalizedBbox(region?.bbox),
      confidence: Math.max(0, Math.min(1, Number(region?.confidence) || 0)),
      artifactRisk: Math.max(0, Math.min(1, Number(region?.artifactRisk) || 0)),
      accepted: Boolean(region?.accepted)
    })).filter(region => region.id);
  }
  return payload;
}

function safeDocumentImageReference(value) {
  const text = stringValue(value);
  if (!text) return null;
  if (/^\/national-test-page-images\/[A-Za-z0-9._-]+$/u.test(text)) return text;
  return null;
}

function sanitizeNormalizedBbox(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = Math.max(0, Math.min(1, Number(value.x) || 0));
  const y = Math.max(0, Math.min(1, Number(value.y) || 0));
  const width = Math.min(1 - x, Math.max(0, Math.min(1, Number(value.width) || 0)));
  const height = Math.min(1 - y, Math.max(0, Math.min(1, Number(value.height) || 0)));
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height, coordinateSpace: "source-document-plane-normalized" };
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function validIso(value) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/\r?\n|;/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeSynonyms(value) {
  const values = Array.isArray(value) ? value : typeof value === "object" && value ? [value] : null;
  if (values) {
    return values
      .map(item => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (item && typeof item === "object") {
          const word = stringValue(item.word);
          if (!word) return "";
          const comparison = stringValue(item.comparison);
          return comparison ? { word, comparison } : { word };
        }
        return "";
      })
      .filter(Boolean);
  }
  return normalizeStringArray(value);
}

function normalizeThesaurusRecord(value) {
  if (!value || typeof value !== "object") return null;
  const synonyms = normalizeStringArray(value.synonyms);
  const relatedWords = normalizeStringArray(value.relatedWords);
  const nearAntonyms = normalizeStringArray(value.nearAntonyms);
  const antonyms = normalizeStringArray(value.antonyms);
  const phrases = normalizeStringArray(value.phrases);
  const examples = normalizeStringArray(value.examples);
  const definitions = normalizeStringArray(value.definitions || value.shortDefinitions);
  if (![synonyms, relatedWords, nearAntonyms, antonyms, phrases, examples, definitions].some(items => items.length)) {
    return null;
  }
  return {
    source: stringValue(value.source) || "merriam-webster",
    reference: stringValue(value.reference) || "thesaurus",
    query: stringValue(value.query),
    entryWord: stringValue(value.entryWord),
    partOfSpeech: stringValue(value.partOfSpeech),
    sourceEntryId: stringValue(value.sourceEntryId),
    definitions,
    synonyms,
    relatedWords,
    nearAntonyms,
    antonyms,
    phrases,
    examples,
    exact: Boolean(value.exact),
    fetchedAt: validIso(value.fetchedAt) || nowIso()
  };
}

function thesaurusItemCount(value) {
  const record = normalizeThesaurusRecord(value);
  if (!record) return 0;
  return [
    record.definitions,
    record.synonyms,
    record.relatedWords,
    record.nearAntonyms,
    record.antonyms,
    record.phrases,
    record.examples
  ].reduce((total, items) => total + items.length, 0);
}

function chooseThesaurusRecord(current, candidate) {
  const currentRecord = normalizeThesaurusRecord(current);
  const candidateRecord = normalizeThesaurusRecord(candidate);
  if (!currentRecord) return candidateRecord;
  if (!candidateRecord) return currentRecord;
  if (!currentRecord.exact && candidateRecord.exact) return candidateRecord;
  return thesaurusItemCount(candidateRecord) > thesaurusItemCount(currentRecord) ? candidateRecord : currentRecord;
}

async function bulkMoveWords(req, res, next) {
  try {
    const db = await readDatabase();
    const ids = normalizeIdList(req.body.ids);
    if (!ids.length) throw httpError(400, "Select at least one word");

    const location = req.body.location || req.body;
    const sourceId = stringValue(location.sourceId);
    const branchId = stringValue(location.branchId);
    const unitId = stringValue(location.unitId);
    validateLocation(db, sourceId, branchId, unitId);
    const targetLocation = { sourceId, branchId, unitId };

    const idSet = new Set(ids);
    const updatedAt = nowIso();
    const updated = [];
    db.words.forEach(word => {
      if (!idSet.has(word.id)) return;
      word.locations = [targetLocation];
      syncPrimaryLocation(word);
      word.updatedAt = updatedAt;
      updated.push(word);
    });

    await writeDatabase(db);
    res.json({ updated, count: updated.length });
  } catch (error) {
    next(error);
  }
}

async function bulkDeleteWords(req, res, next) {
  try {
    const db = await readDatabase();
    const ids = normalizeIdList(req.body.ids);
    if (!ids.length) throw httpError(400, "Select at least one word");

    const idSet = new Set(ids);
    const removedImageFilenames = [];
    const removedPronunciationFilenames = [];
    const removedPracticeWordIds = [];
    const before = db.words.length;
    db.words = db.words.filter(word => {
      if (!idSet.has(word.id)) return true;
      removedPracticeWordIds.push(word.id);
      if (word.image?.filename) {
        removedImageFilenames.push(word.image.filename);
      }
      if (word.pronunciation?.filename) {
        removedPronunciationFilenames.push(word.pronunciation.filename);
      }
      return false;
    });

    await writeDatabase(db);
    await removePracticeProgressForWordIds(removedPracticeWordIds);
    await removeUploadedImageFilenames(removedImageFilenames);
    await removePronunciationFilenames(removedPronunciationFilenames);
    res.json({ ok: true, count: before - db.words.length });
  } catch (error) {
    next(error);
  }
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => stringValue(item)).filter(Boolean))];
}

function wordKey(word) {
  return String(word || "").trim().toLocaleLowerCase();
}

function assignImagesToWords(imageFiles, wordCount, imageIndexes) {
  if (!imageFiles.length) return new Map();
  const hasIndexes = Array.isArray(imageIndexes);

  if (!hasIndexes && imageFiles.length > wordCount) {
    throw httpError(400, "Image count cannot be greater than word count");
  }

  if (hasIndexes && imageIndexes.length !== imageFiles.length) {
    throw httpError(400, "Image indexes must match image count");
  }

  const assigned = new Map();
  imageFiles.forEach((file, fileIndex) => {
    const wordIndex = hasIndexes ? Number(imageIndexes[fileIndex]) : fileIndex;
    if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= wordCount) {
      throw httpError(400, "Image index is outside the word list");
    }
    if (assigned.has(wordIndex)) {
      throw httpError(400, "Each word can only have one image");
    }
    assigned.set(wordIndex, file);
  });
  return assigned;
}

function normalizePartOfSpeech(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
  }
  return typeof value === "string" ? value.trim() : "";
}

function videoExtension(file) {
  const fromName = path.extname(file.originalname || "").toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  if (file.mimetype === "video/mp4") return ".mp4";
  if (file.mimetype === "video/ogg") return ".ogv";
  if (file.mimetype === "video/quicktime") return ".mov";
  return ".webm";
}

function isAcceptedVideoUpload(file) {
  const mimeType = stringValue(file.mimetype).toLocaleLowerCase();
  if (mimeType.startsWith("video/")) return true;
  const extension = path.extname(file.originalname || "").toLocaleLowerCase();
  return [".webm", ".mp4", ".mov", ".m4v", ".ogv", ".ogg"].includes(extension);
}

async function prepareVideoUpload(file, targetFilename = "") {
  if (!file) return null;
  const filename = safeVideoFilename(targetFilename) || file.filename;
  const extension = path.extname(file.filename).toLocaleLowerCase();
  if (extension === VIDEO_OUTPUT_EXTENSION) {
    return retitlePreparedVideo({
      ...file,
      mimetype: VIDEO_OUTPUT_MIME_TYPE,
      originalname: mp4OriginalName(filename)
    }, filename);
  }

  const outputFilename = path.extname(filename).toLocaleLowerCase() === VIDEO_OUTPUT_EXTENSION
    ? filename
    : `${path.basename(filename, path.extname(filename))}${VIDEO_OUTPUT_EXTENSION}`;
  const outputPath = path.join(VIDEO_DIR, outputFilename);

  try {
    await transcodeVideoToMp4(file.path, outputPath);
    const outputStats = await stat(outputPath);
    await removeUploadedVideo(file.filename);
    return {
      ...file,
      path: outputPath,
      filename: outputFilename,
      originalname: mp4OriginalName(file.originalname),
      mimetype: VIDEO_OUTPUT_MIME_TYPE,
      size: outputStats.size
    };
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }
}

async function retitlePreparedVideo(file, targetFilename) {
  if (!file || !targetFilename || file.filename === targetFilename) return file;
  const targetPath = path.join(VIDEO_DIR, targetFilename);
  await rename(file.path, targetPath);
  const outputStats = await stat(targetPath);
  return {
    ...file,
    path: targetPath,
    filename: targetFilename,
    originalname: mp4OriginalName(targetFilename),
    mimetype: VIDEO_OUTPUT_MIME_TYPE,
    size: outputStats.size
  };
}

async function retitleExistingVideo(video, title, studyVideos = [], excludeVideoId = "") {
  const record = normalizeStudyVideoFile(video);
  if (!record) return video;
  const targetFilename = await uniqueTitleVideoFilename(title, studyVideos, {
    excludeVideoId,
    excludeFilenames: [record.filename]
  });

  if (record.filename.toLocaleLowerCase() === targetFilename.toLocaleLowerCase()) {
    return {
      ...record,
      originalName: mp4OriginalName(targetFilename),
      mimeType: VIDEO_OUTPUT_MIME_TYPE,
      url: `/videos/${record.filename}`
    };
  }

  const currentPath = path.join(VIDEO_DIR, record.filename);
  const targetPath = path.join(VIDEO_DIR, targetFilename);
  await rename(currentPath, targetPath);
  const outputStats = await stat(targetPath);
  return {
    ...record,
    filename: targetFilename,
    originalName: mp4OriginalName(targetFilename),
    mimeType: VIDEO_OUTPUT_MIME_TYPE,
    size: outputStats.size,
    url: `/videos/${targetFilename}`
  };
}

async function uniqueTitleVideoFilename(title, studyVideos = [], options = {}) {
  const base = videoFilenameBase(title);
  const excludedFilenames = new Set((options.excludeFilenames || []).map(filename => filename.toLocaleLowerCase()));
  const usedFilenames = new Set((studyVideos || [])
    .filter(video => video?.id !== options.excludeVideoId)
    .map(video => video?.video?.filename)
    .filter(Boolean)
    .map(filename => filename.toLocaleLowerCase()));

  for (let index = 0; index < 1000; index += 1) {
    const suffix = index ? `-${index + 1}` : "";
    const candidate = `${base}${suffix}${VIDEO_OUTPUT_EXTENSION}`;
    const normalized = candidate.toLocaleLowerCase();
    if (usedFilenames.has(normalized)) continue;
    if (excludedFilenames.has(normalized)) return candidate;
    if (await fileExists(path.join(VIDEO_DIR, candidate))) continue;
    return candidate;
  }

  return `${base}-${Date.now()}${VIDEO_OUTPUT_EXTENSION}`;
}

function videoFilenameBase(title) {
  const base = stringValue(title)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 96);
  return base || "video";
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function mp4OriginalName(originalName = "") {
  const parsed = path.parse(stringValue(originalName) || `recording-${Date.now()}`);
  return `${parsed.name || "recording"}${VIDEO_OUTPUT_EXTENSION}`;
}

function transcodeVideoToMp4(inputPath, outputPath) {
  const args = [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath
  ];

  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";

    process.stderr.on("data", chunk => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    process.on("error", error => {
      reject(new Error(`Could not convert video to MP4. Make sure ffmpeg is installed. ${error.message}`));
    });

    process.on("close", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Could not convert video to MP4. ffmpeg exited with code ${code}. ${stderr.trim()}`));
      }
    });
  });
}

function imageRecord(file) {
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: `/images/${file.filename}`
  };
}

function videoRecord(file) {
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: `/videos/${file.filename}`
  };
}

function nationalTestPdfRecord(file) {
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype || "application/pdf",
    size: file.size,
    url: `/national-tests/${file.filename}`
  };
}

async function listeningAudioRecordFromOrganizedUpload(file, options = {}) {
  return listeningMediaRecordFromOrganizedUpload(file, {
    ...options,
    kind: "audio",
    filenameBase: options.topic?.label || options.topic?.key || "audio",
    mimeType: file.mimetype || listeningAudioMimeType(file.filename)
  });
}

async function listeningTranscriptRecordFromOrganizedUpload(file, options = {}) {
  return listeningMediaRecordFromOrganizedUpload(file, {
    ...options,
    kind: "transcript",
    filenameBase: options.topic?.label || options.topic?.key || "transcript",
    mimeType: file.mimetype || "application/pdf"
  });
}

async function listeningMediaRecordFromOrganizedUpload(file, options = {}) {
  const relativePath = listeningMediaOrganizedRelativePath(file, options);
  const targetPath = listeningMediaAbsolutePath(relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rm(targetPath, { force: true });
  await rename(file.path, targetPath);
  const info = await stat(targetPath);
  return {
    filename: relativePath,
    originalName: file.originalname,
    mimeType: options.mimeType,
    size: info.size,
    url: listeningMediaUrl(relativePath)
  };
}

function listeningMediaOrganizedRelativePath(file, options = {}) {
  const test = options.test || {};
  const topic = options.topic || {};
  const extension = nationalTestUploadExtension(file);
  const topicName = topic.label || topic.key || options.filenameBase;
  const testFolder = pathReadableSegment(test.title, "Untitled test");
  const topicFolder = pathReadableSegment(topicName, "Topic");
  const mediaFolder = pathReadableSegment(options.mediaGroupId, "Media");
  const filename = `${pathReadableSegment(topicName, "Listening media")}${extension}`;
  return [testFolder, topicFolder, mediaFolder, filename].join("/");
}

async function listeningMediaGroupIdForSelectedPages(test, topic, pageIds = [], pageLabels = []) {
  const topicName = pathReadableSegment(topic.label || topic.key, "Topic");
  const labelsFromRequest = normalizeListeningMediaPageLabels(pageLabels);
  const labelsFromPages = labelsFromRequest.length ? labelsFromRequest : await listeningMediaSelectedPageLabels(test.id, pageIds);
  const pageSuffix = labelsFromPages.length ? labelsFromPages.join(", ") : "selected pages";
  return `${topicName} - pages ${pageSuffix}`;
}

function normalizeListeningMediaPageLabels(value) {
  let rawValues = value;
  if (typeof value === "string") {
    try {
      rawValues = JSON.parse(value);
    } catch {
      rawValues = value.split(",");
    }
  }
  if (!Array.isArray(rawValues)) return [];
  return rawValues
    .map(item => String(item ?? "").replace(/^[\s"'[\]]+|[\s"'[\]]+$/g, ""))
    .map(item => pathReadableSegment(item, ""))
    .filter(Boolean);
}

async function listeningMediaSelectedPageLabels(testId, pageIds = []) {
  const requestedIds = normalizeListeningMediaPageIds(pageIds);
  if (!testId || !requestedIds.length) return [];
  const pages = await readNationalTestPages();
  const pageById = new Map(pages.filter(page => page.testId === testId).map(page => [page.id, page]));
  return requestedIds
    .map(pageId => listeningMediaPageLabel(pageById.get(pageId)) || "")
    .filter(Boolean);
}

function listeningMediaPageLabel(page) {
  if (!page) return "";
  const baseValue = page.pageLabel || page.pdfLabel || page.pageNumber || page.number;
  const partValue = page.pagePart || page.part;
  const base = baseValue === undefined || baseValue === null ? "" : String(baseValue).trim();
  const part = partValue === undefined || partValue === null || Number(partValue) === 0 ? "" : String(partValue).trim();
  return part && part !== "0" ? `${base}-${part}` : base;
}

function pathReadableSegment(value, fallback = "Item") {
  const segment = stringValue(value)
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 96);
  return safeWindowsReservedName(segment) || fallback;
}

function safeWindowsReservedName(value) {
  const segment = stringValue(value);
  if (!segment) return "";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
    ? `_${segment}`
    : segment;
}

function pathSlugSegment(value, fallback = "item") {
  const slug = stringValue(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || fallback;
}

async function migrateNationalTestListeningMediaStorage() {
  const tests = await readNationalTests();
  let changed = false;
  for (const test of tests) {
    const media = normalizeNationalTestListeningMedia(test.listeningMedia);
    let testChanged = false;

    if (media.audio || media.transcript) {
      const rootTopic = { key: "general", label: "General" };
      const migratedAudio = await migrateListeningMediaRecordToOrganized(media.audio, "audio", {
        test,
        topic: rootTopic,
        mediaGroupId: "media_root"
      });
      const migratedTranscript = await migrateListeningMediaRecordToOrganized(media.transcript, "transcript", {
        test,
        topic: rootTopic,
        mediaGroupId: "media_root"
      });
      if (migratedAudio !== media.audio || migratedTranscript !== media.transcript) {
        media.audio = migratedAudio;
        media.transcript = migratedTranscript;
        testChanged = true;
      }
    }

    media.topics = await Promise.all(media.topics.map(async topic => {
      let topicChanged = false;
      const groups = Array.isArray(topic.mediaGroups) && topic.mediaGroups.length
        ? topic.mediaGroups
        : [topic].filter(item => item.audio || item.transcript);
      const migratedGroups = await Promise.all(groups.map(async (group, index) => {
        const mediaGroupId = await listeningMediaGroupIdForSelectedPages(
          test,
          topic,
          group.pageIds?.length ? group.pageIds : topic.pageIds
        ) || stringValue(group.id) || `media_${index + 1}`;
        const migratedAudio = await migrateListeningMediaRecordToOrganized(group.audio, "audio", {
          test,
          topic,
          mediaGroupId
        });
        const migratedTranscript = await migrateListeningMediaRecordToOrganized(group.transcript, "transcript", {
          test,
          topic,
          mediaGroupId
        });
        if (migratedAudio !== group.audio || migratedTranscript !== group.transcript) {
          topicChanged = true;
        }
        return {
          ...group,
          id: mediaGroupId,
          pageIds: group.pageIds?.length ? group.pageIds : topic.pageIds || [],
          audio: migratedAudio,
          transcript: migratedTranscript
        };
      }));
      const dedupedGroups = dedupeListeningMediaGroups(migratedGroups.filter(group => group.audio || group.transcript));
      if (dedupedGroups.length !== migratedGroups.length) {
        topicChanged = true;
      }
      const firstGroup = dedupedGroups[0] || {};
      if (topicChanged) {
        testChanged = true;
      }
      return {
        ...topic,
        pageIds: firstGroup.pageIds || topic.pageIds || [],
        audio: firstGroup.audio || null,
        transcript: firstGroup.transcript || null,
        mediaGroups: dedupedGroups
      };
    }));

    if (testChanged) {
      test.listeningMedia = media;
      test.updatedAt = nowIso();
      changed = true;
    }
  }
  if (changed) {
    await writeNationalTests(tests);
  }
}

async function migrateListeningMediaRecordToOrganized(record, kind, context = {}) {
  if (!record?.filename) return null;
  const file = {
    fieldname: kind === "audio" ? "listeningAudio" : "listeningTranscript",
    filename: path.basename(record.filename),
    originalname: record.originalName || path.basename(record.filename),
    mimetype: record.mimeType || (kind === "audio" ? listeningAudioMimeType(record.filename) : "application/pdf")
  };
  const relativePath = listeningMediaOrganizedRelativePath(file, context);
  const targetPath = listeningMediaAbsolutePath(relativePath);
  if (listeningMediaIsOrganizedPath(record.filename)) {
    const safeExisting = kind === "audio"
      ? safeListeningAudioFilename(record.filename)
      : safeNationalTestTranscriptFilename(record.filename);
    if (!safeExisting) return null;
    const sourcePath = listeningMediaAbsolutePath(safeExisting);
    const sourceInfo = await stat(sourcePath).catch(() => null);
    if (!sourceInfo?.isFile()) return null;
    if (safeExisting !== relativePath) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await rm(targetPath, { force: true });
      await rename(sourcePath, targetPath);
      await removeEmptyListeningMediaAncestorDirs(path.dirname(sourcePath));
    }
    const targetInfo = await stat(targetPath).catch(() => null);
    return {
      ...record,
      filename: relativePath,
      originalName: record.originalName || path.basename(relativePath),
      mimeType: record.mimeType || file.mimetype,
      size: targetInfo?.size ?? sourceInfo.size ?? record.size,
      url: listeningMediaUrl(relativePath)
    };
  }
  const safeFilename = kind === "audio"
    ? safeListeningAudioFilename(record.filename)
    : safeNationalTestTranscriptFilename(record.filename);
  if (!safeFilename) return record;
  const sourceDir = kind === "audio" ? LEGACY_LISTENING_AUDIO_DIR : LEGACY_LISTENING_TRANSCRIPT_DIR;
  const sourcePath = path.join(sourceDir, safeFilename);
  const sourceInfo = await stat(sourcePath).catch(() => null);
  if (!sourceInfo?.isFile()) return null;
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (await fileExists(targetPath)) {
    await rm(sourcePath, { force: true });
  } else {
    await rename(sourcePath, targetPath);
  }
  const targetInfo = await stat(targetPath).catch(() => null);
  return {
    ...record,
    filename: relativePath,
    mimeType: record.mimeType || file.mimetype,
    size: targetInfo?.size ?? sourceInfo.size ?? record.size,
    url: listeningMediaUrl(relativePath)
  };
}

async function listeningAudioRecordFromFilename(value) {
  const filename = safeListeningAudioFilename(value);
  if (!filename) return null;
  const filePath = listeningMediaIsOrganizedPath(filename)
    ? listeningMediaAbsolutePath(filename)
    : path.join(LEGACY_LISTENING_AUDIO_DIR, filename);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return null;
  return {
    filename,
    originalName: filename,
    mimeType: listeningAudioMimeType(filename),
    size: info.size,
    url: listeningAudioUrl(filename)
  };
}

async function listeningTranscriptRecordFromFilename(value) {
  const filename = safeNationalTestTranscriptFilename(value);
  if (!filename) return null;
  const filePath = listeningMediaIsOrganizedPath(filename)
    ? listeningMediaAbsolutePath(filename)
    : path.join(LEGACY_LISTENING_TRANSCRIPT_DIR, filename);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return null;
  return {
    filename,
    originalName: filename,
    mimeType: "application/pdf",
    size: info.size,
    url: listeningTranscriptUrl(filename)
  };
}

async function listListeningAudioFiles() {
  return [];
}

async function listListeningTranscriptFiles() {
  return [];
}

function compareMediaFileRecords(left, right) {
  return stringValue(left.originalName || left.filename).localeCompare(stringValue(right.originalName || right.filename));
}

async function removeUploadedImage(filename) {
  if (!filename) return;
  await rm(path.join(IMAGE_DIR, path.basename(filename)), { force: true });
}

async function removeUploadedVideo(filename) {
  if (!filename) return;
  await rm(path.join(VIDEO_DIR, path.basename(filename)), { force: true });
}

async function removeNationalTestFile(filename) {
  if (!filename) return;
  await rm(path.join(NATIONAL_TEST_DIR, path.basename(filename)), { force: true });
}

async function removeListeningAudioFile(filename) {
  if (!filename) return;
  const safeFilename = safeListeningAudioFilename(filename);
  if (!safeFilename) return;
  if (!listeningMediaIsOrganizedPath(safeFilename)) return;
  const filePath = listeningMediaAbsolutePath(safeFilename);
  await rm(filePath, { force: true });
}

async function removeListeningTranscriptFile(filename) {
  if (!filename) return;
  const safeFilename = safeNationalTestTranscriptFilename(filename);
  if (!safeFilename) return;
  if (!listeningMediaIsOrganizedPath(safeFilename)) return;
  const filePath = listeningMediaAbsolutePath(safeFilename);
  await rm(filePath, { force: true });
}

async function removeDeletedListeningMediaFiles(group, kind) {
  if (!group || typeof group !== "object") return;
  const removals = [];
  if (kind === "audio" || kind === "all") {
    removals.push(removeListeningAudioFile(group.audio?.filename));
  }
  if (kind === "transcript" || kind === "all") {
    removals.push(removeListeningTranscriptFile(group.transcript?.filename));
  }
  await Promise.all(removals);
}

async function removeListeningMediaGroupDirectory(group) {
  const filenames = [group?.audio?.filename, group?.transcript?.filename]
    .map(stringValue)
    .filter(listeningMediaIsOrganizedPath);
  if (!filenames.length) return;
  const groupDir = path.dirname(listeningMediaAbsolutePath(filenames[0]));
  const root = path.resolve(LISTENING_MEDIA_DIR);
  if (groupDir === root || !groupDir.startsWith(`${root}${path.sep}`)) return;
  await rm(groupDir, { recursive: true, force: true });
  await removeEmptyListeningMediaAncestorDirs(path.dirname(groupDir));
}

async function cleanupUnreferencedListeningMediaStorage(tests = null) {
  const sourceTests = Array.isArray(tests) ? tests : await readNationalTests();
  const referenced = referencedListeningMediaFilenames(sourceTests);
  const files = await listeningMediaStorageFiles();
  await Promise.all(files.map(async filePath => {
    const relativePath = path.relative(LISTENING_MEDIA_DIR, filePath).replace(/\\/g, "/");
    if (!referenced.has(relativePath)) {
      await rm(filePath, { force: true });
    }
  }));
  await removeEmptyListeningMediaAncestorDirs(LISTENING_MEDIA_DIR);
  await mkdir(LISTENING_UPLOAD_TMP_DIR, { recursive: true });
}

async function removeEmptyLegacyListeningFolders() {
  await Promise.all([
    removeLegacyListeningFolderIfEmpty(LEGACY_LISTENING_AUDIO_DIR),
    removeLegacyListeningFolderIfEmpty(LEGACY_LISTENING_TRANSCRIPT_DIR)
  ]);
}

async function removeLegacyListeningFolderIfEmpty(dir) {
  const entries = await readdir(dir).catch(() => null);
  if (!entries) return;
  const meaningfulEntries = entries.filter(name => name !== ".gitkeep");
  if (meaningfulEntries.length) return;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

function referencedListeningMediaFilenames(tests) {
  const filenames = new Set();
  const add = record => {
    const filename = stringValue(record?.filename).replace(/\\/g, "/");
    if (filename && listeningMediaIsOrganizedPath(filename)) {
      filenames.add(filename);
    }
  };
  (tests || []).forEach(test => {
    const media = normalizeNationalTestListeningMedia(test.listeningMedia);
    add(media.audio);
    add(media.transcript);
    media.topics.forEach(topic => {
      add(topic.audio);
      add(topic.transcript);
      (topic.mediaGroups || []).forEach(group => {
        add(group.audio);
        add(group.transcript);
      });
    });
  });
  return filenames;
}

async function listeningMediaStorageFiles(dir = LISTENING_MEDIA_DIR) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(entry => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listeningMediaStorageFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  }));
  return files.flat();
}

async function removeEmptyListeningMediaAncestorDirs(startDir) {
  const root = path.resolve(LISTENING_MEDIA_DIR);
  let current = path.resolve(startDir);
  while (current !== root && current.startsWith(`${root}${path.sep}`)) {
    const entries = await readdir(current).catch(() => null);
    if (!entries || entries.length) break;
    await rm(current, { recursive: true, force: true }).catch(() => {});
    current = path.dirname(current);
  }

  await removeEmptyListeningMediaDirsBottomUp(root);
}

async function removeEmptyListeningMediaDirsBottomUp(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .map(entry => removeEmptyListeningMediaDirsBottomUp(path.join(dir, entry.name))));
  if (path.resolve(dir) === path.resolve(LISTENING_MEDIA_DIR)) return;
  const remaining = await readdir(dir).catch(() => []);
  if (!remaining.length) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function removeNationalTestListeningMediaFiles(media) {
  const normalized = normalizeNationalTestListeningMedia(media);
  const topicFiles = normalized.topics.flatMap(topic => {
    const groups = Array.isArray(topic.mediaGroups) && topic.mediaGroups.length
      ? topic.mediaGroups
      : [topic];
    return groups.flatMap(group => [
      removeListeningAudioFile(group.audio?.filename),
      removeListeningTranscriptFile(group.transcript?.filename)
    ]);
  });
  await Promise.all([
    removeListeningAudioFile(media?.audio?.filename),
    removeListeningTranscriptFile(media?.transcript?.filename),
    ...topicFiles
  ]);
}

async function removeNationalTestUploadFiles(req) {
  const files = uploadedFiles(req, ["pdf", "listeningAudio", "listeningTranscript"]);
  await Promise.all(files.map(file => {
    if (file.fieldname === "listeningAudio" || file.fieldname === "listeningTranscript") {
      return removeListeningTempUploadFile(file);
    }
    return removeNationalTestFile(file.filename);
  }));
}

async function removeListeningTempUploadFile(file) {
  if (!file?.path) return;
  await rm(file.path, { force: true }).catch(() => {});
}

async function removeUploadedImageFilenames(filenames) {
  await Promise.all([...new Set(filenames)].map(filename => removeUploadedImage(filename)));
}

async function removePronunciationFile(filename) {
  if (!filename) return;
  await rm(path.join(PRONUNCIATION_DIR, path.basename(filename)), { force: true });
}

async function removePronunciationFilenames(filenames) {
  await Promise.all([...new Set(filenames)].map(filename => removePronunciationFile(filename)));
}

function uploadedFiles(req, fieldNames) {
  if (req.file && fieldNames.includes(req.file.fieldname)) {
    return [req.file];
  }
  if (Array.isArray(req.files)) {
    return req.files.filter(file => fieldNames.includes(file.fieldname));
  }
  if (req.files && typeof req.files === "object") {
    return fieldNames.flatMap(fieldName => req.files[fieldName] || []);
  }
  return [];
}

async function removeUploadedFiles(files) {
  await Promise.all(files.map(file => removeUploadedImage(file.filename)));
}

function safeVideoFilename(value) {
  const filename = path.basename(stringValue(value));
  return filename && filename === stringValue(value) ? filename : "";
}

function safeNationalTestFilename(value) {
  const filename = path.basename(stringValue(value));
  if (!filename || filename !== stringValue(value)) return "";
  return path.extname(filename).toLocaleLowerCase() === ".pdf" ? filename : "";
}

function safeNationalTestTranscriptFilename(value) {
  return safeMediaStoragePath(value, new Set([".pdf"]));
}

function safeListeningAudioFilename(value) {
  return safeMediaStoragePath(value, LISTENING_AUDIO_EXTENSIONS);
}

function safeMediaStoragePath(value, allowedExtensions) {
  const raw = stringValue(value).replace(/\\/g, "/");
  if (!raw || path.isAbsolute(raw) || /^[a-z]:/i.test(raw)) return "";
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return "";
  const parts = normalized.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.includes("\0"))) return "";
  return allowedExtensions.has(path.extname(normalized).toLocaleLowerCase()) ? normalized : "";
}

function listeningMediaIsOrganizedPath(filename) {
  return stringValue(filename).replace(/\\/g, "/").includes("/");
}

function listeningMediaAbsolutePath(filename) {
  const safeFilename = safeMediaStoragePath(filename, new Set([...LISTENING_AUDIO_EXTENSIONS, ".pdf"]));
  if (!safeFilename) throw httpError(400, "Invalid listening media path");
  const resolved = path.resolve(LISTENING_MEDIA_DIR, ...safeFilename.split("/"));
  const root = path.resolve(LISTENING_MEDIA_DIR);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw httpError(400, "Invalid listening media path");
  }
  return resolved;
}

function listeningMediaUrl(filename) {
  const safeFilename = safeMediaStoragePath(filename, new Set([...LISTENING_AUDIO_EXTENSIONS, ".pdf"]));
  return `/listening-media/${safeFilename.split("/").map(encodeURIComponent).join("/")}`;
}

function listeningAudioUrl(filename, fallbackUrl = "") {
  const safeFilename = safeListeningAudioFilename(filename);
  if (!safeFilename) return "";
  if (listeningMediaIsOrganizedPath(safeFilename)) return listeningMediaUrl(safeFilename);
  const url = stringValue(fallbackUrl);
  return url.startsWith("/listening-media/") ? url : "";
}

function listeningTranscriptUrl(filename, fallbackUrl = "") {
  const safeFilename = safeNationalTestTranscriptFilename(filename);
  if (!safeFilename) return "";
  if (listeningMediaIsOrganizedPath(safeFilename)) return listeningMediaUrl(safeFilename);
  const url = stringValue(fallbackUrl);
  return url.startsWith("/listening-media/") ? url : "";
}

function normalizedListeningTopicKey(value) {
  return stringValue(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nationalTestUploadExtension(file) {
  if (file.fieldname === "listeningAudio") {
    const extension = path.extname(file.originalname || "").toLocaleLowerCase();
    if (LISTENING_AUDIO_EXTENSIONS.has(extension)) return extension;
    const mimeType = stringValue(file.mimetype).toLocaleLowerCase();
    if (mimeType === "video/mp4") return ".mp4";
    if (mimeType.includes("ogg")) return ".ogg";
    if (mimeType.includes("wav")) return ".wav";
    if (mimeType.includes("webm")) return ".webm";
    return ".mp3";
  }
  return ".pdf";
}

function isAcceptedNationalTestUpload(file) {
  const mimeType = stringValue(file.mimetype).toLocaleLowerCase();
  const extension = path.extname(file.originalname || "").toLocaleLowerCase();
  if (file.fieldname === "listeningAudio") {
    return mimeType.startsWith("audio/") || mimeType === "video/mp4" || LISTENING_AUDIO_EXTENSIONS.has(extension);
  }
  return mimeType === "application/pdf" || extension === ".pdf";
}

function listeningAudioMimeType(filename) {
  const extension = path.extname(filename || "").toLocaleLowerCase();
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".ogg") return "audio/ogg";
  if (extension === ".webm") return "audio/webm";
  return "audio/mpeg";
}

function nowIso() {
  return new Date().toISOString();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
