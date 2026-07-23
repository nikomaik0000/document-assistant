import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Shared design tokens
        canvas: "#FAF9F6",
        surface: "#FFFFFF",
        card: "#EDEBE6",
        border: {
          DEFAULT: "#E2E2E2",
          strong: "#E2E2E2",
        },
        ink: {
          DEFAULT: "#666666",
          muted: "#666666",
          faint: "#8A8A8A",
        },
        accent: {
          DEFAULT: "#666666",
          soft: "#EDEBE6",
        },
        danger: "#B3554A",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "\"PingFang TC\"",
          "\"Noto Sans TC\"",
          "\"Segoe UI\"",
          "Roboto",
          "sans-serif",
        ],
      },
      borderRadius: {
        sm: "10px",
        control: "14px",
        card: "18px",
        panel: "20px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(102, 102, 102, 0.04), 0 8px 24px -8px rgba(102, 102, 102, 0.08)",
        softHover: "0 2px 4px rgba(102, 102, 102, 0.06), 0 12px 32px -8px rgba(102, 102, 102, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
