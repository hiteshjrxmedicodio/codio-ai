import type { Content } from "@google/genai";
import { Router } from "express";
import { z } from "zod";
import { handle } from "../../core/http";
import { agentSettings, agentTurn } from "./agent";
import { ObservationSchema } from "./observation";
import { ControlSchema, pickControl } from "./pickControl";

const TurnBody = z
  .object({
    history: z.array(z.custom<Content>((v) => typeof v === "object" && v !== null)).default([]),
    userText: z.string().optional(),
    toolResults: z
      .array(z.object({ id: z.string().optional(), name: z.string(), response: z.record(z.string(), z.unknown()) }))
      .optional(),
    observation: ObservationSchema,
  })
  .refine((b) => Boolean(b.userText?.trim() || b.toolResults?.length), "Send a message or tool results");

const PickBody = z.object({ goal: z.string().min(1), title: z.string(), controls: z.array(ControlSchema) });

export const agentRoutes = Router()
  .get("/settings", (_req, res) => {
    res.json(agentSettings());
  })
  .post("/turn", handle(TurnBody, (b) => agentTurn(b)))
  .post("/pick-control", handle(PickBody, (b) => pickControl(b.goal, b.title, b.controls)));
