import React from 'react';
import { iconNodes } from '../icons/lucide';
import type { IconName, IconNode } from '../icons/lucide';

export type { IconName } from '../icons/lucide';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

const Icon: React.FC<IconProps> = ({ name, size = 20, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true" focusable="false">
    {(iconNodes[name] as readonly IconNode[]).map(([tag, attributes], index) => (
      React.createElement(tag, { ...attributes, key: index })
    ))}
  </svg>
);

export default Icon;
