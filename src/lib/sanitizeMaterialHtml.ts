import DOMPurify from 'dompurify';

// Uploaded lesson materials are raw HTML exports from Word/Google Docs, which
// commonly hard-code inline font-family, color, and background-color on
// "code-like" runs (e.g. a dark console-style block with light text).
// DOMPurify keeps the style attribute by default, so those declarations
// would otherwise override the site's Thai-safe Kanit font and the white
// "paper" surface the material is rendered on, producing unreadable
// dark-on-dark or wrongly-fonted text nested inside an otherwise-white doc.
// Strip them so the surrounding paper styling always wins; keep the rest of
// the inline styling (bold, alignment, etc.) intact.
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style') {
    data.attrValue = data.attrValue.replace(/(?:^|;)\s*(?:font(?:-family)?|color|background|background-color)\s*:[^;]+;?/gi, '');
  }
});

export function sanitizeMaterialHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
