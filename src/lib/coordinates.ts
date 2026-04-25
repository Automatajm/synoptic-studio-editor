// Coordinate conversion helpers.
//
// The editor works internally in CANVAS pixel space so the user's drag actions
// feel natural (pixel-perfect placement against the background image).
//
// On export, all coordinates are converted to RELATIVE 0-100% so the resulting
// CSV/Excel file is independent of the original canvas size — it can be loaded
// into any-sized Power BI visual and still look correct.

/**
 * Convert an absolute canvas coordinate to a 0-100 relative percentage.
 * Clamps to [0, 100] to guard against rounding overshoots.
 */
export function toRelative(absValue: number, canvasSize: number): number {
    if (canvasSize <= 0) return 0;
    const pct = (absValue / canvasSize) * 100;
    return Math.max(0, Math.min(100, pct));
}

/**
 * Convert a 0-100 relative percentage back to an absolute canvas coordinate.
 * Used when importing a CSV — the editor needs absolute coords to render.
 */
export function toAbsolute(relValue: number, canvasSize: number): number {
    return (relValue / 100) * canvasSize;
}

/**
 * Round to a given decimal precision. Default 2 — keeps the export tidy
 * while preserving sub-pixel accuracy on large canvases.
 */
export function round(n: number, decimals = 2): number {
    const f = Math.pow(10, decimals);
    return Math.round(n * f) / f;
}

/**
 * Snap a value to the nearest multiple of `step`, if snapping is enabled.
 * If `step <= 0` or `enabled` is false, returns the value unchanged.
 */
export function snap(value: number, step: number, enabled: boolean): number {
    if (!enabled || step <= 0) return value;
    return Math.round(value / step) * step;
}
