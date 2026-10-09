/**
 * One-time microphone setup. Side panels cannot show Chrome's permission prompt, so this tab
 * asks once for the extension. It asks straight away, tells the side panel when access is
 * granted, and closes itself so the provider lands back where they were.
 */
type State = "ready" | "waiting" | "done" | "blocked";

/**
 * Frame mode: loaded invisibly inside the provider's page by the side panel. It only asks for
 * the microphone and reports back; the panel shows all the UI and removes the frame.
 */
const FRAME = new URLSearchParams(location.search).has("frame");

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const card = $("card");
const COPY: Record<State, { title: string; lead: string; note: string }> = {
  ready: {
    title: "Turn on your microphone",
    lead: "So you can talk to Codio instead of typing. You only do this once.",
    note: "Codio only listens after you tap the mic in the panel.",
  },
  waiting: {
    title: "Choose Allow at the top",
    lead: "Chrome is asking whether Codio can use your microphone.",
    note: "Don't see the box? Click Turn on microphone again.",
  },
  done: {
    title: "Microphone is on",
    lead: "Taking you back to Codio…",
    note: "Tap the mic in the panel whenever you want to talk.",
  },
  blocked: {
    title: "Chrome blocked the microphone",
    lead: "Open Chrome's microphone settings, allow Codio, then try again.",
    note: "Look for Codio under “Allowed to use your microphone”.",
  },
};

function show(state: State): void {
  card.className = state;
  $("title").textContent = COPY[state].title;
  $("lead").textContent = COPY[state].lead;
  $("note").textContent = COPY[state].note;
  $("allow").hidden = state === "done" || state === "blocked";
  $("settings").hidden = state !== "blocked";
  $("retry").hidden = state !== "blocked";
  $("steps").hidden = state === "done" || state === "blocked";
  const step = state === "ready" ? 1 : state === "waiting" ? 2 : 3;
  [1, 2, 3].forEach((n) => {
    const li = $(`s${n}`);
    li.className = n < step ? "past" : n === step ? "now" : "";
  });
}

async function closeSoon(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1400));
  const tab = await browser.tabs.getCurrent();
  if (tab?.id !== undefined) await browser.tabs.remove(tab.id);
}

async function request(): Promise<void> {
  show("waiting");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    show("done");
    browser.runtime.sendMessage({ type: "mic:granted" }).catch(() => undefined);
    await closeSoon();
  } catch {
    show("blocked");
    browser.runtime.sendMessage({ type: "mic:denied" }).catch(() => undefined);
  }
}

async function frameRequest(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    await browser.runtime.sendMessage({ type: "mic:granted" });
  } catch {
    await browser.runtime.sendMessage({ type: "mic:denied" }).catch(() => undefined);
  }
}

if (FRAME) void frameRequest();

$("allow").addEventListener("click", request);
$("retry").addEventListener("click", request);
$("settings").addEventListener("click", () => {
  browser.tabs.create({ url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(`chrome-extension://${browser.runtime.id}/`)}` });
});

// Already allowed: say so and go back. Otherwise ask straight away, saving the provider a click.
if (!FRAME) navigator.permissions
  ?.query({ name: "microphone" as PermissionName })
  .then((p) => {
    if (p.state === "granted") {
      show("done");
      browser.runtime.sendMessage({ type: "mic:granted" }).catch(() => undefined);
      void closeSoon();
    } else if (p.state === "denied") {
      show("blocked");
    } else {
      void request();
    }
  })
  .catch(() => show("ready"));
