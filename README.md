# qimg — Query Images

On-device hybrid search for your image library. Find images by meaning, description, or visual similarity — entirely offline, no cloud required.

---

## Quick Start

### Install

**From npm:**

```sh
npm install -g @idan_ariav/qimg
```

**From the Claude Code marketplace:**

```sh
claude plugin marketplace add idanariav/pkm-query-tools
claude plugin install qimg@pkm-query-tools
```

**Requirements:** Node.js ≥ 22.0.0, ~200MB disk space for the SigLIP model (downloaded on first use).

### Get Running in 3 Steps

```sh
# 1. Register a folder as a collection
qimg collection add ~/photos --name photos

# 2. Scan and index your images
qimg update --collection photos

# 3. Generate semantic embeddings
qimg embed --collection photos
```

### Popular Commands

```sh
# Hybrid search (recommended — combines keyword + semantic)
qimg hsearch "person looking contemplative"

# Keyword search — exact terms in filenames or captions
qimg tsearch "fishing rod"

# Semantic search — find by meaning and visual concepts
qimg vsearch "warm cozy interior"

# Image-to-image similarity
qimg vsearch --image ./reference.jpg

# Inspect a specific image
qimg get photos/portrait.jpg

# Check index health
qimg status
```

---

## Use Cases

qimg is designed for knowledge workers and researchers who maintain large visual libraries and need to find images through natural language rather than filenames or manual tags.

**Find images you remember but can't locate**
> "I had a diagram about motivation and reward loops — search for it without remembering the filename."
```sh
qimg hsearch "motivation reward loop diagram"
```

**Retrieve visual evidence for a claim or idea**
> "I need an image showing social proof or conformity for a presentation."
```sh
qimg vsearch "people following crowd behavior"
```

**Match images to notes in a knowledge base**
> Images paired with Obsidian notes are indexed with their captions, making them discoverable through the concepts in your writing.
```sh
qimg tsearch "external motivation"
```

**Find visually similar photos**
> "Show me images similar to this reference shot."
```sh
qimg vsearch --image ./reference-shot.jpg
```

**Agent-assisted image retrieval**
> Claude Code agents can call qimg via MCP to search your image library before deciding which images to actually read — avoiding unnecessary token usage from uploading whole folders to a vision model.

---

## Commands

### Collection Management

Collections are registered folders qimg knows how to index and search.

```sh
qimg collection add <path> --name <name> [--mask <glob>] [--sidecar-notes <dir>] [--sidecar-field <field>]
qimg collection list
qimg collection remove <name>
qimg collection rename <old> <new>
```

| Flag | Description |
|---|---|
| `--name` | Name for the collection (required) |
| `--mask` | Glob pattern for which files to index (default: `**/*.{png,jpg,jpeg,webp,heic,gif}`) |
| `--sidecar-notes` | Root directory of paired markdown files containing image captions |
| `--sidecar-field` | Frontmatter field in markdown files that holds the caption (default: `ImageText`) |

**Examples:**

```sh
# Basic photo folder
qimg collection add ~/photos --name photos

# Obsidian vault images with paired markdown captions
qimg collection add ./Scaffolding/Visuals/claims --name claims \
  --sidecar-notes ./Content \
  --sidecar-field ImageText

# Only index PNGs in a specific subfolder
qimg collection add ~/diagrams --name diagrams --mask "**/*.png"
```

---

### Indexing

Two-step process: first scan files and extract metadata, then generate semantic embeddings.

```sh
qimg update [--collection <name>]
qimg embed  [--collection <name>] [--force]
```

**`update`** — Walks the collection directory, hashes files, extracts EXIF metadata (camera, GPS, timestamp), and reads sidecar captions. Skips files that haven't changed since the last run.

**`embed`** — Generates SigLIP 2 vector embeddings for each image. Only processes images that don't already have a vector unless `--force` is passed. Shows a live progress bar with ETA.

```sh
# Update and embed everything
qimg update && qimg embed

# Re-embed a specific collection from scratch
qimg embed --collection photos --force
```

---

### Search

Three search strategies, each with different strengths:

```sh
qimg tsearch <query> [--collection <name>] [-n <num>] [--json]
qimg vsearch <query> [--image <path>] [--collection <name>] [-n <num>] [--json]
qimg hsearch <query> [--image <path>] [--collection <name>] [-n <num>] [--json]
```

| Flag | Description |
|---|---|
| `--collection` | Limit search to a single collection |
| `-n` | Number of results to return (default: 20) |
| `--json` | Output results as JSON |
| `--image` | Use an image file as the query instead of text (vsearch / hsearch only) |

**`tsearch` — Keyword Search**

BM25 full-text search over filenames, EXIF text, and sidecar captions. Fast and exact — best when you know specific words that appear in a filename or caption.

```sh
qimg tsearch "fishing rod"
qimg tsearch "Nikon D800" --collection photos
```

**`vsearch` — Semantic Search**

Encodes your query with SigLIP and finds images by vector cosine similarity. Understands meaning and visual concepts, not just exact words. Also supports image-to-image queries.

```sh
qimg vsearch "person looking reflective near water"
qimg vsearch --image ./mood-board.jpg --collection design -n 5
```

**`hsearch` — Hybrid Search**

Fuses BM25 and vector results using Reciprocal Rank Fusion (RRF). Best default choice when you're not sure whether your query is a keyword or a concept.

```sh
qimg hsearch "external motivation diagram"
qimg hsearch "warm light interior" -n 10 --json
```

---

### Inspection

```sh
qimg get <path|#docid> [--collection <name>]
qimg ls [<collection>]
qimg status
```

**`get`** — Prints full metadata for a single image as JSON: path, caption, EXIF fields (camera, GPS, timestamp), dimensions, and vector coverage.

```sh
qimg get photos/portrait.jpg
qimg get claims/external-motivation.png
```

**`ls`** — Lists all indexed images. Optionally filter to one collection.

```sh
qimg ls
qimg ls claims
```

**`status`** — Shows index health: number of collections, images, and how many have embeddings.

```sh
qimg status
```

---

### MCP Server

Starts qimg as a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio, making it accessible to Claude Code and other MCP-compatible agents.

```sh
qimg mcp
```

Once registered, agents can search your images directly in conversation. Configure in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "qimg": {
      "command": "qimg",
      "args": ["mcp"]
    }
  }
}
```

Verify with `/mcp list` inside Claude Code.

---

### Sidecar Captions

For knowledge bases with images stored separately from their markdown notes, qimg supports a **parallel-tree sidecar** strategy: images and markdown files share the same folder structure under different roots.

**Example structure:**

```
Scaffolding/Visuals/claims/psychology/motivation.png
                                         ↕ matched by folder path
Content/Claims/psychology/motivation.md  ← caption read from ImageText field
```

**Markdown frontmatter:**

```markdown
---
title: External Motivation Crowds Out Intrinsic Drive
ImageText: A person looking at a hook dangling from a fishing rod
---
```

After running `qimg update`, the caption is indexed and the image becomes searchable:

```sh
qimg tsearch "fishing rod"
# → 1.0000  psychology/motivation.png
#           A person looking at a hook dangling from a fishing rod
```

---

## Methodology

qimg combines three techniques to make images findable through natural language:

**1. SigLIP 2 Embeddings (Semantic Search)**

[SigLIP 2](https://huggingface.co/docs/transformers/model_doc/siglip2) is a vision-language model trained to embed images and text into the same vector space. A text query like "cozy reading nook" and an image of a person reading by a lamp will land near each other in this space — even if none of those words appear in the filename.

Embeddings run locally via [transformers.js](https://huggingface.co/docs/transformers.js) and ONNX Runtime. The model is downloaded once (~200MB) and cached. No image or query ever leaves your device.

**2. BM25 Full-Text Search (Keyword Search)**

Filenames, EXIF metadata, and sidecar captions are indexed in an [FTS5](https://www.sqlite.org/fts5.html) table inside a local SQLite database. BM25 ranking gives higher scores to images where query terms appear more specifically. This is fast, deterministic, and works offline without any model.

**3. Reciprocal Rank Fusion (Hybrid Search)**

`hsearch` runs both BM25 and vector search in parallel, then merges the ranked result lists using [Reciprocal Rank Fusion](https://en.wikipedia.org/wiki/Reciprocal_rank_fusion). RRF weights items by their position in each ranked list rather than their raw scores, which avoids the score-scale mismatch between BM25 and cosine similarity. The result is more robust than either method alone.

**4. Sidecar Captions**

For knowledge bases where images live in a separate folder tree from their markdown notes, qimg resolves captions by mirroring the directory structure. This lets human-written descriptions (stored as frontmatter in markdown) enrich the search index without modifying the image files themselves.

**Storage:** All data is stored in a single SQLite file at `~/.cache/qimg/index.sqlite`. Collection config lives at `~/.config/qimg/index.yml`. Both paths are overridable via `QIMG_CACHE_DIR` and `QIMG_CONFIG_DIR`.

---

## Privacy and Security

qimg is fully local. Nothing leaves your machine.

- **No cloud calls** — Embeddings are generated on-device using ONNX Runtime. There are no API keys, no telemetry, and no network requests during search or indexing.
- **No image uploads** — Images are read from disk, hashed, and embedded locally. The hash and vector are stored in a local SQLite database; the image bytes are never transmitted anywhere.
- **Model downloaded once** — The SigLIP 2 ONNX model is fetched from Hugging Face on first use and cached locally. After that, the tool runs entirely offline.
- **You own your index** — The SQLite database and config files are plain files in standard XDG directories (`~/.cache/qimg/`, `~/.config/qimg/`). You can inspect, copy, or delete them at any time.

---

## Other Plugins

qimg is part of the **pkm-query-tools** family — a suite of local-first search tools for personal knowledge management:

| Plugin | What it searches |
|---|---|
| **qimg** | Image libraries (keyword + semantic + image-to-image) |
| [qnode](https://github.com/idanariav/qnode) | Graph traversal over note networks (neighbors, paths, distance) |
| [qvoid](https://github.com/idanariav/qvoid) | Semantic clustering and similarity across your vault |

Install all of them at once:

```sh
claude plugin marketplace add idanariav/pkm-query-tools
claude plugin install qnode@pkm-query-tools
claude plugin install qvoid@pkm-query-tools
```
