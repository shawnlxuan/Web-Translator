import React, { useState, useEffect, useCallback } from 'react';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT_TEMPLATE } from '../../shared/constants';
import ApiConfig from './components/ApiConfig';

const SETTINGS_KEY = 'ai_translator_settings';
const APP_ICON_URL = chrome.runtime.getURL('content-ui/ai_translate_icon.svg');

const App: React.FC = () => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // 直接从 chrome.storage.local 加载
  useEffect(() => {
    chrome.storage.local.get(SETTINGS_KEY).then((result) => {
      if (result[SETTINGS_KEY]) {
        setSettings({ ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] });
      }
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });
  }, []);

  // 直接保存到 chrome.storage.local
  const saveSettings = useCallback(async (updated: Settings) => {
    setSettings(updated);
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
      setSaveMsg('✓ 已保存');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err: any) {
      setSaveMsg('✗ 保存失败: ' + err.message);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }, []);

  if (!loaded) {
    return (
      <div className="app-container" style={{ textAlign: 'center', paddingTop: '80px', color: '#6b7280' }}>
        加载中...
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <h1 className="app-title">
          <img className="app-logo" src={APP_ICON_URL} alt="" /> 网页翻译设置
        </h1>
        <p className="app-subtitle">配置大模型 API 连接和翻译偏好。</p>
        {saveMsg && (
          <span style={{
            marginLeft: '12px', fontSize: '13px',
            color: saveMsg.startsWith('✓') ? '#059669' : '#dc2626',
          }}>
            {saveMsg}
          </span>
        )}
      </div>

      {/* API 配置 + 翻译设置 + 高级设置，每个区域独立保存 */}
      <ApiConfig settings={settings} onSave={saveSettings} />

      <TranslationSettings settings={settings} onSave={saveSettings} />
      <PromptSettings settings={settings} onSave={saveSettings} />
      <AdvancedSettings settings={settings} onSave={saveSettings} />

      <div className="app-footer">
        网页翻译 v1.0.0 · API 密钥仅存储在本地浏览器中
      </div>
    </div>
  );
};

// ---- 提示词设置 ----
const PromptSettings: React.FC<{
  settings: Settings;
  onSave: (s: Settings) => void;
}> = ({ settings, onSave }) => {
  const [local, setLocal] = useState(settings);
  useEffect(() => setLocal(settings), [settings]);

  const promptTemplate = local.customPromptTemplate ?? DEFAULT_SYSTEM_PROMPT_TEMPLATE;

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">提示词设置</h2>
        <div className="section-actions">
          <button
            className="secondary-btn"
            onClick={() => setLocal({ ...local, customPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE })}
          >
            恢复默认
          </button>
          <button className="save-btn" onClick={() => onSave(local)}>保存</button>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">系统提示词模板</label>
        <textarea
          value={promptTemplate}
          onChange={e => setLocal({ ...local, customPromptTemplate: e.target.value })}
          className="form-textarea"
          rows={11}
          spellCheck={false}
        />
        <p className="form-hint">
          占位符：{'{{sourceLanguage}}'}、{'{{targetLanguage}}'}。空内容按默认提示词执行。
        </p>
      </div>
    </div>
  );
};

// ---- 翻译设置 ----
const TranslationSettings: React.FC<{
  settings: Settings;
  onSave: (s: Settings) => void;
}> = ({ settings, onSave }) => {
  const [local, setLocal] = useState(settings);
  useEffect(() => setLocal(settings), [settings]);

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">翻译设置</h2>
        <button className="save-btn" onClick={() => onSave(local)}>保存</button>
      </div>

      <div className="form-group">
        <label className="form-label">默认目标语言</label>
        <select value={local.targetLang} onChange={e => setLocal({ ...local, targetLang: e.target.value })} className="form-select">
          <option value="zh-CN">中文(简体)</option><option value="zh-TW">中文(繁體)</option>
          <option value="en">English</option><option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="fr">Français</option><option value="de">Deutsch</option>
          <option value="es">Español</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">默认显示模式</label>
        <select value={local.displayMode} onChange={e => setLocal({ ...local, displayMode: e.target.value as any })} className="form-select">
          <option value="bilingual">对照翻译（原文+译文）</option>
          <option value="replace">仅显示翻译</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">上下文窗口大小（前后句子数）</label>
        <input type="number" min={0} max={10} value={local.contextWindowSize}
          onChange={e => setLocal({ ...local, contextWindowSize: parseInt(e.target.value) || 3 })} className="form-input" />
      </div>

      <div className="form-group">
        <label className="form-label">批量大小（每次 API 调用的句子数）</label>
        <input type="number" min={1} max={20} value={local.batchSize}
          onChange={e => setLocal({ ...local, batchSize: parseInt(e.target.value) || 5 })} className="form-input" />
      </div>

      <div className="form-group">
        <label className="form-label">翻译文字颜色</label>
        <div className="color-input">
          <input type="color" value={local.translationColor}
            onChange={e => setLocal({ ...local, translationColor: e.target.value })} />
          <span style={{ fontSize: '14px', color: '#6b7280' }}>{local.translationColor}</span>
        </div>
      </div>
    </div>
  );
};

// ---- 高级设置 ----
const AdvancedSettings: React.FC<{
  settings: Settings;
  onSave: (s: Settings) => void;
}> = ({ settings, onSave }) => {
  const [local, setLocal] = useState(settings);
  useEffect(() => setLocal(settings), [settings]);

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">高级设置</h2>
        <button className="save-btn" onClick={() => onSave(local)}>保存</button>
      </div>

      <div className="form-group">
        <label className="form-label">缓存有效期（天）</label>
        <input type="number" min={1} max={365} value={local.cacheTTLDays}
          onChange={e => setLocal({ ...local, cacheTTLDays: parseInt(e.target.value) || 30 })} className="form-input" />
      </div>

      <div className="form-group">
        <label className="form-label">最大并发 API 调用数</label>
        <input type="number" min={1} max={10} value={local.maxConcurrentCalls}
          onChange={e => setLocal({ ...local, maxConcurrentCalls: parseInt(e.target.value) || 3 })} className="form-input" />
      </div>

      <div className="form-checkbox">
        <input type="checkbox" id="mutationObserver" checked={local.enableMutationObserver}
          onChange={e => setLocal({ ...local, enableMutationObserver: e.target.checked })} />
        <label htmlFor="mutationObserver" className="form-label" style={{ marginBottom: 0 }}>
          自动翻译动态加载的内容
        </label>
      </div>
    </div>
  );
};

export default App;
