// FlameRenderer — a canvas particle flame that reacts to the game state.
// intensity: 0..1 (how tall/bright the flame burns)
// mood: 'light' | 'dark' — shifts the palette (golden vs. cold violet)

class FlameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.embers = [];
    this.intensity = 0.7;
    this.targetIntensity = 0.7;
    this.mood = 'light';
    this.pulse = 0;        // transient burst, +bright / -dark
    this.pulseColor = null;
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  setIntensity(v) {
    this.targetIntensity = Math.max(0.02, Math.min(1, v));
  }
  setMood(m) {
    this.mood = m === 'dark' ? 'dark' : 'light';
  }
  burst(dir) {
    // dir: 'light' adds bright sparks; 'dark' sends a cold recoil
    this.pulse = dir === 'dark' ? -1 : 1;
    this.pulseColor = dir === 'dark' ? 'dark' : 'light';
    // shoot embers
    const n = 18;
    for (let i = 0; i < n; i++) {
      this.embers.push({
        x: this.w / 2 + (Math.random() - 0.5) * 20,
        y: this.h * 0.9,
        vx: (Math.random() - 0.5) * 3.2,
        vy: -(1.5 + Math.random() * 3) * (dir === 'dark' ? 0.5 : 1),
        life: 1,
        size: 1.5 + Math.random() * 2,
        dark: dir === 'dark',
      });
    }
  }

  loop(now) {
    const dt = Math.min(50, now - this.last);
    this.last = now;
    this.time += dt;
    this.intensity += (this.targetIntensity - this.intensity) * 0.06;
    this.pulse *= 0.9;
    this.draw(dt);
    requestAnimationFrame(this.loop.bind(this));
  }

  draw(dt) {
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    if (w < 2 || h < 2) return;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const baseY = h - 4;
    const inten = Math.max(0.04, this.intensity + this.pulse * 0.18);
    const dark = this.mood === 'dark';

    // ---- ambient glow
    const glowR = 50 + inten * 150;
    const g = ctx.createRadialGradient(cx, h * 0.62, 0, cx, h * 0.62, glowR);
    const glowA = 0.12 + inten * 0.33;
    if (dark) {
      g.addColorStop(0, `rgba(120, 70, 200, ${glowA * 0.8})`);
      g.addColorStop(1, 'rgba(60,20,90,0)');
    } else {
      g.addColorStop(0, `rgba(255, ${Math.round(170 - inten * 50)}, 70, ${glowA})`);
      g.addColorStop(1, 'rgba(255,140,0,0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // ---- dark wisps creeping up when the flame is low / dark
    if (inten < 0.45 || dark) {
      const wisps = dark ? 4 : 2;
      for (let i = 0; i < wisps; i++) {
        const wx = cx + Math.sin(this.time * 0.0006 + i * 2) * (w * 0.32);
        const wy = h * 0.7 - ((this.time * 0.02 + i * 50) % (h * 0.6));
        const wr = 26 + Math.sin(this.time * 0.002 + i) * 8;
        const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr);
        wg.addColorStop(0, 'rgba(80,40,130,0.10)');
        wg.addColorStop(1, 'rgba(40,10,70,0)');
        ctx.fillStyle = wg;
        ctx.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
      }
    }

    // ---- spawn flame particles
    const spawn = Math.floor(inten * 3.4) + 1;
    for (let i = 0; i < spawn; i++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * (8 + inten * 22),
        y: baseY,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -(0.9 + Math.random() * 1.3) * (0.45 + inten),
        life: 1,
        size: 5 + Math.random() * 9 + inten * 9,
        flick: Math.random() * Math.PI * 2,
      });
    }

    // ---- draw flame particles (additive)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx + Math.sin(p.flick += 0.12) * 0.35;
      p.y += p.vy;
      p.vy *= 0.992;
      p.life -= 0.013;
      if (p.life <= 0 || p.y < h * 0.08) { this.particles.splice(i, 1); continue; }
      const a = p.life * (0.34 + inten * 0.42);
      const t = 1 - p.life; // 0 at base -> 1 at tip
      let r, gr, b;
      if (dark) {
        // cold violet / blue flame
        if (t < 0.3) { r = 200; gr = 180; b = 255; }
        else if (t < 0.7) { r = 150; gr = 90; b = 230; }
        else { r = 90; gr = 40; b = 160; }
      } else {
        if (t < 0.28) { r = 255; gr = 250; b = 220; }        // white-hot core
        else if (t < 0.7) { r = 255; gr = Math.round(170 - t * 120); b = 45; } // orange
        else { r = Math.round(210 - t * 90); gr = 45; b = 25; } // red tip
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${r},${gr},${b},${a})`;
      ctx.arc(p.x, p.y, Math.max(0.4, p.size * p.life), 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- embers
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.x += e.vx;
      e.y += e.vy;
      e.vy += 0.04;
      e.life -= 0.012;
      if (e.life <= 0) { this.embers.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.fillStyle = e.dark
        ? `rgba(160,90,230,${e.life})`
        : `rgba(255,${Math.round(180 + e.life * 60)},120,${e.life})`;
      ctx.arc(e.x, e.y, Math.max(0.5, e.size * e.life), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    // ---- lantern base glow line
    const baseGrad = ctx.createLinearGradient(0, baseY - 6, 0, h);
    baseGrad.addColorStop(0, dark ? 'rgba(120,70,200,0.5)' : 'rgba(255,150,40,0.55)');
    baseGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(cx - 60, baseY - 6, 120, h - (baseY - 6));
  }
}

// Ambient background: drifting embers + fog on a dark sky.
class BgRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stars = [];
    this.fog = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    // stars
    this.stars = [];
    for (let i = 0; i < 90; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h * 0.7,
        r: Math.random() * 1.3 + 0.2,
        tw: Math.random() * Math.PI * 2,
        s: 0.0008 + Math.random() * 0.002,
      });
    }
    // fog blobs
    this.fog = [];
    for (let i = 0; i < 6; i++) {
      this.fog.push({
        x: Math.random() * this.w,
        y: this.h * (0.5 + Math.random() * 0.5),
        r: 120 + Math.random() * 180,
        vx: (Math.random() - 0.5) * 0.15,
        a: 0.03 + Math.random() * 0.04,
      });
    }
  }
  loop(now) {
    const dt = Math.min(50, now - this.last);
    this.last = now;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    // fog
    this.fog.forEach((f) => {
      f.x += f.vx;
      if (f.x < -f.r) f.x = w + f.r;
      if (f.x > w + f.r) f.x = -f.r;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(60,50,90,${f.a})`);
      g.addColorStop(1, 'rgba(20,15,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    });
    // stars
    this.stars.forEach((s) => {
      s.tw += s.s * dt;
      const a = 0.3 + Math.sin(s.tw) * 0.3 + 0.3;
      ctx.beginPath();
      ctx.fillStyle = `rgba(220,210,255,${a})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(this.loop.bind(this));
  }
}
