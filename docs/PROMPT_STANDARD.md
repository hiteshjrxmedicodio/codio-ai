# Prompt standard

Every prompt in `service/prompts/` follows this standard. `service/test/promptLint.test.ts`
enforces the mechanical parts. A prompt that fails the lint does not ship.

## The three rules

1. **One prompt, one function.** The FUNCTION section is one sentence that starts with
   `Your only job is to`. If the job needs "and" to describe, it is two prompts.
2. **Instructions only.** No examples, no sample text, no lists of terms, conditions,
   abbreviations or cases. Examples and lists anchor the model: it looks for what was listed
   and misses what was not. Each prompt describes *how to reason*, in general terms, so it
   covers cases nobody wrote down.
3. **Inversion.** Before writing, list the real-world ways this job goes wrong: bad input,
   misleading text, edge cases, model habits. Then write one GUARDS paragraph per failure
   class saying what to do instead. The list of failures stays in the author's notes; the
   prompt holds only the general instruction that prevents each one.

## Sections, in this order, all required

| Section | What it holds |
|---|---|
| `ROLE` | Who the model is. One or two sentences. |
| `FUNCTION` | The single job. One sentence starting `Your only job is to`. |
| `INPUT` | What the model receives and how it is laid out. |
| `BOUNDARIES` | What this prompt does not do, and which neighbouring prompt owns it. Prose. |
| `REASONING` | Numbered steps, in order. The only place numbering is allowed. |
| `GUARDS` | The inversion paragraphs. One failure class per paragraph. Prose, no bullets. |
| `PRECEDENCE` | One ordering that settles any pull between instructions. This is what keeps the prompt free of conflicts. |
| `OUTPUT` | The meaning of each returned field. The JSON shape itself is enforced by the API schema in code, never described in the prompt. |

## Mechanical lint rules

- All eight section headers present, each on its own line, in the order above.
- No bullet lines (`-`, `*`, `•` at line start) anywhere.
- Numbered lines only inside `REASONING`.
- No double-quote characters, so no quoted sample text.
- None of these phrases: `e.g.`, `i.e.`, `for example`, `for instance`, `such as`,
  `like this`, `including but not limited to`.
- No template placeholders (`{{`). Per-call data goes in the user message, not the prompt.
- `FUNCTION` is a single sentence starting `Your only job is to`.

## Writing checks a lint cannot do

Read the prompt once more before committing and check:

- No two sentences can be obeyed only by breaking each other. If two can pull apart, the
  `PRECEDENCE` section must say which wins.
- `BOUNDARIES` and `FUNCTION` agree: nothing in `REASONING` drifts into a neighbour's job.
- Every `GUARDS` paragraph names a failure in general terms and gives the instruction.
- Plain words. Short sentences. Dense, not padded.
