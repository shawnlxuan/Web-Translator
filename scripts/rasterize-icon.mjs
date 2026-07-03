import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const chromePath = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const sourceSvg = resolve(import.meta.dirname, '..', 'public', 'content-ui', 'ai_translate_icon.svg');
const iconDir = resolve(import.meta.dirname, '..', 'public', 'icons');
const windowsTempRoot = '/mnt/c/Users/shawn/AppData/Local/Temp';
const sizes = [16, 48, 128];

mkdirSync(iconDir, { recursive: true });

const tempDir = mkdtempSync(resolve(windowsTempRoot, 'translator-icon-'));
const tempSvg = resolve(tempDir, 'ai_translate_icon.svg');
copyFileSync(sourceSvg, tempSvg);

try {
  for (const size of sizes) {
    const htmlPath = resolve(tempDir, `icon-${size}.html`);
    const tempPngPath = resolve(tempDir, `icon-${size}.png`);
    const finalPngPath = resolve(iconDir, `icon-${size}.png`);
    const html = [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8">',
      '<style>',
      'html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;}',
      'img{display:block;width:100vw;height:100vh;}',
      '</style>',
      '</head>',
      '<body>',
      `<img src="${toWindowsFileUrl(tempSvg)}" alt="">`,
      '</body>',
      '</html>',
    ].join('');

    writeFileSync(htmlPath, html);

    const result = spawnSync(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      `--screenshot=${toWindowsPath(tempPngPath)}`,
      toWindowsFileUrl(htmlPath),
    ], { encoding: 'utf8' });

    if (result.status !== 0) {
      throw new Error([
        `Chrome failed while generating ${finalPngPath}`,
        result.stderr,
        result.stdout,
      ].filter(Boolean).join('\n'));
    }

    copyFileSync(tempPngPath, finalPngPath);
    console.log(`Generated ${finalPngPath}`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function toWindowsFileUrl(path) {
  return `file:///${toWindowsPath(path).replace(/\\/g, '/')}`;
}

function toWindowsPath(path) {
  const normalized = path.replace(/\\/g, '/');
  const match = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) {
    throw new Error(`Path is not on a Windows mount: ${path}`);
  }
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}
