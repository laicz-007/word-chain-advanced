/* compute_chain_idx.js — 为 data/db.json 预计算"可接指数"(常见词供给口径)
 *
 * 背景：旧口径把"词库里所有能接的词"都算供给, 导致 ic/lf/er 这类"结尾墙"
 *       虽真实常见后续极少, 却因词库里有生僻词而拿到高可接指数, 把玩家逼进墙角。
 * 重构：把后继按"常见度 f"加权(越常见越算供给), 生僻后继几乎不计, 得到
 *       "玩家实际能舒服续下去的常见词供给"。
 *
 * 每词写入:
 *   kind       词型分 0-1
 *   succ_cnt   合法后继个数(原始计数)
 *   c_cnt      常见后继个数 (f >= COMMON_THRESHOLD)
 *   has_succ   是否非死路(有后继)
 *   chain_raw  常见供给加权和 = Σ kind(S) × f(S)^F_POW
 *   chain      chain_raw 归一化到 [0,1]
 *   chain_idx  可接指数 = kind × chain
 */
'use strict';
var fs = require('fs');
var path = require('path');
var R = require('../public/logic.js');

var F_POW = 1.5;              // 常见度幂(越大越突出"常见"后继, 生僻几乎不计)
var COMMON_THRESHOLD = 0.42;  // 常见后继阈值(词频>=此值才算常见; 重构后 f 均值~0.37, 故取高一点)
var REF = 18.0;               // 归一化基准(常规数)

var dbPath = path.join(__dirname, '..', 'data', 'db.json');
var db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
var store = new R.WordStore(db);

var VOWELS = 'aeiouy';
var PROPER_RE = /\[(地名|人名|姓|音|圣经|宗|国|地|人|城|河|山|岛|族|币)\]/;
var PROPER_RE2 = /\((美国|英国|德国|法国|日本|意大利|俄国|希腊|罗马|圣经|姓氏|地名|人名|首都|首府|城市|河流|山脉|岛屿)[^)]*\)/;
var POS_RE = /\b(n|v|vt|vi|adj|adv|prep|conj|pron|num|int|interj|abbr|a|ad)\./;
var CAT_TAG_RE = /^\[[^\]]{1,4}\]/;

function computeKind(e) {
  var w = e.w, zh = e.zh || '';
  var L = w.length;
  // 纯缩写/代码/碎片：无元音短词、abbr 前缀、中文缩略标记、领域标签+短词、英文短语式释义
  if (L <= 4 && !/[aeiouy]/.test(w)) return 0.05;
  if (/^abbr\./i.test(zh.trim())) return 0.05;
  if (/(abbr|缩写|缩略|简称|首字母)/.test(zh)) return 0.05;
  if (L <= 5 && CAT_TAG_RE.test(zh.trim())) return 0.05;                 // [计]/[军]/[化] 等前缀 + 短词 => 代码/缩写
  if (L <= 5 && /^[a-z]+ [a-z]+/.test(zh.trim()) && !POS_RE.test(zh)) return 0.05; // "last field"/"intensive care" 等纯英文缩写
  // 地名/人名/姓/专名
  if (PROPER_RE.test(zh) || PROPER_RE2.test(zh)) return 0.10;
  if (L <= 6 && /(公司|协会|组织|委员会|研究所|大学|中心|部|总部|地区|国)/.test(zh) && /[A-Z]/.test(w) === false) return 0.10;
  return 0.90; // 普通词
}

db.forEach(function (e) { e.kind = computeKind(e); });

var maxChain = 0;
var rawDist = [];   // 观测 chain_raw 分布以校验 REF
db.forEach(function (e) {
  var succ = store.candidates(e.w, {}).filter(function (s) { return s.w !== e.w; });
  e.succ_cnt = succ.length;
  e.c_cnt = 0;
  var sum = 0;
  succ.forEach(function (s) {
    var f = (s.f || 0);
    if (f >= COMMON_THRESHOLD) e.c_cnt++;
    sum += ((s.kind != null ? s.kind : 0.9)) * Math.pow(f, F_POW);
  });
  e.has_succ = succ.length > 0;
  e.chain_raw = sum;
  rawDist.push(sum);
  if (sum > maxChain) maxChain = sum;
});

db.forEach(function (e) {
  e.chain = e.chain_raw > 0 ? (1 - Math.exp(-e.chain_raw / REF)) : 0;
  e.chain_idx = e.kind * e.chain;
});

// 过滤缩写/专名：剔除 kind<=0.1 的词，但保留常用词白名单
var KEEP = new Set([
  'ok', 'tv', 'vs', 'am', 'is', 'etc', 'dna', 'who', 'dr', 'pc', 'id', 'asap',
  'diy', 'faq', 'gps', 'hiv', 'mp3', 'pdf', 'vip', 'app', 'ai', 'usa', 'uk', 'la'
]);
var before = db.length;
db = db.filter(function (e) { return e.kind > 0.1 || KEEP.has(e.w); });
console.log('过滤缩写/专名: ' + before + ' -> ' + db.length + '（保留白名单 ' + KEEP.size + ' 个常用词）');

fs.writeFileSync(dbPath, JSON.stringify(db), 'utf8');

function pct(a, p) {
  a = a.slice().sort(function (x, y) { return x - y; });
  var i = Math.floor((a.length - 1) * p);
  return a[i];
}
console.log('wordList: ' + db.length);
console.log('  dead(no succ): ' + db.filter(function (e) { return !e.has_succ; }).length);
console.log('  c_cnt=0 但 has_succ: ' + db.filter(function (e) { return e.has_succ && e.c_cnt === 0; }).length + '  (结尾墙: 有后继但常见后继为0)');
console.log('  succ 常见占比字段已写 c_cnt');
console.log('  F_POW=' + F_POW + ' COMMON_THRESHOLD=' + COMMON_THRESHOLD + ' REF=' + REF);
console.log('  chain_raw p10/p50/p90/p99: ' + pct(rawDist, .1).toFixed(2) + ' / ' + pct(rawDist, .5).toFixed(2) + ' / ' + pct(rawDist, .9).toFixed(2) + ' / ' + pct(rawDist, .99).toFixed(2));
console.log('  maxChain=' + maxChain.toFixed(2));
