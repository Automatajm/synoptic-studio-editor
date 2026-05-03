// Lightweight modal helper. Vanilla DOM, no framework.
//
// Used by the "Load Image" flow to ask the user whether to embed the image
// (base64 in the Excel) or reference it by external URL. Two-step UX:
//   1. Show choice (Embed / URL) — returns "embed" | "url" | "cancel"
//   2. Caller proceeds with file picker or URL input as appropriate.
//
// Kept dependency-free and styled inline so it doesn't need any external CSS
// loaded. Looks consistent with the editor's dark UI palette.

export type ImageChoice = "embed" | "url" | "cancel";

const PALETTE = {
    bg:      "#0f1419",
    surface: "#1a1f26",
    border:  "#2a3441",
    text:    "#e0eef7",
    dim:     "#8aa5b8",
    accent:  "#00e5a0",
    accentDim: "#1a5a45",
};

function styleEl(el: HTMLElement, css: Partial<CSSStyleDeclaration>): void {
    Object.assign(el.style, css);
}

/**
 * Show the image-source choice modal. Returns a promise that resolves with
 * the user's selection (or "cancel" if dismissed).
 */
export async function askImageSource(): Promise<ImageChoice> {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        styleEl(overlay, {
            position: "fixed", inset: "0",
            background: "rgba(0,0,0,0.65)",
            zIndex: "9999",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Segoe UI', sans-serif",
        });

        const dialog = document.createElement("div");
        styleEl(dialog, {
            background: PALETTE.surface,
            border: `1px solid ${PALETTE.border}`,
            borderRadius: "10px",
            padding: "20px 24px",
            maxWidth: "520px",
            width: "calc(100vw - 40px)",
            color: PALETTE.text,
            boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
        });

        const title = document.createElement("div");
        title.textContent = "Add Background Image";
        styleEl(title, {
            fontSize: "16px", fontWeight: "700",
            marginBottom: "4px", color: PALETTE.accent,
        });
        dialog.appendChild(title);

        const subtitle = document.createElement("div");
        subtitle.textContent = "Choose how to attach the image to your synoptic.";
        styleEl(subtitle, {
            fontSize: "12px", color: PALETTE.dim,
            marginBottom: "18px",
        });
        dialog.appendChild(subtitle);

        // Build a card for each option
        const makeCard = (title: string, desc: string, action: ImageChoice): HTMLDivElement => {
            const card = document.createElement("div");
            styleEl(card, {
                background: PALETTE.bg,
                border: `1px solid ${PALETTE.border}`,
                borderRadius: "8px",
                padding: "14px 16px",
                marginBottom: "10px",
                cursor: "pointer",
                transition: "all 0.15s",
            });
            card.addEventListener("mouseenter", () => {
                card.style.borderColor = PALETTE.accent;
                card.style.background  = PALETTE.accentDim;
            });
            card.addEventListener("mouseleave", () => {
                card.style.borderColor = PALETTE.border;
                card.style.background  = PALETTE.bg;
            });
            card.addEventListener("click", () => {
                cleanup();
                resolve(action);
            });

            const t = document.createElement("div");
            t.textContent = title;
            styleEl(t, { fontSize: "13px", fontWeight: "600", marginBottom: "3px" });
            card.appendChild(t);

            const d = document.createElement("div");
            d.textContent = desc;
            styleEl(d, { fontSize: "11px", color: PALETTE.dim, lineHeight: "1.5" });
            card.appendChild(d);

            return card;
        };

        dialog.appendChild(makeCard(
            "Embed in Excel (recommended)",
            "Image is compressed and stored as base64 inside the exported file. Self-contained — no hosting required, works offline. Best for files under ~500KB.",
            "embed",
        ));

        dialog.appendChild(makeCard(
            "Use external URL",
            "Image stays on a public server (GitHub raw, Imgur, your CDN) and the Excel only carries the URL. Smaller file, but the URL must remain reachable.",
            "url",
        ));

        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        styleEl(cancel, {
            background: "transparent",
            border: `1px solid ${PALETTE.border}`,
            color: PALETTE.dim,
            padding: "6px 14px",
            borderRadius: "5px",
            cursor: "pointer",
            fontSize: "11px",
            marginTop: "4px",
            float: "right",
        });
        cancel.addEventListener("click", () => {
            cleanup();
            resolve("cancel");
        });
        dialog.appendChild(cancel);

        const cleanup = () => {
            window.removeEventListener("keydown", onKey);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                cleanup();
                resolve("cancel");
            }
        };
        window.addEventListener("keydown", onKey);

        overlay.appendChild(dialog);
        // Click outside dialog cancels
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve("cancel");
            }
        });
        document.body.appendChild(overlay);
    });
}

/**
 * Prompt for a URL with validation feedback. Returns the URL (trimmed)
 * or null if cancelled.
 */
export async function askForUrl(initial = ""): Promise<string | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        styleEl(overlay, {
            position: "fixed", inset: "0",
            background: "rgba(0,0,0,0.65)",
            zIndex: "9999",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Segoe UI', sans-serif",
        });

        const dialog = document.createElement("div");
        styleEl(dialog, {
            background: PALETTE.surface,
            border: `1px solid ${PALETTE.border}`,
            borderRadius: "10px",
            padding: "20px 24px",
            maxWidth: "560px",
            width: "calc(100vw - 40px)",
            color: PALETTE.text,
            boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
        });

        const title = document.createElement("div");
        title.textContent = "Image URL";
        styleEl(title, {
            fontSize: "15px", fontWeight: "700",
            marginBottom: "4px", color: PALETTE.accent,
        });
        dialog.appendChild(title);

        const desc = document.createElement("div");
        desc.textContent = "Paste a public, direct image URL. For GitHub use the raw.githubusercontent.com URL, not the github.com page URL.";
        styleEl(desc, {
            fontSize: "11px", color: PALETTE.dim,
            marginBottom: "12px", lineHeight: "1.5",
        });
        dialog.appendChild(desc);

        const input = document.createElement("input");
        input.type = "text";
        input.value = initial;
        input.placeholder = "https://raw.githubusercontent.com/.../image.jpg";
        styleEl(input, {
            width: "100%", padding: "8px 10px",
            background: PALETTE.bg,
            border: `1px solid ${PALETTE.border}`,
            color: PALETTE.text,
            borderRadius: "5px",
            fontSize: "12px",
            fontFamily: "monospace",
            outline: "none",
            boxSizing: "border-box",
        });
        dialog.appendChild(input);

        const buttons = document.createElement("div");
        styleEl(buttons, {
            marginTop: "14px", display: "flex",
            justifyContent: "flex-end", gap: "8px",
        });

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        styleEl(cancelBtn, {
            background: "transparent",
            border: `1px solid ${PALETTE.border}`,
            color: PALETTE.dim,
            padding: "6px 14px",
            borderRadius: "5px",
            cursor: "pointer",
            fontSize: "11px",
        });

        const okBtn = document.createElement("button");
        okBtn.textContent = "Use this URL";
        styleEl(okBtn, {
            background: PALETTE.accent,
            border: "none",
            color: "#0a0e13",
            padding: "6px 14px",
            borderRadius: "5px",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "700",
        });

        buttons.appendChild(cancelBtn);
        buttons.appendChild(okBtn);
        dialog.appendChild(buttons);

        const cleanup = () => {
            window.removeEventListener("keydown", onKey);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };
        const submit = () => {
            const v = input.value.trim();
            if (v.length === 0) return;
            cleanup();
            resolve(v);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { cleanup(); resolve(null); }
            if (e.key === "Enter" && document.activeElement === input) submit();
        };
        window.addEventListener("keydown", onKey);
        cancelBtn.addEventListener("click", () => { cleanup(); resolve(null); });
        okBtn.addEventListener("click", submit);

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) { cleanup(); resolve(null); }
        });

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        // Auto-focus the input
        setTimeout(() => input.focus(), 50);
    });
}
