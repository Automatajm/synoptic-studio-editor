import type { Shape } from "../editor/types";
import { ShapeManager } from "../editor/ShapeManager";

/**
 * Sidebar — list of all shapes. Click to select, double-click to rename,
 * × to delete. Keeps selection highlight in sync with the canvas.
 */
export class Sidebar {
    private root:     HTMLElement;
    private listEl:   HTMLElement;
    private countEl:  HTMLElement;
    private shapes:   ShapeManager;

    constructor(parent: HTMLElement, shapes: ShapeManager) {
        this.shapes = shapes;
        this.root = document.createElement("aside");
        this.root.className = "w-60 bg-surface border-r border-border flex flex-col";
        parent.appendChild(this.root);

        // Header
        const hdr = document.createElement("div");
        hdr.className = "px-3 py-2 border-b border-border flex items-center justify-between";
        const title = document.createElement("div");
        title.className = "text-xs uppercase tracking-wider text-dim font-bold";
        title.textContent = "Objects";
        this.countEl = document.createElement("div");
        this.countEl.className = "text-xs text-dim";
        this.countEl.textContent = "0";
        hdr.appendChild(title);
        hdr.appendChild(this.countEl);
        this.root.appendChild(hdr);

        // List
        this.listEl = document.createElement("div");
        this.listEl.className = "flex-1 overflow-y-auto py-1 scrollbar-hidden";
        this.root.appendChild(this.listEl);

        // Help footer
        const help = document.createElement("div");
        help.className = "px-3 py-2 border-t border-border text-[10px] text-dim leading-relaxed";
        help.innerHTML = `
            <div class="font-bold text-muted mb-1">Tips</div>
            <div>• Drag rect: click + drag</div>
            <div>• Polygon: click points, double-click to close</div>
            <div>• Right-click: delete</div>
            <div>• Wheel: zoom · Alt+drag: pan</div>
        `;
        this.root.appendChild(help);

        this.shapes.onChange(() => this.render());
        this.render();
    }

    private render(): void {
        const all = this.shapes.getAll();
        this.countEl.textContent = String(all.length);
        // Clear list
        while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);

        if (all.length === 0) {
            const empty = document.createElement("div");
            empty.className = "px-3 py-6 text-center text-dim text-xs";
            empty.textContent = "No shapes yet. Pick a tool and start drawing.";
            this.listEl.appendChild(empty);
            return;
        }

        const selectedId = this.shapes.getSelectedId();
        for (const s of all) {
            this.listEl.appendChild(this.buildRow(s, s.id === selectedId));
        }
    }

    private buildRow(shape: Shape, selected: boolean): HTMLElement {
        const row = document.createElement("div");
        row.className = selected
            ? "flex items-center gap-2 px-3 py-1.5 cursor-pointer bg-panel border-l-2 border-accent"
            : "flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-panel border-l-2 border-transparent";
        row.addEventListener("click", () => this.shapes.select(shape.id));

        // Type icon
        const icon = document.createElement("span");
        icon.className = "text-xs text-dim w-4";
        icon.textContent = shape.kind === "rect" ? "▭" : "⬡";
        row.appendChild(icon);

        // Label (with inline rename via dblclick)
        const label = document.createElement("span");
        label.className = "flex-1 text-xs text-text truncate";
        label.textContent = shape.label;
        label.addEventListener("dblclick", e => {
            e.stopPropagation();
            this.startRename(shape.id, label);
        });
        row.appendChild(label);

        // Delete
        const del = document.createElement("button");
        del.className = "text-dim hover:text-danger text-xs px-1 opacity-0 hover:opacity-100";
        del.textContent = "✕";
        del.title = "Delete";
        del.addEventListener("click", e => {
            e.stopPropagation();
            this.shapes.remove(shape.id);
        });
        row.appendChild(del);

        // Always show ✕ on hover via group hover trick
        row.addEventListener("mouseenter", () => del.style.opacity = "1");
        row.addEventListener("mouseleave", () => del.style.opacity = "0");

        return row;
    }

    private startRename(id: string, labelEl: HTMLElement): void {
        const shape = this.shapes.getById(id);
        if (!shape) return;
        const input = document.createElement("input");
        input.type = "text";
        input.value = shape.label;
        input.className = "flex-1 text-xs bg-bg border border-accent rounded px-1 outline-none text-text";
        labelEl.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => {
            this.shapes.rename(id, input.value);
            // Re-render is triggered by ShapeManager change
        };
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", e => {
            if (e.key === "Enter")  { e.preventDefault(); input.blur(); }
            if (e.key === "Escape") { input.value = shape.label; input.blur(); }
        });
    }
}
