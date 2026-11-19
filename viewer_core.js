/* viewer_core.js — fungsi murni (tanpa DOM) untuk Threads SNA.
 * Dipakai oleh viewer.html lewat global SNA, dan bisa di-require() dari Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SNA = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MS_DAY = 86400000;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const str = v => (v == null ? '' : String(v));
  const num = (v, d) => (Number.isFinite(v) ? v : d);

  /* Terima "YYYY-MM-DD", "DD/MM/YYYY" (data lama), angka, atau ISO datetime.
   * Menghasilkan epoch ms (UTC) atau null. */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    if (!s) return null;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return Date.UTC(y, mo - 1, d);
      return null;
    }
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
      const d = +m[1], mo = +m[2], y = +m[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return Date.UTC(y, mo - 1, d);
      return null;
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }

  /* d3.forceLink mengganti source/target dari string jadi objek node.
   * eid() membuat semua fungsi di sini tetap bekerja pada graf hasil draw(). */
  function eid(v) {
    return v && typeof v === 'object' ? str(v.id) : str(v);
  }

  function normalizeGraph(graph) {
    const g = graph || {};
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const links = Array.isArray(g.links) ? g.links : [];
    const ids = [];
    const set = new Set();
    nodes.forEach(n => {
      const id = eid(n);
      if (id && !set.has(id)) { set.add(id); ids.push(id); }
    });
    links.forEach(l => {
      if (!l) return;
      [eid(l.source), eid(l.target)].forEach(id => {
        if (id && !set.has(id)) { set.add(id); ids.push(id); }
      });
    });
    ids.sort(cmp);
    const ls = [];
    links.forEach(l => {
      if (!l) return;
      const source = eid(l.source), target = eid(l.target);
      if (!source || !target || source === target) return;
      let w = num(l.w, 1);
      if (!(w > 0)) w = 1;
      ls.push({ source, target, type: str(l.type), w });
    });
    return { ids, set, links: ls };
  }

  /* adjacency tidak berarah. weighted=true memakai l.w, false memakai 1 per link. */
  function buildAdj(g, weighted) {
    const adj = new Map(g.ids.map(id => [id, new Map()]));
    g.links.forEach(l => {
      if (!adj.has(l.source) || !adj.has(l.target)) return;
      const w = weighted ? l.w : 1;
      const a = adj.get(l.source), b = adj.get(l.target);
      a.set(l.target, (a.get(l.target) || 0) + w);
      b.set(l.source, (b.get(l.source) || 0) + w);
    });
    return adj;
  }

  function neighborsOf(g) {
    const adj = buildAdj(g, false);
    const out = new Map();
    g.ids.forEach(id => out.set(id, [...adj.get(id).keys()].sort(cmp)));
    return out;
  }

  /* ---------- build ---------- */
  function build(posts, opts) {
    const o = opts || {};
    const types = o.types == null
      ? new Set(['komentar', 'mention'])
      : (o.types instanceof Set ? new Set(o.types) : new Set(Array.isArray(o.types) ? o.types : []));
    const minDeg = Number.isFinite(o.minDeg) ? o.minDeg : 1;
    const from = o.dateFrom ? parseDate(o.dateFrom) : null;
    let to = o.dateTo ? parseDate(o.dateTo) : null;
    if (to != null) to += MS_DAY - 1; // termasuk seluruh hari dateTo
    const dateActive = from != null || to != null;

    const ps = Array.isArray(posts) ? posts : [];
    const nodes = new Map();
    const links = new Map();

    const N = raw => {
      const id = str(raw).trim();
      if (!id) return null;
      if (!nodes.has(id)) nodes.set(id, { id, posts: 0, replies: 0, deg: 0, threadCount: 0 });
      return nodes.get(id);
    };
    const inRange = ts => {
      const t = parseDate(ts);
      if (t == null) return false;
      return (from == null || t >= from) && (to == null || t <= to);
    };
    const L = (sRaw, tRaw, type, item, weight) => {
      const s = str(sRaw).trim(), t = str(tRaw).trim();
      if (!s || !t || s === t || !types.has(type)) return;
      // Pastikan kedua ujung edge punya node. Akun yang hanya disebut (@mention)
      // tidak muncul sebagai penulis/replier, tapi tetap harus ada di graf.
      if (!N(s) || !N(t)) return;
      const key = s + '>' + t + '>' + type;
      let l = links.get(key);
      if (!l) {
        l = { source: s, target: t, type, w: 0, items: [] };
        links.set(key, l);
      }
      l.items.push(item || {});
      l.w += Number.isFinite(weight) ? weight : 1;
    };

    ps.forEach(raw => {
      const p = raw || {};
      const author = str(p.author).trim();
      const a = N(author);
      if (a) a.posts++;

      const thread = Array.isArray(p.thread) ? p.thread : [];
      thread.forEach(rawT => {
        const t = rawT || {};
        // thread = lanjutan oleh penulis. TIDAK ada edge dari sini.
        const who = N(str(t.author || author));
        if (who) who.threadCount++;
      });

      const replies = Array.isArray(p.replies) ? p.replies : [];
      replies.forEach(rawR => {
        const r = rawR || {};
        const who = str(r.author).trim();
        const n = N(who);
        if (n) n.replies++;
        const text = str(r.text);
        const ts = r.timestamp == null ? null : r.timestamp;
        const item = { text, timestamp: ts, postCode: str(p.code), author: who };

        L(who, author, 'komentar', item, 1);
        const re = /@([\w.]+)/g;
        let m;
        while ((m = re.exec(text))) {
          L(who, m[1], 'mention', item, 1);
        }
      });

      if (types.has('co-comment')) {
        const counts = new Map(), firstTs = new Map();
        replies.forEach(rawR => {
          const r = rawR || {};
          const who = str(r.author).trim();
          if (!who) return;
          counts.set(who, (counts.get(who) || 0) + 1);
          if (!firstTs.has(who) && r.timestamp != null) firstTs.set(who, r.timestamp);
        });
        const talkers = [...counts.entries()]
          .sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))
          .slice(0, 12);
        for (let i = 0; i < talkers.length; i++) {
          for (let j = i + 1; j < talkers.length; j++) {
            const ta = firstTs.get(talkers[i][0]);
            const tb = firstTs.get(talkers[j][0]);
            const pa = parseDate(ta), pb = parseDate(tb);
            let ts = null;
            if (pa != null && pb != null) ts = pa <= pb ? ta : tb;
            else if (pa != null) ts = ta;
            else if (pb != null) ts = tb;
            L(talkers[i][0], talkers[j][0], 'co-comment', {
              text: 'Komentar di postingan @' + author,
              timestamp: ts,
              postCode: str(p.code),
              author
            }, Math.min(talkers[i][1], talkers[j][1]));
          }
        }
      }
    });

    let ls = [...links.values()];
    if (dateActive) {
      ls = ls
        .map(l => ({ ...l, items: l.items.filter(it => inRange(it.timestamp)) }))
        .filter(l => l.items.length > 0);
    }

    // Derajat = jumlah link unik yang menempel (bobot tidak dipakai),
    // dihitung setelah filter type & tanggal, sebelum pembuangan minDeg.
    const deg = new Map([...nodes.keys()].map(id => [id, 0]));
    ls.forEach(l => {
      deg.set(l.source, (deg.get(l.source) || 0) + 1);
      deg.set(l.target, (deg.get(l.target) || 0) + 1);
    });
    const keep = new Set([...deg.keys()].filter(id => deg.get(id) >= minDeg));

    const ns = [...nodes.values()]
      .filter(n => keep.has(n.id))
      .map(n => ({ ...n, deg: deg.get(n.id) }))
      .sort((a, b) => cmp(a.id, b.id));
    ls = ls
      .filter(l => keep.has(l.source) && keep.has(l.target))
      .sort((a, b) => cmp(a.source, b.source) || cmp(a.target, b.target) || cmp(a.type, b.type));

    return { nodes: ns, links: ls };
  }

  /* ---------- metrik ---------- */
  function degree(graph) {
    const g = normalizeGraph(graph);
    const byId = new Map();
    ((graph && graph.nodes) || []).forEach(n => byId.set(eid(n), n));
    const out = new Map();
    let anyDeg = false;
    g.ids.forEach(id => {
      const n = byId.get(id);
      const d = n && Number.isFinite(n.deg) ? n.deg : 0;
      if (d > 0) anyDeg = true;
      out.set(id, d);
    });
    if (!anyDeg && g.links.length) {
      const c = new Map(g.ids.map(id => [id, 0]));
      g.links.forEach(l => {
        c.set(l.source, c.get(l.source) + 1);
        c.set(l.target, c.get(l.target) + 1);
      });
      c.forEach((v, k) => out.set(k, v));
    }
    return out;
  }

  /* Brandes BFS, tidak berarah, tiap link = 1 edge (parallel edge dideduplikasi). */
  function betweenness(graph) {
    const g = normalizeGraph(graph);
    const C = new Map(g.ids.map(id => [id, 0]));
    if (g.ids.length < 3) return C;
    const nb = neighborsOf(g);
    g.ids.forEach(s => {
      const sigma = new Map(g.ids.map(id => [id, 0]));
      const dist = new Map(g.ids.map(id => [id, -1]));
      const P = new Map(g.ids.map(id => [id, []]));
      sigma.set(s, 1);
      dist.set(s, 0);
      const Q = [s], S = [];
      for (let qi = 0; qi < Q.length; qi++) {
        const v = Q[qi];
        S.push(v);
        for (const w of nb.get(v)) {
          if (dist.get(w) < 0) { dist.set(w, dist.get(v) + 1); Q.push(w); }
          if (dist.get(w) === dist.get(v) + 1) {
            sigma.set(w, sigma.get(w) + sigma.get(v));
            P.get(w).push(v);
          }
        }
      }
      const delta = new Map(g.ids.map(id => [id, 0]));
      for (let si = S.length - 1; si >= 0; si--) {
        const w = S[si];
        for (const v of P.get(w)) {
          delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
        }
        if (w !== s) C.set(w, C.get(w) + delta.get(w));
      }
    });
    C.forEach((v, k) => C.set(k, v / 2)); // pasangan tidak berarah dihitung dua kali
    return C;
  }

  /* Closeness = reachable / jumlah jarak (versi ter-normalisasi, aman untuk graf terputus). */
  function closeness(graph) {
    const g = normalizeGraph(graph);
    const out = new Map(g.ids.map(id => [id, 0]));
    if (g.ids.length <= 1) return out;
    const nb = neighborsOf(g);
    g.ids.forEach(s => {
      const dist = new Map(g.ids.map(id => [id, -1]));
      dist.set(s, 0);
      const Q = [s];
      for (let qi = 0; qi < Q.length; qi++) {
        const v = Q[qi];
        for (const w of nb.get(v)) {
          if (dist.get(w) < 0) { dist.set(w, dist.get(v) + 1); Q.push(w); }
        }
      }
      let sum = 0, reach = 0;
      dist.forEach((d, id) => {
        if (id !== s && d > 0) { sum += d; reach++; }
      });
      out.set(s, reach > 0 ? reach / sum : 0);
    });
    return out;
  }

  function eigenvector(graph) {
    const g = normalizeGraph(graph);
    const out = new Map();
    const n = g.ids.length;
    if (!n) return out;
    const adj = buildAdj(g, false);
    let x = new Map(g.ids.map(id => [id, 1 / Math.sqrt(n)]));
    for (let it = 0; it < 50; it++) {
      const y = new Map(g.ids.map(id => [id, 0]));
      g.ids.forEach(u => {
        adj.get(u).forEach((w, v) => {
          if (v !== u) y.set(u, y.get(u) + x.get(v) * w);
        });
      });
      let norm = 0;
      y.forEach(v => { norm += v * v; });
      norm = Math.sqrt(norm);
      if (!(norm > 0)) {
        g.ids.forEach(id => out.set(id, 0));
        return out;
      }
      x = new Map(g.ids.map(id => [id, y.get(id) / norm]));
    }
    g.ids.forEach(id => out.set(id, x.get(id)));
    return out;
  }

  /* Louvain satu level: perbaikan modularitas lokal, bobot dari l.w, deterministik. */
  function louvain(graph) {
    const g = normalizeGraph(graph);
    const out = new Map();
    const n = g.ids.length;
    if (!n) return out;
    const idx = new Map(g.ids.map((id, i) => [id, i]));
    const adj = buildAdj(g, true);
    const k = new Map(g.ids.map(id => [id, 0]));
    adj.forEach((m, id) => m.forEach(w => k.set(id, k.get(id) + w)));
    let m2 = 0;
    k.forEach(v => { m2 += v; });

    if (!(m2 > 0)) {
      g.ids.forEach((id, i) => out.set(id, i));
      return out;
    }

    const com = new Map(g.ids.map((id, i) => [id, i]));
    const tot = new Array(n).fill(0);
    g.ids.forEach((id, i) => { tot[i] = k.get(id); });

    for (let sweep = 0; sweep < 20; sweep++) {
      let moved = false;
      for (const id of g.ids) {
        const i = idx.get(id), ci = com.get(id), ki = k.get(id);
        const kin = new Map();
        adj.get(id).forEach((w, j) => {
          const c = com.get(j);
          kin.set(c, (kin.get(c) || 0) + w);
        });
        const score = c => (kin.get(c) || 0) / m2 - (2 * ki * (tot[c] || 0)) / (m2 * m2);
        let best = ci, bestS = score(ci);
        kin.forEach((_, c) => {
          if (c === ci) return;
          const s = score(c);
          if (s > bestS + 1e-12 || (Math.abs(s - bestS) <= 1e-12 && c < best)) {
            best = c; bestS = s;
          }
        });
        if (best !== ci) {
          com.set(id, best);
          tot[ci] -= ki;
          tot[best] += ki;
          moved = true;
        }
      }
      if (!moved) break;
    }

    const remap = new Map();
    let next = 0;
    g.ids.forEach(id => {
      const c = com.get(id);
      if (!remap.has(c)) remap.set(c, next++);
      out.set(id, remap.get(c));
    });
    return out;
  }

  function analyze(graph) {
    return {
      degree: degree(graph),
      betweenness: betweenness(graph),
      closeness: closeness(graph),
      eigenvector: eigenvector(graph),
      communities: louvain(graph)
    };
  }

  function communitySizes(communities) {
    const sizes = new Map();
    (communities || new Map()).forEach((c, id) => sizes.set(c, (sizes.get(c) || 0) + 1));
    return sizes;
  }

  return {
    build, analyze, louvain, betweenness, closeness, eigenvector, degree,
    parseDate, normalizeGraph, communitySizes, eid
  };
});
