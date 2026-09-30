import React from 'react';
import type { BuiltinProviderType } from '../../../shared/types';
import Icon from '../../../shared/components/Icon';

const ProviderIcon: React.FC<{ preset?: BuiltinProviderType; name: string }> = ({ preset, name }) => {
  if (!preset) {
    return <span className="provider-icon custom" aria-hidden="true">
      {Array.from(name.trim())[0]?.toUpperCase() || <Icon name="box" size={18} />}
    </span>;
  }

  const url = chrome.runtime.getURL(`provider-icons/${preset}.svg`);
  return <span className={`provider-icon ${preset}`} aria-hidden="true">
    {preset === 'mimo' ? (
      <span className="xiaomi-mark" style={{ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }} />
    ) : <img src={url} alt="" width={24} height={24} />}
  </span>;
};

export default ProviderIcon;
