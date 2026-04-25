import type { ToolMode } from "../editor/types";

export interface ToolbarCallbacks {
    onToolChange:  (tool: ToolMode) => void;
    onLoadImage:   () => void;
    onClearImage:  () => void;
    onZoomIn:      () => void;
    onZoomOut:     () => void;
    onFitView:     () => void;
    onSnapToggle:  (enabled: boolean) => void;
    onExport:      () => void;
    onClearAll:    () => void;
}

/**
 * Top toolbar — tool selection, zoom, snap toggle, export button.
 * No state of its own; reflects state passed via setters.
 */
export class Toolbar {
    private root:    HTMLElement;
    private cb:      ToolbarCallbacks;
    private toolBtns: Record<ToolMode, HTMLButtonElement> = {} as Record<ToolMode, HTMLButtonElement>;
    private zoomDisplay: HTMLElement | null = null;
    private snapBtn:     HTMLButtonElement | null = null;
    private currentTool: ToolMode = "select";
    private snapEnabled: boolean = false;
    private clearImgBtn: HTMLButtonElement | null = null;

    constructor(parent: HTMLElement, cb: ToolbarCallbacks) {
        this.cb = cb;
        this.root = document.createElement("div");
        this.root.className = "flex items-center gap-2 px-3 h-12 bg-surface border-b border-border";
        parent.appendChild(this.root);
        this.build();
    }

    setTool(tool: ToolMode): void {
        this.currentTool = tool;
        this.refreshToolButtons();
    }
    setZoom(z: number): void {
        if (this.zoomDisplay) this.zoomDisplay.textContent = `${Math.round(z * 100)}%`;
    }
    setSnap(enabled: boolean): void {
        this.snapEnabled = enabled;
        this.refreshSnapButton();
    }
    setHasImage(has: boolean): void {
        if (this.clearImgBtn) this.clearImgBtn.style.display = has ? "" : "none";
    }

    private build(): void {
        // Logo / title
        const title = document.createElement("div");
        title.className = "flex items-center gap-2 mr-3";
        title.innerHTML = `
            <span class="text-accent font-bold text-sm tracking-wide">SYNOPTIC STUDIO</span>
            <span class="text-dim text-xs">Editor</span>
        `;
        this.root.appendChild(title);

        this.divider();

        // Tool buttons
        const tools: { mode: ToolMode; label: string; title: string }[] = [
            { mode: "select",  label: "↖ Select",  title: "Select / Move (V)" },
            { mode: "rect",    label: "▭ Rect",    title: "Draw rectangle (R)" },
            { mode: "polygon", label: "⬡ Polygon", title: "Draw polygon (P) — double-click to close" },
        ];
        for (const t of tools) {
            const btn = this.toolBtn(t.label, t.title, () => this.cb.onToolChange(t.mode));
            this.toolBtns[t.mode] = btn;
            this.root.appendChild(btn);
        }
        this.refreshToolButtons();

        this.divider();

        // Image controls
        const loadBtn = this.btn("📷 Load image", "Load a background image", () => this.cb.onLoadImage());
        this.root.appendChild(loadBtn);
        this.clearImgBtn = this.btn("✕", "Remove background image", () => this.cb.onClearImage());
        this.clearImgBtn.style.display = "none";
        this.root.appendChild(this.clearImgBtn);

        this.divider();

        // Zoom controls
        const zOut = this.btn("−", "Zoom out", () => this.cb.onZoomOut());
        zOut.style.minWidth = "32px";
        this.root.appendChild(zOut);
        const zd = document.createElement("span");
        zd.className = "text-text text-xs font-semibold min-w-[44px] text-center";
        zd.textContent = "100%";
        this.zoomDisplay = zd;
        this.root.appendChild(zd);
        const zIn = this.btn("+", "Zoom in", () => this.cb.onZoomIn());
        zIn.style.minWidth = "32px";
        this.root.appendChild(zIn);
        const fit = this.btn("⤢ Fit", "Fit to viewport", () => this.cb.onFitView());
        this.root.appendChild(fit);

        this.divider();

        // Snap toggle
        this.snapBtn = this.btn("◫ Snap", "Toggle snap to grid (10px)", () => {
            this.snapEnabled = !this.snapEnabled;
            this.refreshSnapButton();
            this.cb.onSnapToggle(this.snapEnabled);
        });
        this.root.appendChild(this.snapBtn);
        this.refreshSnapButton();

        // Spacer
        const spacer = document.createElement("div");
        spacer.className = "flex-1";
        this.root.appendChild(spacer);

        // Clear all
        this.root.appendChild(this.btn("🗑 Clear all", "Remove all shapes", () => {
            if (confirm("Remove all shapes? This cannot be undone.")) {
                this.cb.onClearAll();
            }
        }));

        // Export — accent button
        const exp = document.createElement("button");
        exp.className = "px-4 py-1.5 bg-accent text-bg font-bold text-xs rounded-md hover:bg-accentDim transition-colors";
        exp.textContent = "↓ Export";
        exp.title = "Export coordinates as Excel";
        exp.addEventListener("click", () => this.cb.onExport());
        this.root.appendChild(exp);
    }

    private toolBtn(label: string, title: string, onClick: () => void): HTMLButtonElement {
        const b = this.btn(label, title, onClick);
        b.dataset.role = "tool";
        return b;
    }

    private btn(label: string, title: string, onClick: () => void): HTMLButtonElement {
        const b = document.createElement("button");
        b.className = "px-2.5 py-1 text-xs text-text bg-panel border border-border rounded hover:border-accent hover:text-accent transition-colors";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", onClick);
        return b;
    }

    private divider(): void {
        const d = document.createElement("div");
        d.className = "w-px h-6 bg-border mx-1";
        this.root.appendChild(d);
    }

    private refreshToolButtons(): void {
        for (const mode of Object.keys(this.toolBtns) as ToolMode[]) {
            const btn = this.toolBtns[mode];
            const active = mode === this.currentTool;
            btn.className = active
                ? "px-2.5 py-1 text-xs text-bg font-bold bg-accent border border-accent rounded transition-colors"
                : "px-2.5 py-1 text-xs text-text bg-panel border border-border rounded hover:border-accent hover:text-accent transition-colors";
        }
    }

    private refreshSnapButton(): void {
        if (!this.snapBtn) return;
        this.snapBtn.className = this.snapEnabled
            ? "px-2.5 py-1 text-xs text-bg font-bold bg-accent border border-accent rounded transition-colors"
            : "px-2.5 py-1 text-xs text-text bg-panel border border-border rounded hover:border-accent hover:text-accent transition-colors";
    }
}
