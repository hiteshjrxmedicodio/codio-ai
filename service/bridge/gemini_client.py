"""Gemini client for the engine's fallback, with thinking capped on every model.

The engine's own client caps thinking only for gemini-2.5 models. Newer models think at length by
default, the thinking uses up the output budget, the answer is cut off, and the fallback reports an
invalid final response. This subclass sends a thinking cap the model accepts and a larger budget.
"""
import json, time, urllib.error, urllib.request

from icd_gemini_fallback import GeminiClient


class CappedGeminiClient(GeminiClient):
    def __init__(self, key, model, thinking_level='low', max_output_tokens=16384):
        super().__init__(key, model)
        self.thinking_level, self.max_output_tokens = thinking_level, max_output_tokens

    def _thinking(self):
        if self.model.startswith('gemini-2.5-'):
            return {'thinkingBudget': 1024}
        return {'thinkingLevel': self.thinking_level}

    def generate(self, instruction, payload, output_schema):
        body = {'systemInstruction': {'parts': [{'text': instruction}]},
                'contents': [{'role': 'user', 'parts': [{'text': json.dumps(payload, ensure_ascii=False)}]}],
                'generationConfig': {'temperature': 0, 'maxOutputTokens': self.max_output_tokens,
                                     'responseMimeType': 'application/json', 'responseSchema': output_schema,
                                     'thinkingConfig': self._thinking()}}
        request = urllib.request.Request(
            f'https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent',
            data=json.dumps(body).encode(), method='POST',
            headers={'x-goog-api-key': self.key, 'Content-Type': 'application/json'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    data = json.load(response)
                break
            except urllib.error.HTTPError as exc:
                if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f'Gemini HTTP {exc.code}') from None
            except (urllib.error.URLError, TimeoutError, OSError):
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError('Gemini connection failed') from None
        usage = data.get('usageMetadata', {})
        candidates = data.get('candidates') or []
        if not candidates or candidates[0].get('finishReason') != 'STOP':
            return None, usage
        parts = candidates[0].get('content', {}).get('parts', [])
        try:
            value = json.loads(''.join(p.get('text', '') for p in parts if not p.get('thought')))
        except (ValueError, TypeError):
            return None, usage
        return value, usage
