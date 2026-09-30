import React, { useId } from 'react';

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
  const id = useId();
  return (
    <div className="language-control">
      <label className="control-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="form-select"
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
