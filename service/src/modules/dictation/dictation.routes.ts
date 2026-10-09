import { Router } from "express";
import { z } from "zod";
import { handle } from "../../core/http";
import { MatchBodySchema, dictateReport, matchField, structureTranscript, transcribePiece } from "./dictation";

const DictateBody = z.object({
  audio: z.string().min(10).describe("Base64 audio without the data: prefix"),
  mimeType: z.string().default("audio/webm"),
});

const StructureBody = z.object({ transcript: z.string().min(1) });

const PieceBody = DictateBody.extend({ previous: z.string().default("") });

export const dictationRoutes = Router()
  .post("/report", handle(DictateBody, (b) => dictateReport(b.audio, b.mimeType)))
  .post("/transcribe", handle(PieceBody, (b) => transcribePiece(b.audio, b.mimeType, b.previous)))
  .post("/structure", handle(StructureBody, (b) => structureTranscript(b.transcript)))
  .post("/match", handle(MatchBodySchema, (b) => matchField(b)));
