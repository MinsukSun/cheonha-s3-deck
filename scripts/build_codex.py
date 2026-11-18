#!/usr/bin/env python3
"""무장·전법·진형 도감 데이터(data/codex.json, data/codex.js)를 만듭니다.

입력 (모두 한 폴더에 둡니다, 기본: 첫 번째 인자):
  sc.json        삼천 데이터 정보 페이지에서 뽑은 표 묶음 (S1 무장표·전법표)
  heroes.json    삼천 데이터의 S2·S3 무장 객체 (능력치 5렙·성장률·50렙, 고유 전법)
  mix-s1.txt     믹스커피 게임 데이터 화면에서 읽은 S1 무장 50렙 능력치/성장률
  mix-gap.json   삼천 데이터에 능력치가 없는 S3 무장·연의 무장 (믹스커피 화면)
  mix-rates.json 믹스커피 전법 선택 목록의 '이름 (유형 발동률)'
그 밖에 저장소의 data/sim-data.js, data/tactic-types.js, data/tactic-desc.js를 읽습니다.

사용: python3 -I scripts/build_codex.py <입력 폴더>
"""
import json, re, sys, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
key = lambda s: re.sub(r'\s+', '', str(s or '')).lower()
STATS = ['통솔', '무력', '지력', '선공']
SC_STAT = {'leadership': '통솔', 'power': '무력', 'intelligence': '지력', 'speed': '선공'}
MAX_SEASON = 3


def js_value(path, name):
    s = open(os.path.join(ROOT, 'data', path), encoding='utf-8').read()
    s = re.sub(r'^\s*//.*$', '', s, flags=re.M)
    s = re.sub(r'(?<=[\],])\s*//[^\n]*', '', s)  # 줄 끝 주석
    m = re.search(r'window\.' + name + r'\s*=\s*', s)
    i = m.end(); depth = 0; instr = False; esc = False
    for j in range(i, len(s)):
        c = s[j]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': instr = False
        elif c == '"': instr = True
        elif c in '[{': depth += 1
        elif c in ']}':
            depth -= 1
            if depth == 0:
                return json.loads(re.sub(r',\s*([\]}])', r'\1', s[i:j + 1]))


def rd(n):
    return json.load(open(os.path.join(SRC, n), encoding='utf-8'))


def num(v):
    try: return float(str(v).replace('%', ''))
    except Exception: return None


def pct(v):
    m = re.findall(r'(\d+)%', str(v or ''))
    return int(m[-1]) if m else None  # '55%→100%'는 10레벨 기준(마지막 값)


attrs = {a[0]: a for a in js_value('sim-data.js', 'GENERAL_ATTRS')}
sc = rd('sc.json')
s1 = {r['values'].get('열 5'): r['values'] for r in sc[1]['records']}
s23 = rd('heroes.json')
mix_s1 = {}
for n, t in json.loads(open(os.path.join(SRC, 'mix-s1.txt'), encoding='utf-8').read()).items():
    d = {}
    for tok in t.split():
        ab, rest = tok[0], tok[1:]
        v, g = rest.split('/')
        d[{'통': '통솔', '무': '무력', '지': '지력', '선': '선공'}[ab]] = (float(v), float(g))
    mix_s1[n] = d
gap = rd('mix-gap.json')


def parse_gap_stats(t):
    d = {}
    for tok in t.split():
        ab, rest = tok[0], tok[1:]
        v, g = rest.split('/')
        d[{'통': '통솔', '무': '무력', '지': '지력', '선': '선공'}[ab]] = {'lv50': float(v), 'growth': float(g)}
    return d


ttypes = {key(x[0]): x for x in js_value('tactic-types.js', 'TACTIC_TYPES')}
yeon_unique = {  # 믹스커피 표기: 한자음 이름 (한국 이름)
    '연의 공손찬': ('위진새외·연의', '백마의종'), '연의 원소': ('군웅 집결·공격', '업성의 진지'),
    '연의 감녕': ('수상 약탈', None), '연의 장료': ('바람 방랑자', '유유자적'),
    '연의 조인': ('철벽 수비', None), '연의 관우': ('칠군수몰·연의', None),
}

gens = []
names = list(attrs) + [n for n in gap if n not in attrs]
for n in names:
    a = attrs.get(n, [n, None, None, None])
    g = {'name': n, 'key': key(n), 'season': None, 'fac': a[1], 'troop': a[2] if a[2] not in (None, '—') else None,
         'pos': a[3] if a[3] not in (None, '—') else None, 'role': None, 'stats': None, 'unique': None, 'src': [], 'notes': []}
    if n.startswith('연의 '):
        g['base'] = n[3:]
    if n in s1:
        v = s1[n]
        g.update(season=1, pos=v.get('무장 / 진형') or g['pos'], role=v.get('무장 / 성향'), troop=v.get('무장 / 병종') or g['troop'])
        g['unique'] = {'name': v.get('열 10'), 'type': v.get('전법 / 유형'), 'trait': v.get('전법 / 특성'),
                       'rate': pct(v.get('발동 / 확률')), 'desc': v.get('전법 설명 (1렙→10렙)')}
        # 삼천 S1 표의 50렙 값은 S2·S3·믹스커피 기준보다 약 5% 높아(유비 통솔 215 vs 205) 다른 시즌과 맞추려고
        # 능력치는 믹스커피 값을 쓰고, 삼천 값은 sc50으로 남깁니다.
        st = {}
        for s in STATS:
            mv = (mix_s1.get(n) or {}).get(s)
            st[s] = {'lv50': mv[0] if mv else num(v.get(f'{s} / (50렙)')), 'growth': mv[1] if mv else None, 'sc50': num(v.get(f'{s} / (50렙)'))}
        g['stats'] = st
        g['src'].append('삼천 데이터 S1 무장표')
        if n in mix_s1: g['src'].append('능력치: 믹스커피 게임 데이터')
    sk = s23.get('제갈량(S3)') if n == 'SP 제갈량' else s23.get(n)
    if sk:
        g['season'] = sk.get('firstSeason')
        g['fac'] = sk.get('country') or g['fac']
        g['pos'] = sk.get('position') or g['pos']
        g['role'] = sk.get('role') or g['role']
        g['troop'] = sk.get('troopType') or g['troop']
        u = sk.get('signatureSkill') or {}
        g['unique'] = {'name': u.get('name'), 'type': u.get('type'), 'trait': u.get('trait'), 'rate': pct(u.get('activationRate')), 'desc': u.get('description')}
        if sk.get('stats'):
            st = sk['stats']
            if 'level' in st:  # S3 형식: {level: 5, power: {value, growth}} → 50렙 = 값 + 성장 × 45
                lv = st['level']
                g['stats'] = {SC_STAT[k]: {'lv5': v['value'], 'growth': v['growth'], 'lv50': round(v['value'] + v['growth'] * (50 - lv), 2)} for k, v in st.items() if k in SC_STAT}
            else:
                g['stats'] = {SC_STAT[k]: {'lv5': v.get('level5'), 'growth': v.get('growth'), 'lv50': v.get('level50')} for k, v in st.items() if k in SC_STAT}
        g['src'].append('삼천 데이터 S2·S3 무장')
    if n in gap:
        m = gap[n]
        if m.get('st') and not g['stats']:
            g['stats'] = parse_gap_stats(m['st']); g['src'].append('능력치: 믹스커피 게임 데이터')
        if m.get('troop') and not g['troop']: g['troop'] = m['troop']
        if m.get('troop') and g['troop'] and m['troop'] != g['troop']:
            g['notes'].append(f"기본 병종이 자료마다 다름: 삼천 {g['troop']} · 믹스커피 {m['troop']}")
        if not g['fac']: g['fac'] = m.get('fac')
        if not g['unique'] or not g['unique'].get('name'):
            nm, alt = yeon_unique.get(n, (m['u'][0], None))
            g['unique'] = {'name': nm, 'alt': alt, 'type': m['u'][1], 'trait': None, 'rate': pct(m['u'][2]), 'desc': None}
            g['src'].append('고유 전법: 믹스커피 게임 데이터')
        if g.get('base'):
            g['season'] = 3
    if g.get('base'):
        b = next((x for x in gens if x['name'] == g['base']), None)
        if b:
            g['stats'] = g['stats'] or b['stats']
            if not g['pos'] and b['pos']:
                g['pos'] = b['pos']; g['notes'].append('위치는 기본 무장 기준')
            g['role'] = g['role'] or b['role']
        g['notes'].append('능력치는 기본 무장과 같음(믹스커피 기준)')
    if (g['season'] or 0) > MAX_SEASON: continue
    if not g['pos']: g['notes'].append('선호 위치(전열/후열) 미확인')
    if g['notes'] == []: del g['notes']
    gens.append(g)

# 전법: 기존 유형표 + 설명 + 효과 태그 + 발동률(믹스커피 목록) + 삼천 원문 이름
desc = js_value('tactic-desc.js', 'TACTIC_DESC')
tags = {key(t): v for t, v in js_value('sim-data.js', 'TACTIC_TAGS')}
rates = {}
for s in rd('mix-rates.json'):
    m = re.match(r'^(.*) \((지휘|액티브|패시브|추격) (\d+)%\)$', s)
    if m and not m.group(1).startswith('경·'): rates[key(m.group(1))] = int(m.group(3))
orig = {}
for r in sc[3]['records']:
    v = r['values']
    orig[key(v.get('열 5'))] = (v.get('전법 이름 원문') or '').replace('\\n', ' ')
    if key(v.get('열 5')) not in rates and pct(v.get('발동 / 확률')): rates[key(v.get('열 5'))] = pct(v.get('발동 / 확률'))
tacs = []
for k, (n, tp, tr, se) in ttypes.items():
    tacs.append({'name': n, 'key': k, 'type': tp, 'trait': tr, 'season': se, 'rate': rates.get(k), 'desc': desc.get(n) or desc.get(k),
                 'tags': (tags.get(k) or '').split() or None, 'orig': orig.get(k) or None})

# 진형: 삼천 데이터 진형표 (S1 공식 + S2 미리보기). 피격률은 [전열…, 후열…] 순서의 자리별 값
forms = [
    {'name': '일자진', 'hit': [33, 34, 33], 'front': 3, 'fx': ['전열이 받는 피해 8% 감소']},
    {'name': '기형진', 'hit': [60, 20, 20], 'front': 1, 'fx': ['전열이 받는 피해 6% 감소', '후열이 주는 피해 12% 증가']},
    {'name': '안형진', 'hit': [40, 40, 20], 'front': 2, 'fx': ['전열 통솔 20포인트 증가', '후열이 주는 피해 15% 증가']},
    {'name': '방원진', 'hit': [40, 40, 20], 'front': 2, 'fx': ['전열이 받는 피해 5% 감소', '후열의 연타 확률 40% 증가']},
    {'name': '추형진', 'hit': [60, 20, 20], 'front': 1, 'fx': ['전열이 주는 피해 16% 증가', '후열이 받는 피해 5% 감소']},
    {'name': '어린진', 'hit': [60, 20, 20], 'front': 1, 'fx': ['전열 피신 12% 증가', '후열 회심·묘책 확률 8% 증가']},
    {'name': '구행진', 'hit': [60, 20, 20], 'front': 1, 'fx': ['전열이 받는 피해 8% 감소', '후열의 연타 확률 25% 증가'], 'season': 2},
    {'name': '언월진', 'hit': [40, 40, 20], 'front': 2, 'fx': ['전열이 주는 피해 14% 증가', '후열이 받는 피해 5% 감소'], 'season': 2},
]

out = {
    'app': 'tk3-codex', 'version': 1, 'season': 'W1 (한국 S3 업주산하)', 'built': datetime.date.today().isoformat(),
    'sources': {
        '삼천 데이터': 'https://three-kingdoms-data-browser.vercel.app/info/',
        '믹스커피 게임 데이터': 'https://sam.mixcoffee.org/data',
    },
    'fields': {
        'general.stats': '통솔·무력·지력·선공: lv50 = 50레벨 기본값(배분 포인트 제외), growth = 레벨당 성장, lv5 = 5레벨 값(있을 때)',
        'general.pos': '선호 위치 전열/균형/후열', 'general.role': '성향(병기·책략·방어·보조·치유 등)',
        'tactic.rate': '발동률(%), 10레벨 기준', 'tactic.tags': '효과 태그(대체 추천용)',
        'formation.hit': '자리별 피격률(%), 앞 front개가 전열',
    },
    'generals': gens, 'tactics': tacs, 'formations': forms,
}
json.dump(out, open(os.path.join(ROOT, 'data', 'codex.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
with open(os.path.join(ROOT, 'data', 'codex.js'), 'w', encoding='utf-8') as f:
    f.write('// 무장·전법·진형 도감 (scripts/build_codex.py가 data/codex.json에서 만듦 — 직접 고치지 마세요)\n')
    f.write('window.CODEX = ' + json.dumps(out, ensure_ascii=False) + ';\n')
print('generals', len(gens), 'tactics', len(tacs), 'with rate', sum(1 for t in tacs if t['rate'] is not None))
print('no stats', [g['name'] for g in gens if not g['stats']])
print('no unique', [g['name'] for g in gens if not g['unique']])
print('no pos', [g['name'] for g in gens if not g['pos']])
print('no rate', [t['name'] for t in tacs if t['rate'] is None])
