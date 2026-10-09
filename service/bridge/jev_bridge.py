"""Bridge from the Codio service to the Jev ICD engine (evidence routing).

Reads {"units": [...], "provider": "decisions"|"jev", "gemini": bool, "gemini_model": str, "workers": int,
"dry": bool} as JSON on
stdin and writes one JSON result per unit on stdout. The engine's own folder is passed with --jev;
nothing in that folder is modified. Uses only the standard library, like the engine.
The engine's pick-one questions go to the OpenAI Decisions API by default (provider "decisions",
OPENAI_API_KEY), or to Jev (provider "jev", TYPESAFE_API_KEY). GEMINI_API_KEY powers the optional fallback.
"""
import argparse, json, os, sys, threading
from concurrent.futures import ThreadPoolExecutor


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jev', required=True)
    a = ap.parse_args()
    sys.path.insert(0, a.jev)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    req = json.load(sys.stdin)
    units, dry = req.get('units', []), bool(req.get('dry'))

    import run_icd_walk as R
    import run_icd_system_walk as S
    from run_icd_direct_walk import q_categories_direct
    from icd_evidence_walk import walk, RecoveryConfig
    from icd_retrieval import get_index

    # Same defaults as the engine's CLI: Excludes1/2 links and index see/see-also; custom links on hold.
    S.POINTERS = None
    S.KNOWLEDGE = None
    S.LINKS = json.load(open(os.path.join(a.jev, 'inputs', 'excludes_links.json')))
    S.SEE_LINKS = json.load(open(os.path.join(a.jev, 'inputs', 'see_links.json')))
    get_index()
    config = RecoveryConfig(max_questions=None, retrieval_limit=int(req.get('retrieval_limit', 8)))

    provider = req.get('provider', 'decisions')
    if provider == 'decisions':
        key = os.environ.get('OPENAI_API_KEY')
        if not key and not dry:
            print(json.dumps({'error': 'OPENAI_API_KEY is not set'}))
            return
        from decisions_adapter import install
        install(R, key, req.get('decisions_model') or 'gpt-6-luna')
    else:
        key = os.environ.get('TYPESAFE_API_KEY')
        if not key and not dry:
            print(json.dumps({'error': 'TYPESAFE_API_KEY is not set'}))
            return
    gemini = None
    if req.get('gemini') and not dry and os.environ.get('GEMINI_API_KEY'):
        from icd_gemini_fallback import fallback
        from gemini_client import CappedGeminiClient
        gemini = (CappedGeminiClient(os.environ['GEMINI_API_KEY'], req.get('gemini_model') or 'gemini-2.5-flash',
                                     req.get('gemini_thinking') or 'low'), fallback)

    def describe(code):
        if not code:
            return None
        node = R.T.node.get(code) or R.T.node.get(code[:-1]) or R.T.node.get(code.split('.')[0])
        return node.get('desc') if node else None

    def node_desc(name):
        node = R.T.node.get(name) if isinstance(name, str) else None
        return node.get('desc') if node else None

    def trail(r):
        """How the engine got to the code, small enough to show the provider: the index entries it
        started from, the route down the ICD-10-CM tree, the linked categories it also checked
        (Excludes and see-also notes) as one line, the codes it compared, its pick and the check of it."""
        start = [dict(code=h.get('code'), term=h.get('term'), desc=node_desc(h.get('code')))
                 for h in (r.get('retrieval') or [])[:3]]
        steps, linked = [], None
        for p in r.get('path') or []:
            level, res, ans = p.get('level') or '', p.get('resolved'), p.get('answer') or {}
            conf = ans.get('confidence')
            if level == 'chapter':
                continue
            if level.startswith('linked'):
                if linked is None:
                    linked = dict(kind='linked', reached=[], dead=[])
                    steps.append(linked)
                if isinstance(res, str):
                    linked['reached'].append(res)
                elif p.get('node') and p.get('node') not in linked['dead'] and not level.endswith('_retry'):
                    linked['dead'].append(p.get('node'))
            elif level == 'candidates' and isinstance(res, list):
                steps.append(dict(kind='candidates', codes=res))
            elif level == 'decide':
                steps.append(dict(kind='decide', chose=res, chose_desc=node_desc(res), confidence=conf))
            elif level == 'verify':
                steps.append(dict(kind='verify', code=p.get('node'), result=res))
            elif level.startswith('gemini'):
                steps.append(dict(kind='gemini', chose=res if isinstance(res, str) else None, chose_desc=node_desc(res)))
            elif not isinstance(res, list):
                steps.append(dict(kind='choice', level=level, parent=p.get('node'), parent_desc=node_desc(p.get('node')),
                                  chose=res, chose_desc=node_desc(res), confidence=conf, undecided=res is None))
        # fallback: the tree walk could not finish and Gemini proposed the code instead.
        return dict(start=start, steps=steps, fallback=bool((r.get('fallback') or {}).get('resolved')))

    def run(u):
        try:
            r = walk(u, key, dry, 20, q_categories_direct, config)
            if gemini and not r.get('code'):
                r = gemini[1](u, r, gemini[0])
            code = r.get('code')
            return {'uid': u['uid'], 'code': code, 'description': r.get('description') or describe(code),
                    'verification': r.get('verification'), 'handoff': r.get('handoff'), 'escalate': r.get('escalate'),
                    'questions': r.get('questions'), 'error': r.get('error'), 'trail': trail(r)}
        except Exception as e:  # one diagnosis failing never sinks the others
            return {'uid': u['uid'], 'code': None, 'error': str(e)[:300]}

    lock = threading.Lock()

    def run_and_report(u):
        # One PROGRESS line on stderr per finished diagnosis, so the provider sees how far coding is.
        out = run(u)
        with lock:
            sys.stderr.write('PROGRESS ' + json.dumps({'uid': out['uid'], 'code': out.get('code')}) + '\n')
            sys.stderr.flush()
        return out

    with ThreadPoolExecutor(max(1, int(req.get('workers', 4)))) as ex:
        results = list(ex.map(run_and_report, units))
    print(json.dumps({'results': results}))


if __name__ == '__main__':
    main()
