import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveSidecar, clearSidecarCache } from "../src/sidecar.js";
import type { SidecarConfig } from "../src/collections.js";

let root: string;
let visuals: string;
let notes: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "qimg-test-"));
  visuals = join(root, "Scaffolding", "Visuals");
  notes = join(root, "Content");
  mkdirSync(join(visuals, "claims"), { recursive: true });
  mkdirSync(join(visuals, "posts"), { recursive: true });
  mkdirSync(join(notes, "Claims"), { recursive: true });
  mkdirSync(join(notes, "Posts"), { recursive: true });
  clearSidecarCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const cfg = (): SidecarConfig => ({
  strategy: "parallel-tree",
  notes_root: notes,
  case_insensitive: true,
  field: "ImageText",
});

describe("resolveSidecar", () => {
  it("resolves case-insensitive parallel-tree mapping", () => {
    writeFileSync(join(visuals, "claims", "foo.png"), "");
    writeFileSync(
      join(notes, "Claims", "foo.md"),
      `---\nImageText: A diagram about forgetting curves\n---\nbody`,
    );
    const r = resolveSidecar(join(visuals, "claims", "foo.png"), visuals, cfg());
    expect(r).not.toBeNull();
    expect(r!.caption).toBe("A diagram about forgetting curves");
    expect(r!.mdPath).toBe(join(notes, "Claims", "foo.md"));
  });

  it("returns null when sidecar markdown is missing", () => {
    writeFileSync(join(visuals, "claims", "lonely.png"), "");
    const r = resolveSidecar(join(visuals, "claims", "lonely.png"), visuals, cfg());
    expect(r).toBeNull();
  });

  it("returns null when frontmatter field is absent", () => {
    writeFileSync(join(visuals, "posts", "bar.png"), "");
    writeFileSync(join(notes, "Posts", "bar.md"), `---\ntitle: x\n---\nbody`);
    const r = resolveSidecar(join(visuals, "posts", "bar.png"), visuals, cfg());
    expect(r).toBeNull();
  });

  it("reads non-string frontmatter values via String() coercion", () => {
    writeFileSync(join(visuals, "posts", "num.png"), "");
    writeFileSync(join(notes, "Posts", "num.md"), `---\nImageText: 42\n---`);
    const r = resolveSidecar(join(visuals, "posts", "num.png"), visuals, cfg());
    expect(r?.caption).toBe("42");
  });
});
