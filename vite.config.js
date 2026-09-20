import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Calver date plus short commit sha, computed fresh on every build instead
// of relying on someone remembering to bump package.json.
function buildVersion() {
  const now = new Date();
  const date = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
  let sha = "dev";
  try {
    sha = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    // no git metadata available (e.g. building from a source tarball)
  }
  return `${date}+${sha}`;
}

// Served from the custom domain root (beakers.davidsouther.com), so base
// stays "/" rather than the repo-name subpath GitHub Pages otherwise needs.
export default defineConfig({
  base: "/",
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "Water Sort Beaker Solver",
        short_name: "Beakers",
        description: "Solve water sort / beaker puzzle levels from a pasted screenshot.",
        theme_color: "#0E1120",
        background_color: "#0E1120",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
      },
    }),
  ],
});
