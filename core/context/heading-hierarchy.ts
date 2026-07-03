// ============================================================
// Extract heading hierarchy (H1-H6 path) for a given text node
// ============================================================

/**
 * Build a breadcrumb path of headings from the document root to a text node.
 * Returns an array of heading texts, e.g., ["Document Title", "Section 2", "Subsection 2.1"]
 */
export function getHeadingPath(node: Node): string[] {
  const headings: Array<{ level: number; text: string }> = [];

  // Collect all headings in document order up to this node
  const allHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');

  for (const heading of allHeadings) {
    // Check if this heading precedes our node in document order
    if (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      break;
    }

    const level = parseInt(heading.tagName.charAt(1));
    const text = heading.textContent?.trim() || '';

    if (text.length === 0) continue;

    // Remove lower-level headings if a higher-level one appears
    // (e.g., an h2 replaces the previous h2, h3, etc.)
    while (headings.length > 0 && headings[headings.length - 1].level >= level) {
      headings.pop();
    }

    headings.push({ level, text });
  }

  return headings.map((h) => h.text);
}

/**
 * Get the nearest heading above a text node (the section title).
 */
export function getNearestHeading(node: Node): string | undefined {
  const path = getHeadingPath(node);
  return path.length > 0 ? path[path.length - 1] : undefined;
}

/**
 * Build the heading path relative to a parent element (faster for batch processing).
 */
export function getHeadingPathFromHeadings(
  headingElements: Array<{ level: number; text: string; element: Element }>,
  targetElement: Element,
): string[] {
  const headings: Array<{ level: number; text: string }> = [];

  for (const h of headingElements) {
    if (
      h.element.compareDocumentPosition(targetElement) &
      Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      break;
    }

    while (headings.length > 0 && headings[headings.length - 1].level >= h.level) {
      headings.pop();
    }

    headings.push({ level: h.level, text: h.text });
  }

  return headings.map((h) => h.text);
}

/**
 * Pre-extract all headings on the page for efficient batch processing.
 */
export function extractAllHeadings(): Array<{
  level: number;
  text: string;
  element: Element;
}> {
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const result: Array<{ level: number; text: string; element: Element }> = [];

  for (const heading of headings) {
    const text = heading.textContent?.trim() || '';
    if (text.length > 0) {
      result.push({
        level: parseInt(heading.tagName.charAt(1)),
        text,
        element: heading,
      });
    }
  }

  return result;
}
