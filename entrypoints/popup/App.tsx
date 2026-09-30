import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, SUPPORTED_LANGUAGES } from '../../shared/constants';
import { TranslationState } from '../../shared/types';
import type { DisplayMode, ProviderId, Settings } from '../../shared/types';
import { resolveActiveProvider } from '../../shared/provider-presets';
import LanguageSelector from './components/LanguageSelector';
import ModeToggle from './components/ModeToggle';
import TranslateButton from './components/TranslateButton';
import Icon from '../../shared/components/Icon';
import {
  ensureContentScript,
  groupProviderProfiles,
  isProviderReady,
  truncateToCodePoints,
} from './popup-utils';

const APP_ICON_URL = chrome.runtime.getURL('content-ui/ai_translate_icon.svg');
const MANUAL_LIMIT = 2000;

type PopupTab = 'page' | 'text';

const App: React.FC = () => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<PopupTab>('page');
  const [sourceLang, setSourceLang] = useState(DEFAULT_SETTINGS.sourceLang);
  const [targetLang, setTargetLang] = useState(DEFAULT_SETTINGS.targetLang);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(DEFAULT_SETTINGS.displayMode);

  const [pageState, setPageState] = useState<TranslationState>(TranslationState.IDLE);
  const [pageProgress, setPageProgress] = useState({ total: 0, translated: 0 });
  const [pageError, setPageError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const activePageTabId = useRef<number | null>(null);

  const [manualText, setManualText] = useState('');
  const [manualResult, setManualResult] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [copyLabel, setCopyLabel] = useState('复制');
  const manualRequestId = useRef(0);
  const manualInFlight = useRef(false);

  const activeProvider = useMemo(() => resolveActiveProvider(settings), [settings]);
  const providerReady = isProviderReady(activeProvider);
  const providerGroups = useMemo(
    () => groupProviderProfiles(settings.providerProfiles),
    [settings.providerProfiles],
  );
  const pageBusy = pageState === TranslationState.EXTRACTING
    || pageState === TranslationState.TRANSLATING;
  const pageComplete = pageState === TranslationState.COMPLETE;

  const updateSettings = useCallback(async (partial: Partial<Settings>) => {
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: partial,
    });
    if (!response?.settings) throw new Error('设置更新失败');
    const updated = response.settings as Settings;
    setSettings(updated);
    return updated;
  }, []);

  const queryPageState = useCallback(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activePageTabId.current = tabs[0]?.id ?? null;
      const response = await chrome.runtime.sendMessage({ type: 'GET_TRANSLATION_STATE' });
      if (!response) return;
      const nextState = response.state || TranslationState.IDLE;
      setPageState(nextState);
      setPageProgress({
        total: response.totalSegments || 0,
        translated: response.translatedSegments || 0,
      });
      setPageError(nextState === TranslationState.ERROR
        ? response.errorMessage || '翻译出错'
        : null);
    } catch {
      // Restricted browser pages may not have a content script.
    }
  }, []);

  useEffect(() => {
    const listener = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
      if (message.type === 'TRANSLATION_STATE_UPDATE' && sender.tab?.id === activePageTabId.current) {
        void queryPageState();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [queryPageState]);

  useEffect(() => () => { manualRequestId.current++; }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
      .then((response) => {
        if (!response?.settings) return;
        const next = response.settings as Settings;
        setSettings(next);
        setSourceLang(next.sourceLang);
        setTargetLang(next.targetLang);
        setDisplayMode(next.displayMode);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    void queryPageState();
  }, [queryPageState]);

  useEffect(() => {
    if (pageBusy) {
      pollRef.current = window.setInterval(() => void queryPageState(), 800);
    } else if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [pageBusy, queryPageState]);

  const selectProvider = async (id: ProviderId) => {
    manualRequestId.current++;
    manualInFlight.current = false;
    setManualLoading(false);
    setManualResult('');
    setPageError(null);
    setManualError(null);
    try {
      await updateSettings({ activeProviderId: id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (activeTab === 'page') {
        setPageError(message);
      } else {
        setManualError(message);
      }
    }
  };

  const changeSourceLanguage = (value: string) => {
    manualRequestId.current++;
    manualInFlight.current = false;
    setManualLoading(false);
    setManualResult('');
    setSourceLang(value);
    void updateSettings({ sourceLang: value }).catch(() => {});
  };

  const changeTargetLanguage = (value: string) => {
    manualRequestId.current++;
    manualInFlight.current = false;
    setManualLoading(false);
    setManualResult('');
    setTargetLang(value);
    void updateSettings({ targetLang: value }).catch(() => {});
  };

  const toggleMode = async (mode: DisplayMode) => {
    setDisplayMode(mode);
    setPageError(null);
    try {
      await updateSettings({ displayMode: mode });
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id != null) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TOGGLE_DISPLAY_MODE',
          displayMode: mode,
        }).catch(() => {});
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePageTranslation = async () => {
    setPageError(null);
    if (pageBusy || pageComplete) {
      try {
        await chrome.runtime.sendMessage({ type: 'STOP_TRANSLATION' });
        setPageState(TranslationState.IDLE);
        setPageProgress({ total: 0, translated: 0 });
      } catch (error) {
        setPageError(`取消翻译失败：${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId == null) throw new Error('无法获取当前标签页');
      try {
        await ensureContentScript(tabId);
      } catch (error) {
        throw new Error(
          `无法在当前页面运行：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const response = await chrome.runtime.sendMessage({
        type: 'START_TRANSLATION',
        sourceLang,
        targetLang,
      });
      if (response?.type === 'TRANSLATION_ERROR') throw new Error(response.error);
      setPageState(TranslationState.TRANSLATING);
      void queryPageState();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error));
      setPageState(TranslationState.ERROR);
    }
  };

  const translateText = async () => {
    if (manualInFlight.current || !providerReady) return;
    const text = manualText.trim();
    if (!text) {
      setManualError('请输入要翻译的文字');
      return;
    }
    setManualLoading(true);
    manualInFlight.current = true;
    const requestId = ++manualRequestId.current;
    setManualError(null);
    setManualResult('');
    setCopyLabel('复制');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        text,
        sourceLang,
        targetLang,
      });
      if (requestId !== manualRequestId.current) return;
      if (!response?.success || !response.translation) {
        throw new Error(response?.error || '翻译失败');
      }
      setManualResult(response.translation);
    } catch (error) {
      if (requestId === manualRequestId.current) {
        setManualError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestId === manualRequestId.current) {
        manualInFlight.current = false;
        setManualLoading(false);
      }
    }
  };

  const copyResult = async () => {
    if (!manualResult) return;
    try {
      await navigator.clipboard.writeText(manualResult);
      setCopyLabel('已复制');
      window.setTimeout(() => setCopyLabel('复制'), 1400);
    } catch {
      setManualError('复制失败');
    }
  };

  if (!loaded) return <div className="popup-loading">加载中...</div>;

  return (
    <main className="app-container">
      <header className="app-header">
        <div className="brand-row">
          <img className="app-logo" src={APP_ICON_URL} alt="" />
          <h1 className="app-title">网页翻译</h1>
        </div>
        <button className="header-settings" onClick={() => chrome.runtime.openOptionsPage()}>
          <Icon name="settings" size={19} />设置
        </button>
      </header>

      <div className="main-tabs" role="tablist" aria-label="翻译类型">
        <button role="tab" id="page-tab" aria-controls="page-panel" aria-selected={activeTab === 'page'}
          className={activeTab === 'page' ? 'active' : ''}
          onClick={() => setActiveTab('page')}><Icon name="globe" size={21} />网页翻译</button>
        <button role="tab" id="text-tab" aria-controls="text-panel" aria-selected={activeTab === 'text'}
          className={activeTab === 'text' ? 'active' : ''}
          onClick={() => setActiveTab('text')}><Icon name="file" size={21} />文本翻译</button>
      </div>

      <section className="tab-panel" role="tabpanel" id={`${activeTab}-panel`} aria-labelledby={`${activeTab}-tab`}>
        <div className="popup-card">
          <section className="shared-controls">
            <label className="provider-control">
              <span className="control-label">API</span>
              <select value={settings.activeProviderId}
                onChange={(event) => void selectProvider(event.target.value as ProviderId)}>
                <optgroup label="固定提供商">
                  {providerGroups.builtins.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </optgroup>
                {providerGroups.custom.length > 0 && (
                  <optgroup label="自定义 API">
                    {providerGroups.custom.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <div className={providerReady ? 'provider-summary ready' : 'provider-summary missing'}>
              <span className="provider-model" title={activeProvider.model}>
                <span className="status-dot" aria-hidden="true" />
                <span className="provider-model-name">{activeProvider.model || '未设置模型'}</span>
              </span>
              <span className="provider-status">{providerReady ? '可用' : '未配置'}</span>
            </div>
          </section>

          <div className="language-grid">
            <LanguageSelector label="源语言" value={sourceLang} languages={SUPPORTED_LANGUAGES} onChange={changeSourceLanguage} />
            <LanguageSelector label="目标" value={targetLang}
              languages={SUPPORTED_LANGUAGES.filter((language) => language.code !== 'auto')}
              onChange={changeTargetLanguage} />
          </div>

          {activeTab === 'page' ? <ModeToggle value={displayMode} onChange={(mode) => void toggleMode(mode)} /> : (
            <div className="manual-input-wrap">
              <textarea
                value={manualText}
                onChange={(event) => {
                  manualRequestId.current++;
                  manualInFlight.current = false;
                  setManualLoading(false);
                  setManualResult('');
                  setManualText(truncateToCodePoints(event.target.value, MANUAL_LIMIT));
                  setManualError(null);
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void translateText();
                  }
                }}
                rows={5}
                placeholder="输入单词或句子"
                aria-label="要翻译的文字"
              />
              <span className="character-count">{Array.from(manualText).length}/{MANUAL_LIMIT}</span>
            </div>
          )}
        </div>

        {activeTab === 'page' ? (
          <div className="panel-actions">
            {!providerReady && <ProviderWarning />}
            {pageError && <div className="error-box" role="alert">{pageError}</div>}
            <TranslateButton
              isTranslating={pageBusy}
              isTranslated={pageComplete}
              hasApiKey={providerReady}
              progress={pageProgress}
              onClick={() => void togglePageTranslation()}
            />
            {(pageBusy || pageComplete) && (
              <Progress progress={pageProgress} complete={pageComplete} />
            )}
          </div>
        ) : (
          <div className="panel-actions manual-panel">
            {!providerReady && <ProviderWarning />}
            {manualError && <div className="error-box" role="alert">{manualError}</div>}
            <button className="manual-translate-btn" disabled={!providerReady || manualLoading || !manualText.trim()}
              aria-busy={manualLoading}
              onClick={() => void translateText()}>
              <span className="button-content">
                {manualLoading ? <span className="spinner" /> : <Icon name="translate" size={23} />}
                {manualLoading ? '翻译中...' : '翻译'}
              </span>
            </button>
            {manualResult && (
              <div className="manual-result">
                <div className="manual-result-header">
                  <span>译文</span>
                  <button onClick={() => void copyResult()}>{copyLabel}</button>
                </div>
                <div className="manual-result-text">{manualResult}</div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
};

const ProviderWarning: React.FC = () => (
  <div className="warning-box">
    当前 API 未配置完整
    <button onClick={() => chrome.runtime.openOptionsPage()}>前往设置</button>
  </div>
);

const Progress: React.FC<{
  progress: { total: number; translated: number };
  complete: boolean;
}> = ({ progress, complete }) => {
  const percentage = progress.total > 0
    ? Math.min(100, (progress.translated / progress.total) * 100)
    : 8;
  return (
    <div className="progress-bar">
      <div className="progress-label">
        <span>{complete ? '翻译完成' : '翻译中...'}</span>
        <span>{progress.total > 0 ? `${progress.translated}/${progress.total}` : ''}</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${percentage}%` }} /></div>
    </div>
  );
};

export default App;
