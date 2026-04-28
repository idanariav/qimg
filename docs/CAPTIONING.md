# Captioning Pipeline

Command: `qimg caption [--collection <name>] [--force]`  
Entry point: `src/cli/qimg.ts` — `caption` command handler

Generates AI captions for images that have no caption in the store. Captions are written back to the `images` table and trigger an FTS reindex so they become searchable immediately.

## Pipeline Steps

```
1. List uncaptioned images from store
2. If --force, re-caption all images instead
3. For each pending image:
   a. Run ViT-GPT2 captioning model (ONNX)
   b. Extract generated_text
   c. Update caption in store (triggers FTS reindex)
4. Report stats
```

## Model

**Model ID:** `Xenova/vit-gpt2-image-captioning`  
**Runtime:** transformers.js (`image-to-text` pipeline, ONNX)  
**Cache:** `~/.cache/huggingface` (downloaded on first run)

Uses a **lazy singleton** — the pipeline is initialized on first call. Non-captioning commands do not load the model.

## Key Function — `src/caption.ts`

```typescript
generateCaption(imagePath: string): Promise<string>
```

Calls the `image-to-text` transformers.js pipeline with the image path, returns `result[0].generated_text`.

## Store Updates

`src/store.ts:Store.updateCaption(id, caption)`:
- Updates `caption` column in `images` table
- Triggers FTS reindex for that row (so the new caption becomes searchable via `tsearch`/`hsearch`)

## Relationship to Sidecar Captions

Captions can come from three sources, applied at different pipeline stages:

| Source | When applied | How stored |
|--------|-------------|------------|
| EXIF `ImageDescription` / IPTC `Caption-Abstract` | During `qimg index` | Written to `caption` column |
| Sidecar `.md` frontmatter field | During `qimg index` | Written to `caption` column (prefers sidecar) |
| AI caption (`qimg caption`) | During `qimg caption` | Written to `caption` column |

`qimg caption` only processes images where `caption IS NULL` (unless `--force`). If an image already has a caption from EXIF or sidecar, the AI captioner skips it.

## Relevant Files

| File | Role |
|------|------|
| `src/caption.ts` | `generateCaption()` — model singleton and inference |
| `src/store.ts` | `Store.listUncaptioned()`, `Store.updateCaption()` |
| `src/cli/qimg.ts` | `caption` command: filtering, progress bar, error handling |
