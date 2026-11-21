import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const THREE_BUILD_DIR = path.join(ROOT_DIR, 'node_modules', 'three', 'build');
const PUBLIC_VENDOR_DIR = path.join(ROOT_DIR, 'public', 'vendor');

const FILES_TO_COPY = ['three.module.js', 'three.core.js'];

mkdirSync(PUBLIC_VENDOR_DIR, { recursive: true });

for (const filename of FILES_TO_COPY) {
  const src = path.join(THREE_BUILD_DIR, filename);
  const dest = path.join(PUBLIC_VENDOR_DIR, filename);
  if (!existsSync(src)) {
    throw new Error(`Missing Three.js build asset at ${src}`);
  }
  copyFileSync(src, dest);
}

console.log(`Synced ${FILES_TO_COPY.join(', ')} into public/vendor/`);
