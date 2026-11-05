/* Shared game simulation: runs on the server (multiplayer rooms) and in the browser (vs Bots). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const ARENA = 3000;          // arena radius
  const BASE = 200;            // px/s
  const BOOST = 450;           // px/s
  const TURN = 3.8;            // rad/s
  const MAX_FOOD = 3200;
  const BOOST_COST = 8;        // mass per second while boosting

  const FOOD_COLORS = ['#ff3b6b', '#ffb02e', '#fff23d', '#39ff88', '#2ee6ff', '#4d7cff', '#b44dff', '#ff4df0', '#ff7a3d', '#9dff3d'];

  const SKINS = [
    { n: 'Neon Lime', c: ['#39ff14'] },
    { n: 'Toxic', c: ['#39ff14', '#0a2e0a'], w: 3 },
    { n: 'Plasma', c: ['#ff2fd1', '#7a2fff'], w: 4 },
    { n: 'Solar', c: ['#fff23d', '#ff8a00'], w: 3 },
    { n: 'Glacier', c: ['#e8fbff', '#2ee6ff', '#2d6bff'], w: 3 },
    { n: 'Lava', c: ['#ff2a2a', '#ff9a00', '#3a0000'], w: 4 },
    { n: 'Candy', c: ['#ff4d8d', '#ffffff'], w: 2 },
    { n: 'Rainbow', rainbow: true },
    { n: 'Deep Blue', c: ['#0a6bff'] },
    { n: 'Phantom', c: ['#d9d9ff', '#6b4dff'], w: 5 },
    { n: 'Cherry', c: ['#ff1744'] },
    { n: 'Mint Choc', c: ['#5dffc4', '#3b1d0f'], w: 3 },
    { n: 'Bee', c: ['#ffe600', '#111111'], w: 2 },
    { n: 'Aurora', c: ['#00ffa3', '#00c8ff', '#8a5bff', '#ff4df0'], w: 4 },
    { n: 'Pumpkin', c: ['#ff7a00', '#2a1500'], w: 3 },
    { n: 'Royal', c: ['#ffd700', '#6a0dad', '#ffd700', '#0b0b6b'], w: 2 }
  ];

  const BOT_NAMES = ['Viper', 'Noodle', 'Zigzag', 'Slinky', 'Mamba', 'Python', 'Cobra', 'Ziggy', 'Sidewinder', 'Basil',
    'Coil', 'Fang', 'Rattler', 'Naga', 'Boa', 'Hiss', 'Wiggles', 'Taipan', 'Slyther', 'Adder', 'Nova', 'Pixel',
    'Comet', 'Blaze', 'Echo', 'Flux', 'Orbit', 'Static', 'Turbo', 'Glitch'];

  const norm = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const radius = score => Math.min(36, 9 + Math.sqrt(score) * 0.5);
  const segLen = score => 18 + Math.floor(score * 0.25);
  const rand = (a, b) => a + Math.random() * (b - a);

  function skinColor(skin, i) {
    const s = SKINS[skin] || SKINS[0];
    if (s.rainbow) return 'hsl(' + ((i * 15) % 360) + ',100%,55%)';
    return s.c[Math.floor(i / (s.w || 1)) % s.c.length];
  }

  class Snake {
    constructor(id, name, skin, x, y, bot) {
      this.id = id; this.name = name; this.skin = skin; this.bot = !!bot;
      this.angle = this.target = Math.random() * TAU;
      this.score = 10; this.boost = false; this.alive = true; this.acc = 0; this.reach = 0;
      this.ai = { t: Math.random() * 0.2, w: 0, boostT: 0, aggr: rand(0.2, 0.95) };
      this.segs = [];
      const n = this.len(), sp = this.spacing();
      for (let i = 0; i < n; i++) this.segs.push({ x: x - Math.cos(this.angle) * sp * i, y: y - Math.sin(this.angle) * sp * i });
    }
    get r() { return radius(this.score); }
    get boosting() { return this.boost && this.score > 12; }
    len() { return segLen(this.score); }
    spacing() { return this.r * 0.5; }

    move(dt) {
      const d = norm(this.target - this.angle);
      const maxT = TURN * (1 - Math.min(0.5, (this.r - 10) / 60)) * dt;
      this.angle += Math.max(-maxT, Math.min(maxT, d));
      const sp = this.boosting ? BOOST : BASE;
      const h = this.segs[0];
      h.x += Math.cos(this.angle) * sp * dt;
      h.y += Math.sin(this.angle) * sp * dt;
      const n = this.len(), segs = this.segs;
      while (segs.length < n) { const t = segs[segs.length - 1]; segs.push({ x: t.x, y: t.y }); }
      while (segs.length > n && segs.length > 3) segs.pop();
      const s = this.spacing();
      for (let i = 1; i < segs.length; i++) {
        const p = segs[i - 1], c = segs[i];
        const dx = p.x - c.x, dy = p.y - c.y, dd = Math.hypot(dx, dy);
        if (dd > s) { const k = (dd - s) / dd; c.x += dx * k; c.y += dy * k; }
      }
    }
  }

  class World {
    constructor(opts) {
      opts = opts || {};
      this.snakes = []; this.foods = [];
      this.nextId = 1; this.fid = 0; this.time = 0;
      this.botTarget = opts.bots || 0;
      this.foodTarget = opts.food || 1300;
      this.onDeath = opts.onDeath || null;
      this.botTimers = [];
      for (let i = 0; i < this.foodTarget; i++) this.spawnFood();
      for (let i = 0; i < this.botTarget; i++) this.addBot();
    }

    randPos(margin) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * (ARENA - margin);
      return { x: Math.cos(a) * d, y: Math.sin(a) * d };
    }
    addFood(x, y, v, c) {
      if (this.foods.length >= MAX_FOOD) return;
      this.foods.push({ id: ++this.fid, x, y, v, c: c == null ? (Math.random() * FOOD_COLORS.length) | 0 : c });
    }
    spawnFood() {
      const p = this.randPos(60), r = Math.random();
      this.addFood(p.x, p.y, r < 0.8 ? 1 : r < 0.95 ? 2 : r < 0.99 ? 3 : 5);
    }
    safePos() {
      for (let t = 0; t < 12; t++) {
        const p = this.randPos(500);
        let ok = true;
        for (const s of this.snakes) {
          for (let i = 0; i < s.segs.length; i += 3) {
            const q = s.segs[i];
            if ((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) < 90000) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (ok) return p;
      }
      return this.randPos(500);
    }
    addSnake(name, skin, bot) {
      const p = this.safePos();
      const s = new Snake(this.nextId++, name, skin, p.x, p.y, bot);
      this.snakes.push(s);
      return s;
    }
    addBot() {
      return this.addSnake(BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0], (Math.random() * SKINS.length) | 0, true);
    }

    kill(s, killer) {
      if (!s.alive) return;
      s.alive = false;
      const i = this.snakes.indexOf(s);
      if (i >= 0) this.snakes.splice(i, 1);
      const n = s.segs.length, k = Math.max(1, Math.ceil(n / 90));
      const per = Math.max(2, Math.round(s.score * 0.85 / (n / k)));
      for (let j = 0; j < n; j += k) {
        const q = s.segs[j];
        this.addFood(q.x + rand(-6, 6), q.y + rand(-6, 6), per, (s.skin + j) % FOOD_COLORS.length);
      }
      if (s.bot) this.botTimers.push(rand(3, 5));
      if (this.onDeath) this.onDeath(s, killer || null);
    }

    step(dt) {
      this.time += dt;
      const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
      for (let i = 0; i < n; i++) this.sub(h);
      for (let i = this.botTimers.length - 1; i >= 0; i--) {
        this.botTimers[i] -= dt;
        if (this.botTimers[i] <= 0) { this.botTimers.splice(i, 1); this.addBot(); }
      }
      let need = Math.min(12, this.foodTarget - this.foods.length);
      while (need-- > 0) this.spawnFood();
    }

    sub(h) {
      const sn = this.snakes;
      for (const s of sn) {
        s.reach = s.segs.length * s.spacing();
        if (s.bot) {
          s.ai.t -= h; s.ai.boostT -= h;
          if (s.ai.t <= 0) { s.ai.t = 0.12 + Math.random() * 0.1; this.think(s); }
        }
        if (s.boosting) {
          s.acc += h * BOOST_COST;
          while (s.acc >= 1 && s.score > 12) {
            s.acc -= 1; s.score -= 1;
            const t = s.segs[s.segs.length - 1];
            this.addFood(t.x + rand(-5, 5), t.y + rand(-5, 5), 1, s.skin % FOOD_COLORS.length);
          }
        }
        s.move(h);
        const hd = s.segs[0], er = s.r + 16, e2 = er * er, f = this.foods;
        for (let i = f.length - 1; i >= 0; i--) {
          const dx = f[i].x - hd.x, dy = f[i].y - hd.y;
          if (dx * dx + dy * dy < e2) { s.score += f[i].v; f[i] = f[f.length - 1]; f.pop(); }
        }
      }
      const dead = [];
      for (const a of sn) {
        const hd = a.segs[0];
        if (hd.x * hd.x + hd.y * hd.y > ARENA * ARENA) { dead.push([a, null]); continue; }
        for (const b of sn) {
          if (b === a) continue;
          const bh = b.segs[0], lim = a.r + b.r + b.reach;
          if (Math.abs(bh.x - hd.x) > lim || Math.abs(bh.y - hd.y) > lim) continue;
          const rr = (a.r + b.r) * 0.72, r2 = rr * rr;
          let hit = false;
          for (let i = 0; i < b.segs.length; i++) {
            const p = b.segs[i], dx = p.x - hd.x, dy = p.y - hd.y;
            if (dx * dx + dy * dy < r2) { hit = true; break; }
          }
          if (hit) { dead.push([a, b]); break; }
        }
      }
      for (const d of dead) this.kill(d[0], d[1]);
    }

    /* Returns a body segment of another snake lying on the path ahead of s, or null. */
    findDanger(s, look) {
      const h = s.segs[0], ca = Math.cos(s.angle), sa = Math.sin(s.angle), R = s.r;
      for (const o of this.snakes) {
        if (o === s) continue;
        const oh = o.segs[0], lim = look + R + o.r + o.reach;
        if (Math.abs(oh.x - h.x) > lim || Math.abs(oh.y - h.y) > lim) continue;
        const rr = (R + o.r) * 0.9 + 14, r2 = rr * rr;
        for (let d = look * 0.4; d <= look; d += look * 0.3) {
          const px = h.x + ca * d, py = h.y + sa * d;
          for (let j = 0; j < o.segs.length; j += 2) {
            const q = o.segs[j], dx = q.x - px, dy = q.y - py;
            if (dx * dx + dy * dy < r2) return q;
          }
        }
      }
      return null;
    }

    /* Bot AI: avoid walls/bodies, hunt smaller snakes by cutting them off, chase food, wander, boost sometimes. */
    think(s) {
      const h = s.segs[0], ai = s.ai, ca = Math.cos(s.angle), sa = Math.sin(s.angle);
      if (h.x * h.x + h.y * h.y > (ARENA - 320) * (ARENA - 320)) {
        s.target = Math.atan2(-h.y, -h.x); s.boost = false; return;
      }
      const q = this.findDanger(s, 100 + s.r * 3);
      if (q) {
        const cr = ca * (q.y - h.y) - sa * (q.x - h.x);
        s.target = s.angle + (cr > 0 ? -1.3 : 1.3);
        s.boost = s.score > 30 && Math.random() < 0.2;
        return;
      }
      let prey = null, bd = 520;
      for (const o of this.snakes) {
        if (o === s) continue;
        const oh = o.segs[0], d = Math.hypot(oh.x - h.x, oh.y - h.y);
        if (d < bd && o.score < s.score * 2.5) { bd = d; prey = o; }
      }
      if (prey && ai.aggr > 0.3) {
        const oh = prey.segs[0], lead = Math.min(300, bd * 0.9);
        s.target = Math.atan2(oh.y + Math.sin(prey.angle) * lead - h.y, oh.x + Math.cos(prey.angle) * lead - h.x);
        s.boost = bd < 380 && s.score > 40 && Math.random() < 0.6;
        return;
      }
      let best = null, bs = 0;
      for (const f of this.foods) {
        const dx = f.x - h.x, dy = f.y - h.y, d2 = dx * dx + dy * dy;
        if (d2 > 202500) continue;
        const sc = f.v / (Math.sqrt(d2) + 40);
        if (sc > bs) { bs = sc; best = f; }
      }
      if (best) s.target = Math.atan2(best.y - h.y, best.x - h.x);
      else { ai.w = ai.w * 0.7 + (Math.random() - 0.5) * 0.9; s.target = s.angle + ai.w; }
      if (ai.boostT <= 0 && s.score > 50 && Math.random() < 0.01) ai.boostT = rand(1, 2.5);
      s.boost = ai.boostT > 0;
    }
  }

  return { TAU, ARENA, BASE, BOOST, SKINS, FOOD_COLORS, skinColor, radius, segLen, norm, Snake, World };
});
