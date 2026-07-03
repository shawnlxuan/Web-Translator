// ============================================================
// Extract page-level metadata from the DOM
// ============================================================

/**
 * Extract page-level metadata for context building.
 */
export function extractPageMetadata(): {
  pageTitle: string;
  pageMetaDescription: string;
  pageLanguage: string;
} {
  return {
    pageTitle: getPageTitle(),
    pageMetaDescription: getMetaDescription(),
    pageLanguage: getPageLanguage(),
  };
}

function getPageTitle(): string {
  // Try multiple sources in priority order
  const ogTitle = document
    .querySelector('meta[property="og:title"]')
    ?.getAttribute('content');
  if (ogTitle?.trim()) return ogTitle.trim();

  const twitterTitle = document
    .querySelector('meta[name="twitter:title"]')
    ?.getAttribute('content');
  if (twitterTitle?.trim()) return twitterTitle.trim();

  return document.title.trim();
}

function getMetaDescription(): string {
  const meta = document.querySelector('meta[name="description"]');
  const content = meta?.getAttribute('content');
  if (content?.trim()) return content.trim();

  const ogDesc = document
    .querySelector('meta[property="og:description"]')
    ?.getAttribute('content');
  if (ogDesc?.trim()) return ogDesc.trim();

  return '';
}

function getPageLanguage(): string {
  // Check <html lang>
  const htmlLang = document.documentElement.lang;
  if (htmlLang) return htmlLang;

  // Check meta
  const metaLang = document
    .querySelector('meta[http-equiv="content-language"]')
    ?.getAttribute('content');
  if (metaLang) return metaLang;

  return 'en';
}

/**
 * Find the primary content element of the page.
 * Falls back to document.body if no main content area is found.
 */
export function findMainContentElement(): Element {
  // Try semantic elements first
  for (const selector of ['main', 'article', '[role="main"]', '#content', '.content', '.post-content', '.article-content', '.entry-content']) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  return document.body;
}
