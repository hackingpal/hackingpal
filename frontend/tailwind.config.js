/** @type {import('tailwindcss').Config} */
//
// Colors are bound to CSS variables (RGB triplets, space-separated) so they
// switch between dark/light themes at runtime without rebuilding. The
// `<alpha-value>` placeholder preserves Tailwind opacity modifiers like
// `bg-bg-base/40`, `text-amber/70`, etc.
//
// Variable definitions live in src/index.css under `:root` (dark default) and
// `:root.light` (overrides). The theme hook in src/lib/theme.ts toggles the
// `.light` class on <html>.
//
function v(name) {
  return `rgb(var(--${name}) / <alpha-value>)`;
}

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "SF Mono",
          "JetBrains Mono",
          "Menlo",
          "Consolas",
          "ui-monospace",
          "monospace",
        ],
      },
      colors: {
        bg: {
          base:        v("bg-base"),
          sidebar:     v("bg-sidebar"),
          card:        v("bg-card"),
          panel:       v("bg-panel"),       // table headers, sub-panels
          "row-alt":   v("bg-row-alt"),     // zebra-stripe alt rows
          "nav-hover": v("bg-nav-hover"),   // sidebar item hover
          "nav-active":v("bg-nav-active"),  // sidebar item active
        },
        divider: v("divider"),
        ink: {
          primary: v("ink-primary"),
          muted:   v("ink-muted"),
          dim:     v("ink-dim"),
        },
        accent:    v("accent"),
        accentDim: v("accent-dim"),
        phos:      v("phos"),
        amber:     v("amber"),
        danger:    v("danger"),
      },
    },
  },
  plugins: [],
};
