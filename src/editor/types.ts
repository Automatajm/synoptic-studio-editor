// Core type definitions for the Synoptic Studio Editor.
// All coordinates are in CANVAS pixel space (0..canvasW, 0..canvasH).
// They are converted to RELATIVE (0..100%) only at export time.

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    kind: "rect";
    id:    string;          // internal unique id (uuid-like)
    label: string;          // user-facing label, e.g. "A01"
    x:     number;          // top-left corner X in canvas coords
    y:     number;          // top-left corner Y in canvas coords
    w:     number;          // width in canvas coords
    h:     number;          // height in canvas coords
}

export interface Polygon {
    kind: "polygon";
    id:    string;
    label: string;
    points: Point[];        // ordered vertices
}

export type Shape = Rect | Polygon;

export type ToolMode = "select" | "rect" | "polygon";

export interface BackgroundImage {
    src:    string;          // data URL or external URL
    width:  number;          // natural pixel width
    height: number;          // natural pixel height
    name:   string;          // file name (for export reference)
}

export interface EditorState {
    shapes:        Shape[];
    selectedId:    string | null;
    tool:          ToolMode;
    canvasW:       number;          // logical canvas width (matches bg image when present)
    canvasH:       number;          // logical canvas height
    background:    BackgroundImage | null;
    zoom:          number;
    panX:          number;
    panY:          number;
    snapToGrid:    boolean;
    gridSize:      number;          // grid step in canvas units (e.g. 10)
}

// Default canvas size when no background image is loaded
export const DEFAULT_CANVAS_W = 1200;
export const DEFAULT_CANVAS_H = 800;
