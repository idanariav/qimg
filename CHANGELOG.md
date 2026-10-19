# Changelog

## [Unreleased]

### Changed

- **Export format v2: vectors are split into chunk files.** `qimg export` now writes `vectors-0.bin`, `vectors-1.bin`, … (at most 4 MiB each, row-aligned) listed in a new manifest `files` field, instead of one `vectors.bin`, so each file stays under Obsidian Sync's 5 MB limit. Earlier `vectors.bin` files are removed on the next export. Readers should accept v1 and v2; see `docs/EXPORT.md`

## [0.4.0] - 2026-10-19

### Added
- **`qimg export [--out <dir>]`** — writes a portable `pkm-vectors` export (vault-relative image metadata, int8 SigLIP image vectors, a query-side word table) into a vault folder, so clients without qimg (the pkm-rag plugin on mobile) can run `tsearch`/`vsearch`/`hsearch`/`get`. Set `export.path` in `index.yml` to re-export after `index`, `embed`, `caption` and `ocr`. Lite `vsearch` matches the CLI's top-10 at 8–10/10 for single words and 5–8/10 for phrases. See `docs/EXPORT.md`
- **`embedTexts(texts)`** — batched SigLIP text embedding (identical results to `embedText`, which now delegates to it)

### Fixed
- `vsearch`/`hsearch` text queries (CLI and MCP) crashed with `RangeError: Invalid array length`: the SigLIP 2 tokenizer reports `model_max_length=1e30`, so `padding: "max_length"` now gets an explicit `max_length: 64`. Added a regression test (`test/embed.test.ts`)
- Bumped `vitest` (3.2.4 → 3.2.7) to resolve a critical arbitrary file read/execute vulnerability in the Vitest UI server ([GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp))
- Bumped `tsx` (4.21.0 → 4.23.1) to pull in `esbuild` 0.28.1, resolving a low-severity arbitrary file read in esbuild's dev server on Windows ([GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr))

## [0.3.1] - 2026-07-18

### Changed
- **`tsearch`/`hsearch` full-text matching**: `Store.searchFts()` now matches queries as an AND of individually-quoted terms instead of one exact adjacent phrase — e.g. `qimg tsearch "red sunset ocean"` now matches a caption like "sunset over the ocean, red sky". This improves recall for natural-language queries but is a behavior change if you relied on the old strict-phrase matching.
- `hashFile` now streams the file instead of reading it fully into memory before hashing

### Fixed
- Tesseract OCR language data is now stored in the config dir instead of the collection folder
- `vsearch`/`hsearch` vector search no longer silently under-returns results when a `--collection`/`--after`/`--before` filter prunes most of the initial candidate set — now escalates the search window until `limit` is satisfied or all vectors are exhausted
- `qimg get` and the MCP `get` tool no longer scan every indexed image into memory to resolve a single path lookup
- `qimg index` now populates `ImageRow.mime` from `sharp`'s detected format instead of always writing `null`
- `qimg embed`/`caption`/`ocr` now skip (with a clear message) rows whose collection was renamed/removed since indexing, instead of crashing mid-batch
- The `ocr_text` schema migration no longer silently swallows unexpected `ALTER TABLE` failures (e.g. disk full, corrupt schema) — only "column already exists" is treated as expected

## [0.3.0] - 2026-05-02

### Added
- `qimg ocr [--collection <n>] [--force]` — extract visible text from images via Tesseract.js; stored in new `ocr_text` column and indexed into FTS5 for keyword search
- `--after YYYY-MM-DD` / `--before YYYY-MM-DD` date filters on `tsearch`, `vsearch`, `hsearch` — restrict results to images with EXIF `taken_at` within the range
- `after` / `before` parameters on MCP `hsearch` tool (same semantics)
- `ocr` count in `qimg status` output

### Changed
- **Captioning model**: replaced `Xenova/vit-gpt2-image-captioning` with `HuggingFaceTB/SmolVLM-256M-Instruct` — significantly higher-quality captions via instruction-prompted VLM using the low-level `AutoModelForVision2Seq` API with chat template
- **Embedding model**: upgraded from `Xenova/siglip-base-patch16-224` (SigLIP 1) to `onnx-community/siglip2-base-patch16-224-ONNX` (SigLIP 2) — ~7% better text-to-image retrieval. **Run `qimg embed --force` after upgrading to regenerate vectors**
- FTS5 index now includes `ocr_text` alongside `path`, `filename`, `caption`, `exif_text`
- `Store.searchFts()` and `Store.searchVec()` now accept a `SearchFilters` object (`{ collection?, after?, before? }`) instead of a positional `collection?` string
- `Store.status()` return type extended with `ocr: number`
- Schema migration (user_version 0→1): adds `ocr_text` column, recreates FTS5 with new column, rebuilds FTS from existing data — runs automatically on first DB open

## [0.2.1] - 2026-04-25

### Fixed
- Replace `Xenova/blip-image-captioning-base` (now returns 401 on HuggingFace) with `Xenova/vit-gpt2-image-captioning`
- Skip npm publish if version already exists in registry
- GitHub release workflow improvements

## [0.2.0] - 2026-04-25

### Added
- LLM-powered image captioning for images without manual captions via `qimg caption` command
- Claude Code plugin marketplace support with configuration
- Documentation and setup simplification for marketplace integration

### Changed
- **Breaking**: Renamed `update` command to `index` for clarity
- Updated marketplace configuration and alignment with shared standards

### Fixed
- Sidecar resolver enhancements
- FTS5 table operations improvements
- SigLIP image embedding fixes

## [0.1.0] - 2026-04-11

Initial release.

### Features

- **Hybrid search** — Reciprocal Rank Fusion over BM25 (FTS5) and SigLIP 2 vector results via `hsearch`
- **Text search** — BM25 keyword search over filenames and sidecar captions via `tsearch`
- **Vector search** — Semantic text-to-image search via `vsearch` using SigLIP 2 embeddings (runs fully on-device via transformers.js / ONNX)
- **Image-similarity search** — Search by image instead of text with `vsearch --image <path>` or `hsearch --image <path>`
- **Sidecar captions** — Enrich images with human-written captions from paired markdown files (`parallel-tree` resolver for Obsidian-style vaults)
- **EXIF extraction** — Indexes EXIF metadata (date, GPS, camera model) automatically during `qimg index`
- **MCP server** — Exposes `hsearch`, `get`, and `status` tools over stdio transport for Claude Code and other MCP clients
- **Collection management** — Add, list, remove, and rename image collections with configurable glob masks
- **Config** — YAML config at `~/.config/qimg/index.yml`; override paths via `QIMG_CONFIG_DIR` / `QIMG_CACHE_DIR`
- **Cross-platform** — macOS (arm64/x64), Linux (arm64/x64), Windows (x64)
