// Lightweight modal helper. Vanilla DOM, no framework.
//
// Used by the "Load Image" flow to ask the user whether to embed the image
// (base64 in the export) or reference it by external URL. Two-step UX:
//   1. Show choice (Embed / URL) — returns "embed" | "url" | "cancel"
//   2. Caller proceeds with file picker or URL input as appropriate.
//
// Also exposes `askExportFormat` for the export flow: lets the user pick
// between Excel (compact, tight image quality) and CSV (larger files,
// preserves image quality near-original).
//
// Kept dependency-free and styled inline so it doesn't need any external CSS
// loaded. Looks consistent with the editor's dark UI palette.

export type ImageChoice  = "embed" | "url" | "cancel";
export type ExportFormat = "xlsx"  | "csv" | "cancel";

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
            "Embed in Excel/CSV (recommended for most cases)",
            "Image is compressed (AVIF/WebP/JPEG, whichever your browser supports best) and stored inside the export. Self-contained, no hosting. Works for moderate-sized images; very large architectural plans may exceed Power BI's 32K data limit and require the URL flow below.",
            "embed",
        ));

        // Compose the URL card with an extra inline link to Imgur.
        const urlCard = document.createElement("div");
        Object.assign(urlCard.style, {
            background: PALETTE.bg,
            border: `1px solid ${PALETTE.border}`,
            borderRadius: "8px",
            padding: "14px 16px",
            marginBottom: "10px",
            cursor: "pointer",
            transition: "all 0.15s",
        } as Partial<CSSStyleDeclaration>);
        urlCard.addEventListener("mouseenter", () => {
            urlCard.style.borderColor = PALETTE.accent;
            urlCard.style.background  = PALETTE.accentDim;
        });
        urlCard.addEventListener("mouseleave", () => {
            urlCard.style.borderColor = PALETTE.border;
            urlCard.style.background  = PALETTE.bg;
        });
        urlCard.addEventListener("click", (e) => {
            // Don't trigger the URL choice if the user clicked the inner Imgur button
            if ((e.target as HTMLElement).getAttribute("data-imgur-btn")) return;
            cleanup();
            resolve("url");
        });

        const urlTitle = document.createElement("div");
        urlTitle.textContent = "Use external URL (best for large images)";
        Object.assign(urlTitle.style, {
            fontSize: "13px", fontWeight: "600", marginBottom: "3px",
        } as Partial<CSSStyleDeclaration>);
        urlCard.appendChild(urlTitle);

        const urlDesc = document.createElement("div");
        urlDesc.textContent = "Image stays on a public server (Imgur, GitHub raw, your CDN). Bypasses Power BI's data-size limit, so the original image is rendered at full quality regardless of size.";
        Object.assign(urlDesc.style, {
            fontSize: "11px", color: PALETTE.dim, lineHeight: "1.5",
            marginBottom: "8px",
        } as Partial<CSSStyleDeclaration>);
        urlCard.appendChild(urlDesc);

        // Inline helper: a small button that opens Imgur.com in a new tab.
        // Imgur is anonymous and free — drag-drop the image, copy the
        // direct image URL, paste it into the next step. Whole flow is ~30s.
        const imgurBtn = document.createElement("button");
        imgurBtn.textContent = "↗  Open Imgur to upload your image";
        imgurBtn.setAttribute("data-imgur-btn", "1");
        Object.assign(imgurBtn.style, {
            background: "transparent",
            border: `1px solid ${PALETTE.accent}`,
            color: PALETTE.accent,
            padding: "4px 10px",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "600",
        } as Partial<CSSStyleDeclaration>);
        imgurBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.open("https://imgur.com/upload", "_blank", "noopener,noreferrer");
        });
        urlCard.appendChild(imgurBtn);

        dialog.appendChild(urlCard);

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

/**
 * Prompt the user to pick between Excel and CSV when exporting.
 *
 * Excel is the compact default but its 32,767-char cell limit forces
 * aggressive image compression when an image is embedded. CSV has no
 * such limit in Power BI's importer, so it can carry near-original
 * image quality at the cost of a larger file.
 *
 * Returns "xlsx" | "csv" | "cancel". If the user has no embedded image,
 * the difference is mostly cosmetic — both formats produce a tiny file —
 * but we still ask so the user is aware of the option.
 */
export async function askExportFormat(hasEmbed: boolean): Promise<ExportFormat> {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
            position: "fixed", inset: "0",
            background: "rgba(0,0,0,0.65)",
            zIndex: "9999",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Segoe UI', sans-serif",
        } as Partial<CSSStyleDeclaration>);

        const PALETTE = {
            bg:        "#0f1419",
            surface:   "#1a1f26",
            border:    "#2a3441",
            text:      "#e0eef7",
            dim:       "#8aa5b8",
            accent:    "#00e5a0",
            accentDim: "#1a5a45",
            warn:      "#f5a623",
        };

        const dialog = document.createElement("div");
        Object.assign(dialog.style, {
            background: PALETTE.surface,
            border: `1px solid ${PALETTE.border}`,
            borderRadius: "10px",
            padding: "20px 24px",
            maxWidth: "560px",
            width: "calc(100vw - 40px)",
            color: PALETTE.text,
            boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
        } as Partial<CSSStyleDeclaration>);

        const title = document.createElement("div");
        title.textContent = "Export Format";
        Object.assign(title.style, {
            fontSize: "16px", fontWeight: "700",
            marginBottom: "4px", color: PALETTE.accent,
        } as Partial<CSSStyleDeclaration>);
        dialog.appendChild(title);

        const subtitle = document.createElement("div");
        subtitle.textContent = hasEmbed
            ? "You have an embedded image. Format choice affects image quality."
            : "Choose the file format for your synoptic export.";
        Object.assign(subtitle.style, {
            fontSize: "12px", color: PALETTE.dim,
            marginBottom: "18px",
        } as Partial<CSSStyleDeclaration>);
        dialog.appendChild(subtitle);

        const makeCard = (
            heading: string, desc: string, badge: string, badgeColor: string,
            action: ExportFormat,
        ): HTMLDivElement => {
            const card = document.createElement("div");
            Object.assign(card.style, {
                background: PALETTE.bg,
                border: `1px solid ${PALETTE.border}`,
                borderRadius: "8px",
                padding: "14px 16px",
                marginBottom: "10px",
                cursor: "pointer",
                transition: "all 0.15s",
            } as Partial<CSSStyleDeclaration>);
            card.addEventListener("mouseenter", () => {
                card.style.borderColor = PALETTE.accent;
                card.style.background = PALETTE.accentDim;
            });
            card.addEventListener("mouseleave", () => {
                card.style.borderColor = PALETTE.border;
                card.style.background = PALETTE.bg;
            });
            card.addEventListener("click", () => {
                cleanup();
                resolve(action);
            });

            const headRow = document.createElement("div");
            Object.assign(headRow.style, {
                display: "flex", alignItems: "center",
                gap: "8px", marginBottom: "3px",
            } as Partial<CSSStyleDeclaration>);
            const t = document.createElement("div");
            t.textContent = heading;
            Object.assign(t.style, { fontSize: "13px", fontWeight: "600" } as Partial<CSSStyleDeclaration>);
            headRow.appendChild(t);

            const b = document.createElement("span");
            b.textContent = badge;
            Object.assign(b.style, {
                fontSize: "10px",
                padding: "2px 7px",
                borderRadius: "10px",
                background: badgeColor,
                color: "#0a0e13",
                fontWeight: "700",
            } as Partial<CSSStyleDeclaration>);
            headRow.appendChild(b);
            card.appendChild(headRow);

            const d = document.createElement("div");
            d.textContent = desc;
            Object.assign(d.style, {
                fontSize: "11px", color: PALETTE.dim, lineHeight: "1.5",
            } as Partial<CSSStyleDeclaration>);
            card.appendChild(d);

            return card;
        };

        dialog.appendChild(makeCard(
            "Excel (.xlsx)",
            hasEmbed
                ? "Compact file with multi-sheet metadata. Embedded images are compressed (q=80) to fit Excel's 32K-char cell limit — fine for most cases but may lose detail on architectural drawings."
                : "Compact file with multi-sheet metadata. Familiar format for most analysts.",
            "compact",
            PALETTE.accent,
            "xlsx",
        ));

        dialog.appendChild(makeCard(
            "CSV (.csv)",
            hasEmbed
                ? "No cell-size limit, so embedded images preserve near-original quality (JPEG q=95). Larger file. Recommended for detailed plans, satellite imagery, anything where contours matter."
                : "Plain text format, no cell-size limit. Slightly larger but universally readable.",
            hasEmbed ? "best quality" : "high quality",
            hasEmbed ? PALETTE.warn : PALETTE.accent,
            "csv",
        ));

        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        Object.assign(cancel.style, {
            background: "transparent",
            border: `1px solid ${PALETTE.border}`,
            color: PALETTE.dim,
            padding: "6px 14px",
            borderRadius: "5px",
            cursor: "pointer",
            fontSize: "11px",
            marginTop: "4px",
            float: "right",
        } as Partial<CSSStyleDeclaration>);
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
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve("cancel");
            }
        });
        document.body.appendChild(overlay);
    });
}
