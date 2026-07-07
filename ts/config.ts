// Space-name cache at ~/.config/gchat-cli/spaces.json (5-minute TTL).
// No auth/token here — credentials live in the backend CLI.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".config", "gchat-cli");
export const SPACES_CACHE_PATH = join(CONFIG_DIR, "spaces.json");

export interface SpaceCacheEntry {
  name: string; // "spaces/AAQAnrmeCn4"
  displayName: string; // "" for DIRECT_MESSAGE
  type: string; // "SPACE" | "DIRECT_MESSAGE" | ...
}

export interface SpacesCache {
  fetched_at: number;
  spaces: SpaceCacheEntry[];
}

function ensureDir(file: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function readSpacesCache(): SpacesCache | null {
  if (!existsSync(SPACES_CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SPACES_CACHE_PATH, "utf8")) as SpacesCache;
  } catch {
    return null;
  }
}

export function writeSpacesCache(cache: SpacesCache): void {
  ensureDir(SPACES_CACHE_PATH);
  writeFileSync(SPACES_CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
}
