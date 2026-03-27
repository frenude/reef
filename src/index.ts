/**
 * 🦞 Lobster Lobby — Package exports
 */

export type {
  LobsterIdentity,
  ClientMessage,
  ServerMessage,
  MentionTarget,
  LobsterInfo,
  LobbyAdapter,
} from "./types.js";

export { RelayClient, type RelayClientConfig } from "./relay-client.js";
export { createClaudeCodeAdapter, type ClaudeCodeAdapterConfig } from "./adapter-claude-code.js";
export { createOpenClawAdapter, buildSyntheticFeishuEvent, parseMentions, type OpenClawAdapterConfig } from "./adapter-openclaw.js";
