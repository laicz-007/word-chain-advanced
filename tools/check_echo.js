/* tools/check_echo.js — 回声规则 / 词库清理 验收脚本
 *
 * 用途：一条命令看清"禁止回声 + 依赖型短词清理"的当前状态。
 * 用法：在项目根目录执行  node tools/check_echo.js
 *
 * 想自己试别的词：改下面 TEST_PAIRS（上词 → 回答词）与 CHECK_WORDS 两组即可。
 */
'use strict';
var S = require('../server.js');
var R = S.R, store = S.store, db = S.dbVocab;

// 想试的"上词 → 回答词"组合（第二列若是上词的末尾 2/3 字母，就是"回声"）
var TEST_PAIRS = [
  ['atlas', 'as'],          // 高频回声 → 应允许
  ['envisage', 'age'],      // 高频回声 → 应允许
  ['into', 'to'],           // 高频回声 → 应允许
  ['boa', 'oat'],           // oat 有独立意思但非高频；这不是回声 → 应允许
  ['bloat', 'oat'],         // 想拿 oat 当回声偷懒 → 应拒绝
  ['abarticular', 'lar']    // 用户抱怨的场景（lar 已被删除）→ 应进入"非词库词确认"
];

// 想查在不在词库里的词
var CHECK_WORDS = ['lar', 'te', 'ogy', 'ess', 'ne', 'ier', 'ary', 'ery', 'sis', 'zed', 'gy',
  'oat', 'tin', 'ram', 'hen', 'lid', 'ox', 'log', 'owl', 'ate', 'to', 'be', 'as'];

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

// 走真实对局路径（Game.submitStart + submitChain），输出即等于游戏里实际发生的
function gameTest(prev, w) {
  var g = new R.Game(store, [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]);
  var s = g.submitStart(prev);
  if (!s.ok) return { res: '上词无法作开局词（' + String(s.reason).slice(0, 18) + '）' };
  var r = g.submitChain(w);
  if (r.ok) return { res: '允许 ✓' };
  if (r.pending === 'non-vocab') return { res: '弹「确认使用」——该词不在词库' };
  if (r.reason && r.reason.indexOf('结尾') >= 0) return { res: '拒绝：禁止回声' };
  return { res: '拒绝：' + String(r.reason).slice(0, 24) };
}

console.log('==================== 词库概况 ====================');
console.log('  词条总数: ' + db.length);
var hotEcho = db.filter(function (e) { return e.w.length <= 3 && R.isTrustedEntry(e); });
console.log('  可回声的高频短词(≤3字母): ' + hotEcho.length + ' 个');
console.log('  ECHO_KEEP_F(高频阈值) = ' + R.ECHO_KEEP_F + '   （柯林斯≥1星 或 常见度≥该值 或 有精讲 = 可信）');

console.log('\n==================== 1) 回声规则：高频允许 / 生僻拒绝 ====================');
console.log('  ' + pad('上词 → 回答词', 26) + pad('是否回声', 10) + pad('词是否在库', 12) + '游戏中的实际结果');
TEST_PAIRS.forEach(function (p) {
  var prev = p[0], w = p[1];
  var isEcho = R.isEcho(prev, w);
  var inBank = !!store.lookup(w);
  console.log('  ' + pad(prev + ' → ' + w, 26) + pad(isEcho ? '是' : '否', 10) +
    pad(inBank ? '在库' : '不在库', 12) + gameTest(prev, w).res);
});

console.log('\n==================== 2) 词库清理：该删的删了、该留的留了 ====================');
var SHOULD_BE_GONE = ['lar', 'te', 'ogy', 'ess', 'ne', 'ier', 'ary', 'ery', 'sis', 'zed', 'gy'];
var SHOULD_KEEP = ['oat', 'tin', 'ram', 'hen', 'lid', 'ox', 'log', 'owl', 'ate', 'to', 'be', 'as'];
var wrong = 0;
console.log('  应删除（依赖型/生僻回声词）:');
SHOULD_BE_GONE.forEach(function (w) {
  var gone = !store.lookup(w);
  if (!gone) wrong++;
  console.log('    ' + pad(w, 8) + (gone ? '已删除 ✓' : '仍在库 ✗'));
});
console.log('  应保留（有独立意思的真词）:');
SHOULD_KEEP.forEach(function (w) {
  var kept = !!store.lookup(w);
  if (!kept) wrong++;
  console.log('    ' + pad(w, 8) + (kept ? '保留 ✓' : '被删 ✗'));
});
console.log('  → ' + (wrong === 0 ? '全部符合预期 ✓' : ('有 ' + wrong + ' 项不符合 ✗')));

console.log('\n==================== 3) 指定词的词库状态 ====================');
CHECK_WORDS.forEach(function (w, i) {
  var e = store.lookup(w);
  var tag = e ? ('在库  可信=' + (R.isTrustedEntry(e) ? '是(可回声)' : '否(不可回声)')) : '不在库';
  process.stdout.write('  ' + pad(w, 7) + tag + ((i % 2 === 1) ? '\n' : '        '));
});
if (CHECK_WORDS.length % 2 === 1) console.log('');
