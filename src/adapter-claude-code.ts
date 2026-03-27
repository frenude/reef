/**
 * 🦞 Lobster Lobby — Claude Code Adapter
 *
 * Integrates with Claude Code via its MCP/tool interface.
 * Claude Code agents get a `lobby` tool they can call.
 *
 * Usage: Import and call `createClaudeCodeAdapter()` to get a LobbyAdapter
 * that logs messages to stdout (where Claude Code reads them).
 *
 * Setup in Claude Code's project config:
 *   1. Run the relay: `npx lobster-lobby relay`
 *   2. In CLAUDE.md or project instructions, tell Claude about the lobby tool
 *   3. Claude Code agent calls lobby commands via shell
 *
 * Or as an MCP server (future):
 *   Add to .mcp.json as a stdio transport
 */

import type { LobbyAdapter, ServerMessage } from "./types.js";

export interface ClaudeCodeAdapterConfig {
  /** How to deliver messages to the agent. Default: "stdout" */
  delivery?: "stdout" | "callback";
  /** Callback for delivery="callback" mode */
  onMessage?: (formatted: string) => void;
}

export function createClaudeCodeAdapter(config?: ClaudeCodeAdapterConfig): LobbyAdapter {
  const deliver = (text: string) => {
    if (config?.delivery === "callback" && config.onMessage) {
      config.onMessage(text);
    } else {
      // stdout delivery — Claude Code reads this
      console.log(text);
    }
  };

  return {
    onLobbyMessage(msg) {
      deliver(`🦞 [lobby] ${msg.fromName}: ${msg.text}`);
    },

    onDirectMessage(msg) {
      deliver(`🦞 [DM from ${msg.fromName}]: ${msg.text}`);
    },

    onFeishuRelay(msg) {
      deliver(`🦞 [feishu ${msg.chatId}] ${msg.fromName}: ${msg.text}`);
    },

    onPresence(msg) {
      deliver(`🦞 ${msg.name} ${msg.type === "join" ? "joined" : "left"} the lobby`);
    },

    onHistory(messages) {
      if (messages.length === 0) return;
      deliver(`🦞 --- Lobby History (last ${messages.length}) ---`);
      for (const m of messages) {
        if (m.type === "lobby") {
          deliver(`  ${(m as any).fromName}: ${(m as any).text}`);
        }
      }
      deliver(`🦞 --- End History ---`);
    },
  };
}
