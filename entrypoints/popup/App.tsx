import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SUPPORTED_LANGUAGES, DEFAULT_SETTINGS } from '../../shared/constants';
import { TranslationState } from '../../shared/types';
import type { Settings, DisplayMode, ProviderType, ProviderStringMap } from '../../shared/types';
import LanguageSelector from './components/LanguageSelector';
import ModeToggle from './components/ModeToggle';
import TranslateButton from './components/TranslateButton';

const SETTINGS_KEY = 'ai_translator_settings';
const APP_ICON_URL = chrome.runtime.getURL('content-ui/ai_translate_icon.svg');

const PROVIDERS: Array<{ value: ProviderType; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'mimo', label: 'MiniMax' },
  { value: 'custom', label: '自定义' },
];

const App: React.FC = () => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bilingual');
  const [translationState, setTranslationState] = useState<TranslationState>(TranslationState.IDLE);
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState({ total: 0, translated: 0 });
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 初始化：加载设置 + 查询翻译状态
  useEffect(() => {
    chrome.storage.local.get(SETTINGS_KEY).then((result) => {
      if (result[SETTINGS_KEY]) {
        const s = normalizeSettings(result[SETTINGS_KEY] as Partial<Settings>);
        setSettings(s);
        setSourceLang(s.sourceLang);
        setTargetLang(s.targetLang);
        setDisplayMode(s.displayMode);
      }
    }).catch(() => {});

    queryTranslationState();
  }, []);

  // 翻译中时每秒轮询进度
  useEffect(() => {
    if (isTranslating) {
      pollRef.current = setInterval(queryTranslationState, 1000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isTranslating]);

  const queryTranslationState = () => {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_TRANSLATION_STATE' }).then((res) => {
        if (res) {
          const active = res.state === 'extracting' || res.state === 'translating';
          setTranslationState(res.state || TranslationState.IDLE);
          setIsTranslating(active);
          setProgress({ total: res.totalSegments || 0, translated: res.translatedSegments || 0 });
          if (res.state === 'error') setError(res.errorMessage || '翻译出错');
          if (res.state !== 'error') setError(null);
          if (res.state === 'idle' || res.state === 'complete') {
            setIsTranslating(false);
          }
        }
      }).catch(() => {});
    }).catch(() => {});
  };

  const ensureContentScript = async (tabId: number): Promise<boolean> => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'GET_TRANSLATION_STATE' });
      return true;
    } catch {
      try {
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: ['content-scripts/content.css'],
        }).catch(() => {}); // CSS optional
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/content.js'],
        });
        await new Promise(r => setTimeout(r, 200));
        return true;
      } catch (err: any) {
        setError('注入失败: ' + (err.message || String(err)));
        return false;
      }
    }
  };

  const handleTranslate = useCallback(() => {
    setError(null);
    if (isTranslating || translationState === TranslationState.COMPLETE) {
      chrome.runtime.sendMessage({ type: 'STOP_TRANSLATION' }, () => {
        if (chrome.runtime.lastError) {
          setError('取消翻译失败: ' + chrome.runtime.lastError.message);
          return;
        }
        setTranslationState(TranslationState.IDLE);
        setIsTranslating(false);
        setProgress({ total: 0, translated: 0 });
      });
      setIsTranslating(false);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
        if (!tabs[0]?.id) {
          setError('无法获取当前标签页');
          return;
        }
        const ok = await ensureContentScript(tabs[0].id);
        if (!ok) return;

        chrome.runtime.sendMessage({
          type: 'START_TRANSLATION',
          sourceLang,
          targetLang,
        }, (response) => {
          if (chrome.runtime.lastError) {
            setError('启动翻译失败: ' + chrome.runtime.lastError.message);
            return;
          }
          if (response?.type === 'TRANSLATION_ERROR') {
            setError('启动失败: ' + response.error);
            return;
          }
          setTranslationState(TranslationState.TRANSLATING);
          setIsTranslating(true);
        });
      });
    }
  }, [isTranslating, sourceLang, targetLang, translationState]);

  const handleToggleMode = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode);
    const updated = { ...settings, displayMode: mode };
    setSettings(updated);
    chrome.storage.local.set({ [SETTINGS_KEY]: updated }).catch(() => {});
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_DISPLAY_MODE', displayMode: mode }).catch(() => {});
      }
    });
  }, [settings]);

  const handleProviderChange = useCallback((provider: ProviderType) => {
    const updated = { ...settings, provider };
    setSettings(updated);
    chrome.storage.local.set({ [SETTINGS_KEY]: updated }).catch((err) => {
      setError('切换 API 提供商失败: ' + (err.message || String(err)));
    });
  }, [settings]);

  const hasApiKey = Boolean(settings.apiKeys[settings.provider]?.trim());
  const isTranslated = translationState === TranslationState.COMPLETE;

  return (
    <div className="app-container">
      <div className="app-header">
        <img className="app-logo" src={APP_ICON_URL} alt="" />
        <h1 className="app-title">网页翻译</h1>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <LanguageSelector label="源语言" value={sourceLang} languages={SUPPORTED_LANGUAGES} onChange={setSourceLang} />
        <div style={{ marginTop: '8px' }}>
          <LanguageSelector label="目标" value={targetLang} languages={SUPPORTED_LANGUAGES.filter(l => l.code !== 'auto')} onChange={setTargetLang} />
        </div>
      </div>

      <div className="provider-panel">
        <label className="form-label">API 提供商</label>
        <div className="provider-row">
          <select
            value={settings.provider}
            onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
            className="form-select provider-select"
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
          <button className="settings-link-btn" onClick={() => chrome.runtime.openOptionsPage()}>
            配置
          </button>
        </div>
        <div className="provider-meta">
          <span>{settings.models[settings.provider] || '未选择模型'}</span>
          <span className={hasApiKey ? 'provider-ready' : 'provider-missing'}>
            {hasApiKey ? '已配置密钥' : '未配置密钥'}
          </span>
        </div>
      </div>

      <ModeToggle value={displayMode} onChange={handleToggleMode} />

      {!hasApiKey && (
        <div className="warning-box">
          ⚠️ 未配置 API 密钥{' '}
          <button onClick={() => chrome.runtime.openOptionsPage()}>前往设置</button>
        </div>
      )}

      {error && (
        <div className="warning-box" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
          ❌ {error}
        </div>
      )}

      <TranslateButton
        isTranslating={isTranslating}
        isTranslated={isTranslated}
        hasApiKey={hasApiKey}
        progress={progress}
        onClick={handleTranslate}
      />

      {(isTranslating || isTranslated) && (
        <div className="progress-bar">
          <div className="progress-label">
            <span>{isTranslated ? '翻译完成' : (progress.total > 0 ? `翻译中...` : '准备中...')}</span>
            <span>{progress.total > 0 ? `${progress.translated}/${progress.total}` : ''}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill"
              style={{ width: progress.total > 0 ? `${(progress.translated / progress.total) * 100}%` : '10%' }} />
          </div>
        </div>
      )}

      <div className="app-footer">
        <span>{getProviderLabel(settings.provider)} · {settings.models[settings.provider]}</span>
        <button onClick={() => chrome.runtime.openOptionsPage()}>设置</button>
      </div>
    </div>
  );
};

export default App;

function normalizeSettings(partial: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    apiKeys: mergeProviderMap(DEFAULT_SETTINGS.apiKeys, partial.apiKeys),
    models: mergeProviderMap(DEFAULT_SETTINGS.models, partial.models),
    customEndpoints: mergeProviderMap(DEFAULT_SETTINGS.customEndpoints, partial.customEndpoints),
  };
}

function mergeProviderMap(
  defaults: ProviderStringMap,
  partial?: Partial<ProviderStringMap>,
): ProviderStringMap {
  return {
    ...defaults,
    ...partial,
  };
}

function getProviderLabel(provider: ProviderType): string {
  return PROVIDERS.find((item) => item.value === provider)?.label || provider;
}
