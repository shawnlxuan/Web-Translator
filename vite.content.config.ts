// Separate build for content script — produces a self-contained IIFE file
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: '.output/chrome-mv3',
    emptyOutDir: false, // Don't clear the main build output
    lib: {
      entry: resolve(__dirname, 'entrypoints/content/index.ts'),
      formats: ['iife'],
      name: 'AITranslator',
      fileName: () => 'content-scripts/content.js',
      cssFileName: 'content-scripts/content',
    },
    rollupOptions: {
      output: {
        // Don't add any external dependencies
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
});
