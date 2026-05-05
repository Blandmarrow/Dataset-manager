/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#1a1a2e",
          card: "#16213e",
          hover: "#0f3460",
        },
        accent: {
          DEFAULT: "#e94560",
          hover: "#c73652",
        },
      },
    },
  },
  plugins: [],
};

