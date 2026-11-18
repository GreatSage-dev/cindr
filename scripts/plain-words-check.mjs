import { readFileSync, existsSync } from 'node:fs';

const BANNED_TERMS = [
  'seamless',
  'robust',
  'revolutionize',
  'empower',
  'leverage',
  'cutting-edge',
  'trustless',
  'decentralized',
  'orchestrate',
  'primitive',
  'paradigm',
  'synergy',
  'autonomous ecosystem',
  'game-changing',
];

const MAX_PRE_TECH_WORDS = 300;
const FILES_TO_CHECK = ['README.md'];

let failed = false;

for (const file of FILES_TO_CHECK) {
  if (!existsSync(file)) continue;
  const raw = readFileSync(file, 'utf8');
  const lower = raw.toLowerCase();

  for (const term of BANNED_TERMS) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const hits = lower.match(regex);
    if (hits && hits.length > 0) {
      console.error(`ERROR [${file}]: Banned buzzword "${term}" found (${hits.length}x).`);
      failed = true;
    }
  }

  // Check pre-technical word count (everything before "## Architecture")
  const archIndex = raw.indexOf('## Architecture');
  const preTech = archIndex >= 0 ? raw.slice(0, archIndex) : raw;
  const cleanWords = preTech
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/[#`*>\-|]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (cleanWords.length > MAX_PRE_TECH_WORDS) {
    console.error(
      `ERROR [${file}]: Pre-technical section has ${cleanWords.length} words (max ${MAX_PRE_TECH_WORDS}).`
    );
    failed = true;
  } else {
    console.log(
      `plain-words-check PASS [${file}]: ${cleanWords.length}/${MAX_PRE_TECH_WORDS} pre-technical words, 0 banned buzzwords.`
    );
  }
}

if (failed) {
  process.exit(1);
}
