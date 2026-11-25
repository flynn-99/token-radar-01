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

/** The usage text printed by --help: what the radar does and how to run it. */
const USAGE = [
  'token radar — rank pre-token protocols from a sealed DefiLlama snapshot.',
  '',
  'Usage:',
  '  MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>',
  '',
  'Flags:',
  '  --input <path>   the snapshot to read (default: /input/snapshot.json when it',
  '                   exists, else the kit snapshot beside this repository)',
  '  --help, -h       print this text and stop',
  '',
  'The output directory comes from MAKEFUN_OUTPUT_DIR, or `out` when it is unset.',
  'Example: MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json',
].join('\n');

/** True when the arguments ask for the usage text instead of a run. */
function wantsHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

/** A snapshot too broken to rank, or null when it is sound enough to run. */
function snapshotIssue(value: unknown): string | null {
  // The snapshot must be an object, not an array or a bare number or string.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'the snapshot is not a JSON object';
  }
  const record = value as { protocols?: unknown; watchlist?: unknown };
  if (!Array.isArray(record.protocols) || record.protocols.length === 0) {
    return 'the snapshot has no protocols array, or it is empty';
  }
  if (!Array.isArray(record.watchlist) || record.watchlist.length === 0) {
    return 'the snapshot has no watchlist array, or it is empty';
  }
  for (const protocol of record.protocols as unknown[]) {
    // Every protocol needs a slug to be named on the board, and a TVL that is a
    // real number, never negative, so the model can score it.
    if (typeof protocol !== 'object' || protocol === null || Array.isArray(protocol)) {
      return 'a protocol in the snapshot is not an object';
    }
    const entry = protocol as { slug?: unknown; tvl_usd?: unknown };
    if (typeof entry.slug !== 'string' || entry.slug.length === 0) {
      return 'a protocol in the snapshot has no slug';
    }
    if (typeof entry.tvl_usd !== 'number' || !Number.isFinite(entry.tvl_usd) || entry.tvl_usd < 0) {
      return `protocol ${entry.slug} has no usable tvl_usd`;
    }
  }
  return null;
}

/** Re-read the board just written and confirm it holds exactly the rows built. */
function verifyBoard(out: string, rows: number): void {
  // Reading back what was written catches a short write before the grader does:
  // the file must parse, and its rows must be the board, no more and no fewer.
  const written = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8')) as { rows?: unknown };
  if (!Array.isArray(written.rows) || written.rows.length !== rows) {
    throw new Error(
      `board.json holds ${Array.isArray(written.rows) ? written.rows.length : 'no'} rows, expected ${rows}`,
    );
  }
  console.error(`verified board.json: ${written.rows.length} rows`);
}

/** Copy a directory from the repository into the output directory, replacing what is there. */
function copyDir(name: string, out: string): void {
  cpSync(join(REPO_ROOT, name), join(out, name), { recursive: true, force: true });
}

/** The whole run: read the snapshot, build the board, write the output directory. */
function main(): void {
  // The help flag is answered before anything else: no snapshot is read and
  // nothing is written, so asking how to run the program can never change it.
  if (wantsHelp(process.argv.slice(2))) {
    console.log(USAGE);
    return;
  }
  const input = snapshotPath(process.argv.slice(2));
  const out = outputDir();

  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  // A snapshot that fails this check cannot produce a board the gate will take,
  // so stop here with a plain error instead of scoring garbage.
  const broken = snapshotIssue(snapshot);
  if (broken !== null) {
    console.error(`main.ts: the snapshot is unusable: ${broken}`);
    process.exit(1);
  }
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
  // The board is checked only after every file is written, so the check sees the
  // finished directory exactly as the grader will.
  verifyBoard(out, board.length);

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
