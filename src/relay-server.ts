#!/usr/bin/env node
/**
 * 🦞 Reef — Relay Server
 *
 * Run: npx tsx src/relay-server.ts
 * Or:  RELAY_TOKEN=secret node dist/relay-server.js
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage, LobsterInfo, MentionTarget } from "./types.js";

const PORT = parseInt(process.env.PORT || "9876", 10);
const RELAY_TOKEN = process.env.RELAY_TOKEN || "";
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || "200", 10);

// --- State ---

interface Lobster {
  ws: WebSocket;
  id: string;
  name: string;
  botOpenId: string | null;
  groups: Set<string>;
  meta: Record<string, unknown>;
  connectedAt: number;
  lastPing: number;
}

const lobsters = new Map<string, Lobster>();
const botOpenIdIndex = new Map<string, string>();  // botOpenId → lobsterId
const botNameIndex = new Map<string, string>();    // name.lower → lobsterId
const lobbyHistory: ServerMessage[] = [];

// --- Server ---

const wss = new WebSocketServer({ port: PORT });

console.log(`🦞 Reef — ws://0.0.0.0:${PORT}`);
if (RELAY_TOKEN) console.log(`   Auth: token required`);

wss.on("connection", (ws: WebSocket) => {
  let registeredId: string | null = null;

  ws.on("message", (raw: Buffer) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { type: "error", message: "Invalid JSON" }); }

    switch (msg.type) {
      case "register": handleRegister(ws, msg); registeredId = msg.lobsterId; break;
      case "lobby":    handleLobby(ws, msg, registeredId); break;
      case "dm":       handleDm(ws, msg, registeredId); break;
      case "feishu":   handleFeishu(ws, msg, registeredId); break;
      case "history":  handleHistory(ws, registeredId); break;
      case "ping":
        if (registeredId && lobsters.has(registeredId)) lobsters.get(registeredId)!.lastPing = Date.now();
        send(ws, { type: "pong" });
        break;
      case "who":
        send(ws, { type: "who", lobsters: listLobsters() });
        break;
      default:
        send(ws, { type: "error", message: `Unknown: ${(msg as any).type}` });
    }
  });

  ws.on("close", () => {
    if (registeredId && lobsters.has(registeredId)) {
      const info = lobsters.get(registeredId)!;
      cleanup(registeredId);
      broadcast({ type: "leave", lobsterId: registeredId, name: info.name, ts: Date.now() }, registeredId);
      console.log(`🦞 ${info.name} left [${lobsters.size} online]`);
    }
  });

  ws.on("error", (err: Error) => {
    console.error(`WS error (${registeredId || "?"}):`, err.message);
  });
});

// --- Handlers ---

function handleRegister(ws: WebSocket, msg: ClientMessage & { type: "register" }) {
  const { lobsterId, name, botOpenId, token, groups, meta } = msg;
  if (!lobsterId || !name) return send(ws, { type: "error", message: "Missing lobsterId/name" });
  if (RELAY_TOKEN && token !== RELAY_TOKEN) return send(ws, { type: "error", message: "Invalid token" });

  // Evict old connection
  if (lobsters.has(lobsterId)) {
    const old = lobsters.get(lobsterId)!;
    try { old.ws.close(4001, "replaced"); } catch {}
    cleanup(lobsterId);
  }

  const info: Lobster = {
    ws, id: lobsterId,
    name: name.trim(),
    botOpenId: botOpenId?.trim() || null,
    groups: new Set(Array.isArray(groups) ? groups : []),
    meta: meta || {},
    connectedAt: Date.now(),
    lastPing: Date.now(),
  };
  lobsters.set(lobsterId, info);
  if (info.botOpenId) botOpenIdIndex.set(info.botOpenId, lobsterId);
  botNameIndex.set(info.name.toLowerCase(), lobsterId);

  send(ws, { type: "registered", lobsterId, lobsters: listLobsters() });
  broadcast({ type: "join", lobsterId, name: info.name, ts: Date.now() }, lobsterId);

  // Send recent history on connect
  if (lobbyHistory.length > 0) {
    send(ws, { type: "history", messages: lobbyHistory.slice(-50) });
  }

  console.log(`🦞 ${info.name} (${lobsterId}${info.botOpenId ? `, bot=${info.botOpenId}` : ""}) joined [${lobsters.size} online]`);
}

function handleLobby(ws: WebSocket, msg: { text: string }, senderId: string | null) {
  if (!senderId || !lobsters.has(senderId)) return send(ws, { type: "error", message: "Not registered" });
  const sender = lobsters.get(senderId)!;
  const text = msg.text?.trim();
  if (!text) return send(ws, { type: "error", message: "Empty text" });

  const payload: ServerMessage = { type: "lobby", from: senderId, fromName: sender.name, text, ts: Date.now() };
  lobbyHistory.push(payload);
  if (lobbyHistory.length > MAX_HISTORY) lobbyHistory.shift();

  for (const [, info] of lobsters) send(info.ws, payload);
}

function handleDm(ws: WebSocket, msg: { to: string; text: string }, senderId: string | null) {
  if (!senderId || !lobsters.has(senderId)) return send(ws, { type: "error", message: "Not registered" });
  const sender = lobsters.get(senderId)!;
  if (!msg.to || !msg.text?.trim()) return send(ws, { type: "error", message: "Missing to/text" });

  const targetId = lobsters.has(msg.to) ? msg.to : botNameIndex.get(msg.to.toLowerCase()) || null;
  if (!targetId || !lobsters.has(targetId)) {
    return send(ws, { type: "error", message: `'${msg.to}' not found. Online: ${[...lobsters.keys()].join(", ")}` });
  }

  const payload: ServerMessage = { type: "dm", from: senderId, fromName: sender.name, text: msg.text.trim(), ts: Date.now() };
  send(lobsters.get(targetId)!.ws, payload);
  send(ws, { ...payload, echo: true });
}

function handleFeishu(ws: WebSocket, msg: { chatId: string; text: string; messageId?: string; threadId?: string; mentions?: MentionTarget[] }, senderId: string | null) {
  if (!senderId || !lobsters.has(senderId)) return send(ws, { type: "error", message: "Not registered" });
  const sender = lobsters.get(senderId)!;
  if (!sender.botOpenId) return send(ws, { type: "error", message: "No botOpenId — Feishu relay needs it" });
  if (!msg.chatId || !msg.text) return send(ws, { type: "error", message: "Missing chatId/text" });

  const payload: ServerMessage = {
    type: "feishu", from: senderId, fromName: sender.name, fromBotOpenId: sender.botOpenId,
    chatId: msg.chatId, text: msg.text, messageId: msg.messageId || `relay-${senderId}-${Date.now()}`,
    threadId: msg.threadId, ts: Date.now(),
  };

  let targets: string[] = [];
  if (Array.isArray(msg.mentions) && msg.mentions.length > 0) {
    for (const m of msg.mentions) {
      const tid = (m.openId && botOpenIdIndex.get(m.openId)) || (m.name && botNameIndex.get(m.name.trim().toLowerCase()));
      if (tid && tid !== senderId && lobsters.has(tid)) targets.push(tid);
    }
  } else {
    for (const [id, info] of lobsters) {
      if (id !== senderId && (info.groups.has(msg.chatId) || info.groups.size === 0)) targets.push(id);
    }
  }

  targets = [...new Set(targets)];
  for (const tid of targets) send(lobsters.get(tid)!.ws, payload);
  if (targets.length > 0) {
    console.log(`🦞 Feishu: ${sender.name} → [${targets.map(t => lobsters.get(t)?.name).join(", ")}] in ${msg.chatId}`);
  }
}

function handleHistory(ws: WebSocket, senderId: string | null) {
  if (!senderId) return send(ws, { type: "error", message: "Not registered" });
  send(ws, { type: "history", messages: lobbyHistory.slice(-50) });
}

// --- Helpers ---

function cleanup(lobsterId: string) {
  const info = lobsters.get(lobsterId);
  if (!info) return;
  if (info.botOpenId) botOpenIdIndex.delete(info.botOpenId);
  botNameIndex.delete(info.name.toLowerCase());
  lobsters.delete(lobsterId);
}

function listLobsters(): LobsterInfo[] {
  return [...lobsters.values()].map(l => ({
    id: l.id, name: l.name, botOpenId: l.botOpenId || undefined,
    groups: [...l.groups], connectedAt: l.connectedAt,
  }));
}

function broadcast(payload: ServerMessage, excludeId?: string) {
  for (const [id, info] of lobsters) {
    if (id !== excludeId) send(info.ws, payload);
  }
}

function send(ws: WebSocket, data: ServerMessage) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

// Evict stale every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, info] of lobsters) {
    if (now - info.lastPing > 120_000) {
      console.log(`🦞 Evicting stale: ${info.name}`);
      try { info.ws.close(4002, "stale"); } catch {}
      cleanup(id);
      broadcast({ type: "leave", lobsterId: id, name: info.name, ts: Date.now() });
    }
  }
}, 60_000);
