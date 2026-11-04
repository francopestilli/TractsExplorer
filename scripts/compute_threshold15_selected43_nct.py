#!/usr/bin/env python3
"""Run NCT for threshold-0.15 clusters rebuilt on the specified 43 tracts."""

import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
UI_ROOT = SCRIPT_DIR.parent
WORKSPACE_ROOT = UI_ROOT.parent
SELECTED43_DIR = (
    WORKSPACE_ROOT / "Kims-Revisions" / "data" / "threshold-15_user43"
)
CLUSTER_MAPS = SELECTED43_DIR / "cluster_maps_fsaverage164k.npz"
OUTPUT_DIR = SELECTED43_DIR

sys.path.insert(0, str(SCRIPT_DIR))
import compute_network_correspondence as nct_base  # noqa: E402

import cbig_network_correspondence as cnc  # noqa: E402


NCT_HEMI_VERTICES = 40962
FSAVERAGE_HEMI_VERTICES = 163842
NCT_THRESHOLD = 0.0001
ENDPOINT_DIR = Path(nct_base.TESTDATA) / "thr-15" / "func"


def load_cluster_assignments() -> dict[int, list[str]]:
    assignments = pd.read_csv(SELECTED43_DIR / "cluster_assignments.csv")
    if assignments["tract"].nunique() != 43:
        raise ValueError("Expected 43 unique tracts in the reproduced cluster assignments.")
    clusters = {
        int(cluster_id): group["tract"].tolist()
        for cluster_id, group in assignments.groupby("cluster", sort=True)
    }
    return clusters


def load_atlas_networks(atlas_name: str) -> tuple[np.ndarray, list[str], list[int]]:
    atlas = cnc.compute_overlap_with_atlases.AtlasParams(atlas_name, "fsaverage6")
    atlas.config.space = "fsaverage6"
    data = np.asarray(cnc.compute_overlap_with_atlases.read_atlas(atlas)).reshape(-1)
    if data.shape != (2 * NCT_HEMI_VERTICES,):
        raise ValueError(
            f"{atlas_name} has {len(data)} vertices in NCT space, expected "
            f"{2 * NCT_HEMI_VERTICES}."
        )

    labels = np.unique(data)
    labels = labels[labels != 0].astype(int).tolist()
    names = cnc.visualize_overlap_lib.construct_network_name(atlas_name)
    if len(labels) != len(names):
        raise ValueError(
            f"{atlas_name} has {len(labels)} nonzero labels but {len(names)} network names."
        )
    return data, names, labels


def main() -> None:
    if not CLUSTER_MAPS.is_file():
        raise FileNotFoundError(
            f"{CLUSTER_MAPS} is missing; first run "
            "Kims-Revisions/reproduce_threshold15_selected43_analysis.py."
        )

    clusters = load_cluster_assignments()
    cluster_maps = np.load(CLUSTER_MAPS)
    notebook_maps_fsaverage6: dict[int, np.ndarray] = {}
    for cluster_id in clusters:
        lh = np.asarray(cluster_maps[f"cluster_{cluster_id}_lh"]).reshape(-1)
        rh = np.asarray(cluster_maps[f"cluster_{cluster_id}_rh"]).reshape(-1)
        if (
            lh.shape != (FSAVERAGE_HEMI_VERTICES,)
            or rh.shape != (FSAVERAGE_HEMI_VERTICES,)
        ):
            raise ValueError(f"Cluster {cluster_id} maps do not have fsaverage 164k length.")
        notebook_maps_fsaverage6[cluster_id] = np.concatenate(
            [lh[:NCT_HEMI_VERTICES], rh[:NCT_HEMI_VERTICES]]
        )

    atlas_data = {
        atlas_name: load_atlas_networks(atlas_name)
        for atlas_name in nct_base.ATLASES
    }

    nct_rows = []
    map_provenance_rows = []
    for cluster_id, members in clusters.items():
        vector = nct_base.to_fsaverage6_vector(str(ENDPOINT_DIR), members)
        if vector is None:
            raise ValueError(f"Cluster {cluster_id} has no nonzero endpoint data.")
        binary_cluster = vector > NCT_THRESHOLD
        cluster_vertex_count = int(binary_cluster.sum())
        notebook_vector = notebook_maps_fsaverage6[cluster_id]
        notebook_binary = notebook_vector > NCT_THRESHOLD
        map_provenance_rows.append(
            {
                "cluster": cluster_id,
                "nct_merge_vertices_above_threshold": cluster_vertex_count,
                "notebook_merge_vertices_above_threshold": int(notebook_binary.sum()),
                "n_thresholded_vertex_disagreements": int(
                    np.count_nonzero(binary_cluster != notebook_binary)
                ),
                "n_vertices_with_different_values": int(
                    np.count_nonzero(~np.isclose(vector, notebook_vector, atol=1e-7))
                ),
                "max_absolute_value_difference": float(
                    np.max(np.abs(vector - notebook_vector))
                ),
                "nct_map_merge": (
                    "max across all available LPI/RAS maps per hemisphere"
                ),
                "decoding_map_merge": (
                    "notebook-specific LPI/RAS and tract-hemisphere selection"
                ),
            }
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            toolbox_rows = nct_base.compute_entity(
                f"cluster{cluster_id}",
                vector,
                temp_dir,
            )
        toolbox_by_pair = {
            (row["group"], row["name"]): row
            for row in toolbox_rows
        }
        for atlas_name, (atlas_vector, network_names, labels) in atlas_data.items():
            for network_name, label in zip(network_names, labels):
                binary_network = atlas_vector == label
                network_vertex_count = int(binary_network.sum())
                intersection_count = int(np.count_nonzero(binary_cluster & binary_network))
                denominator = cluster_vertex_count + network_vertex_count
                dice = (2 * intersection_count / denominator) if denominator else 0.0
                max_dice = (
                    2 * min(cluster_vertex_count, network_vertex_count) / denominator
                    if denominator
                    else 0.0
                )
                toolbox_result = toolbox_by_pair[(atlas_name, network_name)]
                if not np.isclose(dice, float(toolbox_result["dice"]), atol=1e-12):
                    raise ValueError(
                        f"Recomputed Dice differs from NCT for cluster {cluster_id}, "
                        f"{atlas_name}/{network_name}: {dice} vs {toolbox_result['dice']}."
                    )
                nct_rows.append(
                    {
                        "cluster": cluster_id,
                        "n_member_tracts": len(members),
                        "atlas": atlas_name,
                        "network": network_name,
                        "n_cluster_vertices_fsaverage6": cluster_vertex_count,
                        "n_network_vertices_fsaverage6": network_vertex_count,
                        "n_intersection_vertices_fsaverage6": intersection_count,
                        "dice": dice,
                        "max_possible_dice": max_dice,
                        "p_value_nct_spin": float(toolbox_result["p_value"]),
                    }
                )
        print(
            f"Cluster {cluster_id}: {len(members)} tracts, "
            f"{cluster_vertex_count} NCT-thresholded fsaverage6 vertices"
        )

    detailed = pd.DataFrame(nct_rows)
    detailed.to_csv(OUTPUT_DIR / "nct_cluster_network_detailed.csv", index=False)
    pd.DataFrame(map_provenance_rows).to_csv(
        OUTPUT_DIR / "nct_map_provenance_comparison.csv",
        index=False,
    )
    for atlas_name in nct_base.ATLASES:
        atlas_rows = detailed[detailed["atlas"] == atlas_name]
        matrix = atlas_rows.pivot(index="cluster", columns="network", values="dice")
        matrix.to_csv(OUTPUT_DIR / f"nct_dice_matrix_{atlas_name}.csv")

    atlas_summary = (
        detailed.groupby("atlas", as_index=False)
        .agg(
            n_clusters=("cluster", "nunique"),
            n_networks=("network", "nunique"),
            n_pairs=("dice", "size"),
            n_pairs_p_lt_0_05=("p_value_nct_spin", lambda x: int((x < 0.05).sum())),
            max_observed_dice=("dice", "max"),
        )
    )
    atlas_summary.to_csv(OUTPUT_DIR / "nct_atlas_summary.csv", index=False)

    print(f"Saved {len(detailed)} cluster-network rows to {OUTPUT_DIR}")
    print(atlas_summary.to_string(index=False))


if __name__ == "__main__":
    main()
