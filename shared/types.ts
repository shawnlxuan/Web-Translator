// ============================================================
// Core domain types for the AI Translator extension
// ============================================================

/** Supported LLM provider types */
export type ProviderType = 'openai' | 'anthropic' | 'deepseek' | 'glm' | 'mimo' | 'custom';

export type ProviderStringMap = Record<ProviderType, string>;

/** Display mode for translations */
export type DisplayMode = 'bilingual' | 'replace';

/** Classification of text in the DOM */
export enum TextType {
  HEADING = 'heading',
  PARAGRAPH = 'paragraph',
  LIST_ITEM = 'list-item',
  BUTTON = 'button',
  LINK = 'link',
  CAPTION = 'caption',
  TABLE_CELL = 'table-cell',
  CODE_BLOCK = 'code-block',
  NAV_ITEM = 'nav-item',
  OTHER = 'other',
}

/** A text node extracted from the DOM, with metadata */
export interface ExtractedTextNode {
  /** Live reference to the DOM Text node */
  textNode: Text;
  /** Trimmed text content */
  text: string;
  /** Nearest block-level ancestor element */
  blockElement: Element;
  /** Unique segment identifier */
  segmentId: string;
  /** Type classification */
  type: TextType;
  /** Bounding rectangle for viewport-aware lazy translation */
  boundingRect: DOMRect;
  /** Whether this node is currently visible in the viewport */
  isVisible: boolean;
}

/** A segment groups related text nodes (e.g., all nodes in one paragraph) */
export interface Segment {
  id: string;
  type: TextType;
  tagName: string;
  /** All text nodes belonging to this segment */
  textNodes: ExtractedTextNode[];
  /** The sentences split from the combined text */
  sentences: string[];
  /** The block element containing this segment */
  blockElement: Element;
  /** Whether translation has been requested for this segment */
  isTranslated: boolean;
  /** The full original text (combined from all text nodes) */
  originalText: string;
}

/** Structured context collected for a single sentence */
export interface SegmentContext {
  /** The sentence to translate */
  sentence: string;
  /** Type of containing element */
  textType: TextType;
  /** HTML tag name of containing element */
  tagName: string;
  /** Placeholder or aria-label for form elements */
  placeholder?: string;
  /** Page title */
  pageTitle: string;
  /** Meta description */
  pageMetaDescription: string;
  /** Page language from <html lang="..."> */
  pageLanguage: string;
  /** Breadcrumb path of headings (H1 > H2 > H3...) */
  headingPath: string[];
  /** Nearest heading above this text */
  sectionTitle?: string;
  /** N sentences before this one */
  beforeSentences: string[];
  /** N sentences after this one */
  afterSentences: string[];
  /** Text from sibling elements */
  siblingContext?: string;
}

/** A single sentence with its context, ready for translation */
export interface SentenceWithContext {
  sentenceIndex: number;
  segmentId: string;
  sentence: string;
  context: SegmentContext;
}

/** A batch of sentences sent to the LLM API */
export interface TranslationBatch {
  sentences: SentenceWithContext[];
  sourceLang: string;
  targetLang: string;
}

/** Result for a single translated sentence */
export interface TranslationResult {
  sentenceIndex: number;
  segmentId: string;
  translation: string;
  /** Whether this came from cache */
  fromCache: boolean;
}

/** Language pair configuration */
export interface LanguagePair {
  sourceLang: string;
  targetLang: string;
}

/** Provider-specific API configuration */
export interface ProviderConfig {
  type: ProviderType;
  apiKey: string;
  model: string;
  endpoint?: string; // For custom endpoints
}

/** Full extension settings */
export interface Settings {
  provider: ProviderType;
  apiKeys: ProviderStringMap;
  models: ProviderStringMap;
  customEndpoints: ProviderStringMap;
  sourceLang: string;       // 'auto' or specific language code
  targetLang: string;
  displayMode: DisplayMode;
  contextWindowSize: number; // Number of surrounding sentences (default 3)
  batchSize: number;         // Sentences per API call (default 5)
  cacheTTLDays: number;      // Days to keep cached translations
  maxConcurrentCalls: number;
  translationColor: string;
  bilingualStyle: 'inline' | 'block';
  enableMutationObserver: boolean;
  customPromptTemplate: string;
}

/** State of the translation process on a page */
export enum TranslationState {
  IDLE = 'idle',
  EXTRACTING = 'extracting',
  TRANSLATING = 'translating',
  COMPLETE = 'complete',
  ERROR = 'error',
}

/** Progress update sent to popup */
export interface TranslationProgress {
  pageId: string;
  state: TranslationState;
  totalSegments: number;
  translatedSegments: number;
  errorMessage?: string;
}

/** Cached translation entry */
export interface CacheEntry {
  translation: string;
  timestamp: number;
  hitCount: number;
}
