import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the GitHub Pages repo path: https://<user>.github.io/wpr-budget/
// If you rename the repo, change this one value (the data fetch uses BASE_URL,
// so nothing else needs touching).
export default defineConfig({
  plugins: [react()],
  base: "/wpr-budget/",
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: the annual data/UI updates don't invalidate
        // the react bundle, and recharts loads only with the lazy bodies.
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|react-smooth)[\\/]/.test(id)) return "recharts";
        },
      },
    },
  },
});
