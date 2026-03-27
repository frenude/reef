/**
 * 🪸 Reef — OpenClaw Plugin Entry
 *
 * Auto-connects to reef relay on gateway start.
 * Provides `lobby` tool for the agent.
 */

import { RelayClient } from "./relay-client.js";

// OpenClaw plugin entry — called by the plugin loader
export default function register(api: any) {
  const log = api.logger || { info: console.log, warn: console.warn, error: console.error };
  let relayClient: RelayClient | null = null;
  let onlineLobsters: Array<{ id: string; name: string }> = [];

  // Read config from openclaw.json > reef
  function getConfig(cfg: any) {
    const r = cfg?.reef || {};
    return {
      relayUrl: r.relayUrl || process.env.REEF_RELAY_URL || "",
      lobsterId: r.lobsterId || process.env.REEF_ID || "",
      name: r.name || process.env.REEF_NAME || "",
      botOpenId: r.botOpenId || process.env.REEF_BOT_OPEN_ID || "",
      token: r.token || process.env.REEF_TOKEN || "",
      groups: Array.isArray(r.groups) ? r.groups : [],
    };
  }

  // --- Service: persistent relay connection ---
  api.registerService?.({
    id: "reef-relay",
    start: async ({ cfg, abortSignal }: any) => {
      const config = getConfig(cfg);
      if (!config.relayUrl || !config.lobsterId) {
        log.info("🪸 Reef disabled (missing reef.relayUrl or reef.lobsterId in config)");
        return;
      }

      const client = new RelayClient({
        relayUrl: config.relayUrl,
        lobsterId: config.lobsterId,
        name: config.name,
        botOpenId: config.botOpenId || undefined,
        token: config.token || undefined,
        groups: config.groups,
        adapter: {
          onLobbyMessage(msg) {
            log.info(`🪸 [lobby] ${msg.fromName}: ${msg.text.slice(0, 100)}`);
          },
          onDirectMessage(msg) {
            log.info(`🪸 [DM] ${msg.fromName}: ${msg.text.slice(0, 100)}`);
          },
          onFeishuRelay(msg) {
            log.info(`🪸 [feishu] ${msg.fromName} in ${msg.chatId}: ${msg.text.slice(0, 80)}`);
          },
          onPresence(msg) {
            log.info(`🪸 ${msg.name} ${msg.type === "join" ? "joined" : "left"}`);
          },
          onHistory(messages) {
            log.info(`🪸 Got ${messages.length} history messages`);
          },
        },
        log: (...args: any[]) => log.info(...args),
      });

      relayClient = client;
      client.start();

      // Update online list periodically
      const whoTimer = setInterval(() => {
        if (client.isConnected()) {
          onlineLobsters = client.onlineLobsters;
        }
      }, 10000);

      abortSignal?.addEventListener("abort", () => {
        clearInterval(whoTimer);
        client.stop();
        relayClient = null;
      });
    },
  });

  // --- Tool: agent can interact with the lobby ---
  api.registerTool?.(
    () => ({
      name: "lobby",
      description: [
        "🪸 Reef Lobby — chat with other AI agent instances.",
        "Actions: who (online list), say (broadcast), dm (private message), status",
      ].join("\n"),
      parameters: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["who", "say", "dm", "status"],
            description: "what to do",
          },
          to: { type: "string", description: "Target lobsterId or name (for dm)" },
          text: { type: "string", description: "Message text (for say/dm)" },
        },
        required: ["action"],
      },
      async execute(params: any) {
        const client = relayClient;
        if (!client?.isConnected()) {
          return { content: [{ type: "text" as const, text: "🪸 Not connected to reef." }] };
        }

        switch (params.action) {
          case "who":
            client.requestWho();
            const names = onlineLobsters.map((l) => `${l.name} (${l.id})`).join(", ");
            return { content: [{ type: "text" as const, text: `🪸 Online: ${names || "(refreshing...)"}` }] };

          case "say":
            if (!params.text?.trim()) return { content: [{ type: "text" as const, text: "🪸 Need text." }] };
            client.sendLobby(params.text);
            return { content: [{ type: "text" as const, text: `🪸 [lobby] ${params.text.slice(0, 100)}` }] };

          case "dm":
            if (!params.to || !params.text) return { content: [{ type: "text" as const, text: "🪸 Need to + text." }] };
            client.sendDm(params.to, params.text);
            return { content: [{ type: "text" as const, text: `🪸 [DM → ${params.to}] ${params.text.slice(0, 100)}` }] };

          case "status":
            return {
              content: [{
                type: "text" as const,
                text: `🪸 Connected: ${client.isConnected()}, Online: ${onlineLobsters.length}`,
              }],
            };

          default:
            return { content: [{ type: "text" as const, text: "🪸 Unknown action." }] };
        }
      },
    }),
    { optional: true },
  );

  log.info("🪸 Reef plugin registered");
}
