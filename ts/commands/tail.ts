// `gchat tail <space> [-n N] [--interval SEC]`
// Print last N messages, then poll and print new ones (dedup by createTime+name).
import { listMessages, type Message } from "../gws.ts";
import { resolveSpace, splitThread } from "../space-resolver.ts";
import { formatMessage } from "../format.ts";

export async function cmdTail(args: {
  space: string;
  limit: number;
  interval: number;
  format: string;
}): Promise<void> {
  const { spaceArg } = splitThread(args.space);
  const space = await resolveSpace(spaceArg);
  await tailSpace({
    spaceName: space.name,
    initialLimit: args.limit,
    intervalSec: args.interval,
    format: args.format,
    prefix: undefined,
  });
}

export async function tailSpace(opts: {
  spaceName: string;
  initialLimit: number;
  intervalSec: number;
  format: string;
  prefix: string | undefined;
}): Promise<void> {
  const { spaceName, initialLimit, intervalSec, format, prefix } = opts;
  const spaceId = spaceName.replace(/^spaces\//, "");
  const seen = new Set<string>();

  const initial = (await listMessages(spaceName, Math.max(initialLimit, 1)))
    .slice(0, initialLimit)
    .reverse();
  for (const m of initial) seen.add(m.name);
  printBatch(initial, spaceId, format, prefix);

  while (true) {
    await sleep(intervalSec * 1000);
    try {
      const fresh = (await listMessages(spaceName, 25)).reverse();
      const newOnes = fresh.filter((m) => !seen.has(m.name));
      if (newOnes.length) {
        for (const m of newOnes) seen.add(m.name);
        printBatch(newOnes, spaceId, format, prefix);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[tail ${spaceId}] poll error: ${msg}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function printBatch(
  messages: Message[],
  spaceId: string,
  format: string,
  prefix: string | undefined,
): void {
  const head = prefix ? `[${prefix}] ` : "";
  for (const m of messages) {
    if (format === "json") {
      console.log(JSON.stringify(prefix ? { space: prefix, ...m } : m));
    } else {
      console.log(`${head}${formatMessage(m, spaceId)}`);
    }
  }
}
