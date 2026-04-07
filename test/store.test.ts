import { describe, it, expect } from "vitest";
import { Store } from "../src/store.js";
import { EMBED_DIM } from "../src/embed.js";

function randVec(): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  let s = 0;
  for (let i = 0; i < EMBED_DIM; i++) {
    v[i] = Math.random() - 0.5;
    s += v[i]! * v[i]!;
  }
  const n = Math.sqrt(s);
  for (let i = 0; i < EMBED_DIM; i++) v[i] = v[i]! / n;
  return v;
}

describe("Store", () => {
  it("upserts and lists images, populates FTS", () => {
    const store = new Store(":memory:");
    store.upsertImage({
      collection: "test",
      path: "a/b/foo.png",
      hash: "h1",
      width: 100,
      height: 100,
      mime: null,
      taken_at: null,
      camera: null,
      gps_lat: null,
      gps_lon: null,
      caption: "a red sunset over the ocean",
      sidecar_path: null,
      sidecar_mtime: null,
      exif_text: null,
      mtime: 1,
    });
    const rows = store.listImages("test");
    expect(rows.length).toBe(1);
    expect(rows[0]!.caption).toContain("sunset");

    const hits = store.searchFts("sunset");
    expect(hits.length).toBe(1);
    expect(hits[0]!.path).toBe("a/b/foo.png");
    store.close();
  });

  it("upserts and searches vectors", () => {
    const store = new Store(":memory:");
    const v1 = randVec();
    store.upsertImage({
      collection: "t",
      path: "x.png",
      hash: "hx",
      width: null,
      height: null,
      mime: null,
      taken_at: null,
      camera: null,
      gps_lat: null,
      gps_lon: null,
      caption: null,
      sidecar_path: null,
      sidecar_mtime: null,
      exif_text: null,
      mtime: 1,
    });
    store.upsertVector("hx", v1);
    expect(store.hasVector("hx")).toBe(true);
    const hits = store.searchVec(v1, 5);
    expect(hits.length).toBe(1);
    expect(hits[0]!.score).toBeGreaterThan(0.99);
    store.close();
  });

  it("RRF fuses fts and vec hits", () => {
    const store = new Store(":memory:");
    const ftsHits = [
      { id: 1, path: "a", collection: "c", caption: null, sidecar_path: null, score: 0.9 },
      { id: 2, path: "b", collection: "c", caption: null, sidecar_path: null, score: 0.5 },
    ];
    const vecHits = [
      { id: 2, path: "b", collection: "c", caption: null, sidecar_path: null, score: 0.8 },
      { id: 3, path: "c", collection: "c", caption: null, sidecar_path: null, score: 0.6 },
    ];
    const fused = store.hybridQuery(ftsHits, vecHits, 10);
    expect(fused[0]!.id).toBe(2); // appears in both lists
    store.close();
  });
});
