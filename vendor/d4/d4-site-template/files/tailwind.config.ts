import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        "on-accent": "rgb(var(--accent-contrast, 255 255 255) / <alpha-value>)",
        base: "rgb(var(--bg-base) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        heading: "rgb(var(--text-heading) / <alpha-value>)",
        body: "rgb(var(--text-body) / <alpha-value>)",
        muted: "rgb(var(--text-muted) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};

export default config;
