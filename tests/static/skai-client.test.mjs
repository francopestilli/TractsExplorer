import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.TEView = require('../../static/view-state.js');
TEView.init(JSON.parse(readFileSync(new URL('../../data/lookups.json', import.meta.url), 'utf8')).view);
const TESkai = require('../../static/skai-client.js');
const config = JSON.parse(readFileSync(new URL('../../data/config.json', import.meta.url), 'utf8'));
const cfg = { thresholds: config.thresholds, defaultThreshold: config.defaultThreshold };
const BASE = 'https://b.io/te/explorer.html';

// ── fakes ─────────────────────────────────────────────────────────
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const route = routes[(opts.method || 'GET') + ' ' + url];
    if (!route) throw new Error('unexpected request ' + url);
    return route();
  };
  fn.calls = calls;
  return fn;
}

function fakeWebSocketClass() {
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000 }); }
    // test helpers
    open() { this.readyState = 1; if (this.onopen) this.onopen({}); }
    receive(obj) { this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
    drop() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1006 }); }
  }
  FakeWS.OPEN = 1;
  FakeWS.sockets = sockets;
  return FakeWS;
}

function okRoutes() {
  return {
    'GET https://skai.test/ticket': () => jsonResponse(200, { ticket: 'T' }),
    'POST https://skai.test/sessions': () => jsonResponse(200, { session: { id: 'S1', name: 'TractsExplorer' } }),
  };
}

function fakeTimers() {
  const pending = [];
  let next = 0;
  const setTimeout = (fn, ms) => { const id = ++next; pending.push({ fn, ms, id }); return id; };
  const clearTimeout = id => { const i = pending.findIndex(t => t.id === id); if (i >= 0) pending.splice(i, 1); };
  return { setTimeout, clearTimeout, pending };
}

const flush = () => new Promise(r => setImmediate(r));

async function connected(extra = {}) {
  const fetch = fakeFetch(okRoutes());
  const WebSocket = fakeWebSocketClass();
  const timers = fakeTimers();
  const client = TESkai.createClient({ skaiUrl: 'https://skai.test', jwt: 'JWT', fetch, WebSocket, ...timers, ...extra });
  const statuses = [];
  client.onStatus(s => statuses.push(s));
  const p = client.connect();
  await flush();
  WebSocket.sockets[0].open();
  await p;
  return { client, fetch, WebSocket, timers, statuses, ws: WebSocket.sockets[0] };
}

// ── connect ───────────────────────────────────────────────────────
test('connect: ticket with bearer, then named session, then ws + SUBSCRIBE', async () => {
  const { fetch, ws, statuses } = await connected();
  assert.equal(fetch.calls[0].url, 'https://skai.test/ticket');
  assert.equal(fetch.calls[0].opts.headers.Authorization, 'Bearer JWT');
  assert.equal(fetch.calls[1].url, 'https://skai.test/sessions');
  assert.equal(fetch.calls[1].opts.method, 'POST');
  assert.equal(fetch.calls[1].opts.headers.Authorization, 'Bearer JWT');
  assert.deepEqual(JSON.parse(fetch.calls[1].opts.body), { name: 'TractsExplorer' });
  assert.equal(ws.url, 'wss://skai.test/ws?ticket=T');
  assert.deepEqual(ws.sent[0], { sessionId: 'S1', message: { type: 'SUBSCRIBE' } });
  assert.deepEqual(statuses, ['connecting', 'ready']);
});

test('connect: http SKAI url opens a ws:// socket; JWT never in the socket URL', async () => {
  const fetch = fakeFetch({
    'GET http://localhost:9/skai/ticket': () => jsonResponse(200, { ticket: 'a b' }),
    'POST http://localhost:9/skai/sessions': () => jsonResponse(200, { session: { id: 'S' } }),
  });
  const WebSocket = fakeWebSocketClass();
  const client = TESkai.createClient({ skaiUrl: 'http://localhost:9/skai/', jwt: 'SECRET', fetch, WebSocket, ...fakeTimers() });
  client.connect();
  await flush();
  assert.equal(WebSocket.sockets[0].url, 'ws://localhost:9/skai/ws?ticket=a%20b');
  assert.ok(!WebSocket.sockets[0].url.includes('SECRET'));
});

test('/ticket 401 -> status login, no WebSocket, no reconnect', async () => {
  for (const code of [401, 403]) {
    const fetch = fakeFetch({ 'GET https://skai.test/ticket': () => jsonResponse(code, { error: 'Unauthorized' }) });
    const WebSocket = fakeWebSocketClass();
    const timers = fakeTimers();
    const client = TESkai.createClient({ skaiUrl: 'https://skai.test', jwt: 'JWT', fetch, WebSocket, ...timers });
    const statuses = [];
    client.onStatus(s => statuses.push(s));
    await client.connect().catch(() => {});
    assert.deepEqual(statuses, ['connecting', 'login']);
    assert.equal(WebSocket.sockets.length, 0);
    assert.equal(timers.pending.length, 0);
  }
});

test('unreachable SKAI -> offline and a reconnect is scheduled', async () => {
  const fetch = async () => { throw new TypeError('Failed to fetch'); };
  const WebSocket = fakeWebSocketClass();
  const timers = fakeTimers();
  const client = TESkai.createClient({ skaiUrl: 'https://skai.test', jwt: 'JWT', fetch, WebSocket, ...timers });
  const statuses = [];
  client.onStatus(s => statuses.push(s));
  await client.connect().catch(() => {});
  assert.deepEqual(statuses, ['connecting', 'offline']);
  assert.equal(timers.pending.length, 1);
});

test('WebSocket close -> offline, then a reconnect with a fresh ticket and backoff', async () => {
  const { ws, statuses, timers, fetch, WebSocket } = await connected();
  ws.drop();
  assert.equal(statuses[statuses.length - 1], 'offline');
  assert.equal(timers.pending.length, 1);
  const first = timers.pending[0].ms;
  timers.pending[0].fn();
  await flush();
  assert.equal(fetch.calls.filter(c => c.url.endsWith('/ticket')).length, 2);
  assert.equal(WebSocket.sockets.length, 2);
  WebSocket.sockets[1].drop();   // dropped before opening: backoff grows
  assert.ok(timers.pending[1].ms > first);
});

test('open then immediate server close keeps backing off (no 1 s loop)', async () => {
  const { ws, timers, WebSocket } = await connected();
  ws.drop();
  const delays = [timers.pending.at(-1).ms];
  for (let i = 0; i < 4; i++) {
    const t = timers.pending.at(-1);
    timers.pending.splice(timers.pending.indexOf(t), 1);
    t.fn();
    await flush();
    const sock = WebSocket.sockets.at(-1);
    sock.open();   // SKAI accepts the handshake...
    sock.drop();   // ...then closes (bad ticket / no session)
    delays.push(timers.pending.at(-1).ms);
  }
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1], delays.join(','));
});

test('a connection that lasts or hears from the server resets the backoff', async () => {
  const { ws, timers, WebSocket } = await connected();
  ws.drop();
  let t = timers.pending.at(-1); timers.pending.splice(timers.pending.indexOf(t), 1); t.fn(); await flush();
  WebSocket.sockets.at(-1).open();
  WebSocket.sockets.at(-1).receive({ sessionId: 'S1', message: { type: 'MESSAGE_DEFER', content: {} } });
  WebSocket.sockets.at(-1).drop();
  assert.equal(timers.pending.at(-1).ms, 1000);
  t = timers.pending.at(-1); timers.pending.splice(timers.pending.indexOf(t), 1); t.fn(); await flush();
  WebSocket.sockets.at(-1).open();
  const stable = timers.pending.find(x => x.ms === 10000);
  timers.pending.splice(timers.pending.indexOf(stable), 1); stable.fn();   // 10 s up
  WebSocket.sockets.at(-1).drop();
  assert.equal(timers.pending.at(-1).ms, 1000);
});

test('JWT expired mid-chat -> login on reconnect, no /ticket call, no retry loop', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = jwtWith({ sub: 1, exp });
  const fetch = fakeFetch(okRoutes());
  const WebSocket = fakeWebSocketClass();
  const timers = fakeTimers();
  const client = TESkai.createClient({ skaiUrl: 'https://skai.test', jwt, fetch, WebSocket, ...timers });
  const statuses = [];
  client.onStatus(s => statuses.push(s));
  const p = client.connect(); await flush(); WebSocket.sockets[0].open(); await p;
  const realNow = Date.now;
  Date.now = () => (exp + 60) * 1000;   // an hour later the token has expired
  try {
    WebSocket.sockets[0].drop();
    const t = timers.pending.at(-1); timers.pending.splice(timers.pending.indexOf(t), 1); t.fn();
    await flush();
  } finally { Date.now = realNow; }
  assert.deepEqual(statuses, ['connecting', 'ready', 'offline', 'login']);
  assert.equal(fetch.calls.filter(c => c.url.endsWith('/ticket')).length, 1);
  assert.equal(timers.pending.filter(x => x.ms !== 10000).length, 0);
});

test('close() stops reconnecting', async () => {
  const { client, timers } = await connected();
  client.close();
  assert.equal(timers.pending.length, 0);
});

// ── sending ───────────────────────────────────────────────────────
test("ask('hi') sends the TEXT frame", async () => {
  const { client, ws } = await connected();
  assert.equal(client.ask('hi'), true);
  assert.deepEqual(ws.sent[1], { sessionId: 'S1', message: { type: 'TEXT', content: 'hi' } });
});

test('ask(text, view) puts a context line before the question; no CONTEXT frame', async () => {
  const { client, ws } = await connected();
  client.ask('Which topics?', { thr: 'thr-15', tab: 'tract', tract: 'leftArc' });
  assert.deepEqual(ws.sent[1], {
    sessionId: 'S1',
    message: { type: 'TEXT', content: '(Viewing in TractsExplorer: threshold thr-15 · tract leftArc)\n\nWhich topics?' },
  });
  assert.ok(!ws.sent.some(f => f.message.type === 'CONTEXT'));
});

test('contextLine: threshold always, selection only when there is one', () => {
  assert.equal(TESkai.contextLine({ thr: 'thr-15' }), '(Viewing in TractsExplorer: threshold thr-15)');
  assert.equal(TESkai.contextLine({ thr: 'thr-10', cluster: 2, topic: 5, section: 'networks', atlas: 'TY7' }),
    '(Viewing in TractsExplorer: threshold thr-10 · cluster 2 · topic 5 · networks · atlas TY7)');
  assert.equal(TESkai.contextLine({ thr: 'thr-15', tab: 'matrix' }), '(Viewing in TractsExplorer: threshold thr-15 · matrix)');
  assert.equal(TESkai.contextLine(undefined), '');
  assert.equal(TESkai.contextLine({}), '');
});

const FORM = {
  type: 'FORM', id: 'F1', author: 'AGENT',
  content: { fields: [{ id: 'answer', label: 'Which hemisphere?', required: true, type: 'ENUM_INPUT',
    options: [{ id: 'left', option: 'left' }, { id: 'right', option: 'right' }], multiple: false }] },
};

test('answer(form, text) sends a FORM_RESPONSE referencing the FORM', async () => {
  const { client, ws } = await connected();
  assert.equal(client.answer(TESkai.classify(FORM), 'left'), true);
  assert.deepEqual(ws.sent[1], {
    sessionId: 'S1',
    message: { type: 'FORM_RESPONSE', content: { reference: 'F1', responses: [{ id: 'answer', value: 'left' }] } },
  });
});

test('no frame for a while after a question -> REPLY_TIMEOUT; frames restart the wait', async () => {
  const { client, ws, timers } = await connected({ replyTimeoutMs: 500 });
  const got = [];
  client.onMessage(m => got.push(m));
  const replyTimers = () => timers.pending.filter(t => t.ms === 500);
  client.ask('hi');
  assert.equal(replyTimers().length, 1);
  ws.receive({ sessionId: 'S1', message: { type: 'REASONING_STEP', content: { phase: 'thought' } } });
  assert.equal(replyTimers().length, 1);   // restarted, not stacked
  const t = replyTimers()[0];
  timers.clearTimeout(t.id);   // the fake timers leave fired ones pending
  t.fn();
  assert.deepEqual(got.at(-1), { type: 'REPLY_TIMEOUT' });
  assert.equal(TESkai.classify(got.at(-1)).kind, 'timeout');
  // an answer ends the wait
  client.ask('again');
  ws.receive({ sessionId: 'S1', message: { type: 'TEXT', content: 'done' } });
  assert.equal(replyTimers().length, 0);
  // so does a question back, and so does closing
  client.ask('more');
  ws.receive({ sessionId: 'S1', message: FORM });
  assert.equal(replyTimers().length, 0);
  client.ask('last');
  client.close();
  assert.equal(replyTimers().length, 0);
});

test('/ticket that never answers times out -> offline and a retry is scheduled', async () => {
  let signal;
  const fetch = (url, opts) => { signal = opts.signal; return new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }); };
  const timers = fakeTimers();
  const client = TESkai.createClient({ skaiUrl: 'https://skai.test', jwt: 'JWT', fetch, WebSocket: fakeWebSocketClass(),
    fetchTimeoutMs: 15000, ...timers });
  const statuses = [];
  client.onStatus(s => statuses.push(s));
  const p = client.connect();
  const t = timers.pending.find(x => x.ms === 15000);
  assert.ok(t && signal && !signal.aborted);
  t.fn();
  await p.catch(() => {});
  assert.deepEqual(statuses, ['connecting', 'offline']);
  assert.equal(timers.pending.filter(x => x.ms !== 15000).length, 1);   // the reconnect
});

test('ask before the socket is ready returns false and sends nothing', () => {
  const client = TESkai.createClient({ skaiUrl: 'https://skai.test', jwt: 'JWT', fetch: fakeFetch({}), WebSocket: fakeWebSocketClass(), ...fakeTimers() });
  assert.equal(client.ask('hi'), false);
});

// ── receiving ─────────────────────────────────────────────────────
test('onMessage gets the inner message of server frames; PONG / junk ignored', async () => {
  const { client, ws } = await connected();
  const got = [];
  client.onMessage(m => got.push(m));
  ws.receive({ sessionId: 'S1', message: { type: 'TEXT', content: 'hello', author: 'AGENT' } });
  ws.receive({ message: { type: 'PONG' } });
  ws.receive({ error: 'missing' });
  ws.receive('not json');
  assert.deepEqual(got, [{ type: 'TEXT', content: 'hello', author: 'AGENT' }]);
});

test('classify: TEXT renders, progress -> thinking line, the rest ignored', () => {
  assert.deepEqual(TESkai.classify({ type: 'TEXT', content: 'hi' }), { kind: 'text', text: 'hi' });
  assert.equal(TESkai.classify({ type: 'REASONING_STEP', content: { phase: 'thought' } }).kind, 'thinking');
  assert.match(TESkai.classify({ type: 'REASONING_STEP', content: { phase: 'action', tool_name: 'search' } }).text, /search/);
  assert.equal(TESkai.classify({ type: 'REASONING_STEP', content: { phase: 'final_answer' } }).kind, 'ignore');
  assert.equal(TESkai.classify({ type: 'TASK_STATUS', content: { status_text: 'Running' } }).kind, 'thinking');
  for (const type of ['MESSAGE_DEFER', 'CLIENT_TOOL', 'PROVENANCE', 'CONTEXT', 'FORM', 'WHATEVER'])   // FORM without fields
    assert.equal(TESkai.classify({ type, content: {} }).kind, 'ignore');
  assert.equal(TESkai.classify({ type: 'TEXT', content: { not: 'a string' } }).kind, 'ignore');
  assert.equal(TESkai.classify(null).kind, 'ignore');
});

test('classify: FORM -> its question, options, and what to reference in the reply', () => {
  assert.deepEqual(TESkai.classify(FORM),
    { kind: 'form', text: 'Which hemisphere?', reference: 'F1', field: 'answer', options: ['left', 'right'] });
  const free = { type: 'FORM', id: 'F2', content: { fields: [{ id: 'answer', label: 'Which tract?', type: 'TEXT_INPUT' }] } };
  assert.deepEqual(TESkai.classify(free).options, []);
});

// ── explorer links ────────────────────────────────────────────────
test('explorerLinks keeps only this explorer, in order', () => {
  const text = 'See [cluster 2](https://b.io/te/explorer.html?cluster=2) and https://evil.example/explorer.html?cluster=3 and https://b.io/te/explorer.html?tract=leftArc';
  assert.deepEqual(TESkai.explorerLinks(text, BASE, cfg), [{ cluster: 2 }, { tract: 'leftArc' }]);
});

test('explorerLinks trims trailing punctuation and handles none', () => {
  assert.deepEqual(TESkai.explorerLinks('Open https://b.io/te/explorer.html?topic=5.', BASE, cfg), [{ topic: 5 }]);
  assert.deepEqual(TESkai.explorerLinks('**https://b.io/te/explorer.html?cluster=1**', BASE, cfg), [{ cluster: 1 }]);
  assert.deepEqual(TESkai.explorerLinks('no links here', BASE, cfg), []);
  assert.deepEqual(TESkai.explorerLinks('[x](javascript:alert(1))', BASE, cfg), []);
});

test('explorerLinks skips URLs in code spans and fenced code', () => {
  const text = 'Example: `https://b.io/te/explorer.html?cluster=1`\n```\nhttps://b.io/te/explorer.html?cluster=2\n```\nSee https://b.io/te/explorer.html?cluster=3';
  assert.deepEqual(TESkai.explorerLinks(text, BASE, cfg), [{ cluster: 3 }]);
});

// ── JWT ───────────────────────────────────────────────────────────
function jwtWith(payload) {
  const b64 = s => Buffer.from(s).toString('base64url');
  return b64('{"alg":"none"}') + '.' + b64(JSON.stringify(payload)) + '.sig';
}
function store(map) { return { getItem: k => (k in map ? map[k] : null) }; }
const now = Math.floor(Date.now() / 1000);

test('getJwt: expired token -> null', () => {
  assert.equal(TESkai.getJwt(store({ jwt: jwtWith({ sub: 1, exp: now - 60 }) })), null);
});

test('getJwt: brainlife jwt first, then the dev key; junk -> null', () => {
  const good = jwtWith({ sub: 1, exp: now + 3600 });
  const dev = jwtWith({ sub: 2, exp: now + 3600 });
  assert.equal(TESkai.getJwt(store({ jwt: good, 'tractexplorer.devJwt': dev })), good);
  assert.equal(TESkai.getJwt(store({ 'tractexplorer.devJwt': dev })), dev);
  assert.equal(TESkai.getJwt(store({ jwt: jwtWith({ exp: now - 1 }), 'tractexplorer.devJwt': dev })), dev);
  assert.equal(TESkai.getJwt(store({ jwt: 'not-a-jwt' })), null);
  assert.equal(TESkai.getJwt(store({})), null);
  assert.equal(TESkai.getJwt({ getItem() { throw new Error('blocked'); } }), null);
});

// ── markdown ──────────────────────────────────────────────────────
const isInternal = url => TEView.fromUrl(url, BASE, cfg) !== null;

test('renderMarkdown escapes HTML', () => {
  const html = TESkai.renderMarkdown('<img src=x onerror=alert(1)> & "q"', isInternal);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;'));
});

test('renderMarkdown: only http(s) links; external ones open in a new tab', () => {
  const ext = TESkai.renderMarkdown('[paper](https://doi.org/x?a=1&b="2")', isInternal);
  assert.equal(ext, '<p><a href="https://doi.org/x?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">paper</a></p>');
  const js = TESkai.renderMarkdown('[click](javascript:alert(1))', isInternal);
  assert.ok(!js.includes('<a'));
  const internal = TESkai.renderMarkdown('[cluster 2](https://b.io/te/explorer.html?cluster=2)', isInternal);
  assert.equal(internal, '<p><a href="https://b.io/te/explorer.html?cluster=2" class="skai-explorer-link">cluster 2</a></p>');
});

test('renderMarkdown: bold, italics, code, lists, bare urls', () => {
  assert.equal(TESkai.renderMarkdown('**bold** and *it* and `a<b`', isInternal),
    '<p><strong>bold</strong> and <em>it</em> and <code>a&lt;b</code></p>');
  assert.equal(TESkai.renderMarkdown('- one\n- two\n\n1. first', isInternal),
    '<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>');
  assert.equal(TESkai.renderMarkdown('snake_case_name stays', isInternal), '<p>snake_case_name stays</p>');
  assert.equal(TESkai.renderMarkdown('see https://x.org/a.', isInternal),
    '<p>see <a href="https://x.org/a" target="_blank" rel="noopener noreferrer">https://x.org/a</a>.</p>');
  assert.equal(TESkai.renderMarkdown('```\n<x>\n```', isInternal), '<pre><code>&lt;x&gt;</code></pre>');
});

test('summarize a view for the "Showing:" chip', () => {
  assert.equal(TESkai.summarize({ cluster: 2, topic: 5, section: 'networks' }), 'cluster 2 · topic 5 · networks');
  assert.equal(TESkai.summarize({ tab: 'tract', tract: 'leftArc' }), 'leftArc');
  assert.equal(TESkai.summarize({ tab: 'matrix' }), 'matrix');
  assert.equal(TESkai.summarize({}), 'explorer start');
});
