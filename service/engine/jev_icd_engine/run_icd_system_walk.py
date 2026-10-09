"""System-first ICD walk on Jev (separate engine from run_icd_walk.py; pure Jev, no index terms, no matching).

    python3 run_icd_system_walk.py --dry-run --limit 2
    python3 run_icd_system_walk.py --stop-after block --runs 1        # system + block for every unit
    python3 run_icd_system_walk.py --runs 1                           # down to the leaf

Step 1  SYSTEM  — which body system or kind of entry the diagnosis concerns. The symptoms chapter is NOT an option;
                  every body-system option covers both its diseases and its symptoms.
Step 2  BLOCK   — the blocks of that system's chapter PLUS every symptom block of the symptoms chapter (no pairing
                  heuristic). Each option lists the categories it contains and the entries directly beneath them, so
                  the entry for a symptom is visible: "Hemorrhage of anus and rectum" sits next to the symptom blocks.
                  The chapter is derived from the block Jev picks — it is no longer a decision.
Step 3+ CATEGORY, then the within-category walk, reused from run_icd_walk.
"""
from __future__ import annotations
import argparse, collections, json, os, re, sys, time
from concurrent.futures import ThreadPoolExecutor
import run_icd_walk as R
import index_route as IX

HERE = os.path.dirname(os.path.abspath(__file__))
T = R.T; clean = R.clean; CD = R.CD
R.PURE = True

R_RANGE = 'R00-R99'
R_CH = next(c for c in T.chapters if c['range'] == R_RANGE)
SYSTEMS = [c for c in T.chapters if c['range'] != R_RANGE]

# every body system is offered every symptom block; no pairing, no word lists — Jev chooses
SYMPTOM_BLOCKS = list(R_CH['sections'])


# ---------------------------------------------------------------- questions
SYSTEM_SUFFIX = ' This includes symptoms, signs and abnormal findings of this system when the provider has not named a disease.'
BODY_SYSTEMS = {'D50-D89', 'E00-E89', 'G00-G99', 'H00-H59', 'H60-H95', 'I00-I99', 'J00-J99', 'K00-K95', 'L00-L99', 'M00-M99', 'N00-N99'}


def q_system():
    ctx = ('This question decides which body system, or which kind of entry, the `diagnosis` concerns. ' + R.HOW_READ + ' '
           'A symptom, sign or abnormal finding belongs to the system it concerns; whether it is coded as a disease of that '
           'system or as a symptom is decided at the next step, where the entries are listed. '
           'phrase_nature historical_or_status_post or encounter_status means a reason for contact with health services '
           'unless the statements show the condition is treated or monitored at this visit. An inherited predisposition to '
           'a disease the patient does not have is a reason-for-contact entry, not a congenital malformation.')
    opts, mp = {}, {}
    for i, ch in enumerate(SYSTEMS, 1):
        k = f'opt_{i}'; mp[k] = ch['range']
        d = R.CHAPTER_DEFS.get(ch['range'], clean(ch['desc']))
        if ch['range'] in BODY_SYSTEMS:
            d = d.split(', when the condition is classified')[0].rstrip('.') + '.' + SYSTEM_SUFFIX   # no disease-vs-symptom clause here; that is step 2
        opts[k] = d
    k = f'opt_{len(SYSTEMS) + 1}'; mp[k] = 'GENERAL'
    opts[k] = 'Symptoms, signs and abnormal findings that are general or not tied to a single body system, such as findings on blood, urine or imaging tests and symptoms of the whole person.'
    opts['cannot_decide'] = CD
    return dict(key='system', context=ctx, statement='Which body system or kind of entry does `diagnosis` concern?', options=opts, map=mp)


def block_options(ch):
    return list(ch['sections']) + SYMPTOM_BLOCKS


NO_ENTRY = 'no_entry_here'
NO_SYMPTOM_BLOCKS = False   # --no-symptom-blocks: disease blocks only, no 'no entry here', no symptom stage


def q_block(ch, stage='disease'):
    """stage='disease': the system's own blocks + a 'no entry here' option.
       stage='symptom': the 14 symptom blocks, asked only after 'no entry here'."""
    if stage == 'disease':
        ctx = (f'The `diagnosis` concerns "{clean(ch["desc"])}". This question looks for the entry that names the documented '
               'condition among the disease blocks of this system. Each option names a block and lists every category and '
               'entry it contains. Choose the block that contains an entry naming the documented condition; a condition that '
               'reads like a symptom still belongs here when an entry for it is listed. A symptom or abnormality localized to a '
               'part of this system belongs to the block of that part, under its entry for other specified diseases of that '
               'part, when no entry names it itself. ' +
               ('' if NO_SYMPTOM_BLOCKS else 'Choose no_entry_here only when no listed entry names it. ') + R.HOW_READ)
        blocks = list(ch['sections']); statement = 'Which disease block contains an entry naming `diagnosis` as documented?'
    else:
        ctx = (f'No disease block of "{clean(ch["desc"])}" has an entry for the `diagnosis`. This question places it among the '
               'blocks of symptoms, signs and abnormal findings. Each option names a block and lists every category and entry '
               'it contains. ' + R.HOW_READ)
        blocks = SYMPTOM_BLOCKS; statement = 'Which symptom block holds `diagnosis` as documented?'
    opts, mp = {}, {}
    for i, s in enumerate(blocks, 1):
        k = f'opt_{i}'; mp[k] = s['id']
        names = []
        for c in s['cats']:
            names.append(clean(c['desc'])); names += [clean(g['desc']) for g in c['children']]
        opts[k] = clean(clean(s['desc']) + '. Contains: ' + '; '.join(names))
    if stage == 'disease' and not NO_SYMPTOM_BLOCKS: opts[NO_ENTRY] = 'No block listed here contains an entry that names the documented condition.'
    if not (stage == 'disease' and NO_SYMPTOM_BLOCKS): opts['cannot_decide'] = CD   # the forced organ route offers no escape
    return dict(key='block', context=ctx, statement=statement, options=opts, map=mp)


SEC_BY_ID = {s['id']: s for c in T.chapters for s in c['sections']}
TWO_ROUTE = False
INDEX_ROUTE = False
LINKS = None; SEE_LINKS = None; KNOWLEDGE = None
FORCED = False
FACILITY_REV = None   # reverse direction of the facility table, built at load: a link is a pairing, not an arrow   # --links / --see-links: code-to-code tables; no terms at runtime
LINKS = None   # --links: code-to-code links from the tabular's notes (+ facility links); no terms anywhere
POINTERS = None   # --pointers file: symptom entry -> categories to look at as well (ICD Excludes + coder-derived)


def pointer_cats(leaf):
    """Categories pointed to from this exact symptom entry (its own ICD Excludes + facility pointers); nothing inherited."""
    out = []
    for src in ('icd', 'coder'):
        for c in (POINTERS.get(leaf) or {}).get(src, []):
            n = T.resolve(c) or T.node.get(c)
            if n and n['name'] not in out: out.append(n['name'])
    return out


def q_pointer_leaves(sym, leaves_):
    ctx = ('The `diagnosis` has been placed on a symptom entry, and ICD-10-CM together with this facility\'s coding practice '
           'point from that entry to the other entries listed here. This question picks the entry that describes the documented '
           'condition. ' + R.HOW_READ + ' An entry describes the condition when it states the same clinical fact, even in other '
           'words. Prefer the entry that names the condition itself over one that names only a general symptom or an unspecified '
           'finding. A symptom or abnormality localized to a part of an organ system is a disease entry of that part, not a '
           'finding on a specimen and not a general symptom.')
    opts = {'opt_0': clean(R.T.definition(sym, with_excludes=False))}; mp = {'opt_0': sym['name']}
    for i, n in enumerate(leaves_, 1): opts[f'opt_{i}'] = clean(R.T.definition(n, with_excludes=False)); mp[f'opt_{i}'] = n['name']
    opts['cannot_decide'] = CD
    return dict(key='pointer', context=ctx, statement='Which entry describes `diagnosis` as documented?', options=opts, map=mp)


def q_pointer(leaf, cats):
    ctx = ('The `diagnosis` has been placed on a symptom entry. ICD-10-CM and this facility\'s coding practice say that '
           'conditions reaching this entry are often coded instead under the categories listed as the other options. This '
           'question decides whether the documented condition belongs to one of those categories or stays on the symptom entry. '
           + R.HOW_READ + ' Each category option lists the entries it contains; choose it when one of them names the documented '
           'condition, in the same or other words. Keep the symptom entry when none does.')
    opts = {'opt_0': 'Keep the symptom entry: ' + clean(T.node[leaf]['desc'])}; mp = {'opt_0': leaf}
    for i, c in enumerate(cats, 1):
        n = T.node[c]; names = [clean(x['desc']) for x in R.leaves(n)]
        opts[f'opt_{i}'] = clean(n['desc'] + '. Contains: ' + '; '.join(names)); mp[f'opt_{i}'] = c
    opts['cannot_decide'] = CD
    return dict(key='pointer', context=ctx, statement='Does `diagnosis` belong to one of the pointed categories, or stay on the symptom entry?', options=opts, map=mp)


def reverse_facility(P):
    rev = {}
    for a, d in (P or {}).items():
        for src in ('icd', 'coder'):
            for b in d.get(src, []):
                n = T.resolve(b) or T.node.get(b)
                if n: rev.setdefault(n['name'], []).append(a)
    return rev


def linked_codes(
    leaf: str,
    system_range: str,
    hops: int = 2,
    cap: int = 12,
    cross_chapter_only: bool = True,
) -> list[tuple[str, str]]:
    """Return linked codes, excluding the walk entry's chapter by default.

    Same-chapter targets are removed before traversal and the candidate cap, so
    they cannot consume slots or lead to second-hop candidates.
    """
    n = T.node.get(leaf); anc = []
    while n: anc.append(n['name']); n = T.node.get(n['parent']) if n['parent'] else None
    base = T.node.get(leaf)
    seen = set(anc); out = []
    hop_of = {}
    def add(c, src, hop):
        tn = T.resolve(c) or T.node.get(c)
        if not tn or tn['name'] in seen: return None
        if cross_chapter_only and base and tn['chapter'] == base['chapter']: return None
        seen.add(tn['name']); out.append((tn['name'], src)); hop_of[tn['name']] = hop; return tn['name']
    frontier = list(anc)
    for h in range(hops):
        nxt = []
        for c in frontier:
            for src_name, table in (('facility link', None), ('knowledge link', KNOWLEDGE), ('tabular note', LINKS), ('index see/see-also', SEE_LINKS)):
                if src_name == 'facility link':
                    if h > 0: continue
                    targets = [t for s_ in ('icd', 'coder') for t in ((POINTERS or {}).get(c) or {}).get(s_, [])]
                elif src_name in ('knowledge link', 'index see/see-also'):
                    if h > 0: continue
                    targets = (table or {}).get(c, [])
                else:
                    targets = list((table or {}).get(c, {}).keys())
                for t in targets:
                    r = add(t, src_name, h)
                    if r: nxt.append(r)            # every newly reached code joins the next hop, whatever its source
        frontier = nxt
    # facility and knowledge links first, then tabular notes, then see/see-also; the cap applies after ordering
    pri = {'facility link': 0, 'knowledge link': 1, 'tabular note': 2, 'index see/see-also': 3}
    def dist(c):   # structural, code-based: 0 same block, 1 same chapter, 2 elsewhere
        n = T.node.get(c)
        if not base or not n: return 3
        return 0 if n['section'] == base['section'] else 1 if n['chapter'] == base['chapter'] else 2
    out.sort(key=lambda x: (pri[x[1]], hop_of.get(x[0], 9), dist(x[0])))   # source, then 1-hop before 2-hop, then nearest in the tree
    return out[:cap]


def q_decide_n(cands, origins):
    ctx = ('Several entries of ICD-10-CM have been reached for the `diagnosis`: the one the code-based walk through its body '
           'system arrived at, and the entries that ICD-10-CM\'s own notes on that entry, or this facility\'s coding practice, link '
           'it to. This question picks the entry that describes the documented condition. '
           + R.HOW_READ + ' An entry describes the condition when it states the same clinical fact, even in other words. Prefer the '
           'entry that names the condition itself over one that names only a general symptom or an unspecified finding. A symptom '
           'or abnormality localized to a part of an organ system is a disease entry of that part, not a finding on a specimen and '
           'not a general symptom.')
    opts, mp = {}, {}
    for i, (n, o) in enumerate(zip(cands, origins), 1):
        opts[f'opt_{i}'] = clean(R.T.definition(n, with_excludes=False)) + f' [reached by: {o}]'; mp[f'opt_{i}'] = n['name']
    opts['cannot_decide'] = CD
    return dict(key='decide', context=ctx, statement='Which entry describes `diagnosis` as documented?', options=opts, map=mp)


def index_walk(step, phrase, dry):
    """Jev follows the alphabetic index from the matching main term to a coded entry. Returns a tabular node or None."""
    mains = IX.matching_mains(phrase)
    if not mains: return None
    if len(mains) > 1:
        q = dict(key='index_main', context=('The alphabetic index of ICD-10-CM has these main terms that appear in the `diagnosis`. '
                 'Pick the term that names the condition being coded; the other words are its qualifiers or sites. ' + R.HOW_READ),
                 statement='Which index term is the condition in `diagnosis`?', options={f'opt_{i}': m['title'] for i, m in enumerate(mains, 1)}, map={f'opt_{i}': i - 1 for i, m in enumerate(mains, 1)})
        q['options']['cannot_decide'] = CD
        ch, q = step('index_main', q)
        if ch not in q['map']: return None
        term = mains[q['map'][ch]]
    else:
        term = mains[0]
    for depth in range(6):
        opts, mp = {}, {}
        if term['code']: opts['opt_0'] = 'This entry as it stands: ' + IX.option_text(term, T); mp['opt_0'] = ('code', term['code'])
        for i, c in enumerate(term['children'], 1): opts[f'opt_{i}'] = IX.option_text(c, T); mp[f'opt_{i}'] = ('child', i - 1)
        if term['see'] and IX.find_main(term['see']): opts['opt_see'] = f'see {term["see"]}'; mp['opt_see'] = ('jump', term['see'])
        if term['see_also'] and IX.find_main(term['see_also']): opts['opt_see_also'] = f'see also {term["see_also"]}'; mp['opt_see_also'] = ('jump', term['see_also'])
        if not opts: return None
        opts['cannot_decide'] = CD
        q = dict(key=f'index_{depth}', context=(f'The alphabetic index is open at "{term["title"]}". Each option is a sub-term, with the code entry it '
                 'leads to when it has one. Pick the sub-term the documentation supports; pick the entry as it stands when no sub-term '
                 'applies; follow a see or see-also reference when the condition is filed under that other term. ' + R.HOW_READ),
                 statement='Which index sub-term applies to `diagnosis` as documented?', options=opts, map=mp)
        ch, q = step(f'index_{depth}', q)
        if ch not in q['map']: return None
        kind, val = q['map'][ch]
        if kind == 'code': return T.resolve(val) or T.node.get(val[:3])
        if kind == 'child':
            term = term['children'][val]
            if term['code'] and not term['children'] and not term['see']: return T.resolve(term['code']) or T.node.get(term['code'][:3])
        if kind == 'jump': term = IX.find_main(val)
    return (T.resolve(term['code']) or T.node.get(term['code'][:3])) if term.get('code') else None


def q_decide(a, b):
    ctx = ('Two entries of ICD-10-CM have been reached for the `diagnosis`, one through the diseases of the body system it '
           'concerns and one through the symptoms and findings chapter. This question picks the entry that describes the '
           'documented condition. ' + R.HOW_READ + ' An entry describes the condition when it states the same clinical fact, '
           'even in other words. Prefer the entry that names the condition itself over one that names only a general '
           'symptom or an unspecified finding. A symptom or abnormality localized to a part of an organ system is a disease '
           'entry of that part, not a finding on a specimen and not a general symptom.')
    opts = {'opt_1': R.T.definition(a, with_excludes=False), 'opt_2': R.T.definition(b, with_excludes=False), 'cannot_decide': CD}
    return dict(key='decide', context=ctx, statement='Which entry describes `diagnosis` as documented?', options={k: clean(v) for k, v in opts.items()}, map={'opt_1': a['name'], 'opt_2': b['name']})


ORGAN_RULE = (' A symptom or abnormality localized to a part of this system belongs to that part\'s entry for other specified '
              'diseases when no entry names it itself; an entry worded "unspecified disease" is for a disease whose nature is '
              'not stated, not for a localized symptom.')


def descend_from(step, node, ptoks, pl, flat, dry):
    """Forced walk from a category node down to a leaf (used after a pointer redirect)."""
    depth = 0
    while node['children']:
        depth += 1; lv = R.leaves(node)
        if len(lv) <= flat:
            ch, q = step('pointer_flat', R.q_nodes('flat', lv, node['desc'], ptoks, flat=True, ptoks=ptoks, pl=pl), node['name'])
            node = T.node[q['map'][ch]] if ch in q['map'] else (R.residual_child(lv) or lv[0]); break
        ch, q = step(f'pointer_sub{depth}', R.q_nodes(f'sub{depth}', node['children'], node['desc'], ptoks, flat=False, ptoks=ptoks, pl=pl), node['name'])
        node = T.node[q['map'][ch]] if ch in q['map'] else (R.residual_child(node['children']) or node['children'][0])
        if dry and depth > 6: break
    return node


def descend(step, sec, node_start, u, ptoks, pl, flat, dry, tag):
    """category -> ... -> leaf within one block; forced (cannot_decide falls to the first option). Returns leaf node or None."""
    qc = R.q_nodes('category', sec['cats'], clean(sec['desc']), ptoks, flat=False, ptoks=ptoks, pl=pl)
    if tag == 'organ': qc['context'] += ORGAN_RULE; qc['options'].pop('cannot_decide', None)
    ch, q = step(f'{tag}_category', qc)
    if ch not in q['map']: ch = 'opt_1'
    node = T.node[q['map'][ch]]; depth = 0
    while node['children']:
        depth += 1; lv = R.leaves(node)
        if len(lv) <= flat:
            ch, q = step(f'{tag}_flat', R.q_nodes('flat', lv, node['desc'], ptoks, flat=True, ptoks=ptoks, pl=pl), node['name'])
            node = T.node[q['map'][ch]] if ch in q['map'] else (R.residual_child(lv) or lv[0]); break
        ch, q = step(f'{tag}_sub{depth}', R.q_nodes(f'sub{depth}', node['children'], node['desc'], ptoks, flat=False, ptoks=ptoks, pl=pl), node['name'])
        node = T.node[q['map'][ch]] if ch in q['map'] else (R.residual_child(node['children']) or node['children'][0])
        if dry and depth > 6: break
    return node



# ---------------------------------------------------------------- walk
def walk(u, key, dry, flat, stop_after=None):
    st = u['state']; path = []; tok = 0; esc = []

    def step(level, q, node_name=None):
        nonlocal tok
        if FORCED and level not in ('system', 'decide'):
            q = dict(q, options={k: v for k, v in q['options'].items() if k not in ('cannot_decide', NO_ENTRY)})
        a, t = R.ask(st, q, key, dry); tok += t
        ch = a.get('choice')
        path.append(dict(level=level, node=node_name, q=q if dry else None, choice=ch, resolved=q['map'].get(ch), answer=a))
        return ch, q

    ch, q = step('system', q_system())
    if ch not in q['map']: return dict(path=path, code=None, escalate=['system:' + str(ch)], tokens=tok)
    system = {'range': 'GENERAL', 'desc': 'general symptoms and findings', 'sections': []} if q['map'][ch] == 'GENERAL' else next(c for c in SYSTEMS if c['range'] == q['map'][ch])
    if TWO_ROUTE and system['range'] != 'GENERAL':
        global NO_SYMPTOM_BLOCKS
        ptoks = R.toks(u['phrase']); pl = R.ftoks(u['phrase'])
        saved = NO_SYMPTOM_BLOCKS; NO_SYMPTOM_BLOCKS = True
        ch, q = step('organ_block', q_block(system, 'disease')); NO_SYMPTOM_BLOCKS = saved
        if ch not in q['map']: ch = 'opt_1'
        leaf_a = descend(step, SEC_BY_ID[q['map'][ch]], None, u, ptoks, pl, flat, dry, 'organ')
        ch, q = step('symptom_block', q_block(system, 'symptom'))
        if ch not in q['map']: ch = 'opt_1'
        leaf_b = descend(step, SEC_BY_ID[q['map'][ch]], None, u, ptoks, pl, flat, dry, 'symptom')
        ch, q = step('decide', q_decide(leaf_a, leaf_b))
        win = T.node[q['map'][ch]] if ch in q['map'] else None
        if win is None: return dict(path=path, code=None, escalate=['decide:cannot_decide'], tokens=tok, leaf_a=leaf_a['name'], leaf_b=leaf_b['name'])
        chapter = T.chapters[win['chapter']]
        path.append(dict(level='chapter', node=None, q=None, choice='derived', resolved=chapter['range'], answer={'choice': 'derived'}))
        path.append(dict(level='block', node=None, q=None, choice='derived', resolved=win['section'], answer={'choice': 'derived'}))
        return dict(path=path, code=T.leaf_code(win['name'], None) if not win.get('seven') else None, escalate=esc, tokens=tok, leaf_a=leaf_a['name'], leaf_b=leaf_b['name'], winner=win['name'])
    if system['range'] == 'GENERAL':
        ch, q = step('block', q_block(system, 'symptom'))
    else:
        ch, q = step('block', q_block(system, 'disease'))
        if ch == NO_ENTRY:
            esc.append('block:no_entry_in_disease_blocks'); ch, q = step('block_symptom', q_block(system, 'symptom'))
    if ch not in q['map']: return dict(path=path, code=None, escalate=['block:' + str(ch)], tokens=tok)
    sec = SEC_BY_ID[q['map'][ch]]
    chapter = T.chapters[sec['chapter']]
    path.append(dict(level='chapter', node=None, q=None, choice='derived', resolved=chapter['range'], answer={'choice': 'derived'}))
    if stop_after == 'block': return dict(path=path, code=None, escalate=esc, tokens=tok)
    ptoks = R.toks(u['phrase']); pl = R.ftoks(u['phrase'])
    ch, q = step('category', R.q_nodes('category', sec['cats'], clean(sec['desc']), ptoks, flat=False, ptoks=ptoks, pl=pl))
    if ch not in q['map']: return dict(path=path, code=None, escalate=['category:' + str(ch)], tokens=tok)
    node = T.node[q['map'][ch]]
    if stop_after == 'category': return dict(path=path, code=None, escalate=esc, tokens=tok)
    depth = 0
    while node['children']:
        depth += 1
        lv = R.leaves(node)
        if len(lv) <= flat:
            ch, q = step('flat', R.q_nodes('flat', lv, node['desc'], ptoks, flat=True, ptoks=ptoks, pl=pl), node['name'])
            if ch in q['map']: node = T.node[q['map'][ch]]
            else: return dict(path=path, code=None, escalate=[f'flat:{ch}'], tokens=tok)
            break
        ch, q = step(f'sub{depth}', R.q_nodes(f'sub{depth}', node['children'], node['desc'], ptoks, flat=False, ptoks=ptoks, pl=pl), node['name'])
        if ch in q['map']: node = T.node[q['map'][ch]]
        else: return dict(path=path, code=None, escalate=[f'sub{depth}:{ch}'], tokens=tok)
        if dry and depth > 6: break
    if POINTERS and T.chapters[node['chapter']]['range'] == 'R00-R99' and pointer_cats(node['name']):
        extra = [l for c in pointer_cats(node['name']) for l in R.leaves(T.node[c])]
        q = R.q_nodes('flat', [node] + extra, node['desc'], ptoks, flat=True, ptoks=ptoks, pl=pl)
        q['context'] = (f'The `diagnosis` has reached the symptom entry "{clean(node["desc"])}". ICD-10-CM and this facility\'s coding '
                        'practice point from this entry to the entries of some disease categories, so those entries are listed together '
                        'with it. Each option is one final code; choose the one that describes the documented condition. An entry '
                        'describes the condition when it states the same clinical fact, even in other words. A symptom or abnormality '
                        'localized to a part of an organ system is a disease entry of that part, not a finding on a specimen and not a '
                        'general symptom. ' + R.HOW_LEAF)
        q['statement'] = 'Which entry describes `diagnosis` as documented?'
        ch, q = step('pointer_inclusive', q, node['name'])
        if ch in q['map'] and q['map'][ch] != node['name']:
            esc.append(f"pointer:{node['name']}->{q['map'][ch]}"); node = T.node[q['map'][ch]]
            path.append(dict(level='chapter', node=None, q=None, choice='derived', resolved=T.chapters[node['chapter']]['range'], answer={'choice': 'derived'}))
    if LINKS or SEE_LINKS:
        ptoks = R.toks(u['phrase']); pl = R.ftoks(u['phrase'])
        linked = linked_codes(node['name'], system['range'] if system['range'] != 'GENERAL' else 'R00-R99')
        if linked:
            cands = [node]; origins = ['code-based walk']
            for c, src in linked:
                tn = T.node[c]
                if tn['children']: tn = descend_from(step, tn, ptoks, pl, flat, dry)
                if tn['name'] not in [x['name'] for x in cands]: cands.append(tn); origins.append(src)
            path.append(dict(level='candidates', node=None, q=None, choice=None, resolved=[x['name'] for x in cands], answer={'origins': origins}))
            if len(cands) > 1:
                ch, q = step('decide', q_decide_n(cands, origins))
                if ch in q['map'] and q['map'][ch] != node['name']:
                    esc.append(f"link:{node['name']}->{q['map'][ch]}"); node = T.node[q['map'][ch]]
                    path.append(dict(level='chapter', node=None, q=None, choice='derived', resolved=T.chapters[node['chapter']]['range'], answer={'choice': 'derived'}))
        else:
            esc.append('link:none'); path.append(dict(level='candidates', node=None, q=None, choice=None, resolved=[node['name']], answer={'origins': ['code-based walk']}))
    if INDEX_ROUTE:
        ptoks = R.toks(u['phrase']); pl = R.ftoks(u['phrase'])
        ix = index_walk(step, u['phrase'], dry)
        if ix is not None and ix['children']: ix = descend_from(step, ix, ptoks, pl, flat, dry)
        if ix is not None and ix['name'] != node['name']:
            cands, origins = [node, ix], ['code-based walk', 'alphabetic index']
            ch, q = step('decide', q_decide_n(cands, origins))
            if ch in q['map'] and q['map'][ch] != node['name']:
                esc.append(f"index:{node['name']}->{q['map'][ch]}"); node = T.node[q['map'][ch]]
                path.append(dict(level='chapter', node=None, q=None, choice='derived', resolved=T.chapters[node['chapter']]['range'], answer={'choice': 'derived'}))
        elif ix is not None: esc.append('index:agrees')
        else: esc.append('index:none')
    seventh = None
    if node.get('seven'):
        ch, q = step('seventh', R.q_seventh(node['seven'], node['desc']))
        if ch not in q['map']: return dict(path=path, code=None, escalate=['seventh:' + str(ch)], tokens=tok)
        seventh = q['map'][ch]
    return dict(path=path, code=T.leaf_code(node['name'], seventh), escalate=esc, tokens=tok)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', type=int, default=1); ap.add_argument('--workers', type=int, default=6); ap.add_argument('--flat', type=int, default=20)
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--ids'); ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--out')
    ap.add_argument('--stop-after', choices=['block', 'category']); ap.add_argument('--units', help='units json (default inputs/icd100_units.json)')
    ap.add_argument('--no-symptom-blocks', action='store_true', help='disease blocks only: no symptom stage')
    ap.add_argument('--pointers', help='symptom-pointer table json: single pass + one pointer question on symptom leaves')
    ap.add_argument('--links', help='tabular-note code links json'); ap.add_argument('--see-links', help='index see/see-also code links json'); ap.add_argument('--knowledge', help='hand-authored code links json'); ap.add_argument('--forced', action='store_true', help='no cannot_decide in the walk: always reach a candidate set')
    ap.add_argument('--index-route', action='store_true', help='also follow the alphabetic index from the phrase term and compare')
    ap.add_argument('--two-route', action='store_true', help='organ route and symptom route both forced to a leaf, then a two-entry decision')
    a = ap.parse_args()
    global NO_SYMPTOM_BLOCKS, TWO_ROUTE, POINTERS, INDEX_ROUTE, LINKS, SEE_LINKS, KNOWLEDGE, FORCED; NO_SYMPTOM_BLOCKS = a.no_symptom_blocks; TWO_ROUTE = a.two_route; INDEX_ROUTE = a.index_route
    POINTERS = json.load(open(a.pointers)) if a.pointers else None
    FORCED = a.forced
    LINKS = json.load(open(a.links)) if a.links else None; SEE_LINKS = json.load(open(a.see_links)) if a.see_links else None
    if a.knowledge:
        kl = json.load(open(a.knowledge)); KNOWLEDGE = {}
        for k_, vs in kl.items():
            for v_ in vs: KNOWLEDGE.setdefault(k_, []).append(v_); KNOWLEDGE.setdefault(v_, []).append(k_)   # bidirectional
    key = os.environ.get('TYPESAFE_API_KEY')
    if not key and not a.dry_run: sys.exit('TYPESAFE_API_KEY not set')
    units = json.load(open(a.units or os.path.join(HERE, 'inputs', 'icd100_units.json')))
    if a.ids: want = set(json.load(open(a.ids))); units = [u for u in units if u['uid'] in want]
    if a.limit: units = units[:a.limit]
    out = a.out or os.path.join(HERE, 'results', 'system_walk.json')
    if a.dry_run:
        for u in units:
            r = walk(u, key, True, a.flat, a.stop_after)
            print('\n' + '=' * 100 + f"\n{u['uid']}  phrase={u['phrase']!r}  engine={u['engine_code']}")
            for p in r['path']:
                q = p['q']
                if not q: continue
                print(f"\n-- level {p['level']}  ({len(q['options']) - 1} options)\n   CONTEXT: {q['context'][:700]}\n   STATEMENT: {q['statement']}")
                for k, v in q['options'].items(): print(f"     {k:<14} {q['map'].get(k, '')!s:<9} {v[:300]}")
        return
    jobs = [(i, r) for i in range(len(units)) for r in range(1, a.runs + 1)]
    res = collections.defaultdict(list); t0 = time.time()

    def work(j):
        i, r = j
        try: w = walk(units[i], key, False, a.flat, a.stop_after); w['run'] = r; w['error'] = None
        except Exception as e: w = dict(run=r, path=[], code=None, escalate=['error'], tokens=0, error=str(e)[:300])
        return i, w
    with ThreadPoolExecutor(a.workers) as ex:
        for i, w in ex.map(work, jobs): res[i].append(w)
    for i, u in enumerate(units): u['runs'] = sorted(res[i], key=lambda x: x['run'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({'start': 'system', 'runs': a.runs, 'flat': a.flat, 'units': units}, open(out, 'w'), indent=1, ensure_ascii=False)
    tok = sum(w['tokens'] for u in units for w in u['runs'])
    print(f'saved {out}; {len(units)} units x {a.runs} runs; input tokens {tok:,} (~${tok / 1e6 * 0.042:.3f}); {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
