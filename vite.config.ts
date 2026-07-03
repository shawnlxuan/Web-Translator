import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '.output/chrome-mv3',
    emptyOutDir: true,
    // Each entrypoint gets its own complete bundle (no shared chunks)
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'entrypoints/popup/index.html'),
        options: resolve(__dirname, 'entrypoints/options/index.html'),
        background: resolve(__dirname, 'entrypoints/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js';
          return 'chunks/[name]-[hash].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'chunks/[name]-[hash].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
});
