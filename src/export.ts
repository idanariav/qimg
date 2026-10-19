/**
 * Portable export ("pkm-vectors" v2, same layout as `qmd export` / `qvoid export`) so clients
 * without qimg installed — the pkm-rag plugin on mobile — can run tsearch/vsearch/hsearch/get.
 * See docs/EXPORT.md.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import type { NamedCollection } from "./collections.js";
import { bufferToFloat32, embedTexts, EMBED_DIM, SIGLIP_MODEL_ID } from "./embed.js";
import type { Store } from "./store.js";

export const EXPORT_FORMAT = "pkm-vectors";
export const EXPORT_VERSION = 2;
// Each vector file stays under Obsidian Sync's 5 MB per-file limit (Standard plan).
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const SCALE = 127;
const WORD_RE = /[a-z]{3,20}/g;
const TEXT_WORD_MIN_COUNT = 3;
const WORD_BATCH = 64;

/** One image, with what the CLI's search output and `get` show for it. */
export interface ExportImage {
  path: string;           // vault-relative
  file: string;           // collection-relative, as in `qimg <search> --json` "path"
  collection: string;
  hash: string;
  width: number | null;
  height: number | null;
  mime: string | null;
  taken_at: number | null;
  caption: string | null;
  exif_text: string | null;
  ocr_text: string | null;
  sidecar: string | null; // vault-relative sidecar note
}

export interface ExportManifest {
  format: string;
  version: number;
  tool: "qimg";
  model: string;
  dim: number;
  scale: number;
  exportedAt: string;
  files: string[];        // vector chunks, concatenated in this order
  images: ExportImage[];
  items: number[];        // vector row → index into images (images without a vector have no row)
  words: string[];        // rows after the items
}

/** Writes `bin` as row-aligned chunks `vectors-0.bin`, `vectors-1.bin`, … (each at most
 *  MAX_CHUNK_BYTES) and deletes vector files of earlier exports the new set doesn't include. */
export function writeVectorChunks(outDir: string, bin: Int8Array, dim: number): string[] {
  const chunkBytes = Math.max(1, Math.floor(MAX_CHUNK_BYTES / dim)) * dim;
  const files: string[] = [];
  for (let off = 0; off < bin.length || files.length === 0; off += chunkBytes) {
    const part = bin.subarray(off, Math.min(bin.length, off + chunkBytes));
    const name = `vectors-${files.length}.bin`;
    writeFileSync(join(outDir, name), Buffer.from(part.buffer, part.byteOffset, part.byteLength));
    files.push(name);
  }
  for (const f of readdirSync(outDir)) {
    if (/^vectors(-\d+)?\.bin$/.test(f) && !files.includes(f)) unlinkSync(join(outDir, f));
  }
  return files;
}

/** An export's vector bytes: v2's `files` chunks in order, or v1's single `vectors.bin`. */
export function readVectorBytes(outDir: string, manifest: { files?: string[] }): Buffer | null {
  const paths = (manifest.files ?? ["vectors.bin"]).map((f) => join(outDir, f));
  return paths.every((p) => existsSync(p)) ? Buffer.concat(paths.map((p) => readFileSync(p))) : null;
}

export type TextEmbedder = (texts: string[]) => Promise<Float32Array[]>;

export interface ExportResult {
  outDir: string;
  images: number;
  items: number;
  words: number;
  newlyEmbedded: number;
  bytes: number;
  skipped: number;
}

export function quantize(v: ArrayLike<number>): Int8Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = Math.round((v[i]! / norm) * SCALE);
  return out;
}

/** Nearest ancestor of `dir` that is an Obsidian vault (has `.obsidian/`). */
export function findVaultRoot(dir: string): string | null {
  let cur = resolve(dir);
  while (true) {
    if (existsSync(join(cur, ".obsidian"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** Common English words + every caption/filename word + words used at least TEXT_WORD_MIN_COUNT
 *  times across OCR text and the images' sidecar notes (so concept queries like "groupthink"
 *  have a vector even when no caption uses the word). */
export function wordList(curated: string[], counted: string[], commonWords: string[]): string[] {
  const words = new Set(commonWords);
  for (const t of curated) for (const w of t.toLowerCase().match(WORD_RE) ?? []) words.add(w);
  const counts = new Map<string, number>();
  for (const t of counted) for (const w of t.toLowerCase().match(WORD_RE) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  for (const [w, n] of counts) if (n >= TEXT_WORD_MIN_COUNT) words.add(w);
  return [...words].sort();
}

function readCommonWords(): string[] {
  return readFileSync(new URL("../assets/common-words.txt", import.meta.url), "utf-8")
    .split("\n").map((w) => w.trim()).filter(Boolean);
}

/** Word vectors from the previous export, reusable when the model and dim are unchanged. */
function previousWordVectors(outDir: string, model: string, dim: number): Map<string, Int8Array> {
  const prev = new Map<string, Int8Array>();
  const manifestPath = join(outDir, "manifest.json");
  if (!existsSync(manifestPath)) return prev;
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf-8")) as ExportManifest;
    if (m.format !== EXPORT_FORMAT || m.model !== model || m.dim !== dim) return prev;
    const bin = readVectorBytes(outDir, m);
    if (!bin) return prev;
    m.words.forEach((w, i) => {
      prev.set(w, new Int8Array(bin.buffer, bin.byteOffset + (m.items.length + i) * dim, dim));
    });
  } catch {
    // Unreadable previous export: re-embed everything.
  }
  return prev;
}

const toVault = (vaultRoot: string, abs: string): string | null => {
  const rel = relative(vaultRoot, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? null : rel.split(sep).join("/");
};

export async function exportIndex(
  store: Store,
  collections: NamedCollection[],
  outDir: string,
  opts: { embed?: TextEmbedder; commonWords?: string[]; readSidecar?: (absPath: string) => string | null } = {},
): Promise<ExportResult> {
  const vaultRoot = findVaultRoot(outDir);
  if (!vaultRoot) throw new Error(`Export directory is not inside an Obsidian vault (no .obsidian/ above ${resolve(outDir)})`);
  const embed = opts.embed ?? ((texts) => embedTexts(texts));
  const readSidecar = opts.readSidecar ?? ((p) => (existsSync(p) ? readFileSync(p, "utf-8") : null));
  const byName = new Map(collections.map((c) => [c.name, c]));

  // Images, vault-relative; those outside the vault (or in unknown collections) are skipped.
  const images: ExportImage[] = [];
  const sidecarTexts: string[] = [];
  let skipped = 0;
  for (const row of store.listImages()) {
    const col = byName.get(row.collection);
    const path = col ? toVault(vaultRoot, resolve(col.path, row.path)) : null;
    if (!path) { skipped++; continue; }
    const sidecarAbs = row.sidecar_path ? resolve(row.sidecar_path) : null;
    const sidecarText = sidecarAbs ? readSidecar(sidecarAbs) : null;
    if (sidecarText) sidecarTexts.push(sidecarText.split(/^%%$/m)[0]!); // drop drawing-data blocks
    images.push({
      path, file: row.path, collection: row.collection, hash: row.hash,
      width: row.width, height: row.height, mime: row.mime, taken_at: row.taken_at,
      caption: row.caption, exif_text: row.exif_text, ocr_text: row.ocr_text ?? null,
      sidecar: sidecarAbs ? toVault(vaultRoot, sidecarAbs) : null,
    });
  }

  // Items: image vectors as `qimg embed` stored them — no re-embedding.
  const vecByHash = new Map<string, Float32Array>();
  for (const v of store.db.prepare(`SELECT hash, embedding FROM image_vectors`).all() as { hash: string; embedding: Buffer }[]) {
    vecByHash.set(v.hash, bufferToFloat32(v.embedding));
  }
  const items: number[] = [];
  const itemVecs: Int8Array[] = [];
  images.forEach((img, i) => {
    const v = vecByHash.get(img.hash);
    if (v) { items.push(i); itemVecs.push(quantize(v)); }
  });

  // Words: query-side text vectors, so a typed query maps into SigLIP space without a model.
  const words = wordList(
    images.flatMap((img) => [img.file, img.caption ?? ""]),
    [...images.map((img) => img.ocr_text ?? ""), ...sidecarTexts],
    opts.commonWords ?? readCommonWords(),
  );
  const prev = previousWordVectors(outDir, SIGLIP_MODEL_ID, EMBED_DIM);
  const missing = words.filter((w) => !prev.has(w));
  const wordVecs = new Map(prev);
  for (let i = 0; i < missing.length; i += WORD_BATCH) {
    const batch = missing.slice(i, i + WORD_BATCH);
    (await embed(batch)).forEach((v, j) => wordVecs.set(batch[j]!, quantize(v)));
  }

  mkdirSync(outDir, { recursive: true });
  const bin = new Int8Array((itemVecs.length + words.length) * EMBED_DIM);
  itemVecs.forEach((v, i) => bin.set(v, i * EMBED_DIM));
  words.forEach((w, i) => bin.set(wordVecs.get(w)!, (itemVecs.length + i) * EMBED_DIM));
  const files = writeVectorChunks(outDir, bin, EMBED_DIM);
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT, version: EXPORT_VERSION, tool: "qimg", model: SIGLIP_MODEL_ID,
    dim: EMBED_DIM, scale: SCALE, exportedAt: new Date().toISOString(), files, images, items, words,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest));

  return {
    outDir, images: images.length, items: items.length, words: words.length,
    newlyEmbedded: missing.length, bytes: bin.length, skipped,
  };
}
