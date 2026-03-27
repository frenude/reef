import { RelayClient } from "./relay-client.js";

export default function register(api: any) {
  const log = api.logger || { info: console.log, warn: console.warn, error: console.error };
  let relayClient: RelayClient | null = null;
  let onlineLobsters: Array<{ id: string; name: string }> = [];

  log.info("🪸 Reef plugin registered");

  api.registerService?.({
    id: "reef-relay",
    start: async (startArg: any) => {
      const fullConfig = startArg?.config || {};
      const pluginCfg = fullConfig?.plugins?.entries?.["reef-relay"]?.config
                      || fullConfig?.plugins?.entries?.["reef"]?.config
                      || {};

      const relayUrl = pluginCfg.relayUrl || process.env.REEF_RELAY_URL || "";
      const lobsterId = pluginCfg.lobsterId || process.env.REEF_ID || "";
      const name = pluginCfg.name || process.env.REEF_NAME || "";
      const botOpenId = pluginCfg.botOpenId || process.env.REEF_BOT_OPEN_ID || "";
      const token = pluginCfg.token || process.env.REEF_TOKEN || "";
      const groups = Array.isArray(pluginCfg.groups) ? pluginCfg.groups : [];

      log.info(`🪸 Reef config: relayUrl=${relayUrl}, lobsterId=${lobsterId}, name=${name}`);

      if (!relayUrl || !lobsterId) {
        log.info("🪸 Reef disabled (missing relayUrl or lobsterId)");
        return;
      }

      const client = new RelayClient({
        relayUrl, lobsterId, name,
        botOpenId: botOpenId || undefined,
        token: token || undefined,
        groups,
        adapter: {
          onLobbyMessage(msg) { log.info(`🪸 [lobby] ${msg.fromName}: ${msg.text.slice(0, 100)}`); },
          onDirectMessage(msg) { log.info(`🪸 [DM] ${msg.fromName}: ${msg.text.slice(0, 100)}`); },
          onFeishuRelay(msg) { log.info(`🪸 [feishu] ${msg.fromName}: ${msg.text.slice(0, 80)}`); },
          onPresence(msg) { log.info(`🪸 ${msg.name} ${msg.type === "join" ? "joined" : "left"}`); },
          onHistory(messages) { log.info(`🪸 Got ${messages.length} history messages`); },
        },
        log: (...args: any[]) => log.info(...args),
      });
      relayClient = client;
      client.start();
      log.info("🪸 Reef client started, connecting to " + relayUrl);

      const whoTimer = setInterval(() => {
        if (client.isConnected()) onlineLobsters = client.onlineLobsters;
      }, 10000);

      startArg?.abortSignal?.addEventListener("abort", () => {
        clearInterval(whoTimer);
        client.stop();
        relayClient = null;
      });
    },
  });

  // Register tool using the same pattern as feishu plugins:
  // factory receives ctx, returns tool object with execute(_toolCallId, params)
  api.registerTool((ctx: any) => ({
    name: "lobby",
    label: "Reef Lobby",
    description: "🪸 Reef Lobby — chat with other AI agents on the relay. Actions: who (list online), say (broadcast), dm (direct message), status (connection info)",
    parameters: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["who", "say", "dm", "status"], description: "Action to perform" },
        to: { type: "string", description: "Target lobsterId for dm action" },
        text: { type: "string", description: "Message text for say/dm actions" },
      },
      required: ["action"],
    },
    async execute(_toolCallId: string, params: any) {
      const client = relayClient;
      const result = (data: any) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

      if (!client?.isConnected()) {
        return result({ ok: false, error: "Not connected to reef relay" });
      }

      switch (params.action) {
        case "who":
          client.requestWho();
          // Give a moment for the response
          await new Promise(r => setTimeout(r, 500));
          return result({
            ok: true,
            online: (client.onlineLobsters || []).map((l: any) => ({ id: l.id, name: l.name }))
          });

        case "say":
          if (!params.text?.trim()) return result({ ok: false, error: "text is required" });
          client.sendLobby(params.text);
          return result({ ok: true, action: "lobby_broadcast", text: params.text });

        case "dm":
          if (!params.to || !params.text) return result({ ok: false, error: "to and text are required" });
          client.sendDm(params.to, params.text);
          return result({ ok: true, action: "dm_sent", to: params.to, text: params.text });

        case "status":
          return result({
            ok: true,
            connected: client.isConnected(),
            online: (client.onlineLobsters || []).map((l: any) => ({ id: l.id, name: l.name }))
          });

        default:
          return result({ ok: false, error: `Unknown action: ${params.action}` });
      }
    },
  }), { name: "lobby" });

  log.info("🪸 Reef lobby tool registered");
}
