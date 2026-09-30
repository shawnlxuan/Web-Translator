import React, { useCallback, useEffect, useState } from 'react';
import type { DisplayMode, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT_TEMPLATE, SUPPORTED_LANGUAGES } from '../../shared/constants';
import ApiConfig from './components/ApiConfig';

const APP_ICON_URL = chrome.runtime.getURL('content-ui/ai_translate_icon.svg');

const App: React.FC = () => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
      .then((response) => {
        if (response?.settings) setSettings(response.settings as Settings);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const savePartial = useCallback(async (partial: Partial<Settings>) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: partial,
      });
      if (!response?.settings) throw new Error('设置保存响应无效');
      const updated = response.settings as Settings;
      setSettings(updated);
      setSaveMessage('已保存');
      window.setTimeout(() => setSaveMessage(null), 1800);
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveMessage(`保存失败：${message}`);
      window.setTimeout(() => setSaveMessage(null), 3000);
      throw error;
    }
  }, []);

  if (!loaded) {
    return <div className="loading-state">加载中...</div>;
  }

  return (
    <main className="app-container">
      <header className="app-header">
        <div className="app-heading">
          <img className="app-logo" src={APP_ICON_URL} alt="" />
          <div>
            <h1 className="app-title">网页翻译设置</h1>
            <p className="app-subtitle">API 与翻译偏好</p>
          </div>
        </div>
        {saveMessage && (
          <div className={saveMessage === '已保存' ? 'save-status success' : 'save-status error'}>
            {saveMessage}
          </div>
        )}
      </header>

      <ApiConfig settings={settings} onSave={savePartial} />
      <TranslationSettings settings={settings} onSave={savePartial} />
      <PromptSettings settings={settings} onSave={savePartial} />
      <AdvancedSettings settings={settings} onSave={savePartial} />

      <footer className="app-footer">网页翻译 v1.0.0</footer>
    </main>
  );
};

interface SectionProps {
  settings: Settings;
  onSave: (partial: Partial<Settings>) => Promise<Settings>;
}

const PromptSettings: React.FC<SectionProps> = ({ settings, onSave }) => {
  const [prompt, setPrompt] = useState(settings.customPromptTemplate);
  useEffect(() => setPrompt(settings.customPromptTemplate), [settings.customPromptTemplate]);

  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">提示词</h2>
        <div className="section-actions">
          <button className="secondary-btn" onClick={() => setPrompt(DEFAULT_SYSTEM_PROMPT_TEMPLATE)}>
            恢复默认
          </button>
          <button className="save-btn" onClick={() => void onSave({ customPromptTemplate: prompt })}>
            保存
          </button>
        </div>
      </div>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        className="form-textarea"
        rows={11}
        spellCheck={false}
        aria-label="系统提示词模板"
      />
    </section>
  );
};

const TranslationSettings: React.FC<SectionProps> = ({ settings, onSave }) => {
  const [targetLang, setTargetLang] = useState(settings.targetLang);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(settings.displayMode);
  const [contextWindowSize, setContextWindowSize] = useState(settings.contextWindowSize);
  const [batchSize, setBatchSize] = useState(settings.batchSize);

  useEffect(() => setTargetLang(settings.targetLang), [settings.targetLang]);
  useEffect(() => setDisplayMode(settings.displayMode), [settings.displayMode]);
  useEffect(() => setContextWindowSize(settings.contextWindowSize), [settings.contextWindowSize]);
  useEffect(() => setBatchSize(settings.batchSize), [settings.batchSize]);

  const save = () => onSave({
    targetLang,
    displayMode,
    contextWindowSize,
    batchSize,
  });

  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">翻译</h2>
        <button className="save-btn" onClick={() => void save()}>保存</button>
      </div>
      <div className="settings-grid">
        <label className="form-group">
          <span className="form-label">默认目标语言</span>
          <select value={targetLang} onChange={(event) => setTargetLang(event.target.value)} className="form-select">
            {SUPPORTED_LANGUAGES.filter((language) => language.code !== 'auto').map((language) => (
              <option key={language.code} value={language.code}>{language.name}</option>
            ))}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">默认显示模式</span>
          <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)} className="form-select">
            <option value="bilingual">原文 + 译文</option>
            <option value="replace">仅译文</option>
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">上下文窗口</span>
          <input type="number" min={0} max={10} value={contextWindowSize}
            onChange={(event) => setContextWindowSize(Number(event.target.value))} className="form-input" />
        </label>
        <label className="form-group">
          <span className="form-label">每批句子数</span>
          <input type="number" min={1} max={20} value={batchSize}
            onChange={(event) => setBatchSize(Number(event.target.value))} className="form-input" />
        </label>
      </div>
    </section>
  );
};

const AdvancedSettings: React.FC<SectionProps> = ({ settings, onSave }) => {
  const [cacheTTLDays, setCacheTTLDays] = useState(settings.cacheTTLDays);
  const [maxConcurrentCalls, setMaxConcurrentCalls] = useState(settings.maxConcurrentCalls);
  const [enableMutationObserver, setEnableMutationObserver] = useState(settings.enableMutationObserver);
  const [showSelectionTranslateButton, setShowSelectionTranslateButton] = useState(
    settings.showSelectionTranslateButton,
  );

  useEffect(() => setCacheTTLDays(settings.cacheTTLDays), [settings.cacheTTLDays]);
  useEffect(() => setMaxConcurrentCalls(settings.maxConcurrentCalls), [settings.maxConcurrentCalls]);
  useEffect(() => setEnableMutationObserver(settings.enableMutationObserver), [settings.enableMutationObserver]);
  useEffect(() => setShowSelectionTranslateButton(settings.showSelectionTranslateButton), [settings.showSelectionTranslateButton]);

  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">高级</h2>
        <button className="save-btn" onClick={() => void onSave({
          cacheTTLDays,
          maxConcurrentCalls,
          enableMutationObserver,
          showSelectionTranslateButton,
        })}>保存</button>
      </div>
      <div className="settings-grid">
        <label className="form-group">
          <span className="form-label">缓存天数</span>
          <input type="number" min={1} max={365} value={cacheTTLDays}
            onChange={(event) => setCacheTTLDays(Number(event.target.value))} className="form-input" />
        </label>
        <label className="form-group">
          <span className="form-label">最大并发调用</span>
          <input type="number" min={1} max={10} value={maxConcurrentCalls}
            onChange={(event) => setMaxConcurrentCalls(Number(event.target.value))} className="form-input" />
        </label>
      </div>
      <label className="form-checkbox">
        <input type="checkbox" checked={enableMutationObserver}
          onChange={(event) => setEnableMutationObserver(event.target.checked)} />
        <span>自动翻译动态新增内容</span>
      </label>
      <label className="form-checkbox checkbox-with-note">
        <input type="checkbox" checked={showSelectionTranslateButton}
          onChange={(event) => setShowSelectionTranslateButton(event.target.checked)} />
        <span>
          划词后显示翻译按钮
          <small>关闭后仍可使用 Alt+Shift+T 或右键菜单翻译所选文本</small>
        </span>
      </label>
    </section>
  );
};

export default App;
