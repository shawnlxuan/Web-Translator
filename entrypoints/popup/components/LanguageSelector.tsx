import React from 'react';

interface LanguageSelectorProps {
  label: string;
  value: string;
  languages: Array<{ code: string; name: string }>;
  onChange: (code: string) => void;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  label,
  value,
  languages,
  onChange,
}) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <label className="form-label" style={{ marginBottom: 0, width: '48px', whiteSpace: 'nowrap' }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="form-select"
        style={{ flex: 1 }}
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default LanguageSelector;
