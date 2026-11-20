import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Artifact } from '@cashscript/utils';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function resolveArtifactPath(filename: string): string {
  const candidates = [
    path.resolve(MODULE_DIR, '..', 'artifacts', filename),
    path.resolve(MODULE_DIR, '..', '..', 'artifacts', filename),
    path.resolve(process.cwd(), 'artifacts', filename),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function loadArtifact(filename: string): Artifact {
  return JSON.parse(readFileSync(resolveArtifactPath(filename), 'utf8')) as Artifact;
}

export const BlazeForgeArtifact: Artifact = loadArtifact('BlazeForge.json');
export const StampDispenserArtifact: Artifact = loadArtifact('StampDispenser.json');
