# Embedding Pipeline

Command: `qimg embed [--collection <name>] [--force]`  
Entry point: `src/cli/qimg.ts` — `embed` command handler

Generates 768-dim SigLIP vector embeddings for indexed images and stores them in the `image_vectors` sqlite-vec table. Requires images to already be indexed (`qimg index`).

## Pipeline Steps

```
1. List images from store
2. Filter: skip already-embedded unless --force
3. For each pending image:
   a. Load image file
   b. Run SigLIP vision model (ONNX)
   c. L2 normalize output
   d. Store vector keyed by file hash
5. Report stats
```

## Model

**Model ID:** `onnx-community/siglip2-base-patch16-224-ONNX`  
**Runtime:** transformers.js (ONNX via `@huggingface/transformers`)  
**Dimensions:** 768 (`EMBED_DIM` constant in `src/embed.ts`)  
**Cache:** `~/.cache/huggingface` (downloaded on first run, ~200MB)

SigLIP 2 text and image encoders project into the **same 768-dim space**, enabling cross-modal search: a text query can retrieve images using the same index. SigLIP 2 improves text-to-image retrieval accuracy ~7% over SigLIP 1 (COCO I→T R@1: 65.1% → 69.7%).

**Note:** If upgrading from a prior SigLIP 1 index, run `qimg embed --force` to regenerate all vectors in the new embedding space.

## Key Functions — `src/embed.ts`

| Function | Input | Output | Notes |
|----------|-------|--------|-------|
| `embedImage(imagePath)` | file path | `Float32Array` (768) | Loads image, runs vision encoder, L2 normalizes |
| `embedText(text)` | string | `Float32Array` (768) | Tokenizes, runs text encoder, L2 normalizes |
| `float32ToBuffer(v)` | `Float32Array` | `Buffer` | Serialize for SQLite storage |
| `bufferToFloat32(buf)` | `Buffer` | `Float32Array` | Deserialize from SQLite |
| `EMBED_DIM` | — | `768` | Constant used in schema creation |

Both `embedImage` and `embedText` use a **lazy singleton** pattern: the transformers.js pipeline is initialized on first call and reused. This keeps non-embedding commands (index, search) fast since models are not loaded until needed.

L2 normalization is applied to all output vectors before storage, so cosine similarity reduces to a dot product.

## Storage

`src/store.ts:Store.upsertVector(hash, embedding)` writes to the `image_vectors` vec0 table:
```sql
image_vectors (
  hash TEXT PRIMARY KEY,
  embedding float[768] distance_metric=cosine
)
```

The vector is keyed by the file's **SHA1 hash** (not by row ID). This allows vectors to be shared across collections and survive image renames (hash stays stable).

Check existence: `Store.hasVector(hash)` — used to skip already-embedded images.

## `--force` Flag

Without `--force`: `Store.listImages()` is called, then filtered against `Store.hasVector()` for each hash.  
With `--force`: all images are re-embedded, overwriting existing vectors.

## Relevant Files

| File | Role |
|------|------|
| `src/embed.ts` | `embedImage()`, `embedText()`, serialization helpers, model singleton |
| `src/store.ts` | `Store.upsertVector()`, `Store.hasVector()`, `Store.listImages()` |
| `src/cli/qimg.ts` | `embed` command: filtering, progress bar, error handling |
