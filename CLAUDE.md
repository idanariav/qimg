# qimg — Developer Guide

## Commands

```sh
qimg collection add <path> --name <n> [--mask <glob>] [--sidecar-notes <dir>] [--sidecar-field <name>]
qimg collection list
qimg collection remove <name>
qimg collection rename <old> <new>
qimg update [--collection <n>]           # Scan filesystem, hash files, extract EXIF + sidecar captions
qimg embed [--collection <n>] [--force]  # Generate SigLIP vector embeddings
qimg tsearch <query> [--collection <n>] [-n <num>] [--json]
qimg vsearch <query> [--image <path>] [--collection <n>] [-n <num>] [--json]
qimg hsearch <query> [--image <path>] [--collection <n>] [-n <num>] [--json]
qimg get <path|#docid> [--collection <n>]
qimg status
qimg mcp                                 # Start MCP server (stdio)
```

## Development Setup

```sh
npm install
npm run build        # Compile TypeScript → dist/
npm test             # Run tests with vitest
```

Run from source without building (useful during development):

```sh
npx tsx src/cli/qimg.ts <command>
```

## Project Structure

```
src/
  cli/qimg.ts       # CLI entry point and command dispatch
  mcp/server.ts     # MCP server (exposes hsearch, get, status tools)
  store.ts          # SQLite store: FTS5 + sqlite-vec, collection management
  embed.ts          # SigLIP 2 text and image embeddings via transformers.js
  sidecar.ts        # Parallel-tree sidecar resolver for paired markdown files
  exif.ts           # EXIF extraction via exifr
  collections.ts    # Collection config types and validation
  index.ts          # Public API re-exports
test/
  store.test.ts     # Store upsert, vector search, hybrid RRF fusion
  sidecar.test.ts   # Parallel-tree sidecar path resolution
```

## Config & Cache

- Config: `~/.config/qimg/index.yml` (override with `QIMG_CONFIG_DIR`)
- Cache/DB: `~/.cache/qimg/index.sqlite` (override with `QIMG_CACHE_DIR`)

## Running Tests

```sh
npm test
```

Tests use vitest. The store tests create an in-memory SQLite database and do not require any external services or pre-downloaded models.

## Publishing

```sh
npm run build
npm publish
```

Requires `npm login` and `publishConfig.access: "public"` in `package.json` (already set).
