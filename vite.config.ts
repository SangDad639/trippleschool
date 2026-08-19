import { defineConfig, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

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
  plugins: [react(), cacheHeaders()],
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
