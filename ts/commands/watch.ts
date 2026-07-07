// `gchat watch <space1> <space2> ...`
// Tail multiple spaces concurrently; each printed line is prefixed with a name.
import { resolveSpace, splitThread } from "../space-resolver.ts";
import { tailSpace } from "./tail.ts";

export async function cmdWatch(args: {
  spaces: string[];
  limit: number;
  interval: number;
  format: string;
}): Promise<void> {
  const resolved = await Promise.all(
    args.spaces.map(async (arg) => {
      const { spaceArg } = splitThread(arg);
      const space = await resolveSpace(spaceArg);
      const label = space.displayName || space.name.replace(/^spaces\//, "");
      return { name: space.name, label };
    }),
  );

  await Promise.all(
    resolved.map(({ name, label }) =>
      tailSpace({
        spaceName: name,
        initialLimit: args.limit,
        intervalSec: args.interval,
        format: args.format,
        prefix: label,
      }),
    ),
  );
}
