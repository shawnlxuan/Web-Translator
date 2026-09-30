import { describe, expect, it } from 'vitest';
import {
  groupProviderProfiles,
  isProviderReady,
  truncateToCodePoints,
} from '../../../entrypoints/popup/popup-utils';
import { createBuiltinProviderProfiles } from '../../../shared/provider-presets';

describe('popup helpers', () => {
  it('limits manual input by Unicode code points', () => {
    expect(truncateToCodePoints('😀😀a', 2)).toBe('😀😀');
  });

  it('groups built-in and custom profiles for one shared selector', () => {
    const builtins = createBuiltinProviderProfiles();
    const custom = {
      ...builtins[0],
      id: 'custom:one' as const,
      kind: 'custom' as const,
      name: 'Local',
      preset: undefined,
    };

    expect(groupProviderProfiles([...builtins, custom])).toEqual({
      builtins,
      custom: [custom],
    });
  });

  it('requires key, endpoint, and model before enabling translation', () => {
    const profile = { ...createBuiltinProviderProfiles()[0], apiKey: 'key' };
    expect(isProviderReady(profile)).toBe(true);
    expect(isProviderReady({
      ...profile,
      endpoint: 'https://gateway.example.com/v1/chat/completions',
    })).toBe(false);
    expect(isProviderReady({ ...profile, model: ' ' })).toBe(false);
  });

  it('does not inject assets when the content script already responds', async () => {
    const ensureContentScript = await loadEnsureContentScript();
    const calls: string[] = [];

    await ensureContentScript(7, {
      ping: async (tabId) => { calls.push(`ping:${tabId}`); },
      insertCss: async () => { calls.push('css'); },
      executeScript: async () => { calls.push('js'); },
      wait: async () => { calls.push('wait'); },
    });

    expect(calls).toEqual(['ping:7']);
  });

  it('injects CSS before JavaScript and verifies the content script afterward', async () => {
    const ensureContentScript = await loadEnsureContentScript();
    const calls: string[] = [];
    let pingCount = 0;

    await ensureContentScript(9, {
      ping: async (tabId) => {
        calls.push(`ping:${tabId}`);
        pingCount++;
        if (pingCount === 1) throw new Error('Receiving end does not exist');
      },
      insertCss: async (tabId) => { calls.push(`css:${tabId}`); },
      executeScript: async (tabId) => { calls.push(`js:${tabId}`); },
      wait: async (milliseconds) => { calls.push(`wait:${milliseconds}`); },
    });

    expect(calls).toEqual([
      'ping:9',
      'css:9',
      'js:9',
      'wait:120',
      'ping:9',
    ]);
  });

  it('stops bootstrapping and reports CSS injection failures', async () => {
    const ensureContentScript = await loadEnsureContentScript();
    const calls: string[] = [];

    await expect(ensureContentScript(11, {
      ping: async () => { calls.push('ping'); throw new Error('not installed'); },
      insertCss: async () => { calls.push('css'); throw new Error('CSS blocked'); },
      executeScript: async () => { calls.push('js'); },
      wait: async () => { calls.push('wait'); },
    })).rejects.toThrow('CSS blocked');

    expect(calls).toEqual(['ping', 'css']);
  });
});

type EnsureContentScript = (
  tabId: number,
  dependencies: {
    ping: (tabId: number) => Promise<unknown>;
    insertCss: (tabId: number) => Promise<unknown>;
    executeScript: (tabId: number) => Promise<unknown>;
    wait: (milliseconds: number) => Promise<void>;
  },
) => Promise<void>;

async function loadEnsureContentScript(): Promise<EnsureContentScript> {
  const module = await import('../../../entrypoints/popup/popup-utils');
  const ensureContentScript = (module as unknown as {
    ensureContentScript?: EnsureContentScript;
  }).ensureContentScript;

  expect(typeof ensureContentScript).toBe('function');
  return ensureContentScript!;
}
