import React from 'react';
import type { BuiltinProviderType } from '../../../shared/types';
import Icon from '../../../shared/components/Icon';

const ProviderIcon: React.FC<{ preset?: BuiltinProviderType; name: string }> = ({ preset, name }) => {
  if (!preset) return <span className="provider-icon custom" aria-hidden="true">{Array.from(name.trim())[0]?.toUpperCase() || <Icon name="box" size={18} />}</span>;

  const symbols: Record<BuiltinProviderType, React.ReactNode> = {
    openai: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <path key={angle} d="M12 4a4 4 0 0 1 7 3.5v7L12 18l-4-2.3V9l4-2.3 4 2.3v5" transform={`rotate(${angle} 12 12)`} />
      ))}
    </svg>,
    anthropic: <span className="provider-wordmark">AⅠ</span>,
    deepseek: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 8c4-3 7 0 9 4 2 3 6 4 9 1l2-4-4 1-2-4-1 4c-2-4-6-6-10-4C1 7 0 11 2 15c3 6 12 8 18 3-7 1-10-2-12-5C6 10 4 9 2 8Z" /><circle cx="10" cy="11" r="1" fill="white" /></svg>,
    glm: <svg viewBox="0 0 24 24" fill="currentColor">
      {[[12, 3], [6, 6], [18, 6], [3, 12], [9, 10], [15, 10], [21, 12], [6, 17], [12, 16], [18, 17], [12, 22]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" />)}
    </svg>,
    qwen: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" /><path d="m8 8 7 2-2 7-5-5 7-2" />
    </svg>,
    kimi: <span className="provider-wordmark">K</span>,
    mimo: <span className="provider-mi">mi</span>,
    minimax: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 10v4M6 6v12M10 3v18M14 7v10M18 4v16M22 9v6" />
    </svg>,
  };

  return <span className={`provider-icon ${preset}`} aria-hidden="true">{symbols[preset]}</span>;
};

export default ProviderIcon;
