import type { ToolMode, BackgroundImage } from "./types";
import { DEFAULT_CANVAS_W, DEFAULT_CANVAS_H } from "./types";
import { ShapeManager } from "./ShapeManager";
import { Canvas } from "./Canvas";
import { Toolbar } from "../ui/Toolbar";
import { Sidebar } from "../ui/Sidebar";
import { exportToXlsx } from "../io/exportXlsx";
import { askImageSource, askForUrl } from "../ui/ImageSourceModal";
import { imageFileToDataUri, probeImageUrl } from "../lib/image";

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
    /**
     * Two-step flow for adding a background image:
     *   1. Ask the user how they want to attach it (embed vs external URL).
     *   2. Open the appropriate input (file picker or URL prompt) and
     *      process the result.
     * Either step can be cancelled — the editor state is only updated when
     * a valid image is fully loaded.
     */
    private async loadImageDialog(): Promise<void> {
        const choice = await askImageSource();
        if (choice === "cancel") return;
        if (choice === "embed") {
            await this.openFilePickerForEmbed();
        } else {
            await this.openUrlPromptForExternal();
        }
    }

    private openFilePickerForEmbed(): Promise<void> {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.style.display = "none";
            input.addEventListener("change", async () => {
                const file = input.files?.[0];
                if (file) await this.processEmbedFile(file);
                document.body.removeChild(input);
                resolve();
            });
            document.body.appendChild(input);
            input.click();
        });
    }

    private async processEmbedFile(file: File): Promise<void> {
        try {
            const result = await imageFileToDataUri(file);
            if (result.tooLarge) {
                const proceed = confirm(
                    "This image is large (" + Math.round(result.sizeChars / 1024) + " KB after compression).\n\n" +
                    "It exceeds the recommended Excel cell limit. The export may not work correctly.\n\n" +
                    "Continue anyway, or cancel and try a smaller image / external URL?",
                );
                if (!proceed) return;
            }
            this.bg = {
                src:       result.dataUri,
                width:     result.width,
                height:    result.height,
                name:      file.name,
                mode:      "embed",
                embedSize: result.sizeChars,
            };
            this.canvasW = result.width;
            this.canvasH = result.height;
            this.toolbar.setHasImage(true);
            this.canvas.render();
            this.canvas.fitToViewport();
        } catch (err) {
            alert("Failed to process image: " + (err instanceof Error ? err.message : String(err)));
        }
    }

    private async openUrlPromptForExternal(): Promise<void> {
        const url = await askForUrl();
        if (!url) return;
        const probe = await probeImageUrl(url);
        if (!probe.ok) {
            alert("Couldn't load that URL: " + probe.reason);
            return;
        }
        this.bg = {
            src:    url,
            width:  probe.width,
            height: probe.height,
            name:   url.split("/").pop() || "remote-image",
            mode:   "url",
        };
        this.canvasW = probe.width;
        this.canvasH = probe.height;
        this.toolbar.setHasImage(true);
        this.canvas.render();
        this.canvas.fitToViewport();
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
        // The image source (embed data URI or external URL) is set when the
        // user loaded the image — no need to prompt again at export time.
        // For embed mode, the data URI lives in bg.src; for URL mode, the URL.
        // The exportXlsx writer puts it in the FIRST row's Image_URL only,
        // leaving subsequent rows empty so the file stays compact even for
        // large embedded images. The visual reads the first non-empty value.
        const imageUrl = this.bg ? this.bg.src : undefined;
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
