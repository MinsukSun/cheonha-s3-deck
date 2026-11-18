// 조합 분석 (무장 3명 + 학습 전법 2개씩 + 진형) — 브라우저(window.TK3Combo)와 Node(require) 양쪽에서 씁니다.
// 입력 자료는 도감(data/codex.json)입니다. 점수는 자료의 특성·태그·능력치로 매긴 '참고 점수'이고, 실제 전투 결과를 계산한 것은 아닙니다.
(function (root) {
  'use strict';
  const key = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  const STATS = ['통솔', '무력', '지력', '선공'];

  // 전법 설명 → 효과 태그 (app.js의 대체 추천과 같은 규칙)
  const TAG_RULES = [['병기피해', /병기(와 책략)? 피해|병기 피해/], ['책략피해', /책략(과 병기)? 피해|책략 피해/], ['회복', /회복|치유/], ['피해감소', /받는[\s\S]{0,24}피해[\s\S]{0,16}감소|방어 ?1스택|1스택의 방어/],
    ['피해증가', /주는[\s\S]{0,10}피해가[\s\S]{0,12}증가|피해 계수가[\s\S]{0,8}증가/], ['적약화', /적군[\s\S]{0,30}(주는[\s\S]{0,12}피해|무력|지력|통솔|선공)[\s\S]{0,20}감소|탈취/], ['제어', /혼란|침묵|무장 해제|공포|제어 상태/],
    ['상태부여', /화공|홍수|군량 고갈|폭풍|요술|허약|위협/], ['전체', /전체 적군|적군 전체|전체 아군/], ['2명', /2명|2~3명/], ['단일', /단일 목표/], ['조롱', /조롱/], ['반격', /반격/], ['연타', /연타/],
    ['회심묘책', /회심|묘책/], ['선공', /선공/], ['준비', /준비 후/], ['초반', /전투 시작|첫 3턴|3턴 동안|4턴 동안/], ['액티브강화', /액티브 전법 발동률|액티브 전법 피해/], ['일반공격', /일반 공격 후|일반 공격 성공/], ['해제', /디버프 상태[\s\S]{0,6}제거/],
    ['능력상승', /(무력|지력|통솔|선공)[\s\S]{0,12}증가/]];
  const tagsOf = text => TAG_RULES.filter(([, re]) => re.test(text || '')).map(([n]) => n);

  // 역할: 이 중 하나라도 있으면 그 역할을 맡는 전법으로 봅니다.
  const ROLES = [
    { id: 'dmg', label: '피해', tags: ['병기피해', '책략피해'], w: 10 },
    { id: 'sustain', label: '생존(회복·피해 감소)', tags: ['회복', '피해감소'], w: 10 },
    { id: 'control', label: '방해(제어·약화)', tags: ['제어', '적약화', '조롱'], w: 5 },
    { id: 'support', label: '보조(해제·강화)', tags: ['해제', '능력상승', '피해증가', '아군보조', '액티브강화'], w: 5 },
  ];
  // 특성별로 효과에 영향을 주는 능력치
  const TRAIT_STAT = { 병기: ['무력'], 책략: ['지력'], 문무: ['무력', '지력'], 방어: ['통솔'], 치유: ['지력'] };
  const lv50 = (g, s) => (g && g.stats && g.stats[s] && g.stats[s].lv50) || 0;
  const traitsOf = tr => String(tr || '').split(/[·\/,\s]+/).filter(Boolean);
  // 0~1: 175 이하면 낮음, 250 이상이면 충분
  const fitVal = v => Math.max(0, Math.min(1, (v - 100) / 150));
  function statFit(g, trait) {
    const ss = traitsOf(trait).flatMap(t => TRAIT_STAT[t] || []);
    if (!ss.length || !g || !g.stats) return null;
    const v = ss.reduce((a, s) => a + lv50(g, s), 0) / ss.length;
    return { stat: [...new Set(ss)].join('·'), value: Math.round(v), fit: fitVal(v) };
  }
  const person = n => String(n || '').replace(/^연의\s*/, '');

  function index(codex) {
    if (codex.__idx) return codex.__idx;
    const G = new Map(), T = new Map();
    codex.generals.forEach(g => { G.set(g.key || key(g.name), g); G.set(key(g.name), g); });
    codex.tactics.forEach(t => { T.set(t.key || key(t.name), t); T.set(key(t.name), t); if (!t.tags) t.tags = tagsOf(t.desc); });
    codex.generals.forEach(g => { if (g.unique && !g.unique.tags) g.unique.tags = tagsOf(g.unique.desc); });
    const F = new Map(codex.formations.map(f => [f.name, f]));
    Object.defineProperty(codex, '__idx', { value: { G, T, F }, enumerable: false });
    return codex.__idx;
  }
  const findForm = (codex, txt) => { if (!txt) return null; const { F } = index(codex); return F.get(txt) || [...F.values()].find(f => String(txt).includes(f.name)) || null; };

  // 기대 발동 횟수(8턴 기준, 대략): 지휘·패시브 = 항상, 액티브 = 발동률 × 8 (준비형은 절반), 추격 = 발동률 × 일반 공격 8회
  function expectCasts(t) {
    if (!t || t.rate == null) return null;
    if (t.type === '지휘' || t.type === '패시브') return null;
    const base = (t.rate / 100) * 8;
    return Math.round(base * ((t.tags || []).includes('준비') ? 0.5 : 1) * 10) / 10;
  }

  // 전열/후열 자동 배치: 진형의 전열 자리 수(front)만큼, 선호 위치가 맞는 무장을 전열로 보냅니다(동점이면 앞 순서 우선).
  function assignPos(team, codex) {
    const { G } = index(codex);
    const form = findForm(codex, team.form); const front = form ? form.front : 1;
    const n = Math.min(3, (team.slots || []).length || 3);
    const pf = (i, pos) => { const g = G.get(key((team.slots[i] || {}).g)); if (!g) return 0.5; return !g.pos ? 0.5 : g.pos === '균형' || g.pos === pos ? 1 : 0; };
    let best = null;
    const combos = n === 3 ? (front === 1 ? [[0], [1], [2]] : front === 2 ? [[0, 1], [0, 2], [1, 2]] : [[0, 1, 2]]) : [[0]];
    combos.forEach((fr, ci) => {
      const sc = [0, 1, 2].reduce((a, i) => a + pf(i, fr.includes(i) ? '전열' : '후열'), 0) - ci * 0.001;
      if (!best || sc > best.sc) best = { sc, fr };
    });
    return [0, 1, 2].map(i => (best.fr.includes(i) ? '전열' : '후열'));
  }

  // team: { '추형진', slots: [{ g: '장료', t: ['요새 함락', '연전연승'] }, …] }  (이름이나 key)
  function analyze(team, codex) {
    const { G, T } = index(codex);
    const form = findForm(codex, team.form);
    const front = form ? form.front : 1;
    const posOf = assignPos(team, codex);
    const slots = (team.slots || []).slice(0, 3).map((s, i) => {
      const g = G.get(key(s.g)) || null;
      const pos = posOf[i];
      const pref = g ? g.pos || null : null;
      const posFit = !g ? null : !pref ? 0.5 : pref === '균형' || pref === pos ? 1 : 0;
      const unique = g && g.unique ? { ...g.unique, unique: true, fit: statFit(g, g.unique.trait), casts: expectCasts(g.unique) } : null;
      const tactics = (s.t || []).map(n => { const t = n ? T.get(key(n)) : null; return t ? { ...t, fit: statFit(g, t.trait), casts: expectCasts(t) } : (n ? { name: n, unknown: true } : null); });
      return { i, g, name: g ? g.name : s.g || '', pos, pref, posFit, unique, tactics };
    });
    const all = slots.flatMap(s => [s.unique, ...s.tactics].filter(Boolean).map(t => ({ ...t, slot: s.i, owner: s.name })));
    const issues = [];
    // 같은 인물·같은 전법
    const seenP = {}; slots.forEach(s => { if (!s.g) return; const p = person(s.g.name); if (seenP[p] != null) issues.push({ lv: 'bad', msg: `${s.g.name}와 ${slots[seenP[p]].g.name}는 같은 인물이라 한 부대에 함께 넣을 수 없습니다.` }); else seenP[p] = s.i; });
    const seenT = {}; slots.forEach(s => s.tactics.forEach(t => { if (!t || t.unknown) return; if (seenT[t.name]) issues.push({ lv: 'bad', msg: `${t.name}을(를) 두 번 넣었습니다. 한 부대에는 같은 전법을 하나만 쓸 수 있습니다.` }); seenT[t.name] = 1; }));
    slots.forEach(s => { if (s.g && !s.tactics.filter(Boolean).length) issues.push({ lv: 'info', msg: `${s.name}: 학습 전법이 비어 있습니다.` }); });
    // 위치
    slots.forEach(s => { if (s.posFit === 0) issues.push({ lv: 'warn', msg: `${s.name}은(는) ${s.pref} 무장인데 ${s.pos}에 서야 합니다(진형 ${form ? form.name : '미선택'}의 전열 ${front}자리).` }); });
    // 능력치 궁합
    all.forEach(t => { if (t.fit && t.fit.fit < 0.45 && !t.unique) issues.push({ lv: 'warn', msg: `${t.owner}의 ${t.fit.stat} ${t.fit.value}로는 ${t.name}(${t.trait}) 효과가 약합니다.` }); });
    // 역할
    const roles = ROLES.map(r => { const by = all.filter(t => (t.tags || []).some(x => r.tags.includes(x))); return { ...r, by: by.map(t => `${t.name}${t.unique ? '(고유)' : ''}`), ok: by.length > 0 }; });
    roles.filter(r => !r.ok && (r.id === 'dmg' || r.id === 'sustain')).forEach(r => issues.push({ lv: 'warn', msg: `${r.label} 역할을 하는 전법이 없습니다.` }));
    // 피해 성향
    const wpn = all.filter(t => (t.tags || []).includes('병기피해')).length, stg = all.filter(t => (t.tags || []).includes('책략피해')).length;
    const lean = wpn + stg ? (wpn >= stg * 2 ? '병기' : stg >= wpn * 2 ? '책략' : '혼합') : '없음';
    // 점수 (참고용)
    const dmgT = all.filter(t => t.fit && traitsOf(t.trait).some(x => x === '병기' || x === '책략' || x === '문무'));
    const pStat = dmgT.length ? dmgT.reduce((a, t) => a + t.fit.fit, 0) / dmgT.length : 0.5;
    const pRole = roles.reduce((a, r) => a + (r.ok ? r.w : 0), 0) / 30;
    const pos = slots.filter(s => s.g); const pPos = pos.length ? pos.reduce((a, s) => a + s.posFit, 0) / pos.length : 0;
    const bad = issues.filter(x => x.lv === 'bad').length, warn = issues.filter(x => x.lv === 'warn').length;
    const pClean = Math.max(0, 1 - bad * 0.5 - warn * 0.15);
    const parts = [
      { label: '능력치 궁합', w: 40, v: pStat, note: '피해 전법의 특성(병기·책략·문무)과 그 무장의 무력·지력' },
      { label: '역할 분담', w: 30, v: pRole, note: '피해 · 생존 · 방해 · 보조 전법이 있는지' },
      { label: '위치', w: 15, v: pPos, note: '무장의 선호 위치(전열/균형/후열)와 진형 자리' },
      { label: '문제 없음', w: 15, v: pClean, note: '중복·위치·능력치 경고가 적을수록 높음' },
    ];
    const total = Math.round(parts.reduce((a, p) => a + p.w * p.v, 0));
    const fac = {}, troop = {}; slots.forEach(s => { if (s.g) { fac[s.g.fac] = (fac[s.g.fac] || 0) + 1; troop[s.g.troop] = (troop[s.g.troop] || 0) + 1; } });
    return { form, front, slots, roles, issues, lean, wpn, stg, fac, troop, score: { total, parts } };
  }

  const jacc = (a, b) => { a = new Set(a || []); b = new Set(b || []); if (!a.size || !b.size) return 0; let n = 0; a.forEach(x => b.has(x) && n++); return n / (a.size + b.size - n); };

  // 대체 전법 후보: 같은 유형·특성, 비슷한 효과 태그, 그 무장의 능력치에 맞는 것
  function altTactics(team, si, ti, codex, o = {}) {
    const { G, T } = index(codex);
    const s = team.slots[si] || {}; const g = G.get(key(s.g)); const cur = T.get(key((s.t || [])[ti]));
    const used = new Set(team.slots.flatMap(x => (x.t || []).map(key)));
    const out = [];
    for (const t of codex.tactics) {
      const k = t.key || key(t.name); if (used.has(k)) continue;
      if (o.owned && !o.owned(k)) continue;
      const f = statFit(g, t.trait);
      let sc = 0; const why = [];
      if (cur) {
        const j = jacc(cur.tags, t.tags); sc += 0.45 * j; if (j >= 0.4) why.push('효과 비슷');
        if (cur.type === t.type) { sc += 0.2; why.push(`같은 ${t.type}`); }
        if (cur.trait && cur.trait === t.trait) { sc += 0.15; why.push(`같은 ${t.trait}`); }
      } else sc += 0.3 * ((t.tags || []).length ? 1 : 0);
      if (f) { sc += 0.2 * f.fit; if (f.fit >= 0.75) why.push(`${f.stat} ${f.value}`); } else sc += 0.1;
      out.push({ name: t.name, key: k, type: t.type, trait: t.trait, rate: t.rate, score: Math.round(sc * 100), why });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, o.n || 6);
  }

  // 대체 무장 후보: 능력치 모양, 병종, 그 자리의 위치, 고유 전법 유형·특성이 비슷한 무장
  function altGenerals(team, si, codex, o = {}) {
    const { G } = index(codex);
    const s = team.slots[si] || {}; const cur = G.get(key(s.g));
    const pos = assignPos(team, codex)[si];
    const others = new Set(team.slots.filter((x, i) => i !== si && x.g).map(x => person((G.get(key(x.g)) || {}).name || x.g)));
    const vec = g => STATS.map(st => lv50(g, st));
    const cos = (a, b) => { const d = a.reduce((x, v, i) => x + v * b[i], 0), na = Math.hypot(...a), nb = Math.hypot(...b); return na && nb ? d / na / nb : 0; };
    const out = [];
    for (const g of codex.generals) {
      if (cur && person(g.name) === person(cur.name)) continue;
      if (others.has(person(g.name))) continue;
      if (o.owned && !o.owned(g.key)) continue;
      let sc = 0; const why = [];
      if (cur) {
        const c = cos(vec(cur), vec(g)); const cs = Math.max(0, (c - 0.85) / 0.15); sc += 0.35 * cs; if (cs > 0.7) why.push('능력치 비슷');
        if (g.troop && g.troop === cur.troop) { sc += 0.15; why.push(g.troop); }
        if (g.unique && cur.unique && g.unique.type === cur.unique.type) { sc += 0.15; why.push(`고유 ${g.unique.type}`); }
        if (g.unique && cur.unique && g.unique.trait && g.unique.trait === cur.unique.trait) { sc += 0.15; why.push(`고유 ${g.unique.trait}`); }
      }
      const pf = !g.pos ? 0.5 : g.pos === '균형' || g.pos === pos ? 1 : 0; sc += 0.2 * pf; if (pf === 1) why.push(`${pos} 가능`);
      out.push({ name: g.name, key: g.key, pos: g.pos, troop: g.troop, score: Math.round(sc * 100), why });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, o.n || 6);
  }

  const api = { assignPos, key, tagsOf, TAG_RULES, ROLES, statFit, analyze, altTactics, altGenerals, findForm, expectCasts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TK3Combo = api;
})(typeof window !== 'undefined' ? window : globalThis);
