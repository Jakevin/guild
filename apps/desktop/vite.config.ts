import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const daemon = "http://127.0.0.1:7420";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": daemon,
      "/bots": daemon,
      "/bench": daemon,
      "/library": daemon,
      "/studio": daemon,
    },
  },
});
