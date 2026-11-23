# Website

The landing page (`index.html`) and the explorer (`explorer.html`). There is no build step: Vue 2, PapaParse, pako and three.js load from a CDN, and everything is drawn in the browser from the files in [`data/`](../data/), which must sit next to the pages as `data/` (`npm start` links it; the Pages deploy copies it).

| File | Role |
|---|---|
| `explorer.html` | loads `data/config.json` and `data/lookups.json`, then mounts the viewer |
| `viewer.js` | the main Vue component: views, data loading, interaction |
| `cluster.js` | live hierarchical clustering and the dendrogram |
| `charts.js` | radar chart and word cloud |
| `surf3d.js` | GIFTI parsing and the three.js cortical surface |
| `view-state.js` | parses and builds view links |
| `skai-client.js`, `skai-panel.js` | the SKAI assistant panel |

## View links

`explorer.html` reads these query parameters on load and keeps the address bar in sync, so any copied link reopens the same view. All are optional and invalid values are ignored. The allowed values live in `view` in `data/lookups.json`, which the API's `/view-url` also validates against.

| Parameter | Values | Meaning |
|---|---|---|
| `thr` | folder (`thr-15`), value (`0.15`) or `default` | threshold |
| `tab` | `cluster`, `tract`, `matrix` | which view (a bare `#cluster` hash also works) |
| `cluster` | positive integer | cluster number |
| `tract` | tract id, e.g. `leftArc` | tract |
| `topic` | positive integer | topic to open in the details panel |
| `section` | `map`, `topics`, `charts`, `networks` | section to scroll to |
| `map` | `both`, `RAS`, `LPI`, `bytract` | endpoint map |
| `hemi` | `both`, `lh`, `rh` | hemisphere |
| `view` | `dorsal`, `ventral`, `anterior`, `posterior`, `lateral-left`, `lateral-right`, `medial-left`, `medial-right` | camera angle |
| `atlas` | atlas code, e.g. `AS200Y17` | network atlas |

Example: `explorer.html?thr=0.15&tab=tract&tract=leftArc&atlas=AS200Y17`.
