/**
 * HelloCouple World — WebRTC signalling server.
 *
 * This introduces two browsers to each other and then gets out of the way:
 * once the offer/answer and ICE candidates have been relayed, the microphone
 * audio and position updates go peer to peer and never come back here. It
 * keeps no accounts, no database and no history — only which socket is in
 * which room, in memory.
 *
 *   PORT              port to listen on (default 8080)
 *   ALLOWED_ORIGINS   comma-separated list of allowed Origin headers.
 *                     Leave unset to accept any origin (fine for local dev,
 *                     set it in production).
 *   MAX_ROOM          people per room (default 8)
 *
 *   npm install && npm start
 *
 * The game is a static site; this is the only server it ever needs, and only
 * for voice chat. Without it everything else still works.
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const MAX_ROOM = Number(process.env.MAX_ROOM || 8);
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

/** room code -> Map(peerId -> socket) */
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024,
  verifyClient: ({ origin }) => !ALLOWED.length || !origin || ALLOWED.includes(origin),
});

const send = (ws, obj) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

function leave(ws) {
  const { room, id } = ws.meta || {};
  if (!room) return;
  const peers = rooms.get(room);
  if (!peers) return;
  peers.delete(id);
  for (const other of peers.values()) send(other, { t: 'left', id });
  if (!peers.size) rooms.delete(room);
  ws.meta = null;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join') {
      const room = String(msg.room || '').trim().toUpperCase().slice(0, 24);
      const id = String(msg.id || '').slice(0, 40);
      if (!room || !id) return send(ws, { t: 'error', reason: 'bad-join' });

      const peers = rooms.get(room) || new Map();
      if (peers.size >= MAX_ROOM) return send(ws, { t: 'error', reason: 'room-full' });
      if (peers.has(id)) return send(ws, { t: 'error', reason: 'duplicate-id' });

      // tell the newcomer who is already here; they make the offers
      send(ws, { t: 'peers', ids: [...peers.keys()] });
      for (const other of peers.values()) send(other, { t: 'joined', id });

      peers.set(id, ws);
      rooms.set(room, peers);
      ws.meta = { room, id };
      return;
    }

    // everything else is relayed verbatim to one peer in the same room
    if (msg.t === 'signal' && ws.meta) {
      const peers = rooms.get(ws.meta.room);
      const target = peers?.get(String(msg.to || ''));
      if (target) send(target, { ...msg, from: ws.meta.id });
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// drop sockets that stopped answering, so rooms do not fill with ghosts
const beat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { leave(ws); ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(beat));

server.listen(PORT, () => {
  console.log(`[hellocouple] signalling server on :${PORT}` +
    (ALLOWED.length ? ` (origins: ${ALLOWED.join(', ')})` : ' (any origin)'));
});
