#!/usr/bin/env python3
"""
export_network_atlases.py — network atlases for the brain workspace

Builds assets/atlases/<CODE>.json for each reference atlas of the Network
Correspondence Toolbox (Kong et al. 2025) used in the paper, so the website
can paint canonical functional networks on the same fsaverage surface it
draws tract endpoints on.

The toolbox ships the atlases as fsaverage6 hard parcellations
(40,962 vertices / hemisphere, .mat files with lh_labels / rh_labels):
    https://github.com/rubykong/cbig_network_correspondence_data
fsaverage6 is an exact vertex subset of fsaverage (the first 40,962 vertices,
icosahedral nesting), so each full-resolution vertex takes the label of its
nearest fsaverage6 vertex on the sphere.

Parcel atlases (AS200Y17, XS268_8) are first collapsed to networks with the
toolbox's network_assignment/<CODE>.mat mapping, exactly as the toolbox
does before computing Dice. Network names follow the toolbox convention:
sorted unique non-zero label ids ↔ lines of network_names/<CODE>.

Output JSON (per atlas):
    { "code", "title", "names": [...], "colors": [...],
      "n": 163842, "lh": [v, run, v, run, …], "rh": [...] }
with labels 0 = no network, 1..K = index into names, run-length encoded.

Usage:
    python3 scripts/export_network_atlases.py <toolbox-data-dir>
where <toolbox-data-dir> holds atlases/fsaverage6/, network_assignment/,
network_names/ from the cbig_network_correspondence_data repository
(tag v1.1.0). Requires numpy, scipy, nibabel.
"""
import json
import os
import sys

import nibabel as nib
import numpy as np
import scipy.io as sio
from scipy.spatial import cKDTree

THIS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(THIS)
SPHERES = {
    'lh': os.path.join(ROOT, 'assets/TractEndpointImages/neuromaps/atlases/fsaverage/tpl-fsaverage_den-164k_hemi-L_sphere.surf.gii'),
    'rh': os.path.join(ROOT, 'assets/TractEndpointImages/neuromaps/atlases/fsaverage/tpl-fsaverage_den-164k_hemi-R_sphere.surf.gii'),
}
OUT = os.path.join(ROOT, 'assets/atlases')
FS6 = 40962

ATLASES = {
    'TY7':      ('YeoLab/TY7',      'Yeo 7 networks'),
    'EG17':     ('WashU/EG17',      'Gordon 17 networks'),
    'AS200Y17': ('YeoLab/AS200Y17', 'Schaefer 200 parcels / Yeo 17 networks'),
    'MG360J12': ('Glasser/MG360J12','Glasser 360 parcels / 12 networks (Ji)'),
    'XS268_8':  ('Shen/XS268_8',    'Shen 268 parcels / 8 networks'),
    'EG286_12': ('WashU/EG286_12',  'Gordon 286 parcels / 12 networks'),
}

# Colours follow the Yeo 7 convention for every atlas, so the same family
# (visual, somatomotor, dorsal attention, salience/ventral attention, limbic,
# control/frontoparietal, default) looks the same whichever atlas is shown;
# subdivisions (A/B/C, 1/2, lateral/medial…) get lighter/darker shades of the
# family colour. Families the Yeo 7 lacks (language, auditory, cingulo-
# opercular, memory, …) get their own fixed colours.
FAMILY = [  # (substring to match on the lower-cased network name, colour)
    ('visual', '#781286'), ('vis', '#781286'),
    ('somatomotor', '#4682B4'), ('sommot', '#4682B4'), ('motor', '#4682B4'), ('handsm', '#4682B4'), ('facesm', '#5A9BD5'), ('footsm', '#2F5F8F'), ('sm', '#4682B4'),
    ('dorsattn', '#00760E'),
    ('sal/venattn', '#C43AFA'), ('salventattn', '#C43AFA'), ('ventattn', '#C43AFA'), ('salience', '#C43AFA'), ('salsubcor', '#C43AFA'),
    ('limbic', '#DCF8A4'), ('orbitaffective', '#DCF8A4'),
    ('context', '#9B6B4F'), ('control', '#E69422'), ('cont', '#E69422'), ('frontpar', '#E69422'),
    ('default', '#CD3E4E'), ('medfront', '#CD3E4E'),
    ('language', '#1FB9B0'), ('auditory', '#F2D53C'), ('cingoperc', '#B57A2B'),
    ('temppar', '#7FB3D5'), ('postmulti', '#8AD1B8'), ('ventmulti', '#C7B8E6'),
    ('antmtl', '#E89AC7'), ('postmtl', '#B8528F'), ('parmemory', '#D26BA6'), ('medpar', '#C9C9C9'), ('paroccip', '#5B5F8F'), ('parocc', '#5B5F8F'),
    ('premotor', '#9BC4E6'), ('latvis', '#9A4DB3'), ('medvis', '#5A0E6B'), ('visassoc', '#B07CC6'),
]
FALLBACK = ['#F4A261', '#2AB0A0', '#9B75D4', '#B0C93E', '#E080C0', '#5AACCC', '#D4A843', '#6BBF6B']


def _shade(hex_, k):
    """k < 0 darkens, k > 0 lightens (fraction towards black / white)."""
    r, g, b = (int(hex_[i:i + 2], 16) for i in (1, 3, 5))
    if k >= 0:
        r, g, b = (int(round(c + (255 - c) * k)) for c in (r, g, b))
    else:
        r, g, b = (int(round(c * (1 + k))) for c in (r, g, b))
    return '#%02X%02X%02X' % (r, g, b)


def family_colours(names):
    base, fam = [], []
    for nm in names:
        key = nm.lower().replace(' ', '')
        col = next((c for sub, c in FAMILY if sub in key), None)
        fam.append(col)
        base.append(col)
    # Subdivisions of one family (DefaultA/B/C, Visual1/2, VisualA/B …) get distinct shades.
    out = []
    used = {}
    nxt = 0
    for nm, col in zip(names, base):
        if col is None:
            col = FALLBACK[nxt % len(FALLBACK)]; nxt += 1
            out.append(col); continue
        k = used.get(col, 0); used[col] = k + 1
        out.append(col if k == 0 else _shade(col, [0.28, -0.3, 0.5, -0.5][(k - 1) % 4]))
    return out


def rle(a):
    a = np.asarray(a).ravel()
    out = []
    i = 0
    n = len(a)
    while i < n:
        v = int(a[i])
        j = i + 1
        while j < n and a[j] == v:
            j += 1
        out += [v, j - i]
        i = j
    return out


def main(data_dir):
    os.makedirs(OUT, exist_ok=True)
    # nearest fsaverage6 vertex for every fsaverage vertex, per hemisphere
    nn = {}
    for hemi, path in SPHERES.items():
        xyz = nib.load(path).darrays[0].data.astype(np.float64)
        tree = cKDTree(xyz[:FS6])
        _, idx = tree.query(xyz, k=1)
        assert np.array_equal(idx[:FS6], np.arange(FS6)), 'fsaverage6 vertices should map to themselves'
        nn[hemi] = idx
    index = []
    for code, (rel, title) in ATLASES.items():
        m = sio.loadmat(os.path.join(data_dir, 'atlases/fsaverage6', rel + '.mat'))
        lab = {'lh': np.asarray(m['lh_labels']).ravel().astype(np.int64),
               'rh': np.asarray(m['rh_labels']).ravel().astype(np.int64)}
        mapfile = os.path.join(data_dir, 'network_assignment', code + '.mat')
        if os.path.exists(mapfile):
            mp = np.asarray(sio.loadmat(mapfile)['mapping']).ravel().astype(np.int64)
            for h in lab:
                v = lab[h]
                out = np.zeros_like(v)
                nz = v > 0
                out[nz] = mp[v[nz] - 1]
                lab[h] = out
        names = [l.strip() for l in open(os.path.join(data_dir, 'network_names', code)) if l.strip()]
        ids = np.setdiff1d(np.unique(np.concatenate([lab['lh'], lab['rh']])), [0])
        assert len(ids) == len(names), (code, len(ids), len(names))
        remap = {int(i): k + 1 for k, i in enumerate(ids)}
        colors = family_colours(names)
        rec = {'code': code, 'title': title, 'names': names, 'colors': colors, 'n': int(len(nn['lh']))}
        for h in ('lh', 'rh'):
            full = lab[h][nn[h]]
            full = np.vectorize(lambda x: remap.get(int(x), 0))(full) if len(remap) else full
            rec[h] = rle(full.astype(np.uint8))
        path = os.path.join(OUT, code + '.json')
        with open(path, 'w') as f:
            json.dump(rec, f, separators=(',', ':'))
        index.append({'code': code, 'title': title, 'names': names, 'colors': colors})
        print(f'{code}: {len(names)} networks, {os.path.getsize(path) // 1024} KB')
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump({'atlases': index}, f, separators=(',', ':'))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
