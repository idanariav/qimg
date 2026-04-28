# qimg

Local, offline hybrid image search — indexes images into SQLite with BM25 full-text search and SigLIP vector embeddings, with an MCP server for Claude integration.

## General instructions

When refactoring commands (renaming, adding/removing params) — review CLAUDE.md, relevant docs, and README.md to ensure no stale references remain.

## Commands

```sh
qimg collection add <path> --name <n> [--mask <glob>] [--sidecar-notes <dir>] [--sidecar-field <name>]
qimg collection list
qimg collection remove <name>
qimg collection rename <old> <new>

qimg index [--collection <n>]              # Scan filesystem, hash files, extract EXIF + sidecar captions
qimg embed [--collection <n>] [--force]    # Generate SigLIP vector embeddings
qimg caption [--collection <n>] [--force]  # Generate AI captions for un-captioned images

qimg tsearch <query> [--collection <n>] [-n <num>] [--json]
qimg vsearch <query> [--image <path>] [--collection <n>] [-n <num>] [--json]
qimg hsearch <query> [--image <path>] [--collection <n>] [-n <num>] [--json]

qimg get <path|#docid> [--collection <n>]
qimg status
qimg mcp                                   # Start MCP server (stdio)
```

## Development

```sh
npm run build   # Compile TypeScript → dist/
npm test        # Run test suite (vitest)
```

Run from source during development (no build needed):

```sh
npx tsx src/cli/qimg.ts <command>
```

## Important: Do NOT run automatically

- Never run `qimg index`, `qimg embed`, or `qimg caption` automatically — these modify user data and may download large models
- Write out example commands for the user to run manually

## Do NOT compile unnecessarily

Use `npx tsx src/cli/qimg.ts` during development. Only run `npm run build` when testing the compiled output or preparing a release.

## Releasing

Use `/npm-release` to cut a release.

- Add changelog entries under `## [Unreleased]` **as you make changes**
- The release script renames `[Unreleased]` → `[X.Y.Z] - date` at release time

## Config & Cache

- Config: `~/.config/qimg/index.yml` (override with `QIMG_CONFIG_DIR`)
- Cache/DB: `~/.cache/qimg/index.sqlite` (override with `QIMG_CACHE_DIR`)

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module map, data flow, key types, and design decisions.

Subsystem docs:

| Topic | File |
|-------|------|
| File discovery, EXIF, sidecar, upsert | [docs/INDEXING.md](docs/INDEXING.md) |
| SigLIP model, vector storage, serialization | [docs/EMBEDDING.md](docs/EMBEDDING.md) |
| ViT-GPT2 captioning, FTS update | [docs/CAPTIONING.md](docs/CAPTIONING.md) |
| BM25, cosine, hybrid RRF search | [docs/SEARCHING.md](docs/SEARCHING.md) |
| SQLite schema, Store class API | [docs/STORE.md](docs/STORE.md) |
