import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Send /api calls to the Fastify server so the browser only talks to one origin.
    proxy: { "/api": "http://localhost:3001" },
  },
});
