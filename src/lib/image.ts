// Image processing helpers.
//
// ──────────────────────────────────────────────────────────────────────────
//  THE 32K POWER BI LIMIT
// ──────────────────────────────────────────────────────────────────────────
// Power BI's custom-visual runtime caps text fields passed to visuals at
// ~32,766 characters. Anything longer gets silently truncated. For
// background images embedded as base64 data URIs, this is brutal: a
// JPEG q=80 of a 1500x900 architectural plan can easily reach 200K
// characters, well beyond the limit.
//
// Strategy: use the BEST available image format the browser supports,
// pre-resize when natural dimensions are excessive, and tell the user
// honestly when the image is too large to embed (so they can switch to
// the External URL flow).
//
// Format priority: AVIF → WebP → JPEG.
// AVIF compresses ~50% better than JPEG at the same perceived quality.
// WebP compresses ~30% better. JPEG is the universal fallback.
//
// We probe browser support by attempting toDataURL with the format —
// browsers that don't support the requested type silently return PNG,
// which is our cue to fall through to the next candidate.

const PBI_VISUAL_MAX_CHARS = 32_700;     // PBI's actual cap is 32,766; leave headroom
const MAX_NATURAL_EDGE = 1920;           // pre-resize cap; matches typical screen width
const JPEG_QUALITY_FALLBACK_STEPS = [0.92, 0.85, 0.78, 0.70, 0.60];
const WEBP_QUALITY_FALLBACK_STEPS = [0.92, 0.85, 0.78, 0.70, 0.60];
const AVIF_QUALITY_FALLBACK_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45];

export type EmbedQuality = "excel" | "csv" | "auto";
export type EmbedFormat  = "avif" | "webp" | "jpeg";

export interface EmbedResult {
    dataUri:   string;
    format:    EmbedFormat;
    width:     number;
    height:    number;
    sizeChars: number;
    fitsInPbi: boolean;
    quality:   EmbedQuality;
}

export async function loadImageFromFile(file: File): Promise<{ src: string; width: number; height: number }> {
    const objectUrl = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({
            src:    objectUrl,
            width:  img.naturalWidth,
            height: img.naturalHeight,
        });
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Failed to load image"));
        };
        img.src = objectUrl;
    });
}

export async function imageFileToDataUri(
    file: File,
    quality: EmbedQuality = "auto",
): Promise<EmbedResult> {
    const img = await loadImage(file);
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;

    const maxEdge = Math.max(naturalW, naturalH);
    let scale = 1.0;
    if (quality === "csv" && maxEdge > 4096) {
        scale = 4096 / maxEdge;
    } else if (quality === "excel" || quality === "auto") {
        if (maxEdge > MAX_NATURAL_EDGE) {
            scale = MAX_NATURAL_EDGE / maxEdge;
        }
    }
    const targetW = Math.round(naturalW * scale);
    const targetH = Math.round(naturalH * scale);

    const candidates: { format: EmbedFormat; steps: number[]; mime: string }[] = [
        { format: "avif", steps: AVIF_QUALITY_FALLBACK_STEPS, mime: "image/avif" },
        { format: "webp", steps: WEBP_QUALITY_FALLBACK_STEPS, mime: "image/webp" },
        { format: "jpeg", steps: JPEG_QUALITY_FALLBACK_STEPS, mime: "image/jpeg" },
    ];

    let best: EmbedResult | null = null;

    for (const c of candidates) {
        const probe = renderCanvas(img, targetW, targetH, c.mime, 0.5);
        if (!probe.startsWith("data:" + c.mime)) {
            continue;
        }

        for (const q of c.steps) {
            const dataUri = renderCanvas(img, targetW, targetH, c.mime, q);
            if (dataUri.length <= PBI_VISUAL_MAX_CHARS) {
                return {
                    dataUri,
                    format:    c.format,
                    width:     naturalW,
                    height:    naturalH,
                    sizeChars: dataUri.length,
                    fitsInPbi: true,
                    quality,
                };
            }
            if (!best || dataUri.length < best.sizeChars) {
                best = {
                    dataUri,
                    format:    c.format,
                    width:     naturalW,
                    height:    naturalH,
                    sizeChars: dataUri.length,
                    fitsInPbi: false,
                    quality,
                };
            }
        }
    }

    if (best) return best;

    const fallback = renderCanvas(img, targetW, targetH, "image/jpeg", 0.5);
    return {
        dataUri:   fallback,
        format:    "jpeg",
        width:     naturalW,
        height:    naturalH,
        sizeChars: fallback.length,
        fitsInPbi: fallback.length <= PBI_VISUAL_MAX_CHARS,
        quality,
    };
}

export function detectSupportedFormats(): EmbedFormat[] {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const supported: EmbedFormat[] = ["jpeg"];
    try {
        const webp = canvas.toDataURL("image/webp", 0.5);
        if (webp.startsWith("data:image/webp")) supported.push("webp");
    } catch (_e) { /* ignore */ }
    try {
        const avif = canvas.toDataURL("image/avif", 0.5);
        if (avif.startsWith("data:image/avif")) supported.push("avif");
    } catch (_e) { /* ignore */ }
    return supported;
}

function loadImage(file: File): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => {
            URL.revokeObjectURL(url);
            resolve(im);
        };
        im.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to decode image"));
        };
        im.src = url;
    });
}

function renderCanvas(img: HTMLImageElement, w: number, h: number, mime: string, q: number): string {
    const canvas = document.createElement("canvas");
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL(mime, q);
}

export async function probeImageUrl(url: string): Promise<{ ok: true; width: number; height: number } | { ok: false; reason: string }> {
    if (!url || !/^https?:\/\//i.test(url)) {
        return { ok: false, reason: "URL must start with http:// or https://" };
    }
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload  = () => resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ ok: false, reason: "URL is not reachable or not an image" });
        img.src = url;
    });
}
