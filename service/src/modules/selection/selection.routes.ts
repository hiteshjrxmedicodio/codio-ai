import { Router } from "express";
import { handle } from "../../core/http";
import { SelectBodySchema, codeSelection } from "./codeSelection";

export const selectionRoutes = Router().post("/code", handle(SelectBodySchema, (b) => codeSelection(b.text, b.context)));
