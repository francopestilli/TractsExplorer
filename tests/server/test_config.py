import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2] / "data"

def test_config_matches_published_folders():
    cfg = json.loads((ROOT / "config.json").read_text())
    assert set(cfg["thresholds"]) == {"thr-05", "thr-10", "thr-15", "thr-15_5clusters", "thr-20"}
    assert cfg["defaultThreshold"] == "thr-15"
    for folder, v in cfg["thresholds"].items():
        assert (ROOT / "thresholds" / folder / "matrix.csv").exists()
        assert isinstance(v["label"], str) and v["label"]
        assert (ROOT / "thresholds" / v.get("func", folder) / "func" / "manifest.json").exists()
        assert isinstance(v["value"], float)
