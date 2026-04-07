# qimg — Query Images

On-device hybrid search for image files. Sibling tool to [qmd](https://github.com/tobi/qmd) but for images instead of markdown.

- **Vector search** via [SigLIP 2](https://huggingface.co/docs/transformers/model_doc/siglip2) (text↔image, runs locally via transformers.js / ONNX)
- **BM25 keyword search** over filenames + sidecar markdown captions (`ImageText` frontmatter)
- **Image→image** similarity search
- **MCP server** for agent integration

## Commands

```sh
qimg collection add <path> --name <n>
qimg collection list / remove / rename
qimg update                  # scan + hash + EXIF + sidecar captions
qimg embed                   # generate SigLIP vectors
qimg get <path|#docid>
qimg query "sunset over mountains"
qimg query --image photo.jpg
qimg search "keyword"
qimg vsearch "concept"
qimg status
qimg mcp [--http] [--port N]
```

## Sidecar markdown captions

For Obsidian-style vaults where each image has a paired markdown note with an `ImageText` YAML frontmatter field, configure a sidecar resolver in `~/.config/qimg/index.yml`:

```yaml
collections:
  vault:
    path: /path/to/vault/Scaffolding/Visuals
    pattern: "**/*.{png,jpg,webp}"
    sidecar:
      strategy: parallel-tree
      notes_root: /path/to/vault/Content
      case_insensitive: true
      field: ImageText
```

The mapping is: `<visuals_root>/<subfolder>/<name>.png` ↔ `<notes_root>/<Subfolder>/<name>.md` (case-insensitive folder match).
