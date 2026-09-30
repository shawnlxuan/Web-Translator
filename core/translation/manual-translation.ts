import type { CachedTranslationRequest } from './translation-service';
import { TextType, type SegmentContext } from '../../shared/types';

export const MANUAL_TRANSLATION_MAX_LENGTH = 2000;

export interface ManualTranslationInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  context?: SegmentContext;
  segmentId?: string;
}

interface ManualTranslationService {
  translate(request: CachedTranslationRequest): Promise<Array<{
    translation: string;
  }>>;
}

export async function translateManualText(
  input: ManualTranslationInput,
  service: ManualTranslationService,
): Promise<string> {
  const text = input.text.trim();
  if (!text) {
    throw new Error('Translation text must not be empty.');
  }
  if (Array.from(text).length > MANUAL_TRANSLATION_MAX_LENGTH) {
    throw new Error(`Translation text must not exceed ${MANUAL_TRANSLATION_MAX_LENGTH} characters.`);
  }
  if (!input.sourceLang.trim() || !input.targetLang.trim()) {
    throw new Error('Source and target languages are required.');
  }

  const results = await service.translate({
    sentences: [{
      segmentId: input.segmentId || 'manual',
      sentenceIndex: 0,
      sentence: text,
      context: input.context ? {
        ...input.context,
        sentence: text,
      } : {
        sentence: text,
        textType: TextType.OTHER,
        tagName: 'manual-input',
        pageTitle: '',
        pageMetaDescription: '',
        pageLanguage: input.sourceLang,
        headingPath: [],
        beforeSentences: [],
        afterSentences: [],
      },
    }],
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
  });

  const translation = results[0]?.translation?.trim();
  if (!translation) {
    throw new Error('Translation output is missing or blank.');
  }
  return translation;
}
