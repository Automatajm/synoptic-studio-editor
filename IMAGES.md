# Background Images — Power Query Approach (Advanced)

The Synoptic Studio editor handles background images automatically: pick
**"Embed in Excel"** when you load the image and the editor will compress
it to JPEG, base64-encode it, and place the resulting data URI in the
first row of `Image_URL`. Most users should stop here — that flow is
self-contained and requires no external setup.

This document covers the **manual Power Query alternative** for users
who want full control over the image pipeline:

- Reuse the same image across many reports without touching the editor
- Reference an image stored on a SharePoint / OneDrive / network share
- Avoid increasing the size of every Excel export
- Build a workflow where the layout file and the image evolve separately

## Why use Power Query?

When `Image_URL` is base64-embedded in the Excel, the binary lives inside
the `.xlsx`. That's convenient (autonomous file) but it has trade-offs:

| | Editor's "Embed" mode | Power Query |
|---|---|---|
| Self-contained Excel | ✅ | ❌ (image is a separate file) |
| Image bytes stored once | ✅ (first row only) | ✅ (single Power Query step) |
| Image refresh requires re-export | ✅ | ❌ (just refresh PBI) |
| Works offline in PBI Service | ✅ | Depends on storage location |
| Easy to share with colleagues | ✅ | Needs the image file too |

If you want the image to live separately and be referenced at refresh
time — keep reading.

## Recipe

In Power Query, create a new blank query and paste:

```powerquery
let
    // Path to the image on disk. Use a UNC path for shared folders or
    // mapped drives; on a Service-published report, use SharePoint or
    // a connector that supports binary content.
    Source = File.Contents("C:\Users\you\Pictures\synoptic-bg.jpg"),

    // Convert binary to base64 text.
    Base64 = Binary.ToText(Source, BinaryEncoding.Base64),

    // Wrap in a data-URI scheme. Adjust the MIME type to match your
    // image format: image/jpeg, image/png, image/webp, image/svg+xml.
    DataUri = "data:image/jpeg;base64," & Base64
in
    DataUri
```

Name the query `BackgroundImageURI` (or anything memorable).

### Bind it to the visual

The Synoptic Studio visual reads the **first non-empty value** from the
`Image_URL` column across all rows. So you have two ways to wire the
Power Query result in:

#### Option 1: Add it as a calculated column

In your layout table, replace the `Image_URL` column (or add a new one):

```powerquery
= Table.AddColumn(Source, "Image_URL", each BackgroundImageURI)
```

Every row will carry the same data URI. PBI deduplicates this internally,
so the model size doesn't multiply by the row count.

#### Option 2: Single-row strategy

If you want the data URI in only one row (mirroring how the editor
exports), use `Table.AddIndexColumn` and a conditional:

```powerquery
= Table.AddColumn(
    Table.AddIndexColumn(Source, "RowIdx", 0, 1),
    "Image_URL",
    each if [RowIdx] = 0 then BackgroundImageURI else ""
  )
```

Then drop the temporary `RowIdx` column.

## Refreshing the image

The big win of the Power Query path: when the image on disk changes,
hit **Refresh** in PBI and the visual picks up the new version. No need
to rerun the editor.

To force a refresh of just the image without rerunning the layout query,
set the image query as the only dependency of `Image_URL`:

```powerquery
let
    Layouts = Excel.Workbook(File.Contents("layout.xlsx"), null, true)
              {[Item="Layouts",Kind="Sheet"]}[Data],
    Promoted = Table.PromoteHeaders(Layouts),
    // ...other layout transformations...
    WithImage = Table.AddColumn(Promoted, "Image_URL", each BackgroundImageURI)
in
    WithImage
```

## File size considerations

Power BI's model compresses repeated text values aggressively (VertiPaq
columnstore). A 100KB base64 string repeated across 200 rows still adds
only ~140KB to the model — not 20MB, as you might expect.

That said, **prefer the single-row strategy** if your image is over
500KB encoded. The compressor handles repetition fine, but query
evaluation and refresh time scale with row count regardless.

## Common pitfalls

**Wrong MIME type.** A `.png` file with `data:image/jpeg;base64,...`
won't render. Match the extension to the MIME type.

**Forgetting the prefix.** The `Image_URL` value MUST start with
`data:image/...;base64,` for the visual to render it. Plain base64
without the prefix is treated as a regular URL and fails.

**Power Query "Privacy levels" blocking refresh.** When you reference
local files, PBI Service refresh may fail with a privacy error. Either
set the data sources to "Public" privacy or move the image to a
gateway-accessible location.

**Image too large for Excel cell on export.** This only applies to the
editor's embed mode; Power Query stores the data URI inside the data
model, not inside a single cell, so the 32,767-character cell limit is
not relevant here.

## When NOT to use this approach

- You're prototyping or evaluating the visual — use the editor's embed
  mode and don't worry about it
- The image rarely changes — embed mode is simpler
- Your team isn't comfortable in Power Query — embed mode requires no
  M code

For everything else, the Power Query path gives you long-term
flexibility at a small one-time setup cost.
