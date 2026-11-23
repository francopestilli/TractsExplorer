# Data

The published results behind TractsExplorer: the full output of the tract endpoint decoding analysis, kept whole here so researchers can use the files directly. The website and the API read from this folder, but nothing in it depends on them.

```
data/
├── config.json                ← thresholds and data paths shared by the website and the API (paths are relative to data/)
├── lookups.json               ← tract display names and the explorer's view-link parameters
├── thresholds/
│   └── thr-15/                ← one folder per threshold; thr-15 = threshold 0.15, full 61-tract cohort
│       ├── matrix.csv         ← tracts × topics, joint (LPI + RAS) decoding (Pearson r)
│       ├── matrix_RAS.csv     ← RAS endpoint decoded on its own (same layout)
│       ├── matrix_LPI.csv     ← LPI endpoint decoded on its own (same layout)
│       ├── cluster-matrix.csv ← clusters × topics, each cluster's combined map decoded
│       ├── cluster-assignments_joint.csv
│       ├── cluster-quality.csv   ← joint LPI + RAS silhouette and Dunn scores for k=2…8
│       ├── analysis-summary.csv  ← joint LPI + RAS complete counts and cophenetic r
│       ├── network-correspondence.csv  ← tract/cluster × network-atlas Dice, p-value, size-based Dice ceiling
│       ├── images/            ← pre-rendered figures: dendrograms, per-cluster radar / surface / word cloud
│       └── func/
│           ├── {lh|rh}.{tract}.{LPI|RAS}.func.gii   ← per-tract endpoint maps (fsaverage)
│           └── manifest.json  ← which hemisphere/orientation files exist per tract
├── surf/mesh/                 ← fsaverage midthickness mesh, cortex mask, thickness
├── atlases/                   ← network atlases painted on the cortex
└── decoding/topic-terms.json  ← full LDA term list per topic
```

`thr-15_5clusters` is threshold 0.15 restricted to a fixed 43-tract cohort; it reuses `thr-15/func` (`func` in `config.json`). The website draws its figures live, so it does not use `images/` (the per-cluster figures predate the smooth_3 reanalysis).

## Formats

- **matrix\*.csv**: first column `tract`, then one column per topic named `{id}_{term1}_{term2}_{term3}`. Values are Pearson r, `NaN` when missing. `{id}` is the 1-based row of the topic in the LDA features file and the key in `topic-terms.json`.
- **network-correspondence.csv**: columns `entity_type, entity_id, group, name, dice, p_value, max_possible_dice`. `max_possible_dice` is the size-based upper bound `2 × min(n_entity, n_network) / (n_entity + n_network)`, after the same fsaverage6 mapping and `0.0001` threshold as the Dice. It is a bound from set sizes, not an overlap the maps can necessarily reach.
- **topic-terms.json**: `{"topics": {"<id>": {"class": ..., "terms": [[term, weight, class], ...]}}}`; weights are LDA term frequencies normalised so each topic's top term is 1.0.

## How the clusters are made

`static/cluster.js` reproduces the clustering in `Kims-Revisions/decode-tracts.ipynb`: keep tracts with no missing topic scores, take 1 − Pearson r between tracts across topics, run complete-linkage clustering, and cut the tree at 1.32. Cluster numbers follow scipy's `fcluster`, so cluster *N* is row *N* of `cluster-matrix.csv`.

## Regenerating

The scripts in `scripts/` read from the sibling `Kims-Revisions` and `smooth_data` folders. Install their dependencies with `pip install -r scripts/requirements.txt`.

| Output | Command |
|---|---|
| threshold tables (validates the endpoint maps vertex-for-vertex first) | `python3 scripts/publish_func_thresh_15_results.py` |
| `network-correspondence.csv` | `python3 scripts/compute_network_correspondence.py [thr-15] [--clusters-only] [--max-dice-only]` |
| `atlases/` | `python3 scripts/export_network_atlases.py` |
| `decoding/topic-terms.json` | `python3 scripts/export_topic_terms.py ../Kims-Revisions/data/decoding` |

Thresholds use the continuous `*.smooth_3.func.gii` maps from `smooth_data/1062_cortexmap_binarize_smooth-surf-1_threshold-<value>_dilate-0/cortexmap/func`. The full cohort is the 61 tracts with complete LPI/RAS map pairs at each threshold; `leftbaum` is represented by `leftSuperiorOpticRadiation`. Clustering and cluster decodings use the joint maps only.

After publishing, rerun the network correspondence. `--clusters-only` is safe only when the tract cohort and maps are unchanged; `--max-dice-only` adds the Dice bound without rerunning the spin tests. The Network Correspondence Toolbox pins old numpy/matplotlib, so give it its own environment:

```bash
conda create -n cbig_nc python=3.11
conda run -n cbig_nc pip install -r scripts/requirements.txt
conda run -n cbig_nc python scripts/compute_network_correspondence.py
```

The script maps each tract's and cluster's endpoint map to fsaverage6 by taking the first 40,962 vertices of fsaverage (fsaverage6 is an exact vertex subset), then runs the toolbox against the atlases in its `ATLASES` list: `EG17`, `TY7`, `AS200Y17`, `MG360J12`, `XS268_8`, `EG286_12`. To add one of the toolbox's other atlases, add its code there and rerun; the website's atlas list comes from the CSV.

## Adding a threshold

1. Add a folder under `thresholds/` with the files above.
2. Add an entry to `thresholds` in `config.json`, keyed by the folder name. `label` is what the threshold selector shows and `value` is the numeric threshold; `cut` defaults to 1.0, `noClusters: true` hides the Cluster View, and `func` names another threshold whose `func/` maps this one reuses.

   ```json
   "thr-25": { "label": "0.25 (6 clusters)", "cut": 1.0, "value": 0.25 }
   ```
