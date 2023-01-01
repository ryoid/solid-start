import solid from "solid-start/vite";
import { defineConfig } from "vite";
import vercel from "../../packages/start-vercel";

export default defineConfig({
  plugins: [
    solid({
      prerenderRoutes: ["/", "/about", "/nested/about"],
      adapter: vercel({
        splitApis: true
      })
    })
  ]
});
