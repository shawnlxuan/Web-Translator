import React from 'react';
import Icon from '../../../shared/components/Icon';
import type { IconName } from '../../../shared/components/Icon';

interface SectionHeadingProps {
  icon: IconName;
  title: string;
  description: string;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({ icon, title, description }) => (
  <div className="section-heading">
    <span className="section-icon"><Icon name={icon} size={23} /></span>
    <div>
      <h2 className="section-title">{title}</h2>
      <p className="section-description">{description}</p>
    </div>
  </div>
);

export const SaveButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => (
  <button className="save-btn" {...props}><Icon name="save" size={17} />保存</button>
);
