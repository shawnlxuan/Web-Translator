import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderId, ProviderProfile, Settings } from '../../../shared/types';
import { isQwenMtModel } from '../../../shared/provider-models';
import {
  createCustomProviderProfile,
  normalizeEndpoint,
  normalizeProviderName,
  PROVIDER_PRESETS,
  validateProviderEndpoint,
} from '../../../shared/provider-presets';
import {
  deleteCustomProfile,
  renameCustomProfile,
  resetBuiltinProfile,
  validateProviderProfileNames,
} from '../../../core/storage/provider-profile-editor';

interface ApiConfigProps {
  settings: Settings;
  onSave: (partial: Partial<Settings>) => Promise<Settings>;
}

const BUILTIN_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  glm: '智谱 GLM',
  qwen: '通义千问 Qwen',
  kimi: 'Kimi',
  mimo: 'Xiaomi MiMo',
  minimax: 'MiniMax',
};

const ApiConfig: React.FC<ApiConfigProps> = ({ settings, onSave }) => {
  const initialSignature = providerSignature(settings);
  const persistedSignature = useRef(initialSignature);
  const [profiles, setProfiles] = useState(() => cloneProfiles(settings.providerProfiles));
  const [selectedId, setSelectedId] = useState<ProviderId>(settings.activeProviderId);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const requestGeneration = useRef(0);

  const invalidateRequests = () => {
    requestGeneration.current++;
    setTesting(false);
    setFetchingModels(false);
    setModels([]);
  };

  const incomingSignature = providerSignature(settings);
  useEffect(() => {
    if (incomingSignature === persistedSignature.current) return;
    persistedSignature.current = incomingSignature;
    requestGeneration.current++;
    setTesting(false);
    setFetchingModels(false);
    setProfiles(cloneProfiles(settings.providerProfiles));
    setSelectedId(settings.activeProviderId);
    setModels([]);
  }, [incomingSignature, settings.activeProviderId, settings.providerProfiles]);

  const selected = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) ?? profiles[0],
    [profiles, selectedId],
  );
  const builtins = profiles.filter((profile) => profile.kind === 'builtin');
  const customProfiles = profiles.filter((profile) => profile.kind === 'custom');

  const updateSelected = (updates: Partial<Pick<ProviderProfile, 'apiKey' | 'endpoint' | 'model'>>) => {
    if (!selected) return;
    invalidateRequests();
    setProfiles((current) => current.map((profile) => (
      profile.id === selected.id ? { ...profile, ...updates } : profile
    )));
    setMessage(null);
  };

  const updateName = (name: string) => {
    if (!selected || selected.kind !== 'custom') return;
    try {
      setProfiles((current) => renameCustomProfile(current, selected.id, name));
      setMessage(null);
    } catch (error) {
      setProfiles((current) => current.map((profile) => (
        profile.id === selected.id ? { ...profile, name } : profile
      )));
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const addCustom = () => {
    try {
      const profile = createCustomProviderProfile(newName, profiles);
      invalidateRequests();
      setProfiles((current) => [...current, profile]);
      setSelectedId(profile.id);
      setNewName('');
      setAdding(false);
      setModels([]);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const removeSelected = () => {
    if (!selected || selected.kind !== 'custom') return;
    if (!window.confirm(`删除“${selected.name}”？`)) return;
    try {
      const next = deleteCustomProfile(profiles, selected.id, selectedId);
      invalidateRequests();
      setProfiles(next.profiles);
      setSelectedId(next.activeProviderId);
      setModels([]);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const resetSelected = () => {
    if (!selected || selected.kind !== 'builtin') return;
    invalidateRequests();
    setProfiles((current) => current.map((profile) => (
      profile.id === selected.id ? resetBuiltinProfile(profile) : profile
    )));
    setModels([]);
    setMessage('已恢复官方端点与模型，保存后生效');
  };

  const save = async () => {
    const normalized = profiles.map((profile) => ({
      ...profile,
      name: normalizeProviderName(profile.name),
      endpoint: normalizeEndpoint(profile.endpoint),
      model: profile.model.trim(),
    }));
    const validationError = validateProviderProfileNames(normalized);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    for (const profile of normalized) {
      if (!profile.endpoint.trim()) continue;
      try {
        validateProviderEndpoint(profile.endpoint, profile.protocol);
      } catch (error) {
        setMessage(`${profile.name}：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    try {
      const updated = await onSave({
        activeProviderId: selectedId,
        providerProfiles: normalized,
      });
      persistedSignature.current = providerSignature(updated);
      setProfiles(cloneProfiles(updated.providerProfiles));
      setSelectedId(updated.activeProviderId);
      setMessage('API 配置已保存');
    } catch {
      // The root page already reports persistence errors.
    }
  };

  const testConnection = async () => {
    if (!selected) return;
    setTesting(true);
    setMessage(null);
    const generation = ++requestGeneration.current;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_API_CONNECTION',
        profile: selected,
      });
      if (generation !== requestGeneration.current) return;
      setMessage(response?.message || '连接测试无响应');
    } catch (error) {
      if (generation === requestGeneration.current) setMessage(`连接失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (generation === requestGeneration.current) setTesting(false);
    }
  };

  const fetchModels = async () => {
    if (!selected) return;
    setFetchingModels(true);
    setMessage(null);
    const generation = ++requestGeneration.current;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_MODELS',
        profile: selected,
      });
      if (generation !== requestGeneration.current) return;
      if (!response?.success) throw new Error(response?.error || '获取模型失败');
      setModels(response.models || []);
      setMessage(`已获取 ${response.models?.length || 0} 个模型`);
    } catch (error) {
      if (generation === requestGeneration.current) {
        setModels([]);
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === requestGeneration.current) setFetchingModels(false);
    }
  };

  if (!selected) return null;
  const preset = selected.kind === 'builtin' && selected.preset
    ? PROVIDER_PRESETS[selected.preset]
    : null;

  return (
    <section className="section api-section">
      <div className="section-header">
        <h2 className="section-title">API 提供商</h2>
        <button className="save-btn" onClick={() => void save()}>保存</button>
      </div>

      <div className="provider-editor">
        <aside className="provider-list" aria-label="API 提供商列表">
          <div className="provider-list-label">固定</div>
          {builtins.map((profile) => (
            <button key={profile.id} className={profile.id === selected.id ? 'provider-item active' : 'provider-item'}
              onClick={() => { invalidateRequests(); setSelectedId(profile.id); setMessage(null); }}>
              <span>{profile.preset ? BUILTIN_LABELS[profile.preset] : profile.name}</span>
              <span className={profile.apiKey.trim() ? 'status-dot ready' : 'status-dot'} aria-label={profile.apiKey.trim() ? '已配置' : '未配置'} />
            </button>
          ))}

          <div className="provider-list-heading">
            <span className="provider-list-label">自定义</span>
            <button className="icon-command" title="新增自定义 API" aria-label="新增自定义 API"
              onClick={() => { setAdding(true); setMessage(null); }}>+</button>
          </div>
          {customProfiles.map((profile) => (
            <button key={profile.id} className={profile.id === selected.id ? 'provider-item active' : 'provider-item'}
              onClick={() => { invalidateRequests(); setSelectedId(profile.id); setMessage(null); }}>
              <span>{profile.name || '未命名 API'}</span>
              <span className={profile.apiKey.trim() ? 'status-dot ready' : 'status-dot'} aria-label={profile.apiKey.trim() ? '已配置' : '未配置'} />
            </button>
          ))}
          {adding && (
            <div className="add-provider-row">
              <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') addCustom(); }}
                placeholder="自定义名称" aria-label="自定义 API 名称" />
              <button onClick={addCustom}>添加</button>
              <button className="icon-command" title="取消" aria-label="取消新增"
                onClick={() => { setAdding(false); setNewName(''); }}>×</button>
            </div>
          )}
          {customProfiles.length === 0 && !adding && (
            <div className="empty-provider-list">暂无自定义 API</div>
          )}
        </aside>

        <div className="provider-detail">
          <div className="provider-detail-header">
            <div>
              <span className="provider-kind">{selected.kind === 'builtin' ? '固定提供商' : '自定义 API'}</span>
              {selected.kind === 'custom' ? (
                <input className="provider-name-input" value={selected.name}
                  onChange={(event) => updateName(event.target.value)} aria-label="提供商名称" />
              ) : (
                <h3>{selected.preset ? BUILTIN_LABELS[selected.preset] : selected.name}</h3>
              )}
            </div>
            <div className="provider-detail-actions">
              {preset && (
                <a className="secondary-btn link-btn" href={preset.docsUrl} target="_blank" rel="noreferrer">文档</a>
              )}
              {selected.kind === 'builtin' ? (
                <button className="secondary-btn" onClick={resetSelected}>恢复官方值</button>
              ) : (
                <button className="danger-btn" onClick={removeSelected}>删除</button>
              )}
            </div>
          </div>

          <label className="form-group">
            <span className="form-label">API 密钥</span>
            <input type="password" value={selected.apiKey}
              onChange={(event) => updateSelected({ apiKey: event.target.value })}
              className="form-input" autoComplete="off" />
          </label>
          <label className="form-group">
            <span className="form-label">接口地址</span>
            <input type="url" value={selected.endpoint}
              onChange={(event) => updateSelected({ endpoint: event.target.value })}
              className="form-input" placeholder="https://api.example.com/v1" />
          </label>
          <label className="form-group">
            <span className="form-label">模型名称</span>
            <input value={selected.model} list={`models-${selected.id}`}
              onChange={(event) => updateSelected({ model: event.target.value })}
              className="form-input" />
            <datalist id={`models-${selected.id}`}>
              {models.map((model) => <option key={model} value={model} />)}
            </datalist>
          </label>

          {selected.protocol === 'openai-compatible' && isQwenMtModel(selected.model) && (
            <p className="form-hint">Qwen-MT 使用专用翻译模式，不应用自定义提示词或上下文设置。</p>
          )}

          <div className="connection-actions">
            <button className="test-btn" disabled={testing || fetchingModels} onClick={() => void testConnection()}>
              {testing ? '测试中...' : '测试连接'}
            </button>
            <button className="test-btn" disabled={testing || fetchingModels || selected.protocol === 'anthropic'}
              onClick={() => void fetchModels()}>
              {fetchingModels ? '获取中...' : '获取模型'}
            </button>
          </div>
          {message && <div className="inline-message" role="status">{message}</div>}
        </div>
      </div>
    </section>
  );
};

function cloneProfiles(profiles: readonly ProviderProfile[]): ProviderProfile[] {
  return profiles.map((profile) => ({ ...profile }));
}

function providerSignature(settings: Pick<Settings, 'activeProviderId' | 'providerProfiles'>): string {
  return JSON.stringify([settings.activeProviderId, settings.providerProfiles]);
}

export default ApiConfig;
