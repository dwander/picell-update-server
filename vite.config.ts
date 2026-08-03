import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

// 관리 콘솔(SPA) 빌드. 산출물은 Hono가 그대로 서빙한다(dist/public).
// dev에서는 vite 서버가 API 요청만 Hono(3000)로 프록시해 HMR을 유지한다.
export default defineConfig({
  root: "web",
  base: "/",
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
    // 구형 브라우저를 볼 일이 없는 관리 전용 콘솔이라 최신 타깃으로 둔다.
    target: "es2022",
  },
  server: {
    port: 5173,
    proxy: {
      "/admin/api": "http://localhost:3000",
      "/update": "http://localhost:3000",
    },
  },
});
