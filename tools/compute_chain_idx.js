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
/* 专名注记式（补 PROPER_RE/PROPER_RE2 的漏网）。
 * ECDICT 最常见的专名写法是「(Aage)人名；(丹)奥格」—— "人名" 在括号【外面】，
 * 上面两条正则都匹配不到，导致 7,056 个专名被当成普通词(kind=0.9)。
 * 这里要求"注记式"上下文（右括号后紧跟 人名/地名/姓氏，或 （人名）/[人名]），
 * 【不能】用宽泛的 /人名|地名|姓氏/：那会因子串误伤真常用词
 * （例：warehouse 的定义含"以他人名义购进"，其中的"人名"是巧合子串，实测 f=0.60）。 */
var PROPER_RE3 = /([)）]\s*(人名|地名|姓氏))|([（(](人名|地名|姓氏)[）)])|(\[人名\])/;
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
  if (PROPER_RE.test(zh) || PROPER_RE2.test(zh) || PROPER_RE3.test(zh)) return 0.10;
  if (L <= 6 && /(公司|协会|组织|委员会|研究所|大学|中心|部|总部|地区|国)/.test(zh) && /[A-Z]/.test(w) === false) return 0.10;
  return 0.90; // 普通词
}

db.forEach(function (e) { e.kind = computeKind(e); });

// 预取 kind（后继里要频繁用）
var kindMap = Object.create(null);
db.forEach(function (e) { kindMap[e.w] = e.kind != null ? e.kind : 0.9; });

var maxChain = 0;
var rawDist = [];   // 观测 chain_raw 分布以校验 REF
var total = db.length;

// 快路径：直接遍历 by2/by3 前缀桶，避免 candidates() 里对每个候选做 canChain 正则
// 前缀桶里的词开头已对上，只需再校验"结尾元音 + 禁止结尾"两条（纯字符串操作）
function isChainable(prev, s) {
  var w = s.w;
  if (w === prev) return false;
  // 结尾最多3字母须含元音
  var tail = w.length <= 3 ? w : w.slice(-3);
  var hasV = false;
  for (var i = 0; i < tail.length; i++) { if (VOWELS.indexOf(tail.charAt(i)) !== -1) { hasV = true; break; } }
  if (!hasV) return false;
  // 禁止结尾 ry/ht/ck
  var c1 = w.charCodeAt(w.length - 1), c2 = w.charCodeAt(w.length - 2);
  if ((c2 === 114 && c1 === 121) || (c2 === 104 && c1 === 116) || (c2 === 99 && c1 === 107)) return false; // ry/ht/ck
  return true;
}

db.forEach(function (e, idx) {
  var w = e.w;
  var seen = Object.create(null);
  var succ_cnt = 0, c_cnt = 0, sum = 0;
  var p2 = w.slice(-2), p3 = w.length >= 3 ? w.slice(-3) : null;

  var bucket = store.by2[p2]; var b, s;
  if (bucket) for (b = 0; b < bucket.length; b++) { s = bucket[b]; if (!isChainable(w, s)) continue; if (seen[s.w]) continue; seen[s.w] = 1; succ_cnt++; var f = (s.f || 0); if (f >= COMMON_THRESHOLD) c_cnt++; sum += kindMap[s.w] * Math.pow(f, F_POW); }
  if (p3) { bucket = store.by3[p3]; if (bucket) for (b = 0; b < bucket.length; b++) { s = bucket[b]; if (!isChainable(w, s)) continue; if (seen[s.w]) continue; seen[s.w] = 1; succ_cnt++; var f2 = (s.f || 0); if (f2 >= COMMON_THRESHOLD) c_cnt++; sum += kindMap[s.w] * Math.pow(f2, F_POW); } }

  e.succ_cnt = succ_cnt;
  e.c_cnt = c_cnt;
  e.has_succ = succ_cnt > 0;
  e.chain_raw = sum;
  rawDist.push(sum);
  if (sum > maxChain) maxChain = sum;

  // 进度条：每 1% 打印一次
  if (idx % 5000 === 0 || idx === total - 1) {
    var pctDone = ((idx + 1) / total * 100).toFixed(1);
    process.stdout.write('\r  进度: ' + (idx + 1) + '/' + total + ' (' + pctDone + '%)');
  }
});
process.stdout.write('\n');

db.forEach(function (e) {
  e.chain = e.chain_raw > 0 ? (1 - Math.exp(-e.chain_raw / REF)) : 0;
  e.chain_idx = e.kind * e.chain;
});

// 过滤缩写/专名：剔除 kind<=0.1 的词，但保留常用词白名单
var KEEP = new Set([
  'ok', 'tv', 'vs', 'am', 'is', 'etc', 'dna', 'who', 'dr', 'pc', 'id', 'asap',
  'diy', 'faq', 'gps', 'hiv', 'mp3', 'pdf', 'vip', 'app', 'ai', 'usa', 'uk', 'la'
]);
// 精确黑名单：拟声/网络用语/罗马数字/明显拼写错误
var JUNK = new Set([
  'aaaaa', 'aaaargh', 'ahhhh', 'awww', 'awwww', 'ooo', 'ummm', 'yyy', 'grrrr', 'shhhh', 'tsktsk',
  'iii', 'vii', 'viii', 'xi', 'xii', 'xiii', 'xiv', 'xvi', 'xvii', 'xviii', 'xix',
  'xxi', 'xxii', 'xxviii', 'xxix', 'xxxi', 'xxxiii', 'xxxiv', 'xxxvii', 'xxxviii', 'xxxix',
  'lxviii', 'lxxxiv', 'lxxxviii', 'xciii', 'xcviii', 'xlviii',
  'processsor', 'messsage', 'narcisssus', 'excesssive', 'bosss', 'eyewitnesss'
]);
var before = db.length;
db = db.filter(function (e) {
  if (JUNK.has(e.w)) return false;                    // 明确垃圾黑名单
  // 缩写/碎片(kind=0.05)：只留常见词白名单。
  // 注意这里是 < 0.1 而【不是】<= 0.1 —— kind=0.10 的专名（人名/地名/姓氏）要【保留】：
  // 游戏对专名改用"限额制度"（每人每局最多 N 个），它们仍需留在词库里参与接龙，
  // 只是 AI 会重度降权避开、玩家用量受限。把它们从词库删掉反而会制造新的死路。
  if (e.kind < 0.1) return KEEP.has(e.w);
  if (e.w.length >= 4 && !/[aeiouy]/.test(e.w)) return false;  // 无元音长串(代码/缩写碎片)
  // [网络] 标签且无权威佐证(collins/词频)：低质机翻/游戏黑话，剔除
  // 注意：ECDICT 里 [网络] 从不位于释义开头（实际写法是 "n. 野猫\n[网络] 野猫赛；美国原装进口"），
  //       所以必须用【不锚定】的匹配。曾经写成 /^\[网络\]/，结果一个词都匹配不到（规则空转）。
  if (/\[网络\]/.test(e.zh || '') && !(e.collins > 0) && !((e.frq || 0) > 0)) return false;
  return true;
});
console.log('过滤(缩写碎片/无元音/黑名单/[网络]低质；专名保留待限额): ' + before + ' -> ' + db.length + '（保留白名单 ' + KEEP.size + ' 个常用词）');
console.log('  kind 分布: ' +
  '普通词 ' + db.filter(function (e) { return e.kind >= 0.5; }).length +
  ' / 专名 ' + db.filter(function (e) { return e.kind > 0.06 && e.kind < 0.5; }).length +
  ' / 缩写 ' + db.filter(function (e) { return e.kind <= 0.06; }).length);

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
