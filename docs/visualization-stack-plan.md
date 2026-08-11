# Visualization stack plan

Approved on 2026-08-10.

## Principles

- Agents emit **semantic JSON intents**, never raw SVG/HTML/JS.
- Validators enforce structural and numeric limits before anything renders.
- The router chooses an adapter; the LLM never chooses a library directly.
- External simulations with licensing constraints remain **disabled** until cleared.

## Active adapters

| Intent family | Adapter | Status |
| --- | --- | --- |
| geometry (graphless) | `geometry-svg` | active |
| geometry/function graph mode | `graph2d-jsxgraph` | active |
| equation | `katex` | active |

## Planned adapters

| Intent family | Adapter | Library / stack | Status |
| --- | --- | --- | --- |
| 2D graphs | `graph2d-jsxgraph` | JSXGraph + math.js | next |
| 3D graphs | `graph3d-r3f` | three.js + @react-three/fiber + drei + math.js | planned |
| physics diagrams | `physics-svg` | custom SVG + KaTeX | planned |
| physics 3D | `physics-3d-r3f` | three.js + r3f | planned |
| chemistry 2D | `chemistry-rdkit` | RDKit.js | planned |
| biology diagrams | `biology-svg` | custom SVG + KaTeX | planned |
| biology networks | `biology-network` | Cytoscape.js | planned |
| external simulations | `phet-locked` | PhET / PhET-iO | locked pending license |

## PhET policy

PhET integration is architecturally reserved but **must not be shipped or routed to** until licensing with UC Boulder is confirmed. That includes:

- no embedded production iframe integration,
- no bundled sim assets,
- no PhET-iO wrapper/API integration,
- no product dependency on PhET for core lesson flows.

## 2D graph schema direction

The existing `function` intent remains the canonical 2D graph intent.

Planned/introduced schema additions:

- axis labels: `xLabel`, `yLabel`
- display hints: `showGrid`, `showLegend`
- sampling hints: `sampling.samples`, `sampling.adaptive`
- graph annotations:
  - `point`
  - `root`
  - `extremum`
  - `intersection`
  - `tangent`
  - `area`
  - `asymptote`

## 3D graph schema direction

A new `graph3d` intent is reserved for the future three.js/r3f adapter.

Shape:

- `axes`: labels + `showGrid`
- `domain`: `x`, `y`, optional `z`
- `camera`: `azimuth`, `elevation`, `distance`
- `sampling`: `xSteps`, `ySteps`, `tSteps`, `uSteps`, `vSteps`
- `surfaces`: one or more 3D objects

Supported object kinds in the schema:

- `surface`
- `parametric_surface`
- `parametric_curve`
- `point_cloud`
- `vector_field`

## Build order

1. integrate `math.js`
2. upgrade 2D graph adapter (multi-curve, annotations, styling)
3. scaffold 3D graph adapter with unsupported placeholder already in router
4. add physics SVG intents/adapters
5. add chemistry RDKit adapter
6. add biology SVG + Cytoscape adapters
7. unlock PhET only after license clearance
