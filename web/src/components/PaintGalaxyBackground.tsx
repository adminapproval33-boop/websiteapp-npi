import { useEffect, useRef } from "react";

interface Particle {
  sprite: HTMLCanvasElement;
  r: number;
  theta: number;
  t: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  spin: number;
  wob: number;
  wobF: number;
  sx: number;
  sy: number;
  delay: number;
  dur: number;
}

interface Star {
  x: number;
  y: number;
  s: number;
  v: number;
  tw: number;
  tf: number;
  c: string;
  spike: boolean;
}

interface Ripple {
  x: number;
  y: number;
  t: number;
  s: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  len: number;
}

interface Planet {
  x: number;
  y: number;
  r: number;
}

/**
 * Animasi latar "galaksi cat" di ruang angkasa -- partikel cipratan cat 2D
 * membentuk pusaran galaksi (mouse-reactive spt cairan), di atas latar
 * nebula/pita Bima Sakti/bintang berparalaks/bintang jatuh/planet yg
 * digambar sekali ke canvas offscreen `bg` lalu dipakai ulang tiap frame
 * (2026-09-23, revisi kedua dari file animasi HTML yg dikirim user --
 * versi pertama dirasa "kurang menunjukan ruang angkasa", jadi diganti versi
 * ini yg py elemen luar angkasa lebih eksplisit). Dipangkas dari file
 * aslinya: bagian <nav>/<hero>/tombol dibuang krn halaman login sudah py
 * kartu form sendiri -- yg dipakai cuma mesin partikel & latar canvas-nya.
 */
export default function PaintGalaxyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const ctx2d = canvasEl?.getContext("2d");
    if (!canvasEl || !ctx2d) return;
    // Re-bind ke const baru krn narrowing TS di atas TIDAK terbawa ke dalam
    // closure fungsi bersarang (resize/build/frame) yg didefinisikan &
    // dipanggil belakangan di effect ini.
    const cvs = canvasEl;
    const ctx = ctx2d;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    let DPR = 1;
    let R = 0;
    let centerX = 0;
    let centerY = 0;

    const palette: Array<[string, number]> = [
      ["#e3121b", 10],
      ["#ff3b3b", 8],
      ["#b80d1f", 7],
      ["#ff5a4e", 6],
      ["#d9002f", 5],
      ["#ff2d55", 4],
      ["#1d4fd6", 6],
      ["#3b7bff", 5],
      ["#0f2f9e", 4],
      ["#2196f3", 3],
      ["#4054e8", 2],
      ["#ffffff", 7],
      ["#f3f0e8", 3],
      ["#9b3fd6", 2.5],
      ["#6a3fd6", 2],
      ["#c04dd9", 2],
      ["#ff6fb1", 2.5],
      ["#ff9ec4", 1.5],
      ["#8fb4ff", 2],
      ["#9fe7ff", 1.5],
      ["#ff8a3d", 2.5],
      ["#ffb347", 2],
      ["#ffd166", 2],
      ["#f5e663", 1.5],
      ["#3ed1c4", 2],
      ["#22b573", 1.5],
      ["#9be15d", 1.5],
      ["#c7a17a", 1.5],
      ["#ff7a7a", 1.5],
    ];
    const totalW = palette.reduce((s, p) => s + p[1], 0);
    const pickColor = () => {
      let r = Math.random() * totalW;
      for (const [c, w] of palette) {
        r -= w;
        if (r <= 0) return c;
      }
      return palette[0][0];
    };
    const gauss = () => ((Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.58) * 0.5;

    const S = 128;
    function makeSplat(color: string) {
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const g = c.getContext("2d")!;
      g.translate(S / 2, S / 2);
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 12;
      const base = S * 0.15;
      const n = 12 + ((Math.random() * 6) | 0);
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = base * (0.72 + Math.random() * 0.5);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      g.beginPath();
      const m0 = mid(pts[n - 1], pts[0]);
      g.moveTo(m0[0], m0[1]);
      for (let i = 0; i < n; i++) {
        const m = mid(pts[i], pts[(i + 1) % n]);
        g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
      }
      g.fill();
      const spikes = 3 + ((Math.random() * 5) | 0);
      for (let i = 0; i < spikes; i++) {
        const a = Math.random() * Math.PI * 2;
        const len = base * (0.9 + Math.random() * 1.5);
        const w = base * (0.12 + Math.random() * 0.14);
        g.save();
        g.rotate(a);
        g.beginPath();
        g.moveTo(base * 0.5, -w);
        g.quadraticCurveTo(base * 0.5 + len * 0.6, -w * 0.25, base * 0.5 + len, 0);
        g.quadraticCurveTo(base * 0.5 + len * 0.6, w * 0.25, base * 0.5, w);
        g.fill();
        g.beginPath();
        g.arc(base * 0.5 + len, 0, w * 0.75, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      const drops = 3 + ((Math.random() * 6) | 0);
      for (let i = 0; i < drops; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = base * (1.4 + Math.random() * 1.3);
        const r = base * (0.06 + Math.random() * 0.18);
        g.beginPath();
        g.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2);
        g.fill();
      }
      g.shadowBlur = 0;
      g.fillStyle = "rgba(255,255,255,.45)";
      g.beginPath();
      g.ellipse(-base * 0.3, -base * 0.32, base * 0.28, base * 0.14, -0.6, 0, Math.PI * 2);
      g.fill();
      return c;
    }
    const spriteCache: Record<string, HTMLCanvasElement[]> = {};
    const getSprite = (color: string) => {
      const list = spriteCache[color] || (spriteCache[color] = Array.from({ length: 6 }, () => makeSplat(color)));
      return list[(Math.random() * list.length) | 0];
    };

    let parts: Particle[] = [];
    let stars: Star[] = [];

    // ---------- Latar luar angkasa (digambar sekali ke canvas offscreen,
    // lalu dipakai ulang tiap frame -- noise-based nebula & pita Bima
    // Sakti, JAUH lebih berat kalau di-render ulang tiap frame). ----------
    const bg = document.createElement("canvas");
    const bgx = bg.getContext("2d")!;
    const SEED = Math.random() * 1000;
    const hash2 = (x: number, y: number) => {
      let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
    const vnoise = (x: number, y: number) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const u = xf * xf * (3 - 2 * xf);
      const v = yf * yf * (3 - 2 * yf);
      const a = hash2(xi, yi);
      const b = hash2(xi + 1, yi);
      const c = hash2(xi, yi + 1);
      const d = hash2(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm2 = (x0: number, y0: number) => {
      let s = 0;
      let a = 0.5;
      let x = x0;
      let y = y0;
      for (let i = 0; i < 5; i++) {
        s += a * vnoise(x, y);
        x = x * 2.03 + 17.1;
        y = y * 2.03 + 9.7;
        a *= 0.5;
      }
      return s;
    };
    const sstep = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    let planet: Planet = { x: -1e4, y: 0, r: 0 };

    function makeSpace() {
      bg.width = W * DPR;
      bg.height = H * DPR;
      bgx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const M = Math.min(W, H);
      const gcx = centerX;
      const gcy = centerY;

      const g = bgx.createRadialGradient(gcx, gcy, 0, gcx, gcy, Math.max(W, H) * 0.85);
      g.addColorStop(0, "#0e1233");
      g.addColorStop(0.45, "#070a1e");
      g.addColorStop(1, "#020309");
      bgx.fillStyle = g;
      bgx.fillRect(0, 0, W, H);

      const sc = 5;
      const lw = Math.ceil(W / sc);
      const lh = Math.ceil(H / sc);
      const neb = document.createElement("canvas");
      neb.width = lw;
      neb.height = lh;
      const nx = neb.getContext("2d")!;
      const img = nx.createImageData(lw, lh);
      const D = img.data;
      const ax = W * 1.05;
      const ay = -H * 0.1;
      const bx2 = -W * 0.05;
      const by2 = H * 1.1;
      const ldx = bx2 - ax;
      const ldy = by2 - ay;
      const llen = Math.hypot(ldx, ldy);
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const X = x * sc;
          const Y = y * sc;
          const u = X / M;
          const v = Y / M;
          const n = fbm2(u * 2.2 + SEED, v * 2.2);
          const n2 = fbm2(u * 4.5 + 50 + SEED, v * 4.5 + 20);
          const n3 = fbm2(u * 1.3 - SEED, v * 1.3 + 7);
          const dist = Math.abs((X - ax) * ldy - (Y - ay) * ldx) / llen / M;
          const band = Math.exp((-dist * dist) / 0.035);
          const cloud = sstep(0.42, 0.78, n) * sstep(0.35, 0.7, n3);
          const dust = sstep(0.5, 0.68, n2);
          const cd = Math.hypot(X - gcx, Y - gcy) / M;
          const keep = 0.3 + 0.7 * sstep(0.12, 0.55, cd);
          let r: number;
          let gg: number;
          let b: number;
          const m = sstep(0.3, 0.75, n2 * 0.6 + n3 * 0.6);
          if (m < 0.5) {
            const k = m * 2;
            r = 190 * (1 - k) + 110 * k;
            gg = 30 * (1 - k) + 40 * k;
            b = 90 * (1 - k) + 170 * k;
          } else {
            const k = (m - 0.5) * 2;
            r = 110 * (1 - k) + 25 * k;
            gg = 40 * (1 - k) + 90 * k;
            b = 170 * (1 - k) + 200 * k;
          }
          const bandLight = band * (0.45 + 0.7 * n) * (1 - 0.75 * dust);
          const I = Math.min(1, (cloud * 0.75 + bandLight * 0.5) * keep);
          const bl = bandLight * keep * 0.55;
          const i = (y * lw + x) * 4;
          D[i] = Math.min(255, r + bl * 120);
          D[i + 1] = Math.min(255, gg + bl * 120);
          D[i + 2] = Math.min(255, b + bl * 110);
          D[i + 3] = I * 200;
        }
      }
      nx.putImageData(img, 0, 0);
      bgx.save();
      bgx.globalCompositeOperation = "lighter";
      bgx.imageSmoothingQuality = "high";
      bgx.filter = "blur(4px)";
      bgx.drawImage(neb, 0, 0, W, H);
      bgx.filter = "none";
      bgx.restore();

      const nStar = Math.round((W * H) / 350);
      for (let i = 0; i < nStar; i++) {
        const X = Math.random() * W;
        const Y = Math.random() * H;
        const dist = Math.abs((X - ax) * ldy - (Y - ay) * ldx) / llen / M;
        if (Math.random() > 0.35 + 0.65 * Math.exp((-dist * dist) / 0.02)) continue;
        const a = 0.15 + Math.pow(Math.random(), 2) * 0.75;
        const r = 0.3 + Math.pow(Math.random(), 3) * 0.9;
        bgx.fillStyle = Math.random() < 0.15 ? `rgba(255,210,170,${a})` : Math.random() < 0.3 ? `rgba(180,205,255,${a})` : `rgba(255,255,255,${a})`;
        bgx.beginPath();
        bgx.arc(X, Y, r, 0, Math.PI * 2);
        bgx.fill();
      }
      for (let i = 0; i < Math.round((W * H) / 60000); i++) {
        const X = Math.random() * W;
        const Y = Math.random() * H;
        const r = 4 + Math.random() * 8;
        const hg = bgx.createRadialGradient(X, Y, 0, X, Y, r);
        hg.addColorStop(0, "rgba(255,255,255,.9)");
        hg.addColorStop(0.15, "rgba(200,220,255,.35)");
        hg.addColorStop(1, "rgba(120,160,255,0)");
        bgx.fillStyle = hg;
        bgx.fillRect(X - r, Y - r, r * 2, r * 2);
      }

      const pr = M * (W < 700 ? 0.22 : 0.3);
      const pcx = W < 700 ? -pr * 0.2 : W * 0.02;
      const pcy = H + pr * 0.42;
      planet = { x: pcx, y: pcy, r: pr + 2 };
      bgx.save();
      bgx.beginPath();
      bgx.arc(pcx, pcy, pr, 0, Math.PI * 2);
      bgx.clip();
      const pg = bgx.createRadialGradient(pcx + pr * 0.35, pcy - pr * 0.85, pr * 0.05, pcx, pcy, pr * 1.05);
      pg.addColorStop(0, "#3a4f9a");
      pg.addColorStop(0.35, "#1b2458");
      pg.addColorStop(0.75, "#0a0d22");
      pg.addColorStop(1, "#04050c");
      bgx.fillStyle = pg;
      bgx.fillRect(pcx - pr, pcy - pr, pr * 2, pr * 2);
      for (let i = 0; i < 9; i++) {
        const yy = pcy - pr + (i + 0.5) * ((pr * 2) / 9) + (Math.random() - 0.5) * pr * 0.08;
        bgx.fillStyle = i % 3 === 0 ? "rgba(200,70,90,.10)" : "rgba(120,150,255,.07)";
        bgx.beginPath();
        bgx.ellipse(pcx, yy, pr * 1.1, pr * (0.03 + Math.random() * 0.04), -0.12, 0, Math.PI * 2);
        bgx.fill();
      }
      const sh = bgx.createLinearGradient(pcx + pr * 0.45, pcy - pr * 0.95, pcx - pr * 0.7, pcy + pr * 0.1);
      sh.addColorStop(0, "rgba(0,0,0,0)");
      sh.addColorStop(0.55, "rgba(0,0,0,.55)");
      sh.addColorStop(1, "rgba(0,0,0,.9)");
      bgx.fillStyle = sh;
      bgx.fillRect(pcx - pr, pcy - pr, pr * 2, pr * 2);
      bgx.restore();
      bgx.save();
      bgx.beginPath();
      bgx.arc(pcx, pcy, pr, -Math.PI * 0.72, -Math.PI * 0.12);
      bgx.strokeStyle = "rgba(110,160,255,.55)";
      bgx.lineWidth = 2;
      bgx.shadowColor = "rgba(90,140,255,.9)";
      bgx.shadowBlur = 14;
      bgx.stroke();
      bgx.restore();
    }

    function build() {
      const N = W < 700 ? 3000 : 6400;
      parts = [];
      for (let i = 0; i < N; i++) {
        const color = pickColor();
        let t: number;
        let theta: number;
        let r: number;
        let dust = false;
        const kind = Math.random();
        if (kind < 0.12) {
          t = Math.random() * 0.15;
          r = Math.abs(gauss()) * 0.16;
          theta = Math.random() * Math.PI * 2;
        } else if (kind < 0.72) {
          const arm = Math.random() < 0.5 ? 0 : 1;
          t = Math.pow(Math.random(), 0.8);
          r = 0.07 + 0.93 * t + gauss() * 0.055;
          theta = arm * Math.PI + t * Math.PI * 2.5 + gauss() * (0.38 * (1 - t) + 0.14);
        } else {
          dust = true;
          const arm = Math.random() < 0.5 ? 0 : 1;
          t = Math.random();
          r = 0.08 + 0.95 * t + gauss() * 0.12;
          theta = arm * Math.PI + t * Math.PI * 2.5 + gauss() * 0.9;
        }
        const big = Math.pow(Math.random(), 3);
        parts.push({
          sprite: getSprite(color),
          r,
          theta,
          t,
          ox: 0,
          oy: 0,
          vx: 0,
          vy: 0,
          size: dust ? 4 + Math.random() * 9 : 8 + big * 50 * (1 - t * 0.3),
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.6,
          wob: Math.random() * Math.PI * 2,
          wobF: 0.4 + Math.random() * 0.8,
          sx: (Math.random() - 0.5) * 2.4,
          sy: (Math.random() - 0.5) * 2.4,
          delay: 0.15 + t * 1.3 + Math.random() * 0.6,
          dur: 1.4 + Math.random() * 0.6,
        });
      }
      parts.sort((a, b) => a.size - b.size);

      const starCols = ["#ffffff", "#dfe8ff", "#bcd4ff", "#fff1d6", "#ffcf9e", "#ffb3b3"];
      stars = Array.from({ length: W < 700 ? 140 : 280 }, () => {
        const layer = Math.random();
        return {
          x: Math.random(),
          y: Math.random(),
          s: layer < 0.7 ? 0.4 + Math.random() * 0.7 : 0.9 + Math.random() * 1.1,
          v: (layer < 0.7 ? 0.0015 : 0.004) * (0.6 + Math.random() * 0.8),
          tw: Math.random() * Math.PI * 2,
          tf: 0.6 + Math.random() * 2.2,
          c: starCols[(Math.random() * starCols.length) | 0],
          spike: layer > 0.93,
        };
      });
      makeSpace();
    }

    const meteors: Meteor[] = [];
    let nextMeteor = 2.5;

    // Pusatkan pusaran galaksi (& gradasi langit di makeSpace) ke RUANG
    // KOSONG di kiri kartu login, bukan ke tengah window penuh (2026-09-23,
    // keluhan eksplisit user: "animasinya terlihat tidak center" -- kartu
    // login digeser ke kanan lewat .login-shift di app.css, jadi kalau CX
    // selalu W/2, separuh kanan pusarannya ketutup kartu & yg kelihatan di
    // ruang terbuka jadi nge-geser, bukan center). Diukur langsung dari DOM
    // (bukan hardcode breakpoint) supaya otomatis ngikut kalau .login-shift
    // diubah lagi belakangan.
    function measureOpenArea() {
      const cardEl = document.querySelector<HTMLElement>(".login-card-wrap");
      const rect = cardEl?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.left > W * 0.15) {
        return rect.left;
      }
      return W;
    }

    function resize() {
      DPR = Math.min(devicePixelRatio || 1, 2);
      W = innerWidth;
      H = innerHeight;
      cvs.width = W * DPR;
      cvs.height = H * DPR;
      cvs.style.width = W + "px";
      cvs.style.height = H + "px";
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const openW = measureOpenArea();
      centerX = openW / 2;
      centerY = H / 2;
      R = Math.min(openW, H) * 0.44;
    }

    let px = -9999;
    let py = -9999;
    let pvx = 0;
    let pvy = 0;
    let lastMove = 0;
    let active = false;
    let lastRipple = 0;
    const ripples: Ripple[] = [];
    const addRipple = (x: number, y: number, s: number) => {
      ripples.push({ x, y, t: performance.now() / 1000, s });
      if (ripples.length > 12) ripples.shift();
    };
    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now() / 1000;
      const dt = Math.max(now - lastMove, 0.008);
      if (active) {
        pvx = pvx * 0.6 + ((e.clientX - px) / dt) * 0.4;
        pvy = pvy * 0.6 + ((e.clientY - py) / dt) * 0.4;
      }
      px = e.clientX;
      py = e.clientY;
      lastMove = now;
      active = true;
      const sp = Math.hypot(pvx, pvy);
      if (sp > 700 && now - lastRipple > 0.12) {
        addRipple(px, py, Math.min(sp / 2500, 0.6));
        lastRipple = now;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      active = true;
      addRipple(px, py, 1);
    };
    const onPointerLeave = () => {
      active = false;
    };
    const onBlur = () => {
      active = false;
    };
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerleave", onPointerLeave);
    addEventListener("blur", onBlur);

    const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
    const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const t0 = performance.now();
    let prevNow = performance.now();
    let quality = 1;
    let fpsN = 0;
    let fpsT = 0;
    let rafId = 0;

    function frame(now: number) {
      const time = reduce ? 30 : (now - t0) / 1000;
      const dt = Math.min((now - prevNow) / 1000, 0.033);
      prevNow = now;
      const nowS = now / 1000;
      ctx.fillStyle = "#020309";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = clamp(time / 1.8);
      ctx.drawImage(bg, 0, 0, W, H);
      ctx.globalAlpha = 1;

      if (nowS - lastMove > 0.05) {
        pvx *= 0.85;
        pvy *= 0.85;
      }
      const CX = centerX;
      const CY = centerY;
      const RAD = Math.max(110, R * 0.38);
      while (ripples.length && nowS - ripples[0].t > 2.2) ripples.shift();

      const sa = clamp(time / 1.5);
      for (const s of stars) {
        s.x -= s.v * dt;
        if (s.x < -0.01) {
          s.x = 1.01;
          s.y = Math.random();
        }
        const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * s.tf + s.tw));
        const X = s.x * W;
        const Y = s.y * H;
        if (Math.hypot(X - planet.x, Y - planet.y) < planet.r) continue;
        ctx.globalAlpha = sa * tw;
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.arc(X, Y, s.s, 0, Math.PI * 2);
        ctx.fill();
        if (s.spike) {
          ctx.globalAlpha = sa * tw * 0.45;
          ctx.strokeStyle = s.c;
          ctx.lineWidth = 0.6;
          const L = s.s * 7 * tw;
          ctx.beginPath();
          ctx.moveTo(X - L, Y);
          ctx.lineTo(X + L, Y);
          ctx.moveTo(X, Y - L);
          ctx.lineTo(X, Y + L);
          ctx.stroke();
        }
      }

      if (!reduce && time > nextMeteor) {
        const ang = Math.PI * (0.78 + Math.random() * 0.12);
        const sp = 900 + Math.random() * 600;
        meteors.push({
          x: W * (0.3 + Math.random() * 0.8),
          y: -20 + Math.random() * H * 0.3,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          age: 0,
          life: 0.7 + Math.random() * 0.5,
          len: 120 + Math.random() * 140,
        });
        nextMeteor = time + 3 + Math.random() * 5;
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.age += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.age > m.life) {
          meteors.splice(i, 1);
          continue;
        }
        const a = Math.sin((Math.PI * m.age) / m.life);
        const v = Math.hypot(m.vx, m.vy);
        const tx = m.x - (m.vx / v) * m.len;
        const ty = m.y - (m.vy / v) * m.len;
        const mg = ctx.createLinearGradient(m.x, m.y, tx, ty);
        mg.addColorStop(0, `rgba(255,255,255,${0.9 * a})`);
        mg.addColorStop(0.3, `rgba(190,210,255,${0.35 * a})`);
        mg.addColorStop(1, "rgba(150,180,255,0)");
        ctx.globalAlpha = 1;
        ctx.strokeStyle = mg;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }

      const ga = clamp((time - 0.6) / 1.8) * (0.85 + 0.15 * Math.sin(time * 1.3));
      ctx.globalAlpha = ga;
      ctx.globalCompositeOperation = "lighter";
      const grd = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 0.32);
      grd.addColorStop(0, "rgba(255,245,235,.95)");
      grd.addColorStop(0.18, "rgba(255,200,150,.45)");
      grd.addColorStop(0.5, "rgba(120,170,255,.12)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(CX - R, CY - R, R * 2, R * 2);
      ctx.globalCompositeOperation = "source-over";

      const spin = time * 0.07;
      const scale = R / 420;
      fpsN++;
      fpsT += dt;
      if (fpsT > 1.2) {
        const fps = fpsN / fpsT;
        if (time > 5 && fps < 42 && quality > 0.45) quality -= 0.12;
        fpsN = 0;
        fpsT = 0;
      }
      const skip = Math.floor(parts.length * (1 - quality));
      for (let i = skip; i < parts.length; i++) {
        const p = parts[i];
        const th = p.theta + spin;
        const wob = Math.sin(time * p.wobF + p.wob) * 0.006;
        const tx = CX + Math.cos(th) * (p.r + wob) * R;
        const ty = CY + Math.sin(th) * (p.r + wob) * R * 0.9;
        const pr = clamp((time - p.delay) / p.dur);
        const e = easeOut(pr);
        if (pr <= 0) continue;
        const bx = CX + p.sx * W * 0.6 * (1 - e) + (tx - CX) * e;
        const by = CY + p.sy * H * 0.6 * (1 - e) + (ty - CY) * e;

        let x = bx + p.ox;
        let y = by + p.oy;
        if (active) {
          const dx = x - px;
          const dy = y - py;
          const d = Math.hypot(dx, dy) || 1;
          if (d < RAD) {
            const f = Math.pow(1 - d / RAD, 2);
            const nx = dx / d;
            const ny = dy / d;
            p.vx += (nx * 520 + -ny * 260) * f * dt * 4 + pvx * f * dt * 5;
            p.vy += (ny * 520 + nx * 260) * f * dt * 4 + pvy * f * dt * 5;
          }
        }
        for (const rp of ripples) {
          const age = nowS - rp.t;
          const rr = age * 380;
          const w = 60;
          const dx = x - rp.x;
          const dy = y - rp.y;
          const d = Math.hypot(dx, dy) || 1;
          const gap = Math.abs(d - rr);
          if (gap < w) {
            const k = (1 - gap / w) * Math.exp(-age * 1.6) * rp.s * 1600 * dt;
            p.vx += (dx / d) * k;
            p.vy += (dy / d) * k;
          }
        }
        p.vx += -p.ox * 16 * dt;
        p.vy += -p.oy * 16 * dt;
        const damp = Math.exp(-dt * 3);
        p.vx *= damp;
        p.vy *= damp;
        p.ox += p.vx * dt;
        p.oy += p.vy * dt;
        x = bx + p.ox;
        y = by + p.oy;

        const land = clamp((time - p.delay - p.dur) / 0.35);
        const pop = pr < 1 ? 0.35 + 0.65 * e : 1 + 0.45 * Math.sin(Math.PI * land) * (land < 1 ? 1 : 0);
        const s = p.size * scale * pop;
        ctx.globalAlpha = pr < 0.34 ? pr * 3 : 1;
        const ang = p.rot + time * p.spin;
        const cr = Math.cos(ang);
        const sr = Math.sin(ang);
        let A11 = 1;
        let A12 = 0;
        let A21 = 0;
        let A22 = 1;
        const v = Math.hypot(p.vx, p.vy);
        if (v > 20) {
          const c = p.vx / v;
          const sn = p.vy / v;
          const st = 1 + Math.min(v / 500, 1.1);
          const sq = 1 / Math.sqrt(st);
          A11 = c * c * st + sn * sn * sq;
          A22 = sn * sn * st + c * c * sq;
          A12 = A21 = c * sn * (st - sq);
        }
        ctx.setTransform(
          DPR * (A11 * cr + A12 * sr),
          DPR * (A21 * cr + A22 * sr),
          DPR * (A12 * cr - A11 * sr),
          DPR * (A22 * cr - A21 * sr),
          DPR * x,
          DPR * y,
        );
        ctx.drawImage(p.sprite, -s / 2, -s / 2, s, s);
      }
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalAlpha = 1;

      ctx.globalCompositeOperation = "lighter";
      for (const rp of ripples) {
        const age = nowS - rp.t;
        const a = Math.exp(-age * 1.8) * rp.s;
        for (let i = 0; i < 3; i++) {
          const rr = age * 380 - i * 22;
          if (rr <= 0) continue;
          ctx.globalAlpha = a * (0.22 - i * 0.06);
          ctx.strokeStyle = i === 1 ? "#ffc9a0" : "#cfe4ff";
          ctx.lineWidth = 2 - i * 0.5;
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (active) {
        ctx.globalAlpha = 0.18;
        const cg = ctx.createRadialGradient(px, py, 0, px, py, RAD * 0.8);
        cg.addColorStop(0, "rgba(190,220,255,.6)");
        cg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = cg;
        ctx.fillRect(px - RAD, py - RAD, RAD * 2, RAD * 2);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(frame);
    }

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        build();
      }, 150);
    };
    addEventListener("resize", onResize);

    resize();
    build();
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      removeEventListener("pointermove", onPointerMove);
      removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerleave", onPointerLeave);
      removeEventListener("blur", onBlur);
      removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="login-galaxy-bg" aria-hidden="true" />;
}
