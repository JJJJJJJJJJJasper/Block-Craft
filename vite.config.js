import { defineConfig } from 'vite';

// The client lives in /client; the built files go to /dist where the Node
// server serves them in production.
export default defineConfig({
  root: 'client',
  publicDir: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
  },
  worker: { format: 'es' },
});
