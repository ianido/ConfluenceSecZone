import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base is required: Forge serves Custom UI assets from a per-version path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
