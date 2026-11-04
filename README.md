# WMC Tract Endpoint Decoding Viewer

Interactive visualization of white matter tract endpoint decoding — how the cortical endpoints of each tract map onto meta-analytic cognitive topics (NeuroQuery LDA topics, decoded with the [gradec](https://gradec.readthedocs.io/en/latest/index.html) toolbox — [Peraza et al., 2024](https://direct.mit.edu/imag/article/doi/10.1162/imag_a_00081/119100/Methods-for-decoding-cortical-gradients-of)) — built for the [brainlife.io](https://brainlife.io) platform.

Everything is drawn live in the browser from CSV / GIFTI data: no pre-rendered figures are needed.

**Live:** [kimberlylray.github.io/ui-wmc-endpoint-decoding](https://kimberlylray.github.io/ui-wmc-endpoint-decoding/) — a landing page (`index.html`) with the project description, preprint link and citation, linking to the actual tool (`explorer.html`).

White matter tracts were defined from [Bullock et al., 2022](https://academic.oup.com/cercor/article/32/20/4524/6528900) ("A taxonomy of the brain's white matter: twenty-one major tracts for the 21st century", *Cerebral Cortex*) using its [brainlife.io app](https://brainlife.io/app/5cc73ef44ed9df00317f6288).

## What it shows

**Cluster View**
- Dendrogram of tract similarity, computed live (click a branch → cluster, a name → tract)
- Member tracts listed next to the cluster label (click → Tract View)
- 3D cortical endpoint map of the whole cluster (LPI + RAS combined, max across member tracts)
- Top cognitive topics, radar chart and word cloud from the cluster's own decoding
- Cluster counts, cophenetic correlations, silhouette scores, and Dunn indices from the current reanalysis

**Tract View**
- 3D cortical endpoint maps for the RAS and LPI endpoints (drag to rotate, scroll to zoom)
- Decoding of the joint (LPI + RAS) map next to the RAS-only and LPI-only decodings: top topics, radar chart and word cloud for each
- Searchable list of all tracts, colored by cluster

**Full Matrix** — tract × topic heatmap with hover tooltips; click a row to open that tract.

**Topic details** — click any topic bar to see the topic's full 40-term list with LDA weights and term type (Functional / Anatomical / Clinical / Non-specific). The *Functional terms only* switch (on by default, matching the gradec figures) also drives the radar labels and word clouds.

**Network Correspondence** — in both Cluster View and Tract View, a bar chart (same style as the topic bars) of Dice overlap between the selection's endpoint map and each network in the selected atlas, via the [Network Correspondence Toolbox](https://github.com/rubykong/cbig_network_correspondence) ([Kong et al., 2025](https://www.nature.com/articles/s41467-025-58176-9)). An atlas dropdown switches between the six reference atlases used in the paper — `EG17`, `TY7`, `AS200Y17`, `MG360J12`, `XS268_8`, `EG286_12` (the toolbox supports ~20 more, see below). Bold/starred networks are spin-test significant (p < 0.05).

Charts use the cluster's color throughout (a tract takes its cluster's color).

## How clustering works

`cluster.js` reproduces the clustering in `Kims-Revisions/decode-tracts.ipynb`:

1. keep tracts with no missing topic scores (`matrix.dropna(axis=0)`)
2. distance = 1 − Pearson r between tracts across topics
3. complete-linkage hierarchical clustering
4. cut the tree at distance 1.32 for the published smooth_3 reanalysis

Cluster numbers follow scipy's `fcluster` exactly, so cluster *N* matches row *N* of `cluster-matrix.csv`. Tracts with missing scores are shown as "Not clustered".

## Data layout

```
testdata/
└── thr-15/                    ← threshold 0.15, full 61-tract available cohort
    ├── matrix.csv             ← tracts × topics, joint (LPI + RAS) decoding (Pearson r)
    ├── matrix_RAS.csv         ← RAS endpoint decoded on its own (same layout)
    ├── matrix_LPI.csv         ← LPI endpoint decoded on its own (same layout)
    ├── cluster-matrix.csv     ← clusters × topics, each cluster's combined map decoded
    ├── cluster-quality.csv    ← joint LPI + RAS silhouette and Dunn scores for k=2…8
    ├── analysis-summary.csv   ← joint LPI + RAS complete counts and cophenetic r
    ├── cluster-assignments_joint.csv
    ├── dendrogram_joint.png
    ├── network-correspondence.csv  ← tract/cluster × network-atlas Dice, p-value, and size-based Dice ceiling (see below)
    └── func/
        ├── {lh|rh}.{tract}.{LPI|RAS}.func.gii   ← per-tract endpoint maps (fsaverage)
        └── manifest.json      ← which hemisphere/orientation files exist per tract
assets/
├── surf/mesh/                 ← fsaverage midthickness mesh, cortex mask, thickness
└── decoding/topic-terms.json  ← full term list per topic (see scripts/)
```

**matrix.csv** — first column `tract`, then one column per topic named `{id}_{term1}_{term2}_{term3}`; values are Pearson r, `NaN` for missing. `{id}` is the 1-based row of the topic in the LDA features file.

**topic-terms.json** — regenerate with

```bash
python3 scripts/export_topic_terms.py ../Kims-Revisions/data/decoding
```

which reads gradec's `source-neuroquery_desc-lda_{features,frequencies,classification}.csv`.

## Published smooth_3 reanalysis

The active threshold selector uses the continuous
`*.smooth_3.func.gii` maps from `smooth_data/1062_cortexmap_binarize_smooth-surf-1_threshold-<value>_dilate-0/cortexmap/func`.
The website's selected endpoint maps are checked vertex-for-vertex against
those source maps before publishing. The full available cohort includes all 61
tracts with complete LPI/RAS map pairs at each threshold. Threshold 0.15 also
has a separate fixed 43-tract cohort, listed in the selector as such.
`leftbaum` is represented by `leftOpticRadiation`.

Tract decoding matrices are retained for LPI, RAS, and joint LPI + RAS, but
clustering, cluster decodings, dendrograms, and cluster-quality metrics are
produced only for the joint maps. Use the update script from this repository to
republish the results and validate maps before copying:

```bash
python3 scripts/publish_func_thresh_15_results.py
```

The website displays joint clustering results only. After publishing, rerun
`scripts/compute_network_correspondence.py` in the documented `cbig_nc`
environment to refresh tract rows for the full cohort and joint cluster rows
for the updated partitions. `--clusters-only` is appropriate only when the
tract cohort and maps are unchanged. The existing pre-rendered PNG exports are
not used by the interactive viewer.

## Network Correspondence Toolbox

`network-correspondence.csv` (one per threshold; columns `entity_type, entity_id, group, name, dice, p_value, max_possible_dice`) is computed offline by `scripts/compute_network_correspondence.py`, using [cbig_network_correspondence](https://github.com/rubykong/cbig_network_correspondence) ([Kong et al., 2025](https://www.nature.com/articles/s41467-025-58176-9)). The revised cluster partitions have been recalculated; the unchanged tract-level Dice and spin-test p-values are preserved.

`max_possible_dice` is the size-based upper bound `2 × min(n_entity, n_network) / (n_entity + n_network)`, using the entity and network vertex counts after the same fsaverage6 mapping and `0.0001` threshold as the NCT Dice calculation. It assumes the smaller set could be fully contained in the larger one, so it is an upper bound based on sizes, not a claim that the maps can attain that overlap in their actual spatial arrangement. The viewer shows observed Dice / size-based maximum Dice. `--max-dice-only` adds this field to existing results without rerunning the NCT spin tests and verifies the stored observed Dice against direct binary-mask intersections.

The toolbox pins exact dependency versions (`numpy==1.26.4`, `matplotlib==3.9.0`, …) that conflict with the newer `numpy`/`matplotlib` the Kims-Revisions decoding notebook needs — **install it into its own environment**, not the notebook's:

```bash
conda create -n cbig_nc python=3.11
/opt/anaconda3/envs/cbig_nc/bin/python3 -m pip install cbig_network_correspondence
```

Then, from this repo:

```bash
/opt/anaconda3/envs/cbig_nc/bin/python3 scripts/compute_network_correspondence.py            # all thresholds
/opt/anaconda3/envs/cbig_nc/bin/python3 scripts/compute_network_correspondence.py thr-15      # one threshold
/opt/anaconda3/envs/cbig_nc/bin/python3 scripts/compute_network_correspondence.py --clusters-only  # refresh revised clusters only
/opt/anaconda3/envs/cbig_nc/bin/python3 scripts/compute_network_correspondence.py --max-dice-only  # add bound without rerunning spin tests
```

For each tract and each live-clustered cluster, a rerun combines its endpoint map(s) (same max-overlap merge the 3D viewer uses), resamples to fsaverage6 by taking the **first 40,962 vertices** of our native fsaverage (164k) data — fsaverage6 is an exact vertex subset of fsaverage via icosahedral subdivision, verified directly against both meshes' coordinates, so no resampling tool (e.g. Connectome Workbench) is needed — and runs `network_correspondence()` against each atlas in the script's `ATLASES` list: `EG17` (Gordon 17), `TY7` (Yeo 7), `AS200Y17` (Schaefer 200, Yeo 17), `MG360J12` (Glasser 360, 12 networks), `XS268_8` (Shen 268, 8 networks), `EG286_12` (Gordon 286, 12 networks) — the reference atlases used in the paper. The script uses the revised 1.32 cluster cut and limits tract-level calculations to each matrix's cohort.

To add another of the toolbox's ~25 atlases (Schaefer, Gordon, Cole-Anticevic, Power, …) to the website's dropdown, add its code to `ATLASES` in the script and re-run — no other code changes needed, the dropdown is populated from whatever atlas codes are actually present in the CSV.

## Adding a threshold

1. Add a folder under `testdata/` with the files above.
2. Add an entry to `config.thresholds` in `explorer.html`:

   ```js
   '0.25 (6 clusters)': { folder: 'thr-25', surfBase: 'testdata/thr-25/func', cut: 1.0 }
   ```

   Options: `folder` (required), `surfBase` (omit to hide the 3D maps), `cut` (dendrogram cut, default 1.0), `noClusters: true` (hide the Cluster View).

## Running locally

```bash
npm install
npm start          # serves the folder, e.g. http://localhost:3000
```

Any static file server works (e.g. `python3 -m http.server 3000`); opening the HTML files directly from disk will not, because the browser blocks loading the data files. Once served, open `index.html` for the landing page or go straight to `explorer.html` for the tool.

## Hosting

The site is static, so it can be served from GitHub Pages (Settings → Pages → deploy from `main`, folder `/`) — `index.html` becomes the landing page visitors land on. For brainlife.io, point `dataBase` in `explorer.html` at the brainlife output location.

## Code

| File | Role |
|---|---|
| `index.html` | landing page: description, preprint link/citation, and live previews (reusing `cluster.js`/`surf3d.js` against real data) of each view |
| `explorer.html` | the tool itself: page shell + configuration (thresholds, data paths) |
| `viewer.js` | main Vue component (views, data loading, interaction) |
| `cluster.js` | hierarchical clustering + dendrogram |
| `charts.js` | radar chart + word cloud |
| `surf3d.js` | GIFTI parsing + three.js cortical surface rendering |
| `scripts/export_topic_terms.py` | builds `assets/decoding/topic-terms.json` |
| `scripts/compute_network_correspondence.py` | builds `network-correspondence.csv` (run in the separate `cbig_nc` environment — see above) |
| `scripts/publish_func_thresh_15_results.py` | publishes and validates the smooth_3 reanalysis tables from the sibling `Kims-Revisions` project |

Dependencies are loaded from a CDN, with no build step: [Vue 2](https://v2.vuejs.org/), [PapaParse](https://www.papaparse.com/), [pako](https://github.com/nodeca/pako), [three.js](https://threejs.org/).

## Credits

Developed by Kim Ray, University of Texas at Austin (Pestilli Lab).
Supported by the [brainlife.io](https://brainlife.io) platform.

This tool accompanies:

> Human white matter tracts aligned with canonical functional brain networks
> Kimberly L. Ray, Sohmee Kim, Karen Herrera, Suna Guo, Daniela Reyes, Julio A. Peraza, Anna Bostoganashvili, Gabriele Amorosino, Angela R. Laird, Franco Pestilli
> doi: [10.64898/2026.05.20.726546](https://doi.org/10.64898/2026.05.20.726546)

Topic decoding is performed with the [gradec](https://gradec.readthedocs.io/en/latest/index.html) Python toolbox:

> Methods for decoding cortical gradients of function
> Julio A. Peraza, et al., 2024
> doi: [10.1162/imag_a_00081](https://direct.mit.edu/imag/article/doi/10.1162/imag_a_00081/119100/Methods-for-decoding-cortical-gradients-of)
