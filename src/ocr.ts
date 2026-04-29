// Tesseract.js OCR wrapper. Worker is lazily created and kept alive for the
// lifetime of a `qimg ocr` run, then terminated via terminateOcrWorker().
// Language data is cached in the qimg cache dir (~/.cache/qimg/) alongside
// the SQLite database.

import { mkdirSync } from "fs";
import { getCacheDir } from "./store.js";

let workerPromise: Promise<any> | null = null;

async function getWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const cacheDir = getCacheDir();
      mkdirSync(cacheDir, { recursive: true });
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, { cachePath: cacheDir });
    })();
  }
  return workerPromise;
}

export async function extractOcrText(imagePath: string): Promise<string> {
  const worker = await getWorker();
  const result = await worker.recognize(imagePath);
  return result.data.text.trim();
}

export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
