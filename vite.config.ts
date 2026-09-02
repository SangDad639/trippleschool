import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { CLIPS } from "./src/components/guide/clipsData";

// /guide-clips.json — the machine-readable twin of the /guide page.
//
// Triple Bot (the desktop app) shows the manual INSIDE the app, so it needs the clip list
// as data. It cannot read it from this site's bundle, so it fetches this file: publish a
// clip here and every installed app picks it up on its next open — no new exe.
//
// clipsData.ts stays the ONE place a clip is edited; the JSON is generated from it, so the
// two cannot drift. Served in dev as well, so the app can be pointed at localhost:5173.
const guideClipsFeed = (): Plugin => ({
  name: "guide-clips-feed",
  configureServer(server: ViteDevServer) {
    server.middlewares.use("/guide-clips.json", (_req, res) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ clips: CLIPS }));
    });
  },
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "guide-clips.json",
      source: JSON.stringify({ clips: CLIPS }, null, 2),
    });
  },
});

/**
 * `vite preview` (what Railway runs in prod) sends no Cache-Control at all, so
 * browsers apply their own heuristic and can keep a stale index.html — and thus
 * a stale app bundle — for days. In-app browsers (LINE) are the worst offenders:
 * users kept seeing an old build after a deploy.
 *
 * /assets/* filenames carry a content hash, so they are safe to cache forever;
 * everything else (index.html and every SPA route falling back to it) must be
 * revalidated. The etag preview already sends turns that into a cheap 304.
 */
function cacheHeaders() {
  return {
    name: 'cache-headers',
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (/^\/assets\//.test(url) && /\.[a-z0-9]+$/i.test(url)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
        next();
      });
    },
  };
}

/**
 * การ์ดพรีวิวตอนแชร์คอร์ส (LINE / Facebook / X)
 *
 * ปุ่ม "แชร์คอร์สนี้" ส่งลิงก์ /courses/{share_code} ออกไป แต่เว็บเป็น SPA และ
 * crawler ของ LINE/FB ไม่รัน JS → ถ้าไม่ทำอะไร การ์ดที่ขึ้นจะเป็น meta กลางของทั้งเว็บ
 * middleware นี้ดักเฉพาะ /courses/:ref แล้วยิงถาม API เอาชื่อ/คำโปรย/ปกของคอร์สนั้น
 * มาแทรกเป็น og: ใน index.html ก่อนส่ง (ยิงไม่ติด/ไม่พบคอร์ส = ส่งไฟล์เดิม ไม่พังหน้าเว็บ)
 */
function courseOgTags(apiBase: string) {
  const esc = (s: string) =>
    String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return {
    name: 'course-og-tags',
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        // รองรับ 4 ทรง: ลิงก์คอร์ส (/courses/:ref) · ลิงก์วิดีโอเต็ม (/app/courses/:ref/learn/:id)
        // · /app/courses/{ref} · ลิงก์สั้นแบบ bitly ที่ root (/{รหัส 6 ตัว} — จำกัดรูปแบบรหัส
        // แน่นๆ กันไปดัก path จริงอย่าง /update ที่บังเอิญหน้าตาเหมือนรหัส)
        const m = /^\/courses\/([^/]+)\/?$/.exec(url);
        const mv = /^\/app\/courses\/([^/]+)\/learn\/(\d+)\/?$/.exec(url);
        const ms = /^\/app\/courses\/([^/]+)\/?$/.exec(url) ?? /^\/([a-hj-km-np-z][a-hj-km-np-z2-9]{5})\/?$/.exec(url);
        let ref = m?.[1] ?? mv?.[1];
        let lessonId: string | null = mv?.[2] ?? null;
        if (req.method !== 'GET' || !apiBase) return next();
        try {
          if (!ref && ms) {
            // ref เดี่ยวใต้ /app — อาจเป็นรหัสบทเรียนหรือคอร์ส ให้ server ตัดสิน
            const rr = await fetch(`${apiBase}/api/courses/resolve/${encodeURIComponent(ms[1])}`, {
              signal: AbortSignal.timeout(3000),
            });
            if (!rr.ok) return next();
            const j = await rr.json();
            ref = j.slug;
            if (j.type === 'lesson') lessonId = String(j.lesson_id);
          }
          if (!ref) return next();
          const r = await fetch(`${apiBase}/api/courses/${encodeURIComponent(ref)}`, {
            signal: AbortSignal.timeout(3000),
          });
          if (!r.ok) return next();
          const c = await r.json();
          if (!c?.id || !c?.name) return next();
          // ลิงก์วิดีโอ → รูปการ์ดใช้ thumb ของบทนั้น (endpoint สาธารณะ มี fallback ในตัว)
          // ชื่อยังเป็นชื่อคอร์ส — payload สาธารณะรายบทไม่มีให้ และไม่ควรเปิดข้อมูลบทที่ล็อก
          const ogImage = lessonId
            ? `${apiBase}/api/courses/lessons/${lessonId}/thumb`
            : `${apiBase}/api/courses/${c.id}/cover?v=hero`;
          const fs = await import('node:fs/promises');
          const pathMod = await import('node:path');
          const raw = await fs.readFile(pathMod.resolve(__dirname, 'dist/index.html'), 'utf8');
          // ถอด og:/twitter: ค่ากลางใน index.html ออกก่อน — ถ้าปล่อยไว้จะมีสองชุด
          // แล้ว crawler ส่วนใหญ่หยิบ "ตัวแรก" ไปใช้ = ได้การ์ดกลางแทนการ์ดคอร์ส
          const html = raw.replace(
            /[ \t]*<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*\n?/gi,
            ''
          );
          const pageUrl = `${process.env.VITE_SITE_URL || 'https://www.triple-school.com'}${url}`;
          const tags = [
            `<meta property="og:type" content="website">`,
            `<meta property="og:site_name" content="Triple School">`,
            `<meta property="og:title" content="${esc(c.name)}">`,
            `<meta property="og:description" content="${esc(c.short_description || c.description || '').slice(0, 200)}">`,
            `<meta property="og:image" content="${ogImage}">`,
            `<meta property="og:url" content="${esc(pageUrl)}">`,
            `<meta name="twitter:card" content="summary_large_image">`,
            `<meta name="twitter:title" content="${esc(c.name)}">`,
            `<meta name="twitter:image" content="${ogImage}">`,
          ].join('\n    ');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(html.replace('</head>', `  ${tags}\n  </head>`).replace(/<title>[^<]*<\/title>/, `<title>${esc(c.name)} | Triple School</title>`));
        } catch {
          next();
        }
      });
    },
  };
}

// API base สำหรับดึงข้อมูลคอร์สมาทำ og: (ค่าเดียวกับที่ FE ใช้เรียก API)
const OG_API_BASE = process.env.VITE_API_URL || "https://backend-production-0eef4.up.railway.app";

export default defineConfig({
  server: {
    host: "::",
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT || 3001}`,
        changeOrigin: true,
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: [
      "www.triple-school.com",
      "triple-school.com",
      // Railway dev/standby preview
      ".railway.app",
      "viral-fe-develop.up.railway.app",
      "viral-fe-production.up.railway.app",
    ]
  },
  plugins: [react(), guideClipsFeed(), cacheHeaders(), courseOgTags(OG_API_BASE)],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': [
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-slider',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
          ],
          'utils-vendor': ['date-fns', 'lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
