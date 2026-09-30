import React from 'react';
import type { DisplayMode } from '../../../shared/types';
import Icon from '../../../shared/components/Icon';

interface ModeToggleProps {
  value: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

const ModeToggle: React.FC<ModeToggleProps> = ({ value, onChange }) => {
  return (
    <div className="display-control" role="group" aria-label="显示">
      <span className="control-label">显示</span>
      <div className="mode-toggle">
        <button
          className={`mode-btn ${value === 'bilingual' ? 'active' : ''}`}
          aria-pressed={value === 'bilingual'}
          onClick={() => onChange('bilingual')}
        >
          <Icon name="columns" size={19} />对照翻译
        </button>
        <button
          className={`mode-btn ${value === 'replace' ? 'active' : ''}`}
          aria-pressed={value === 'replace'}
          onClick={() => onChange('replace')}
        >
          <Icon name="file" size={19} />仅显示翻译
        </button>
      </div>
    </div>
  );
};

export default ModeToggle;
