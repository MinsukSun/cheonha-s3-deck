// 간이 모의전투 엔진 — 브라우저(window.TK3Sim)와 명령줄(jsc: scripts/sim_cli.js) 양쪽에서 씁니다.
//
// 무엇을 하나:
//   도감(data/codex.json)의 능력치·발동률과 전법 설명 문장에서 뽑은 수치(피해·치유 계수, 피해 감소/증가, 능력치 증가, 제어)로
//   3 대 3 전투를 8턴 동안 돌립니다. 여러 번 돌려 승·무·패 비율과 무장별 피해·치유를 냅니다.
// 한계 (중요):
//   게임의 실제 피해 공식, 병종 상성, 병법·장비·인연, 상태 이상의 세부 규칙은 공개 자료가 없어 넣지 않았거나 단순하게 추정했습니다.
//   설명 문장에서 수치를 못 뽑은 효과는 빠집니다(결과의 'parsed'에 전법별로 무엇을 반영했는지 나옵니다).
//   그래서 절대 승률보다 '같은 조건에서 A안과 B안 중 무엇이 나은가'를 비교하는 데 쓰세요.
(function (root) {
  'use strict';
  const key = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  const STATS = ['통솔', '무력', '지력', '선공'];
  const TURNS = 8;
  // 피해·치유 크기: 10000병력·무력 270(배분 포함) 대 통솔 200의 일반 공격이 약 780. 티어 덱끼리 붙였을 때 평균 6~7턴, 무승부 약 40%가 되도록 맞춘 값
  // (실제 게임 수치가 아닙니다. 옵션 kDmg·kHeal로 바꿔 볼 수 있습니다)
  const K_DMG = 2.4, K_HEAL = 1.5;

  // ── 난수 (시드 고정 가능) ──
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  // ── 전법 설명 → 효과 목록 ──
  const NUM = '(\\d+(?:\\.\\d+)?)';
  const lv10 = (a, b) => parseFloat(b != null ? b : a);
  function targetsOf(c, side) {
    if (/자신(?!이)|자기/.test(c) && !/아군|적군/.test(c)) return { side: 'self', n: 1 };
    const enemy = side === 'enemy' || (/적군|적 /.test(c) && !/아군/.test(c.split(/적군/)[0] || ''));
    const s = enemy ? 'enemy' : /아군/.test(c) ? 'ally' : 'self';
    const n = /전체|모든/.test(c) ? 3 : /2~3명/.test(c) ? 2.5 : /2명/.test(c) ? 2 : 1;
    return { side: s, n };
  }
  function timingOf(c, type) {
    let m;
    if ((m = c.match(/(\d)번째 턴/))) return { when: 'turn', from: +m[1], to: +m[1] };
    if ((m = c.match(/(?:전투 시작|처음|첫)\s*(?:후|시)?\s*(\d)턴/))) return { when: 'start', from: 1, to: +m[1] };
    if (/행동 (?:종료|후)|행동할 때/.test(c)) return { when: 'act' };
    if (/일반 공격 후|일반 공격을 한 후/.test(c)) return { when: 'attack' };
    if (/매 턴|턴 시작 시|턴 종료 시|매턴/.test(c)) return { when: 'turn', from: 1, to: TURNS };
    if (/전투 시작/.test(c)) return { when: 'start', from: 1, to: TURNS };
    return null;
  }
  // 한 전법 → { kind, effects[], prep, parsed[] }
  function parseTactic(t) {
    const desc = String(t.desc || '');
    const type = t.type || '패시브';
    const out = { name: t.name, type, rate: t.rate != null ? t.rate / 100 : (type === '지휘' || type === '패시브' ? 1 : 0.4), prep: /준비/.test(desc), effects: [], parsed: [] };
    const clauses = desc.split(/(?<=다)\.\s*|(?<=며),\s*|(?<=고),\s*|(?<=하며)\s|(?<=후),\s*|(?<=\)),\s*/).map(x => x.trim()).filter(Boolean);
    let lastTiming = null, lastTarget = null;
    for (const c of clauses) {
      const tm = timingOf(c, type) || lastTiming; if (timingOf(c, type)) lastTiming = tm;
      const dur = (c.match(/(\d)턴 동안/) || [])[1];
      const prob = (c.match(new RegExp(NUM + '%(?:→' + NUM + '%)? 확률')) || []);
      const p = prob.length ? lv10(prob[1], prob[2]) / 100 : 1;
      let m;
      // 피해
      const re = new RegExp(NUM + '%(?:→' + NUM + '%)?의 (병기|책략)(와 책략|과 병기)? 피해', 'g');
      while ((m = re.exec(c))) {
        const tg = targetsOf(c, 'enemy'); lastTarget = tg;
        const dt = m[4] ? 'mix' : m[3] === '병기' ? 'wpn' : 'stg';
        out.effects.push({ k: 'dmg', v: lv10(m[1], m[2]) / 100, dt, tg: tg.side === 'self' ? { side: 'enemy', n: 1 } : { ...tg, side: tg.side === 'ally' ? 'enemy' : tg.side }, tm, p });
        out.parsed.push(`${dt === 'wpn' ? '병기' : dt === 'stg' ? '책략' : '병기·책략'} 피해 ${lv10(m[1], m[2])}%×${tg.n}명`);
      }
      // 치유
      if ((m = c.match(new RegExp('치유율 ' + NUM + '%(?:→' + NUM + '%)?')))) {
        const tg = targetsOf(c, 'ally'); const t2 = tg.side === 'enemy' ? { side: 'ally', n: tg.n } : tg;
        out.effects.push({ k: 'heal', v: lv10(m[1], m[2]) / 100, tg: t2, tm, p });
        out.parsed.push(`치유 ${lv10(m[1], m[2])}%×${t2.n}명`);
      }
      // 받는 피해 감소 / 적이 주는 피해 감소
      if ((m = c.match(new RegExp('받는[^.]{0,30}?피해[^.]{0,8}?' + NUM + '%(?:→' + NUM + '%)? 감소')))) {
        const tg = targetsOf(c, 'ally'); const t2 = tg.side === 'enemy' ? { side: 'ally', n: tg.n } : tg;
        out.effects.push({ k: 'reduce', v: lv10(m[1], m[2]) / 100, tg: t2, tm, dur: dur ? +dur : null, p });
        out.parsed.push(`받는 피해 -${lv10(m[1], m[2])}%`);
      } else if ((m = c.match(new RegExp('적군[^.]{0,30}주는[^.]{0,12}피해[^.]{0,8}?' + NUM + '%(?:→' + NUM + '%)? 감소')))) {
        out.effects.push({ k: 'weaken', v: lv10(m[1], m[2]) / 100, tg: targetsOf(c, 'enemy'), tm, dur: dur ? +dur : null, p });
        out.parsed.push(`적 주는 피해 -${lv10(m[1], m[2])}%`);
      }
      // 주는 피해 증가
      if ((m = c.match(new RegExp('주는[^.]{0,20}?피해[^.]{0,8}?' + NUM + '%(?:→' + NUM + '%)? 증가'))) && !/받는/.test(c.slice(0, m.index))) {
        const tg = targetsOf(c, 'ally'); const t2 = tg.side === 'enemy' ? { side: 'self', n: 1 } : tg;
        out.effects.push({ k: 'amp', v: lv10(m[1], m[2]) / 100, tg: t2, tm, dur: dur ? +dur : null, p });
        out.parsed.push(`주는 피해 +${lv10(m[1], m[2])}%`);
      }
      // 능력치 증가 (중첩 포함)
      const sre = new RegExp('(무력|지력|통솔|선공)(?:과 (무력|지력|통솔|선공))?이? ' + NUM + '(?:→' + NUM + ')?포인트 증가', 'g');
      while ((m = sre.exec(c))) {
        const stack = (c.match(/최대 (\d+)회 중첩/) || [])[1];
        const onHit = /피해를 준 후|피해를 줄 때/.test(c);
        const tg = targetsOf(c, 'ally'); const t2 = tg.side === 'enemy' ? { side: 'self', n: 1 } : tg;
        [m[1], m[2]].filter(Boolean).forEach(st => out.effects.push({ k: 'stat', st, v: lv10(m[3], m[4]), tg: t2, tm: onHit ? { when: 'hit', dt: /책략 피해를 준/.test(c) ? 'stg' : /병기 피해를 준/.test(c) ? 'wpn' : null } : tm, stack: stack ? +stack : 1, dur: dur ? +dur : null, p }));
        out.parsed.push(`${m[1]}${m[2] ? '·' + m[2] : ''} +${lv10(m[3], m[4])}${stack ? `(최대 ${stack}중첩)` : ''}`);
      }
      // 적 능력치 감소
      const dre = new RegExp('(무력|지력|통솔|선공)이? ' + NUM + '(?:→' + NUM + ')?포인트 감소', 'g');
      while ((m = dre.exec(c))) { out.effects.push({ k: 'stat', st: m[1], v: -lv10(m[2], m[3]), tg: targetsOf(c, 'enemy'), tm, dur: dur ? +dur : 2, stack: 1, p }); out.parsed.push(`적 ${m[1]} -${lv10(m[2], m[3])}`); }
      // 회심·묘책·연타 확률
      if ((m = c.match(new RegExp('(회심|묘책|연타)(?: 확률)?(?:이|가)? ' + NUM + '%(?:→' + NUM + '%)? 증가')))) {
        const tg = targetsOf(c, 'ally'); const t2 = tg.side === 'enemy' ? { side: 'self', n: 1 } : tg;
        out.effects.push({ k: m[1] === '연타' ? 'double' : 'crit', v: lv10(m[2], m[3]) / 100, tg: t2, tm, dur: dur ? +dur : null, p });
        out.parsed.push(`${m[1]} +${lv10(m[2], m[3])}%`);
      }
      // 제어
      if ((m = c.match(/(혼란|침묵|무장 해제|공포|기절|위협)/)) && /적군|적 /.test(c)) {
        const tg = targetsOf(c, 'enemy');
        out.effects.push({ k: 'ctrl', c: m[1], tg: { ...tg, side: 'enemy' }, tm, dur: dur ? +dur : 1, p });
        out.parsed.push(`${m[1]} ${dur || 1}턴`);
      }
    }
    // 시점이 없는 효과: 지휘·패시브는 전투 시작(전 턴 유지), 액티브는 발동 시, 추격은 일반 공격 후
    out.effects.forEach(e => { if (!e.tm) e.tm = type === '액티브' ? { when: 'cast' } : type === '추격' ? { when: 'attack' } : e.k === 'dmg' || e.k === 'heal' ? { when: 'turn', from: 1, to: TURNS } : { when: 'start', from: 1, to: TURNS }; });
    if (type === '액티브') out.effects.forEach(e => { if (e.tm.when !== 'hit') e.tm = { when: 'cast', inner: e.tm }; });
    if (type === '추격') out.effects.forEach(e => { if (e.tm.when !== 'hit') e.tm = { when: 'attack' }; });
    return out;
  }

  // ── 진형 효과 ──
  function formFx(form) {
    const fx = { front: {}, back: {} };
    (form ? form.fx : []).forEach(s => {
      const side = /^전열/.test(s) ? 'front' : 'back'; let m;
      if ((m = s.match(/받는 피해 (\d+)% 감소/))) fx[side].reduce = +m[1] / 100;
      if ((m = s.match(/주는 피해 (\d+)% 증가/))) fx[side].amp = +m[1] / 100;
      if ((m = s.match(/통솔 (\d+)포인트 증가/))) fx[side].통솔 = +m[1];
      if ((m = s.match(/연타 확률 (\d+)% 증가/))) fx[side].double = +m[1] / 100;
      if ((m = s.match(/피신 (\d+)% 증가/))) fx[side].dodge = +m[1] / 100;
      if ((m = s.match(/회심·묘책 확률 (\d+)% 증가/))) fx[side].crit = +m[1] / 100;
    });
    return fx;
  }

  // ── 부대 만들기 ──
  // team: { form, slots: [{ g, t: [..] }] }, o: { troops, points: 'auto'|'none' }
  function buildSide(team, codex, o, sideName, parseCache) {
    const C = root.TK3Combo;
    const G = new Map(codex.generals.map(g => [key(g.name), g])), T = new Map(codex.tactics.map(t => [key(t.name), t]));
    const form = codex.formations.find(f => f.name === team.form || (team.form && String(team.form).includes(f.name))) || null;
    const pos = C && C.assignPos ? C.assignPos(team, codex) : [0, 1, 2].map(i => (i === 0 ? '전열' : '후열'));
    const ffx = formFx(form);
    const hit = form ? form.hit : [60, 20, 20];
    const units = [];
    let fi = 0, bi = 0;
    (team.slots || []).slice(0, 3).forEach((s, i) => {
      const g = G.get(key(s.g)); if (!g) return;
      const st = {}; STATS.forEach(x => (st[x] = ((g.stats || {})[x] || {}).lv50 || 100));
      if (o.points !== 'none') { const main = st['무력'] >= st['지력'] ? '무력' : '지력'; st[main] += 50; }
      const p = pos[i]; const f = p === '전열' ? ffx.front : ffx.back;
      if (f.통솔) st['통솔'] += f.통솔;
      const tacs = [];
      const add = (t, unique) => { if (!t) return; const pk = (unique ? 'u:' : '') + t.name; const pt = parseCache[pk] || (parseCache[pk] = parseTactic(t)); tacs.push({ ...pt, unique }); };
      if (g.unique) add({ ...g.unique, desc: g.unique.desc || '' }, true);
      (s.t || []).forEach(n => n && add(T.get(key(n)), false));
      // 자리별 피격률: 전열 자리부터 앞쪽 값을 씁니다
      const w = p === '전열' ? hit[fi++] : hit[(form ? form.front : 1) + bi++];
      units.push({ side: sideName, name: g.name, troop: g.troop, pos: p, base: { ...st }, st, hp: o.troops, max: o.troops, wounded: 0, hitW: w || 20,
        tacs, fx: { reduce: f.reduce || 0, amp: f.amp || 0, crit: f.crit || 0, double: f.double || 0, dodge: f.dodge || 0 },
        buffs: [], ctrl: {}, prepared: {}, stacks: {}, dealt: 0, healed: 0, taken: 0, casts: {} });
    });
    return { units, form };
  }

  // ── 전투 1회 ──
  function battle(A, B, R, log) {
    const all = () => [...A.units, ...B.units];
    const alive = u => u.hp > 0;
    const foes = u => (u.side === 'A' ? B : A).units.filter(alive);
    const mates = u => (u.side === 'A' ? A : B).units.filter(alive);
    const L = log ? (...a) => log.push(a.map(x => (x && x.side ? (x.side === 'A' ? '아군 ' : '적군 ') + x.name : x)).join('')) : () => {};
    const sum = (u, k) => (u.fx[k] || 0) + u.buffs.filter(b => b.k === k).reduce((a, b) => a + b.v, 0);
    const stat = (u, s) => Math.max(1, u.st[s] + u.buffs.filter(b => b.k === 'stat' && b.st === s).reduce((a, b) => a + b.v, 0) + Object.entries(u.stacks).filter(([k]) => k.endsWith('|' + s)).reduce((a, [, v]) => a + v.v * v.n, 0));
    const pickWeighted = (list, n) => {
      const out = []; let pool = list.slice(); const cnt = n === 2.5 ? (R() < 0.5 ? 2 : 3) : Math.round(n);
      for (let i = 0; i < cnt && pool.length; i++) { const tot = pool.reduce((a, x) => a + x.hitW, 0); let r = R() * tot; let j = 0; for (; j < pool.length - 1; j++) { r -= pool[j].hitW; if (r <= 0) break; } out.push(pool[j]); pool.splice(j, 1); }
      return out;
    };
    const targets = (u, tg) => tg.side === 'self' ? [u] : tg.side === 'enemy' ? pickWeighted(foes(u), tg.n) : (tg.n >= 3 ? mates(u) : mates(u).sort((x, y) => x.hp / x.max - y.hp / y.max).slice(0, Math.max(1, Math.round(tg.n))));
    const troopF = u => Math.sqrt(Math.max(0, u.hp) / 10000);
    function onHit(u, dt) { u.tacs.forEach(t => t.effects.forEach(e => { if (e.k === 'stat' && e.tm.when === 'hit' && (!e.tm.dt || e.tm.dt === dt)) { const k = t.name + '|' + e.st; const s = u.stacks[k] || (u.stacks[k] = { v: e.v, n: 0 }); if (s.n < (e.stack || 1)) s.n++; } })); }
    function damage(u, v, dt, tgt, src) {
      if (!alive(tgt)) return;
      if (R() < sum(tgt, 'dodge')) { L('  ', tgt, ' 피신'); return; }
      const d = dt === 'mix' ? (R() < 0.5 ? 'wpn' : 'stg') : dt;
      const atk = d === 'wpn' ? stat(u, '무력') : stat(u, '지력');
      const def = d === 'wpn' ? stat(tgt, '통솔') : (stat(tgt, '지력') + stat(tgt, '통솔')) / 2;
      let x = (B.kDmg || K_DMG) * v * troopF(u) * Math.max(40, atk - 0.5 * def + 150);
      x *= Math.max(0.1, 1 + sum(u, 'amp') - sum(u, 'weaken'));
      x *= Math.max(0.1, 1 - Math.min(0.8, sum(tgt, 'reduce')));
      if (R() < sum(u, 'crit')) x *= 1.5;
      x *= 0.95 + R() * 0.1;
      x = Math.round(Math.min(x, tgt.hp));
      tgt.hp -= x; tgt.taken += x; tgt.wounded += Math.round(x * 0.9); u.dealt += x;
      L('  ', u, ' → ', tgt, ' ', src, ' ', x, tgt.hp <= 0 ? ' (퇴각)' : ` (남은 ${tgt.hp})`);
      onHit(u, d);
    }
    function heal(u, v, tgt, src) {
      if (!alive(tgt)) return;
      let x = (B.kHeal || K_HEAL) * v * troopF(u) * (stat(u, '지력') + 150);
      x = Math.round(Math.min(x, tgt.wounded, tgt.max - tgt.hp)); if (x <= 0) return;
      tgt.hp += x; tgt.wounded -= x; u.healed += x;
      L('  ', u, ' → ', tgt, ' ', src, ' 회복 ', x);
    }
    function apply(u, t, e, turn) {
      if (R() > e.p) return;
      const ts = targets(u, e.tg);
      if (e.k === 'dmg') ts.forEach(x => damage(u, e.v, e.dt, x, t.name));
      else if (e.k === 'heal') ts.forEach(x => heal(u, e.v, x, t.name));
      else if (e.k === 'ctrl') ts.forEach(x => { x.ctrl[e.c] = Math.max(x.ctrl[e.c] || 0, e.dur); L('  ', x, ' ', e.c, ' ', e.dur, '턴 (', t.name, ')'); });
      else {
        const until = e.dur ? turn + e.dur - 1 : e.tm.to || (e.tm.inner && e.tm.inner.to) || TURNS;
        ts.forEach(x => x.buffs.push({ k: e.k === 'weaken' ? 'weaken' : e.k, st: e.st, v: e.v, until, src: t.name }));
      }
    }
    const fire = (u, t, when, turn) => t.effects.forEach(e => {
      if (e.tm.when !== when) return;
      if ((when === 'turn' || when === 'start') && (turn < (e.tm.from || 1) || turn > (e.tm.to || TURNS))) return;
      apply(u, t, e, turn);
    });
    // 전투 시작: 지휘·패시브의 시작 효과
    all().sort((x, y) => stat(y, '선공') - stat(x, '선공')).forEach(u => u.tacs.forEach(t => t.effects.forEach(e => { if (e.tm.when === 'start' && (e.tm.from || 1) === 1) apply(u, t, e, 1); })));
    for (let turn = 1; turn <= TURNS; turn++) {
      L(`[${turn}턴]`);
      all().forEach(u => (u.buffs = u.buffs.filter(b => b.until >= turn)));
      const order = all().filter(alive).sort((x, y) => stat(y, '선공') - stat(x, '선공') || R() - 0.5);
      // 턴 시작/매 턴 효과
      order.forEach(u => alive(u) && u.tacs.forEach(t => { if (t.type === '지휘' || t.type === '패시브') { fire(u, t, 'turn', turn); if (turn > 1) t.effects.forEach(e => { if (e.tm.when === 'start' && e.tm.from === turn) apply(u, t, e, turn); }); } }));
      for (const u of order) {
        if (!alive(u)) continue;
        if (!foes(u).length) break;
        const stun = u.ctrl['기절'] || u.ctrl['공포'];
        if (stun) { L('  ', u, ' 행동 불가'); continue; }
        // 액티브
        if (!u.ctrl['침묵']) u.tacs.filter(t => t.type === '액티브').forEach(t => {
          if (u.prepared[t.name]) { delete u.prepared[t.name]; u.casts[t.name] = (u.casts[t.name] || 0) + 1; L('  ', u, ' [', t.name, '] 준비 완료'); fire(u, t, 'cast', turn); return; }
          if (R() < t.rate) { if (t.prep) { u.prepared[t.name] = 1; L('  ', u, ' [', t.name, '] 준비'); } else { u.casts[t.name] = (u.casts[t.name] || 0) + 1; L('  ', u, ' [', t.name, ']'); fire(u, t, 'cast', turn); } }
        });
        // 일반 공격 (+연타) → 추격
        if (!u.ctrl['무장 해제']) {
          const n = 1 + (R() < sum(u, 'double') ? 1 : 0);
          for (let k = 0; k < n; k++) {
            const tg = u.ctrl['혼란'] && R() < 0.5 ? pickWeighted(mates(u).filter(x => x !== u), 1)[0] || pickWeighted(foes(u), 1)[0] : pickWeighted(foes(u), 1)[0];
            if (!tg) break;
            damage(u, 1, 'wpn', tg, k ? '연타' : '일반 공격');
            u.tacs.forEach(t => { if (t.type === '추격') { if (R() < t.rate) { u.casts[t.name] = (u.casts[t.name] || 0) + 1; fire(u, t, 'attack', turn); } } else fire(u, t, 'attack', turn); });
          }
        }
        u.tacs.forEach(t => fire(u, t, 'act', turn));
      }
      all().forEach(u => Object.keys(u.ctrl).forEach(c => { if (--u.ctrl[c] <= 0) delete u.ctrl[c]; }));
      A.turnsDone = turn;
      if (!A.units.some(alive) || !B.units.some(alive)) break;
    }
    A.turns = Math.min(TURNS, A.turnsDone || TURNS);
    const a = A.units.some(alive), b = B.units.some(alive);
    return a && !b ? 'win' : b && !a ? 'lose' : 'draw';
  }

  // ── 여러 번 돌리기 ──
  // o: { n: 300, seed: 1, troops: 10000, points: 'auto'|'none', log: false }
  function simulate(teamA, teamB, codex, o = {}) {
    const n = o.n || 300, R = rng(o.seed || 12345), cache = {};
    const opt = { troops: o.troops || 10000, points: o.points || 'auto' };
    const res = { n, win: 0, draw: 0, lose: 0, hpA: 0, hpB: 0, units: {}, log: null };
    for (let i = 0; i < n; i++) {
      const A = buildSide(teamA, codex, opt, 'A', cache), B = buildSide(teamB, codex, opt, 'B', cache);
      B.kDmg = o.kDmg; B.kHeal = o.kHeal;
      if (!A.units.length || !B.units.length) return { error: '양쪽 모두 무장이 필요합니다' };
      const log = o.log && i === 0 ? [] : null;
      const r = battle(A, B, R, log); res[r]++;
      if (log) res.log = log;
      res.turns = (res.turns || 0) + A.turns;
      res.hpA += A.units.reduce((s, u) => s + Math.max(0, u.hp), 0) / (opt.troops * A.units.length);
      res.hpB += B.units.reduce((s, u) => s + Math.max(0, u.hp), 0) / (opt.troops * B.units.length);
      [...A.units, ...B.units].forEach(u => {
        const k = u.side + ':' + u.name; const x = res.units[k] || (res.units[k] = { side: u.side, name: u.name, pos: u.pos, dealt: 0, healed: 0, taken: 0, alive: 0, casts: {} });
        x.dealt += u.dealt; x.healed += u.healed; x.taken += u.taken; x.alive += u.hp > 0 ? 1 : 0;
        Object.entries(u.casts).forEach(([t, c]) => (x.casts[t] = (x.casts[t] || 0) + c));
      });
    }
    res.winRate = res.win / n; res.drawRate = res.draw / n; res.loseRate = res.lose / n;
    res.hpA /= n; res.hpB /= n; res.turns /= n;
    Object.values(res.units).forEach(x => { x.dealt = Math.round(x.dealt / n); x.healed = Math.round(x.healed / n); x.taken = Math.round(x.taken / n); x.alive /= n; Object.keys(x.casts).forEach(t => (x.casts[t] = Math.round((x.casts[t] / n) * 10) / 10)); });
    res.parsed = Object.values(cache).map(t => ({ name: t.name, type: t.type, rate: t.rate, effects: t.parsed }));
    return res;
  }

  // 여러 상대와 붙이기: opponents = [{ name, team }]
  function gauntlet(team, opponents, codex, o = {}) {
    return opponents.map((op, i) => { const r = simulate(team, op.team, codex, { ...o, seed: (o.seed || 7) + i * 101 }); return { name: op.name, tier: op.tier, turns: r.turns, win: r.winRate, draw: r.drawRate, lose: r.loseRate, hpA: r.hpA, hpB: r.hpB, error: r.error }; });
  }

  const api = { parseTactic, simulate, gauntlet, formFx, rng, TURNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TK3Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
