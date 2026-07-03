import type { Segment } from '../../shared/types';

export interface SegmentTranslationBuffer {
  segmentId: string;
  sentenceCount: number;
  translations: Map<number, string>;
  injected: boolean;
}

export interface SegmentSentenceTranslation {
  segmentId: string;
  sentenceIndex: number;
  translation: string;
}

export function createSegmentTranslationBuffers(
  segments: Array<Pick<Segment, 'id' | 'sentences'>>,
): Map<string, SegmentTranslationBuffer> {
  return new Map(
    segments.map((segment) => [
      segment.id,
      {
        segmentId: segment.id,
        sentenceCount: segment.sentences.length,
        translations: new Map<number, string>(),
        injected: false,
      },
    ]),
  );
}

export function addSentenceTranslation(
  buffers: Map<string, SegmentTranslationBuffer>,
  item: SegmentSentenceTranslation,
): SegmentTranslationBuffer | null {
  const buffer = buffers.get(item.segmentId);
  if (!buffer || buffer.injected) return null;
  if (item.sentenceIndex < 0 || item.sentenceIndex >= buffer.sentenceCount) {
    return null;
  }

  const text = item.translation.trim();
  if (!text) return null;

  buffer.translations.set(item.sentenceIndex, text);
  return isSegmentTranslationComplete(buffer) ? buffer : null;
}

export function isSegmentTranslationComplete(
  buffer: SegmentTranslationBuffer,
): boolean {
  return buffer.translations.size >= buffer.sentenceCount;
}

export function joinSegmentTranslation(
  buffer: SegmentTranslationBuffer,
  targetLang: string,
): string {
  const parts: string[] = [];
  for (let i = 0; i < buffer.sentenceCount; i++) {
    const part = buffer.translations.get(i);
    if (part) parts.push(part);
  }

  const separator = shouldJoinWithoutSpaces(targetLang) ? '' : ' ';
  return parts.join(separator).trim();
}

export function markSegmentTranslationInjected(
  buffer: SegmentTranslationBuffer,
): void {
  buffer.injected = true;
}

function shouldJoinWithoutSpaces(targetLang: string): boolean {
  return /^(zh|ja|ko|th)\b/i.test(targetLang);
}
