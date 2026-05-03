import type { ToolMode, BackgroundImage } from "./types";
import { DEFAULT_CANVAS_W, DEFAULT_CANVAS_H } from "./types";
import { ShapeManager } from "./ShapeManager";
import { Canvas } from "./Canvas";
import { Toolbar } from "../ui/Toolbar";
import { Sidebar } from "../ui/Sidebar";
import { exportToXlsx } from "../io/exportXlsx";
import { exportToCsv } from "../io/exportCsv";
import { askImageSource, askForUrl, askExportFormat } from "../ui/ImageSourceModal";
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
    // Cached reference to the originally chosen file for embed mode.
    // Lets us re-encode at a higher quality if the user picks CSV at
    // export time after having initially picked an Excel-friendly compression.
    // Only set for "embed" mode — null for "url" mode.
    private bgSourceFile: File | null = null;
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

    /**
     * Load an image file for embed mode WITHOUT compressing it for preview.
     *
     * The editor canvas always uses the original blob URL — never a
     * compressed version — so the user works at 100% fidelity. Compression
     * only happens at export time, and we re-encode using the format and
     * quality profile that fit Power BI's 32K-character cap.
     *
     * If the image is so detailed that NO compression strategy fits within
     * the cap, we surface that fact clearly in the warning so the user
     * knows to switch to External URL flow before exporting (rather than
     * silently producing a broken export).
     */
    private async processEmbedFile(file: File): Promise<void> {
        try {
            const objectUrl = URL.createObjectURL(file);
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const im = new Image();
                im.onload  = () => resolve(im);
                im.onerror = () => reject(new Error("Failed to decode image"));
                im.src = objectUrl;
            });
            const naturalW = img.naturalWidth;
            const naturalH = img.naturalHeight;
            this.bg = {
                src:    objectUrl,
                width:  naturalW,
                height: naturalH,
                name:   file.name,
                mode:   "embed",
            };
            this.bgSourceFile = file;
            this.canvasW = naturalW;
            this.canvasH = naturalH;
            this.toolbar.setHasImage(true);
            this.canvas.render();
            this.canvas.fitToViewport();

            // Pre-flight check: try the AVIF/WebP/JPEG cascade silently in
            // the background so the user knows BEFORE they trace shapes
            // whether the image will fit in PBI's data cap. This avoids
            // wasting hours of work only to discover at export time.
            // Run as a microtask so the canvas render isn't blocked.
            queueMicrotask(async () => {
                try {
                    const probe = await imageFileToDataUri(file, "auto");
                    if (!probe.fitsInPbi) {
                        const sizeKb = Math.round(probe.sizeChars / 1024);
                        const proceed = confirm(
                            "⚠  Image too large for embedding\n\n" +
                            "Even after compression to " + probe.format.toUpperCase() +
                            ", the smallest version is ~" + sizeKb + "KB which exceeds " +
                            "Power BI's 32K limit for visual data fields.\n\n" +
                            "RECOMMENDED: Cancel this image, click Load Image again, " +
                            "and pick 'Use external URL' to upload to Imgur (free, anonymous, 30 seconds).\n\n" +
                            "Continue with degraded image anyway?",
                        );
                        if (!proceed) {
                            // User opted out — clear the background
                            URL.revokeObjectURL(objectUrl);
                            this.bg = null;
                            this.bgSourceFile = null;
                            this.canvasW = DEFAULT_CANVAS_W;
                            this.canvasH = DEFAULT_CANVAS_H;
                            this.toolbar.setHasImage(false);
                            this.canvas.render();
                        }
                    }
                } catch (_e) { /* probe failed; ignore */ }
            });
        } catch (err) {
            alert("Failed to load image: " + (err instanceof Error ? err.message : String(err)));
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
        this.bgSourceFile = null;     // URL mode — no source file to remember
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
    /**
     * Export flow:
     *   1. Ask the user which format (xlsx vs csv).
     *   2. If embedding an image, re-encode at the appropriate quality:
     *      - xlsx → "excel" profile (q=80, aggressive resize if needed)
     *      - csv  → "csv" profile  (q=95, minimal resize)
     *   3. Hand off to the matching writer (exportToXlsx / exportToCsv).
     *
     * Re-encoding at export time gives the user the best possible quality
     * for the format they chose, without requiring them to reload the
     * image just to change formats.
     */
    private async exportFile(): Promise<void> {
        const shapes = this.shapes.getAll();
        if (shapes.length === 0) {
            alert("No shapes to export. Draw at least one shape first.");
            return;
        }

        const hasEmbed = this.bg?.mode === "embed";
        const fmt = await askExportFormat(!!hasEmbed);
        if (fmt === "cancel") return;

        // Resolve the image URL/data URI to embed.
        // - URL mode: use the stored URL directly (always valid for both formats).
        // - Embed mode: re-encode at export time with the "auto" quality
        //   profile, which picks the best AVIF/WebP/JPEG combo that fits
        //   Power BI's 32K data limit. Falls back gracefully if the image
        //   is too large to fit at any quality.
        let imageUrl: string | undefined = undefined;
        if (this.bg) {
            if (this.bg.mode === "url") {
                imageUrl = this.bg.src;
            } else if (this.bg.mode === "embed" && this.bgSourceFile) {
                try {
                    const result = await imageFileToDataUri(this.bgSourceFile, "auto");
                    imageUrl = result.dataUri;
                    if (!result.fitsInPbi) {
                        const sizeKb = Math.round(result.sizeChars / 1024);
                        const proceed = confirm(
                            "⚠  Embedded image (" + result.format.toUpperCase() + ", ~" + sizeKb + "KB) " +
                            "exceeds Power BI's 32K limit. " +
                            "The image WILL appear truncated in Power BI.\n\n" +
                            "Recommended: cancel and switch to External URL flow (Imgur).\n\n" +
                            "Continue with truncated image anyway?",
                        );
                        if (!proceed) return;
                    } else {
                        // Helpful confirmation
                        console.log(
                            "[SynopticStudio] Image embedded as " + result.format.toUpperCase() +
                            ", " + Math.round(result.sizeChars / 1024) + "KB, fits PBI cap.",
                        );
                    }
                } catch (err) {
                    alert("Failed to encode image: " + (err instanceof Error ? err.message : String(err)));
                    return;
                }
            } else {
                imageUrl = this.bg.src;     // fallback
            }
        }

        try {
            if (fmt === "csv") {
                await exportToCsv(shapes, this.canvasW, this.canvasH, this.bg, { imageUrl });
            } else {
                await exportToXlsx(shapes, this.canvasW, this.canvasH, this.bg, { imageUrl });
            }
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
