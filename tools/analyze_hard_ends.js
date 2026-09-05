/* 分析脚本：统计每个双辅音结尾 MN 能承接的 "MN xxx" / "XMN xxx" 词数
 *
 * 判据（按你的定义）：
 *   对双辅音 MN（词尾最后两个字母都是辅音），统计词库里有多少词满足
 *     - "M N xxx"   ：以 MN 开头（2 字母匹配）
 *     - "某个字母 M N xxx"：以 XMN 开头（3 字母匹配, X=该词倒数第 3 个字母, 可为任意字母含辅音）
 *   若这些"承接词"数量很少 / 频率很低 -> 该 MN 难接下去。
 *
 * 输出：每个 MN 的  cnt2(以MN开头) / cnt3(以XMN开头, 按前导字母X细分) / total / 最高词频
 *       total <= HARD_MAX 视为"难接"。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var R = require('../public/logic.js');

var HARD_MAX = Number(process.argv[2] || 2); // total<=2 视为难接

var ROOT = path.join(__dirname, '..');
var vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
var store = new R.WordStore(vocab);

var VOWELS = 'aeiouy';
function isConsonant(c) { return !!c && /[a-z]/.test(c) && VOWELS.indexOf(c) === -1; }
function isDoubConsonantEnd(w) { return w.length >= 2 && isConsonant(w[w.length - 1]) && isConsonant(w[w.length - 2]); }

// 1) 收集：每个双辅音结尾 MN 及其来源词、前导字母 X
var perMN = {};   // mn -> {sources:[{w,x}], xs:Set}
var by2 = {}, by3 = {};
store.list.forEach(function (e) {
  var w = e.w;
  if (w.length < 2) return;
  // 前缀索引
  (by2[w.slice(0, 2)] = by2[w.slice(0, 2)] || []).push(e.w);
  if (w.length >= 3) (by3[w.slice(0, 3)] = by3[w.slice(0, 3)] || []).push(e.w);

  if (!isDoubConsonantEnd(w)) return;
  var mn = w.slice(-2);
  var x = w.length >= 3 ? w[w.length - 3] : '(短)';
  (perMN[mn] = perMN[mn] || { xs: {}, cnt: 0 }).xs[x] = (perMN[mn].xs[x] || 0) + 1;
  perMN[mn].cnt++;
});

// 2) 每个 MN 统计承接词数量(仅长度>=3 的真实承接词)
var rows = [];
Object.keys(perMN).forEach(function (mn) {
  var p = perMN[mn];
  var cnt2 = (by2[mn] || []).filter(function (w) { return w.length >= 3; }).length; // 以 MN 开头的词数
  var cnt2freq = 0;
  (by2[mn] || []).forEach(function (w) { if (w.length < 3) return; var e = store.lookup(w); if (e && e.f > cnt2freq) cnt2freq = e.f; });

  var cnt3 = 0, cnt3freq = 0, perX = [];
  Object.keys(p.xs).forEach(function (x) {
    if (x === '(短)') return;                         // 2字母源词无真实 XMN
    var arr = by3[x + mn] || [];                      // 以 XMN 开头的词数
    var mf = 0;
    arr.forEach(function (w) { var e = store.lookup(w); if (e && e.f > mf) mf = e.f; });
    cnt3 += arr.length;
    if (mf > cnt3freq) cnt3freq = mf;
    perX.push(x + '→' + arr.length + (arr.length === 0 ? '(无)' : ''));
  });

  var total = cnt2 + cnt3;
  rows.push({
    mn: mn, cnt2: cnt2, cnt3: cnt3, total: total,
    maxFreq: Math.max(cnt2freq, cnt3freq),
    srcWords: p.cnt, xs: p.xs, perX: perX.join(' '),
    hard: total <= HARD_MAX
  });
});

rows.sort(function (a, b) {
  if (a.hard !== b.hard) return a.hard ? -1 : 1;      // 难接在前
  return a.total - b.total;
});

// 3) 汇总
var nHard = rows.filter(function (r) { return r.hard; }).length;
var report = {
  meta: { vocabSize: store.list.length, hardMax: HARD_MAX, genAt: new Date().toISOString() },
  mnCount: rows.length, hardCount: nHard,
  rows: rows
};
fs.writeFileSync(path.join(__dirname, 'hard_ends_report.json'), JSON.stringify(report, null, 2), 'utf8');

console.log('词库规模: ' + store.list.length);
console.log('双辅音结尾对(MN)出现个数: ' + rows.length + '  其中 total<=' + HARD_MAX + ' 的"难接"对数: ' + nHard);
console.log('\n===== 每个双辅音 MN 的 承接词数 (MN xxx + XMN xxx) =====');
console.log('  MN   以MN开头  以XMN开头  总数   最高词频  (按总数升序)');
rows.slice(0, 45).forEach(function (r) {
  console.log('  ' + pad(r.mn) + pad(String(r.cnt2)) + pad(String(r.cnt3)) + pad(String(r.total)) +
    '  ' + (r.maxFreq > 0 ? r.maxFreq.toFixed(2) : '0') + (r.hard ? '  ◀难接' : '') + '   [' + r.perX + ']');
});

function pad(s) { while (s.length < 6) s += ' '; return s; }
