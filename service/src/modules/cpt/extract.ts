import { callBlock } from "../../core/llm/gemini";
import type { Usage } from "../../core/types";
import { reportText, type Block } from "../icd/extract";

export type ProcStatus = "complete" | "attempted" | "mixed" | "no_procedure";

export interface Procedure {
  procedure_text: string;
  /** Short standard name; the retrieval query. */
  extracted_procedure: string;
  laterality: string;
  approach: string;
  quantity: string;
  /** Set on the discontinued procedure of an attempted or mixed session. */
  attempted?: boolean;
}

export interface Extraction {
  status: ProcStatus;
  attempted_procedure: string;
  attempted_reason: string;
  procedures: Procedure[];
}

const str = { type: "string" };

/** Step 1: completion status and each procedure performed, paired with its parent procedure. */
export async function extractProcedures(blocks: Block[]): Promise<{ extraction: Extraction; usage: Usage }> {
  const { data, usage } = await callBlock<Extraction>({
    blockId: "P-PROC-EXTRACT",
    parts: [{ text: `REPORT\n${reportText(blocks)}` }],
    schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["complete", "attempted", "mixed", "no_procedure"] },
        attempted_procedure: str,
        attempted_reason: str,
        procedures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              procedure_text: str,
              extracted_procedure: str,
              laterality: { type: "string", enum: ["left", "right", "bilateral", "N/A"] },
              approach: str,
              quantity: str,
            },
            required: ["procedure_text", "extracted_procedure", "laterality", "approach", "quantity"],
          },
        },
      },
      required: ["status", "attempted_procedure", "attempted_reason", "procedures"],
    },
  });
  return { extraction: data, usage };
}

/**
 * What goes on to coding. Attempted: only the discontinued procedure. Mixed: the completed ones
 * plus the discontinued one last. No procedure: nothing. A status the items contradict is
 * corrected the way the engine did: items with no status count as complete.
 */
export function proceduresToCode(x: Extraction): Procedure[] {
  const attempted: Procedure[] = x.attempted_procedure.trim()
    ? [{
        procedure_text: `${x.attempted_procedure} (attempted, discontinued: ${x.attempted_reason || "reason not stated"})`,
        extracted_procedure: x.attempted_procedure,
        laterality: "N/A",
        approach: "",
        quantity: "single",
        attempted: true,
      }]
    : [];
  if (x.status === "attempted") return attempted;
  if (x.status === "mixed") return [...x.procedures, ...attempted];
  return x.procedures;
}
