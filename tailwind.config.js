/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                bg:      "#0a0e13",
                surface: "#0f141a",
                panel:   "#141a22",
                border:  "#1f2730",
                hi:      "#2a3a4a",
                accent:  "#00e5a0",
                accentDim: "#00b380",
                text:    "#e0eef7",
                dim:     "#8aa5b8",
                muted:   "#a0b8c8",
                danger:  "#ef4444",
            },
        },
    },
    plugins: [],
};
