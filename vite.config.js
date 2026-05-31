import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the GitHub Pages repo path: https://<user>.github.io/wpr-budget/
// If you rename the repo, change this one value (the data fetch uses BASE_URL,
// so nothing else needs touching).
export default defineConfig({
  plugins: [react()],
  base: "/wpr-budget/",
});
