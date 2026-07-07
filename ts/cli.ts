#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { cmdSpaces } from "./commands/spaces.ts";
import { cmdRead } from "./commands/read.ts";
import { cmdSend } from "./commands/send.ts";
import { cmdTail } from "./commands/tail.ts";
import { cmdWatch } from "./commands/watch.ts";
import { cmdAuth } from "./commands/auth.ts";
import { GwsError } from "./gws.ts";

const spaceDesc =
  "space id, spaces/<id>, or displayName (exact match first, then substring)";

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName("gchat")
    .usage("$0 <command> [args]")
    .command(
      ["spaces", "rooms", "ls"],
      "List spaces you're a member of (newest activity first)",
      (y) =>
        y.option("format", {
          type: "string",
          choices: ["table", "json"] as const,
          default: "table",
        }),
      async (argv) => {
        await cmdSpaces({ format: argv.format as string });
      },
    )
    .command(
      "read <space>",
      "Read the last N messages of a space",
      (y) =>
        y
          .positional("space", { type: "string", describe: spaceDesc })
          .option("limit", { alias: "n", type: "number", default: 20 })
          .option("format", { type: "string", choices: ["text", "json"] as const, default: "text" })
          .demandOption(["space"]),
      async (argv) => {
        await cmdRead({
          space: argv.space as string,
          limit: argv.limit as number,
          format: argv.format as string,
        });
      },
    )
    .command(
      "send <space> <message>",
      'Send a message (two-step: first call returns --code, re-run with it to commit). Reply into a thread with "<space>:<threadId>".',
      (y) =>
        y
          .positional("space", { type: "string", describe: `${spaceDesc}; append :<threadId> to reply` })
          .positional("message", { type: "string", describe: "message body" })
          .option("code", { type: "string", describe: "confirm code from the first call" })
          .option("dry-run", { type: "boolean", default: false, describe: "validate via gws --dry-run, send nothing" })
          .demandOption(["space", "message"]),
      async (argv) => {
        await cmdSend({
          space: argv.space as string,
          message: argv.message as string,
          code: argv.code as string | undefined,
          dryRun: argv["dry-run"] as boolean | undefined,
        });
      },
    )
    .command(
      "tail <space>",
      "Print last N messages then poll for new ones (Ctrl-C to stop)",
      (y) =>
        y
          .positional("space", { type: "string", describe: spaceDesc })
          .option("limit", { alias: "n", type: "number", default: 10, describe: "initial backlog count" })
          .option("interval", { type: "number", default: 20, describe: "poll interval in seconds" })
          .option("exit-on-message", { type: "boolean", default: false, describe: "stop as soon as the first new message from someone else arrives (wait-for-reply)" })
          .option("timeout", { type: "string", describe: "auto-stop after this long (e.g. 90s, 30m, 2h); exit 0 even if nothing arrived" })
          .option("format", { type: "string", choices: ["text", "json"] as const, default: "text" })
          .demandOption(["space"]),
      async (argv) => {
        await cmdTail({
          space: argv.space as string,
          limit: argv.limit as number,
          interval: argv.interval as number,
          format: argv.format as string,
          exitOnMessage: argv["exit-on-message"] as boolean,
          ...(argv.timeout !== undefined ? { timeout: argv.timeout as string } : {}),
        });
      },
    )
    .command(
      "watch <spaces..>",
      "Tail multiple spaces concurrently; each line is prefixed with [space]",
      (y) =>
        y
          .positional("spaces", { type: "string", array: true, describe: "space id / name list" })
          .option("limit", { alias: "n", type: "number", default: 10, describe: "initial backlog per space" })
          .option("interval", { type: "number", default: 20, describe: "poll interval in seconds" })
          .option("format", { type: "string", choices: ["text", "json"] as const, default: "text" })
          .demandOption(["spaces"]),
      async (argv) => {
        await cmdWatch({
          spaces: argv.spaces as string[],
          limit: argv.limit as number,
          interval: argv.interval as number,
          format: argv.format as string,
        });
      },
    )
    .command(
      "auth",
      "Show gws auth status and whether the Chat scopes gchat needs are granted",
      (y) =>
        y.option("format", { type: "string", choices: ["text", "json"] as const, default: "text" }),
      async (argv) => {
        await cmdAuth({ format: argv.format as string });
      },
    )
    .demandCommand(1, "Pick a command: spaces | read | send | tail | watch | auth")
    .strict()
    .help()
    .alias("h", "help")
    .fail((msg, err) => {
      if (err) throw err;
      console.error(`gchat: ${msg}`);
      process.exit(1);
    })
    .parseAsync();
}

main().catch((err: unknown) => {
  if (err instanceof GwsError) {
    if (err.isScope) {
      console.error(`gchat: missing OAuth scope (403). Run: gchat auth`);
    } else {
      console.error(`gchat: gws error${err.code ? ` ${err.code}` : ""}: ${err.message.slice(0, 300)}`);
    }
  } else if (err instanceof Error) {
    console.error(`gchat: ${err.message}`);
  } else {
    console.error(`gchat: unknown error`, err);
  }
  process.exit(1);
});
