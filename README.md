# gchat-cli

A thin, ergonomic **Google Chat** CLI: list spaces, read / send / tail messages
from the terminal, with space-name resolution and a send confirm-guard.

It uses the existing `gws` (Google Workspace) credentials under the hood, so
there's **no** second OAuth flow to set up — and it turns the otherwise ugly
nested-JSON Chat API calls into simple commands.

Before / after:

```bash
# before — the raw nested-JSON call
gws chat spaces messages create \
  --params '{"parent":"spaces/AAAAxxxx","messageReplyOption":"REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"}' \
  --json '{"text":"hi","thread":{"name":"spaces/AAAAxxxx/threads/TTTTyyyy"}}'

# after — gchat
gchat send "myteam:TTTTyyyy" "hi"
```

## Install

Requires [Bun](https://bun.sh) ≥ 1.1 and a working `gws` on `PATH` (that's where
the Google credentials live).

```bash
bun install
bun link          # exposes `gchat` globally (uses the "bin" in package.json)
```

## Auth

gchat-cli has **no** login of its own — it reuses the existing Google Workspace
credentials. Check that the Chat scopes are granted:

```bash
gchat auth
#   ✓ chat.spaces.readonly    — gchat spaces
#   ✓ chat.messages.readonly  — gchat read / tail / watch
#   ✓ chat.messages.create    — gchat send
```

If a scope is missing (`403 insufficient authentication scopes`), re-authorize
to grant it.

## Commands

| command | purpose |
| --- | --- |
| `gchat spaces` | list spaces (newest activity first); `rooms` is an alias |
| `gchat read <space> [-n N]` | last N messages, human-readable |
| `gchat send <space[:threadId]> "<msg>"` | send (two-step confirm), optionally into a thread |
| `gchat tail <space> [-n N] [--interval S]` | print backlog then poll for new messages |
| `gchat watch <space..>` | tail several spaces at once, prefixed with `[name]` |
| `gchat auth` | show auth status + required Chat scopes |

### Space names

Anywhere a `<space>` is accepted you can pass (exact match wins over substring):

- a full resource name — `spaces/AAAAxxxx`
- a bare space id — `AAAAxxxx`
- a `displayName`, exact — `Engineering`
- a `displayName`, substring — `eng` (must be unambiguous)

Resolved names are cached at `~/.config/gchat-cli/spaces.json` for 5 minutes
(`gchat spaces` refreshes it).

### Examples

```bash
# list spaces
gchat spaces
gchat spaces --format json

# read the last 15 messages of a space (resolved by substring)
gchat read eng -n 15

# send a NEW thread to a space (two-step confirm)
gchat send eng "デプロイ完了しました"
#   … prints recent context + "Re-run within 60s with --code=XXXX to send."
gchat send eng "デプロイ完了しました" --code=XXXX

# REPLY into a thread — the target is "<space>:<threadId>".
# The threadId is shown in `read`/`tail` output as "[thread <space>:<threadId>]".
gchat send "eng:TTTTyyyy" "確認しました"
gchat send "eng:TTTTyyyy" "確認しました" --code=XXXX

# validate a send without posting anything
gchat send eng "test" --code=XXXX --dry-run

# live-follow one or many spaces
gchat tail eng
gchat watch eng "announce"
```

### The send confirm guard

`gchat send` is two-step on purpose: the first call shows the space's recent
messages and a summary, then prints a `--code=XXXX`. Re-run the identical command
with `--code` within 60s to actually post. This makes an accidental /
wrong-target send hard to do in one keystroke.

Thread vs. new thread, made explicit:

- `gchat send eng "..."` → **new top-level thread** in the space.
- `gchat send "eng:<threadId>" "..."` → **reply** into that thread
  (falls back to a new thread if the id is stale).

## Notes / limitations

- Sender display names are **not** shown — the Chat API only returns
  `users/<id>` without the memberships scope, so messages render as
  `user:…<last6>`. Message text and mentions are shown as the API returns them.
- Set `GCHAT_GWS_BIN` to point at a non-default backend binary.

## Development

```bash
bun run typecheck
bun test
```
