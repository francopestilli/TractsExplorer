const tractNames = [
  'anterioFrontalCC', 'forcepsMajor', 'forcepsMinor', 'leftAnterioFrontoCerebellar',
  'leftArc', 'leftAslant', 'leftCST', 'leftContraAnterioFrontoCerebellar',
  'leftContraMotorCerebellar', 'leftIFOF', 'leftILF', 'leftMDLFang',
  'leftMDLFspl', 'leftMotorCerebellar', 'leftOccipitoCerebellar', 'leftSuperiorOpticRadiation',
  'leftParietoCerebellar', 'leftSLF1And2', 'leftSLF3', 'leftTPC',
  'leftThalamicoCerebellar', 'leftUncinate', 'leftVOF', 'leftcingulum',
  'leftfrontoThalamic', 'leftInferiorOpticRadiation', 'leftmotorThalamic', 'leftpArc',
  'leftparietoThalamic', 'leftspinoThalamic', 'lefttemporoThalamic', 'middleFrontalCC',
  'parietalCC', 'rightAnterioFrontoCerebellar', 'rightArc', 'rightAslant',
  'rightCST', 'rightContraAnterioFrontoCerebellar', 'rightContraMotorCerebellar', 'rightIFOF',
  'rightILF', 'rightMDLFang', 'rightMDLFspl', 'rightMotorCerebellar',
  'rightOccipitoCerebellar', 'rightSuperiorOpticRadiation', 'rightParietoCerebellar', 'rightSLF1And2',
  'rightSLF3', 'rightTPC', 'rightThalamicoCerebellar', 'rightUncinate',
  'rightVOF', 'rightcingulum', 'rightfrontoThalamic', 'rightInferiorOpticRadiation',
  'rightmotorThalamic', 'rightpArc', 'rightparietoThalamic', 'rightspinoThalamic',
  'righttemporoThalamic'
];

const tracts = tractNames.map((name, index) => ({ id: String(index + 1).padStart(2, '0'), name }));
const thresholds = [
  { value: '0.05', label: '0.05', token: '05', folder: 'threshold-05_tract_decoding' },
  { value: '0.10', label: '0.10', token: '10', folder: 'threshold-10_tract_decoding' },
  { value: '0.15', label: '0.15', token: '15', folder: 'threshold-15_tract_decoding' },
  { value: '0.20', label: '0.20', token: '20', folder: 'threshold-20_tract_decoding' }
];
const state = { selected: null, query: '', rotation: 0, threshold: '0.10' };
const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const assetRoot = 'assets/decoding/Decoding';

function renderTracts() {
  const query = state.query.toLowerCase();
  const visible = tracts.filter((tract) => `${tract.id} ${tract.name}`.toLowerCase().includes(query));
  $('#endpoint-count').textContent = `${visible.length} of ${tracts.length} tracts`;
  $('#endpoint-list').innerHTML = visible.map((tract) => `<button class="endpoint-item ${state.selected?.id === tract.id ? 'active' : ''}" data-tract="${tract.id}" role="option" aria-selected="${state.selected?.id === tract.id}"><i class="endpoint-dot"></i><span class="endpoint-name">${tract.name}</span><span class="endpoint-code">${tract.id}</span></button>`).join('');
  all('.endpoint-item').forEach((button) => button.addEventListener('click', () => selectTract(button.dataset.tract)));
}

function endpointPoint(seed, side) {
  const angle = (seed * 1.73 + side * 2.4) % (Math.PI * 2);
  return { x: side ? Math.cos(angle) * .55 : -Math.cos(angle) * .55, y: Math.sin(angle) * .52 };
}

function drawBrain() {
  const canvas = $('#brain-canvas'); const bounds = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, bounds.width * ratio); canvas.height = Math.max(1, bounds.height * ratio);
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = bounds.width; const height = bounds.height; const scale = Math.min(width, height) / 2.6;
  ctx.clearRect(0, 0, width, height); ctx.save(); ctx.translate(width * .51, height * .52); ctx.rotate(Math.sin(state.rotation) * .035);
  if (state.selected) {
    const seed = Number(state.selected.id); const left = endpointPoint(seed, 0); const right = endpointPoint(seed, 1);
    ctx.globalAlpha = 1; ctx.strokeStyle = '#e4a17a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(left.x * scale, left.y * scale); ctx.bezierCurveTo(-scale * .16, -scale * .38, scale * .16, scale * .38, right.x * scale, right.y * scale); ctx.stroke();
    [left, right].forEach((point) => { ctx.fillStyle = '#e4a17a'; ctx.beginPath(); ctx.arc(point.x * scale, point.y * scale, 5, 0, Math.PI * 2); ctx.fill(); });
  }
  ctx.restore();
}

function showImage(image, empty, sources) {
  let sourceIndex = 0;
  const trySource = () => {
    const source = sources[sourceIndex++];
    if (!source) { image.hidden = true; empty.hidden = false; empty.textContent = 'PNG not found for this tract and threshold'; $('#asset-status').textContent = 'PNG missing'; return; }
    image.src = source; image.hidden = false; empty.hidden = true;
    image.onerror = trySource;
    image.onload = () => { $('#asset-status').textContent = 'loaded'; };
  };
  trySource();
}

function loadSelectedAssets() {
  if (!state.selected) return;
  const threshold = thresholds.find((item) => item.value === state.threshold);
  const folder = `${assetRoot}/${threshold.folder}`;
  const name = state.selected.name;
  const plotSources = [`${folder}/${name}_thr-${threshold.token}_radar.png`];
  const cloudSources = [`${folder}/${name}_thr-${threshold.token}_wordcloud.png`];
  $('#threshold-value').textContent = threshold.label; $('#detail-threshold').textContent = threshold.label;
  $('#results-label').textContent = `Threshold ${threshold.label} · source PNGs`;
  showImage($('#decoding-plot'), $('.result-figure:first-child .image-empty'), plotSources);
  showImage($('#word-cloud'), $('.result-figure:last-child .image-empty'), cloudSources);
}

function selectTract(id) {
  state.selected = tracts.find((tract) => tract.id === id); if (!state.selected) return;
  $('#selected-pair-label').textContent = state.selected.name; $('#stage-hint').hidden = true;
  $('#detail-index').textContent = state.selected.id; $('#detail-name').textContent = state.selected.name;
  $('#detail-endpoints').textContent = '2 visualized'; loadSelectedAssets();
  renderTracts(); drawBrain();
}

$('#search').addEventListener('input', (event) => { state.query = event.target.value; renderTracts(); });
$('#threshold').addEventListener('change', (event) => { state.threshold = event.target.value; if (state.selected) loadSelectedAssets(); else { const threshold = thresholds.find((item) => item.value === state.threshold); $('#threshold-value').textContent = threshold.label; $('#detail-threshold').textContent = threshold.label; $('#results-label').textContent = `Threshold ${threshold.label} · source PNGs`; } });
$('#reset-view').addEventListener('click', () => { state.selected = null; $('#selected-pair-label').textContent = 'Choose a tract from the list'; $('#stage-hint').hidden = false; $('#detail-index').textContent = '01'; $('#detail-name').textContent = 'No tract selected'; $('#detail-endpoints').textContent = '—'; all('.result-figure img').forEach((image) => { image.hidden = true; image.removeAttribute('src'); }); all('.image-empty').forEach((empty) => { empty.hidden = false; empty.textContent = 'Select a tract'; }); $('#asset-status').textContent = 'waiting'; renderTracts(); drawBrain(); });
window.addEventListener('resize', drawBrain);
renderTracts(); drawBrain();
setInterval(() => { state.rotation += .01; if (state.selected) drawBrain(); }, 50);
