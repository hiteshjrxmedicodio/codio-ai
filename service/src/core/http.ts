import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

export const SectionSchema = z.object({ name: z.string(), text: z.string() });
export const SettingSchema = z.enum(["operative", "enm", "inpatient", "unknown"]);

/** Validate the body with zod, then run the handler. Errors become JSON, never a stack dump. */
export function handle<T>(schema: z.ZodType<T>, fn: (body: T) => Promise<unknown>): RequestHandler {
  return async (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
      return;
    }
    try {
      res.json(await fn(parsed.data));
    } catch (err) {
      res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
    }
  };
}

/** Only the extension and local tools may call the service. */
export function localCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin ?? "";
  if (origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}
