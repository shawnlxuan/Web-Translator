import type { ProviderProfile } from '../../shared/types';
import { validateProviderEndpoint } from '../../shared/provider-presets';

export interface ContentScriptBootstrapDependencies {
  ping: (tabId: number) => Promise<unknown>;
  insertCss: (tabId: number) => Promise<unknown>;
  executeScript: (tabId: number) => Promise<unknown>;
  wait: (milliseconds: number) => Promise<void>;
}

export async function ensureContentScript(
  tabId: number,
  dependencies: ContentScriptBootstrapDependencies = createChromeBootstrapDependencies(),
): Promise<void> {
  try {
    await dependencies.ping(tabId);
    return;
  } catch {
    // Tabs opened before an extension reload need both content assets injected.
  }

  await dependencies.insertCss(tabId);
  await dependencies.executeScript(tabId);
  await dependencies.wait(120);
  await dependencies.ping(tabId);
}

export function truncateToCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('');
}

export function groupProviderProfiles(profiles: readonly ProviderProfile[]): {
  builtins: ProviderProfile[];
  custom: ProviderProfile[];
} {
  return {
    builtins: profiles.filter((profile) => profile.kind === 'builtin'),
    custom: profiles.filter((profile) => profile.kind === 'custom'),
  };
}

export function isProviderReady(profile: ProviderProfile): boolean {
  const complete = Boolean(
    profile.apiKey.trim()
    && profile.endpoint.trim()
    && profile.model.trim(),
  );
  if (!complete) return false;

  try {
    validateProviderEndpoint(profile.endpoint, profile.protocol);
    return true;
  } catch {
    return false;
  }
}

function createChromeBootstrapDependencies(): ContentScriptBootstrapDependencies {
  return {
    ping: (tabId) => chrome.tabs.sendMessage(tabId, {
      type: 'GET_TRANSLATION_STATE',
    }),
    insertCss: (tabId) => chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content-scripts/content.css'],
    }),
    executeScript: (tabId) => chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    }),
    wait: (milliseconds) => new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    }),
  };
}
