import json
import pathlib

import pandas as pd
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2] / "data"
CFG = json.loads((ROOT / "config.json").read_text())
LOOKUPS = json.loads((ROOT / "lookups.json").read_text())
FOLDERS = list(CFG["thresholds"])


def folder_dir(folder):
    return ROOT / "thresholds" / folder


def func_dir(folder):
    return folder_dir(CFG["thresholds"][folder].get("func", folder)) / "func"


def matrix(folder, name="matrix.csv"):
    return pd.read_csv(folder_dir(folder) / name, index_col=0)


def networks(folder):
    return pd.read_csv(folder_dir(folder) / "network-correspondence.csv", dtype={"entity_id": str})


def assignments(folder):
    return pd.read_csv(folder_dir(folder) / "cluster-assignments_joint.csv")


@pytest.mark.parametrize("folder", FOLDERS)
def test_endpoint_maps_match_manifest(folder):
    d = func_dir(folder)
    manifest = json.loads((d / "manifest.json").read_text())
    listed = {f"{hemi}.{tract}.{o}.func.gii"
              for tract, hemis in manifest.items() for hemi, orients in hemis.items() for o in orients}
    on_disk = {p.name for p in d.glob("*.func.gii")}
    assert listed - on_disk == set(), "manifest lists missing files"
    assert on_disk - listed == set(), "files not in the manifest"
    no_maps = [t for t in matrix(folder).index if not any(manifest.get(t, {}).values())]
    assert no_maps == [], "tracts in matrix.csv without endpoint maps"


@pytest.mark.parametrize("folder", FOLDERS)
def test_matrices_share_tracts_and_topics(folder):
    joint = matrix(folder)
    for name in ("matrix_RAS.csv", "matrix_LPI.csv"):
        m = matrix(folder, name)
        assert list(m.columns) == list(joint.columns), name
        assert set(m.index) == set(joint.index), name
    assert list(matrix(folder, "cluster-matrix.csv").columns) == list(joint.columns)


@pytest.mark.parametrize("folder", FOLDERS)
def test_topics_have_terms(folder):
    terms = json.loads((ROOT / "decoding" / "topic-terms.json").read_text())["topics"]
    missing = [c for c in matrix(folder).columns if c.split("_")[0] not in terms]
    assert missing == []


@pytest.mark.parametrize("folder", FOLDERS)
def test_clusters_cover_complete_tracts(folder):
    a = assignments(folder)
    assert set(a.tract) == set(matrix(folder).dropna().index), "clustered tracts != tracts with no missing scores"
    assert sorted(matrix(folder, "cluster-matrix.csv").index) == sorted(set(a.cluster))


@pytest.mark.parametrize("folder", FOLDERS)
def test_network_correspondence(folder):
    n, m = networks(folder), matrix(folder)
    atlases = {a["code"] for a in json.loads((ROOT / "atlases" / "index.json").read_text())["atlases"]}
    assert set(n.group) <= atlases
    tracts = set(n[n.entity_type == "tract"].entity_id)
    assert tracts <= set(m.index)
    assert set(m.index) - tracts <= set(m.index[m.isna().any(axis=1)])
    clusters = set(n[n.entity_type == "cluster"].entity_id)
    assert clusters == {str(c) for c in assignments(folder).cluster}
    assert n.dice.between(0, 1).all() and n.p_value.dropna().between(0, 1).all()
    assert (n.dice <= n.max_possible_dice + 1e-9).all()


def test_every_tract_has_a_display_name():
    names = LOOKUPS["tractNames"]
    tracts = {t for f in FOLDERS for t in matrix(f).index}
    unnamed = sorted(t for t in tracts if t.lower().removeprefix("left").removeprefix("right") not in names)
    assert unnamed == []


def test_atlases_and_mesh():
    index = {a["code"] for a in json.loads((ROOT / "atlases" / "index.json").read_text())["atlases"]}
    assert index == {p.stem for p in (ROOT / "atlases").glob("*.json")} - {"index"}
    for hemi in ("lh", "rh"):
        for name in ("midthickness.fsaverage.surf.gii", "roi.shape.gii", "thickness.shape.gii"):
            assert (ROOT / "surf" / "mesh" / f"{hemi}.{name}").is_file()
