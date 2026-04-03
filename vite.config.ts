import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "node:path";

export default defineConfig({
  root: path.resolve(process.cwd(), "web"),
  base: "/app/",
  plugins: [react()],
  build: {
    outDir: path.resolve(process.cwd(), "public", "app"),
    emptyOutDir: true,
  },
});
