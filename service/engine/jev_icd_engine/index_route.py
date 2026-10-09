"""Alphabetic-index route: Jev looks the diagnosis up in the ICD-10-CM index the way a coder does.

1. Main terms whose title appears in the phrase ("Bleeding", "Pain", "Hematochezia") are the only lookup done in
   code: a whole-word match of the main-term title against the phrase. No stop lists, no tiers.
2. Jev picks the main term that is the condition (one question, when more than one matches).
3. Jev follows the sub-terms level by level ("anal", "rectum", ...) until an entry with a code; a "see" entry
   jumps to the target main term, a "see also" target is offered as one more option at that level.
4. The code reached is a candidate for the final comparison alongside the tree walk's entry.

The index tree is parsed once from the CMS XML into inputs/icd_index_tree.json.
"""
from __future__ import annotations
import json, os, re
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
XML = os.path.join(HERE, 'inputs', 'icd10cm_index_2026.xml')   # only needed if inputs/icd_index_tree.json is deleted
CACHE = os.path.join(HERE, 'inputs', 'icd_index_tree.json')


def _t(e):
    return ' '.join(''.join(e.itertext()).split()) if e is not None else ''


def _term(el):
    return dict(title=_t(el.find('title')), code=_t(el.find('code')).rstrip('-'), see=_t(el.find('see')), see_also=_t(el.find('seeAlso')),
                children=[_term(c) for c in el.findall('term')])


def load():
    if os.path.exists(CACHE): return json.load(open(CACHE))
    root = ET.parse(XML).getroot()
    mains = [_term(m) for letter in root.findall('letter') for m in letter.findall('mainTerm')]
    json.dump(mains, open(CACHE, 'w')); return mains


MAINS = load()


def first_form(title):
    """'Pain(s)' -> 'pain'; 'Petechia, petechiae' -> ['petechia', 'petechiae']; 'Diarrhea, diarrheal(disease)' -> ['diarrhea','diarrheal']"""
    t = re.sub(r'\([^)]*\)', '', title).lower()
    forms = [x.strip() for x in t.split(',') if x.strip()]
    # only true spelling variants of the first form count ("Petechia, petechiae"); "Acroasphyxia, chronic" does not make 'chronic' a term
    return [forms[0]] + [f for f in forms[1:] if f[:3] == forms[0][:3]] if forms else []


BY_FORM = {}
for m in MAINS:
    for f in first_form(m['title']): BY_FORM.setdefault(f, m)


def find_main(title):
    for f in first_form(title):
        if f in BY_FORM: return BY_FORM[f]
    return None


def matching_mains(phrase):
    """Main terms whose title form occurs as a whole word (or phrase) in the diagnosis phrase."""
    p = ' ' + re.sub(r'[^a-z0-9 ]', ' ', phrase.lower()) + ' '
    out = []
    for form, m in BY_FORM.items():
        if len(form) < 4: continue
        if f' {form} ' in p or f' {form}s ' in p or (form.endswith('a') and f' {form}e ' in p):
            if m not in out: out.append(m)
    return out


def option_text(t, T):
    d = t['title']
    if t['code']:
        n = T.resolve(t['code']) or T.node.get(t['code'][:3])
        if n: d += ' — ' + n['desc']
    if t['see']: d += f' — see {t["see"]}'
    if t['see_also']: d += f' — see also {t["see_also"]}'
    if t['children'] and not t['code']: d += f' (has {len(t["children"])} more specific sub-terms)'
    return d
