# gchat-cli — notes for Claude

Thin Google Chat CLI. It reuses the existing `gws` (Google Workspace) CLI as its
backend for credentials + transport — no OAuth of its own. This tool just builds
the nested-JSON Chat API calls, resolves space names, and renders messages.

## Layout

- `ts/cli.ts` — yargs entrypoint (commands: `spaces`/`rooms`/`ls`, `read`, `send`, `tail`, `watch`, `auth`).
- `tail --exit-on-message` = wait-for-reply (matches slack-term; no separate
  `wait` command, since neither slack-cli nor chatwork-cli has one): blocks until
  the next message from someone *other than you* and exits 0. Own-message
  filtering uses `getSelfUserId()` (People API `people/me` → PROFILE source id,
  which equals the Chat `users/<id>`); if unavailable it degrades to "any new
  message". `--timeout` parses `90s/30m/2h/1d` via `parseDuration()`.
- `ts/gws.ts` — the only place that shells out to `gws`. `gwsJson()` runs a
  command, parses JSON off **stdout**, and turns Google's `{"error":{…}}`
  envelope into a `GwsError` (with `.isScope` for 403). Typed helpers:
  `listSpaces`, `listMessages`, `sendMessage`, `authStatus`. Binary overridable
  via `GCHAT_GWS_BIN` (used by tests).
- `ts/space-resolver.ts` — `resolveSpace()` (id / `spaces/<id>` / displayName,
  exact→substring) + `splitThread()` for the `"<space>:<threadId>"` syntax.
- `ts/config.ts` — space cache at `~/.config/gchat-cli/spaces.json` (5-min TTL).
- `ts/format.ts` — table + message rendering; `threadIdOf()` extracts the reply id.
- `ts/commands/*.ts` — one file per command.
- `tests/*.test.ts` — pure-logic tests + a fake-`gws` shell script for `gws.ts`.

## gws quirks this wraps (learned the hard way)

- `gws` prints `Using keyring backend: keyring` (and `error[…]` lines) to
  **stderr**; the machine-readable payload is always JSON on **stdout**.
- On API errors `gws` exits non-zero **and** prints a JSON error envelope on
  stdout → `gwsJson` parses stdout first, falls back to stderr.
- `gws chat spaces messages list` rejects `--format json` (native output is
  already JSON) → never pass `--format` on raw Chat calls.
- Threaded replies need the raw API (`+send` helper can't do threads):
  `messages create --params '{parent, messageReplyOption:"REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"}' --json '{text, thread:{name}}'`.
- No memberships scope here → the API doesn't return sender display names; we
  render `user:…<last6>`.

## Conventions

- `send` is a **two-step confirm**: first call prints recent context +
  `--code=XXXX` and stashes the intent under `$TMPDIR`; re-run the identical
  command with `--code` within 60s to post. `--dry-run` validates via
  `gws --dry-run` without sending.
- Thread reply target is `"<space>:<threadId>"`. The threadId appears in
  `read`/`tail` output as `[thread <space>:<threadId>]`.

## Dev

```bash
bun run typecheck   # tsc --noEmit, strict
bun test            # no network — fake gws binary
```

Verify against real gws (read-only + dry-run, safe):

```bash
bun ts/cli.ts auth
bun ts/cli.ts spaces
bun ts/cli.ts read eng -n 3
bun ts/cli.ts send eng "x" --code=<code> --dry-run
```
