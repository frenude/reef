#!/usr/bin/env node
/**
 * 🦞 Reef — Integration Test
 *
 * Run: npx tsx src/test.ts
 *
 * Tests: lobby broadcast, DM, feishu relay, history, isolation
 */

import { RelayClient } from "./relay-client.js";
import { createClaudeCodeAdapter } from "./adapter-claude-code.js";
import type { LobbyAdapter, ServerMessage } from "./types.js";

const RELAY_URL = process.env.RELAY_URL || "ws://127.0.0.1:9876";
const checks: string[] = [];
const log = (...args: unknown[]) => {}; // silent for tests

function collectingAdapter(name: string): LobbyAdapter {
  return {
    onLobbyMessage(msg) { checks.push(`✅ ${name} saw lobby from ${msg.fromName}`); },
    onDirectMessage(msg) { checks.push(`✅ ${name} got DM from ${msg.fromName}`); },
    onFeishuRelay(msg) { checks.push(`✅ ${name} got feishu relay from ${msg.fromName} in ${msg.chatId}`); },
    onPresence(msg) { /* ignore for test noise */ },
    onHistory(msgs) { if (msgs.length > 0) checks.push(`✅ ${name} got history (${msgs.length})`); },
  };
}

async function run() {
  // WALL-E: has Feishu bot, in group
  const walle = new RelayClient({
    relayUrl: RELAY_URL, lobsterId: "wall-e", name: "WALL-E",
    botOpenId: "ou_walle", groups: ["oc_group1"],
    adapter: collectingAdapter("WALL-E"), log,
  });

  // ORACLE: has Feishu bot, in same group
  const oracle = new RelayClient({
    relayUrl: RELAY_URL, lobsterId: "oracle", name: "ORACLE",
    botOpenId: "ou_oracle", groups: ["oc_group1"],
    adapter: {
      ...collectingAdapter("ORACLE"),
      onFeishuRelay(msg) {
        checks.push(`✅ ORACLE got feishu relay from ${msg.fromName} in ${msg.chatId}`);
        // Reply via DM
        oracle.sendDm("wall-e", "LGTM!");
      },
    }, log,
  });

  // GHOST: lobby-only, no Feishu (Claude Code style)
  const ghost = new RelayClient({
    relayUrl: RELAY_URL, lobsterId: "ghost", name: "GHOST",
    adapter: {
      ...collectingAdapter("GHOST"),
      onFeishuRelay() { checks.push("❌ GHOST wrongly got feishu relay!"); },
    }, log,
  });

  // Start all
  walle.start(); oracle.start(); ghost.start();

  // Wait for connections
  await sleep(1500);

  // Phase 1: GHOST broadcasts in lobby
  ghost.sendLobby("Hey from lobby-only lobster!");
  await sleep(500);

  // Phase 2: WALL-E replies in lobby
  walle.sendLobby("Welcome GHOST!");
  await sleep(500);

  // Phase 3: WALL-E @ORACLE in shared Feishu group
  walle.sendFeishuRelay({
    chatId: "oc_group1",
    text: "@ORACLE help me review",
    mentions: [{ name: "ORACLE", openId: "ou_oracle" }],
  });
  await sleep(1000);

  // Results
  console.log("\n=== 🦞 Test Results ===");
  checks.forEach(c => console.log(c));
  const passed = checks.filter(c => c.startsWith("✅")).length;
  const failed = checks.filter(c => c.startsWith("❌")).length;
  console.log(`\n${failed === 0 && passed >= 5 ? "🦞 ALL PASSED" : "❌ FAILED"} (${passed} pass, ${failed} fail)`);

  walle.stop(); oracle.stop(); ghost.stop();
  process.exit(failed > 0 ? 1 : 0);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

run().catch(console.error);
