import type {
    Shape, Rect, Polygon, ToolMode, BackgroundImage,
} from "./types";
import { ShapeManager } from "./ShapeManager";
import { snap } from "../lib/coordinates";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_RECT_SIZE = 5;       // smallest rect we'll keep — anything tinier is treated as a click
const HANDLE_SIZE   = 10;       // resize handle square size in screen pixels
const SNAP_STEP     = 10;       // canvas units per snap step

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface DragState {
    kind: "create-rect" | "move" | "resize" | "pan" | "polygon-build";
    startX:    number;             // mouse start in canvas coords (or screen for pan)
    startY:    number;
    handle?:   ResizeHandle;
    shapeId?:  string;
    shapeOriginal?: Shape;          // snapshot for delta calculations
    // For pan
    panStartX?: number;
    panStartY?: number;
}

/**
 * Canvas — the SVG editing surface.
 *
 * Responsibilities:
 *  - Render the background image and all shapes
 *  - Handle mouse interactions to create / select / move / resize shapes
 *  - Handle zoom (wheel) and pan (middle-click drag, or space+drag)
 *  - Render a polygon-in-progress while the user is placing points
 *
 * All shape mutations go through ShapeManager — Canvas never mutates shape
 * state directly. This keeps the source of truth single-threaded.
 */
export class Canvas {
    private svg:         SVGSVGElement;
    private bgLayer:     SVGGElement;
    private shapesLayer: SVGGElement;
    private overlayLayer: SVGGElement;        // selection handles, rubber bands

    private shapes:      ShapeManager;

    // Editor state owned externally — Canvas reads via getters
    private getCanvasW: () => number;
    private getCanvasH: () => number;
    private getTool:    () => ToolMode;
    private getBg:      () => BackgroundImage | null;
    private getSnap:    () => boolean;

    // View transform
    private zoom = 1;
    private panX = 0;
    private panY = 0;

    // Interaction state
    private drag: DragState | null = null;
    private polygonPoints: { x: number; y: number }[] = [];
    // Track last polygon click time for manual double-click detection.
    // The native 'dblclick' event is unreliable on SVG (depends on target,
    // bubbling, and browser-specific quirks). Comparing timestamps in our
    // own mousedown handler is the most robust solution.
    private lastPolygonClickAt = 0;
    private readonly DBL_CLICK_MS = 350;

    // Notifications for the parent editor
    private onZoomChange: ((zoom: number) => void) | null = null;

    constructor(root: HTMLElement, shapes: ShapeManager, accessors: {
        getCanvasW: () => number;
        getCanvasH: () => number;
        getTool:    () => ToolMode;
        getBg:      () => BackgroundImage | null;
        getSnap:    () => boolean;
    }) {
        this.shapes = shapes;
        this.getCanvasW = accessors.getCanvasW;
        this.getCanvasH = accessors.getCanvasH;
        this.getTool    = accessors.getTool;
        this.getBg      = accessors.getBg;
        this.getSnap    = accessors.getSnap;

        // Build SVG structure
        this.svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
        this.svg.setAttribute("xmlns", SVG_NS);
        this.svg.style.width  = "100%";
        this.svg.style.height = "100%";
        this.svg.style.display = "block";
        this.svg.style.background = "#0a0e13";
        root.appendChild(this.svg);

        // Layers — bg goes underneath, shapes in middle, overlay on top
        this.bgLayer      = document.createElementNS(SVG_NS, "g");
        this.shapesLayer  = document.createElementNS(SVG_NS, "g");
        this.overlayLayer = document.createElementNS(SVG_NS, "g");
        this.svg.appendChild(this.bgLayer);
        this.svg.appendChild(this.shapesLayer);
        this.svg.appendChild(this.overlayLayer);

        // Wire up events
        this.attachEvents();
        this.shapes.onChange(() => this.render());

        // Initial render
        this.render();
    }

    onZoom(fn: (zoom: number) => void): void { this.onZoomChange = fn; }

    // ── Public API ──────────────────────────────────────────────────────
    public render(): void {
        this.applyTransform();
        this.renderBackground();
        this.renderShapes();
        this.renderOverlay();
    }

    public setZoom(z: number): void {
        this.zoom = Math.max(0.1, Math.min(8, z));
        this.applyTransform();
        if (this.onZoomChange) this.onZoomChange(this.zoom);
    }

    public zoomIn():  void { this.setZoom(this.zoom * 1.25); }
    public zoomOut(): void { this.setZoom(this.zoom / 1.25); }
    public fitToViewport(): void {
        const cw = this.getCanvasW(), ch = this.getCanvasH();
        const rect = this.svg.getBoundingClientRect();
        const sX = rect.width / cw, sY = rect.height / ch;
        const fit = Math.min(sX, sY) * 0.95;
        this.zoom = fit;
        // Center
        this.panX = (rect.width  - cw * fit) / 2;
        this.panY = (rect.height - ch * fit) / 2;
        this.applyTransform();
        if (this.onZoomChange) this.onZoomChange(this.zoom);
    }

    public cancelPolygon(): void {
        this.polygonPoints = [];
        this.lastPolygonClickAt = 0;
        this.drag = null;
        this.renderOverlay();
    }

    public commitPolygon(): void {
        if (this.polygonPoints.length >= 3) {
            this.shapes.addPolygon(this.polygonPoints);
        }
        this.polygonPoints = [];
        this.lastPolygonClickAt = 0;
        this.drag = null;
        this.renderOverlay();
    }

    // ── Internal: transform ─────────────────────────────────────────────
    private applyTransform(): void {
        const t = `translate(${this.panX},${this.panY}) scale(${this.zoom})`;
        this.bgLayer.setAttribute("transform", t);
        this.shapesLayer.setAttribute("transform", t);
        this.overlayLayer.setAttribute("transform", t);
    }

    // ── Coordinate conversion ───────────────────────────────────────────
    private screenToCanvas(clientX: number, clientY: number): { x: number; y: number } {
        const rect = this.svg.getBoundingClientRect();
        const sx = clientX - rect.left;
        const sy = clientY - rect.top;
        return {
            x: (sx - this.panX) / this.zoom,
            y: (sy - this.panY) / this.zoom,
        };
    }

    // ── Rendering: background image ─────────────────────────────────────
    private renderBackground(): void {
        while (this.bgLayer.firstChild) this.bgLayer.removeChild(this.bgLayer.firstChild);
        const bg = this.getBg();
        const cw = this.getCanvasW(), ch = this.getCanvasH();

        // Canvas frame — visible even without bg image so the user knows where
        // the working area is.
        const frame = document.createElementNS(SVG_NS, "rect");
        frame.setAttribute("x", "0");
        frame.setAttribute("y", "0");
        frame.setAttribute("width",  String(cw));
        frame.setAttribute("height", String(ch));
        frame.setAttribute("fill", "#0f141a");
        frame.setAttribute("stroke", "#1f2730");
        frame.setAttribute("stroke-width", String(1 / this.zoom));
        this.bgLayer.appendChild(frame);

        if (bg) {
            const img = document.createElementNS(SVG_NS, "image");
            img.setAttributeNS("http://www.w3.org/1999/xlink", "href", bg.src);
            img.setAttribute("href", bg.src);
            img.setAttribute("x", "0");
            img.setAttribute("y", "0");
            img.setAttribute("width",  String(cw));
            img.setAttribute("height", String(ch));
            img.setAttribute("preserveAspectRatio", "xMidYMid slice");
            this.bgLayer.appendChild(img);
        }
    }

    // ── Rendering: shapes ───────────────────────────────────────────────
    private renderShapes(): void {
        while (this.shapesLayer.firstChild) {
            this.shapesLayer.removeChild(this.shapesLayer.firstChild);
        }
        const selectedId = this.shapes.getSelectedId();
        for (const s of this.shapes.getAll()) {
            const isSel = s.id === selectedId;
            const node = this.buildShapeNode(s, isSel);
            this.shapesLayer.appendChild(node);
        }
    }

    private buildShapeNode(shape: Shape, selected: boolean): SVGElement {
        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("data-shape-id", shape.id);
        g.style.cursor = this.getTool() === "select" ? "pointer" : "default";

        const fill   = selected ? "rgba(0,229,160,0.25)" : "rgba(0,229,160,0.12)";
        const stroke = selected ? "#00e5a0" : "rgba(0,229,160,0.6)";
        const sw     = (selected ? 2.5 : 1.5) / this.zoom;

        if (shape.kind === "rect") {
            const r = document.createElementNS(SVG_NS, "rect");
            r.setAttribute("x",      String(shape.x));
            r.setAttribute("y",      String(shape.y));
            r.setAttribute("width",  String(shape.w));
            r.setAttribute("height", String(shape.h));
            r.setAttribute("fill",   fill);
            r.setAttribute("stroke", stroke);
            r.setAttribute("stroke-width", String(sw));
            g.appendChild(r);
        } else {
            // Polygon
            const pts = shape.points.map(p => `${p.x},${p.y}`).join(" ");
            const poly = document.createElementNS(SVG_NS, "polygon");
            poly.setAttribute("points", pts);
            poly.setAttribute("fill",   fill);
            poly.setAttribute("stroke", stroke);
            poly.setAttribute("stroke-width", String(sw));
            poly.setAttribute("stroke-linejoin", "round");
            g.appendChild(poly);
        }

        // Label
        const cen = this.shapeCenter(shape);
        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(cen.x));
        label.setAttribute("y", String(cen.y));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "central");
        label.setAttribute("fill", "#e0eef7");
        label.setAttribute("font-size", String(Math.max(10, 14 / this.zoom)));
        label.setAttribute("font-weight", "700");
        label.setAttribute("font-family", "'Segoe UI', sans-serif");
        label.setAttribute("paint-order", "stroke");
        label.setAttribute("stroke", "#0a0e13");
        label.setAttribute("stroke-width", String(3 / this.zoom));
        label.setAttribute("stroke-linejoin", "round");
        label.style.pointerEvents = "none";
        label.style.userSelect = "none";
        label.textContent = shape.label;
        g.appendChild(label);

        return g;
    }

    private shapeCenter(s: Shape): { x: number; y: number } {
        if (s.kind === "rect") {
            return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
        }
        // Polygon centroid (simple average — good enough for label placement)
        let cx = 0, cy = 0;
        for (const p of s.points) { cx += p.x; cy += p.y; }
        const n = Math.max(1, s.points.length);
        return { x: cx / n, y: cy / n };
    }

    // ── Rendering: overlay (handles, rubber band, polygon preview) ──────
    private renderOverlay(): void {
        while (this.overlayLayer.firstChild) {
            this.overlayLayer.removeChild(this.overlayLayer.firstChild);
        }

        // Selection handles for selected rect
        const sel = this.shapes.getSelected();
        if (sel && sel.kind === "rect" && this.getTool() === "select") {
            this.renderRectHandles(sel);
        }

        // Selection handles for selected polygon (vertex points)
        if (sel && sel.kind === "polygon" && this.getTool() === "select") {
            this.renderPolygonHandles(sel);
        }

        // Polygon-in-progress preview
        if (this.polygonPoints.length > 0) {
            this.renderPolygonInProgress();
        }
    }

    private renderRectHandles(rect: Rect): void {
        const handles: { name: ResizeHandle; x: number; y: number }[] = [
            { name: "nw", x: rect.x,            y: rect.y },
            { name: "n",  x: rect.x + rect.w/2, y: rect.y },
            { name: "ne", x: rect.x + rect.w,   y: rect.y },
            { name: "e",  x: rect.x + rect.w,   y: rect.y + rect.h/2 },
            { name: "se", x: rect.x + rect.w,   y: rect.y + rect.h },
            { name: "s",  x: rect.x + rect.w/2, y: rect.y + rect.h },
            { name: "sw", x: rect.x,            y: rect.y + rect.h },
            { name: "w",  x: rect.x,            y: rect.y + rect.h/2 },
        ];
        const sz = HANDLE_SIZE / this.zoom;
        for (const h of handles) {
            const handle = document.createElementNS(SVG_NS, "rect");
            handle.setAttribute("x", String(h.x - sz/2));
            handle.setAttribute("y", String(h.y - sz/2));
            handle.setAttribute("width", String(sz));
            handle.setAttribute("height", String(sz));
            handle.setAttribute("fill", "#00e5a0");
            handle.setAttribute("stroke", "#fff");
            handle.setAttribute("stroke-width", String(1.5 / this.zoom));
            handle.setAttribute("data-handle", h.name);
            handle.setAttribute("data-shape-id", rect.id);
            handle.style.cursor = this.handleCursor(h.name);
            this.overlayLayer.appendChild(handle);
        }
    }

    private renderPolygonHandles(poly: Polygon): void {
        const sz = HANDLE_SIZE / this.zoom;
        poly.points.forEach((p, i) => {
            const handle = document.createElementNS(SVG_NS, "circle");
            handle.setAttribute("cx", String(p.x));
            handle.setAttribute("cy", String(p.y));
            handle.setAttribute("r",  String(sz / 2));
            handle.setAttribute("fill", "#00e5a0");
            handle.setAttribute("stroke", "#fff");
            handle.setAttribute("stroke-width", String(1.5 / this.zoom));
            handle.setAttribute("data-vertex-idx", String(i));
            handle.setAttribute("data-shape-id", poly.id);
            handle.style.cursor = "move";
            this.overlayLayer.appendChild(handle);
        });
    }

    private renderPolygonInProgress(): void {
        if (this.polygonPoints.length === 0) return;
        // Lines between placed points
        if (this.polygonPoints.length >= 2) {
            const pts = this.polygonPoints.map(p => `${p.x},${p.y}`).join(" ");
            const line = document.createElementNS(SVG_NS, "polyline");
            line.setAttribute("points", pts);
            line.setAttribute("fill", "none");
            line.setAttribute("stroke", "#00e5a0");
            line.setAttribute("stroke-width", String(2 / this.zoom));
            line.setAttribute("stroke-dasharray", `${4/this.zoom},${3/this.zoom}`);
            this.overlayLayer.appendChild(line);
        }
        // Closing-line preview: dashed line back to the first point so the user
        // can see the polygon's closing edge while placing points
        if (this.polygonPoints.length >= 2) {
            const first = this.polygonPoints[0];
            const last  = this.polygonPoints[this.polygonPoints.length - 1];
            const closing = document.createElementNS(SVG_NS, "line");
            closing.setAttribute("x1", String(last.x));
            closing.setAttribute("y1", String(last.y));
            closing.setAttribute("x2", String(first.x));
            closing.setAttribute("y2", String(first.y));
            closing.setAttribute("stroke", "#00e5a0");
            closing.setAttribute("stroke-width", String(1.2 / this.zoom));
            closing.setAttribute("stroke-dasharray", `${2/this.zoom},${4/this.zoom}`);
            closing.setAttribute("opacity", "0.5");
            this.overlayLayer.appendChild(closing);
        }
        // Vertex dots — first one is bigger (anchor / closing target)
        this.polygonPoints.forEach((p, i) => {
            const isFirst = i === 0;
            const dot = document.createElementNS(SVG_NS, "circle");
            dot.setAttribute("cx", String(p.x));
            dot.setAttribute("cy", String(p.y));
            dot.setAttribute("r", String((isFirst ? 6 : 4) / this.zoom));
            dot.setAttribute("fill", isFirst ? "#fff" : "#00e5a0");
            dot.setAttribute("stroke", "#00e5a0");
            dot.setAttribute("stroke-width", String((isFirst ? 2 : 1) / this.zoom));
            this.overlayLayer.appendChild(dot);
        });
        // Hint text near the first point — only shown when there are enough
        // points to close (≥2 placed; double-click adds the third and closes)
        if (this.polygonPoints.length >= 2) {
            const first = this.polygonPoints[0];
            const hint = document.createElementNS(SVG_NS, "text");
            hint.setAttribute("x", String(first.x + 12 / this.zoom));
            hint.setAttribute("y", String(first.y - 8 / this.zoom));
            hint.setAttribute("fill", "#00e5a0");
            hint.setAttribute("font-size", String(11 / this.zoom));
            hint.setAttribute("font-family", "'Segoe UI', sans-serif");
            hint.setAttribute("font-weight", "600");
            hint.setAttribute("paint-order", "stroke");
            hint.setAttribute("stroke", "#0a0e13");
            hint.setAttribute("stroke-width", String(3 / this.zoom));
            hint.setAttribute("stroke-linejoin", "round");
            hint.style.pointerEvents = "none";
            hint.style.userSelect = "none";
            hint.textContent = "Double-click to close";
            this.overlayLayer.appendChild(hint);
        }
    }

    private handleCursor(h: ResizeHandle): string {
        switch (h) {
            case "nw": case "se": return "nwse-resize";
            case "ne": case "sw": return "nesw-resize";
            case "n":  case "s":  return "ns-resize";
            case "e":  case "w":  return "ew-resize";
        }
    }

    // ── Events ──────────────────────────────────────────────────────────
    private attachEvents(): void {
        this.svg.addEventListener("mousedown", e => this.onMouseDown(e));
        window.addEventListener("mousemove",   e => this.onMouseMove(e));
        window.addEventListener("mouseup",     e => this.onMouseUp(e));
        this.svg.addEventListener("wheel",     e => this.onWheel(e), { passive: false });
        this.svg.addEventListener("dblclick",  e => this.onDoubleClick(e));
        this.svg.addEventListener("contextmenu", e => this.onContextMenu(e));
    }

    private onMouseDown(e: MouseEvent): void {
        // Middle button or alt+left = pan
        if (e.button === 1 || e.altKey) {
            e.preventDefault();
            this.drag = {
                kind: "pan",
                startX: e.clientX,
                startY: e.clientY,
                panStartX: this.panX,
                panStartY: this.panY,
            };
            this.svg.style.cursor = "grabbing";
            return;
        }
        if (e.button !== 0) return;

        const target = e.target as Element;
        const tool   = this.getTool();
        const pt     = this.screenToCanvas(e.clientX, e.clientY);

        // Check if clicking a resize handle
        const handle = target.getAttribute("data-handle") as ResizeHandle | null;
        const shapeIdFromHandle = target.getAttribute("data-shape-id");
        if (handle && shapeIdFromHandle) {
            const shape = this.shapes.getById(shapeIdFromHandle);
            if (shape && shape.kind === "rect") {
                this.drag = {
                    kind: "resize",
                    startX: pt.x, startY: pt.y,
                    handle,
                    shapeId: shape.id,
                    shapeOriginal: { ...shape },
                };
                return;
            }
        }

        // Check if clicking an existing shape
        const shapeNode = this.findShapeNode(target);
        const clickedShapeId = shapeNode?.getAttribute("data-shape-id") ?? null;

        if (tool === "polygon") {
            // Manual double-click detection: if this click comes within
            // DBL_CLICK_MS of the previous one and we already have ≥2 points
            // (so closing makes a valid triangle or larger), close the polygon
            // instead of adding another vertex.
            const now = e.timeStamp || Date.now();
            const isDoubleClick = (now - this.lastPolygonClickAt) < this.DBL_CLICK_MS
                                  && this.polygonPoints.length >= 2;
            this.lastPolygonClickAt = now;

            if (isDoubleClick) {
                // Don't add a new vertex; close with what we have.
                // commitPolygon() needs at least 3 points — at this stage we
                // already have ≥2 placed plus the one from the first click of
                // this double-click pair (which was added on the previous
                // mousedown). Total ≥3.
                this.commitPolygon();
                return;
            }

            // First click (or single click): add a vertex.
            this.polygonPoints.push({
                x: snap(pt.x, SNAP_STEP, this.getSnap()),
                y: snap(pt.y, SNAP_STEP, this.getSnap()),
            });
            this.renderOverlay();
            return;
        }

        if (clickedShapeId) {
            // Select + start move
            this.shapes.select(clickedShapeId);
            const shape = this.shapes.getById(clickedShapeId);
            if (shape && tool === "select") {
                this.drag = {
                    kind: "move",
                    startX: pt.x, startY: pt.y,
                    shapeId: shape.id,
                    shapeOriginal: shape.kind === "rect"
                        ? { ...shape }
                        : { ...shape, points: shape.points.map(p => ({...p})) },
                };
            }
            return;
        }

        // Empty click — start a new shape or clear selection
        if (tool === "rect") {
            const sx = snap(pt.x, SNAP_STEP, this.getSnap());
            const sy = snap(pt.y, SNAP_STEP, this.getSnap());
            this.drag = {
                kind: "create-rect",
                startX: sx, startY: sy,
            };
            // Visual feedback: draw a temp rect
            this.drawTempRect(sx, sy, 0, 0);
        } else {
            this.shapes.clearSelection();
        }
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.drag) return;
        const pt = this.screenToCanvas(e.clientX, e.clientY);
        const snapOn = this.getSnap();

        if (this.drag.kind === "pan") {
            const dx = e.clientX - this.drag.startX;
            const dy = e.clientY - this.drag.startY;
            this.panX = (this.drag.panStartX ?? 0) + dx;
            this.panY = (this.drag.panStartY ?? 0) + dy;
            this.applyTransform();
            return;
        }

        if (this.drag.kind === "create-rect") {
            const sx = this.drag.startX, sy = this.drag.startY;
            const ex = snap(pt.x, SNAP_STEP, snapOn);
            const ey = snap(pt.y, SNAP_STEP, snapOn);
            const x = Math.min(sx, ex), y = Math.min(sy, ey);
            const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
            this.drawTempRect(x, y, w, h);
            return;
        }

        if (this.drag.kind === "move" && this.drag.shapeId && this.drag.shapeOriginal) {
            const dx = pt.x - this.drag.startX;
            const dy = pt.y - this.drag.startY;
            const orig = this.drag.shapeOriginal;
            if (orig.kind === "rect") {
                this.shapes.updateRect(orig.id, {
                    x: snap(orig.x + dx, SNAP_STEP, snapOn),
                    y: snap(orig.y + dy, SNAP_STEP, snapOn),
                });
            } else {
                this.shapes.updatePolygon(orig.id, orig.points.map(p => ({
                    x: snap(p.x + dx, SNAP_STEP, snapOn),
                    y: snap(p.y + dy, SNAP_STEP, snapOn),
                })));
            }
            return;
        }

        if (this.drag.kind === "resize" && this.drag.shapeOriginal && this.drag.handle) {
            const orig = this.drag.shapeOriginal;
            if (orig.kind !== "rect") return;
            const dx = pt.x - this.drag.startX;
            const dy = pt.y - this.drag.startY;
            const next = this.applyResize(orig, this.drag.handle, dx, dy, snapOn);
            this.shapes.updateRect(orig.id, next);
            return;
        }
    }

    private onMouseUp(_e: MouseEvent): void {
        if (!this.drag) return;
        this.svg.style.cursor = "";

        if (this.drag.kind === "create-rect") {
            const tmp = this.svg.querySelector("#temp-rect");
            const x = parseFloat(tmp?.getAttribute("x")  ?? "0");
            const y = parseFloat(tmp?.getAttribute("y")  ?? "0");
            const w = parseFloat(tmp?.getAttribute("width")  ?? "0");
            const h = parseFloat(tmp?.getAttribute("height") ?? "0");
            tmp?.remove();
            if (w >= MIN_RECT_SIZE && h >= MIN_RECT_SIZE) {
                this.shapes.addRect(x, y, w, h);
            }
        }
        this.drag = null;
    }

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        // Zoom toward mouse position
        const rect = this.svg.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newZoom = Math.max(0.1, Math.min(8, this.zoom * factor));
        // Adjust pan so the point under the cursor stays fixed
        this.panX = sx - (sx - this.panX) * (newZoom / this.zoom);
        this.panY = sy - (sy - this.panY) * (newZoom / this.zoom);
        this.zoom = newZoom;
        this.applyTransform();
        if (this.onZoomChange) this.onZoomChange(this.zoom);
    }

    private onDoubleClick(e: MouseEvent): void {
        // Backup polygon close path. The primary close mechanism is the
        // manual double-click detection in onMouseDown (timestamp-based).
        // This native dblclick handler is kept as a fallback for cases
        // where the browser does fire it reliably.
        if (this.getTool() === "polygon" && this.polygonPoints.length >= 3) {
            e.preventDefault();
            this.commitPolygon();
        }
    }

    private onContextMenu(e: MouseEvent): void {
        // Right-click on a shape removes it
        const target = e.target as Element;
        const node   = this.findShapeNode(target);
        const id     = node?.getAttribute("data-shape-id");
        if (id) {
            e.preventDefault();
            this.shapes.remove(id);
        }
        // Right-click during polygon-build cancels it
        if (this.getTool() === "polygon" && this.polygonPoints.length > 0) {
            e.preventDefault();
            this.cancelPolygon();
        }
    }

    private findShapeNode(el: Element | null): Element | null {
        let cur = el;
        while (cur && cur !== this.svg) {
            if (cur.getAttribute && cur.getAttribute("data-shape-id")
                && !cur.getAttribute("data-handle")
                && !cur.getAttribute("data-vertex-idx")) {
                return cur;
            }
            cur = cur.parentElement;
        }
        return null;
    }

    private drawTempRect(x: number, y: number, w: number, h: number): void {
        let tmp = this.svg.querySelector("#temp-rect") as SVGRectElement | null;
        if (!tmp) {
            tmp = document.createElementNS(SVG_NS, "rect");
            tmp.setAttribute("id", "temp-rect");
            tmp.setAttribute("fill", "rgba(0,229,160,0.18)");
            tmp.setAttribute("stroke", "#00e5a0");
            tmp.setAttribute("stroke-width", String(1.5 / this.zoom));
            tmp.setAttribute("stroke-dasharray", `${4/this.zoom},${3/this.zoom}`);
            this.shapesLayer.appendChild(tmp);
        }
        tmp.setAttribute("x", String(x));
        tmp.setAttribute("y", String(y));
        tmp.setAttribute("width",  String(w));
        tmp.setAttribute("height", String(h));
    }

    /**
     * Compute new {x, y, w, h} for a rect being resized by dragging a handle.
     * Keeps width and height non-negative; if the user drags past the opposite
     * edge, the rect flips correctly.
     */
    private applyResize(
        orig: Rect, h: ResizeHandle, dx: number, dy: number, snapOn: boolean,
    ): { x: number; y: number; w: number; h: number } {
        let { x, y, w, h: hh } = orig;
        const right  = x + w;
        const bottom = y + hh;

        // Adjust the moving edges based on which handle is dragged
        if (h === "nw" || h === "w" || h === "sw") {
            x = orig.x + dx;
        }
        if (h === "nw" || h === "n" || h === "ne") {
            y = orig.y + dy;
        }
        if (h === "ne" || h === "e" || h === "se") {
            w = orig.w + dx;
        }
        if (h === "sw" || h === "s" || h === "se") {
            hh = orig.h + dy;
        }
        // Recompute width/height when left/top edges moved
        if (h === "nw" || h === "w" || h === "sw") {
            w = right - x;
        }
        if (h === "nw" || h === "n" || h === "ne") {
            hh = bottom - y;
        }

        // Snap
        x  = snap(x,  SNAP_STEP, snapOn);
        y  = snap(y,  SNAP_STEP, snapOn);
        w  = snap(w,  SNAP_STEP, snapOn);
        hh = snap(hh, SNAP_STEP, snapOn);

        // Don't allow inverted rects — clamp to minimum size
        if (w < MIN_RECT_SIZE)  w  = MIN_RECT_SIZE;
        if (hh < MIN_RECT_SIZE) hh = MIN_RECT_SIZE;
        return { x, y, w, h: hh };
    }
}