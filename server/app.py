"""Read-only HTTP API (for agents).

Run: uvicorn app:app --app-dir server
Env: TE_ROOT (data folder holding config.json), PUBLIC_URL (base for view links), ROOT_PATH (reverse-proxy prefix).
"""
import os
import re
from pathlib import Path
from urllib.parse import quote_plus

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

try:
    from .data import NotFound, Repository
except ImportError:  # run as a top-level module: uvicorn app:app --app-dir server
    from data import NotFound, Repository

ID_RE = re.compile(r"^[A-Za-z0-9_]+$")
POSINT_RE = re.compile(r"^[1-9][0-9]*$")

class BadRequest(Exception):
    def __init__(self, error, hint=""):
        super().__init__(error)
        self.error, self.hint = error, hint


def to_query(params, keys):
    """Port of TEView.toQuery: URLSearchParams encoding, keys in the given order, empties omitted."""
    parts = []
    for k in keys:
        v = params.get(k)
        if v is None or v == "":
            continue
        enc = quote_plus(str(v), safe="*").replace("~", "%7E")
        parts.append(f"{k}={enc}")
    return "?" + "&".join(parts) if parts else ""


def _bad(error, hint):
    return JSONResponse({"error": error, "hint": hint}, status_code=400)


def create_app(root: Path, public_url: str, root_path: str = "") -> FastAPI:
    root = Path(root).resolve()
    public_url = public_url.rstrip("/")
    repo = Repository(root)
    view_keys, enums = repo.lookups["view"]["keys"], repo.lookups["view"]["enums"]
    app = FastAPI(title="TractsExplorer API", docs_url=None, redoc_url=None, openapi_url=None)
    app.root_path = root_path  # set directly: the constructor argument is deprecated
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])

    def view_url(thr=None, **params):
        return public_url + "/explorer.html" + to_query({"thr": thr, **params}, view_keys)

    def check_cluster(thr, n):
        if n not in repo.cluster_ids(thr):
            raise NotFound(f"Unknown cluster '{n}' at {thr}.",
                           "Valid clusters: " + ", ".join(map(str, repo.cluster_ids(thr))))

    def thr_info(thr):
        label = next(t["label"] for t in repo.thresholds() if t["id"] == thr)
        return {"id": thr, "label": label}

    # ---- error shapes -------------------------------------------------
    @app.exception_handler(NotFound)
    async def _nf(request, exc):
        return JSONResponse({"error": exc.error, "hint": exc.hint}, status_code=404)

    @app.exception_handler(BadRequest)
    async def _br(request, exc):
        return _bad(exc.error, exc.hint)

    @app.exception_handler(RequestValidationError)
    async def _val(request, exc):
        e = exc.errors()[0]
        where = ".".join(str(x) for x in e["loc"] if x != "query" and x != "path")
        return _bad(f"Invalid parameter '{where}': {e['msg']}.",
                    "limit must be 1-50; cluster and topic ids are positive integers.")

    @app.exception_handler(StarletteHTTPException)
    async def _http(request, exc):
        hint = "See /thresholds for the entry point." if exc.status_code == 404 else ""
        return JSONResponse({"error": "Not found." if exc.status_code == 404 else str(exc.detail),
                             "hint": hint}, status_code=exc.status_code)

    Limit = Query(10, ge=1, le=50)

    # ---- API ------------------------------------------------------------
    @app.get("/thresholds")
    def thresholds():
        return {"thresholds": repo.thresholds()}

    @app.get("/topics")
    def topics(q: str = Query(..., min_length=1)):
        return {"topics": repo.search_topics(q)}

    @app.get("/view-url")
    def view_url_route(request: Request):
        q = request.query_params
        out = {"thr": repo.resolve_threshold(q.get("thr"))}
        for k in view_keys[1:]:
            if k not in q:
                continue
            v = q[k]
            if k in enums:
                if v not in enums[k]:
                    raise BadRequest(f"Invalid {k} '{v}'.", f"{k} must be one of: {', '.join(enums[k])}.")
                out[k] = v
            elif k in ("cluster", "topic"):
                if not POSINT_RE.match(v):
                    raise BadRequest(f"Invalid {k} '{v}'.", f"{k} must be a positive integer.")
                out[k] = int(v)
            else:
                if not ID_RE.match(v):
                    raise BadRequest(f"Invalid {k} '{v}'.", f"{k} may only contain letters, digits and underscores.")
                out[k] = v
        # The value is well-formed; now check it exists at this threshold.
        t = out["thr"]
        if "tract" in out:
            out["tract"] = repo.resolve_tract(t, out["tract"])
        if "cluster" in out:
            check_cluster(t, out["cluster"])
        if "atlas" in out and out["atlas"] not in repo.atlases(t):
            raise NotFound(f"Unknown atlas '{out['atlas']}' at {t}.",
                           "Available atlases: " + ", ".join(repo.atlases(t)))
        return {"threshold": thr_info(out["thr"]),
                "view_url": public_url + "/explorer.html" + to_query(out, view_keys)}

    @app.get("/{thr}/clusters")
    def clusters(thr: str, atlas: str | None = None):
        t = repo.resolve_threshold(thr)
        items = repo.clusters(t)
        for c in items:
            c["view_url"] = view_url(t, tab="cluster", cluster=c["cluster"], atlas=atlas)
        return {"threshold": thr_info(t), "clusters": items}

    @app.get("/{thr}/clusters/{n}")
    def cluster(thr: str, n: int, atlas: str | None = None, limit: int = Limit):
        t = repo.resolve_threshold(thr)
        r = repo.cluster(t, n, atlas, limit)
        return {"threshold": thr_info(t), **r,
                "view_url": view_url(t, tab="cluster", cluster=n, atlas=atlas)}

    @app.get("/{thr}/tracts")
    def find_tracts(thr: str, q: str = Query(..., min_length=1)):
        t = repo.resolve_threshold(thr)
        items = repo.find_tracts(t, q)
        for i in items:
            i["view_url"] = view_url(t, tab="tract", tract=i["tract"])
        return {"threshold": thr_info(t), "tracts": items}

    @app.get("/{thr}/tracts/{tract}")
    def tract(thr: str, tract: str, atlas: str | None = None, limit: int = Limit):
        t = repo.resolve_threshold(thr)
        r = repo.tract(t, tract, atlas, limit)
        return {"threshold": thr_info(t), **r,
                "view_url": view_url(t, tab="tract", tract=r["tract"], atlas=atlas)}

    @app.get("/{thr}/topics/{topic_id}/tracts")
    def topic_tracts(thr: str, topic_id: int, limit: int = Limit):
        t = repo.resolve_threshold(thr)
        items = repo.tracts_for_topic(t, topic_id, limit)
        for i in items:
            i["view_url"] = view_url(t, tab="tract", tract=i["tract"])
        return {"threshold": thr_info(t), "topic": topic_id, "tracts": items}

    @app.get("/{thr}/networks")
    def networks(thr: str, entity: str = Query(..., min_length=1), atlas: str | None = None,
                 limit: int = Limit):
        t = repo.resolve_threshold(thr)
        kind, _, ident = entity.partition(":")
        if kind not in ("tract", "cluster") or not ident:
            raise BadRequest(f"Invalid entity '{entity}'.", "Use entity=tract:leftArc or entity=cluster:2.")
        if kind == "tract":
            ident = repo.resolve_tract(t, ident)
            vu = view_url(t, tab="tract", tract=ident, atlas=atlas)
        else:
            check_cluster(t, int(ident) if POSINT_RE.match(ident) else ident)
            vu = view_url(t, tab="cluster", cluster=int(ident), atlas=atlas)
        return {"threshold": thr_info(t), "entity": f"{kind}:{ident}",
                "networks": repo.networks(t, kind, ident, atlas)[:limit], "view_url": vu}

    return app


app = create_app(
    Path(os.environ.get("TE_ROOT") or Path(__file__).resolve().parents[1] / "data"),
    os.environ.get("PUBLIC_URL", "http://localhost:8000"),
    os.environ.get("ROOT_PATH", ""),
)
