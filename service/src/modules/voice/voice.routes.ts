import { Router } from "express";
import { z } from "zod";
import { handle } from "../../core/http";
import { transcribeAndClean } from "./voice";

const TranscribeBody = z.object({
  audio: z.string().min(10).describe("Base64 audio without the data: prefix"),
  mimeType: z.string().default("audio/webm"),
});

export const voiceRoutes = Router().post("/transcribe", handle(TranscribeBody, (b) => transcribeAndClean(b.audio, b.mimeType)));
