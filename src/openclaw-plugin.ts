import { RelayClient } from "./relay-client.js";
import { exec as cpExec } from "node:child_process";

export default function register(api: any) {
  const log = api.logger || { info: console.log, warn: console.warn, error: console.error };
  const runtime = api.runtime;
  let relayClient: RelayClient | null = null;
  let onlineLobsters: Array<{ id: string; name: string }> = [];
  let pluginCfg: any = {};

  log.info("🪸 Reef plugin registered");

  // Helper: send a message to feishu group via API
  async function sendToFeishuGroup(text: string) {
    try {
      const fullCfg = runtime?.config?.loadConfig?.() || {};
      const reefCfg = fullCfg?.plugins?.entries?.["reef-relay"]?.config
                    || fullCfg?.plugins?.entries?.["reef"]?.config
                    || {};
      const deliverGroupId = reefCfg.deliverGroupId || "";
      if (!deliverGroupId) return;

      const feishuCfg = fullCfg?.channels?.feishu;
      const appId = feishuCfg?.appId;
      const appSecret = feishuCfg?.appSecret;
      if (!appId || !appSecret) return;

      const tokenRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const tokenData = await tokenRes.json() as any;
      const token = tokenData.tenant_access_token;
      if (!token) return;

      const sendRes = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          receive_id: deliverGroupId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        }),
      });
      const sendData = await sendRes.json() as any;
      if (sendData.code === 0) {
        log.info(`🪸 Sent to group ${deliverGroupId}`);
      } else {
        log.error(`🪸 Feishu send failed: ${sendData.code} ${sendData.msg}`);
      }
    } catch (err: any) {
      log.error(`🪸 Send to feishu failed: ${err.message}`);
    }
  }

  // Helper: create an isolated cron agentTurn to process a DM.
  // This spawns a fresh agent session that can use the lobby tool to reply.
  async function spawnAgentForDm(from: string, fromName: string, text: string, retries = 2): Promise<boolean> {
    const message = [
      `🪸 Reef DM received — please handle and reply.`,
      `From: ${fromName} (lobsterId: ${from})`,
      `Message: ${text}`,
      ``,
      `Action: Read the message, think about an appropriate response, then use the lobby tool with action="dm", to="${from}" to send your reply.`,
      `Your reply will be automatically mirrored to the Feishu group.`,
      `Keep it concise and helpful.`,
    ].join("\n");

    // Use cron one-shot "at" job to spawn an isolated agentTurn
    const job = {
      name: `reef-dm-${from}-${Date.now()}`,
      schedule: { kind: "at", at: new Date(Date.now() + 1000).toISOString() },
      payload: { kind: "agentTurn", message, timeoutSeconds: 120 },
      sessionTarget: "isolated",
      delivery: { mode: "announce" },
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const escapedParams = JSON.stringify({ action: "add", job }).replace(/'/g, "'\\''");
        const ok = await new Promise<boolean>((resolve) => {
          cpExec(
            `openclaw gateway call cron --params '${escapedParams}' --timeout 10000`,
            { timeout: 15000 },
            (err, stdout) => {
              if (err) {
                log.error(`🪸 Cron add failed: ${err.message}`);
                resolve(false);
              } else {
                log.info(`🪸 Cron job created for DM from ${fromName}: ${stdout.slice(0, 200)}`);
                resolve(true);
              }
            },
          );
        });
        if (ok) return true;
      } catch {}
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
    }
    log.error("🪸 Failed to spawn agent for DM after all retries");
    return false;
  }

  // When we receive a DM:
  // 1. Forward to Feishu group for visibility
  // 2. Spawn isolated agent to process and reply
  async function handleIncomingDm(from: string, fromName: string, text: string) {
    // Send to Feishu group
    const groupMessage = `🪸 [Reef DM 收到] ${fromName} → ${pluginCfg.name || pluginCfg.lobsterId}:\n${text}`;
    await sendToFeishuGroup(groupMessage);

    // Spawn agent to handle
    await spawnAgentForDm(from, fromName, text);
  }

  api.registerService?.({
    id: "reef-relay",
    start: async (startArg: any) => {
      const fullConfig = startArg?.config || {};
      pluginCfg = fullConfig?.plugins?.entries?.["reef-relay"]?.config
                || fullConfig?.plugins?.entries?.["reef"]?.config
                || {};

      const relayUrl = pluginCfg.relayUrl || process.env.REEF_RELAY_URL || "";
      const lobsterId = pluginCfg.lobsterId || process.env.REEF_ID || "";
      const name = pluginCfg.name || process.env.REEF_NAME || "";
      const botOpenId = pluginCfg.botOpenId || process.env.REEF_BOT_OPEN_ID || "";
      const token = pluginCfg.token || process.env.REEF_TOKEN || "";
      const groups = Array.isArray(pluginCfg.groups) ? pluginCfg.groups : [];
      const autoReply = pluginCfg.autoReply !== false;

      log.info(`🪸 Reef config: relayUrl=${relayUrl}, lobsterId=${lobsterId}, name=${name}, autoReply=${autoReply}`);

      if (!relayUrl || !lobsterId) {
        log.info("🪸 Reef disabled (missing relayUrl or lobsterId)");
        return;
      }

      const client = new RelayClient({
        relayUrl, lobsterId, name,
        botOpenId: botOpenId || undefined,
        token: token || undefined,
        groups,
        meta: pluginCfg.meta || {},
        adapter: {
          onLobbyMessage(msg) {
            log.info(`🪸 [lobby] ${msg.fromName}: ${msg.text.slice(0, 100)}`);
          },
          onDirectMessage(msg) {
            log.info(`🪸 [DM] ${msg.fromName}: ${msg.text.slice(0, 100)}`);
            if (autoReply && msg.from !== lobsterId) {
              handleIncomingDm(msg.from, msg.fromName, msg.text).catch((err) => {
                log.error(`🪸 handleIncomingDm failed: ${err.message}`);
              });
            }
          },
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

      const lobsterMap = pluginCfg.lobsterFeishuMap || {};
      const deliverGroupId = pluginCfg.deliverGroupId || "";

      switch (params.action) {
        case "who":
          client.requestWho();
          await new Promise(r => setTimeout(r, 500));
          return result({
            ok: true,
            online: (client.onlineLobsters || []).map((l: any) => ({
              id: l.id,
              name: l.name,
              meta: l.meta || {},
              connectedAt: l.connectedAt,
            }))
          });

        case "say":
          if (!params.text?.trim()) return result({ ok: false, error: "text is required" });
          client.sendLobby(params.text);
          if (deliverGroupId) {
            sendToFeishuGroup(`🪸 ${pluginCfg.name || pluginCfg.lobsterId}: ${params.text}`).catch(() => {});
          }
          return result({ ok: true, action: "lobby_broadcast", text: params.text });

        case "dm": {
          if (!params.to || !params.text) return result({ ok: false, error: "to and text are required" });
          client.sendDm(params.to, params.text);
          // Mirror outgoing DM to feishu group
          if (deliverGroupId) {
            const targetInfo = lobsterMap[params.to];
            const targetName = targetInfo?.name || params.to;
            sendToFeishuGroup(`🪸 [Reef DM 回复] ${pluginCfg.name || pluginCfg.lobsterId} → ${targetName}:\n${params.text}`).catch(() => {});
          }
          return result({ ok: true, action: "dm_sent", to: params.to, text: params.text });
        }

        case "status":
          return result({
            ok: true,
            connected: client.isConnected(),
            online: (client.onlineLobsters || []).map((l: any) => ({
              id: l.id,
              name: l.name,
              meta: l.meta || {},
            }))
          });

        default:
          return result({ ok: false, error: `Unknown action: ${params.action}` });
      }
    },
  }), { name: "lobby" });

  log.info("🪸 Reef lobby tool registered");
}
