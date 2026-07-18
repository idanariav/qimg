import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  addCollection,
  getCollection,
  isValidCollectionName,
  listCollections,
  loadConfig,
  removeCollection,
  renameCollection,
} from "../src/collections.js";

describe("collections", () => {
  let dir: string;
  const originalConfigDir = process.env.QIMG_CONFIG_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qimg-collections-test-"));
    process.env.QIMG_CONFIG_DIR = dir;
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.QIMG_CONFIG_DIR;
    else process.env.QIMG_CONFIG_DIR = originalConfigDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty config when no config file exists yet", () => {
    expect(loadConfig()).toEqual({ collections: {} });
    expect(listCollections()).toEqual([]);
  });

  it("adds, lists, and looks up a collection", () => {
    addCollection("photos", "/abs/photos", "**/*.jpg");
    expect(listCollections()).toEqual([{ name: "photos", path: "/abs/photos", pattern: "**/*.jpg" }]);
    expect(getCollection("photos")).toEqual({ name: "photos", path: "/abs/photos", pattern: "**/*.jpg" });
    expect(getCollection("missing")).toBeNull();
  });

  it("removes a collection", () => {
    addCollection("photos", "/abs/photos");
    expect(removeCollection("photos")).toBe(true);
    expect(getCollection("photos")).toBeNull();
    expect(removeCollection("photos")).toBe(false);
  });

  it("renames a collection", () => {
    addCollection("photos", "/abs/photos");
    expect(renameCollection("photos", "pics")).toBe(true);
    expect(getCollection("photos")).toBeNull();
    expect(getCollection("pics")).not.toBeNull();
  });

  it("returns false renaming a collection that doesn't exist", () => {
    expect(renameCollection("ghost", "anything")).toBe(false);
  });

  it("throws renaming onto a name that already exists (collision)", () => {
    addCollection("photos", "/abs/photos");
    addCollection("pics", "/abs/pics");
    expect(() => renameCollection("photos", "pics")).toThrow(/already exists/);
    // Original collection is left intact on collision
    expect(getCollection("photos")).not.toBeNull();
  });

  it("validates collection names", () => {
    expect(isValidCollectionName("photos-2026")).toBe(true);
    expect(isValidCollectionName("photos_2026")).toBe(true);
    expect(isValidCollectionName("photos 2026")).toBe(false);
    expect(isValidCollectionName("photos/2026")).toBe(false);
  });
});
