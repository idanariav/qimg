# Changelog

## [Unreleased]

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
