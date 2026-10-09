import { Router } from "express";
import { handle } from "../../core/http";
import { PredictBodySchema, predictIcd } from "./pipeline";

export const icdRoutes = Router().post("/predict", handle(PredictBodySchema, (b) => predictIcd(b.blocks)));
