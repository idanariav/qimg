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
import { existsSync, mkdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { readFileSync } from "fs";
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

export function hashFile(path: string): string {
  return createHash("sha1").update(readFileSync(path)).digest("hex");
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
      } catch {
        // Column already exists (fresh install path from CREATE TABLE above)
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
      for (const row of rows) {
        const filename = row.path.split("/").pop() ?? "";
        stmt.run(row.id, row.path, filename, row.caption ?? "", row.exif_text ?? "", row.ocr_text ?? "");
      }
    })();
  }

  getByPath(collection: string, path: string): ImageRow | null {
    const row = this.db
      .prepare<[string, string], ImageRow>(
        `SELECT * FROM images WHERE collection = ? AND path = ?`,
      )
      .get(collection, path);
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
      .prepare<[number], { rowid: number; path: string; caption: string | null; exif_text: string | null; ocr_text: string | null }>(
        `SELECT id as rowid, path, caption, exif_text, ocr_text FROM images WHERE id = ?`,
      )
      .get(id);
    if (!row) return;
    const filename = row.path.split("/").pop() ?? "";
    this.db
      .prepare(
        `REPLACE INTO images_fts (rowid, path, filename, caption, exif_text, ocr_text) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, row.path, filename, row.caption ?? "", row.exif_text ?? "", row.ocr_text ?? "");
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
   */
  searchFts(query: string, limit: number = 20, filters?: SearchFilters): SearchHit[] {
    if (!query.trim()) return [];
    const safe = query.replace(/"/g, '""');
    const matchExpr = `"${safe}"`;

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
    // Step 1: pure vec0 query — no joins
    const vecRows = this.db
      .prepare<[Buffer, number], { hash: string; distance: number }>(
        `SELECT hash, distance FROM image_vectors
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(buf, limit * 4); // overfetch to allow filter narrowing

    if (vecRows.length === 0) return [];

    // Step 2: join via hash, apply filters
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
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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
