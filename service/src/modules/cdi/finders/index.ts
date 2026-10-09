import type { CareSetting, Finding, Section, Usage } from "../../../core/types";
import { runAmbiguity } from "./ambiguity";
import { runContradictions } from "./contradictions";
import { runUnaddressed } from "./unaddressed";
import { runWording } from "./wording";

export type FinderFn = (sections: Section[], setting: CareSetting) => Promise<{ findings: Finding[]; usage: Usage }>;

/** Block id → finder. pipeline.finders in config.yaml picks which of these run. */
export const FINDERS: Record<string, FinderFn> = {
  "P-CON": runContradictions,
  "P-AMB": runAmbiguity,
  "P-INC": runUnaddressed,
  "P-WRD": runWording,
};
