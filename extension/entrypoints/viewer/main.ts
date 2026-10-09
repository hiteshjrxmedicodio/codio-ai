/**
 * Codio's PDF viewer. Chrome lets no extension run inside its own PDF viewer, so PDFs open here
 * instead: pages drawn with pdf.js, with a real text layer so text can be highlighted, and the
 * Codio AI companion running exactly as it does on web pages.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { companionOn } from "../content/companion";
import { watchForReports } from "../content/permission";
import { enablePushToTalk } from "../content/pushToTalk";
import { enableSelection } from "../content/selection";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const params = new URLSearchParams(location.search);
const file = params.get("file") ?? "";
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const MAX_SCALE = 1.6;

function status(html: string): void {
  $("status").innerHTML = html;
  $("status").style.display = html ? "block" : "none";
}

/** Skip Codio's viewer for this file from now on in this session, and show it in Chrome's. */
async function openInChrome(): Promise<void> {
  await browser.runtime.sendMessage({ type: "pdf:skip", url: file }).catch(() => undefined);
  location.replace(file);
}

async function renderPage(doc: pdfjs.PDFDocumentProxy, n: number, width: number): Promise<void> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_SCALE, width / base.width);
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;

  const box = document.createElement("div");
  box.className = "page";
  box.style.width = `${viewport.width}px`;
  box.style.height = `${viewport.height}px`;
  box.style.setProperty("--scale-factor", String(scale));
  box.style.setProperty("--total-scale-factor", String(scale));

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  box.appendChild(canvas);

  const text = document.createElement("div");
  text.className = "textLayer";
  box.appendChild(text);
  $("pages").appendChild(box);

  await page.render({ canvas, canvasContext: canvas.getContext("2d") as CanvasRenderingContext2D, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
  await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
}

async function main(): Promise<void> {
  const name = decodeURIComponent(file.split(/[\\/]/).pop()?.split(/[?#]/)[0] || "document.pdf");
  document.title = `${name} · Codio AI`;
  $("name").textContent = name;
  ($("download") as HTMLAnchorElement).href = file;
  $("chrome").addEventListener("click", () => void openInChrome());

  let data: ArrayBuffer;
  try {
    const res = await fetch(file, { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.arrayBuffer();
  } catch {
    const local = file.startsWith("file:");
    status(
      local
        ? `Codio needs permission to open files on this computer.<br>In <b>chrome://extensions</b>, open Codio's <b>Details</b> and turn on <b>Allow access to file URLs</b>, then reload this tab.<br><button id="fallback">Open in Chrome's viewer instead</button>`
        : `This PDF couldn't be opened here.<br><button id="fallback">Open in Chrome's viewer</button>`,
    );
    document.getElementById("fallback")?.addEventListener("click", () => void openInChrome());
    return;
  }

  const doc = await pdfjs.getDocument({ data }).promise;
  $("count").textContent = `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`;
  status("");
  const width = Math.min(window.innerWidth - 48, 1100);
  for (let n = 1; n <= doc.numPages; n++) await renderPage(doc, n, width);

  // The companion, as on any web page. It looks at the PDF's text to decide whether to ask.
  const cfg = (await browser.runtime.sendMessage({ type: "companion:config" }).catch(() => null)) as
    | { enabled: boolean; clinical_hints: string[]; min_hits: number }
    | null;
  if (!cfg?.enabled) return;
  companionOn();
  enableSelection();
  enablePushToTalk();
  watchForReports(cfg.clinical_hints, cfg.min_hits);
}

void main();
