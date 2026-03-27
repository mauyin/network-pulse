/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — custom near-black with blue undertone
        page: "#0a0a0f",
        surface: {
          DEFAULT: "#12121a",
          hover: "#1a1a25",
        },
        border: {
          DEFAULT: "#1e1e2e",
          subtle: "#16161f",
        },
        // Text
        primary: "#e4e4ed",
        secondary: "#a0a0b4",
        muted: "#6b6b80",
        subtle: "#4a4a5e",
        // Accent
        accent: {
          DEFAULT: "#22d3ee",
          dim: "rgba(34, 211, 238, 0.12)",
          hover: "#06b6d4",
        },
        // Status
        healthy: {
          DEFAULT: "#34d399",
          bg: "rgba(52, 211, 153, 0.12)",
        },
        degraded: {
          DEFAULT: "#fbbf24",
          bg: "rgba(251, 191, 36, 0.12)",
        },
        critical: {
          DEFAULT: "#ef4444",
          bg: "rgba(239, 68, 68, 0.12)",
        },
        info: {
          DEFAULT: "#22d3ee",
          bg: "rgba(34, 211, 238, 0.12)",
        },
        // Chain brand colors
        chain: {
          ethereum: "#627EEA",
          arbitrum: "#28A0F0",
          optimism: "#FF0420",
          polygon: "#8247E5",
          bsc: "#F0B90B",
          base: "#0052FF",
          mantle: "#000000",
          avalanche: "#E84142",
        },
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Satoshi", "Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "18px" }],
        base: ["14px", { lineHeight: "20px" }],
        md: ["16px", { lineHeight: "24px" }],
        lg: ["20px", { lineHeight: "28px" }],
        xl: ["24px", { lineHeight: "32px" }],
        "2xl": ["32px", { lineHeight: "40px" }],
        "3xl": ["48px", { lineHeight: "1" }],
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        full: "9999px",
      },
      spacing: {
        "2xs": "2px",
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "48px",
        "3xl": "64px",
      },
      transitionDuration: {
        micro: "75ms",
        short: "150ms",
        medium: "200ms",
        long: "400ms",
      },
      animation: {
        "skeleton": "pulse 400ms ease-in-out infinite alternate",
      },
    },
  },
  plugins: [],
};
