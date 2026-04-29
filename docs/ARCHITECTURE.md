# qimg Architecture

qimg is a local, offline hybrid image search system. It indexes images into a SQLite database with full-text search (FTS5/BM25) over captions and metadata, and vector search (768-dim SigLIP embeddings via sqlite-vec). Searches can combine both signals via Reciprocal Rank Fusion (RRF). It exposes a CLI and an MCP server for agent integration.

## File Map

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/cli/qimg.ts` | CLI entry point and command dispatch | All commands |
| `src/store.ts` | SQLite persistence, FTS, vector search, RRF | `Store`, `ImageRow`, `SearchHit`, `SearchFilters`, `hashFile`, `fileMtime` |
| `src/embed.ts` | SigLIP 2 text/image embeddings (ONNX) | `embedText`, `embedImage`, `EMBED_DIM`, `float32ToBuffer`, `bufferToFloat32` |
| `src/caption.ts` | SmolVLM-256M AI captions (ONNX) | `generateCaption` |
| `src/ocr.ts` | Tesseract.js OCR text extraction | `extractOcrText`, `terminateOcrWorker` |
| `src/sidecar.ts` | Resolve captions from paired markdown files | `resolveSidecar`, `clearSidecarCache`, `SidecarResult` |
| `src/exif.ts` | EXIF/IPTC/XMP metadata extraction | `extractExif`, `ExifData` |
| `src/collections.ts` | YAML config management for collections | `Collection`, `addCollection`, `listCollections`, `loadConfig`, `saveConfig` |
| `src/mcp/server.ts` | MCP server (stdio) — thin wrapper over Store | `startMcp` |
| `src/index.ts` | Public API barrel export | re-exports all modules |

## Data Flow by Command

```
qimg index
  └─ fast-glob (file discovery)
  └─ src/exif.ts:extractExif()
  └─ src/sidecar.ts:resolveSidecar()
  └─ sharp (dimensions)
  └─ src/store.ts:Store.upsertImage()
       └─ images table + images_fts (FTS5)

qimg embed
  └─ src/store.ts:Store.listImages() [filter: no vector]
  └─ src/embed.ts:embedImage()
       └─ onnx-community/siglip2-base-patch16-224-ONNX
  └─ src/store.ts:Store.upsertVector()
       └─ image_vectors (vec0)

qimg caption
  └─ src/store.ts:Store.listUncaptioned()
  └─ src/caption.ts:generateCaption()
       └─ HuggingFaceTB/SmolVLM-256M-Instruct (ONNX, chat-template API)
  └─ src/store.ts:Store.updateCaption()
       └─ images table + FTS reindex

qimg ocr
  └─ src/store.ts:Store.listWithoutOcr()
  └─ src/ocr.ts:extractOcrText()
       └─ tesseract.js (eng language model)
  └─ src/store.ts:Store.updateOcr()
       └─ images table + FTS reindex

qimg tsearch / vsearch / hsearch
  └─ src/store.ts:Store.searchFts()      (BM25)
  └─ src/embed.ts:embedText/embedImage() → Store.searchVec()  (cosine)
  └─ src/store.ts:Store.hybridQuery()    (RRF fusion)

qimg mcp
  └─ src/mcp/server.ts (stdio MCP)
       └─ hsearch / get / status → src/store.ts
```

## Key Data Types

```typescript
// src/store.ts
ImageRow {
  id: number, collection: string, path: string, hash: string,
  width?, height?, mime?,
  taken_at?, camera?, gps_lat?, gps_lon?,   // EXIF
  caption?, sidecar_path?, sidecar_mtime?,
  exif_text?,                                // FTS search target
  ocr_text?,                                 // OCR-extracted text (FTS search target)
  mtime: number, indexed_at: number
}

SearchHit {
  id: number, path: string, collection: string,
  caption: string | null, sidecar_path: string | null,
  score: number   // [0..1] normalized
}

// src/collections.ts
Collection {
  path: string,           // folder root to scan
  pattern: string,        // glob filter (e.g. "**/*.{jpg,png}")
  ignore?: string[],
  sidecar?: SidecarConfig
}

SidecarConfig {           // src/sidecar.ts
  strategy: "parallel-tree",
  notes_root: string,     // root of markdown tree
  case_insensitive?: boolean,
  field: string           // frontmatter key to read
}

ExifData {                // src/exif.ts
  taken_at?, camera?, lens?, gps_lat?, gps_lon?,
  caption?,
  exif_text: string       // flattened keywords + description for FTS
}
```

## Key Design Decisions

| Decision | Reason |
|----------|--------|
| Two-step vector query in `searchVec()` | Inline JOIN with sqlite-vec `vec0` tables causes a hang; workaround fetches candidates first, then JOINs via hash |
| RRF fusion for hybrid search | Combines BM25 ranks + cosine ranks without manual weight tuning |
| Lazy model loading in `embed.ts` and `caption.ts` | Keeps non-embedding commands (index, search) fast; models load only when needed |
| SHA1 hash-based deduplication | File hash is stable across renames; vectors are keyed by hash, not row ID |
| SigLIP text + image in same 768d space | Enables cross-modal search (text query → image results) without separate indexes |

## MCP Server

Entry: `src/mcp/server.ts` — run via `qimg mcp` (stdio transport).

Three tools exposed:

| Tool | Inputs | Returns |
|------|--------|---------|
| `hsearch` | `query` (string) OR `image_path` (string), `limit` (default 20), `collection` (optional), `after`/`before` (YYYY-MM-DD, optional) | `SearchHit[]` as JSON |
| `get` | `path` (relative or `collection/path`) | `ImageRow` as JSON or "not found" |
| `status` | — | `{collections, images, vectors, ocr}` counts |

The MCP `hsearch` tool runs identical logic to the CLI `hsearch` command: parallel FTS + vector search at 2× limit, fused via `hybridQuery()`.

## Config & Storage Paths

| Resource | Default Path | Override Env Var |
|----------|-------------|-----------------|
| Config YAML | `~/.config/qimg/index.yml` | `QIMG_CONFIG_DIR` |
| SQLite DB | `~/.cache/qimg/index.sqlite` | `QIMG_CACHE_DIR` |
| Model cache | `~/.cache/huggingface` | transformers.js default |
