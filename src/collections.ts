/**
 * Collections configuration management for qimg.
 * YAML config at ~/.config/qimg/index.yml
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import YAML from "yaml";

export interface SidecarConfig {
  strategy: "parallel-tree";
  notes_root: string;
  case_insensitive?: boolean;
  field: string;
}

export interface Collection {
  path: string;
  pattern: string;
  ignore?: string[];
  sidecar?: SidecarConfig;
}

export interface CollectionConfig {
  collections: Record<string, Collection>;
}

export interface NamedCollection extends Collection {
  name: string;
}

function getConfigDir(): string {
  if (process.env.QIMG_CONFIG_DIR) return process.env.QIMG_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "qimg");
  return join(homedir(), ".config", "qimg");
}

function getConfigFilePath(): string {
  return join(getConfigDir(), "index.yml");
}

export function loadConfig(): CollectionConfig {
  const path = getConfigFilePath();
  if (!existsSync(path)) return { collections: {} };
  try {
    const content = readFileSync(path, "utf-8");
    const config = (YAML.parse(content) as CollectionConfig) ?? { collections: {} };
    if (!config.collections) config.collections = {};
    return config;
  } catch (e) {
    throw new Error(`Failed to parse ${path}: ${e}`);
  }
}

export function saveConfig(config: CollectionConfig): void {
  const path = getConfigFilePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, YAML.stringify(config, { indent: 2, lineWidth: 0 }), "utf-8");
}

export function listCollections(): NamedCollection[] {
  const config = loadConfig();
  return Object.entries(config.collections).map(([name, c]) => ({ name, ...c }));
}

export function getCollection(name: string): NamedCollection | null {
  const config = loadConfig();
  const c = config.collections[name];
  return c ? { name, ...c } : null;
}

export function addCollection(
  name: string,
  path: string,
  pattern: string = "**/*.{png,jpg,jpeg,webp,heic,gif}",
  sidecar?: SidecarConfig,
): void {
  const config = loadConfig();
  config.collections[name] = {
    path,
    pattern,
    ...(sidecar ? { sidecar } : {}),
  };
  saveConfig(config);
}

export function removeCollection(name: string): boolean {
  const config = loadConfig();
  if (!config.collections[name]) return false;
  delete config.collections[name];
  saveConfig(config);
  return true;
}

export function renameCollection(oldName: string, newName: string): boolean {
  const config = loadConfig();
  if (!config.collections[oldName]) return false;
  if (config.collections[newName]) throw new Error(`Collection '${newName}' already exists`);
  config.collections[newName] = config.collections[oldName]!;
  delete config.collections[oldName];
  saveConfig(config);
  return true;
}

export function getConfigPath(): string {
  return getConfigFilePath();
}

export function isValidCollectionName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}
