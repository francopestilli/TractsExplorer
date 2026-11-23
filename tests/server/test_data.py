import json
import pathlib

import pandas as pd
import pytest
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import pdist

from server.data import NotFound, Repository

ROOT = pathlib.Path(__file__).resolve().parents[2] / "data"
CFG = json.loads((ROOT / "config.json").read_text())


@pytest.fixture(scope="module")
def repo():
    return Repository(ROOT)


def test_resolve_threshold(repo):
    assert repo.resolve_threshold(None) == "thr-15"
    assert repo.resolve_threshold("default") == "thr-15"
    assert repo.resolve_threshold("0.15") == "thr-15"
    assert repo.resolve_threshold("0.1") == "thr-10"
    assert repo.resolve_threshold("thr-15_5clusters") == "thr-15_5clusters"
    with pytest.raises(NotFound) as e:
        repo.resolve_threshold("0.99")
    assert "thr-10" in e.value.hint


def test_thresholds_listing(repo):
    rows = {r["id"]: r for r in repo.thresholds()}
    assert rows["thr-15"]["default"] is True
    assert rows["thr-10"]["default"] is False
    assert rows["thr-15"]["clusters"] == 4
    assert rows["thr-15"]["tracts"] > 0


def test_cluster_counts(repo):
    assert len(repo.clusters("thr-15")) == 4
    assert len(repo.clusters("thr-15_5clusters")) == 5


@pytest.mark.parametrize("folder", list(CFG["thresholds"]))
def test_cluster_numbering_matches_scipy(folder):
    entry = CFG["thresholds"][folder]
    d = ROOT / "thresholds" / folder
    m = pd.read_csv(d / "matrix.csv", index_col=0).dropna()
    labels = fcluster(linkage(pdist(m.values, "correlation"), method="complete"),
                      t=entry["cut"], criterion="distance")
    expected = dict(zip(m.index, (int(x) for x in labels)))
    got = pd.read_csv(d / "cluster-assignments_joint.csv").set_index("tract")["cluster"].to_dict()
    assert expected == got


def test_tract(repo):
    csv = pd.read_csv(ROOT / "thresholds/thr-15/cluster-assignments_joint.csv").set_index("tract")
    t = repo.tract("thr-15", "leftArc")
    assert t["cluster"] == int(csv.loc["leftArc", "cluster"])
    joint = t["top_topics"]["joint"]
    assert len(joint) == 10
    assert [abs(x["r"]) for x in joint] == sorted((abs(x["r"]) for x in joint), reverse=True)
    assert set(t["top_topics"]) == {"joint", "RAS", "LPI"}
    json.dumps(t, allow_nan=False)


def test_unknown_tract(repo):
    with pytest.raises(NotFound) as e:
        repo.tract("thr-15", "arcuate")
    assert "leftArc" in e.value.hint


def test_find_tracts(repo):
    names = {r["tract"] for r in repo.find_tracts("thr-15", "arc")}
    assert {"leftArc", "rightArc"} <= names
    assert {r["tract"] for r in repo.find_tracts("thr-15", "arcuate")} >= {"leftArc"}


def test_networks(repo):
    nets = repo.networks("thr-15", "tract", "leftArc", "TY7")
    assert nets
    assert all(n["max_dice"] >= n["dice"] for n in nets)
    assert [n["dice"] for n in nets] == sorted((n["dice"] for n in nets), reverse=True)
    assert all(n["significant"] == (n["p_value"] <= 0.05) for n in nets)
    with pytest.raises(NotFound) as e:
        repo.networks("thr-15", "tract", "leftArc", "NOPE")
    assert "TY7" in e.value.hint


def test_cluster_detail(repo):
    c = repo.cluster("thr-15", 1, atlas="TY7", limit=3)
    assert c["tracts"] and c["top_topics"] and len(c["networks"]) <= 3
    with pytest.raises(NotFound):
        repo.cluster("thr-15", 99)


def test_topics(repo):
    found = repo.search_topics("language")
    assert found
    rows = repo.tracts_for_topic("thr-15", found[0]["id"])
    assert rows and [r["r"] for r in rows] == sorted((r["r"] for r in rows), reverse=True)
    with pytest.raises(NotFound):
        repo.tracts_for_topic("thr-15", 999999)


def test_top_topics_rank_by_abs_r(repo):
    m = pd.read_csv(ROOT / "thresholds/thr-15/matrix.csv", index_col=0)
    checked = 0
    for name, row in m.iterrows():
        row = row.dropna()
        by_abs = {int(c.split("_")[0]) for c in row.abs().sort_values(ascending=False, kind="stable").index[:10]}
        by_signed = {int(c.split("_")[0]) for c in row.sort_values(ascending=False).index[:10]}
        if by_abs != by_signed:
            got = {x["id"] for x in repo.tract("thr-15", name)["top_topics"]["joint"]}
            assert got == by_abs
            assert any(x["r"] < 0 for x in repo.tract("thr-15", name)["top_topics"]["joint"])
            checked += 1
    assert checked > 0


def test_default_atlas_is_alphabetical_first(repo):
    default = repo.networks("thr-15", "tract", "leftArc")
    assert default == repo.networks("thr-15", "tract", "leftArc", "AS200Y17")
