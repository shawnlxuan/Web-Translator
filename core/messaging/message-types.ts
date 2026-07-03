// ============================================================
// Type-safe message definitions for extension IPC
// ============================================================

import type { Settings, DisplayMode, TranslationProgress, TranslationState } from '../../shared/types';

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
}

export interface GetTranslationStatePopupMessage {
  type: 'GET_TRANSLATION_STATE';
}

export interface FetchModelsMessage {
  type: 'FETCH_MODELS';
  provider: string;
  apiKey: string;
  endpoint: string;
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
  | FetchModelsMessage;

// ---- Background → Content Script ----

export interface ExecuteTranslationMessage {
  type: 'EXECUTE_TRANSLATION';
  pageId: string;
  targetLang: string;
  sourceLang: string;
  displayMode: DisplayMode;
}

export interface InjectTranslationsMessage {
  type: 'INJECT_TRANSLATIONS';
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
}

export interface ContentTranslationErrorMessage {
  type: 'TRANSLATION_ERROR';
  pageId: string | null;
  error: string;
}

/** All messages sent from background to content script */
export type BackgroundToContentMessage =
  | ExecuteTranslationMessage
  | InjectTranslationsMessage
  | ToggleDisplayModeMessage
  | GetTranslationStateMessage
  | ContentStopTranslationMessage
  | ContentTranslationErrorMessage;

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
    context: any; // SegmentContext (serialized)
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

/** All response messages from background to popup/options */
export type BackgroundToPopupMessage =
  | SettingsResponse
  | TranslationStartedResponse
  | TranslationProgressResponse
  | TranslationStoppedResponse
  | CacheClearedResponse
  | ApiTestResponse
  | FetchModelsResponse;

// ---- Union of all possible messages ----

export type AnyMessage =
  | PopupToBackgroundMessage
  | BackgroundToContentMessage
  | ContentToBackgroundMessage
  | BackgroundToPopupMessage;
