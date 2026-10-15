import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// الواجهة تُبنى إلى web/dist ويخدمها خادم الموقع داخل عملية البوت.
// لا متغيّر بيئة VITE_* يحمل سراً: كل شيء يأتي من /api/v1 وقت التشغيل.
export default defineConfig({
  root: ".",
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // بصمات في أسماء الملفات ⇒ تخزين دائم آمن (الخادم يضع immutable لها)
    assetsDir: "assets",
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // أثناء التطوير: الواجهة على 5173 والـAPI على منفذ البوت
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/brand": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
});
