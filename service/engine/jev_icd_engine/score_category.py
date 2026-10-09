"""Category inclusion for saved walks with cross-chapter links by default.
Covered = the coder's 3-char category is in the candidate set offered to the decision (entry + linked codes).
A walk that reached no entry (cannot_decide) goes to the Gemini route and is REMOVED from the denominator; its share
is reported separately. API errors are reported separately too.
    python3 score_category.py <run.json> [--vs <other_run.json>]   (candidates recomputed from the current link tables)
"""
import json, sys, collections
from icd_tree import Tree
import run_icd_system_walk as S
T = Tree(); ch = lambda c: (T.chapter_of_code(c) or {}).get('range') if c else None; d = lambda c: T.node[c]['desc'][:30] if c in T.node else '-'
# DEFAULT = cross-chapter Excludes1/Excludes2 and index see/see-also links. --with-all-notes adds code-first/code-also/use-additional; --with-custom / --with-knowledge add the review-hold tables.
S.SEE_LINKS = json.load(open('inputs/see_links.json'))
S.LINKS = json.load(open('inputs/code_links.json')) if '--with-all-notes' in sys.argv else json.load(open('inputs/excludes_links.json'))   # default: Excludes1/2 only
S.POINTERS = json.load(open('inputs/custom_links.json')) if '--with-custom' in sys.argv else None
if S.POINTERS: S.POINTERS = {k: {'icd': [], 'coder': v} for k, v in S.POINTERS.items()}
S.KNOWLEDGE = None
if '--with-knowledge' in sys.argv:
    K = json.load(open('inputs/knowledge_links.json')); S.KNOWLEDGE = {}
    for k, vs in K.items():
        for v in vs: S.KNOWLEDGE.setdefault(k, []).append(v); S.KNOWLEDGE.setdefault(v, []).append(k)
def entry(u):
    p = {x['level']: x for x in u['runs'][0]['path']}
    for lv in ('flat', 'sub3', 'sub2', 'sub1', 'category'):
        if lv in p and p[lv].get('resolved'): return p[lv]['resolved']
def cands(u):
    e = entry(u); return ([e] + [c for c, _ in S.linked_codes(e, 'K00-K95')]) if e else []
def score(units, label):
    seen = set(); units = [u for u in units if not (u['uid'] in seen or seen.add(u['uid']))]   # a few charts appear twice in the set; count each diagnosis once
    XE = {x['uid'] for x in json.load(open('inputs/extraction_errors.json'))} if __import__('os').path.exists('inputs/extraction_errors.json') else set()
    kept_all0 = [u for u in units if u['coder_kept']]; xerr = [u for u in kept_all0 if u['uid'] in XE]
    kept_all = [u for u in kept_all0 if u['uid'] not in XE]
    errs = [u for u in kept_all if u['runs'][0].get('error')]
    gemini = [u for u in kept_all if not u['runs'][0].get('error') and not entry(u)]
    kept = [u for u in kept_all if not u['runs'][0].get('error') and entry(u)]; n = len(kept)
    walk_cat = cand_cat = cand_code = noentry = 0; miss = collections.Counter(); ex = collections.defaultdict(list)
    for u in kept:
        g = u['coder_code']; e = entry(u); cs = cands(u)
        walk_cat += bool(e) and e[:3] == g[:3]
        ok = g[:3] in {c[:3] for c in cs}; cand_cat += ok; cand_code += g in cs
        if not ok:
            key = f"coder {g[:3]} {d(g[:3])[:24]:<24} | walk {e[:3] if e else 'no entry'} {d(e[:3])[:24] if e else ''}"
            miss[key] += 1; ex[key].append(f"{u['phrase'][:24]} [{g}]")
    print(f"{label}: {len(kept_all0)} coder-kept -> extraction errors {len(xerr)} (excluded), Gemini route (cannot decide) {len(gemini)} = {len(gemini)/max(len(kept_all),1):.1%}, API errors {len(errs)}, scored by Jev {n}")
    print(f"  walk itself reached the coder's category      : {walk_cat}/{n} = {walk_cat/n:.1%}")
    print(f"  CATEGORY in candidates (official)             : {cand_cat}/{n} = {cand_cat/n:.1%}")
    print(f"  exact code in candidates                      : {cand_code}/{n} = {cand_code/n:.1%}")
    return miss, ex
if __name__ == '__main__':
    U = json.load(open(sys.argv[1]))['units']; miss, ex = score(U, sys.argv[1])
    if '--vs' in sys.argv:
        ids = {u['uid'] for u in U}; O = [u for u in json.load(open(sys.argv[sys.argv.index('--vs') + 1]))['units'] if u['uid'] in ids]
        print(); score(O, sys.argv[sys.argv.index('--vs') + 1] + ' (same diagnoses)')
    print(f"\nWHERE IT LACKS ({sum(miss.values())} diagnoses, coder category not in candidates):")
    for k, v in miss.most_common(25): print(f"  {v:>3}  {k}   e.g. {' ; '.join(ex[k][:2])}")
