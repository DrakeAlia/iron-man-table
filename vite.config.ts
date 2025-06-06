import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "@mediapipe/hands",
      "@mediapipe/camera_utils",
      "@mediapipe/drawing_utils",
    ],
  },
  build: {
    rollupOptions: {
      external: [],
      output: {
        assetFileNames: (assetInfo) => {
          // Ensure MediaPipe files are properly handled
          if (
            assetInfo.name?.endsWith(".wasm") ||
            assetInfo.name?.endsWith(".data")
          ) {
            return "assets/[name].[ext]";
          }
          return "assets/[name]-[hash].[ext]";
        },
      },
    },
  },
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Permissions-Policy": "camera=(self), microphone=(self)",
    },
  },
});
