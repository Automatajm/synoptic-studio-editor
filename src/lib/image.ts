// Image processing helpers.
//
// Two flows are supported when the user adds a background image:
//
//  1. EMBED — the image is recompressed (JPEG q≈80) and converted to a
//     base64 data URI stored on the BackgroundImage. On Excel export,
//     the data URI is written into the Image_URL column of the FIRST row
//     only; remaining rows are left empty (the visual reads the first
//     non-empty URL from any row, so this both works and keeps the file
//     small). Self-contained — no hosting required.
//
//  2. URL — the user pastes a public URL (e.g. raw.githubusercontent.com).
//     The visual fetches it at render time. Smaller Excel file, but
//     requires the URL to remain publicly accessible.
//
// Excel limit awareness: a single cell holds at most 32,767 characters.
// We target 30,000 to leave headroom. If the compressed base64 still
// exceeds that, the caller is informed via EmbedResult.tooLarge so the UI
// can surface an actionable message ("image too heavy, lower the resolution
// or use a public URL").

const EMBED_MAX_CHARS = 30_000;
const JPEG_QUALITY = 0.8;

export interface EmbedResult {
    dataUri:   string;     // "data:image/jpeg;base64,..."
    width:     number;
    height:    number;
    sizeChars: number;     // length of the dataUri string
    tooLarge:  boolean;    // true if sizeChars > EMBED_MAX_CHARS
}

/**
 * Read a File (from <input type='file'> or drag-drop) and return both:
 *   - a regular object URL for in-editor display (cheap, instant)
 *   - the natural width/height of the image
 */
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

/**
 * Compress an image to JPEG (or PNG with transparency) and return a base64
 * data URI suitable for embedding in an Excel cell. Tries JPEG first
 * (smaller); falls back to PNG only if the source is a transparent format
 * the user really wants preserved (we don't auto-detect this — keep it
 * simple, always JPEG for the embed flow).
 *
 * Strategy:
 *  1. Draw the image into a canvas at its natural size.
 *  2. Export as JPEG quality 0.8.
 *  3. If the resulting base64 is too big for an Excel cell, retry with
 *     reduced dimensions (max-edge clamp) until it fits OR we've shrunk
 *     too far (returns tooLarge:true so the UI can warn).
 */
export async function imageFileToDataUri(file: File): Promise<EmbedResult> {
    // Load into an Image element first
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload  = () => resolve(im);
        im.onerror = () => reject(new Error("Failed to decode image"));
        im.src = url;
    });
    URL.revokeObjectURL(url);

    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;

    // Try natural size first; if too big, scale down progressively.
    const trials = [1.0, 0.75, 0.5, 0.35, 0.25];
    for (const scale of trials) {
        const w = Math.round(naturalW * scale);
        const h = Math.round(naturalH * scale);
        const canvas = document.createElement("canvas");
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return {
                dataUri: "", width: 0, height: 0,
                sizeChars: 0, tooLarge: true,
            };
        }
        // Solid white background — JPEG doesn't support transparency,
        // and a white default reads better than black on most synoptic maps.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const dataUri = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        if (dataUri.length <= EMBED_MAX_CHARS) {
            return {
                dataUri,
                width:     naturalW,    // report natural dims (the canvas scaling is just for compression)
                height:    naturalH,
                sizeChars: dataUri.length,
                tooLarge:  false,
            };
        }
    }

    // Even the most aggressive scale failed — return the smallest with tooLarge=true
    // so the UI can show a clear warning.
    const lastW = Math.round(naturalW * trials[trials.length - 1]);
    const lastH = Math.round(naturalH * trials[trials.length - 1]);
    const canvas = document.createElement("canvas");
    canvas.width  = lastW;
    canvas.height = lastH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, lastW, lastH);
    ctx.drawImage(img, 0, 0, lastW, lastH);
    const dataUri = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return {
        dataUri,
        width:     naturalW,
        height:    naturalH,
        sizeChars: dataUri.length,
        tooLarge:  dataUri.length > EMBED_MAX_CHARS,
    };
}

/**
 * Probe a public URL to verify it's a reachable image. Used when the user
 * picks the URL flow — we want to fail fast if the URL is broken instead
 * of silently producing an Excel that won't render in PBI.
 */
export async function probeImageUrl(url: string): Promise<{ ok: true; width: number; height: number } | { ok: false; reason: string }> {
    if (!url || !/^https?:\/\//i.test(url)) {
        return { ok: false, reason: "URL must start with http:// or https://" };
    }
    return new Promise((resolve) => {
        const img = new Image();
        // crossOrigin for CDNs that send CORS headers; if it fails, the
        // image still loads for display (we don't need pixel access here).
        img.crossOrigin = "anonymous";
        img.onload  = () => resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ ok: false, reason: "URL is not reachable or not an image" });
        img.src = url;
    });
}
