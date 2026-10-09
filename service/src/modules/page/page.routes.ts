import { Router } from "express";
import { z } from "zod";
import { handle } from "../../core/http";
import { checkPage } from "./pageCheck";

const CheckBody = z
  .object({ text: z.string().optional(), screenshot: z.string().optional() })
  .refine((b) => Boolean(b.text?.trim() || b.screenshot), "Send page text or a screenshot");

export const pageRoutes = Router().post("/check", handle(CheckBody, (b) => checkPage(b)));
