/**
 * SigLIP 2 embeddings via @huggingface/transformers (ONNX Runtime).
 *
 * Both branches (text + image) project into the same 768d space, so a single
 * vector table serves text→image, image→image, and image→text retrieval.
 *
 * Models are lazy-loaded as singletons. The first call downloads weights to
 * the transformers.js cache (~/.cache/huggingface by default).
 */

import { readFileSync } from "fs";

// transformers.js is loaded dynamically because it is a large ESM dep and
// CLI commands that don't need embeddings (collection list, status) should
// stay fast.
type TransformersModule = typeof import("@huggingface/transformers");

let tfPromise: Promise<TransformersModule> | null = null;
function loadTf(): Promise<TransformersModule> {
  if (!tfPromise) tfPromise = import("@huggingface/transformers");
  return tfPromise;
}

export const SIGLIP_MODEL_ID = "onnx-community/siglip2-base-patch16-224-ONNX";
export const EMBED_DIM = 768;

let textPipePromise: Promise<any> | null = null;
let imagePipePromise: Promise<any> | null = null;

async function getTextPipe(): Promise<any> {
  if (textPipePromise) return textPipePromise;
  textPipePromise = (async () => {
    const tf = await loadTf();
    const tokenizer = await tf.AutoTokenizer.from_pretrained(SIGLIP_MODEL_ID);
    const ModelCls = (tf as any).SiglipTextModel ?? tf.AutoModel;
    const model = await ModelCls.from_pretrained(SIGLIP_MODEL_ID);
    return { tokenizer, model, tf };
  })();
  return textPipePromise;
}

async function getImagePipe(): Promise<any> {
  if (imagePipePromise) return imagePipePromise;
  imagePipePromise = (async () => {
    const tf = await loadTf();
    const processor = await tf.AutoProcessor.from_pretrained(SIGLIP_MODEL_ID);
    const ModelCls = (tf as any).SiglipVisionModel ?? tf.AutoModel;
    const model = await ModelCls.from_pretrained(SIGLIP_MODEL_ID);
    return { processor, model, tf };
  })();
  return imagePipePromise;
}

function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

export async function embedText(text: string): Promise<Float32Array> {
  const { tokenizer, model } = await getTextPipe();
  const inputs = tokenizer(text, { padding: "max_length", truncation: true });
  const fn = typeof model.get_text_features === "function"
    ? (i: any) => model.get_text_features(i)
    : (i: any) => model(i);
  const out = await fn(inputs);
  const embeds = out.text_embeds ?? out.pooler_output ?? out.last_hidden_state;
  if (!embeds) throw new Error(`No text embeddings in model output: ${Object.keys(out).join(",")}`);
  return l2normalize(Float32Array.from(embeds.data));
}

export async function embedImage(imagePath: string): Promise<Float32Array> {
  const { processor, model, tf } = await getImagePipe();
  const image = await tf.RawImage.read(imagePath);
  const inputs = await processor(image);
  // Some ONNX exports of SigLIP don't expose get_image_features; fall back to
  // the model's forward pass, which returns image_embeds in its output.
  const fn = typeof model.get_image_features === "function"
    ? (i: any) => model.get_image_features(i)
    : (i: any) => model({ pixel_values: i.pixel_values });
  const out = await fn(inputs);
  const embeds = out.image_embeds ?? out.pooler_output ?? out.last_hidden_state;
  if (!embeds) throw new Error(`No image embeddings in model output: ${Object.keys(out).join(",")}`);
  return l2normalize(Float32Array.from(embeds.data));
}

export function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function float32ToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

// Convenience for re-embedding from disk later
export function readImageBytes(p: string): Buffer {
  return readFileSync(p);
}
