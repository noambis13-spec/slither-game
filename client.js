(() => {
'use strict';
const TAU = Math.PI * 2, ARENA = SG.ARENA, INTERP_MS = 100;
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

/* ---------- canvas ---------- */
const cv = $('game'), ctx = cv.getContext('2d');
const mmc = $('minimap'), mm = mmc.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
}
addEventListener('resize', resize); resize();

/* ---------- sprites (pre-rendered for speed) ---------- */
const ballCache = new Map(), glowCache = new Map();
function ball(color) {
  let c = ballCache.get(color);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(32, 32, 30, 0, TAU); g.fill();
  const gr = g.createRadialGradient(24, 22, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(.45, 'rgba(255,255,255,0)');
  gr.addColorStop(.8, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.5)');
  g.fillStyle = gr; g.fill();
  ballCache.set(color, c); return c;
}
function glow(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color;
  g.beginPath(); g.arc(32, 32, 14, 0, TAU); g.fill();
  glowCache.set(color, c); return c;
}
// Hex-tile background pattern (Slither-style dark grid)
const hexPattern = (() => {
  const s = 30, h = Math.sqrt(3) * s, c = document.createElement('canvas');
  c.width = s * 3; c.height = Math.round(h);
  const g = c.getContext('2d');
  g.strokeStyle = '#18213a'; g.lineWidth = 2;
  const hex = (cx, cy) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; g.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s); }
    g.closePath(); g.stroke();
  };
  [[0, 0], [3 * s, 0], [0, h], [3 * s, h], [1.5 * s, h / 2], [1.5 * s, -h / 2], [1.5 * s, 1.5 * h]].forEach(p => hex(p[0], p[1]));
  return ctx.createPattern(c, 'repeat');
})();

/* ---------- snake rendering (flat [x0,y0,x1,y1,...] body) ---------- */
function drawSnake(g, f, skin, r, boosting, angle, vb) {
  const n = f.length >> 1, sz = r * 2.13;
  for (let i = n - 1; i >= 0; i--) {
    const x = f[2 * i], y = f[2 * i + 1];
    if (vb && (x < vb.x0 - r * 2 || x > vb.x1 + r * 2 || y < vb.y0 - r * 2 || y > vb.y1 + r * 2)) continue;
    const col = SG.skinColor(skin, i);
    if (boosting ? (i & 1) === 0 : i % 3 === 0) {
      const gs = r * 5; g.globalAlpha = boosting ? 0.45 : 0.16;
      g.drawImage(glow(col), x - gs / 2, y - gs / 2, gs, gs); g.globalAlpha = 1;
    }
    g.drawImage(ball(col), x - sz / 2, y - sz / 2, sz, sz);
  }
  const hx = f[0], hy = f[1], ca = Math.cos(angle), sa = Math.sin(angle);
  for (const sd of [-1, 1]) {
    const ea = angle + sd * 0.65, ex = hx + Math.cos(ea) * r * 0.55, ey = hy + Math.sin(ea) * r * 0.55;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, ey, r * 0.36, 0, TAU); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(ex + ca * r * 0.14, ey + sa * r * 0.14, r * 0.19, 0, TAU); g.fill();
  }
}

/* Convert a simulated Snake into a render entry (reuses buffers). */
function entry(s) {
  const e = s._e || (s._e = {}), n = s.segs.length;
  e.id = s.id; e.name = s.name; e.skin = s.skin; e.angle = s.angle; e.boosting = s.boosting; e.score = s.score; e.r = s.r;
  let f = e.flat;
  if (!f || f.length !== n * 2) f = e.flat = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { f[2 * i] = s.segs[i].x; f[2 * i + 1] = s.segs[i].y; }
  return e;
}

/* ---------- input ---------- */
const input = { angle: 0, boost: false };
addEventListener('pointermove', e => { input.angle = Math.atan2(e.clientY - H / 2, e.clientX - W / 2); });
let lastTap = 0;
cv.addEventListener('pointerdown', e => {
  input.angle = Math.atan2(e.clientY - H / 2, e.clientX - W / 2);
  const now = Date.now();
  if (now - lastTap < 300) input.boost = true;
  lastTap = now;
});
addEventListener('pointerup', e => { input.boost = false; });
addEventListener('keydown', e => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') { input.boost = true; e.preventDefault(); }
});
addEventListener('keyup', e => { if (e.code === 'Space') input.boost = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());



let skinIdx = Math.min(SG.SKINS.length - 1, parseInt(store.get('skin', '0'), 10) || 0);
const nick = $('nick');
nick.value = store.get('nick', '');

const ui = {
  toastT: 0,
  toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.add('hidden'), 3200);
  },
  msg(m) { $('menuMsg').textContent = m || ''; },
  showMenu() { $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('death').classList.add('hidden'); },
  hideMenu() { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); $('death').classList.add('hidden'); },
  dead(score) { $('deadScore').textContent = score; $('death').classList.remove('hidden'); input.boost = false; },
  score(v) { const t = $('score'); const s = String(Math.floor(v)); if (t.textContent !== s) t.textContent = s; },
  leaderboard(list, rank, total) {
    $('lbList').innerHTML = list.map((r, i) =>
      '<div class="' + (r[2] ? 'me' : '') + '"><span>' + (i + 1) + '. ' + esc(r[0]) + '</span><span>' + r[1] + '</span></div>').join('');
    $('rank').textContent = rank || '-'; $('total').textContent = total || '-';
  },
  room(code) {
    $('roomtag').classList.toggle('hidden', !code);
    $('roomCode').textContent = code || '----';
  }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// skin grid + carousel
function swatchCss(i) {
  const s = SG.SKINS[i];
  if (s.rainbow) return 'linear-gradient(90deg,#f33,#fc3,#3f6,#3cf,#93f,#f3c)';
  const step = 100 / s.c.length;
  return 'linear-gradient(90deg,' + s.c.map((c, k) => c + ' ' + k * step + '% ' + (k + 1) * step + '%').join(',') + ')';
}
function selectSkin(i) {
  skinIdx = (i + SG.SKINS.length) % SG.SKINS.length;
  store.set('skin', skinIdx);
  $('skinName').textContent = SG.SKINS[skinIdx].n;
  [...$('skins').children].forEach((el, k) => el.classList.toggle('sel', k === skinIdx));
}
SG.SKINS.forEach((s, i) => {
  const b = document.createElement('button');
  b.className = 'sw'; b.style.background = swatchCss(i); b.title = s.n;
  b.onclick = () => selectSkin(i);
  $('skins').appendChild(b);
});
$('skinPrev').onclick = () => selectSkin(skinIdx - 1);
$('skinNext').onclick = () => selectSkin(skinIdx + 1);
selectSkin(skinIdx);

const prevCv = $('preview'), pg = prevCv.getContext('2d');
function drawPreview(t) {
  pg.clearRect(0, 0, prevCv.width, prevCv.height);
  const n = 28, f = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { f[2 * i] = 225 - i * 7.5; f[2 * i + 1] = 45 + Math.sin(t * 3 - i * 0.4) * 11; }
  drawSnake(pg, f, skinIdx, 12, false, 0.1, null);
}

/* ---------- sessions ---------- */
class LocalSession {
  constructor(name, skin, demo) {
    this.ready = true; this.demo = demo; this.lbT = 0;
    this.world = new SG.World({
      bots: demo ? 14 : 24,
      onDeath: s => { if (s === this.me) { this.me = null; ui.dead(Math.floor(s.score)); } }
    });
    this.me = demo ? null : this.world.addSnake(name, skin, false);
  }
  update(dt, inp) {
    if (this.me) { this.me.target = inp.angle; this.me.boost = inp.boost; }
    this.world.step(dt);
    if (!this.demo && (this.lbT -= dt) <= 0) {
      this.lbT = 0.5;
      const r = [...this.world.snakes].sort((a, b) => b.score - a.score);
      ui.leaderboard(r.slice(0, 10).map(s => [s.name, Math.floor(s.score), s === this.me ? 1 : 0]), this.me ? r.indexOf(this.me) + 1 : 0, r.length);
    }
  }
  render() {
    const out = { me: null, others: [], foods: this.world.foods, follow: null };
    let big = null;
    for (const s of this.world.snakes) {
      const e = entry(s);
      if (s === this.me) out.me = e; else out.others.push(e);
      if (!big || s.score > big.score) big = e;
    }
    if (!out.me) out.follow = big;
    return out;
  }
  close() {}
}

class NetSession {
  constructor(mode, name, skin, code) {
    this.ready = false; this.closed = false;
    this.mode = mode; this.name = name; this.skin = skin; this.code = code || '';
    this.snaps = []; this.foods = new Map(); this.me = null; this.id = 0; this.err = { x: 0, y: 0 };
    this.off = null; this.ping = 0; this.sendT = 0;
    let ws;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host); }
    catch (e) { ui.msg('Cannot reach server. Run "npm start" and open http://localhost:3000'); this.closed = true; setTimeout(() => game.toMenu(), 0); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.send(mode === 'create' ? { t: 'create', name, skin } : { t: 'join', code, name, skin });
      this.pingT = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    ws.onmessage = e => this.onMsg(JSON.parse(e.data));
    ws.onclose = () => {
      clearInterval(this.pingT);
      if (this.closed) return;
      this.closed = true;
      ui.msg(this.ready ? 'Connection lost' : 'Cannot reach server. Run "npm start" and open http://localhost:3000');
      game.toMenu();
    };
    ws.onerror = () => {};
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() {
    this.closed = true; clearInterval(this.pingT);
    if (this.ws) { this.send({ t: 'leave' }); this.ws.close(); }
  }
  respawn() {
    this.me = null; this.snaps = []; this.foods.clear();
    this.send({ t: 'respawn', name: this.name, skin: this.skin });
  }
  onMsg(m) {
    switch (m.t) {
      case 'joined':
        this.id = m.id; this.me = null; this.ready = true; cam.snap = true;
        ui.room(m.code); ui.hideMenu(); ui.msg('');
        break;
      case 'err':
        this.closed = true; ui.msg(m.m); this.close(); game.toMenu(); break;
      case 'pong': {
        const p = performance.now() - m.c;
        this.ping = this.ping ? this.ping * 0.7 + p * 0.3 : p;
        $('ping').textContent = Math.round(this.ping) + ' ms';
        break;
      }
      case 'dead': this.me = null; ui.dead(m.score); break;
      case 's': this.onSnap(m); break;
    }
  }
  onSnap(m) {
    const samp = m.ts - performance.now();
    // track the best-case clock offset (lowest latency sample), drift slowly toward others
    this.off = this.off == null || samp > this.off ? samp : this.off + (samp - this.off) * 0.02;
    const map = new Map();
    for (const s of m.sn) map.set(s.i, { id: s.i, name: s.n, skin: s.k, angle: s.a, boosting: !!s.b, score: s.s, r: SG.radius(s.s), flat: s.p });
    this.snaps.push({ ts: m.ts, map });
    if (this.snaps.length > 10) this.snaps.shift();
    const fa = m.fa;
    for (let i = 0; i < fa.length; i += 5) this.foods.set(fa[i], { x: fa[i + 1], y: fa[i + 2], v: fa[i + 3], c: fa[i + 4] });
    for (const id of m.fr) this.foods.delete(id);
    const me = map.get(this.id);
    if (me) this.reconcile(me);
    if (m.lb) ui.leaderboard(m.lb, m.rk, m.n);
  }
  setSegs(s, p) {
    s.segs.length = 0;
    for (let i = 0; i < p.length; i += 2) s.segs.push({ x: p[i], y: p[i + 1] });
  }
  /* Client-side prediction: keep a locally simulated snake, nudge it toward the server state (lag-compensated). */
  reconcile(e) {
    const p = e.flat;
    if (!this.me || this.me.id !== this.id) {
      const s = new SG.Snake(this.id, e.name, e.skin, p[0], p[1], false);
      this.setSegs(s, p); s.angle = s.target = e.angle;
      this.me = s; this.err = { x: 0, y: 0 }; cam.snap = true;
    }
    const s = this.me; s.score = e.score;
    const sp = e.boosting ? SG.BOOST : SG.BASE, lead = this.ping / 2000 + 0.02;
    const px = p[0] + Math.cos(s.angle) * sp * lead, py = p[1] + Math.sin(s.angle) * sp * lead;
    const h = s.segs[0], ex = px - h.x, ey = py - h.y;
    if (Math.hypot(ex, ey) > 260) { this.setSegs(s, p); s.angle = e.angle; this.err = { x: 0, y: 0 }; }
    else this.err = { x: ex, y: ey };
  }
  update(dt, inp) {
    const me = this.me;
    if (me) {
      me.target = inp.angle; me.boost = inp.boost;
      me.move(dt);
      const k = 1 - Math.exp(-6 * dt), dx = this.err.x * k, dy = this.err.y * k;
      me.segs[0].x += dx; me.segs[0].y += dy; this.err.x -= dx; this.err.y -= dy;
    }
    const now = performance.now();
    if (this.ready && now - this.sendT > 33) {
      this.sendT = now;
      this.send({ t: 'i', a: +inp.angle.toFixed(3), b: inp.boost ? 1 : 0 });
    }
  }
  /* Entity interpolation: render other snakes ~100ms in the past between two snapshots. */
  render() {
    const out = { me: this.me ? entry(this.me) : null, others: [], foods: this.foods.values(), follow: null };
    const sn = this.snaps;
    if (!sn.length || this.off == null) return out;
    const rt = performance.now() + this.off - INTERP_MS;
    const first = sn[0], last = sn[sn.length - 1];
    let a, b;
    if (rt >= last.ts) a = b = last;
    else if (rt <= first.ts) a = b = first;
    else for (let i = sn.length - 1; i > 0; i--) if (sn[i - 1].ts <= rt) { a = sn[i - 1]; b = sn[i]; break; }
    const t = a === b ? 1 : Math.max(0, Math.min(1, (rt - a.ts) / (b.ts - a.ts)));
    for (const [id, e] of b.map) {
      if (id === this.id) continue;
      const ea = a.map.get(id);
      let f = e.flat;
      if (ea && ea !== e && t < 1) {
        const n = Math.min(ea.flat.length, e.flat.length);
        f = new Float64Array(e.flat.length);
        for (let i = 0; i < n; i++) f[i] = ea.flat[i] + (e.flat[i] - ea.flat[i]) * t;
        for (let i = n; i < f.length; i++) f[i] = e.flat[i];
      }
      out.others.push({ id, name: e.name, skin: e.skin, angle: e.angle, boosting: e.boosting, score: e.score, r: e.r, flat: f });
    }
    return out;
  }
}

/* ---------- game flow ---------- */
let session = null, demo = new LocalSession('', 0, true);
const cam = { x: 0, y: 0, z: 1, snap: true };
const playerName = () => (nick.value.trim() || 'Player').slice(0, 16);

const game = {
  begin(s) {
    if (session) session.close();
    session = s; cam.snap = true; ui.msg(''); ui.room('');
    if (s.ready) ui.hideMenu();
    store.set('nick', nick.value.trim());
  },
  solo() { this.begin(new LocalSession(playerName(), skinIdx, false)); },
  create() { ui.msg('Creating room...'); this.begin(new NetSession('create', playerName(), skinIdx)); },
  join() {
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 4) { ui.msg('Enter a 4-character room code'); return; }
    ui.msg('Joining...'); this.begin(new NetSession('join', playerName(), skinIdx, code));
  },
  again() {
    if (session instanceof NetSession) { session.name = playerName(); session.skin = skinIdx; session.respawn(); $('death').classList.add('hidden'); }
    else this.solo();
  },
  toMenu() {
    if (session) { session.close(); session = null; }
    ui.showMenu(); ui.room(''); cam.snap = true;
  }
};
$('play').onclick = () => game.solo();
$('create').onclick = () => game.create();
$('joinBtn').onclick = () => { $('joinRow').classList.toggle('hidden'); $('code').focus(); };
$('joinGo').onclick = () => game.join();
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') game.join(); });
nick.addEventListener('keydown', e => { if (e.key === 'Enter') game.solo(); });
$('again').onclick = () => game.again();
$('toMenu').onclick = () => game.toMenu();
$('roomtag').onclick = () => {
  const c = $('roomCode').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(c).then(() => ui.toast('Room code ' + c + ' copied'), () => {});
};

/* ---------- draw ---------- */
function drawWorld(st, time, dt) {
  const f = st.me || st.follow;
  if (f) {
    const tx = f.flat[0], ty = f.flat[1];
    const tz = Math.max(0.32, Math.min(1, 0.95 * Math.pow(1 + f.score / 350, -0.38)));
    if (cam.snap) { cam.x = tx; cam.y = ty; cam.z = tz; cam.snap = false; }
    else {
      const k = 1 - Math.exp(-14 * dt), kz = 1 - Math.exp(-2.5 * dt);
      cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * kz;
    }
  }
  const sc = cam.z * Math.max(0.6, Math.min(1.25, Math.sqrt(W * H) / 1100));
  const vb = { x0: cam.x - W / 2 / sc, y0: cam.y - H / 2 / sc, x1: cam.x + W / 2 / sc, y1: cam.y + H / 2 / sc };

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-cam.x, -cam.y);

  ctx.fillStyle = hexPattern; ctx.fillRect(vb.x0, vb.y0, vb.x1 - vb.x0, vb.y1 - vb.y0);
  // out-of-bounds shade + glowing border
  ctx.beginPath();
  ctx.rect(vb.x0 - 20, vb.y0 - 20, vb.x1 - vb.x0 + 40, vb.y1 - vb.y0 + 40);
  ctx.arc(0, 0, ARENA, 0, TAU, true);
  ctx.fillStyle = 'rgba(30,0,12,.82)'; ctx.fill('evenodd');
  ctx.beginPath(); ctx.arc(0, 0, ARENA, 0, TAU);
  ctx.lineWidth = 12; ctx.strokeStyle = '#ff2a55'; ctx.shadowColor = '#ff2a55'; ctx.shadowBlur = 30; ctx.stroke();
  ctx.shadowBlur = 0;

  // food (glow sprites with a slight pulse)
  for (const fd of st.foods) {
    if (fd.x < vb.x0 - 30 || fd.x > vb.x1 + 30 || fd.y < vb.y0 - 30 || fd.y > vb.y1 + 30) continue;
    const r = (3 + Math.sqrt(fd.v) * 1.7) * (1 + 0.12 * Math.sin(time * 3 + fd.x * 0.05)), s = r * 2 * (64 / 28);
    ctx.drawImage(glow(SG.FOOD_COLORS[fd.c]), fd.x - s / 2, fd.y - s / 2, s, s);
  }

  const names = [];
  const draw = e => {
    drawSnake(ctx, e.flat, e.skin, e.r, e.boosting, e.angle, vb);
    names.push(e);
  };
  for (const e of st.others) draw(e);
  if (st.me) draw(st.me);

  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = 'bold ' + Math.round(13 / sc) + 'px "Trebuchet MS",sans-serif';
  for (const e of names) {
    if (e.flat[0] < vb.x0 || e.flat[0] > vb.x1 || e.flat[1] < vb.y0 || e.flat[1] > vb.y1) continue;
    ctx.fillText(e.name, e.flat[0], e.flat[1] - e.r - 12 / sc);
  }
  ctx.restore();
}

function drawMinimap(st) {
  const S = mmc.width, c = S / 2, R = c - 4;
  mm.clearRect(0, 0, S, S);
  mm.fillStyle = 'rgba(8,12,22,.7)'; mm.beginPath(); mm.arc(c, c, R, 0, TAU); mm.fill();
  mm.strokeStyle = '#2a3a60'; mm.lineWidth = 3; mm.stroke();
  for (const e of st.others) {
    mm.fillStyle = SG.skinColor(e.skin, 0);
    mm.beginPath(); mm.arc(c + e.flat[0] / ARENA * R, c + e.flat[1] / ARENA * R, 3, 0, TAU); mm.fill();
  }
  if (st.me) {
    mm.fillStyle = '#fff'; mm.shadowColor = '#fff'; mm.shadowBlur = 8;
    mm.beginPath(); mm.arc(c + st.me.flat[0] / ARENA * R, c + st.me.flat[1] / ARENA * R, 5, 0, TAU); mm.fill();
    mm.shadowBlur = 0;
  }
}

let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  const active = session && session.ready;
  const s = active ? session : demo;
  s.update(dt, input);
  const st = s.render();
  drawWorld(st, t / 1000, dt);
  if (active) {
    if (st.me) ui.score(st.me.score);
    drawMinimap(st);
  } else drawPreview(t / 1000);
}
requestAnimationFrame(frame);
})();
