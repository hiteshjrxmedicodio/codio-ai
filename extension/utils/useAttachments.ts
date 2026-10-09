import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { AttachedDoc, PendingFile } from "./types";

/** Used until the service answers with its own limits. */
const FALLBACK = { maxMb: 15, maxFiles: 5 };

const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};

/** File inputs accept this; the service has the final say on what it can read. */
export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,.md,.csv,application/pdf,image/*,text/plain";

function mimeOf(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? file.type ?? "";
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

let counter = 0;

/**
 * Files waiting in the composer. Each is read by the service as soon as it is added, so by the
 * time the provider presses send the document is already in sections.
 */
export function useAttachments() {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [limits, setLimits] = useState(FALLBACK);

  useEffect(() => {
    api.fileLimits().then(setLimits).catch(() => undefined);
  }, []);

  const patch = (id: string, next: Partial<PendingFile>) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...next } : f)));

  const add = useCallback(
    (incoming: File[]) => {
      const room = Math.max(0, limits.maxFiles - files.length);
      incoming.slice(0, room).forEach(async (file) => {
        const id = `f${Date.now()}-${counter++}`;
        const name = file.name || "Pasted image";
        setFiles((list) => [...list, { id, name, status: "reading" }]);
        if (file.size > limits.maxMb * 1024 * 1024) {
          patch(id, { status: "error", error: `Larger than ${limits.maxMb} MB` });
          return;
        }
        try {
          const r = await api.readFile(name, mimeOf(file), await toBase64(file));
          patch(id, { status: "ready", doc: { name: r.name, sections: r.sections } });
        } catch (err) {
          patch(id, { status: "error", error: String(err instanceof Error ? err.message : err) });
        }
      });
    },
    [files.length, limits],
  );

  const remove = useCallback((id: string) => setFiles((list) => list.filter((f) => f.id !== id)), []);
  const clear = useCallback(() => setFiles([]), []);

  const ready: AttachedDoc[] = files.flatMap((f) => (f.status === "ready" && f.doc ? [f.doc] : []));
  const reading = files.some((f) => f.status === "reading");
  const full = files.length >= limits.maxFiles;

  return { files, ready, reading, full, add, remove, clear };
}
