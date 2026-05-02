# Changelog

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
