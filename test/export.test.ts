import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Store } from "../src/store.js";
import { EMBED_DIM } from "../src/embed.js";
import {
  exportIndex, quantize, readVectorBytes, wordList, writeVectorChunks, MAX_CHUNK_BYTES, type ExportManifest,
} from "../src/export.js";
import type { NamedCollection } from "../src/collections.js";

function unit(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return v;
}

let vault: string;
let embedCalls: string[][];
const fakeEmbed = async (texts: string[]) => {
  embedCalls.push(texts);
  return texts.map((t) => unit(t.length % EMBED_DIM));
};

function seed(store: Store, collection: string, path: string, hash: string, caption: string, sidecar: string | null): void {
  store.upsertImage({
    collection, path, hash, width: 10, height: 10, mime: "image/png", taken_at: null, camera: null,
    gps_lat: null, gps_lon: null, caption, sidecar_path: sidecar, sidecar_mtime: null, exif_text: null, mtime: 1,
  });
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "qimg-export-"));
  mkdirSync(join(vault, ".obsidian"));
  embedCalls = [];
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("quantize", () => {
  it("normalizes then scales to int8", () => {
    expect([...quantize([3, 4])]).toEqual([76, 102]);
  });
});

describe("wordList", () => {
  it("keeps every curated word and counted words used at least 3 times", () => {
    expect(wordList(["Red clock.png"], ["ladder ladder ladder", "rare"], ["the"])).toEqual(["clock", "ladder", "png", "red", "the"]);
  });
});

describe("exportIndex", () => {
  it("writes vault-relative images, vectors from the index, and word vectors", async () => {
    const store = new Store(":memory:");
    const cols: NamedCollection[] = [
      { name: "claims", path: join(vault, "Visuals/claims"), pattern: "**/*.png" },
      { name: "outside", path: join(tmpdir(), "elsewhere"), pattern: "**/*.png" },
    ];
    seed(store, "claims", "a clock.png", "h1", "a red clock", join(vault, "Content/A clock.md"));
    seed(store, "claims", "no vector.png", "h2", "a ladder", null);
    seed(store, "outside", "x.png", "h3", "skipped", null);
    store.upsertVector("h1", unit(3));

    const out = join(vault, "Scaffolding/Embeddings/qimg");
    const r = await exportIndex(store, cols, out, {
      embed: fakeEmbed, commonWords: ["the"], readSidecar: () => "groupthink groupthink groupthink\n%%\ndrawing drawing drawing",
    });
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf-8")) as ExportManifest;
    const bin = new Int8Array(readVectorBytes(out, m)!);

    expect(r.skipped).toBe(1);
    expect(m).toMatchObject({ format: "pkm-vectors", version: 2, tool: "qimg", dim: EMBED_DIM, scale: 127 });
    expect(m.files.length).toBeGreaterThan(0);
    expect(m.images.map((i) => i.path)).toEqual(["Visuals/claims/a clock.png", "Visuals/claims/no vector.png"]);
    expect(m.images[0]!.sidecar).toBe("Content/A clock.md");
    expect(m.items).toEqual([0]); // only the image with a vector gets a row
    expect(bin[3]).toBe(127);
    expect(m.words).toContain("groupthink"); // from the sidecar note
    expect(m.words).not.toContain("drawing"); // after the %% drawing-data line
    expect(bin.length).toBe((m.items.length + m.words.length) * EMBED_DIM);
    store.close();
  });

  it("reuses word vectors from the previous export", async () => {
    const store = new Store(":memory:");
    const cols: NamedCollection[] = [{ name: "claims", path: join(vault, "Visuals"), pattern: "**/*.png" }];
    seed(store, "claims", "a.png", "h1", "clock", null);
    const out = join(vault, "out");
    await exportIndex(store, cols, out, { embed: fakeEmbed, commonWords: ["the"] });
    embedCalls = [];
    const r = await exportIndex(store, cols, out, { embed: fakeEmbed, commonWords: ["the", "tree"] });
    expect(embedCalls).toEqual([["tree"]]);
    expect(r.newlyEmbedded).toBe(1);
    store.close();
  });

  it("refuses a directory outside any vault", async () => {
    const store = new Store(":memory:");
    const outside = mkdtempSync(join(tmpdir(), "qimg-novault-"));
    await expect(exportIndex(store, [], outside, { embed: fakeEmbed, commonWords: [] })).rejects.toThrow(/not inside an Obsidian vault/);
    rmSync(outside, { recursive: true, force: true });
    store.close();
  });
});

describe("vector chunks", () => {
  it("splits on row boundaries under the size limit and reads back identically", () => {
    const rows = Math.ceil((MAX_CHUNK_BYTES * 2.5) / EMBED_DIM);
    const bin = Int8Array.from({ length: rows * EMBED_DIM }, (_, i) => (i % 255) - 127);
    const files = writeVectorChunks(vault, bin, EMBED_DIM);
    expect(files).toHaveLength(3);
    for (const f of files) {
      const size = statSync(join(vault, f)).size;
      expect(size).toBeLessThanOrEqual(MAX_CHUNK_BYTES);
      expect(size % EMBED_DIM).toBe(0);
    }
    expect(Buffer.compare(readVectorBytes(vault, { files })!, Buffer.from(bin.buffer))).toBe(0);
  });

  it("removes the v1 vectors.bin and leftover chunks, and still reads v1 exports", () => {
    const dir = join(vault, "chunks");
    mkdirSync(dir);
    writeFileSync(join(dir, "vectors.bin"), Buffer.from([1, 2, 3]));
    expect([...readVectorBytes(dir, {})!]).toEqual([1, 2, 3]);
    writeFileSync(join(dir, "vectors-7.bin"), "old");
    expect(writeVectorChunks(dir, new Int8Array(8), 4)).toEqual(["vectors-0.bin"]);
    expect(readdirSync(dir)).toEqual(["vectors-0.bin"]);
  });
});
