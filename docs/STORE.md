# Store — SQLite Persistence Layer

File: `src/store.ts`

The `Store` class is the central data layer. It manages the SQLite database (via `better-sqlite3`), runs migrations, and implements all read/write operations including FTS and vector search.

## Database Schema

### `images` table

Primary storage for indexed image metadata.

```sql
CREATE TABLE images (
  id          INTEGER PRIMARY KEY,
  collection  TEXT NOT NULL,
  path        TEXT NOT NULL,           -- relative to collection root
  hash        TEXT NOT NULL,           -- SHA1 of file contents
  width       INTEGER,
  height      INTEGER,
  mime        TEXT,
  taken_at    INTEGER,                 -- Unix ms (from EXIF DateTimeOriginal)
  camera      TEXT,                    -- "Make Model"
  gps_lat     REAL,
  gps_lon     REAL,
  caption     TEXT,                    -- from EXIF, sidecar, or AI captioning
  sidecar_path TEXT,
  sidecar_mtime INTEGER,
  exif_text   TEXT,                    -- flattened keywords for FTS
  ocr_text    TEXT,                    -- text extracted from image via OCR
  mtime       INTEGER NOT NULL,        -- file modification time (ms)
  indexed_at  INTEGER NOT NULL,        -- Unix ms timestamp
  UNIQUE(collection, path)
)
```

Indexes: `idx_images_hash`, `idx_images_collection`, `idx_images_taken_at`.

### `images_fts` — FTS5 virtual table

Contentless FTS5 table (stores its own inverted index):

```sql
CREATE VIRTUAL TABLE images_fts USING fts5(
  path, filename, caption, exif_text, ocr_text,
  content='',
  tokenize='porter unicode61'
)
```

- `porter` stemming (run/runs/running → run)
- `unicode61` normalization (handles accents, case)
- Reindexed on every `upsertImage()`, `updateCaption()`, and `updateOcr()` call via `REPLACE INTO`

### `image_vectors` — sqlite-vec vec0 table

```sql
CREATE VIRTUAL TABLE image_vectors USING vec0(
  hash TEXT PRIMARY KEY,
  embedding float[768] distance_metric=cosine
)
```

- 768-dim float vectors (SigLIP 2 embeddings)
- Keyed by file hash (not row ID) — stable across renames and cross-collection dedup
- Cosine distance metric (sqlite-vec computes 1 - cosine_similarity internally)

## Store Class

**Constructor:** `new Store(dbPath?)` — defaults to `getDefaultDbPath()`.  
Opens or creates the SQLite DB, loads the sqlite-vec extension, enables WAL mode, and runs `migrate()`.

### Write Methods

| Method | Description |
|--------|-------------|
| `upsertImage(row)` | INSERT OR REPLACE into `images`; triggers FTS reindex |
| `upsertVector(hash, Float32Array)` | INSERT OR REPLACE into `image_vectors` |
| `updateCaption(id, caption)` | UPDATE `images.caption`; triggers FTS reindex for the row |
| `updateOcr(id, ocrText)` | UPDATE `images.ocr_text`; triggers FTS reindex for the row |
| `deleteImage(collection, path)` | DELETE from `images`, `images_fts`, and `image_vectors` |

### Read Methods

| Method | Returns | Notes |
|--------|---------|-------|
| `getByPath(collection, path)` | `ImageRow \| null` | Exact lookup |
| `listImages(collection?)` | `ImageRow[]` | All images, optionally filtered |
| `listUncaptioned(collection?)` | `ImageRow[]` | WHERE caption IS NULL |
| `listWithoutOcr(collection?)` | `ImageRow[]` | WHERE ocr_text IS NULL |
| `hasVector(hash)` | `boolean` | Check if embedding exists |
| `status()` | `{collections, images, vectors, ocr}` | Aggregate counts |

### Search Methods

| Method | Description |
|--------|-------------|
| `searchFts(query, limit, filters?)` | BM25 over `images_fts`; returns normalized `SearchHit[]` |
| `searchVec(embedding, limit, filters?)` | Two-step cosine search; returns `SearchHit[]` sorted by `1 - distance` |
| `hybridQuery(ftsHits, vecHits, limit, k?)` | RRF fusion of two hit lists; default k=60 |

`SearchFilters` (optional on all search methods):
```typescript
{ collection?: string; after?: number; before?: number }
// after/before are Unix ms timestamps from taken_at
```

## Two-Step Vector Query Pattern

`searchVec` cannot use an inline JOIN with the `vec0` table — this causes sqlite-vec to hang. The workaround:

```typescript
// Step 1: fetch candidate hashes from vec0 only
const candidates = db.prepare(
  `SELECT hash, distance FROM image_vectors WHERE embedding MATCH ? AND k = ?`
).all(serialize(embedding), limit * 4);

// Step 2: join to images table separately
const placeholders = candidates.map(() => '?').join(',');
const rows = db.prepare(
  `SELECT ... FROM images WHERE hash IN (${placeholders}) ${collectionFilter}`
).all(...hashes);
```

The oversample factor (`k * 4`) compensates for post-filter collection narrowing.

## Utility Exports

| Export | Description |
|--------|-------------|
| `hashFile(path)` | SHA1 of full file contents (returns hex string) |
| `fileMtime(path)` | File modification time in milliseconds |
| `getDefaultDbPath()` | `~/.cache/qimg/index.sqlite` (or `$QIMG_CACHE_DIR/index.sqlite`) |

## Dependencies

- `better-sqlite3` — synchronous SQLite driver (no async/await needed)
- `sqlite-vec` — loaded as a native extension via `db.loadExtension()`
- WAL journal mode enabled for concurrent read access
