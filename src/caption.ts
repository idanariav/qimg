import type { Pipeline } from "@huggingface/transformers";

const MODEL = "Xenova/vit-gpt2-image-captioning";
let pipePromise: Promise<Pipeline> | null = null;

function getCaptionPipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("image-to-text", MODEL);
    })();
  }
  return pipePromise;
}

export async function generateCaption(imagePath: string): Promise<string> {
  const pipe = await getCaptionPipe();
  const result = await pipe(imagePath);
  // result is [{ generated_text: "..." }]
  return result[0].generated_text.trim();
}
