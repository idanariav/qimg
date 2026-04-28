# Indexing Pipeline

Command: `qimg index [--collection <name>]`  
Entry point: `src/cli/qimg.ts` — `index` command handler

Scans the filesystem for images, extracts metadata, and upserts records into the SQLite store. Does **not** generate embeddings or AI captions (separate commands).

## Pipeline Steps

```
1. Load collection config
2. Discover image files (fast-glob)
3. For each file:
   a. Check if unchanged (skip if so)
   b. Hash file (SHA1)
   c. Extract EXIF metadata
   d. Extract image dimensions (sharp)
   e. Resolve sidecar caption (if configured)
   f. Upsert into store (images table + FTS reindex)
4. Report stats
```

## Step Details

### 1. Load Collection Config
`src/collections.ts:listCollections()` reads `~/.config/qimg/index.yml`.  
Returns `NamedCollection[]` with `path`, `pattern`, `ignore`, and optional `sidecar` config.

### 2. File Discovery
Uses `fast-glob` with the collection's `pattern` (e.g. `**/*.{jpg,jpeg,png,gif,webp,tiff}`) rooted at `collection.path`, with `ignore` globs applied.

### 3. Unchanged-File Detection
For each discovered file:
- Read `mtime` from filesystem
- Fetch existing `ImageRow` via `store.getByPath(collection, path)`
- If `row.mtime === fileMtime` AND (no sidecar OR `row.sidecar_mtime === sidecarMtime`) → **skip**

This avoids re-hashing and re-parsing files that haven't changed.

### 4. Hash File
`src/store.ts:hashFile(path)` — SHA1 of full file contents.  
Used as the vector table key and for cross-collection deduplication.

### 5. EXIF Extraction
`src/exif.ts:extractExif(imagePath)` — uses `exifr` with all parsers enabled (TIFF, EXIF, IPTC, XMP, GPS).

Returns `ExifData`:
- `taken_at` — from `DateTimeOriginal` or `CreateDate` (Unix ms)
- `camera` — `Make + " " + Model`
- `lens` — `LensModel` or `Lens`
- `gps_lat`, `gps_lon`
- `caption` — merged from `ImageDescription`, `Caption-Abstract`, `Description`, `title`
- `exif_text` — space-joined keywords + description fields, used for FTS indexing

Failures are silent; returns `{ exif_text: "" }` on error.

### 6. Image Dimensions
`sharp(imagePath).metadata()` — lazy import to avoid loading sharp unless needed.  
Extracts `width`, `height`, `mime` (format mapped to MIME type).

### 7. Sidecar Resolution
Only runs if collection has `sidecar` config.

`src/sidecar.ts:resolveSidecar(imagePath, collection.path, sidecar)` implements the **parallel-tree strategy**:
- Maps image subdirectory to a notes subdirectory (case-insensitive if configured)
- Looks for a `.md` file with the same stem as the image
- Reads frontmatter and extracts the configured `field` (e.g. `ImageText`)

```
Example mapping:
  Image:  /Visuals/claims/diagram.png
  Notes:  /Content/Claims/diagram.md
  Field:  ImageText: "description of diagram"
```

Per-run in-memory directory listing cache (`dirCache`) in `src/sidecar.ts` avoids repeated filesystem scans across files in the same folder. Cache is cleared between index runs via `clearSidecarCache()`.

### 8. Upsert
`src/store.ts:Store.upsertImage(row)` — INSERT OR REPLACE into `images` table.  
Automatically triggers FTS reindex for the row via `images_fts` content table.

Caption written is: `sidecar?.caption ?? exif?.caption ?? null`.  
`exif_text` is written for FTS keyword search.

## Relevant Files

| File | Role |
|------|------|
| `src/cli/qimg.ts` | `index` command: orchestrates the pipeline, progress reporting |
| `src/store.ts` | `hashFile()`, `fileMtime()`, `Store.upsertImage()`, `Store.getByPath()` |
| `src/exif.ts` | `extractExif()` — all metadata parsing |
| `src/sidecar.ts` | `resolveSidecar()`, `clearSidecarCache()` |
| `src/collections.ts` | `listCollections()`, `Collection` type |
