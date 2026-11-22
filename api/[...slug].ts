import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, '..');

let cachedLandingHtml: string | null = null;
function getLandingHtml(): string {
  if (!cachedLandingHtml) {
    const candidates = [
      path.join(PROJECT_ROOT, 'public', 'landing.html'),
      path.join(PROJECT_ROOT, 'public', 'index.html'),
      path.join(process.cwd(), 'public', 'landing.html'),
      path.join(process.cwd(), 'public', 'index.html'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        cachedLandingHtml = fs.readFileSync(p, 'utf8');
        break;
      }
    }
  }
  return cachedLandingHtml || '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=/landing.html"></head><body>Redirecting...</body></html>';
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  // If this handler is somehow invoked for the root page or index, return HTML with status 200 immediately
  if (pathname === '/' || pathname === '/index.html' || pathname === '/landing.html') {
    const html = getLandingHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'public, max-age=0, must-revalidate',
    });
    res.end(html);
    return;
  }

  // Otherwise, delegate to the cindr server request handler with full error containment
  try {
    const { default: serverHandler } = await import('../src/server.js');
    await serverHandler(req, res);
  } catch (err: unknown) {
    console.error('[cindr serverless error]:', err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : String(err);
      const body = JSON.stringify({
        status: 'error',
        code: 'INTERNAL_SERVER_ERROR',
        message,
      });
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
    }
  }
}
