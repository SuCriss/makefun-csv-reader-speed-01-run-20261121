// make.fun csv-reader-speed-01-run-20261121 authored driver.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// The same V8 flag the house baseline uses, applied before solve.js is loaded.
setFlagsFromString('--no-incremental-marking');
const solveUrl = new URL('./solve.js', import.meta.url).href;
const run = (await import(solveUrl)).run;

const inDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
mkdirSync(outDir, { recursive: true });
const cases = JSON.parse(readFileSync(join(inDir, 'cases.json'), 'utf8'));
const answers = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(outDir, 'answers.json'), JSON.stringify(answers));
