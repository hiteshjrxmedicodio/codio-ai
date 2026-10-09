"""Walk the ICD-10-CM tree with Jev, one pick-one question per step, and compose the code in code.

    export TYPESAFE_API_KEY=...                       # from chat only, never in a file
    python3 run_icd_walk.py --dry-run --limit 3       # print the questions, call nothing
    python3 run_icd_walk.py --from category --runs 3  # start at the engine's 3-char category (facet test)
    python3 run_icd_walk.py --from chapter  --runs 3  # full walk: chapter -> block -> category -> ... -> leaf

v3 (after the first 480-dx run, 81.5% vs engine):
  * A node whose subtree has <= --flat leaves is asked as ONE question over the leaves themselves (no hidden
    grandchildren: 'Generalized abdominal pain' is visible instead of only 'Other abdominal pain').
  * A bigger node is asked over its children, each option carrying a 'Contains:' preview of the entries beneath.
  * Every option carries the alphabetic-index terms that lead into it AND share a word with the diagnosis
    (Schatzki's ring -> K22.2; Debility -> R53.81), which is the knowledge the tabular alone lacks.
  * cannot_decide falls back to the single 'unspecified' sibling, else the single 'other specified' one.
  * Option keys are opt_1..opt_n; no code string reaches the model. Jev's choice is used as a class label;
    probabilities are stored but not used for routing.
"""
from __future__ import annotations
import argparse, collections, json, os, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from icd_tree import Tree

HERE = os.path.dirname(os.path.abspath(__file__))
PURE = True   # no index terms, no word lists, no fallback/override; Jev's choice is the answer
API = 'https://api.typesafe.ai/v1/systemone'; MODEL = 'jev-latest'
CD = 'The diagnosis and statements do not let you tell which of the other options applies.'
T = Tree()
READ = ['diagnosis', 'statements']
STOP = {'the', 'of', 'in', 'and', 'or', 'with', 'without', 'to', 'a', 'an', 'on', 'for', 'due', 'other', 'unspecified', 'nos',
        'disease', 'disorder', 'syndrome', 'chronic', 'acute', 'history', 'personal', 'status', 'left', 'right', 'bilateral',
        'specified', 'elsewhere', 'classified', 'not', 'see', 'also', 'type', 'mild', 'moderate', 'severe'}

# --------------------------------------------------------------------------- alphabetic index
_IDX = collections.defaultdict(list)   # code prefix (no dash) -> [index path]
for path, code in json.load(open(os.path.join(HERE, 'inputs', 'icd_index_2026.json'))):
    _IDX[code.rstrip('-').rstrip('.')].append(path)


_IDX_CH = collections.defaultdict(list); _IDX_SEC = collections.defaultdict(list)
for _code, _paths in _IDX.items():
    _n = T.resolve(_code) or T.node.get(_code[:3])
    if _n: _IDX_CH[_n['chapter']] += _paths; _IDX_SEC[_n['section']] += _paths


def ranked_terms(paths, qtoks, ptoks, cap=6, pl=frozenset(), min_tier=1):
    if PURE: return []
    hits = {}
    for p in paths:
        t, extra = tier(p, pl, qtoks)
        if t >= min_tier:
            tag = (' (exact)' if t == 3 else f" (exact after dropping the qualifier: {', '.join(sorted(extra))})" if t == 2.5
                   else f" (only if the documentation also states: {', '.join(sorted(extra))})" if t == 2 else '')
            hits[p.lower()] = (t, len(toks(p) & qtoks), p + tag)
    return [x[2] for x in sorted(hits.values(), key=lambda x: (-x[0], -x[1]))[:cap]]


LIGHT_STOP = {'the', 'of', 'in', 'and', 'or', 'to', 'a', 'an', 'on', 'for', 'see', 'also', 'nos', 'nec', 'other', 'specified',
              'unspecified', 'left', 'right', 'bilateral', 'with', 'without', 'due', 'by', 'at', 'as', 'mild', 'moderate',
              'severe', 'refractory', 'recurrent', 'persistent', 'progressive', 'intermittent', 'symptomatic', 'new', 'worsening', 'stable',
              'region', 'side', 'site', 'area', 'level', 'borderline', 'cm', 'mm', 'kg'}


def ftoks(s):
    """Light tokens for the exact/covers tiers: grammar words dropped, plurals folded (tests -> test, pains -> pain)."""
    out = set()
    for w in re.findall(r"[a-z0-9']+", (s or '').lower()):
        w = w.replace("'s", '').replace("'", '')   # Parkinson's -> parkinson
        if re.fullmatch(r'[0-9.]+', w): continue   # measurements are never index words
        if w in LIGHT_STOP or len(w) < 2: continue
        if len(w) > 3 and w.endswith('s') and not w.endswith('ss'): w = w[:-1]
        out.add(w)
    return out


def tier(p, pl, qtoks):
    """(tier, extra). core = index words outside parentheses, full = all index words.
    3   exact: every core word is in the phrase and every phrase word is in the full path ("Diabetes (mellitus)" == "Diabetes mellitus")
    2.5 the phrase is the index entry plus qualifiers the index does not use ("Chronic anemia" -> "Anemia")
    2   the path covers the phrase but needs extra words documented ("Dysphagia > spastica" for "Dysphagia")
    1   shares a word; 0 none."""
    segs = re.sub(r'\([^)]*\)', ' ', p).split(' > ')
    segs[0] = segs[0].split(',')[0]            # only the MAIN term lists word variants ("Deficiency, deficient")
    core = ftoks(' > '.join(segs))
    full = core | ftoks(p)
    if pl and core <= pl <= full: return 3, set()
    if pl and core and core < pl and (pl - core) <= {'chronic', 'acute'}: return 2.5, pl - core   # only course words may be dropped
    if pl and pl <= core: return 2, core - pl
    return (1, set()) if toks(p) & qtoks else (0, set())


_CODE_PAREN = re.compile(r'\s*\((?:[A-Z][0-9][0-9A-Z]?(?:\.[0-9A-Z-]{0,4})?(?:-[A-Z]?[0-9][0-9A-Z]?(?:\.[0-9A-Z-]{0,4})?)?[,;\s]*)+\)')
_CODE_BARE = re.compile(r'\b[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z-]{1,4})?-?\b')


def clean(text):
    """Remove every ICD code or code range from text we send: '(A00-A09)', '(F50.9)', 'E16-E31', 'E34.-'. The model
    must decide from words; codes are the engine's business."""
    t = _CODE_PAREN.sub('', text)
    t = _CODE_BARE.sub('', t)
    return re.sub(r'\s{2,}', ' ', t).replace(' ,', ',').replace(' ;', ';').strip(' ,;')


def toks(s):
    return {w for w in re.findall(r"[a-z0-9']+", (s or '').lower()) if w not in STOP and len(w) > 2}


def subtree_codes(n):
    out = [n['name']]
    for c in n['children']: out += subtree_codes(c)
    return out


def index_terms(n, qtoks, cap=6, ptoks=None, pl=frozenset()):
    if PURE: return []
    paths = [p for code in subtree_codes(n) for p in _IDX.get(code, [])]
    return ranked_terms(paths, qtoks, ptoks, cap, pl)


def leaves(n):
    return [n] if not n['children'] else [l for c in n['children'] for l in leaves(c)]


def preview(n, cap=14):
    """Names of the entries beneath n: every direct child first, then grandchildren until the cap."""
    out = [c['desc'] for c in n['children']]
    extra = [g['desc'] for c in n['children'] for g in c['children']]
    room = max(cap - len(out), 0)
    out += extra[:room]
    hidden = len(extra) - room
    if hidden > 0: out.append(f'and {hidden} more specific entries')
    return out


def option_text(n, qtoks, show_preview, ptoks=None, pl=frozenset()):
    parts = [n['desc']]
    inc = (n.get('includes') or []) + (n.get('inclusion') or [])
    if inc: parts.append('Includes: ' + '; '.join(inc[:6]))
    if show_preview and n['children']: parts.append('Contains: ' + '; '.join(preview(n)))
    it = index_terms(n, qtoks, ptoks=ptoks, pl=pl)
    if it: parts.append('Index terms leading here: ' + ' | '.join(it))
    if n.get('ex1'): parts.append('Not: ' + '; '.join(n['ex1'][:4]))
    return clean(' '.join(parts))   # Includes / Not are the tabular's own definitional text for the entry, not examples


# --------------------------------------------------------------------------- instructions
HOW_READ = ('Read the `diagnosis` facts first. Use the `statements` only to confirm a detail the provider wrote about this '
            'diagnosis; a detail counts only when it is written for this diagnosis, not inferred from elsewhere in the chart.')

HOW_LEAF = (HOW_READ + ' '
            'Choose the entry worded "unspecified" when nothing beyond the condition itself is documented. Choose an entry '
            'worded "other specified" only when the provider names a type, site or cause that has no entry of its own. A word '
            'describing course or degree is not a type unless an option or its Index term contains that word. An entry naming '
            'a cause needs that cause written for this diagnosis. When more than one distinct site is named, the entry worded '
            '"multiple sites" is correct. The condition named first in the phrase is the one being coded; a cause or '
            'association that follows it modifies it and does not move the code to the cause\'s own entry. A personal-history '
            'entry must name the same organ or site as the documented history. In ICD-10-CM the hip belongs to the thigh region.')

HOW = HOW_LEAF   # within-category questions


CHAPTER_DEFS = {
    'A00-B99': 'Infectious and parasitic diseases that are classified by the causative organism or are generalized, rather than by the single organ they affect.',
    'C00-D49': 'Neoplasms of every behaviour: malignant, in situ, benign, and of uncertain or unknown behaviour.',
    'D50-D89': 'Disorders of the blood and its cells, of clotting, of the blood-forming organs and spleen, and of the immune mechanism.',
    'E00-E89': 'Disorders of the endocrine glands, nutritional deficiency or excess, and disorders of metabolism.',
    'F01-F99': 'Mental, behavioural and neurodevelopmental disorders that the provider names as a disorder.',
    'G00-G99': 'Diseases of the brain, spinal cord and peripheral nerves, and pain that is classified as a condition in its own right.',
    'H00-H59': 'Diseases of the eye and its adnexa.',
    'H60-H95': 'Diseases of the ear and mastoid process.',
    'I00-I99': 'Diseases of the heart and blood vessels.',
    'J00-J99': 'Diseases of the airways and lungs, including infections localized to them.',
    'K00-K95': 'Diseases of the digestive tract, liver, biliary tract, pancreas and abdominal wall, when the condition is classified as a disease of these organs rather than as a symptom.',
    'L00-L99': 'Diseases of the skin and subcutaneous tissue.',
    'M00-M99': 'Diseases of bones, joints, muscles and connective tissue, when the condition is classified as a disorder of these structures rather than as a symptom.',
    'N00-N99': 'Diseases of the kidneys, urinary tract and genital organs.',
    'O00-O9A': 'Conditions that arise from, or complicate, pregnancy, childbirth or the puerperium.',
    'P00-P96': 'Conditions that originate in the perinatal period.',
    'Q00-QA0': 'Structural anomalies, deformations and chromosomal abnormalities present from birth.',
    'R00-R99': 'Symptoms, signs and abnormal clinical or laboratory findings that have not been attributed to a diagnosis.',
    'S00-T88': 'The injury, poisoning or other consequence of an external cause itself.',
    'V00-Y99': 'How an injury or poisoning happened: the external cause, never the injury itself.',
    'Z00-Z99': 'Reasons for contact with health services that are not a current disease: screening, counselling, personal or family history, a status the patient carries, a risk factor, or an administrative or follow-up encounter.',
    'U00-U85': 'Codes reserved for special purposes and newly identified diseases.',
}


def q_kind():
    ctx = ('This question decides what kind of entry the `diagnosis` is before it is placed in a chapter. ' + HOW_READ + ' '
           'Use phrase_nature when present: symptom_or_sign points to a symptom or finding, historical_or_status_post and '
           'encounter_status point to a reason for contact with health services, active_condition points to a condition.')
    opts = {
        'condition': 'A disease, disorder, injury or other condition that has been named by the provider as the diagnosis itself.',
        'symptom_or_finding': 'A symptom, sign, or abnormal clinical or laboratory finding that the provider has not attributed to a named condition.',
        'encounter_reason': 'A reason for contact with health services that is not a current condition: screening, counselling, a personal or family history, a status the patient carries, a risk factor, or an administrative or follow-up encounter.',
        'cannot_decide': CD}
    mp = {'condition': 'condition', 'symptom_or_finding': 'symptom', 'encounter_reason': 'factor'}
    return dict(key='kind', context=ctx, statement='What kind of entry is `diagnosis`?', options=opts, map=mp)


def q_chapter(qtoks=frozenset(), ptoks=frozenset(), pl=frozenset(), exclude=()):
    ctx = ('This question decides which chapter of ICD-10-CM the `diagnosis` belongs to. A chapter groups conditions by '
           'body system or by kind of condition. ' + HOW_READ + ' Apply these rules in order. '
           'First: the provider\'s framing in phrase_nature decides. historical_or_status_post means a past or resolved '
           'condition and belongs in the chapter for factors influencing health status, unless the statements show it is '
           'treated or monitored at this visit. encounter_status means a reason for the encounter and belongs in that same '
           'chapter. symptom_or_sign means the symptoms-and-findings chapter. active_condition means the chapter of the body '
           'system or kind of disease. '
           'Second: a symptom or abnormal finding stays in the symptoms-and-findings chapter even when it concerns one organ, '
           'unless ICD-10-CM classifies that symptom as a condition of a body system or the provider names the disease that '
           'causes it. '
           'Third: an inherited predisposition to a disease the patient does not have is a health-status entry, not a '
           'congenital malformation.')
    opts, mp = {}, {}
    for i, ch in enumerate(T.chapters, 1):
        if ch['range'] in exclude: continue
        k = f'opt_{i}'; mp[k] = ch['range']
        d = CHAPTER_DEFS.get(ch['range'], ch['desc'])
        it = ranked_terms(_IDX_CH.get(ch['idx'], []), qtoks, ptoks, pl=pl, min_tier=2)
        if it: d += ' Index terms leading here: ' + ' | '.join(it)
        opts[k] = clean(d)
    opts['cannot_decide'] = CD
    return dict(key='chapter', context=ctx, statement='Which chapter does `diagnosis` belong to?', options=opts, map=mp)


def q_sections(ch, qtoks, ptoks=frozenset(), pl=frozenset()):
    ctx = (f'The `diagnosis` has been placed in the chapter "{clean(ch["desc"])}". This question picks the block of categories '
           'beneath it that matches what is documented. Each option names a block and lists the categories it contains; '
           'judge a block by the category that would hold this diagnosis. ' + HOW_READ +
           ' If no block contains a category that fits, choose cannot_decide.')
    opts, mp = {}, {}
    for i, s in enumerate(ch['sections'], 1):
        k = f'opt_{i}'; mp[k] = s['id']
        cats = [clean(c['desc']) for c in s['cats']]
        d = clean(s['desc']) + '. Contains: ' + '; '.join(cats[:30]) + (f'; and {len(cats) - 30} more' if len(cats) > 30 else '')
        it = ranked_terms(_IDX_SEC.get(s['id'], []), qtoks, ptoks, pl=pl, min_tier=2)
        if it: d += ' Index terms leading here: ' + ' | '.join(it)
        opts[k] = clean(d)
    opts['cannot_decide'] = 'No block here contains a category that fits the diagnosis as documented.'
    return dict(key='block', context=ctx, statement='Which block best describes `diagnosis` as documented?', options=opts, map=mp)


def q_nodes(key, nodes, parent_desc, qtoks, flat, ptoks=None, pl=frozenset()):
    what = 'code entry' if flat else 'entry'
    ctx = (f'The `diagnosis` has been placed under "{parent_desc}". This question picks the {what} beneath it that '
           f'matches what is documented. ' + ('Each option is one final code. ' if flat else
           'Each option is a group; its Contains line shows the entries inside it, so judge a group by what it contains. ') + HOW)
    opts, mp = {}, {}
    for i, n in enumerate(nodes, 1):
        k = f'opt_{i}'; mp[k] = n['name']; opts[k] = option_text(n, qtoks, show_preview=not flat, ptoks=ptoks, pl=pl)
    opts['cannot_decide'] = CD
    return dict(key=key, context=ctx, statement=f'Which {what} best describes `diagnosis` as documented?', options=opts, map=mp)


def q_seventh(seven, desc):
    ctx = (f'The code for "{desc}" needs a seventh character describing the episode of care or the stage of the '
           'condition at this visit. Initial encounter means the patient is receiving active treatment for the condition; '
           'subsequent encounter means routine care during healing or recovery after active treatment; sequela means a '
           'late effect of a condition that has itself ended. Judge from what the provider does at this visit, not from '
           'whether the patient was seen before. ' + HOW)
    opts, mp = {}, {}
    for i, (ch, d) in enumerate(seven.items(), 1):
        k = f'opt_{i}'; mp[k] = ch; opts[k] = d
    opts['cannot_decide'] = CD
    return dict(key='seventh', context=ctx, statement='Which seventh character applies to `diagnosis` at this visit?', options=opts, map=mp)


def to_api(q):
    return {q['key']: {'type': 'choice', 'instructions': {'context': q['context'], 'statement': q['statement'], 'read': READ}, 'criteria': q['options']}}


# --------------------------------------------------------------------------- Jev
def call(state, questions, key, retries=5):
    body = json.dumps({'model': MODEL, 'state': state, 'questions': questions}).encode()
    req = urllib.request.Request(API, data=body, method='POST', headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e:
            txt = e.read().decode(errors='replace')
            if e.code in (429, 500, 502, 503, 529) and i < retries - 1: time.sleep(3 * (i + 1)); continue
            raise RuntimeError(f'HTTP {e.code}: {txt[:500]}')
        except (urllib.error.URLError, TimeoutError, OSError):
            if i < retries - 1: time.sleep(3 * (i + 1)); continue
            raise
    raise RuntimeError('gave up')


def ask(state, q, key, dry):
    if dry: return {'choice': None, '_dry': True}, 0
    out = call(state, to_api(q), key)
    return out['answers'][q['key']], (out.get('usage') or {}).get('input_tokens', 0)


def residual_child(nodes):
    u = [n for n in nodes if 'unspecified' in n['desc'].lower()]
    if len(u) == 1: return u[0]
    o = [n for n in nodes if n['desc'].lower().startswith('other') or 'other specified' in n['desc'].lower() or 'not elsewhere classified' in n['desc'].lower()]
    return o[0] if len(o) == 1 else None


# --------------------------------------------------------------------------- walk
def walk(u, start, key, dry, flat, stop_after=None, backtrack=False, pre_kind=False):
    st = u['state']; path = []; tok = 0; esc = []
    ptoks = toks(u['phrase']); pl = ftoks(re.sub(r'\([^)]*\)', ' ', u['phrase']))
    qtoks = ptoks | toks(json.dumps(st['statements'])) | toks(st['diagnosis'].get('anatomical_location', ''))
    node = None

    def step(level, q, node_name=None):
        nonlocal tok
        a, t = ask(st, q, key, dry); tok += t
        ch = a.get('choice'); a = dict(a, raw_choice=ch)
        ex = [] if PURE else ([k for k, v in q['options'].items() if '(exact)' in v] or [k for k, v in q['options'].items() if '(exact after dropping' in v])
        if ch == 'cannot_decide' and not PURE:
            if len(ex) == 1: ch = ex[0]; esc.append(f'{level}:cannot_decide->exact_index'); a = dict(a, choice=ch, fallback='exact_index')
            else:
                cov = [k for k, v in q['options'].items() if 'only if the documentation also states' in v]
                if len(cov) == 1: ch = cov[0]; esc.append(f'{level}:cannot_decide->covering_index'); a = dict(a, choice=ch, fallback='covering_index')
        elif not PURE and level in ('chapter', 'block', 'category') and len(ex) == 1 and ch != ex[0]:
            # the alphabetic index names this phrase under exactly one option: code by the index, verify in the tabular
            esc.append(f'{level}:{ch}->exact_index_override'); ch = ex[0]; a = dict(a, choice=ch, fallback='exact_index_override')
        path.append(dict(level=level, node=node_name, q=q if dry else None, choice=ch, resolved=q['map'].get(ch), answer=a))
        return ch, q

    if start == 'chapter':
        excluded = set()
        if pre_kind:
            kch, kq = step('kind', q_kind())
            kind = kq['map'].get(kch)
            if kind == 'symptom': excluded = {c['range'] for c in T.chapters if c['range'] not in ('R00-R99',)}
            elif kind == 'factor': excluded = {c['range'] for c in T.chapters if c['range'] not in ('Z00-Z99',)}
            elif kind == 'condition': excluded = {'R00-R99', 'Z00-Z99'}
        for attempt in range(3):
            if len(T.chapters) - len(excluded) == 1:
                only = next(c for c in T.chapters if c['range'] not in excluded)
                path.append(dict(level='chapter', node=None, q=None, choice='by_kind', resolved=only['range'], answer={'choice': 'by_kind', 'raw_choice': 'by_kind'}))
                ch, q = 'by_kind', dict(map={'by_kind': only['range']})
            else:
                ch, q = step('chapter', q_chapter(ptoks, ptoks, pl, exclude=excluded))
            if ch not in q['map']: return dict(path=path, code=None, escalate=['chapter:' + str(ch)], tokens=tok)
            chapter = next(c for c in T.chapters if c['range'] == q['map'][ch])
            if stop_after == 'chapter': return dict(path=path, code=None, escalate=esc, tokens=tok)
            ch, q = step('block', q_sections(chapter, ptoks, ptoks, pl))
            if backtrack and path[-1]['answer'].get('raw_choice') == 'cannot_decide' and attempt < 2:
                excluded.add(chapter['range']); path[-1]['backtracked'] = True; esc.append(f'block:cannot_decide->backtrack_from_{chapter["range"]}')
                continue
            break
        if ch not in q['map']: return dict(path=path, code=None, escalate=esc + ['block:' + str(ch)], tokens=tok)
        sec = next(s for s in chapter['sections'] if s['id'] == q['map'][ch])
        if stop_after == 'block': return dict(path=path, code=None, escalate=esc, tokens=tok)
        ch, q = step('category', q_nodes('category', sec['cats'], sec['desc'], qtoks, flat=False, ptoks=ptoks, pl=pl))
        if ch not in q['map']: return dict(path=path, code=None, escalate=['category:' + str(ch)], tokens=tok)
        node = T.node[q['map'][ch]]
        if stop_after == 'category': return dict(path=path, code=None, escalate=[], tokens=tok)
    else:
        cat = (u['engine_code'] or '')[:3]
        node = T.node.get(cat)
        if node is None: return dict(path=path, code=None, escalate=['no_category:' + str(cat)], tokens=tok)

    depth = 0
    while node['children']:
        depth += 1
        lv = leaves(node)
        if len(lv) <= flat:
            ch, q = step('flat', q_nodes('flat', lv, node['desc'], qtoks, flat=True, ptoks=ptoks, pl=pl), node['name'])
            if ch in q['map']: node = T.node[q['map'][ch]]
            else:
                un = residual_child(lv)
                if un is None: return dict(path=path, code=None, escalate=[f'flat:{ch}'], tokens=tok)
                esc.append(f'flat:cannot_decide->{un["name"]}'); node = un
            break
        ch, q = step(f'sub{depth}', q_nodes(f'sub{depth}', node['children'], node['desc'], qtoks, flat=False, ptoks=ptoks, pl=pl), node['name'])
        if ch in q['map']: node = T.node[q['map'][ch]]
        else:
            un = residual_child(node['children'])
            if un is None: return dict(path=path, code=None, escalate=[f'sub{depth}:{ch}'], tokens=tok)
            esc.append(f'sub{depth}:cannot_decide->{un["name"]}'); node = un
        if dry and depth > 6: break
    seventh = None
    if node.get('seven'):
        ch, q = step('seventh', q_seventh(node['seven'], node['desc']))
        if ch not in q['map']: return dict(path=path, code=None, escalate=['seventh:' + str(ch)], tokens=tok)
        seventh = q['map'][ch]
    return dict(path=path, code=T.leaf_code(node['name'], seventh), escalate=esc, tokens=tok)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='start', choices=['category', 'chapter'], default='category')
    ap.add_argument('--runs', type=int, default=1); ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--flat', type=int, default=20, help='ask over the leaves directly when a subtree has at most this many')
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--ids', help='json list of uids to (re)run')
    ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--out')
    ap.add_argument('--stop-after', choices=['chapter', 'block', 'category'], help='ask only up to this level')
    ap.add_argument('--with-index', action='store_true', help='re-enable the index-term matcher (off by default: pure Jev)')
    ap.add_argument('--pre-kind', action='store_true', help='ask condition / symptom / encounter-reason first and narrow the chapter options')
    ap.add_argument('--backtrack', action='store_true', help='cannot_decide at the block level re-asks the chapter without the rejected chapter')
    a = ap.parse_args()
    global PURE; PURE = not a.with_index
    key = os.environ.get('TYPESAFE_API_KEY')
    if not key and not a.dry_run: sys.exit('TYPESAFE_API_KEY not set')
    units = json.load(open(os.path.join(HERE, 'inputs', 'icd100_units.json')))
    if a.ids: want = set(json.load(open(a.ids))); units = [u for u in units if u['uid'] in want]
    if a.limit: units = units[:a.limit]
    out = a.out or os.path.join(HERE, 'results', f'walk_{a.start}.json')
    if a.dry_run:
        for u in units:
            r = walk(u, a.start, key, True, a.flat, a.stop_after, a.backtrack, a.pre_kind)
            print('\n' + '=' * 100 + f"\n{u['uid']}  phrase={u['phrase']!r}  engine={u['engine_code']}  coder_kept={u['coder_kept']}")
            print('STATE:', json.dumps(u['state'], ensure_ascii=False)[:700])
            for p in r['path']:
                q = p['q']; print(f"\n-- level {p['level']}  ({len(q['options']) - 1} options)\n   CONTEXT: {q['context'][:300]}...\n   STATEMENT: {q['statement']}")
                for k, v in list(q['options'].items())[:14]: print(f"     {k:<14} {q['map'].get(k, '')!s:<9} {v[:260]}")
                if len(q['options']) > 14: print(f'     ... {len(q["options"]) - 14} more')
            print('   (dry run follows the first option at each level)')
        return
    jobs = [(i, r) for i in range(len(units)) for r in range(1, a.runs + 1)]
    res = collections.defaultdict(list); t0 = time.time(); done = [0]

    def work(j):
        i, r = j
        try: w = walk(units[i], a.start, key, False, a.flat, a.stop_after, a.backtrack, a.pre_kind); w['run'] = r; w['error'] = None
        except Exception as e: w = dict(run=r, path=[], code=None, escalate=['error'], tokens=0, error=str(e)[:300])
        done[0] += 1
        if done[0] % 100 == 0: print(f'  {done[0]}/{len(jobs)} ({time.time() - t0:.0f}s)', flush=True)
        return i, w
    with ThreadPoolExecutor(a.workers) as ex:
        for i, w in ex.map(work, jobs): res[i].append(w)
    for i, u in enumerate(units): u['runs'] = sorted(res[i], key=lambda x: x['run'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({'start': a.start, 'runs': a.runs, 'flat': a.flat, 'units': units}, open(out, 'w'), indent=1, ensure_ascii=False)
    tok = sum(w['tokens'] for u in units for w in u['runs'])
    print(f'saved {out}; {len(units)} units x {a.runs} runs; input tokens {tok:,} (~${tok / 1e6 * 0.042:.3f}); {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
