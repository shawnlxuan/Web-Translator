import React from 'react';
import Icon from '../../../shared/components/Icon';

interface TranslateButtonProps {
  isTranslating: boolean;
  isTranslated: boolean;
  hasApiKey: boolean;
  progress: { total: number; translated: number };
  onClick: () => void;
}

const TranslateButton: React.FC<TranslateButtonProps> = ({
  isTranslating,
  isTranslated,
  hasApiKey,
  progress,
  onClick,
}) => {
  const isDisabled = !hasApiKey && !isTranslating && !isTranslated;
  const buttonMode = isTranslating || isTranslated ? 'stop' : 'start';

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`translate-btn ${buttonMode}`}
      aria-busy={isTranslating}
    >
      {isTranslating ? (
        <span className="button-content">
          <span className="spinner" />
          {progress.total > 0
            ? `翻译中 (${progress.translated}/${progress.total})`
            : '停止翻译'}
        </span>
      ) : isTranslated ? (
        <span className="button-content"><Icon name="refresh" size={21} />取消翻译</span>
      ) : (
        <><span className="button-content"><Icon name="translate" size={24} />翻译页面</span>
          <Icon name="arrow-right" size={21} className="button-arrow" /></>
      )}
    </button>
  );
};

export default TranslateButton;
