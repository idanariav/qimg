# Portable export (`qimg export`)

Writes a compact copy of the image index into a folder inside an Obsidian vault, so clients
that can't run qimg (the pkm-rag plugin on mobile, or a desktop without qimg) can still run
`tsearch`, `vsearch`, `hsearch` and `get`. Image vectors are read from `image_vectors`, not
re-embedded. Only the word table (below) is embedded.

```sh
qimg export --out <vault>/Scaffolding/Embeddings/qimg   # explicit
qimg export                                             # uses export.path from index.yml
```

Config (`~/.config/qimg/index.yml`). When `export.path` is set, `index`, `embed`, `caption` and
`ocr` re-export at the end:

```yaml
export:
  path: /Users/me/Vault/Scaffolding/Embeddings/qimg
```

The output directory must sit inside a vault (a `.obsidian/` folder above it). Image and sidecar
paths are written vault-relative, and images from collections outside that vault are skipped.

## Format: `pkm-vectors` v2

Same layout as `qmd export` / `qvoid export`:

- `vectors-0.bin`, `vectors-1.bin`, … are int8, row-major, 768 bytes per row: all `items` first, then all `words`, split on row boundaries into files of at most 4 MiB (Obsidian Sync's Standard plan skips files over 5 MB). Concatenate the files in manifest `files` order. Format v1 (before qmd 2.6 / qvoid 0.6 / qimg 0.5) wrote one `vectors.bin` and had no `files`; readers should accept both.
- `manifest.json`:

```jsonc
{
  "format": "pkm-vectors", "version": 2, "tool": "qimg",
  "model": "onnx-community/siglip2-base-patch16-224-ONNX", "dim": 768, "scale": 127,
  "exportedAt": "<ISO date>",
  "files": ["vectors-0.bin", "vectors-1.bin"],
  "images": [{ "path": "Scaffolding/Visuals/claims/x.png",   // vault-relative
               "file": "x.png",                              // collection-relative, as in --json "path"
               "collection": "claims", "hash": "…", "width": 1200, "height": 800,
               "mime": "image/png", "taken_at": null,
               "caption": "…", "exif_text": null, "ocr_text": "…",
               "sidecar": "Content/Claims/X.md" }],           // vault-relative, or null
  "items": [0, 1, …],   // vector row → index into images (images without a vector have no row)
  "words": ["ability", "…"]
}
```

Vectors keep SigLIP's full 768 dims, L2-normalized, then `round(x * 127)`. Score a row as
`dot(query, row) / 127` with a normalized float query, which gives cosine similarity.

**Word table.** Clients have no SigLIP text model, so a typed query is embedded as the mean of its
words' text vectors. An image already in the export can also be the query by using its own row,
which gives lite `vsearch --image` for vault images. The table holds `assets/common-words.txt`
(~5k English words), every caption and filename word, and every word used at least 3 times across
OCR text and the images' sidecar notes (text after a note's `%%` drawing-data line is ignored).
Words are embedded raw with `embedTexts` (batched, identical to `embedText`). They're reused from
the previous export, so only new words cost time: the first export of ~6.8k words takes ~3.5 min,
and later ones take seconds.

**Fidelity** (vault, 366 images; top-10 overlap with the CLI):

| Query | `vsearch` |
|---|---|
| Single words ("clock", "ladder", "procrastination") | 8–10 / 10 |
| Phrases ("two people talking", "light bulb idea") | 5–8 / 10 |

Averaging word vectors loses word order and composition, so phrases are the weak spot. A
"a picture of {word}" prompt template made it worse (5.6 vs 6.3 / 10 on phrases), so words are
embedded raw. Lite `tsearch` overlaps 9.4/10 and `hsearch` 8.2/10.
