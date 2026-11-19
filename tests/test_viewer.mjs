import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SNA = require('../viewer_core.js');

const byKey = (g, s, t, type) => g.links.find(l => l.source === s && l.target === t && l.type === type);

test('ekspor minimal tersedia', () => {
  for (const fn of ['build', 'analyze', 'louvain', 'betweenness', 'closeness', 'eigenvector', 'parseDate']) {
    assert.equal(typeof SNA[fn], 'function', fn);
  }
});

test('build: komentar + mention, tanpa edge dari thread, self-loop dilewati', () => {
  const posts = [{
    code: 'A1', author: 'zulfa', text: 'judul',
    thread: [
      { code: 'T1', author: 'zulfa', text: 'lanjutan 1' },
      { code: 'T2', author: 'zulfa', text: 'lanjutan 2' }
    ],
    replies: [
      { code: 'R1', author: 'budi', text: 'Keren @zulfa', timestamp: '2026-10-01' },
      { code: 'R2', author: 'sari', text: 'Setuju', timestamp: '2026-10-02' }
    ]
  }];
  const g = SNA.build(posts);
  assert.deepEqual(g.nodes.map(n => n.id), ['budi', 'sari', 'zulfa']);
  const zulfa = g.nodes.find(n => n.id === 'zulfa');
  assert.equal(zulfa.threadCount, 2);
  assert.equal(zulfa.posts, 1);
  assert.equal(byKey(g, 'budi', 'zulfa', 'komentar').w, 1);
  assert.equal(byKey(g, 'budi', 'zulfa', 'mention').w, 1);
  assert.equal(byKey(g, 'sari', 'zulfa', 'komentar').w, 1);
  assert.equal(g.links.some(l => l.type === 'co-comment'), false);
  assert.equal(g.links.some(l => l.source === 'zulfa'), false, 'thread tidak boleh jadi edge');
  assert.equal(byKey(g, 'budi', 'budi', 'mention'), undefined, 'self-loop dilewati');
  assert.equal(byKey(g, 'budi', 'zulfa', 'komentar').items[0].timestamp, '2026-10-01');
});

test('build: akun yang hanya disebut tetap jadi node (tidak ada link tanpa node)', () => {
  const posts = [{
    author: 'host', text: 'x',
    replies: [{ author: 'budi', text: 'hai @berkastadanterhormat' }]
  }];
  const g = SNA.build(posts);
  const ids = new Set(g.nodes.map(n => n.id));
  assert.ok(ids.has('berkastadanterhormat'), 'target mention harus punya node');
  for (const l of g.links) {
    assert.ok(ids.has(l.source), 'source tanpa node: ' + l.source);
    assert.ok(ids.has(l.target), 'target tanpa node: ' + l.target);
  }
  assert.equal(byKey(g, 'budi', 'berkastadanterhormat', 'mention').w, 1);
  assert.equal(g.nodes.find(n => n.id === 'berkastadanterhormat').posts, 0);
});

test('build: deduplikasi link dan derajat tidak memakai bobot', () => {
  const posts = [{
    code: 'A1', author: 'admin', text: 'x',
    replies: [
      { author: 'dua', text: 'a' },
      { author: 'dua', text: 'b' },
      { author: 'satu', text: 'c' }
    ]
  }];
  const g = SNA.build(posts);
  const e = byKey(g, 'dua', 'admin', 'komentar');
  assert.equal(e.w, 2);
  assert.equal(e.items.length, 2);
  assert.equal(g.nodes.find(n => n.id === 'dua').deg, 1);
  assert.equal(g.nodes.find(n => n.id === 'admin').deg, 2);
});

test('build: filter type, minDeg, dan tanggal', () => {
  const posts = [{
    code: 'A1', author: 'author', text: 'x',
    replies: [
      { author: 'lama', text: 'halo @author', timestamp: '2026-09-30' },
      { author: 'baru', text: 'halo @author', timestamp: '2026-10-05' }
    ]
  }];

  const onlyComment = SNA.build(posts, { types: new Set(['komentar']) });
  assert.equal(onlyComment.links.some(l => l.type === 'mention'), false);

  const dated = SNA.build(posts, { dateFrom: '2026-10-01', dateTo: '2026-10-31' });
  assert.deepEqual([...new Set(dated.links.map(l => l.source))], ['baru']);
  assert.equal(byKey(dated, 'baru', 'author', 'komentar').w, 1);
  assert.equal(byKey(dated, 'baru', 'author', 'mention').items.length, 1);

  const noTimestamp = SNA.build([{
    author: 'author', text: 'x', replies: [{ author: 'tanpa', text: 'hai' }]
  }], { dateFrom: '2026-10-01' });
  assert.equal(noTimestamp.links.length, 0);
  assert.equal(noTimestamp.nodes.length, 0);

  const all = SNA.build(posts, { minDeg: 0 });
  assert.equal(all.nodes.length, 3, 'minDeg=0 mempertahankan node terisolasi');
  const high = SNA.build(posts, { minDeg: 9 });
  assert.deepEqual(high, { nodes: [], links: [] });
});

test('build: co-comment hanya bila diminta, maksimal 12, bobot min(count)', () => {
  const replies = Array.from({ length: 14 }, (_, i) => ({
    author: 'u' + String(i).padStart(2, '0'),
    text: 'komentar',
    timestamp: '2026-10-03'
  }));
  const posts = [{ code: 'A1', author: 'host', text: 'x', replies }];

  const off = SNA.build(posts);
  assert.equal(off.links.filter(l => l.type === 'co-comment').length, 0);

  const on = SNA.build(posts, { types: new Set(['co-comment']) });
  const co = on.links.filter(l => l.type === 'co-comment');
  assert.equal(co.length, (12 * 11) / 2);
  assert.ok(co.every(l => l.w === 1));
  assert.ok(co.every(l => l.items[0].text === 'Komentar di postingan @host'));
  assert.ok(co.every(l => l.items[0].author === 'host'));
  assert.ok(co.every(l => l.items[0].timestamp === '2026-10-03'));
  assert.ok(!co.some(l => l.source === 'u13' || l.target === 'u13'));

  const dup = SNA.build([{
    author: 'host', text: 'x',
    replies: [
      { author: 'a', text: '1' }, { author: 'a', text: '2' }, { author: 'a', text: '3' },
      { author: 'b', text: '1' }, { author: 'b', text: '2' }
    ]
  }], { types: new Set(['co-comment']) });
  assert.equal(byKey(dup, 'a', 'b', 'co-comment').w, 2);
});

test('build: toleran terhadap data lama tanpa field baru & deterministik', () => {
  const posts = [{ author: 'a', text: 'x', replies: [{ author: 'b', text: 'y' }] }];
  const g1 = SNA.build(posts);
  const g2 = SNA.build(posts);
  assert.deepEqual(g1, g2);
  assert.equal(g1.nodes.find(n => n.id === 'b').threadCount, 0);
  assert.equal(g1.links[0].items[0].timestamp, null);
  assert.deepEqual(SNA.build(null), { nodes: [], links: [] });
  assert.deepEqual(SNA.build([]), { nodes: [], links: [] });
});

test('parseDate menerima format baru, lama, ISO, dan menolak sampah', () => {
  assert.equal(SNA.parseDate('2026-10-07'), Date.UTC(2026, 9, 7));
  assert.equal(SNA.parseDate('07/10/2026'), Date.UTC(2026, 9, 7));
  assert.equal(SNA.parseDate('2026-10-07T08:30:00Z'), Date.parse('2026-10-07T08:30:00Z'));
  assert.equal(SNA.parseDate(null), null);
  assert.equal(SNA.parseDate(''), null);
  assert.equal(SNA.parseDate('bukan tanggal'), null);
});

const line = {
  nodes: [{ id: 'A', deg: 1 }, { id: 'B', deg: 2 }, { id: 'C', deg: 1 }],
  links: [
    { source: 'A', target: 'B', type: 'komentar', w: 1 },
    { source: 'B', target: 'C', type: 'komentar', w: 1 }
  ]
};

test('metrik pada graf linear: degree, betweenness, closeness', () => {
  const a = SNA.analyze(line);
  assert.equal(a.degree.get('B'), 2);
  assert.equal(a.betweenness.get('B'), 1);
  assert.equal(a.betweenness.get('A'), 0);
  assert.equal(a.betweenness.get('C'), 0);
  assert.ok(Math.abs(a.closeness.get('B') - 1) < 1e-9);
  assert.ok(Math.abs(a.closeness.get('A') - 2 / 3) < 1e-9);
});

test('eigenvector: pusat bintang lebih tinggi dari daun', () => {
  const star = {
    nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, deg: id === 'a' ? 3 : 1 })),
    links: ['b', 'c', 'd'].map(id => ({ source: 'a', target: id, type: 'komentar', w: 1 }))
  };
  const ev = SNA.eigenvector(star);
  assert.ok(ev.get('a') > ev.get('b'));
  assert.ok(Math.abs(ev.get('b') - ev.get('c')) < 1e-9);
  assert.ok(Math.abs(Math.sqrt([...ev.values()].reduce((s, v) => s + v * v, 0)) - 1) < 1e-6);
});

test('louvain: dua komunitas terpisah, deterministik, index 0..k-1', () => {
  const g = {
    nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, deg: 1 })),
    links: [
      { source: 'a', target: 'b', type: 'komentar', w: 3 },
      { source: 'c', target: 'd', type: 'komentar', w: 3 }
    ]
  };
  const c1 = SNA.louvain(g), c2 = SNA.louvain(g);
  assert.deepEqual(c1, c2);
  assert.equal(c1.get('a'), c1.get('b'));
  assert.equal(c1.get('c'), c1.get('d'));
  assert.notEqual(c1.get('a'), c1.get('c'));
  assert.deepEqual([...new Set(c1.values())].sort(), [0, 1]);
  assert.deepEqual([...SNA.communitySizes(c1).values()].sort(), [2, 2]);
});

test('analyze aman untuk graf kosong dan satu node', () => {
  for (const g of [{ nodes: [], links: [] }, { nodes: [{ id: 'solo', deg: 0 }], links: [] }]) {
    const a = SNA.analyze(g);
    assert.ok(a.degree instanceof Map);
    assert.ok(a.betweenness instanceof Map);
    assert.ok(a.closeness instanceof Map);
    assert.ok(a.eigenvector instanceof Map);
    assert.ok(a.communities instanceof Map);
  }
  assert.equal(SNA.analyze({ nodes: [], links: [] }).communities.size, 0);
  assert.equal(SNA.analyze({ nodes: [{ id: 'solo', deg: 0 }], links: [] }).communities.get('solo'), 0);
});

test('metrik tetap bekerja pada graf yang sudah dimutasi d3.forceLink', () => {
  const g = SNA.build([{
    author: 'host', text: 'x',
    replies: [{ author: 'a', text: '1' }, { author: 'b', text: '2' }]
  }]);
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  g.links.forEach(l => { l.source = byId.get(l.source); l.target = byId.get(l.target); });
  const a = SNA.analyze(g);
  assert.equal(a.degree.get('host'), 2);
  assert.equal(a.communities.size, 3);
  assert.ok(a.eigenvector.size === 3);
});
