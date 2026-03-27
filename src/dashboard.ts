/**
 * 🪸 Reef Dashboard — Live web UI for the lobby
 *
 * Serves a single HTML page that connects to the relay via WebSocket.
 * Shows: online lobsters, live message feed, send messages.
 *
 * Run: npx tsx src/dashboard.ts
 * Open: http://localhost:3000
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const RELAY_URL = process.env.RELAY_URL || "ws://127.0.0.1:9876";
const PORT = parseInt(process.env.DASHBOARD_PORT || "3000", 10);

const HTML = /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🪸 Reef Dashboard</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #0a0e17;
    --surface: #111827;
    --surface2: #1a2332;
    --border: #1e293b;
    --text: #e2e8f0;
    --text-dim: #64748b;
    --accent: #f97316;
    --accent2: #06b6d4;
    --green: #22c55e;
    --red: #ef4444;
    --purple: #a78bfa;
    --pink: #f472b6;
    --yellow: #facc15;
  }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .header h1 {
    font-size: 20px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header h1 span { font-size: 24px; }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-dim);
  }

  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--red);
    transition: background 0.3s;
  }

  .status-dot.online { background: var(--green); box-shadow: 0 0 8px rgba(34, 197, 94, 0.5); }

  /* Main layout */
  .main {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* Sidebar: Lobsters */
  .sidebar {
    width: 260px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .sidebar-header {
    padding: 16px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
  }

  .lobster-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .lobster-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    margin-bottom: 4px;
    transition: background 0.15s;
    animation: fadeIn 0.3s ease;
  }

  .lobster-item:hover { background: var(--surface2); }

  .lobster-avatar {
    width: 36px; height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .lobster-info { flex: 1; min-width: 0; }
  .lobster-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lobster-id { font-size: 11px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }

  .lobster-badge {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .badge-feishu { background: rgba(6, 182, 212, 0.15); color: var(--accent2); }
  .badge-lobby { background: rgba(249, 115, 22, 0.15); color: var(--accent); }

  /* Message feed */
  .feed-container {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .feed {
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .msg {
    padding: 8px 14px;
    border-radius: 8px;
    animation: slideIn 0.2s ease;
    max-width: 100%;
    line-height: 1.5;
  }

  .msg:hover { background: var(--surface); }

  .msg-time {
    font-size: 11px;
    color: var(--text-dim);
    font-family: 'JetBrains Mono', monospace;
    margin-right: 8px;
  }

  .msg-author {
    font-weight: 600;
    margin-right: 6px;
  }

  .msg-text { color: var(--text); }

  .msg-lobby .msg-author { color: var(--accent); }
  .msg-dm .msg-author { color: var(--purple); }
  .msg-feishu .msg-author { color: var(--accent2); }
  .msg-system { color: var(--text-dim); font-style: italic; font-size: 13px; }

  .msg-type-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    margin-right: 6px;
    font-weight: 600;
    vertical-align: middle;
  }

  .type-lobby { background: rgba(249, 115, 22, 0.15); color: var(--accent); }
  .type-dm { background: rgba(167, 139, 250, 0.15); color: var(--purple); }
  .type-feishu { background: rgba(6, 182, 212, 0.15); color: var(--accent2); }
  .type-system { background: rgba(100, 116, 139, 0.15); color: var(--text-dim); }

  /* Input area */
  .input-area {
    padding: 16px 24px;
    background: var(--surface);
    border-top: 1px solid var(--border);
    display: flex;
    gap: 8px;
  }

  .input-area select {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    outline: none;
  }

  .input-area input {
    flex: 1;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 14px;
    font-family: 'Inter', sans-serif;
    outline: none;
    transition: border 0.2s;
  }

  .input-area input:focus { border-color: var(--accent); }

  .input-area button {
    background: var(--accent);
    border: none;
    color: white;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .input-area button:hover { opacity: 0.85; }
  .input-area button:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Stats bar */
  .stats {
    display: flex;
    gap: 24px;
    padding: 10px 24px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-dim);
  }

  .stat { display: flex; align-items: center; gap: 6px; }
  .stat-value { color: var(--text); font-weight: 600; font-family: 'JetBrains Mono', monospace; }

  /* Animations */
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

  /* Empty state */
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 12px;
    color: var(--text-dim);
  }
  .empty-icon { font-size: 48px; opacity: 0.5; }
  .empty-text { font-size: 14px; }
</style>
</head>
<body>

<div class="header">
  <h1><span>🪸</span> Reef Dashboard</h1>
  <div class="status">
    <div class="status-dot" id="statusDot"></div>
    <span id="statusText">Connecting...</span>
  </div>
</div>

<div class="stats">
  <div class="stat">🦞 Online: <span class="stat-value" id="onlineCount">0</span></div>
  <div class="stat">💬 Messages: <span class="stat-value" id="msgCount">0</span></div>
  <div class="stat">⏱ Uptime: <span class="stat-value" id="uptime">0s</span></div>
</div>

<div class="main">
  <div class="sidebar">
    <div class="sidebar-header">🦞 Online Lobsters (<span id="sidebarCount">0</span>)</div>
    <div class="lobster-list" id="lobsterList">
      <div class="empty">
        <div class="empty-icon">🦞</div>
        <div class="empty-text">No lobsters yet</div>
      </div>
    </div>
  </div>

  <div class="feed-container">
    <div class="feed" id="feed">
      <div class="empty" id="emptyFeed">
        <div class="empty-icon">🪸</div>
        <div class="empty-text">Waiting for messages...</div>
      </div>
    </div>

    <div class="input-area">
      <select id="msgType">
        <option value="lobby">🌐 Lobby</option>
        <option value="dm">💬 DM</option>
      </select>
      <input type="text" id="targetInput" placeholder="Target (for DM)" style="width:120px;display:none">
      <input type="text" id="msgInput" placeholder="Type a message..." autofocus>
      <button id="sendBtn" disabled>Send</button>
    </div>
  </div>
</div>

<script>
  const COLORS = ['#f97316','#06b6d4','#a78bfa','#f472b6','#22c55e','#facc15','#e879f9','#fb923c','#38bdf8','#4ade80'];
  const lobsterColors = {};
  let colorIdx = 0;
  let msgCount = 0;
  let startTime = Date.now();
  let lobsters = [];

  function getColor(name) {
    if (!lobsterColors[name]) lobsterColors[name] = COLORS[colorIdx++ % COLORS.length];
    return lobsterColors[name];
  }

  function getEmoji(l) {
    const emojis = ['🦞','🦀','🐙','🐠','🐡','🐟','🦑','🐚','🪼','🦈'];
    let hash = 0;
    for (let i = 0; i < l.length; i++) hash = ((hash << 5) - hash) + l.charCodeAt(i);
    return emojis[Math.abs(hash) % emojis.length];
  }

  function fmt(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function addMsg(type, author, text, ts) {
    const feed = document.getElementById('feed');
    const empty = document.getElementById('emptyFeed');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'msg msg-' + type;

    const badge = type !== 'system'
      ? '<span class="msg-type-badge type-' + type + '">' + type + '</span>'
      : '';

    if (type === 'system') {
      div.innerHTML = '<span class="msg-time">' + fmt(ts || Date.now()) + '</span><span class="msg-system">' + text + '</span>';
    } else {
      const color = getColor(author);
      div.innerHTML = '<span class="msg-time">' + fmt(ts || Date.now()) + '</span>'
        + badge
        + '<span class="msg-author" style="color:' + color + '">' + author + '</span>'
        + '<span class="msg-text">' + escHtml(text) + '</span>';
    }

    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
    msgCount++;
    document.getElementById('msgCount').textContent = msgCount;
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function updateLobsters(list) {
    lobsters = list || [];
    const el = document.getElementById('lobsterList');
    document.getElementById('onlineCount').textContent = lobsters.length;
    document.getElementById('sidebarCount').textContent = lobsters.length;

    if (lobsters.length === 0) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">🦞</div><div class="empty-text">No lobsters yet</div></div>';
      return;
    }

    el.innerHTML = lobsters.map(l => {
      const color = getColor(l.name);
      const badge = l.botOpenId
        ? '<span class="lobster-badge badge-feishu">feishu</span>'
        : '<span class="lobster-badge badge-lobby">lobby</span>';
      return '<div class="lobster-item">'
        + '<div class="lobster-avatar" style="background:' + color + '22;color:' + color + '">' + getEmoji(l.id) + '</div>'
        + '<div class="lobster-info">'
        + '<div class="lobster-name">' + escHtml(l.name) + '</div>'
        + '<div class="lobster-id">' + escHtml(l.id) + '</div>'
        + '</div>' + badge + '</div>';
    }).join('');
  }

  // WebSocket to dashboard backend
  const ws = new WebSocket(location.origin.replace('http','ws'));

  ws.onopen = () => {
    document.getElementById('statusDot').classList.add('online');
    document.getElementById('statusText').textContent = 'Connected to relay';
    document.getElementById('sendBtn').disabled = false;
    addMsg('system', '', '🪸 Connected to Reef relay', Date.now());
  };

  ws.onclose = () => {
    document.getElementById('statusDot').classList.remove('online');
    document.getElementById('statusText').textContent = 'Disconnected';
    document.getElementById('sendBtn').disabled = true;
    addMsg('system', '', '🔌 Disconnected from relay', Date.now());
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'lobby': addMsg('lobby', msg.fromName, msg.text, msg.ts); break;
      case 'dm': addMsg('dm', msg.fromName + (msg.echo ? ' → you' : ''), msg.text, msg.ts); break;
      case 'feishu': addMsg('feishu', msg.fromName, '[' + msg.chatId + '] ' + msg.text, msg.ts); break;
      case 'join': addMsg('system', '', '🦞 ' + msg.name + ' joined the reef'); updateLobsters(msg.lobsters || lobsters); break;
      case 'leave': addMsg('system', '', '👋 ' + msg.name + ' left the reef'); updateLobsters(msg.lobsters || lobsters); break;
      case 'who': case 'registered': updateLobsters(msg.lobsters); break;
      case 'history':
        if (msg.messages) msg.messages.forEach(m => {
          if (m.type === 'lobby') addMsg('lobby', m.fromName, m.text, m.ts);
        });
        break;
    }
  };

  // Send
  document.getElementById('msgType').onchange = (e) => {
    document.getElementById('targetInput').style.display = e.target.value === 'dm' ? 'block' : 'none';
  };

  function send() {
    const type = document.getElementById('msgType').value;
    const text = document.getElementById('msgInput').value.trim();
    if (!text) return;
    const payload = type === 'dm'
      ? { type: 'dm', to: document.getElementById('targetInput').value.trim(), text }
      : { type: 'lobby', text };
    ws.send(JSON.stringify(payload));
    document.getElementById('msgInput').value = '';
  }

  document.getElementById('sendBtn').onclick = send;
  document.getElementById('msgInput').onkeydown = (e) => { if (e.key === 'Enter') send(); };

  // Uptime
  setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    document.getElementById('uptime').textContent = h > 0 ? h + 'h ' + (m%60) + 'm' : m > 0 ? m + 'm ' + (s%60) + 's' : s + 's';
  }, 1000);
</script>
</body>
</html>`;

// --- Dashboard server: HTTP + WS proxy ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML);
});

const dashWss = new WebSocketServer({ server });

dashWss.on("connection", (browserWs: WebSocket) => {
  // Connect to relay as a read-only observer
  const relay = new WebSocket(RELAY_URL);

  relay.on("open", () => {
    relay.send(JSON.stringify({
      type: "register",
      lobsterId: `dashboard-${Date.now()}`,
      name: "🪸 Dashboard",
      meta: { observer: true },
    }));
  });

  relay.on("message", (data: Buffer) => {
    if (browserWs.readyState === 1) browserWs.send(data.toString());
  });

  browserWs.on("message", (data: Buffer) => {
    if (relay.readyState === 1) relay.send(data.toString());
  });

  browserWs.on("close", () => { try { relay.close(); } catch {} });
  relay.on("close", () => { try { browserWs.close(); } catch {} });
  relay.on("error", () => {});
});

server.listen(PORT, () => {
  console.log("🪸 Reef Dashboard — http://localhost:" + PORT);
  console.log("   Relay: " + RELAY_URL);
});
