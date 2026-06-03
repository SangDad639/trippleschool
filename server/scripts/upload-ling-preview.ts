// One-shot uploader: pushes the local "ลิง.mp4" reference video into Dropbox
// so it can be used as preview_video_url for the "ลิง" viral template.
// Run once with: cd server && npx tsx scripts/upload-ling-preview.ts
import 'dotenv/config';
import { uploadLocalFileToDropbox } from '../src/utils/dropbox.js';

const LOCAL_PATH = 'C:\\Users\\User\\Downloads\\ลิง.mp4';
const DROPBOX_PATH = '/trippleviral/viral-templates/ling-preview.mp4';

(async () => {
  try {
    console.log(`[ling-preview] Uploading ${LOCAL_PATH} → ${DROPBOX_PATH}`);
    const { sharedUrl, dropboxPath } = await uploadLocalFileToDropbox(LOCAL_PATH, DROPBOX_PATH);
    console.log(`[ling-preview] ✅ done`);
    console.log(`[ling-preview] sharedUrl: ${sharedUrl}`);
    console.log(`[ling-preview] dropboxPath: ${dropboxPath}`);
    // Also print a streamable variant (?raw=1) suitable for <video> tags.
    const streamable = sharedUrl.replace(/[?&]dl=1/g, m => m.startsWith('?') ? '?raw=1' : '&raw=1');
    console.log(`[ling-preview] streamable: ${streamable}`);
  } catch (err: any) {
    console.error('[ling-preview] ❌ failed:', err.message);
    process.exit(1);
  }
})();
