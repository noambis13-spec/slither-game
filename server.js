'use strict';
/* Node.js server: static files + authoritative multiplayer rooms over WebSocket. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const SG = require('./game.js');

const PORT = process.env.PORT || 3000;
const TICK_MS = 33;        // simulation rate (~30 Hz)
const SEND_MS = 50;        // snapshot rate (20 Hz)
const VIEW = 2300;         // half-size of per-client interest area
const MAX_PLAYERS = 16;
const ROOM_BOTS = 6;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/client.js': ['client.js', 'application/javascript; charset=utf-8'],
  '/shared/game.js': ['shared/game.js', 'application/javascript; charset=utf-8']
};

const server = http.createServer((req, res) => {
  const f = FILES[req.url.split('?')[0]];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(__dirname, f[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });
const rooms = new Map();

const send = (ws, obj) => { if (ws.readyState === 1 && ws.bufferedAmount < 1e6) ws.send(JSON.stringify(obj)); };

function newCode() {
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]; } while (rooms.has(c));
  return c;
}

class Room {
  constructor(code) {
    this.code = code;
    this.clients = new Set();
    this.n = 0;
    this.world = new SG.World({ bots: ROOM_BOTS, onDeath: (s, k) => this.onDeath(s, k) });
  }

  onDeath(s, killer) {
    const c = s.client;
    if (!c) return;
    c.snake = null;
    send(c.ws, { t: 'dead', score: Math.floor(s.score), by: killer ? killer.name : null });
  }

  /* Build a per-client snapshot: visible snakes (full body), food deltas, own score, periodic leaderboard. */
  snapshot(c, ranked) {
    const w = this.world, me = c.snake;
    if (me) { c.pos.x = me.segs[0].x; c.pos.y = me.segs[0].y; }
    const cx = c.pos.x, cy = c.pos.y, sn = [];
    for (const s of w.snakes) {
      let vis = s === me;
      if (!vis) {
        for (let i = 0; i < s.segs.length; i += 2) {
          const p = s.segs[i];
          if (Math.abs(p.x - cx) < VIEW && Math.abs(p.y - cy) < VIEW) { vis = true; break; }
        }
      }
      if (!vis) continue;
      const p = new Array(s.segs.length * 2);
      for (let i = 0; i < s.segs.length; i++) { p[2 * i] = Math.round(s.segs[i].x); p[2 * i + 1] = Math.round(s.segs[i].y); }
      sn.push({ i: s.id, n: s.name, k: s.skin, a: Math.round(s.angle * 100) / 100, b: s.boosting ? 1 : 0, s: Math.floor(s.score), p });
    }
    const seen = new Set(), fa = [], fr = [];
    for (const f of w.foods) {
      if (Math.abs(f.x - cx) < VIEW && Math.abs(f.y - cy) < VIEW) {
        seen.add(f.id);
        if (!c.known.has(f.id)) fa.push(f.id, Math.round(f.x), Math.round(f.y), f.v, f.c);
      }
    }
    for (const id of c.known) if (!seen.has(id)) fr.push(id);
    c.known = seen;
    const msg = { t: 's', ts: Date.now(), sn, fa, fr, n: w.snakes.length };
    if (ranked) {
      msg.lb = ranked.slice(0, 10).map(s => [s.name, Math.floor(s.score), s === me ? 1 : 0]);
      msg.rk = me ? ranked.indexOf(me) + 1 : 0;
    }
    return msg;
  }

  broadcast() {
    this.n++;
    const ranked = this.n % 10 === 0 ? [...this.world.snakes].sort((a, b) => b.score - a.score) : null;
    for (const c of this.clients) send(c.ws, this.snapshot(c, ranked));
  }
}

const cleanName = n => (String(n || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16)) || 'Player';
const cleanSkin = k => { k = Number(k) | 0; return k >= 0 && k < SG.SKINS.length ? k : 0; };

function spawn(c) {
  c.snake = c.room.world.addSnake(c.name, c.skin, false);
  c.snake.client = c;
  c.known = new Set();
  send(c.ws, { t: 'joined', code: c.room.code, id: c.snake.id });
}

function enter(c, room, m) {
  if (room.clients.size >= MAX_PLAYERS) { send(c.ws, { t: 'err', m: 'Room is full' }); return; }
  c.name = cleanName(m.name); c.skin = cleanSkin(m.skin);
  c.room = room; room.clients.add(c);
  spawn(c);
}

function leave(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  if (c.snake) { const s = c.snake; c.snake = null; s.client = null; room.world.kill(s, null); }
  room.clients.delete(c);
  if (!room.clients.size) rooms.delete(room.code);   // destroy empty room
}

wss.on('connection', ws => {
  const c = { ws, room: null, snake: null, name: 'Player', skin: 0, pos: { x: 0, y: 0 }, known: new Set() };
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'ping': send(ws, { t: 'pong', c: m.c }); break;
      case 'create': {
        if (c.room) return;
        const room = new Room(newCode());
        rooms.set(room.code, room);
        enter(c, room, m);
        break;
      }
      case 'join': {
        if (c.room) return;
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) { send(ws, { t: 'err', m: 'Room not found' }); return; }
        enter(c, room, m);
        break;
      }
      case 'i':
        if (c.snake) {
          const a = Number(m.a);
          if (isFinite(a)) c.snake.target = a;
          c.snake.boost = !!m.b;
        }
        break;
      case 'respawn':
        if (c.room && !c.snake) {
          if (m.name) c.name = cleanName(m.name);
          if (m.skin != null) c.skin = cleanSkin(m.skin);
          spawn(c);
        }
        break;
      case 'leave': leave(c); break;
    }
  });
  ws.on('close', () => leave(c));
  ws.on('error', () => {});
});

let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const room of rooms.values()) room.world.step(dt);
}, TICK_MS);
setInterval(() => { for (const room of rooms.values()) room.broadcast(); }, SEND_MS);

server.listen(PORT, () => console.log('Slither server running on http://localhost:' + PORT));
