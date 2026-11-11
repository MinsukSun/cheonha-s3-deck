/* 천하결전 S3 덱 관리 — 정적 사이트 (데이터는 브라우저 localStorage에 저장) */
(() => {
'use strict';

// ───────────────────────── 기본 설정 ─────────────────────────
const DEFAULT_SHEET = {
  id: '17NtAf-aULDH-RtGPlWHHTGXJdg6R3yPg87uIo-F75_I',
  tabs: [
    { name: '시즌3 티어덱', gid: '1443176189', kind: 'tier' },
    { name: '시즌3 변칙, 계열덱', gid: '1922923785', kind: 'variant' },
    { name: '시즌3 공존덱', gid: '474450804', kind: 'coexist' },
    { name: '시즌3 공존덱(2)', gid: '841351688', kind: 'coexist' },
    { name: '무장 도감', gid: '1134089693', kind: 'roster' },
  ],
};
const KIND_LABEL = { tier: '티어덱', variant: '변칙·계열덱', coexist: '공존덱', simple: '내 시트', roster: '무장 도감', community: '커뮤니티', research: '추가 조사', custom: '내 덱' };
const LABELS = new Set(['전법', '병법', '병종', '장비', '장비/탈것', '장비특성', '탈것특성', '스텟', '스탯', '비고']);
const MAX_SEASON = 3;
// 돌파(红度)·승품(金印 升品) 최대 단계: 둘 다 5 (17173 2025-02-22 기사 "升品也是有5红", 커뮤니티 "共5品")
const MAX_STARS = 5, MAX_GRADE = 5;
const range0 = n => Array.from({ length: n + 1 }, (_, i) => i);
const LS_STATE = 'tk3-state-v1', LS_CACHE = 'tk3-cache-v1';

// ───────────────────────── 유틸 ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const cell = (g, r, c) => (g[r] && g[r][c] != null ? String(g[r][c]).trim() : '');
const uid = () => Math.random().toString(36).slice(2, 10);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400); }
function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('브라우저 저장 실패: ' + e.message); } }

// ───────────────────────── 상태 ─────────────────────────
const ACCOUNT_NAMES = ['덕구', '부계정'];
function newAccount(i) { return { id: uid(), name: ACCOUNT_NAMES[i] || `계정 ${i + 1}`, generals: {}, tactics: {}, lineup: [], squads: 5 }; }
let state = load(LS_STATE, null);
if (!state) state = { accounts: ACCOUNT_NAMES.map((_, i) => newAccount(i)), active: 0, sheet: DEFAULT_SHEET, customDecks: [], ui: {} };
// 예전 3계정 저장본·백업: 앞의 2개만 남기고, 기본 이름이면 덕구·부계정으로 바꿉니다.
function normalizeAccounts() {
  if (state.accounts.length > ACCOUNT_NAMES.length) state.accounts = state.accounts.slice(0, ACCOUNT_NAMES.length);
  while (state.accounts.length < ACCOUNT_NAMES.length) state.accounts.push(newAccount(state.accounts.length));
  state.accounts.forEach((a, i) => { if (/^계정 \d$/.test(a.name)) a.name = ACCOUNT_NAMES[i]; });
  if (!(state.active < state.accounts.length)) state.active = 0;
}
normalizeAccounts();
state.ui = Object.assign({ tab: 'decks', src: 'main', status: 'all', q: '', ownTab: 'generals', ownMode: 'own', ownQ: '', ownUsedOnly: true, ownSort: 'name' }, state.ui || {});
state.sheet = state.sheet || DEFAULT_SHEET;
state.customDecks = state.customDecks || [];
// 저장된 값이나 불러온 백업에 최대보다 큰 값이 있으면 최대로 맞춥니다.
function clampAccounts() {
  for (const a of state.accounts) for (const g of Object.values(a.generals || {})) {
    if (g.stars > MAX_STARS) g.stars = MAX_STARS;
    if (g.grade > MAX_GRADE) g.grade = MAX_GRADE;
  }
}
clampAccounts();
const persist = () => { save(LS_STATE, state); Cloud.onLocalChange(); };
const acct = () => state.accounts[state.active] || state.accounts[0];

// ───────────────────────── 공유 저장소 (GitHub 저장소의 JSON 파일) ─────────────────────────
// 계정 보유·편성, 내 덱, 시트 설정을 GitHub 저장소의 파일 하나에 저장해 여러 기기·사람이 같이 씁니다.
// - 읽기: 토큰 없이도 가능 (공개 저장소 raw 파일)
// - 저장: 저장소 Contents 쓰기 권한이 있는 GitHub 토큰이 기기마다 한 번 필요 (이 브라우저에만 보관)
// - 사이트(main 브랜치)가 저장할 때마다 다시 빌드되지 않도록 'data' 브랜치에 저장합니다.
// - 두 사람이 동시에 저장하면, 서버의 최신본을 받은 뒤 내가 바꾼 계정만 덮어써서 다시 저장합니다.
const LS_CLOUD = 'tk3-cloud-v1', LS_CLOUD_META = 'tk3-cloud-meta-v1';
const DEFAULT_CLOUD = { repo: 'MinsukSun/cheonha-s3-deck', branch: 'data', path: 'shared-state.json', token: '', enabled: true };
const Cloud = (() => {
  let cfg = Object.assign({}, DEFAULT_CLOUD, load(LS_CLOUD, {}));
  let meta = load(LS_CLOUD_META, { sha: null, base: null, at: null, rev: 0 });   // base: 마지막으로 서버와 맞춘 공유 데이터, rev: 서버 저장 번호
  let status = 'idle', detail = '', timer = null, busy = false, again = false;
  const AUTH_PATH = 'auth.json';
  let authBlob, authSha;   // undefined = 아직 안 읽음, null = 없음
  // AES-GCM 256 + PBKDF2-SHA256 (31만 회). 비밀번호가 약하면 공개된 암호문을 풀어볼 수 있으니 8자 이상을 씁니다.
  const bytesB64 = u8 => btoa(String.fromCharCode(...u8));
  const b64Bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function pwKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptSecret(text, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 310000;
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pwKey(pw, salt, iter), new TextEncoder().encode(text)));
    return { v: 1, alg: 'AES-GCM/PBKDF2-SHA256', iter, salt: bytesB64(salt), iv: bytesB64(iv), ct: bytesB64(ct), at: new Date().toISOString() };
  }
  async function decryptSecret(blob, pw) {
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64Bytes(blob.iv) }, await pwKey(pw, b64Bytes(blob.salt), blob.iter || 310000), b64Bytes(blob.ct));
      return new TextDecoder().decode(pt);
    } catch { return null; }
  }
  // 깊은 복사본: 저장 중에 화면에서 바꾼 내용이 '저장됨'으로 섞이지 않게 합니다.
  const shared = s => JSON.parse(JSON.stringify({ accounts: s.accounts, customDecks: s.customDecks || [], sheet: s.sheet }));
  const body = d => { const { rev, savedAt, ...rest } = d || {}; return rest; };
  const sj = o => JSON.stringify(o);
  const api = p => `https://api.github.com/repos/${cfg.repo}${p}`;
  const hdr = () => ({ Accept: 'application/vnd.github+json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) });
  const b64e = str => { const b = new TextEncoder().encode(str); let s = ''; b.forEach(x => (s += String.fromCharCode(x))); return btoa(s); };
  const b64d = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
  function setStatus(s, d = '') { status = s; detail = d; paintStatus(); }
  function saveCfg() { save(LS_CLOUD, cfg); }
  function saveMeta() { save(LS_CLOUD_META, meta); }
  const canWrite = () => cfg.enabled && !!cfg.token && !!cfg.repo;

  async function fetchRemote() {
    if (cfg.token) {
      const r = await fetch(api(`/contents/${encodeURIComponent(cfg.path)}?ref=${encodeURIComponent(cfg.branch)}`), { headers: hdr(), cache: 'no-store' });
      if (r.status === 404) return { data: null, sha: null };
      if (!r.ok) throw new Error(`읽기 실패 (${r.status})`);
      const j = await r.json();
      return { data: JSON.parse(b64d(j.content)), sha: j.sha };
    }
    // 토큰 없이 읽기: GitHub API(최신본, IP당 시간 60회)를 먼저 쓰고, 한도에 걸리면 raw 파일(최대 5분 늦을 수 있음)로 대신 읽습니다.
    const a = await fetch(api(`/contents/${encodeURIComponent(cfg.path)}?ref=${encodeURIComponent(cfg.branch)}`), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' }).catch(() => null);
    if (a && a.status === 404) return { data: null, sha: null };
    if (a && a.ok) { const j = await a.json(); return { data: JSON.parse(b64d(j.content)), sha: undefined }; }
    const r = await fetch(`https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/${cfg.path}?t=${Date.now()}`, { cache: 'no-store' });
    if (r.status === 404) return { data: null, sha: null };
    if (!r.ok) throw new Error(`읽기 실패 (${r.status})`);
    return { data: await r.json(), sha: undefined };
  }
  async function ensureBranch() {
    const r = await fetch(api(`/git/ref/heads/${encodeURIComponent(cfg.branch)}`), { headers: hdr(), cache: 'no-store' });
    if (r.ok) return;
    if (r.status !== 404) throw new Error(`브랜치 확인 실패 (${r.status})`);
    const info = await (await fetch(api(''), { headers: hdr() })).json();
    const base = await (await fetch(api(`/git/ref/heads/${info.default_branch}`), { headers: hdr() })).json();
    const c = await fetch(api('/git/refs'), { method: 'POST', headers: hdr(), body: sj({ ref: `refs/heads/${cfg.branch}`, sha: base.object.sha }) });
    if (!c.ok) throw new Error(`브랜치 만들기 실패 (${c.status})`);
  }
  async function putRemote(data, sha) {
    const body = { message: `덱 관리 데이터 저장 (${new Date().toLocaleString('ko-KR')})`, content: b64e(JSON.stringify(data, null, 1)), branch: cfg.branch };
    if (sha) body.sha = sha;
    const r = await fetch(api(`/contents/${encodeURIComponent(cfg.path)}`), { method: 'PUT', headers: hdr(), body: sj(body) });
    if (r.status === 409 || r.status === 422) return { conflict: true };
    if (r.status === 401 || r.status === 403) throw new Error('토큰 권한이 없습니다 (Contents 읽기·쓰기 필요)');
    if (!r.ok) throw new Error(`저장 실패 (${r.status})`);
    const j = await r.json();
    return { sha: j.content.sha };
  }
  // 서버 최신본(remote)에 내가 바꾼 부분만 얹기
  function merge(remote, local, base) {
    const out = JSON.parse(sj(remote));
    const baseAcc = new Map((base?.accounts || []).map(a => [a.id, sj(a)]));
    local.accounts.forEach((a, i) => {
      if (baseAcc.get(a.id) === sj(a)) return;                 // 내가 안 바꾼 계정은 서버 것 유지
      const j = out.accounts.findIndex(x => x.id === a.id);
      if (j >= 0) out.accounts[j] = a; else if (out.accounts.length < ACCOUNT_NAMES.length) out.accounts.splice(i, 0, a);
    });
    if (sj(local.customDecks) !== sj(base?.customDecks || [])) out.customDecks = local.customDecks;
    if (sj(local.sheet) !== sj(base?.sheet)) out.sheet = local.sheet;
    return out;
  }
  function applyShared(data) {
    data = body(JSON.parse(sj(data)));
    state.accounts = data.accounts; state.customDecks = data.customDecks || []; if (data.sheet) state.sheet = data.sheet;
    normalizeAccounts(); clampAccounts(); save(LS_STATE, state);
  }
  const dirty = () => meta.base == null || sj(shared(state)) !== sj(body(meta.base));

  // 서버에서 받아오기. 내 변경이 없으면 서버 것으로 바꾸고, 있으면 합쳐서 저장합니다.
  async function pull(opts = {}) {
    if (!cfg.enabled || !cfg.repo) return setStatus('off');
    if (busy) { again = true; return; }
    busy = true; setStatus('sync', '불러오는 중');
    try {
      const { data, sha } = await fetchRemote();
      if (!data) {
        if (canWrite()) { busy = false; return push(); }
        setStatus('empty', '아직 공유 파일이 없습니다. 토큰을 넣으면 이 브라우저 데이터로 만듭니다.');
      } else if (!opts.adopt && meta.base && (data.rev || 0) < (meta.rev || 0)) {
        // 방금 저장한 것보다 오래된 사본(GitHub 캐시)이 내려온 경우: 무시
        setStatus(canWrite() ? (dirty() ? 'pending' : 'ok') : 'readonly');
        if (dirty() && canWrite()) { busy = false; schedule(); return; }
      } else if (opts.adopt || !dirty() || !meta.base) {
        const changed = sj(shared(state)) !== sj(body(data));
        // 처음 연결할 때 이 브라우저에만 있던 데이터는 따로 보관 (데이터·설정 → 백업에서 복구 가능)
        if (changed && !meta.base && state.accounts.some(a => Object.keys(a.generals).length || Object.keys(a.tactics).length)) save('tk3-state-before-cloud', state);
        meta = { sha: sha ?? meta.sha, base: data, at: new Date().toISOString(), rev: data.rev || 0 }; saveMeta();
        applyShared(data);
        if (changed && typeof start._done !== 'undefined') { buildData(); render(); }
        setStatus(canWrite() ? 'ok' : 'readonly');
      } else if (canWrite()) {
        const merged = merge(body(data), shared(state), body(meta.base));
        meta = { sha, base: data, at: meta.at, rev: Math.max(meta.rev || 0, data.rev || 0) }; saveMeta();
        applyShared(merged); buildData(); render();
        busy = false; return push();
      } else {
        setStatus('readonly', '이 브라우저에 공유되지 않은 변경이 있습니다 (토큰 없음)');
      }
    } catch (e) { setStatus('error', e.message); }
    busy = false;
    if (again) { again = false; schedule(); }
  }
  async function push() {
    if (!canWrite()) return setStatus(cfg.enabled ? 'readonly' : 'off');
    if (busy) { again = true; return; }
    busy = true; setStatus('sync', '저장 중');
    try {
      if (!meta.sha) await ensureBranch();
      for (let tries = 0; tries < 3; tries++) {
        const local = shared(state);                       // 이 순간의 복사본만 올림
        const rev = (meta.rev || 0) + 1;
        const doc = { ...local, rev, savedAt: new Date().toISOString() };
        const res = await putRemote(doc, meta.sha);
        if (!res.conflict) { meta = { sha: res.sha, base: doc, at: doc.savedAt, rev }; saveMeta(); setStatus(dirty() ? 'pending' : 'ok'); if (dirty()) again = true; break; }
        // 다른 곳에서 먼저 저장함 → 최신본에 내 변경만 얹어 다시 시도
        const { data, sha } = await fetchRemote();
        const merged = data ? merge(body(data), local, body(meta.base)) : local;
        meta = { sha, base: data, at: meta.at, rev: Math.max(meta.rev || 0, data?.rev || 0) }; saveMeta();
        applyShared(merged); buildData(); render();
        setStatus('sync', '다른 기기의 변경과 합치는 중');
        if (tries === 2) throw new Error('저장 충돌이 계속됩니다. 잠시 뒤 다시 시도하세요.');
      }
    } catch (e) { setStatus('error', e.message); toast('공유 저장 실패: ' + e.message); }
    busy = false;
    if (again) { again = false; schedule(); }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => (dirty() ? push() : null), 1500); }
  function onLocalChange() {
    if (!cfg.enabled) return;
    if (!dirty()) return;
    if (canWrite()) { setStatus('pending', '저장 대기'); schedule(); } else setStatus('readonly', '이 브라우저에만 저장됨 (토큰 없음)');
  }
  const LABEL = { idle: '공유 확인 전', off: '공유 꺼짐 · 이 브라우저만', ok: '공유 저장됨', pending: '공유 저장 대기', sync: '공유 동기화 중', readonly: '공유 읽기 전용', empty: '공유 파일 없음', error: '공유 오류' };
  function paintStatus() {
    const el = document.getElementById('cloudStatus'); if (!el) return;
    el.textContent = '☁ ' + LABEL[status]; el.title = detail || LABEL[status]; el.dataset.s = status;
    const m = document.getElementById('cloudMsg'); if (m) m.textContent = `${LABEL[status]}${detail ? ' — ' + detail : ''}${meta.at ? ` · 마지막 동기화 ${new Date(meta.at).toLocaleString('ko-KR')}` : ''}`;
  }
  // 주기적·포커스 시 새로고침 (토큰 있으면 1분, 없으면 포커스 때만)
  setInterval(() => { if (cfg.token && document.visibilityState === 'visible' && !dirty()) pull(); }, 60000);
  window.addEventListener('focus', () => { if (!cfg.enabled || busy) return; if (dirty() && canWrite()) schedule(); else if (!dirty()) pull(); });
  return {
    pull, push, onLocalChange, paintStatus,
    // ── 공유 비밀번호: 토큰을 비밀번호로 암호화해 저장소(data 브랜치 auth.json)에 두고, 어느 브라우저든 비밀번호로 풀어 씁니다.
    get authExists() { return authBlob === undefined ? null : !!authBlob; },
    async fetchAuth() {
      if (authBlob !== undefined) return authBlob;
      try {
        const r = await fetch(api(`/contents/${AUTH_PATH}?ref=${encodeURIComponent(cfg.branch)}`), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
        if (r.status === 404) authBlob = null;
        else if (r.ok) { const j = await r.json(); authBlob = JSON.parse(b64d(j.content)); authSha = j.sha; }
        else { const raw = await fetch(`https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/${AUTH_PATH}?t=${Date.now()}`, { cache: 'no-store' }); authBlob = raw.ok ? await raw.json() : null; }
      } catch { authBlob = null; }
      return authBlob;
    },
    async unlockWith(pw) {
      const blob = await this.fetchAuth(); if (!blob || !pw) return false;
      const tok = await decryptSecret(blob, pw); if (!tok) return false;
      cfg = Object.assign({}, cfg, { token: tok, enabled: true }); saveCfg(); setStatus(dirty() ? 'pending' : 'ok');
      return true;
    },
    async publishAuth(pw) {
      if (!canWrite()) throw new Error('먼저 이 브라우저에 토큰을 연결하세요');
      const blob = await encryptSecret(cfg.token, pw);
      if (!meta.sha) await ensureBranch();
      const cur = await fetch(api(`/contents/${AUTH_PATH}?ref=${encodeURIComponent(cfg.branch)}`), { headers: hdr(), cache: 'no-store' });
      const sha = cur.ok ? (await cur.json()).sha : undefined;
      const r = await fetch(api(`/contents/${AUTH_PATH}`), { method: 'PUT', headers: hdr(), body: sj({ message: '공유 비밀번호 설정', content: b64e(JSON.stringify(blob, null, 1)), branch: cfg.branch, ...(sha ? { sha } : {}) }) });
      if (!r.ok) throw new Error(`올리기 실패 (${r.status})`);
      authBlob = blob;
    },
    get cfg() { return cfg; }, get status() { return status; },
    setCfg(next) { cfg = Object.assign({}, cfg, next); saveCfg(); meta = { sha: null, base: null, at: null, rev: 0 }; saveMeta(); },
    uploadLocal: async () => { const r = await fetchRemote().catch(() => ({})); meta = { sha: r.sha || null, base: { accounts: [] }, at: meta.at, rev: Math.max(meta.rev || 0, r.data?.rev || 0) }; saveMeta(); return push(); },
    adoptRemote: () => pull({ adopt: true }),
  };
})();

let cache = load(LS_CACHE, null) || window.SHEET_CACHE || { tabs: [] };

// ───────────────────────── 이름 사전 ─────────────────────────
const G = new Map(); // 무장 key → {key,name,season,skill,type,cat,desc,used,forms}
const T = new Map(); // 전법 key → {key,name,used,forms}
function reg(map, raw, extra) {
  const k = key(raw); if (!k) return null;
  let e = map.get(k);
  if (!e) { e = { key: k, name: raw, used: 0, forms: {} }; map.set(k, e); }
  if (extra) Object.assign(e, extra);
  return e;
}
function noteForm(e, raw) { if (!e) return; e.forms[raw] = (e.forms[raw] || 0) + 1; }
function finalizeNames(map) {
  for (const e of map.values()) {
    if (e.fixed) continue;
    const f = Object.entries(e.forms).sort((a, b) => b[1] - a[1] || (b[0].includes(' ') - a[0].includes(' ')));
    if (f.length) e.name = f[0][0];
  }
}
const gName = k => (G.get(k) || {}).name || k;
const tName = k => (T.get(k) || {}).name || k;

// ───────────────────────── 파서 ─────────────────────────
const TROOP_RE = /(궁병|기병|창병|방패병|보병)/;
function parseGeneralCell(raw) {
  raw = String(raw || '').trim(); if (!raw) return null;
  let troop = '';
  const m = raw.match(/\(([^)]*)\)/); if (m && TROOP_RE.test(m[1])) troop = m[1].match(TROOP_RE)[1];
  const clean = raw.replace(/\([^)]*\)/g, '').trim();
  const opts = clean.split('/').map(s => s.trim()).filter(Boolean);
  return { raw, troop, opts: opts.map(o => { const e = reg(G, o); noteForm(e, o); return e.key; }) };
}
function parseTacticCell(raw) {
  raw = String(raw || '').trim(); if (!raw) return null;
  const copy = /영본/.test(raw);
  const opts = raw.replace(/\([^)]*\)/g, '').split('/').map(s => s.trim()).filter(Boolean);
  const AL = window.TACTIC_ALIASES || {};
  return { raw, copy, opts: opts.map(o => {
    const to = AL[key(o)] || AL[o];
    if (to) { const e = reg(T, to); (e.aliases = e.aliases || new Set()).add(o); return e.key; }
    const e = reg(T, o); noteForm(e, o); return e.key;
  }) };
}
function parseTier(title) {
  const m = String(title).match(/^\s*T\s*(\d+(?:\.\d+)?)\s*([+-])?\s*(.*)$/i);
  if (!m) return { tier: null, tierLabel: '', name: String(title).trim() };
  const n = parseFloat(m[1]), s = m[2] || '';
  return { tier: n + (s === '-' ? 0.05 : s === '+' ? -0.05 : 0), tierLabel: 'T' + m[1] + s, name: m[3].replace(/^[-\s]+/, '').trim() || title };
}

function parseBlockTab(tab) {
  const g = tab.grid || [], decks = [];
  let group = '';
  const found = [];
  for (let r = 0; r < g.length; r++) for (let c = 0; c < (g[r] || []).length; c++) {
    if (cell(g, r, c) !== '전법' || r < 3) continue;
    const gens = [1, 2, 3].map(j => cell(g, r - 2, c + j));
    if (!gens.some(Boolean)) continue;
    found.push([r, c]);
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [r, c] of found) {
    // 제목·설명 위치 찾기
    const at = row => cell(g, row, c) || cell(g, row, c + 1);
    const t3 = at(r - 3), t4 = r >= 4 ? at(r - 4) : '';
    const t4lbl = LABELS.has(cell(g, r - 4, c));
    let title, desc = '', titleRow, choice = '';
    if (/택\s*\d/.test(t4)) { choice = t4; title = t3; titleRow = r - 3; }
    else if (t3 && t4 && !t4lbl && !LABELS.has(cell(g, r - 3, c))) { title = t4; desc = t3; titleRow = r - 4; }
    else { title = t3; titleRow = r - 3; }
    if (tab.kind !== 'tier' && c > 0) { const g0 = cell(g, titleRow, 0); if (g0 && g0 !== title) group = g0; }
    const { tier, tierLabel, name } = parseTier(title || '이름 없음');
    const slots = [1, 2, 3].map(j => ({ gen: parseGeneralCell(cell(g, r - 2, c + j)), tactics: [], books: [], rows: {} }));
    const extra = {};
    let label = '', note = '';
    for (let i = r; i < g.length; i++) {
      const lab = cell(g, i, c), vals = [1, 2, 3].map(j => cell(g, i, c + j));
      if (!lab && !vals.some(Boolean)) break;
      if (lab && !LABELS.has(lab)) break;
      if (lab) label = lab;
      if (label === '비고') { note += (note ? ' ' : '') + vals.filter(Boolean).join(' '); continue; }
      vals.forEach((v, j) => {
        const s = slots[j];
        if (label === '전법') { const t = parseTacticCell(v); if (t) s.tactics.push(t); }
        else if (label === '병법') { if (v) s.books.push(v); }
        else if (v) s.rows[label] = (s.rows[label] ? s.rows[label] + ' · ' : '') + v;
      });
    }
    slots.forEach(s => { if (s.rows['병종'] && !s.gen?.troop && s.gen) s.gen.troop = s.rows['병종']; });
    decks.push(mkDeck({ src: tab.name, kind: tab.kind, group: tab.kind === 'tier' ? '' : group, title, name, tier, tierLabel, desc, note, choice,
      formation: cell(g, r - 1, c), slots, pos: `${r}:${c}` }));
  }
  return decks;
}

// 단순 표 형식 (한 줄에 덱 하나): 덱이름 | 티어 | 진형 | 무장1 | 무장1 전법1 | 무장1 전법2 | 무장2 ... | 비고
function parseSimpleTab(tab) {
  const g = tab.grid || []; if (!g.length) return [];
  const hr = g.findIndex(r => r.some(v => key(v) === '덱이름'));
  if (hr < 0) return [];
  const H = g[hr].map(key), col = n => H.indexOf(key(n));
  const out = [];
  for (let r = hr + 1; r < g.length; r++) {
    const v = n => { const i = col(n); return i >= 0 ? cell(g, r, i) : ''; };
    if (!v('덱이름')) continue;
    const slots = [1, 2, 3].map(j => ({
      gen: parseGeneralCell(v(`무장${j}`)),
      tactics: [v(`무장${j}전법1`), v(`무장${j}전법2`)].map(parseTacticCell).filter(Boolean),
      books: v(`무장${j}병법`) ? [v(`무장${j}병법`)] : [], rows: v(`무장${j}병종`) ? { '병종': v(`무장${j}병종`) } : {},
    }));
    const tr = parseTier(v('티어') ? (v('티어').startsWith('T') ? v('티어') : 'T' + v('티어')) + ' x' : 'x');
    out.push(mkDeck({ src: tab.name, kind: 'simple', group: v('분류'), title: v('덱이름'), name: v('덱이름'), tier: tr.tier, tierLabel: tr.tierLabel,
      desc: '', note: v('비고'), starText: v('돌파조건'), formation: v('진형'), slots, pos: String(r) }));
  }
  return out;
}

function parseRoster(tab) {
  const g = tab.grid || [];
  let season = 1;
  const TYPES = new Set(['지휘', '패시브', '액티브', '추격', '돌격']);
  for (let r = 0; r < g.length; r++) {
    const h = cell(g, r, 0);
    if (/무장/.test(h) && (/시즌/.test(h) || /출시/.test(h))) { const m = h.match(/시즌\s*(\d+)/); season = m ? +m[1] : 99; }
    if (season > MAX_SEASON) continue;
    for (let c = 0; c < (g[r] || []).length; c++) {
      const name = cell(g, r, c);
      if (!name || !TYPES.has(cell(g, r, c + 3)) || cell(g, r, c - 1)) continue;
      reg(G, name, { name, fixed: true, season, skill: cell(g, r, c + 1), type: cell(g, r, c + 3), cat: cell(g, r, c + 4), desc: cell(g, r - 1, c + 1), roster: true });
    }
  }
}

// 설명·비고의 "마초 3돌 이상", "마운록 4돌 2품 이상", "왕이 2품" 같은 문구에서 무장별 최소 돌파·승품을 뽑습니다.
// s.req[무장key] = { s: 돌파, p: 품 }
// 문구에 처음 나오는 조건(일반 서버 기준)만 쓰고, 뒤에 붙은 "시골섭에는 3돌 1품" 같은 완화 조건은 무시합니다.
function extractStarReq(d) {
  const text = [d.desc, d.note, d.starText].filter(Boolean).join(' ');
  d.slots.forEach(s => { s.req = {}; s.reqRural = {}; });
  if (!/\d\s*(돌|품)/.test(text)) return;
  for (const s of d.slots) {
    if (!s.gen) continue;
    for (const k of s.gen.opts) {
      const names = new Set([gName(k), ...Object.keys((G.get(k) || {}).forms || {})]);
      let best = null;
      for (const n of names) {
        const pat = [...n.replace(/\s+/g, '')].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
        // "마운록 4돌 2품", "마초 3돌파", "왕이 2품"
        const m = new RegExp(pat + '\\s*[:：]?\\s*(?:(\\d)\\s*돌(?:파)?)?\\s*(?:(\\d)\\s*품)?', 'gi');
        let x;
        while ((x = m.exec(text))) {
          if (x[1] || x[2]) { if (!best || x.index < best.index) best = x; break; }
          if (m.lastIndex === x.index) m.lastIndex++;
        }
      }
      if (best) {
        s.req[k] = { s: Math.min(MAX_STARS, +(best[1] || 0)), p: Math.min(MAX_GRADE, +(best[2] || 0)) };
        // 바로 뒤(40자 안)에 "시골섭에는 3돌 1품" 같은 완화 조건이 있으면 따로 저장
        const after = text.slice(best.index + best[0].length, best.index + best[0].length + 40);
        const rm = /시골\s*섭[^\d]{0,8}(?:(\d)\s*돌(?:파)?)?\s*(?:(\d)\s*품)?/.exec(after);
        if (rm && (rm[1] || rm[2])) s.reqRural[k] = { s: +(rm[1] || 0), p: +(rm[2] || 0) };
      }
    }
  }
}
const reqText = r => [r.s ? `${r.s}돌` : '', r.p ? `${r.p}품` : ''].filter(Boolean).join(' ');
const genState = (a, k) => (a.generals[k] && a.generals[k].owned ? a.generals[k] : null);
const starsOf = (a, k) => { const g = genState(a, k); return g ? g.stars || 0 : -1; };
const gradeOf = (a, k) => { const g = genState(a, k); return g ? g.grade || 0 : -1; };
// 계정의 서버 유형이 '시골섭'이고 완화 조건이 있으면 그것을, 아니면 일반 조건을 씁니다.
const effReq = (a, s, k) => (a && a.server === 'rural' && s.reqRural && s.reqRural[k]) || (s.req && s.req[k]) || null;
const meetsG = (a, s, k) => {
  if (!ownsG(a, k)) return false;
  const r = effReq(a, s, k); if (!r) return true;
  return starsOf(a, k) >= r.s && gradeOf(a, k) >= r.p;
};

function mkDeck(d) {
  const gk = d.slots.map(s => (s.gen ? s.gen.opts.join('|') : '')).join('+');
  d.id = `${d.kind}:${key(d.name)}:${gk}`;
  return d;
}

let DECKS = [], COEXIST = [];
function buildData() {
  G.clear(); T.clear();
  const tabs = cache.tabs || [];
  tabs.filter(t => t.kind === 'roster').forEach(parseRoster);
  let decks = [];
  for (const t of tabs) {
    if (t.kind === 'roster') continue;
    decks = decks.concat(t.kind === 'simple' ? parseSimpleTab(t) : parseBlockTab(t));
  }
  // 커뮤니티 덱
  for (const src of window.EXTRA_DECKS || []) for (const d of src.decks) {
    decks.push(mkDeck({ src: src.source, url: src.url, kind: 'community', group: '', title: d.name, name: d.name, tier: null, tierLabel: '', desc: '', note: d.note || '',
      formation: '', unknownTactics: true, slots: d.generals.map(n => ({ gen: parseGeneralCell(n), tactics: [], books: [], rows: {} })) }));
  }
  // 추가 조사 덱 (덱 빌더·삼천 데이터 등, 전법까지 있는 것)
  for (const src of window.RESEARCH_DECKS || []) for (const d of src.decks) {
    const tr = parseTier(d.tier ? d.tier + ' x' : 'x');
    const tier = tr.tier == null ? null : 0.4 + tr.tier * 0.5;  // T0→0.4, T1→0.9, T2→1.4 (시트 티어보다 한 단계 아래로 봄)
    decks.push(mkDeck({ src: src.source, url: src.url, kind: 'research', group: d.group || '', title: d.name, name: d.name, tier,
      tierLabel: d.tier ? d.tier + (d.score ? ` ${d.score}` : '') : '', desc: '', note: d.note || '', formation: d.formation || '',
      slots: d.generals.map((n, i) => ({ gen: parseGeneralCell(n), tactics: (d.tactics[i] || []).map(parseTacticCell).filter(Boolean), books: [], rows: d.troops && d.troops[i] ? { '병종': d.troops[i] } : {} })) }));
  }
  // 내 덱
  for (const c of state.customDecks) {
    const tr = parseTier(c.tier ? (/^T/i.test(c.tier) ? c.tier : 'T' + c.tier) + ' x' : 'x');
    decks.push(Object.assign(mkDeck({ src: '내가 추가한 덱', kind: 'custom', group: '', title: c.name, name: c.name, tier: tr.tier, tierLabel: tr.tierLabel, desc: '', note: c.note || '',
      formation: c.formation || '', starText: c.slots.filter(s => s.general && (+s.stars > 0 || +s.grade > 0)).map(s => `${s.general} ${+s.stars || 0}돌 ${+s.grade || 0}품`).join(', '), slots: c.slots.map(s => ({ gen: parseGeneralCell(s.general), tactics: [s.t1, s.t2].map(parseTacticCell).filter(Boolean), books: [], rows: s.troop ? { '병종': s.troop } : {} })) }), { customId: c.id }));
  }
  // 동일 id 정리
  const seen = {};
  for (const d of decks) { seen[d.id] = (seen[d.id] || 0) + 1; if (seen[d.id] > 1) d.id += '#' + seen[d.id]; }
  // 사용 빈도
  for (const d of decks) for (const s of d.slots) {
    s.gen?.opts.forEach(k => G.get(k).used++);
    s.tactics.forEach(t => t.opts.forEach(k => T.get(k).used++));
  }
  finalizeNames(G); finalizeNames(T);
  // 전법 유형표: 유형·특성·시즌을 붙이고, 덱에 안 쓰이는 전법도 보유 목록에 올립니다.
  for (const [n, ty, tr, se] of window.TACTIC_TYPES || []) {
    const k = key(n), AL = window.TACTIC_ALIASES || {};
    const e = T.get(AL[k] || k) || reg(T, n);
    Object.assign(e, { ttype: ty, trait: tr, tseason: se, name: n });   // 표기는 유형표의 공식 이름(띄어쓰기 포함)으로 통일
  }
  decks.forEach(extractStarReq);
  // 같은 무장 3명 조합인데 설명에 돌파 조건이 없는 덱은, 다른 탭의 같은 조합 덱에 적힌 조건 중 가장 낮은 값을 따릅니다.
  const sig = d => d.slots.map(s => (s.gen ? s.gen.opts[0] : '')).sort().join('+');
  const hasReq = d => d.slots.some(s => Object.keys(s.req).length);
  const minReq = {};
  decks.filter(hasReq).forEach(d => d.slots.forEach(s => Object.entries(s.req).forEach(([k, r]) => {
    const key2 = sig(d) + '|' + k, cur = minReq[key2] || { s: 9, p: 9 };
    minReq[key2] = { s: Math.min(cur.s, r.s), p: Math.min(cur.p, r.p) };
  })));
  decks.filter(d => !hasReq(d) && d.kind !== 'community' && d.kind !== 'custom').forEach(d => d.slots.forEach(s => s.gen && s.gen.opts.forEach(k => {
    const r = minReq[sig(d) + '|' + k]; if (r && (r.s || r.p)) { s.req[k] = { ...r }; d.reqInherited = true; }
  })));
  // 시골섭 완화 조건: 같은 조합 덱에 적힌 것 중 가장 낮은 값. 단, 일반 조건보다 엄격해지지 않게 맞춥니다.
  const minRural = {};
  decks.forEach(d => d.slots.forEach(s => Object.entries(s.reqRural || {}).forEach(([k, r]) => {
    const key2 = sig(d) + '|' + k, cur = minRural[key2] || { s: 9, p: 9 };
    minRural[key2] = { s: Math.min(cur.s, r.s), p: Math.min(cur.p, r.p) };
  })));
  decks.filter(d => d.kind !== 'community' && d.kind !== 'custom').forEach(d => d.slots.forEach(s => Object.keys(s.req).forEach(k => {
    const r = s.reqRural[k] || minRural[sig(d) + '|' + k];
    if (r) s.reqRural[k] = { s: Math.min(r.s, s.req[k].s), p: Math.min(r.p, s.req[k].p) };
  })));
  DECKS = decks;
  // 공존 프리셋
  COEXIST = [];
  const groups = {};
  for (const d of decks.filter(d => d.kind === 'coexist')) { const gk = d.src + '|' + d.group; (groups[gk] = groups[gk] || { src: d.src, group: d.group, decks: [] }).decks.push(d); }
  for (const gr of Object.values(groups)) {
    const m = gr.group.match(/(\d)\s*공존/); const n = m ? +m[1] : gr.decks.length;
    const ci = gr.decks.findIndex(d => d.choice);
    if (ci >= 0 && ci + 1 < gr.decks.length) {
      // '둘 중 택1': 표시된 덱과 바로 다음 덱 중 하나만 사용
      const pair = [gr.decks[ci], gr.decks[ci + 1]], base = gr.decks.filter(d => !pair.includes(d));
      pair.forEach(d => (d.choiceTag = '둘 중 택1'));
      COEXIST.push({ name: gr.group.trim(), src: gr.src, need: n, decks: gr.decks, options: pair.map(p => [...base, p]) });
    } else if (gr.decks.length > n && gr.decks.length % n === 0) {
      for (let i = 0; i < gr.decks.length; i += n) COEXIST.push({ name: `${gr.group.trim()} · 방안 ${String.fromCharCode(65 + i / n)}`, src: gr.src, need: n, decks: gr.decks.slice(i, i + n) });
    } else COEXIST.push({ name: gr.group.trim(), src: gr.src, need: Math.min(n, gr.decks.length), decks: gr.decks, choose: gr.decks.length > n });
  }
  // 자동완성
  $('#dlGenerals').innerHTML = [...G.values()].filter(e => !e.season || e.season <= MAX_SEASON).map(e => `<option value="${esc(e.name)}">`).join('');
  $('#dlTactics').innerHTML = [...T.values()].map(e => `<option value="${esc(e.name)}">`).join('');
}

// ───────────────────────── 보유 판정 ─────────────────────────
const ownsG = (a, k) => !!(a.generals[k] && a.generals[k].owned);
const tCount = (a, k) => a.tactics[k] || 0;
function check(d, a) {
  const missG = [], missT = [], missS = [];
  d.slots.forEach(s => {
    if (s.gen && !s.gen.opts.some(k => ownsG(a, k))) missG.push(s.gen.opts.map(gName).join('/'));
    else if (s.gen && !s.gen.opts.some(k => meetsG(a, s, k))) {
      const k = s.gen.opts.find(k => ownsG(a, k));
      const r = effReq(a, s, k);
      missS.push({ label: gName(k), need: reqText(r), have: [r.s ? `${starsOf(a, k)}돌` : '', r.p ? `${gradeOf(a, k)}품` : ''].filter(Boolean).join(' ') });
    }
    s.tactics.forEach(t => { if (!t.opts.some(k => tCount(a, k) > 0)) missT.push({ label: t.opts.map(tName).join('/'), opts: t.opts }); });
  });
  return { status: missG.length ? 'general' : missT.length ? 'tactic' : missS.length ? 'stars' : 'ok', missG, missT, missS };
}
const STATUS_LABEL = { ok: '구성 가능', stars: '돌파·품 부족', tactic: '전법 부족', general: '무장 부족' };
const STATUS_ORDER = { ok: 0, stars: 1, tactic: 2, general: 3 };
const tierScore = d => (d.tier == null ? (d.kind === 'community' ? 2 : 3) : Math.max(0.5, 10 - d.tier * 6));

// 덱 하나의 실제 구성 후보 (대체 무장/전법 조합)
function realizations(d, a, cap = 48) {
  let list = [{ g: [], t: {} }];
  for (const s of d.slots) {
    if (s.gen) {
      const own = s.gen.opts.filter(k => meetsG(a, s, k)); if (!own.length) return [];
      list = list.flatMap(x => own.map(k => ({ g: [...x.g, k], t: x.t })));
    }
    for (const t of s.tactics) {
      const own = t.opts.filter(k => tCount(a, k) > 0); if (!own.length) return [];
      list = list.flatMap(x => own.map(k => ({ g: x.g, t: { ...x.t, [k]: (x.t[k] || 0) + 1 } })));
    }
    if (list.length > cap) list = list.slice(0, cap);
  }
  return list;
}
function fits(r, usedG, usedT, a) {
  if (r.g.some(k => usedG.has(k))) return false;
  if (new Set(r.g).size !== r.g.length) return false;
  for (const [k, n] of Object.entries(r.t)) if ((usedT[k] || 0) + n > tCount(a, k)) return false;
  return true;
}
// 무장·전법 중복 없이 최대 k개 덱을 고르는 탐색
function solve(cands, a, k, fixed = []) {
  const usedG = new Set(), usedT = {};
  const apply = (r, sign) => { r.g.forEach(x => sign > 0 ? usedG.add(x) : usedG.delete(x)); for (const [x, n] of Object.entries(r.t)) usedT[x] = (usedT[x] || 0) + sign * n; };
  for (const f of fixed) apply(f.r, 1);
  const items = cands.map(d => ({ d, rs: realizations(d, a), s: tierScore(d) })).filter(x => x.rs.length).sort((x, y) => y.s - x.s);
  let best = { n: -1, s: -1, pick: [] }, nodes = 0;
  const cur = [];
  const dfs = (i, n, s) => {
    if (++nodes > 150000) return;
    if (n > best.n || (n === best.n && s > best.s)) best = { n, s, pick: cur.slice() };
    if (n >= k || i >= items.length) return;
    // 상한 가지치기
    let ub = s; for (let j = i, c = 0; j < items.length && c < k - n; j++, c++) ub += items[j].s;
    if (Math.min(k, n + items.length - i) < best.n || (Math.min(k, n + items.length - i) === best.n && ub <= best.s)) return;
    const it = items[i];
    for (const r of it.rs) if (fits(r, usedG, usedT, a)) { apply(r, 1); cur.push({ d: it.d, r }); dfs(i + 1, n + 1, s + it.s); cur.pop(); apply(r, -1); break; }
    dfs(i + 1, n, s);
  };
  dfs(0, 0, 0);
  return best.pick;
}

// ───────────────────────── 렌더: 공통 ─────────────────────────
function serverSelect(a, i) {
  return `<label class="small" title="시골섭: 인구가 적은 서버. 시트에 '시골섭에는 3돌 1품'처럼 완화 조건이 적힌 덱은 그 조건으로 판정합니다">서버
    <select data-act-input="server" data-a="${i}"><option value="normal" ${a.server !== 'rural' ? 'selected' : ''}>일반 조건</option><option value="rural" ${a.server === 'rural' ? 'selected' : ''}>시골섭 완화</option></select></label>`;
}
function renderAcctSwitch() {
  $('#acctSwitch').innerHTML = state.accounts.map((a, i) => `<button data-act="acct" data-i="${i}" class="${i === state.active ? 'on' : ''}">${esc(a.name)}</button>`).join('');
}
function deckCard(d, a, opts = {}) {
  const ck = check(d, a);
  const st = d.unknownTactics && ck.status !== 'general' ? 'ok' : ck.status;
  const slot = s => {
    if (!s.gen) return '<div class="slot muted">—</div>';
    const has = s.gen.opts.some(k => ownsG(a, k)), meet = s.gen.opts.some(k => meetsG(a, s, k));
    const gtxt = s.gen.opts.map(k => {
      const g = a.generals[k], need = effReq(a, s, k);
      const both = s.req && s.req[k] ? `일반 ${reqText(s.req[k])}` + (s.reqRural && s.reqRural[k] ? ` / 시골섭 ${reqText(s.reqRural[k])}` : '') : '';
      const mine = g && g.owned ? reqText({ s: g.stars || 0, p: g.grade || 0 }) : '';
      return esc(gName(k)) + (mine ? `<span class="small"> ${mine}</span>` : '') +
        (need ? ` <span class="req ${meetsG(a, s, k) ? 'met' : ''}" title="${esc(gName(k))} 필요 조건 — ${esc(both)}${a.server === 'rural' ? ' (시골섭 기준 적용 중)' : ''}${d.reqInherited ? ' (같은 조합의 다른 탭 설명 기준)' : ''}">${reqText(need)}↑</span>` : '');
    }).join(' / ');
    const tac = s.tactics.map(t => {
      const ok = t.opts.some(k => tCount(a, k) > 0);
      return `<div class="tac ${ok ? 'have' : 'miss'}">${ok ? '●' : '○'} ${t.opts.map(k => esc(tName(k))).join(' / ')}${t.copy ? ' <span class="tag">영본</span>' : ''}</div>`;
    }).join('');
    const troop = s.gen.troop || s.rows['병종'] || '';
    return `<div class="slot"><div class="gname ${meet ? 'have' : has ? 'warn' : 'miss'}">${gtxt}</div>${troop ? `<div class="troop">${esc(troop)}</div>` : ''}${tac || (d.unknownTactics ? '<div class="tac muted">전법 세부 미확인</div>' : '')}</div>`;
  };
  const rowsKeys = [...new Set(d.slots.flatMap(s => Object.keys(s.rows)))];
  const hasBooks = d.slots.some(s => s.books.length);
  const more = (hasBooks || rowsKeys.length) ? `<details class="more"><summary>병법 · 병종 · 장비 · 스탯</summary><table>
    <tr><th></th>${d.slots.map(s => `<th style="width:auto">${esc(s.gen ? s.gen.opts.map(gName).join('/') : '')}</th>`).join('')}</tr>
    ${hasBooks ? `<tr><th>병법</th>${d.slots.map(s => `<td>${s.books.map(esc).join('<br>')}</td>`).join('')}</tr>` : ''}
    ${rowsKeys.map(rk => `<tr><th>${esc(rk)}</th>${d.slots.map(s => `<td>${esc(s.rows[rk] || '')}</td>`).join('')}</tr>`).join('')}
  </table></details>` : '';
  const inLineup = a.lineup.includes(d.id);
  const missLine = [
    ck.missG.length ? `<div class="small miss">없는 무장: ${ck.missG.map(esc).join(', ')}</div>` : '',
    ck.missT.length ? `<div class="small miss">없는 전법: ${ck.missT.map(m => esc(m.label)).join(', ')}</div>` : '',
    ck.missS.length ? `<div class="small warn">돌파·품 부족: ${ck.missS.map(m => `${esc(m.label)} ${esc(m.have)} → ${esc(m.need)}`).join(', ')}</div>` : '',
  ].join('');
  return `<div class="card ${st}">
    <div class="card-h"><h3>${d.tierLabel ? `<span class="tier">${esc(d.tierLabel)}</span>` : ''}${esc(d.name)}</h3><span class="status ${st}">${d.unknownTactics && st === 'ok' ? '무장 보유' : STATUS_LABEL[st]}</span></div>
    <div><span class="tag">${esc(KIND_LABEL[d.kind] || d.kind)}</span>${d.group ? `<span class="tag">${esc(d.group)}</span>` : ''}${d.choiceTag ? `<span class="tag">${esc(d.choiceTag)}</span>` : ''}${d.formation ? `<span class="tag">${esc(d.formation)}</span>` : ''}${d.url ? `<a class="tag" href="${esc(d.url)}" target="_blank" rel="noopener">출처</a>` : ''}</div>
    ${d.desc ? `<div class="desc">${esc(d.desc)}</div>` : ''}
    <div class="slots">${d.slots.map(slot).join('')}</div>
    ${missLine}
    ${d.note ? `<div class="desc">${esc(d.note)}</div>` : ''}
    ${more}
    ${opts.noActions ? '' : `<div class="card-f"><span class="small muted">${esc(d.src)}</span><span>
      ${d.customId ? `<button class="btn small" data-act="delCustom" data-id="${esc(d.customId)}">삭제</button>` : ''}
      <button class="btn small ${inLineup ? '' : 'primary'}" data-act="toggleLineup" data-id="${esc(d.id)}">${inLineup ? '편성에서 빼기' : `${esc(a.name)} 편성에 추가`}</button></span></div>`}
  </div>`;
}

// ───────────────────────── 렌더: 추천 덱 ─────────────────────────
function viewDecks() {
  const a = acct(), u = state.ui;
  const srcF = { main: d => d.kind === 'tier' || d.kind === 'variant' || d.kind === 'simple' || d.kind === 'custom' || d.kind === 'research', sheet: d => d.kind === 'tier' || d.kind === 'variant', research: d => d.kind === 'research', all: () => true, tier: d => d.kind === 'tier', variant: d => d.kind === 'variant', coexist: d => d.kind === 'coexist', community: d => d.kind === 'community', custom: d => d.kind === 'custom' || d.kind === 'simple' };
  const q = key(u.q);
  let list = DECKS.filter(srcF[u.src] || srcF.main).map(d => ({ d, c: check(d, a) }));
  if (q) list = list.filter(({ d }) => key(d.name + d.group + d.slots.map(s => (s.gen ? s.gen.opts.map(gName).join('') : '') + s.tactics.map(t => t.opts.map(tName).join('')).join('')).join('')).includes(q));
  const cnt = { ok: 0, stars: 0, tactic: 0, general: 0 }; list.forEach(x => cnt[x.c.status]++);
  if (u.status !== 'all') list = list.filter(x => x.c.status === u.status);
  list.sort((x, y) => STATUS_ORDER[x.c.status] - STATUS_ORDER[y.c.status] || (x.d.tier ?? 9) - (y.d.tier ?? 9));
  // 가장 많은 덱을 열어주는 전법/무장/돌파
  const unlockT = {}, unlockG = {}, unlockS = {};
  for (const d of DECKS.filter(srcF.main)) {
    const c = check(d, a);
    if (c.status === 'stars') c.missS.forEach(m => { const lb = `${m.label} ${m.need}`; unlockS[lb] = (unlockS[lb] || 0) + 1; });
    if (c.status === 'tactic' && c.missT.length === 1) { const lb = c.missT[0].label; unlockT[lb] = (unlockT[lb] || 0) + 1; }
    if (c.status === 'general' && c.missG.length === 1 && !c.missT.length) unlockG[c.missG[0]] = (unlockG[c.missG[0]] || 0) + 1;
  }
  const top = o => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => `<span class="tag">${esc(k)} +${n}</span>`).join('') || '<span class="small muted">없음</span>';
  const ownedN = Object.values(a.generals).filter(g => g.owned).length, tacN = Object.values(a.tactics).filter(n => n > 0).length;
  return `
  ${ownedN === 0 ? `<div class="hint">먼저 <b>보유 관리</b> 탭에서 ${esc(a.name)}의 무장과 전법을 선택하세요. 선택하면 아래 덱마다 구성 가능 여부가 표시됩니다.</div>` : ''}
  <div class="stats">
    <div class="stat"><span class="small muted">구성 가능</span><b class="have">${cnt.ok}</b></div>
    <div class="stat"><span class="small muted">돌파·품 부족</span><b class="warn">${cnt.stars}</b></div>
    <div class="stat"><span class="small muted">전법 부족</span><b style="color:var(--warn)">${cnt.tactic}</b></div>
    <div class="stat"><span class="small muted">무장 부족</span><b class="miss">${cnt.general}</b></div>
    <div class="stat"><span class="small muted">보유 무장 / 전법</span><b>${ownedN} / ${tacN}</b></div>
  </div>
  <div class="hint small"><b>이것만 있으면 바로 열리는 덱</b> — 전법: ${top(unlockT)} &nbsp; 무장: ${top(unlockG)} &nbsp; 돌파·품: ${top(unlockS)}</div>
  ${cnt.stars ? `<div class="hint small">일부 덱은 시트 설명에 돌파·승품 조건(예: 마운록 4돌 2품 이상)이 있습니다. <b>보유 관리</b>에서 <b>탭=돌파+1</b>, <b>탭=품+1</b>로 입력해야 정확히 판정됩니다. 입력하지 않은 무장은 0돌 0품으로 봅니다. 인구가 적은 서버라면 <b>서버: 시골섭 완화</b>를 고르면 시트에 적힌 완화 조건(예: 시골섭 3돌 1품)으로 판정합니다.</div>` : ''}
  <div class="bar">
    <input type="search" placeholder="덱·무장·전법 검색" value="${esc(u.q)}" data-model="q">
    ${serverSelect(a, state.active)}
    <select data-model="src">
      ${[['main', '시트+추가 조사+내 덱'], ['sheet', '시트 (티어+변칙)'], ['research', '추가 조사'], ['tier', '티어덱'], ['variant', '변칙·계열덱'], ['coexist', '공존덱 구성'], ['community', '커뮤니티(세부 미확인)'], ['custom', '내 덱'], ['all', '전체']].map(([v, l]) => `<option value="${v}" ${u.src === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <div class="seg">${[['all', '전체'], ['ok', '가능'], ['stars', '돌파·품 부족'], ['tactic', '전법 부족'], ['general', '무장 부족']].map(([v, l]) => `<button data-act="set" data-k="status" data-v="${v}" class="${u.status === v ? 'on' : ''}">${l}</button>`).join('')}</div>
  </div>
  ${list.length ? `<div class="grid">${list.map(x => deckCard(x.d, a)).join('')}</div>` : '<div class="empty">조건에 맞는 덱이 없습니다.</div>'}
  `;
}

// ───────────────────────── 렌더: 보유 관리 ─────────────────────────
// ───────────────────────── 캡처 이미지로 보유 입력 (브라우저 OCR) ─────────────────────────
// 게임 화면 캡처를 붙여넣으면(Ctrl+V) 한국어 OCR(Tesseract.js, 브라우저 안에서 실행)로 글자를 읽고,
// 사이트에 있는 무장·전법 이름과 맞춰 본 뒤 확인 목록을 보여줍니다. 저장은 확인 후에만 합니다.
const OCR_LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const ocr = { status: 'idle', msg: '', img: '', items: [], raw: '' };
let ocrWorker = null;
function loadScript(src) {
  return new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('OCR 라이브러리를 불러오지 못했습니다')); document.head.appendChild(s); });
}
function ocrSet(patch) { Object.assign(ocr, patch); if (state.ui.tab === 'own') render(); }
async function ocrPrep(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.max(1, Math.min(3, 1800 / bmp.width));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
  const invert = sum / (d.length / 4) < 128;                 // 어두운 게임 화면 → 흰 글씨를 검은 글씨로
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    if (invert) v = 255 - v;
    v = Math.max(0, Math.min(255, (v - 128) * 1.6 + 128));   // 대비 높이기
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  x.putImageData(im, 0, 0);
  return c;
}
const ocrNorm = s => String(s).toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
function lev(a, b) {
  const m = a.length, n = b.length, dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
// 글자 위치를 이용해 이름과 돌·품을 짝지읍니다.
// - 이름: 같은 줄의 단어 1~3개를 이어 붙여 비교 (공백이 있는 '연의 원소', '침략 방어' 대응). 긴 이름부터 찾고,
//   4글자 이상만 한 글자 틀림을 허용합니다(짧은 이름은 오인식이 많아 정확히 일치할 때만).
// - 돌·품: '3돌', '4 돌', ']품'(1을 잘못 읽은 것) 같은 단어를 찾아, 이름의 오른쪽이나 바로 아래에 있는 가장 가까운 이름에 붙입니다.
const OCR_DIGIT = { ']': 1, '|': 1, 'l': 1, 'I': 1, 'i': 1, '!': 1, 'O': 0, 'o': 0 };
function ocrWords(data) {
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push((l.words || []).filter(w => w.text.trim()));
  if (!lines.length && data.words) lines.push(data.words);
  return lines.filter(l => l.length);
}
function ocrMatch(data) {
  const cands = [
    ...[...G.values()].filter(e => (e.season || 0) <= MAX_SEASON && (e.used || e.roster)).map(e => ({ kind: 'g', key: e.key, name: e.name, k: ocrNorm(e.name) })),
    ...[...T.values()].map(e => ({ kind: 't', key: e.key, name: e.name, k: ocrNorm(e.name) })),
  ].filter(c => c.k.length >= 2).sort((x, y) => y.k.length - x.k.length);
  const lines = ocrWords(data);
  const box = ws => ({ x0: Math.min(...ws.map(w => w.bbox.x0)), y0: Math.min(...ws.map(w => w.bbox.y0)), x1: Math.max(...ws.map(w => w.bbox.x1)), y1: Math.max(...ws.map(w => w.bbox.y1)) });
  const names = [], levels = [];
  for (const ws of lines) {
    const used = new Set();
    // 돌·품 단어
    ws.forEach((w, i) => {
      let t = w.text.replace(/\s/g, ''), m = t.match(/([0-9\]|lIi!Oo])(돌|품)/);
      if (!m && /^(돌|품)/.test(t) && i > 0) { const pv = ws[i - 1].text.trim().slice(-1); if (/[0-9\]|lIi!Oo]/.test(pv)) m = [null, pv, t[0]]; }
      if (!m) return;
      const v = /\d/.test(m[1]) ? +m[1] : OCR_DIGIT[m[1]];
      if (v == null) return;
      levels.push({ type: m[2] === '돌' ? 's' : 'p', v, b: w.bbox });
    });
    // 이름
    for (const c of cands) {
      const L = c.k.length;
      outer: for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= ws.length; i++) {
        const idx = Array.from({ length: n }, (_, j) => i + j);
        if (idx.some(j => used.has(j))) continue;
        const span = ocrNorm(idx.map(j => ws[j].text).join(''));
        const at = span.indexOf(c.k);
        const fuzzy = at < 0 && L >= 4 && Math.abs(span.length - L) <= 1 && lev(span, c.k) <= 1;
        if (at < 0 && !fuzzy) continue;
        if (at >= 0 && span.length > L + 3 && n > 1) continue;      // 너무 긴 묶음 안의 우연한 일치는 제외
        idx.forEach(j => used.add(j));
        names.push({ kind: c.kind, key: c.key, name: c.name, exact: !fuzzy, line: idx.map(j => ws[j].text).join(' '), b: box(idx.map(j => ws[j])) });
        break outer;
      }
    }
  }
  // 돌·품을 가장 가까운 무장 이름에 붙이기 (오른쪽 같은 줄 또는 아래 3줄 이내)
  const gens = names.filter(n => n.kind === 'g');
  for (const lv of levels) {
    let best = null, bd = Infinity;
    const cx = (lv.b.x0 + lv.b.x1) / 2, cy = (lv.b.y0 + lv.b.y1) / 2;
    for (const n of gens) {
      const w = n.b.x1 - n.b.x0, h = Math.max(8, n.b.y1 - n.b.y0);
      const right = cy >= n.b.y0 - h * 0.5 && cy <= n.b.y1 + h * 0.5 && cx >= n.b.x0 && cx <= n.b.x1 + w * 2 + 40;
      const below = cy > n.b.y1 - h * 0.3 && cy <= n.b.y1 + h * 3.5 && cx >= n.b.x0 - w * 0.6 - 20 && cx <= n.b.x1 + w * 0.6 + 20;
      if (!right && !below) continue;
      const d = Math.hypot(cx - (n.b.x0 + n.b.x1) / 2, cy - (n.b.y0 + n.b.y1) / 2);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) best[lv.type === 's' ? 'stars' : 'grade'] = Math.min(lv.type === 's' ? MAX_STARS : MAX_GRADE, lv.v);
  }
  const found = new Map();
  for (const n of names) { const p = found.get(n.key); if (!p || (n.exact && !p.exact) || (n.stars ?? -1) > (p.stars ?? -1)) found.set(n.key, n); }
  const a = acct();
  return [...found.values()].map(it => {
    if (it.kind === 'g') {
      // 같은 이름의 SP·연의 무장이 있으면 고를 수 있게 (OCR이 'SP', '연의'를 빠뜨리는 경우가 많음)
      const base = it.key.replace(/^(sp|연의)/, '');
      const alts = [...G.values()].filter(e => (e.season || 0) <= MAX_SEASON && (e.key === base || e.key === 'sp' + base || e.key === '연의' + base)).map(e => e.key);
      it.alts = alts.length > 1 ? alts.sort((x, y) => x.length - y.length) : null;
    }
    if (it.kind === 'g') { const g = a.generals[it.key] || {}; return { kind: 'g', alts: it.alts, key: it.key, name: it.name, exact: it.exact, line: it.line, checked: true, read: [it.stars != null ? `${it.stars}돌` : '', it.grade != null ? `${it.grade}품` : ''].filter(Boolean).join(' '), cur: g.owned ? reqText({ s: g.stars || 0, p: g.grade || 0 }) || '0돌' : '', stars: it.stars ?? (g.stars || 0), grade: it.grade ?? (g.grade || 0) }; }
    const n = tCount(a, it.key); return { kind: 't', key: it.key, name: it.name, exact: it.exact, line: it.line, checked: true, cur: n ? `${n}개` : '', count: Math.max(1, n) };
  }).sort((x, y) => (x.kind === y.kind ? byKoName(x, y) : x.kind === 'g' ? -1 : 1));
}
async function ocrRun(blob) {
  if (!blob || !/^image\//.test(blob.type)) return toast('이미지가 아닙니다');
  ocrSet({ status: 'loading', msg: '이미지 준비 중', img: URL.createObjectURL(blob), items: [], raw: '' });
  try {
    const canvas = await ocrPrep(blob);
    if (!ocrWorker) {
      ocrSet({ msg: '글자 인식 도구 불러오는 중 (처음 한 번, 약 2MB)' });
      await loadScript(OCR_LIB);
      ocrWorker = await window.Tesseract.createWorker('kor', 1, {
        logger: m => { if (m.status === 'recognizing text') { const el = document.getElementById('ocrMsg'); if (el) el.textContent = `글자 읽는 중 ${Math.round(m.progress * 100)}%`; } },
      });
    }
    ocrSet({ status: 'reading', msg: '글자 읽는 중' });
    const { data } = await ocrWorker.recognize(canvas, {}, { text: true, blocks: true });
    const items = ocrMatch(data);
    ocrSet({ status: 'done', raw: String(data.text || '').trim(), items, msg: items.length ? `${items.length}개를 찾았습니다. 맞는지 확인하고 저장하세요.` : '아는 무장·전법 이름을 찾지 못했습니다. 이름이 크게 보이도록 다시 캡처해 보세요.' });
  } catch (e) { ocrSet({ status: 'error', msg: '인식 실패: ' + e.message }); }
}
function ocrPanel() {
  const busy = ocr.status === 'loading' || ocr.status === 'reading';
  const g = ocr.items.filter(i => i.kind === 'g'), t = ocr.items.filter(i => i.kind === 't');
  const opt = (n, v, unit) => range0(n).map(x => `<option value="${x}" ${x === v ? 'selected' : ''}>${x}${unit}</option>`).join('');
  const row = (it, i) => `<tr class="${it.checked ? '' : 'off'}">
    <td><input type="checkbox" data-ocr="checked" data-i="${i}" ${it.checked ? 'checked' : ''}></td>
    <td>${it.alts ? `<select data-ocr="key" data-i="${i}" title="SP·연의 무장인지 확인하세요">${it.alts.map(k => `<option value="${esc(k)}" ${k === it.key ? 'selected' : ''}>${esc(gName(k))}</option>`).join('')}</select>` : `<b>${esc(it.name)}</b>`}${it.exact ? '' : ' <span class="tag" title="글자 하나가 다르게 읽혔지만 가장 가까운 이름">비슷</span>'}${it.read ? ` <span class="tag" title="캡처에서 읽은 값">읽음 ${esc(it.read)}</span>` : ''}${it.cur ? ` <span class="small muted">현재 ${esc(it.cur)}</span>` : ' <span class="small have">새로 추가</span>'}</td>
    <td>${it.kind === 'g'
      ? `<select data-ocr="stars" data-i="${i}">${opt(MAX_STARS, it.stars, '돌')}</select> <select data-ocr="grade" data-i="${i}">${opt(MAX_GRADE, it.grade, '품')}</select>`
      : `<select data-ocr="count" data-i="${i}"><option value="1" ${it.count === 1 ? 'selected' : ''}>1개</option><option value="2" ${it.count === 2 ? 'selected' : ''}>2개(영본)</option></select>`}</td>
    <td class="small muted ocr-line" title="${esc(it.line)}">${esc(it.line)}</td></tr>`;
  const idx = it => ocr.items.indexOf(it);
  return `<div class="hint ocr">
    <div class="bar" style="margin:0">
      <b>캡처로 입력</b>
      <span class="small muted">게임 화면을 캡처(Win+Shift+S)한 뒤 이 화면에서 <b>Ctrl+V</b> · 이미지 끌어놓기 · </span>
      <label class="btn small">파일 고르기<input type="file" accept="image/*" id="ocrFile" hidden></label>
      ${ocr.status !== 'idle' && !busy ? '<button class="btn small" data-act="ocrClear">닫기</button>' : ''}
    </div>
    ${ocr.status !== 'idle' ? `<div class="ocr-body">
      ${ocr.img ? `<img src="${ocr.img}" alt="붙여넣은 캡처" class="ocr-img">` : ''}
      <div class="ocr-res">
        <p class="small ${ocr.status === 'error' ? 'miss' : 'muted'}" id="ocrMsg">${esc(ocr.msg)}</p>
        ${ocr.items.length ? `<table class="ocr-t">
          ${g.length ? `<tr><th colspan="4">무장 (${esc(acct().name)})</th></tr>${g.map(it => row(it, idx(it))).join('')}` : ''}
          ${t.length ? `<tr><th colspan="4">전법 (${esc(acct().name)})</th></tr>${t.map(it => row(it, idx(it))).join('')}` : ''}
        </table>
        <div class="bar" style="margin-top:8px"><button class="btn primary" data-act="ocrApply">선택한 ${ocr.items.filter(i => i.checked).length}개 보유로 저장</button><span class="small muted">체크한 것만 저장하고, 목록에 없는 기존 보유는 그대로 둡니다.</span></div>` : ''}
        ${ocr.raw ? `<details class="small"><summary>읽은 글자 전체 보기</summary><pre class="ocr-raw">${esc(ocr.raw)}</pre></details>` : ''}
      </div></div>` : ''}
  </div>`;
}
function ocrApply() {
  const a = acct(); let n = 0;
  for (const it of ocr.items) {
    if (!it.checked) continue;
    if (it.kind === 'g') a.generals[it.key] = { owned: true, stars: +it.stars || 0, grade: +it.grade || 0 };
    else a.tactics[it.key] = Math.max(1, Math.min(2, +it.count || 1));
    n++;
  }
  ocr.status = 'idle'; ocr.items = []; ocr.img = ''; ocr.raw = '';
  persist(); render(); toast(`${a.name}: ${n}개 보유로 저장했습니다`);
}
document.addEventListener('paste', e => {
  if (state.ui.tab !== 'own') return;
  const f = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (!f) return;                                   // 글자 붙여넣기는 그대로 둠
  e.preventDefault(); ocrRun(f.getAsFile());
});
document.addEventListener('dragover', e => { if (state.ui.tab === 'own' && [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) e.preventDefault(); });
document.addEventListener('drop', e => {
  if (state.ui.tab !== 'own') return;
  const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); ocrRun(f); }
});

// 가나다순: 공백 무시, 'SP 제갈량'은 '제갈량' 바로 뒤에 오도록 SP를 빼고 비교
const koSortKey = n => String(n).replace(/^sp\s*/i, '').replace(/\s+/g, '') + (/^sp/i.test(n) ? '\uffff' : '');
const byKoName = (x, y) => koSortKey(x.name).localeCompare(koSortKey(y.name), 'ko');
function viewOwn() {
  const a = acct(), u = state.ui, q = key(u.ownQ);
  const head = `
  <div class="bar">
    <input type="text" value="${esc(a.name)}" data-act-input="rename" style="max-width:160px" title="계정 이름">
    ${serverSelect(a, state.active)}
    <div class="seg">${[['generals', '무장'], ['tactics', '전법']].map(([v, l]) => `<button data-act="set" data-k="ownTab" data-v="${v}" class="${u.ownTab === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${u.ownTab === 'generals' ? `<div class="seg">${[['own', '탭=보유'], ['stars', '탭=돌파+1'], ['grade', '탭=품+1']].map(([v, l]) => `<button data-act="set" data-k="ownMode" data-v="${v}" class="${u.ownMode === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
    <input type="search" placeholder="이름 검색" value="${esc(u.ownQ)}" data-model="ownQ">
    <label class="small"><input type="checkbox" data-act="toggleUsedOnly" ${u.ownUsedOnly ? 'checked' : ''}> 덱에 쓰이는 것만</label>
  </div>
  <div class="bar">
    <select data-act-input="copyFrom"><option value="">다른 계정에서 복사…</option>${state.accounts.map((x, i) => i === state.active ? '' : `<option value="${i}">${esc(x.name)}의 ${u.ownTab === 'generals' ? '무장' : '전법'} 복사</option>`).join('')}</select>
    <button class="btn" data-act="clearOwn">${u.ownTab === 'generals' ? '무장' : '전법'} 전체 해제</button>
  </div>
  ${ocrPanel()}
  <details class="hint"><summary>여러 개 한 번에 입력 (이름 붙여넣기)</summary>
    <p class="small muted">쉼표·줄바꿈으로 구분해 이름을 붙여넣으면 보유로 표시합니다. ${u.ownTab === 'tactics' ? '전법 이름 뒤에 <b>*2</b>를 붙이면 영본까지 2개 보유로 저장합니다. 예: 침략방어*2, 기선제압' : '이름 뒤에 <b>:돌파</b> 또는 <b>:돌파:품</b>을 붙이면 함께 저장합니다. 예: 마초:3, 마운록:4:2, 강유'}</p>
    <textarea rows="3" id="bulkIn"></textarea>
    <div class="bar" style="margin-top:6px"><button class="btn primary" data-act="bulkApply">적용</button><span class="small muted" id="bulkMsg"></span></div>
  </details>`;
  const sortBar = `<div class="bar"><span class="small muted">정렬</span><div class="seg">${[['name', '가나다순'], ['used', '사용 덱 수']].map(([v, l]) => `<button data-act="set" data-k="ownSort" data-v="${v}" class="${u.ownSort === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  const sorter = u.ownSort === 'used' ? ((x, y) => y.used - x.used || byKoName(x, y)) : byKoName;
  const section = (label, items, isOwned, chip) => items.length
    ? `<div class="section-t">${label} (보유 ${items.filter(isOwned).length}/${items.length})</div><div class="chips">${items.sort(sorter).map(chip).join('')}</div>` : '';
  if (u.ownTab === 'generals') {
    let gens = [...G.values()].filter(e => (e.season || 0) <= MAX_SEASON);
    if (u.ownUsedOnly) gens = gens.filter(e => e.used > 0 || ownsG(a, e.key));
    if (q) gens = gens.filter(e => e.key.includes(q));
    const chip = e => {
      const g = a.generals[e.key] || {};
      const tip = [e.season ? `시즌${e.season}` : '', e.skill, e.type, e.cat].filter(Boolean).join(' · ') + (e.desc ? '\n' + e.desc : '');
      return `<button class="chip ${g.owned ? 'on' : ''} ${e.used ? '' : 'dim'}" data-act="gen" data-k="${esc(e.key)}" title="${esc(tip)}">${esc(e.name)}${g.owned && (g.stars || g.grade) ? `<span class="st">${reqText({ s: g.stars || 0, p: g.grade || 0 })}</span>` : ''}${e.used ? `<span class="n">${e.used}</span>` : ''}</button>`;
    };
    // 시즌별 묶음: 연의 무장은 따로, 도감에 없는 무장은 '기타'
    const groupsDef = [['S3 연의 무장', e => /^연의/.test(e.key)], ['시즌3 무장', e => e.season === 3], ['시즌2 무장', e => e.season === 2], ['시즌1 무장', e => e.season === 1], ['기타 (도감 미등록)', () => true]];
    const left = new Set(gens);
    const parts = groupsDef.map(([lab, f]) => { const items = [...left].filter(f); items.forEach(x => left.delete(x)); return section(lab, items, e => ownsG(a, e.key), chip); }).join('');
    return head + sortBar + `<p class="small muted">칩을 누르면 보유/해제됩니다. 시즌별로 나눠 보여주고, 각 묶음 안은 위에서 고른 순서(가나다순 또는 많이 쓰이는 순)입니다. 오른쪽 작은 숫자는 그 무장이 쓰이는 덱 수입니다. 돌파 수는 <b>탭=돌파+1</b>, 승품은 <b>탭=품+1</b>을 고른 뒤 누르면 하나씩 올라갑니다. 돌파는 최대 ${MAX_STARS}돌, 승품은 최대 ${MAX_GRADE}품이고, 최대 다음은 0으로 돌아갑니다. 칩에 마우스를 올리면 시즌·고유 전법이 보입니다.</p>` + (parts || '<div class="empty">표시할 무장이 없습니다.</div>');
  }
  let tacs = [...T.values()];
  if (u.ownUsedOnly) tacs = tacs.filter(e => e.used > 0 || tCount(a, e.key));
  if (q) tacs = tacs.filter(e => e.key.includes(q));
  const chip = e => {
    const n = tCount(a, e.key);
    const tip = [e.ttype, e.trait, e.tseason].filter(Boolean).join(' · ') + (e.aliases ? `\n다른 자료 표기: ${[...e.aliases].join(', ')}` : '');
    return `<button class="chip ${n ? 'on' : ''} ${n > 1 ? 'two' : ''} ${e.used ? '' : 'dim'}" data-act="tac" data-k="${esc(e.key)}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(e.name)}${e.aliases ? '<span class="n">*</span>' : ''}${n > 1 ? '<span class="st">×2</span>' : ''}${e.used ? `<span class="n">${e.used}</span>` : ''}</button>`;
  };
  const TYPES = ['지휘', '액티브', '패시브', '추격'];
  const tparts = [...TYPES.map(t => section(`${t} 전법`, tacs.filter(e => e.ttype === t), e => tCount(a, e.key) > 0, chip)),
    section('유형 미확인', tacs.filter(e => !TYPES.includes(e.ttype)), e => tCount(a, e.key) > 0, chip)].join('');
  return head + sortBar + `<p class="small muted">누를 때마다 <b>없음 → 1개 → 2개(영본) → 없음</b>으로 바뀝니다. 공존덱처럼 같은 전법을 두 부대에 쓰려면 2개가 필요합니다. 유형별(지휘·액티브·패시브·추격)로 나눠 보여주고, 오른쪽 숫자는 그 전법이 쓰이는 덱 수입니다. 칩에 마우스를 올리면 특성·등장 시즌이 보입니다. <b>덱에 쓰이는 것만</b>을 끄면 S1~S3 전체 전법이 나옵니다.</p>
    ${tparts || '<div class="empty">표시할 전법이 없습니다.</div>'}
    <div class="bar" style="margin-top:14px"><input type="text" list="dlTactics" id="newTac" placeholder="목록에 없는 전법 직접 추가"><button class="btn" data-act="addTac">추가</button></div>`;
}

// ───────────────────────── 렌더: 계정별 편성 ─────────────────────────
function lineupDecks(a) { return a.lineup.map(id => DECKS.find(d => d.id === id)).filter(Boolean); }
function lineupConflicts(a) {
  const decks = lineupDecks(a), useG = {}, useT = {};
  // 실제 사용할 구성: 앞에서부터 가능한 대체안을 고름
  const usedG = new Set(), usedT = {}, res = {};
  for (const d of decks) {
    const rs = realizations(d, a);
    const r = rs.find(x => fits(x, usedG, usedT, a));
    if (r) { r.g.forEach(k => usedG.add(k)); for (const [k, n] of Object.entries(r.t)) usedT[k] = (usedT[k] || 0) + n; res[d.id] = { ok: true }; }
    else {
      const why = [];
      if (!rs.length) {
        const c = check(d, a);
        if (c.status === 'stars') c.missS.forEach(m => why.push(`${m.label} ${m.need} 필요 (현재 ${m.have})`));
        else why.push(c.status === 'general' ? '무장 미보유' : '전법 미보유');
      }
      else {
        d.slots.forEach(s => s.gen && s.gen.opts.every(k => usedG.has(k) || !ownsG(a, k)) && why.push(`${s.gen.opts.map(gName).join('/')} 중복`));
        d.slots.forEach(s => s.tactics.forEach(t => t.opts.every(k => (usedT[k] || 0) >= tCount(a, k)) && why.push(`${t.opts.map(tName).join('/')} 부족`)));
      }
      res[d.id] = { ok: false, why: why.length ? why : ['다른 부대와 겹침'] };
    }
  }
  return res;
}
function viewLineup() {
  const cols = state.accounts.map((a, i) => {
    const decks = lineupDecks(a), conf = lineupConflicts(a);
    const item = d => {
      const c = conf[d.id];
      return `<div class="lu-item ${c.ok ? '' : 'conflict'}"><div class="row"><b>${d.tierLabel ? `<span class="tier">${esc(d.tierLabel)}</span>` : ''}${esc(d.name)}</b>
        <span><button class="btn small" data-act="luUp" data-a="${i}" data-id="${esc(d.id)}">▲</button> <button class="btn small" data-act="luDel" data-a="${i}" data-id="${esc(d.id)}">✕</button></span></div>
        <div class="mem">${d.slots.map(s => `${esc(s.gen ? s.gen.opts.map(gName).join('/') : '')}${s.tactics.length ? ` (${s.tactics.map(t => esc(t.opts.map(tName).join('/'))).join(', ')})` : ''}`).join(' · ')}</div>
        ${c.ok ? '' : `<div class="small miss">${c.why.map(esc).join(', ')}</div>`}</div>`;
    };
    return `<div class="card"><div class="card-h"><h3>${esc(a.name)}</h3><span class="small muted">${decks.length}/${a.squads} 부대</span></div>
      <div class="bar" style="margin:8px 0 0">
        ${serverSelect(a, i)}
        <label class="small">부대 수 <select data-act-input="squads" data-a="${i}">${[1, 2, 3, 4, 5].map(n => `<option ${a.squads === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn small primary" data-act="auto" data-a="${i}">자동 추천 편성</button>
        <button class="btn small" data-act="luClear" data-a="${i}">비우기</button>
      </div>
      ${decks.length ? decks.map(item).join('') : '<div class="empty small">편성이 비어 있습니다.<br>자동 추천을 누르거나 추천 덱 탭에서 추가하세요.</div>'}
    </div>`;
  });
  return `<div class="hint small"><b>자동 추천 편성</b>은 보유 무장·전법으로 만들 수 있는 덱 중에서 무장이 겹치지 않고 전법 보유 수(영본 포함)를 넘지 않게, 부대 수만큼 티어가 높은 덱을 고릅니다. 대상은 티어덱·변칙덱·공존덱·내 덱입니다. 편성은 직접 추가·삭제·순서 변경도 할 수 있고, 겹치는 부대는 빨간색으로 표시됩니다.</div>
    <div class="cols">${cols.join('')}</div>`;
}

// ───────────────────────── 렌더: 공존 프리셋 ─────────────────────────
function presetPick(p, a) {
  let best = [];
  for (const opt of p.options || [p.decks]) { const pick = solve(opt, a, p.need); if (pick.length > best.length) best = pick; }
  return best;
}
function viewCoexist() {
  if (!COEXIST.length) return '<div class="empty">공존덱 데이터가 없습니다.</div>';
  return `<div class="hint small">시트의 공존덱 묶음입니다. 계정마다 묶음 전체를 <b>동시에</b> 구성할 수 있는지(무장 중복 없음, 전법 수량 충족) 확인합니다. 덱이 필요 수보다 많은 묶음은 그중 필요 수만큼 만들 수 있는지를 봅니다.</div>
  <div class="grid">${COEXIST.map((p, pi) => {
    const rows = state.accounts.map((a, ai) => {
      const pick = presetPick(p, a);
      const ok = pick.length >= p.need;
      return `<div class="row" style="display:flex;justify-content:space-between;gap:6px;margin-top:4px"><span>${esc(a.name)}</span><span class="status ${ok ? 'ok' : pick.length ? 'tactic' : 'general'}">${pick.length}/${p.need} 가능</span>
        ${ok ? `<button class="btn small" data-act="applyPreset" data-p="${pi}" data-a="${ai}">편성에 적용</button>` : ''}</div>`;
    }).join('');
    return `<div class="card"><h3 style="margin:0 0 4px;font-size:15px">${esc(p.name)}</h3><div class="small muted">${esc(p.src)} · 필요 ${p.need}부대${p.choose ? ` (덱 ${p.decks.length}개 중 선택)` : ''}</div>
      <div class="chips" style="margin:8px 0">${p.decks.map(d => `<span class="tag" title="${esc(d.slots.map(s => s.gen ? s.gen.opts.map(gName).join('/') : '').join(' · '))}">${d.tierLabel ? esc(d.tierLabel) + ' ' : ''}${esc(d.name)}${d.choiceTag ? ' (택1)' : ''}</span>`).join('')}</div>${rows}
      <details class="more"><summary>덱 상세 (${esc(acct().name)} 기준)</summary>${p.decks.map(d => deckCard(d, acct(), { noActions: true })).join('')}</details></div>`;
  }).join('')}</div>`;
}

// ───────────────────────── 렌더: 데이터·설정 ─────────────────────────
function cloudSection() {
  const c = Cloud.cfg;
  return `<h2>공유 저장소 (여러 기기에서 같이 관리)</h2>
  <div class="hint small">덕구·부계정의 보유 무장·전법, 편성, 내 덱, 시트 설정을 GitHub 저장소의 파일 하나(<code>${esc(c.repo)}</code>의 <code>${esc(c.branch)}</code> 브랜치 <code>${esc(c.path)}</code>)에 저장합니다.
  <b>읽기</b>는 누구나 바로 되고, <b>저장</b>하려면 기기마다 한 번 GitHub 토큰을 넣어야 합니다. 토큰은 이 브라우저에만 보관됩니다.<br>
  토큰 만들기: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained token</a> → Repository access: <b>Only select repositories</b>에서 이 저장소만 선택 → Permissions → Contents: <b>Read and write</b> → Generate.<br>
  저장소가 공개라서 공유 파일 내용(보유 무장·편성)도 공개됩니다.</div>
  <div class="form-grid">
    <div class="fld"><label>저장소 (아이디/이름)</label><input id="cRepo" value="${esc(c.repo)}"></div>
    <div class="fld"><label>브랜치</label><input id="cBranch" value="${esc(c.branch)}"></div>
    <div class="fld"><label>파일 경로</label><input id="cPath" value="${esc(c.path)}"></div>
  </div>
  <div class="fld"><label>GitHub 토큰 (저장할 때만 필요)</label><input id="cToken" type="password" autocomplete="off" value="${esc(c.token)}" placeholder="github_pat_..."></div>
  <label class="small"><input type="checkbox" id="cOn" ${c.enabled ? 'checked' : ''}> 공유 저장소 사용</label>
  <div class="bar" style="margin-top:8px">
    <button class="btn primary" data-act="cloudSave">설정 저장 후 연결</button>
    <button class="btn" data-act="cloudPull">지금 동기화</button>
    <button class="btn" data-act="cloudAdopt">공유 내용으로 바꾸기</button>
    <button class="btn" data-act="cloudUpload">이 브라우저 내용 올리기</button>
  </div>
  <p class="small muted" id="cloudMsg"></p>
  <div class="card" style="margin-top:10px">
    <b>공유 비밀번호</b> <span class="small muted">— 토큰을 기기마다 넣지 않고, 비밀번호만으로 어느 브라우저에서든 저장할 수 있게 합니다.</span>
    ${c.token ? `<p class="small muted">이 브라우저의 토큰을 비밀번호로 암호화해 저장소(<code>${esc(c.branch)}/auth.json</code>)에 올립니다. 다른 브라우저에서는 입장 화면이나 아래 칸에 비밀번호를 넣으면 됩니다. 암호문은 공개되므로 <b>8자 이상, 다른 곳에 안 쓰는 비밀번호</b>를 쓰세요. 비밀번호를 바꾸려면 다시 올리면 됩니다.</p>
    <div class="form-grid"><div class="fld"><label>공유 비밀번호</label><input type="password" id="cPw1" autocomplete="new-password"></div>
    <div class="fld"><label>한 번 더</label><input type="password" id="cPw2" autocomplete="new-password"></div>
    <div class="fld"><label>&nbsp;</label><button class="btn primary" data-act="cloudLock">비밀번호로 잠가 올리기</button></div></div>`
    : `<p class="small muted">공유 비밀번호를 알면 토큰 없이도 이 브라우저에서 저장할 수 있습니다.</p>
    <div class="bar"><input type="password" id="cPwIn" placeholder="공유 비밀번호" autocomplete="current-password"><button class="btn primary" data-act="cloudUnlock">저장 권한 받기</button></div>`}
  </div>`;
}
function viewData() {
  const sh = state.sheet;
  const tabsRows = sh.tabs.map((t, i) => `<tr>
    <td><input value="${esc(t.name)}" data-tabcfg="${i}" data-f="name"></td>
    <td><input value="${esc(t.gid)}" data-tabcfg="${i}" data-f="gid" placeholder="비우면 탭 이름으로 찾음"></td>
    <td><select data-tabcfg="${i}" data-f="kind">${['tier', 'variant', 'coexist', 'simple', 'roster'].map(k => `<option value="${k}" ${t.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select></td>
    <td><button class="btn small" data-act="delTab" data-i="${i}">✕</button></td></tr>`).join('');
  const counts = {}; DECKS.forEach(d => counts[d.kind] = (counts[d.kind] || 0) + 1);
  return `
  <h2>구글 시트 연동</h2>
  <div class="hint small">시트를 고치면 여기서 <b>지금 업데이트</b>를 눌러 최신 내용을 받아옵니다. 시트는 <b>링크가 있는 모든 사용자: 뷰어</b>로 공유되어 있어야 합니다.
  내 시트를 쓰려면 예시 시트를 <b>파일 → 사본 만들기</b>로 복사한 뒤 링크를 아래에 붙여넣으세요. 탭 gid는 시트 URL 끝의 <code>#gid=</code> 값이고, 비워두면 탭 이름으로 찾습니다.</div>
  <div class="fld"><label>시트 링크 또는 ID</label><input id="sheetUrl" value="https://docs.google.com/spreadsheets/d/${esc(sh.id)}/"></div>
  <table class="tabs-cfg"><tr><th>탭 이름</th><th>gid</th><th>형식</th><th></th></tr>${tabsRows}</table>
  <div class="bar" style="margin-top:8px">
    <button class="btn" data-act="addTab">탭 추가</button>
    <button class="btn" data-act="resetSheet">기본값으로</button>
    <button class="btn primary" data-act="sync">지금 업데이트</button>
    <span class="small muted" id="syncMsg">마지막 업데이트: ${esc(cache.fetchedAt || '없음')} · 덱 ${DECKS.length}개 (${Object.entries(counts).map(([k, n]) => `${KIND_LABEL[k] || k} ${n}`).join(', ')}) · 무장 ${G.size} · 전법 ${T.size}</span>
  </div>
  <p class="small muted"><b>내 시트 형식</b>을 쓰는 탭은 첫 줄에 다음 열 이름이 있으면 됩니다: 덱이름, 티어, 분류, 진형, 무장1, 무장1전법1, 무장1전법2, 무장1병종, 무장1병법, 무장2…, 무장3…, 비고, 돌파조건(예: <code>마초 3돌, 마운록 4돌 2품</code>). 대체안은 <code>A/B</code>, 영본은 <code>침략방어(영본)</code>처럼 씁니다.
  <button class="btn small" data-act="exportCsv">현재 덱을 이 형식 CSV로 받기</button></p>

  <h2>내 덱 직접 추가</h2>
  <div class="card">
    <div class="form-grid">
      <div class="fld"><label>덱 이름</label><input id="cdName" placeholder="예: 월량마 변형"></div>
      <div class="fld"><label>티어 (선택)</label><input id="cdTier" placeholder="예: 0.5"></div>
      <div class="fld"><label>진형 (선택)</label><input id="cdForm" placeholder="예: 안형진"></div>
      ${[0, 1, 2].map(j => `<div><div class="fld"><label>무장 ${j + 1}</label><input list="dlGenerals" id="cdG${j}"></div>
        <div class="fld"><label>전법 1</label><input list="dlTactics" id="cdT${j}a"></div>
        <div class="fld"><label>전법 2</label><input list="dlTactics" id="cdT${j}b"></div>
        <div class="fld"><label>병종</label><input id="cdP${j}" placeholder="기병/창병/궁병/방패병"></div>
        <div class="fld"><label>필요 돌파 (선택)</label><select id="cdS${j}">${range0(MAX_STARS).map(n => `<option value="${n}">${n ? n + '돌 이상' : '조건 없음'}</option>`).join('')}</select></div>
        <div class="fld"><label>필요 승품 (선택)</label><select id="cdQ${j}">${range0(MAX_GRADE).map(n => `<option value="${n}">${n ? n + '품 이상' : '조건 없음'}</option>`).join('')}</select></div></div>`).join('')}
    </div>
    <div class="fld"><label>비고</label><input id="cdNote"></div>
    <button class="btn primary" data-act="addCustom">덱 추가</button>
  </div>

  ${cloudSection()}
  <h2>백업 / 복원</h2>
  <div class="hint small">보유 정보와 편성은 이 브라우저에만 저장됩니다. 다른 기기로 옮기거나 백업하려면 내보내기 파일을 쓰세요.</div>
  <div class="bar">
    <button class="btn" data-act="export">백업 파일 내보내기</button>
    <label class="btn">백업 불러오기<input type="file" accept=".json" id="importFile" hidden></label>
    <button class="btn" data-act="resetAll">모두 초기화</button>
    <button class="btn" data-act="lock" title="이 브라우저에 기억된 인증을 지우고 다시 인증 키를 묻습니다">다시 잠그기</button>
  </div>
  <h2>자료 출처</h2>
  <ul class="small">
    <li><a href="https://docs.google.com/spreadsheets/d/17NtAf-aULDH-RtGPlWHHTGXJdg6R3yPg87uIo-F75_I/htmlview" target="_blank" rel="noopener">삼국지 천하결전 정보 시트</a> — 시즌3 티어덱, 변칙·계열덱, 공존덱, 무장 도감 (시트 안의 원출처 표기 포함)</li>
    ${(window.RESEARCH_DECKS || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)}</a> — 무장·전법 ${s.decks.length}개 덱 수록</li>`).join('')}
    ${(window.EXTRA_DECKS || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)}</a> — 무장 구성만 텍스트로 확인 (전법은 이미지라 미수록)</li>`).join('')}
  </ul>`;
}

// ───────────────────────── 렌더 진입 ─────────────────────────
const VIEWS = { decks: viewDecks, own: viewOwn, lineup: viewLineup, coexist: viewCoexist, data: viewData };
function render() {
  renderAcctSwitch();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.ui.tab));
  const y = window.scrollY, focus = document.activeElement?.dataset?.model;
  const caret = document.activeElement?.selectionStart;
  $('#view').innerHTML = (VIEWS[state.ui.tab] || viewDecks)();
  if (focus) { const el = $(`[data-model="${focus}"]`); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch {} } }
  window.scrollTo(0, y);
  Cloud.paintStatus();
}

// ───────────────────────── 시트 동기화 (JSONP) ─────────────────────────
function gvizGrid(id, tab) {
  return new Promise((resolve, reject) => {
    const cb = '__gv_' + uid();
    const s = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${tab.name}: 응답 없음`)); }, 20000);
    function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
    window[cb] = resp => {
      cleanup();
      if (resp.status === 'error') return reject(new Error(`${tab.name}: ${(resp.errors || []).map(e => e.detailed_message || e.message).join(' ')}`));
      const grid = (resp.table.rows || []).map(r => (r.c || []).map(c => (c == null ? '' : c.f != null ? String(c.f) : c.v == null ? '' : String(c.v))));
      grid.forEach(r => { while (r.length && !String(r[r.length - 1]).trim()) r.pop(); });
      resolve(grid);
    };
    const sel = tab.gid ? `gid=${encodeURIComponent(tab.gid)}` : `sheet=${encodeURIComponent(tab.name)}`;
    s.src = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:json;responseHandler:${cb}&headers=0&${sel}`;
    s.onerror = () => { cleanup(); reject(new Error(`${tab.name}: 불러오기 실패 (공유 설정 확인)`)); };
    document.head.appendChild(s);
  });
}
async function sync() {
  const url = $('#sheetUrl').value.trim();
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/); const id = m ? m[1] : url;
  if (!id) return toast('시트 링크를 입력하세요');
  state.sheet.id = id; persist();
  const msg = $('#syncMsg'); msg.textContent = '불러오는 중…';
  try {
    const tabs = [];
    for (const t of state.sheet.tabs) { msg.textContent = `불러오는 중… ${t.name}`; tabs.push({ ...t, grid: await gvizGrid(id, t) }); }
    cache = { sheetId: id, fetchedAt: new Date().toLocaleString('ko-KR'), tabs };
    save(LS_CACHE, cache);
    buildData(); render(); toast(`업데이트 완료: 덱 ${DECKS.length}개`);
  } catch (e) { msg.textContent = '실패: ' + e.message; }
}

// ───────────────────────── 이벤트 ─────────────────────────
function cycleStars(g) { g.stars = ((g.stars || 0) + 1) % (MAX_STARS + 1); g.owned = true; }
function cycleGrade(g) { g.grade = ((g.grade || 0) + 1) % (MAX_GRADE + 1); g.owned = true; }
function bulkApply() {
  const a = acct(), txt = $('#bulkIn').value, isT = state.ui.ownTab === 'tactics';
  let okN = 0; const bad = [];
  txt.split(/[,\n、]/).map(s => s.trim()).filter(Boolean).forEach(tok => {
    const m = isT ? tok.match(/^(.*?)\s*(?:[*x×]\s*(\d))?$/) : tok.match(/^(.*?)\s*(?::\s*(\d))?\s*(?::\s*(\d))?$/);
    const k = key(m[1]); const n = m[2] ? +m[2] : null;
    if (isT) { if (!T.has(k)) reg(T, m[1]); a.tactics[k] = Math.min(2, n || 1); okN++; }
    else { if (!G.has(k)) { bad.push(m[1]); return; } const p = m[3] ? +m[3] : null;
      a.generals[k] = { owned: true, stars: n != null ? Math.min(MAX_STARS, n) : (a.generals[k]?.stars || 0), grade: p != null ? Math.min(MAX_GRADE, p) : (a.generals[k]?.grade || 0) }; okN++; }
  });
  persist(); render();
  toast(`${okN}개 적용${bad.length ? ` · 못 찾음: ${bad.join(', ')}` : ''}`);
}
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('#tabs button'); if (tabBtn) { state.ui.tab = tabBtn.dataset.tab; persist(); render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type !== 'checkbox')) return;
  const A = b.dataset.act, a = acct();
  const ai = b.dataset.a != null ? state.accounts[+b.dataset.a] : a;
  switch (A) {
    case 'acct': state.active = +b.dataset.i; break;
    case 'set': state.ui[b.dataset.k] = b.dataset.v; break;
    case 'toggleUsedOnly': state.ui.ownUsedOnly = b.checked; break;
    case 'gen': {
      const g = a.generals[b.dataset.k] || (a.generals[b.dataset.k] = { owned: false, stars: 0 });
      if (state.ui.ownMode === 'stars') cycleStars(g); else if (state.ui.ownMode === 'grade') cycleGrade(g); else g.owned = !g.owned;
      if (!g.owned) delete a.generals[b.dataset.k];
      break;
    }
    case 'tac': { const k = b.dataset.k; const n = ((a.tactics[k] || 0) + 1) % 3; if (n) a.tactics[k] = n; else delete a.tactics[k]; break; }
    case 'addTac': { const v = $('#newTac').value.trim(); if (!v) return; const ent = reg(T, v); a.tactics[ent.key] = 1; ent.fixed = true; break; }
    case 'clearOwn': if (!confirm(`${a.name}의 ${state.ui.ownTab === 'generals' ? '무장' : '전법'} 보유 표시를 모두 해제할까요?`)) return; if (state.ui.ownTab === 'generals') a.generals = {}; else a.tactics = {}; break;
    case 'bulkApply': return bulkApply();
    case 'toggleLineup': { const i = a.lineup.indexOf(b.dataset.id); if (i >= 0) a.lineup.splice(i, 1); else { a.lineup.push(b.dataset.id); toast(`${a.name} 편성에 추가 (${a.lineup.length}/${a.squads})`); } break; }
    case 'luDel': ai.lineup = ai.lineup.filter(x => x !== b.dataset.id); break;
    case 'luUp': { const i = ai.lineup.indexOf(b.dataset.id); if (i > 0) [ai.lineup[i - 1], ai.lineup[i]] = [ai.lineup[i], ai.lineup[i - 1]]; break; }
    case 'luClear': ai.lineup = []; break;
    case 'auto': {
      const cands = DECKS.filter(d => ['tier', 'variant', 'coexist', 'simple', 'custom', 'research'].includes(d.kind));
      const pick = solve(cands, ai, ai.squads);
      ai.lineup = pick.map(p => p.d.id);
      toast(pick.length ? `${ai.name}: ${pick.length}부대 편성` : `${ai.name}: 지금 보유로 만들 수 있는 덱이 없습니다`);
      break;
    }
    case 'applyPreset': { const p = COEXIST[+b.dataset.p]; const pick = presetPick(p, ai); ai.lineup = pick.map(x => x.d.id); if (ai.squads < pick.length) ai.squads = pick.length; toast(`${ai.name} 편성에 적용`); break; }
    case 'delCustom': state.customDecks = state.customDecks.filter(c => c.id !== b.dataset.id); persist(); buildData(); break;
    case 'addCustom': {
      const name = $('#cdName').value.trim(); if (!name) return toast('덱 이름을 입력하세요');
      const slots = [0, 1, 2].map(j => ({ general: $('#cdG' + j).value.trim(), t1: $(`#cdT${j}a`).value.trim(), t2: $(`#cdT${j}b`).value.trim(), troop: $('#cdP' + j).value.trim(), stars: +$('#cdS' + j).value, grade: +$('#cdQ' + j).value }));
      if (!slots.some(s => s.general)) return toast('무장을 하나 이상 입력하세요');
      state.customDecks.push({ id: uid(), name, tier: $('#cdTier').value.trim(), formation: $('#cdForm').value.trim(), note: $('#cdNote').value.trim(), slots });
      persist(); buildData(); toast('내 덱에 추가했습니다'); break;
    }
    case 'addTab': state.sheet.tabs.push({ name: '', gid: '', kind: 'simple' }); break;
    case 'delTab': state.sheet.tabs.splice(+b.dataset.i, 1); break;
    case 'resetSheet': state.sheet = JSON.parse(JSON.stringify(DEFAULT_SHEET)); break;
    case 'sync': return sync();
    case 'ocrApply': return ocrApply();
    case 'ocrClear': Object.assign(ocr, { status: 'idle', items: [], img: '', raw: '', msg: '' }); break;
    case 'cloudSave': {
      Cloud.setCfg({ repo: $('#cRepo').value.trim(), branch: $('#cBranch').value.trim() || 'data', path: $('#cPath').value.trim() || 'shared-state.json',
        token: $('#cToken').value.trim(), enabled: $('#cOn').checked });
      toast('공유 설정을 저장했습니다'); render(); Cloud.pull(); return;
    }
    case 'cloudPull': Cloud.pull(); return;
    case 'cloudLock': {
      const p1 = $('#cPw1').value, p2 = $('#cPw2').value;
      if (p1.length < 8) return toast('비밀번호는 8자 이상으로 하세요');
      if (p1 !== p2) return toast('두 비밀번호가 다릅니다');
      if (p1 === '1234') return toast('인증 키와 다른 비밀번호를 쓰세요');
      toast('암호화해서 올리는 중…');
      Cloud.publishAuth(p1).then(() => toast('공유 비밀번호를 설정했습니다. 다른 브라우저에서는 이 비밀번호로 들어오세요.'), e => toast('실패: ' + e.message));
      return;
    }
    case 'cloudUnlock': {
      const v = $('#cPwIn').value; if (!v) return;
      Cloud.unlockWith(v).then(ok => { if (ok) { toast('저장 권한을 받았습니다'); render(); Cloud.pull(); } else toast(Cloud.authExists === false ? '아직 공유 비밀번호가 설정되지 않았습니다' : '비밀번호가 맞지 않습니다'); });
      return;
    }
    case 'cloudAdopt': if (!confirm('이 브라우저의 보유·편성·내 덱을 공유 저장소의 내용으로 바꿉니다. 계속할까요?')) return; Cloud.adoptRemote(); return;
    case 'cloudUpload': if (!confirm('공유 저장소의 내용을 이 브라우저의 보유·편성·내 덱으로 덮어씁니다. 다른 사람이 입력한 내용도 바뀝니다. 계속할까요?')) return; Cloud.uploadLocal(); return;
    case 'export': {
      const blob = new Blob([JSON.stringify({ app: 'tk3-deck', version: 1, state }, null, 1)], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `천하결전-덱관리-백업-${new Date().toISOString().slice(0, 10)}.json`; l.click(); return;
    }
    case 'exportCsv': return exportCsv();
    case 'lock': try { localStorage.removeItem(LS_AUTH); } catch {} location.reload(); return;
    case 'resetAll': if (!confirm(`모든 계정의 보유 정보, 편성, 내 덱을 지웁니다.${Cloud.cfg.token && Cloud.cfg.enabled ? ' 공유 저장소에도 반영되어 다른 기기에서도 지워집니다.' : ''} 계속할까요?`)) return;
      state = { accounts: ACCOUNT_NAMES.map((_, i) => newAccount(i)), active: 0, sheet: DEFAULT_SHEET, customDecks: [], ui: state.ui }; buildData(); break;
    default: return;
  }
  persist(); render();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.model) { state.ui[t.dataset.model] = t.value; persist(); render(); }
  else if (t.dataset.tabcfg != null) { state.sheet.tabs[+t.dataset.tabcfg][t.dataset.f] = t.value.trim(); persist(); }
});
document.addEventListener('change', e => {
  const t = e.target, A = t.dataset.actInput;
  if (t.dataset.model === 'src') { state.ui.src = t.value; persist(); render(); return; }
  if (t.dataset.tabcfg != null) { state.sheet.tabs[+t.dataset.tabcfg][t.dataset.f] = t.value; persist(); return; }
  if (t.dataset.ocr) {
    const it = ocr.items[+t.dataset.i]; if (!it) return;
    if (t.dataset.ocr === 'key') {
      const g = acct().generals[t.value] || {};
      Object.assign(it, { key: t.value, name: gName(t.value), cur: g.owned ? reqText({ s: g.stars || 0, p: g.grade || 0 }) || '0돌' : '' });
      render(); return;
    }
    it[t.dataset.ocr] = t.type === 'checkbox' ? t.checked : +t.value;
    if (t.type === 'checkbox') render();
    return;
  }
  if (t.id === 'ocrFile' && t.files[0]) { ocrRun(t.files[0]); t.value = ''; return; }
  if (t.id === 'importFile' && t.files[0]) {
    t.files[0].text().then(txt => {
      try { const d = JSON.parse(txt); if (!d.state || !Array.isArray(d.state.accounts)) throw new Error('형식 오류'); state = d.state; state.ui = Object.assign({}, state.ui); normalizeAccounts(); clampAccounts(); persist(); buildData(); render(); toast('백업을 불러왔습니다'); }
      catch (err) { toast('불러오기 실패: ' + err.message); }
    });
    return;
  }
  if (!A) return;
  const a = acct();
  if (A === 'rename') { a.name = t.value.trim() || a.name; }
  else if (A === 'squads') { state.accounts[+t.dataset.a].squads = +t.value; }
  else if (A === 'server') { state.accounts[+t.dataset.a].server = t.value; toast(`${state.accounts[+t.dataset.a].name}: ${t.value === 'rural' ? '시골섭 완화 조건으로 판정' : '일반 조건으로 판정'}`); }
  else if (A === 'copyFrom' && t.value !== '') {
    const src = state.accounts[+t.value];
    if (state.ui.ownTab === 'generals') a.generals = JSON.parse(JSON.stringify(src.generals)); else a.tactics = { ...src.tactics };
    toast(`${src.name}에서 복사했습니다`);
  }
  persist(); render();
});

function exportCsv() {
  const head = ['덱이름', '티어', '분류', '진형'];
  [1, 2, 3].forEach(j => head.push(`무장${j}`, `무장${j}전법1`, `무장${j}전법2`, `무장${j}병종`, `무장${j}병법`));
  head.push('비고', '돌파조건', '출처');
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = DECKS.filter(d => d.kind !== 'community').map(d => {
    const r = [d.name, d.tierLabel.replace(/^T/, ''), d.group || KIND_LABEL[d.kind], d.formation];
    d.slots.forEach(s => r.push(s.gen ? s.gen.raw : '', s.tactics[0]?.raw || '', s.tactics[1]?.raw || '', s.rows['병종'] || s.gen?.troop || '', s.books.join(' / ')));
    r.push(d.note || d.desc, d.slots.flatMap(s => Object.entries(s.req || {}).map(([k, rq]) => `${gName(k)} ${reqText(rq)}` + (s.reqRural && s.reqRural[k] ? ` (시골섭 ${reqText(s.reqRural[k])})` : ''))).join(', '), d.src);
    return r.map(q).join(',');
  });
  const blob = new Blob(['﻿' + [head.map(q).join(','), ...rows].join('\n')], { type: 'text/csv' });
  const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = '천하결전-시즌3-덱목록.csv'; l.click();
}

// ───────────────────────── 접속 인증 ─────────────────────────
// 인증 키를 맞게 넣어야 화면이 열립니다. 키 원문 대신 해시만 코드에 둡니다.
// 주의: 정적 사이트라 진짜 보안은 아닙니다(소스·데이터 파일은 주소를 알면 직접 열 수 있음). 지나가는 접속을 막는 용도입니다.
// 키를 바꾸려면 브라우저 콘솔에서 __tk3hash('새키') 결과를 AUTH_HASH에 넣으세요.
const AUTH_HASH = '1iju3panfpf';           // '1234'
const LS_AUTH = 'tk3-auth-v1';
function cyrb53(str, seed = 7) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const authHash = k => cyrb53('tk3:' + String(k).trim());
window.__tk3hash = authHash;
function isAuthed() { try { return localStorage.getItem(LS_AUTH) === AUTH_HASH; } catch { return false; } }
function showGate(onOk) {
  document.body.classList.add('locked');
  const g = document.createElement('div');
  g.className = 'gate';
  g.innerHTML = `<form class="gate-box" autocomplete="off">
    <strong>천하결전 덱 관리</strong>
    <p class="small muted">인증 키(보기)나 공유 비밀번호(보기+저장)를 입력하세요.</p>
    <input type="password" id="gateKey" placeholder="인증 키 또는 공유 비밀번호" aria-label="인증 키 또는 공유 비밀번호">
    <label class="small"><input type="checkbox" id="gateRemember" checked> 이 브라우저에서 기억하기</label>
    <button class="btn primary" type="submit">들어가기</button>
    <div class="small miss" id="gateMsg" aria-live="polite"></div>
  </form>`;
  document.body.appendChild(g);
  const inp = g.querySelector('#gateKey'), msg = g.querySelector('#gateMsg'), btn = g.querySelector('button'); inp.focus();
  Cloud.fetchAuth();   // 미리 받아두기
  const enter = () => {
    try { if (g.querySelector('#gateRemember').checked) localStorage.setItem(LS_AUTH, AUTH_HASH); } catch {}
    g.remove(); document.body.classList.remove('locked'); onOk();
  };
  g.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const v = inp.value;
    if (authHash(v) === AUTH_HASH) { if (!Cloud.cfg.token) toast('보기 전용으로 열었습니다. 저장하려면 공유 비밀번호로 들어오세요.'); return enter(); }
    btn.disabled = true; msg.textContent = '확인 중…';
    const ok = await Cloud.unlockWith(v);
    btn.disabled = false;
    if (ok) { toast('공유 비밀번호 확인: 이 브라우저에서 저장할 수 있습니다'); return enter(); }
    msg.textContent = Cloud.authExists === false ? '인증 키가 맞지 않습니다.' : '인증 키나 공유 비밀번호가 맞지 않습니다.';
    inp.select();
  });
}

// ───────────────────────── 시작 ─────────────────────────
function start() { start._done = true; buildData(); render(); Cloud.paintStatus(); Cloud.pull(); }
if (isAuthed()) start(); else showGate(start);
window.__tk3 = { get DECKS() { return DECKS; }, get COEXIST() { return COEXIST; }, G, T, check, solve, Cloud, state: () => state };
})();
