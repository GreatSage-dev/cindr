import { readFileSync } from 'node:fs';
import type { Artifact } from '@cashscript/utils';

function loadArtifact(filename: string): Artifact {
  const url = new URL(`../artifacts/${filename}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Artifact;
}

export const BlazeForgeArtifact: Artifact = loadArtifact('BlazeForge.json');
export const StampDispenserArtifact: Artifact = loadArtifact('StampDispenser.json');
