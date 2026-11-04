/* ─────────────────────────────────────────────────────────────────
   Minimal GIFTI (.gii) reader + Three.js cortical-surface renderer,
   used by the Tract View "Cortical Endpoint Map (3D)" panel.

   Depends on (loaded as globals in index.html, before this file):
     - pako   — zlib inflate for GIFTI's "GZipBase64Binary" payloads.
                NOTE: despite the name, Connectome Workbench writes a
                raw zlib stream here, not a real .gz file, so this
                uses pako.inflate() (zlib) rather than pako.ungzip().
     - THREE  — WebGL rendering (r128, classic global build).
   ───────────────────────────────────────────────────────────────── */

// ─── GIFTI parsing ──────────────────────────────────────────────────

function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Returns an array of { intent, dim0, dim1, values } — one per <DataArray>.
function parseGiftiDataArrays(xml) {
  const out = [];
  const daRe = /<DataArray\b([^>]*)>([\s\S]*?)<\/DataArray>/g;
  let m;
  while ((m = daRe.exec(xml))) {
    const attrs = {};
    const attrRe = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(m[1]))) attrs[am[1]] = am[2];

    const dm = /<Data>([\s\S]*?)<\/Data>/.exec(m[2]);
    if (!dm) continue;

    const raw = b64ToBytes(dm[1].trim());
    let bin;
    if (attrs.Encoding === 'GZipBase64Binary') {
      bin = pako.inflate(raw);
    } else if (attrs.Encoding === 'Base64Binary') {
      bin = raw;
    } else {
      continue; // ASCII encoding unused in this dataset
    }
    // Copy into a freshly-sized buffer so the typed-array view below
    // can't be thrown off by pako's internal chunk allocation.
    const buf = new Uint8Array(bin.length);
    buf.set(bin);

    let values;
    if (attrs.DataType === 'NIFTI_TYPE_FLOAT32') values = new Float32Array(buf.buffer);
    else if (attrs.DataType === 'NIFTI_TYPE_INT32') values = new Int32Array(buf.buffer);
    else continue;

    out.push({
      intent: attrs.Intent,
      dim0: parseInt(attrs.Dim0 || '0', 10),
      dim1: attrs.Dim1 ? parseInt(attrs.Dim1, 10) : 1,
      values
    });
  }
  return out;
}

function fetchGifti(url) {
  return fetch(url).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  }).then(parseGiftiDataArrays);
}

// ─── Mesh cache ─────────────────────────────────────────────────────
// This is the SAME fsaverage midthickness mesh (+ ROI cortex mask +
// thickness map) the func.gii endpoint maps were generated on
// (cortexmap/surf in the decoding pipeline), so vertex correspondence
// with the overlay data is guaranteed. It's identical for every
// tract/threshold/orientation, so it's fetched once per hemisphere
// and reused.

const _meshCache = {};

function loadHemiMesh(meshBase, hemi) {
  const key = meshBase + '|' + hemi;
  if (_meshCache[key]) return _meshCache[key];
  const geomUrl = `${meshBase}/${hemi}.midthickness.fsaverage.surf.gii`;
  const roiUrl = `${meshBase}/${hemi}.roi.shape.gii`;
  const thickUrl = `${meshBase}/${hemi}.thickness.shape.gii`;
  const p = Promise.all([
    fetchGifti(geomUrl),
    fetchGifti(roiUrl).catch(() => null),
    fetchGifti(thickUrl).catch(() => null)
  ]).then(([geomArrays, roiArrays, thickArrays]) => {
    const points = geomArrays.find(a => a.intent === 'NIFTI_INTENT_POINTSET');
    const tris = geomArrays.find(a => a.intent === 'NIFTI_INTENT_TRIANGLE');
    const roi = roiArrays ? roiArrays[0] : null;
    const thickness = thickArrays ? thickArrays[0] : null;
    return {
      nVerts: points.dim0,
      positions: points.values,
      indices: tris.values,
      roi: roi ? roi.values : null,             // 0 = medial wall / non-cortex
      thickness: thickness ? thickness.values : null
    };
  });
  _meshCache[key] = p;
  return p;
}

// ─── Per-tract availability manifest ─────────────────────────────────
// Optional {tract: {lh: ["RAS","LPI"], rh: [...]}} file alongside the
// func.gii data (see scripts/ for how it's generated). When present, the
// viewer only requests hemi/orientation combinations that actually exist
// instead of blindly probing all four and eating 404s for the ones that
// don't — most tracts are unilateral and/or only have one orientation.
// Missing manifest → caller falls back to probing everything as before.

const _manifestCache = {};

function loadSurfManifest(surfBase) {
  if (_manifestCache[surfBase]) return _manifestCache[surfBase];
  const p = fetch(`${surfBase}/manifest.json`)
    .then(r => { if (!r.ok) throw new Error('no manifest.json'); return r.json(); })
    .catch(() => null);
  _manifestCache[surfBase] = p;
  return p;
}

// ─── Colour mapping ─────────────────────────────────────────────────

// "Hot" colormap: black → red → yellow → white
function hotColor(t) {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.4) return [t / 0.4 * 0.85, 0, 0];
  if (t < 0.8) return [0.85 + (t - 0.4) / 0.4 * 0.15, (t - 0.4) / 0.4, 0];
  return [1, 1, (t - 0.8) / 0.2];
}

// Builds a colored BufferGeometry: thickness-shaded gray background (masked
// out to a flat muted color on the medial wall via the ROI cortex mask),
// with the tract's endpoint density painted on top in a hot colormap.
function buildColoredGeometry(mesh, overlay, overlayMax, colorFn) {
  const cmap = colorFn || hotColor;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  // GIFTI topology arrays are declared NIFTI_TYPE_INT32 (signed) per spec, but
  // WebGL's drawElements only accepts unsigned index types — passing the signed
  // Int32Array straight through causes GL_INVALID_ENUM on every draw call and
  // nothing renders. Indices are always non-negative, so this cast is safe.
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
  geo.computeVertexNormals();

  const n = mesh.nVerts;
  const colors = new Float32Array(n * 3);
  const max = overlayMax || 1e-6;
  for (let i = 0; i < n; i++) {
    const isCortex = !mesh.roi || mesh.roi[i] > 0;

    if (!isCortex) {
      // Medial wall / non-cortex: flat muted color, never painted with overlay.
      colors[i * 3] = 0.16; colors[i * 3 + 1] = 0.17; colors[i * 3 + 2] = 0.22;
      continue;
    }

    // Thickness-based background shading for subtle anatomical texture
    // (typical cortical thickness ~0-4.5mm).
    let g = 0.62;
    if (mesh.thickness) {
      const t = Math.max(0, Math.min(1, mesh.thickness[i] / 4.5));
      g = 0.68 - 0.22 * t;
    }
    let r = g, gg = g, b = g;
    const v = overlay ? overlay[i] : 0;
    if (v > max * 0.02) {
      const c = cmap(v / max);
      r = c[0]; gg = c[1]; b = c[2];
    }
    colors[i * 3] = r; colors[i * 3 + 1] = gg; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ─── Interactive scene (drag to rotate, scroll to zoom) ─────────────
// A small hand-rolled orbit instead of THREE.OrbitControls, so no
// extra example/module build is needed beyond the core three.min.js.

class SurfaceScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
    this.camera.up.set(0, 0, 1); // fsaverage RAS space: +Z is superior
    this.camera.position.set(140, -260, 200);
    this.camera.lookAt(0, 0, 0);

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.75);
    dir.position.set(100, -200, 300);
    this.scene.add(dir);

    this.meshes = {};
    this._bindInteraction();
    this._raf = requestAnimationFrame(() => this._tick());
  }

  // Start from a lateral view of whichever hemisphere(s) have data, so a
  // left-only tract isn't shown from its medial side (where lateral
  // endpoints such as the arcuate's are hidden). Both → view from above.
  setDefaultView(hemis) {
    const lh = hemis.includes('lh'), rh = hemis.includes('rh');
    const pos = lh && rh ? [0, -160, 360] : lh ? [-300, -60, 140] : [300, -60, 140];
    this.group.rotation.set(0, 0, 0);
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.camera.lookAt(0, 0, 0);
  }

  setHemiMesh(hemi, geometry) {
    this.clearHemi(hemi);
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 8, specular: 0x222222 });
    const mesh = new THREE.Mesh(geometry, mat);
    this.meshes[hemi] = mesh;
    this.group.add(mesh);
  }

  clearHemi(hemi) {
    const mesh = this.meshes[hemi];
    if (mesh) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      delete this.meshes[hemi];
    }
  }

  _bindInteraction() {
    let dragging = false, px = 0, py = 0;
    const down = e => { dragging = true; px = e.clientX; py = e.clientY; };
    const up = () => { dragging = false; };
    const move = e => {
      if (!dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY;
      this.group.rotation.z += dx * 0.01;
      this.group.rotation.x += dy * 0.01;
    };
    const wheel = e => {
      e.preventDefault();
      const d = this.camera.position.length() * (1 + e.deltaY * 0.001);
      this.camera.position.setLength(Math.max(80, Math.min(1200, d)));
    };
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.canvas.addEventListener('wheel', wheel, { passive: false });
    this._cleanupInteraction = () => {
      this.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('wheel', wheel);
    };
  }

  _tick() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(() => this._tick());
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._cleanupInteraction();
    Object.keys(this.meshes).forEach(h => this.clearHemi(h));
    this.renderer.dispose();
  }
}
