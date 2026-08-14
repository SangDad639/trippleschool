import DOMPurify from 'dompurify';

// Uploaded lesson materials are raw HTML exports (Word/Google Docs, or a
// syntax-highlighted "export as HTML" from a code editor) and are rendered
// inside a sandboxed <iframe> (see MaterialHtmlFrame), not injected into the
// page DOM via dangerouslySetInnerHTML. The iframe gives the export its own
// isolated document, so its <style>/inline colors/fonts can render exactly
// as they do when the file is opened directly in a browser, without ever
// repainting the surrounding app. WHOLE_DOCUMENT keeps <head>/<style> intact
// for that. <script> stays stripped by DOMPurify's default profile, and the
// iframe sandbox (no `allow-scripts`) is a second line of defense against
// it. <link> is forbidden to stop the export from pulling in an external
// stylesheet (or tracking pixel) at render time.
export function sanitizeMaterialHtml(html: string): string {
  return DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, FORBID_TAGS: ['link'] });
}
