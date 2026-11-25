// The token radar's entrypoint: one sealed snapshot in, one ranked board out.
//
// It reads the frozen DefiLlama snapshot, scores every protocol with the model in
// lib/model.ts, and writes everything the entry hands in into the output directory:
// board.json (the ranked board), data.js (the dashboard's whole dataset, no network),
// dashboard/ and screenshots/ (copied as they are), and dossier.json (the dashboard
// dossier the judge reads, built from the output directory itself).
//
// Run it from this repository's root:
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
//
// The grader runs the same file in its own container, where the snapshot is at
// /input/snapshot.json and the output directory is /output; both are taken from the
// --input flag and the MAKEFUN_OUTPUT_DIR variable, so the same file works in both
// places with no change. The program uses the Node standard library only, and every
// run over the same snapshot writes the same bytes.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The directory this file lives in: the repository's root, where dashboard/ and screenshots/ are. */
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

/** The snapshot the grader hands the program, when it is there. */
const GRADER_SNAPSHOT = '/input/snapshot.json';

/** The snapshot in the kit next to this repository, for a run on a developer's machine. */
const KIT_SNAPSHOT = resolve(REPO_ROOT, '..', 'token-radar-01-kit', 'input', 'snapshot.json');

/** The most bytes the dossier's text may hold (the scorer's cap). */
const DOSSIER_TEXT_MAX_BYTES = 65_536;

/** The value of a `--flag value` or `--flag=value` argument, or null when the flag is absent. */
function flagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === flag) return argv[i + 1] ?? null;
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return null;
}

/** The snapshot path: the --input flag, else the grader's, else the kit's. */
function snapshotPath(argv: string[]): string {
  const given = flagValue(argv, '--input');
  if (given !== null) return given;
  if (existsSync(GRADER_SNAPSHOT)) return GRADER_SNAPSHOT;
  return KIT_SNAPSHOT;
}

/** The output directory: MAKEFUN_OUTPUT_DIR, else `out` beside this repository. */
function outputDir(): string {
  return process.env.MAKEFUN_OUTPUT_DIR ?? 'out';
}

/** Copy a directory from the repository into the output directory, replacing what is there. */
function copyDir(name: string, out: string): void {
  cpSync(join(REPO_ROOT, name), join(out, name), { recursive: true, force: true });
}

/** The whole run: read the snapshot, build the board, write the output directory. */
function main(): void {
  const input = snapshotPath(process.argv.slice(2));
  const out = outputDir();

  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  const { board, radar } = buildRadar(snapshot);

  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`the board is not one the gate will take: ${issue}`);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`, 'utf8');
  writeFileSync(join(out, 'data.js'), dataScript(radar), 'utf8');
  copyDir('dashboard', out);
  copyDir('screenshots', out);
  // The dossier is built last: it reads the finished output directory, dashboard and screenshots included.
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES }));

  const top = board[0]!;
  console.log(
    `wrote ${board.length} rows to ${out} (top: ${top.name}, $${top.implied_value_usd.toLocaleString('en-US')})`,
  );
}

try {
  main();
} catch (err) {
  console.error(`main.ts: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
