// Helpers for generating object IDs and labels.

import type { Shape } from "../editor/types";

let idCounter = 0;
function uuid(): string {
    idCounter++;
    return `s${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export { uuid };

/**
 * Generate the next sequential label for a new shape.
 * Format: A01, A02, ..., A99, B01, ..., Z99.
 *
 * Looks at the existing shapes' labels and picks the next slot in sequence,
 * skipping over labels the user has manually renamed (so the auto-numbering
 * doesn't fight with custom names).
 */
export function nextLabel(shapes: Shape[]): string {
    // Collect all labels matching the auto-pattern (Letter + 2 digits)
    const auto = new Set<string>();
    const re = /^([A-Z])(\d{2})$/;
    for (const s of shapes) {
        if (re.test(s.label)) auto.add(s.label);
    }

    // Walk A01..Z99 in order; first slot not taken wins
    for (let letter = 65; letter <= 90; letter++) {
        const ch = String.fromCharCode(letter);
        for (let n = 1; n <= 99; n++) {
            const candidate = ch + String(n).padStart(2, "0");
            if (!auto.has(candidate)) return candidate;
        }
    }
    // Fallback if we somehow exhausted A01..Z99 (2,574 shapes — unlikely)
    return `X${String(shapes.length + 1).padStart(3, "0")}`;
}
