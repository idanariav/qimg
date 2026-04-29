# Search Modes

qimg provides three search commands backed by two indexes (FTS5 and sqlite-vec) and a fusion layer.

| Command | Mode | Entry |
|---------|------|-------|
| `qimg tsearch <query>` | Full-text (BM25) | `src/cli/qimg.ts` → `Store.searchFts()` |
| `qimg vsearch <query\|--image>` | Vector (cosine) | `src/cli/qimg.ts` → `embedText/embedImage` → `Store.searchVec()` |
| `qimg hsearch <query\|--image>` | Hybrid (RRF) | `src/cli/qimg.ts` → both above → `Store.hybridQuery()` |

All search functions are in `src/store.ts`. All return `SearchHit[]`.

---

## 1. Full-Text Search (tsearch)

**Function:** `Store.searchFts(query, limit, filters?)`

Queries the FTS5 virtual table `images_fts`:
```sql
SELECT rowid, rank FROM images_fts
JOIN images i ON i.id = images_fts.rowid
WHERE images_fts MATCH ?
  [AND i.collection = ?]  [AND i.taken_at >= ?]  [AND i.taken_at <= ?]
ORDER BY score DESC LIMIT ?
```

FTS5 config:
- **Tokenizer:** `porter unicode61` (stemming + Unicode normalization)
- **Indexed columns:** `path`, `filename`, `caption`, `exif_text`, `ocr_text`
- Scores are normalized to `[0..1]` by dividing by the top result's rank

**Use case:** Keyword search over filenames, captions, EXIF keywords, and OCR-extracted text.

---

## 2. Vector Search (vsearch)

**Functions:** `embedText(query)` or `embedImage(imagePath)` → `Store.searchVec(embedding, limit, filters?)`

Both text and image queries produce a 768-dim Float32Array in SigLIP 2's shared embedding space (see [EMBEDDING.md](EMBEDDING.md)).

`searchVec` uses a **two-step query** (workaround for sqlite-vec inline JOIN hang):

```sql
-- Step 1: get candidate hashes from vec0 table
SELECT hash, distance FROM image_vectors
WHERE embedding MATCH ? AND k = ?

-- Step 2: join to images table, apply filters
SELECT ... FROM images WHERE hash IN (...)
  [AND collection = ?]  [AND taken_at >= ?]  [AND taken_at <= ?]
```

Score: `1 - distance` (cosine distance → similarity, range `[0..1]`).

**Use case:** Semantic search — find images by meaning, not just keywords. Also supports visual similarity search (`--image` flag).

---

## 3. Hybrid Search (hsearch)

**Functions:** `Store.searchFts()` + `Store.searchVec()` → `Store.hybridQuery(ftsHits, vecHits, limit, k?)`

Runs both FTS and vector search **in parallel** at `2× limit`, then fuses results.

### RRF Fusion Algorithm (`Store.hybridQuery`)

Reciprocal Rank Fusion combines ranked lists without manual weight tuning:

```
rrf(rank) = 1 / (k + rank + 1)    default k = 60
```

Steps:
1. Assign RRF scores to each hit based on its rank in the FTS list and vector list
2. For images appearing in both lists, **sum** the two RRF scores
3. Re-rank all images by combined RRF score (descending)
4. Return top `limit` results

Images appearing in both lists are rewarded with higher combined scores, surfacing results that are both keyword-relevant and semantically similar.

### Image Query Mode

When `--image <path>` is provided:
- Only vector search runs (no FTS query makes sense for image input)
- Results ranked by cosine similarity only

---

## CLI Flags (all search commands)

| Flag | Effect |
|------|--------|
| `--collection <name>` | Restrict search to one collection |
| `--after YYYY-MM-DD` | Only return images taken on or after this date |
| `--before YYYY-MM-DD` | Only return images taken on or before this date |
| `-n <num>` | Max results (default 20) |
| `--json` | Output results as JSON array |
| `--image <path>` | Use image as query (vsearch/hsearch only) |

Date filters apply to the `taken_at` field (EXIF DateTimeOriginal). Images without EXIF dates are excluded when a date filter is active.

---

## MCP `hsearch` Tool

`src/mcp/server.ts` exposes a `hsearch` MCP tool that runs identical hybrid search logic:
- `query` (string) OR `image_path` (string)
- `limit` (default 20), `collection` (optional)
- `after` (YYYY-MM-DD, optional), `before` (YYYY-MM-DD, optional)
- Returns `SearchHit[]` serialized as JSON

---

## Relevant Files

| File | Role |
|------|------|
| `src/store.ts` | `Store.searchFts()`, `Store.searchVec()`, `Store.hybridQuery()` |
| `src/embed.ts` | `embedText()`, `embedImage()` — query embedding for vsearch/hsearch |
| `src/cli/qimg.ts` | `tsearch`, `vsearch`, `hsearch` command handlers |
| `src/mcp/server.ts` | MCP `hsearch` tool implementation |
