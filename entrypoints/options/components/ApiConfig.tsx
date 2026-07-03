import React, { useState, useEffect, useCallback } from 'react';
import type { Settings, ProviderType } from '../../../shared/types';

interface ApiConfigProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

const PROVIDERS: Array<{ value: ProviderType; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'mimo', label: 'MiniMax' },
  { value: 'custom', label: '自定义' },
];

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  mimo: 'https://api.minimax.chat/v1',
};

const ApiConfig: React.FC<ApiConfigProps> = ({ settings, onSave }) => {
  // 本地编辑状态，点击保存才提交
  const [local, setLocal] = useState<Settings>(settings);
  useEffect(() => setLocal(settings), [settings]);

  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const provider = local.provider;
  const apiKey = local.apiKeys[provider] || '';
  const endpoint = local.customEndpoints[provider] || PROVIDER_ENDPOINTS[provider] || '';

  // 修改本地状态（不立即保存）
  const update = (updates: Partial<Settings>) => setLocal({ ...local, ...updates });
  const updateApiKey = (p: ProviderType, key: string) =>
    setLocal({ ...local, apiKeys: { ...local.apiKeys, [p]: key } });
  const updateModel = (p: ProviderType, model: string) =>
    setLocal({ ...local, models: { ...local.models, [p]: model } });
  const updateEndpoint = (p: ProviderType, ep: string) =>
    setLocal({ ...local, customEndpoints: { ...local.customEndpoints, [p]: ep } });

  // 直接调用 API 获取模型列表
  const fetchModels = useCallback(async () => {
    if (!apiKey) { setFetchError('请先输入 API 密钥'); return; }
    setFetchingModels(true);
    setFetchError(null);
    try {
      const baseUrl = endpoint.replace(/\/+$/, '');
      let resp = await fetch(`${baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      if (!resp.ok) {
        resp = await fetch(`${baseUrl}/models`, {
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
        });
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const models: string[] = (data.data || []).map((m: any) => m.id || m.model).filter(Boolean).sort();
      if (models.length > 0) {
        setModelList(models);
        // 自动选择第一个模型
        setLocal(prev => ({ ...prev, models: { ...prev.models, [provider]: models[0] } }));
      } else {
        setFetchError('该 API 未返回模型列表');
      }
    } catch (err: any) {
      setFetchError(`获取失败: ${err.message}`);
    } finally {
      setFetchingModels(false);
    }
  }, [provider, apiKey, endpoint]);

  // 测试连接
  const testConnection = useCallback(async () => {
    if (!apiKey) { alert('请先输入 API 密钥'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const baseUrl = endpoint.replace(/\/+$/, '');
      let resp = await fetch(`${baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      if (!resp.ok) {
        resp = await fetch(`${baseUrl}/models`, {
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
        });
      }
      setTestResult(resp.ok ? '✅ 连接成功！' : `❌ HTTP ${resp.status}`);
    } catch (err: any) {
      setTestResult(`❌ 连接失败: ${err.message}`);
    } finally {
      setTesting(false);
    }
  }, [provider, apiKey, endpoint]);

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">API 配置</h2>
        <button className="save-btn" onClick={() => onSave(local)}>保存</button>
      </div>

      <div className="form-group">
        <label className="form-label">大模型提供商</label>
        <div className="provider-tabs" style={{ flexWrap: 'wrap' }}>
          {PROVIDERS.map((p) => (
            <button key={p.value}
              onClick={() => setLocal(prev => ({ ...prev, provider: p.value }))}
              className={`provider-btn ${provider === p.value ? 'active' : ''}`}
              style={{ minWidth: '80px', marginBottom: '6px' }}
            >{p.label}</button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">API 密钥</label>
        <input type="password" value={apiKey}
          onChange={e => updateApiKey(provider, e.target.value)}
          placeholder="输入 API 密钥..." className="form-input" />
        <p className="form-hint">密钥仅存储在本地，除 LLM API 外不会发送到任何服务器。</p>
      </div>

      <div className="form-group">
        <label className="form-label">API 端点地址</label>
        <input type="text" value={endpoint}
          onChange={e => updateEndpoint(provider, e.target.value)}
          placeholder="https://api.example.com/v1" className="form-input" />
        <p className="form-hint">需兼容 OpenAI 格式。</p>
      </div>

      <div className="form-group">
        <label className="form-label">模型</label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
          {modelList.length > 0 ? (
            <select value={local.models[provider] || ''}
              onChange={e => {
                const val = e.target.value;
                if (val === '__custom__') {
                  setModelList([]);
                  setLocal(prev => ({ ...prev, models: { ...prev.models, [provider]: '' } }));
                } else {
                  updateModel(provider, val);
                }
              }}
              className="form-select" style={{ flex: 1 }}>
              {modelList.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="__custom__" style={{ color: '#6366f1' }}>✏️ 手动输入其他模型...</option>
            </select>
          ) : (
            <input type="text" value={local.models[provider] || ''}
              onChange={e => updateModel(provider, e.target.value)}
              placeholder="模型名称..." className="form-input" style={{ flex: 1 }} />
          )}
          <button onClick={fetchModels} disabled={fetchingModels || !apiKey}
            className="test-btn" title="拉取可用模型">{fetchingModels ? '⏳' : '📡'}</button>
        </div>
        {fetchingModels && <p className="form-hint">⏳ 正在获取模型列表...</p>}
        {fetchError && <p className="form-hint" style={{ color: '#ef4444' }}>{fetchError}</p>}
        {modelList.length > 0 && !fetchError && <p className="form-hint">✅ 已获取 {modelList.length} 个模型</p>}
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button onClick={testConnection} disabled={testing || !apiKey} className="test-btn">
          {testing ? '⏳ 测试中...' : '🔗 测试连接'}
        </button>
        {testResult && <span style={{ fontSize: '13px', color: testResult.startsWith('✅') ? '#059669' : '#dc2626' }}>{testResult}</span>}
      </div>
    </div>
  );
};

export default ApiConfig;
