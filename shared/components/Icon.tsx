import React from 'react';

export type IconName = 'globe' | 'file' | 'settings' | 'translate' | 'columns'
  | 'arrow-right' | 'save' | 'refresh' | 'database' | 'sliders' | 'link'
  | 'box' | 'eye' | 'eye-off' | 'hash' | 'layers' | 'clock' | 'plus'
  | 'external' | 'chevron-down';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

const paths: Record<IconName, React.ReactNode> = {
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h8" /></>,
  settings: <><path d="m9 3-.6 2.5-1.5.9-2.5-.7-2 3.5 1.9 1.8v1.9l-1.9 1.8 2 3.5 2.5-.7 1.5.9L9 21h4l.6-2.6 1.5-.9 2.5.7 2-3.5-1.9-1.8V11l1.9-1.8-2-3.5-2.5.7-1.5-.9L13 3z" /><circle cx="11" cy="12" r="3" /></>,
  translate: <><path d="M3 5h12M9 3v2M5 5c.6 4.7 3 7.2 7 10M13 5c-.8 4.5-4 8.2-9 11M13 21l4.5-11L22 21M15 17h5" /></>,
  columns: <><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" fill="currentColor" stroke="none" /></>,
  'arrow-right': <path d="M4 12h16m-6-6 6 6-6 6" />,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z" /><path d="M7 3v6h9V3M7 21v-8h10v8M13 5v2" /></>,
  refresh: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m-5 0h5v5" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" /></>,
  sliders: <><path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h3m4 0h11" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="8" cy="18" r="2" /></>,
  link: <><path d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 9l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(0 1)" /></>,
  box: <><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3 4M6 6a20 20 0 0 0-4 6s3.5 7 10 7a11 11 0 0 0 5-1.2M10 10a3 3 0 0 0 4 4" /></>,
  hash: <path d="m9 3-2 18M17 3l-2 18M4 8h16M3 16h16" />,
  layers: <><path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  external: <path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
};

const Icon: React.FC<IconProps> = ({ name, size = 20, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths[name]}
  </svg>
);

export default Icon;
