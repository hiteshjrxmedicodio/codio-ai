import { Router } from "express";
import { handle } from "../../core/http";
import { icdJob, startIcdJob } from "./jobs";
import { PredictBodySchema, predictIcd } from "./pipeline";

export const icdRoutes = Router()
  .post("/predict", handle(PredictBodySchema, (b) => predictIcd(b.blocks)))
  // Same pipeline as a job: start it, then poll for its current step and, once finished, the result.
  .post("/jobs", handle(PredictBodySchema, async (b) => ({ id: startIcdJob(b.blocks) })))
  .get("/jobs/:id", (req, res) => {
    const job = icdJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "That coding job has expired" });
      return;
    }
    res.json({ step: job.step, finished: job.finished, result: job.result, error: job.error });
  });
