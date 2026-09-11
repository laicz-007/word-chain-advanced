/* compute_chain_idx.js — 读原始词库、过滤、为成品词库预计算"可接指数"(常见词供给口径)
 *   data/db.raw.json ──(本脚本)──> data/db.json
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
/* ★ 复用运行期的规则引擎，而不是在本文件里再写一遍规则。
 *
 * 为什么必须这样做：构建期要判断"一个词能否充当别人的后继"（末尾含元音、禁 ry/ht/ck），
 * 运行期（public/logic.js 的 Game.submitChain）要判断同一件事。**两处必须是同一套判据**。
 * 历史教训：本项目已经因为"同一规则写两遍"踩过坑 ——
 *   · isTrustedEntry / ECHO_KEEP_F 在本文件与 logic.js 各有一份，注释里只能靠"⚠️ 两边要一致"提醒；
 *   · `[网络]` 过滤正则曾在构建期与预期不符，规则看似存在却一个词都没匹配到（空转）。
 * 一旦两边分叉，症状是**静默的**：词库照常生成、测试全绿，
 * 但 AI 会以为某个词接得下去，运行时却被拒绝 —— 极难定位。
 * 所以这里直接调 logic.js 导出的 hasVowelEnding / forbiddenEnding / isTrustedEntry。 */
var R = require('../public/logic.js');
var fingerprint = require('./rules_fingerprint.js');

var F_POW = 1.5;              // 常见度幂(越大越突出"常见"后继, 生僻几乎不计)
var COMMON_THRESHOLD = 0.42;  // 常见后继阈值(词频>=此值才算常见; 重构后 f 均值~0.37, 故取高一点)
var REF = 18.0;               // 归一化基准(常规数)

/* 分段计时（结尾打印）。用于回答"时间花在哪"，改算法后一眼看出收益。 */
var T0 = Date.now();
var PH = {};
function mark(name) { PH[name] = Date.now() - T0; }

/* 输入 = data/db.raw.json（第 2 步 build_unified_db.py 的原始产物，谁也不许改写它）
 * 输出 = data/db.json    （过滤 + 算好可接指数的成品，游戏实际加载的就是它）
 *
 * ⚠️ 为什么分成两个文件：以前这里是【读 db.json 写回 db.json】，等于就地改写。
 *    过滤规则一旦删过头，那些词就永久消失了 —— 2026-09 实测因此丢了 25,183 个词
 *    （action/abroad/ace 等常用词全不见，且没有任何迹象）。拆开后：
 *      · 改过滤规则 → 重跑本脚本（约 30 秒）即可反复试
 *      · 原始数据 db.raw.json 始终完好，随时可以重来
 */
var RAW_PATH = path.join(__dirname, '..', 'data', 'db.raw.json');
var OUT_PATH = path.join(__dirname, '..', 'data', 'db.json');
var BUILD_META_PATH = path.join(__dirname, '..', 'data', 'db.build.json');

if (!fs.existsSync(RAW_PATH)) {
  console.error('找不到原始词库 ' + RAW_PATH);
  console.error('请先运行上一步（几分钟，需要 Python 3）：');
  console.error('  python tools/build_unified_db.py');
  console.error('或者跑完整链路：npm run build');
  process.exit(1);
}
var db = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
mark('读取+解析');

/* 前置校验：本脚本用"完美哈希"把词的前 2/3 个字母映射到定长数组下标（见下方算法说明），
 * 因此**必须**保证每个词都是纯小写 a-z 且长度 ≥2，否则下标会越界、把词串到别的桶里。
 * 这与运行时 WordStore 的收录条件一致（那边是 `/[^a-z]/.test(w) || w.length < 2 → 跳过`）。
 * 以前这里靠 `new R.WordStore(db)` 顺手做了这层过滤，现在那层没了，就显式校验一遍 ——
 * 宁可启动时大声报错，也不要静默产出错误的可接指数（铁律：绝不静默失败）。 */
(function validateWords() {
  var bad = [];
  for (var i = 0; i < db.length; i++) {
    var w = db[i].w;
    if (typeof w !== 'string' || w.length < 2 || !/^[a-z]+$/.test(w)) {
      if (bad.length < 5) bad.push(JSON.stringify(w));
    }
  }
  if (bad.length) {
    console.error('原始词库里有非法词条（必须是小写纯字母且长度 ≥2）：' + bad.join(', '));
    console.error('文件：' + RAW_PATH);
    console.error('请检查上一步 build_unified_db.py 的输出，或先运行 node tools/check_db.js 看完整报告。');
    process.exit(1);
  }
})();

var VOWELS = R.VOWELS;   // 元音集合：与运行期共用（logic.js 是唯一真相源）
// 由 VOWELS 派生的正则，供"整词里有没有元音"这类词形启发式使用（不再是写死的 [aeiouy]）
var VOWEL_RE = new RegExp('[' + VOWELS + ']');
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

/* 高频/可信词条的定义**不在这里**，而是直接用 logic.js 的 isTrustedEntry
 * （柯林斯≥1星 或 常见度 f≥R.ECHO_KEEP_F 或 Kyle 精讲词）。
 * 用途：① 词库清理时"非高频的依赖型短词/回声热词"才删（见下方过滤块）；
 *      ② 运行期用它决定"这个回声词允不允许"（logic.js 的 canChain → echoOkFor）；
 *      ③ computeKind 里当"这不可能是专名/缩写"的守卫（见下面两处）。
 * ⚠️ 曾经这里有一份自己的 ECHO_KEEP_F 和 isTrusted()，靠注释提醒"两处要一致" ——
 *    那种约定迟早会分叉。现在结构上只剩一份实现。 */
var isTrusted = R.isTrustedEntry;
var ECHO_KEEP_F = R.ECHO_KEEP_F;   // 仅用于日志/提示显示

function computeKind(e) {
  var w = e.w, zh = e.zh || '';
  var L = w.length;
  // 纯缩写/代码/碎片：无元音短词、abbr 前缀、中文缩略标记、领域标签+短词、英文短语式释义
  if (L <= 4 && !VOWEL_RE.test(w)) return 0.05;
  if (/^abbr\./i.test(zh.trim())) return 0.05;
  /* 中文缩略标记（缩写/缩略/简称/首字母）。
   * ⚠️ 这条曾经【没有长度限制也没有高频守卫】，实测误删 18 个常用词，其中最严重的是
   *    salt（食盐，collins=3，释义里提到 "SALT [缩写] 限制战略武器会谈"）、
   *    india（印度，释义里"简称次大陆"指的是别的词）、
   *    canon（教会法教规/佳能）、acronym、contraction、abbreviation。
   *    这些词的释义只是【提到了】缩写，它们本身不是缩写。
   * 修法：① 只对 8 字母以内的词生效（真正的缩写词条都很短，实测 10,285 个命中里 ≤8 字母占 99%）；
   *      ② 高频可信词一律豁免（salt/canon/acronym/contraction 由此保住）；
   *      ③ 保留 abbreviation/initialism 这类"谈论缩写"的真词（长度 ≥9，被 ① 放过）。
   * 实测：改前删 10,285 个（误伤常用词 18）；改后删 10,165 个（误伤 0）。
   * 注：这批缩写里有 9,454 个释义以 "abbr." 开头，已被上面的 L55 先一步拦下，不受本改动影响。 */
  if (L <= 8 && !isTrusted(e) && /(abbr|缩写|缩略|简称|首字母)/.test(zh)) return 0.05;
  if (L <= 5 && CAT_TAG_RE.test(zh.trim())) return 0.05;                 // [计]/[军]/[化] 等前缀 + 短词 => 代码/缩写
  if (L <= 5 && /^[a-z]+ [a-z]+/.test(zh.trim()) && !POS_RE.test(zh)) return 0.05; // "last field"/"intensive care" 等纯英文缩写
  /* 更彻底的缩写/符号清理（按"清理大部分缩写"的要求补充）。
   * 实测：命中 167 个词，且对 to/my/no/be/as/by/so/an（这些词的释义里附带国别码
   * no=Norway、be=Belgium）与 owl/ado/bunny 等真词【零误伤】。
   * ⚠️ 反面教训：不要用宽泛的 /\[域\]/ —— 那会删掉最常用的英语虚词。 */
  if (L <= 6 && /^\s*(symb|abr\.|abbr\.)/i.test(zh)) return 0.05;    // 化学元素符号(symb)/缩写前缀(abr.)
  if (/\[\s*=/.test(zh)) return 0.05;                                // [=全称] 等价缩写（physiol/refrig/catscan…）
  if (/[A-Z][a-z]{2,}\s*[之的]昵称/.test(zh)) return 0.05;            // 人名昵称（ed = Edwin 之昵称；注意别误伤 bunny）
  if (L <= 6 && /^\s*[A-Z][A-Za-z]+\s*[,，]/.test(zh)) return 0.05;   // 释义以大写英文词+逗号开头
  // 地名/人名/姓/专名
  if (PROPER_RE.test(zh) || PROPER_RE2.test(zh) || PROPER_RE3.test(zh)) return 0.10;
  /* 机构名兜底（PROPER_RE/PROPER_RE2/PROPER_RE3 之外，"某某公司/协会/…"式的专名）。
   * ⚠️ 必须加 !isTrusted 守卫：中文释义是散文，"部""国""中心"会大量误伤常用词 ——
   *    实测不加守卫时 231 个常用词被判成专名，例：
   *      all（"全部的"含"部"）、back（"背部"）、body（"主要部分"）、area（"地区"）、
   *      part（"部分"）、action（"某一地区"）、abroad（"往国外"）、board（"部"）、
   *      border（"国界"）、axis（"中心线"）、campus（"大学校园"）…
   *    后果不只是"分类不准"：联机房间里专名每人每局限 3 个，这些词会白白吃掉玩家的额度，
   *    AI 也会刻意避开它们 —— 等于最常用的词反而最难被出出来。
   * 为什么高频词就一定不是机构专名：柯林斯星级/常见度衡量的是"这个词作为英文单词有多常用"，
   *    真正的机构名（如 abc=美国广播公司）不会有这种数据。实测加守卫后误判 231 → 0。
   * 另注："部/国"这类关键词本身太宽（全部/部分/内部/胸部/外国/国家都会命中），
   *    所以宁可依赖守卫，也不要靠收窄关键词 —— 收窄会漏掉真正的机构专名。 */
  if (L <= 6 && !isTrusted(e) && /(公司|协会|组织|委员会|研究所|大学|中心|部|总部|地区|国)/.test(zh) && /[A-Z]/.test(w) === false) return 0.10;
  return 0.90; // 普通词
}

db.forEach(function (e) { e.kind = computeKind(e); });
mark('算 kind');

/* 词条可信度 conf (0.3~0.9) 与 难度猜测标记 dGuess
 *
 * 背景（实测）：build_unified_db.py 的 _derive_diff 以 best=5 起步，仅凭
 *   考试标签 / 柯林斯星级 / 词频 / 词长 推导难度；因此对"无任何佐证"的词，
 *   难度实际上只由词长决定（≤13 字母→5，>13→7）。全库 227,775 个词是 d=5，
 *   占 80.7%，彼此完全没有区分度。
 *
 * 危害：AI 的难度贴合项 S2 = 1-|d-target|/10，对中等水平玩家(target≈5)来说，
 *   这 22.5 万个"难度未知"的词【全部拿满分 S2=1.0】，反而比真正有难度数据的词
 *   更占优 —— 难度匹配变成了奖励"未知"的假信号。模拟对局证实 AI 出词中
 *   35% 是 d=5、20% 是生僻词(f<0.45)。
 *
 * 处理：① dGuess 标记"难度来自词长兜底"的词，打分时把它们的 S2 降为中性；
 *      ② conf 给出"这个词值不值得喂给学习者"的可信度，供 AI 降权使用。
 * 取值依据：Kyle 精讲(为学习者精选) > 权威佐证 > 无佐证 > 无佐证的专业术语
 */
var DOMAIN_TAG = /\[[^\]]{1,4}\]/;   // [医] [化] [计] [军] [网络] 等标签
db.forEach(function (e) {
  var authed = (e.collins > 0) || ((e.frq || 0) > 0);
  e.dGuess = !authed && !e.has_note;                 // 难度仅为词长兜底推断
  var conf;
  if (e.has_note) conf = 0.9;                        // Kyle 精讲：为学习者精选
  else if (authed) conf = 0.8;                       // 有考试标签/柯林斯/词频佐证
  else if (DOMAIN_TAG.test(e.zh || '')) conf = 0.3;  // 无佐证的专业术语（医/化/计…）
  else conf = 0.45;                                  // 无任何佐证
  e.conf = conf;
});

// 预取 kind（后继里要频繁用）
var kindMap = Object.create(null);
db.forEach(function (e) { kindMap[e.w] = e.kind != null ? e.kind : 0.9; });

var maxChain = 0;
var rawDist = [];   // 观测 chain_raw 分布以校验 REF
var total = db.length;

/* ★ 可接指数计算（succ_cnt / c_cnt / has_succ / chain_raw / chain_idx）
 *
 * 【算法：按前缀桶离线聚合，把 O(Σ|桶|) 降到 O(N)】
 *
 * 朴素做法：对每个词 w，遍历"以 w 末尾 2 字母开头"和"以 w 末尾 3 字母开头"两个桶，
 *   对桶里每个候选 s 调一次判断。总代价 = Σ_w [ B(末2(w)) + B(末3(w)) ]，
 *   其中 B(P) = 以 P 开头的词数。英语前缀是重尾分布（in/re/er/st/co… 开头的词成千上万），
 *   而大量词又共享同一个词尾，于是这个和是**准平方级**的：实测 33 万词要跑 100 秒以上。
 *
 * 关键观察（OI 里典型的"把聚合提到循环外"／离线预处理）：
 *   判断 `isChainable(prev, s)` 里，除了一句 `s.w === prev`（排除自己），
 *   其余两条（末尾 3 字母含元音、不以 ry/ht/ck 结尾）**只取决于 s，与 prev 无关**。
 *   也就是说：同一个前缀桶，对"所有以它开头的候选"给出的贡献是**一模一样**的。
 *   于是可以对每个前缀桶**只聚合一次**，之后每个词 O(1) 查表。
 *
 *   记桶 P 的三个聚合量（只统计"合格词" valid(s)）：
 *     cnt[P] = 合格候选个数      cmn[P] = 其中常见候选个数(f ≥ COMMON_THRESHOLD)
 *     sm[P]  = Σ kind(s)·f(s)^F_POW
 *   则对词 w（令 p2 = 末 2 字母，p3 = 末 3 字母）：
 *     succ_cnt = cnt[p2] + cnt[p3] − |A∩B| − 自己
 *   其中 A = 以 p2 开头的词集，B = 以 p3 开头的词集（p3 比 p2 多一个前导字母）。
 *   两项修正都很小、都可 O(1) 判定：
 *
 *   · 交集 A∩B：B ⊆ A 当且仅当 p2 恰好等于 p3 的前两个字母。
 *     设 a = w[L-3], b = w[L-2], c = w[L-1]（都是 0..25 的字母序号），该条件即
 *         a·26 + b == b·26 + c   ⟺   26(a−b) + (b−c) == 0
 *     由于 |26(a−b)| ≤ 650 而 |b−c| ≤ 25，要抵消只能是 a−b == 0 且 b−c == 0，
 *     即 **a == b == c**：末三个字母全同（"ooo"/"sss" 这种）。
 *     此时 A∩B = B，修正量就是整个桶三的聚合量。
 *
 *   · 自己：w 若正好以自己开头（first2(w) == last2(w) 或 first3(w) == last3(w)），
 *     它会被算进自己那一桶里一次（朴素版靠 `s.w === prev` 排掉），减 1。
 *     注意与交集修正**不会重复计**：无论它同时在 A、B 还是只在其中一个，朴素版都只算一次。
 *
 * 复杂度：聚合阶段每个词恰好进 1 个二字母桶 + 1 个三字母桶 → 严格 O(N)；
 *         查表阶段每词 O(1) → 严格 O(N)。整体从准平方降到线性。
 *
 * 【哈希：不用字符串当 key，用"完美哈希"落到定长类型数组】
 *   2 字母 → (c0−97)·26 + (c1−97)                     ∈ [0, 676)
 *   3 字母 → (c0−97)·676 + (c1−97)·26 + (c2−97)        ∈ [0, 17576)
 *   查表/累加全是数组下标，没有字符串哈希，也没有每词一个 `seen` 对象的分配与 GC。
 *   （朴素版每个词都 `Object.create(null)` 建一个去重表，33 万次分配。）
 *
 * 【为什么仍然用 Math.pow 而不是 f*sqrt(f)】
 *   f^1.5 == f·√f 在数学上成立，但 IEEE754 下 Math.pow 与 Math.sqrt 的舍入路径不同，
 *   结果可能差最后 1 位。本函数的结果要拿去和旧词库逐字段对拍，所以保持 Math.pow 原样 ——
 *   反正现在它每个词只算一次，不再是热路径。
 *
 * ⚠️ 结果与旧的"逐桶遍历"版：所有整数字段（succ_cnt/c_cnt/has_succ）逐位相同；
 *    浮点字段 chain_raw 只差在**求和顺序**（新的先各自求桶内和再相加），
 *    相对误差在 1e-15 量级，对 chain/chain_idx 与 AI 排序无任何影响。
 */
var A2 = 26, A2N = 26 * 26, A3N = 26 * 26 * 26;   // 26 / 676 / 17576

/* 判断一个"候选词"是否合格（可充当别人的后继）—— 即原 isChainable 里与 prev 无关的那两条。
 * ★ 两条判据都直接调用运行期（logic.js）的实现，而不是在这里再写一遍：
 *     R.hasVowelEnding  = 结尾最多 3 字母须含元音（VOWELS = aeiouy）
 *     R.forbiddenEnding = 禁止结尾 ry / ht / ck
 * 说明：这里【不】应用"禁止回声"规则 —— 该规则只在联机房间运行时生效（用户确认的范围），
 * 人机对战/本地同屏都允许回声，所以词库层面的可接指数不应把它算掉。 */
function validSucc(w) {
  return R.hasVowelEnding(w) && !R.forbiddenEnding(w);
}

var gCnt2, gCmn2, gSum2, gCnt3, gCmn3, gSum3;

function buildPrefixAggregates() {
  gCnt2 = new Int32Array(A2N); gCmn2 = new Int32Array(A2N); gSum2 = new Float64Array(A2N);
  gCnt3 = new Int32Array(A3N); gCmn3 = new Int32Array(A3N); gSum3 = new Float64Array(A3N);
  for (var i = 0; i < db.length; i++) {
    var e = db[i], w = e.w, L = w.length;
    if (!validSucc(w)) continue;          // 不合格的词不充当任何人的后继
    var f = e.f || 0;
    var term = kindMap[w] * Math.pow(f, F_POW);
    var cm = f >= COMMON_THRESHOLD ? 1 : 0;
    var i2 = (w.charCodeAt(0) - 97) * A2 + (w.charCodeAt(1) - 97);
    gCnt2[i2]++; gCmn2[i2] += cm; gSum2[i2] += term;
    if (L >= 3) {
      var i3 = i2 * A2 + (w.charCodeAt(2) - 97);
      gCnt3[i3]++; gCmn3[i3] += cm; gSum3[i3] += term;
    }
  }
}

/* ★ 必须在【过滤之后】调用 —— 它只应统计"过滤后仍在库"的词。
 *   曾经的写法把这段跑在过滤之前，导致 succ_cnt/has_succ 把已被删除的词也算成后继：
 *   29,770 个词后继数虚高，onyx/oryx/coccyx/archaeopteryx 等 20 个词被错标为"接得上"。 */
function computeSucc() {
  maxChain = 0; rawDist = []; total = db.length;

  buildPrefixAggregates();

  for (var i = 0; i < total; i++) {
    var e = db[i], w = e.w, L = w.length;

    // 末 2 字母的哈希 —— 它是"候选词的前缀"，不是 w 自己的前缀
    var b = w.charCodeAt(L - 2) - 97, c = w.charCodeAt(L - 1) - 97;
    var p2 = b * A2 + c;

    var succ_cnt = gCnt2[p2], c_cnt = gCmn2[p2], sum = gSum2[p2];

    if (L >= 3) {
      var a = w.charCodeAt(L - 3) - 97;
      var p3 = a * A2N + p2;
      if (a === b && b === c) {
        // 末三字母全同 → B ⊆ A，三字母桶整个已经在二字母桶里算过了，不重复计入
      } else {
        succ_cnt += gCnt3[p3]; c_cnt += gCmn3[p3]; sum += gSum3[p3];
      }
    }

    // 排除"自己"：w 若以自己开头，会被自己那一桶算进去
    if (validSucc(w)) {
      var first2 = (w.charCodeAt(0) - 97) * A2 + (w.charCodeAt(1) - 97);
      var isSelf = (first2 === p2);                 // w ∈ A
      if (!isSelf && L >= 3) {                      // 否则再看 w ∈ B
        var first3 = (w.charCodeAt(0) - 97) * A2N + (w.charCodeAt(1) - 97) * A2 + (w.charCodeAt(2) - 97);
        var last3 = (w.charCodeAt(L - 3) - 97) * A2N + (w.charCodeAt(L - 2) - 97) * A2 + (w.charCodeAt(L - 1) - 97);
        isSelf = (first3 === last3);
      }
      if (isSelf) {
        // 朴素版无论 w 落在 A、B 还是两者，都只被计一次（去重），所以这里也只减 1
        succ_cnt -= 1;
        var fw = e.f || 0;
        if (fw >= COMMON_THRESHOLD) c_cnt -= 1;
        sum -= kindMap[w] * Math.pow(fw, F_POW);
      }
    }

    e.succ_cnt = succ_cnt;
    e.c_cnt = c_cnt;
    e.has_succ = succ_cnt > 0;
    e.chain_raw = sum;
    rawDist.push(sum);
    if (sum > maxChain) maxChain = sum;

    // 进度条：每 1% 打印一次
    if (i % 5000 === 0 || i === total - 1) {
      var pctDone = ((i + 1) / total * 100).toFixed(1);
      process.stdout.write('\r  进度: ' + (i + 1) + '/' + total + ' (' + pctDone + '%)');
    }
  }
  process.stdout.write('\n');

  for (var j = 0; j < total; j++) {
    var x = db[j];
    x.chain = x.chain_raw > 0 ? (1 - Math.exp(-x.chain_raw / REF)) : 0;
    x.chain_idx = x.kind * x.chain;
  }
}

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

/* ---- 依赖型短词清理（"必须要有独立实际意思才可以保留"）----
 * 判据：长度 2-3 的短词，若非"高频/可信"，且满足以下任一，即删除：
 *   A. 依赖型语义 —— 释义表明它依附于另一个词/不是独立词：
 *      等于另一词（sis =「姐妹（等于sister）」）、字母名（ess/zed/en）、化学符号（te/ne/ag）、
 *      缩写、昵称、屈折形式（ays =「ay 的第三人称」）、词素标记（fer =「pref. 带」）、
 *      缩略语展开（ac =「Alternating Current,…」）、无词性标记的片段（ogy =「农业气象学」）
 *   B. 回声热词 —— 长度≤3、非高频、且有 ≥ECHO_HOT_MIN 个词以它结尾（说明它实际被当后缀用）。
 *      这类词（lar/ier/ary/ery/nin…）释义看起来正常，但生僻到没人认识，
 *      出完含该后缀的词后对手只要原样回一遍就"接上了"，看起来就是在偷懒。
 * 保留：有独立意思的真词（oat 燕麦 / tin 锡 / ram 公羊 / hen 母鸡 / ox 公牛 / log 原木 / owl 猫头鹰…）。
 * 实测：删 212 个，其中仅 6 个边缘真词受损（um/ay/os/ger/fed/dal，输入时仍可用确认方式出词）。
 */
var ECHO_HOT_MIN = 500;
var POS_REX = /\b(n|v|vt|vi|adj|adv|prep|conj|pron|num|int|interj|abbr|a|ad|un|art|aux|modal)\./;
function dependentWhy(z) {
  if (/等于|\(\s*=|（\s*=|\[\s*=/.test(z)) return '等于另一词';
  if (/字母\s*[A-Z]\b|\b[A-Z]\s*字母/.test(z)) return '字母名';
  if (/\bsymb\b/i.test(z)) return '化学符号';
  if (/缩写|缩略|简称|略语|首字母/.test(z)) return '缩写';
  if (/[A-Z][a-z]{2,}\s*[之的]昵称/.test(z)) return '昵称';
  if (/的(过去式|过去分词|现在分词|第三人称|复数|名词复数|比较级|最高级)|的-s形式/.test(z)) return '屈折形式';
  if (/\bvbl\.|\bpref\.|\bsuff\.|\bcomb\./.test(z)) return '词素标记';
  if (/^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(z)) return '缩略语展开';
  if (!POS_REX.test(z)) return '无词性标记(片段)';
  return null;
}
// 每个 2/3 字母串作为"词尾"出现在多少词里（衡量它被当作后缀使用的程度）
var suf2 = Object.create(null), suf3 = Object.create(null);
db.forEach(function (e) {
  var w = e.w;
  if (w.length >= 2) suf2[w.slice(-2)] = (suf2[w.slice(-2)] || 0) + 1;
  if (w.length >= 3) suf3[w.slice(-3)] = (suf3[w.slice(-3)] || 0) + 1;
});
function echoCount(e) { return e.w.length === 3 ? (suf3[e.w.slice(-3)] || 0) : (suf2[e.w.slice(-2)] || 0); }

/* ---- 游戏黑话 / 机场代码 / 文件后缀名（"释义根本不是个词"）----
 * 与 [网络] 规则同类：这条释义压根不是"一个英文词的意思"。实测全库命中 15 个，删 11 个：
 *   ony  = [魔兽世界]Onyxia's Lair,黑龙公主奥妮克希亚
 *   yx   = [暗黑破坏神]you xing,有形的
 *   kuk  = [暗黑破坏神]Copy item 复制物品
 *   sheal= [暗黑破坏神]13号神符…          valk = [暗黑破坏神]瓦格雷头盔
 *   alx  = [魔兽世界]地名，阿拉希盆地        zon  = [暗黑破坏神]见"ama"
 *   cky  = 科纳克里（城市机场代码）
 *   bas  = BASIC程序的扩展名              ini  = [计]初始化设置文件的后缀名
 *   exe  = 可执行程序的扩展名
 * 它们都属于用户说的"看起来像在偷懒"那类：ony 能被 22 个常见词接出来（harmony/agony/colony…），
 * cky 能被 11 个接出来（lucky/sticky/rocky…）—— 和当初的 lar 是同一个毛病。
 *
 * 豁免条件用 collins（柯林斯星级佐证），【不】用 frq：
 *   exe(frq=28292) / zon(frq=37017) 在语料里出现得不算少，但释义仍然只是"扩展名 / 见ama"，
 *   没有独立实际意思，按用户规则应当删掉。
 * 必须保住的反例（靠 collins 豁免）：
 *   bat(蝙蝠,collins=3) / bin(箱柜,2) / tar(焦油,1) / extension(延长,2)
 *   —— 它们的释义里也提到"扩展名"，但它们本身是真词，删了就是误伤。
 *
 * 已知代价（有意接受）：删 yx 会让 20 个词变成死路，因为 yx 是它们唯一的接法
 *   （onyx 缟玛瑙 / oryx 剑羚 / coccyx 尾骨 / archaeopteryx 始祖鸟 / sardonyx 缠丝玛瑙…）。
 *   全库本来就有 2659 个死路词，20 个不影响平衡；换来的是"onyx → yx"这种偷懒接法消失。
 */
var GAME_JARGON_RE = /\[(魔兽世界|暗黑破坏神|梦幻西游|传奇|网游|网络游戏|游戏)[^\]]*\]/;
var CODE_WORD_RE = /机场代码|后缀名|扩展名/;

db = db.filter(function (e) {
  if (JUNK.has(e.w)) return false;                    // 明确垃圾黑名单
  // 缩写/碎片(kind=0.05)：只留常见词白名单。
  // 注意这里是 < 0.1 而【不是】<= 0.1 —— kind=0.10 的专名（人名/地名/姓氏）要【保留】：
  // 游戏对专名改用"限额制度"（每人每局最多 N 个），它们仍需留在词库里参与接龙，
  // 只是 AI 会重度降权避开、玩家用量受限。把它们从词库删掉反而会制造新的死路。
  if (e.kind < 0.1) return KEEP.has(e.w);
  if (e.w.length >= 4 && !VOWEL_RE.test(e.w)) return false;  // 无元音长串(代码/缩写碎片)
  // [网络] 标签且无权威佐证(collins/词频)：低质机翻/游戏黑话，剔除
  // 注意：ECDICT 里 [网络] 从不位于释义开头（实际写法是 "n. 野猫\n[网络] 野猫赛；美国原装进口"），
  //       所以必须用【不锚定】的匹配。曾经写成 /^\[网络\]/，结果一个词都匹配不到（规则空转）。
  if (/\[网络\]/.test(e.zh || '') && !(e.collins > 0) && !((e.frq || 0) > 0)) return false;
  // 游戏黑话 / 机场代码 / 文件后缀名（详见上方说明；豁免只看 collins，不看 frq）
  if (!(e.collins > 0) && (GAME_JARGON_RE.test(e.zh || '') || CODE_WORD_RE.test(e.zh || ''))) return false;
  // 依赖型短词 / 生僻回声热词（见上方说明）
  if (e.w.length >= 2 && e.w.length <= 3 && !KEEP.has(e.w) && !isTrusted(e)) {
    var z = String(e.zh || '').trim();
    if (dependentWhy(z)) return false;
    if (echoCount(e) >= ECHO_HOT_MIN) return false;
  }
  return true;
});
console.log('过滤(缩写碎片/无元音/黑名单/[网络]低质/游戏黑话·代码·后缀名/依赖型短词/生僻回声热词；专名保留待限额): ' + before + ' -> ' + db.length + '（保留白名单 ' + KEEP.size + ' 个常用词）');
mark('过滤');
console.log('  kind 分布: ' +
  '普通词 ' + db.filter(function (e) { return e.kind >= 0.5; }).length +
  ' / 专名 ' + db.filter(function (e) { return e.kind > 0.06 && e.kind < 0.5; }).length +
  ' / 缩写 ' + db.filter(function (e) { return e.kind <= 0.06; }).length);

/* ★ 过滤完成 —— 现在才计算可接指数。
 * ⚠️ 顺序不能颠倒：computeSucc 只应统计"过滤后仍在库"的词。
 *    曾经的写法把 succ 计算跑在过滤【之前】，导致 succ_cnt/has_succ 把已被删除的词也算成后继
 *    （29,770 个词后继数虚高；onyx/oryx/coccyx/archaeopteryx 等 20 个词被错标为"接得上"）。 */
kindMap = Object.create(null);
db.forEach(function (e) { kindMap[e.w] = e.kind != null ? e.kind : 0.9; });
computeSucc();
mark('算可接指数');

fs.writeFileSync(OUT_PATH, JSON.stringify(db), 'utf8');

/* 落一份构建元数据（sidecar）。
 * 关键是 rulesFingerprint：它记录"这份词库是用哪一版规则算出来的"。
 * 之后若有人改了规则却没重建，check_db.js 会算一遍新指纹并对比，提醒词库已过期 ——
 * 否则症状是静默的：测试全绿、服务照常启动，只是 AI 以为某个词接得下去、运行时却被拒绝。 */
fs.writeFileSync(BUILD_META_PATH, JSON.stringify({
  builtAt: new Date().toISOString(),
  rawWords: before,
  finalWords: db.length,
  rulesFingerprint: fingerprint.compute(),
  constants: { F_POW: F_POW, COMMON_THRESHOLD: COMMON_THRESHOLD, REF: REF, ECHO_KEEP_F: ECHO_KEEP_F }
}, null, 2), 'utf8');

mark('序列化+写盘');

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
/* 分段耗时（每段净耗时）。可接指数那一段从 100 秒降到 0.2 秒级，见上方 computeSucc 的算法说明。 */
(function () {
  var order = ['读取+解析', '算 kind', '过滤', '算可接指数', '序列化+写盘'];
  var prev = 0, parts = [];
  order.forEach(function (k) {
    var d = PH[k] - prev; prev = PH[k];
    parts.push(k + ' ' + d + 'ms');
  });
  console.log('  耗时: ' + parts.join(' → ') + '   合计 ' + PH['序列化+写盘'] + 'ms');
})();
