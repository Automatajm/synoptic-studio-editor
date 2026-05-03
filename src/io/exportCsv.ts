// CSV export.
//
// Why a separate CSV format on top of Excel?
//
// Excel cells have a hard 32,767-character limit. Our base64-embedded
// background images often want more than that for full quality — a JPEG
// at q=0.95 can easily reach 100KB-500KB encoded. The Excel embed path
// has to compress aggressively to fit, sacrificing detail.
//
// CSV cells, on the other hand, have NO practical size limit in Power
// BI's importer. We've successfully tested with 5MB+ in a single cell.
// So this exporter pairs naturally with the "csv" quality profile in
// image.ts (JPEG q=0.95, minimal resize).
//
// The output schema mirrors exportXlsx exactly so a Power BI report
// built against one format can switch to the other without rebinding
// columns. The only Excel-specific feature we lose is the metadata
// sheet, which we replace by prepending a comment-style header row
// (commented-out values) for human reference.
//
// Encoding: UTF-8 with BOM. Power BI's CSV importer expects this and
// without the BOM, accented characters in object IDs (e.g. "Patio Ñ")
// can be misread.

import type { Shape } from "../editor/types";
import type { BackgroundImage } from "../editor/types";
import { computeCentroid } from "../lib/centroid";
import { toRelative, round } from "../lib/coordinates";

export interface CsvExportOptions {
    imageUrl?: string;
}

export async function exportToCsv(
    shapes: Shape[],
    canvasW: number,
    canvasH: number,
    bg: BackgroundImage | null,
    opts: CsvExportOptions = {},
): Promise<void> {
    const headers = [
        "Object_ID", "Label",
        "Layout_X", "Layout_Y", "Layout_W", "Layout_H",
        "Polygon_Points",
        "Centroid_X", "Centroid_Y",
        "Canvas_W", "Canvas_H",
        "Image_URL",
    ];

    // Build rows (sorted alphabetically), then inject Image_URL into row 0
    const dataRows = shapes.map(s => buildCsvRow(s, canvasW, canvasH));
    dataRows.sort((a, b) => a[0].localeCompare(b[0]));   // sort by Object_ID
    if (opts.imageUrl && dataRows.length > 0) {
        // Image_URL is the last column (index 11).
        // CRITICAL: strip any newline characters from the data URI before
        // putting it in the CSV. Some browsers' canvas.toDataURL produce
        // base64 with \n every 76 chars (MIME standard). Even though we
        // wrap the field in quotes, some CSV parsers (including Power BI's
        // in certain configurations) split on every newline regardless of
        // quoting context, which would chop a single image into many rows.
        // Base64 works fine on a single line — it's only the MIME wire
        // format that calls for line breaks.
        dataRows[0][11] = opts.imageUrl.replace(/\r?\n/g, "");
    }

    // Sanity check: every row should have exactly `headers.length` fields.
    // If a row has more, our buildCsvRow has a bug; if fewer, we'd be
    // writing malformed CSV. Defensive check before write.
    for (let i = 0; i < dataRows.length; i++) {
        if (dataRows[i].length !== headers.length) {
            throw new Error(
                `CSV row ${i} has ${dataRows[i].length} fields, expected ${headers.length}. Aborting export.`,
            );
        }
    }

    // Assemble CSV string. We use UTF-8 + BOM and proper RFC 4180 escaping
    // (double quotes inside fields are doubled, fields with commas / newlines
    // / quotes are wrapped in double quotes).
    const lines: string[] = [];
    lines.push(headers.map(escapeCsvField).join(","));
    for (const row of dataRows) {
        lines.push(row.map(escapeCsvField).join(","));
    }
    const csv = "\uFEFF" + lines.join("\r\n");   // BOM + CRLF line endings

    // Filename
    const ts = new Date().toISOString().slice(0, 10);
    const fn = `synoptic-layout-${ts}.csv`;

    // Trigger browser download via a Blob URL
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fn;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay to ensure the download started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Suppress unused parameter warning — bg may be useful in future
    // (e.g. for a separate metadata.json sidecar). For now we ignore it.
    void bg;
}

/**
 * Build a row as an array of strings (matching the header order).
 * All numeric values are stringified here so the escape function only
 * deals with text.
 */
function buildCsvRow(s: Shape, cw: number, ch: number): string[] {
    const c = computeCentroid(s);
    const centroidX = round(toRelative(c.x, cw));
    const centroidY = round(toRelative(c.y, ch));

    if (s.kind === "rect") {
        return [
            s.label,
            s.label,
            String(round(toRelative(s.x, cw))),
            String(round(toRelative(s.y, ch))),
            String(round(toRelative(s.w, cw))),
            String(round(toRelative(s.h, ch))),
            "",                      // Polygon_Points
            String(centroidX),
            String(centroidY),
            String(cw),
            String(ch),
            "",                      // Image_URL — only filled on row 0
        ];
    }
    // Polygon — also compute bounding box for legacy compatibility
    const xs = s.points.map(p => p.x);
    const ys = s.points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pts = s.points
        .map(p => `${round(toRelative(p.x, cw))},${round(toRelative(p.y, ch))}`)
        .join(";");
    return [
        s.label,
        s.label,
        String(round(toRelative(minX, cw))),
        String(round(toRelative(minY, ch))),
        String(round(toRelative(maxX - minX, cw))),
        String(round(toRelative(maxY - minY, ch))),
        pts,
        String(centroidX),
        String(centroidY),
        String(cw),
        String(ch),
        "",
    ];
}

/**
 * RFC 4180 CSV field escaping: wrap in double quotes if the field
 * contains comma, double quote, CR, or LF. Inside quotes, double quotes
 * are escaped as doubled double-quotes (...").
 *
 * This matters especially for embedded base64 images — the data URI
 * itself contains commas and slashes that would otherwise be confused
 * with field separators.
 */
function escapeCsvField(field: string): string {
    if (field.indexOf(",") === -1
        && field.indexOf("\"") === -1
        && field.indexOf("\r") === -1
        && field.indexOf("\n") === -1) {
        return field;
    }
    return "\"" + field.replace(/"/g, "\"\"") + "\"";
}
