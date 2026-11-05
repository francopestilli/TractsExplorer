/* ─────────────────────────────────────────────────────────────────
   WMC Tract Endpoint Decoding Viewer  —  combined cluster + tract view
   Depends on: Vue 2, PapaParse
   ───────────────────────────────────────────────────────────────── */

// Cluster colour palette — used by the live dendrogram, charts and 3D maps
const CLUSTER_COLORS = [
  '#e07b7b', // 1 – red
  '#d4a843', // 2 – amber
  '#6bbf6b', // 3 – green
  '#5aaccc', // 4 – blue
  '#9b75d4', // 5 – purple
  '#d47a5a', // 6 – orange
  '#3fb8a8', // 7 – teal (was sky blue, too close to cluster 4)
  '#b0c93e', // 8 – lime
  '#e080c0'  // 9 – pink
];

// Tints for 'colour by tract' inside a cluster (up to 12 members)
const TRACT_TINTS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9f1c', '#f15bb5', '#80ed99', '#9bf6ff', '#ffadad', '#bdb2ff', '#fdffb6'];

// Diverging colour scale: blue → white → red (for decoding scores)
function scoreToColor(v, vmin, vmax) {
  if (v === null || isNaN(v)) return '#2a2d40';
  const mid = (vmin + vmax) / 2;
  let t;
  if (v < mid) {
    t = (v - vmin) / (mid - vmin);
    const r = Math.round(59  + t * (240 - 59));
    const g = Math.round(108 + t * (240 - 108));
    const b = Math.round(196 + t * (240 - 196));
    return `rgb(${r},${g},${b})`;
  } else {
    t = (v - mid) / (vmax - mid);
    const r = Math.round(240 + t * (196 - 240));
    const g = Math.round(240 - t * (240 - 59));
    const b = Math.round(240 - t * (240 - 59));
    return `rgb(${r},${g},${b})`;
  }
}

// Parse topic label: "102_novel_repetition_priming" → "novel repetition priming"
function topicLabel(raw) {
  return raw.replace(/^\d+_/, '').replace(/_/g, ' ');
}

// Human-readable tract names. The data uses internal identifiers such as
// "leftArc" or "rightMDLFspl"; the raw id is always shown alongside (tooltip
// or small print) so nothing is hidden, this just makes lists readable.
const TRACT_WORDS = {
  arc: 'Arcuate', parc: 'Posterior arcuate', slf1and2: 'SLF I & II', slf3: 'SLF III',
  ifof: 'IFOF', ilf: 'ILF', vof: 'VOF', uncinate: 'Uncinate', cingulum: 'Cingulum',
  cst: 'Corticospinal', aslant: 'Frontal aslant', tpc: 'Temporo-parietal connection',
  mdlfang: 'MdLF (angular)', mdlfspl: 'MdLF (SPL)', meyer: "Meyer's loop",
  opticradiation: 'Optic radiation', forcepsmajor: 'Forceps major', forcepsminor: 'Forceps minor',
  anteriofrontalcc: 'Anterior frontal CC', middlefrontalcc: 'Middle frontal CC', parietalcc: 'Parietal CC',
  frontothalamic: 'Fronto-thalamic', parietothalamic: 'Parieto-thalamic', temporothalamic: 'Temporo-thalamic',
  motorthalamic: 'Motor-thalamic', spinothalamic: 'Spino-thalamic',
  anteriofrontocerebellar: 'Anterior fronto-cerebellar', contraanteriofrontocerebellar: 'Contralateral anterior fronto-cerebellar',
  motorcerebellar: 'Motor-cerebellar', contramotorcerebellar: 'Contralateral motor-cerebellar',
  parietocerebellar: 'Parieto-cerebellar', occipitocerebellar: 'Occipito-cerebellar', thalamicocerebellar: 'Thalamo-cerebellar'
};
function tractParts(raw) {
  const m = /^(left|right)(.+)$/i.exec(raw);
  const side = m ? m[1].toLowerCase() : null;
  const rest = (m ? m[2] : raw).toLowerCase();
  return { side, rest };
}
function tractLabel(raw) {
  const { side, rest } = tractParts(raw);
  const base = TRACT_WORDS[rest] || raw.replace(/^(left|right)/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
  return side ? `${side === 'left' ? 'L' : 'R'} ${base}` : base;
}
function tractSide(raw) {
  const { side } = tractParts(raw);
  return side ? side.toUpperCase() : 'MID';
}

// Reference atlases of the Network Correspondence Toolbox used in the paper.
const ATLAS_LABELS = {
  TY7: 'Yeo 7 networks (TY7)', EG17: 'Gordon 17 (EG17)', AS200Y17: 'Schaefer 200 / Yeo 17 (AS200Y17)',
  MG360J12: 'Glasser 360 / 12 networks (MG360J12)', XS268_8: 'Shen 268 / 8 networks (XS268_8)', EG286_12: 'Gordon 286 / 12 networks (EG286_12)'
};

// localStorage is a convenience only (first-visit guide); fail soft.
function readPref(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function writePref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

// Topic detail panel: full LDA term list for the topic clicked in
// "Top Cognitive Topics" (data: assets/decoding/topic-terms.json, made by
// scripts/export_topic_terms.py). Shared by the Cluster and Tract views.
const TOPIC_PANEL_TEMPLATE = `
              <aside class="panel-card topic-detail" v-if="selectedTopic" data-tour="topic-panel">
                <div class="panel-card-title topic-detail-title">
                  <span>Topic {{ topicId(selectedTopic) }}</span>
                  <button class="topic-detail-close" @click="selectedTopic = null" aria-label="Close topic panel">×</button>
                </div>
                <div class="topic-detail-body">
                  <div class="topic-detail-name">{{ topicLabel(selectedTopic) }}</div>
                  <div class="topic-detail-score" v-if="tab === 'tract'">
                    <span v-for="src in endpointSources" :key="src.key" class="topic-detail-side">
                      {{ src.label }}: <strong>{{ fmtR(src.row && src.row[selectedTopic]) }}</strong>
                    </span>
                  </div>
                  <div class="topic-detail-score" v-else-if="selectedTopicScore !== null">
                    r = <strong>{{ selectedTopicScore.toFixed(3) }}</strong> for {{ topicSubjectLabel }}
                  </div>
                  <label class="topic-detail-filter">
                    <input type="checkbox" v-model="topicFunctionalOnly" /> Functional terms only
                  </label>
                  <div v-if="!topicTerms" class="text-muted">Loading term list…</div>
                  <div v-else-if="!selectedTopicTerms" class="text-muted">No term list available for this topic.</div>
                  <ol class="term-list" v-else>
                    <li v-for="(t, i) in selectedTopicTerms" :key="t[0]" class="term-row" :title="t[0] + ' — ' + t[2] + ', weight ' + t[1].toFixed(3)">
                      <span class="term-rank">{{ i + 1 }}</span>
                      <span class="term-name">{{ t[0] }}</span>
                      <span class="term-class" :class="termClassCss(t[2])">{{ termClassShort(t[2]) }}</span>
                      <span class="term-bar"><span :style="{ width: (t[1] * 100) + '%' }"></span></span>
                    </li>
                  </ol>
                  <div class="topic-detail-legend">
                    <span class="term-class tc-functional">F</span> Functional
                    <span class="term-class tc-anatomical">A</span> Anatomical
                    <span class="term-class tc-clinical">C</span> Clinical
                    <span class="term-class tc-nonspecific">N</span> Non-specific
                    <div>Bars: LDA term weight (top term = 1)</div>
                  </div>
                </div>
              </aside>
`;

// Brain workspace: ONE large viewport shared by the Cluster and Tract views.
// Toolbar: which map (tract: both / RAS / LPI; cluster: combined / by tract),
// which hemisphere(s), and camera presets. Everything is drawn from func.gii.
const BRAIN_TEMPLATE = `
            <div class="brain-ws" v-if="surfBase && surfMeshBase">
              <div class="brain-toolbar">
                <label class="ctl">
                  <span class="ctl-label">Show</span>
                  <select class="select" :value="brain.mode" @change="setBrainMode($event.target.value)" aria-label="What to draw on the cortex">
                    <template v-if="tab === 'cluster'">
                      <option value="both">Cluster endpoints (combined)</option>
                      <option value="bytract">Cluster endpoints, coloured by tract</option>
                    </template>
                    <template v-else>
                      <option value="both">Both endpoints</option>
                      <option value="RAS">RAS endpoint only</option>
                      <option value="LPI">LPI endpoint only</option>
                    </template>
                    <option value="none" v-if="brain.atlas">Networks only (no endpoints)</option>
                  </select>
                </label>
                <label class="ctl">
                  <span class="ctl-label">View</span>
                  <select class="select" :value="brain.view" @change="setBrainView($event.target.value)" aria-label="Camera view">
                    <option v-for="v in brainViews" :key="v.id" :value="v.id">{{ v.label }}</option>
                  </select>
                </label>
                <button class="icon-btn" @click="resetBrain()" title="Reset rotation and zoom" aria-label="Reset view">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5"/></svg>
                </button>
              </div>
              <div class="brain-stage">
                <canvas ref="surfCanvas"></canvas>
                <div class="surf-overlay" v-if="brain.status === 'loading'"><div class="spinner"></div></div>
                <div class="surf-overlay surf-empty" v-if="brain.status === 'empty'">No endpoint map for this selection at this threshold</div>
                <div class="surf-overlay surf-empty" v-if="brain.status === 'nomembers'">Cluster membership couldn't be computed for this threshold</div>
                <div class="surf-overlay surf-empty" v-if="brain.status === 'nowebgl'">3D view unavailable (WebGL failed to start in this browser)</div>
                <div class="brain-caption">
                  <span v-if="tab === 'cluster'">Cluster {{ selectedCluster }} · {{ brain.mode === 'bytract' ? 'coloured by tract' : brain.mode === 'none' ? 'networks only' : 'combined LPI + RAS' }}</span>
                  <span v-else>{{ tractLabel(selectedTract) }} · {{ brain.mode === 'both' ? 'LPI + RAS' : brain.mode === 'none' ? 'networks only' : brain.mode + ' endpoint' }}</span>
                  <span class="hint">drag to rotate · scroll to zoom</span>
                </div>
              </div>
            </div>
`;

// Shared 3D endpoint-map panel, used by both the Cluster and Tract views.
// Only one view is mounted at a time, so the canvas refs never collide.
const SURF_PANEL_TEMPLATE = `
            <!-- Live 3D cortical endpoint map, rendered from func.gii (tract, or max across a cluster's tracts) -->
            <template v-if="surfBase && surfMeshBase">
              <div class="tract-section-title">Cortical Endpoint Map (3D)</div>
              <div class="tract-surf-row" data-tour="surf-map">
                <div class="panel-card surf-card">
                  <div class="panel-card-title">RAS orientation</div>
                  <div class="surf-canvas-wrap">
                    <canvas ref="surfCanvasRAS"></canvas>
                    <div class="surf-overlay" v-if="surfStatus.RAS === 'loading'"><div class="spinner"></div></div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'empty'">No RAS surface data for this selection</div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'nomembers'">Cluster membership couldn't be computed for this threshold</div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'nowebgl'">3D view unavailable (WebGL failed to start in this browser)</div>
                  </div>
                  <div class="surf-legend" v-if="surfStatus.RAS === 'ready'">
                    <span>0</span><div class="legend-grad hot"></div><span>{{ surfMax.RAS.toFixed(2) }}</span>
                  </div>
                </div>
                <div class="brain-legend" v-if="brain.status === 'ready' && brain.mode !== 'none'" :class="{ raised: brain.atlas && atlasInfo }">
                  <template v-if="brain.mode === 'bytract'">
                    <span v-for="t in brainTints" :key="t.tract" class="tint" :class="{ active: hoverTract === t.tract }"
                          @click="selectTractAndSwitch(t.tract)" :title="t.tract + ' — open in Tract view'">
                      <i :style="{ background: t.color }"></i>{{ tractLabel(t.tract) }}
                    </span>
                  </template>
                  <template v-else>
                    <span class="lg-label">endpoint density</span>
                    <span>0</span><div class="legend-grad" :style="{ background: brain.atlas ? glowLegendCss : brainLegendCss }"></div><span>{{ brain.max.toFixed(2) }}</span>
                  </template>
                </div>
              </div>
                <div class="brain-legend atlas-legend" v-if="brain.atlas && atlasInfo">
                  <span class="lg-label">{{ atlasInfo.title }} · <a href="#" @click.prevent="goToSection('networks')">change atlas</a> · <a href="#" @click.prevent="setAtlas(false)">hide</a></span>
                  <span v-for="(nm, i) in atlasInfo.names" :key="nm" class="tint" :class="{ active: focusNetwork === nm, hot: hoverNetwork === nm, muted: focusNetwork && focusNetwork !== nm }"
                        @click="toggleNetwork(nm)" @mouseenter="hoverNetwork = nm" @mouseleave="hoverNetwork = null" :title="'Click to isolate ' + nm">
                    <i :style="{ background: atlasInfo.colors[i] }"></i>{{ nm }}
                  </span>
                </div>
            </div>
`;

// First-visit guide shown at the top of the Cluster / Tract views until dismissed.
const GUIDE_TEMPLATE = `
          <div class="guide" v-if="!guideDismissed">
            <div>
              <h3>Explore in three steps</h3>
              <p>This site accompanies Ray et al. — every panel is computed live from the paper's data.</p>
              <ol>
                <li><b>Pick a cluster</b> of functionally similar tracts (left panel or dendrogram).</li>
                <li><b>Choose a tract</b> to see its cortical endpoints and how each endpoint decodes.</li>
                <li><b>Click a topic bar</b> to read the full term list behind that cognitive topic.</li>
              </ol>
            </div>
            <button class="dismiss" @click="dismissGuide">Got it, hide this</button>
          </div>
`;


// "At a glance" strip shown under the selection header in both views.
const GLANCE_TEMPLATE = `
            <aside class="glance" data-tour="glance">
              <div class="glance-card">
                <div class="glance-title">Top topics <span>joint decoding · r</span></div>
                <div class="glance-topics" v-if="glanceTopics.length">
                  <button v-for="item in glanceTopics" :key="item.topic" class="glance-row" :class="{ active: selectedTopic === item.topic }"
                          @click="openTopic(item.topic)" :title="'Open topic: ' + topicLabel(item.topic)"
                          @mouseenter="hoverTopic = item.topic" @mouseleave="hoverTopic = null">
                    <span class="glance-label">{{ topicLabel(item.topic) }}</span>
                    <span class="glance-track"><i :style="{ width: (Math.abs(item.value) / glanceMax * 100) + '%', background: item.value >= 0 ? '#e57536' : '#3b9fd0' }"></i></span>
                    <span class="glance-val">{{ item.value.toFixed(2) }}</span>
                  </button>
                </div>
                <div class="glance-empty" v-else>No decoding at this threshold</div>
                <button class="glance-more" @click="goToSection('topics')">All top topics →</button>
              </div>
              <div class="glance-card">
                <div class="glance-title">Best networks <span>{{ networkAtlas || '' }} · Dice</span></div>
                <div class="glance-topics" v-if="glanceNetworks.length">
                  <div v-for="item in glanceNetworks" :key="item.name" class="glance-row static" :title="item.sig ? 'spin-test p < 0.05' : 'not significant'">
                    <span class="glance-label" :class="{ 'network-sig': item.sig }">{{ item.name }}</span>
                    <span class="glance-track"><i :style="{ width: item.widthPct + '%', background: glanceColor, opacity: item.sig ? 1 : .4 }"></i></span>
                    <span class="glance-val">{{ item.dice.toFixed(2) }}{{ item.sig ? '*' : '' }}</span>
                  </div>
                </div>
                <div class="glance-empty" v-else>No network correspondence for this threshold</div>
                <button class="glance-more" @click="goToSection('networks')" v-if="networkAtlases.length">All networks &amp; atlases →</button>
              </div>
              <div class="glance-card glance-how">
                <div class="glance-title">What you're looking at</div>
                <p v-if="tab === 'cluster'">A group of tracts with similar functional profiles. The panels below use the union of their cortical endpoints: where they end, which cognitive topics that territory is associated with, and which brain networks it overlaps.</p>
                <p v-else>One tract. Its two endpoint maps (RAS / LPI) are decoded jointly and separately against 104 cognitive topics, and compared with canonical brain networks.</p>
                <button class="glance-more" @click="startTour()">Take the 2-minute tour →</button>
              </div>
            </aside>
`;

// Topics panel header: chart / list switch + what-it-shows line.
const TOPICS_HEAD_TEMPLATE = `
              <div class="section-title">
                <div class="seg" role="group" aria-label="Topics display">
                  <button :class="{ active: topicsMode === 'chart' }" @click="topicsMode = 'chart'">Profile</button>
                  <button :class="{ active: topicsMode === 'list' }" @click="topicsMode = 'list'">Ranked list</button>
                </div>
              </div>
`;

// Cluster View: ONE combined map — every member tract's LPI and RAS
// endpoint maps merged (per-vertex max), like the "Cluster #N_LPI+RAS"
// figures, coloured with the cluster's own colour ramp.
const CLUSTER_SURF_TEMPLATE = `
            <template v-if="surfBase && surfMeshBase">
              <div class="tract-section-title">Cortical Endpoint Map (3D)</div>
              <div class="panel-card surf-card" data-tour="surf-map" style="max-width:900px;">
                <div class="panel-card-title">Cluster {{ selectedCluster }} — LPI + RAS combined</div>
                <div class="surf-canvas-wrap">
                  <canvas ref="surfCanvasRAS"></canvas>
                  <div class="surf-overlay" v-if="surfStatus.RAS === 'loading'"><div class="spinner"></div></div>
                  <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'empty'">No surface data for this cluster's tracts</div>
                  <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'nomembers'">Cluster membership couldn't be computed for this threshold</div>
                  <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'nowebgl'">3D view unavailable (WebGL failed to start in this browser)</div>
                </div>
                <div class="controls">
                  <span class="bar-legend" style="margin:0"><i style="background:#e57536"></i>positive r <i style="background:#3b9fd0;margin-left:10px"></i>negative r</span>
                </div>
              </div>
              <p class="section-note" v-if="topicsMode === 'chart'">
                Every one of the 104 NeuroQuery topics, placed by its correlation (Pearson r) with the endpoint map; stacked dots share the same value.
                <template v-if="tab === 'tract'">The three lanes share one axis, so a topic that only one endpoint carries stands out at a glance.</template>
                The strongest topics are labelled. Hover for the name and value; click a dot or a label to open the topic's term list (step 3).
              </p>
              <p class="section-note" v-else>
                The strongest topics as a ranked list with exact values<template v-if="tab === 'tract'">, for the joint map and each endpoint on its own</template>. Click a topic to open its term list.
              </p>
`;

// Networks panel: link the rows to the brain.
const NETWORK_TOOLS_TEMPLATE = `
              <div class="net-tools">
                <button class="btn small" :class="{ primary: brain.atlas }" @click="setAtlas(!brain.atlas)">
                  {{ brain.atlas ? 'Shown on the brain' : 'Show on the brain' }}
                </button>
                <label class="opacity" v-if="brain.atlas" title="How strongly the networks are painted on the cortex">
                  <span>Opacity</span>
                  <input type="range" min="0.1" max="1" step="0.05" v-model.number="brain.atlasOpacity" @input="onAtlasOpacity" aria-label="Network opacity" />
                  <b>{{ Math.round(brain.atlasOpacity * 100) }}%</b>
                </label>
                <span class="net-hint" v-if="brain.atlas">Hover a row to find it on the cortex, click to isolate.<template v-if="focusNetwork"> <a href="#" @click.prevent="focusNetwork = null; queueSurfRefresh()">Show all</a>.</template></span>
              </div>
`;

// Sub-tabs: one panel on screen at a time.
const SUBTABS_TEMPLATE = `
            <nav class="subtabs" aria-label="Sections" data-tour="subtabs">
              <button v-for="st in subTabs" :key="st.id" class="subtab" :class="{ active: subTab === st.id }"
                      :disabled="!st.available" @click="goToSection(st.id)" :title="st.hint">
                <b>{{ st.label }}</b><small>{{ st.hint }}</small>
              </button>
            </nav>
`;

// ─── Main component ────────────────────────────────────────────────
Vue.component('wmc-viewer', {
  props: ['config'],

  template: `
  <div class="wmc-root">

    <!-- ── Header (lab style) ──────────────────────────────── -->
    <header class="site-header wide">
      <div class="bar">
        <button class="icon-btn sidebar-toggle" @click="sidebarOpen = !sidebarOpen" aria-label="Toggle tract list">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <a class="site-title" href="index.html" title="Back to the overview"><img class="mark" src="assets/img/mark.svg" alt="" /><span class="words"><b>White Matter Tract Explorer</b><span>Ray et al. · companion site</span></span></a>
        <nav class="nav">
          <div class="control-group" data-tour="threshold" title="Endpoint-density threshold used to define tract endpoints (and the number of clusters it yields)">
            <label>Threshold</label>
            <select class="select" v-model="selectedThreshold" @change="onThresholdChange">
              <option v-for="(folder, label) in config.thresholds" :key="label" :value="label">{{ label }}</option>
            </select>
          </div>
          <span class="stat-chip hide-sm" v-if="tractOrder.length">{{ tractOrder.length }} tracts · {{ topics.length }} topics</span>
          <a class="lab-link hide-sm" href="https://pestillilab.github.io/" target="_blank" rel="noopener" title="A project of the Pestilli Lab, UT Austin"><img src="assets/img/pestilli-lab.svg" alt="Pestilli Lab" /></a>
          <button class="btn small" @click="startTour()" data-tour="tour-btn" title="Guided walkthrough of every panel">Tour</button>
          <button class="icon-btn" @click="helpOpen = true" aria-label="How to use the explorer" title="How to use the explorer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>
          </button>
        </nav>
        </div>
    </header>

    <!-- ── Workflow stepper ─────────────────────────────────── -->
    <div class="stepper" role="tablist" aria-label="Explore workflow" data-tour="stepper">
      <button class="step-btn" role="tab" :class="{ active: tab==='cluster', done: !!selectedCluster }" @click="showClusterView" v-if="clustersEnabled" :aria-selected="tab==='cluster'">
        <span class="step-num">1</span>
        <span class="step-text">
          <small>Cluster</small>
          <span v-if="activeCluster"><span class="step-dot" :style="{ background: activeCluster.color }"></span> Cluster {{ selectedCluster }}</span>
          <span v-else class="placeholder">Pick a cluster</span>
        </span>
      </button>
      <span class="sep" v-if="clustersEnabled">›</span>
      <button class="step-btn" role="tab" :class="{ active: tab==='tract', done: !!selectedTract }" @click="showTractView" :aria-selected="tab==='tract'">
        <span class="step-num">2</span>
        <span class="step-text">
          <small>Tract</small>
          <span v-if="selectedTract"><span class="step-dot" :style="{ background: tractClusterColor(selectedTract) }"></span> {{ tractLabel(selectedTract) }}</span>
          <span v-else class="placeholder">Choose a tract</span>
        </span>
      </button>
      <span class="sep">›</span>
      <button class="step-btn" role="tab" :class="{ done: !!selectedTopic }" :disabled="!selectedTopic" @click="scrollToTopic" :aria-selected="!!selectedTopic">
        <span class="step-num">3</span>
        <span class="step-text">
          <small>Topic</small>
          <span v-if="selectedTopic">{{ topicLabel(selectedTopic) }}</span>
          <span v-else class="placeholder">Click a topic bar</span>
        </span>
      </button>
      <span class="spacer"></span>
      <button class="step-btn alt" role="tab" :class="{ active: tab==='matrix' }" @click="tab='matrix'" :aria-selected="tab==='matrix'" data-tour="matrix-btn">
        <span class="step-text"><small>Or browse</small><span>Full matrix</span></span>
      </button>
    </div>

    <!-- ── Body ───────────────────────────────────────────── -->
    <div class="wmc-body">

      <div class="sidebar-backdrop" v-if="sidebarOpen" @click="sidebarOpen = false"></div>

      <!-- ── Sidebar: clusters → tracts tree ──────────────── -->
      <nav class="wmc-sidebar" :class="{ open: sidebarOpen }" aria-label="Clusters and tracts">
        <div class="sidebar-head">
          <label class="search" data-tour="tract-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input v-model="tractSearch" placeholder="Find a tract (e.g. arcuate, SLF, left…)" aria-label="Search tracts" @keydown.enter="openFirstMatch" />
            <button v-if="tractSearch" @click="tractSearch = ''" aria-label="Clear search">×</button>
          </label>
        </div>
        <div class="sidebar-scroll" data-tour="sidebar">
          <div class="cluster-chips" v-if="clustersEnabled && clusters.length">
            <button v-for="c in clusters" :key="c.id" class="chip" :class="{ active: tab === 'cluster' && selectedCluster === c.id }"
                    @click="selectCluster(c.id)" :title="c.tracts.length + ' tracts — click to view cluster ' + c.id">
              <i :style="{ background: c.color }"></i>{{ c.id }}<small>{{ c.tracts.length }}</small>
            </button>
          </div>
          <div class="sidebar-tabs" data-tour="sidebar-tabs">
            <button class="stab" :class="{ active: sideMode === 'clusters' }" @click="sideMode = 'clusters'" v-if="clustersEnabled">Clusters</button>
            <button class="stab" :class="{ active: sideMode === 'tracts' }" @click="sideMode = 'tracts'">Tracts</button>
          </div>

          <template v-if="sideMode === 'clusters'">
            <div class="sidebar-section">Dendrogram</div>
            <div class="dendro-wrap" data-tour="dendrogram" v-if="clustering">
              <tract-dendrogram
                :clustering="clustering"
                :colors="clusterColors"
                :selected-cluster="selectedCluster"
                :selected-tract="selectedTract"
                :labels="tractLabels"
                :highlight="tractSearch.trim() ? filteredTracts : null"
                :row-height="17"
                :width="330"
                :tree-width="104"
                @select-cluster="selectCluster"
                @select-tract="selectTractAndSwitch"
              ></tract-dendrogram>
              <div class="dendro-note">
                Tracts grouped by how similar their decoding profiles are (complete linkage on 1 − r, cut at {{ clustering.cut }}).
                Click a branch to view its cluster, a name to open that tract.
                <template v-if="clustering.excluded.length">
                  Not clustered (missing scores): {{ clustering.excluded.map(tractLabel).join(', ') }}.
                </template>
              </div>
            </div>
            <div class="tree" v-else>
              <div class="tree-tracts">
                <button v-for="t in filteredTracts" :key="t" class="tract-btn" :class="{ active: tab === 'tract' && selectedTract === t }"
                        @click="selectTractAndSwitch(t)" :title="t">
                  <span class="cluster-dot" :style="{ background: tractClusterColor(t) }"></span>
                  <span class="tract-btn-label">{{ tractLabel(t) }}</span><span class="side">{{ tractSide(t) }}</span>
                </button>
              </div>
            </div>
            <div class="sidebar-section" data-tour="cluster-list">Clusters</div>
            <div class="cluster-list">
              <button v-for="c in clusters" :key="c.id" class="cluster-btn" :class="{ active: selectedCluster === c.id }"
                      @click="selectCluster(c.id)" :title="c.tracts.length + ' tracts'">
                <span class="cluster-dot" :style="{ background: c.color }"></span>
                <span class="cluster-label">Cluster {{ c.id }}</span>
                <span class="cluster-count">{{ c.tracts.length }} {{ c.tracts.length === 1 ? 'tract' : 'tracts' }}</span>
              </button>
            </div>
          </template>

          <template v-else>
            <div class="sidebar-section">{{ tractSearch ? matchCount + ' of ' + tractOrder.length + ' tracts' : 'Tracts · ' + tractOrder.length }}</div>
            <div class="tree tree-tracts">
              <button v-for="t in filteredTracts" :key="t" class="tract-btn" :class="{ active: tab === 'tract' && selectedTract === t }"
                      @click="selectTractAndSwitch(t)" :title="t">
                <span class="cluster-dot" :style="{ background: tractClusterColor(t) }"></span>
                <span class="tract-btn-label">{{ tractLabel(t) }}</span><span class="side">{{ tractSide(t) }}</span>
              </button>
            </div>
          </template>
        </div>
      </nav>

      <!-- ── Content ──────────────────────────────────────── -->
      <main class="wmc-content">

        <!-- Loading -->
        <div class="tab-panel" v-if="loading">
          <div class="loading"><div class="spinner"></div>Loading decoding data…</div>
        </div>

        <!-- ── CLUSTER VIEW TAB ──────────────────────────── -->
        <div class="tab-panel" v-else-if="tab==='cluster'">
          <div v-if="!selectedCluster" class="empty-state">
            Pick a cluster from the list on the left to see its combined endpoint map and decoding profile.
          </div>
          <div v-else>
            <div class="sel-head" data-tour="selection">
              <div>
                <p class="eyebrow"><span class="step-dot" :style="{ background: activeCluster.color }"></span> Step 1 · Cluster</p>
                <h2>Cluster {{ selectedCluster }} <span class="raw">{{ activeCluster.tracts.length }} {{ activeCluster.tracts.length === 1 ? 'tract' : 'tracts' }} · threshold {{ selectedThreshold.split(' ')[0] }}</span></h2>
                <p class="summary" v-if="activeCluster.tracts.length">
                  Tracts whose topic-decoding profiles cluster together. Everything here is computed from the
                  <em>union</em> of the member tracts' endpoint maps. Click a tract to go to step 2.
                </p>
                <p class="summary" v-else>Cluster membership couldn't be computed for this threshold.</p>
                <div class="tract-tags" v-if="activeCluster.tracts.length">
                  <button class="tract-tag" v-for="t in activeCluster.tracts" :key="t" :style="{ borderColor: activeCluster.color }"
                          @click="selectTractAndSwitch(t)" :title="t + ' — open in Tract view'">{{ tractLabel(t) }}</button>
                </div>
              </div>
            </div>

            <!-- Workspace: the brain stays put on the left; the sections live on the right -->
            <div class="workspace">
              <div class="ws-brain" data-tour="map">${BRAIN_TEMPLATE}</div>
              <div class="ws-panels">
            ${SUBTABS_TEMPLATE}
            <section class="subpanel" id="sec-map" data-section="map">
              <h3 class="sec-head"><span>Overview</span><small>Top topics, best networks, what this is</small></h3>
              ${GLANCE_TEMPLATE}
            </section>

            <!-- Topics -->
            <section class="subpanel" id="sec-topics" data-tour="topics" data-section="topics">
              <h3 class="sec-head"><span>Topics</span><small>All 104 cognitive topics decoded from the endpoint map</small></h3>
              <template v-if="clusterMatrix[selectedCluster]">
                ${TOPICS_HEAD_TEMPLATE}
                <div class="topics-row" :class="{ stack: topicsMode === 'chart' }">
                  <div class="profile-wrap" v-if="topicsMode === 'chart'">
                    <topic-profile :lanes="profileLanes" :selected-topic="selectedTopic" :hover-topic="hoverTopic"
                                   @select-topic="toggleTopic($event)" @hover-topic="hoverTopic = $event"></topic-profile>
                  </div>
                  <div class="topic-bars" v-else>
                    <div v-for="item in clusterTopTopics" :key="item.topic" class="topic-bar-row clickable"
                         :class="{ active: selectedTopic === item.topic, hot: hoverTopic === item.topic }" role="button" tabindex="0"
                         @click="toggleTopic(item.topic)" @keydown.enter.space.prevent="toggleTopic(item.topic)"
                         @mouseenter="hoverTopic = item.topic" @mouseleave="hoverTopic = null">
                      <div class="topic-bar-label" :title="'Click to see all terms in ' + item.topic">{{ topicLabel(item.topic) }}</div>
                      <div class="topic-bar-track">
                        <div class="topic-bar-fill" :style="{ width: clusterBarWidth(item.value) + '%', background: item.value >= 0 ? '#e57536' : '#3b9fd0' }"></div>
                        <span class="topic-bar-val">{{ item.value.toFixed(3) }}</span>
                      </div>
                    </div>
            ${CLUSTER_SURF_TEMPLATE}

            <!-- Live decoding scores for this cluster (if cluster-matrix.csv exists for this threshold) -->
            <template v-if="clusterMatrix[selectedCluster]">
              <div class="tract-section-title">Top Cognitive Topics</div>
              <div class="topics-row" data-tour="topics">
              <div class="topic-bars">
                <div v-for="item in clusterTopTopics" :key="item.topic" class="topic-bar-row clickable"
                     :class="{ active: selectedTopic === item.topic }" role="button" tabindex="0"
                     @click="toggleTopic(item.topic)" @keydown.enter.space.prevent="toggleTopic(item.topic)">
                  <div class="topic-bar-label" :title="'Click to see all terms in ' + item.topic">{{ topicLabel(item.topic) }}</div>
                  <div class="topic-bar-track">
                    <div
                      class="topic-bar-fill"
                      :style="{
                        width: clusterBarWidth(item.value) + '%',
                        background: item.value >= 0 ? '#e07b7b' : '#4f8ef7'
                      }"
                    ></div>
                    <span class="topic-bar-val">{{ item.value.toFixed(3) }}</span>
                  </div>
                  ${TOPIC_PANEL_TEMPLATE}
                </div>
              </template>
              <div v-else class="network-corr-empty">No cluster-level decoding for this threshold.</div>
            </section>

            <!-- Radar + word cloud -->
            <section class="subpanel" id="sec-charts" data-tour="charts" data-section="charts">
              <h3 class="sec-head"><span>Radar &amp; word cloud</span><small>The paper's figures (Figs. 3–4), drawn live</small></h3>
              <div class="section-title">
                <div class="controls" style="margin-left:0">
                  <label class="chart-term-toggle" v-if="topicTerms && Object.keys(topicTerms).length" style="margin:0">
                    <input type="checkbox" v-model="topicFunctionalOnly" /> Functional terms only
                  </label>
                </div>
              </div>
              <p class="section-note">The paper's figures, drawn live from the same decoding scores. Hover a bar or a word to see them light up together; click one to open its topic (step 3). With “Functional terms only” on (as in Ray et al.), labels use each topic's functional terms.</p>
              <div class="tract-img-row" v-if="clusterScores">
                <div class="panel-card">
                  <div class="panel-card-title">Radar chart<span v-if="chartTermSets">functional terms</span></div>
                  <topic-radar :scores="clusterScores" :color="activeCluster.color" :term-sets="chartTermSets" :selected-topic="selectedTopic" :hover-topic="hoverTopic" @select-topic="openTopic" @hover-topic="hoverTopic = $event"></topic-radar>
                </div>
                <div class="panel-card">
                  <div class="panel-card-title">Word cloud<span v-if="chartTermSets">functional terms</span></div>
                  <topic-wordcloud :scores="clusterScores" :color="activeCluster.color" :term-sets="chartTermSets" :selected-topic="selectedTopic" :hover-topic="hoverTopic" @select-topic="openTopic" @hover-topic="hoverTopic = $event"></topic-wordcloud>
                </div>
              </div>
              <div v-else class="network-corr-empty">No cluster-level decoding for this threshold.</div>
            </section>

            <!-- Network correspondence -->
            <section class="subpanel" id="sec-networks" data-tour="networks" data-section="networks">
              <h3 class="sec-head"><span>Networks</span><small>Overlap with canonical brain networks (Dice, spin test)</small></h3>
              <div class="section-title">
                <div class="controls" style="margin-left:0">
                  <label>Atlas
                    <select class="select" v-model="networkAtlas" style="margin-left:6px">
                      <option v-for="a in networkAtlases" :key="a" :value="a">{{ atlasLabel(a) }}</option>
                    </select>
                  </label>
                </div>
            </div>

            <!-- Network Correspondence: Dice overlap with canonical network atlases -->
            <template v-if="networkAtlases.length">
              <div class="tract-section-title" data-tour="network-corr">
  Network Correspondence
</div>
              <p class="section-note">
                Dice overlap between this cluster's combined endpoint map and each network of the selected
                atlas, from the <a href="https://www.nature.com/articles/s41467-025-58176-9" target="_blank" rel="noopener">Network Correspondence Toolbox</a>
                (Kong et al., 2025). Bold / starred networks are spin-test significant (p &lt; 0.05); non-significant bars are faded.
              </p>
              ${NETWORK_TOOLS_TEMPLATE}
              <div v-if="clusterNetworkRows.length" class="topic-bars">
                <div v-for="item in clusterNetworkRows" :key="item.name" class="topic-bar-row clickable"
                     :class="{ active: focusNetwork === item.name, hot: hoverNetwork === item.name }" role="button" tabindex="0"
                     @click="toggleNetwork(item.name)" @keydown.enter.space.prevent="toggleNetwork(item.name)"
                     @mouseenter="hoverNetwork = item.name" @mouseleave="hoverNetwork = null">
                  <div class="topic-bar-label" :class="{ 'network-sig': item.sig }" :title="item.name">{{ item.name }}</div>
                  <div class="topic-bar-track">
                    <div class="topic-bar-fill" :style="{ width: item.widthPct + '%', background: networkColor(item.name) || activeCluster.color, opacity: item.sig ? 1 : 0.35 }"></div>
                    <span class="topic-bar-val">{{ item.dice.toFixed(3) }}{{ item.sig ? ' *' : '' }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="network-corr-empty">No {{ networkAtlas }} correspondence for this cluster.</div>
            </section>
              </div>
            </div>

          </div>
        </div>

        <!-- ── TRACT VIEW TAB ────────────────────────────── -->
        <div class="tab-panel" v-else-if="tab==='tract'">
          <div v-if="!selectedTract" class="empty-state">
            Choose a tract from the list on the left (or search for one) to see its endpoint map and decoding profile.
          </div>
          <div v-else>
            <div class="sel-head" data-tour="selection">
              <div>
                <p class="eyebrow"><span class="step-dot" :style="{ background: tractClusterColor(selectedTract) }"></span> Step 2 · Tract</p>
                <h2>{{ tractLabel(selectedTract) }} <span class="raw">{{ selectedTract }} · threshold {{ selectedThreshold.split(' ')[0] }}</span></h2>
                <p class="summary">
                  <template v-if="clusterAssignments[selectedTract]">
                    Member of <a href="#" @click.prevent="jumpToCluster(tractClusterIndex(selectedTract))">Cluster {{ tractClusterIndex(selectedTract) }}</a>
                    with {{ siblingTracts.length }} other {{ siblingTracts.length === 1 ? 'tract' : 'tracts' }}.
                  </template>
                  <template v-else>Not clustered at this threshold (missing decoding scores).</template>
                  Defined by the <a href="https://academic.oup.com/cercor/article/32/20/4524/6528900" target="_blank" rel="noopener">Bullock et al. (2022)</a> taxonomy
                  via its <a href="https://brainlife.io/app/5cc73ef44ed9df00317f6288" target="_blank" rel="noopener">brainlife.io app</a>.
                </p>
                <div class="tract-tags" v-if="siblingTracts.length">
                  <button class="tract-tag" v-for="t in siblingTracts" :key="t" :style="{ borderColor: tractClusterColor(t) }" @click="selectTractAndSwitch(t)" :title="t">{{ tractLabel(t) }}</button>
                </div>
              </div>
              <div class="side">
                <button class="btn small" v-if="clusterAssignments[selectedTract]" @click="jumpToCluster(tractClusterIndex(selectedTract))">← Back to cluster {{ tractClusterIndex(selectedTract) }}</button>
              </div>
            </div>

            <!-- Workspace: the brain stays put on the left; the sections live on the right -->
            <div class="workspace">
              <div class="ws-brain" data-tour="map">${BRAIN_TEMPLATE}</div>
              <div class="ws-panels">
            ${SUBTABS_TEMPLATE}
            <section class="subpanel" id="sec-map" data-section="map">
              <h3 class="sec-head"><span>Overview</span><small>Top topics, best networks, what this is</small></h3>
              ${GLANCE_TEMPLATE}
            </section>

            <!-- Decoding: joint (LPI + RAS) vs. each endpoint on its own -->
            <section class="subpanel" id="sec-topics" data-tour="topics" data-section="topics">
              <h3 class="sec-head"><span>Topics</span><small>All 104 cognitive topics decoded from the endpoint map</small></h3>
              ${TOPICS_HEAD_TEMPLATE}
              <div class="topics-row" :class="{ stack: topicsMode === 'chart' }">
                <div class="profile-wrap" v-if="topicsMode === 'chart'">
                  <topic-profile :lanes="profileLanes" :selected-topic="selectedTopic" :hover-topic="hoverTopic"
                                 @select-topic="toggleTopic($event)" @hover-topic="hoverTopic = $event"></topic-profile>
                </div>
                <div class="endpoint-cols" v-else>
                  <div class="endpoint-col" v-for="src in endpointSources" :key="src.key">
                    <div class="endpoint-col-title">{{ src.label }}</div>
                    <div v-if="!src.has" class="endpoint-empty">No {{ src.key }}-only decoding for this tract at this threshold.</div>
                    <div v-else class="topic-bars">
                      <div v-for="item in src.top" :key="item.topic" class="topic-bar-row clickable"
                           :class="{ active: selectedTopic === item.topic, hot: hoverTopic === item.topic }" role="button" tabindex="0"
                           @click="toggleTopic(item.topic)" @keydown.enter.space.prevent="toggleTopic(item.topic)"
                           @mouseenter="hoverTopic = item.topic" @mouseleave="hoverTopic = null">
                        <div class="topic-bar-label" :title="'Click to see all terms in ' + item.topic">{{ topicLabel(item.topic) }}</div>
                        <div class="topic-bar-track">
                          <div class="topic-bar-fill" :style="{ width: sideBarWidth(item.value) + '%', background: item.value >= 0 ? '#e57536' : '#3b9fd0' }"></div>
                          <span class="topic-bar-val">{{ item.value.toFixed(3) }}</span>
                        </div>
${SURF_PANEL_TEMPLATE}
            <!-- Decoding: joint (LPI + RAS) vs. each endpoint on its own, side by side -->
            <div class="tract-section-title">Top Cognitive Topics — joint vs. each endpoint</div>
            <p class="view-intro">
              Explore the strongest topics associated with this tract's endpoints. Click a topic to
              examine its full list of terms.
            </p>
            <div class="topics-row" data-tour="topics">
              <div class="endpoint-cols">
                <div class="endpoint-col" v-for="src in endpointSources" :key="src.key">
                  <div class="endpoint-col-title">{{ src.label }}</div>
                  <div v-if="!src.has" class="endpoint-empty">No {{ src.key }}-only decoding for this tract at this threshold.</div>
                  <div v-else class="topic-bars">
                    <div v-for="item in src.top" :key="item.topic" class="topic-bar-row clickable"
                         :class="{ active: selectedTopic === item.topic }" role="button" tabindex="0"
                         @click="toggleTopic(item.topic)" @keydown.enter.space.prevent="toggleTopic(item.topic)">
                      <div class="topic-bar-label" :title="'Click to see all terms in ' + item.topic">{{ topicLabel(item.topic) }}</div>
                      <div class="topic-bar-track">
                        <div class="topic-bar-fill"
                             :style="{ width: sideBarWidth(item.value) + '%', background: item.value >= 0 ? '#e07b7b' : '#4f8ef7' }"></div>
                        <span class="topic-bar-val">{{ item.value.toFixed(3) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
                ${TOPIC_PANEL_TEMPLATE}
              </div>
            </section>

            <!-- Radar + word cloud per decoding -->
            <section class="subpanel" id="sec-charts" data-tour="charts" data-section="charts">
              <h3 class="sec-head"><span>Radar &amp; word cloud</span><small>The paper's figures (Figs. 3–4), drawn live</small></h3>
              <div class="section-title">
                <div class="controls" style="margin-left:0">
                  <label class="chart-term-toggle" v-if="topicTerms && Object.keys(topicTerms).length" style="margin:0">
                    <input type="checkbox" v-model="topicFunctionalOnly" /> Functional terms only
                  </label>
                </div>
              </div>
              <p class="section-note">
                One radar chart and word cloud per decoding (joint, RAS, LPI). Hover a bar or a word to link them; click one to open its topic (step 3).
                Ray et al. used functional terms only. Topics are decoded with
                <a href="https://gradec.readthedocs.io/en/latest/index.html" target="_blank" rel="noopener">gradec</a>
                (<a href="https://direct.mit.edu/imag/article/doi/10.1162/imag_a_00081/119100/Methods-for-decoding-cortical-gradients-of" target="_blank" rel="noopener">Peraza et al., 2024</a>).
              </p>
              <div class="endpoint-charts">
                <div class="panel-card" v-for="src in endpointSources" :key="'radar-' + src.key">
                  <div class="panel-card-title">Radar<span>{{ src.label }}</span></div>
                  <topic-radar v-if="src.has" :scores="src.row" :color="tractChartColor" :term-sets="chartTermSets" :selected-topic="selectedTopic" :hover-topic="hoverTopic" @select-topic="openTopic" @hover-topic="hoverTopic = $event"></topic-radar>
                  <div v-else class="endpoint-empty chart-empty-card">No {{ src.key }}-only decoding</div>
                </div>
                <div class="panel-card" v-for="src in endpointSources" :key="'cloud-' + src.key">
                  <div class="panel-card-title">Word cloud<span>{{ src.label }}</span></div>
                  <topic-wordcloud v-if="src.has" :scores="src.row" :color="tractChartColor" :term-sets="chartTermSets" :selected-topic="selectedTopic" :hover-topic="hoverTopic" @select-topic="openTopic" @hover-topic="hoverTopic = $event"></topic-wordcloud>
                  <div v-else class="endpoint-empty chart-empty-card">No {{ src.key }}-only decoding</div>
                </div>
              </div>
            </section>

            <!-- Network correspondence -->
            <section class="subpanel" id="sec-networks" data-tour="networks" data-section="networks">
              <h3 class="sec-head"><span>Networks</span><small>Overlap with canonical brain networks (Dice, spin test)</small></h3>
              <div class="section-title">
                <div class="controls" style="margin-left:0">
                  <label>Atlas
                    <select class="select" v-model="networkAtlas" style="margin-left:6px">
                      <option v-for="a in networkAtlases" :key="a" :value="a">{{ atlasLabel(a) }}</option>
                    </select>
                  </label>
                </div>
            </div>

            <!-- Network Correspondence: Dice overlap with canonical network atlases -->
            <template v-if="networkAtlases.length">
             <div class="tract-section-title" data-tour="network-corr">
  Network Correspondence
</div>
              <p class="section-note">
                Dice overlap between this tract's combined (LPI + RAS) endpoint map and each network of the
                selected atlas, from the <a href="https://www.nature.com/articles/s41467-025-58176-9" target="_blank" rel="noopener">Network Correspondence Toolbox</a>
                (Kong et al., 2025). Bold / starred networks are spin-test significant (p &lt; 0.05); non-significant bars are faded.
              </p>
              ${NETWORK_TOOLS_TEMPLATE}
              <div v-if="tractNetworkRows.length" class="topic-bars">
                <div v-for="item in tractNetworkRows" :key="item.name" class="topic-bar-row clickable"
                     :class="{ active: focusNetwork === item.name, hot: hoverNetwork === item.name }" role="button" tabindex="0"
                     @click="toggleNetwork(item.name)" @keydown.enter.space.prevent="toggleNetwork(item.name)"
                     @mouseenter="hoverNetwork = item.name" @mouseleave="hoverNetwork = null">
                  <div class="topic-bar-label" :class="{ 'network-sig': item.sig }" :title="item.name">{{ item.name }}</div>
                  <div class="topic-bar-track">
                    <div class="topic-bar-fill" :style="{ width: item.widthPct + '%', background: networkColor(item.name) || tractChartColor, opacity: item.sig ? 1 : 0.35 }"></div>
                    <span class="topic-bar-val">{{ item.dice.toFixed(3) }}{{ item.sig ? ' *' : '' }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="network-corr-empty">No {{ networkAtlas }} correspondence for this tract.</div>
            </section>
              </div>
            </div>

          </div>
        </div>

        <!-- ── MATRIX TAB ────────────────────────────────── -->
        <div class="tab-panel" v-else-if="tab==='matrix'">
          <div class="sel-head">
            <div>
              <p class="eyebrow">Browse · Full matrix</p>
              <h2>All {{ tractOrder.length }} tracts × {{ topics.length }} topics</h2>
              <p class="summary">
                Every tract's joint decoding score for every topic. Rows follow the dendrogram, so functionally similar tracts sit together,
                with the row's cluster color on the left. Hover a cell for the exact value; click a row to open that tract (step 2).
                Rows without values are tracts whose endpoints didn't survive this threshold.
              </p>
            </div>
            <div class="side">
              <div class="matrix-legend">
                <span>{{ vmin.toFixed(2) }}</span>
                <div class="legend-grad"></div>
                <span>{{ vmax.toFixed(2) }}</span>
                <span style="margin-left:10px">decoding score (r)</span>
              </div>
            </div>
          </div>
          <div class="matrix-wrap" data-tour="matrix-table">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th class="corner">Tract ↓ · Topic →</th>
                  <th class="col-header" v-for="t in topics" :key="t" :title="topicLabel(t)"><span>{{ topicLabel(t) }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tract in matrixTractOrder" :key="tract" @click="selectTractAndSwitch(tract)" style="cursor:pointer;" :title="'Open ' + tractLabel(tract)">
                  <th class="row-header" :style="{ borderLeft: '3px solid ' + tractClusterColor(tract) }">{{ tractLabel(tract) }}</th>
                  <td
                    class="cell"
                    v-for="topic in topics"
                    :key="topic"
                    :style="{ background: cellColor(tract, topic) }"
                    @mousemove.stop="showTip($event, tract, topic)"
                    @mouseleave="hideTip"
                  ></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>

    <!-- ── Tooltip ─────────────────────────────────────────── -->
    <div
      class="cell-tooltip"
      v-if="tooltip.visible"
      :style="{ top: tooltip.y + 'px', left: tooltip.x + 'px' }"
    >
      <strong>{{ tooltip.tract }}</strong>
      <span>{{ topicLabel(tooltip.topic) }}</span><br/>
      <span v-if="tooltip.value !== null" class="val">r = {{ tooltip.value.toFixed(4) }}</span>
      <span v-else style="color:var(--orange)">No data (NaN)</span>
    </div>

    <!-- ── Guided tour (spotlight walkthrough) ───────────────── -->
    <div class="tour" v-if="tour.active" role="dialog" aria-modal="true" aria-label="Guided tour">
      <svg class="tour-mask" aria-hidden="true">
        <defs>
          <mask id="tourMask">
            <rect width="100%" height="100%" fill="#fff" />
            <rect v-if="tour.rect" :x="tour.rect.x - 6" :y="tour.rect.y - 6" :width="tour.rect.w + 12" :height="tour.rect.h + 12" rx="10" fill="#000" />
          </mask>
        </defs>
        <rect width="100%" height="100%" class="tour-shade" mask="url(#tourMask)" @click="endTour" />
      </svg>
      <div class="tour-ring" v-if="tour.rect" :style="{ left: (tour.rect.x - 6) + 'px', top: (tour.rect.y - 6) + 'px', width: (tour.rect.w + 12) + 'px', height: (tour.rect.h + 12) + 'px' }"></div>
      <div class="tour-card" :class="tour.place" :style="tour.cardStyle" ref="tourCard">
        <div class="tour-progress"><span>{{ tour.step + 1 }} / {{ tourSteps.length }}</span><button class="tour-skip" @click="endTour">Skip tour</button></div>
        <h3>{{ tourSteps[tour.step].title }}</h3>
        <p v-html="tourSteps[tour.step].body"></p>
        <div class="tour-actions">
          <button class="btn small" @click="tourGo(-1)" :disabled="tour.step === 0">Back</button>
          <button class="btn primary small" @click="tourGo(1)">{{ tour.step === tourSteps.length - 1 ? 'Finish' : 'Next' }}</button>
        </div>
      </div>
    </div>

    <!-- ── Help dialog ─────────────────────────────────────── -->
    <div class="modal-backdrop" v-if="helpOpen" @click.self="helpOpen = false">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
        <h2 id="helpTitle">How to use the explorer</h2>
        <p class="lede">The explorer is a drill-down in three steps. The bar under the header always shows where you are.</p>
        <h4>Step 1 · Cluster</h4>
        <p><b>Tracts are grouped by how similar their functional profiles are</b> (complete-linkage clustering on 1 − Pearson r across the 104 topics, cut at the distance shown under the dendrogram). Pick a cluster in the left panel or click a branch of the dendrogram. You'll see the union of its members' endpoint maps, its top topics, radar chart, word cloud and network overlap.</p>
        <h4>Step 2 · Tract</h4>
        <p><b>Open any tract</b> — from the cluster's tag list, the tree on the left, the search box, or a row of the full matrix. The tract view shows its endpoint map in both orientation conventions (RAS and LPI), and the decoding of the joint map next to each endpoint decoded on its own.</p>
        <h4>Step 3 · Topic</h4>
        <p><b>Click any topic bar</b> to open that topic's full 40-term LDA list, with each term's weight and type (functional, anatomical, clinical, non-specific). The “Functional terms only” switch matches the paper's figures and also drives the radar and word-cloud labels.</p>
        <h4>Threshold</h4>
        <p>The dropdown in the header switches the endpoint-density threshold used to define tract endpoints (0.05–0.20). Each threshold has its own decoding and its own clustering solution; the number of clusters is shown in the label.</p>
        <h4>3D maps</h4>
        <p>Drag to rotate, scroll to zoom. The color scale is the endpoint density on the fsaverage surface (max across member tracts for a cluster).</p>
        <div class="close-row" style="gap:10px"><button class="btn" @click="helpOpen = false; startTour()">Take the guided tour</button><button class="btn primary" @click="helpOpen = false">Got it</button></div>
      </div>
    </div>

    <!-- ── Intro tour ──────────────────────────────────────── -->
    <div class="tour-overlay" v-if="tourActive">
      <div class="tour-dim" v-if="tourRect" :style="tourDimStyle"></div>
      <div class="tour-popover" :class="{ centered: !tourRect }" :style="tourPopoverStyle">
        <button class="tour-popover-close" @click="skipTour" aria-label="Close tour">×</button>
        <div class="tour-popover-title">{{ currentTourStep.title }}</div>
        <div class="tour-popover-body">{{ currentTourStep.body }}</div>
        <div class="tour-popover-footer">
          <span class="tour-step-count">{{ tourIndex + 1 }} / {{ tourSteps.length }}</span>
          <div class="tour-popover-actions">
            <button class="tour-btn tour-btn-ghost" @click="prevTourStep" v-if="tourIndex > 0">Back</button>
            <button class="tour-btn tour-btn-primary" @click="nextTourStep">{{ tourIndex === tourSteps.length - 1 ? 'Done' : 'Next' }}</button>
        </div>
      </div>
    </div>

  </div>
  `,

  data() {
    return {
      tab: 'cluster',
      loading: true,
      selectedThreshold: this.config.defaultThreshold || Object.keys(this.config.thresholds)[0],
      selectedCluster: null,
      selectedTract: null,
      tractSearch: '',
      numClusters: 0,
      clusters: [],             // [{ id, color, tracts }]
      tractOrder: [],           // row order from CSV
      topics: [],               // column names (raw)
      matrix: {},               // { tractName: { topicName: value } }
      clusterAssignments: {},   // { tractName: clusterIndex }
      membershipKnown: false,   // true once clusters have been computed for this threshold
      clustering: null,         // live HCA result from cluster.js (Z, leaves, assignments, …)
      topicTerms: null,         // { "<topic id>": { class, terms: [[term, weight, class], …] } }
      selectedTopic: null,      // raw topic column name shown in the topic detail panel
      topicFunctionalOnly: true,    // on by default: matches the notebook/gradec figures (functional terms)
      clusterMatrix: {},
      matrixRAS: {},            // { tract: { topic: r } } — RAS endpoint decoded on its own (matrix_RAS.csv)
      matrixLPI: {},            // same for the LPI endpoint (matrix_LPI.csv)        // { clusterId: { topicName: value } } — from cluster-matrix.csv, optional
      vmin: -0.5,
      vmax: 0.5,
      tooltip: { visible: false, x: 0, y: 0, tract: '', topic: '', value: null },
      // Brain workspace state. mode: 'both' | 'RAS' | 'LPI' | 'bytract'; status: 'idle' | 'loading' | 'ready' | 'empty' | 'nomembers' | 'nowebgl'
      brain: { mode: 'both', hemi: 'both', view: 'dorsal', status: 'idle', max: 0, atlas: false, overlay: true, atlasOpacity: 0.8 },
      brainTints: [],            // [{ tract, color }] legend for "by tract" mode
      hoverTract: null,
      // Network atlas painted on the cortex (assets/atlases/<code>.json, from scripts/export_network_atlases.py)
      atlasInfo: null,           // { code, title, names, colors } of the atlas currently painted
      hoverNetwork: null,        // network name under the pointer (legend / Networks rows)
      focusNetwork: null,        // network isolated on the brain (click)
      // Network Correspondence Toolbox (Kong et al. 2025) results, from
      // network-correspondence.csv: { "tract|leftArc": { TY7: [{name,dice,p_value}], TY17: [...] } }
      networkCorrespondence: {},
      networkAtlases: [],        // atlas codes present in this threshold's CSV, e.g. ['TY7','TY17']
      networkAtlas: null,        // currently selected atlas code
      // ── UI state for the guided workflow ──
      sideMode: 'clusters',
      sidebarOpen: false,        // mobile drawer
      helpOpen: false,           // "How to use" dialog
      hoverTopic: null,          // topic under the pointer in a bar / radar / word cloud (links the three)
      subTab: 'map',             // 'map' | 'topics' | 'charts' | 'networks'
      topicsMode: 'chart',       // Topics panel: 'chart' (profile beeswarm) | 'list' (ranked bars)
      // Guided tour: spotlight + card over the live page (see tourSteps / startTour)
      tour: { active: false, step: 0, rect: null, place: 'below', cardStyle: {} },
      dendroOpen: true,          // dendrogram shown in the sidebar
      openClusters: {},          // { clusterId: true } — expanded rows in the sidebar tree
      guideDismissed: readPref('wmc.guideDismissed') === '1',

      // Intro tour (guided walkthrough) — see startTour()/buildTourSteps().
      tourActive: false,
      tourSteps: [],
      tourIndex: 0,
      tourRect: null,            // target element's viewport rect for the current step, or null (centered step)
      tourPopoverPos: { top: 0, left: 0 }
    };
  },

  computed: {
    // Threshold config value may be a string (legacy) or an object
    thresholdCfg()    {
      const v = this.config.thresholds[this.selectedThreshold];
      return typeof v === 'string' ? { folder: v } : v;
    },
    thresholdFolder() { return this.thresholdCfg.folder; },
    baseUrl()         { return `${this.config.dataBase}/${this.thresholdFolder}`; },
    clusterColors()   { return CLUSTER_COLORS; },
    // Whether this threshold has cluster-level images / clustering data
    clustersEnabled() { return !this.thresholdCfg.noClusters; },
    // Per-tract func.gii endpoint map support (3D surface panel)
    surfBase()        { return this.thresholdCfg.surfBase || null; },
    surfMeshBase()    { return this.config.surfMeshBase || null; },

    // Decoding row behind the cluster radar/word cloud (cluster-matrix.csv).
    clusterScores() {
      return (this.selectedCluster && this.clusterMatrix[this.selectedCluster]) || null;
    },
    // Network Correspondence Toolbox rows for the current selection + atlas.
    // Sorted by Dice descending, with a bar width (% of the row's own max)
    // and a `sig` flag (spin-test p < 0.05) baked in for the template.
    tractNetworkRows()   { return this.sortedNetworkRows(this.networkRowsFor('tract', this.selectedTract)); },
    clusterNetworkRows() { return this.sortedNetworkRows(this.networkRowsFor('cluster', this.selectedCluster)); },
    // Charts for a tract use the colour of the cluster it belongs to.
    tractChartColor() {
      const c = this.clusterAssignments[this.selectedTract];
      return c ? CLUSTER_COLORS[(c - 1) % CLUSTER_COLORS.length] : '#4f8ef7';
    },
    // Joint / RAS-only / LPI-only decoding rows for the selected tract.
    endpointSources() {
      const t = this.selectedTract;
      const top = row => !row ? [] : Object.entries(row)
        .filter(([, v]) => v !== null && !isNaN(v))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 10)
        .map(([topic, value]) => ({ topic, value }));
      return [
        { key: 'joint', label: 'LPI + RAS (joint)', row: this.matrix[t] },
        { key: 'RAS',   label: 'RAS only',          row: this.matrixRAS[t] },
        { key: 'LPI',   label: 'LPI only',          row: this.matrixLPI[t] }
      ].map(src => {
        const items = top(src.row);
        return Object.assign(src, { top: items, has: items.length > 0 });
      });
    },
    // One bar scale shared by the three columns so they're directly comparable.
    sideBarMax() {
      let m = 0;
      this.endpointSources.forEach(s => s.top.forEach(x => { m = Math.max(m, Math.abs(x.value)); }));
      return m || 1;
    },
    // { topicName: [[term, weight], …] } of functional terms only, for the
    // radar/word cloud when "Functional terms only" is on; null = default charts.
    chartTermSets() {
      if (!this.topicFunctionalOnly || !this.topicTerms) return null;
      const out = {};
      this.topics.forEach(topic => {
        const entry = this.topicTerms[this.topicId(topic)];
        if (entry) out[topic] = entry.terms.filter(t => t[2] === 'Functional').map(t => [t[0], t[1]]);
      });
      return Object.freeze(out);
    },
    selectedTopicTerms() {
      if (!this.selectedTopic || !this.topicTerms) return null;
      const entry = this.topicTerms[this.topicId(this.selectedTopic)];
      if (!entry) return null;
      return this.topicFunctionalOnly ? entry.terms.filter(t => t[2] === 'Functional') : entry.terms;
    },
    // Score of the open topic for whatever is being viewed (tract or cluster).
    selectedTopicScore() {
      if (!this.selectedTopic) return null;
      const row = this.tab === 'cluster' ? this.clusterMatrix[this.selectedCluster] : this.matrix[this.selectedTract];
      const v = row ? row[this.selectedTopic] : null;
      return v === null || v === undefined || isNaN(v) ? null : v;
    },
    topicSubjectLabel() {
      return this.tab === 'cluster' ? `cluster ${this.selectedCluster}` : this.selectedTract;
    },
    clusterLegendCss() {
      return rampGradientCss(clusterRamp(this.activeCluster ? this.activeCluster.color : null));
    },
    glowLegendCss() {
      const hex = this.tab === 'cluster' && this.activeCluster ? this.activeCluster.color : '#ffb454';
      return 'linear-gradient(to right, ' + hex + ', #ffffff)';
    },
    brainLegendCss() {
      return this.tab === 'cluster' ? this.clusterLegendCss : 'linear-gradient(to right, #000, #c00, #fc0, #fff)';
    },
    // Camera presets; the two medial views hide the other hemisphere.
    brainViews() {
      return [
        { id: 'dorsal',        label: 'Top',           cam: 'dorsal',        hemi: 'both' },
        { id: 'ventral',       label: 'Bottom',        cam: 'ventral',       hemi: 'both' },
        { id: 'anterior',      label: 'Front',         cam: 'anterior',      hemi: 'both' },
        { id: 'posterior',     label: 'Back',          cam: 'posterior',     hemi: 'both' },
        { id: 'lateral-left',  label: 'Left, lateral', cam: 'lateral-left',  hemi: 'both' },
        { id: 'lateral-right', label: 'Right, lateral',cam: 'lateral-right', hemi: 'both' },
        { id: 'medial-left',   label: 'Left, medial',  cam: 'lateral-right', hemi: 'lh' },
        { id: 'medial-right',  label: 'Right, medial', cam: 'lateral-left',  hemi: 'rh' }
      ];
    },
    // Tracts whose endpoint maps the 3D panel should show right now.
    surfTracts() {
      if (this.tab === 'tract') return this.selectedTract ? [this.selectedTract] : [];
      if (this.tab === 'cluster' && this.activeCluster) return this.activeCluster.tracts;
      return [];
    },

    activeCluster() {
      return this.clusters.find(c => c.id === this.selectedCluster) || null;
    },

    filteredTracts() {
      const q = this.tractSearch.trim().toLowerCase();
      if (!q) return this.tractOrder.slice().sort();
      // Match the raw id ("leftArc"), the readable label ("L Arcuate") and
      // the side word ("left"), so "arcuate", "arc" and "left" all work.
      return this.tractOrder.filter(t => {
        const { side } = tractParts(t);
        const hay = `${t} ${tractLabel(t)} ${side || ''}`.toLowerCase();
        return q.split(/\s+/).every(w => hay.includes(w));
      }).sort();
    },

    // Sidebar tree: one group per cluster (in cluster order) holding its
    // tracts, plus a "Not clustered" group for tracts without decoding
    // scores at this threshold. While searching, every match is listed flat.
    sidebarGroups() {
      if (this.tractSearch.trim()) {
        return this.filteredTracts.length ? [{ id: 'all', label: 'Matches', color: null, tracts: this.filteredTracts }] : [];
      }
      if (!this.clustersEnabled || !this.clusters.length) {
        return [{ id: 'all', label: 'Tracts', color: null, tracts: this.tractOrder.slice().sort() }];
      }
      const groups = this.clusters.map(c => ({ id: c.id, label: `Cluster ${c.id}`, color: c.color, tracts: c.tracts.slice().sort() }));
      const rest = this.tractOrder.filter(t => !this.clusterAssignments[t]).sort();
      if (rest.length) groups.push({ id: 'none', label: 'Not clustered', color: '#555', tracts: rest });
      return groups;
    },

    // Guided tour. Each step names a [data-tour] anchor and may prepare the
    // page (switch tab / sub-tab, open a topic) before the spotlight lands.
    tourSteps() {
      const firstTopic = () => {
        const list = this.tab === 'cluster' ? this.clusterTopTopics : (this.endpointSources[0] ? this.endpointSources[0].top : []);
        return list.length ? list[0].topic : null;
      };
      return [
        { target: 'tour-btn', title: 'Welcome to the explorer',
          body: 'This two-minute tour walks through every control and panel. You can restart it any time from this <b>Tour</b> button, or press <b>Esc</b> to leave.' },
        { target: 'threshold', title: 'Endpoint threshold',
          body: 'Tract endpoints are defined by an endpoint-density cutoff. Each threshold has its own decoding and its own clustering solution; the label shows how many clusters it yields. The paper\'s default is 0.15.' },
        { target: 'stepper', title: 'Your path: Cluster › Tract › Topic',
          body: 'The explorer is a drill-down in three steps, and this bar always shows where you are. Click a step to go back to it. <b>Full matrix</b> on the right is the alternative: browse every tract and topic at once.' },
        { target: 'sidebar', title: 'The cluster tree', prep: () => { this.sidebarOpen = true; },
          body: 'Every tract as a leaf of the dendrogram, grouped by how similar their decoding profiles are. Click a coloured branch to view that cluster, a tract name to open it, the numbered chips to jump between clusters, or search by name (Enter opens the first match).' },
        { target: 'selection', title: 'What is selected', prep: () => { this.sidebarOpen = false; if (this.tab === 'matrix') this.showClusterView(); },
          body: 'The header names the selected cluster or tract, how it was defined, and its members. The tags are shortcuts: click a tract to go to step 2, or jump back to its cluster.' },
        { target: 'subtabs', title: 'One panel at a time',
          body: 'The brain stays on the left; everything else is stacked on the right. This bar jumps to a section and shows where you are: the <b>overview</b> (top topics, best networks), all <b>topics</b> decoded from the map, the <b>radar & word cloud</b> figures from the paper, and <b>network</b> overlap.' },
        { target: 'map', title: 'Cortical endpoint map', prep: () => { this.goToSection('map'); },
          body: 'Where the tract\'s streamlines end on the cortex, as endpoint density on the fsaverage surface. For a cluster it is the union of its members\' maps. <b>Show</b> picks what is drawn (combined endpoints, one endpoint, a cluster coloured by tract) and <b>View</b> jumps to a camera angle; the Networks section can paint its atlas underneath. <b>Drag</b> to rotate, <b>scroll</b> to zoom.' },
        { target: 'glance', title: 'At a glance',
          body: 'Beside the map: the five strongest cognitive topics and the three best-matching brain networks for this selection, and a plain-language note on what the selection is. Click a topic here to open it directly.' },
        { target: 'topics', title: 'Decoded cognitive topics', prep: () => { this.goToSection('topics'); },
          body: 'All 104 NeuroQuery topics at once: each dot is one topic, placed by its correlation (Pearson r) with the endpoint map. Orange is positive, blue negative, and the strongest are labelled. In the tract view the joint map and the two endpoints are lanes on one shared axis.' },
        { target: 'topic-panel', title: 'Step 3: inside a topic', prep: () => { const t = firstTopic(); if (t) this.selectedTopic = t; this.goToSection('topics'); },
          body: 'Clicking a topic opens its full 40-term list with LDA weights and term type: <b>F</b>unctional, <b>A</b>natomical, <b>C</b>linical, <b>N</b>on-specific. The <b>Functional terms only</b> switch matches the paper\'s figures.' },
        { target: 'charts', title: 'Radar chart & word cloud', prep: () => { this.goToSection('charts'); },
          body: 'The paper\'s figures, drawn live. Brighter means a stronger topic. Hover a bar or a word to see what it belongs to; click one to open that topic.' },
        { target: 'networks', title: 'Network correspondence', prep: () => { this.goToSection('networks'); },
          body: 'Dice overlap between the endpoint map and each network of a reference atlas (Yeo, Gordon, Schaefer, Glasser, Shen). Bold / starred networks survive a spin test (p < 0.05). <b>Show networks on the brain</b> paints the atlas on the cortex with the endpoint map on top; hover a row to find that network, click to isolate it.' },
        { target: 'matrix-btn', title: 'Or browse everything', prep: () => { this.goToSection('map'); },
          body: 'The <b>full matrix</b> shows all tracts against all topics as one heatmap, ordered like the dendrogram. Click any row to open that tract. That\'s the tour: the <b>?</b> button has a written version.' }
      ];
    },

    // Sub-tabs under the selection header; one panel at a time.
    subTabs() {
      const hasSurf = !!(this.surfBase && this.surfMeshBase);
      const hasScores = this.tab === 'cluster' ? !!this.clusterMatrix[this.selectedCluster] : !!this.matrix[this.selectedTract];
      return [
        { id: 'map',      label: 'Overview',           hint: 'Top topics, best networks, what this is',      available: true },
        { id: 'topics',   label: 'Topics',             hint: 'Cognitive topics decoded from the map',        available: hasScores },
        { id: 'charts',   label: 'Radar & word cloud', hint: "The paper's figures (Figs. 3–4), live",        available: hasScores },
        { id: 'networks', label: 'Networks',           hint: 'Overlap with canonical brain networks',        available: this.networkAtlases.length > 0 }
      ];
    },
    // Readable label for every tract (for the dendrogram leaves).
    tractLabels() {
      const out = {};
      this.tractOrder.forEach(t => { out[t] = tractLabel(t); });
      return out;
    },
    matchCount() { return this.filteredTracts.length; },

    // Lanes for the topic profile chart: one row per decoding.
    profileLanes() {
      if (this.tab === 'cluster') {
        return [{ key: 'cluster', label: 'Cluster ' + this.selectedCluster + ' · combined map', row: this.clusterMatrix[this.selectedCluster] || null }];
      }
      return this.endpointSources.map(src => ({ key: src.key, label: src.label, row: src.row || null }));
    },
    // "At a glance" strip
    glanceTopics() {
      const src = this.tab === 'cluster' ? this.clusterTopTopics : (this.endpointSources[0] ? this.endpointSources[0].top : []);
      return src.slice(0, 5);
    },
    glanceMax() { return Math.max(1e-6, ...this.glanceTopics.map(x => Math.abs(x.value))); },
    glanceNetworks() { return (this.tab === 'cluster' ? this.clusterNetworkRows : this.tractNetworkRows).slice(0, 3); },
    glanceColor() { return this.tab === 'cluster' ? (this.activeCluster ? this.activeCluster.color : '#3fd2ff') : this.tractChartColor; },

    // Other tracts in the selected tract's cluster (for the "see also" tags).
    siblingTracts() {
      const cid = this.clusterAssignments[this.selectedTract];
      if (!cid) return [];
      const c = this.clusters.find(x => x.id === cid);
      return c ? c.tracts.filter(t => t !== this.selectedTract) : [];
    },

    // Full Matrix row order: same order the dendrogram's leaves are drawn in
    // (so visually/functionally similar tracts sit next to each other),
    // with tracts the dendrogram excluded (missing decoding scores) appended
    // at the end in their original CSV order.
    matrixTractOrder() {
      if (!this.clustering) return this.tractOrder;
      const ordered = this.clustering.leaves.map(i => this.clustering.tracts[i]);
      const rest = this.tractOrder.filter(t => !ordered.includes(t));
      return ordered.concat(rest);
    },

    tractTopTopics() {
      if (!this.selectedTract || !this.matrix[this.selectedTract]) return [];
      const row = this.matrix[this.selectedTract];
      return Object.entries(row)
        .filter(([, v]) => v !== null && !isNaN(v))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 15)
        .map(([topic, value]) => ({ topic, value }));
    },

    // Same shape as tractTopTopics, but for the selected cluster's own
    // decoding row (from cluster-matrix.csv — an independent re-decode of
    // the cluster's combined endpoint map, not an average of its tracts).
    clusterTopTopics() {
      if (!this.selectedCluster || !this.clusterMatrix[this.selectedCluster]) return [];
      const row = this.clusterMatrix[this.selectedCluster];
      return Object.entries(row)
        .filter(([, v]) => v !== null && !isNaN(v))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 15)
        .map(([topic, value]) => ({ topic, value }));
    },

    // ── Intro tour ──────────────────────────────────────────────────
    currentTourStep() { return this.tourSteps[this.tourIndex] || {}; },
    // Spotlight cutout: a box-shadow with a huge spread dims the whole page
    // except this element's own box, which lands exactly on the target.
    tourDimStyle() {
      const r = this.tourRect;
      return {
        top: r.top + 'px', left: r.left + 'px',
        width: r.width + 'px', height: r.height + 'px'
      };
    },
    tourPopoverStyle() {
      if (!this.tourRect) return {};
      return { top: this.tourPopoverPos.top + 'px', left: this.tourPopoverPos.left + 'px' };
    }
  },

  mounted() {
    // Deep link from the landing page's "Cluster View" / "Tract View" /
    // "Full Matrix" cards (explorer.html#cluster|tract|matrix).
    const hashTab = (location.hash || '').replace('#', '');
    if (hashTab === 'tract') { this.tab = 'tract'; }
    if (hashTab === 'tract') { this.tab = 'tract'; this.sideMode = 'tracts'; }
    else if (hashTab === 'matrix') { this.tab = 'matrix'; }
    else if (hashTab === 'cluster') { this.tab = 'cluster'; }

    if (!this.clustersEnabled) {
      this.tab = 'tract';
    }
    this.loadData();
    this.loadTopicTerms();
  },

  beforeDestroy() {
    this.disposeSurfScenes();
    if (this._tourKey) { window.removeEventListener('keydown', this._tourKey); window.removeEventListener('resize', this._tourResize); }
  },

  updated() { if (!this._secObsQueued) { this._secObsQueued = true; this.$nextTick(() => { this._secObsQueued = false; this.observeSections(); }); } },
  watch: {
    networkAtlas() { if (this.brain.atlas) { this.focusNetwork = null; this.queueSurfRefresh(); } },
    hoverNetwork(v) {
      if (!this.brain.atlas) return;
      clearTimeout(this._hoverNetTimer);
      // Hover previews the network by temporarily focusing it; a click pins it.
      this._hoverNetTimer = setTimeout(() => { this._hoverFocus = v; this.queueSurfRefresh(); }, 80);
    },
    // Any change to what's being viewed refreshes the 3D endpoint map.
    // queueSurfRefresh() dedups watchers that fire in the same tick
    // (e.g. selectTract() sets selectedTract and tab together).
    selectedTract(newVal) {
      if (this.tab !== 'tract') return;
      if (!newVal) { this.disposeSurfScenes(); return; }
      this.queueSurfRefresh();
    },
    selectedCluster(newVal) {
      if (this.tab === 'cluster' && newVal) this.queueSurfRefresh();
    },
    // Cluster membership is rebuilt whenever matrix.csv (re)loads, possibly
    // after a cluster is already selected — redraw once it lands.
    clusters() {
      if (this.tab === 'cluster' && this.selectedCluster) this.queueSurfRefresh();
    },
    tab(newTab) {
      if ((newTab === 'tract' && this.selectedTract) || (newTab === 'cluster' && this.selectedCluster)) {
        this.queueSurfRefresh();
      } else {
        this.disposeSurfScenes();
      }
    },
  },

  methods: {
    // ── Intro tour ────────────────────────────────────────────────
    // Each step: { target?: '<data-tour value>', title, body, before?: fn }.
    // `target` omitted ⇒ a centered step (welcome/closing). `before` runs
    // right before the step is shown, to switch tab/sideMode/selection so
    // the target element actually exists in the DOM.
    buildTourSteps() {
      const steps = [];
      steps.push({
        title: 'Welcome to the WMC Tract Endpoint Decoding Viewer',
        body: 'A quick tour of how to explore the data — about a minute. Click Next to begin, or × to skip.'
      });
      steps.push({
        target: 'threshold',
        title: 'Pick a threshold',
        body: "Each threshold re-clusters the 51 tracts into a different number of functional groups, with its own decoding. Start here."
      });
      steps.push({
        target: 'stepper',
        title: 'Choose a view',
        body: 'Explore a cluster, focus on one tract, or browse every tract × topic score in the full matrix.'
      });
      if (this.clustersEnabled) {
        steps.push({
          target: 'sidebar-tabs',
          before: () => { this.showClusterView(); },
          title: 'Browse by cluster or tract',
          body: 'Switch the sidebar between browsing clusters or searching for a specific tract.'
        });
        steps.push({
          target: 'dendrogram',
          before: () => { this.sideMode = 'clusters'; this.tab = 'cluster'; },
          title: 'The dendrogram',
          body: 'Shows how tracts group together by functional similarity. Click a branch to open a cluster, or a leaf to jump straight to one tract.'
        });
        steps.push({
          target: 'cluster-list',
          before: () => { this.sideMode = 'clusters'; this.tab = 'cluster'; },
          title: 'Or pick a cluster directly',
          body: 'Each cluster lists its member tract count — click one to see its combined profile.'
        });
        steps.push({
          target: 'surf-map',
          before: () => {
            this.sideMode = 'clusters'; this.tab = 'cluster';
            if (!this.selectedCluster && this.clusters.length) this.selectCluster(this.clusters[0].id);
          },
          title: 'Live 3D endpoint map',
          body: 'Once a cluster (or tract) is selected, its cortical endpoint map renders live in 3D — drag to rotate, scroll to zoom.'
        });
        steps.push({
          target: 'topics',
          before: () => { this.sideMode = 'clusters'; this.tab = 'cluster'; },
          title: 'Top Cognitive Topics',
          body: 'The strongest NeuroQuery topics for this selection — red bars are positive associations, blue are negative. Click a bar for the full term list.'
        });
        steps.push({
          target: 'network-corr',
          before: () => { this.sideMode = 'clusters'; this.tab = 'cluster'; },
          title: 'Network Correspondence',
          body: 'Dice overlap with canonical functional brain networks. Use the Atlas dropdown to compare against different reference parcellations.'
        });
      }
      steps.push({
        target: 'tract-search',
        before: () => {
          this.showTractView();
          if (!this.selectedTract && this.tractOrder.length) this.selectTract(this.tractOrder[0]);
        },
        title: this.clustersEnabled ? 'Or explore one tract at a time' : 'Search for a tract',
        body: "Tract View breaks a single tract's endpoints into RAS and LPI orientations, decoded separately."
      });
      if (!this.clustersEnabled) {
        steps.push({ target: 'surf-map', title: 'Live 3D endpoint map', body: 'Drag to rotate, scroll to zoom.' });
        steps.push({ target: 'topics', title: 'Top Cognitive Topics', body: 'Click a bar for the full term list.' });
        steps.push({ target: 'network-corr', title: 'Network Correspondence', body: 'Dice overlap with canonical functional brain networks, via the Atlas dropdown.' });
      }
      steps.push({
        target: 'matrix-table',
        before: () => { this.tab = 'matrix'; },
        title: 'Full Matrix',
        body: 'Every tract × topic decoding score at once — hover a cell for the exact value, or click a row to open that tract.'
      });
      steps.push({
        title: "That's it!",
        body: 'Click the "? Help" button in the header any time to replay this tour.'
      });
      return steps;
    },

    startTour() {
      this.tourSteps = this.buildTourSteps();
      this.goToTourStep(0, 1);
    },

    skipTour() {
      this.tourActive = false;
      try { localStorage.setItem('wmc_tour_seen', '1'); } catch (e) { /* storage unavailable */ }
    },

    prevTourStep() { this.goToTourStep(this.tourIndex - 1, -1); },
    nextTourStep() { this.goToTourStep(this.tourIndex + 1, 1); },

    // dir says which way to keep skipping if a step's target element isn't
    // in the DOM for the current config (e.g. no-cluster thresholds).
    goToTourStep(i, dir) {
      if (i < 0 || i >= this.tourSteps.length) { this.skipTour(); return; }
      const step = this.tourSteps[i];
      this.tourIndex = i;
      this.tourActive = true;
      if (step.before) step.before();
      this.$nextTick(() => {
        setTimeout(() => {
          if (!this.positionTour(step)) this.goToTourStep(i + dir, dir);
        }, step.target ? 260 : 0);
      });
    },

    // Measures the step's target element and stores its viewport rect (for
    // the spotlight) plus a clamped popover position next to it. Returns
    // false if the target isn't present/visible, so the caller can skip it.
    positionTour(step) {
      if (!step.target) { this.tourRect = null; return true; }
      const el = this.$el.querySelector('[data-tour="' + step.target + '"]');
      if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const pad = 6;
      this.tourRect = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
      const popW = 320, popH = 170, margin = 14;
      let top = this.tourRect.top + this.tourRect.height + margin;
      if (top + popH > window.innerHeight) top = this.tourRect.top - popH - margin;
      if (top < margin) top = margin;
      let left = this.tourRect.left;
      if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
      if (left < margin) left = margin;
      this.tourPopoverPos = { top, left };
      return true;
    },

    onThresholdChange() {
      // The loading panel below unmounts the Tract View's canvases, so release
      // the old WebGL scenes now; refreshTractSurfaces() recreates them on the
      // new canvases once the threshold's data has loaded.
      this.disposeSurfScenes();
      this.loading = true;
      this.selectedCluster = null;
      // selectedTract is intentionally left alone here — if the user was
      // viewing a tract, loadData()'s complete callback below keeps that
      // same tract selected under the new threshold instead of reverting
      // to the cluster view. Cluster selection always resets, since cluster
      // IDs/membership aren't comparable across different thresholds' own
      // clustering solutions.
      // If new threshold has no clustering, switch to tract mode/view
      if (!this.clustersEnabled) {
        this.tab = 'tract';
      }
      this.loadData();
    },

    loadData() {
      const url = `${this.baseUrl}/matrix.csv`;
      Papa.parse(url, {
        download: true,
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (results) => {
          this.parseMatrix(results);
          this.loading = false;
          this.loadClusterMatrix();
          this.loadNetworkCorrespondence();
          this.loadSideMatrices();

          // A tract the user had selected might not exist under this
          // threshold's data (shouldn't normally happen — all thresholds
          // share the same 51 tracts — but fall back safely if it does).
          if (this.selectedTract && !this.tractOrder.includes(this.selectedTract)) {
            this.selectedTract = null;
          }

          if (this.tab === 'tract') {
            // Stay on Tract View across the threshold switch. If a tract is
            // already selected, just refresh the live 3D panel for the new
            // threshold's own data; otherwise leave its normal "select a
            // tract" empty state showing instead of jumping to Cluster View.
            if (this.selectedTract) { this.revealTract(this.selectedTract); this.queueSurfRefresh(); }
            else this.showTractView();
          } else if (this.tab === 'matrix') {
            // Stay on Full Matrix too — it re-renders from the new matrix.csv
            // on its own, nothing to (re)select here.
          } else if (this.clustersEnabled && this.clusters.length > 0) {
            this.selectCluster(this.clusters[0].id);
          }

        },
        error: (err) => {
          console.error('Failed to load matrix CSV:', err);
          this.loading = false;
        }
      });
    },

    parseMatrix(results) {
      const rows = results.data;
      if (!rows.length) return;

      const allCols = results.meta.fields;
      const tractCol = allCols[0];
      const topicCols = allCols.slice(1);

      this.topics = topicCols;
      this.tractOrder = [];
      this.matrix = {};
      let allValues = [];

      rows.forEach(row => {
        const tractName = row[tractCol];
        if (!tractName) return;
        this.tractOrder.push(tractName);
        this.matrix[tractName] = {};
        topicCols.forEach(t => {
          const raw = row[t];
          const v = (raw === 'NaN' || raw === '' || raw === undefined) ? null : parseFloat(raw);
          this.matrix[tractName][t] = v;
          if (v !== null && !isNaN(v)) allValues.push(v);
        });
      });

      allValues.sort((a, b) => a - b);
      const lo = Math.floor(allValues.length * 0.05);
      const hi = Math.ceil(allValues.length * 0.95);
      this.vmin = allValues[lo] ?? -0.5;
      this.vmax = allValues[hi] ?? 0.5;

      this.buildClusters();
    },

    // Clusters are computed live from matrix.csv (see cluster.js) with the
    // notebook's method: complete linkage on 1 − Pearson r, cut at
    // thresholdCfg.cut (default 1.0). Numbering matches scipy's fcluster,
    // i.e. the cluster ids used in cluster-matrix.csv and the N_surf.png figures.
    buildClusters() {
      const cut = this.thresholdCfg.cut ?? 1.0;
      const res = computeClustering(this.matrix, this.tractOrder, this.topics, cut);
      this.clustering = res ? Object.freeze(res) : null;   // frozen: no deep reactivity needed
      if (!res) {
        this.numClusters = 0; this.membershipKnown = false; this.clusters = [];
        this.rebuildAssignments();
        return;
      }
      const byCluster = {};
      res.tracts.forEach(t => { (byCluster[res.assignments[t]] = byCluster[res.assignments[t]] || []).push(t); });
      this.numClusters = res.numClusters;
      this.membershipKnown = true;
      this.clusters = Object.keys(byCluster).map(Number).sort((a, b) => a - b).map(id => ({
        id,
        color: CLUSTER_COLORS[(id - 1) % CLUSTER_COLORS.length],
        tracts: byCluster[id]
      }));
      this.rebuildAssignments();
      this.afterClustersBuilt();
    },

    // On first load the cluster list isn't ready when loadData() finishes,
    // so pick the first cluster here if the Cluster View is showing nothing.
    afterClustersBuilt() {
      if (this.tab === 'cluster' && this.clusters.length &&
          !this.clusters.some(c => c.id === this.selectedCluster)) {
        this.selectCluster(this.clusters[0].id);
      }
    },

    rebuildAssignments() {
      this.clusterAssignments = {};
      this.clusters.forEach(c => {
        c.tracts.forEach(t => { this.clusterAssignments[t] = c.id; });
      });
    },

    selectCluster(id) {
      this.selectedCluster = id;
      this.tab = 'cluster';
      this.selectedTopic = null;
      this.$set(this.openClusters, id, true);
      this.sidebarOpen = false;
    },

    selectTract(name) {
      this.selectedTract = name;
      this.tab = 'tract';
    },

    // Step 2 tab: never land on an empty state — if no tract is selected yet,
    // open the first tract of the current cluster (or the first tract overall).
    showTractView() {
      if (!this.selectedTract) {
        const c = this.activeCluster;
        const first = (c && c.tracts.length) ? c.tracts.slice().sort()[0] : this.tractOrder.slice().sort()[0];
        if (first) this.selectedTract = first;
      }
      this.tab = 'tract';
      this.revealTract(this.selectedTract);
    },

    showClusterView() {
      this.tab = 'cluster';
      this.afterClustersBuilt();   // nothing selected yet → show the first cluster
    },

    selectTractAndSwitch(name) {
      this.selectedTract = name;
      this.selectedTopic = null;
      this.tab = 'tract';
      this.revealTract(name);
      this.sidebarOpen = false;
    },

    // Expand the sidebar group that holds this tract, and keep the cluster
    // step in sync so the stepper reads "Cluster N › tract".
    revealTract(name) {
      const cid = this.clusterAssignments[name];
      if (cid) { this.selectedCluster = cid; this.$set(this.openClusters, cid, true); }
      else if (name) this.$set(this.openClusters, 'none', true);
    },

    jumpToCluster(id) {
      this.selectedCluster = id;
      this.tab = 'cluster';
      this.$set(this.openClusters, id, true);
    },

    // Sidebar tree helpers
    isOpen(id) { return !!this.openClusters[id]; },
    toggleOpen(id) { this.$set(this.openClusters, id, !this.openClusters[id]); },
    onClusterRowClick(id) {
      if (id === 'none') { this.toggleOpen(id); return; }
      this.selectCluster(id);
    },
    scrollToTopic() {
      if (this.tab === 'matrix') this.tab = this.selectedTract ? 'tract' : 'cluster';
      this.$nextTick(() => {
        const el = this.$el.querySelector('#sec-topics');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    // Section nav: scroll the right-hand column to a section; the active
    // entry follows the scroll position (see observeSections).
    goToSection(id) {
      this.subTab = id;
      this.$nextTick(() => {
        const el = this.$el.querySelector('#sec-' + id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    observeSections() {
      if (this._secObs) this._secObs.disconnect();
      const root = this.$el.querySelector('.tab-panel');
      const secs = this.$el.querySelectorAll('section.subpanel[data-section]');
      if (!root || !secs.length || typeof IntersectionObserver === 'undefined') return;
      this._secObs = new IntersectionObserver(entries => {
        const vis = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (vis.length) this.subTab = vis[0].target.dataset.section;
      }, { root, threshold: [0.25, 0.5, 0.75] });
      secs.forEach(el => this._secObs.observe(el));
    },
    openFirstMatch() {
      if (this.filteredTracts.length) { this.selectTractAndSwitch(this.filteredTracts[0]); this.tractSearch = ''; }
    },
    dismissGuide() { this.guideDismissed = true; writePref('wmc.guideDismissed', '1'); },

    // ── Guided tour ──────────────────────────────────────────
    startTour() {
      this.helpOpen = false;
      if (this.tab === 'matrix') this.showClusterView();
      this.tourSteps = this.buildTourSteps();
      this.tour.step = 0;
      this.tour.active = true;
      this.tourShow();
      if (!this._tourKey) {
        this._tourKey = e => {
          if (!this.tour.active) return;
          if (e.key === 'Escape') this.endTour();
          else if (e.key === 'ArrowRight' || e.key === 'Enter') this.tourGo(1);
          else if (e.key === 'ArrowLeft') this.tourGo(-1);
        };
        this._tourResize = () => { if (this.tour.active) this.tourPlace(); };
        window.addEventListener('keydown', this._tourKey);
        window.addEventListener('resize', this._tourResize);
      }
    },
    endTour() {
      this.tour.active = false;
      this.tour.rect = null;
      this.sidebarOpen = false;
      writePref('wmc.tourDone', '1');
    },
    tourGo(dir) {
      const next = this.tour.step + dir;
      if (next < 0) return;
      if (next >= this.tourSteps.length) { this.endTour(); return; }
      this.tour.step = next;
      this.tourShow();
    },
    // Prepare the page for the current step, wait for Vue to render it, then
    // scroll the anchor into view and place the spotlight + card around it.
    tourShow() {
      const step = this.tourSteps[this.tour.step];
      if (step.before) step.before();
      this.tour.rect = null;
      this.$nextTick(() => {
        const el = this.$el.querySelector('[data-tour="' + step.target + '"]');
        if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        setTimeout(() => this.tourPlace(), 60);
      });
    },
    tourPlace() {
      const step = this.tourSteps[this.tour.step];
      const el = this.$el.querySelector('[data-tour="' + step.target + '"]');
      const vw = window.innerWidth, vh = window.innerHeight;
      if (!el) { this.tour.rect = null; this.tour.place = 'center'; this.tour.cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }; return; }
      const r = el.getBoundingClientRect();
      const rect = { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(r.width, vw - Math.max(0, r.left)), h: Math.min(r.height, vh - Math.max(0, r.top)) };
      this.tour.rect = rect;
      const CW = Math.min(380, vw - 32), CH = 230, GAP = 14;
      let left, top, place;
      if (rect.y + rect.h + GAP + CH < vh) { place = 'below'; top = rect.y + rect.h + GAP; left = rect.x; }
      else if (rect.y - GAP - CH > 0)      { place = 'above'; top = rect.y - GAP - CH; left = rect.x; }
      else if (rect.x + rect.w + GAP + CW < vw) { place = 'right'; top = Math.max(16, Math.min(rect.y, vh - CH - 16)); left = rect.x + rect.w + GAP; }
      else { place = 'left'; top = Math.max(16, Math.min(rect.y, vh - CH - 16)); left = rect.x - GAP - CW; }
      left = Math.max(16, Math.min(left, vw - CW - 16));
      this.tour.place = place;
      this.tour.cardStyle = { left: left + 'px', top: top + 'px', width: CW + 'px' };
    },
    tractLabel(raw) { return tractLabel(raw); },
    tractSide(raw) { return tractSide(raw); },
    atlasLabel(code) { return ATLAS_LABELS[code] || code; },

    cellColor(tract, topic) {
      const v = this.matrix[tract]?.[topic] ?? null;
      return scoreToColor(v, this.vmin, this.vmax);
    },

    tractClusterColor(tract) {
      const cIdx = this.clusterAssignments[tract];
      if (!cIdx) return '#555';
      return CLUSTER_COLORS[(cIdx - 1) % CLUSTER_COLORS.length];
    },

    tractClusterIndex(tract) {
      return this.clusterAssignments[tract] || '–';
    },

    topicLabel(raw) { return topicLabel(raw); },
    topicId(raw) { return String(raw).split('_')[0]; },
    fmtR(v) { return v === null || v === undefined || isNaN(v) ? '—' : v.toFixed(3); },
    sideBarWidth(v) { return (Math.abs(v) / this.sideBarMax) * 96; },
    // matrix_RAS.csv / matrix_LPI.csv: each endpoint decoded on its own
    // (same layout as matrix.csv). Missing file → that column says "no data".
    loadSideMatrices() {
      ['RAS', 'LPI'].forEach(side => {
        const key = 'matrix' + side;
        this[key] = {};
        Papa.parse(`${this.baseUrl}/matrix_${side}.csv`, {
          download: true, header: true, skipEmptyLines: true,
          complete: (results) => {
            const fields = results.meta.fields || [];
            if (!fields.length) return;
            const out = {};
            results.data.forEach(row => {
              const tract = row[fields[0]];
              if (!tract) return;
              out[tract] = {};
              fields.slice(1).forEach(t => {
                const raw = row[t];
                out[tract][t] = (raw === 'NaN' || raw === '' || raw === undefined) ? null : parseFloat(raw);
              });
            });
            this[key] = Object.freeze(out);
          },
          error: () => { /* no per-endpoint file for this threshold */ }
        });
      });
    },
    toggleTopic(topic) { this.selectedTopic = this.selectedTopic === topic ? null : topic; },
    // From a radar bar or word-cloud word: open the topic (step 3) and bring its term list into view.
    openTopic(topic) {
      if (!topic) return;
      this.selectedTopic = topic;
      this.scrollToTopic();
    },
    termClassCss(c) { return 'tc-' + String(c).toLowerCase().replace(/[^a-z]/g, ''); },
    termClassShort(c) { return String(c).charAt(0).toUpperCase(); },
    loadTopicTerms() {
      const url = this.config.topicTermsUrl || 'assets/decoding/topic-terms.json';
      fetch(url)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { this.topicTerms = Object.freeze((d && d.topics) || {}); })
        .catch(() => { this.topicTerms = {}; });
    },

    // Scale bar width: largest |value| = 100%, maintain sign split at 50%
    barWidth(v) {
      const maxAbs = this.tractTopTopics.length
        ? Math.max(...this.tractTopTopics.map(x => Math.abs(x.value)))
        : 1;
      return maxAbs > 0 ? (Math.abs(v) / maxAbs) * 96 : 0;
    },

    showTip(event, tract, topic) {
      const v = this.matrix[tract]?.[topic] ?? null;
      this.tooltip = {
        visible: true,
        x: event.clientX + 14,
        y: event.clientY - 10,
        tract, topic, value: v
      };
    },
    hideTip() { this.tooltip.visible = false; },

    // Optional cluster-matrix.csv alongside matrix.csv — one row per cluster
    // (independent re-decode of that cluster's combined endpoint map), same
    // 104 topic columns as the tract matrix. Missing file just means this
    // threshold hasn't had its cluster decoding exported/copied in yet.
    loadClusterMatrix() {
      this.clusterMatrix = {};
      const url = `${this.baseUrl}/cluster-matrix.csv`;
      Papa.parse(url, {
        download: true,
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length && !results.data.length) return; // no file
          const fields = results.meta.fields || [];
          const clusterCol = fields[0];
          const topicCols = fields.slice(1);
          const byCluster = {};
          results.data.forEach(row => {
            const id = parseInt(row[clusterCol], 10);
            if (!id) return;
            byCluster[id] = {};
            topicCols.forEach(t => {
              const raw = row[t];
              byCluster[id][t] = (raw === 'NaN' || raw === '' || raw === undefined) ? null : parseFloat(raw);
            });
          });
          this.clusterMatrix = byCluster;
        },
        error: () => { /* cluster-matrix.csv not present for this threshold — fine, panel just hides */ }
      });
    },

    // Optional network-correspondence.csv: Dice overlap + spin-test p-value
    // against canonical network atlases (Yeo 7/17, "TY7"/"TY17"), for every
    // tract and cluster — computed offline by
    // scripts/compute_network_correspondence.py using the Network
    // Correspondence Toolbox (Kong et al. 2025, Nature Communications:
    // https://www.nature.com/articles/s41467-025-58176-9). Missing file
    // just means this threshold hasn't had it exported yet.
    loadNetworkCorrespondence() {
      this.networkCorrespondence = {};
      this.networkAtlases = [];
      const url = `${this.baseUrl}/network-correspondence.csv`;
      Papa.parse(url, {
        download: true,
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data.length) return; // no file for this threshold
          const byEntity = {};
          const atlases = new Set();
          results.data.forEach(row => {
            const key = `${row.entity_type}|${row.entity_id}`;
            const atlas = row.group;
            atlases.add(atlas);
            (byEntity[key] = byEntity[key] || {})[atlas] = byEntity[key][atlas] || [];
            byEntity[key][atlas].push({
              name: row.name,
              dice: parseFloat(row.dice),
              p_value: parseFloat(row.p_value)
            });
          });
          this.networkCorrespondence = byEntity;
          this.networkAtlases = Array.from(atlases).sort();
          if (!this.networkAtlases.includes(this.networkAtlas)) {
            this.networkAtlas = this.networkAtlases[0] || null;
          }
        },
        error: () => { /* network-correspondence.csv not present for this threshold — panel just hides */ }
      });
    },

    // Rows for the given atlas for whatever's currently selected (tract or cluster).
    networkRowsFor(entityType, entityId) {
      if (!entityId || !this.networkAtlas) return [];
      const entity = this.networkCorrespondence[`${entityType}|${entityId}`];
      return (entity && entity[this.networkAtlas]) || [];
    },

    // Bar width (% of this row set's own max Dice) + significance flag, same
    // "largest value = full bar" convention as barWidth()/clusterBarWidth().
    sortedNetworkRows(rows) {
      const sorted = rows.slice().sort((a, b) => b.dice - a.dice);
      const max = Math.max(...sorted.map(r => r.dice), 1e-6);
      return sorted.map(r => ({
        ...r,
        widthPct: (r.dice / max) * 96,
        sig: r.p_value <= 0.05
      }));
    },

    // Scale bar width for the cluster topic bars, same convention as barWidth() above.
    clusterBarWidth(v) {
      const maxAbs = this.clusterTopTopics.length
        ? Math.max(...this.clusterTopTopics.map(x => Math.abs(x.value)))
        : 1;
      return maxAbs > 0 ? (Math.abs(v) / maxAbs) * 96 : 0;
    },

    clusterCellColor(clusterId, topic) {
      const v = this.clusterMatrix[clusterId]?.[topic] ?? null;
      return scoreToColor(v, this.vmin, this.vmax);
    },

    showClusterTip(event, clusterId, topic) {
      const v = this.clusterMatrix[clusterId]?.[topic] ?? null;
      this.tooltip = {
        visible: true,
        x: event.clientX + 14,
        y: event.clientY - 10,
        tract: `Cluster ${clusterId}`, topic, value: v
      };
    },

    // ── Brain workspace (one SurfaceScene on the shared canvas) ──────
    ensureSurfScenes() {
      if (!this.surfMeshBase || this._webglFailed) return;
      try {
        // The canvas is rebuilt by Vue when a view unmounts; rebind if so.
        if (this._surf && this._surf.canvas !== this.$refs.surfCanvas) { this._surf.dispose(); this._surf = null; }
        if (!this._surf && this.$refs.surfCanvas) this._surf = new SurfaceScene(this.$refs.surfCanvas);
      } catch (err) {
        console.error('3D surface view unavailable (WebGL failed to initialize):', err);
        this._webglFailed = true;
        this.brain.status = 'nowebgl';
        this.disposeSurfScenes();
      }
    },

    disposeSurfScenes() {
      this._surfRequestId = (this._surfRequestId || 0) + 1;
      if (this._surf) { this._surf.dispose(); this._surf = null; }
    },

    queueSurfRefresh() {
      if (this._surfRefreshQueued) return;
      this._surfRefreshQueued = true;
      this.$nextTick(() => {
        this._surfRefreshQueued = false;
        this.refreshTractSurfaces();
      });
    },

    // Toolbar actions
    setBrainMode(mode) { this.brain.mode = mode; this.queueSurfRefresh(); },
    setAtlas(on) { this.brain.atlas = !!on; if (!on) { this.focusNetwork = null; if (this.brain.mode === 'none') this.brain.mode = 'both'; } this.queueSurfRefresh(); },
    // Opacity slider: re-colour the mesh at most every ~80 ms while dragging.
    onAtlasOpacity() {
      clearTimeout(this._opacityTimer);
      this._opacityTimer = setTimeout(() => this.queueSurfRefresh(), 80);
    },
    toggleNetwork(name) {
      this.focusNetwork = this.focusNetwork === name ? null : name;
      if (!this.brain.atlas) this.brain.atlas = true;
      this.queueSurfRefresh();
    },
    networkColor(name) {
      if (!this.atlasInfo || this.atlasInfo.code !== this.networkAtlas) return null;
      const i = this.atlasInfo.names.indexOf(name);
      return i >= 0 ? this.atlasInfo.colors[i] : null;
    },
    // assets/atlases/<code>.json, decoded once per atlas and kept.
    loadAtlas(code) {
      this._atlasCache = this._atlasCache || new Map();
      if (!this._atlasCache.has(code)) {
        const url = (this.config.atlasBase || 'assets/atlases') + '/' + code + '.json';
        this._atlasCache.set(code, fetch(url).then(r => (r.ok ? r.json() : null)).then(d => {
          if (!d) return null;
          return { code: d.code, title: d.title, names: d.names, colors: d.colors,
                   colors01: d.colors.map(h => { const v = parseInt(h.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }),
                   lh: decodeRle(d.lh, d.n), rh: decodeRle(d.rh, d.n) };
        }).catch(() => null));
      }
      return this._atlasCache.get(code);
    },
    setBrainView(id) {
      const v = this.brainViews.find(x => x.id === id) || this.brainViews[0];
      this.brain.view = v.id;
      this.brain.hemi = v.hemi;
      if (this._surf) {
        this._surf.setHemiVisible('lh', v.hemi !== 'rh');
        this._surf.setHemiVisible('rh', v.hemi !== 'lh');
        this._surf.setView(v.cam);
      }
    },
    resetBrain() { if (this._surf) { this._surf.resetZoom(); this.setBrainView(this.brain.view); } },

    // Cached GIFTI fetches: toggling map / hemisphere / threshold never
    // re-downloads a file the page already parsed.
    cachedGifti(url) {
      this._giftiCache = this._giftiCache || new Map();
      if (!this._giftiCache.has(url)) this._giftiCache.set(url, fetchGifti(url).catch(() => null));
      return this._giftiCache.get(url);
    },

    refreshTractSurfaces() {
      if (!this.surfBase || !this.surfMeshBase) return;
      if (this.tab === 'tract' && !this.selectedTract) return;
      if (this.tab === 'cluster' && !this.activeCluster) return;
      // Mode sanity: 'bytract' only makes sense for a cluster, RAS/LPI only for a tract.
      if (this.tab === 'cluster' && (this.brain.mode === 'RAS' || this.brain.mode === 'LPI')) this.brain.mode = 'both';
      if (this.tab === 'tract' && this.brain.mode === 'bytract') this.brain.mode = 'both';
      this.ensureSurfScenes();
      if (this._webglFailed) return;
      if (!this.surfTracts.length) { this.brain.status = 'nomembers'; return; }
      const requestId = (this._surfRequestId = (this._surfRequestId || 0) + 1);
      this.loadBrain(requestId);
    },

    // Fetches lh/rh func.gii for every tract in surfTracts (one tract in Tract
    // View, all member tracts in Cluster View) and the orientations the mode
    // asks for, colours the shared fsaverage mesh and drops it into the scene.
    // 'both'/'RAS'/'LPI': per-vertex MAX across the chosen maps (one colour ramp).
    // 'bytract': winner-takes-all across member tracts, each its own tint.
    loadBrain(requestId) {
      const scene = this._surf;
      if (!scene) return;
      const isCluster = this.tab === 'cluster';
      const mode = this.brain.mode;
      const orients = mode === 'RAS' || mode === 'LPI' ? [mode] : ['RAS', 'LPI'];
      if (mode === 'none' && !this.brain.atlas) this.brain.mode = 'both';
      const tracts = this.surfTracts.slice();
      const surfBase = this.surfBase, meshBase = this.surfMeshBase;
      const stops = isCluster ? clusterRamp(this.activeCluster.color) : null;
      let colorFn = stops ? (t => rampRgb01(stops, 0.25 + 0.75 * t)) : null;
      if (this.brain.atlas) {
        // On top of a coloured atlas the usual ramps vanish; use a bright glow
        // from the selection's colour towards white instead.
        const hex = isCluster ? this.activeCluster.color : '#ffb454';
        const v = parseInt(hex.slice(1), 16), c = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
        colorFn = t => { const k = 0.3 + 0.7 * Math.min(1, t); return [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k]; };
      }
      const tintHex = tracts.map((t, i) => TRACT_TINTS[i % TRACT_TINTS.length]);
      const tint01 = tintHex.map(h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; });

      this.brain.status = 'loading';
      this.brainTints = mode === 'bytract' ? tracts.map((tract, i) => ({ tract, color: tintHex[i] })) : [];
      const wantAtlas = this.brain.atlas && this.networkAtlas;
      const atlasP = wantAtlas ? this.loadAtlas(this.networkAtlas) : Promise.resolve(null);
      const showOverlay = this.brain.mode !== 'none';

      Promise.all([atlasP, loadSurfManifest(surfBase)]).then(([atlas, manifest]) => {
        if (requestId !== this._surfRequestId) return [];
        this.atlasInfo = atlas ? { code: atlas.code, title: atlas.title, names: atlas.names, colors: atlas.colors } : null;
        this._atlas = atlas;
        return Promise.all(['lh', 'rh'].map(hemi => {
        const wanted = [];   // [tractIndex, orientation]
        tracts.forEach((t, ti) => orients.forEach(o => {
          if (!manifest || (manifest[t] && manifest[t][hemi] && manifest[t][hemi].includes(o))) wanted.push([ti, o]);
        }));
        if (!wanted.length) return null;
        return Promise.all([
          loadHemiMesh(meshBase, hemi),
          Promise.all(wanted.map(([ti, o]) => this.cachedGifti(`${surfBase}/${hemi}.${tracts[ti]}.${o}.func.gii`)))
        ]).then(([mesh, arrays]) => {
          const perTract = tracts.map(() => null);
          let any = false;
          arrays.forEach((arr, k) => {
            if (!arr || !arr.length) return;
            const d = (arr.find(a => a.dim0 === mesh.nVerts) || arr[0]).values;
            const ti = wanted[k][0];
            if (!perTract[ti]) { perTract[ti] = Float32Array.from(d); }
            else { const ov = perTract[ti]; for (let i = 0; i < ov.length; i++) if (d[i] > ov[i]) ov[i] = d[i]; }
            any = true;
          });
          return any ? { hemi, mesh, perTract } : null;
        });
      })); }).then(results => {
        if (requestId !== this._surfRequestId) return;   // a newer request superseded this one
        const atlas = this._atlas;
        const focusName = this.focusNetwork || this._hoverFocus;
        const focusIdx = atlas && focusName ? atlas.names.indexOf(focusName) + 1 : 0;
        const baseFor = (hemi, mesh) => atlas ? buildAtlasBase(mesh, atlas[hemi], atlas.colors01, focusIdx || null, null, this.brain.atlasOpacity) : null;
        const found = results.filter(Boolean);
        if (!found.length) { scene.clearHemi('lh'); scene.clearHemi('rh'); this.brain.status = 'empty'; return; }
        let max = 0;
        found.forEach(f => f.perTract.forEach(ov => { if (ov) for (let i = 0; i < ov.length; i++) if (ov[i] > max) max = ov[i]; }));
        ['lh', 'rh'].forEach(h => { if (!found.some(f => f.hemi === h)) scene.clearHemi(h); });
        found.forEach(f => {
          const base = baseFor(f.hemi, f.mesh);
          if (!showOverlay) {
            scene.setHemiMesh(f.hemi, buildColoredGeometry(f.mesh, null, 1, colorFn, base));
          } else if (mode === 'bytract') {
            scene.setHemiMesh(f.hemi, buildTintedGeometry(f.mesh, f.perTract, tint01, base));
          } else {
            let overlay = null;
            f.perTract.forEach(ov => {
              if (!ov) return;
              if (!overlay) { overlay = Float32Array.from(ov); return; }
              for (let i = 0; i < overlay.length; i++) if (ov[i] > overlay[i]) overlay[i] = ov[i];
            });
            scene.setHemiMesh(f.hemi, buildColoredGeometry(f.mesh, overlay, max, colorFn, base));
          }
        });
        // If the chosen hemisphere has no map for this selection, fall back to both.
        const haveHemis = found.map(f => f.hemi);
        if (this.brain.hemi !== 'both' && !haveHemis.includes(this.brain.hemi)) this.setBrainView('dorsal');
        scene.setHemiVisible('lh', this.brain.hemi !== 'rh');
        scene.setHemiVisible('rh', this.brain.hemi !== 'lh');
        // First load of a selection: pick a sensible camera; later reloads keep the user's view.
        if (this._brainKey !== this.tab + '|' + tracts.join(',')) {
          this._brainKey = this.tab + '|' + tracts.join(',');
          const hemis = found.map(f => f.hemi);
          const v = hemis.length === 2 ? 'dorsal' : hemis[0] === 'lh' ? 'lateral-left' : 'lateral-right';
          scene.resetZoom(); this.setBrainView(v);
        }
        this.brain.max = max;
        this.brain.status = 'ready';
      }).catch(err => {
        console.error('Failed to load endpoint map:', err);
        if (requestId === this._surfRequestId) this.brain.status = 'empty';
      });
    }
  }
});
