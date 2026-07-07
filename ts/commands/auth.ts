// `gchat auth` — show whether gws is authorized with the Chat scopes gchat needs.
import { authStatus } from "../gws.ts";

const NEEDED = [
  { scope: "https://www.googleapis.com/auth/chat.spaces.readonly", for: "gchat spaces" },
  { scope: "https://www.googleapis.com/auth/chat.messages.readonly", for: "gchat read / tail / watch" },
  { scope: "https://www.googleapis.com/auth/chat.messages.create", for: "gchat send" },
];

export async function cmdAuth(opts: { format: string }): Promise<void> {
  const status = await authStatus();
  if (opts.format === "json") {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  const have = new Set(status.scopes ?? []);
  console.log(`auth method: ${status.auth_method ?? "unknown"}  (scopes: ${status.scope_count ?? have.size})`);
  console.log(`--- Chat scopes --------------------------------`);
  let missing = false;
  for (const n of NEEDED) {
    const ok = have.has(n.scope);
    if (!ok) missing = true;
    const short = n.scope.replace("https://www.googleapis.com/auth/", "");
    console.log(`  ${ok ? "✓" : "✗"} ${short}  — ${n.for}`);
  }
  if (missing) {
    console.log(`------------------------------------------------`);
    console.log(`Some scopes are missing. Re-authorize gws to grant them (see gws docs).`);
    process.exitCode = 1;
  }
}
