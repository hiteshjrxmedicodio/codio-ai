import { Router } from "express";
import { handle } from "../../core/http";
import { PredictBodySchema } from "../icd/pipeline";
import { runCodes } from "./run";

export const codesRoutes = Router().post("/run", handle(PredictBodySchema, (b) => runCodes(b.blocks)));
