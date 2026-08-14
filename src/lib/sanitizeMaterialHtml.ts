import DOMPurify from 'dompurify';

// Uploaded lesson materials are raw HTML exports (Word/Google Docs, or a
// syntax-highlighted "export as HTML" from a code editor). Two separate
// things in that markup can break the readable "white paper" surface the
// material is meant to render on:
//
// 1. Inline `style="..."` attributes hard-coding font-family/color/
//    background-color on "code-like" runs (e.g. a dark console block).
//    DOMPurify keeps the style attribute by default, so we strip those
//    declarations here.
// 2. An embedded `<style>` block (common in code-editor HTML exports —
//    e.g. a dark syntax-highlighting theme). DOMPurify allows <style> tags
//    by default, and a <style> injected via dangerouslySetInnerHTML is
//    parsed and applied by the browser just like any other stylesheet —
//    it is NOT scoped to the container, so it can repaint the entire
//    material box (or page) with whatever theme the export baked in,
//    completely bypassing the inline-attribute stripping above. Forbidding
//    the tag outright keeps all material styling under our own control.
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style') {
    data.attrValue = data.attrValue.replace(/(?:^|;)\s*(?:font(?:-family)?|color|background|background-color)\s*:[^;]+;?/gi, '');
  }
});

export function sanitizeMaterialHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'link'] });
}
