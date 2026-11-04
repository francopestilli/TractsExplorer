#!/usr/bin/env python3
"""
compute_network_correspondence.py — Network Correspondence Toolbox integration
(https://github.com/rubykong/cbig_network_correspondence, Kong et al. 2025,
Nature Communications: https://www.nature.com/articles/s41467-025-58176-9)

For every tract and every cluster at every threshold, computes Dice overlap +
spin-test p-value against canonical functional network atlases (Yeo 7 / Yeo
17, "TY7"/"TY17"), and writes one long-form CSV per threshold:

    testdata/<threshold>/network-correspondence.csv
    columns: entity_type, entity_id, group, name, dice, p_value,
             max_possible_dice

    entity_type  "tract" or "cluster"
    entity_id    tract name, or cluster id ("1", "2", …)
    group        atlas code ("TY7" or "TY17")
    name         network name within that atlas (e.g. "Default")
    dice, p_value  from cbig_network_correspondence's own output
    max_possible_dice  size-based upper bound for the Dice score

Run with the *cbig_nc* conda environment (has the toolbox's pinned
dependency versions — NOT the Kims-Revisions environment used for the LDA
decoding notebook, whose newer numpy/matplotlib conflict with it):

    /opt/anaconda3/envs/cbig_nc/bin/python3 scripts/compute_network_correspondence.py
    /opt/anaconda3/envs/cbig_nc/bin/python3 scripts/compute_network_correspondence.py --clusters-only

Resampling note: the toolbox needs surface data at fsaverage6 (40,962
vertices/hemisphere); our func.gii maps are native fsaverage (163,842/hemi,
i.e. fsaverage7). No resampling tool (e.g. Connectome Workbench) is needed —
fsaverage6 is an exact vertex subset of fsaverage (icosahedral subdivision,
verified directly against both meshes' coordinates), so fsaverage6 == the
first 40,962 vertices of our data, by plain index.
"""
import argparse
import configparser
import csv
import json
import os
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
NCT_THRESHOLD = 0.0001

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


def load_atlas_network_masks():
    """Load the binary network masks in the same fsaverage6 space as NCT."""
    network_masks = {}
    for atlas_name in ATLASES:
        params = cnc.compute_overlap_with_atlases.AtlasParams(
            atlas_name, "fsaverage6"
        )
        params.config.space = "fsaverage6"
        labels = np.asarray(
            cnc.compute_overlap_with_atlases.read_atlas(params)
        ).reshape(-1)
        expected_size = 2 * FSAVERAGE6_N
        if labels.shape != (expected_size,):
            raise ValueError(
                f"{atlas_name} has {labels.size} vertices in NCT space, "
                f"expected {expected_size}."
            )
        network_labels = np.unique(labels)
        network_labels = network_labels[network_labels != 0].astype(int).tolist()
        network_names = cnc.visualize_overlap_lib.construct_network_name(atlas_name)
        if len(network_labels) != len(network_names):
            raise ValueError(
                f"{atlas_name} has {len(network_labels)} nonzero labels but "
                f"{len(network_names)} network names."
            )
        for network_name, label in zip(network_names, network_labels):
            network_masks[(atlas_name, network_name)] = labels == label
    return network_masks


def add_max_possible_dice(records, vec, network_masks):
    """Add the size-based Dice upper bound and verify observed Dice directly."""
    binary_entity = vec > NCT_THRESHOLD
    entity_size = int(binary_entity.sum())
    for record in records:
        key = (record["group"], record["name"])
        if key not in network_masks:
            raise ValueError(f"No atlas network mask found for {key}.")
        binary_network = network_masks[key]
        network_size = int(binary_network.sum())
        denominator = entity_size + network_size
        intersection = int(np.count_nonzero(binary_entity & binary_network))
        observed_dice = 2 * intersection / denominator if denominator else 0.0
        if not np.isclose(observed_dice, float(record["dice"]), atol=1e-12):
            raise ValueError(
                f"Direct Dice differs from NCT for {record['group']}/"
                f"{record['name']}: {observed_dice} vs {record['dice']}."
            )
        max_dice = (
            2 * min(entity_size, network_size) / denominator
            if denominator
            else 0.0
        )
        if max_dice + 1e-12 < observed_dice:
            raise ValueError(
                f"Maximum Dice is below observed Dice for {key}: "
                f"{max_dice} < {observed_dice}."
            )
        record["max_possible_dice"] = max_dice
    return records


def update_existing_max_dice(thr_dir, func_dir, matrix_csv, cut, network_masks):
    """Add size-based Dice bounds to an existing CSV without rerunning spins."""
    csv_path = os.path.join(thr_dir, "network-correspondence.csv")
    if not os.path.isfile(csv_path):
        raise FileNotFoundError(f"Cannot add maximum Dice; missing {csv_path}")

    with open(os.path.join(func_dir, "manifest.json")) as f:
        manifest = json.load(f)
    matrix = pd.read_csv(matrix_csv, index_col=0)
    tract_ids = {str(tract) for tract in matrix.index if tract in manifest}
    clusters = compute_clustering(matrix_csv, cut)
    cluster_ids = {str(cluster_id) for cluster_id in clusters}

    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    if not rows:
        raise ValueError(f"Cannot add maximum Dice; {csv_path} is empty.")
    if "max_possible_dice" not in fieldnames:
        fieldnames.append("max_possible_dice")

    vectors = {}
    for row in rows:
        entity_type = row["entity_type"]
        entity_id = row["entity_id"]
        key = (entity_type, entity_id)
        if key not in vectors:
            if entity_type == "tract" and entity_id in tract_ids:
                members = [entity_id]
            elif entity_type == "cluster" and entity_id in cluster_ids:
                members = clusters[int(entity_id)]
            else:
                raise ValueError(
                    f"{csv_path} contains an entity without matching maps: {key}"
                )
            vec = to_fsaverage6_vector(func_dir, members)
            if vec is None:
                raise ValueError(f"No nonzero endpoint map for {key}.")
            vectors[key] = vec
        enriched = add_max_possible_dice(
            [{"group": row["group"], "name": row["name"], "dice": row["dice"]}],
            vectors[key],
            network_masks,
        )
        row["max_possible_dice"] = format(enriched[0]["max_possible_dice"], ".16g")

    fd, temp_path = tempfile.mkstemp(
        prefix=".network-correspondence-", suffix=".csv", dir=thr_dir
    )
    try:
        with os.fdopen(fd, "w", newline="") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=fieldnames,
                extrasaction="ignore",
                lineterminator="\n",
            )
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temp_path, csv_path)
    except Exception:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise
    print(f"[{os.path.basename(thr_dir)}] added maximum Dice to {len(rows)} rows")


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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "threshold",
        nargs="?",
        choices=THRESHOLDS,
        help="Recompute one threshold folder instead of all thresholds.",
    )
    parser.add_argument(
        "--clusters-only",
        action="store_true",
        help=(
            "Recompute revised cluster rows only, preserving existing tract "
            "rows in each network-correspondence.csv."
        ),
    )
    parser.add_argument(
        "--max-dice-only",
        action="store_true",
        help=(
            "Add maximum-possible Dice bounds to existing rows without "
            "recomputing NCT spin tests."
        ),
    )
    args = parser.parse_args()
    if args.max_dice_only and args.clusters_only:
        parser.error("--max-dice-only cannot be combined with --clusters-only")
    network_masks = load_atlas_network_masks()
    for folder, cfg in THRESHOLDS.items():
        if args.threshold and folder != args.threshold:
            continue
        thr_dir = os.path.join(TESTDATA, folder)
        func_dir = os.path.join(TESTDATA, cfg.get("func_dir", folder), "func")
        matrix_csv = os.path.join(thr_dir, "matrix.csv")
        if not os.path.isdir(func_dir) or not os.path.isfile(matrix_csv):
            print(f"[{folder}] skip — missing func/ or matrix.csv")
            continue
        if args.max_dice_only:
            update_existing_max_dice(
                thr_dir, func_dir, matrix_csv, cfg["cut"], network_masks
            )
            continue

        manifest_path = os.path.join(func_dir, "manifest.json")
        with open(manifest_path) as f:
            manifest = json.load(f)
        matrix = pd.read_csv(matrix_csv, index_col=0)
        tracts = [tract for tract in matrix.index if tract in manifest]
        if not tracts:
            raise ValueError(f"[{folder}] matrix has no tracts with available surface maps")

        rows = []
        if not args.clusters_only:
            print(f"[{folder}] {len(tracts)} tracts")
            for i, tract in enumerate(tracts):
                with tempfile.TemporaryDirectory() as tmp:
                    vec = to_fsaverage6_vector(func_dir, [tract])
                    if vec is None:
                        print(f"  ({i+1}/{len(tracts)}) {tract}: no data, skipping")
                        continue
                    recs = compute_entity(tract, vec, tmp)
                recs = add_max_possible_dice(recs, vec, network_masks)
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
            recs = add_max_possible_dice(recs, vec, network_masks)
            for r in recs:
                rows.append({"entity_type": "cluster", "entity_id": str(cid), **r})
            print(f"  cluster {cid} ({len(members)} tracts): done")

        out_df = pd.DataFrame(rows)
        out_path = os.path.join(thr_dir, "network-correspondence.csv")
        if args.clusters_only:
            if not os.path.isfile(out_path):
                raise FileNotFoundError(
                    f"Cannot preserve tract results; existing file is missing: {out_path}"
                )
            existing = pd.read_csv(out_path)
            tract_rows = existing[existing["entity_type"] == "tract"]
            if tract_rows.empty:
                raise ValueError(
                    f"Cannot preserve tract results; no tract rows in {out_path}"
                )
            max_by_pair = {}
            for tract in tract_rows["entity_id"].astype(str).unique():
                vec = to_fsaverage6_vector(func_dir, [tract])
                if vec is None:
                    raise ValueError(f"No nonzero endpoint map for tract {tract}.")
                tract_records = tract_rows[
                    tract_rows["entity_id"].astype(str) == tract
                ].to_dict("records")
                enriched = add_max_possible_dice(
                    tract_records, vec, network_masks
                )
                max_by_pair.update(
                    {
                        (tract, row["group"], row["name"]): row["max_possible_dice"]
                        for row in enriched
                    }
                )
            tract_rows = tract_rows.copy()
            tract_rows["max_possible_dice"] = [
                max_by_pair[(str(row.entity_id), row.group, row["name"])]
                for _, row in tract_rows.iterrows()
            ]
            out_df = pd.concat([tract_rows, out_df], ignore_index=True)
        out_df.to_csv(out_path, index=False)
        print(f"[{folder}] wrote {len(out_df)} rows to {out_path}")


if __name__ == "__main__":
    main()
