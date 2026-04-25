import "./style.css";
import { Editor } from "./editor/Editor";

const root = document.getElementById("app");
if (!root) {
    throw new Error("Missing #app element in index.html");
}

new Editor(root);
