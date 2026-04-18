---
name: excalidraw
description: "Generate Excalidraw diagrams from natural language descriptions. Use when asked to specifically create Excalidraw diagrams. Supports flowcharts, relationship diagrams, mind maps, and system architecture diagrams. Outputs .excalidraw JSON files that can be opened directly in Excalidraw."
---

# Excalidraw Diagram Generator

A skill for generating Excalidraw-format diagrams from natural language descriptions. This skill helps create visual representations of processes, systems, relationships, and ideas without manual drawing.

## When to Use

When the user requests a diagram, flowchart, architecture diagram, ERD, sequence-style diagram, or any visual that should be an `.excalidraw` file.

## Workflow

1. Analyse requirements — determine elements, connections, and layout
2. Write a `.mjs` file that builds an array of `ExcalidrawElementSkeleton` objects and `export default`s it
3. Run the converter to produce a valid `.excalidraw` file

```bash
node ~/.config/opencode/skills/excalidraw/dist/convert.mjs </tmp/diagram.mjs> <output.excalidraw>
```

The converter dynamically imports the `.mjs` file, passes the exported skeleton array through `convertToExcalidrawElements` from `@excalidraw/excalidraw`, and wraps the result in the `.excalidraw` file format.

4. Verify the output — render to PNG and visually inspect
5. After everything is verified and satisfactory, run `open /tmp/<last-iteration-preview>.png` to show the preview to the user

### Verification

After generating the `.excalidraw` file, render it to PNG and visually inspect:

```bash
~/.config/opencode/skills/excalidraw/dist/preview <output.excalidraw> /tmp/<name>-preview.png
```

Then use the `Read` tool on `/tmp/<name>-preview.png` to view the rendered image. Check:

1. **Renders correctly** — all elements visible, no overlapping text or shapes, arrows connect to the right nodes, layout is readable
2. **Factually correct** — all entities and relationships from the user's request are present, labels match the user's intent, nothing is missing or misrepresented

If either check fails, fix the `.mjs` source file, re-run the converter and preview, and re-inspect. Retry up to 3 times before reporting remaining issues to the user.

### Why JavaScript, not JSON

The skeleton API is JS-native. Writing a `.mjs` file lets you use variables for layout constants, loops for repeated elements, computed positions, and helper functions — all of which produce cleaner, more maintainable diagrams.

---

## Element Types

### Shapes: `rectangle`, `ellipse`, `diamond`

Required: `type`, `x`, `y`.

```js
{ type: "rectangle", x: 0, y: 0 }
```

Optional styling:

| Property          | Type   | Notes                                                         |
| ----------------- | ------ | ------------------------------------------------------------- |
| `width`           | number | Default ~100                                                  |
| `height`          | number | Default ~100                                                  |
| `backgroundColor` | string | Hex color. Requires `fillStyle` to be visible                 |
| `fillStyle`       | string | `"solid"`, `"hachure"` (default), `"cross-hatch"`, `"zigzag"` |
| `strokeColor`     | string | Hex color, default `"#1e1e1e"`                                |
| `strokeWidth`     | number | `1` (default), `2`, `4`                                       |
| `strokeStyle`     | string | `"solid"` (default), `"dashed"`, `"dotted"`                   |
| `roughness`       | number | `0` (architect/clean), `1` (artist, **Excalidraw default**), `2` (cartoonist) |
| `roundness`       | object | `{ type: 3 }` for rounded corners                             |
| `opacity`         | number | 0–100, default 100                                            |

### Text

Required: `type`, `x`, `y`, `text`.

```js
{ type: "text", x: 0, y: 0, text: "Hello" }
```

Additional properties: `fontSize` (default 20), `fontFamily` (1=Excalifont/hand-drawn **default**, 2=Nunito/clean, 3=Comic Shanns/code), `textAlign` (`"left"`, `"center"`, `"right"`), `strokeColor`.

> **Style consistency**: Always use the same `fontFamily` across all elements. Mixing families (e.g. `1` in some boxes, `2` in others) looks broken. Default to `fontFamily: 1` for the authentic Excalidraw hand-drawn look. Only use `fontFamily: 2` if the user explicitly asks for a clean/polished style — and if unsure, ask before starting.

### Lines & Arrows

Required: `type`, `x`, `y`.

```js
{ type: "arrow", x: 0, y: 0 }
{ type: "line",  x: 0, y: 0 }
```

Additional properties: `width` (horizontal span), `height` (vertical span), `startArrowhead` (`"arrow"`, `"circle"`, `"bar"`, `"triangle"`, `null`), `endArrowhead` (same), plus all common styling props.

### Text Containers (shapes with labels)

Add a `label` property to any shape. If you omit `width`/`height`, dimensions auto-compute from label size.

Required inside `label`: `text`. Optional: `fontSize`, `strokeColor`, `textAlign` (`"left"`, `"center"`, `"right"`), `verticalAlign` (`"top"`, `"middle"`).

```js
{
  type: "rectangle",
  x: 0, y: 0,
  label: { text: "Service A" },
}
```

### Labelled Arrows

Arrows also accept `label`:

```js
{
  type: "arrow",
  x: 0, y: 0,
  label: { text: "HTTP GET" },
}
```

### Arrow Bindings

Bind arrows to shapes using `start` and `end`. Two modes:

**Inline shapes** — creates new shapes automatically:

```js
{
  type: "arrow",
  x: 100, y: 200,
  start: { type: "rectangle" },
  end:   { type: "ellipse" },
}
```

`start`/`end` accept all shape properties including `label`, `width`, `height`, etc.

**By ID** — bind to existing elements (preferred for complex diagrams):

```js
[
  { type: "rectangle", id: "svc-a", x: 0, y: 0, label: { text: "Service A" } },
  {
    type: "rectangle",
    id: "svc-b",
    x: 400,
    y: 0,
    label: { text: "Service B" },
  },
  {
    type: "arrow",
    x: 160,
    y: 50,
    start: { id: "svc-a" },
    end: { id: "svc-b" },
    label: { text: "REST" },
  },
];
```

When using `id` bindings, the arrow's `x`/`y` is the start point and `width`/`height` control span. The library computes exact attachment points.

**Text as binding target** — arrows can also bind to inline text elements:

```js
{
  type: "arrow",
  x: 255, y: 239,
  start: { type: "text", text: "Source" },
  end:   { type: "text", text: "Destination" },
}
```

**Note on `regenerateIds`:** `convertToExcalidrawElements` regenerates all element IDs by default. ID-based bindings (`start: { id: "..." }`) still resolve correctly because bindings are resolved before IDs are regenerated. If you need stable output IDs (e.g., incremental diagram updates), pass `{ regenerateIds: false }` as the second argument.

### Frames

Group elements visually. Required: `type`, `children` (array of element IDs).

```js
[
  { type: "rectangle", id: "r1", x: 10, y: 10 },
  { type: "rectangle", id: "r2", x: 150, y: 10 },
  { type: "frame", children: ["r1", "r2"], name: "Backend" },
];
```

---

## Layout Guide

### Coordinate System

- Origin `(0, 0)` is top-left. X increases right, Y increases down.
- Default shape size is roughly 100x100 when not specified.

### Spacing Rules

Use a grid-based layout. Define constants at the top of your `.mjs` file:

```js
const SHAPE_W = 180; // standard shape width
const SHAPE_H = 80; // standard shape height
const GAP_X = 100; // horizontal gap between shapes
const GAP_Y = 80; // vertical gap between rows
const COL_STRIDE = SHAPE_W + GAP_X; // 280 — column step
const ROW_STRIDE = SHAPE_H + GAP_Y; // 160 — row step
```

### Flowcharts (top-to-bottom)

Place decision/process nodes in rows. Center each row horizontally.

```
Row 0:  y = 0                     (start / trigger)
Row 1:  y = ROW_STRIDE            (process steps)
Row 2:  y = ROW_STRIDE * 2        (decisions / branching)
```

For arrows between vertically stacked nodes:

- Arrow `x` = shape center X, `y` = source bottom edge
- Arrow `height` = `GAP_Y`, `width` = 0 (straight down)

### Left-to-right flows

Same idea, swap axes. Use `COL_STRIDE` for horizontal spacing. Arrows: `width` = `GAP_X`, `height` = 0.

### Arrow Geometry — Edge Helper Pattern

Arrow `x`/`y` is the start point; `x + width`/`y + height` is the end point (where the arrowhead goes). The converter auto-derives `points` from `width`/`height`, so you only need to set those four properties correctly.

**Recommended**: define shape rects and edge helpers to compute exact edge-to-edge arrow geometry:

```js
// Shape rect lookup (mirrors your shape definitions)
const S = {
  svcA: { x: 0, y: 0, w: 180, h: 80 },
  svcB: { x: 0, y: 200, w: 180, h: 80 },
};

// Edge calculators
function bottomCenter(s) { return { x: s.x + s.w / 2, y: s.y + s.h }; }
function topCenter(s)    { return { x: s.x + s.w / 2, y: s.y }; }
function rightCenter(s)  { return { x: s.x + s.w, y: s.y + s.h / 2 }; }
function leftCenter(s)   { return { x: s.x, y: s.y + s.h / 2 }; }

// Arrow helper — computes geometry from source/target edges
function arrow(id, from, to, opts = {}) {
  return {
    type: "arrow", id,
    x: from.x, y: from.y,
    width: to.x - from.x,
    height: to.y - from.y,
    ...opts,
  };
}

// Usage: vertical arrow from svcA bottom → svcB top
arrow("a1", bottomCenter(S.svcA), topCenter(S.svcB))
// Usage: horizontal arrow from svcA right → svcB left
arrow("a2", rightCenter(S.svcA), leftCenter(S.svcB))
```

The formulas for manual calculation:

For a horizontal arrow from shape A (right edge) to shape B (left edge):

- `x` = A.x + A.width
- `y` = A.y + A.height / 2
- `width` = B.x - (A.x + A.width)
- `height` = B.y + B.height / 2 - (A.y + A.height / 2) (0 if same row)

For a vertical arrow from shape A (bottom edge) to shape B (top edge):

- `x` = A.x + A.width / 2
- `y` = A.y + A.height
- `width` = B.x + B.width / 2 - (A.x + A.width / 2)
- `height` = B.y - (A.y + A.height)

---

## Color Palette

Excalidraw hand-drawn style colors (from the default palette):

| Name         | Hex       | Good for              |
| ------------ | --------- | --------------------- |
| Light red    | `#ffc9c9` | Error / danger states |
| Light green  | `#c0eb75` | Success / healthy     |
| Light blue   | `#a5d8ff` | Info / primary        |
| Light yellow | `#fff3bf` | Warning / highlight   |
| Light purple | `#e599f7` | Special / accent      |
| Dark blue    | `#1971c2` | Stroke accent         |
| Dark green   | `#2f9e44` | Stroke accent         |
| Dark red     | `#c2255c` | Stroke accent         |
| Dark orange  | `#f08c00` | Stroke accent         |
| Dark purple  | `#9c36b5` | Stroke accent         |
| Black        | `#1e1e1e` | Default stroke        |

Always pair `backgroundColor` with `fillStyle: "solid"` (or `"cross-hatch"`, `"zigzag"`) — the default `"hachure"` fill is subtle and can be hard to see.

---

## Complete Example: 3-Service Architecture

```js
// architecture.mjs

const W = 180;
const H = 80;
const GAP = 100;
const STRIDE = W + GAP;

const nodes = [
  { id: "client", x: 0, label: "Client App", bg: "#a5d8ff" },
  { id: "api", x: STRIDE, label: "API Gateway", bg: "#c0eb75" },
  { id: "db", x: STRIDE * 2, label: "Database", bg: "#fff3bf" },
];

const shapes = nodes.map(({ id, x, label, bg }) => ({
  type: "rectangle",
  id,
  x,
  y: 0,
  width: W,
  height: H,
  backgroundColor: bg,
  fillStyle: "solid",
  strokeWidth: 2,
  label: { text: label },
}));

const arrows = [
  { from: "client", to: "api", label: "REST" },
  { from: "api", to: "db", label: "SQL" },
];

const arrowElements = arrows.map(({ from, to, label }) => ({
  type: "arrow",
  x: nodes.find((n) => n.id === from).x + W,
  y: H / 2,
  width: GAP,
  height: 0,
  strokeWidth: 2,
  start: { id: from },
  end: { id: to },
  label: { text: label },
}));

export default [...shapes, ...arrowElements];
```

```bash
node ~/.config/opencode/skills/excalidraw/dist/convert.mjs architecture.mjs architecture.excalidraw
```

---

## Tips

- **Style** — use hand-drawn (Excalifont, `roughness: 1`) style - it's the native Excalidraw aesthetic.
- **Pick one font family and use it everywhere** — mixing `fontFamily: 1` with `fontFamily: 2` across elements looks broken. Set a constant at the top (`const FONT = 1`) and reference it in every element.
- **Set `width` and `height` explicitly** on shapes that contain labels — auto-sizing depends on font metrics which may differ in Node.js.
- **Use `fillStyle: "solid"`** when setting `backgroundColor` so the fill is clearly visible.
- **Arrows need exact geometry** — use the edge helper pattern (see Arrow Geometry section) to compute `x`, `y`, `width`, `height` from source/target shape edges. The converter auto-derives `points` from these values.
- **Use variables and loops** — define layout constants at the top and compute positions instead of hard-coding coordinates.
- **For multi-line labels** use `\n` in the `text` string.
- **Diagrams open in Excalidraw** — users can drag the `.excalidraw` file into https://excalidraw.com or open it in the VS Code Excalidraw extension.
- **Always verify with `preview`** — render every generated diagram to PNG and visually inspect before delivering to the user. This catches layout issues, missing elements, and factual errors that aren't obvious from the JSON alone.
