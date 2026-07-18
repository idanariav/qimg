/**
 * SQLite store for qimg.
 *
 * Tables:
 *   images          metadata + caption + ocr_text (one row per image)
 *   images_fts      FTS5 virtual table (BM25 over filename, caption, exif_text, ocr_text)
 *   image_vectors   sqlite-vec vec0 virtual table (768d SigLIP embeddings)
 *
 * Two-step query pattern: vec0 MATCH first by hash, JOIN to images second
 * (qmd discovered that inline joins with vec0 cause sqlite-vec to hang).
 *
 * Schema migrations are tracked via SQLite's built-in PRAGMA user_version.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync, statSync, createReadStream } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { EMBED_DIM, float32ToBuffer } from "./embed.js";

export interface ImageRow {
  id: number;
  collection: string;
  path: string;
  hash: string;
  width: number | null;
  height: number | null;
  mime: string | null;
  taken_at: number | null;
  camera: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  caption: string | null;
  sidecar_path: string | null;
  sidecar_mtime: number | null;
  exif_text: string | null;
  ocr_text?: string | null;
  mtime: number;
  indexed_at: number;
}

export interface SearchHit {
  id: number;
  path: string;
  collection: string;
  caption: string | null;
  sidecar_path: string | null;
  score: number;
}

/** Optional filters applied to all search methods. */
export interface SearchFilters {
  collection?: string;
  /** Unix ms — only return images taken on or after this timestamp. */
  after?: number;
  /** Unix ms — only return images taken on or before this timestamp. */
  before?: number;
}

export function getCacheDir(): string {
  if (process.env.QIMG_CACHE_DIR) return process.env.QIMG_CACHE_DIR;
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, "qimg");
  return join(homedir(), ".cache", "qimg");
}

export function getDefaultDbPath(): string {
  return join(getCacheDir(), "index.sqlite");
}

export function hashFile(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha1");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

export function fileMtime(path: string): number {
  return Math.floor(statSync(path).mtimeMs);
}

export class Store {
  db: Database.Database;

  constructor(dbPath: string = getDefaultDbPath()) {
    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    sqliteVec.load(this.db);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    // Base schema (idempotent — safe to run on fresh and existing DBs)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        mime TEXT,
        taken_at INTEGER,
        camera TEXT,
        gps_lat REAL,
        gps_lon REAL,
        caption TEXT,
        sidecar_path TEXT,
        sidecar_mtime INTEGER,
        exif_text TEXT,
        ocr_text TEXT,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        UNIQUE(collection, path)
      );

      CREATE INDEX IF NOT EXISTS idx_images_hash ON images(hash);
      CREATE INDEX IF NOT EXISTS idx_images_collection ON images(collection);
      CREATE INDEX IF NOT EXISTS idx_images_taken_at ON images(taken_at);
      CREATE INDEX IF NOT EXISTS idx_images_path ON images(path);
    `);

    // sqlite-vec table — created separately to control the dimension constant
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS image_vectors USING vec0(
        hash TEXT PRIMARY KEY,
        embedding float[${EMBED_DIM}] distance_metric=cosine
      );
    `);

    // Schema version migrations
    const version = this.db.pragma("user_version", { simple: true }) as number;

    if (version < 1) {
      // Add ocr_text to existing DBs that pre-date this column
      try {
        this.db.exec(`ALTER TABLE images ADD COLUMN ocr_text TEXT`);
      } catch (e) {
        // Column already exists (fresh install path from CREATE TABLE above) —
        // any other failure (disk full, locked file, corrupt schema) should stop
        // the migration rather than silently proceeding to drop/rebuild FTS.
        if (!/duplicate column name/i.test((e as Error).message)) throw e;
      }

      // Recreate FTS5 with ocr_text column. Drop first — FTS5 virtual tables
      // cannot be altered to add columns.
      this.db.exec(`DROP TABLE IF EXISTS images_fts`);
      this.db.exec(`
        CREATE VIRTUAL TABLE images_fts USING fts5(
          path,
          filename,
          caption,
          exif_text,
          ocr_text,
          content='',
          tokenize='porter unicode61'
        );
      `);

      // Rebuild FTS index from current images table data
      this.rebuildAllFts();

      this.db.pragma("user_version = 1");
    }
  }

  private rebuildAllFts(): void {
    const rows = this.db
      .prepare<[], { id: number; path: string; caption: string | null; exif_text: string | null; ocr_text: string | null }>(
        `SELECT id, path, caption, exif_text, ocr_text FROM images`,
      )
      .all();

    const stmt = this.db.prepare(
      `REPLACE INTO images_fts (rowid, path, filename, caption, exif_text, ocr_text) VALUES (?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      for (const row of rows) this.writeFtsRow(stmt, row.id, row);
    })();
  }

  /** Shared by `reindexFts` (single row) and `rebuildAllFts` (bulk, own prepared statement). */
  private writeFtsRow(
    stmt: Database.Statement,
    id: number,
    row: { path: string; caption: string | null; exif_text: string | null; ocr_text: string | null },
  ): void {
    const filename = row.path.split("/").pop() ?? "";
    stmt.run(id, row.path, filename, row.caption ?? "", row.exif_text ?? "", row.ocr_text ?? "");
  }

  getByPath(collection: string, path: string): ImageRow | null {
    const row = this.db
      .prepare<[string, string], ImageRow>(
        `SELECT * FROM images WHERE collection = ? AND path = ?`,
      )
      .get(collection, path);
    return row ?? null;
  }

  /**
   * Look up a single image by exact path, "collection/path", or a path suffix
   * (e.g. a bare filename). Matches without pulling the whole table into memory.
   */
  findByPath(target: string): ImageRow | null {
    const suffix = target.replace(/[\\%_]/g, "\\$&");
    const row = this.db
      .prepare<[string, string, string], ImageRow>(
        `SELECT * FROM images
         WHERE path = ?
            OR (collection || '/' || path) = ?
            OR path LIKE '%/' || ? ESCAPE '\\'
         LIMIT 1`,
      )
      .get(target, target, suffix);
    return row ?? null;
  }

  upsertImage(row: Omit<ImageRow, "id" | "indexed_at">): number {
    const indexed_at = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO images (
        collection, path, hash, width, height, mime, taken_at,
        camera, gps_lat, gps_lon, caption, sidecar_path, sidecar_mtime,
        exif_text, ocr_text, mtime, indexed_at
      ) VALUES (
        @collection, @path, @hash, @width, @height, @mime, @taken_at,
        @camera, @gps_lat, @gps_lon, @caption, @sidecar_path, @sidecar_mtime,
        @exif_text, @ocr_text, @mtime, @indexed_at
      )
      ON CONFLICT(collection, path) DO UPDATE SET
        hash=excluded.hash,
        width=excluded.width,
        height=excluded.height,
        mime=excluded.mime,
        taken_at=excluded.taken_at,
        camera=excluded.camera,
        gps_lat=excluded.gps_lat,
        gps_lon=excluded.gps_lon,
        caption=excluded.caption,
        sidecar_path=excluded.sidecar_path,
        sidecar_mtime=excluded.sidecar_mtime,
        exif_text=excluded.exif_text,
        mtime=excluded.mtime,
        indexed_at=excluded.indexed_at
      RETURNING id
    `);
    const result = stmt.get({ ocr_text: null, ...row, indexed_at }) as { id: number };
    this.reindexFts(result.id);
    return result.id;
  }

  private reindexFts(id: number): void {
    const row = this.db
      .prepare<[number], { path: string; caption: string | null; exif_text: string | null; ocr_text: string | null }>(
        `SELECT path, caption, exif_text, ocr_text FROM images WHERE id = ?`,
      )
      .get(id);
    if (!row) return;
    const stmt = this.db.prepare(
      `REPLACE INTO images_fts (rowid, path, filename, caption, exif_text, ocr_text) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.writeFtsRow(stmt, id, row);
  }

  deleteImage(collection: string, path: string): void {
    const row = this.getByPath(collection, path);
    if (!row) return;
    this.db.prepare(`DELETE FROM images WHERE id = ?`).run(row.id);
    this.db.prepare(`DELETE FROM images_fts WHERE rowid = ?`).run(row.id);
    this.db.prepare(`DELETE FROM image_vectors WHERE hash = ?`).run(row.hash);
  }

  upsertVector(hash: string, embedding: Float32Array): void {
    if (embedding.length !== EMBED_DIM) {
      throw new Error(`Embedding dim mismatch: got ${embedding.length}, expected ${EMBED_DIM}`);
    }
    this.db.prepare(`DELETE FROM image_vectors WHERE hash = ?`).run(hash);
    this.db
      .prepare(`INSERT INTO image_vectors (hash, embedding) VALUES (?, ?)`)
      .run(hash, float32ToBuffer(embedding));
  }

  hasVector(hash: string): boolean {
    const r = this.db
      .prepare<[string], { c: number }>(`SELECT COUNT(*) as c FROM image_vectors WHERE hash = ?`)
      .get(hash);
    return (r?.c ?? 0) > 0;
  }

  listImages(collection?: string): ImageRow[] {
    if (collection) {
      return this.db
        .prepare<[string], ImageRow>(`SELECT * FROM images WHERE collection = ? ORDER BY path`)
        .all(collection);
    }
    return this.db.prepare<[], ImageRow>(`SELECT * FROM images ORDER BY collection, path`).all();
  }

  listUncaptioned(collection?: string): ImageRow[] {
    if (collection) {
      return this.db
        .prepare<[string], ImageRow>(`SELECT * FROM images WHERE caption IS NULL AND collection = ? ORDER BY path`)
        .all(collection);
    }
    return this.db.prepare<[], ImageRow>(`SELECT * FROM images WHERE caption IS NULL ORDER BY collection, path`).all();
  }

  listWithoutOcr(collection?: string): ImageRow[] {
    if (collection) {
      return this.db
        .prepare<[string], ImageRow>(`SELECT * FROM images WHERE ocr_text IS NULL AND collection = ? ORDER BY path`)
        .all(collection);
    }
    return this.db.prepare<[], ImageRow>(`SELECT * FROM images WHERE ocr_text IS NULL ORDER BY collection, path`).all();
  }

  updateCaption(id: number, caption: string): void {
    this.db.prepare(`UPDATE images SET caption = ? WHERE id = ?`).run(caption, id);
    this.reindexFts(id);
  }

  updateOcr(id: number, ocrText: string): void {
    this.db.prepare(`UPDATE images SET ocr_text = ? WHERE id = ?`).run(ocrText, id);
    this.reindexFts(id);
  }

  status(): { collections: number; images: number; vectors: number; ocr: number } {
    const collections = this.db
      .prepare<[], { c: number }>(`SELECT COUNT(DISTINCT collection) as c FROM images`)
      .get()!.c;
    const images = this.db.prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM images`).get()!.c;
    const vectors = this.db
      .prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM image_vectors`)
      .get()!.c;
    const ocr = this.db
      .prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM images WHERE ocr_text IS NOT NULL`)
      .get()!.c;
    return { collections, images, vectors, ocr };
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /**
   * BM25 over images_fts. Returns hits sorted by relevance.
   *
   * Each query word is quoted and joined with FTS5's default AND operator, so all
   * terms must appear somewhere in the row (any order/position) rather than requiring
   * an exact adjacent phrase match — better recall for natural-language queries.
   */
  searchFts(query: string, limit: number = 20, filters?: SearchFilters): SearchHit[] {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const matchExpr = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");

    const conditions: string[] = [];
    const params: unknown[] = [matchExpr];

    if (filters?.collection) {
      conditions.push("i.collection = ?");
      params.push(filters.collection);
    }
    if (filters?.after != null) {
      conditions.push("i.taken_at >= ?");
      params.push(filters.after);
    }
    if (filters?.before != null) {
      conditions.push("i.taken_at <= ?");
      params.push(filters.before);
    }

    const where = conditions.length > 0 ? "AND " + conditions.join(" AND ") : "";
    const sql = `
      SELECT i.id, i.path, i.collection, i.caption, i.sidecar_path,
             -bm25(images_fts) as score
      FROM images_fts
      JOIN images i ON i.id = images_fts.rowid
      WHERE images_fts MATCH ?
      ${where}
      ORDER BY score DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as SearchHit[];
    const max = rows[0]?.score ?? 1;
    return rows.map((r) => ({ ...r, score: max > 0 ? r.score / max : 0 }));
  }

  /**
   * Cosine similarity over image_vectors. Two-step query: MATCH first by hash,
   * then JOIN to images.
   */
  searchVec(embedding: Float32Array, limit: number = 20, filters?: SearchFilters): SearchHit[] {
    const buf = float32ToBuffer(embedding);
    const hasFilters = !!(filters?.collection || filters?.after != null || filters?.before != null);
    const maxK = hasFilters ? this.vectorCount() : Infinity;

    let k = Math.min(limit * 4, maxK);
    let hits: SearchHit[] = [];
    while (k > 0) {
      const vecRows = this.matchVectors(buf, k);
      if (vecRows.length === 0) return [];
      hits = this.joinVecHits(vecRows, filters);
      // Only escalate when a filter may have pruned matches that vec0 didn't
      // return in this batch — i.e. more candidates exist beyond k.
      if (!hasFilters || hits.length >= limit || vecRows.length < k || k >= maxK) break;
      k = Math.min(k * 4, maxK);
    }
    return hits.slice(0, limit);
  }

  private vectorCount(): number {
    return this.db.prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM image_vectors`).get()!.c;
  }

  /** Step 1: pure vec0 query — no joins. */
  private matchVectors(buf: Buffer, k: number): Array<{ hash: string; distance: number }> {
    return this.db
      .prepare<[Buffer, number], { hash: string; distance: number }>(
        `SELECT hash, distance FROM image_vectors
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(buf, k);
  }

  /** Step 2: join vec0 matches to `images` by hash, applying filters. */
  private joinVecHits(
    vecRows: Array<{ hash: string; distance: number }>,
    filters?: SearchFilters,
  ): SearchHit[] {
    const placeholders = vecRows.map(() => "?").join(",");
    const conditions: string[] = [`hash IN (${placeholders})`];
    const params: unknown[] = vecRows.map((r) => r.hash);

    if (filters?.collection) {
      conditions.push("collection = ?");
      params.push(filters.collection);
    }
    if (filters?.after != null) {
      conditions.push("taken_at >= ?");
      params.push(filters.after);
    }
    if (filters?.before != null) {
      conditions.push("taken_at <= ?");
      params.push(filters.before);
    }

    const sql = `SELECT id, path, collection, caption, sidecar_path, hash
                 FROM images WHERE ${conditions.join(" AND ")}`;
    const imgRows = this.db.prepare(sql).all(...params) as Array<
      Omit<SearchHit, "score"> & { hash: string }
    >;

    const distByHash = new Map(vecRows.map((r) => [r.hash, r.distance]));
    return imgRows
      .map((r) => ({
        id: r.id,
        path: r.path,
        collection: r.collection,
        caption: r.caption,
        sidecar_path: r.sidecar_path,
        score: 1 - (distByHash.get(r.hash) ?? 1),
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Reciprocal Rank Fusion of FTS + vector results.
   */
  hybridQuery(
    ftsHits: SearchHit[],
    vecHits: SearchHit[],
    limit: number = 20,
    k: number = 60,
  ): SearchHit[] {
    const scores = new Map<number, { hit: SearchHit; score: number }>();
    const add = (hits: SearchHit[]) => {
      hits.forEach((hit, rank) => {
        const rrf = 1 / (k + rank + 1);
        const existing = scores.get(hit.id);
        if (existing) existing.score += rrf;
        else scores.set(hit.id, { hit, score: rrf });
      });
    };
    add(ftsHits);
    add(vecHits);
    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ hit, score }) => ({ ...hit, score }));
  }
}
