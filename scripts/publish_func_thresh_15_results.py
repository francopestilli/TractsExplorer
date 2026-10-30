#!/usr/bin/env python3
"""Publish the smooth_3 reanalysis tables to the static website data folders."""

from __future__ import annotations

import base64
import csv
import shutil
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = REPO_ROOT.parent
ANALYSIS_ROOT = (
    WORKSPACE_ROOT / "Kims-Revisions" / "data" / "func_thresh_15_reanalysis"
)
SMOOTH_DATA_ROOT = WORKSPACE_ROOT / "smooth_data"

THRESHOLDS = {
    "0.05": ("thr-05", "full_available"),
    "0.10": ("thr-10", "full_available"),
    "0.15": ("thr-15", "full_available"),
    "0.20": ("thr-20", "full_available"),
}
FIXED_43_TARGET = ("0.15", "thr-15_5clusters", "user43")
MODES = ("LPI", "RAS", "joint")
SUMMARY_FIELDS = (
    "threshold",
    "cohort",
    "mode",
    "n_available_tracts",
    "n_complete_tracts",
    "n_incomplete_tracts",
    "n_clusters_at_cut1_32",
    "cophenetic_correlation",
)


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames is None:
            raise ValueError(f"{path} has no CSV header.")
        return list(reader.fieldnames), list(reader)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=fields,
            extrasaction="ignore",
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def threshold_output_dir(cohort: str, threshold: str) -> Path:
    return ANALYSIS_ROOT / cohort / f"threshold-{threshold.replace('.', '-')}"


def get_cohort_members(threshold: str, cohort: str) -> list[str]:
    _, rows = read_csv(ANALYSIS_ROOT / "cohort_membership.csv")
    if cohort == "user43":
        included_field = "included_in_fixed_user43_at_0.15"
    else:
        included_field = "included_in_full_available_cohort"
    members = [
        row["tract"]
        for row in rows
        if float(row["threshold"]) == float(threshold)
        and row[included_field].lower() == "true"
    ]
    return members


def required_maps(tract: str) -> tuple[tuple[str, str], ...]:
    if tract.startswith("left"):
        return (("lh", "LPI"), ("lh", "RAS"))
    if tract.startswith("right"):
        return (("rh", "LPI"), ("rh", "RAS"))
    return (("lh", "LPI"), ("rh", "RAS"))


def gifti_metric(path: Path) -> tuple[dict[str, str], bytes]:
    root = ET.parse(path).getroot()
    arrays = root.findall(".//{*}DataArray")
    if len(arrays) != 1:
        raise ValueError(f"{path} contains {len(arrays)} data arrays; expected one.")
    data_array = arrays[0]
    data_element = data_array.find("{*}Data")
    if data_element is None or data_element.text is None:
        raise ValueError(f"{path} has no encoded data.")
    attributes = data_array.attrib
    encoded = base64.b64decode(data_element.text)
    if attributes.get("Encoding") == "GZipBase64Binary":
        values = zlib.decompress(encoded)
    elif attributes.get("Encoding") == "Base64Binary":
        values = encoded
    else:
        raise ValueError(
            f"{path} uses unsupported GIFTI encoding {attributes.get('Encoding')}."
        )
    return attributes, values


def validate_maps(
    threshold: str,
    surface_folder: str,
    members: list[str],
) -> int:
    source_dir = (
        SMOOTH_DATA_ROOT
        / (
            "1062_cortexmap_binarize_smooth-surf-1_"
            f"threshold-{threshold}_dilate-0"
        )
        / "cortexmap"
        / "func"
    )
    website_func_dir = REPO_ROOT / "testdata" / surface_folder / "func"
    comparisons = 0
    for tract in members:
        for hemi, orientation in required_maps(tract):
            source = (
                source_dir
                / f"{hemi}.{tract}_box_1mm_{orientation}_FiberEndpoint.smooth_3.func.gii"
            )
            website = website_func_dir / f"{hemi}.{tract}.{orientation}.func.gii"
            if not source.is_file() or not website.is_file():
                raise FileNotFoundError(
                    f"Missing required {threshold} map for {tract}: "
                    f"source={source.is_file()}, website={website.is_file()}."
                )
            source_attributes, source_values = gifti_metric(source)
            website_attributes, website_values = gifti_metric(website)
            if (
                source_attributes.get("DataType") != "NIFTI_TYPE_FLOAT32"
                or source_attributes.get("Dim0") != "163842"
                or source_attributes != website_attributes
                or source_values != website_values
            ):
                raise ValueError(
                    f"Website map does not exactly match the source smooth_3 map: "
                    f"{website}."
                )
            comparisons += 1
    return comparisons


def copy_mode_results(
    source_dir: Path,
    destination_dir: Path,
    mode: str,
) -> None:
    copies = {
        f"tract_decoding_{mode}.csv": (
            "matrix.csv" if mode == "joint" else f"matrix_{mode}.csv"
        ),
        f"cluster_assignments_{mode}_cut1-32.csv": (
            f"cluster-assignments_{mode}.csv"
        ),
        f"cluster_decoding_{mode}_cut1-32.csv": (
            "cluster-matrix.csv"
            if mode == "joint"
            else f"cluster-matrix_{mode}.csv"
        ),
        f"dendrogram_{mode}_cut1-32.png": f"dendrogram_{mode}.png",
    }
    for source_name, destination_name in copies.items():
        source = source_dir / source_name
        if not source.is_file():
            raise FileNotFoundError(source)
        shutil.copyfile(source, destination_dir / destination_name)


def publish_threshold(
    threshold: str,
    target_folder: str,
    cohort: str,
    surface_folder: str | None = None,
) -> tuple[int, int]:
    members = get_cohort_members(threshold, cohort)
    expected_count = 43 if cohort == "user43" else 45
    if len(members) != expected_count:
        raise ValueError(
            f"{threshold}/{cohort} has {len(members)} cohort members; "
            f"expected {expected_count}."
        )
    map_comparisons = validate_maps(
        threshold,
        surface_folder or target_folder,
        members,
    )

    source_dir = threshold_output_dir(cohort, threshold)
    destination_dir = REPO_ROOT / "testdata" / target_folder
    for mode in MODES:
        matrix_fields, matrix_rows = read_csv(
            source_dir / f"tract_decoding_{mode}.csv"
        )
        matrix_tracts = [row[matrix_fields[0]] for row in matrix_rows]
        if matrix_tracts != members:
            raise ValueError(
                f"{threshold}/{cohort}/{mode} tract order or membership "
                "does not match the recorded cohort."
            )
        copy_mode_results(source_dir, destination_dir, mode)

    quality_fields, quality_rows = [], []
    summary_rows = []
    _, all_summary_rows = read_csv(
        ANALYSIS_ROOT / "analysis_summary.csv"
    )
    for mode in MODES:
        source_quality_fields, source_quality_rows = read_csv(
            source_dir / f"cluster_quality_{mode}_n2-n8.csv"
        )
        if not quality_fields:
            quality_fields = source_quality_fields
        quality_rows.extend(
            {**row, "quality_file": "cluster-quality.csv"}
            for row in source_quality_rows
        )
        summary_row = next(
            (
                row
                for row in all_summary_rows
                if float(row["threshold"]) == float(threshold)
                and row["cohort"] == cohort
                and row["mode"] == mode
            ),
            None,
        )
        if summary_row is None:
            raise ValueError(f"Missing summary row for {threshold}/{cohort}/{mode}.")
        summary_rows.append({field: summary_row[field] for field in SUMMARY_FIELDS})

    write_csv(destination_dir / "cluster-quality.csv", quality_fields, quality_rows)
    write_csv(
        destination_dir / "analysis-summary.csv",
        list(SUMMARY_FIELDS),
        summary_rows,
    )

    joint_dendrogram = destination_dir / "dendrogram_joint.png"
    shutil.copyfile(joint_dendrogram, destination_dir / "dendro.png")

    nct_path = destination_dir / "network-correspondence.csv"
    nct_fields, nct_rows = read_csv(nct_path)
    current_tract_rows = [
        row
        for row in nct_rows
        if row.get("entity_type") == "tract" and row.get("entity_id") in members
    ]
    write_csv(nct_path, nct_fields, current_tract_rows)

    return len(members), map_comparisons


def main() -> None:
    if not ANALYSIS_ROOT.is_dir() or not SMOOTH_DATA_ROOT.is_dir():
        raise FileNotFoundError(
            "Expected Kims-Revisions reanalysis outputs and sibling smooth_data/."
        )

    reports = []
    for threshold, (folder, cohort) in THRESHOLDS.items():
        count, maps = publish_threshold(threshold, folder, cohort)
        reports.append((threshold, cohort, folder, count, maps))

    threshold, folder, cohort = FIXED_43_TARGET
    count, maps = publish_threshold(
        threshold,
        folder,
        cohort,
        surface_folder="thr-15",
    )
    reports.append((threshold, cohort, folder, count, maps))

    for threshold, cohort, folder, tract_count, map_count in reports:
        print(
            f"{threshold} {cohort} -> testdata/{folder}: "
            f"{tract_count} tracts, {map_count} verified maps"
        )

    print(
        "Published 3 decoding modes, cluster assignments/decodings, "
        "dendrograms, and cluster-quality metrics. Cluster-level NCT rows "
        "were omitted because they were calculated for the previous cluster "
        "partition; tract-level rows were retained for the unchanged maps."
    )


if __name__ == "__main__":
    main()
