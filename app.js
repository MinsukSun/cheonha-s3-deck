/* 천하결전 S3 덱 관리 — 정적 사이트 (데이터는 브라우저 localStorage에 저장) */
(() => {
'use strict';

// ───────────────────────── 기본 설정 ─────────────────────────
const SHEET_B = '1HqKv31nFCBqB5DF-D-ezuAkM-k_TLl0vRWTtAnLYDXc';
const DEFAULT_SHEET = {
  v: 2,
  id: '17NtAf-aULDH-RtGPlWHHTGXJdg6R3yPg87uIo-F75_I',
  tabs: [
    { name: '시즌3 티어덱', gid: '1443176189', kind: 'tier' },
    { name: '시즌3 변칙, 계열덱', gid: '1922923785', kind: 'variant' },
    { name: '시즌3 공존덱', gid: '474450804', kind: 'coexist' },
    { name: '시즌3 공존덱(2)', gid: '841351688', kind: 'coexist' },
    { name: '무장 도감', gid: '1134089693', kind: 'roster' },
    // 추가 시트 (다른 사람이 정리한 S3 티어덱·연의 공존 편성)
    { name: '시즌3 티어덱 ①', gid: '2130591871', kind: 'band', sid: SHEET_B, lineup: 'none' },
    { name: '시즌3 티어덱 ②', gid: '1764941948', kind: 'band', sid: SHEET_B, lineup: 'auto' },
    { name: '시즌3 티어덱 ③', gid: '8456161', kind: 'band', sid: SHEET_B, lineup: 'all' },
  ],
};
// 예전 설정(추가 시트 탭이 없는 것)에 기본 탭을 한 번만 채워 넣습니다.
function migrateSheet(sh) {
  if (!sh || !Array.isArray(sh.tabs) || (sh.v || 0) >= 2) return sh;
  for (const t of DEFAULT_SHEET.tabs) if (t.sid && !sh.tabs.some(x => x.gid === t.gid && x.sid === t.sid)) sh.tabs.push({ ...t });
  sh.v = 2; return sh;
}
const KIND_LABEL = { tier: '티어덱', variant: '변칙·계열덱', coexist: '공존덱', band: '블록 정리표', simple: '내 시트', roster: '무장 도감', community: '커뮤니티', research: '추가 조사', custom: '내 덱' };
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
// 초성 검색: 검색어의 자음(ㄱ~ㅎ)은 그 자리 글자의 첫소리와 맞춰 봅니다. 예) 'ㅊㄱ'·'ㅅㅁ'·'칠ㄱ' → 칠군수몰
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const choOf = c => { const n = c.charCodeAt(0) - 0xac00; return n >= 0 && n < 11172 ? CHO[Math.floor(n / 588)] : c; };
const CHO_LOOSE = { 'ㄱ': 'ㄲ', 'ㄷ': 'ㄸ', 'ㅂ': 'ㅃ', 'ㅅ': 'ㅆ', 'ㅈ': 'ㅉ' };
const chMatch = (q, c) => q === c || (CHO.includes(q) && (choOf(c) === q || CHO_LOOSE[q] === choOf(c)));
function hmatch(text, query) {
  const q = [...key(query)], t = [...key(text)];
  if (!q.length) return true;
  for (let i = 0; i + q.length <= t.length; i++) { let ok = true; for (let j = 0; j < q.length; j++) if (!chMatch(q[j], t[i + j])) { ok = false; break; } if (ok) return true; }
  return false;
}
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
state.ui = Object.assign({ tab: 'decks', src: 'main', status: 'all', q: '', ownTab: 'generals', ownMode: 'stars', ownTacMode: 'stars', ownQ: '', ownUsedOnlyV2: false, ownSort: 'name' }, state.ui || {});
state.sheet = migrateSheet(state.sheet || JSON.parse(JSON.stringify(DEFAULT_SHEET)));
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
    state.accounts = data.accounts; state.customDecks = data.customDecks || []; if (data.sheet) state.sheet = migrateSheet(data.sheet);
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
// 브라우저에 저장된 예전 캐시에 없는 탭(추가 시트)은 사이트에 들어 있는 캐시에서 채웁니다.
for (const t of (window.SHEET_CACHE || {}).tabs || []) if (!(cache.tabs || []).some(x => x.gid === t.gid && (x.sid || '') === (t.sid || ''))) (cache.tabs = cache.tabs || []).push(t);

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

// ───────── 블록 정리표 형식 (추가 시트: '장수' 줄 또는 '전법' 칸 기준 블록) ─────────
// 한 줄에 나란히 놓인 블록들 = 하나의 띠(band). lineup 설정에 따라 띠를 공존 편성으로도 묶습니다.
//   none: 덱 목록만 · auto: 2덱 이상이고 '카운터' 묶음이 아니면 공존 · all: 2덱 이상이면 공존
// 'OR' 칸이 두 블록 사이에 있으면 그 둘은 같은 자리의 택1입니다.
// 첫 시트와 같은 이름으로 맞춤: 장비 = 장비·탈것 능력치(무력선공 등), 장비특성 = 장비 세트, 탈것특성 = 탈것
const BAND_LABEL = { '전법': 'T', '전법1': 'T', '전법2': 'T', '대체전법': '대체 전법', '병법': 'B', '병종': '병종', '탈것,장비': '장비', '장비,탈것': '장비',
  '장비': '장비특성', '탈것': '탈것특성', '스탯': '스텟', '스텟': '스텟', '설명': 'NOTE', '비고': 'NOTE' };
const TROOP_SHORT = { 궁: '궁병', 기: '기병', 창: '창병', 방: '방패병' };
function bandGen(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim(); if (!s) return '';
  if (s === '내 부인') s = '감부인';
  let troop = '';
  const tm = s.match(/\s*-\s*(궁|기|창|방)(?:병|패병)?$/); if (tm) { troop = TROOP_SHORT[tm[1]]; s = s.slice(0, tm.index); }
  const pm = s.match(/(궁병|기병|창병|방패병)\s*/); if (pm) { troop = troop || pm[1]; s = s.replace(pm[0], ''); }
  s = s.replace(/^연의\s*/, '연의 ').trim();
  return troop ? `${s}(${troop})` : s;
}
function bandTac(v) {
  v = String(v || '').trim(); if (!v || v === '-') return '';
  const copy = /(^|[\/\n])\s*영\s*[-·]/.test(v);
  v = v.replace(/(^|[\/\n])\s*영\s*[-·]\s*/g, '$1').replace(/\n/g, '/');
  return copy ? v + '(영본)' : v;
}
function bandText(s) {
  const lines = String(s || '').split('\n').map(x => x.trim()), ne = lines.filter(Boolean);
  const vertical = ne.length > 3 && ne.filter(x => x.length <= 2).length / ne.length > 0.6;
  return (vertical ? lines.join('') : ne.join(' ')).split('//')[0].replace(/\s+/g, ' ').replace(/[\s\/]+$/, '').trim();
}
const stripHan = s => { const t = String(s).replace(/[一-鿿][一-鿿\/\s]*/g, ' ').replace(/^[\s\/]+|[\s\/]+$/g, '').replace(/\s+/g, ' ').trim(); return t || String(s).trim(); };
const tabSrc = tab => (tab.sid && tab.sid !== (state.sheet || DEFAULT_SHEET).id ? '추가 시트 · ' : '') + tab.name;

function parseBandTab(tab, ti) {
  const g = tab.grid || [], src = tabSrc(tab), decks = [], groups = [];
  const anchors = [];
  for (let r = 0; r < g.length; r++) for (let c = 0; c < (g[r] || []).length; c++) {
    const v = key(cell(g, r, c));
    if (v === '장수' && [1, 2, 3].some(j => cell(g, r, c + j))) anchors.push({ gr: r, c, lr: r + 2, fr: r + 1 });
    else if (v === '전법' && r >= 2 && !cell(g, r - 2, c) && [1, 2, 3].some(j => cell(g, r - 2, c + j))) anchors.push({ gr: r - 2, c, lr: r, fr: r - 1 });
  }
  // 긴 설명 칸의 "1. 덱이름 / 설명…" 목록
  const notes = [];
  g.forEach(row => (row || []).forEach(v => {
    if (String(v).length < 150 || !/\d+\.\s/.test(v)) return;
    String(v).split(/\n(?=\s*\d+\.\s)/).forEach(ch => {
      const m = ch.match(/^\s*\d+\.\s*([^\n]+)\n?([\s\S]*)$/); if (!m) return;
      const names = m[1].split(/[()（）]/).map(x => key(stripHan(x))).filter(x => x.length >= 2);
      const body = m[2].replace(/\s*\n\s*/g, ' ').trim();
      if (names.length && body) notes.push({ names, body });
    });
  }));
  const bands = {};
  anchors.forEach(an => (bands[an.gr] = bands[an.gr] || []).push(an));
  const bandRows = Object.keys(bands).map(Number).sort((a, b) => a - b);
  bandRows.forEach((gr, bi) => {
    const list = bands[gr].sort((a, b) => a.c - b.c), minC = list[0].c, prev = bi ? bandRows[bi - 1] : -1;
    // 묶음 이름: 블록 왼쪽 열에서 가장 가까운 글, 단계: 그 위쪽의 '…단계' 글
    let section = '', stage = '';
    for (let rr = gr - 1; rr > prev && !section; rr--) for (let cc = minC - 1; cc >= 0 && !section; cc--) section = bandText(cell(g, rr, cc));
    for (let rr = gr - 1; rr >= 0 && !stage; rr--) { const t = bandText(cell(g, rr, 0)); if (/단계/.test(t)) stage = t; }
    const gname = [...new Set([stage, section].filter(Boolean))].join(' · ');
    const made = [];
    for (const an of list) {
      const { c } = an, at = row => (row >= 0 ? cell(g, row, c) || cell(g, row, c + 1) : '');
      const t1 = at(gr - 1).split('\n')[0].replace(/[\s\/]+$/, '').trim(), t2 = at(gr - 2).split('\n')[0].trim();
      let title = t1, desc = '';
      if (/^T\s*\d/i.test(t2)) { title = t2; desc = at(gr - 1).replace(/\s*\n\s*/g, ' ').trim(); }
      if (!title || title === 'OR') title = t2 || '이름 없음';
      const tp = parseTier(title);
      const name = stripHan(tp.name);
      const slots = [1, 2, 3].map(j => ({ gen: parseGeneralCell(bandGen(cell(g, gr, c + j))), tactics: [], books: [], rows: {} }));
      let label = '', note = '';
      for (let i = an.lr; i < g.length; i++) {
        const labRaw = cell(g, i, c), vals = [1, 2, 3].map(j => cell(g, i, c + j));
        if (!labRaw && !vals.some(Boolean)) break;
        if (labRaw) { const L = BAND_LABEL[key(labRaw)]; if (!L) break; label = L; }
        if (!label) break;
        if (label === 'NOTE') { note += (note ? ' ' : '') + vals.filter(Boolean).join(' ').replace(/\s*\n\s*/g, ' '); continue; }
        vals.forEach((v, j) => {
          const s = slots[j]; if (!v) return;
          if (label === 'T') { const t = parseTacticCell(bandTac(v)); if (t) s.tactics.push(t); }
          else if (label === 'B') s.books.push(v.replace(/\s*\n\s*/g, ' '));
          else { const vv = label === '대체 전법' ? bandTac(v).replace(/\(영본\)$/, '').split('/').map(x => x.trim()).filter(Boolean).join(' / ') : v.replace(/\s*\n\s*/g, ' '); if (vv) s.rows[label] = (s.rows[label] ? s.rows[label] + ' · ' : '') + vv; }
        });
      }
      if (!slots.some(s => s.gen) || !slots.some(s => s.tactics.length)) continue;
      slots.forEach(s => { if (s.rows['병종'] && s.gen && !s.gen.troop) s.gen.troop = s.rows['병종']; });
      if (!desc) { const tk = key(name); const hit = notes.find(n => n.names.some(x => x === tk || (x.length >= 2 && (tk.includes(x) || x.includes(tk))))); if (hit) desc = hit.body; }
      const d = mkDeck({ src, kind: 'tier', group: tab.lineup === 'none' ? '' : gname, title, name, tier: tp.tier, tierLabel: tp.tierLabel, desc, note,
        formation: bandText(cell(g, an.fr, c)), slots, pos: `${gr}:${c}`, prio: 2 + ti / 100 });
      d.id = `band:${key(tab.gid || tab.name)}:${d.id}`;
      decks.push(d); made.push({ d, c });
    }
    // 공존 묶음
    const isLineup = made.length >= 2 && (tab.lineup === 'all' || (tab.lineup === 'auto' && !/카운터/.test(section)));
    if (!isLineup) return;
    const slotsL = [];
    // 'N군'·'선발대' 머리글이 있으면 그 열 기준으로 자리를 나눕니다 (머리글 오른쪽 블록들은 같은 자리의 택1).
    const heads = [];
    for (const rr of [gr - 2, gr - 3]) (g[rr] || []).forEach((v, cc) => { if (/^(\d\s*군|선발대)$/.test(String(v).trim()) && cc >= minC) heads.push(cc); });
    if (new Set(heads).size >= 2) {
      const hs = [...new Set(heads)].sort((a, b) => a - b), by = {};
      made.forEach(m => { const h = hs.filter(x => x <= m.c).pop() ?? hs[0]; (by[h] = by[h] || []).push(m.d); });
      hs.forEach(h => by[h] && slotsL.push(by[h]));
    } else made.forEach((m, i) => {
      const orCell = i && [gr - 1, gr - 2].some(rr => { for (let cc = made[i - 1].c + 1; cc <= m.c; cc++) if (key(cell(g, rr, cc)) === 'or') return true; return false; });
      if (orCell) slotsL[slotsL.length - 1].push(m.d); else slotsL.push([m.d]);
    });
    let options = [[]];
    slotsL.forEach(alts => { options = options.flatMap(o => alts.map(x => [...o, x])); });
    groups.push({ name: gname || `${src} 공존`, src, need: slotsL.length, decks: made.map(m => m.d), options: options.length > 1 ? options : null });
    if (slotsL.some(s => s.length > 1)) made.forEach(m => { if (slotsL.find(s => s.includes(m.d)).length > 1) m.d.choiceTag = '택1'; });
  });
  return { decks, groups };
}

// ───────── 겹치는 덱 하나로 합치기 ─────────
// 같은 무장 3명 + 전법이 거의 같은 덱(다른 전법 칸 2개 이하)은 우선순위가 높은 출처의 덱 하나로 합칩니다.
// 다른 전법은 그 자리의 대체안(A / B)으로, 빠진 병법·병종·장비·설명·티어는 서로 채웁니다.
// 커뮤니티 덱(무장만 있음)은 같은 무장 조합 덱이 있으면 출처만 남기고 합칩니다.
let DECK_ALIAS = {};
function mergeDupes(decks) {
  DECK_ALIAS = {};
  const gsig = d => d.slots.map(s => (s.gen ? s.gen.opts[0] : '')).sort().join('+');
  const optsOf = sl => new Set(sl.tactics.flatMap(t => t.opts));
  const pair = (p, d) => d.slots.map(ds => [ds, ds.gen && p.slots.find(ps => ps.gen && ps.gen.opts[0] === ds.gen.opts[0])]);
  const uncovered = (a, b) => a.tactics.filter(t => !t.opts.some(k => optsOf(b).has(k)));
  const mismatch = (p, d) => pair(p, d).reduce((n, [ds, ps]) => n + (ps ? uncovered(ds, ps).length : 9), 0);
  const elig = d => d.prio != null && !d.unknownTactics;
  const primaries = {}, gone = new Set();
  const order = decks.filter(elig).sort((x, y) => x.prio - y.prio);
  for (const d of order) {
    const sg = gsig(d), list = primaries[sg] = primaries[sg] || [];
    const p = list.find(p => mismatch(p, d) <= 2);
    if (!p) { list.push(d); continue; }
    gone.add(d); DECK_ALIAS[d.id] = p.id;
    p.srcs = [...new Set([...(p.srcs || [p.src]), d.src])];
    const nm = String(d.name).trim();   // 다른 출처의 덱 이름 (설명 문장처럼 보이는 제목은 빼기)
    if (nm.length >= 2 && nm.length <= 10 && !/[,，.]|돌|품|피해|중요|필수|사용|(고|데|음|함)$|^(궁병|기병|창병|방패병)$/.test(nm) && !T.has(key(nm)) && key(nm) !== key(p.name) && !(p.aka || []).some(x => key(x) === key(nm))) (p.aka = p.aka || []).push(nm);
    for (const [ds, ps] of pair(p, d)) {
      if (!ps) continue;
      const U = uncovered(ds, ps), V = uncovered(ps, ds);
      U.forEach((u, i) => {
        if (V[i]) { u.opts.forEach(k => V[i].opts.includes(k) || V[i].opts.push(k)); V[i].raw += ' / ' + u.raw; V[i].copy = V[i].copy || u.copy; }
        else if (ps.tactics.length < 2) ps.tactics.push({ ...u, opts: [...u.opts] });
      });
      if (!ps.books.length && ds.books.length) ps.books = [...ds.books];
      for (const [k, v] of Object.entries(ds.rows || {})) if (!ps.rows[k]) ps.rows[k] = v;
      if (ps.gen && ds.gen && !ps.gen.troop && ds.gen.troop) ps.gen.troop = ds.gen.troop;
    }
    if (p.tier == null && d.tier != null) { p.tier = d.tier; p.tierLabel = d.tierLabel; }
    if (!p.formation) p.formation = d.formation;
    else if (d.formation && !key(p.formation).includes(key(d.formation))) p.formation += ' / ' + d.formation;
    if (!p.url && d.url) p.url = d.url;
    const ex = [d.desc, d.note].filter(Boolean).join(' ');
    if (ex && ![p.desc, p.note, ...(p.extra || []).map(x => x.text)].some(t => t && t.includes(ex))) (p.extra = p.extra || []).push({ src: d.src, name: d.name, text: ex });
  }
  // 커뮤니티 덱(무장만) → 같은 무장 조합 덱에 출처만 합치기
  for (const d of decks.filter(d => d.kind === 'community')) {
    const p = (primaries[gsig(d)] || [])[0]; if (!p) continue;
    gone.add(d); DECK_ALIAS[d.id] = p.id; p.srcs = [...new Set([...(p.srcs || [p.src]), d.src])];
  }
  return decks.filter(d => !gone.has(d));
}
const resolveId = id => { const i = id.indexOf('~sub~'), b = i < 0 ? id : id.slice(0, i); return DECK_ALIAS[b] ? DECK_ALIAS[b] + (i < 0 ? '' : id.slice(i)) : id; };
const deckById = id => DECKS.find(x => x.id === id) || DECKS.find(x => x.id === resolveId(id));

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
  const text = [d.desc, d.note, d.starText, ...(d.extra || []).map(x => x.text)].filter(Boolean).join(' ');
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
  const bandGroups = [];
  tabs.forEach((t, ti) => {
    if (t.kind === 'roster') return;
    if (t.kind === 'band') { const r = parseBandTab(t, ti); decks = decks.concat(r.decks); bandGroups.push(...r.groups); return; }
    const ds = t.kind === 'simple' ? parseSimpleTab(t) : parseBlockTab(t);
    ds.forEach(d => { if (d.kind !== 'coexist') d.prio = d.kind === 'tier' ? 0 + ti / 100 : d.kind === 'variant' ? 1 + ti / 100 : 1.5; });
    decks = decks.concat(ds);
  });
  // 커뮤니티 덱
  for (const src of window.EXTRA_DECKS || []) for (const d of src.decks) {
    decks.push(mkDeck({ src: src.source, url: src.url, kind: 'community', group: '', title: d.name, name: d.name, tier: null, tierLabel: '', desc: '', note: d.note || '',
      formation: '', unknownTactics: true, slots: d.generals.map(n => ({ gen: parseGeneralCell(n), tactics: [], books: [], rows: {} })) }));
  }
  // 추가 조사 덱 (덱 빌더·삼천 데이터 등, 전법까지 있는 것)
  for (const src of window.RESEARCH_DECKS || []) for (const d of src.decks) {
    const tr = parseTier(d.tier ? d.tier + ' x' : 'x');
    // 기본: T0→0.4, T1→0.9, T2→1.4 (시트 티어보다 한 단계 아래로 봄). tierMap이 있는 출처는 그 표를 씀.
    const tier = src.tierMap && d.tier in src.tierMap ? src.tierMap[d.tier] : tr.tier == null ? null : 0.4 + tr.tier * 0.5;
    const at = (arr, i) => (arr && arr[i]) || '';
    decks.push(mkDeck({ src: src.source, url: src.url, kind: 'research', group: d.group || '', title: d.name, name: d.name, tier,
      tierLabel: d.tier ? d.tier + (d.score ? ` ${d.score}` : '') : '', desc: '', note: d.note || '', formation: d.formation || '',
      slots: d.generals.map((n, i) => {
        const rows = {};
        if (at(d.troops, i)) rows['병종'] = d.troops[i];
        if (at(d.stats, i)) rows['스텟'] = d.stats[i];
        if (at(d.gear, i)) rows['장비특성'] = d.gear[i];
        return { gen: parseGeneralCell(n), tactics: (d.tactics[i] || []).map(parseTacticCell).filter(Boolean), books: at(d.books, i) ? [d.books[i]] : [], rows };
      }), prio: src.prio || 5 }));
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
  // 겹치는 덱 합치기
  decks = mergeDupes(decks);
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
  // 전법 효과 설명
  const DESC = {}; for (const [n, d] of Object.entries(window.TACTIC_DESC || {})) DESC[key(n)] = d;
  for (const e of T.values()) e.tdesc = DESC[e.key] || DESC[key(e.name)] || '';
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
  buildSubData();
  // 공존 프리셋
  COEXIST = [];
  const groups = {};
  for (const d of decks.filter(d => d.kind === 'coexist')) { const gk = d.src + '|' + d.group; (groups[gk] = groups[gk] || { src: d.src, group: d.group, decks: [] }).decks.push(d); }
  for (const gr of bandGroups) {
    const fix = d => deckById(d.id) || d;
    COEXIST.push({ ...gr, decks: [...new Set(gr.decks.map(fix))], options: gr.options && gr.options.map(o => o.map(fix)) });
  }
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
// 연의 무장: 연의 칸마다 두 연의 무장 중 한 명만 고를 수 있음(연의1 공손찬/원소, 연의2 장료/감녕, 연의3 관우/조인).
// 고르지 않은 쪽 '연의' 무장만 미보유로 보고, 기본 무장(장료·감녕 등)은 그대로 씁니다. 같은 인물은 한 부대·편성에 한 번만.
const yeonBase = k => String(k).replace(/^연의/, '');
const person = k => yeonBase(k);                         // 같은 인물(기본·연의)은 한 번만 출전
const YEON_GROUPS = [['공손찬', '원소'], ['장료', '감녕'], ['관우', '조인']];
const yeonGroup = b => YEON_GROUPS.find(g => g.includes(b));
const yeonPick = (a, g) => g.find(b => (a.yeonui || {})[b] === 'yeon') || '';
const yeonBlocked = (a, k) => { if (!/^연의/.test(k)) return false; const b = yeonBase(k), g = yeonGroup(b); if (!g) return false; const p = yeonPick(a, g); return !!p && p !== b; };
const ownsG = (a, k) => !!(a.generals[k] && a.generals[k].owned) && !yeonBlocked(a, k);
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

// ── 돌파 수준: 무장 돌 기준으로 덱을 고르는 고돌 / 중간돌 / 명함(저돌) 구분 ──
// 덱 쪽: 시트·사이트 문구에서 '고돌파용', '높은 돌파 권장', '고승품' → 고돌 덱 / '저돌파용', '명함', '낮은 돌파도 가능' → 명함·저돌 덱 / '모든 돌파용' → 무관
const BREAK_LABEL = { low: '명함', mid: '중간돌', high: '고돌' };
function deckBreak(d) {
  const cls = t => {
    if (!t) return null;
    if (/모든\s*돌파/.test(t)) return 'all';
    const hi = /고돌파|고승품|높은\s*돌파|고돌/.test(t), lo = /저돌파|저돌|명함|낮은\s*돌파/.test(t);
    return hi && !lo ? 'high' : lo && !hi ? 'low' : null;
  };
  return cls(d.group) || cls([d.desc, d.note].filter(Boolean).join(' '));
}
// 계정 쪽: 덱에 쓰이는 보유 무장의 평균 돌 (수동 지정이 있으면 그것). 1돌 미만 = 명함, 3돌 미만 = 중간돌, 그 이상 = 고돌
function breakInfo(a) {
  const own = Object.entries(a.generals || {}).filter(([k, g]) => g.owned && (G.get(k) || {}).used);
  const avg = own.length ? own.reduce((s, [, g]) => s + (g.stars || 0), 0) / own.length : null;
  const auto = avg == null ? null : avg < 1 ? 'low' : avg < 3 ? 'mid' : 'high';
  const level = a.breakLevel && a.breakLevel !== 'auto' ? a.breakLevel : auto;
  return { level, auto, avg, manual: !!(a.breakLevel && a.breakLevel !== 'auto') };
}
// 덱이 계정 수준에 맞는지: good(맞음) / warn(고돌 권장인데 내 수준이 낮음) / null(기준 없음)
function breakFit(d, a) {
  const bt = deckBreak(d), lv = breakInfo(a).level;
  if (!bt || bt === 'all' || !lv) return { bt, fit: null };
  if (bt === 'high') return { bt, fit: lv === 'high' ? 'good' : 'warn' };
  return { bt, fit: lv === 'high' ? null : 'good' };
}
const fitBonus = (d, a) => { const f = breakFit(d, a).fit; return f === 'warn' ? -1.5 : f === 'good' ? 0.5 : 0; };
// 덱 무장들의 현재 평균 돌 (보유한 대체 무장 중 가장 높은 돌 기준)
function deckAvgStars(d, a) {
  const v = d.slots.filter(s => s.gen).map(s => Math.max(-1, ...s.gen.opts.map(k => (ownsG(a, k) ? starsOf(a, k) : -1)))).filter(x => x >= 0);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
}
function breakSelect(a, i) {
  const bi = breakInfo(a);
  const autoTxt = bi.auto ? `자동: ${BREAK_LABEL[bi.auto]} (평균 ${bi.avg.toFixed(1)}돌)` : '자동 (보유 무장 없음)';
  return `<label class="small" title="무장 돌 기준으로 고돌·명함 덱을 구분합니다. 평균 1돌 미만 = 명함, 3돌 미만 = 중간돌, 그 이상 = 고돌">돌파 수준
    <select data-act-input="breakLevel" data-a="${i}"><option value="auto">${autoTxt}</option>${['low', 'mid', 'high'].map(v => `<option value="${v}" ${a.breakLevel === v ? 'selected' : ''}>${BREAK_LABEL[v]}</option>`).join('')}</select></label>`;
}

// ───────────────────────── 대체 무장·전법 추천 ─────────────────────────
// 근거 1) 실제 교체 사례: 다른 두 무장이 같은 덱끼리 남은 한 자리의 무장 / 시트의 'A/B' 대체안 / 같은 무장 조합에서 같은 자리 전법이 다른 경우
// 근거 2) 역할 유사도: 무장은 고유전법 유형·특성, 병종, 위치, 진영, 고유전법 효과 태그 / 전법은 유형·특성, 효과 태그
const subG = new Map(), subT = new Map();
const bump = (m, a, b, w) => { if (a === b) return; const x = m.get(a) || new Map(); x.set(b, (x.get(b) || 0) + w); m.set(a, x); };
const TAG_RULES = [['병기피해', /병기(와 책략)? 피해|병기 피해/], ['책략피해', /책략(과 병기)? 피해|책략 피해/], ['회복', /회복|치유/], ['피해감소', /받는[\s\S]{0,24}피해[\s\S]{0,16}감소|방어 ?1스택|1스택의 방어/],
  ['피해증가', /주는[\s\S]{0,10}피해가[\s\S]{0,12}증가|피해 계수가[\s\S]{0,8}증가/], ['적약화', /적군[\s\S]{0,30}(주는[\s\S]{0,12}피해|무력|지력|통솔|선공)[\s\S]{0,20}감소|탈취/], ['제어', /혼란|침묵|무장 해제|공포|제어 상태/],
  ['상태부여', /화공|홍수|군량 고갈|폭풍|요술|허약|위협/], ['전체', /전체 적군|적군 전체|전체 아군/], ['2명', /2명|2~3명/], ['단일', /단일 목표/], ['조롱', /조롱/], ['반격', /반격/], ['연타', /연타/],
  ['회심묘책', /회심|묘책/], ['선공', /선공/], ['준비', /준비 후/], ['초반', /전투 시작|첫 3턴|3턴 동안|4턴 동안/], ['액티브강화', /액티브 전법 발동률|액티브 전법 피해/], ['일반공격', /일반 공격 후|일반 공격 성공/], ['해제', /디버프 상태[\s\S]{0,6}제거/]];
const descTags = t => new Set(TAG_RULES.filter(([, re]) => re.test(t || '')).map(([n]) => n));
const jacc = (A, B) => { if (!A || !B || !A.size || !B.size) return 0; let n = 0; A.forEach(x => B.has(x) && n++); return n / (A.size + B.size - n); };
function buildSubData() {
  subG.clear(); subT.clear();
  for (const [n, fac, troop, pos] of window.GENERAL_ATTRS || []) { const e = G.get(key(n)); if (e) Object.assign(e, { fac, troop, pos }); }
  for (const e of G.values()) e.tags = descTags(e.desc);
  for (const [n, tg] of window.TACTIC_TAGS || []) { const e = T.get((window.TACTIC_ALIASES || {})[key(n)] || key(n)); if (e) e.tags = new Set(tg.split(/\s+/).filter(Boolean)); }
  const real = DECKS.filter(d => d.kind !== 'community' && d.kind !== 'custom');
  for (const d of real) for (const sl of d.slots) {
    if (sl.gen) for (const x of sl.gen.opts) for (const y of sl.gen.opts) bump(subG, x, y, 2);          // '손권 / 대교'
    for (const t of sl.tactics) for (const x of t.opts) for (const y of t.opts) bump(subT, x, y, 2);   // '결사의 다짐/기선제압'
  }
  const main = d => d.slots.map(sl => (sl.gen ? sl.gen.opts[0] : ''));
  for (let i = 0; i < real.length; i++) for (let j = i + 1; j < real.length; j++) {
    const A = main(real[i]), B = main(real[j]);
    const onlyA = A.filter(x => x && !B.includes(x)), onlyB = B.filter(x => x && !A.includes(x));
    if (onlyA.length === 1 && onlyB.length === 1) { bump(subG, onlyA[0], onlyB[0], 1); bump(subG, onlyB[0], onlyA[0], 1); }
    if (onlyA.length === 0 && onlyB.length === 0) {
      // 같은 무장 조합: 같은 무장 자리에서 서로 다른 전법 = 교체 사례
      real[i].slots.forEach(si => { const sj = real[j].slots.find(x => x.gen && si.gen && x.gen.opts[0] === si.gen.opts[0]); if (!sj) return;
        const ti = si.tactics.flatMap(t => t.opts), tj = sj.tactics.flatMap(t => t.opts);
        const oi = ti.filter(x => !tj.includes(x)), oj = tj.filter(x => !ti.includes(x));
        if (oi.length === 1 && oj.length === 1) { bump(subT, oi[0], oj[0], 1); bump(subT, oj[0], oi[0], 1); } });
    }
  }
}
// 직업(병참·청낭·천공·진군·기좌·신행)은 조사 결과 전투 속성·전법·병종·치유율을 바꾸지 않고 사망률·예비병·공성치·이동 같은 맵 효과만 있어 대체 점수에 넣지 않습니다.
function genSubs(a, missKey, deck, used) {
  const X = G.get(missKey); if (!X) return [];
  const emp = subG.get(missKey) || new Map();
  const out = [];
  for (const Y of G.values()) {
    if (Y.key === missKey || !ownsG(a, Y.key) || used.has(Y.key) || (Y.season || 0) > MAX_SEASON) continue;
    const why = []; let sc = 0;
    const e = emp.get(Y.key) || 0; if (e) { sc += 3 * Math.min(e, 3); why.push(`실제 교체 사례 ${e}`); }
    if (X.cat && Y.cat === X.cat) { sc += 2.5; why.push(`같은 ${X.cat}형`); }
    if (X.type && Y.type === X.type) { sc += 1.5; why.push(`고유 ${X.type}`); }
    if (X.troop && Y.troop === X.troop && X.troop !== '—') { sc += 1; why.push(X.troop); }
    if (X.pos && Y.pos === X.pos && X.pos !== '—') { sc += 1; why.push(X.pos); }
    if (X.fac && Y.fac === X.fac) { sc += 0.5; }
    const js = jacc(X.tags, Y.tags); if (js > 0.3) { sc += js * 2; why.push('비슷한 효과'); }
    if (sc >= 3) out.push({ key: Y.key, name: Y.name, sc, why, stars: starsOf(a, Y.key) });
  }
  return out.sort((x, y) => y.sc - x.sc || y.stars - x.stars).slice(0, 3);
}
function tacSubs(a, missOpts, usedT) {
  const X = T.get(missOpts[0]); if (!X) return [];
  const emp = new Map(); missOpts.forEach(k => (subT.get(k) || new Map()).forEach((v, y) => emp.set(y, (emp.get(y) || 0) + v)));
  const out = [];
  for (const Y of T.values()) {
    if (missOpts.includes(Y.key) || tCount(a, Y.key) <= (usedT[Y.key] || 0)) continue;
    const why = []; let sc = 0;
    const e = emp.get(Y.key) || 0; if (e) { sc += 3 * Math.min(e, 3); why.push(`실제 교체 사례 ${e}`); }
    if (X.ttype && Y.ttype === X.ttype) { sc += 2; why.push(X.ttype); }
    if (X.trait && Y.trait === X.trait) { sc += 1.5; why.push(X.trait); }
    const js = jacc(X.tags, Y.tags); if (js > 0) { sc += js * 3; if (js >= 0.4) why.push('비슷한 효과'); }
    if (sc >= 3) out.push({ key: Y.key, name: Y.name, sc, why });
  }
  return out.sort((x, y) => y.sc - x.sc).slice(0, 3);
}
// 덱 하나에 대해 빠진 무장·전법별 대체 후보
function deckSubs(d, a) {
  const gUsed = new Set(d.slots.flatMap(sl => (sl.gen ? sl.gen.opts.filter(k => ownsG(a, k)).slice(0, 1) : [])));
  const usedT = {}; d.slots.forEach(sl => sl.tactics.forEach(t => { const k = t.opts.find(x => tCount(a, x) > 0); if (k) usedT[k] = (usedT[k] || 0) + 1; }));
  const gens = [], tacs = [];
  d.slots.forEach((sl, si) => {
    if (sl.gen && !sl.gen.opts.some(k => ownsG(a, k))) {
      const list = genSubs(a, sl.gen.opts[0], d, gUsed);
      gens.push({ si, miss: sl.gen.opts.map(gName).join('/'), list });
      if (list[0]) gUsed.add(list[0].key);
    }
    sl.tactics.forEach((t, ti) => {
      if (t.opts.some(k => tCount(a, k) > 0)) return;
      const list = tacSubs(a, t.opts, usedT);
      tacs.push({ si, ti, miss: t.opts.map(tName).join('/'), list });
      if (list[0]) usedT[list[0].key] = (usedT[list[0].key] || 0) + 1;
    });
  });
  return { gens, tacs };
}
// 대체안을 넣은 덱 사본 (자동 편성용). 대체 1개당 점수 감점.
function subVariant(d, a, maxGen = 2) {
  const S = deckSubs(d, a);
  if (S.gens.length > maxGen || S.gens.some(g => !g.list.length) || S.tacs.some(t => !t.list.length) || S.gens.length + S.tacs.length === 0 || S.tacs.length > 3) return null;
  const subbed = new Set(S.gens.map(g => g.si));
  // 대체한 자리의 돌 조건만 지우고, 나머지 자리의 조건(예: 마초 2돌)은 그대로 둠
  const v = JSON.parse(JSON.stringify({ ...d, slots: d.slots.map((sl, si) => ({ ...sl, gen: sl.gen && { ...sl.gen }, tactics: sl.tactics.map(t => ({ ...t })), req: subbed.has(si) ? {} : sl.req, reqRural: subbed.has(si) ? {} : sl.reqRural })) }));
  const notes = [];
  S.gens.forEach(g => { const sl = v.slots[g.si]; sl.subFrom = g.miss; sl.gen.opts = [g.list[0].key]; sl.gen.raw = g.list[0].name; sl.gen.troop = ''; notes.push(`${g.miss}→${g.list[0].name}`); });
  S.tacs.forEach(t => { v.slots[t.si].tactics[t.ti].opts = [t.list[0].key]; notes.push(`${t.miss}→${t.list[0].name}`); });
  v.id = `${d.id}~sub~${notes.join(',')}`; v.subOf = d.id; v.subNotes = notes; v.subPenalty = 2.5 * S.gens.length + 0.8 * S.tacs.length;   // 대체 무장 1명 −2.5, 전법 1개 −0.8
  v.name = `${d.name} (대체)`;
  return v;
}

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
  if (r.g.some(k => usedG.has(person(k)))) return false;
  if (new Set(r.g.map(person)).size !== r.g.length) return false;
  for (const [k, n] of Object.entries(r.t)) if ((usedT[k] || 0) + n > tCount(a, k)) return false;
  return true;
}
// 무장·전법 중복 없이 최대 k개 덱을 고르는 탐색
function solve(cands, a, k, fixed = [], maxNodes = 150000) {
  const usedG = new Set(), usedT = {};
  const apply = (r, sign) => { r.g.forEach(x => sign > 0 ? usedG.add(person(x)) : usedG.delete(person(x))); for (const [x, n] of Object.entries(r.t)) usedT[x] = (usedT[x] || 0) + sign * n; };
  for (const f of fixed) apply(f.r, 1);
  const items = cands.map(d => ({ d, rs: realizations(d, a), s: deckScore(d, a) })).filter(x => x.rs.length).sort((x, y) => y.s - x.s);
  let best = { n: -1, s: -1, pick: [] }, nodes = 0;
  const cur = [];
  const dfs = (i, n, s) => {
    if (++nodes > maxNodes) return;
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
// ───────────────────────── 그림: 무장 초상 타일 · 전법 아이콘 ─────────────────────────
// 게임 원화는 쓰지 않고, 진영 색 + 이름 글자로 초상 타일을 그립니다(배치는 믹스커피 공략 가이드를 참고).
const FAC_CLS = { 위: 'wei', 촉: 'shu', 오: 'wu', 군: 'qun' };
const TROOP_ABBR = { 기병: '기', 방패병: '방', 궁병: '궁', 창병: '창' };
function genFac(k) {
  const e = G.get(k) || {}, b = G.get(yeonBase(k)) || {};
  return FAC_CLS[e.fac || b.fac] || 'none';
}
// 타일에 쓸 이름: 'SP 제갈량' → '제갈량', '연의 원소' → '원소'
const avName = k => String(gName(k)).replace(/^연의\s*/, '').replace(/^SP\s*/i, '');
// o: { size: 'sm'|'md'|'lg', a: 계정(돌·품 표시), troop, dim, mark: 'have'|'warn'|'miss', label }
function avatar(k, o = {}) {
  const e = G.get(k) || {}, nm = avName(k), g = o.a ? genState(o.a, k) : null;
  const troopFull = String(o.troop || (e.troop && e.troop !== '—' ? e.troop : '')).replace(/^백전\s*/, '');
  const tr = TROOP_ABBR[(troopFull.match(TROOP_RE) || [])[1]] || '';
  const badge = /^연의/.test(k) ? '<i class="av-b yeon">연의</i>' : /^sp/i.test(k) ? '<i class="av-b sp">SP</i>' : '';
  const pips = g ? `<span class="av-s">${range0(MAX_STARS - 1).map(i => `<b class="${i < (g.stars || 0) ? 'on' : ''}"></b>`).join('')}</span>${g.grade ? `<span class="av-g">${g.grade}품</span>` : ''}` : '';
  const len = [...nm].length;
  return `<span class="av f-${genFac(k)} ${o.size || 'md'} ${o.dim ? 'dim' : ''} ${o.mark || ''}" title="${esc(o.label || gName(k))}">
    <span class="av-n l${Math.min(len, 4)}">${esc(nm)}</span>${badge}${tr ? `<i class="av-t">${tr}</i>` : ''}${pips}</span>`;
}
const TICON = {
  지휘: '<path d="M6 3v18M6 4h11l-3 4 3 4H6"/>',
  액티브: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
  패시브: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  추격: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
};
const TTYPE_CLS = { 지휘: 'cmd', 액티브: 'act', 패시브: 'pas', 추격: 'pur' };
function ticon(type) {
  return `<svg class="ti ${TTYPE_CLS[type] || 'unk'}" viewBox="0 0 24 24" aria-hidden="true">${TICON[type] || '<circle cx="12" cy="12" r="4"/>'}</svg>`;
}
// 전법 특성(병기·책략·문무·방어·보조·치유) 배지
const TRAITS = ['병기', '책략', '문무', '방어', '보조', '치유'];
const TRAIT_CLS = { 병기: 'wpn', 책략: 'stg', 문무: 'mix', 방어: 'def', 보조: 'sup', 치유: 'heal' };
const traitBadge = tr => (tr ? `<i class="trb ${TRAIT_CLS[tr] || ''}">${esc(tr)}</i>` : '');
const tacTip = k => { const e = T.get(k) || {}; return [[e.ttype, e.trait, e.tseason].filter(Boolean).join(' · '), e.tdesc].filter(Boolean).join('\n'); };
// 전법 이름 + 유형 아이콘 + 특성 배지 (opts는 대체안 목록). 마우스를 올리면 효과 설명
function tacLabel(keys, o = {}) {
  const e = T.get(keys[0]) || {};
  return `<span class="tl ${o.cls || ''}" title="${esc(keys.map(tacTip).join('\n\n'))}">${ticon(e.ttype)}<span>${keys.map(k => esc(tName(k))).join(' / ')}${traitBadge(e.trait)}</span>${o.copy ? ' <span class="tag">영본</span>' : ''}</span>`;
}
// 티어 숫자 → 티어표 줄
const TIER_ROWS = [['T0+', t => t < 0.4], ['T0', t => t < 0.75], ['T1', t => t < 1.2], ['T2', t => t < 1.7], ['T3', () => true]];
const tierRowOf = d => (d.tier == null ? '참고' : TIER_ROWS.find(([, f]) => f(d.tier))[0]);

// 무장 한 자리의 세팅: 병종 · 병법 · 장비 · 특성 · 스탯 (시트에 없으면 병종은 무장 기본 병종으로)
function slotInfo(s) {
  if (!s.gen) return '';
  const r = s.rows || {}, base = G.get(s.gen.opts[0]) || {};
  const troop = s.gen.troop || r['병종'] || (base.troop && base.troop !== '—' ? `${base.troop} (기본)` : '');
  const gear = r['장비'] || r['장비/탈것'] || '';
  const trait = [r['장비특성'], r['탈것특성']].filter(Boolean).join(' / ');
  const stat = r['스텟'] || r['스탯'] || '';
  const line = (k, v) => v ? `<div class="si"><span>${k}</span>${esc(v)}</div>` : '';
  const body = line('병종', troop) + line('병법', s.books.join(' · ')) + line('장비', gear) + line('특성', trait) + line('스탯', stat) + line('대체 전법', r['대체 전법']);
  return body ? `<div class="sinfo">${s.subFrom ? `<div class="si muted">대체 무장 · 세팅은 원래 ${esc(s.subFrom)} 기준</div>` : ''}${body}</div>` : '';
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
      return `<div class="tac ${ok ? 'have' : 'miss'}">${tacLabel(t.opts, { copy: t.copy })}</div>`;
    }).join('');
    const fk = s.gen.opts.find(k => ownsG(a, k)) || s.gen.opts[0];
    const face = `<div class="face">${avatar(fk, { a, troop: s.gen.troop || (s.rows || {})['병종'], mark: meet ? '' : has ? 'warn' : 'miss' })}</div>`;
    return `<div class="slot">${face}<div class="gname ${meet ? 'have' : has ? 'warn' : 'miss'}">${gtxt}</div>${tac || (d.unknownTactics ? '<div class="tac muted">전법 세부 미확인</div>' : '')}${slotInfo(s)}</div>`;
  };
  const more = '';
  const inLineup = a.lineup.some(id => resolveId(id) === d.id);
  const S = (ck.missG.length || ck.missT.length) && d.kind !== 'community' && Object.keys(a.generals).length ? deckSubs(d, a) : null;
  const subTag = c => `<span class="tag sub" title="${esc(c.why.join(' · ') || '역할이 비슷함')}">${esc(c.name)}${c.stars != null && c.stars >= 0 ? ` ${c.stars}돌` : ''}</span>`;
  const subLine = (label, arr) => arr.length ? `<div class="small subs"><b>${label}</b> ${arr.map(x => `<span class="miss">${esc(x.miss)}</span> → ${x.list.length ? x.list.map(subTag).join('') : '<span class="muted">보유 중 마땅한 대체 없음</span>'}`).join('<br>')}</div>` : '';
  const missLine = [
    ck.missG.length ? (S && S.gens.length ? subLine('없는 무장 · 대체 추천', S.gens) : `<div class="small miss">없는 무장: ${ck.missG.map(esc).join(', ')}</div>`) : '',
    ck.missT.length ? (S && S.tacs.length ? subLine('없는 전법 · 대체 추천', S.tacs) : `<div class="small miss">없는 전법: ${ck.missT.map(m => esc(m.label)).join(', ')}</div>`) : '',
    ck.missS.length ? `<div class="small warn">돌파·품 부족: ${ck.missS.map(m => `${esc(m.label)} ${esc(m.have)} → ${esc(m.need)}`).join(', ')}</div>` : '',
  ].join('');
  return `<div class="card ${st}">
    <div class="card-h"><h3>${d.tierLabel ? `<span class="tier">${esc(d.tierLabel)}</span>` : ''}${esc(d.name)}${d.aka ? `<span class="small muted" title="다른 출처에서 부르는 이름"> = ${d.aka.map(esc).join(', ')}</span>` : ''}</h3><span class="status ${st}">${d.unknownTactics && st === 'ok' ? '무장 보유' : STATUS_LABEL[st]}</span></div>
    <div><span class="tag">${esc(KIND_LABEL[d.kind] || d.kind)}</span>${(() => { const bf = breakFit(d, a), av = deckAvgStars(d, a); if (!bf.bt || bf.bt === 'all') return ''; const lab = bf.bt === 'high' ? '고돌 덱' : '명함·저돌 가능'; return `<span class="tag brk ${bf.fit || ''}" title="${bf.fit === 'warn' ? '고돌파 권장 덱인데 내 돌파 수준이 낮습니다' : '내 돌파 수준에 맞는 덱'}${av != null ? ` · 이 덱 무장 평균 ${av.toFixed(1)}돌` : ''}">${lab}${bf.fit === 'warn' ? ' ⚠' : bf.fit === 'good' ? ' ✓' : ''}</span>`; })()}${d.group ? `<span class="tag">${esc(d.group)}</span>` : ''}${d.choiceTag ? `<span class="tag">${esc(d.choiceTag)}</span>` : ''}${d.formation ? `<span class="tag">${esc(d.formation)}</span>` : ''}${d.url ? `<a class="tag" href="${esc(d.url)}" target="_blank" rel="noopener">출처</a>` : ''}</div>
    ${d.subNotes ? `<div class="small warn">대체 구성: ${d.subNotes.map(esc).join(', ')}</div>` : ''}
    ${d.desc ? `<div class="desc">${esc(d.desc)}</div>` : ''}
    <div class="slots">${d.slots.map(slot).join('')}</div>
    ${missLine}
    ${d.note ? `<div class="desc">${esc(d.note)}</div>` : ''}
    ${(() => { const ks = [...new Set(d.slots.flatMap(sl => sl.tactics.flatMap(t => t.opts)))].filter(k => (T.get(k) || {}).tdesc); return ks.length ? `<details class="more"><summary class="small">전법 설명 ${ks.length}개</summary>${ks.map(k => { const e = T.get(k); return `<div class="desc">${ticon(e.ttype)} <b>${esc(e.name)}</b>${traitBadge(e.trait)} <span class="muted">${esc(e.ttype || '')}</span><br>${esc(e.tdesc)}</div>`; }).join('')}</details>` : ''; })()}
    ${d.extra ? `<details class="more"><summary class="small">다른 출처 설명 ${d.extra.length}개</summary>${d.extra.map(x => `<div class="desc"><b>${esc(x.src)}</b>${key(x.name) !== key(d.name) ? ` (${esc(x.name)})` : ''}: ${esc(x.text)}</div>`).join('')}</details>` : ''}
    ${more}
    ${opts.noActions ? '' : `<div class="card-f"><span class="small muted" title="${d.srcs ? '같은 덱이 여러 출처에 있어 하나로 합쳤습니다' : ''}">${esc((d.srcs || [d.src]).join(' · '))}</span><span>
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
  if (q) list = list.filter(({ d }) => [d.name, ...(d.aka || []), d.group, ...d.slots.flatMap(s => [...(s.gen ? s.gen.opts.map(gName) : []), ...s.tactics.flatMap(t => t.opts.map(tName))])].some(x => hmatch(x, u.q)));
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
  ${cnt.stars ? `<div class="hint small">일부 덱은 시트 설명에 돌파·승품 조건(예: 마운록 4돌 2품 이상)이 있습니다. <b>보유 관리</b>의 <b>돌파</b>·<b>품</b> 모드로 입력해야 정확히 판정됩니다. 입력하지 않은 무장은 0돌 0품으로 봅니다. 인구가 적은 서버라면 <b>서버: 시골섭 완화</b>를 고르면 시트에 적힌 완화 조건(예: 시골섭 3돌 1품)으로 판정합니다.</div>` : ''}
  <div class="bar">
    <input type="search" placeholder="덱·무장·전법 검색 (초성 가능)" value="${esc(u.q)}" data-model="q">
    ${serverSelect(a, state.active)} ${breakSelect(a, state.active)}
    <select data-model="src">
      ${[['main', '시트+추가 조사+내 덱'], ['sheet', '시트 (티어+변칙)'], ['research', '추가 조사'], ['tier', '티어덱'], ['variant', '변칙·계열덱'], ['coexist', '공존덱 구성'], ['community', '커뮤니티(세부 미확인)'], ['custom', '내 덱'], ['all', '전체']].map(([v, l]) => `<option value="${v}" ${u.src === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <div class="seg">${[['tier', '티어표'], ['cards', '상세 카드']].map(([v, l]) => `<button data-act="set" data-k="deckView" data-v="${v}" class="${(u.deckView === 'cards' ? 'cards' : 'tier') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="seg">${[['all', '전체'], ['ok', '가능'], ['stars', '돌파·품 부족'], ['tactic', '전법 부족'], ['general', '무장 부족']].map(([v, l]) => `<button data-act="set" data-k="status" data-v="${v}" class="${u.status === v ? 'on' : ''}">${l}</button>`).join('')}</div>
  </div>
  ${!list.length ? '<div class="empty">조건에 맞는 덱이 없습니다.</div>' : u.deckView === 'cards' ? `<div class="grid">${list.map(x => deckCard(x.d, a)).join('')}</div>` : tierTable(list, a)}
  ${openDeckId && deckById(openDeckId) ? `<div class="deck-pop" data-act="closeDeck"><div data-stop="1">${deckCard(deckById(openDeckId), a)}</div></div>` : ''}
  `;
}
// 티어표: 왼쪽 티어 칸 + 덱마다 초상 3장 (누르면 상세 카드)
let openDeckId = null;
function tierTable(list, a) {
  const rows = {};
  for (const x of list) (rows[tierRowOf(x.d)] = rows[tierRowOf(x.d)] || []).push(x);
  const order = ['T0+', 'T0', 'T1', 'T2', 'T3', '참고'];
  const cls = { 'T0+': 'T0p', 'T0': 'T0', 'T1': 'T1', 'T2': 'T2', 'T3': 'T3', '참고': 'ref' };
  const card = ({ d, c }) => {
    const faces = d.slots.map(s => {
      if (!s.gen) return '';
      const k = s.gen.opts.find(x => ownsG(a, x)) || s.gen.opts[0];
      const mark = s.gen.opts.some(x => meetsG(a, s, x)) ? '' : s.gen.opts.some(x => ownsG(a, x)) ? 'warn' : 'miss';
      return avatar(k, { a, troop: s.gen.troop || (s.rows || {})['병종'], mark });
    }).join('');
    return `<button class="tcard ${c.status}" data-act="openDeck" data-id="${esc(d.id)}" title="${esc(d.slots.map(s => s.gen ? s.gen.opts.map(gName).join('/') : '').join(' · '))}">
      <div class="faces">${faces}</div><div class="nm">${esc(d.name)}${d.aka ? `<span class="small muted"> = ${esc(d.aka.slice(0, 2).join(', '))}</span>` : ''}</div>
      <div class="mt"><span>${esc([d.tierLabel, d.formation].filter(Boolean).join(' · ') || KIND_LABEL[d.kind])}</span><span class="status ${c.status}">${STATUS_LABEL[c.status]}</span></div></button>`;
  };
  return `<div class="tier-list">${order.filter(t => rows[t]).map(t => `<div class="tier-row"><div class="tier-lab ${cls[t]}"><b>${t}</b><span>${rows[t].length}덱</span></div><div class="tier-cards">${rows[t].map(card).join('')}</div></div>`).join('')}</div>`;
}

// ───────────────────────── 렌더: 보유 관리 ─────────────────────────
// 가나다순: 공백 무시, 'SP 제갈량'은 '제갈량' 바로 뒤에 오도록 SP를 빼고 비교
const koSortKey = n => String(n).replace(/^sp\s*/i, '').replace(/\s+/g, '') + (/^sp/i.test(n) ? '\uffff' : '');
const byKoName = (x, y) => koSortKey(x.name).localeCompare(koSortKey(y.name), 'ko');
function viewOwn() {
  const a = acct(), u = state.ui, q = key(u.ownQ);
  const head = `
  <div class="bar">
    <input type="text" value="${esc(a.name)}" data-act-input="rename" style="max-width:160px" title="계정 이름">
    ${serverSelect(a, state.active)} ${breakSelect(a, state.active)}
    <div class="seg">${[['generals', '무장'], ['tactics', '전법']].map(([v, l]) => `<button data-act="set" data-k="ownTab" data-v="${v}" class="${u.ownTab === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${u.ownTab === 'generals' ? `<div class="seg">${[['stars', '돌파'], ['grade', '품']].map(([v, l]) => `<button data-act="set" data-k="ownMode" data-v="${v}" class="${(u.ownMode === 'grade' ? 'grade' : 'stars') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`
      : `<div class="seg">${[['own', '보유'], ['copies', '영본 개수']].map(([v, l]) => `<button data-act="set" data-k="ownTacMode" data-v="${v}" class="${(u.ownTacMode === 'copies' ? 'copies' : 'own') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`}
    <input type="search" placeholder="이름 검색 (초성 가능: ㅊㄱ)" value="${esc(u.ownQ)}" data-model="ownQ">
    <label class="small"><input type="checkbox" data-act="toggleUsedOnly" ${u.ownUsedOnlyV2 ? 'checked' : ''}> 덱에 쓰이는 것만</label>
  </div>
  <div class="bar">
    <select data-act-input="copyFrom"><option value="">다른 계정에서 복사…</option>${state.accounts.map((x, i) => i === state.active ? '' : `<option value="${i}">${esc(x.name)}의 ${u.ownTab === 'generals' ? '무장' : '전법'} 복사</option>`).join('')}</select>
    <button class="btn" data-act="clearOwn">${u.ownTab === 'generals' ? '무장' : '전법'} 전체 해제</button>
  </div>
  <details class="hint"><summary>여러 개 한 번에 입력 (이름 붙여넣기)</summary>
    <p class="small muted">쉼표·줄바꿈으로 구분해 이름을 붙여넣으면 보유로 표시합니다. ${u.ownTab === 'tactics' ? '전법 이름 뒤에 <b>*2</b>를 붙이면 영본까지 2개 보유로 저장합니다. 예: 침략방어*2, 기선제압' : '이름 뒤에 <b>:돌파</b> 또는 <b>:돌파:품</b>을 붙이면 함께 저장합니다. 예: 마초:3, 마운록:4:2, 강유'}</p>
    <textarea rows="3" id="bulkIn"></textarea>
    <div class="bar" style="margin-top:6px"><button class="btn primary" data-act="bulkApply">적용</button><span class="small muted" id="bulkMsg"></span></div>
  </details>`;
  const sortBar = `<div class="bar"><span class="small muted">정렬</span><div class="seg">${[['name', '가나다순'], ['used', '사용 덱 수']].map(([v, l]) => `<button data-act="set" data-k="ownSort" data-v="${v}" class="${u.ownSort === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  const sorter = u.ownSort === 'used' ? ((x, y) => y.used - x.used || byKoName(x, y)) : byKoName;
  const section = (label, items, isOwned, chip, box = 'chips') => items.length
    ? `<div class="section-t">${label} (보유 ${items.filter(isOwned).length}/${items.length})</div><div class="${box}">${items.sort(sorter).map(chip).join('')}</div>` : '';
  if (u.ownTab === 'generals') {
    let gens = [...G.values()].filter(e => (e.season || 0) <= MAX_SEASON);
    if (u.ownUsedOnlyV2) gens = gens.filter(e => e.used > 0 || ownsG(a, e.key));
    if (q) gens = gens.filter(e => hmatch(e.name, u.ownQ) || hmatch(e.key, u.ownQ));
    const chip = e => {
      const g = a.generals[e.key] || {};
      const tip = [e.season ? `시즌${e.season}` : '', e.skill, e.type, e.cat].filter(Boolean).join(' · ') + (e.desc ? '\n' + e.desc : '');
      const own = ownsG(a, e.key);
      return `<button class="av-btn ${own ? 'on' : ''} ${e.used ? '' : 'unused'}" data-act="gen" data-k="${esc(e.key)}" title="${esc(tip)}">${avatar(e.key, { a: own ? a : null, label: tip })}<span class="cap">${esc(e.name)}${own ? ` · ${g.stars || 0}돌${g.grade ? ` ${g.grade}품` : ''}` : ''}${e.used ? ` <span class="muted">(${e.used})</span>` : ''}</span></button>`;
    };
    // 시즌별 묶음: 연의 무장은 따로, 도감에 없는 무장은 '기타'
    const groupsDef = [['S3 연의 무장', e => /^연의/.test(e.key)], ['시즌3 무장', e => e.season === 3], ['시즌2 무장', e => e.season === 2], ['시즌1 무장', e => e.season === 1], ['기타 (도감 미등록)', () => true]];
    const left = new Set(gens);
    const parts = groupsDef.map(([lab, f]) => { const items = [...left].filter(f); items.forEach(x => left.delete(x)); return section(lab, items, e => ownsG(a, e.key), chip, 'av-grid'); }).join('');
    return head + sortBar + `<p class="small muted"><b>돌파</b> 모드: 초상을 누를 때마다 <b>미보유 → 0돌 → 1돌 → … → 5돌 → 미보유</b>로 바뀝니다(초상 아래쪽 마름모 = 돌파). <b>품</b> 모드: 누를 때마다 품이 0→5→0으로 바뀝니다(미보유면 0돌로 보유 처리). 초상 색은 진영(위 파랑 · 촉 초록 · 오 빨강 · 군 황토), 오른쪽 위 글자는 기본 병종입니다. 회색 초상은 미보유이고, 이름 옆 괄호 숫자는 그 무장이 쓰이는 덱 수입니다.</p>` + (parts || '<div class="empty">표시할 무장이 없습니다.</div>');
  }
  let tacs = [...T.values()];
  if (u.ownUsedOnlyV2) tacs = tacs.filter(e => e.used > 0 || tCount(a, e.key));
  if (q) tacs = tacs.filter(e => hmatch(e.name, u.ownQ) || [...(e.aliases || [])].some(x => hmatch(x, u.ownQ)));
  const chip = e => {
    const n = tCount(a, e.key);
    const tip = tacTip(e.key) + (e.aliases ? `\n다른 자료 표기: ${[...e.aliases].join(', ')}` : '');
    if (u.ownTacView === 'list') return `<div class="trow ${n ? 'on' : ''} ${e.used ? '' : 'dim'}"><button class="chip ${n ? 'on' : ''} ${n > 1 ? 'two' : ''}" data-act="tac" data-k="${esc(e.key)}">${ticon(e.ttype)}${esc(e.name)}${n > 1 ? '<span class="st">×2</span>' : ''}</button>
      <div class="tmeta">${traitBadge(e.trait)}<span class="small muted">${esc([e.ttype, e.tseason].filter(Boolean).join(' · '))}${e.used ? ` · 덱 ${e.used}개` : ''}</span></div><div class="tdesc">${esc(e.tdesc || '설명 없음')}</div></div>`;
    return `<button class="chip ${n ? 'on' : ''} ${n > 1 ? 'two' : ''} ${e.used ? '' : 'dim'}" data-act="tac" data-k="${esc(e.key)}"${tip ? ` title="${esc(tip)}"` : ''}>${ticon(e.ttype)}${esc(e.name)}${traitBadge(e.trait)}${e.aliases ? '<span class="n">*</span>' : ''}${n > 1 ? '<span class="st">×2</span>' : ''}${e.used ? `<span class="n">${e.used}</span>` : ''}</button>`;
  };
  const TYPES = ['지휘', '액티브', '패시브', '추격'];
  if (u.ownTrait && u.ownTrait !== 'all') tacs = tacs.filter(e => e.trait === u.ownTrait);
  if (u.ownTtype && u.ownTtype !== 'all') tacs = tacs.filter(e => e.ttype === u.ownTtype);
  const box = u.ownTacView === 'list' ? 'tlist' : 'chips', has = e => tCount(a, e.key) > 0;
  const byTrait = u.ownTacGroup === 'trait';
  const GA = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  const gaOf = n => { const c = choOf(String(n).replace(/^sp\s*/i, '').trim()[0] || ''); const f = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' }[c] || c; return GA.includes(f) ? f : '기타'; };
  const gaRows = () => `<div class="ga-rows">${[...GA, '기타'].map(l => { const it = tacs.filter(e => gaOf(e.name) === l).sort((x, y) => koSortKey(x.name).localeCompare(koSortKey(y.name), 'ko'));
    if (l === '기타' && !it.length) return '';
    return `<div class="ga-row ${it.length ? '' : 'none'}"><b class="ga-l">${l}<span>${it.filter(has).length}/${it.length}</span></b><div class="${box}">${it.length ? it.map(chip).join('') : '<span class="small muted">—</span>'}</div></div>`; }).join('')}</div>`;
  const tparts = u.ownTacGroup === 'abc' ? gaRows() : (byTrait
    ? [...TRAITS.map(t => section(`${t} 특성`, tacs.filter(e => e.trait === t), has, chip, box)), section('특성 미확인', tacs.filter(e => !TRAITS.includes(e.trait)), has, chip, box)]
    : [...TYPES.map(t => section(`${t} 전법`, tacs.filter(e => e.ttype === t), has, chip, box)), section('유형 미확인', tacs.filter(e => !TYPES.includes(e.ttype)), has, chip, box)]).join('');
  const segOf = (k, opts, def) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="set" data-k="${k}" data-v="${v}" class="${(u[k] || def) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const tacBar = `<div class="bar"><span class="small muted">묶기</span>${segOf('ownTacGroup', [['type', '유형별'], ['trait', '특성별'], ['abc', '가나다 행']], 'type')}
    <span class="small muted">보기</span>${segOf('ownTacView', [['chips', '칩'], ['list', '설명 목록']], 'chips')}</div>
    <div class="bar"><span class="small muted">유형</span>${segOf('ownTtype', [['all', '전체'], ...TYPES.map(t => [t, t])], 'all')}
    <span class="small muted">특성</span>${segOf('ownTrait', [['all', '전체'], ...TRAITS.map(t => [t, t])], 'all')}</div>`;
  return head + sortBar + tacBar + `<p class="small muted"><b>보유</b> 모드: 칩을 누르면 보유/해제됩니다(덱 판정은 전법 유무만 봅니다). <b>영본 개수</b> 모드: 누를 때마다 1개 ↔ 2개(영본)로 바뀝니다. 공존덱처럼 같은 전법을 두 부대에 쓰려면 2개가 필요합니다. <b>묶기</b>로 유형별(지휘·액티브·패시브·추격) 또는 특성별(병기·책략·문무·방어·보조·치유)로 나누고, 위 버튼으로 유형·특성을 골라 볼 수 있습니다. 칩 옆 색 배지가 특성이고, 오른쪽 숫자는 그 전법이 쓰이는 덱 수입니다. <b>설명 목록</b>을 고르면 전법마다 효과 설명이 보입니다(칩에 마우스를 올려도 보임). 기본으로 S1~S3 전체 전법이 나오고, <b>덱에 쓰이는 것만</b>을 켜면 추천 덱에 나오는 전법만 보입니다(흐린 칩 = 덱에 안 쓰임).</p>
    ${tparts || '<div class="empty">표시할 전법이 없습니다.</div>'}
    <div class="bar" style="margin-top:14px"><input type="text" list="dlTactics" id="newTac" placeholder="목록에 없는 전법 직접 추가"><button class="btn" data-act="addTac">추가</button></div>`;
}

// ───────────────────────── 렌더: 계정별 편성 ─────────────────────────
function findDeck(id, a) {
  if (a.locked && a.locked[id]) { const L = lockedDeck(id, a); if (L) return L; }
  if (id.startsWith('filler:')) return fillerDeck(id, a);
  const d = deckById(id); if (d) return d;
  const i = id.indexOf('~sub~'); if (i < 0) return null;
  const base = deckById(id.slice(0, i)); return base ? subVariant(base, a) : null;   // 대체 구성은 저장하지 않고 다시 계산
}
function lineupDecks(a) { return a.lineup.map(id => findDeck(id, a)).filter(Boolean); }
function lineupConflicts(a) {
  const decks = lineupDecks(a), useG = {}, useT = {};
  // 실제 사용할 구성: 앞에서부터 가능한 대체안을 고름
  const usedG = new Set(), usedT = {}, res = {};
  for (const d of decks) {
    const rs = realizations(d, a);
    const r = rs.find(x => fits(x, usedG, usedT, a));
    if (r) { r.g.forEach(k => usedG.add(person(k))); for (const [k, n] of Object.entries(r.t)) usedT[k] = (usedT[k] || 0) + n; res[d.id] = { ok: true, r }; }
    else {
      const why = [];
      if (!rs.length) {
        const c = check(d, a);
        if (c.status === 'stars') c.missS.forEach(m => why.push(`${m.label} ${m.need} 필요 (현재 ${m.have})`));
        else why.push(c.status === 'general' ? '무장 미보유' : '전법 미보유');
      }
      else {
        d.slots.forEach(s => s.gen && s.gen.opts.every(k => usedG.has(person(k)) || !ownsG(a, k)) && why.push(`${s.gen.opts.map(gName).join('/')} 중복`));
        d.slots.forEach(s => s.tactics.forEach(t => t.opts.every(k => (usedT[k] || 0) >= tCount(a, k)) && why.push(`${t.opts.map(tName).join('/')} 부족`)));
      }
      res[d.id] = { ok: false, why: why.length ? why : ['다른 부대와 겹침'] };
    }
  }
  return res;
}
// ───────────────────────── 5부대 편성 (메인 3 + 보조 2) ─────────────────────────
const deckScore = (d, a) => (d.kind === 'filler' ? 0 : tierScore(d) + fitBonus(d, a) - (d.subPenalty || 0));
const REAL_KINDS = ['tier', 'variant', 'coexist', 'simple', 'custom', 'research'];
// 고정(🔒) 덱: 무장은 고정 당시 그대로, 전법만 지금 보유 기준으로 다시 고름(없으면 대체 전법)
function lockedDeck(id, a) {
  const gens = a.locked[id]; if (!gens) return null;
  const baseId = id.startsWith('filler:') ? null : id.split('~sub~')[0];
  const base = baseId ? deckById(baseId) : fillerDeck(id, a);
  if (!base) return null;
  const v = JSON.parse(JSON.stringify({ ...base, slots: base.slots.map(sl => ({ ...sl, gen: sl.gen && { ...sl.gen }, tactics: sl.tactics.map(t => ({ ...t })) })) }));
  const notes = [];
  v.slots.forEach((sl, si) => {
    const k = gens[si]; if (!sl.gen || !k) return;
    if (!sl.gen.opts.includes(k)) {           // 대체 무장으로 고정한 자리: 원래 무장의 돌 조건은 적용하지 않음
      sl.subFrom = sl.gen.opts.map(gName).join('/'); notes.push(`${sl.subFrom}→${gName(k)}`);
      sl.req = {}; sl.reqRural = {}; sl.gen.troop = '';
    } else {                                    // 원래 무장: 그 무장의 돌 조건만 남김
      const keep = o => (o && o[k] ? { [k]: o[k] } : {});
      sl.req = keep(sl.req); sl.reqRural = keep(sl.reqRural);
    }
    sl.gen.opts = [k];
  });
  const S = deckSubs(v, a);
  // 없는 전법: 대체가 있으면 바꾸고, 없으면 빈 칸으로 두어 부대 자체는 유지
  S.tacs.forEach(t => { const tt = v.slots[t.si].tactics[t.ti]; if (t.list[0]) { tt.opts = [t.list[0].key]; notes.push(`${t.miss}→${t.list[0].name}`); } else { tt.drop = true; notes.push(`${t.miss} 없음`); } });
  v.slots.forEach(sl => (sl.tactics = sl.tactics.filter(t => !t.drop)));
  return Object.assign(v, { id, lockedOf: id, subNotes: notes.length ? notes : null, subPenalty: 0, name: base.name.replace(/ \(대체\)$/, '') + (notes.length ? ' (대체)' : '') });
}
// 남은 무장 부대: 덱이 안 나올 때 남은 무장 3명 + 그 무장이 덱에서 주로 쓰는 전법
function fillerDeck(id, a) {
  const parts = id.slice(7).split(';').filter(Boolean).map(p => { const [k, ts] = p.split('='); return { k, ts: (ts || '').split(',').filter(Boolean) }; });
  return { id, kind: 'filler', name: '남은 무장 부대', title: '남은 무장 부대', tier: null, tierLabel: '', group: '', desc: '', note: '추천 덱이 없어 남은 무장과 각자 자주 쓰는 전법으로 채운 부대입니다. 전법·배치는 직접 조정하세요.', formation: '',
    slots: parts.map(p => ({ gen: { opts: [p.k], raw: gName(p.k), troop: '' }, tactics: p.ts.map(t => ({ raw: tName(t), copy: false, opts: [t] })), books: [], rows: {}, req: {}, reqRural: {} })) };
}
function favTactics(k) {
  const cnt = {};
  for (const d of DECKS) for (const sl of d.slots) if (sl.gen && sl.gen.opts.includes(k)) sl.tactics.forEach(t => t.opts.forEach(x => (cnt[x] = (cnt[x] || 0) + 1)));
  return Object.entries(cnt).sort((x, y) => y[1] - x[1]).map(([x]) => x);
}
function makeFillers(a, need, usedG, usedT) {
  const left = Object.keys(a.generals).filter(k => G.has(k) && ownsG(a, k) && !usedG.has(person(k)))
    .sort((x, y) => ((G.get(y) || {}).used || 0) - ((G.get(x) || {}).used || 0) || starsOf(a, y) - starsOf(a, x));
  const out = [];
  while (out.length < need && left.length >= 3) {
    // 전열 1명을 먼저 넣고 나머지 2명
    const fi = left.findIndex(k => (G.get(k) || {}).pos === '전열');
    const team = [fi >= 0 ? left.splice(fi, 1)[0] : left.shift(), left.shift(), left.shift()];
    const parts = team.map(k => {
      const ts = favTactics(k).filter(t => tCount(a, t) > (usedT[t] || 0)).slice(0, 2);
      ts.forEach(t => (usedT[t] = (usedT[t] || 0) + 1));
      usedG.add(person(k));
      return `${k}=${ts.join(',')}`;
    });
    out.push('filler:' + parts.join(';'));
  }
  return out;
}
// 편성 계획: 고정 부대 유지 → 메인(대체 무장 최대 1명) → 보조(대체 무장 최대 2명) → 남은 무장 부대
function planLineup(a, opts = {}) {
  const squads = a.squads || 5, mains = Math.min(a.mainCount ?? 3, squads), maxNodes = opts.maxNodes || 150000;
  const cur = (a.lineup || []).slice(0, squads);
  const slots = Array(squads).fill(null), fixed = [];
  const usedG = new Set(), usedT = {};
  const take = r => { r.g.forEach(k => usedG.add(person(k))); for (const [k, n] of Object.entries(r.t)) usedT[k] = (usedT[k] || 0) + n; };
  cur.forEach((id, i) => {
    if (!(a.locked || {})[id]) return;
    const d = findDeck(id, a); const r = d && realizations(d, a).find(x => fits(x, usedG, usedT, a));
    slots[i] = id;
    if (r) { fixed.push({ r }); take(r); }
    else { const g = (a.locked[id] || []).filter(Boolean); fixed.push({ r: { g, t: {} } }); g.forEach(k => usedG.add(person(k))); }   // 무장은 고정이므로 다른 부대에 쓰지 않음
  });
  const base = DECKS.filter(d => REAL_KINDS.includes(d.kind));
  const allowSub = a.allowSub !== false;
  const needSub = base.filter(d => { const st = check(d, a).status; return st === 'general' || st === 'tactic'; });
  const cMain = base.concat(allowSub ? needSub.map(d => subVariant(d, a, 1)).filter(Boolean) : []);
  const cSup = base.concat(allowSub ? needSub.map(d => subVariant(d, a, 2)).filter(Boolean) : []);
  const fill = (from, to, cands) => {
    const free = []; for (let i = from; i < to; i++) if (!slots[i]) free.push(i);
    if (!free.length) return;
    const pick = solve(cands, a, free.length, fixed, maxNodes).sort((x, y) => deckScore(y.d, a) - deckScore(x.d, a));
    pick.forEach((p, j) => { slots[free[j]] = p.d.id; fixed.push({ r: p.r }); take(p.r); });
  };
  fill(0, mains, cMain);
  fill(mains, squads, cSup);
  const empty = slots.map((x, i) => (x ? -1 : i)).filter(i => i >= 0);
  if (empty.length && opts.fillers !== false) makeFillers(a, empty.length, usedG, usedT).forEach((id, j) => (slots[empty[j]] = id));
  // 고정하지 않은 자리는 점수 순으로 다시 배치: 실제 덱이 메인을 먼저 채우고 남은 무장 부대는 뒤로
  const freeIdx = slots.map((x, i) => (x && !(a.locked || {})[x] ? i : -1)).filter(i => i >= 0);
  const ordered = freeIdx.map(i => slots[i]).sort((x, y) => { const dx = findDeck(x, a), dy = findDeck(y, a); return (dy ? deckScore(dy, a) : -9) - (dx ? deckScore(dx, a) : -9); });
  freeIdx.forEach((i, j) => (slots[i] = ordered[j]));
  const lineup = slots.filter(Boolean);
  const score = lineup.reduce((sc, id, i) => { const d = findDeck(id, a); return sc + (d ? deckScore(d, a) * (i < mains ? 1 : 0.6) : 0); }, 0);
  return { lineup, score };
}
// 뽑기 추천: 아직 없는 무장을 하나씩 0돌로 넣어 보고 편성 점수가 얼마나 오르는지
function pullAdvice(a) {
  const baseScore = planLineup({ ...a, locked: {}, lineup: [] }, { maxNodes: 20000, fillers: false }).score;
  const cands = [...G.values()].filter(e => (e.season || 0) <= MAX_SEASON && e.used && !ownsG(a, e.key) && !yeonBlocked(a, e.key));
  const out = [];
  for (const e of cands) {
    const b = { ...a, locked: {}, lineup: [], generals: { ...a.generals, [e.key]: { owned: true, stars: 0 } } };
    const r = planLineup(b, { maxNodes: 20000, fillers: false });
    const gain = r.score - baseScore;
    if (gain > 0.05) out.push({ key: e.key, name: e.name, season: e.season, gain, decks: r.lineup.map(id => findDeck(id, b)).filter(d => d && d.slots.some(sl => sl.gen && sl.gen.opts.includes(e.key))).map(d => d.name) });
  }
  return out.sort((x, y) => y.gain - x.gain).slice(0, 10);
}
const pullCache = {};
function yeonPanel(a, i) {
  const groups = YEON_GROUPS.map(g => g.filter(b => G.has('연의' + b))).filter(g => g.length);
  if (!groups.length) return '';
  const own = k => (a.generals[k] && a.generals[k].owned ? ' (보유)' : '');
  const picks = groups.map(g => yeonPick(a, g)).filter(Boolean);
  return `<details class="yeon"><summary class="small">연의 선택 ${picks.length ? `· ${picks.map(b => gName('연의' + b)).map(esc).join(', ')}` : '(미정)'}</summary>
    <p class="small muted">연의 칸마다 두 연의 무장 중 한 명만 쓸 수 있습니다. 고른 연의 무장만 추천에 쓰고, 고르지 않은 쪽 연의 무장은 미보유로 봅니다. 기본 무장(예: 장료·감녕)은 연의 선택과 상관없이 그대로 쓰며, 같은 인물의 기본·연의는 한 편성에 한 번만 나옵니다.</p>
    <div class="yeon-grid">${groups.map((g, gi) => `<label class="small">연의${gi + 1}<select data-act-input="yeon" data-a="${i}" data-group="${esc(g.join(','))}">
      <option value="">미정</option>${g.map(b => `<option value="${esc(b)}" ${yeonPick(a, g) === b ? 'selected' : ''}>${esc(gName('연의' + b))}${own('연의' + b)}</option>`).join('')}</select></label>`).join('')}</div>
  </details>`;
}
function pullPanel(a, i) {
  const c = pullCache[a.id];
  const list = c && c.list ? (c.list.length ? `<ol class="pull">${c.list.map(p => `<li><b>${esc(p.name)}</b> <span class="small muted">시즌${p.season || '?'}</span> <span class="tag sub">편성 점수 +${p.gain.toFixed(1)}</span>${p.decks.length ? `<div class="small muted">들어가는 부대: ${p.decks.map(esc).join(', ')}</div>` : ''}</li>`).join('')}</ol>` : '<p class="small muted">한 명만 더 뽑아서 편성이 좋아지는 무장이 없습니다.</p>') : '';
  return `<details class="yeon" ${c ? 'open' : ''}><summary class="small">뽑기 추천 (다음에 뽑으면 좋은 무장)</summary>
    <p class="small muted">아직 없는 무장을 한 명씩 0돌로 넣어 보고, 5부대 편성 점수가 가장 많이 오르는 순서입니다(메인 점수 ×1, 보조 ×0.6). 연의는 고른 쪽만 봅니다.</p>
    <button class="btn small" data-act="pull" data-a="${i}" ${c && c.busy ? 'disabled' : ''}>${c && c.busy ? '계산 중…' : '뽑기 추천 계산'}</button>${list}
  </details>`;
}
// ───────── 편성 전법 배분: 직접 고른 전법(a.tacPick) + 나머지는 추천 순서대로 ─────────
// a.tacPick[덱 id]['무장자리:전법칸'] = 전법 key. 비어 있으면 그 칸의 추천 전법(대체안 순서) 중 남은 것을 자동으로 고릅니다.
// 반환: plan[덱 id] = { gens: [무장 key|null], cells: { 'si:ti': { k, rec, picked, over, users } }, diffs: [...] }
function tacPlan(a, decks) {
  const picks = a.tacPick || {}, use = {}, who = {}, plan = {}, usedP = new Set();
  const add = (k, label) => { use[k] = (use[k] || 0) + 1; (who[k] = who[k] || []).push(label); };
  // 1) 무장: 앞 부대부터 보유·미사용인 첫 무장
  for (const d of decks) {
    const gens = d.slots.map(s => {
      if (!s.gen) return null;
      const k = s.gen.opts.find(x => ownsG(a, x) && !usedP.has(person(x))) || null;
      if (k) usedP.add(person(k)); return k;
    });
    plan[d.id] = { gens, cells: {}, diffs: [] };
  }
  const cellsOf = d => d.slots.flatMap((s, si) => s.tactics.map((t, ti) => ({ s, si, t, ti, cid: `${si}:${ti}` })));
  // 2) 직접 고른 전법 먼저 자리 잡기
  for (const d of decks) for (const c of cellsOf(d)) {
    const k = (picks[d.id] || {})[c.cid];
    if (k) { plan[d.id].cells[c.cid] = { k, picked: true }; add(k, d.name); }
  }
  // 3) 나머지 칸: 추천 순서대로 남은 것 → 없으면 보유한 첫 대체안(겹침) → 없으면 미보유
  for (const d of decks) for (const c of cellsOf(d)) {
    if (plan[d.id].cells[c.cid]) continue;
    const sameGen = cellsOf(d).filter(o => o.si === c.si && o.cid !== c.cid).map(o => (plan[d.id].cells[o.cid] || {}).k);
    const ok = c.t.opts.filter(k => tCount(a, k) > 0 && !sameGen.includes(k));
    const k = ok.find(k => (use[k] || 0) < tCount(a, k)) || ok[0] || null;
    plan[d.id].cells[c.cid] = { k };
    if (k) add(k, d.name);
  }
  // 4) 겹침·추천과 다른 점
  for (const d of decks) for (const c of cellsOf(d)) {
    const cell = plan[d.id].cells[c.cid], rec = c.t.opts[0];
    cell.rec = rec; cell.alt = c.t.opts;
    cell.over = !!cell.k && (use[cell.k] || 0) > tCount(a, cell.k);
    cell.users = cell.k ? who[cell.k].filter(n => n !== d.name) : [];
    cell.miss = !cell.k;
    if (cell.k && cell.k !== rec) {
      const gk = plan[d.id].gens[c.si] || (c.s.gen && c.s.gen.opts[0]);
      plan[d.id].diffs.push({ cid: c.cid, gen: gName(gk), from: rec, to: cell.k, listed: c.t.opts.includes(cell.k), picked: cell.picked });
    }
  }
  return plan;
}
// 전법 칸 고르기: 추천 대체안 → 같은 유형·특성 → 나머지 보유 전법
function tacSelect(a, d, cid, cell, ai, slot) {
  const rec = cell.alt || [], cur = cell.k, e0 = T.get(cell.rec) || {};
  const owned = [...T.values()].filter(e => tCount(a, e.key) > 0);
  const lab = e => `${e.name}${tCount(a, e.key) > 1 ? ' ×2' : ''}`;   // 유형·특성은 묶음 제목에 있음
  const opt = e => `<option value="${esc(e.key)}" ${e.key === cur ? 'selected' : ''}>${esc(lab(e))}</option>`;
  const recE = rec.map(k => T.get(k)).filter(e => e && tCount(a, e.key) > 0);
  const near = owned.filter(e => !rec.includes(e.key) && e.ttype === e0.ttype && e.trait === e0.trait).sort(byKoName);
  const rest = owned.filter(e => !rec.includes(e.key) && !near.includes(e)).sort((x, y) => (x.ttype || '').localeCompare(y.ttype || '') || byKoName(x, y));
  const curMissing = cur && !owned.some(e => e.key === cur) ? `<option value="${esc(cur)}" selected>${esc(tName(cur))} (미보유)</option>` : '';
  return `<select class="tsel" data-act-input="tacPick" data-a="${ai}" data-id="${esc(d.id)}" data-cell="${cid}" title="전법 직접 고르기">
    <option value="">자동 (추천 순서${cell.picked ? '' : ` → ${esc(cur ? tName(cur) : '없음')}`})</option>${curMissing}
    ${recE.length ? `<optgroup label="추천·자료 대체안">${recE.map(opt).join('')}</optgroup>` : ''}
    ${near.length ? `<optgroup label="같은 ${esc([e0.ttype, e0.trait].filter(Boolean).join('·'))}">${near.map(opt).join('')}</optgroup>` : ''}
    ${['지휘', '액티브', '패시브', '추격', ''].map(ty => { const g = rest.filter(e => (e.ttype || '') === ty); return g.length ? `<optgroup label="그 밖의 ${ty || '유형 미확인'} 전법">${g.map(opt).join('')}</optgroup>` : ''; }).join('')}</select>`;
}

function viewLineup() {
  const i = state.active, a = acct();
  const decks = lineupDecks(a), conf = lineupConflicts(a), plan = tacPlan(a, decks), mains = Math.min(a.mainCount ?? 3, a.squads || 5);
  let overN = 0, diffN = 0;
  const item = (d, idx) => {
    const c = conf[d.id], locked = !!(a.locked || {})[d.id], P = plan[d.id];
    const role = idx < mains ? `메인 ${idx + 1}` : `보조 ${idx - mains + 1}`;
    const tacBad = Object.values(P.cells).some(x => x.over || x.miss);
    const genWhy = c.ok ? [] : c.why.filter(w => !/부족$|전법 미보유/.test(w));
    const bad = tacBad || genWhy.length;
    overN += Object.values(P.cells).filter(x => x.over).length; diffN += P.diffs.length;
    const slotHtml = d.slots.map((s, si) => {
      if (!s.gen) return '';
      const k = P.gens[si];
      const tacs = s.tactics.map((t, ti) => {
        const cid = `${si}:${ti}`, cell = P.cells[cid];
        const cls = cell.miss ? 'miss' : cell.over ? 'over' : cell.k !== cell.rec ? 'changed' : '';
        const note = cell.miss ? `<div class="tnote miss">보유한 추천 전법 없음 — 아래에서 고르세요</div>`
          : cell.over ? `<div class="tnote miss">겹침: ${esc(cell.users.join(', ') || '같은 부대')}에서도 사용 (보유 ${tCount(a, cell.k)}개)</div>`
          : cell.k !== cell.rec ? `<div class="tnote">추천: <s>${esc(tName(cell.rec))}</s>${(cell.alt || []).includes(cell.k) ? ' · 자료 대체안' : ' · 직접 변경'}</div>` : '';
        return `<div class="tac ${cls}">${cell.k ? tacLabel([cell.k]) : `<span class="miss">${esc(t.opts.map(tName).join(' / '))}</span>`}${note}${tacSelect(a, d, cid, cell, i, s)}</div>`;
      }).join('');
      return `<div class="slot"><div class="face">${avatar(k || s.gen.opts[0], { a, size: 'sm', troop: s.gen.troop || (s.rows || {})['병종'], mark: k ? '' : 'miss' })}</div><div class="gname">${esc(k ? gName(k) : s.gen.opts.map(gName).join('/'))}${k ? `<span class="small"> ${starsOf(a, k)}돌${gradeOf(a, k) ? ` ${gradeOf(a, k)}품` : ''}</span>` : ''}</div>${tacs}${slotInfo(s)}</div>`;
    }).join('');
    const diffLine = P.diffs.length ? `<div class="small diffs"><b>추천과 다른 전법 ${P.diffs.length}개</b> ${P.diffs.map(x => `<span class="tag ${x.listed ? '' : 'mine'}">${esc(x.gen)}: ${esc(tName(x.from))} → ${esc(tName(x.to))}</span>`).join('')}${Object.keys((a.tacPick || {})[d.id] || {}).length ? ` <button class="btn small" data-act="tacReset" data-a="${i}" data-id="${esc(d.id)}">직접 고른 전법 되돌리기</button>` : ''}</div>` : '';
    return `<div class="lu-item ${bad ? 'conflict' : ''} ${idx < mains ? 'main' : 'sup'} ${d.kind === 'filler' ? 'filler' : ''}"><div class="row"><b><span class="role">${role}</span>${d.tierLabel ? `<span class="tier">${esc(d.tierLabel)}</span>` : ''}${esc(d.name)}${locked ? ' <span class="tag">고정</span>' : ''}</b>
      <span><button class="btn small" data-act="luLock" data-a="${i}" data-id="${esc(d.id)}" title="${locked ? '고정 해제' : '이 부대 무장 고정: 다시 편성해도 무장은 그대로, 전법만 다시 고름'}">${locked ? '🔒' : '🔓'}</button> <button class="btn small" data-act="luUp" data-a="${i}" data-id="${esc(d.id)}">▲</button> <button class="btn small" data-act="luDel" data-a="${i}" data-id="${esc(d.id)}">✕</button></span></div>
      ${d.formation || d.subNotes ? `<div class="small muted">${d.formation ? esc(d.formation) : ''}${d.subNotes ? ` · 대체: ${d.subNotes.map(esc).join(', ')}` : ''}</div>` : ''}
      ${d.kind === 'filler' ? `<div class="small warn">${esc(d.note)}</div>` : ''}
      ${diffLine}
      <div class="lu-slots">${slotHtml}</div>
      ${genWhy.length ? `<div class="small miss">${genWhy.map(esc).join(', ')}</div>` : ''}</div>`;
  };
  const body = decks.map(item).join('');
  const total = decks.reduce((sc, d, idx) => sc + deckScore(d, a) * (idx < mains ? 1 : 0.6), 0);
  return `<div class="hint small"><b>${esc(a.name)}</b>의 편성입니다. 다른 계정은 위쪽 계정 버튼으로 바꿉니다.
    <b>자동 추천 편성</b>은 부대 수(기본 5)를 <b>메인</b>(기본 3)과 <b>보조</b>로 나눠 채웁니다. 🔒 고정한 부대는 무장을 그대로 두고 전법만 다시 고릅니다.
    전법 칸 아래 목록에서 <b>전법을 직접 바꿀 수 있습니다</b>. 바꾼 전법은 노란 표시와 함께 <b>추천: <s>원래 전법</s></b>이 보이고, 다른 부대와 수량이 겹치면 빨간색으로 알려줍니다.</div>
    <div class="card"><div class="card-h"><h3>${esc(a.name)}</h3><span class="small muted">${decks.length}/${a.squads || 5} 부대 · 편성 점수 ${total.toFixed(1)}</span></div>
      ${decks.length ? `<div class="lu-sum ${overN ? 'bad' : 'ok'}">${overN ? `전법 겹침 ${overN}칸` : '전법 겹침 없음'} · 추천과 다른 전법 ${diffN}칸</div>` : ''}
      <div class="bar" style="margin:8px 0 0">
        ${serverSelect(a, i)} ${breakSelect(a, i)}
        <label class="small">부대 수 <select data-act-input="squads" data-a="${i}">${[1, 2, 3, 4, 5].map(n => `<option ${(a.squads || 5) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="small">메인 <select data-act-input="mainCount" data-a="${i}">${[0, 1, 2, 3, 4, 5].filter(n => n <= (a.squads || 5)).map(n => `<option ${mains === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="bar" style="margin:6px 0 0">
        <button class="btn small primary" data-act="auto" data-a="${i}">자동 추천 편성</button>
        <label class="small" title="무장·전법이 없으면 보유한 대체 무장·전법으로 바꾼 구성도 씁니다(메인은 대체 무장 1명까지, 보조는 2명까지, 원래 덱보다 낮은 점수)"><input type="checkbox" data-act="toggleSub" data-a="${i}" ${a.allowSub !== false ? 'checked' : ''}> 대체 허용</label>
        <button class="btn small" data-act="luClear" data-a="${i}">비우기(고정 제외)</button>
      </div>
      ${yeonPanel(a, i)}
      ${body || '<div class="empty small">편성이 비어 있습니다.<br>자동 추천을 누르거나 추천 덱 탭에서 추가하세요.</div>'}
      ${pullPanel(a, i)}
    </div>`;
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
      const pf = breakFit({ group: p.name }, a);
      const fitTag = !pf.bt || pf.bt === 'all' ? '' : `<span class="tag brk ${pf.fit || ''}" title="${esc(a.name)} 돌파 수준: ${BREAK_LABEL[breakInfo(a).level] || '미정'}">${pf.fit === 'warn' ? '고돌용 ⚠' : pf.fit === 'good' ? '수준 맞음 ✓' : ''}</span>`;
      return `<div class="row" style="display:flex;justify-content:space-between;gap:6px;margin-top:4px"><span>${esc(a.name)} ${fitTag}</span><span class="status ${ok ? 'ok' : pick.length ? 'tactic' : 'general'}">${pick.length}/${p.need} 가능</span>
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
    <td><input value="${esc(t.sid || '')}" data-tabcfg="${i}" data-f="sid" placeholder="비우면 위 시트"></td>
    <td><select data-tabcfg="${i}" data-f="kind">${['tier', 'variant', 'coexist', 'band', 'simple', 'roster'].map(k => `<option value="${k}" ${t.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select></td>
    <td><button class="btn small" data-act="delTab" data-i="${i}">✕</button></td></tr>`).join('');
  const counts = {}; DECKS.forEach(d => counts[d.kind] = (counts[d.kind] || 0) + 1);
  return `
  <h2>구글 시트 연동</h2>
  <div class="hint small">시트를 고치면 여기서 <b>지금 업데이트</b>를 눌러 최신 내용을 받아옵니다. 시트는 <b>링크가 있는 모든 사용자: 뷰어</b>로 공유되어 있어야 합니다.
  내 시트를 쓰려면 예시 시트를 <b>파일 → 사본 만들기</b>로 복사한 뒤 링크를 아래에 붙여넣으세요. 탭 gid는 시트 URL 끝의 <code>#gid=</code> 값이고, 비워두면 탭 이름으로 찾습니다.</div>
  <div class="fld"><label>시트 링크 또는 ID</label><input id="sheetUrl" value="https://docs.google.com/spreadsheets/d/${esc(sh.id)}/"></div>
  <table class="tabs-cfg"><tr><th>탭 이름</th><th>gid</th><th>다른 시트 ID</th><th>형식</th><th></th></tr>${tabsRows}</table>
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
// ───────────────────────── 렌더: 도감 (무장·전법·진형) ─────────────────────────
// 자료: data/codex.js (scripts/build_codex.py). 삼천 데이터를 먼저 쓰고, 빈칸은 믹스커피 게임 데이터 화면으로 채움.
let openCodexKey = null;
const CX_STATS = ['통솔', '무력', '지력', '선공'];
const CX_MAX = 300;
const cxData = () => window.CODEX || { generals: [], tactics: [], formations: [] };
const cxGen = k => cxData().generals.find(g => g.key === k);
const cxRate = r => (r == null ? '' : `${r}%`);
function cxStatBars(st) {
  if (!st) return '<p class="small muted">능력치 자료 없음</p>';
  return `<div class="cx-stats">${CX_STATS.map(s => { const v = st[s] || {}; const w = Math.min(100, ((v.lv50 || 0) / CX_MAX) * 100);
    return `<div class="cx-st"><span class="lab">${s}</span><span class="track"><b style="width:${w.toFixed(1)}%"></b></span><span class="val">${v.lv50 != null ? Math.round(v.lv50) : '—'}</span><span class="gr small muted">${v.growth != null ? `+${v.growth}/렙` : ''}</span></div>`; }).join('')}</div>`;
}
function cxUnique(u) {
  if (!u) return '';
  return `<div class="cx-uni"><div class="hd">${ticon(u.type)}<b>${esc(u.name || '?')}</b>${traitBadge(u.trait)}<span class="small muted">${esc([u.type, u.rate != null ? `발동 ${u.rate}%` : ''].filter(Boolean).join(' · '))}</span></div>
    ${u.alt ? `<div class="small muted">다른 표기: ${esc(u.alt)}</div>` : ''}<div class="tdesc">${esc(u.desc || '설명 자료 없음')}</div></div>`;
}
function cxGenDetail(g, a) {
  const e = G.get(g.key) || {}, own = ownsG(a, g.key), gs = genState(a, g.key);
  const decks = DECKS.filter(d => d.kind !== 'custom' && d.slots.some(s => s.gen && s.gen.opts.includes(g.key)));
  return `<div class="card cx-detail">
    <div class="cx-dh">${avatar(g.key, { size: 'lg', a: own ? a : null })}<div><h3>${esc(g.name)}</h3>
      <div class="small muted">${esc([g.season ? `S${g.season}` : '', g.fac, g.troop, g.pos || '위치 미확인', g.role].filter(Boolean).join(' · '))}</div>
      <div class="small">${own ? `<span class="have">${esc(a.name)} 보유 · ${gs.stars || 0}돌${gs.grade ? ` ${gs.grade}품` : ''}</span>` : `<span class="muted">${esc(a.name)} 미보유${yeonBlocked(a, g.key) ? ' (연의 선택에서 제외)' : ''}</span>`}</div></div>
      <button class="btn" data-act="cxClose" style="margin-left:auto">닫기</button></div>
    <h4>능력치 <span class="small muted">50레벨 · 배분 포인트 제외</span></h4>${cxStatBars(g.stats)}
    <h4>고유 전법</h4>${cxUnique(g.unique)}
    <h4>쓰이는 덱 <span class="small muted">${decks.length}개</span></h4>
    ${decks.length ? `<div class="chips">${decks.slice(0, 24).map(d => `<button class="chip" data-act="openDeck" data-id="${esc(d.id)}">${esc(d.name)}</button>`).join('')}${decks.length > 24 ? `<span class="small muted">외 ${decks.length - 24}개</span>` : ''}</div>` : '<p class="small muted">추천 덱에 쓰이지 않습니다.</p>'}
    ${(g.notes || []).length ? `<p class="small warn">${g.notes.map(esc).join(' · ')}</p>` : ''}
    <p class="small muted">출처: ${esc((g.src || []).join(', '))}</p></div>`;
}
// ── 도감 > 조합 분석 (combo.js) ──
const comboState = () => { const u = state.ui; if (!u.combo || !Array.isArray(u.combo.slots)) u.combo = { form: '', from: '', slots: [0, 1, 2].map(() => ({ g: '', t: ['', ''] })) }; return u.combo; };
const fitTag = f => (!f ? '' : `<span class="tag ${f.fit >= 0.75 ? 'ok' : f.fit >= 0.45 ? '' : 'warn'}" title="${esc(f.stat)} ${f.value}">${f.fit >= 0.75 ? '궁합 좋음' : f.fit >= 0.45 ? '보통' : '약함'} · ${esc(f.stat)} ${f.value}</span>`);
function comboFromDeck(d) { const c = comboState(), t = deckTeam(d); c.slots = t.slots; c.form = t.form; c.from = d.id; }
function viewCombo(a) {
  const C = window.TK3Combo, cx = cxData(), c = comboState(), u = state.ui;
  if (!C) return '<div class="empty">combo.js를 불러오지 못했습니다.</div>';
  const r = C.analyze(c, cx);
  const ownG = k => ownsG(a, k), ownT = k => tCount(a, k) > 0;
  const genOpts = cur => `<option value="">— 무장 —</option>${[1, 2, 3].map(se => `<optgroup label="S${se}">${cx.generals.filter(g => g.season === se).sort((x, y) => x.name.localeCompare(y.name, 'ko')).map(g => `<option value="${esc(g.name)}" ${g.name === cur ? 'selected' : ''}>${esc(g.name)}${ownG(g.key) ? ' ✓' : ''}</option>`).join('')}</optgroup>`).join('')}`;
  const TY = ['지휘', '액티브', '패시브', '추격'];
  const tacOpts = cur => `<option value="">— 전법 —</option>${TY.map(ty => `<optgroup label="${ty}">${cx.tactics.filter(t => t.type === ty).sort((x, y) => x.name.localeCompare(y.name, 'ko')).map(t => `<option value="${esc(t.name)}" ${t.name === cur ? 'selected' : ''}>${esc(t.name)}${ownT(t.key) ? ' ✓' : ''}</option>`).join('')}</optgroup>`).join('')}`;
  const decks = DECKS.filter(d => d.kind !== 'custom' && d.slots.filter(s => s.gen).length >= 3).sort((x, y) => (x.tier ?? 9) - (y.tier ?? 9) || x.name.localeCompare(y.name, 'ko'));
  const owned = u.comboOwned ? { owned: null } : {};
  const bar = `<div class="bar"><label class="small">덱에서 불러오기 <select data-act-input="combo" data-f="from"><option value="">— 추천 덱 고르기 —</option>${decks.map(d => `<option value="${esc(d.id)}" ${d.id === c.from ? 'selected' : ''}>${esc([d.tierLabel, d.name].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>
    <label class="small">진형 <select data-act-input="combo" data-f="form"><option value="">— 진형 —</option>${cx.formations.map(f => `<option value="${esc(f.name)}" ${f.name === c.form ? 'selected' : ''}>${esc(f.name)} (전열 ${f.front})</option>`).join('')}</select></label>
    <label class="small"><input type="checkbox" data-act="comboOwned" ${u.comboOwned ? 'checked' : ''}> 대체 후보는 ${esc(a.name)} 보유만</label>
    <button class="btn" data-act="comboClear">비우기</button></div>`;
  const slotCard = s => {
    const cs = c.slots[s.i], g = s.g;
    const altG = g || cs.g ? C.altGenerals(c, s.i, cx, { owned: u.comboOwned ? ownG : null, n: 5 }) : [];
    const tacRow = (t, ti) => {
      const alts = cs.g ? C.altTactics(c, s.i, ti, cx, { owned: u.comboOwned ? ownT : null, n: 5 }) : [];
      return `<div class="cb-t"><select class="tsel" data-act-input="combo" data-f="t" data-si="${s.i}" data-ti="${ti}">${tacOpts(cs.t[ti])}</select>
        ${t && !t.unknown ? `<div class="cb-meta">${ticon(t.type)}${traitBadge(t.trait)}${t.rate != null ? `<span class="small muted">발동 ${t.rate}%${t.casts != null ? ` · 8턴 약 ${t.casts}회` : ''}</span>` : ''}${fitTag(t.fit)}${t.tdesc || t.desc ? `<span class="small muted cb-tip" title="${esc(t.desc)}">설명</span>` : ''}</div>` : ''}
        ${alts.length ? `<details class="cb-alt"><summary class="small">대체 전법 후보</summary>${alts.map(x => `<div class="cb-ar"><button class="btn sm" data-act="comboSet" data-si="${s.i}" data-f="t" data-ti="${ti}" data-v="${esc(x.name)}">바꾸기</button>${ticon(x.type)}<b>${esc(x.name)}</b>${traitBadge(x.trait)}${ownT(x.key) ? '<span class="tag ok">보유</span>' : ''}<span class="small muted">${x.score}점${x.why.length ? ' · ' + x.why.map(esc).join(', ') : ''}</span></div>`).join('')}</details>` : ''}</div>`;
    };
    return `<div class="card cb-slot"><div class="cb-h"><b>${s.i + 1}번</b> <span class="tag ${s.pos === '전열' ? '' : 'sub'}">${s.pos}</span>${s.posFit === 0 ? `<span class="tag warn">${esc(s.pref)} 무장</span>` : s.posFit === 1 ? `<span class="tag ok">위치 맞음</span>` : g ? '<span class="tag">위치 미확인</span>' : ''}</div>
      <div class="cb-g">${g ? avatar(g.key, { a: ownG(g.key) ? a : null }) : ''}<div style="flex:1;min-width:0"><select class="tsel" data-act-input="combo" data-f="g" data-si="${s.i}">${genOpts(cs.g)}</select>
        ${g ? `<div class="small muted">${esc([g.fac, g.troop, g.pos ? `선호 ${g.pos}` : '선호 위치 미확인'].filter(Boolean).join(' · '))}</div><div class="cx-mini">${CX_STATS.map(st => `<i>${st[0]}${Math.round(((g.stats || {})[st] || {}).lv50 || 0)}</i>`).join('')}</div>` : ''}</div></div>
      ${s.unique ? `<div class="cb-u small">${ticon(s.unique.type)}<b>고유</b> ${esc(s.unique.name || '')}${traitBadge(s.unique.trait)}${fitTag(s.unique.fit)}</div>` : ''}
      ${s.tactics.map((t, ti) => tacRow(t, ti)).join('')}${[0, 1].slice(s.tactics.length).map(ti => tacRow(null, ti)).join('')}
      ${altG.length ? `<details class="cb-alt"><summary class="small">대체 무장 후보</summary>${altG.map(x => `<div class="cb-ar"><button class="btn sm" data-act="comboSet" data-si="${s.i}" data-f="g" data-v="${esc(x.name)}">넣기</button><b>${esc(x.name)}</b>${ownG(x.key) ? '<span class="tag ok">보유</span>' : ''}<span class="small muted">${x.score}점${x.why.length ? ' · ' + x.why.map(esc).join(', ') : ''}</span></div>`).join('')}</details>` : ''}</div>`;
  };
  // slots가 3개보다 적으면 채움
  const posAuto = C.assignPos(c, cx);
  const slots = [0, 1, 2].map(i => r.slots[i] || { i, g: null, pos: posAuto[i], posFit: null, unique: null, tactics: [] });
  const any = slots.some(s => s.g);
  const res = !any ? '<div class="empty">무장을 고르거나 위에서 추천 덱을 불러오세요.</div>' : `<div class="card cb-res">
    <div class="cb-score"><div class="big">${r.score.total}<span class="small muted"> / 100</span></div><div class="small muted">참고 점수 · 자료의 특성·태그·능력치로 매긴 값이고 실제 전투 결과는 아닙니다</div></div>
    <div class="cb-parts">${r.score.parts.map(p => `<div class="cx-st" title="${esc(p.note)}"><span class="lab" style="width:auto">${esc(p.label)}</span><span class="track"><b style="width:${(p.v * 100).toFixed(0)}%"></b></span><span class="val">${Math.round(p.v * p.w)}</span><span class="gr small muted">/ ${p.w}</span></div>`).join('')}</div>
    <h4>역할</h4><div class="chips">${r.roles.map(x => `<span class="chip ${x.ok ? 'on' : ''}" title="${esc(x.by.join(', ') || '없음')}">${x.ok ? '✓' : '✕'} ${esc(x.label)}${x.ok ? `<span class="n">${x.by.length}</span>` : ''}</span>`).join('')}</div>
    <p class="small muted">피해 성향: <b>${esc(r.lean)}</b> (병기 피해 전법 ${r.wpn} · 책략 피해 전법 ${r.stg}) · 진영 ${Object.entries(r.fac).map(([k, v]) => `${esc(k)} ${v}`).join(', ')} · 병종 ${Object.entries(r.troop).map(([k, v]) => `${esc(k)} ${v}`).join(', ')}${r.form ? ` · ${esc(r.form.name)}: ${r.form.fx.map(esc).join(', ')}` : ' · 진형 미선택(전열 1자리로 봄)'}</p>
    ${r.issues.length ? `<h4>확인할 점</h4><ul class="cb-iss">${r.issues.map(x => `<li class="${x.lv}">${esc(x.msg)}</li>`).join('')}</ul>` : '<p class="small have">겹침·위치·능력치 경고가 없습니다.</p>'}</div>`;
  return bar + `<div class="cb-grid">${slots.map(slotCard).join('')}</div>` + res +
    `<p class="small muted" style="margin-top:10px">전열/후열은 진형의 전열 자리 수만큼 선호 위치가 맞는 무장을 자동으로 배치한 결과입니다. 점수: 능력치 궁합 40(병기→무력, 책략→지력, 문무→둘의 평균, 50레벨 기준 250이면 만점) + 역할 분담 30(피해·생존 각 10, 방해·보조 각 5) + 위치 15 + 문제 없음 15. 대체 후보는 효과 태그·유형·특성이 비슷하고 그 무장의 능력치에 맞을수록 위에 옵니다. ✓는 ${esc(a.name)} 보유 표시입니다. 분석 로직은 <code>combo.js</code>에 따로 있어 로컬 에이전트가 같은 계산을 쓸 수 있습니다.</p>`;
}
// ── 도감 > 모의전투 (sim.js) ──
let simRes = null;   // { kind: 'vs'|'gauntlet'|'alts', busy, ... }
function deckTeam(d) {
  const cx = cxData();
  const tn = k => { const t = cx.tactics.find(x => x.key === k); return t ? t.name : tName(k); };
  const gs = d.slots.filter(s => s.gen).slice(0, 3);
  const f = window.TK3Combo.findForm(cx, d.formation);
  return { form: f ? f.name : '', slots: [0, 1, 2].map(i => { const s = gs[i]; if (!s) return { g: '', t: ['', ''] }; const k = s.gen.opts[0]; const cg = cxGen(k);
    return { g: cg ? cg.name : gName(k), t: [0, 1].map(j => (s.tactics[j] ? tn(s.tactics[j].opts[0]) : '')) }; }) };
}
const simDecks = () => DECKS.filter(d => d.kind !== 'custom' && d.kind !== 'community' && d.slots.filter(s => s.gen).length >= 3).sort((x, y) => (x.tier ?? 9) - (y.tier ?? 9) || x.name.localeCompare(y.name, 'ko'));
function simOpponents() { const seen = new Set(); return simDecks().filter(d => d.tier != null && d.tier <= 1 && !seen.has(d.name) && seen.add(d.name)).map(d => ({ name: d.name, tier: d.tierLabel, team: deckTeam(d) })); }
const teamText = t => t.slots.filter(s => s.g).map(s => `${s.g}(${s.t.filter(Boolean).join('·') || '전법 없음'})`).join(' / ') + (t.form ? ` · ${t.form}` : '');
const pctTxt = v => `${Math.round(v * 100)}%`;
function simRun(kind) {
  const S = window.TK3Sim, cx = cxData(), u = state.ui, me = JSON.parse(JSON.stringify(comboState()));
  const n = +(u.simN || 300), o = { n, troops: +(u.simTroops || 10000), seed: 20261118 };
  const opDeck = u.simOpp && deckById(u.simOpp);
  if (!me.slots.some(s => s.g)) return toast('먼저 조합 분석에서 아군 무장을 고르세요');
  if ((kind === 'vs' || kind === 'log') && !opDeck) return toast('상대 덱을 고르세요');
  simRes = { kind, busy: true }; render();
  setTimeout(() => {
    const t0 = Date.now();
    if (kind === 'vs' || kind === 'log') {
      const op = deckTeam(opDeck);
      const r = S.simulate(me, op, cx, { ...o, log: true });
      simRes = { kind, me, op, opName: opDeck.name, r, ms: Date.now() - t0 };
    } else if (kind === 'gauntlet') {
      const ops = simOpponents();
      const g = S.gauntlet(me, ops, cx, { ...o, n: Math.max(50, Math.round(n / 3)) });
      simRes = { kind, me, g, avg: g.reduce((a, x) => a + (x.win || 0), 0) / (g.length || 1), ms: Date.now() - t0 };
    } else if (kind === 'alts') {
      const C = window.TK3Combo, ownT = k => tCount(acct(), k) > 0, ownG = k => ownsG(acct(), k);
      const ops = opDeck ? [{ name: opDeck.name, team: deckTeam(opDeck) }] : simOpponents();
      const each = opDeck ? n : Math.max(30, Math.round(n / 10));
      const score = team => { const g = S.gauntlet(team, ops, cx, { ...o, n: each }); return { win: g.reduce((a, x) => a + (x.win || 0), 0) / g.length, lose: g.reduce((a, x) => a + (x.lose || 0), 0) / g.length }; };
      const base = score(me); const rows = [];
      me.slots.forEach((s, si) => {
        if (!s.g) return;
        [0, 1].forEach(ti => C.altTactics(me, si, ti, cx, { owned: u.comboOwned ? ownT : null, n: 3 }).forEach(a => {
          const t = JSON.parse(JSON.stringify(me)); t.slots[si].t[ti] = a.name; const r = score(t);
          rows.push({ what: 't', si, ti, from: s.t[ti] || '(빈칸)', to: a.name, owner: s.g, ...r, d: r.win - base.win });
        }));
        C.altGenerals(me, si, cx, { owned: u.comboOwned ? ownG : null, n: 3 }).forEach(a => {
          const t = JSON.parse(JSON.stringify(me)); t.slots[si].g = a.name; const r = score(t);
          rows.push({ what: 'g', si, from: s.g, to: a.name, ...r, d: r.win - base.win });
        });
      });
      rows.sort((x, y) => y.d - x.d);
      simRes = { kind, me, base, rows, opName: opDeck ? opDeck.name : `티어 덱 ${ops.length}개`, ms: Date.now() - t0 };
    }
    render();
  }, 30);
}
function viewSim(a) {
  const S = window.TK3Sim, u = state.ui, me = comboState();
  if (!S) return '<div class="empty">sim.js를 불러오지 못했습니다.</div>';
  const decks = simDecks();
  const bar = `<div class="card"><div class="small"><b>아군</b> (조합 분석에서 고른 조합): ${me.slots.some(s => s.g) ? esc(teamText(me)) : '<span class="muted">비어 있음 — 조합 분석 탭에서 먼저 고르세요</span>'}</div>
    <div class="bar" style="margin:8px 0 0"><label class="small">상대 덱 <select data-act-input="simOpt" data-k="simOpp"><option value="">— 고르기 —</option>${decks.map(d => `<option value="${esc(d.id)}" ${d.id === u.simOpp ? 'selected' : ''}>${esc([d.tierLabel, d.name].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>
    <label class="small">반복 <select data-act-input="simOpt" data-k="simN">${[100, 300, 1000].map(v => `<option ${+(u.simN || 300) === v ? 'selected' : ''}>${v}</option>`).join('')}</select>회</label>
    <label class="small">병력 <select data-act-input="simOpt" data-k="simTroops">${[6000, 8000, 10000, 12000].map(v => `<option ${+(u.simTroops || 10000) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="bar" style="margin:0"><button class="btn primary" data-act="simRun" data-k="vs">상대 덱과 붙이기</button><button class="btn" data-act="simRun" data-k="gauntlet" title="T0~T1 추천 덱 전체와 한 번씩 붙입니다">티어 덱 전체와 붙이기</button><button class="btn" data-act="simRun" data-k="alts" title="전법마다 대체 후보 3개, 무장마다 대체 후보 3명으로 바꿔 보고 승률 변화를 봅니다. 상대 덱을 고르지 않으면 티어 덱 전체가 상대입니다">대체 후보 시험</button></div></div>`;
  let body = '';
  const R = simRes;
  if (R && R.busy) body = '<div class="empty">돌리는 중…</div>';
  else if (R && (R.kind === 'vs' || R.kind === 'log') && R.r && !R.r.error) {
    const r = R.r, units = Object.values(r.units);
    const tbl = side => `<table class="cx-tbl"><thead><tr><th>${side === 'A' ? '아군' : '상대'}</th><th>위치</th><th>준 피해</th><th>치유</th><th>받은 피해</th><th>생존</th><th>발동(평균)</th></tr></thead><tbody>${units.filter(x => x.side === side).map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${x.pos}</td><td class="num">${x.dealt}</td><td class="num">${x.healed || ''}</td><td class="num">${x.taken}</td><td class="num">${pctTxt(x.alive)}</td><td class="small">${Object.entries(x.casts).map(([t, c]) => `${esc(t)} ${c}`).join(', ')}</td></tr>`).join('')}</tbody></table>`;
    body = `<div class="card"><h4 style="margin-top:0">vs ${esc(R.opName)} <span class="small muted">${esc(teamText(R.op))}</span></h4>
      <div class="sim-wdl"><b class="w" style="flex:${r.win || 0.001}">승 ${pctTxt(r.winRate)}</b><b class="d" style="flex:${r.draw || 0.001}">무 ${pctTxt(r.drawRate)}</b><b class="l" style="flex:${r.lose || 0.001}">패 ${pctTxt(r.loseRate)}</b></div>
      <p class="small muted">${r.n}회 · 평균 ${r.turns.toFixed(1)}턴 · 남은 병력 아군 ${pctTxt(r.hpA)} / 상대 ${pctTxt(r.hpB)} · ${R.ms}ms</p>
      <div class="tbl-wrap">${tbl('A')}</div><div class="tbl-wrap" style="margin-top:8px">${tbl('B')}</div>
      <details style="margin-top:10px"><summary class="small">전법별로 반영한 효과 (${r.parsed.length}개)</summary><ul class="small">${r.parsed.map(p => `<li><b>${esc(p.name)}</b> <span class="muted">${esc(p.type)} ${Math.round(p.rate * 100)}%</span> — ${p.effects.length ? p.effects.map(esc).join(', ') : '<span class="warn">반영한 효과 없음 (설명에서 수치를 못 뽑음)</span>'}</li>`).join('')}</ul></details>
      <details style="margin-top:6px"><summary class="small">전투 기록 (첫 판)</summary><pre class="sim-log">${esc((r.log || []).join('\n'))}</pre></details></div>`;
  } else if (R && R.kind === 'gauntlet') {
    body = `<div class="card"><h4 style="margin-top:0">티어 덱 ${R.g.length}개와 붙인 결과 <span class="small muted">평균 승률 ${pctTxt(R.avg)} · ${R.ms}ms</span></h4>
      <div class="tbl-wrap"><table class="cx-tbl"><thead><tr><th>상대</th><th>티어</th><th>승</th><th>무</th><th>패</th><th>평균 턴</th></tr></thead><tbody>
      ${R.g.slice().sort((x, y) => y.win - x.win).map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.tier || '')}</td><td class="num">${pctTxt(x.win)}</td><td class="num">${pctTxt(x.draw)}</td><td class="num">${pctTxt(x.lose)}</td><td class="num">${x.turns ? x.turns.toFixed(1) : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
  } else if (R && R.kind === 'alts') {
    body = `<div class="card"><h4 style="margin-top:0">대체 후보 시험 <span class="small muted">상대: ${esc(R.opName)} · 지금 조합 승률 ${pctTxt(R.base.win)} · ${R.ms}ms</span></h4>
      <div class="tbl-wrap"><table class="cx-tbl"><thead><tr><th>바꿀 곳</th><th>지금</th><th>대체</th><th>승률</th><th>변화</th><th></th></tr></thead><tbody>
      ${R.rows.map(x => `<tr><td>${x.si + 1}번 ${x.what === 'g' ? '무장' : `${esc(x.owner)} 전법${x.ti + 1}`}</td><td>${esc(x.from)}</td><td><b>${esc(x.to)}</b></td><td class="num">${pctTxt(x.win)}</td><td class="num ${x.d > 0.02 ? 'have' : x.d < -0.02 ? 'warn' : 'muted'}">${x.d >= 0 ? '+' : ''}${Math.round(x.d * 100)}%p</td>
        <td><button class="btn sm" data-act="comboSet" data-si="${x.si}" data-f="${x.what}" ${x.what === 't' ? `data-ti="${x.ti}"` : ''} data-v="${esc(x.to)}">적용</button></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">후보는 조합 분석의 대체 후보 상위 3개(전법) · 3명(무장)입니다. '적용'을 누르면 조합이 바뀌고, 다시 돌려서 확인할 수 있습니다.</p></div>`;
  } else if (R && R.r && R.r.error) body = `<div class="empty">${esc(R.r.error)}</div>`;
  return bar + body + `<p class="small muted" style="margin-top:12px"><b>간이 엔진입니다.</b> 능력치·발동률과 전법 설명에서 뽑은 수치(피해·치유 계수, 피해 감소·증가, 능력치 증가, 제어)로 8턴을 돌립니다. 피해 공식, 병종 상성, 병법·장비, 상태 이상 규칙은 공개 자료가 없어 넣지 않았거나 추정했습니다. 그래서 승률 숫자 자체보다 같은 조건에서 <b>A안과 B안 중 무엇이 나은지</b> 비교하는 데 쓰세요. 무장마다 배분 포인트 50을 무력·지력 중 높은 쪽에 넣고, 진형에 따라 전열/후열을 자동 배치합니다. 명령줄 실행은 README의 '모의전투'를 보세요.</p>`;
}
function viewCodex() {
  const u = state.ui, a = acct(), cx = cxData(), tab = u.cxTab || 'gen';
  const seg = (k, opts, def) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="set" data-k="${k}" data-v="${v}" class="${(u[k] || def) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const head = `<div class="bar">${seg('cxTab', [['gen', `무장 ${cx.generals.length}`], ['tac', `전법 ${cx.tactics.length}`], ['form', `진형 ${cx.formations.length}`], ['combo', '조합 분석'], ['sim', '모의전투']], 'gen')}
    <button class="btn" data-act="cxExport" title="도감 전체를 JSON 파일로 내려받습니다(모의 조합·로컬 AI 에이전트용)">JSON 내려받기</button></div>`;
  const q = key(u.cxQ || '');
  let body = '';
  if (tab === 'gen') {
    let gs = cx.generals.slice();
    const f = (k, fn) => { if (u[k] && u[k] !== 'all') gs = gs.filter(g => fn(g, u[k])); };
    f('cxSeason', (g, v) => String(g.season) === v); f('cxFac', (g, v) => g.fac === v); f('cxPos', (g, v) => (g.pos || '미확인') === v);
    f('cxTroop', (g, v) => g.troop === v); f('cxUType', (g, v) => g.unique && g.unique.type === v); f('cxOwn', (g, v) => (v === 'own') === ownsG(a, g.key));
    if (q) gs = gs.filter(g => hmatch(g.name, u.cxQ) || hmatch(g.unique && g.unique.name, u.cxQ));
    const sk = u.cxSort || 'default';
    if (CX_STATS.includes(sk)) gs.sort((x, y) => ((y.stats || {})[sk]?.lv50 || 0) - ((x.stats || {})[sk]?.lv50 || 0));
    else if (sk === 'name') gs.sort((x, y) => x.name.localeCompare(y.name, 'ko'));
    else if (sk === 'used') gs.sort((x, y) => ((G.get(y.key) || {}).used || 0) - ((G.get(x.key) || {}).used || 0));
    const filters = `<div class="bar"><input type="search" placeholder="무장·고유 전법 검색 (초성 가능)" value="${esc(u.cxQ || '')}" data-model="cxQ">
      <span class="fl"><span class="small muted">정렬</span>${seg('cxSort', [['default', '기본'], ['name', '이름'], ['used', '덱 수'], ...CX_STATS.map(s => [s, s])], 'default')}</span>
      <span class="fl"><span class="small muted">보기</span>${seg('cxView', [['cards', '카드'], ['table', '표']], 'cards')}</span></div>
      <div class="bar"><span class="fl"><span class="small muted">시즌</span>${seg('cxSeason', [['all', '전체'], ['1', 'S1'], ['2', 'S2'], ['3', 'S3']], 'all')}</span>
      <span class="fl"><span class="small muted">진영</span>${seg('cxFac', [['all', '전체'], ['위', '위'], ['촉', '촉'], ['오', '오'], ['군', '군']], 'all')}</span>
      <span class="fl"><span class="small muted">위치</span>${seg('cxPos', [['all', '전체'], ['전열', '전열'], ['균형', '균형'], ['후열', '후열'], ['미확인', '미확인']], 'all')}</span></div>
      <div class="bar"><span class="fl"><span class="small muted">병종</span>${seg('cxTroop', [['all', '전체'], ['기병', '기병'], ['방패병', '방패병'], ['궁병', '궁병'], ['창병', '창병']], 'all')}</span>
      <span class="fl"><span class="small muted">고유 유형</span>${seg('cxUType', [['all', '전체'], ['지휘', '지휘'], ['액티브', '액티브'], ['패시브', '패시브'], ['추격', '추격']], 'all')}</span>
      <span class="fl"><span class="small muted">${esc(a.name)}</span>${seg('cxOwn', [['all', '전체'], ['own', '보유'], ['miss', '미보유']], 'all')}</span></div>`;
    const cards = u.cxView === 'table'
      ? `<div class="tbl-wrap"><table class="cx-tbl"><thead><tr><th>무장</th><th>시즌</th><th>진영</th><th>병종</th><th>위치</th>${CX_STATS.map(s => `<th>${s}</th>`).join('')}<th>고유 전법</th><th>덱</th></tr></thead><tbody>
        ${gs.map(g => `<tr class="${ownsG(a, g.key) ? 'own' : ''}"><td><button class="lnk" data-act="cxOpen" data-k="${esc(g.key)}">${esc(g.name)}</button></td><td>${g.season ? `S${g.season}` : ''}</td><td>${esc(g.fac || '')}</td><td>${esc(g.troop || '')}</td><td>${esc(g.pos || '—')}</td>
          ${CX_STATS.map(s => { const v = (g.stats || {})[s]; return `<td class="num">${v && v.lv50 != null ? Math.round(v.lv50) : ''}${v && v.growth != null ? `<span class="small muted"> ${v.growth}</span>` : ''}</td>`; }).join('')}
          <td>${g.unique ? `${ticon(g.unique.type)}${esc(g.unique.name || '')}${traitBadge(g.unique.trait)}` : ''}</td><td class="num">${(G.get(g.key) || {}).used || ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="cx-grid">${gs.map(g => { const own = ownsG(a, g.key), st = g.stats || {};
        return `<button class="cx-card ${own ? 'on' : ''}" data-act="cxOpen" data-k="${esc(g.key)}">${avatar(g.key, { a: own ? a : null })}
          <span class="cx-c"><b>${esc(g.name)}</b><span class="small muted">${esc([g.season ? `S${g.season}` : '', g.pos || '위치?', g.troop].filter(Boolean).join(' · '))}</span>
          <span class="cx-u">${g.unique ? `${ticon(g.unique.type)}${esc(g.unique.name || '')}` : ''}</span>
          <span class="cx-mini">${CX_STATS.map(s => `<i title="${s}">${s[0]}${st[s] && st[s].lv50 != null ? Math.round(st[s].lv50) : '—'}</i>`).join('')}</span></span></button>`; }).join('')}</div>`;
    body = filters + `<p class="small muted">${gs.length}명 · 카드를 누르면 능력치·고유 전법·쓰이는 덱이 보입니다. 능력치는 50레벨 기본값(배분 포인트·돌파·병법 제외)이고, '+n/렙'은 레벨당 성장입니다.</p>` + (gs.length ? cards : '<div class="empty">조건에 맞는 무장이 없습니다.</div>');
    const og = openCodexKey && cxGen(openCodexKey);
    if (og) body += `<div class="deck-pop" data-act="cxClose"><div data-stop="1">${cxGenDetail(og, a)}</div></div>`;
    if (!og && openDeckId && deckById(openDeckId)) body += `<div class="deck-pop" data-act="closeDeck"><div data-stop="1">${deckCard(deckById(openDeckId), a)}</div></div>`;
  } else if (tab === 'tac') {
    let ts = cx.tactics.slice();
    if (u.cxTType && u.cxTType !== 'all') ts = ts.filter(t => t.type === u.cxTType);
    if (u.cxTTrait && u.cxTTrait !== 'all') ts = ts.filter(t => t.trait === u.cxTTrait);
    if (u.cxTSeason && u.cxTSeason !== 'all') ts = ts.filter(t => (t.season || '?') === u.cxTSeason);
    if (q) ts = ts.filter(t => hmatch(t.name, u.cxQ) || key(t.desc).includes(q) || (t.tags || []).some(x => hmatch(x, u.cxQ)));
    const sk = u.cxTSort || 'type', TY = ['지휘', '액티브', '패시브', '추격'];
    ts.sort(sk === 'rate' ? (x, y) => (y.rate || 0) - (x.rate || 0) : sk === 'used' ? (x, y) => ((T.get(y.key) || {}).used || 0) - ((T.get(x.key) || {}).used || 0)
      : sk === 'name' ? (x, y) => x.name.localeCompare(y.name, 'ko') : (x, y) => TY.indexOf(x.type) - TY.indexOf(y.type) || x.name.localeCompare(y.name, 'ko'));
    body = `<div class="bar"><input type="search" placeholder="전법 이름·설명·태그 검색 (초성 가능)" value="${esc(u.cxQ || '')}" data-model="cxQ">
      <span class="fl"><span class="small muted">정렬</span>${seg('cxTSort', [['type', '유형'], ['name', '이름'], ['rate', '발동률'], ['used', '덱 수']], 'type')}</span></div>
      <div class="bar"><span class="fl"><span class="small muted">유형</span>${seg('cxTType', [['all', '전체'], ...TY.map(t => [t, t])], 'all')}</span>
      <span class="fl"><span class="small muted">특성</span>${seg('cxTTrait', [['all', '전체'], ...TRAITS.map(t => [t, t])], 'all')}</span>
      <span class="fl"><span class="small muted">시즌</span>${seg('cxTSeason', [['all', '전체'], ['S1', 'S1'], ['S2', 'S2'], ['S3', 'S3']], 'all')}</span></div>
      <p class="small muted">${ts.length}개 · 발동률은 10레벨 기준입니다. '보유'는 ${esc(a.name)} 계정의 전법 수(영본 포함)입니다.</p>
      <div class="tbl-wrap"><table class="cx-tbl tac"><thead><tr><th>전법</th><th>유형</th><th>특성</th><th>발동</th><th>시즌</th><th>덱</th><th>보유</th><th>효과</th></tr></thead><tbody>
      ${ts.map(t => { const n = tCount(a, t.key); return `<tr class="${n ? 'own' : ''}"><td class="nm">${ticon(t.type)}<b>${esc(t.name)}</b>${t.orig ? `<div class="small muted">${esc(t.orig)}</div>` : ''}</td><td>${esc(t.type || '')}</td><td>${traitBadge(t.trait)}</td><td class="num">${cxRate(t.rate)}</td><td>${esc(t.season || '')}</td>
        <td class="num">${(T.get(t.key) || {}).used || ''}</td><td class="num">${n ? (n > 1 ? '×2' : '○') : ''}</td><td class="desc">${esc(t.desc || '설명 없음')}${(t.tags || []).length ? `<div class="tags">${t.tags.map(x => `<span class="tag sub">${esc(x)}</span>`).join('')}</div>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  } else if (tab === 'combo') {
    body = viewCombo(a);
  } else if (tab === 'sim') {
    body = viewSim(a);
  } else {
    body = `<p class="small muted">자리별 피격률은 적의 일반 공격·단일 대상 전법이 그 자리를 노릴 확률입니다. 앞쪽 자리가 전열입니다. 효과 수치는 기본값이며 건물 기술로 강화됩니다.</p>
      <div class="tbl-wrap"><table class="cx-tbl"><thead><tr><th>진형</th><th>전열</th><th>피격률 (자리별)</th><th>효과</th></tr></thead><tbody>
      ${cx.formations.map(f => `<tr><td><b>${esc(f.name)}</b>${f.season ? ` <span class="small muted">S${f.season}</span>` : ''}</td><td class="num">${f.front}명</td>
        <td>${f.hit.map((h, i) => `<span class="tag ${i < f.front ? '' : 'sub'}">${i < f.front ? '전' : '후'} ${h}%</span>`).join(' ')}</td><td>${f.fx.map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return head + body + `<p class="small muted" style="margin-top:16px">출처: <a href="https://three-kingdoms-data-browser.vercel.app/info/" target="_blank" rel="noopener">삼천 데이터</a>(무장·전법·진형 표)를 먼저 쓰고, 빈칸(S1 성장률, 일부 S3·연의 무장 능력치, 전법 발동률)은 <a href="https://sam.mixcoffee.org/data" target="_blank" rel="noopener">믹스커피 게임 데이터</a> 화면에서 확인해 채웠습니다. 정리일 ${esc(cx.built || '')}.</p>`;
}

const VIEWS = { decks: viewDecks, own: viewOwn, lineup: viewLineup, coexist: viewCoexist, codex: viewCodex, data: viewData };
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
    for (const t of state.sheet.tabs) { msg.textContent = `불러오는 중… ${t.name}`; tabs.push({ ...t, grid: await gvizGrid(t.sid || id, t) }); }
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
    case 'openDeck': openDeckId = b.dataset.id; openCodexKey = null; break;
    case 'cxOpen': openCodexKey = b.dataset.k; break;
    case 'simRun': return simRun(b.dataset.k);
    case 'comboOwned': state.ui.comboOwned = b.checked; break;
    case 'comboClear': state.ui.combo = null; comboState(); break;
    case 'comboSet': { const c = comboState(), sl = c.slots[+b.dataset.si]; if (b.dataset.f === 'g') sl.g = b.dataset.v; else sl.t[+b.dataset.ti] = b.dataset.v; c.from = ''; break; }
    case 'cxClose': if (e.target.closest('[data-stop]') && !e.target.closest('[data-act="cxClose"].btn')) return; openCodexKey = null; break;
    case 'cxExport': {
      const blob = new Blob([JSON.stringify(window.CODEX || {}, null, 1)], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `천하결전-W1-도감-${(window.CODEX || {}).built || 'data'}.json`; l.click(); return;
    }
    case 'tacReset': if (ai.tacPick) delete ai.tacPick[b.dataset.id]; break;
    case 'closeDeck': if (e.target.closest('[data-stop]')) return; openDeckId = null; break;
    case 'toggleSub': ai.allowSub = b.checked; break;
    case 'toggleUsedOnly': state.ui.ownUsedOnlyV2 = b.checked; break;
    case 'gen': {
      const k = b.dataset.k, g = a.generals[k];
      if (state.ui.ownMode === 'grade') { const x = g && g.owned ? g : (a.generals[k] = { owned: true, stars: 0, grade: 0 }); cycleGrade(x); break; }
      // 돌파: 미보유 → 0돌 → 1 … 5돌 → 미보유
      if (!g || !g.owned) a.generals[k] = { owned: true, stars: 0, grade: (g && g.grade) || 0 };
      else if ((g.stars || 0) < MAX_STARS) g.stars = (g.stars || 0) + 1;
      else delete a.generals[k];
      break;
    }
    case 'tac': {
      const k = b.dataset.k, n = a.tactics[k] || 0;
      if (state.ui.ownTacMode === 'copies') { a.tactics[k] = n === 1 ? 2 : 1; break; }   // 영본: 1개 ↔ 2개
      if (n) delete a.tactics[k]; else a.tactics[k] = 1;                                // 보유 ↔ 미보유
      break;
    }
    case 'addTac': { const v = $('#newTac').value.trim(); if (!v) return; const ent = reg(T, v); a.tactics[ent.key] = 1; ent.fixed = true; break; }
    case 'clearOwn': if (!confirm(`${a.name}의 ${state.ui.ownTab === 'generals' ? '무장' : '전법'} 보유 표시를 모두 해제할까요?`)) return; if (state.ui.ownTab === 'generals') a.generals = {}; else a.tactics = {}; break;
    case 'bulkApply': return bulkApply();
    case 'toggleLineup': { const i = a.lineup.findIndex(id => resolveId(id) === b.dataset.id); if (i >= 0) a.lineup.splice(i, 1); else { a.lineup.push(b.dataset.id); toast(`${a.name} 편성에 추가 (${a.lineup.length}/${a.squads})`); } break; }
    case 'luDel': ai.lineup = ai.lineup.filter(x => x !== b.dataset.id); if (ai.locked) delete ai.locked[b.dataset.id]; break;
    case 'luLock': {
      const id = b.dataset.id; ai.locked = ai.locked || {};
      if (ai.locked[id]) { delete ai.locked[id]; toast('고정 해제'); break; }
      const c = lineupConflicts(ai)[id];
      const d = findDeck(id, ai);
      const gens = c && c.r ? c.r.g : d.slots.filter(sl => sl.gen).map(sl => sl.gen.opts.find(k => ownsG(ai, k)) || sl.gen.opts[0]);
      ai.locked[id] = d.slots.map(sl => (sl.gen ? gens.shift() : null));
      toast('고정: 무장은 그대로 두고 전법만 다시 고릅니다');
      break;
    }
    case 'pull': { pullCache[ai.id] = { busy: true }; render(); setTimeout(() => { pullCache[ai.id] = { list: pullAdvice(ai), at: Date.now() }; render(); }, 30); return; }
    case 'yeon': break;
    case 'luUp': { const i = ai.lineup.indexOf(b.dataset.id); if (i > 0) [ai.lineup[i - 1], ai.lineup[i]] = [ai.lineup[i], ai.lineup[i - 1]]; break; }
    case 'luClear': ai.lineup = (ai.lineup || []).filter(id => (ai.locked || {})[id]); break;
    case 'auto': {
      const plan = planLineup(ai);
      ai.lineup = plan.lineup;
      // 고정 목록 정리 (편성에서 빠진 고정 덱 제거)
      Object.keys(ai.locked || {}).forEach(id => { if (!ai.lineup.includes(id)) delete ai.locked[id]; });
      const nf = plan.lineup.filter(id => id.startsWith('filler:')).length;
      toast(plan.lineup.length ? `${ai.name}: ${plan.lineup.length}부대 편성${nf ? ` (남은 무장 부대 ${nf})` : ''}` : `${ai.name}: 보유 무장이 부족합니다`);
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
  if (A === 'simOpt') { state.ui[t.dataset.k] = t.value; persist(); render(); return; }
  if (A === 'combo') {
    const c = comboState(), f = t.dataset.f;
    if (f === 'from') { const d = t.value && deckById(t.value); if (d) comboFromDeck(d); else c.from = ''; }
    else if (f === 'form') c.form = t.value;
    else if (f === 'g') { c.slots[+t.dataset.si].g = t.value; c.from = ''; }
    else if (f === 't') { c.slots[+t.dataset.si].t[+t.dataset.ti] = t.value; c.from = ''; }
    persist(); render(); return;
  }
  if (t.dataset.tabcfg != null) { state.sheet.tabs[+t.dataset.tabcfg][t.dataset.f] = t.value; persist(); return; }
  if (t.id === 'importFile' && t.files[0]) {
    t.files[0].text().then(txt => {
      try { const d = JSON.parse(txt); if (!d.state || !Array.isArray(d.state.accounts)) throw new Error('형식 오류'); state = d.state; state.ui = Object.assign({}, state.ui); normalizeAccounts(); clampAccounts(); persist(); buildData(); render(); toast('백업을 불러왔습니다'); }
      catch (err) { toast('불러오기 실패: ' + err.message); }
    });
    return;
  }
  if (!A) return;
  const a = acct();
  if (A === 'tacPick') {
    const x = state.accounts[+t.dataset.a], id = t.dataset.id, cid = t.dataset.cell;
    x.tacPick = x.tacPick || {}; const m = x.tacPick[id] = x.tacPick[id] || {};
    if (t.value) m[cid] = t.value; else delete m[cid];
    if (!Object.keys(m).length) delete x.tacPick[id];
    persist(); render(); return;
  }
  if (A === 'rename') { a.name = t.value.trim() || a.name; }
  else if (A === 'squads') { state.accounts[+t.dataset.a].squads = +t.value; }
  else if (A === 'mainCount') { state.accounts[+t.dataset.a].mainCount = +t.value; }
  else if (A === 'yeon') { const x = state.accounts[+t.dataset.a]; x.yeonui = x.yeonui || {}; t.dataset.group.split(',').forEach(b => delete x.yeonui[b]); if (t.value) x.yeonui[t.value] = 'yeon'; delete pullCache[x.id]; }
  else if (A === 'breakLevel') { state.accounts[+t.dataset.a].breakLevel = t.value; }
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
window.__tk3 = { get DECKS() { return DECKS; }, get COEXIST() { return COEXIST; }, G, T, check, solve, planLineup, realizations, subVariant, fits, Cloud, state: () => state };
})();
