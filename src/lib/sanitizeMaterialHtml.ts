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
// เอกสารที่ export จาก Word/Docs ตั้งความกว้างหน้ากระดาษ (~800px) มาด้วย พอเปิดในกรอบ
// แคบๆ บนมือถือจึงล้น/ต้องเลื่อนแนวนอนในกล่อง — เติม viewport + กติกา max-width ให้เอกสาร
//
// ⚠️ ต้องเติม *หลัง* sanitize: DOMPurify ไม่มี `meta` ใน allowlist (ตรวจ dist แล้ว) จึงลบ
// แท็ก viewport ทิ้งทุกครั้งถ้าใส่ก่อน — และกฎ CSS ครอบด้วย @media เพื่อไม่ให้เปลี่ยน
// การเรนเดอร์เอกสารบนเดสก์ท็อป (table{display:block} ทำตารางเสียโครงบนจอกว้าง)
const MOBILE_DOC_HEAD =
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<style>html{-webkit-text-size-adjust:100%}' +
  '@media (max-width:768px){body{margin:8px;word-wrap:break-word;overflow-wrap:anywhere}' +
  'img,video,pre{max-width:100%;height:auto}table{display:block;overflow-x:auto;max-width:100%}}</style>';

export function sanitizeMaterialHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, FORBID_TAGS: ['link'] });
  // เนื้อหาผ่านการ sanitize แล้ว ส่วนที่เติมเป็นสตริงคงที่ของเราเอง (ไม่มี input ผู้ใช้)
  return /<head[\s>]/i.test(clean)
    ? clean.replace(/<head([^>]*)>/i, `<head$1>${MOBILE_DOC_HEAD}`)
    : MOBILE_DOC_HEAD + clean;
}
