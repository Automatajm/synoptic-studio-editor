// Centroid calculation for rectangles and polygons.
// Used by the Canvas (label anchor display + draggable override) and by
// the Excel export (Centroid_X / Centroid_Y columns). Downstream consumers
// can use the centroid as a graph node position for routing, clustering,
// nearest-neighbor analysis, etc.

import type { Point, Shape } from "../editor/types";

/**
 * Compute the centroid of a shape.
 * - Rectangle: trivial center (x + w/2, y + h/2)
 * - Polygon:   area-weighted geometric centroid using the shoelace formula.
 *              This always falls inside any simple polygon — including L, T,
 *              U, donut-less irregular shapes — unlike the naive average of
 *              vertices which can fall outside concave shapes.
 *
 * Honors `centroidOverride` if present (manual anchor positioning).
 */
export function computeCentroid(s: Shape): Point {
    if (s.centroidOverride) {
        return { x: s.centroidOverride.x, y: s.centroidOverride.y };
    }
    if (s.kind === "rect") {
        return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    }
    return polygonCentroid(s.points);
}

/**
 * Compute the geometric centroid of a polygon using the shoelace formula.
 * Returns the area-weighted average of the polygon's signed-triangle areas
 * formed with the origin. Works for convex and concave simple polygons.
 *
 * Edge case: if the polygon has zero area (degenerate, e.g. all collinear
 * points), falls back to the bounding box center.
 */
export function polygonCentroid(points: Point[]): Point {
    const n = points.length;
    if (n < 3) return boundingBoxCenter(points);

    let area2 = 0;   // 2 × signed area
    let cx   = 0;
    let cy   = 0;

    for (let i = 0; i < n; i++) {
        const p0 = points[i];
        const p1 = points[(i + 1) % n];
        const cross = p0.x * p1.y - p1.x * p0.y;
        area2 += cross;
        cx    += (p0.x + p1.x) * cross;
        cy    += (p0.y + p1.y) * cross;
    }

    if (Math.abs(area2) < 1e-9) {
        // Degenerate (collinear points or zero area) — fall back to bbox center
        return boundingBoxCenter(points);
    }

    // 6 = 6 × area; divide x and y sums to get centroid
    const factor = 1 / (3 * area2);
    return { x: cx * factor, y: cy * factor };
}

function boundingBoxCenter(points: Point[]): Point {
    if (points.length === 0) return { x: 0, y: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Test whether a point lies inside a simple polygon using the ray-casting
 * algorithm. Used to validate manual centroid overrides — the editor warns
 * (or rejects) if the user drags the centroid outside its shape.
 *
 * For rectangles, this is just a bounding box test (caller can use shape.x/y/w/h).
 */
export function pointInPolygon(pt: Point, polygon: Point[]): boolean {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersects = ((yi > pt.y) !== (yj > pt.y))
                        && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

/**
 * Test whether a point lies inside any shape's body.
 * For rects: bounding box test.
 * For polygons: ray-casting.
 */
export function pointInShape(pt: Point, s: Shape): boolean {
    if (s.kind === "rect") {
        return pt.x >= s.x && pt.x <= s.x + s.w
            && pt.y >= s.y && pt.y <= s.y + s.h;
    }
    return pointInPolygon(pt, s.points);
}
