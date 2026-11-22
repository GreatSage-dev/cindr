import fs from 'node:fs';

const bf = JSON.parse(fs.readFileSync('artifacts/BlazeForge.json', 'utf8'));
const sd = JSON.parse(fs.readFileSync('artifacts/StampDispenser.json', 'utf8'));

const content = `import type { Artifact } from '@cashscript/utils';

export const BlazeForgeArtifact: Artifact = ${JSON.stringify(bf, null, 2)} as unknown as Artifact;

export const StampDispenserArtifact: Artifact = ${JSON.stringify(sd, null, 2)} as unknown as Artifact;
`;

fs.writeFileSync('src/artifacts.ts', content, 'utf8');
console.log('Successfully generated src/artifacts.ts with inlined JSON artifacts!');
