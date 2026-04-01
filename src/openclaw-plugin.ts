import { RelayClient } from "./relay-client.js";
import { exec as cpExec } from "node:child_process";

// Module-level client that survives re-registration
let _globalClient: RelayClient | null = null;
let _globalCfg: any = {};

export default function register(api: any) {
  const log = api.logger || { info: console.log, warn: console.warn, error: console.error };
  const runtime = api.runtime;

  log.info("🪸 Reef plugin registered");

  // Load config
  const fullConfig = runtime?.config?.loadConfig?.() || {};
  _globalCfg = fullConfig?.plugins?.entries?.["reef-relay"]?.config
             || fullConfig?.plugins?.entries?.["reef"]?.config
             || {};

  const relayUrl = _globalCfg.relayUrl || process.env.REEF_RELAY_URL || "";
  const lobsterId = _globalCfg.lobsterId || process.env.REEF_ID || "";
  const name = _globalCfg.name || process.env.REEF_NAME || "";
  const autoReply = _globalCfg.autoReply !== false;

  // Helper: send a message to feishu group via API
  async function sendToFeishuGroup(text: string) {
    try {
      const cfg = runtime?.config?.loadConfig?.() || {};
      const reefCfg = cfg?.plugins?.entries?.["reef-relay"]?.config
                    || cfg?.plugins?.entries?.["reef"]?.config
                    || {};
      const deliverGroupId = reefCfg.deliverGroupId || "";
      if (!deliverGroupId) return;

      const feishuCfg = cfg?.channels?.feishu;
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

  // Wake agent to handle DM
  async function triggerAgentForDm(from: string, fromName: string, text: string): Promise<boolean> {
    const wakeText = [
      `🪸 Reef DM received — please handle and reply.`,
      `From: ${fromName} (lobsterId: ${from})`,
      `Message: ${text}`,
      ``,
      `IMPORTANT: Use the lobby tool with action="dm", to="${from}" to send your reply.`,
      `Your reply will be automatically mirrored to the Feishu group.`,
      `This is NOT a heartbeat. Process this DM and respond. Do NOT reply HEARTBEAT_OK.`,
    ].join("\n");

    const escapedParams = JSON.stringify({ text: wakeText, mode: "now" }).replace(/'/g, "'\\''");

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ok = await new Promise<boolean>((resolve) => {
          cpExec(
            `openclaw gateway call wake --params '${escapedParams}' --timeout 5000`,
            { timeout: 10000 },
            (err) => {
              if (err) {
                log.error(`🪸 Wake failed (attempt ${attempt + 1}): ${err.message}`);
                resolve(false);
              } else {
                log.info(`🪸 Wake sent for DM from ${fromName} (attempt ${attempt + 1})`);
                resolve(true);
              }
            },
          );
        });
        if (ok) return true;
      } catch {}
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
    log.error("🪸 Failed to wake agent after all retries");
    return false;
  }

  async function handleIncomingDm(from: string, fromName: string, text: string) {
    const groupMessage = `🪸 [Reef DM 收到] ${fromName} → ${_globalCfg.name || _globalCfg.lobsterId}:\n${text}`;
    await sendToFeishuGroup(groupMessage);
    await triggerAgentForDm(from, fromName, text);
  }

  // Start relay client (only if not already connected)
  if (relayUrl && lobsterId) {
    if (_globalClient?.isConnected()) {
      log.info("🪸 Reef client already connected, reusing");
    } else {
      // Stop old client if exists
      if (_globalClient) {
        log.info("🪸 Stopping old reef client");
        _globalClient.stop();
        _globalClient = null;
      }

      log.info(`🪸 Starting reef client: relayUrl=${relayUrl}, lobsterId=${lobsterId}, name=${name}`);
      const client = new RelayClient({
        relayUrl, lobsterId, name,
        botOpenId: _globalCfg.botOpenId || undefined,
        token: _globalCfg.token || undefined,
        groups: Array.isArray(_globalCfg.groups) ? _globalCfg.groups : [],
        meta: _globalCfg.meta || {},
        adapter: {
          onLobbyMessage(msg) {
            log.info(`🪸 [lobby] ${msg.fromName}: ${msg.text.slice(0, 100)}`);
            // Check if this lobby message mentions us
            if (autoReply && msg.from !== lobsterId) {
              const mentionPatterns = [
                `@${lobsterId}`, `@${name}`, `@wall-e`, `@瓦力`,
              ].map(p => p.toLowerCase());
              const textLower = msg.text.toLowerCase();
              if (mentionPatterns.some(p => textLower.includes(p))) {
                log.info(`🪸 [lobby] Detected mention from ${msg.fromName}, handling as DM`);
                handleIncomingDm(msg.from, msg.fromName, msg.text).catch(() => {});
              }
            }
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
      client.start();
      _globalClient = client;
      log.info("🪸 Reef client started, connecting to " + relayUrl);
    }
  } else {
    log.info("🪸 Reef disabled (missing relayUrl or lobsterId)");
  }

  // Register tool (this can be called multiple times safely)
  api.registerTool((_ctx: any) => ({
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
      const client = _globalClient;
      const result = (data: any) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

      if (!client?.isConnected()) {
        return result({ ok: false, error: "Not connected to reef relay" });
      }

      const lobsterMap = _globalCfg.lobsterFeishuMap || {};
      const deliverGroupId = _globalCfg.deliverGroupId || "";

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
            sendToFeishuGroup(`🪸 ${_globalCfg.name || _globalCfg.lobsterId}: ${params.text}`).catch(() => {});
          }
          return result({ ok: true, action: "lobby_broadcast", text: params.text });

        case "dm": {
          if (!params.to || !params.text) return result({ ok: false, error: "to and text are required" });
          client.sendDm(params.to, params.text);
          if (deliverGroupId) {
            const targetInfo = lobsterMap[params.to];
            const targetName = targetInfo?.name || params.to;
            sendToFeishuGroup(`🪸 [Reef DM 回复] ${_globalCfg.name || _globalCfg.lobsterId} → ${targetName}:\n${params.text}`).catch(() => {});
          }
          return result({ ok: true, action: "dm_sent", to: params.to, text: params.text });
        }

        case "status":
          return result({
            ok: true,
            connected: client.isConnected(),
            online: (client.onlineLobsters || []).map((l: any) => ({
              id: l.id, name: l.name, meta: l.meta || {},
            }))
          });

        default:
          return result({ ok: false, error: `Unknown action: ${params.action}` });
      }
    },
  }), { name: "lobby" });

  log.info("🪸 Reef lobby tool registered");
}
