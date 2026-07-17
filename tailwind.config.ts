import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Apple / Notion 風格：米白背景、淡灰卡片，無鮮豔色彩
        canvas: "#FAF9F6",
        surface: "#FFFFFF",
        card: "#F4F3F0",
        border: {
          DEFAULT: "#E7E5E0",
          strong: "#D8D5CE",
        },
        ink: {
          DEFAULT: "#1F1E1C",
          muted: "#6B6862",
          faint: "#9B9890",
        },
        accent: {
          DEFAULT: "#3D3B37", // 中性深灰，作為主要互動色，避免鮮豔色彩
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
        card: "16px",
        control: "10px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(31, 30, 28, 0.04), 0 8px 24px -8px rgba(31, 30, 28, 0.08)",
        softHover: "0 2px 4px rgba(31, 30, 28, 0.06), 0 12px 32px -8px rgba(31, 30, 28, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
