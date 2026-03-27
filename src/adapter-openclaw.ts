/**
 * 🦞 Reef — OpenClaw Adapter
 *
 * Integrates as an OpenClaw plugin:
 * - registerService: persistent relay connection
 * - registerTool: `lobby` tool for the agent
 * - message_sent hook: intercept Feishu @mentions for relay
 */

import type { LobbyAdapter, ServerMessage } from "./types.js";

export interface OpenClawAdapterConfig {
  /** OpenClaw logger */
  log?: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };
  /** Callback when a Feishu relay should be injected as a synthetic event */
  onFeishuInject?: (syntheticEvent: any) => Promise<void>;
}

/**
 * Build a synthetic Feishu message event from a relay message.
 * Can be passed to handleFeishuMessage() in the OpenClaw Feishu plugin.
 */
export function buildSyntheticFeishuEvent(msg: {
  from?: string;
  fromBotOpenId?: string;
  chatId?: string;
  text?: string;
  messageId?: string;
  threadId?: string;
  ts?: number;
}, targetBotOpenId: string) {
  return {
    sender: {
      sender_id: { open_id: msg.fromBotOpenId || `bot:${msg.from}` },
      sender_type: "bot",
    },
    message: {
      message_id: msg.messageId || `relay:${msg.from}:${msg.ts}`,
      chat_id: msg.chatId || "",
      chat_type: "group" as const,
      message_type: "text" as const,
      content: JSON.stringify({ text: msg.text }),
      create_time: String(msg.ts || Date.now()),
      mentions: targetBotOpenId
        ? [{ key: "@_user_relay", id: { open_id: targetBotOpenId }, name: "me" }]
        : undefined,
      ...(msg.threadId ? { root_id: msg.threadId, thread_id: msg.threadId } : {}),
    },
  };
}

/** Parse <at user_id="ou_xxx">Name</at> from outbound text */
export function parseMentions(text: string): Array<{ name: string; openId: string }> {
  const out: Array<{ name: string; openId: string }> = [];
  const re = /<at\s+user_id="([^"]+)">([^<]+)<\/at>/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ openId: m[1], name: m[2].trim() });
  return out;
}

export function createOpenClawAdapter(config?: OpenClawAdapterConfig): LobbyAdapter {
  const log = config?.log || { info: console.log, warn: console.warn, error: console.error };

  return {
    onLobbyMessage(msg) {
      log.info(`🦞 [lobby] ${msg.fromName}: ${msg.text.slice(0, 100)}`);
    },

    onDirectMessage(msg) {
      log.info(`🦞 [DM] ${msg.fromName}: ${msg.text.slice(0, 100)}`);
    },

    onFeishuRelay(msg) {
      log.info(`🦞 [feishu relay] ${msg.fromName} in ${msg.chatId}: ${msg.text.slice(0, 80)}`);
      config?.onFeishuInject?.(msg).catch((err: any) => {
        log.error(`🦞 Feishu inject failed: ${err.message}`);
      });
    },

    onPresence(msg) {
      log.info(`🦞 ${msg.name} ${msg.type === "join" ? "joined" : "left"}`);
    },

    onHistory(messages) {
      log.info(`🦞 Got ${messages.length} history messages`);
    },
  };
}
