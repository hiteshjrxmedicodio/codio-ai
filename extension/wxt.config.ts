import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Visible folder (no leading dot) so it shows up in Chrome's "Load unpacked" picker on macOS.
  outDir: "dist",
  manifest: {
    name: "Codio",
    description: "Reads the open clinical note and shows critical documentation suggestions before signing.",
    // unlimitedStorage: saved conversations can outgrow the 10 MB local-storage default.
    permissions: ["activeTab", "scripting", "tabs", "storage", "unlimitedStorage", "tabGroups", "sidePanel", "offscreen"],
    // <all_urls> lets the panel read and capture whichever EMR or scribe tool is open.
    host_permissions: ["<all_urls>"],
    action: { default_title: "Open Codio" },
    // Codio lives in Chrome's side panel; the toolbar icon opens it.
    side_panel: { default_path: "panel.html" },
    // mic.html is a tiny frame that shows Chrome's microphone prompt (side panels can't show it).
    web_accessible_resources: [{ resources: ["mic.html"], matches: ["<all_urls>"] }],
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
