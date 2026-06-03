// One-shot uploader: pushes the 3 ref scene images of "ลิง" template to Dropbox.
// Run once: cd server && npx tsx scripts/upload-ling-scene-refs.ts
import 'dotenv/config';
import { uploadLocalFileToDropbox } from '../src/utils/dropbox.js';

const SCENES = [
  { idx: 0, local: 'C:\\Users\\User\\Downloads\\Scene 1.png', remote: '/trippleviral/viral-templates/ling-scene-ref-1.png' },
  { idx: 1, local: 'C:\\Users\\User\\Downloads\\Scene 2.png', remote: '/trippleviral/viral-templates/ling-scene-ref-2.png' },
  { idx: 2, local: 'C:\\Users\\User\\Downloads\\Scence 3.png', remote: '/trippleviral/viral-templates/ling-scene-ref-3.png' },
];

(async () => {
  for (const s of SCENES) {
    try {
      console.log(`[ling-scene-refs] Uploading ${s.local} → ${s.remote}`);
      const { sharedUrl } = await uploadLocalFileToDropbox(s.local, s.remote);
      // Convert ?dl=1 → ?raw=1 so the URL streams inline (works as image_input for KIE).
      const streamable = sharedUrl.replace(/[?&]dl=1/g, m => m.startsWith('?') ? '?raw=1' : '&raw=1');
      console.log(`[ling-scene-refs] ✅ scene ${s.idx + 1}: ${streamable}`);
    } catch (err: any) {
      console.error(`[ling-scene-refs] ❌ scene ${s.idx + 1} failed:`, err.message);
    }
  }
})();
