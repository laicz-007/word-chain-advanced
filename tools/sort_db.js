/* sort_db.js — 词库排序/去重（**可选工具**，通常用不上）
 * 1) 去重：同词多来源时保留更完整词条（有知识点 > 有释义 > 有音标）。
 * 2) 按字母表顺序排序（方便数据审查，也为未来二分检索提供前提）。
 *
 * ⚠️ 说明：build_unified_db.py 生成 data/db.raw.json 时**已经**做了去重与排序，
 *    所以正常流程下本脚本无事可做，保留它只是为了数据审查时能单独跑一遍。
 *    它只读写**原始库** data/db.raw.json —— 绝不碰成品 data/db.json，
 *    以免像以前那样把过滤好的成品又洗一遍（那会丢字段、还会掩盖过滤问题）。
 * 用法：node tools/sort_db.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var DB = path.join(ROOT, 'data', 'db.raw.json');

var arr = JSON.parse(fs.readFileSync(DB, 'utf8'));
function richness(e) {
  return (e.has_note ? 4 : 0) + (e.zh ? 2 : 0) + (e.phonetic ? 1 : 0);
}
var byWord = new Map();
arr.forEach(function (e) {
  var w = String(e.w).toLowerCase();
  var prev = byWord.get(w);
  if (!prev || richness(e) > richness(prev)) byWord.set(w, e);
});
var out = Array.from(byWord.values());
out.sort(function (a, b) { return a.w < b.w ? -1 : a.w > b.w ? 1 : 0; });
fs.writeFileSync(DB, JSON.stringify(out), 'utf8');
console.log('原 ' + arr.length + ' 条 -> 去重后 ' + out.length + ' 条（已按字母排序）');