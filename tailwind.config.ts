import type { Config } from "tailwindcss";
import palette from "./src/lib/palette.json";
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: Object.fromEntries(
        Object.keys(palette).map((key) => [key, `var(--${key})`]),
      ),
    },
  },
  plugins: [],
} satisfies Config;
