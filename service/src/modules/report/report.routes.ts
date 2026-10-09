import { Router } from "express";
import { handle } from "../../core/http";
import { AskBodySchema, askAboutReport } from "./ask";
import { SummarizeBodySchema, summarizeReport } from "./summarize";

export const reportRoutes = Router()
  .post("/summarize", handle(SummarizeBodySchema, (b) => summarizeReport(b)))
  .post("/ask", handle(AskBodySchema, (b) => askAboutReport(b)));
