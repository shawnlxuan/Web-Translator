import React from 'react';

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
    >
      {isTranslating ? (
        <span>
          <span className="spinner" />
          {progress.total > 0
            ? `翻译中 (${progress.translated}/${progress.total})`
            : '停止翻译'}
        </span>
      ) : isTranslated ? (
        <span>取消翻译</span>
      ) : (
        <span>翻译页面</span>
      )}
    </button>
  );
};

export default TranslateButton;
