import type { Shape, Rect, Polygon, Point } from "./types";
import { uuid, nextLabel } from "../lib/labels";

/**
 * ShapeManager — single source of truth for all shapes in the editor.
 *
 * Owns: the array of shapes, the currently-selected shape ID.
 * Notifies listeners when state changes so UI components can re-render.
 *
 * NOT owned here: tool mode, zoom/pan, background image — those live in
 * the parent Editor class. ShapeManager only cares about shapes.
 */

export type ShapeChangeListener = () => void;

export class ShapeManager {
    private shapes:    Shape[] = [];
    private selectedId: string | null = null;
    private listeners: Set<ShapeChangeListener> = new Set();

    // ── Subscriptions ───────────────────────────────────────────────────
    onChange(fn: ShapeChangeListener): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private notify(): void {
        this.listeners.forEach(fn => fn());
    }

    // ── Read ────────────────────────────────────────────────────────────
    getAll(): Shape[] { return this.shapes; }
    getSelected(): Shape | null {
        if (!this.selectedId) return null;
        return this.shapes.find(s => s.id === this.selectedId) ?? null;
    }
    getSelectedId(): string | null { return this.selectedId; }
    getById(id: string): Shape | null {
        return this.shapes.find(s => s.id === id) ?? null;
    }

    // ── Selection ───────────────────────────────────────────────────────
    select(id: string | null): void {
        if (this.selectedId === id) return;
        this.selectedId = id;
        this.notify();
    }
    clearSelection(): void { this.select(null); }

    // ── Create ──────────────────────────────────────────────────────────
    addRect(x: number, y: number, w: number, h: number): Rect {
        const r: Rect = {
            kind: "rect",
            id: uuid(),
            label: nextLabel(this.shapes),
            x, y, w, h,
        };
        this.shapes.push(r);
        this.selectedId = r.id;
        this.notify();
        return r;
    }
    addPolygon(points: Point[]): Polygon {
        const p: Polygon = {
            kind: "polygon",
            id: uuid(),
            label: nextLabel(this.shapes),
            points: [...points],
        };
        this.shapes.push(p);
        this.selectedId = p.id;
        this.notify();
        return p;
    }

    // ── Update ──────────────────────────────────────────────────────────
    updateRect(id: string, patch: Partial<Pick<Rect, "x"|"y"|"w"|"h">>): void {
        const s = this.getById(id);
        if (!s || s.kind !== "rect") return;
        Object.assign(s, patch);
        this.notify();
    }
    updatePolygon(id: string, points: Point[]): void {
        const s = this.getById(id);
        if (!s || s.kind !== "polygon") return;
        s.points = points;
        this.notify();
    }
    rename(id: string, newLabel: string): void {
        const s = this.getById(id);
        if (!s) return;
        s.label = newLabel.trim() || s.label; // ignore empty rename
        this.notify();
    }

    /**
     * Set or clear the manual centroid override for a shape.
     * Pass null to clear (revert to geometric centroid).
     */
    setCentroidOverride(id: string, override: Point | null): void {
        const s = this.getById(id);
        if (!s) return;
        if (override === null) {
            delete s.centroidOverride;
        } else {
            s.centroidOverride = { x: override.x, y: override.y };
        }
        this.notify();
    }

    // ── Delete ──────────────────────────────────────────────────────────
    remove(id: string): void {
        const idx = this.shapes.findIndex(s => s.id === id);
        if (idx < 0) return;
        this.shapes.splice(idx, 1);
        if (this.selectedId === id) this.selectedId = null;
        this.notify();
    }
    removeSelected(): void {
        if (this.selectedId) this.remove(this.selectedId);
    }
    clearAll(): void {
        this.shapes = [];
        this.selectedId = null;
        this.notify();
    }

    // ── Bulk import (from CSV) ──────────────────────────────────────────
    replaceAll(shapes: Shape[]): void {
        this.shapes = shapes;
        this.selectedId = null;
        this.notify();
    }
}
