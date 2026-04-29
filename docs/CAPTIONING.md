# Captioning Pipeline

Command: `qimg caption [--collection <name>] [--force]`  
Entry point: `src/cli/qimg.ts` — `caption` command handler

Generates AI captions for images that have no caption in the store. Captions are written back to the `images` table and trigger an FTS reindex so they become searchable immediately.

## Pipeline Steps

```
1. List uncaptioned images from store
2. If --force, re-caption all images instead
3. For each pending image:
   a. Build chat-template prompt with image + text instruction
   b. Run SmolVLM-256M vision-language model (ONNX)
   c. Decode generated tokens (input tokens trimmed)
   d. Update caption in store (triggers FTS reindex)
4. Report stats
```

## Model

**Model ID:** `HuggingFaceTB/SmolVLM-256M-Instruct`  
**Runtime:** transformers.js (`AutoModelForVision2Seq` low-level API, ONNX)  
**Cache:** `~/.cache/huggingface` (downloaded on first run)  
**Prompt:** `"Describe this image concisely in one or two sentences."`

SmolVLM is a 256M-parameter vision-language model that produces significantly higher quality captions than the previous ViT-GPT2 model. It requires the chat-template API — the `image-to-text` pipeline is not used because it does not support instruction prompting.

Uses a **lazy singleton** — model components are initialized on first call. Non-captioning commands do not load the model.

## Key Function — `src/caption.ts`

```typescript
generateCaption(imagePath: string): Promise<string>
```

Builds a chat-template message with image + text prompt, runs `AutoModelForVision2Seq.generate()`, then decodes only the newly generated tokens (input tokens are trimmed from the output).

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
