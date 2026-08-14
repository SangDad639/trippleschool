import DOMPurify from 'dompurify';

// Uploaded lesson materials are raw HTML exports from Word/Google Docs, which
// commonly hard-code an inline font-family (e.g. Courier New) on "code-like"
// runs. DOMPurify keeps the style attribute by default, so that font-family
// would otherwise override the site's Thai-safe Kanit font and break Thai
// tone-mark rendering. Strip font declarations so Kanit always wins; keep the
// rest of the inline styling (colors, alignment, etc.) intact.
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style') {
    data.attrValue = data.attrValue.replace(/font(-family)?\s*:[^;]+;?/gi, '');
  }
});

export function sanitizeMaterialHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
