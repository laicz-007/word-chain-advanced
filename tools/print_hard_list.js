/* 读取 hard_ends_report.json，按"难接程度"分组输出人类可读清单
 *
 * 报告由 tools/analyze_hard_ends.js 生成，真实字段结构：
 *   { meta: { vocabSize, hardMax, genAt }, mnCount, hardCount,
 *     rows: [ { mn, cnt2, cnt3, total, maxFreq, srcWords, xs, perX, hard } ] }
 *
 * ⚠ 重要：rows 的单位是"结尾对(MN)"，不是单词。
 *   所以本脚本按 MN 分组；不要假设存在 rep.words / rep.summary
 *   （那是更早一版报告的字段，现已被 rows / meta 取代 —— 这正是本脚本曾经崩溃的原因）。
 *
 * 用法:
 *   node tools/analyze_hard_ends.js     # 先生成报告（会读词库，稍慢）
 *   node tools/print_hard_list.js       # 再打印清单
 */
'use strict';
var fs = require('fs');
var path = require('path');

var REPORT = path.join(__dirname, 'hard_ends_report.json');
if (!fs.existsSync(REPORT)) {
  console.error('找不到 ' + REPORT);
  console.error('请先运行: node tools/analyze_hard_ends.js');
  process.exit(1);
}

var rep = JSON.parse(fs.readFileSync(REPORT, 'utf8'));

// ---- 兼容性自检：给出人话而不是 TypeError ----
if (!Array.isArray(rep.rows) || !rep.meta) {
  console.error('报告结构不是预期版本（缺少 rows / meta）。');
  console.error('实际顶层字段: ' + Object.keys(rep).join(', '));
  console.error('请重新运行: node tools/analyze_hard_ends.js');
  process.exit(1);
}

var rows = rep.rows;
var HARD_MAX = rep.meta.hardMax;

var dead = rows.filter(function (r) { return r.total === 0; });
var hard = rows.filter(function (r) { return r.total > 0 && r.total <= HARD_MAX; });

// 排序：承接词少的在前；同样少时，词频低的更危险（连常用词都没有）
function worseFirst(a, b) {
  if (a.total !== b.total) return a.total - b.total;
  return a.maxFreq - b.maxFreq;
}
dead.sort(worseFirst);
hard.sort(worseFirst);

var lines = [];
lines.push('# 难接双辅音结尾清单');
lines.push('');
lines.push('判据 = 每个双辅音结尾对(MN)真正能接上的词数 total（"MNxxx" + "XMNxxx" 两种开头之和）。');
lines.push('生成时间: ' + rep.meta.genAt + '   词库规模: ' + rep.meta.vocabSize);
lines.push('');
lines.push('统计：双辅音结尾对 = ' + rep.mnCount +
  '；DEAD（total = 0，死路）= ' + dead.length +
  '；HARD（total ≤ ' + HARD_MAX + '）= ' + hard.length +
  '；报告标记 hard = ' + rep.hardCount);
lines.push('');

function block(title, list, note) {
  lines.push('## ' + title + '（' + list.length + ' 个结尾）');
  if (note) lines.push('   ' + note);
  lines.push('');
  if (!list.length) {
    lines.push('   （无）');
    lines.push('');
    return;
  }
  lines.push('   结尾   以该结尾的词  承接词(MN)  承接词(XMN)  合计  最高词频  三字母分布');
  list.forEach(function (r) {
    lines.push('   ' + pad(r.mn, 6) + pad(String(r.srcWords), 12) + pad(String(r.cnt2), 11) +
      pad(String(r.cnt3), 12) + pad(String(r.total), 6) +
      pad(r.maxFreq > 0 ? r.maxFreq.toFixed(2) : '0', 10) +
      (r.perX || '(短)'));
  });
  lines.push('');
}

block('DEAD — 完全接不上（建议在选词/提示时避开）', dead,
  '这类结尾一旦出词，对局就卡住了。');
block('HARD — 只有极少数词能接', hard,
  '这类结尾能接但很窄，AI 选词时会被"可接指数"扣分。');

// 健康区间的总体分布，方便判断词库整体是否健康
var dist = { '0': 0, '1': 0, '2-5': 0, '6-20': 0, '21+': 0 };
rows.forEach(function (r) {
  if (r.total === 0) dist['0']++;
  else if (r.total === 1) dist['1']++;
  else if (r.total <= 5) dist['2-5']++;
  else if (r.total <= 20) dist['6-20']++;
  else dist['21+']++;
});
lines.push('## 全部结尾对的承接词数分布');
lines.push('');
Object.keys(dist).forEach(function (k) {
  var n = dist[k];
  var pct = rows.length ? (n / rows.length * 100) : 0;
  lines.push('   total ' + pad(k, 8) + pad(String(n), 8) + pct.toFixed(1) + '%');
});
lines.push('');

console.log(lines.join('\n'));

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
