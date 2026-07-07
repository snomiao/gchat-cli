// Resolve a <space> arg → canonical space name ("spaces/<id>"), plus parse the
// "<space>:<threadId>" reply syntax.
//
// Accepted <space> forms (exact match wins over substring):
//   spaces/AAAAxxxx   full resource name (used as-is)
//   AAAAxxxx          bare space id
//   Engineering       displayName, exact
//   eng               displayName, substring (must be unambiguous)
import { listSpaces } from "./gws.ts";
import {
  readSpacesCache,
  writeSpacesCache,
  type SpaceCacheEntry,
} from "./config.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface ResolvedSpace {
  name: string; // "spaces/<id>"
  displayName: string; // "" for DMs
}

// Split "<space>:<threadId>" → { spaceArg, threadId }. A space arg may itself be
// "spaces/<id>" (one internal slash, no colon), so we split on the LAST colon
// and only treat the tail as a thread id when it has no slash.
export function splitThread(arg: string): { spaceArg: string; threadId?: string } {
  const idx = arg.lastIndexOf(":");
  if (idx === -1) return { spaceArg: arg };
  const tail = arg.slice(idx + 1);
  // A URL scheme ("https://") or an empty tail is not a thread id.
  if (!tail || tail.includes("/")) return { spaceArg: arg };
  return { spaceArg: arg.slice(0, idx), threadId: tail };
}

export async function resolveSpace(arg: string, force = false): Promise<ResolvedSpace> {
  if (arg.startsWith("spaces/")) return { name: arg, displayName: "" };

  const spaces = await loadSpacesCached(force);

  // Bare space id (matches the tail of a resource name).
  const byId = spaces.find((s) => s.name === `spaces/${arg}`);
  if (byId) return { name: byId.name, displayName: byId.displayName };

  const named = spaces.filter((s) => s.displayName);
  const exact = named.filter((s) => s.displayName === arg);
  if (exact.length === 1) return toResolved(exact[0]!);
  if (exact.length > 1) throw ambiguous(arg, exact);

  const fuzzy = named.filter((s) => s.displayName.includes(arg));
  if (fuzzy.length === 1) return toResolved(fuzzy[0]!);
  if (fuzzy.length === 0)
    throw new Error(`No space matching "${arg}". Try: gchat spaces`);
  throw ambiguous(arg, fuzzy);
}

function toResolved(e: SpaceCacheEntry): ResolvedSpace {
  return { name: e.name, displayName: e.displayName };
}

function ambiguous(arg: string, matches: SpaceCacheEntry[]): Error {
  const list = matches
    .slice(0, 6)
    .map((s) => `${s.name}=${s.displayName}`)
    .join(", ");
  return new Error(
    `Ambiguous "${arg}" — matches ${matches.length} spaces: ${list}. Use the space id instead.`,
  );
}

export async function loadSpacesCached(force = false): Promise<SpaceCacheEntry[]> {
  if (!force) {
    const cache = readSpacesCache();
    if (cache && Date.now() - cache.fetched_at < CACHE_TTL_MS) return cache.spaces;
  }
  const spaces = await listSpaces();
  const entries: SpaceCacheEntry[] = spaces.map((s) => ({
    name: s.name,
    displayName: s.displayName ?? "",
    type: s.spaceType ?? "SPACE",
  }));
  writeSpacesCache({ fetched_at: Date.now(), spaces: entries });
  return entries;
}
