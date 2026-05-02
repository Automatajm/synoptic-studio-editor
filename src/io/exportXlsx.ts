import * as XLSX from "xlsx";
import type { Shape, BackgroundImage } from "../editor/types";
import { toRelative, round } from "../lib/coordinates";
import { computeCentroid } from "../lib/centroid";

/**
 * Export shapes to Excel (.xlsx).
 *
 * Output schema (one sheet, "Layouts"):
 *   Object_ID, Label, Layout_X, Layout_Y, Layout_W, Layout_H, Polygon_Points,
 *   Centroid_X, Centroid_Y, Canvas_W, Canvas_H, Image_URL
 *
 * - Coordinates are RELATIVE 0-100 (percentages of canvas).
 * - Rectangles fill Layout_X/Y/W/H; Polygon_Points is empty.
 * - Polygons fill Polygon_Points (semicolon-separated "x,y" pairs);
 *   Layout_X/Y/W/H carry the bounding box for backwards compat with PBI visuals
 *   that don't yet support polygons.
 * - Centroid_X / Centroid_Y carry the label-anchor / graph-node position.
 *   Honors manual centroidOverride; falls back to the geometric centroid.
 *   These are usable downstream as graph node positions for routing,
 *   clustering, nearest-neighbor analysis, etc.
 * - Image_URL is filled on every row when provided (denormalized for easier
 *   handling in Power BI's data model).
 */

export interface ExportOptions {
    imageUrl?: string;        // optional URL to embed as a column
}

export async function exportToXlsx(
    shapes: Shape[],
    canvasW: number,
    canvasH: number,
    bg: BackgroundImage | null,
    opts: ExportOptions = {},
): Promise<void> {
    const rows = shapes.map(s => buildRow(s, canvasW, canvasH, opts.imageUrl ?? ""));

    // Sort rows by Object_ID alphabetically for a tidy output
    rows.sort((a, b) => String(a.Object_ID).localeCompare(String(b.Object_ID)));

    const ws = XLSX.utils.json_to_sheet(rows, {
        header: [
            "Object_ID", "Label",
            "Layout_X", "Layout_Y", "Layout_W", "Layout_H",
            "Polygon_Points",
            "Centroid_X", "Centroid_Y",
            "Canvas_W", "Canvas_H",
            "Image_URL",
        ],
    });
    // Column widths
    ws["!cols"] = [
        { wch: 14 }, { wch: 14 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 50 },
        { wch: 11 }, { wch: 11 },
        { wch: 10 }, { wch: 10 },
        { wch: 30 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Layouts");

    // Add a metadata sheet so the user remembers the canvas size used
    const meta = XLSX.utils.aoa_to_sheet([
        ["Field", "Value"],
        ["Canvas Width (px)",  canvasW],
        ["Canvas Height (px)", canvasH],
        ["Background image",   bg?.name ?? ""],
        ["Image URL",          opts.imageUrl ?? ""],
        ["Coordinates",        "Relative (0-100% of canvas)"],
        ["Total objects",      shapes.length],
        ["Generated",          new Date().toISOString()],
    ]);
    meta["!cols"] = [{ wch: 25 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, meta, "Metadata");

    // Filename
    const ts = new Date().toISOString().slice(0, 10);
    const fn = `synoptic-layout-${ts}.xlsx`;
    XLSX.writeFile(wb, fn);
}

function buildRow(
    s: Shape, cw: number, ch: number, imageUrl: string,
): Record<string, string | number> {
    // Centroid: respects manual override; otherwise area-weighted geometric.
    const c = computeCentroid(s);
    const centroidX = round(toRelative(c.x, cw));
    const centroidY = round(toRelative(c.y, ch));

    if (s.kind === "rect") {
        return {
            Object_ID: s.label,
            Label:     s.label,
            Layout_X:  round(toRelative(s.x, cw)),
            Layout_Y:  round(toRelative(s.y, ch)),
            Layout_W:  round(toRelative(s.w, cw)),
            Layout_H:  round(toRelative(s.h, ch)),
            Polygon_Points: "",
            Centroid_X: centroidX,
            Centroid_Y: centroidY,
            Canvas_W:  cw,
            Canvas_H:  ch,
            Image_URL: imageUrl,
        };
    }
    // Polygon — also compute bounding box so older visuals can still place it
    const xs = s.points.map(p => p.x);
    const ys = s.points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pts = s.points
        .map(p => `${round(toRelative(p.x, cw))},${round(toRelative(p.y, ch))}`)
        .join(";");
    return {
        Object_ID: s.label,
        Label:     s.label,
        Layout_X:  round(toRelative(minX, cw)),
        Layout_Y:  round(toRelative(minY, ch)),
        Layout_W:  round(toRelative(maxX - minX, cw)),
        Layout_H:  round(toRelative(maxY - minY, ch)),
        Polygon_Points: pts,
        Centroid_X: centroidX,
        Centroid_Y: centroidY,
        Canvas_W:  cw,
        Canvas_H:  ch,
        Image_URL: imageUrl,
    };
}
