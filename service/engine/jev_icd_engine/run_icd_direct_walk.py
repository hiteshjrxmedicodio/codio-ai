"""ICD walk on Jev: system -> category -> entry -> linked candidates -> decision.

    python3 run_icd_direct_walk.py --dry-run --units inputs/gastro/gastro500_units.json --limit 2
    python3 run_icd_direct_walk.py --units ... --ids ids_issue_all.json --pointers inputs/symptom_pointers.json \
        --links inputs/code_links.json --see-links inputs/see_links.json --knowledge inputs/knowledge_links.json

Step 1  SYSTEM    the 21 non-symptom chapters + general symptoms (same question as run_icd_system_walk).
Step 2  CATEGORY  choose among the selected system's categories and all symptom categories in one question.
Step 3  ENTRY     the within-category walk (sub-levels, flat leaf question when <= --flat leaves), cannot_decide allowed.
Step 4  LINKS     candidate set = entry + codes linked to it or its parents through Excludes1 / Excludes2 notes (both
                  directions, 2 hops) and the index's see / see-also references. Code-first, code-also and use-additional
                  notes are not used. Custom and knowledge links are on review hold and load only when passed explicitly.
                  Only links to a different ICD chapter from the walk entry are offered. Then ONE decision among
                  concrete entries. Pure Jev throughout.
"""
from __future__ import annotations
import argparse, collections, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
import run_icd_walk as R
import run_icd_system_walk as S

HERE = os.path.dirname(os.path.abspath(__file__))
T = R.T; clean = R.clean; CD = R.CD
R.PURE = True
SYMPTOM_CATS = [cat for sec in S.R_CH['sections'] for cat in sec['cats']]


def q_categories_direct(system):
    """Offer the system and symptom categories in one question."""
    if system['range'] == 'GENERAL':
        cats = SYMPTOM_CATS
        where = 'the symptoms, signs and abnormal findings chapter'
    else:
        cats = [cat for sec in system['sections'] for cat in sec['cats']] + SYMPTOM_CATS
        where = f'"{clean(system["desc"])}" and the symptoms chapter'
    ctx = (f'The `diagnosis` concerns {where}. Pick the category for what the `diagnosis` phrase itself names, using its '
           'anatomical_location to distinguish organs and sites. First decide what the phrase names. It names an observed '
           'appearance when its subject is how tissue looked during the examination: its colour, surface, texture, shape or '
           'pattern. It names a diagnosis when its subject is a disease itself. An observed appearance is coded as a finding '
           'of the organ where it was seen: choose that organ\'s category for other specified diseases when no category names '
           'the appearance itself. This holds even when the phrase or the statements add that the appearance is compatible '
           'with, consistent with, suggestive of, in keeping with, or due to a disease; that added disease is an '
           'interpretation and is not coded from this phrase. Choose a disease category only when the phrase names the '
           'disease itself as the diagnosis. A general symptom category is for a symptom or finding that is not located in '
           'one organ. An abnormal test result is a finding, not the screening encounter. Statements may clarify the same '
           'diagnosis, but must not replace it with a different condition. Each category option lists its entries; choose by '
           'those entries. ' + R.HOW_READ)
    return _category_question(cats, ctx)


def _category_question(cats, ctx):
    opts, mp = {}, {}
    for i, c in enumerate(cats, 1):
        k = f'opt_{i}'; mp[k] = c['name']
        inc = (c.get('includes') or []) + (c.get('inclusion') or [])
        names = [clean(g['desc'] + (' (includes: ' + '; '.join(g['inclusion']) + ')' if g.get('inclusion') else '')) for g in c['children']] or []   # entry + its CMS inclusion terms
        opts[k] = clean(c['desc'] + ('. Includes: ' + '; '.join(inc) if inc else '') + ('. Contains: ' + '; '.join(names) if names else ''))
    opts['cannot_decide'] = CD
    return dict(key='category', context=ctx, statement=('Which category holds what the `diagnosis` phrase names? If the phrase '
                'names how tissue looked during the examination, the answer is the category of that organ for other specified '
                'diseases, not the category of a disease the appearance is said to be compatible with.'), options=opts, map=mp)


def walk(u, key, dry, flat):
    st = u['state']; path = []; tok = 0; esc = []

    def step(level, q, node_name=None):
        nonlocal tok
        a, t = R.ask(st, q, key, dry); tok += t
        ch = a.get('choice')
        path.append(dict(level=level, node=node_name, q=q if dry else None, choice=ch, resolved=q['map'].get(ch), answer=a))
        return ch, q

    ch, q = step('system', S.q_system())
    if ch not in q['map']: return dict(path=path, code=None, escalate=['system:' + str(ch)], tokens=tok)
    system = {'range': 'GENERAL', 'desc': 'general symptoms and findings', 'sections': []} if q['map'][ch] == 'GENERAL' else next(c for c in S.SYSTEMS if c['range'] == q['map'][ch])
    ch, q = step('category', q_categories_direct(system))
    if ch not in q['map']: return dict(path=path, code=None, escalate=['category:' + str(ch)], tokens=tok)
    node = T.node[q['map'][ch]]
    path.append(dict(level='chapter', node=None, q=None, choice='derived', resolved=T.chapters[node['chapter']]['range'], answer={'choice': 'derived'}))
    ptoks = R.toks(u['phrase']); pl = R.ftoks(u['phrase'])
    depth = 0
    while node['children']:
        depth += 1; lv = R.leaves(node)
        if len(lv) <= flat:
            ch, q = step('flat', R.q_nodes('flat', lv, node['desc'], ptoks, flat=True, ptoks=ptoks, pl=pl), node['name'])
            if ch in q['map']: node = T.node[q['map'][ch]]
            else: return dict(path=path, code=None, escalate=[f'flat:{ch}'], tokens=tok)
            break
        ch, q = step(f'sub{depth}', R.q_nodes(f'sub{depth}', node['children'], node['desc'], ptoks, flat=False, ptoks=ptoks, pl=pl), node['name'])
        if ch in q['map']: node = T.node[q['map'][ch]]
        else: return dict(path=path, code=None, escalate=[f'sub{depth}:{ch}'], tokens=tok)
        if dry and depth > 6: break
    if S.LINKS or S.SEE_LINKS or S.KNOWLEDGE or S.POINTERS:
        linked = S.linked_codes(node['name'], system['range'])
        cands = [node]; origins = ['code-based walk']
        for c, src in linked:
            tn = T.node[c]
            if tn['children']: tn = S.descend_from(step, tn, ptoks, pl, flat, dry)
            if tn['name'] not in [x['name'] for x in cands]: cands.append(tn); origins.append(src)
        path.append(dict(level='candidates', node=None, q=None, choice=None, resolved=[x['name'] for x in cands], answer={'origins': origins}))
        if len(cands) > 1:
            ch, q = step('decide', S.q_decide_n(cands, origins))
            if ch in q['map'] and q['map'][ch] != node['name']:
                esc.append(f"link:{node['name']}->{q['map'][ch]}"); node = T.node[q['map'][ch]]
                path.append(dict(level='chapter', node=None, q=None, choice='derived', resolved=T.chapters[node['chapter']]['range'], answer={'choice': 'derived'}))
    seventh = None
    if node.get('seven'):
        ch, q = step('seventh', R.q_seventh(node['seven'], node['desc']))
        if ch not in q['map']: return dict(path=path, code=None, escalate=['seventh:' + str(ch)], tokens=tok)
        seventh = q['map'][ch]
    return dict(path=path, code=T.leaf_code(node['name'], seventh), escalate=esc, tokens=tok)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', type=int, default=1); ap.add_argument('--workers', type=int, default=8); ap.add_argument('--flat', type=int, default=20)
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--ids'); ap.add_argument('--units'); ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--out')
    ap.add_argument('--pointers', help='custom links (on hold; pass to include)'); ap.add_argument('--links', help='tabular link table (default: inputs/excludes_links.json = Excludes1/2 only)'); ap.add_argument('--see-links', help='index see/see-also links (default: inputs/see_links.json)'); ap.add_argument('--knowledge', help='knowledge links (on hold; pass to include)')
    a = ap.parse_args()
    key = os.environ.get('TYPESAFE_API_KEY')
    if not key and not a.dry_run: sys.exit('TYPESAFE_API_KEY not set')
    # DEFAULT ENGINE: system -> category -> entry; cross-chapter candidates from Excludes1/Excludes2 notes
    # and the index see/see-also references. Code-first / code-also / use-additional notes are NOT used (they add a second code,
    # not an alternative). Custom and knowledge links are on review hold and load only when passed explicitly.
    S.POINTERS = json.load(open(a.pointers)) if a.pointers else None
    if S.POINTERS and isinstance(next(iter(S.POINTERS.values())), list):
        S.POINTERS = {k: {'icd': [], 'coder': v} for k, v in S.POINTERS.items()}   # custom links file: {entry: [categories]}
    S.LINKS = json.load(open(a.links or os.path.join(HERE, 'inputs', 'excludes_links.json')))   # Excludes1 + Excludes2 only (CMS, code-to-code)
    S.SEE_LINKS = json.load(open(a.see_links or os.path.join(HERE, 'inputs', 'see_links.json')))
    S.KNOWLEDGE = None
    if a.knowledge:
        kl = json.load(open(a.knowledge)); S.KNOWLEDGE = {}
        for k_, vs in kl.items():
            for v_ in vs: S.KNOWLEDGE.setdefault(k_, []).append(v_); S.KNOWLEDGE.setdefault(v_, []).append(k_)
    units = json.load(open(a.units or os.path.join(HERE, 'inputs', 'icd100_units.json')))
    if a.ids: want = set(json.load(open(a.ids))); units = [u for u in units if u['uid'] in want]
    if a.limit: units = units[:a.limit]
    out = a.out or os.path.join(HERE, 'results', 'direct_walk.json')
    if a.dry_run:
        for u in units:
            r = walk(u, key, True, a.flat)
            print('\n' + '=' * 100 + f"\n{u['uid']}  phrase={u['phrase']!r}  coder={u.get('coder_code')}  engine={u['engine_code']}")
            for p in r['path']:
                q = p['q']
                if not q: continue
                n = sum(len(v) for v in q['options'].values())
                print(f"\n-- {p['level']}: {len(q['options']) - 1} options, {n:,} chars ≈ {n // 4:,} tokens\n   CONTEXT: {q['context'][:260]}...\n   STATEMENT: {q['statement']}")
                for k, v in list(q['options'].items())[:6]: print(f"     {k:<10} {q['map'].get(k, '')!s:<8} {v[:150]}")
                if len(q['options']) > 6: print(f'     ... {len(q["options"]) - 6} more')
        return
    jobs = [(i, r) for i in range(len(units)) for r in range(1, a.runs + 1)]
    res = collections.defaultdict(list); t0 = time.time()

    def work(j):
        i, r = j
        try: w = walk(units[i], key, False, a.flat); w['run'] = r; w['error'] = None
        except Exception as e: w = dict(run=r, path=[], code=None, escalate=['error'], tokens=0, error=str(e)[:300])
        return i, w
    with ThreadPoolExecutor(a.workers) as ex:
        for i, w in ex.map(work, jobs): res[i].append(w)
    for i, u in enumerate(units): u['runs'] = sorted(res[i], key=lambda x: x['run'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({'start': 'direct', 'runs': a.runs, 'flat': a.flat, 'units': units}, open(out, 'w'), indent=1, ensure_ascii=False)
    tok = sum(w['tokens'] for u in units for w in u['runs'])
    print(f'saved {out}; {len(units)} units x {a.runs} runs; input tokens {tok:,} (~${tok / 1e6 * 0.042:.3f}); {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
