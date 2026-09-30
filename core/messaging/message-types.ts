// ============================================================
// Type-safe message definitions for extension IPC
// ============================================================

import type {
  Settings,
  DisplayMode,
  ProviderProfile,
  SegmentContext,
  TranslationProgress,
  TranslationState,
} from '../../shared/types';

// ---- Popup → Background ----

export interface StartTranslationMessage {
  type: 'START_TRANSLATION';
  targetLang?: string;
  sourceLang?: string;
}

export interface StopTranslationMessage {
  type: 'STOP_TRANSLATION';
}

export interface GetSettingsMessage {
  type: 'GET_SETTINGS';
}

export interface UpdateSettingsMessage {
  type: 'UPDATE_SETTINGS';
  settings: Partial<Settings>;
}

export interface ClearCacheMessage {
  type: 'CLEAR_CACHE';
}

export interface TestApiConnectionMessage {
  type: 'TEST_API_CONNECTION';
  profile: ProviderProfile;
}

export interface GetTranslationStatePopupMessage {
  type: 'GET_TRANSLATION_STATE';
}

export interface FetchModelsMessage {
  type: 'FETCH_MODELS';
  profile: ProviderProfile;
}

export interface TranslateTextMessage {
  type: 'TRANSLATE_TEXT';
  text: string;
  sourceLang: string;
  targetLang: string;
}

export interface TranslateSelectionMessage {
  type: 'TRANSLATE_SELECTION';
  text: string;
  context: SegmentContext;
}

/** All messages sent from popup/options to background */
export type PopupToBackgroundMessage =
  | StartTranslationMessage
  | StopTranslationMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | ClearCacheMessage
  | TestApiConnectionMessage
  | GetTranslationStatePopupMessage
  | FetchModelsMessage
  | TranslateTextMessage;

// ---- Background → Content Script ----

export interface ExecuteTranslationMessage {
  type: 'EXECUTE_TRANSLATION';
  pageId: string;
  targetLang: string;
  sourceLang: string;
  displayMode: DisplayMode;
  batchSize: number;
  maxConcurrentCalls: number;
  contextWindowSize: number;
  translationColor: string;
  enableMutationObserver: boolean;
  /** Native MT can translate a plain paragraph in one request. */
  translateByParagraph?: boolean;
}

export interface InjectTranslationsMessage {
  type: 'INJECT_TRANSLATIONS';
  pageId: string;
  translations: Array<{
    segmentId: string;
    sentenceIndex: number;
    translation: string;
  }>;
}

export interface ToggleDisplayModeMessage {
  type: 'TOGGLE_DISPLAY_MODE';
  displayMode: DisplayMode;
}

export interface ContentStopTranslationMessage {
  type: 'STOP_TRANSLATION';
  pageId: string;
}

export interface ContentTranslationErrorMessage {
  type: 'TRANSLATION_ERROR';
  pageId: string | null;
  error: string;
}

export interface TriggerSelectionTranslationMessage {
  type: 'TRIGGER_SELECTION_TRANSLATION';
  selectionText?: string;
}

/** All messages sent from background to content script */
export type BackgroundToContentMessage =
  | ExecuteTranslationMessage
  | InjectTranslationsMessage
  | ToggleDisplayModeMessage
  | GetTranslationStateMessage
  | ContentStopTranslationMessage
  | ContentTranslationErrorMessage
  | TriggerSelectionTranslationMessage;

// ---- Content Script → Background ----

export interface SegmentsReadyMessage {
  type: 'SEGMENTS_READY';
  pageId: string;
  sourceLang: string;
  targetLang: string;
  batch: Array<{
    segmentId: string;
    sentenceIndex: number;
    sentence: string;
    context: SegmentContext;
  }>;
}

export interface TranslationProgressUpdateMessage {
  type: 'TRANSLATION_PROGRESS';
  pageId: string;
  progress: TranslationProgress;
}

export interface TranslationCompleteMessage {
  type: 'TRANSLATION_COMPLETE';
  pageId: string;
}

export interface TranslationErrorMessage {
  type: 'TRANSLATION_ERROR';
  pageId: string | null;
  error: string;
  segmentId?: string;
}

export interface GetTranslationStateMessage {
  type: 'GET_TRANSLATION_STATE';
}

export interface TranslationStateUpdateMessage {
  type: 'TRANSLATION_STATE_UPDATE';
  pageId: string | null;
  state: TranslationState;
  totalSegments: number;
  translatedSegments: number;
  errorMessage?: string;
}

/** All messages sent from content script to background */
export type ContentToBackgroundMessage =
  | SegmentsReadyMessage
  | TranslateSelectionMessage
  | TranslationProgressUpdateMessage
  | TranslationCompleteMessage
  | TranslationErrorMessage
  | GetTranslationStateMessage
  | TranslationStateUpdateMessage;

// ---- Background → Popup/Options ----

export interface SettingsResponse {
  type: 'SETTINGS_RESPONSE';
  settings: Settings;
}

export interface TranslationStartedResponse {
  type: 'TRANSLATION_STARTED';
  pageId: string;
}

export interface TranslationProgressResponse {
  type: 'TRANSLATION_PROGRESS';
  progress: TranslationProgress;
}

export interface TranslationStoppedResponse {
  type: 'TRANSLATION_STOPPED';
}

export interface CacheClearedResponse {
  type: 'CACHE_CLEARED';
}

export interface ApiTestResponse {
  type: 'API_TEST_RESPONSE';
  success: boolean;
  message: string;
}

export interface FetchModelsResponse {
  type: 'FETCH_MODELS_RESPONSE';
  success: boolean;
  models: string[];
  error?: string;
}

export interface TranslateTextResponse {
  type: 'TRANSLATE_TEXT_RESPONSE';
  success: boolean;
  translation?: string;
  error?: string;
}

export interface TranslateSelectionResponse {
  type: 'TRANSLATE_SELECTION_RESPONSE';
  success: boolean;
  translation?: string;
  error?: string;
}

/** All response messages from background to popup/options */
export type BackgroundToPopupMessage =
  | SettingsResponse
  | TranslationStartedResponse
  | TranslationProgressResponse
  | TranslationStoppedResponse
  | CacheClearedResponse
  | ApiTestResponse
  | FetchModelsResponse
  | TranslateTextResponse
  | TranslateSelectionResponse;

// ---- Union of all possible messages ----

export type AnyMessage =
  | PopupToBackgroundMessage
  | BackgroundToContentMessage
  | ContentToBackgroundMessage
  | BackgroundToPopupMessage;
