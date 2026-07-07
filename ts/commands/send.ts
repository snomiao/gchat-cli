// `gchat send <space[:threadId]> "<msg>" [--code XXXX]`
//
// Two-step confirm guard: the first call reads the space's recent messages,
// prints them + a summary + a --code=XXXX, and stashes the intent. Re-run within
// the TTL with --code to actually post. Reply into a thread with the
// "<space>:<threadId>" target.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMessages, sendMessage, GwsError, type Message } from "../gws.ts";
import { resolveSpace, splitThread } from "../space-resolver.ts";
import { formatMessage, threadIdOf } from "../format.ts";

const PENDING_TTL_MS = 60_000;

interface Pending {
  space_arg: string;
  message: string;
  created_at: number;
}

function intentHash(target: string, message: string): string {
  return createHash("sha256").update(`${target}\x00${message}`).digest("hex").slice(0, 8);
}

function pendingPath(hash: string): string {
  return join(tmpdir(), `gchat-cli-pending-${hash}.json`);
}

// Best-effort recent-context block for the confirm gate. Fail-soft: if the space
// can't be resolved / read (bad name, missing scope), we still mint the code so
// the flow isn't blocked — errors resurface at confirm time.
async function printContext(spaceArg: string, threadId: string | undefined, message: string): Promise<void> {
  let recent: Message[] = [];
  let spaceId = "";
  let dest = spaceArg;
  try {
    const space = await resolveSpace(spaceArg);
    spaceId = space.name.replace(/^spaces\//, "");
    dest = space.displayName ? `${space.displayName} (${space.name})` : space.name;
    const msgs = await listMessages(space.name, 3);
    recent = msgs.slice(0, 3).reverse();
  } catch {
    /* degrade to no context */
  }

  console.log(`--- Recent messages ----------------------------`);
  if (recent.length) {
    for (const m of recent) console.log(`  ${formatMessage(m, spaceId)}`);
  } else {
    console.log(`  (space context unavailable)`);
  }
  console.log(`--- Sending ------------------------------------`);
  console.log(`  → space: ${dest}`);
  if (threadId) console.log(`  → thread reply: ${threadId}`);
  else console.log(`  → new thread`);
  console.log(`  Message: ${message}`);
  console.log(`------------------------------------------------`);
}

export async function cmdSend(args: {
  space: string;
  message: string;
  code: string | undefined;
  dryRun?: boolean | undefined;
}): Promise<void> {
  const { spaceArg, threadId } = splitThread(args.space);
  const hash = intentHash(args.space, args.message);
  const path = pendingPath(hash);

  if (!args.code) {
    await printContext(spaceArg, threadId, args.message);
    const pending: Pending = { space_arg: args.space, message: args.message, created_at: Date.now() };
    writeFileSync(path, JSON.stringify(pending), { mode: 0o600 });
    console.log(`Re-run within ${PENDING_TTL_MS / 1000}s with --code=${hash} to send.`);
    return;
  }

  if (args.code !== hash) {
    console.error(`code mismatch: expected ${hash}, got ${args.code}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(path)) {
    console.error(`no pending intent for code=${hash}. Re-run without --code to start over.`);
    process.exitCode = 1;
    return;
  }
  const pending = JSON.parse(readFileSync(path, "utf8")) as Pending;
  if (Date.now() - pending.created_at > PENDING_TTL_MS) {
    unlinkSync(path);
    console.error(`pending intent expired (>${PENDING_TTL_MS / 1000}s). Re-run without --code.`);
    process.exitCode = 1;
    return;
  }

  const space = await resolveSpace(spaceArg);
  try {
    const result = await sendMessage({
      spaceName: space.name,
      text: args.message,
      threadId,
      dryRun: args.dryRun,
    });
    unlinkSync(path);
    if (args.dryRun) {
      console.log(`✓ dry-run OK (nothing sent) → ${space.name}${threadId ? `:${threadId}` : ""}`);
      return;
    }
    const tid = threadIdOf(result);
    const spaceId = space.name.replace(/^spaces\//, "");
    console.log(`✓ sent to ${space.name} (reply with: gchat send "${spaceId}:${tid}" "...")`);
  } catch (e) {
    if (e instanceof GwsError && e.isScope) {
      console.error(
        `✗ missing scope for chat.messages.create. Check: gchat auth\n  Re-authorize gws with the chat.messages.create scope.`,
      );
      process.exitCode = 3;
      return; // keep pending file so the user can retry after fixing scopes
    }
    throw e;
  }
}
