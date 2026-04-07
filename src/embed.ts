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

export const SIGLIP_MODEL_ID = "Xenova/siglip-base-patch16-224";
export const EMBED_DIM = 768;

let textPipePromise: Promise<any> | null = null;
let imagePipePromise: Promise<any> | null = null;

async function getTextPipe(): Promise<any> {
  if (textPipePromise) return textPipePromise;
  textPipePromise = (async () => {
    const tf = await loadTf();
    const tokenizer = await tf.AutoTokenizer.from_pretrained(SIGLIP_MODEL_ID);
    const model = await tf.AutoModel.from_pretrained(SIGLIP_MODEL_ID);
    return { tokenizer, model, tf };
  })();
  return textPipePromise;
}

async function getImagePipe(): Promise<any> {
  if (imagePipePromise) return imagePipePromise;
  imagePipePromise = (async () => {
    const tf = await loadTf();
    const processor = await tf.AutoProcessor.from_pretrained(SIGLIP_MODEL_ID);
    const model = await tf.AutoModel.from_pretrained(SIGLIP_MODEL_ID);
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
  const { text_embeds } = await model.get_text_features(inputs);
  return l2normalize(Float32Array.from(text_embeds.data));
}

export async function embedImage(imagePath: string): Promise<Float32Array> {
  const { processor, model, tf } = await getImagePipe();
  const image = await tf.RawImage.read(imagePath);
  const inputs = await processor(image);
  const { image_embeds } = await model.get_image_features(inputs);
  return l2normalize(Float32Array.from(image_embeds.data));
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
