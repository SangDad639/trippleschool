// One-shot uploader: pushes the local preview mp4 into Dropbox so it can be
// used as preview_video_url for the "Add Character in Movie" viral template.
// Run once with: cd server && npx tsx scripts/upload-add-character-in-movie-preview.ts
import 'dotenv/config';
import { uploadLocalFileToDropbox } from '../src/utils/dropbox.js';

const LOCAL_PATH = 'C:\\Users\\User\\Documents\\GitHub\\trippleviral\\public\\add-character-in-movie-demo.mp4';
const DROPBOX_PATH = '/trippleviral/viral-templates/add-character-in-movie-preview.mp4';

(async () => {
  try {
    console.log(`[acim-preview] Uploading ${LOCAL_PATH} → ${DROPBOX_PATH}`);
    const { sharedUrl, dropboxPath } = await uploadLocalFileToDropbox(LOCAL_PATH, DROPBOX_PATH);
    console.log(`[acim-preview] ✅ done`);
    console.log(`[acim-preview] sharedUrl: ${sharedUrl}`);
    console.log(`[acim-preview] dropboxPath: ${dropboxPath}`);
    // Print a streamable variant (?raw=1) suitable for <video> tags.
    const streamable = sharedUrl.replace(/[?&]dl=1/g, m => m.startsWith('?') ? '?raw=1' : '&raw=1');
    console.log(`[acim-preview] streamable: ${streamable}`);
  } catch (err: any) {
    console.error('[acim-preview] ❌ failed:', err.message);
    process.exit(1);
  }
})();
