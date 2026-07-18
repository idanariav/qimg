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

  it("searchFts matches all query terms regardless of order/adjacency (AND, not phrase)", () => {
    const store = new Store(":memory:");
    store.upsertImage({
      collection: "test",
      path: "sunset.png",
      hash: "h2",
      width: null,
      height: null,
      mime: null,
      taken_at: null,
      camera: null,
      gps_lat: null,
      gps_lon: null,
      caption: "sunset over the ocean, red sky",
      sidecar_path: null,
      sidecar_mtime: null,
      exif_text: null,
      mtime: 1,
    });
    // Words appear in the caption but not adjacent/in this order — would fail a
    // strict phrase match, should succeed with AND-of-terms.
    const hits = store.searchFts("red sunset ocean");
    expect(hits.length).toBe(1);
    expect(hits[0]!.path).toBe("sunset.png");

    // A term that isn't present at all should still exclude the row.
    expect(store.searchFts("red sunset mountain").length).toBe(0);
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

  it("searchVec escalates overfetch when a filter prunes the initial k below limit", () => {
    const store = new Store(":memory:");
    const query = new Float32Array(EMBED_DIM);
    query[0] = 1;

    // 50 "noise" vectors, all near the query direction, in a different collection
    for (let i = 0; i < 50; i++) {
      const v = new Float32Array(EMBED_DIM);
      v[0] = 1;
      v[1] = (i + 1) * 1e-6;
      store.upsertImage({
        collection: "noise",
        path: `n${i}.png`,
        hash: `n${i}`,
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
      store.upsertVector(`n${i}`, v);
    }

    // 2 "target" vectors pointing the opposite direction — maximally distant from
    // the query, so a naive limit*4 overfetch (8) won't reach them among 50 closer
    // noise vectors.
    for (let i = 0; i < 2; i++) {
      const v = new Float32Array(EMBED_DIM);
      v[0] = -1;
      store.upsertImage({
        collection: "target",
        path: `t${i}.png`,
        hash: `t${i}`,
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
      store.upsertVector(`t${i}`, v);
    }

    const hits = store.searchVec(query, 2, { collection: "target" });
    expect(hits.length).toBe(2);
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
