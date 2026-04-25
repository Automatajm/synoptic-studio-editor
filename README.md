# Synoptic Studio Editor

A visual editor for creating Synoptic Studio layouts — draw rectangles and polygons over a background image, and export coordinates as an Excel file ready for Power BI.

Companion to the [Synoptic Studio Power BI custom visual](https://github.com/Automatajm/synoptic-studio).

---

## What it does

You upload an image — a floor plan, dental chart, parking lot, factory layout, geographic map — and trace each object on it with the mouse. The editor generates a coordinates file that you import into Power BI alongside your data, and the Synoptic Studio visual draws the same objects with live color rules and cross-filtering.

Use cases:

| Industry | Background image | Shapes |
|---|---|---|
| Agriculture | Greenhouse layout photo / CAD plan | Rectangles for beds |
| Healthcare | Dental chart, anatomy | Polygons for teeth, organs |
| Hospitality | Hotel floor plan | Rectangles for rooms |
| Manufacturing | Factory photo / layout | Mixed: rect for stations, polygons for zones |
| Geographic | Country / region map | Polygons for regions |

---

## Quick start

```bash
# Install once
npm install

# Run the dev server
npm run dev

# Build for production
npm run build
```

Open `http://localhost:5173` in your browser.

---

## How to use

1. **Load a background image** — click `📷 Load image` (PNG / JPG, drag-drop coming soon).
2. **Pick a tool**:
   - `↖ Select` (V) — move and edit shapes
   - `▭ Rect` (R) — drag to draw a rectangle
   - `⬡ Polygon` (P) — click points; double-click or press Enter to close
3. **Draw your shapes** over the image.
4. **Rename** any shape by double-clicking its row in the sidebar.
5. **Export** — click `↓ Export` to download an Excel file.
6. **Use in Power BI** — load the exported file as a data source, connect the columns to the Synoptic Studio visual.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `V` | Select tool |
| `R` | Rectangle tool |
| `P` | Polygon tool |
| `Delete` / `Backspace` | Delete selected shape |
| `Enter` (in polygon) | Close polygon |
| `Escape` | Cancel polygon / clear selection |
| `Wheel` | Zoom toward cursor |
| `Alt + drag` or middle-click drag | Pan |
| `Right-click on shape` | Delete shape |

---

## Export schema

The exported `.xlsx` contains a `Layouts` sheet with these columns:

| Column | Used for | Notes |
|---|---|---|
| `Object_ID` | Unique identifier | Used as Object ID in the visual |
| `Label` | Display text | Defaults to Object_ID; user-editable |
| `Layout_X` | Top-left X | Relative 0-100 (% of canvas) |
| `Layout_Y` | Top-left Y | Relative 0-100 |
| `Layout_W` | Width | Relative 0-100 |
| `Layout_H` | Height | Relative 0-100 |
| `Polygon_Points` | Vertex list (polygons only) | `x,y;x,y;…` in relative coords |
| `Image_URL` | Background image URL | Optional, denormalized per row |

Plus a `Metadata` sheet recording the original canvas size, image filename, and generation timestamp.

### Coordinates are relative

All coordinates are exported as percentages of the canvas size. This means the same layout file works at any visual size — Power BI can show the same data on a 4K monitor and a phone, and the proportions stay correct.

---

## Roadmap

This is **v0.1** — the MVP for rectangles. Coming up:

- [ ] Polygon mode (in progress)
- [ ] Import existing CSV/Excel for editing
- [ ] Undo / Redo (Ctrl+Z / Ctrl+Y)
- [ ] Drag-drop image loading
- [ ] Multi-select + bulk operations
- [ ] Snap to other shapes (alignment guides)
- [ ] Bulk auto-grid (place 50 numbered rectangles in a grid)
- [ ] Templates (load common layouts: 2×3 conference room, 12-month calendar, etc.)
- [ ] Deploy to `editor.synopticstudio.app` on Vercel

---

## Tech stack

- **Vite** + **TypeScript** — fast HMR, strict types, no framework overhead
- **Vanilla SVG** — same paradigm as the Power BI visual; no canvas-library dependency
- **Tailwind CSS** — utility-first styling for fast iteration
- **SheetJS** — Excel export
- **Vercel** — hosting (zero-config deploy from GitHub)

---

## License

MIT — see [LICENSE](./LICENSE).

## Author

Built by **Automatajm**.
