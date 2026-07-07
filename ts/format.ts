// Human-readable rendering of spaces and messages.
//
// Note: the Chat API (without the memberships scope, which gws here lacks) does
// not return sender display names — only "users/<numeric-id>". We show a short
// id so output stays readable; mentions in text are left as the API renders them.
import type { Message, Space } from "./gws.ts";

// ISO 8601 → "YYYY-MM-DD HH:MM" in local time.
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// "spaces/X/threads/ABC" | "spaces/X/messages/ABC.DEF" → "ABC" (the thread id).
export function threadIdOf(m: Message): string {
  const t = m.thread?.name;
  if (t) return t.slice(t.lastIndexOf("/") + 1);
  // Fall back to the message-id prefix (Chat uses <threadId>.<msgId>).
  const msgId = m.name.slice(m.name.lastIndexOf("/") + 1);
  const dot = msgId.indexOf(".");
  return dot === -1 ? msgId : msgId.slice(0, dot);
}

// "users/114836537158851875650" → "user:…875650" (short, stable, readable).
function shortSender(m: Message): string {
  const raw = m.sender?.displayName || m.sender?.name || "unknown";
  if (raw.startsWith("users/")) {
    const id = raw.slice("users/".length);
    const tail = id.length > 6 ? id.slice(-6) : id;
    const kind = m.sender?.type === "BOT" ? "bot" : "user";
    return `${kind}:…${tail}`;
  }
  return raw;
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ⏎ ").trim();
}

export function formatSpacesTable(spaces: Space[]): string {
  const rows = spaces.map((s) => ({
    id: s.name.replace(/^spaces\//, ""),
    type: (s.spaceType ?? "").replace("DIRECT_MESSAGE", "DM").replace("SPACE", "room"),
    name: s.displayName ?? "(direct message)",
  }));
  const w = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    type: Math.max(4, ...rows.map((r) => r.type.length)),
  };
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  return [
    `${pad("id", w.id)}  ${pad("type", w.type)}  name`,
    `${"-".repeat(w.id)}  ${"-".repeat(w.type)}  ----`,
    ...rows.map((r) => `${pad(r.id, w.id)}  ${pad(r.type, w.type)}  ${r.name}`),
  ].join("\n");
}

// Render one message. `spaceId` (short) is included in the thread hint so the
// user can copy "<spaceId>:<threadId>" straight into `gchat send`.
export function formatMessage(m: Message, spaceId?: string): string {
  const t = formatTime(m.createTime);
  const who = shortSender(m);
  const body = oneLine(m.text ?? m.formattedText ?? m.argumentText ?? "(no text)");
  const tid = threadIdOf(m);
  const reply = spaceId ? ` [thread ${spaceId}:${tid}]` : ` [thread :${tid}]`;
  return `[${t}] ${who}: ${body}${reply}`;
}

export function formatMessages(messages: Message[], spaceId?: string): string {
  return messages.map((m) => formatMessage(m, spaceId)).join("\n");
}
