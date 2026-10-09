import { Router } from "express";
import { handle } from "../../core/http";
import { jobStatus, stopJobRoute, startJob } from "../icd/jobs";
import { PredictBodySchema } from "../icd/pipeline";
import { runCodes } from "./run";

export const codesRoutes = Router()
  .post("/run", handle(PredictBodySchema, (b) => runCodes(b.blocks)))
  // Same run as a job: the companion shows each step, and each card's result the moment its part finishes.
  .post("/jobs", handle(PredictBodySchema, async (b) => ({ id: startJob(CDI_STEP, (onStep, part) => runCodes(b.blocks, onStep, part)) })))
  .get("/jobs/:id", jobStatus)
  .post("/jobs/:id/stop", stopJobRoute);

const CDI_STEP = { step: "cdi" as const, label: "Cleaning the report (CDI)" };
