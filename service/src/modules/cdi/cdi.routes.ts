import { Router } from "express";
import { z } from "zod";
import { SectionSchema, SettingSchema, handle } from "../../core/http";
import type { Suggestion } from "../../core/types";
import { runFix } from "./fix/fix";
import { analyzeNote } from "./pipeline/analyze";
import { checkPageContent } from "./pipeline/checkPage";

const AnalyzeBody = z.object({ sections: z.array(SectionSchema).min(1), setting: SettingSchema });

const CheckPageBody = z
  .object({
    blocks: z.array(z.object({ heading: z.string(), text: z.string() })).optional(),
    screenshots: z.array(z.string()).optional(),
    setting: SettingSchema,
  })
  .refine((b) => Boolean(b.blocks?.length || b.screenshots?.length), "Send page blocks or screenshots");

const FixBody = z.object({
  suggestion: z.custom<Suggestion>((v) => typeof v === "object" && v !== null && "gate" in v && "quotes" in v),
  sections: z.array(SectionSchema).min(1),
  setting: SettingSchema,
});

export const cdiRoutes = Router()
  .post("/analyze", handle(AnalyzeBody, (b) => analyzeNote(b.sections, b.setting)))
  .post("/check-page", handle(CheckPageBody, (b) => checkPageContent(b, b.setting)))
  .post("/fix", handle(FixBody, (b) => runFix(b.suggestion, b.sections, b.setting)));
