// ============================================================
// Helper functions for type-safe message passing
// ============================================================

import type { AnyMessage } from './message-types';

/**
 * Send a message to the background service worker and expect a response.
 */
export async function sendToBackground<T = any>(
  message: AnyMessage,
): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

/**
 * Send a message to a specific tab's content script.
 */
export async function sendToContentScript<T = any>(
  tabId: number,
  message: AnyMessage,
): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

/**
 * Send a message to the active tab's content script.
 */
export async function sendToActiveTab<T = any>(
  message: AnyMessage,
): Promise<T | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0 || tabs[0].id == null) return null;
  return sendToContentScript<T>(tabs[0].id, message);
}

/**
 * Add a listener for messages from the background.
 */
export function onBackgroundMessage(
  handler: (
    message: AnyMessage,
    sender: chrome.runtime.MessageSender,
  ) => Promise<any> | any,
): () => void {
  const listener = (
    message: AnyMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ) => {
    const result = handler(message, sender);
    if (result instanceof Promise) {
      result.then(sendResponse).catch((err) => {
        console.error('[AI Translator] Message handler error:', err);
        sendResponse({ error: err.message });
      });
      return true; // Keep the message channel open for async response
    }
    sendResponse(result);
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/**
 * Listen for messages from the popup/options in the background.
 * Only handles messages from extension pages (popup, options, side panel).
 * Non-extension messages are silently passed through without calling sendResponse,
 * so that other listeners can handle them.
 */
export function onPopupMessage(
  handler: (message: AnyMessage) => Promise<any> | any,
): () => void {
  const listener = (
    message: AnyMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ) => {
    // Only handle messages from extension pages (popup, options)
    const extensionUrl = chrome.runtime.getURL('');
    if (!sender.url?.startsWith(extensionUrl)) {
      // Return false: we are NOT responding to this message
      // Chrome will let other listeners try to respond
      return false;
    }

    const result = handler(message);
    if (result instanceof Promise) {
      result.then(sendResponse).catch((err) => {
        console.error('[AI Translator] Popup handler error:', err);
        sendResponse({ error: err.message });
      });
      return true; // Async response
    }
    sendResponse(result);
    return false;
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/**
 * Add a listener for specific message types.
 */
export function onMessageType<T extends AnyMessage>(
  type: T['type'],
  handler: (message: T, sender: chrome.runtime.MessageSender) => Promise<any> | any,
): () => void {
  return onBackgroundMessage((message, sender) => {
    if (message.type === type) {
      return handler(message as T, sender);
    }
  });
}
