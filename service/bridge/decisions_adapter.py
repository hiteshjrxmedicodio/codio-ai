"""Answer the Jev engine's pick-one questions with the OpenAI Decisions API instead of Jev.

The engine sends every model question through run_icd_walk.ask(state, question, key, dry) and reads
back {'choice': option_key}. This replaces that one function at load time, so the engine's index
search, tree walk, links and verification stay exactly as they are. The engine folder is not edited.
"""
import json, re, time, urllib.error, urllib.request

API = 'https://api.openai.com/v1/decisions'


def _instructions(q):
    read = q.get('read') or ['diagnosis', 'statements']
    return f"{q['context']}\n\nQUESTION: {q['statement']}\n\nRead the input fields in this order: {', '.join(read)}."


def _post(body, key, url=API, retries=4):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors='replace')
            if e.code in (429, 500, 502, 503, 529) and i < retries - 1:
                time.sleep(2 * (i + 1))
                continue
            raise RuntimeError(f'Decisions API HTTP {e.code}: {text[:300]}')
        except (urllib.error.URLError, TimeoutError, OSError):
            if i < retries - 1:
                time.sleep(2 * (i + 1))
                continue
            raise
    raise RuntimeError('Decisions API gave up')


MAX_CHOICES = 255   # the Decisions API's limit per question
CD = 'cannot_decide'


def rounds(options, size=MAX_CHOICES):
    """Split an over-long option set into chunks that each fit one question, every chunk keeping
    cannot_decide, so the infections, injuries and external-causes chapters can still be asked."""
    keys = [k for k in options if k != CD]
    step = size - (1 if CD in options else 0)
    return [{**{k: options[k] for k in keys[i:i + step]}, **({CD: options[CD]} if CD in options else {})}
            for i in range(0, len(keys), step)]


def install(R, key, model, url=API):
    """Swap the engine's question function for one that asks the Decisions API."""

    def ask_once(state, q):
        name = re.sub(r'[^A-Za-z0-9_]', '_', q['key'])[:60] or 'question'
        body = {
            'model': model,
            'input': [{'role': 'user', 'content': [{'type': 'input_text', 'text': json.dumps(state, ensure_ascii=False)}]}],
            'questions': [{'type': 'choice', 'name': name, 'instructions': _instructions(q),
                           'choices': [{'value': k, 'description': str(v)} for k, v in q['options'].items()]}],
        }
        out = _post(body, key, url)
        answer = next((a for a in out.get('answers', []) if a.get('name') == name), None) or {}
        tokens = (out.get('usage') or {}).get('input_tokens', 0)
        if answer.get('type') == 'refusal' or answer.get('choice') not in q['options']:
            return {'choice': CD, 'reason': 'decisions_refused_or_invalid'}, tokens
        return {'choice': answer['choice'], 'confidence': answer.get('confidence'), 'probabilities': answer.get('probabilities')}, tokens

    def ask(state, q, _jev_key, dry):
        if dry:
            return {'choice': None, '_dry': True}, 0
        if len(q['options']) <= MAX_CHOICES:
            return ask_once(state, q)
        # Too many options for one question: pick within each chunk, then pick among the chunk winners.
        winners, conf, tokens = {}, {}, 0
        for chunk in rounds(q['options']):
            a, t = ask_once(state, {**q, 'options': chunk})
            tokens += t
            if a.get('choice') not in (None, CD):
                winners[a['choice']] = q['options'][a['choice']]
                conf[a['choice']] = a.get('confidence')
        if not winners:
            return {'choice': CD, 'reason': 'no chunk had a fit'}, tokens
        if len(winners) == 1:
            only = next(iter(winners))
            return {'choice': only, 'confidence': conf[only]}, tokens
        final, t = ask_once(state, {**q, 'options': {**winners, **({CD: q['options'][CD]} if CD in q['options'] else {})}})
        return final, tokens + t

    R.ask = ask
