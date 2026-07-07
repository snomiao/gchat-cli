// Thin wrapper around the `gws` (Google Workspace) CLI for the Chat API.
//
// gchat-cli does NOT own an OAuth flow: it shells out to `gws chat ...`, which
// already holds the credentials / keyring. We just build the (ugly) nested-JSON
// invocations, parse the JSON result off stdout, and turn Google's error
// envelope into a typed error.
//
// gws quirks this file papers over:
//   - it prints "Using keyring backend: keyring" (and error[...] lines) to
//     stderr; the machine-readable payload is always JSON on stdout.
//   - on API errors it exits non-zero AND prints a {"error": {...}} envelope to
//     stdout, so we parse stdout first and only fall back to stderr.
//   - `spaces messages list` rejects `--format json` (its native output is
//     already JSON), so we never pass --format for raw calls.
import { spawn } from "node:child_process";

// Allow overriding the binary in tests / non-standard installs. Read lazily so
// GCHAT_GWS_BIN set at runtime (e.g. in tests) is honored.
export function gwsBin(): string {
  return process.env.GCHAT_GWS_BIN || "gws";
}

export class GwsError extends Error {
  constructor(
    public code: number | undefined,
    public reason: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GwsError";
  }

  // True when the failure is a missing OAuth scope (403). gchat send/read need
  // chat.messages.create / chat.messages.readonly / chat.spaces.readonly.
  get isScope(): boolean {
    return this.code === 403 && /insufficient authentication scopes/i.test(this.message);
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Low-level: run `gws <args...>` and capture streams. Never throws on non-zero
// exit — callers decide (some gws errors still carry a useful JSON body).
export function runGws(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const bin = gwsBin();
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      reject(
        new GwsError(
          undefined,
          "spawn",
          `failed to run "${bin}": ${err.message}. Is gws installed and on PATH?`,
        ),
      ),
    );
    child.on("close", (exitCode) =>
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 }),
    );
  });
}

interface ErrorEnvelope {
  error?: { code?: number; message?: string; reason?: string };
}

// Run a gws command that is expected to emit a JSON object on stdout, and return
// it parsed. Turns Google's {"error": {...}} envelope (and hard failures) into a
// GwsError.
export async function gwsJson<T = unknown>(args: string[]): Promise<T> {
  const { stdout, stderr, exitCode } = await runGws(args);
  const trimmed = stdout.trim();

  let parsed: unknown = null;
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON stdout on a non-zero exit → surface stderr; otherwise rethrow.
      if (exitCode !== 0) {
        throw new GwsError(undefined, "exit", cleanStderr(stderr) || trimmed);
      }
      throw new GwsError(undefined, "parse", `could not parse gws output as JSON: ${trimmed.slice(0, 200)}`);
    }
  }

  const env = parsed as ErrorEnvelope | null;
  if (env && env.error) {
    throw new GwsError(env.error.code, env.error.reason, env.error.message ?? "gws error");
  }
  if (exitCode !== 0) {
    throw new GwsError(undefined, "exit", cleanStderr(stderr) || `gws exited with code ${exitCode}`);
  }
  return parsed as T;
}

// Drop gws's noise lines so error messages stay readable.
function cleanStderr(s: string): string {
  return s
    .split("\n")
    .filter((l) => l.trim() && !/^Using keyring backend:/i.test(l))
    .join("\n")
    .trim();
}

// ---------- typed Chat resources (subset gchat-cli uses) ----------

export interface Space {
  name: string; // "spaces/AAQAnrmeCn4"
  displayName?: string; // absent for DIRECT_MESSAGE
  spaceType?: string; // "SPACE" | "DIRECT_MESSAGE" | "GROUP_CHAT"
  spaceUri?: string;
  lastActiveTime?: string;
  membershipCount?: { joinedDirectHumanUserCount?: number };
}

export interface Sender {
  name: string; // "users/1234567890"
  type?: string; // "HUMAN" | "BOT"
  displayName?: string;
}

export interface Message {
  name: string; // "spaces/<id>/messages/<msgId>"
  text?: string;
  formattedText?: string;
  argumentText?: string;
  createTime: string; // ISO 8601
  sender?: Sender;
  thread?: { name: string }; // "spaces/<id>/threads/<threadId>"
  threadReply?: boolean;
}

// ---------- typed endpoint helpers ----------

// List spaces the caller is a member of. Auto-paginates.
export async function listSpaces(): Promise<Space[]> {
  const spaces: Space[] = [];
  let pageToken: string | undefined;
  do {
    const params: Record<string, unknown> = { pageSize: 100 };
    if (pageToken) params.pageToken = pageToken;
    const res = await gwsJson<{ spaces?: Space[]; nextPageToken?: string }>([
      "chat",
      "spaces",
      "list",
      "--params",
      JSON.stringify(params),
    ]);
    if (res.spaces) spaces.push(...res.spaces);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return spaces;
}

// List recent messages of a space, newest first. Note: no `--format json`
// (gws rejects it here). Returns [] for an empty space.
export async function listMessages(spaceName: string, pageSize = 25): Promise<Message[]> {
  const res = await gwsJson<{ messages?: Message[] }>([
    "chat",
    "spaces",
    "messages",
    "list",
    "--params",
    JSON.stringify({ parent: spaceName, pageSize, orderBy: "createTime desc" }),
  ]);
  return res.messages ?? [];
}

export interface SendOpts {
  spaceName: string;
  text: string;
  threadId?: string | undefined; // short id, e.g. "H1wKYwDJb3g"
  dryRun?: boolean | undefined;
}

// Post a message. With threadId it replies into that thread (falling back to a
// new thread if the id is stale); without it, a new top-level thread is created.
export async function sendMessage(opts: SendOpts): Promise<Message> {
  const params: Record<string, unknown> = { parent: opts.spaceName };
  const body: Record<string, unknown> = { text: opts.text };
  if (opts.threadId) {
    params.messageReplyOption = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD";
    body.thread = { name: `${opts.spaceName}/threads/${opts.threadId}` };
  }
  const args = [
    "chat",
    "spaces",
    "messages",
    "create",
    "--params",
    JSON.stringify(params),
    "--json",
    JSON.stringify(body),
  ];
  if (opts.dryRun) args.push("--dry-run");
  return gwsJson<Message>(args);
}

export interface AuthStatus {
  auth_method?: string;
  scopes?: string[];
  scope_count?: number;
  [k: string]: unknown;
}

export async function authStatus(): Promise<AuthStatus> {
  return gwsJson<AuthStatus>(["auth", "status"]);
}

interface PeopleMe {
  metadata?: { sources?: Array<{ type?: string; id?: string }> };
}

// The caller's own Chat user resource name ("users/<id>"), via the People API.
// The PROFILE source id matches the numeric id Chat puts in `sender.name`, so
// this lets `wait` skip the caller's own messages. Returns null if it can't be
// determined (e.g. missing People scope) — callers degrade to "any new message".
export async function getSelfUserId(): Promise<string | null> {
  try {
    const me = await gwsJson<PeopleMe>([
      "people",
      "people",
      "get",
      "--params",
      JSON.stringify({ resourceName: "people/me", personFields: "metadata" }),
    ]);
    const sources = me.metadata?.sources ?? [];
    const profile =
      sources.find((s) => s.type === "PROFILE") ??
      sources.find((s) => s.type === "DOMAIN_PROFILE");
    const id = profile?.id;
    return id ? `users/${id}` : null;
  } catch {
    return null;
  }
}
