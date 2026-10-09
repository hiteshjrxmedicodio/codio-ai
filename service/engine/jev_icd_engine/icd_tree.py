"""ICD-10-CM FY2026 tabular as a walkable tree (from icd_tabular_2026.json, parsed off the CMS XML).

Levels: chapter -> section (block) -> category (3-char) -> subcategory nodes ... -> leaf (+ optional 7th char).
Every node carries the official description plus its own includes / inclusion terms / excludes, which is
what the Jev option definitions are built from. No KB table has these intermediate nodes (t_kb_icd_codes
holds billable leaves only), hence the CMS source.
"""
from __future__ import annotations
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))


class Tree:
    def __init__(self, path=os.path.join(HERE, 'inputs', 'icd_tabular_2026.json')):
        self.chapters = json.load(open(path))
        self.node = {}          # code -> diag node dict (augmented with parent / chapter / section / seven)
        self.cat_of_section = {}  # section id -> list of category codes
        for ci, ch in enumerate(self.chapters):
            ch['idx'] = ci
            ch['range'] = re.search(r'\(([A-Z0-9]+-[A-Z0-9]+)\)', ch['desc'] or '')
            ch['range'] = ch['range'].group(1) if ch['range'] else ch['name']
            for sec in ch['sections']:
                sec['chapter'] = ci
                for cat in sec['cats']:
                    self._index(cat, None, ci, sec['id'], None)

    def _index(self, d, parent, ci, sec_id, seven):
        seven = d['seven_def'] or seven
        d['parent'] = parent; d['chapter'] = ci; d['section'] = sec_id; d['seven'] = seven
        self.node[d['name']] = d
        for c in d['children']:
            self._index(c, d['name'], ci, sec_id, seven)

    # ----- lookups
    def chapter_of_code(self, code):
        n = self.node.get(code) or self.node.get(code[:3])
        return self.chapters[n['chapter']] if n else None

    def section_of_code(self, code):
        n = self.node.get(code) or self.node.get(code[:3])
        if not n: return None
        return next(s for s in self.chapters[n['chapter']]['sections'] if s['id'] == n['section'])

    def leaf_code(self, node_name, seventh=None):
        """Billable code string for a leaf node, padding with X when a 7th character applies."""
        if seventh is None:
            return node_name
        base = node_name.replace('.', '')
        base = base.ljust(6, 'X')
        return base[:3] + '.' + base[3:] + seventh

    def resolve(self, code):
        """Node for a billable code, stripping a 7th character when the leaf is a 6-char node with X padding."""
        if code in self.node: return self.node[code]
        for cut in (code[:-1], code[:-1].rstrip('X'), code.replace('X', '')[:-1]):
            c = cut.rstrip('.')
            if c in self.node: return self.node[c]
        return None

    @staticmethod
    def definition(n, with_excludes=True):
        """Option definition text for a node: official description, then its own includes / inclusion
        terms (ICD's definitional synonyms), then excludes1 as 'not' statements."""
        parts = [n['desc']]
        inc = (n.get('includes') or []) + (n.get('inclusion') or [])
        if inc: parts.append('Includes: ' + '; '.join(inc[:8]))
        if with_excludes and n.get('ex1'): parts.append('Not: ' + '; '.join(n['ex1'][:6]))
        return ' '.join(parts)
