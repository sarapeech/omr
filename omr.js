/* OMR engine: finds the 4 corner markers, maps the template, reads bubbles.
   Works on {width, height, data: RGBA Uint8ClampedArray}. No dependencies. */
(function (root) {
  'use strict';

  function grayOf(img, mode) {
    const { width: w, height: h, data } = img;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      const r = data[j], gg = data[j + 1], b = data[j + 2];
      g[i] = mode === 'min' ? Math.min(r, gg, b) : 0.299 * r + 0.587 * gg + 0.114 * b;
    }
    return { w, h, g };
  }

  function downscale(G, maxDim) {
    const s = Math.min(1, maxDim / Math.max(G.w, G.h));
    if (s === 1) return { w: G.w, h: G.h, g: G.g, s: 1 };
    const w = Math.max(1, Math.round(G.w * s)), h = Math.max(1, Math.round(G.h * s));
    const g = new Float32Array(w * h), cnt = new Float32Array(w * h);
    for (let y = 0; y < G.h; y++) {
      const ty = Math.min(h - 1, (y * s) | 0);
      for (let x = 0; x < G.w; x++) {
        const tx = Math.min(w - 1, (x * s) | 0), k = ty * w + tx;
        g[k] += G.g[y * G.w + x]; cnt[k]++;
      }
    }
    for (let i = 0; i < g.length; i++) g[i] = cnt[i] ? g[i] / cnt[i] : 255;
    return { w, h, g, s: w / G.w };
  }

  function integral(G) {
    const { w, h, g } = G, I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += g[y * w + x];
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
      }
    }
    return I;
  }

  function binarize(G, win, k) {
    const { w, h, g } = G, I = integral(G), B = new Uint8Array(w * h), r = win >> 1;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        B[y * w + x] = g[y * w + x] < mean * k ? 1 : 0;
      }
    }
    return B;
  }

  function components(B, w, h) {
    const lab = new Int32Array(w * h), parent = [0];
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    let next = 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!B[i]) continue;
      const n = [];
      if (x > 0 && lab[i - 1]) n.push(lab[i - 1]);
      if (y > 0) {
        if (lab[i - w]) n.push(lab[i - w]);
        if (x > 0 && lab[i - w - 1]) n.push(lab[i - w - 1]);
        if (x < w - 1 && lab[i - w + 1]) n.push(lab[i - w + 1]);
      }
      if (!n.length) { parent.push(next); lab[i] = next++; continue; }
      let m = find(n[0]);
      for (let t = 1; t < n.length; t++) { const r = find(n[t]); if (r !== m) { if (r < m) { parent[m] = r; m = r; } else parent[r] = m; } }
      lab[i] = m;
    }
    const st = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!lab[i]) continue;
      const r = find(lab[i]);
      let s = st.get(r);
      if (!s) { s = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, x0: x, x1: x, y0: y, y1: y }; st.set(r, s); }
      s.n++; s.sx += x; s.sy += y; s.sxx += x * x; s.syy += y * y; s.sxy += x * y;
      if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
    }
    return [...st.values()];
  }

  function squareCandidates(comps, maxDim) {
    const out = [];
    const amin = Math.pow(maxDim * 0.007, 2), amax = Math.pow(maxDim * 0.09, 2);
    for (const c of comps) {
      if (c.n < amin || c.n > amax || c.n < 12) continue;
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (bw / bh > 2.2 || bh / bw > 2.2) continue;
      const fill = c.n / (bw * bh);
      if (fill < 0.45) continue;
      const cx = c.sx / c.n, cy = c.sy / c.n;
      const m20 = c.sxx / c.n - cx * cx, m02 = c.syy / c.n - cy * cy, m11 = c.sxy / c.n - cx * cy;
      const J = (m20 + m02) / c.n;              // 1/6 for a filled square, 1/(2pi) for a disk
      if (J < 0.14 || J > 0.205) continue;
      const tr = m20 + m02, det = m20 * m02 - m11 * m11, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
      if (l2 <= 0 || Math.sqrt(l1 / l2) > 1.6) continue;
      out.push({ x: cx, y: cy, a: c.n });
    }
    return out;
  }

  // Homography mapping src[i] -> dst[i] (4 points)
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const n = 8;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < n; r++) if (r !== c) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function apply(H, x, y) {
    const d = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
  }

  function sample(G, x, y) {
    const { w, h, g } = G;
    if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return 255;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy;
  }

  function percentile(arr, p) {
    const a = Float32Array.from(arr).sort();
    return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
  }

  // darkness of a disk (mm) relative to the paper just around it
  function bubbleScore(G, H, cx, cy, r, mmPx) {
    const step = Math.max(0.12, Math.min(0.3, 0.6 / mmPx));
    const ri = r * 0.7, ring = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      for (const rr of [r * 1.3, r * 1.45]) {
        const [x, y] = apply(H, cx + rr * Math.cos(a), cy + rr * Math.sin(a));
        ring.push(sample(G, x, y));
      }
    }
    const bg = Math.max(60, percentile(ring, 0.85));
    let sum = 0, n = 0;
    for (let dy = -ri; dy <= ri; dy += step) for (let dx = -ri; dx <= ri; dx += step) {
      if (dx * dx + dy * dy > ri * ri) continue;
      const [x, y] = apply(H, cx + dx, cy + dy);
      const v = sample(G, x, y);
      sum += Math.min(1, Math.max(0, (bg - v) / bg)); n++;
    }
    return n ? sum / n : 0;
  }

  function regionDark(G, H, cx, cy, hw, hh) {
    let sum = 0, n = 0;
    for (let dy = -hh; dy <= hh; dy += hh / 4) for (let dx = -hw; dx <= hw; dx += hw / 8) {
      const [x, y] = apply(H, cx + dx, cy + dy); sum += sample(G, x, y); n++;
    }
    return sum / n;
  }

  function locate(img, L) {
    const lum = grayOf(img, 'lum');
    const D = downscale(lum, 1000);
    const maxDim = Math.max(D.w, D.h);
    let cands = [];
    for (const k of [0.72, 0.6, 0.82]) {
      const B = binarize(D, (Math.round(maxDim / 10) | 1), k);
      cands = squareCandidates(components(B, D.w, D.h), maxDim);
      const res = pickQuad(cands, D, L);
      if (res) {
        const s = D.s;
        const S = [s, 0, 0, 0, s, 0, 0, 0, 1];
        // H maps mm -> downscaled px; convert to full-res px
        const Hf = res.H.map((v, i) => (i < 6 ? v / s : v));
        return { H: Hf, rot: res.rot, corners: res.corners.map(([x, y]) => [x / s, y / s]), nCand: cands.length };
      }
    }
    return { error: 'markers', nCand: cands.length, cands: cands.slice(0, 12) };
  }

  // the sheet's fixed print must be where the template says: dark bar and markers, blank paper at known spots
  function verify(D, H, L) {
    const [W, Hh] = L.page;
    const dark = [regionDark(D, H, L.bar[0], L.bar[1], 13, 1.4)].concat(L.fid.map(([x, y]) => regionDark(D, H, x, y, 2, 2)));
    const paperSpots = [[L.bar[0] - 42, L.bar[1], 6, 1.2], [L.bar[0] + 42, L.bar[1], 6, 1.2], [W / 2 + 10, 18, 6, 1.2],
      [W / 2, Hh - 8.5, 12, 1.2], [L.fid[0][0] - 1, Hh / 2, 0.8, 30], [L.fid[1][0] + 1, Hh / 2, 0.8, 30]];
    const paperVals = paperSpots.map(([x, y, hw, hh]) => regionDark(D, H, x, y, hw, hh));
    const paper = Math.min(...paperVals), dk = Math.max(...dark);
    return { sc: paper - dk, paper, dark: dk };
  }

  function pickQuad(cands, D, L) {
    if (cands.length < 4) return null;
    cands.sort((a, b) => b.a - a.a);
    const C = cands.slice(0, 24);
    const tmplRatio = (L.fidSize * L.fidSize) / ((L.fid[1][0] - L.fid[0][0]) * (L.fid[3][1] - L.fid[0][1]));
    const combos = [];
    for (let a = 0; a < C.length; a++) for (let b = a + 1; b < C.length; b++)
      for (let c = b + 1; c < C.length; c++) for (let d = c + 1; d < C.length; d++) {
        const q = [C[a], C[b], C[c], C[d]];
        const areas = q.map((p) => p.a), mx = Math.max(...areas), mn = Math.min(...areas);
        if (mx / mn > 4) continue;
        const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
        q.sort((p1, p2) => Math.atan2(p1.y - cy, p1.x - cx) - Math.atan2(p2.y - cy, p2.x - cx));
        let area = 0, convex = true, sign = 0;
        for (let i = 0; i < 4; i++) {
          const p = q[i], n1 = q[(i + 1) % 4], n2 = q[(i + 2) % 4];
          area += p.x * n1.y - n1.x * p.y;
          const cr = (n1.x - p.x) * (n2.y - n1.y) - (n1.y - p.y) * (n2.x - n1.x);
          if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) convex = false;
        }
        area = Math.abs(area) / 2;
        if (!convex || area <= 0) continue;
        const ratio = (areas.reduce((s, v) => s + v, 0) / 4) / area / tmplRatio;
        if (ratio < 0.45 || ratio > 2.2) continue;
        combos.push({ q, area });
      }
    combos.sort((a, b) => b.area - a.area);
    for (const { q } of combos.slice(0, 60)) {
      const pts = q.map((p) => [p.x, p.y]);
      let best = null;
      for (let rot = 0; rot < 4; rot++) {
        const dst = [0, 1, 2, 3].map((i) => pts[(i + rot) % 4]);
        const H = homography(L.fid, dst);
        if (!H) continue;
        const v = verify(D, H, L);
        if (!best || v.sc > best.sc) best = Object.assign(v, { H, rot, corners: dst });
      }
      if (best && best.sc > 0.3 * best.paper) return best;
    }
    return null;
  }

  function decide(scores, base, T) {
    const rel = scores.map((s) => s - base);
    let i1 = -1, i2 = -1;
    rel.forEach((v, i) => { if (i1 < 0 || v > rel[i1]) { i2 = i1; i1 = i; } else if (i2 < 0 || v > rel[i2]) i2 = i; });
    const m = rel[i1], m2 = i2 >= 0 ? rel[i2] : -1;
    if (m < T) {
      // faint but clearly the darkest in its row: keep it as the answer and ask the teacher to confirm
      if (m > T * 0.45 && m - Math.max(m2, 0) > T * 0.35) return { pick: i1, state: 'unsure', faint: true, rel };
      return { pick: -1, state: m > T * 0.6 ? 'unsure' : 'blank', rel };
    }
    if (m2 >= T && m2 >= 0.55 * m) return { pick: -2, state: 'multi', rel, picks: rel.map((v, i) => (v >= T && v >= 0.55 * m ? i : -1)).filter((i) => i >= 0) };
    const unsure = m < T * 1.5 || m2 > T * 0.7;
    return { pick: i1, state: unsure ? 'unsure' : 'ok', rel };
  }

  function read(img, L, opt) {
    opt = opt || {};
    const loc = locate(img, L);
    if (loc.error) return { ok: false, error: loc.error, dbg: loc };
    const G = grayOf(img, 'min');
    const H = loc.H;
    const [ax] = apply(H, 0, 0), [bx] = apply(H, 10, 0);
    const mmPx = Math.hypot(...(() => { const p = apply(H, 0, 0), q = apply(H, 10, 0); return [q[0] - p[0], q[1] - p[1]]; })()) / 10;
    const nq = Math.min(opt.numQ || L.questions.length, L.questions.length);
    const nc = Math.max(2, Math.min(5, opt.choices || 5));
    const nd = opt.idDigits === undefined ? L.idCols.length : Math.max(0, Math.min(L.idCols.length, opt.idDigits));
    const nv = opt.versions > 1 && L.verBubbles ? Math.min(opt.versions, L.verBubbles.length) : 0;
    const qs = [], all = [];
    for (let q = 0; q < nq; q++) {
      const s = L.questions[q].slice(0, nc).map(([x, y]) => bubbleScore(G, H, x, y, L.qR, mmPx));
      qs.push(s); all.push(...s);
    }
    const ids = L.idCols.slice(0, nd).map((col) => col.map(([x, y]) => bubbleScore(G, H, x, y, L.idR, mmPx)));
    ids.forEach((c) => all.push(...c));
    const ver = nv ? L.verBubbles.slice(0, nv).map(([x, y]) => bubbleScore(G, H, x, y, L.verR || L.qR, mmPx)) : null;
    if (ver) all.push(...ver);
    const base = percentile(all, 0.3);
    // adaptive threshold: half of the typical mark strength, never below the noise floor
    const rowMax = qs.concat(ids).map((s) => Math.max(...s) - base);
    const dev = all.map((v) => Math.abs(v - base));
    const noiseFloor = percentile(dev, 0.6) * 6;
    const sens = opt.sens || 1;
    const T = opt.threshold || sens * Math.min(0.09, Math.max(0.025, noiseFloor, 0.45 * percentile(rowMax, 0.5)));
    const answers = qs.map((s) => decide(s, base, T));
    const idDec = ids.map((s) => decide(s, base, T));
    const digits = idDec.map((d) => (d.pick >= 0 && d.state === 'ok' ? String(d.pick) : d.pick >= 0 ? String(d.pick) : d.state === 'blank' ? ' ' : '?'));
    const idUnsure = idDec.some((d) => d.state !== 'ok' && d.state !== 'blank');
    const sid = digits.join('').trim();
    const version = ver ? decide(ver, base, T) : null;
    return { ok: true, T, H, mmPx, corners: loc.corners, rot: loc.rot, base, answers, id: { str: sid, cols: idDec, unsure: idUnsure }, version };
  }

  const api = { read, locate, apply, homography };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OMR = api;
})(typeof self !== 'undefined' ? self : this);
