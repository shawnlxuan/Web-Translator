import React, { useCallback, useEffect, useState } from 'react';
import type { DisplayMode, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT_TEMPLATE, SUPPORTED_LANGUAGES } from '../../shared/constants';
import ApiConfig from './components/ApiConfig';
import Icon from '../../shared/components/Icon';
import { SaveButton, SectionHeading } from './components/SectionHeading';

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
          <div role="status" className={saveMessage === '已保存' ? 'save-status success' : 'save-status error'}>
            {saveMessage}
          </div>
        )}
      </header>

      <ApiConfig settings={settings} onSave={savePartial} />
      <TranslationSettings settings={settings} onSave={savePartial} />
      <PromptSettings settings={settings} onSave={savePartial} />
      <AdvancedSettings settings={settings} onSave={savePartial} />

      <footer className="app-footer">网页翻译 v1.0.2</footer>
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
        <SectionHeading icon="file" title="提示词" description="自定义翻译提示词，控制翻译风格和要求" />
        <div className="section-actions">
          <button className="secondary-btn" onClick={() => setPrompt(DEFAULT_SYSTEM_PROMPT_TEMPLATE)}>
            <Icon name="refresh" size={17} />恢复默认
          </button>
          <SaveButton onClick={() => void onSave({ customPromptTemplate: prompt })} />
        </div>
      </div>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        className="form-textarea"
        rows={7}
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
        <SectionHeading icon="settings" title="翻译" description="设置翻译的基本行为和输出格式" />
        <SaveButton onClick={() => void save()} />
      </div>
      <div className="settings-grid">
        <label className="form-group">
          <span className="form-label">默认目标语言</span>
          <span className="input-with-icon"><Icon name="globe" size={18} />
            <select value={targetLang} onChange={(event) => setTargetLang(event.target.value)} className="form-select">
              {SUPPORTED_LANGUAGES.filter((language) => language.code !== 'auto').map((language) => (
                <option key={language.code} value={language.code}>{language.name}</option>
              ))}
            </select>
          </span>
        </label>
        <label className="form-group">
          <span className="form-label">默认显示模式</span>
          <span className="input-with-icon"><Icon name="file" size={18} />
            <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)} className="form-select">
              <option value="bilingual">原文 + 译文</option>
              <option value="replace">仅译文</option>
            </select>
          </span>
        </label>
        <label className="form-group">
          <span className="form-label">上下文窗口</span>
          <span className="input-with-icon"><Icon name="hash" size={18} />
            <input type="number" min={0} max={10} value={contextWindowSize}
              onChange={(event) => setContextWindowSize(Number(event.target.value))} className="form-input" />
          </span>
          <small className="field-hint">用于提供上下文的前后段落数量</small>
        </label>
        <label className="form-group">
          <span className="form-label">每批句子数</span>
          <span className="input-with-icon"><Icon name="layers" size={18} />
            <input type="number" min={1} max={20} value={batchSize}
              onChange={(event) => setBatchSize(Number(event.target.value))} className="form-input" />
          </span>
          <small className="field-hint">每次发送给模型的句子数量，范围 1–20</small>
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
        <SectionHeading icon="sliders" title="高级" description="性能优化和其他高级选项" />
        <SaveButton onClick={() => void onSave({
          cacheTTLDays,
          maxConcurrentCalls,
          enableMutationObserver,
          showSelectionTranslateButton,
        })} />
      </div>
      <div className="settings-grid">
        <label className="form-group">
          <span className="form-label">缓存天数</span>
          <span className="input-with-icon"><Icon name="clock" size={18} />
            <input type="number" min={1} max={365} value={cacheTTLDays}
              onChange={(event) => setCacheTTLDays(Number(event.target.value))} className="form-input" />
          </span>
          <small className="field-hint">翻译结果在本地缓存的天数</small>
        </label>
        <label className="form-group">
          <span className="form-label">最大并发调用</span>
          <span className="input-with-icon"><Icon name="link" size={18} />
            <input type="number" min={1} max={10} value={maxConcurrentCalls}
              onChange={(event) => setMaxConcurrentCalls(Number(event.target.value))} className="form-input" />
          </span>
          <small className="field-hint">同时进行的 API 调用数量，范围 1–10</small>
        </label>
      </div>
      <div className="checkbox-grid">
        <label className="form-checkbox checkbox-with-note">
          <input type="checkbox" checked={enableMutationObserver}
            onChange={(event) => setEnableMutationObserver(event.target.checked)} />
          <span>自动翻译动态新增内容<small>自动检测并翻译页面中动态加载的新内容</small></span>
        </label>
        <label className="form-checkbox checkbox-with-note">
          <input type="checkbox" checked={showSelectionTranslateButton}
            onChange={(event) => setShowSelectionTranslateButton(event.target.checked)} />
          <span>
            划词后显示翻译按钮
            <small>关闭后仍可使用 Alt+Shift+T 或右键菜单翻译所选文本</small>
          </span>
        </label>
      </div>
    </section>
  );
};

export default App;
