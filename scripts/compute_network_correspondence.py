#!/usr/bin/env python3
"""
compute_network_correspondence.py — Network Correspondence Toolbox integration
(https://github.com/rubykong/cbig_network_correspondence, Kong et al. 2025,
Nature Communications: https://www.nature.com/articles/s41467-025-58176-9)

For every tract and every cluster at every threshold, computes Dice overlap +
spin-test p-value against canonical functional network atlases (Yeo 7 / Yeo
17, "TY7"/"TY17"), and writes one long-form CSV per threshold:

    testdata/<threshold>/network-correspondence.csv
    columns: entity_type, entity_id, group, name, dice, p_value

    entity_type  "tract" or "cluster"
    entity_id    tract name, or cluster id ("1", "2", …)
    group        atlas code ("TY7" or "TY17")
    name         network name within that atlas (e.g. "Default")
    dice, p_value  straight from cbig_network_correspondence's own output

Run with the *cbig_nc* conda environment (has the toolbox's exact pinned
dependency versions — NOT the Kims-Revisions environment used for the LDA
decoding notebook, whose newer numpy/matplotlib conflict with it):

    /opt/anaconda3/envs/cbig_nc/bin/python3 scripts/compute_network_correspondence.py

Resampling note: the toolbox needs surface data at fsaverage6 (40,962
vertices/hemisphere); our func.gii maps are native fsaverage (163,842/hemi,
i.e. fsaverage7). No resampling tool (e.g. Connectome Workbench) is needed —
fsaverage6 is an exact vertex subset of fsaverage (icosahedral subdivision,
verified directly against both meshes' coordinates), so fsaverage6 == the
first 40,962 vertices of our data, by plain index.
"""
import configparser
import json
import os
import sys
import tempfile

import nibabel as nib
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

import cbig_network_correspondence as cnc

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(THIS_DIR)
TESTDATA = os.path.join(REPO_ROOT, "testdata")

# Atlas codes to compute against — the reference atlases used in the paper:
# EG17 (Gordon 17-network), TY7 (Yeo 7-network), AS200Y17 (Schaefer 200,
# Yeo 17), MG360J12 (Glasser 360, 12 networks), XS268_8 (Shen 268, 8
# networks), EG286_12 (Gordon 286, 12 networks). See the toolbox's registry
# for ~20 more (Power, Laumann, Cole-Anticevic, …); add codes here to extend
# the website's selector, no other code changes needed.
ATLASES = ["EG17", "TY7", "AS200Y17", "MG360J12", "XS268_8", "EG286_12"]

FSAVERAGE6_N = 40962  # vertices per hemisphere

# Must match config.thresholds in explorer.html exactly — `cut` decides
# cluster membership (and therefore cluster count), and `func_dir` overrides
# where this threshold's endpoint maps live (thr-15_5clusters has its own
# matrix.csv/cut but reuses thr-15's func.gii files, same as surfBase does
# on the website). Both duplicated here because the offline script can't
# read explorer.html's JS.
THRESHOLDS = {
    "thr-05": {"cut": 1.32},
    "thr-10": {"cut": 1.32},
    "thr-15": {"cut": 1.32},
    "thr-15_5clusters": {"cut": 1.32, "func_dir": "thr-15"},
    "thr-20": {"cut": 1.32},
}


def load_hemi_combined(func_dir, hemi, tract):
    """Max-combine whichever LPI/RAS files exist for this tract+hemisphere.
    Mirrors surf3d.js's loadTractSurface / viewer.js's cluster merge exactly."""
    combined = None
    for orient in ("RAS", "LPI"):
        path = os.path.join(func_dir, f"{hemi}.{tract}.{orient}.func.gii")
        if not os.path.exists(path):
            continue
        vals = np.asarray(nib.load(path).agg_data(), dtype=np.float32)
        combined = vals if combined is None else np.maximum(combined, vals)
    return combined


def to_fsaverage6_vector(func_dir, tracts):
    """Max-combine endpoint maps for `tracts` (one tract, or every member of
    a cluster) across both hemispheres, then slice to fsaverage6 density."""
    lh = rh = None
    for tract in tracts:
        hlh = load_hemi_combined(func_dir, "lh", tract)
        hrh = load_hemi_combined(func_dir, "rh", tract)
        if hlh is not None:
            lh = hlh if lh is None else np.maximum(lh, hlh)
        if hrh is not None:
            rh = hrh if rh is None else np.maximum(rh, hrh)
    n = FSAVERAGE6_N
    lh6 = lh[:n] if lh is not None else np.zeros(n, dtype=np.float32)
    rh6 = rh[:n] if rh is not None else np.zeros(n, dtype=np.float32)
    vec = np.concatenate([lh6, rh6])
    return vec if vec.max() > 0 else None  # nothing to compute for an all-zero map


def compute_entity(name, vec, tmpdir):
    """Run network_correspondence() for one fsaverage6 vector, return a
    long-form list of {group, name, dice, p_value} dict rows."""
    npy_path = os.path.join(tmpdir, "data.npy")
    cfg_path = os.path.join(tmpdir, "config.ini")
    np.save(npy_path, vec.reshape(-1, 1))

    config = configparser.ConfigParser()
    config["data_info"] = {
        "Data_Name": name,
        "Data_Space": "fsaverage6",
        "Data_Type": "Metric",
        # Our maps are already a sparse density (zeroed below the pipeline's
        # own WM-probability threshold) — treat any nonzero vertex as part
        # of this tract/cluster's cortical footprint, same convention used
        # throughout the rest of the app (e.g. the 3D endpoint map's cutoff).
        "Data_Threshold": "[0.0001,Inf]",
    }
    with open(cfg_path, "w") as f:
        config.write(f)

    out_dir = os.path.join(tmpdir, "out")
    os.makedirs(out_dir, exist_ok=True)
    ref_params = cnc.compute_overlap_with_atlases.DataParams(cfg_path, npy_path)
    cnc.compute_overlap_with_atlases.network_correspondence(ref_params, ATLASES, out_dir)

    df = pd.read_csv(os.path.join(out_dir, "network_correspondence.csv"), index_col=0)
    return df.to_dict("records")


def compute_clustering(matrix_csv, cut):
    """Reproduces cluster.js's computeClustering(): complete linkage on
    1 - Pearson r between tracts (dropping any tract with a missing topic
    score), cut at `cut`. Returns {cluster_id: [tract, …]}, numbered exactly
    like scipy's fcluster (same as cluster-matrix.csv's row numbers)."""
    df = pd.read_csv(matrix_csv, index_col=0)
    complete = df.dropna(axis=0)
    if len(complete) < 2:
        return {}
    corr = complete.T.corr(method="pearson")
    dist = 1 - corr
    Z = linkage(squareform(dist.values, checks=False), method="complete")
    labels = fcluster(Z, cut, criterion="distance")
    clusters = {}
    for tract, label in zip(complete.index, labels):
        clusters.setdefault(int(label), []).append(tract)
    return clusters


def main():
    only_threshold = sys.argv[1] if len(sys.argv) > 1 else None
    for folder, cfg in THRESHOLDS.items():
        if only_threshold and folder != only_threshold:
            continue
        thr_dir = os.path.join(TESTDATA, folder)
        func_dir = os.path.join(TESTDATA, cfg.get("func_dir", folder), "func")
        matrix_csv = os.path.join(thr_dir, "matrix.csv")
        if not os.path.isdir(func_dir) or not os.path.isfile(matrix_csv):
            print(f"[{folder}] skip — missing func/ or matrix.csv")
            continue

        manifest_path = os.path.join(func_dir, "manifest.json")
        with open(manifest_path) as f:
            manifest = json.load(f)
        matrix = pd.read_csv(matrix_csv, index_col=0)
        tracts = [tract for tract in matrix.index if tract in manifest]
        if not tracts:
            raise ValueError(f"[{folder}] matrix has no tracts with available surface maps")

        rows = []
        print(f"[{folder}] {len(tracts)} tracts")
        for i, tract in enumerate(tracts):
            with tempfile.TemporaryDirectory() as tmp:
                vec = to_fsaverage6_vector(func_dir, [tract])
                if vec is None:
                    print(f"  ({i+1}/{len(tracts)}) {tract}: no data, skipping")
                    continue
                recs = compute_entity(tract, vec, tmp)
            for r in recs:
                rows.append({"entity_type": "tract", "entity_id": tract, **r})
            print(f"  ({i+1}/{len(tracts)}) {tract}: done")

        clusters = compute_clustering(matrix_csv, cfg["cut"])
        print(f"[{folder}] {len(clusters)} clusters")
        for cid, members in sorted(clusters.items()):
            with tempfile.TemporaryDirectory() as tmp:
                vec = to_fsaverage6_vector(func_dir, members)
                if vec is None:
                    print(f"  cluster {cid}: no data, skipping")
                    continue
                recs = compute_entity(f"cluster{cid}", vec, tmp)
            for r in recs:
                rows.append({"entity_type": "cluster", "entity_id": str(cid), **r})
            print(f"  cluster {cid} ({len(members)} tracts): done")

        out_df = pd.DataFrame(rows)
        out_path = os.path.join(thr_dir, "network-correspondence.csv")
        out_df.to_csv(out_path, index=False)
        print(f"[{folder}] wrote {len(out_df)} rows to {out_path}")


if __name__ == "__main__":
    main()
