import type { ExtractedTextNode } from '../../../shared/types';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_POSITION_PRECEDING = 2;
const DOCUMENT_POSITION_FOLLOWING = 4;
const EXTENSION_OWNED_ATTRIBUTES = [
  'data-tr-ignore',
  'data-tr-injected',
  'data-tr-loading',
];

export function resolveDynamicContentRoot(node: Node): Element | null {
  const element = node.nodeType === ELEMENT_NODE
    ? node as Element
    : node.nodeType === TEXT_NODE
      ? node.parentElement
      : null;
  if (!element || isInsideExtensionOwnedTree(element)) return null;
  return element;
}

export function normalizeDynamicContentRoots(nodes: Node[]): Element[] {
  const uniqueRoots: Element[] = [];
  const seen = new Set<Element>();

  for (const node of nodes) {
    const root = resolveDynamicContentRoot(node);
    if (!root || seen.has(root)) continue;
    seen.add(root);
    uniqueRoots.push(root);
  }

  return uniqueRoots.filter((root) => !uniqueRoots.some((candidate) => (
    candidate !== root && containsNode(candidate, root)
  )));
}

export function mergeExtractedNodesInDocumentOrder(
  existingNodes: ExtractedTextNode[],
  newNodes: ExtractedTextNode[],
): ExtractedTextNode[] {
  const seen = new Set<Text>();
  const merged = [...existingNodes, ...newNodes].filter((node) => {
    if (node.textNode.isConnected === false) return false;
    if (seen.has(node.textNode)) return false;
    seen.add(node.textNode);
    return true;
  });

  return merged
    .map((node, originalIndex) => ({ node, originalIndex }))
    .sort((left, right) => {
      const position = compareTextNodes(left.node.textNode, right.node.textNode);
      return position || left.originalIndex - right.originalIndex;
    })
    .map(({ node }) => node);
}

function isInsideExtensionOwnedTree(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    const candidate = current;
    if (EXTENSION_OWNED_ATTRIBUTES.some((attribute) => candidate.hasAttribute(attribute))) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function containsNode(container: Element, node: Node): boolean {
  return typeof container.contains === 'function' && container.contains(node);
}

function compareTextNodes(left: Text, right: Text): number {
  if (left === right || typeof left.compareDocumentPosition !== 'function') return 0;
  const position = left.compareDocumentPosition(right);
  if (position & DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}
