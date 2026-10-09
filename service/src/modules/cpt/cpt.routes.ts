import { Router } from "express";
import { handle } from "../../core/http";
import { PredictBodySchema } from "../icd/pipeline";
import { predictCpt } from "./pipeline";

export const cptRoutes = Router().post("/predict", handle(PredictBodySchema, (b) => predictCpt(b.blocks)));
