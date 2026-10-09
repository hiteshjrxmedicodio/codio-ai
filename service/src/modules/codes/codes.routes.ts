import { Router } from "express";
import { handle } from "../../core/http";
import { jobStatus, startJob } from "../icd/jobs";
import { PredictBodySchema } from "../icd/pipeline";
import { runCodes } from "./run";

export const codesRoutes = Router()
  .post("/run", handle(PredictBodySchema, (b) => runCodes(b.blocks)))
  // Same run as a job, so the companion can show each step (CDI first) while it waits.
  .post("/jobs", handle(PredictBodySchema, async (b) => ({ id: startJob(CDI_STEP, (onStep) => runCodes(b.blocks, onStep)) })))
  .get("/jobs/:id", jobStatus);

const CDI_STEP = { step: "cdi" as const, label: "Cleaning the report (CDI)", withCdi: true };
