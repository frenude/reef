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

  // Helper: when we receive a DM, forward it to the configured Feishu group
  // AND wake the agent via `openclaw gateway call wake` so it can process and respond.
  async function injectToAgent(from: string, fromName: string, text: string) {
    const groupMessage = `🪸 [Reef DM] ${fromName} → ${pluginCfg.name || pluginCfg.lobsterId}:\n${text}`;

    // 1. Send to Feishu group for visibility
    await sendToFeishuGroup(groupMessage);

    // 2. Wake the agent via OpenClaw CLI so it can respond with lobby dm
    try {
      const wakeText = `🪸 [Reef DM from ${fromName} (${from})]\n${text}\n\n(用 lobby tool 的 dm action 回复 to="${from}")`;
      const escapedParams = JSON.stringify({ text: wakeText, mode: "now" }).replace(/'/g, "'\''");

      await new Promise<void>((resolve, reject) => {
        cpExec(
          `openclaw gateway call wake --params '${escapedParams}' --timeout 5000`,
          { timeout: 10000 },
          (err, stdout, stderr) => {
            if (err) {
              log.error(`🪸 Wake CLI failed: ${err.message}`);
              reject(err);
            } else {
              log.info(`🪸 Woke agent for DM from ${fromName}`);
              resolve();
            }
          }
        );
      });
    } catch (err: any) {
      log.error(`🪸 Wake failed: ${err.message}`);
    }
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
            // When we RECEIVE a DM, forward it to our owner's agent session
            if (autoReply && msg.from !== lobsterId) {
              injectToAgent(msg.from, msg.fromName, msg.text).catch(() => {});
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
          // Also mirror to feishu group if configured
          if (deliverGroupId) {
            sendToFeishuGroup(`🪸 ${pluginCfg.name || pluginCfg.lobsterId}: ${params.text}`).catch(() => {});
          }
          return result({ ok: true, action: "lobby_broadcast", text: params.text });

        case "dm": {
          if (!params.to || !params.text) return result({ ok: false, error: "to and text are required" });
          client.sendDm(params.to, params.text);
          // Mirror outgoing DM to feishu group — I (sender) post it, @ the recipient
          if (deliverGroupId) {
            const targetInfo = lobsterMap[params.to];
            const mention = targetInfo?.openId
              ? `<at user_id="${targetInfo.openId}">${targetInfo.name || params.to}</at> `
              : `@${params.to} `;
            sendToFeishuGroup(`🪸 ${mention}${params.text}`).catch(() => {});
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
