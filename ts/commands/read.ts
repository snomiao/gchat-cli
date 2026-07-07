// `gchat read <space> [-n N] [--json]` — last N messages, human-readable.
import { listMessages } from "../gws.ts";
import { resolveSpace, splitThread } from "../space-resolver.ts";
import { formatMessages } from "../format.ts";

export async function cmdRead(args: {
  space: string;
  limit: number;
  format: string;
}): Promise<void> {
  // Accept "<space>:<thread>" too, but read is space-wide — drop the thread part.
  const { spaceArg } = splitThread(args.space);
  const space = await resolveSpace(spaceArg);
  const messages = await listMessages(space.name, Math.max(args.limit, 1));
  // API returns newest-first; show oldest-first like a chat transcript.
  const ordered = messages.slice(0, args.limit).reverse();

  if (args.format === "json") {
    console.log(JSON.stringify(ordered, null, 2));
    return;
  }
  const spaceId = space.name.replace(/^spaces\//, "");
  if (ordered.length === 0) {
    console.log("(no messages)");
    return;
  }
  console.log(formatMessages(ordered, spaceId));
}
