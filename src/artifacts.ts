import type { Artifact } from '@cashscript/utils';
import blazeForgeJson from '../artifacts/BlazeForge.json' with { type: 'json' };
import stampDispenserJson from '../artifacts/StampDispenser.json' with { type: 'json' };

export const BlazeForgeArtifact: Artifact = blazeForgeJson as unknown as Artifact;
export const StampDispenserArtifact: Artifact = stampDispenserJson as unknown as Artifact;
