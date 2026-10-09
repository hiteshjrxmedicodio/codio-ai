import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/style.css";
import App from "./App";

// Tells the background the panel is open, so the companion cursor shows on the page; closing the
// panel closes this port and the companion goes away.
browser.runtime.connect({ name: "codio-panel" });

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
