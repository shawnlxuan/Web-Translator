// ============================================================
// Translation Quality Scorer — heuristic assessment
// ============================================================

export type QualityLevel = 'good' | 'suspicious' | 'error';

export interface QualityResult {
  level: QualityLevel;
  reasons: string[];
}

/**
 * Assess the quality of a translation heuristically.
 * This provides visual feedback to the user.
 */
export function assessTranslation(
  original: string,
  translation: string,
): QualityResult {
  const reasons: string[] = [];

  // Check 1: Length ratio
  const origLen = original.trim().length;
  const transLen = translation.trim().length;

  if (origLen > 0 && transLen > 0) {
    const ratio = transLen / origLen;

    // Languages have different expansion/contraction ratios.
    // English → Chinese is typically 0.5-0.8x
    // Chinese → English is typically 1.5-2.5x
    if (ratio < 0.1) {
      reasons.push(`Translation too short (${Math.round(ratio * 100)}% of original)`);
    } else if (ratio > 5) {
      reasons.push(`Translation unusually long (${Math.round(ratio * 100)}% of original)`);
    }
  }

  // Check 2: Empty or identical
  if (translation.trim().length === 0) {
    reasons.push('Translation is empty');
  } else if (translation.trim() === original.trim()) {
    reasons.push('Translation identical to original');
  }

  // Check 3: Looks like an error message
  if (
    translation.includes('Error:') ||
    translation.includes('error:') ||
    translation.includes('Sorry') ||
    translation.startsWith('[') && translation.endsWith(']')
  ) {
    reasons.push('Translation may contain an error message');
  }

  // Check 4: Contains the instruction text (hallucination leakage)
  const instructionPhrases = [
    'Translate the',
    'Translation to',
    'TEXT TO TRANSLATE',
    'SURROUNDING TEXT',
    '[Before]',
    '[After]',
  ];
  for (const phrase of instructionPhrases) {
    if (translation.includes(phrase)) {
      reasons.push(`May contain leaked prompt text ("${phrase}")`);
      break;
    }
  }

  // Determine level
  if (reasons.length === 0) {
    return { level: 'good', reasons: [] };
  } else if (reasons.filter((r) => r.includes('empty') || r.includes('error') || r.includes('leaked')).length > 0) {
    return { level: 'error', reasons };
  } else {
    return { level: 'suspicious', reasons };
  }
}

export function getQualityColor(level: QualityLevel): string {
  switch (level) {
    case 'good': return '#22c55e';
    case 'suspicious': return '#eab308';
    case 'error': return '#ef4444';
  }
}

export function getQualityEmoji(level: QualityLevel): string {
  switch (level) {
    case 'good': return '✓';
    case 'suspicious': return '⚠';
    case 'error': return '✗';
  }
}
