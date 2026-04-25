import type { ToolMode, BackgroundImage } from "./types";
import { DEFAULT_CANVAS_W, DEFAULT_CANVAS_H } from "./types";
import { ShapeManager } from "./ShapeManager";
import { Canvas } from "./Canvas";
import { Toolbar } from "../ui/Toolbar";
import { Sidebar } from "../ui/Sidebar";
import { exportToXlsx } from "../io/exportXlsx";

/**
 * Editor — top-level controller.
 * Holds the editor state that's NOT shape-related (tool, zoom, bg image,
 * snap setting), wires up the UI, and routes events.
 */
export class Editor {
    private root:    HTMLElement;
    private shapes:  ShapeManager;
    private canvas:  Canvas;
    private toolbar: Toolbar;
    // sidebar is created for its DOM side-effects; we don't reference it after construction
    private _sidebar: Sidebar;

    private tool: ToolMode = "select";
    private bg:   BackgroundImage | null = null;
    private canvasW = DEFAULT_CANVAS_W;
    private canvasH = DEFAULT_CANVAS_H;
    private snap    = false;

    constructor(root: HTMLElement) {
        this.root = root;
        this.root.className = "h-full w-full flex flex-col bg-bg text-text";

        this.shapes = new ShapeManager();

        // Toolbar — top
        this.toolbar = new Toolbar(this.root, {
            onToolChange:  t => this.setTool(t),
            onLoadImage:   () => this.loadImageDialog(),
            onClearImage:  () => this.clearImage(),
            onZoomIn:      () => this.canvas.zoomIn(),
            onZoomOut:     () => this.canvas.zoomOut(),
            onFitView:     () => this.canvas.fitToViewport(),
            onSnapToggle:  s => { this.snap = s; },
            onExport:      () => this.exportFile(),
            onClearAll:    () => this.shapes.clearAll(),
        });

        // Body — sidebar + canvas
        const body = document.createElement("div");
        body.className = "flex-1 flex min-h-0";
        this.root.appendChild(body);

        this._sidebar = new Sidebar(body, this.shapes);

        const canvasWrap = document.createElement("div");
        canvasWrap.className = "flex-1 relative bg-bg";
        body.appendChild(canvasWrap);

        this.canvas = new Canvas(canvasWrap, this.shapes, {
            getCanvasW: () => this.canvasW,
            getCanvasH: () => this.canvasH,
            getTool:    () => this.tool,
            getBg:      () => this.bg,
            getSnap:    () => this.snap,
        });
        this.canvas.onZoom(z => this.toolbar.setZoom(z));

        // Reference _sidebar to satisfy TS (it's used for its constructor side effects)
        void this._sidebar;

        // Keyboard shortcuts
        this.attachKeyboard();

        // Initial fit
        // Defer to allow layout to settle
        setTimeout(() => this.canvas.fitToViewport(), 0);
    }

    private setTool(t: ToolMode): void {
        // Switching tool while building a polygon — cancel the in-progress polygon
        if (this.tool === "polygon" && t !== "polygon") {
            this.canvas.cancelPolygon();
        }
        this.tool = t;
        this.toolbar.setTool(t);
        if (t !== "select") this.shapes.clearSelection();
    }

    // ── Image loading ───────────────────────────────────────────────────
    private loadImageDialog(): void {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.style.display = "none";
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (file) this.loadImageFile(file);
        });
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    private loadImageFile(file: File): void {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new Image();
            img.onload = () => {
                this.bg = {
                    src:    dataUrl,
                    width:  img.naturalWidth,
                    height: img.naturalHeight,
                    name:   file.name,
                };
                // Resize canvas to match image natural dimensions for pixel-perfect
                // alignment of shapes against the picture.
                this.canvasW = img.naturalWidth;
                this.canvasH = img.naturalHeight;
                this.toolbar.setHasImage(true);
                this.canvas.render();
                this.canvas.fitToViewport();
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }

    private clearImage(): void {
        this.bg = null;
        this.canvasW = DEFAULT_CANVAS_W;
        this.canvasH = DEFAULT_CANVAS_H;
        this.toolbar.setHasImage(false);
        this.canvas.render();
        this.canvas.fitToViewport();
    }

    // ── Export ──────────────────────────────────────────────────────────
    private async exportFile(): Promise<void> {
        const shapes = this.shapes.getAll();
        if (shapes.length === 0) {
            alert("No shapes to export. Draw at least one shape first.");
            return;
        }
        // Ask for image URL only if a background is loaded
        let imageUrl: string | undefined = undefined;
        if (this.bg) {
            const answer = prompt(
                "Optional: paste a public image URL to include in the export. " +
                "Leave blank to export coordinates only.",
                "",
            );
            if (answer && answer.trim().length > 0) imageUrl = answer.trim();
        }
        try {
            await exportToXlsx(shapes, this.canvasW, this.canvasH, this.bg, { imageUrl });
        } catch (err) {
            alert("Export failed: " + (err instanceof Error ? err.message : String(err)));
        }
    }

    // ── Keyboard ────────────────────────────────────────────────────────
    private attachKeyboard(): void {
        window.addEventListener("keydown", e => {
            // Ignore when the user is typing in an input
            const tag = (e.target as HTMLElement | null)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;

            switch (e.key) {
                case "v": case "V":
                    this.setTool("select"); break;
                case "r": case "R":
                    this.setTool("rect"); break;
                case "p": case "P":
                    this.setTool("polygon"); break;
                case "Delete": case "Backspace":
                    if (this.shapes.getSelectedId()) {
                        e.preventDefault();
                        this.shapes.removeSelected();
                    }
                    break;
                case "Enter":
                    if (this.tool === "polygon") {
                        e.preventDefault();
                        this.canvas.commitPolygon();
                    }
                    break;
                case "Escape":
                    if (this.tool === "polygon") {
                        this.canvas.cancelPolygon();
                    } else {
                        this.shapes.clearSelection();
                    }
                    break;
            }
        });
    }
}
