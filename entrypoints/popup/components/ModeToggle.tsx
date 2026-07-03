import React from 'react';
import type { DisplayMode } from '../../../shared/types';

interface ModeToggleProps {
  value: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

const ModeToggle: React.FC<ModeToggleProps> = ({ value, onChange }) => {
  return (
    <div className="form-group">
      <label className="form-label">Mode</label>
      <div className="mode-toggle">
        <button
          className={`mode-btn ${value === 'bilingual' ? 'active' : ''}`}
          onClick={() => onChange('bilingual')}
        >
          对照翻译
        </button>
        <button
          className={`mode-btn ${value === 'replace' ? 'active' : ''}`}
          onClick={() => onChange('replace')}
        >
          仅显示翻译
        </button>
      </div>
    </div>
  );
};

export default ModeToggle;
