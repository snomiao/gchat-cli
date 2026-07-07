// `gchat spaces [--json] [--refresh]` — list spaces, newest activity first.
import { listSpaces } from "../gws.ts";
import { writeSpacesCache, type SpaceCacheEntry } from "../config.ts";
import { formatSpacesTable } from "../format.ts";

export async function cmdSpaces(opts: { format: string }): Promise<void> {
  const spaces = await listSpaces();
  spaces.sort((a, b) => (b.lastActiveTime ?? "").localeCompare(a.lastActiveTime ?? ""));

  // Every `spaces` call refreshes the resolver cache — it just paid for the data.
  const entries: SpaceCacheEntry[] = spaces.map((s) => ({
    name: s.name,
    displayName: s.displayName ?? "",
    type: s.spaceType ?? "SPACE",
  }));
  writeSpacesCache({ fetched_at: Date.now(), spaces: entries });

  if (opts.format === "json") {
    console.log(JSON.stringify(spaces, null, 2));
  } else {
    console.log(formatSpacesTable(spaces));
  }
}
