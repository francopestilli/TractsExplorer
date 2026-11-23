// SKAI (brainlife.io's assistant) client for the explorer's side panel.
// Plain browser JS (global TESkai); also CommonJS for the Node tests.
// Protocol (brainlife-assistant api/assistant_api): GET /ticket with the
// brainlife JWT -> {ticket} (single use, 30 s); POST /sessions {name} ->
// {session} (a named session is reused); WebSocket /ws?ticket=...; frames
// are {sessionId, message: {type, content, ...}} both ways.
(function (root) {
  var JWT_KEYS = ['jwt', 'tractexplorer.devJwt'];   // brainlife.io's key, then a dev override
  var BACKOFF_MS = 1000, BACKOFF_MAX_MS = 30000;
  var STABLE_MS = 10000;   // a socket up this long (or one that hears back) resets the backoff
  var FETCH_TIMEOUT_MS = 15000;   // /ticket and /sessions
  var REPLY_TIMEOUT_MS = 120000;  // silence after a question before giving up on the answer

  function view() { return root.TEView || (typeof TEView !== 'undefined' ? TEView : null); }

  // ── JWT ─────────────────────────────────────────────────────────
  function jwtPayload(token) {
    var part = String(token).split('.')[1];
    if (!part) return null;
    var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try { return JSON.parse(atob(b64)); } catch (e) { return null; }
  }

  function pastExp(token) {
    var p = jwtPayload(token);
    return !!p && typeof p.exp === 'number' && p.exp * 1000 < Date.now();
  }
  function expired(token) {
    var p = jwtPayload(token);
    return !p || typeof p !== 'object' || pastExp(token);
  }

  // A usable (present, decodable, unexpired) JWT from storage, or null.
  function getJwt(storage) {
    for (var i = 0; i < JWT_KEYS.length; i++) {
      var token;
      try { token = storage && storage.getItem(JWT_KEYS[i]); } catch (e) { return null; }
      if (!token) continue;
      if (!expired(token)) return token;
    }
    return null;
  }

  // ── Client ──────────────────────────────────────────────────────
  function createClient(opts) {
    var base = String(opts.skaiUrl).replace(/\/+$/, '');
    var jwt = opts.jwt;
    var doFetch = opts.fetch;
    var WS = opts.WebSocket;
    var setT = opts.setTimeout || setTimeout, clearT = opts.clearTimeout || clearTimeout;
    var sessionName = opts.sessionName || 'TractsExplorer';
    var fetchTimeout = opts.fetchTimeoutMs || FETCH_TIMEOUT_MS;
    var replyTimeout = opts.replyTimeoutMs || REPLY_TIMEOUT_MS;
    var msgCbs = [], statusCbs = [];
    var ws = null, sessionId = null, timer = null, stable = null, attempt = 0, closed = false, status = null;
    var waiting = null;   // reply timer while a question is unanswered

    function setStatus(s) {
      if (s === status) return;
      status = s;
      statusCbs.forEach(function (cb) { cb(s); });
    }
    function authed(extra) {
      var h = { Authorization: 'Bearer ' + jwt };
      for (var k in extra) h[k] = extra[k];
      return h;
    }
    function check(r) {
      if (r.status === 401 || r.status === 403) { var e = new Error('SKAI login required'); e.login = true; throw e; }
      if (!r.ok) throw new Error('SKAI HTTP ' + r.status);
      return r.json();
    }
    function scheduleReconnect() {
      if (closed || timer) return;
      var delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MS * Math.pow(2, attempt++));
      timer = setT(function () { timer = null; connect().catch(function () {}); }, delay);
    }
    function send(message) {
      if (!ws || ws.readyState !== 1 || !sessionId) return false;
      ws.send(JSON.stringify({ sessionId: sessionId, message: message }));
      return true;
    }
    function clearStable() { if (stable) { clearT(stable); stable = null; } }
    function emit(m) { msgCbs.forEach(function (cb) { cb(m); }); }
    // While a question is unanswered, every frame restarts the reply timer;
    // an answer (TEXT) or a question back (FORM) ends the wait.
    function stopWaiting() { if (waiting) { clearT(waiting); waiting = null; } }
    function wait() {
      stopWaiting();
      waiting = setT(function () { waiting = null; emit({ type: 'REPLY_TIMEOUT' }); }, replyTimeout);
    }
    function onFrame(ev) {
      var frame;
      try { frame = JSON.parse(ev.data); } catch (e) { return; }
      attempt = 0;   // the server is really talking to us
      var m = frame && frame.message;
      if (!m || typeof m !== 'object' || m.type === 'PONG') return;
      if (waiting) { if (m.type === 'TEXT' || m.type === 'FORM') stopWaiting(); else wait(); }
      emit(m);
    }
    // fetch that gives up after fetchTimeout (AbortController where available).
    function fetchT(url, init) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (ctl) init.signal = ctl.signal;
      var t = setT(function () { if (ctl) ctl.abort(); }, fetchTimeout);
      return doFetch(url, init).then(
        function (r) { clearT(t); return r; },
        function (e) { clearT(t); throw e; });
    }

    function connect() {
      closed = false;
      if (timer) { clearT(timer); timer = null; }
      clearStable();
      if (ws) { var old = ws; ws = null; old.onclose = null; try { old.close(); } catch (e) {} }
      // SKAI answers an expired JWT with a 500, so catch it here, as a login problem.
      if (pastExp(jwt)) {
        setStatus('login');
        var e = new Error('SKAI login expired'); e.login = true;
        return Promise.reject(e);
      }
      setStatus('connecting');
      return fetchT(base + '/ticket', { headers: authed({}) })
        .then(check)
        .then(function (t) {
          return fetchT(base + '/sessions', {
            method: 'POST', headers: authed({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ name: sessionName })
          }).then(check).then(function (s) { return { ticket: t.ticket, session: s.session }; });
        })
        .then(function (r) {
          if (closed) throw new Error('SKAI client closed');
          if (!r.ticket || !r.session || !r.session.id) throw new Error('SKAI: unexpected reply');
          sessionId = r.session.id;
          return new Promise(function (resolve, reject) {
            var sock = ws = new WS(base.replace(/^http/, 'ws') + '/ws?ticket=' + encodeURIComponent(r.ticket));
            var opened = false;
            sock.onopen = function () {
              if (sock !== ws) return;
              opened = true;
              // SKAI accepts then closes on a bad ticket / missing session, so
              // only a connection that lasts (or gets a frame) resets the backoff.
              stable = setT(function () { stable = null; attempt = 0; }, STABLE_MS);
              send({ type: 'SUBSCRIBE' });
              setStatus('ready');
              resolve();
            };
            sock.onmessage = function (ev) { if (sock === ws) onFrame(ev); };
            sock.onerror = function () {};   // onclose follows
            sock.onclose = function () {
              if (sock !== ws) return;
              ws = null;
              clearStable();
              stopWaiting();
              if (closed) return;
              setStatus('offline');
              scheduleReconnect();
              if (!opened) reject(new Error('SKAI socket closed'));
            };
          });
        }, function (err) {
          if (err.login) { setStatus('login'); throw err; }
          if (!closed) { setStatus('offline'); scheduleReconnect(); }
          throw err;
        });
    }

    return {
      connect: connect,
      retry: function () { attempt = 0; return connect(); },
      // A question, prefixed with a line saying what the explorer shows
      // (SKAI keeps no per-message context of its own).
      ask: function (text, view) {
        var line = contextLine(view);
        var ok = send({ type: 'TEXT', content: (line ? line + '\n\n' : '') + String(text) });
        if (ok) wait();
        return ok;
      },
      // The user's reply to a FORM (SKAI's ask_user): form = classify(FORM).
      answer: function (form, text) {
        var ok = send({ type: 'FORM_RESPONSE', content: {
          reference: form.reference,
          responses: [{ id: form.field, value: String(text) }]
        } });
        if (ok) wait();
        return ok;
      },
      onMessage: function (cb) { msgCbs.push(cb); },
      onStatus: function (cb) { statusCbs.push(cb); },
      close: function () {
        closed = true;
        clearStable();
        stopWaiting();
        if (timer) { clearT(timer); timer = null; }
        if (ws) { var s = ws; ws = null; try { s.close(); } catch (e) {} }
      }
    };
  }

  // ── Incoming messages ───────────────────────────────────────────
  // TEXT -> answer; FORM (SKAI asking back) -> question + options to reply
  // to; reasoning / job progress -> one-line status; REPLY_TIMEOUT (from the
  // client) -> give up; the rest (MESSAGE_DEFER echo, PROVENANCE, CONTEXT,
  // CLIENT_TOOL...) is ignored.
  function classify(m) {
    if (!m || typeof m !== 'object') return { kind: 'ignore' };
    var c = m.content;
    if (m.type === 'TEXT') return typeof c === 'string' ? { kind: 'text', text: c } : { kind: 'ignore' };
    if (m.type === 'FORM') {
      // SKAI's ask_user sends one field: {id, label: question, options?: [{id, option}]}.
      var f = c && Array.isArray(c.fields) && c.fields[0];
      if (!f || typeof f !== 'object' || !f.label) return { kind: 'ignore' };
      return {
        kind: 'form', text: String(f.label), reference: m.id, field: f.id || 'answer',
        options: (Array.isArray(f.options) ? f.options : []).map(function (o) {
          return String(o && typeof o === 'object' ? (o.option || o.id) : o);
        })
      };
    }
    if (m.type === 'REPLY_TIMEOUT') return { kind: 'timeout', text: "SKAI didn't answer — try again." };
    if (m.type === 'REASONING_STEP') {
      if (!c || c.phase === 'final_answer') return { kind: 'ignore' };
      return { kind: 'thinking', text: c.tool_name ? 'Thinking… (' + c.tool_name + ')' : 'Thinking…' };
    }
    if (m.type === 'TASK_STATUS') return { kind: 'thinking', text: (c && c.status_text) || 'Working…' };
    return { kind: 'ignore' };
  }

  // ── Context line ────────────────────────────────────────────────
  // "(Viewing in TractsExplorer: threshold thr-15 · tract leftArc)" from a
  // view (currentView plus thr); '' when there is no threshold to report.
  function contextLine(v) {
    if (!v || !v.thr) return '';
    var parts = ['threshold ' + v.thr];
    if (v.tab === 'matrix') parts.push('matrix');
    if (v.cluster) parts.push('cluster ' + v.cluster);
    if (v.tract) parts.push('tract ' + v.tract);
    if (v.topic) parts.push('topic ' + v.topic);
    if (v.section && v.section !== 'map') parts.push(v.section);
    if (v.atlas) parts.push('atlas ' + v.atlas);
    return '(Viewing in TractsExplorer: ' + parts.join(' · ') + ')';
  }

  // ── Links ───────────────────────────────────────────────────────
  // Code spans come first so that URLs inside them are skipped, as the
  // renderer shows them as code rather than links.
  var LINK_RE = /`[^`\n]+`|\[([^\]\n]*)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()\[\]"'`]+)/g;
  function trimUrl(u) { return u.replace(/[.,;:!?*_]+$/, ''); }
  function withoutFences(text) {
    var out = [], fenced = false;
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      else if (!fenced) out.push(line);
    });
    return out.join('\n');
  }

  // View params of every link in `text` that opens this explorer, in order
  // (not counting code spans and fenced code blocks).
  function explorerLinks(text, baseUrl, cfg) {
    var out = [], m, TV = view(), src = withoutFences(text);
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(src))) {
      if (m[0].charAt(0) === '`') continue;
      var url = m[2] || trimUrl(m[3]);
      if (!/^https?:\/\//i.test(url)) continue;
      var p = TV.fromUrl(url, baseUrl, cfg);
      if (p !== null) out.push(p);
    }
    return out;
  }

  function summarize(p) {
    p = p || {};
    if (p.tab === 'matrix') return 'matrix';
    var parts = [];
    if (p.cluster) parts.push('cluster ' + p.cluster);
    if (p.tract) parts.push(p.tract);
    if (p.topic) parts.push('topic ' + p.topic);
    if (p.section && p.section !== 'map') parts.push(p.section);
    if (p.atlas) parts.push(p.atlas);
    if (!parts.length && p.tab) parts.push(p.tab + ' view');
    return parts.length ? parts.join(' · ') : 'explorer start';
  }

  // ── Markdown (safe subset) ──────────────────────────────────────
  // Everything is HTML-escaped; only http(s) links become <a>. Links for
  // which isInternal(url) is true stay in the page (the panel opens them in
  // the explorer); others open in a new tab.
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function emphasis(escaped) {
    return escaped
      .replace(/\*\*(\S(?:[^*]*?\S)?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w*])\*(\S(?:[^*]*?\S)?)\*(?=[^\w*]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(\S(?:[^_]*?\S)?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  }
  function link(url, label, isInternal) {
    var internal = isInternal && isInternal(url);
    return '<a href="' + esc(url) + '"' +
      (internal ? ' class="skai-explorer-link"' : ' target="_blank" rel="noopener noreferrer"') +
      '>' + label + '</a>';
  }
  var INLINE_RE = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()\[\]"'`]+)/g;
  function inline(text, isInternal) {
    var out = '', last = 0, m;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(text))) {
      var before = text.slice(last, m.index), tail = '';
      if (m[1] !== undefined) out += emphasis(esc(before)) + '<code>' + esc(m[1]) + '</code>';
      else if (m[2] !== undefined) {
        out += emphasis(esc(before)) + (/^https?:\/\//i.test(m[3])
          ? link(m[3], emphasis(esc(m[2])), isInternal) : emphasis(esc(m[2])));
      } else {
        var url = trimUrl(m[4]);
        tail = m[4].slice(url.length);
        out += emphasis(esc(before)) + link(url, esc(url), isInternal);
      }
      last = m.index + m[0].length - tail.length;
    }
    return out + emphasis(esc(text.slice(last)));
  }

  function renderMarkdown(src, isInternal) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var html = '', para = [], list = null, i = 0;
    function flushPara() { if (para.length) { html += '<p>' + para.join('<br>') + '</p>'; para = []; } }
    function flushList() { if (list) { html += '</' + list + '>'; list = null; } }
    for (; i < lines.length; i++) {
      var line = lines[i], m;
      if (/^\s*```/.test(line)) {
        flushPara(); flushList();
        var code = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
        html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
      } else if ((m = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line))) {
        flushPara();
        var tag = m[1] ? 'ol' : 'ul';
        if (list !== tag) { flushList(); html += '<' + tag + '>'; list = tag; }
        html += '<li>' + inline(m[2], isInternal) + '</li>';
      } else if ((m = /^\s*#{1,6}\s+(.*)$/.exec(line))) {
        flushPara(); flushList();
        html += '<p><strong>' + inline(m[1], isInternal) + '</strong></p>';
      } else if (!line.trim()) {
        flushPara(); flushList();
      } else {
        flushList();
        para.push(inline(line.trim(), isInternal));
      }
    }
    flushPara(); flushList();
    return html;
  }

  var TESkai = {
    getJwt: getJwt, createClient: createClient, classify: classify, contextLine: contextLine,
    explorerLinks: explorerLinks, summarize: summarize, renderMarkdown: renderMarkdown
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TESkai;
  else root.TESkai = TESkai;
})(typeof window !== 'undefined' ? window : this);
