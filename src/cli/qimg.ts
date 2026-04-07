/**
 * qimg CLI entry point.
 *
 * Mirrors qmd's command surface for image search:
 *   collection add/list/remove/rename
 *   ls            - list indexed images
 *   update        - scan filesystem, hash files, extract EXIF + sidecar caption
 *   embed         - generate SigLIP vectors for images that don't have one
 *   get           - print metadata + caption for a single image
 *   search        - BM25 over filename + caption + exif_text
 *   vsearch       - vector cosine similarity (text or --image)
 *   query         - hybrid (RRF fusion of fts + vec)
 *   status        - index counts
 *   mcp           - start MCP server
 */

import fg from "fast-glob";
import { resolve, relative } from "path";
import { existsSync, statSync } from "fs";
import {
  addCollection,
  getCollection,
  isValidCollectionName,
  listCollections,
  removeCollection,
  renameCollection,
  getConfigPath,
} from "../collections.js";
import { Store, hashFile, fileMtime } from "../store.js";
import type { SearchHit } from "../store.js";
import { resolveSidecar, clearSidecarCache } from "../sidecar.js";
import { extractExif } from "../exif.js";
import { embedText, embedImage } from "../embed.js";

// ---------------------------------------------------------------------------
// Terminal UI helpers (ported from qmd)
// ---------------------------------------------------------------------------

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const c = {
  reset: useColor ? "\x1b[0m" : "",
  dim: useColor ? "\x1b[2m" : "",
  bold: useColor ? "\x1b[1m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  green: useColor ? "\x1b[32m" : "",
};

const isTTY = process.stderr.isTTY;
const cursor = {
  hide() { if (isTTY) process.stderr.write("\x1b[?25l"); },
  show() { if (isTTY) process.stderr.write("\x1b[?25h"); },
};
process.on("SIGINT", () => { cursor.show(); process.exit(130); });
process.on("SIGTERM", () => { cursor.show(); process.exit(143); });

// OSC 9;4 taskbar progress (supported by some terminals like WezTerm, Windows Terminal)
const progress = {
  set(percent: number) { if (isTTY) process.stderr.write(`\x1b]9;4;1;${Math.round(percent)}\x07`); },
  clear() { if (isTTY) process.stderr.write(`\x1b]9;4;0\x07`); },
  indeterminate() { if (isTTY) process.stderr.write(`\x1b]9;4;3\x07`); },
};

function renderProgressBar(percent: number, width: number = 30): string {
  const filled = Math.round((percent / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "...";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith("-") && a.length > 1) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function flagNum(v: unknown, fallback: number): number {
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function flagStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function printHits(hits: SearchHit[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(hits, null, 2));
    return;
  }
  for (const h of hits) {
    const score = h.score.toFixed(3);
    console.log(`${score}\t${h.path}`);
    if (h.caption) console.log(`        ${h.caption}`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdHelp(): void {
  console.log(`qimg - Query Images

Commands:
  collection add <path> --name <n> [--mask <glob>]
                          [--sidecar-notes <dir>] [--sidecar-field <name>]
  collection list
  collection remove <name>
  collection rename <old> <new>
  ls [collection]
  update [--collection <n>]   Scan filesystem, hash, extract EXIF + caption
  embed [--collection <n>]    Generate SigLIP vectors for indexed images
  get <path|#docid>
  search <query> [--collection <n>] [-n <num>] [--json]
  vsearch <query> [--image <path>] [--collection <n>] [-n <num>] [--json]
  query <query> [--image <path>] [--collection <n>] [-n <num>] [--json]
  status
  mcp [--http] [--port <n>]

Config: ${getConfigPath()}
`);
}

function cmdCollection(args: ParsedArgs): void {
  const sub = args.positional[0];
  switch (sub) {
    case "add": {
      const path = args.positional[1];
      const name = flagStr(args.flags.name);
      if (!path || !name) {
        console.error("usage: qimg collection add <path> --name <n>");
        process.exit(2);
      }
      if (!isValidCollectionName(name)) {
        console.error(`invalid collection name: ${name}`);
        process.exit(2);
      }
      const abs = resolve(path);
      const mask = flagStr(args.flags.mask) ?? "**/*.{png,jpg,jpeg,webp,heic,gif}";
      const notesRoot = flagStr(args.flags["sidecar-notes"]);
      const field = flagStr(args.flags["sidecar-field"]) ?? "ImageText";
      addCollection(
        name,
        abs,
        mask,
        notesRoot
          ? {
              strategy: "parallel-tree",
              notes_root: resolve(notesRoot),
              case_insensitive: true,
              field,
            }
          : undefined,
      );
      console.log(`added collection '${name}' at ${abs}`);
      break;
    }
    case "list": {
      const cols = listCollections();
      if (cols.length === 0) {
        console.log("(no collections)");
        return;
      }
      for (const c of cols) {
        console.log(`${c.name}\t${c.path}\t${c.pattern}`);
        if (c.sidecar) console.log(`  sidecar: ${c.sidecar.notes_root} (field=${c.sidecar.field})`);
      }
      break;
    }
    case "remove": {
      const name = args.positional[1];
      if (!name) {
        console.error("usage: qimg collection remove <name>");
        process.exit(2);
      }
      console.log(removeCollection(name) ? `removed ${name}` : `not found: ${name}`);
      break;
    }
    case "rename": {
      const [, oldN, newN] = args.positional;
      if (!oldN || !newN) {
        console.error("usage: qimg collection rename <old> <new>");
        process.exit(2);
      }
      console.log(renameCollection(oldN, newN) ? `renamed ${oldN} → ${newN}` : `not found: ${oldN}`);
      break;
    }
    default:
      console.error(`unknown subcommand: collection ${sub ?? ""}`);
      process.exit(2);
  }
}

function cmdLs(args: ParsedArgs): void {
  const store = new Store();
  try {
    const collection = args.positional[0];
    const rows = store.listImages(collection);
    for (const r of rows) {
      console.log(`${r.collection}/${r.path}`);
    }
  } finally {
    store.close();
  }
}

async function cmdUpdate(args: ParsedArgs): Promise<void> {
  const only = flagStr(args.flags.collection);
  const cols = listCollections().filter((c) => !only || c.name === only);
  if (cols.length === 0) {
    console.error("no collections to update");
    process.exit(1);
  }
  const store = new Store();
  try {
    for (const col of cols) {
      console.log(`[${col.name}] scanning ${col.path}...`);
      clearSidecarCache();
      const files = await fg(col.pattern, {
        cwd: col.path,
        ignore: col.ignore,
        absolute: false,
        onlyFiles: true,
      });
      let added = 0,
        updated = 0,
        skipped = 0;
      for (const rel of files) {
        const abs = resolve(col.path, rel);
        if (!existsSync(abs)) continue;
        const mtime = fileMtime(abs);
        const existing = store.getByPath(col.name, rel);

        const sidecar = col.sidecar ? resolveSidecar(abs, col.path, col.sidecar) : null;
        const sidecarChanged =
          sidecar &&
          (!existing || existing.sidecar_mtime !== sidecar.mdMtime);

        if (existing && existing.mtime === mtime && !sidecarChanged) {
          skipped++;
          continue;
        }

        const hash = hashFile(abs);
        const exif = await extractExif(abs);
        let width: number | null = null;
        let height: number | null = null;
        try {
          // sharp is heavy — only require when needed
          const sharp = (await import("sharp")).default;
          const meta = await sharp(abs).metadata();
          width = meta.width ?? null;
          height = meta.height ?? null;
        } catch {
          // ignore — image may be in unsupported format for sharp
        }

        store.upsertImage({
          collection: col.name,
          path: rel,
          hash,
          width,
          height,
          mime: null,
          taken_at: exif.taken_at ?? null,
          camera: exif.camera ?? null,
          gps_lat: exif.gps_lat ?? null,
          gps_lon: exif.gps_lon ?? null,
          caption: sidecar?.caption ?? null,
          sidecar_path: sidecar?.mdPath ?? null,
          sidecar_mtime: sidecar?.mdMtime ?? null,
          exif_text: exif.exif_text || null,
          mtime,
        });
        if (existing) updated++;
        else added++;
      }
      console.log(
        `[${col.name}] ${files.length} files, ${added} added, ${updated} updated, ${skipped} unchanged`,
      );
    }
  } finally {
    store.close();
  }
}

async function cmdEmbed(args: ParsedArgs): Promise<void> {
  const only = flagStr(args.flags.collection);
  const store = new Store();
  try {
    const allRows = store.listImages(only);
    const pending = allRows.filter((r) => !store.hasVector(r.hash));
    const skipped = allRows.length - pending.length;
    const total = pending.length;

    if (total === 0) {
      console.log(`${c.green}✓ All ${allRows.length} images already have embeddings.${c.reset}`);
      return;
    }

    console.log(`${c.dim}Embedding ${total} images (${skipped} already done)${c.reset}`);
    cursor.hide();
    progress.indeterminate();
    const t0 = Date.now();
    let done = 0;
    let errors = 0;
    for (const row of pending) {
      const abs = resolve(getCollection(row.collection)!.path, row.path);
      try {
        const v = await embedImage(abs);
        store.upsertVector(row.hash, v);
        done++;
      } catch (e) {
        errors++;
        if (isTTY) process.stderr.write("\r\x1b[K");
        console.error(`failed: ${abs}: ${(e as Error).message}`);
      }
      const completed = done + errors;
      const percent = (completed / total) * 100;
      progress.set(percent);
      const elapsed = (Date.now() - t0) / 1000;
      const rate = completed / elapsed;
      const etaSec = rate > 0 ? (total - completed) / rate : 0;
      const bar = renderProgressBar(percent);
      const percentStr = percent.toFixed(0).padStart(3);
      const eta = elapsed > 2 ? formatETA(etaSec) : "...";
      const errStr = errors > 0 ? ` ${c.yellow}${errors} err${c.reset}` : "";
      if (isTTY) {
        process.stderr.write(
          `\r${c.cyan}${bar}${c.reset} ${c.bold}${percentStr}%${c.reset} ${c.dim}${completed}/${total}${c.reset}${errStr} ${c.dim}${rate.toFixed(1)}/s ETA ${eta}${c.reset}   `,
        );
      }
    }
    progress.clear();
    cursor.show();
    if (isTTY) process.stderr.write("\n");
    console.log(
      `${c.green}✓ Done!${c.reset} Embedded ${c.bold}${done}${c.reset} images in ${c.bold}${formatETA((Date.now() - t0) / 1000)}${c.reset}` +
        (errors > 0 ? ` ${c.yellow}(${errors} failed)${c.reset}` : ""),
    );
  } finally {
    store.close();
  }
}

function cmdGet(args: ParsedArgs): void {
  const target = args.positional[0];
  if (!target) {
    console.error("usage: qimg get <path|#docid>");
    process.exit(2);
  }
  const store = new Store();
  try {
    // Try as a path first
    const all = store.listImages();
    const match = all.find(
      (r) => r.path === target || r.path.endsWith("/" + target) || `${r.collection}/${r.path}` === target,
    );
    if (!match) {
      console.error(`not found: ${target}`);
      process.exit(1);
    }
    console.log(JSON.stringify(match, null, 2));
  } finally {
    store.close();
  }
}

async function cmdSearch(args: ParsedArgs): Promise<void> {
  const query = args.positional.join(" ");
  if (!query) {
    console.error("usage: qimg search <query>");
    process.exit(2);
  }
  const store = new Store();
  try {
    const limit = flagNum(args.flags.n, 20);
    const collection = flagStr(args.flags.collection);
    const hits = store.searchFts(query, limit, collection);
    printHits(hits, !!args.flags.json);
  } finally {
    store.close();
  }
}

async function cmdVsearch(args: ParsedArgs): Promise<void> {
  const store = new Store();
  try {
    const limit = flagNum(args.flags.n, 20);
    const collection = flagStr(args.flags.collection);
    const imgPath = flagStr(args.flags.image);
    let embedding: Float32Array;
    if (imgPath) {
      embedding = await embedImage(resolve(imgPath));
    } else {
      const query = args.positional.join(" ");
      if (!query) {
        console.error("usage: qimg vsearch <query> | --image <path>");
        process.exit(2);
      }
      embedding = await embedText(query);
    }
    const hits = store.searchVec(embedding, limit, collection);
    printHits(hits, !!args.flags.json);
  } finally {
    store.close();
  }
}

async function cmdQuery(args: ParsedArgs): Promise<void> {
  const store = new Store();
  try {
    const limit = flagNum(args.flags.n, 20);
    const collection = flagStr(args.flags.collection);
    const imgPath = flagStr(args.flags.image);
    const query = args.positional.join(" ");

    let vecHits: SearchHit[] = [];
    let ftsHits: SearchHit[] = [];

    if (imgPath) {
      const v = await embedImage(resolve(imgPath));
      vecHits = store.searchVec(v, limit * 2, collection);
    } else {
      if (!query) {
        console.error("usage: qimg query <query> | --image <path>");
        process.exit(2);
      }
      ftsHits = store.searchFts(query, limit * 2, collection);
      const v = await embedText(query);
      vecHits = store.searchVec(v, limit * 2, collection);
    }

    const fused = store.hybridQuery(ftsHits, vecHits, limit);
    printHits(fused, !!args.flags.json);
  } finally {
    store.close();
  }
}

function cmdStatus(): void {
  const store = new Store();
  try {
    const s = store.status();
    const cols = listCollections();
    console.log(`config:      ${getConfigPath()}`);
    console.log(`collections: ${s.collections} (${cols.length} configured)`);
    console.log(`images:      ${s.images}`);
    console.log(`vectors:     ${s.vectors}`);
    for (const c of cols) {
      console.log(`  - ${c.name} → ${c.path}`);
    }
  } finally {
    store.close();
  }
}

async function cmdMcp(args: ParsedArgs): Promise<void> {
  const { startMcp } = await import("../mcp/server.js");
  await startMcp({
    http: !!args.flags.http,
    port: flagNum(args.flags.port, 8181),
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    cmdHelp();
    return;
  }
  const cmd = argv[0]!;
  const args = parseArgs(argv.slice(1));

  switch (cmd) {
    case "collection":
      cmdCollection(args);
      break;
    case "ls":
      cmdLs(args);
      break;
    case "update":
      await cmdUpdate(args);
      break;
    case "embed":
      await cmdEmbed(args);
      break;
    case "get":
      cmdGet(args);
      break;
    case "search":
      await cmdSearch(args);
      break;
    case "vsearch":
      await cmdVsearch(args);
      break;
    case "query":
      await cmdQuery(args);
      break;
    case "status":
      cmdStatus();
      break;
    case "mcp":
      await cmdMcp(args);
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      cmdHelp();
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
