import warnings
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import pytest

with warnings.catch_warnings():
    # starlette warns that its httpx-based TestClient is deprecated; the replacement
    # (httpx2) is not installed here, so silence only that import-time notice.
    warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient`")
    from fastapi.testclient import TestClient

from server.app import create_app

ROOT = Path(__file__).resolve().parents[2] / "data"
PUB = "https://x.test/te"
KEYS = ["thr", "tab", "cluster", "tract", "topic", "section", "map", "hemi", "view", "atlas"]


@pytest.fixture(scope="module")
def client():
    return TestClient(create_app(ROOT, PUB))


def test_thresholds(client):
    items = client.get("/thresholds").json()["thresholds"]
    assert len(items) == 5
    defaults = [i for i in items if i["default"]]
    assert len(defaults) == 1 and defaults[0]["id"] == "thr-15"


def test_clusters(client):
    r = client.get("/0.15/clusters").json()
    assert r["threshold"]["id"] == "thr-15"
    assert len(r["clusters"]) == 4
    for c in r["clusters"]:
        assert c["view_url"].startswith(PUB + "/explorer.html?thr=thr-15&tab=cluster&cluster=")


def test_cluster_detail_and_unknown(client):
    r = client.get("/default/clusters/1?limit=3").json()
    assert r["view_url"] == PUB + "/explorer.html?thr=thr-15&tab=cluster&cluster=1"
    assert len(r["top_topics"]) == 3
    bad = client.get("/default/clusters/99")
    assert bad.status_code == 404 and bad.json()["hint"]


def test_tract_detail(client):
    r = client.get("/default/tracts/leftArc?atlas=TY7")
    assert r.status_code == 200
    b = r.json()
    assert "joint" in b["top_topics"] and b["networks"] and b["threshold"]["id"] == "thr-15"
    assert b["view_url"] == PUB + "/explorer.html?thr=thr-15&tab=tract&tract=leftArc&atlas=TY7"


def test_unknown_tract_404(client):
    r = client.get("/thr-15/tracts/arcuate")
    assert r.status_code == 404
    assert "leftArc" in r.json()["hint"]


def test_unknown_threshold_404(client):
    r = client.get("/9.9/clusters")
    assert r.status_code == 404 and set(r.json()) == {"error", "hint"}


def test_find_tracts_and_topics(client):
    r = client.get("/default/tracts?q=arc").json()
    assert r["tracts"] and all(t["view_url"].startswith(PUB + "/explorer.html?thr=thr-15&tab=tract&tract=") for t in r["tracts"])
    t = client.get("/topics?q=language").json()
    assert "threshold" not in t and t["topics"]
    tid = t["topics"][0]["id"]
    r = client.get(f"/default/topics/{tid}/tracts?limit=2").json()
    assert len(r["tracts"]) == 2 and "view_url" in r["tracts"][0] and r["threshold"]["id"] == "thr-15"


def test_networks(client):
    r = client.get("/default/networks?entity=tract:leftArc&atlas=TY7").json()
    assert r["networks"] and r["view_url"].endswith("tab=tract&tract=leftArc&atlas=TY7")
    r = client.get("/default/networks?entity=cluster:2").json()
    assert "tab=cluster&cluster=2" in r["view_url"]


def test_bad_inputs_400(client):
    for url in ["/default/clusters/1?limit=0", "/default/clusters/1?limit=51",
                "/default/networks?entity=bogus", "/default/networks",
                "/view-url?tab=nope", "/default/clusters/abc"]:
        r = client.get(url)
        assert r.status_code == 400, url
        assert set(r.json()) == {"error", "hint"}


def parse_back(url):
    return dict(parse_qsl(urlsplit(url).query))


def test_view_url(client):
    body = client.get("/view-url?thr=0.10&cluster=2&atlas=TY7").json()
    assert body["threshold"]["id"] == "thr-10"
    u = body["view_url"]
    assert u == PUB + "/explorer.html?thr=thr-10&cluster=2&atlas=TY7"
    assert parse_back(u) == {"thr": "thr-10", "cluster": "2", "atlas": "TY7"}
    # key order is fixed regardless of request order
    u = client.get("/view-url?atlas=TY7&tab=tract&tract=leftArc&thr=default&hemi=lh").json()["view_url"]
    assert urlsplit(u).query == "thr=thr-15&tab=tract&tract=leftArc&hemi=lh&atlas=TY7"
    body = client.get("/view-url?cluster=1").json()
    assert body["threshold"]["id"] == "thr-15"
    assert body["view_url"] == PUB + "/explorer.html?thr=thr-15&cluster=1"
    assert client.get("/view-url").json()["view_url"] == PUB + "/explorer.html?thr=thr-15"
    r = client.get("/view-url?thr=9.9")
    assert r.status_code == 404 and set(r.json()) == {"error", "hint"}


def test_view_url_checks_entities(client):
    # tract names are canonicalised, like the tract routes
    body = client.get("/view-url?tab=tract&tract=leftarc").json()
    assert parse_back(body["view_url"])["tract"] == "leftArc"
    for url, hint in [("/view-url?tract=arcuate", "leftArc"),
                      ("/view-url?cluster=99", "Valid clusters"),
                      ("/view-url?atlas=NOPE", "TY7")]:
        r = client.get(url)
        assert r.status_code == 404, url
        assert set(r.json()) == {"error", "hint"} and hint in r.json()["hint"], url


def test_static_files_are_not_served(client):
    for p in ["/", "/explorer.html", "/view-state.js", "/config.json", "/assets/img/mark.svg",
              "/data/thresholds/thr-15/matrix.csv", "/thresholds/thr-15/matrix.csv", "/server/app.py", "/.git/config",
              "/package.json", "/scripts/x", "/tests/x",
              "/assets/../server/app.py", "/..%2fserver/app.py", "/%2e%2e/server/app.py",
              "/assets/%2e%2e/server/app.py", "/server%2fapp.py", "/nope.html"]:
        assert client.get(p).status_code == 404, p


def test_cors(client):
    r = client.get("/thresholds", headers={"Origin": "https://other.test"})
    assert r.headers["access-control-allow-origin"] == "*"


def test_root_path_prefix():
    c = TestClient(create_app(ROOT, PUB, root_path="/tractexplorer"))
    assert c.get("/thresholds").status_code == 200
    assert c.get("/tractexplorer/thresholds").status_code == 200
    assert c.get("/tractexplorer/explorer.html").status_code == 404
    assert c.get("/tractexplorer").status_code == 404
