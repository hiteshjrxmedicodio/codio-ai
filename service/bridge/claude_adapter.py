"""Answer the ICD engine's pick-one questions with Claude instead of Jev or the Decisions API.

The engine sends every model question through run_icd_walk.ask(state, question, key, dry) and reads
back {'choice': option_key}. This replaces that one function at load time, so the engine's tree walk,
links and candidates stay exactly as they are. The engine folder is not edited.

Each question becomes one structured-output request: the options and the question are the system
prompt, the diagnosis state (already redacted by the service) is the user turn, and the answer is
constrained to one of the option keys plus a confidence.
"""
import json

from anthropic import Anthropic

from decisions_adapter import CD, _instructions


def _system(q):
    options = '\n'.join(f'{k}: {v}' for k, v in q['options'].items())
    return (f"{_instructions(q)}\n\nOPTIONS (answer with exactly one key)\n{options}\n\n"
            f"Choose {CD} only when the diagnosis and statements do not let you tell which option applies.")


def install(R, key, model, effort):
    """Swap the engine's question function for one that asks Claude."""
    client = Anthropic(api_key=key)

    def ask(state, q, _key, dry):
        if dry:
            return {'choice': None, '_dry': True}, 0
        schema = {
            'type': 'object',
            'properties': {'choice': {'type': 'string', 'enum': list(q['options'])}, 'confidence': {'type': 'number'}},
            'required': ['choice', 'confidence'],
            'additionalProperties': False,
        }
        msg = client.beta.messages.create(
            model=model,
            max_tokens=16000,
            system=_system(q),
            messages=[{'role': 'user', 'content': json.dumps(state, ensure_ascii=False)}],
            output_config={'effort': effort, 'format': {'type': 'json_schema', 'schema': schema}},
            # On a safety decline, the API re-runs the question on Anthropic's recommended fallback model.
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
        )
        tokens = msg.usage.input_tokens
        if msg.stop_reason in ('refusal', 'max_tokens'):
            return {'choice': CD, 'reason': f'claude_{msg.stop_reason}'}, tokens
        answer = json.loads(''.join(b.text for b in msg.content if b.type == 'text'))
        if answer.get('choice') not in q['options']:
            return {'choice': CD, 'reason': 'claude_invalid_choice'}, tokens
        return {'choice': answer['choice'], 'confidence': answer.get('confidence')}, tokens

    R.ask = ask
