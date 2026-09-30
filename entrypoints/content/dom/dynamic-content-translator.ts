import type { ExtractedTextNode, Segment, SentenceWithContext } from '../../../shared/types';
import { TranslationState } from '../../../shared/types';
import { resetContextCache } from '../../../core/context/context-collector';
import { extractTextNodes } from './text-extractor';
import { buildSegments } from './segment-builder';
import {
  filterSegmentsForTargetLanguage,
  serializeBatches,
} from '../../../core/translation/translation-orchestrator';
import { createBatches } from '../../../core/translation/batch-manager';
import {
  createSegmentTranslationBuffers,
  type SegmentTranslationBuffer,
} from '../../../core/translation/segment-translation-buffer';
import {
  mergeExtractedNodesInDocumentOrder,
  normalizeDynamicContentRoots,
} from './dynamic-content-roots';

type SerializedBatches = ReturnType<typeof serializeBatches>;

export interface DynamicContentTranslationState {
  pageState: TranslationState;
  watcherActive: boolean;
  runId: number;
  currentRunId: number;
  sourceLang: string;
  targetLang: string;
  batchSize: number;
  contextWindowSize: number;
  translateByParagraph?: boolean;
  existingNodes: ExtractedTextNode[];
}

export interface DynamicContentTranslationWork {
  extractedNodes: ExtractedTextNode[];
  allNodes: ExtractedTextNode[];
  segments: Segment[];
  segmentBuffers: Map<string, SegmentTranslationBuffer>;
  serializedBatches: SerializedBatches;
}

export interface DynamicContentTranslationDependencies {
  extractTextNodes: (options: {
    root: Element;
    allowWithinTranslatedRoot?: boolean;
  }) => ExtractedTextNode[];
  buildSegments: typeof buildSegments;
  filterSegmentsForTargetLanguage: (
    segments: Segment[],
    targetLang: string,
  ) => Segment[];
  createBatches: (
    segments: Segment[],
    allNodes: ExtractedTextNode[],
    config: {
      batchSize: number;
      sourceLang: string;
      targetLang: string;
      contextWindowSize: number;
    },
  ) => SentenceWithContext[][];
  serializeBatches: typeof serializeBatches;
  createSegmentTranslationBuffers: typeof createSegmentTranslationBuffers;
  resetContextCache: typeof resetContextCache;
}

const defaultDependencies: DynamicContentTranslationDependencies = {
  extractTextNodes,
  buildSegments,
  filterSegmentsForTargetLanguage,
  createBatches,
  serializeBatches,
  createSegmentTranslationBuffers,
  resetContextCache,
};

export function prepareDynamicContentTranslation(
  nodes: Node[],
  state: DynamicContentTranslationState,
  deps: DynamicContentTranslationDependencies = defaultDependencies,
): DynamicContentTranslationWork | null {
  if (
    state.pageState !== TranslationState.COMPLETE ||
    !state.watcherActive ||
    state.runId !== state.currentRunId
  ) {
    return null;
  }

  const roots = normalizeDynamicContentRoots(nodes);
  if (roots.length === 0) return null;

  const seenTextNodes = new Set(state.existingNodes.map(({ textNode }) => textNode));
  const extractedNodes = roots.flatMap((root) => deps.extractTextNodes({
    root,
    allowWithinTranslatedRoot: true,
  }))
    .filter(({ textNode }) => {
      if (seenTextNodes.has(textNode)) return false;
      seenTextNodes.add(textNode);
      return true;
    });
  if (extractedNodes.length === 0) return null;

  const segments = deps.filterSegmentsForTargetLanguage(
    state.translateByParagraph
      ? deps.buildSegments(extractedNodes, state.sourceLang, true)
      : deps.buildSegments(extractedNodes, state.sourceLang),
    state.targetLang,
  );
  if (segments.length === 0) return null;

  const allNodes = mergeExtractedNodesInDocumentOrder(
    state.existingNodes,
    extractedNodes,
  );
  deps.resetContextCache();
  const serializedBatches = deps.serializeBatches(
    deps.createBatches(segments, allNodes, {
      batchSize: state.batchSize,
      sourceLang: state.sourceLang,
      targetLang: state.targetLang,
      contextWindowSize: state.contextWindowSize,
    }),
  );
  if (serializedBatches.length === 0) return null;

  return {
    extractedNodes,
    allNodes,
    segments,
    segmentBuffers: deps.createSegmentTranslationBuffers(segments),
    serializedBatches,
  };
}
