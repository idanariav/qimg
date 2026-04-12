# qimg — Query Images

On-device hybrid search for image files. Sibling tool to [qmd](https://github.com/tobi/qmd) but for images instead of markdown.

- **Vector search** via [SigLIP 2](https://huggingface.co/docs/transformers/model_doc/siglip2) (text↔image, runs locally via transformers.js / ONNX)
- **BM25 keyword search** over filenames + sidecar markdown captions (`ImageText` frontmatter)
- **Image→image** similarity search
- **MCP server** for agent integration

## Installation

### From npm

```sh
npm install -g @idan_ariav/qimg
```

### From source

```sh
git clone https://github.com/idanariav/qimg.git
cd qimg
npm install
npm run build
npm link
```

### Requirements

- Node.js ≥ 22.0.0
- ~200MB disk space for SigLIP model (downloaded on first use)

## For Agentic Systems

qimg dramatically improves agent efficiency when searching visual content. Instead of sending images to LLMs for retrieval (expensive in tokens and latency), agents can use local semantic search to find candidate images first, then pass only relevant ones to vision models. This approach:

- **Reduces token consumption** — avoid uploading entire image folders to APIs
- **Improves accuracy** — combine keyword + semantic search for better recall
- **Lowers latency** — run queries instantly on-device, no network round-trips
- **Enables RAG workflows** — build agentic systems that reason over visual libraries at scale

## Commands

### Collection Management

```sh
qimg collection add <path> --name <n> [--mask <glob>] [--sidecar-notes <dir>] [--sidecar-field <name>]
qimg collection list
qimg collection remove <name>
qimg collection rename <oldname> <newname>
```

Create and manage image collections:

```sh
# Add a collection without sidecar metadata
qimg collection add ~/photos --name myPhotos

# Add a collection with sidecar captions (paired markdown files)
qimg collection add ./Scaffolding/Visuals/claims --name claims \
  --sidecar-notes ./Content \
  --sidecar-field ImageText
```

### Indexing

```sh
qimg update [--collection <name>]              # Scan filesystem, hash files, extract EXIF + sidecar captions
qimg embed [--collection <name>] [--force]    # Generate SigLIP vector embeddings for all images
```

### Search

Three search strategies available:

```sh
qimg tsearch "fishing rod"                     # BM25 keyword search over filenames + captions
qimg vsearch "person meditating"               # Semantic vector search (text query)
qimg vsearch --image photo.jpg                 # Image-to-image similarity search
qimg hsearch "sunset over mountains"           # Hybrid: RRF fusion of keyword + vector search
```

**Search method comparison:**

- **`tsearch`** — Fast keyword matching on filenames and caption text. Best for exact terms ("fishing rod", "logo", "blue door"). Uses BM25 ranking.
- **`vsearch`** — Semantic understanding via SigLIP embeddings. Best for concepts and descriptions ("person looking sad", "wooden furniture", "outdoor scene"). Finds images by meaning, not exact words.
- **`hsearch`** — Best of both worlds. Fuses BM25 and vector results via [Reciprocal Rank Fusion](https://en.wikipedia.org/wiki/Reciprocal_rank_fusion). Use this when you're unsure whether the query is a keyword or a concept.

### Inspection

```sh
qimg get <path|#docid> [--collection <name>]  # Print full metadata + caption for a single image
qimg status                                     # Show collection counts and vector coverage
```

### Server

```sh
qimg mcp                                        # Start MCP server for agent integration (stdio)
```

## Sidecar Markdown Captions

For Obsidian-style vaults and knowledge bases, enrich images with human-written captions from paired markdown files. This makes images discoverable through natural language search.

### Configuration

Edit `~/.config/qimg/index.yml` to add sidecar resolvers:

```yaml
collections:
  claims:
    path: /Users/you/Vault/Scaffolding/Visuals/claims
    pattern: "**/*.{png,jpg,webp}"
    sidecar:
      strategy: parallel-tree
      notes_root: /Users/you/Vault/Content
      case_insensitive: true
      field: ImageText
```

### Directory Structure & Mapping

The mapping is case-insensitive and supports two patterns:

**Pattern 1: Images in subfolders**
```
Scaffolding/Visuals/claims/psychology/motivation.png
                            ↓ (matches folder name case-insensitively)
Content/Claims/psychology/motivation.md
```

**Pattern 2: Images in collection root**
```
Scaffolding/Visuals/claims/external-motivation.png
                     ↓ (collection folder name matches)
Content/Claims/external-motivation.md
```

### Setup Example

1. Add a collection with sidecar via CLI:

```sh
qimg collection add ./Scaffolding/Visuals/claims --name claims \
  --sidecar-notes ./Content \
  --sidecar-field ImageText
```

2. In your markdown files, add captions to the frontmatter:

```markdown
---
title: External Motivation Crowds Out Intrinsic Drive
ImageText: A person looking at a hook at the end of a fishing rod
---

Research shows...
```

3. Index and search:

```sh
qimg update --collection claims
qimg tsearch "fishing rod"
```

Output:
```
1.0000  external-motivation.png
        A person looking at a hook at the end of a fishing rod
```

### Configuration Options

- **`strategy`** — Currently only `parallel-tree` (folder-parallel structure)
- **`notes_root`** — Path to your markdown documents directory
- **`case_insensitive`** — If `true`, folder names are matched case-insensitively (recommended)
- **`field`** — YAML frontmatter field name containing the caption (default: `ImageText`)

## Claude Code MCP Integration

Run qimg as a Model Context Protocol server and integrate it with Claude Code for seamless agent-based image search.

### Setup

1. **Install qimg** (if not already installed):

```sh
npm install -g @idan_ariav/qimg
```

2. **Register qimg with Claude Code** — Install the plugin (recommended):

```bash
claude plugin marketplace add idan/qimg
claude plugin install qimg@qimg
```

Or configure MCP manually in `~/.claude/settings.json`:

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

3. **Verify the connection:**

```
/mcp list
```

You should see `qimg` in the list of active MCP servers. Claude Code will now have access to image search capabilities.

### Using qimg in Claude Code Agents

Once registered, agents can query images directly in prompts:

```
Search my design assets for "mobile ui components" and show me the top 3 matches.
```

The agent will:
1. Use `qimg hsearch` to search image captions and vectors
2. Retrieve matching images from your collections
3. Fetch metadata and display results
4. Use image paths for further processing or analysis

### Running the MCP Server Standalone

For debugging or custom integrations, start the server directly:

```sh
qimg mcp
```

qimg uses stdio transport, which is compatible with Claude Code and all standard MCP clients.
