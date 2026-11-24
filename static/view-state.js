// View links: parse/build explorer URLs. Plain browser JS; also CommonJS.
(function (root) {
  var KEYS = [], ENUMS = {};
  function init(view) { KEYS = view.keys; ENUMS = view.enums; }
  var ID_RE = /^[A-Za-z0-9_]+$/;

  function resolveThreshold(x, cfg) {
    if (x == null || !cfg || !cfg.thresholds) return null;
    x = String(x).trim();
    if (!x) return null;
    var folders = Object.keys(cfg.thresholds);
    var def = cfg.thresholds[cfg.defaultThreshold] ? cfg.defaultThreshold : null;
    if (x === 'default') return def;
    if (folders.indexOf(x) >= 0) return x;
    if (!/^\d*\.?\d+$/.test(x)) return null;
    var n = Number(x);
    if (def && Number(cfg.thresholds[def].value) === n) return def;
    for (var j = 0; j < folders.length; j++) if (Number(cfg.thresholds[folders[j]].value) === n) return folders[j];
    return null;
  }

  function posInt(s) { return /^[1-9]\d*$/.test(s) ? Number(s) : null; }

  // Valid view params from q into out, skipping keys out already has.
  function readParams(q, out, cfg) {
    var v;
    if (!('thr' in out) && q.has('thr') && (v = resolveThreshold(q.get('thr'), cfg)) !== null) out.thr = v;
    Object.keys(ENUMS).forEach(function (k) {
      if (!(k in out) && q.has(k) && ENUMS[k].indexOf(q.get(k)) >= 0) out[k] = q.get(k);
    });
    ['cluster', 'topic'].forEach(function (k) {
      if (!(k in out) && q.has(k) && (v = posInt(q.get(k))) !== null) out[k] = v;
    });
    ['tract', 'atlas'].forEach(function (k) {
      if (!(k in out) && q.has(k) && ID_RE.test(q.get(k))) out[k] = q.get(k);
    });
  }

  // The query wins; the hash adds what it lacks (embedded panel links put the
  // view after '#' so changing it doesn't reload the page).
  function parse(search, hash, cfg) {
    var out = {};
    readParams(new URLSearchParams(search || ''), out, cfg);
    var h = String(hash || '').replace(/^#/, '');
    if (h.indexOf('=') >= 0) readParams(new URLSearchParams(h), out, cfg);
    else if (!out.tab && ENUMS.tab.indexOf(h) >= 0) out.tab = h;
    var ordered = {};
    KEYS.forEach(function (k) { if (k in out) ordered[k] = out[k]; });
    return ordered;
  }

  function toQuery(p) {
    var q = new URLSearchParams();
    KEYS.forEach(function (k) {
      if (p && p[k] !== undefined && p[k] !== null && p[k] !== '') q.set(k, String(p[k]));
    });
    var s = q.toString();
    return s ? '?' + s : '';
  }

  function toHash(p) { return toQuery(p).replace(/^\?/, '#'); }

  // explorer.html?embed=1: shown inside SKAI's side panel.
  function isEmbed(search) { return new URLSearchParams(search || '').get('embed') === '1'; }

  function fromUrl(url, baseUrl, cfg) {
    var u, b;
    try { u = new URL(url, baseUrl); b = new URL(baseUrl); } catch (e) { return null; }
    if (u.origin !== b.origin) return null;
    if (!/explorer\.html$/.test(u.pathname) || u.pathname !== b.pathname) return null;
    return parse(u.search, u.hash, cfg);
  }

  var TEView = { init: init, parse: parse, toQuery: toQuery, toHash: toHash, isEmbed: isEmbed, fromUrl: fromUrl, resolveThreshold: resolveThreshold };
  if (typeof module !== 'undefined' && module.exports) module.exports = TEView;
  else root.TEView = TEView;
})(typeof window !== 'undefined' ? window : this);
