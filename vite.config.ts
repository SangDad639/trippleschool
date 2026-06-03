import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

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
      "www.tripleviral.com",
      "tripleviral.com",
      // Railway dev/standby preview
      ".railway.app",
      "viral-fe-develop.up.railway.app",
      "viral-fe-production.up.railway.app",
    ]
  },
  plugins: [react()],
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
