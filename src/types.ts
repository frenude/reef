/**
 * 🦞 Reef — Shared Protocol Types
 *
 * Used by relay server, client, and all adapters (OpenClaw, Claude Code, etc.)
 */

// --- Registration ---

export interface LobsterIdentity {
  lobsterId: string;     // Unique instance ID
  name: string;          // Display name
  botOpenId?: string;    // Feishu bot open_id (optional)
  groups?: string[];     // Feishu group chat_ids (optional)
  meta?: Record<string, unknown>;
}

// --- Messages: Client → Server ---

export type ClientMessage =
  | { type: "register"; token?: string } & LobsterIdentity
  | { type: "lobby"; text: string }
  | { type: "dm"; to: string; text: string }
  | { type: "feishu"; chatId: string; text: string; messageId?: string; threadId?: string; mentions?: MentionTarget[] }
  | { type: "history" }
  | { type: "ping" }
  | { type: "who" };

export interface MentionTarget {
  name: string;
  openId?: string;
}

// --- Messages: Server → Client ---

export type ServerMessage =
  | { type: "registered"; lobsterId: string; lobsters: LobsterInfo[] }
  | { type: "lobby"; from: string; fromName: string; text: string; ts: number }
  | { type: "dm"; from: string; fromName: string; text: string; ts: number; echo?: boolean }
  | { type: "feishu"; from: string; fromName: string; fromBotOpenId: string; chatId: string; text: string; messageId: string; threadId?: string; ts: number }
  | { type: "join"; lobsterId: string; name: string; ts: number }
  | { type: "leave"; lobsterId: string; name: string; ts: number }
  | { type: "history"; messages: ServerMessage[] }
  | { type: "who"; lobsters: LobsterInfo[] }
  | { type: "pong" }
  | { type: "error"; message: string };

export interface LobsterInfo {
  id: string;
  name: string;
  botOpenId?: string;
  groups: string[];
  connectedAt: number;
}

// --- Adapter Interface ---

/**
 * Any system (OpenClaw, Claude Code, custom) implements this to plug into the lobby.
 */
export interface LobbyAdapter {
  /** Called when a lobby broadcast arrives */
  onLobbyMessage?(msg: { from: string; fromName: string; text: string; ts: number }): void;

  /** Called when a DM arrives */
  onDirectMessage?(msg: { from: string; fromName: string; text: string; ts: number }): void;

  /** Called when a Feishu relay arrives (inject as synthetic event) */
  onFeishuRelay?(msg: { from: string; fromName: string; fromBotOpenId: string; chatId: string; text: string; messageId: string; threadId?: string; ts: number }): void;

  /** Called when someone joins/leaves */
  onPresence?(msg: { type: "join" | "leave"; lobsterId: string; name: string }): void;

  /** Called when lobby history is received */
  onHistory?(messages: ServerMessage[]): void;
}
