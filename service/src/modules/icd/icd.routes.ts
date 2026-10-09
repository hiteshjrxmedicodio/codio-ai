import { Router } from "express";
import { handle } from "../../core/http";
import { jobStatus, startIcdJob } from "./jobs";
import { PredictBodySchema, predictIcd } from "./pipeline";

export const icdRoutes = Router()
  .post("/predict", handle(PredictBodySchema, (b) => predictIcd(b.blocks)))
  // Same pipeline as a job: start it, then poll for its current step and, once finished, the result.
  .post("/jobs", handle(PredictBodySchema, async (b) => ({ id: startIcdJob(b.blocks) })))
  .get("/jobs/:id", jobStatus);
