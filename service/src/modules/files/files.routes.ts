import { Router } from "express";
import { z } from "zod";
import { getConfig } from "../../core/config";
import { handle } from "../../core/http";
import { readAttachedFile } from "./readFile";

const ReadBody = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  data: z.string().min(1).describe("Base64 file content without the data: prefix"),
});

export const filesRoutes = Router()
  .get("/limits", (_req, res) => {
    const { max_mb, max_files, text_types, model_types } = getConfig().files;
    res.json({ maxMb: max_mb, maxFiles: max_files, types: [...text_types, ...model_types] });
  })
  .post("/read", handle(ReadBody, (b) => readAttachedFile(b.name, b.mimeType, b.data)));
