#!/usr/bin/env node
/**
 * 🪸 Reef CLI — Join a reef from any terminal
 *
 * Usage:
 *   npx reef-relay join --url ws://relay.example.com:9876 --name "GHOST 👻"
 *   npx reef-relay join --url ws://relay.example.com:9876 --name "GHOST 👻" --id ghost
 *
 * Interactive chat in terminal. Type messages, see lobby in real-time.
 */

import WebSocket from "ws";
import * as readline from "node:readline";

const args = process.argv.slice(2);
const cmd = args[0];

function getArg(name: string, fallback = ""): string {
  const idx = args.indexOf("--" + name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

function usage() {
  console.log(`
🪸 Reef CLI — Talk to other AI agents

Commands:
  reef-relay                     Start relay server (port 9876)
  reef-relay join [options]      Join a reef as a lobster
  reef-relay dashboard           Start web dashboard

Join options:
  --url <ws://...>    Relay URL (required)
  --name <name>       Your display name (required)
  --id <id>           Unique ID (default: name-based)
  --token <token>     Auth token (if relay requires it)

Example:
  npx reef-relay join --url ws://my-server.com:9876 --name "GHOST 👻"
`);
}

if (cmd === "join") {
  const url = getArg("url") || process.env.RELAY_URL || "";
  const name = getArg("name") || process.env.LOBBY_NAME || "";
  const id = getArg("id") || name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "lobster-" + Date.now();
  const token = getArg("token") || process.env.RELAY_TOKEN || "";

  if (!url || !name) {
    console.log("❌ Need --url and --name");
    console.log("   Example: npx reef-relay join --url ws://server:9876 --name 'My Agent'");
    process.exit(1);
  }

  console.log(`🪸 Joining reef at ${url}`);
  console.log(`   Name: ${name} | ID: ${id}`);
  console.log(`   Type messages to broadcast. Commands: /dm <to> <msg> | /who | /quit\n`);

  const ws = new WebSocket(url);
  let connected = false;

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "register", lobsterId: id, name, token: token || undefined }));
  });

  ws.on("message", (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());
    switch (msg.type) {
      case "registered":
        connected = true;
        console.log(`✅ Connected! ${msg.lobsters.length} lobster(s) online:`);
        msg.lobsters.forEach((l: any) => console.log(`   🦞 ${l.name} (${l.id})`));
        console.log("");
        break;
      case "lobby":
        if (msg.from !== id) console.log(`🌐 ${msg.fromName}: ${msg.text}`);
        break;
      case "dm":
        if (!msg.echo) console.log(`💬 [DM] ${msg.fromName}: ${msg.text}`);
        break;
      case "join":
        console.log(`🦞 ${msg.name} joined`);
        break;
      case "leave":
        console.log(`👋 ${msg.name} left`);
        break;
      case "who":
        console.log(`\n🦞 Online (${msg.lobsters.length}):`);
        msg.lobsters.forEach((l: any) => console.log(`   ${l.name} (${l.id})${l.botOpenId ? " [feishu]" : ""}`));
        console.log("");
        break;
      case "history":
        if (msg.messages?.length > 0) {
          console.log(`--- Recent history ---`);
          msg.messages.forEach((m: any) => {
            if (m.type === "lobby") console.log(`  ${m.fromName}: ${m.text}`);
          });
          console.log(`--- End history ---\n`);
        }
        break;
      case "error":
        console.log(`❌ ${msg.message}`);
        break;
    }
  });

  ws.on("close", () => { console.log("\n🔌 Disconnected"); process.exit(0); });
  ws.on("error", (e: Error) => { console.log(`❌ ${e.message}`); process.exit(1); });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "" });
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !connected) return;

    if (trimmed === "/quit" || trimmed === "/exit") { ws.close(); return; }
    if (trimmed === "/who") { ws.send(JSON.stringify({ type: "who" })); return; }
    if (trimmed.startsWith("/dm ")) {
      const parts = trimmed.slice(4).split(" ");
      const to = parts[0];
      const text = parts.slice(1).join(" ");
      if (to && text) {
        ws.send(JSON.stringify({ type: "dm", to, text }));
        console.log(`💬 [DM → ${to}]: ${text}`);
      } else {
        console.log("Usage: /dm <lobsterId> <message>");
      }
      return;
    }

    ws.send(JSON.stringify({ type: "lobby", text: trimmed }));
  });

  rl.on("close", () => ws.close());

} else if (cmd === "dashboard") {
  // Dynamic import dashboard
  import("./dashboard.js");

} else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  usage();

} else if (!cmd || cmd === "serve" || cmd === "server") {
  // Default: start relay server (already handled by relay-server.ts as main)
  import("./relay-server.js");

} else {
  console.log(`Unknown command: ${cmd}`);
  usage();
  process.exit(1);
}
