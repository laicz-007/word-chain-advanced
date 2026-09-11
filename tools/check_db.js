/* tools/check_db.js — 词库体检（改过词库 / 跑完 npm run build 之后，先跑这一条）
 *
 * 用法：在项目根目录执行   node tools/check_db.js
 *
 * 它只读不写，回答一个问题：**现在这份词库是健康的吗？**
 *   ✅ = 必须满足的硬指标（不满足说明构建出问题了）
 *   ⚠️ = 需要你知道、但不一定是错的现象
 *   ·  = 纯信息
 *
 * 退出码：0 = 没有硬失败；1 = 有硬失败（可直接用在脚本/CI 里）
 */
'use strict';
var db = require('../src/db.js');
var R = db.R, store = db.store, list = db.dbVocab;
var fs = require('fs');
var path = require('path');
var fingerprint = require('./rules_fingerprint.js');

// 本词库设计的三个 kind 档位（见 tools/compute_chain_idx.js）
//   0.05 = 高频缩写档（dna/tv/uk… 有意保留，因为它够常见）
//   0.10 = 专名档（人名/地名/姓氏，房间模式每人每局限 3 个）
//   0.90 = 普通词
var KNOWN_KINDS = [0.05, 0.1, 0.9];

// 词条必须齐全的字段（实测 281,889 条 100% 都有，缺一个就说明构建写坏了）
// 值 = 允许的类型；"a|b" 表示两种都行（note_long 允许 null，这是正常的）
var FIELDS = {
  w: 'string', zh: 'string', phonetic: 'string', tag: 'string', note: 'string',
  note_long: 'string|null',
  frq: 'number', d: 'number', f: 'number', collins: 'number', kind: 'number',
  succ_cnt: 'number', c_cnt: 'number', chain_raw: 'number', chain: 'number',
  chain_idx: 'number', conf: 'number',
  has_note: 'boolean', has_succ: 'boolean', dGuess: 'boolean'
};

function typeOk(spec, v) {
  var t = (v === null) ? 'null' : typeof v;
  if (spec.split('|').indexOf(t) < 0) return false;
  if (t === 'number' && !isFinite(v)) return false;   // NaN / Infinity 也算坏
  return true;
}

// 用户明确要求删掉的：缩写 + 依附于别的词的短词（"必须要有独立实际意思才可以保留"）
var SHOULD_BE_GONE = ['lar', 'se', 'te', 'ess', 'sis', 'ogy', 'ier', 'ary', 'ery', 'gy',
  'zed', 'ism', 'en', 'ide', 've', 'ra', 'ian', 'lin', 'ely', 'ope', 'ole', 'ory', 'mic', 'nin', 'ery', 'ay'];
// 必须保留的：有独立实际意思的真词（哪怕很短、哪怕能被别人回声）
var SHOULD_KEEP = ['oat', 'tin', 'ram', 'hen', 'lid', 'ox', 'log', 'owl', 'ash', 'den',
  'mat', 'nil', 'pod', 'fin', 'tar', 'pus', 'ump', 'amp', 'ken', 'mol', 'col', 'ate',
  'to', 'be', 'as', 'la', 'ma'];

var fails = 0, warns = 0;
function ok(label, detail) { console.log('  ✅ ' + pad(label, 34) + (detail || '')); }
function bad(label, detail) { fails++; console.log('  ❌ ' + pad(label, 34) + (detail || '')); }
function warn(label, detail) { warns++; console.log('  ⚠️  ' + pad(label, 34) + (detail || '')); }
function info(label, detail) { console.log('  ·  ' + pad(label, 34) + (detail || '')); }
function head(t) { console.log('\n==================== ' + t + ' ===================='); }
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

/* ---------- 1. 现在用的是哪份词库 ---------- */
head('1) 当前词库');
info('实际加载文件', db.dbPath);
info('词条总数', list.length.toLocaleString('en-US'));
info('带精讲(note)的词', db.noteCount.toLocaleString('en-US'));

/* 精讲数据完整性：has_note 来自 Kyle 语料，是构建期"可信词"判据的一支
 *（isTrustedEntry = 柯林斯≥1星 或 f≥阈值 或 有精讲），也决定 conf 与 AI 的教学加成。
 * ⚠️ 全新克隆默认拿不到它（GitHub API 不通且本地无 data/kyle/ 缓存）——
 *    实测那种构建的 has_note 会从 13,884 掉到 0，且会**多删一批短词**（少了"有精讲=可信"这一支）。
 *    这类残缺是静默的：构建照常成功、游戏照常能玩，只是词库和标准版不一样。 */
if (db.noteCount === 0) {
  bad('精讲数据(has_note)', '0 个 —— 这份词库几乎肯定是残缺构建（缺 Kyle 语料），请重跑 npm run build 并看它的警告');
} else if (db.noteCount < db.wordCount * 0.005) {
  warn('精讲数据偏少', db.noteCount + ' 个（正常约 1.3 万，占 4.5%）—— 可能只拿到部分 Kyle 语料');
} else {
  ok('精讲数据(has_note)', db.noteCount.toLocaleString('en-US') + ' 个');
}

/* 词库与规则是否同版：
 * 词库里的 has_succ/chain_idx 是**用某一版规则算出来的**。若规则改了却没重建，
 * 词库就与运行期判据脱节 —— 而症状是静默的（测试全绿、服务照常启动，
 * 只是 AI 会以为某个词接得下去、运行时却被拒绝）。
 * 构建时会把规则指纹写进 data/db.build.json，这里算一遍当前的对比。 */
var META_PATH = path.join(__dirname, '..', 'data', 'db.build.json');
var nowPrint = fingerprint.compute();
if (!fs.existsSync(META_PATH)) {
  warn('缺构建元数据 data/db.build.json', '无法判断这份词库是否与当前规则同版（老版本构建的产物没有这个文件）');
} else {
  var meta = {};
  try { meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch (e) { meta = null; }
  if (!meta || !meta.rulesFingerprint) {
    warn('构建元数据不可读', 'data/db.build.json 内容异常');
  } else if (meta.rulesFingerprint === nowPrint) {
    ok('词库与规则同版', '指纹一致 ' + nowPrint + '（构建于 ' + String(meta.builtAt).slice(0, 19).replace('T', ' ') + '）');
  } else {
    warn('词库是用【旧规则】构建的',
      '构建时指纹 ' + meta.rulesFingerprint + '，当前代码指纹 ' + nowPrint +
      ' → 请重跑 npm run build（否则 AI 会按旧规则的可接指数出词）');
  }
  /* 构建脚本是否变过：规则指纹只盯 logic.js 的规则，盯不住构建脚本自己。
   * 改了 tools/compute_chain_idx.js 的过滤规则同样会让词库变样，这里补上。
   * 源码做了"去注释"规范化，所以只改说明文字不会误报。 */
  var nowBuild = fingerprint.buildFingerprint();
  if (!meta || !meta.buildFingerprint) {
    info('构建脚本指纹', '这份元数据是旧版生成的，没有该字段（重跑一次 npm run build 后即可对比）');
  } else if (meta.buildFingerprint === nowBuild) {
    ok('词库与构建脚本同版', '指纹一致 ' + nowBuild);
  } else {
    warn('词库是用【旧版构建脚本】产出的',
      '构建时 ' + meta.buildFingerprint + '，当前代码 ' + nowBuild +
      ' → 构建脚本变过（过滤规则/参数），请重跑 npm run build；若线上用了这份词库，需要重新上传 data/db.json');
  }
}
if (typeof list[0] !== 'object' || list[0] === null) {
  bad('顶层结构', '应该是词条数组，实际拿到 ' + typeof list[0]);
  console.log('\n词库结构不对，后面的检查无法进行。');
  process.exit(1);
}

/* ---------- 2. 字段完整性 ---------- */
head('2) 字段完整性');
var missing = {};
Object.keys(FIELDS).forEach(function (k) { missing[k] = 0; });
var wrongType = {};
var extraKeys = Object.create(null);
list.forEach(function (e) {
  Object.keys(e).forEach(function (k) { extraKeys[k] = 1; });
  Object.keys(FIELDS).forEach(function (k) {
    var v = e[k];
    if (v === undefined) { missing[k]++; return; }
    if (!typeOk(FIELDS[k], v)) wrongType[k] = (wrongType[k] || 0) + 1;
  });
});
var missKeys = Object.keys(missing).filter(function (k) { return missing[k] > 0; });
if (missKeys.length === 0) ok('必需的 ' + Object.keys(FIELDS).length + ' 个字段', '全部齐全');
else missKeys.forEach(function (k) { bad('字段缺失 ' + k, missing[k] + ' 条没有这个字段'); });

var badTypeKeys = Object.keys(wrongType);
if (badTypeKeys.length === 0) ok('字段类型', '全部正确（数字/文本/真假值）');
else badTypeKeys.forEach(function (k) { bad('类型不对 ' + k, wrongType[k] + ' 条类型不是 ' + FIELDS[k]); });

var unforeseen = Object.keys(extraKeys).filter(function (k) { return !(k in FIELDS); });
info('字段清单', Object.keys(FIELDS).length + ' 个已知 + ' +
  (unforeseen.length ? ('未知: ' + unforeseen.join(', ')) : '0 个未知'));

/* ---------- 3. 数据卫生 ---------- */
head('3) 数据卫生');
var nonAz = [], short = [], seen = Object.create(null), dups = [];
list.forEach(function (e) {
  var w = e.w;
  var clean = true;
  for (var i = 0; i < w.length; i++) { var c = w.charCodeAt(i); if (c < 97 || c > 122) { clean = false; break; } }
  if (!clean) nonAz.push(w);
  if (w.length < 2) short.push(w);
  if (seen[w]) dups.push(w); else seen[w] = 1;
});
if (nonAz.length === 0) ok('单词只含 a-z', '0 条异常'); else bad('单词只含 a-z', nonAz.length + ' 条异常，例: ' + nonAz.slice(0, 6).join(', '));
if (short.length === 0) ok('单词长度 ≥ 2', '0 条异常'); else bad('单词长度 ≥ 2', short.length + ' 条，例: ' + short.slice(0, 6).join(', '));
if (dups.length === 0) ok('无重复词条', '0 条重复'); else bad('无重复词条', dups.length + ' 条重复，例: ' + dups.slice(0, 6).join(', '));

/* ---------- 4. 核心不变量 ---------- */
head('4) 核心不变量');
// (a) 接不上任何词的词，可接指数必须是 0；反之亦然。两者必须严格同步。
var noSucc = list.filter(function (e) { return e.has_succ === false; });
var zeroIdx = list.filter(function (e) { return e.chain_idx === 0; });
if (noSucc.length === zeroIdx.length &&
  noSucc.every(function (e) { return e.chain_idx === 0; })) {
  ok('has_succ=false ⟺ chain_idx=0', noSucc.length.toLocaleString('en-US') + ' 条，两边完全一致');
} else {
  bad('has_succ=false ⟺ chain_idx=0',
    'has_succ=false 有 ' + noSucc.length + ' 条，chain_idx=0 有 ' + zeroIdx.length + ' 条，不同步');
}
info('死路词（接不上任何词）', noSucc.length.toLocaleString('en-US') + ' 条，占 ' +
  (noSucc.length / list.length * 100).toFixed(2) + '%' +
  (noSucc.length ? '  例: ' + noSucc.slice(0, 6).map(function (e) { return e.w; }).join(', ') : ''));

// (b) 归一化后的可接指数必须落在 [0,1]
var outOfRange = list.filter(function (e) { return !(e.chain_idx >= 0 && e.chain_idx <= 1); });
if (outOfRange.length === 0) ok('chain_idx ∈ [0,1]', '全部在范围内');
else bad('chain_idx ∈ [0,1]', outOfRange.length + ' 条越界，例: ' +
  outOfRange.slice(0, 5).map(function (e) { return e.w + '=' + e.chain_idx; }).join(', '));

// (c) kind 只能是设计好的三个档位 —— 冒出第四个值通常意味着过滤规则被改坏了
var kindCount = Object.create(null);
list.forEach(function (e) { kindCount[e.kind] = (kindCount[e.kind] || 0) + 1; });
var unknownKinds = Object.keys(kindCount).filter(function (k) { return KNOWN_KINDS.indexOf(Number(k)) < 0; });
if (unknownKinds.length === 0) {
  ok('kind 取值', KNOWN_KINDS.map(function (k) { return k + '(' + (kindCount[k] || 0).toLocaleString('en-US') + ')'; }).join('  '));
} else {
  warn('kind 出现新档位', unknownKinds.map(function (k) { return k + '(' + kindCount[k] + ')'; }).join(', ') +
    '  —— 若是有意新增请同步更新本脚本的 KNOWN_KINDS');
}
var proper = list.filter(function (e) { return e.kind === 0.1; });
var abbr = list.filter(function (e) { return e.kind === 0.05; });
info('专名（房间模式每人每局限 ' + R.PROPER_QUOTA + ' 个）', proper.length.toLocaleString('en-US') + ' 条');
if (abbr.length) info('高频缩写档（有意保留）', abbr.length + ' 条: ' + abbr.map(function (e) { return e.w; }).join(' '));

/* ---------- 5. 清理效果：该删的删了、该留的留了 ---------- */
head('5) 清理效果（缩写/依附型短词）');
var goneWrong = SHOULD_BE_GONE.filter(function (w) { return !!store.lookup(w); });
if (goneWrong.length === 0) ok('该删的都删了', SHOULD_BE_GONE.length + ' 个检查项全部不在库');
else bad('该删的仍在库', goneWrong.join(', ') + '  —— 过滤规则可能被改回去了');
var keepWrong = SHOULD_KEEP.filter(function (w) { return !store.lookup(w); });
if (keepWrong.length === 0) ok('该留的都留着', SHOULD_KEEP.length + ' 个检查项全部在库');
else bad('该留的被删了', keepWrong.join(', ') + '  —— 过滤规则删过头了');

/* ---------- 6. 回声现状（只报告，不判对错） ---------- */
head('6) 回声现状（房间模式拒绝，单机模式允许）');
// 结构上是回声 = 某个词的末尾 2/3 字母恰好也是一个词
// 其中"高频可信"的（to/be/as 那类）即使在房间模式也被放行 —— 这是用户明确要求的例外
var echoTotal = 0, echoAllowed = 0;
var samples = [];
list.forEach(function (e) {
  var w = e.w;
  if (w.length !== 2 && w.length !== 3) return;    // 只有 2/3 字母的词才可能当回声被接
  if (!R.isTrustedEntry(e)) return;                 // 生僻的已经在清理阶段删掉了
  echoAllowed++;                                    // 它本身是个"被允许的回声词"
});
// 反向统计：库里有多少对照组 (上词, 回声词)
var perPair = 0;
var byLen = { 2: Object.create(null), 3: Object.create(null) };
list.forEach(function (e) {
  var w = e.w;
  if (w.length < 3) return;
  var s2 = w.slice(-2), s3 = w.slice(-3);
  if (s2 !== w && store.lookup(s2) && R.isTrustedEntry(store.lookup(s2))) {
    perPair++; byLen[2][s2] = (byLen[2][s2] || 0) + 1;
  }
  if (s3 !== w && store.lookup(s3) && R.isTrustedEntry(store.lookup(s3))) {
    perPair++; byLen[3][s3] = (byLen[3][s3] || 0) + 1;
  }
});
info('可被回声的高频短词', echoAllowed + ' 个（2/3 字母且柯林斯≥1星 或 f≥' + R.ECHO_KEEP_F + ' 或 有精讲）');
info('库内"高频回声"机会', perPair.toLocaleString('en-US') + ' 组（房间模式放行；单机模式本来就允许）');
var hot2 = Object.keys(byLen[2]).sort(function (a, b) { return byLen[2][b] - byLen[2][a]; }).slice(0, 6);
var hot3 = Object.keys(byLen[3]).sort(function (a, b) { return byLen[3][b] - byLen[3][a]; }).slice(0, 6);
info('最常见的 2 字母回声', hot2.map(function (k) { return k + '(' + byLen[2][k] + ')'; }).join('  '));
info('最常见的 3 字母回声', hot3.map(function (k) { return k + '(' + byLen[3][k] + ')'; }).join('  '));
if (echoAllowed > 0) {
  info('说明', '房间模式仍会放行这 ' + echoAllowed + ' 个高频短词（用户明确要求：to/be/as 这类常见词不算偷懒）');
}

/* ---------- 7. 短词风险面（"还会不会冒出 lar 那种词"） ---------- */
head('7) 短词风险面');
// 一个短词只有"某个词的末尾正好是它"时才可能被出出来。
// 所以衡量风险的正确口径不是"它在不在库里"，而是"有多少常见词能接出它"。
// 完全接不上常见词的短词，玩家基本遇不到，危害很低。
var shortWords = list.filter(function (e) {
  return (e.w.length === 2 || e.w.length === 3) && !R.isTrustedEntry(e);
});
var reach = Object.create(null);
shortWords.forEach(function (e) { reach[e.w] = { common: 0, rare: 0 }; });
list.forEach(function (e) {
  var w = e.w;
  if (w.length < 3) return;
  [w.slice(-2), w.slice(-3)].forEach(function (s) {
    if (!s || s === w || !reach[s]) return;
    if (R.isTrustedEntry(e)) reach[s].common++; else reach[s].rare++;
  });
});
var reachable = shortWords.filter(function (e) { return reach[e.w].common > 0; });
info('非高频短词', shortWords.length + ' 个（2/3 字母，且不算高频）');
info('其中"常见的词接得上"', reachable.length + ' 个 —— 只有这些玩家才真的可能出到');
info('接不上常见词的', (shortWords.length - reachable.length) + ' 个 —— 几乎遇不到，危害低');

// 这 171 个里绝大多数是有独立意思的真词（ain 自己的 / ort 剩菜 / awl 锥子…），必须保留。
// 真正该盯的是"释义根本不是个词"的少数：游戏黑话、机场代码、文件后缀名。
var JUNK_RE = [
  { re: /\[(魔兽世界|暗黑破坏神|游戏|网游|网络游戏)[^\]]*\]/, why: '游戏黑话/游戏地名' },
  { re: /机场代码/, why: '机场代码' },
  { re: /后缀名|扩展名/, why: '文件后缀名' }
];
var junk = shortWords.filter(function (e) {
  if (e.kind !== 0.9) return false;                 // 缩写档(0.05)/专名档(0.1) 是设计内的，不算
  var zh = String(e.zh || '');
  return JUNK_RE.some(function (r) { return r.re.test(zh); });
});
if (junk.length === 0) {
  ok('没有游戏黑话/代码/后缀名类短词', '0 个');
} else {
  warn('发现 ' + junk.length + ' 个"不像词"的短词',
    '可考虑按"必须有独立实际意思"的规则删掉（改 compute_chain_idx.js 的过滤块后重跑 npm run build）');
  junk.forEach(function (e) {
    var hit = JUNK_RE.filter(function (r) { return r.re.test(String(e.zh || '')); })[0];
    info('  ' + e.w + '（' + hit.why + (reach[e.w].common ? '，' + reach[e.w].common + ' 个常见词接得上' : '，接不上常见词') + '）',
      String(e.zh).replace(/\s+/g, ' ').slice(0, 46));
  });
}
var topReach = reachable.sort(function (a, b) { return reach[b.w].common - reach[a.w].common; }).slice(0, 5);
info('最难缠的可达短词', topReach.map(function (e) {
  return e.w + '(' + reach[e.w].common + ')';
}).join('  ') + '   —— 括号是能接出它的常见词数');

/* ---------- 8. 结论 ---------- */
head('结论');
if (fails === 0 && warns === 0) {
  console.log('  🎉 词库健康：' + Object.keys(FIELDS).length + ' 项硬指标全过，没有需要注意的地方。');
} else if (fails === 0) {
  console.log('  ✅ 硬指标全过（' + (warns ? warns + ' 处提醒，见上面 ⚠️' : '无提醒') + '）—— 词库可用。');
} else {
  console.log('  ⛔ 有 ' + fails + ' 项硬失败（见上面 ❌）。词库可能不完整，建议重跑：npm run build');
}
console.log('');
process.exit(fails === 0 ? 0 : 1);
