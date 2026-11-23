# WMC Tract Endpoint Decoding Viewer

Interactive visualization of how the cortical endpoints of white matter tracts map onto meta-analytic cognitive topics (NeuroQuery LDA topics, decoded with the [gradec](https://gradec.readthedocs.io/en/latest/index.html) toolbox), built for [brainlife.io](https://brainlife.io). Tracts are defined as in [Bullock et al., 2022](https://academic.oup.com/cercor/article/32/20/4524/6528900), using its [brainlife.io app](https://brainlife.io/app/5cc73ef44ed9df00317f6288).

**Live:** published from this repo ([francopestilli/TractsExplorer](https://github.com/francopestilli/TractsExplorer)): a landing page (`static/index.html`) linking to the tool (`static/explorer.html`). Everything is drawn live in the browser from the CSV and GIFTI files in [`data/`](data/).

## What it shows

- **Cluster View**: a live dendrogram of tract similarity; each cluster's member tracts, 3D cortical endpoint map, top topics, radar chart and word cloud; cluster-quality statistics.
- **Tract View**: 3D RAS and LPI endpoint maps, and the joint, RAS-only and LPI-only decodings side by side.
- **Full Matrix**: the tract × topic heatmap.
- **Topic details**: each topic's full 40-term list with LDA weights and term types.
- **Network Correspondence**: Dice overlap with six canonical network atlases, with spin-test significance, via the [Network Correspondence Toolbox](https://github.com/rubykong/cbig_network_correspondence).

## Data

[`data/`](data/) holds the complete published results: decoding matrices, cluster assignments and quality, network correspondence, endpoint maps and figures for each threshold. Its [README](data/README.md) describes the files, how to regenerate them, and how to add a threshold.

## Running locally

```bash
npm install
npm start          # http://localhost:3000
```

`npm start` links `data/` into `static/` and serves it. Opening the HTML files from disk does not work, because the browser blocks loading the data.

The website and its view links are described in [static/README.md](static/README.md), and the read-only JSON API in [server/README.md](server/README.md).

## Tests

```bash
python3 -m venv server/.venv                                   # once; a venv keeps global pytest plugins out
server/.venv/bin/pip install -r server/requirements-dev.txt   # once
server/.venv/bin/python -m pytest tests/server -W error
npm test
```

On pushes to `main`, GitHub Actions runs the tests and deploys `static/` plus `data/` to GitHub Pages (**Settings → Pages → Source: GitHub Actions**).

## Repository layout

| Path | Contents |
|---|---|
| [`static/`](static/README.md) | the website: landing page and explorer, with no build step |
| [`data/`](data/README.md) | configuration, lookup tables and published data, shared by the website and the API |
| [`server/`](server/README.md) | read-only JSON API |
| `scripts/` | offline scripts that build `data/` from the analysis outputs |
| `tests/` | tests for `server/` (`tests/server`) and `static/` (`tests/static`) |

## Credits

Developed by Kim Ray, University of Texas at Austin (Pestilli Lab). Supported by the [brainlife.io](https://brainlife.io) platform.

This tool accompanies:

> Human white matter tracts aligned with canonical functional brain networks
> Kimberly L. Ray, Sohmee Kim, Karen Herrera, Suna Guo, Daniela Reyes, Julio A. Peraza, Anna Bostoganashvili, Gabriele Amorosino, Angela R. Laird, Franco Pestilli
> doi: [10.64898/2026.05.20.726546](https://doi.org/10.64898/2026.05.20.726546)

Topic decoding uses [gradec](https://gradec.readthedocs.io/en/latest/index.html):

> Methods for decoding cortical gradients of function
> Julio A. Peraza, et al., 2024
> doi: [10.1162/imag_a_00081](https://direct.mit.edu/imag/article/doi/10.1162/imag_a_00081/119100/Methods-for-decoding-cortical-gradients-of)
