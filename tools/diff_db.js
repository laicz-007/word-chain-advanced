/* tools/diff_db.js — 两份词库逐词逐字段对拍（差分测试）
 *
 * 用法：
 *   node tools/diff_db.js <A.json> <B.json>
 *   例：node tools/diff_db.js data/db.reference.json data/db.json
 *
 * 用途（OI 里的"对拍"）：**改了生成算法之后，用它证明结果没变**。
 * 只靠肉眼看统计摘要是不够的 —— 摘要相同不代表 30 万个词逐个相同。
 * 本脚本逐条比对，并明确区分三类字段：
 *   ① 整数字段：必须**逐位相同**，有任何一处不同就是改坏了
 *   ② 原样保留字段：必须逐位相同
 *   ③ 浮点字段：只允许"求和顺序变化"带来的 1e-12 以内相对误差
 *
 * 退出码：0 = 通过；1 = 有不可接受的差异（可直接用在 CI / 提交前检查里）
 */
'use strict';
var fs = require('fs');
var path = require('path');

var A = process.argv[2], B = process.argv[3];
if (!A || !B) {
  console.error('用法: node tools/diff_db.js <A.json> <B.json>');
  console.error('  例: node tools/diff_db.js data/db.reference.json data/db.json');
  process.exit(1);
}
function load(p) {
  if (!fs.existsSync(p)) { console.error('找不到文件: ' + p); process.exit(1); }
  return JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
}

var ref = load(A), cur = load(B);

// 整数字段：逻辑上必须完全一致
var INT_FIELDS = ['succ_cnt', 'c_cnt', 'has_succ', 'kind', 'dGuess', 'conf'];
// 浮点字段：允许求和顺序带来的极小误差
var FLOAT_FIELDS = ['chain_raw', 'chain', 'chain_idx'];
// 应从原始库原样带过来的字段
var RAW_FIELDS = ['w', 'zh', 'phonetic', 'frq', 'd', 'f', 'tag', 'collins', 'note', 'has_note'];
var REL_TOL = 1e-12;   // 相对误差上限（实测正常在 1e-14 量级）

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

console.log('对拍 A = ' + A);
console.log('     B = ' + B);
console.log('词条数: A=' + ref.length + '  B=' + cur.length);
if (ref.length !== cur.length) {
  console.log('⛔ 词条数不同，直接失败（生成逻辑改动过大，或用了不同的原始库）');
  process.exit(1);
}

var intDiff = {}, floatMax = {}, rawDiff = 0, orderOk = true, firstOrderBreak = '';
INT_FIELDS.forEach(function (k) { intDiff[k] = 0; });
FLOAT_FIELDS.forEach(function (k) { floatMax[k] = { abs: 0, rel: 0, at: '' }; });

for (var i = 0; i < ref.length; i++) {
  var a = ref[i], b = cur[i];
  if (a.w !== b.w) { orderOk = false; firstOrderBreak = '第 ' + i + ' 条: ' + a.w + ' vs ' + b.w; break; }
  RAW_FIELDS.forEach(function (k) { if (a[k] !== b[k]) rawDiff++; });
  INT_FIELDS.forEach(function (k) { if (a[k] !== b[k]) intDiff[k]++; });
  FLOAT_FIELDS.forEach(function (k) {
    var x = a[k], y = b[k];
    if (x === y) return;
    var d = Math.abs(x - y), r = d / Math.max(1e-30, Math.abs(x));
    if (r > floatMax[k].rel) floatMax[k] = { abs: d, rel: r, at: a.w + ' (' + x + ' vs ' + y + ')' };
  });
}

console.log('词序完全一致: ' + (orderOk ? '是 ✓' : ('否 ✗ ' + firstOrderBreak)));
console.log('');
console.log('① 整数字段（必须逐位相同）');
var bad = 0;
INT_FIELDS.forEach(function (k) {
  if (intDiff[k]) bad++;
  console.log('   ' + pad(k, 12) + (intDiff[k] === 0 ? '一致 ✓' : ('★ ' + intDiff[k] + ' 处不同')));
});
console.log('② 原样保留字段（必须逐位相同）');
if (rawDiff) bad++;
console.log('   ' + (rawDiff === 0 ? '全部一致 ✓' : ('★ ' + rawDiff + ' 处不同')));
console.log('③ 浮点字段（允许求和顺序带来的误差，上限 ' + REL_TOL.toExponential(0) + '）');
FLOAT_FIELDS.forEach(function (k) {
  var m = floatMax[k];
  if (m.rel > REL_TOL) bad++;
  console.log('   ' + pad(k, 12) + '最大相对差 ' + m.rel.toExponential(3) +
    (m.rel > REL_TOL ? '  ★ 超出上限' : '  ✓'));
  if (m.rel > 0) console.log('   ' + pad('', 12) + '出现在 ' + m.at);
});
if (!orderOk) bad++;

console.log('');
if (bad === 0) {
  console.log('🎉 对拍通过：两侧结果等价（浮点差异仅来自求和顺序，不影响 AI 排序）');
  process.exit(0);
} else {
  console.log('⛔ 对拍失败：有 ' + bad + ' 类字段出现不可接受的差异，请排查生成逻辑');
  process.exit(1);
}
