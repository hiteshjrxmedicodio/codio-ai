import { Router } from "express";
import { handle } from "../../core/http";
import { FeedbackSchema, readFeedback, recordFeedback } from "./store";

export const feedbackRoutes = Router()
  .post("/", handle(FeedbackSchema, async (entry) => {
    await recordFeedback(entry);
    return { ok: true };
  }))
  .get("/", async (_req, res) => {
    res.json(await readFeedback());
  });
