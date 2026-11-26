// A stand-in for the `gws` CLI, for the parity cases (rs/parity.json).
//
// gchat-cli has no network code of its own: everything goes through `gws`.
// Both implementations are pointed at this script instead (GCHAT_GWS_BIN, or
// PATH for the cases that prove the default name), so a parity run needs no
// network and no Google account, and can never send anything.
//
// It is driven by two files in the directory the command runs in:
//
//   gws.json         what to answer (written by the case, see below)
//   gws-calls.jsonl  what it was asked: one JSON array of arguments per call.
//                    Cases print this afterwards, so the exact argument list
//                    each implementation built is part of what is compared.
//
// gws.json:
//   { "rules": [ { "args": ["chat","spaces","list"],   // prefix of the arguments
//                  "has": "spaces/AAA",                 // optional: text some argument contains
//                  "replies": [ <reply>, ... ] } ] }    // nth matching call gets the nth reply;
//                                                       // the last one repeats
// The first rule that matches answers. A reply:
//   json    value printed on stdout as JSON          stdout  raw text instead
//   base64  raw bytes instead (invalid UTF-8)        pretty  print `json` indented
//   stderr  text for stderr, after the keyring line  noise   false = no keyring line
//   exit    exit code (default 0)                    sleep   milliseconds to wait first
//   rm      files to delete before answering         signal  die from this signal instead of exiting
//   killParent  signal to send to the calling process (ends a command that never stops by itself)
import fs from "node:fs";

const args = process.argv.slice(2);
fs.appendFileSync("gws-calls.jsonl", JSON.stringify(args) + "\n");

function die(code, message) {
  process.stderr.write(`fake-gws: ${message}\n`);
  process.exit(code);
}

let spec;
try {
  spec = JSON.parse(fs.readFileSync("gws.json", "utf8"));
} catch (err) {
  die(97, `no usable gws.json in ${process.cwd()}: ${err.message}`);
}

const index = spec.rules.findIndex(
  (rule) =>
    rule.args.every((arg, i) => args[i] === arg) &&
    (rule.has === undefined || args.some((arg) => arg.includes(rule.has))),
);
if (index === -1) die(96, `no rule for ${JSON.stringify(args)}`);

// How often this rule has answered before, from a log of its own, so calls
// that overlap in time still each leave a line.
const hitsFile = ".gws-hits";
const hits = fs.existsSync(hitsFile) ? fs.readFileSync(hitsFile, "utf8").split("\n").filter((l) => l === String(index)).length : 0;
fs.appendFileSync(hitsFile, `${index}\n`);
const replies = spec.rules[index].replies;
const reply = replies[Math.min(hits, replies.length - 1)];

if (reply.sleep) await new Promise((resolve) => setTimeout(resolve, reply.sleep));
for (const file of reply.rm || []) fs.rmSync(file, { force: true });
if (reply.killParent) {
  process.kill(process.ppid, reply.killParent);
  process.exit(0);
}

if (reply.noise !== false) fs.writeSync(2, "Using keyring backend: keyring\n");
if (reply.stderr) fs.writeSync(2, reply.stderr);
if (reply.base64 !== undefined) fs.writeSync(1, Buffer.from(reply.base64, "base64"));
else if (reply.stdout !== undefined) fs.writeSync(1, reply.stdout);
else if (reply.json !== undefined) fs.writeSync(1, JSON.stringify(reply.json, null, reply.pretty ? 2 : 0) + "\n");

if (reply.signal) process.kill(process.pid, reply.signal);
else process.exit(reply.exit ?? 0);
