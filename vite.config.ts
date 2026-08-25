import { defineConfig, type Plugin, type ViteDevServer } from "vite";
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
  plugins: [react(), guideClipsFeed()],
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
