// `gchat tail <space> [-n N] [--interval SEC] [--exit-on-message] [--timeout DUR]`
// Print last N messages, then poll and print new ones (dedup by message name).
//
// --exit-on-message turns tail into a "wait for reply": it skips the backlog and
// exits 0 as soon as the first new message *from someone other than you* arrives
// (your own sends are ignored via the People API self-id). --timeout DUR auto-
// stops after that long (exit 0 even if nothing arrived).
import { listMessages, getSelfUserId, type Message } from "../gws.ts";
import { resolveSpace, splitThread } from "../space-resolver.ts";
import { formatMessage } from "../format.ts";

// Parse a duration like "300", "90s", "30m", "2h", "1d" → seconds. Bare numbers
// are seconds. Throws on anything unrecognized.
export function parseDuration(input: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([smhd]?)$/.exec(input.trim());
  if (!m) throw new Error(`invalid duration "${input}" (use e.g. 90s, 30m, 2h, 1d)`);
  const n = Number(m[1]);
  const mult = { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] ?? ""]!;
  return n * mult;
}

export async function cmdTail(args: {
  space: string;
  limit: number;
  interval: number;
  format: string;
  exitOnMessage?: boolean | undefined;
  timeout?: string | undefined;
}): Promise<void> {
  const { spaceArg } = splitThread(args.space);
  const space = await resolveSpace(spaceArg);
  // Only need the self-id when we must exclude our own messages.
  const selfUserId = args.exitOnMessage ? await getSelfUserId() : null;
  await tailSpace({
    spaceName: space.name,
    initialLimit: args.limit,
    intervalSec: args.interval,
    format: args.format,
    prefix: undefined,
    exitOnMessage: args.exitOnMessage ?? false,
    timeoutSec: args.timeout !== undefined ? parseDuration(args.timeout) : undefined,
    selfUserId,
  });
}

export async function tailSpace(opts: {
  spaceName: string;
  initialLimit: number;
  intervalSec: number;
  format: string;
  prefix: string | undefined;
  exitOnMessage?: boolean;
  timeoutSec?: number | undefined;
  selfUserId?: string | null;
}): Promise<void> {
  const { spaceName, initialLimit, intervalSec, format, prefix } = opts;
  const exitOnMessage = opts.exitOnMessage ?? false;
  const spaceId = spaceName.replace(/^spaces\//, "");
  const seen = new Set<string>();
  const deadline = opts.timeoutSec !== undefined ? Date.now() + opts.timeoutSec * 1000 : Infinity;

  // Seed the dedup set with existing messages. Print the backlog only in plain
  // tail mode — when waiting (exit-on-message / timeout) we care about genuinely
  // new messages, so the backlog is silently seeded, not echoed.
  const initial = (await listMessages(spaceName, Math.max(initialLimit, 1)))
    .slice(0, initialLimit)
    .reverse();
  for (const m of initial) seen.add(m.name);
  if (!exitOnMessage && opts.timeoutSec === undefined) {
    printBatch(initial, spaceId, format, prefix);
  }

  while (true) {
    if (Date.now() >= deadline) return; // --timeout reached (exit 0)
    await sleep(Math.min(intervalSec * 1000, Math.max(0, deadline - Date.now())));
    if (Date.now() >= deadline) return;
    try {
      const fresh = (await listMessages(spaceName, 25)).reverse();
      const newOnes = fresh.filter((m) => !seen.has(m.name));
      for (const m of newOnes) seen.add(m.name);
      if (newOnes.length) {
        printBatch(newOnes, spaceId, format, prefix);
        // Exit once a reply from someone other than us lands. If we couldn't
        // resolve our own id, any new message counts.
        if (exitOnMessage) {
          const fromOther = newOnes.some(
            (m) => !opts.selfUserId || m.sender?.name !== opts.selfUserId,
          );
          if (fromOther) return;
        }
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
