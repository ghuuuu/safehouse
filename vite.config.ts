import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  // The version in package.json, baked in so Settings can say which one is
  // running. npm sets it for `npm run build` and `npm run dev`.
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev") },
  resolve: {
    tsconfigPaths: true,
  },
});
