// 모의전투 명령줄 실행기 — Node 없이 macOS 기본 JavaScriptCore(jsc)로 돌아갑니다. (Node가 있으면 node로도 됩니다)
//
// 저장소 맨 위 폴더에서:
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC scripts/sim_cli.js -- decks                         추천 덱 이름 목록(믹스커피 W1·추가 조사)
//   $JSC scripts/sim_cli.js -- vs 연료마 월량마 [--n 500] [--log]
//   $JSC scripts/sim_cli.js -- gauntlet 연료마 [--tier T1] [--n 200]   티어 덱 전체와 붙이기
//   $JSC scripts/sim_cli.js -- vs team.json 월량마             팀 파일: {"form":"구행진","slots":[{"g":"하후연","t":["원문사극","신속 전개"]},…]}
//   $JSC scripts/sim_cli.js -- parse 요새 함락                  전법 설명에서 뽑은 효과 보기
// 결과는 JSON으로 출력합니다(로컬 에이전트가 읽기 좋게). --pretty를 붙이면 들여쓰기합니다.
var window = this;
var isNode = typeof require === 'function' && typeof module !== 'undefined';
// jsc는 인자를 Latin-1로 넘기므로 UTF-8로 되돌립니다.
var fixUtf8 = function (s) { try { return decodeURIComponent(escape(s)); } catch (e) { return s; } };
var argv = isNode ? process.argv.slice(2) : (typeof arguments !== 'undefined' ? Array.prototype.slice.call(arguments).map(fixUtf8) : []);
var out = isNode ? function (s) { console.log(s); } : print;
function loadJs(p) { if (isNode) { var vm = require('vm'); vm.runInThisContext(require('fs').readFileSync(p, 'utf8'), { filename: p }); } else load(p); }
function readText(p) { return isNode ? require('fs').readFileSync(p, 'utf8') : readFile(p); }
if (isNode) { global.window = global; }
['data/codex.js', 'data/research-decks.js', 'data/mix-w1-decks.js', 'combo.js', 'sim.js'].forEach(loadJs);
var CODEX = window.CODEX, Sim = window.TK3Sim;
var key = function (s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); };

// 추천 덱(추가 조사 묶음) → 팀
var DECKS = [];
(window.RESEARCH_DECKS || []).forEach(function (src) {
  (src.decks || []).forEach(function (d) {
    if (!d.generals || d.generals.length < 3) return;
    DECKS.push({ name: d.name, tier: d.tier || '', src: src.source, team: {
      form: d.formation || '',
      slots: d.generals.slice(0, 3).map(function (g, i) {
        return { g: String(g).split('/')[0].replace(/\(.*?\)/g, '').trim(), t: ((d.tactics || [])[i] || []).map(function (t) { return String(t).split('/')[0].replace(/^[영경]·/, '').trim(); }) };
      }) } });
  });
});
function findDeck(name) { var k = key(name); return DECKS.filter(function (d) { return key(d.name) === k; })[0] || DECKS.filter(function (d) { return key(d.name).indexOf(k) >= 0; })[0]; }
function teamOf(arg) {
  if (/\.json$/.test(arg)) return { name: arg, team: JSON.parse(readText(arg)) };
  var d = findDeck(arg); if (!d) throw new Error('덱을 찾지 못함: ' + arg + ' (decks 명령으로 목록 확인)');
  return d;
}
function opt(name, def) { var i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && argv[i + 1].indexOf('--') !== 0 ? argv[i + 1] : true) : def; }
var pos = argv.filter(function (a, i) { return a.indexOf('--') !== 0 && !(i > 0 && argv[i - 1].indexOf('--') === 0 && ['n', 'seed', 'tier', 'troops'].indexOf(argv[i - 1].slice(2)) >= 0); });
var cmd = pos[0];
var o = { n: +opt('n', 300), seed: +opt('seed', 12345), troops: +opt('troops', 10000), log: !!opt('log', false) };
var pretty = opt('pretty', false) ? 1 : 0;
var TIER_ORDER = { 'T0+': 0, 'T0': 1, 'T1': 2, 'T2': 3, 'T3': 4 };
try {
  if (cmd === 'decks') out(JSON.stringify(DECKS.map(function (d) { return { name: d.name, tier: d.tier, form: d.team.form, generals: d.team.slots.map(function (s) { return s.g; }) }; }), null, pretty));
  else if (cmd === 'parse') { var t = CODEX.tactics.filter(function (x) { return key(x.name) === key(pos.slice(1).join(' ')); })[0] || CODEX.generals.map(function (g) { return g.unique; }).filter(function (u) { return u && key(u.name) === key(pos.slice(1).join(' ')); })[0]; out(JSON.stringify(t ? Sim.parseTactic(t) : { error: '전법을 찾지 못함' }, null, 1)); }
  else if (cmd === 'vs') {
    var A = teamOf(pos[1]), B = teamOf(pos[2]);
    var r = Sim.simulate(A.team, B.team, CODEX, o);
    r.a = A.name; r.b = B.name; if (!o.log) delete r.log;
    out(JSON.stringify(r, null, pretty));
  } else if (cmd === 'gauntlet') {
    var A2 = teamOf(pos[1]); var maxT = TIER_ORDER[opt('tier', 'T2')]; if (maxT == null) maxT = 3;
    var seen = {}, ops = DECKS.filter(function (d) { var tt = TIER_ORDER[d.tier]; if (tt == null || tt > maxT || seen[key(d.name)]) return false; seen[key(d.name)] = 1; return key(d.name) !== key(A2.name); });
    var g = Sim.gauntlet(A2.team, ops, CODEX, o);
    var avg = g.reduce(function (s, x) { return s + (x.win || 0); }, 0) / (g.length || 1);
    out(JSON.stringify({ team: A2.name, opponents: g.length, avgWin: Math.round(avg * 1000) / 1000, results: g.sort(function (x, y) { return y.win - x.win; }) }, null, pretty));
  } else out('사용법: decks | vs <덱|팀.json> <덱|팀.json> | gauntlet <덱|팀.json> [--tier T1] | parse <전법>   옵션: --n 300 --seed 1 --troops 10000 --log --pretty');
} catch (e) { out(JSON.stringify({ error: String(e && e.message || e) })); }
