/**
 * Sidecar markdown caption resolver.
 *
 * Given an image path and a SidecarConfig, locate the paired markdown file
 * and extract the caption from its YAML frontmatter.
 *
 * Strategy "parallel-tree":
 *   image at <visuals_root>/<subfolder>/<name>.<ext>
 *   md    at <notes_root>/<Subfolder>/<name>.md
 *   where <Subfolder> matches <subfolder> case-insensitively when configured.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, extname, join, relative } from "path";
import matter from "gray-matter";
import type { SidecarConfig } from "./collections.js";

export interface SidecarResult {
  mdPath: string;
  caption: string;
  mdMtime: number;
}

// Per-run cache of notes_root → list of immediate child dir names
const dirCache = new Map<string, string[]>();

function listDirs(root: string): string[] {
  const cached = dirCache.get(root);
  if (cached) return cached;
  if (!existsSync(root)) {
    dirCache.set(root, []);
    return [];
  }
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  dirCache.set(root, entries);
  return entries;
}

export function clearSidecarCache(): void {
  dirCache.clear();
}

export function resolveSidecar(
  imagePath: string,
  visualsRoot: string,
  config: SidecarConfig,
): SidecarResult | null {
  if (config.strategy !== "parallel-tree") return null;

  const rel = relative(visualsRoot, imagePath);
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const subfolder = parts[parts.length - 2]!;
  const fileName = parts[parts.length - 1]!;
  const name = basename(fileName, extname(fileName));

  // Resolve subfolder name in notes_root
  let resolvedSubfolder: string | undefined;
  if (config.case_insensitive) {
    const dirs = listDirs(config.notes_root);
    resolvedSubfolder = dirs.find((d) => d.toLowerCase() === subfolder.toLowerCase());
  } else {
    resolvedSubfolder = subfolder;
  }
  if (!resolvedSubfolder) return null;

  const mdPath = join(config.notes_root, resolvedSubfolder, `${name}.md`);
  if (!existsSync(mdPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(mdPath, "utf-8");
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = matter(raw);
  } catch {
    return null;
  }

  const fm = parsed.data as Record<string, unknown>;
  const value = fm[config.field];
  const caption =
    typeof value === "string"
      ? value.trim()
      : value != null
        ? String(value).trim()
        : "";

  if (!caption) return null;

  const mdMtime = Math.floor(statSync(mdPath).mtimeMs);
  return { mdPath, caption, mdMtime };
}
