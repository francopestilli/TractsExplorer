# API server

A small FastAPI app serving a read-only JSON API over [`data/`](../data/). SKAI, brainlife's assistant, uses it to answer questions about the results and to link to explorer views. It does not serve the website. It needs Python 3.10 or newer.

Run it from the repository root:

```bash
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
server/.venv/bin/uvicorn app:app --app-dir server      # http://localhost:8000/thresholds
```

With Docker, the image holds the server and only the data files it reads (`config.json`, `lookups.json`, the threshold CSVs and `decoding/topic-terms.json`):

```bash
docker build -t tractsexplorer .
docker run --rm -p 8000:8000 -e PUBLIC_URL=https://your-site.example tractsexplorer
```

| Env var | Default | Purpose |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8000` | base of the `view_url` links the API returns (e.g. `https://brainlife.io/tractexplorer`) |
| `ROOT_PATH` | empty | path prefix, when the reverse proxy passes it through (leave empty if the proxy strips it) |
| `TE_ROOT` | `data/` | folder holding `config.json`, `lookups.json`, `thresholds/` and `decoding/topic-terms.json` |

Behind a reverse proxy, run uvicorn with `--proxy-headers` and `--forwarded-allow-ips` set to the proxy. `thresholds/` may be a symlink, e.g. to a data volume.

## Endpoints

All responses are JSON. Responses for one threshold include a `threshold` object (`id`, `label`), and cluster and tract results include a `view_url` that opens the matching view in the explorer (`PUBLIC_URL` + `/explorer.html?...`).

| Endpoint | Returns |
|---|---|
| `GET /thresholds` | each threshold's `id` (folder), `label`, `value`, whether it is the `default`, and its clustered tract and cluster counts |
| `GET /topics?q=` | topics whose label or LDA terms match a keyword |
| `GET /view-url?thr=&tab=&cluster=&tract=&...` | a validated explorer link; parameters as in the explorer's [view links](../static/README.md#view-links), and an unknown tract, cluster or atlas is a 404 |
| `GET /{thr}/clusters` | the clusters |
| `GET /{thr}/clusters/{n}?atlas=&limit=` | one cluster: member tracts, top topics, networks |
| `GET /{thr}/tracts?q=` | find tracts by id or label (`leftArc`, `arcuate`, `L Arcuate`) |
| `GET /{thr}/tracts/{tract}?atlas=&limit=` | one tract: cluster, top topics (joint, RAS, LPI), networks |
| `GET /{thr}/topics/{topic_id}/tracts?limit=` | tracts ranked by match to a topic |
| `GET /{thr}/networks?entity=tract:leftArc&atlas=&limit=` | Dice overlap with atlas networks (`entity=cluster:2` also works) |

- `{thr}` is a folder (`thr-15`), a value (`0.15`) or `default`, which is `defaultThreshold` in `data/config.json`.
- Tract labels come from `tractNames` in `data/lookups.json`, the same names the explorer shows.
- Top topics are ranked by |r|, keeping the sign; `topics/{id}/tracts` is ranked by signed r. `limit` is 1–50, default 10.
- Without `atlas`, the alphabetically first atlas is used. A network is significant when p ≤ 0.05.
- Errors are `{"error": ..., "hint": ...}`, with 400 for a malformed parameter and 404 for anything unknown, including paths that are not endpoints.

## Code and tests

`app.py` defines the routes and validates view-link parameters against `data/lookups.json`. `data.py` reads the threshold CSVs and topic terms and caches each threshold after its first use.

```bash
server/.venv/bin/pip install -r server/requirements-dev.txt
server/.venv/bin/python -m pytest tests/server -W error
```
