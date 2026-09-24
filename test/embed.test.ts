import { describe, it, expect } from "vitest";
import { embedText, EMBED_DIM, TEXT_MAX_LENGTH } from "../src/embed.js";

// Regression: the SigLIP 2 tokenizer reports model_max_length=1e30, so
// padding:"max_length" without an explicit max_length threw
// "RangeError: Invalid array length". Needs the cached SigLIP model.
describe("embedText", () => {
  it("embeds a short query into a normalized EMBED_DIM vector", async () => {
    const v = await embedText("stress");
    expect(TEXT_MAX_LENGTH).toBe(64);
    expect(v.length).toBe(EMBED_DIM);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 4);
  }, 120_000);
});
