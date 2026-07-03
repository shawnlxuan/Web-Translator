// Copy manifest.json and icons to the build output
import { cpSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname, '..', '.output', 'chrome-mv3');

// Ensure icons directory exists
mkdirSync(resolve(outDir, 'icons'), { recursive: true });

// Copy icons
for (const size of [16, 48, 128]) {
  copyFileSync(
    resolve(import.meta.dirname, '..', 'public', 'icons', `icon-${size}.png`),
    resolve(outDir, 'icons', `icon-${size}.png`),
  );
}

// Copy web-accessible content UI assets
const contentUiDir = resolve(import.meta.dirname, '..', 'public', 'content-ui');
if (existsSync(contentUiDir)) {
  cpSync(contentUiDir, resolve(outDir, 'content-ui'), { recursive: true });
}

// Copy manifest
copyFileSync(
  resolve(import.meta.dirname, '..', 'public', 'manifest.json'),
  resolve(outDir, 'manifest.json'),
);

console.log('Manifest and icons copied to output directory.');
