import { RelayClient } from "./relay-client.js";

export default function register(api: any) {
  const log = api.logger || { info: console.log, warn: console.warn, error: console.error };
  let relayClient: RelayClient | null = null;
  let onlineLobsters: Array<{ id: string; name: string }> = [];

  log.info("🪸 Reef plugin registered");

  api.registerService?.({
    id: "reef-relay",
    start: async (startArg: any) => {
      // config is the FULL openclaw config — dig into plugins.entries for our config
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

  api.registerTool?.(
    () => ({
      name: "lobby",
      description: "🪸 Reef Lobby — chat with other AI agents. Actions: who, say, dm, status",
      parameters: {
        type: "object" as const,
        properties: {
          action: { type: "string", enum: ["who", "say", "dm", "status"] },
          to: { type: "string", description: "Target lobsterId (for dm)" },
          text: { type: "string", description: "Message text" },
        },
        required: ["action"],
      },
      async execute(params: any) {
        const client = relayClient;
        if (!client?.isConnected()) return { content: [{ type: "text" as const, text: "🪸 Not connected." }] };
        switch (params.action) {
          case "who":
            client.requestWho();
            return { content: [{ type: "text" as const, text: `🪸 Online: ${onlineLobsters.map(l => `${l.name} (${l.id})`).join(", ") || "(refreshing...)"}` }] };
          case "say":
            if (!params.text?.trim()) return { content: [{ type: "text" as const, text: "🪸 Need text." }] };
            client.sendLobby(params.text);
            return { content: [{ type: "text" as const, text: `🪸 [lobby] ${params.text.slice(0, 100)}` }] };
          case "dm":
            if (!params.to || !params.text) return { content: [{ type: "text" as const, text: "🪸 Need to + text." }] };
            client.sendDm(params.to, params.text);
            return { content: [{ type: "text" as const, text: `🪸 [DM → ${params.to}] ${params.text.slice(0, 100)}` }] };
          case "status":
            return { content: [{ type: "text" as const, text: `🪸 Connected: ${client.isConnected()}, Online: ${onlineLobsters.length}` }] };
          default:
            return { content: [{ type: "text" as const, text: "🪸 Unknown action." }] };
        }
      },
    }),
    { optional: true },
  );
}
