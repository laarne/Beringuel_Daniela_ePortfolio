/**
 * Daniela D. Beringuel, EnP - e-Professional Portfolio
 * Sheet terrain, coordinate readout, legend isolation, tabs, document dialog.
 */

document.addEventListener('DOMContentLoaded', () => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     Terrain: an illustrative heightfield with a river valley, drawn as
     contour linework (marching squares), vegetation tint, river, and the
     dashed retention buffer from Case Study 01.
     ------------------------------------------------------------------ */
  const map = document.getElementById('map');
  const canvas = document.getElementById('terrain');
  const riverLabel = document.querySelector('.map-river');
  let field = null; // { cols, rows, cell, h: Float32Array }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Seeded value noise
  function makeNoise(seed) {
    const perm = new Uint8Array(512);
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const val = Array.from({ length: 256 }, () => rnd());
    const fade = (t) => t * t * (3 - 2 * t);
    const v = (x, y) => val[perm[(x & 255) + perm[y & 255]]];
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = fade(xf), w = fade(yf);
      const a = v(xi, yi) + (v(xi + 1, yi) - v(xi, yi)) * u;
      const b = v(xi, yi + 1) + (v(xi + 1, yi + 1) - v(xi, yi + 1)) * u;
      return a + (b - a) * w;
    };
    return (x, y) => {
      let sum = 0, amp = 0.5, freq = 1;
      for (let o = 0; o < 5; o++) { sum += amp * noise(x * freq, y * freq); amp *= 0.5; freq *= 2.03; }
      return sum / 0.97;
    };
  }
  const relief = makeNoise(20260915);
  const cover = makeNoise(6842);

  // River centreline in normalised sheet coordinates (Catmull-Rom sampled)
  const RIVER_CTRL = [[-0.06, 0.8], [0.14, 0.7], [0.3, 0.76], [0.46, 0.62], [0.58, 0.5], [0.74, 0.47], [0.88, 0.33], [1.06, 0.26]];
  function sampleRiver(n) {
    const pts = [];
    const P = RIVER_CTRL;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        pts.push([0, 1].map((d) => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    pts.push(P[P.length - 1]);
    return pts;
  }
  const river = sampleRiver(24);

  function distToRiver(x, y, aspect) {
    let best = Infinity;
    for (let i = 0; i < river.length - 1; i++) {
      const ax = river[i][0] * aspect, ay = river[i][1], bx = river[i + 1][0] * aspect, by = river[i + 1][1];
      const px = x * aspect, py = y;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      const d = qx * qx + qy * qy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function buildField(w, h) {
    const cell = w < 640 ? 6 : 8;
    const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
    const aspect = w / h;
    const H = new Float32Array(cols * rows);
    const V = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = (i * cell) / w, y = (j * cell) / h;
        const d = distToRiver(x, y, aspect);
        const valley = Math.pow(Math.min(d / 0.42, 1), 0.85);
        const ridge = relief(x * 3.2 * aspect * 0.6 + 7, y * 3.2 + 3);
        H[j * cols + i] = 0.08 + valley * 0.62 + ridge * 0.42 * (0.35 + valley);
        V[j * cols + i] = cover(x * 4 * aspect * 0.6 + 11, y * 4 + 5);
      }
    }
    return { cols, rows, cell, h: H, v: V, w, hgt: h };
  }

  // Marching squares -> segments per level
  function contours(f, levels) {
    const { cols, rows, cell, h } = f;
    const out = levels.map(() => []);
    const lerp = (a, b, l) => (l - a) / (b - a);
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const tl = h[j * cols + i], tr = h[j * cols + i + 1], br = h[(j + 1) * cols + i + 1], bl = h[(j + 1) * cols + i];
        const lo = Math.min(tl, tr, br, bl), hi = Math.max(tl, tr, br, bl);
        const x = i * cell, y = j * cell;
        for (let k = 0; k < levels.length; k++) {
          const L = levels[k];
          if (L < lo || L > hi) continue;
          const c = (tl > L ? 8 : 0) | (tr > L ? 4 : 0) | (br > L ? 2 : 0) | (bl > L ? 1 : 0);
          if (c === 0 || c === 15) continue;
          const T = [x + cell * lerp(tl, tr, L), y], R = [x + cell, y + cell * lerp(tr, br, L)];
          const B = [x + cell * lerp(bl, br, L), y + cell], Lf = [x, y + cell * lerp(tl, bl, L)];
          const s = out[k];
          switch (c) {
            case 1: case 14: s.push(Lf, B); break;
            case 2: case 13: s.push(B, R); break;
            case 3: case 12: s.push(Lf, R); break;
            case 4: case 11: s.push(T, R); break;
            case 5: s.push(Lf, T, B, R); break;
            case 6: case 9: s.push(T, B); break;
            case 7: case 8: s.push(Lf, T); break;
            case 10: s.push(T, R, Lf, B); break;
          }
        }
      }
    }
    return out;
  }

  function offsetLine(pts, off, w, h) {
    return pts.map((p, i) => {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      const dx = (b[0] - a[0]) * w, dy = (b[1] - a[1]) * h, len = Math.hypot(dx, dy) || 1;
      return [p[0] * w - (dy / len) * off, p[1] * h + (dx / len) * off];
    });
  }

  function strokePath(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
  }

  let animToken = 0;
  function renderTerrain(animate) {
    if (!map || !canvas) return;
    const rect = map.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const C = {
      paper: css('--paper-hi'), veg: css('--veg'), vegDeep: css('--veg-deep'), contour: css('--contour'),
      index: css('--contour-index'), water: css('--water'), waterTint: css('--water-tint'), road: css('--road'), ink: css('--ink'),
    };

    field = buildField(w, h);
    const step = 0.035;
    const levels = [];
    for (let L = 0.12; L < 1.3; L += step) levels.push(+L.toFixed(3));
    const segs = contours(field, levels);

    // Vegetation tint: one pixel per cell, scaled up with smoothing for soft edges
    const off = document.createElement('canvas');
    off.width = field.cols; off.height = field.rows;
    const octx = off.getContext('2d');
    const img = octx.createImageData(field.cols, field.rows);
    const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const vegRGB = hex(C.veg), deepRGB = hex(C.vegDeep), wtRGB = hex(C.waterTint);
    for (let n = 0; n < field.cols * field.rows; n++) {
      const v = field.v[n], hh = field.h[n];
      let rgb = null, a = 0;
      if (hh < 0.16) { rgb = wtRGB; a = 150; }
      else if (v > 0.56) { rgb = v > 0.66 ? deepRGB : vegRGB; a = 235; }
      if (rgb) { img.data.set([rgb[0], rgb[1], rgb[2], a], n * 4); }
    }
    octx.putImageData(img, 0, 0);

    const riverPx = river.map((p) => [p[0] * w, p[1] * h]);
    const bufferOff = Math.max(18, Math.min(w, h) * 0.045);

    // Settlement (culture) blocks near the river bend
    const blocks = [];
    const bend = river[Math.floor(river.length * 0.36)];
    const rnd = makeNoise(29);
    for (let k = 0; k < 26; k++) {
      const bx = bend[0] * w + (rnd(k * 1.7, 2) - 0.5) * w * 0.22;
      const by = bend[1] * h - bufferOff * 1.6 - rnd(3, k * 1.3) * h * 0.14;
      blocks.push([bx, by, 3 + Math.round(rnd(k, k) * 4)]);
    }

    const drawBase = () => {
      ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, field.cols * field.cell, field.rows * field.cell);
    };
    const drawLevel = (k) => {
      const isIndex = k % 5 === 0;
      ctx.strokeStyle = isIndex ? C.index : C.contour;
      ctx.lineWidth = isIndex ? 1.25 : 0.6;
      ctx.globalAlpha = isIndex ? 0.95 : 0.8;
      ctx.beginPath();
      const s = segs[k];
      for (let n = 0; n < s.length; n += 2) { ctx.moveTo(s[n][0], s[n][1]); ctx.lineTo(s[n + 1][0], s[n + 1][1]); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const drawSpotLabels = () => {
      // Elevation figures set into index contours, knocked out of the linework the way a sheet prints them
      ctx.font = `600 10px ${css("--f-sans")}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      segs.forEach((s, k) => {
        if (k % 5 !== 0 || s.length < 40) return;
        const elev = Math.round(((levels[k] - 0.1) * 360) / 10) * 10;
        [0.3, 0.72].forEach((f) => {
          const n = Math.floor((s.length / 2) * f) * 2;
          const p = s[n], q = s[n + 1];
          const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          if (mx < 40 || mx > w - 40 || my < 30 || my > h - 50) return;
          let ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
          if (ang > Math.PI / 2) ang -= Math.PI;
          if (ang < -Math.PI / 2) ang += Math.PI;
          ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
          const label = String(elev), tw = ctx.measureText(label).width + 6;
          ctx.fillStyle = C.paper; ctx.fillRect(-tw / 2, -6, tw, 12);
          ctx.fillStyle = C.index; ctx.fillText(label, 0, 0.5);
          ctx.restore();
        });
      });
    };
    const drawCulture = () => {
      // retention buffer (dash-dot boundary), river, settlement
      ctx.setLineDash([9, 4, 2, 4]);
      ctx.strokeStyle = C.road; ctx.lineWidth = 1.4;
      strokePath(ctx, offsetLine(river, bufferOff, w, h));
      strokePath(ctx, offsetLine(river, -bufferOff, w, h));
      ctx.setLineDash([]);
      ctx.strokeStyle = C.water; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, w * 0.005); strokePath(ctx, riverPx);
      ctx.fillStyle = C.ink;
      blocks.forEach(([x, y, s]) => ctx.fillRect(Math.round(x), Math.round(y), s, s));
    };

    // River label: first stretch of channel whose label box clears the name and the frame
    if (riverLabel) {
      const nameEl = document.querySelector(".map-name");
      const mr = map.getBoundingClientRect();
      const nr = nameEl.getBoundingClientRect();
      const name = { l: nr.left - mr.left - 12, t: nr.top - mr.top - 12, r: nr.right - mr.left + 12, b: nr.bottom - mr.top + 12 };
      const lw = riverLabel.offsetWidth, lh = riverLabel.offsetHeight;
      const n = riverPx.length;
      let pick = null;
      for (let f = 0.86; f >= 0.3 && !pick; f -= 0.02) {
        const i = Math.floor(n * f), a = riverPx[i], b = riverPx[Math.min(i + 6, n - 1)];
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const x = a[0] + Math.sin(ang) * 16, y = a[1] - Math.cos(ang) * 16 - 10;
        const x2 = x + Math.cos(ang) * lw, y2 = y + Math.sin(ang) * lw;
        const box = { l: Math.min(x, x2), r: Math.max(x, x2), t: Math.min(y, y2), b: Math.max(y, y2) + lh };
        const inFrame = box.l > 8 && box.r < w - 8 && box.t > 20 && box.b < h - 40;
        const hitsName = !(box.r < name.l || box.l > name.r || box.b < name.t || box.t > name.b);
        if (inFrame && !hitsName) pick = { x, y, ang };
      }
      riverLabel.hidden = !pick;
      if (pick) {
        riverLabel.style.setProperty("--rx", `${pick.x}px`);
        riverLabel.style.setProperty("--ry", `${pick.y}px`);
        riverLabel.style.setProperty("--rr", `${pick.ang}rad`);
      }
    }

    const token = ++animToken;
    if (!animate || reduceMotion) {
      drawBase(); segs.forEach((_, k) => drawLevel(k)); drawSpotLabels(); drawCulture();
      return;
    }
    // One authored moment: contours climb out of the valley, then the river inks in.
    const dur = 1500, t0 = performance.now();
    let drawn = 0;
    drawBase();
    drawCulture(); // river and buffer are present from the first frame; redrawn on top once contours land
    const frame = (now) => {
      if (token !== animToken) return;
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const target = Math.floor(eased * segs.length);
      while (drawn < target) drawLevel(drawn++);
      if (p < 1) requestAnimationFrame(frame);
      else { while (drawn < segs.length) drawLevel(drawn++); drawSpotLabels(); drawCulture(); }
    };
    requestAnimationFrame(frame);
  }

  if (map && canvas) {
    renderTerrain(true);
    let rt;
    let lastW = map.clientWidth, lastH = map.clientHeight;
    new ResizeObserver(() => {
      if (map.clientWidth === lastW && Math.abs(map.clientHeight - lastH) < 2) return;
      lastW = map.clientWidth; lastH = map.clientHeight;
      clearTimeout(rt); rt = setTimeout(() => renderTerrain(false), 140);
    }).observe(map);

    // Live coordinate + elevation readout (illustrative extent 125°30′–125°38′E, 9°00′–8°54′N)
    const roLat = document.getElementById('ro-lat');
    const roLon = document.getElementById('ro-lon');
    const roElev = document.getElementById('ro-elev');
    const dms = (deg, pos, neg) => {
      const hemi = deg >= 0 ? pos : neg; deg = Math.abs(deg);
      const d = Math.floor(deg), mf = (deg - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60);
      return `${d}°${String(m).padStart(2, '0')}′${String(s === 60 ? 59 : s).padStart(2, '0')}″${hemi}`;
    };
    map.addEventListener('pointermove', (e) => {
      if (!field) return;
      const r = map.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      roLon.textContent = dms(125.5 + (x / r.width) * (8 / 60), 'E', 'W');
      roLat.textContent = dms(9.0 - (y / r.height) * (6 / 60), 'N', 'S');
      const i = Math.min(field.cols - 1, Math.max(0, Math.round(x / field.cell)));
      const j = Math.min(field.rows - 1, Math.max(0, Math.round(y / field.cell)));
      const hv = field.h[j * field.cols + i];
      roElev.textContent = `Elev. ${Math.max(2, Math.round((hv - 0.1) * 360))} m`;
    });
  }

  /* ------------------------------------------------------------------
     Legend isolation: pointing at a legend entry lifts its map point and
     dims the rest of the sheet.
     ------------------------------------------------------------------ */
  const points = new Map([...document.querySelectorAll('[data-point]')].map((a) => [a.dataset.point, a]));
  const legendLinks = document.querySelectorAll('[data-legend]');
  const isolate = (key) => {
    points.forEach((a, k) => a.classList.toggle('lit', k === key));
    legendLinks.forEach((a) => a.classList.toggle('lit', a.dataset.legend === key));
    map && map.classList.toggle('isolating', !!key);
  };
  [...legendLinks, ...points.values()].forEach((a) => {
    const key = a.dataset.legend || a.dataset.point;
    a.addEventListener('pointerenter', () => isolate(key));
    a.addEventListener('pointerleave', () => isolate(null));
    a.addEventListener('focus', () => isolate(key));
    a.addEventListener('blur', () => isolate(null));
  });

  /* ------------------------------------------------------------------
     Active section in the header
     ------------------------------------------------------------------ */
  const navLinks = [...document.querySelectorAll('.nav-link')];
  const byId = new Map(navLinks.map((l) => [l.getAttribute('href').slice(1), l]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      navLinks.forEach((l) => { l.classList.remove('active'); l.removeAttribute('aria-current'); });
      const link = byId.get(en.target.id);
      if (link) { link.classList.add('active'); link.setAttribute('aria-current', 'true'); }
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main section[id]').forEach((s) => io.observe(s));

  const printBtn = document.querySelector('[data-print-resume]');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      const frame = document.querySelector('#tab-resume iframe');
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (_) {
        const w = window.open('resume.html', '_blank');
        if (w) w.addEventListener('load', () => w.print());
      }
    });
  }

  /* ------------------------------------------------------------------
     Certificate preview dialog
     ------------------------------------------------------------------ */
  const dialog = document.getElementById('doc-dialog');
  const docFrame = document.getElementById('doc-frame');
  let opener = null;
  document.querySelectorAll('[data-doc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      opener = btn;
      const url = btn.dataset.doc, title = btn.dataset.docTitle;
      document.getElementById('doc-title').textContent = title;
      document.getElementById('doc-path').textContent = url;
      document.getElementById('doc-download').href = url;
      docFrame.title = title;
      docFrame.src = url;
      dialog.showModal();
    });
  });
  document.getElementById('doc-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { docFrame.src = 'about:blank'; opener && opener.focus(); });
});
