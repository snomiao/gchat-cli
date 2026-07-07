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
| `gchat spaces` | list spaces (newest activity first); `rooms` and `ls` are aliases |
| `gchat read <space> [-n N]` | last N messages, human-readable |
| `gchat send <space[:threadId]> "<msg>"` | send (two-step confirm), optionally into a thread |
| `gchat tail <space> [-n N] [--interval S]` | print backlog then poll for new messages |
| `gchat watch <space..>` | tail several spaces at once, prefixed with `[name]` |
| `gchat wait <space> [--timeout DUR]` | block until the next reply from someone else, print it, exit 0 |
| `gchat auth` | show auth status + required Chat scopes |

### Space names

Anywhere a `<space>` is accepted you can pass (exact match wins over substring):

- a full resource name — `spaces/AAAAxxxx`
- a bare space id — `AAAAxxxx`
- a `displayName`, exact — `Engineering`
- a `displayName`, substring — `eng` (must be unambiguous)

Resolved names are cached at `~/.config/gchat-cli/spaces.json` for 5 minutes
(`gchat spaces` refreshes it).

### The send confirm guard

`gchat send` is two-step on purpose: the first call shows the space's recent
messages and a summary, then prints a `--code=XXXX`. Re-run the identical command
with `--code` within 60s to actually post. This makes an accidental /
wrong-target send hard to do in one keystroke.

Thread vs. new thread, made explicit:

- `gchat send eng "..."` → **new top-level thread** in the space.
- `gchat send "eng:<threadId>" "..."` → **reply** into that thread
  (falls back to a new thread if the id is stale).

## Usage examples

### List spaces — `gchat spaces`

```console
$ gchat spaces
id           type  name
-----------  ----  ----
AAAAxxxx     room  Engineering
9pR5yAAAAE   DM    (direct message)
AAAAf18AgOY  room  announce
```

```bash
# machine-readable (full Chat API objects)
gchat spaces --format json | jq -r '.[] | "\(.name)\t\(.displayName // "(dm)")"'

# `rooms` and `ls` are aliases
gchat rooms
```

### Read recent messages — `gchat read`

```console
$ gchat read eng -n 3
[2026-07-07 11:01] user:…885488: 全員へお願いします … [thread AAAAxxxx:N8yHhSGG8Wk]
[2026-07-07 11:04] user:…340719: すみません、躓きました [thread AAAAxxxx:H1wKYwDJb3g]
[2026-07-07 16:41] user:…875650: 手順を訂正させてください [thread AAAAxxxx:H1wKYwDJb3g]
```

```bash
gchat read Engineering            # by exact displayName
gchat read AAAAxxxx               # by bare space id
gchat read eng -n 50             # last 50 messages
gchat read eng --format json      # raw message objects for scripting
```

The `[thread <space>:<threadId>]` suffix is copy-pasteable straight into
`gchat send` to reply (see below).

### Send a message — `gchat send`

Sending is a **two-step confirm**. The first call previews recent context and
prints a code; re-run the identical command with `--code` to actually post.

```console
$ gchat send eng "デプロイ完了しました 🚀"
--- Recent messages ----------------------------
  [2026-07-07 16:41] user:…875650: 手順を訂正させてください [thread AAAAxxxx:H1wKYwDJb3g]
--- Sending ------------------------------------
  → space: Engineering (spaces/AAAAxxxx)
  → new thread
  Message: デプロイ完了しました 🚀
------------------------------------------------
Re-run within 60s with --code=551f87f5 to send.

$ gchat send eng "デプロイ完了しました 🚀" --code=551f87f5
✓ sent to spaces/AAAAxxxx (reply with: gchat send "AAAAxxxx:H1wKYwDJb3g" "...")
```

Reply **into a thread** — the target is `"<space>:<threadId>"`:

```bash
# threadId comes from `read` / `tail` output, e.g. [thread AAAAxxxx:H1wKYwDJb3g]
gchat send "eng:H1wKYwDJb3g" "確認しました 👍"
gchat send "eng:H1wKYwDJb3g" "確認しました 👍" --code=XXXX
```

Validate a send without posting anything (`--dry-run`):

```console
$ gchat send eng "test" --code=XXXX --dry-run
✓ dry-run OK (nothing sent) → spaces/AAAAxxxx
```

### Follow live — `gchat tail` / `gchat watch`

```bash
# print the last 10 messages, then poll every 20s for new ones (Ctrl-C to stop)
gchat tail eng

# tune the backlog and poll interval
gchat tail eng -n 30 --interval 10

# watch several spaces at once — each line is prefixed with [space]
gchat watch eng announce
```

```console
$ gchat watch eng announce
[Engineering] [2026-07-07 17:02] user:…875650: PR merged [thread AAAAxxxx:H1wKYwDJb3g]
[announce]    [2026-07-07 17:03] user:…112233: 全体会は15時です [thread AAAAf18AgOY:Qb2..]
```

### Wait for a reply — `gchat wait`

`gchat wait` blocks until the **next message from someone other than you**
arrives, prints it, and exits `0` — the "I asked something, wake me when they
answer" pattern. Your own sends are ignored (via the People API self-id), so it
won't return on your own message. It's sugar for `tail --exit-on-message`.

```bash
# send a question, then block until someone replies
gchat send "eng:H1wKYwDJb3g" "この方針で進めて大丈夫ですか？" --code=XXXX
gchat wait "eng:H1wKYwDJb3g"        # returns when a reply lands

# give up after 30 minutes (still exits 0 so a script can branch on it)
gchat wait eng --timeout 30m

# in a script: act on the reply
if reply=$(gchat wait eng --timeout 1h); then echo "got: $reply"; fi
```

`--timeout` accepts `90s`, `30m`, `2h`, `1d`, or a bare number of seconds. The
same behavior is available on `tail` directly via
`gchat tail <space> --exit-on-message [--timeout DUR]`.

### Check auth — `gchat auth`

```console
$ gchat auth
auth method: oauth2  (scopes: 15)
--- Chat scopes --------------------------------
  ✓ chat.spaces.readonly    — gchat spaces
  ✓ chat.messages.readonly  — gchat read / tail / watch
  ✓ chat.messages.create    — gchat send
```

### Handy one-liners

```bash
# grep the last 200 messages of a space
gchat read eng -n 200 --format json | jq -r '.[].text' | grep -i deploy

# find a space id by name
gchat spaces --format json | jq -r '.[] | select(.displayName=="Engineering") | .name'

# post the output of a command into a space (two-step, so pipe the code back)
gchat send eng "$(uptime)"        # then re-run with the printed --code
```

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
