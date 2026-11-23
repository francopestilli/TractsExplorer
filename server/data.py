import difflib
import json
import math
import re
from pathlib import Path


class NotFound(Exception):
    def __init__(self, error, hint=""):
        super().__init__(error)
        self.error = error
        self.hint = hint


def tract_label(raw, names):
    m = re.match(r"^(left|right)(.+)$", raw, re.I)
    side = m.group(1).lower() if m else None
    rest = (m.group(2) if m else raw).lower()
    base = names.get(rest)
    if base is None:
        base = re.sub(r"^(left|right)", "", raw)
        base = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", base)
        base = base[:1].upper() + base[1:]
    return f"{'L' if side == 'left' else 'R'} {base}" if side else base


def topic_label(raw):
    """viewer.js topicLabel: '102_novel_repetition_priming' -> 'novel repetition priming'."""
    return re.sub(r"^\d+_", "", raw).replace("_", " ")


def topic_id(raw):
    return int(str(raw).split("_")[0])


def _num(x):
    """float, or None for NaN/missing."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) else v


class Repository:
    def __init__(self, root):
        import pandas as pd
        self._pd = pd
        self.root = Path(root)
        self.cfg = json.loads((self.root / "config.json").read_text())
        self.lookups = json.loads((self.root / "lookups.json").read_text())
        self.base = self.root / "thresholds"
        self._thresholds = self.cfg["thresholds"]
        self._default_folder = self.cfg["defaultThreshold"]
        self._cache = {}
        self._topic_terms = None

    # ---- thresholds -------------------------------------------------
    def _ids(self):
        return list(self._thresholds)

    def resolve_threshold(self, x):
        valid = ", ".join(self._ids())
        if x is None or str(x).strip() in ("", "default"):
            return self._default_folder
        x = str(x).strip()
        if x in self._ids():
            return x
        if re.fullmatch(r"\d*\.?\d+", x):
            n = float(x)
            if float(self._thresholds[self._default_folder]["value"]) == n:
                return self._default_folder
            for folder, e in self._thresholds.items():
                if float(e["value"]) == n:
                    return folder
        raise NotFound(f"Unknown threshold '{x}'.",
                       f"Valid thresholds: {valid}, or a numeric value, or 'default'.")

    def thresholds(self):
        out = []
        for folder, e in self._thresholds.items():
            f = self._frames(folder)
            out.append({"id": folder, "label": e["label"], "value": e["value"],
                        "default": folder == self._default_folder,
                        "tracts": len(f["assign"]), "clusters": len(set(f["assign"].values()))})
        return out

    def _frames(self, thr):
        if thr in self._cache:
            return self._cache[thr]
        if thr not in self._ids():
            self.resolve_threshold(thr)  # raises NotFound
        pd = self._pd
        d = self.base / thr
        mats = {}
        for key, name in (("joint", "matrix.csv"), ("RAS", "matrix_RAS.csv"), ("LPI", "matrix_LPI.csv")):
            mats[key] = pd.read_csv(d / name, index_col=0)
        cm = pd.read_csv(d / "cluster-matrix.csv", index_col=0)
        a = pd.read_csv(d / "cluster-assignments_joint.csv")
        assign = {r.tract: int(r.cluster) for r in a.itertuples()}
        net = pd.read_csv(d / "network-correspondence.csv", dtype={"entity_id": str})
        f = {"mats": mats, "cm": cm, "assign": assign, "net": net}
        self._cache[thr] = f
        return f

    # ---- helpers ----------------------------------------------------
    def _label(self, name):
        return tract_label(name, self.lookups["tractNames"])

    @staticmethod
    def _top(row, n):
        """Top n topics ranked by |r| descending (as the explorer does); r keeps its sign."""
        items = [(c, _num(v)) for c, v in row.items()]
        items = [(c, v) for c, v in items if v is not None]
        items.sort(key=lambda cv: -abs(cv[1]))  # stable, like the explorer's JS sort
        return [{"id": topic_id(c), "label": topic_label(c), "r": v} for c, v in items[:n]]

    def _tract_names(self, thr):
        return list(self._frames(thr)["mats"]["joint"].index)

    def resolve_tract(self, thr, name):
        """Canonical tract name (case-insensitive match), or NotFound with suggestions."""
        names = self._tract_names(thr)
        if name in names:
            return name
        low = {n.lower(): n for n in names}
        if name.lower() in low:
            return low[name.lower()]
        labels = {self._label(n): n for n in names}
        hits = []
        for c in difflib.get_close_matches(name, names, n=3) + \
                [labels[x] for x in difflib.get_close_matches(name, list(labels), n=3)]:
            if c not in hits:
                hits.append(c)
        q = name.lower()
        for n in names:
            if n not in hits and (q in n.lower() or q in self._label(n).lower()):
                hits.append(n)
        hint = ("Did you mean: " + ", ".join(hits) + "?") if hits else \
            "Use find_tracts to search for a tract name."
        raise NotFound(f"Unknown tract '{name}' at {thr}.", hint)

    def cluster_ids(self, thr):
        return sorted(set(self._frames(thr)["assign"].values()))

    def atlases(self, thr):
        """Network atlases at this threshold, in file order."""
        return list(dict.fromkeys(self._frames(thr)["net"]["group"]))

    # ---- clusters ---------------------------------------------------
    def clusters(self, thr):
        f = self._frames(thr)
        out = []
        for c in self.cluster_ids(thr):
            out.append({"cluster": c,
                        "tracts": sorted(t for t, k in f["assign"].items() if k == c),
                        "top_topics": self._top(f["cm"].loc[c], 5)})
        return out

    def cluster(self, thr, n, atlas=None, limit=10):
        f = self._frames(thr)
        n = int(n)
        if n not in self.cluster_ids(thr):
            raise NotFound(f"Unknown cluster {n} at {thr}.",
                           "Valid clusters: " + ", ".join(map(str, self.cluster_ids(thr))))
        return {"cluster": n,
                "tracts": sorted(t for t, k in f["assign"].items() if k == n),
                "top_topics": self._top(f["cm"].loc[n], limit),
                "networks": self.networks(thr, "cluster", str(n), atlas)[:limit]}

    # ---- tracts -----------------------------------------------------
    def find_tracts(self, thr, q):
        f = self._frames(thr)
        q = q.strip().lower()
        return [{"tract": n, "label": self._label(n), "cluster": f["assign"].get(n)}
                for n in self._tract_names(thr)
                if q in n.lower() or q in self._label(n).lower()]

    def tract(self, thr, name, atlas=None, limit=10):
        f = self._frames(thr)
        name = self.resolve_tract(thr, name)
        return {"tract": name, "label": self._label(name), "cluster": f["assign"].get(name),
                "top_topics": {k: self._top(f["mats"][k].loc[name], limit) if name in f["mats"][k].index else []
                               for k in ("joint", "RAS", "LPI")},
                "networks": self.networks(thr, "tract", name, atlas)[:limit]}

    # ---- topics -----------------------------------------------------
    def _terms(self):
        if self._topic_terms is None:
            p = self.root / "decoding" / "topic-terms.json"
            self._topic_terms = json.loads(p.read_text())["topics"]
        return self._topic_terms

    def _topic_columns(self):
        return list(self._frames(self._default_folder)["mats"]["joint"].columns)

    def search_topics(self, q):
        q = q.strip().lower()
        terms = self._terms()
        out = []
        for col in self._topic_columns():
            tid = topic_id(col)
            entry = terms.get(str(tid))
            all_terms = [t[0] for t in entry["terms"]] if entry else []
            if q in topic_label(col).lower() or any(q in t.lower() for t in all_terms):
                functional = [t[0] for t in entry["terms"] if t[2] == "Functional"] if entry else []
                out.append({"id": tid, "label": topic_label(col), "terms": functional})
        return out

    def tracts_for_topic(self, thr, topic_id_, limit=10):
        """Tracts ranked by signed r descending (strongest positive association first)."""
        f = self._frames(thr)
        col = next((c for c in f["mats"]["joint"].columns if topic_id(c) == int(topic_id_)), None)
        if col is None:
            raise NotFound(f"Unknown topic {topic_id_}.", "Use search_topics to find topic ids.")
        rows = [(t, _num(v)) for t, v in f["mats"]["joint"][col].items()]
        rows = sorted(((t, v) for t, v in rows if v is not None), key=lambda tv: -tv[1])
        return [{"tract": t, "r": v, "cluster": f["assign"].get(t)} for t, v in rows[:limit]]

    # ---- networks ---------------------------------------------------
    def networks(self, thr, entity_type, entity_id, atlas=None):
        net = self._frames(thr)["net"]
        atlases = self.atlases(thr)
        if atlas is None:
            atlas = sorted(atlases)[0]  # explorer default: first alphabetically
        elif atlas not in atlases:
            raise NotFound(f"Unknown atlas '{atlas}'.", "Available atlases: " + ", ".join(atlases))
        sub = net[(net.entity_type == entity_type) & (net.entity_id == str(entity_id)) & (net.group == atlas)]
        rows = []
        for r in sub.itertuples():
            p = _num(r.p_value)
            rows.append({"name": r.name, "dice": _num(r.dice), "max_dice": _num(r.max_possible_dice),
                         "p_value": p, "significant": p is not None and p <= 0.05})
        rows.sort(key=lambda x: -(x["dice"] if x["dice"] is not None else -1))
        return rows
