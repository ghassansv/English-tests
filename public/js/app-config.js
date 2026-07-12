export const DEFAULT_REVIEW_WORD_COUNT = 10;

export const SOURCE_TREE_COLLAPSE_STORAGE_KEY = "sourceTreeCollapsed";
export const NATIONAL_TEST_PAGE_GROUP_COLLAPSE_STORAGE_KEY = "nationalTestPageGroupsCollapsed";
export const NATIONAL_TEST_PROGRESS_STORAGE_KEY = "nationalTestProgress";
export const TEST_KNOWN_TOKEN_IGNORE_STORAGE_KEY = "testKnownTokenIgnoreList";
export const TEST_PAGE_GROUPING_TOOL_COLLAPSE_STORAGE_KEY = "testPageGroupingToolCollapsed";
export const TEST_PAGE_GROUPING_TOOL_HIDDEN_STORAGE_KEY = "testPageGroupingToolHidden";
export const TEST_PAGE_PDF_COLLAPSE_STORAGE_KEY = "testPagePdfCollapsed";
export const TEST_PAGE_WORD_PRACTICE_HIDDEN_STORAGE_KEY = "testPageWordPracticeHidden";
export const TEST_PAGE_PDF_ZOOM_STORAGE_KEY = "testPagePdfZoom";
export const TEST_PAGE_LIST_WIDTH_STORAGE_KEY = "testPageListWidth";
export const TEST_PAGE_LIST_COLLAPSE_STORAGE_KEY = "testPageListCollapsed";
export const TEST_PAGE_PRACTICE_WIDTH_STORAGE_KEY = "testPagePracticeWidth";
export const TEST_PAGE_VISUAL_ZOOM_STORAGE_KEY = "testPageVisualZoom";
export const TEST_PAGE_TRANSLATION_LANGUAGE_STORAGE_KEY = "testPageTranslationLanguage";
export const ACTIVE_SECTION_STORAGE_KEY = "activeAppSection";
export const DATABASE_CACHE_STORAGE_KEY = "englishWordVaultDatabaseCache";
export const DATABASE_CACHE_SCHEMA_VERSION = 4;

export const WORD_RENDER_BATCH_SIZE = 50;
export const STUDY_TEXT_RENDER_BATCH_SIZE = 50;
export const STUDY_VIDEO_RENDER_BATCH_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 180;
export const TEST_PAGE_VISUAL_ZOOM_MIN = 0.6;
export const TEST_PAGE_VISUAL_ZOOM_MAX = 2.2;
export const TEST_PAGE_VISUAL_ZOOM_STEP = 0.1;
export const TEST_PAGE_PDF_ZOOM_MIN = 0.5;
export const TEST_PAGE_PDF_ZOOM_MAX = 2.5;
export const TEST_PAGE_PDF_ZOOM_STEP = 0.1;
export const NATIONAL_TEST_SOURCE_NAME = "National Tests";
export const STUDY_AUTOSAVE_DELAY_MS = 2200;

export const STUDY_TEXT_TYPES = [
  { value: "note", label: "Note" },
  { value: "summary", label: "Summary" },
  { value: "assignment", label: "Assignment" },
  { value: "reflection", label: "Reflection" },
  { value: "vocabulary", label: "Vocabulary" },
  { value: "draft", label: "Draft" },
  { value: "essay", label: "Essay" }
];

export const ESSAY_BODY_PARAGRAPH_MIN = 1;
export const ESSAY_BODY_PARAGRAPH_MAX = 6;
export const ESSAY_BODY_PARAGRAPH_FIELDS = [
  "idea",
  "sourceExample",
  "anotherReason",
  "wrapUp"
];

export const ESSAY_BODY_STARTERS = {
  idea: [
    "Firstly,",
    "One important point is",
    "One main reason is",
    "To begin with,",
    "It is important to consider"
  ],
  sourceExample: [
    "For example,",
    "For instance,",
    "According to",
    "Research shows that",
    "This can be seen in",
    "A clear example of this is"
  ],
  anotherReason: [
    "Secondly,",
    "Furthermore,",
    "In addition,",
    "Another important point is",
    "Similarly,",
    "Moreover,"
  ],
  wrapUp: [
    "In summary,",
    "Therefore,",
    "Overall,",
    "Consequently,",
    "For these reasons,",
    "This shows that",
    "It is therefore clear that"
  ]
};

export const ESSAY_SUPPORT_MIN = 1;
export const ESSAY_SUPPORT_MAX = 6;
export const ESSAY_SUPPORT_FIELDS = [
  "ownWords",
  "source",
  "comment"
];

export const STUDY_VIDEO_TYPES = [
  { value: "assignment", label: "Assignment" },
  { value: "presentation", label: "Presentation" },
  { value: "practice", label: "Practice" },
  { value: "reflection", label: "Reflection" },
  { value: "draft", label: "Draft" }
];

export const NATIONAL_TEST_SECTIONS = [
  { key: "reading", name: "Reading", icon: "book-open" },
  { key: "writing", name: "Writing", icon: "pen-line" },
  { key: "listening", name: "Listening", icon: "headphones" },
  { key: "speaking", name: "Speaking", icon: "mic" }
];

export const UNGROUPED_NATIONAL_TEST_TOPIC = "Ungrouped pages";
