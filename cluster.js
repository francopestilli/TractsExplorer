/* ─────────────────────────────────────────────────────────────────
   cluster.js — live hierarchical clustering + dendrogram
   Re-implements the clustering in Kims-Revisions/decode-tracts.ipynb
   so it runs in the browser straight from matrix.csv:

     complete = tracts with no NaN topic scores   (df.dropna(axis=0))
     D        = 1 - Pearson r between tracts across topics
     Z        = scipy linkage(squareform(D), method="complete")
     labels   = scipy fcluster(Z, cut, criterion="distance")

   Cluster numbering follows scipy's fcluster exactly, so cluster N here
   is the same cluster N as in cluster-matrix.csv and the N_surf.png
   figures the notebook exported. Tracts with any NaN score are left out
   of the clustering, exactly as in the notebook.
   ───────────────────────────────────────────────────────────────── */

function _pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb);
}

// matrix: { tract: { topic: value|null } }; returns null if < 2 complete tracts.
function computeClustering(matrix, tractOrder, topics, cut) {
  const ok = v => v !== null && v !== undefined && !isNaN(v);
  const tracts = tractOrder.filter(t => matrix[t] && topics.every(k => ok(matrix[t][k])));
  const excluded = tractOrder.filter(t => !tracts.includes(t));
  const n = tracts.length;
  if (n < 2) return null;

  const X = tracts.map(t => topics.map(k => matrix[t][k]));
  const size = 2 * n - 1;
  const dm = Array.from({ length: size }, () => new Float64Array(size));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = 1 - _pearson(X[i], X[j]);
      dm[i][j] = dm[j][i] = d;
    }
  }

  // Complete linkage. Merges come out in increasing height (complete
  // linkage is monotone), new nodes are numbered n, n+1, … and each row
  // stores [smaller id, larger id, height, size] — the same layout as
  // scipy's Z matrix.
  const active = Array.from({ length: n }, (_, i) => i);
  const sizes = new Array(size).fill(1);
  const Z = [];
  for (let step = 0; step < n - 1; step++) {
    let best = Infinity, ba = -1, bb = -1;
    for (let p = 0; p < active.length; p++) {
      for (let q = p + 1; q < active.length; q++) {
        const d = dm[active[p]][active[q]];
        if (d < best) { best = d; ba = active[p]; bb = active[q]; }
      }
    }
    const id = n + step;
    sizes[id] = sizes[ba] + sizes[bb];
    Z.push([Math.min(ba, bb), Math.max(ba, bb), best, sizes[id]]);
    for (const k of active) {
      if (k === ba || k === bb) continue;
      dm[id][k] = dm[k][id] = Math.max(dm[ba][k], dm[bb][k]);
    }
    active.splice(active.indexOf(ba), 1);
    active.splice(active.indexOf(bb), 1);
    active.push(id);
  }
  const root = 2 * n - 2;

  // fcluster(..., criterion="distance"), mirroring scipy's cluster_monocrit
  // traversal so the numbering matches: depth-first from the root, left
  // child first; the first node at or below the cut starts a new cluster.
  // A node's *leaf* children are labelled only after its internal children
  // are done — this is what decides the numbers of singleton clusters.
  const labelIdx = new Array(n);
  let numClusters = 0;
  const walk = (node, c) => {
    const [a, b, h] = Z[node - n];
    if (c === null && h <= cut) c = ++numClusters;
    if (a >= n) walk(a, c);
    if (b >= n) walk(b, c);
    if (a < n) labelIdx[a] = c === null ? ++numClusters : c;
    if (b < n) labelIdx[b] = c === null ? ++numClusters : c;
  };
  walk(root, null);

  // Dendrogram leaf order (scipy: left child = Z[i,0] first).
  const leaves = [];
  const order = node => {
    if (node < n) { leaves.push(node); return; }
    order(Z[node - n][0]); order(Z[node - n][1]);
  };
  order(root);

  const assignments = {};
  tracts.forEach((t, i) => { assignments[t] = labelIdx[i]; });
  return { tracts, excluded, Z, n, cut, numClusters, assignments, leaves };
}

// ─── Dendrogram (SVG) ──────────────────────────────────────────────
// Same layout as the notebook figure (orientation="left"): root on the
// left, leaves on the right, first leaf at the bottom, branches below the
// cut coloured by cluster. Click a branch → cluster; click a name → tract.
if (typeof Vue !== 'undefined') Vue.component('tract-dendrogram', {
  props: {
    clustering:      { type: Object, default: null },
    colors:          { type: Array, required: true },
    selectedCluster: { type: Number, default: null },
    selectedTract:   { type: String, default: null },
    labels:          { type: Object, default: null },   // { rawName: display label }
    highlight:       { type: Array, default: null },    // names to keep bright (search); null = all
    rowHeight:       { type: Number, default: 13 },
    width:           { type: Number, default: 260 },
    treeWidth:       { type: Number, default: 110 }     // horizontal room for the branches
  },
  template: `
  <svg v-if="clustering" class="dendro-svg" :viewBox="'0 0 ' + W + ' ' + H" role="img" aria-label="Tract clustering dendrogram">
    <line class="dendro-cut" :x1="xOf(clustering.cut)" :x2="xOf(clustering.cut)" :y1="PAD" :y2="H - AXIS">
      <title>Cut at distance {{ clustering.cut }}</title>
    </line>
    <path v-for="l in links" :key="l.key" :d="l.d" fill="none"
          :stroke="l.color" :stroke-width="l.cluster && l.cluster === selectedCluster ? 2.6 : 1.4"
          class="dendro-link" />
    <!-- wide transparent copies of the in-cluster branches = easy click targets -->
    <path v-for="l in links" v-if="l.cluster" :key="'hit' + l.key" :d="l.d" fill="none"
          class="dendro-hit" @click="$emit('select-cluster', l.cluster)">
      <title>Cluster {{ l.cluster }} — click to view</title>
    </path>
    <g v-for="lf in leafLabels" :key="lf.name" class="dendro-leaf"
       :class="{ active: lf.name === selectedTract, dim: isDim(lf), match: highlight && highlight.includes(lf.name) }"
       @click="$emit('select-tract', lf.name)" role="button" tabindex="0" @keydown.enter.space.prevent="$emit('select-tract', lf.name)">
      <rect class="dendro-leaf-hit" :x="X1 + 1" :y="lf.y - ROW / 2" :width="W - X1 - 2" :height="ROW" rx="3" />
      <circle :cx="X1 + 8" :cy="lf.y" r="3" :fill="lf.color" />
      <text :x="X1 + 16" :y="lf.y" dy="0.35em" :fill="lf.color">{{ labelOf(lf.name) }}<title>{{ lf.name }} — cluster {{ lf.cluster }}</title></text>
    </g>
    <g class="dendro-axis">
      <line :x1="X0" :x2="X1" :y1="H - AXIS" :y2="H - AXIS" />
      <g v-for="t in ticks" :key="t">
        <line :x1="xOf(t)" :x2="xOf(t)" :y1="H - AXIS" :y2="H - AXIS + 4" />
        <text :x="xOf(t)" :y="H - AXIS + 14" text-anchor="middle">{{ t.toFixed(1) }}</text>
      </g>
    </g>
  </svg>`,
  data() { return { X0: 6, PAD: 6, AXIS: 20 }; },
  computed: {
    W() { return this.width; },
    X1() { return this.treeWidth; },
    ROW() { return this.rowHeight; },
    H() { return this.clustering ? this.PAD * 2 + this.clustering.n * this.ROW + this.AXIS : 0; },
    hMax() {
      const Z = this.clustering.Z;
      return Math.max(Z[Z.length - 1][2], this.clustering.cut) * 1.04;
    },
    ticks() {
      const out = [];
      for (let v = 0; v <= this.hMax + 1e-9; v += 0.5) out.push(v);
      return out;
    },
    // y position of every node (leaves evenly spaced, first leaf at the bottom).
    layout() {
      const c = this.clustering, n = c.n;
      const y = new Array(2 * n - 1), h = new Array(2 * n - 1).fill(0), lab = new Array(2 * n - 1);
      const bottom = this.H - this.AXIS - this.PAD - this.ROW / 2;
      c.leaves.forEach((leaf, i) => {
        y[leaf] = bottom - i * this.ROW;
        lab[leaf] = c.assignments[c.tracts[leaf]];
      });
      c.Z.forEach((r, i) => {
        const id = n + i;
        y[id] = (y[r[0]] + y[r[1]]) / 2;
        h[id] = r[2];
        lab[id] = lab[r[0]] === lab[r[1]] ? lab[r[0]] : null;   // null → spans clusters
      });
      return { y, h, lab };
    },
    links() {
      const c = this.clustering, { y, h, lab } = this.layout;
      return c.Z.map((r, i) => {
        const id = c.n + i, xa = this.xOf(h[r[0]]), xb = this.xOf(h[r[1]]), xp = this.xOf(r[2]);
        const cl = r[2] <= c.cut ? lab[id] : null;
        return {
          key: id, h: r[2], cluster: cl,
          color: cl ? this.colorOf(cl) : '#7a7f9a',
          d: `M${xa},${y[r[0]]} H${xp} V${y[r[1]]} H${xb}`
        };
      });
    },
    leafLabels() {
      const c = this.clustering, { y } = this.layout;
      return c.leaves.map(leaf => {
        const name = c.tracts[leaf], cl = c.assignments[name];
        return { name, cluster: cl, y: y[leaf], color: this.colorOf(cl) };
      });
    }
  },
  methods: {
    labelOf(name) { return (this.labels && this.labels[name]) || name; },
    // Dim leaves outside the selected cluster, or outside the search matches.
    isDim(lf) {
      if (this.highlight) return !this.highlight.includes(lf.name);
      return !!(this.selectedCluster && lf.cluster !== this.selectedCluster);
    },
    xOf(v) { return this.X1 - (this.X1 - this.X0) * v / this.hMax; },
    colorOf(id) { return this.colors[(id - 1) % this.colors.length]; }
  }
});

if (typeof module !== 'undefined') module.exports = { computeClustering };
