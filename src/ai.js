/* src/ai.js — AI 裁判：可疑出词的"验词"机制
 *
 * 作用：玩家出了可疑的词时，暂停本轮并弹一道四选一（3 个释义候选 + "以上都不对"），
 *      让玩家证明自己真认识这个词。答错扣 1 分（接龙照常继续），答对不扣。
 *
 * 适用范围：人机对战 / 本地同屏 / 联机房间 —— 三者都走同一套判定
 *          （钩子挂在共用引擎 Game 上，见 public/logic.js 的 `this.aiReferee`）。
 *
 * 判定依据（结合本局 + 历次对局）：
 *   1. 生僻度      —— 词本身常见度低 / 非可信词条
 *   2. 出词过快    —— 距上一个词的时间过短，不像是真在想
 *   3. 难度突跳    —— 这个词比该玩家本局此前的词难一大截
 *   4. 不像你会用  —— 超出该玩家学习画像的难度区 / 不在其已见词集合里（历次对局数据）
 *   5. 取巧短词    —— 又短又生僻，典型"凑数"词
 *
 * ⚠️ 阈值都在 CFG 里，想调松紧只改这里。触发过于频繁时优先调大 TRIGGER 或 COOLDOWN_MS。
 */
'use strict';
var db = require('./db');

var CFG = {
  FAST_MS: 2500,          // 距上一个词不足此毫秒 → 视为"出词过快"
  VERY_FAST_MS: 1200,     // 极快（几乎不可能是真在回忆）
  OBSCURE_VERY_LOW: 0.30, // 常见度 f 低于此 → 很生僻（可疑度 1.0）
  OBSCURE_LOW: 0.45,      // f 低于此 → 偏生僻（可疑度 0.7）
  COOLDOWN_MS: 60000,     // 同一玩家两次验词的最小间隔（防连环弹窗）
  TRIGGER: 0.55,          // 可疑度达到此值就弹验词
  OPTION_COUNT: 3,        // 释义候选个数（另有 1 个"以上都不对"）
  NONE_OPTION_RATE: 0.25, // 该概率下正确释义不在候选里 → "以上都不对"才是答案
  NONE_LABEL: '以上都不对'
};

// 权重（总和 1.0）
var W = { obscure: 0.50, fast: 0.30, jumpUp: 0.05, unlikely: 0.10, lazyShort: 0.05 };

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

/* 生僻度分档（比线性 ramp 更好调、行为更可预期）
 * 有佐证/精讲的词条基本可信；无佐证的词按常见度分三档 */
function obscurityOf(entry) {
  if (db.R.isTrustedEntry(entry)) return 0.15;
  var f = entry.f || 0;
  if (f < CFG.OBSCURE_VERY_LOW) return 1.0;   // 很生僻
  if (f < CFG.OBSCURE_LOW) return 0.7;        // 偏生僻
  return 0.35;                                // 一般
}

// 释义精简：去掉词性前缀、压平换行、截断
function cleanZh(zh) {
  var s = String(zh == null ? '' : zh).replace(/\s+/g, ' ').trim();
  s = s.replace(/^[a-z]{1,6}\.\s*/i, '');
  if (s.length > 34) s = s.slice(0, 34) + '…';
  return s;
}

/* 生成四选一题目。返回 { word, options, answerIdx, correctZh } 或 null（该词无法出题） */
function makeQuestion(entry) {
  if (!entry) return null;
  var correctZh = cleanZh(entry.zh);
  if (!correctZh) return null;                       // 没有释义无法出题
  var pool = db.dbVocab;
  var used = Object.create(null);
  used[correctZh] = 1;
  var distractors = [];
  var guard = 0;
  while (distractors.length < CFG.OPTION_COUNT && guard < 400) {
    guard++;
    var cand = pool[Math.floor(Math.random() * pool.length)];
    if (!cand || cand.w === entry.w) continue;
    // 干扰项难度接近才像真的
    if (Math.abs((cand.d || 5) - (entry.d || 5)) > 2) continue;
    var z = cleanZh(cand.zh);
    if (!z || used[z]) continue;
    used[z] = 1;
    distractors.push(z);
  }
  if (distractors.length < CFG.OPTION_COUNT) return null;   // 凑不齐就别出题

  var options = distractors.slice(0, CFG.OPTION_COUNT);
  var noneIsCorrect = Math.random() < CFG.NONE_OPTION_RATE;
  var answerText;
  if (noneIsCorrect) {
    // 正确释义故意不放进候选 → "以上都不对"才是答案（防止瞎猜）
    answerText = CFG.NONE_LABEL;
  } else {
    options[Math.floor(Math.random() * options.length)] = correctZh;
    answerText = correctZh;
  }
  options.push(CFG.NONE_LABEL);
  // 洗牌（Fisher–Yates）
  for (var i = options.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = options[i]; options[i] = options[j]; options[j] = t;
  }
  return { word: entry.w, options: options, answerIdx: options.indexOf(answerText), correctZh: correctZh, noneIsCorrect: noneIsCorrect };
}

/* 判定某次出词是否可疑。命中则返回可直接挂到 game.verify 的验词对象，否则返回 null。
 * opts.elapsedMs —— 距上一个词的毫秒数（可选；拿不到就忽略"速度"这一项）
 */
function assess(game, playerIdx, entry, opts) {
  opts = opts || {};
  if (!entry) return null;                                    // 非词库词本来就要玩家确认，不再验
  var p = game && game.players && game.players[playerIdx];
  if (!p || p.type !== 'human') return null;                  // 只验人类玩家
  if (game.verify) return null;                               // 已有待作答的题
  if (p._lastVerifyAt && Date.now() - p._lastVerifyAt < CFG.COOLDOWN_MS) return null;

  var reasons = [];

  // 1) 生僻度
  var obscure = obscurityOf(entry);
  if (obscure >= 0.7) reasons.push('生僻词');

  // 2) 出词过快
  var ms = (opts.elapsedMs == null) ? null : Number(opts.elapsedMs);
  var fast = (ms == null) ? 0 : (ms <= CFG.VERY_FAST_MS ? 1 : (ms <= CFG.FAST_MS ? 0.6 : 0));
  if (fast >= 0.6) reasons.push('出词过快');

  // 3) 难度突跳（本局：比该玩家此前词的平均难度高出一大截）
  var recent = p.recent || [];
  var avgD = recent.length ? recent.reduce(function (a, r) { return a + (r.d || 5); }, 0) / recent.length : null;
  var jumpUp = (avgD == null) ? 0 : clamp01(((entry.d || 5) - avgD - 2) / 5);
  if (jumpUp >= 0.3) reasons.push('难度突跳');

  // 4) 不像你会用的词（历次对局画像：难度区 + 已见词集合）
  var unlikely = 0;
  var prof = game.profile;
  if (prof && prof.hasData) {
    var skill = Number(prof.skill) || 5;
    if ((entry.d || 5) > skill + 2) unlikely += 0.6;
    if (prof.knownSet && !prof.knownSet[entry.w]) unlikely += 0.4;
    unlikely = clamp01(unlikely);
  }
  if (unlikely >= 0.3) reasons.push('超出你的水平');

  // 5) 取巧短词（又短又生僻）
  var lazyShort = (entry.w.length <= 4 && !db.R.isTrustedEntry(entry)) ? 1 : 0;
  if (lazyShort && entry.w.length <= 3) reasons.push('取巧短词');

  var score = W.obscure * obscure + W.fast * fast + W.jumpUp * jumpUp + W.unlikely * unlikely + W.lazyShort * lazyShort;
  // 硬规则：极生僻词（无任何佐证且 f 低于 OBSCURE_VERY_LOW）无论快慢都验 ——
  // 能打出这种词，就应该能说出它的意思；仅靠加分容易被"慢慢打"绕过。
  var mustVerify = (obscure >= 1.0);
  if (mustVerify) reasons.push('极生僻');
  if (!mustVerify && score < CFG.TRIGGER) return null;

  var q = makeQuestion(entry);
  if (!q) return null;

  p._lastVerifyAt = Date.now();
  return {
    playerIdx: playerIdx,
    playerName: p.name,
    word: q.word,
    options: q.options,
    answerIdx: q.answerIdx,
    correctZh: q.correctZh,
    noneIsCorrect: q.noneIsCorrect,
    score: Math.round(score * 100) / 100,
    reasons: reasons
  };
}

/* 把裁判挂到一局对局上（三种模式都调用它） */
function attach(game) {
  if (!game) return game;
  game.aiReferee = assess;
  return game;
}

module.exports = { CFG: CFG, WEIGHTS: W, assess: assess, attach: attach, makeQuestion: makeQuestion, cleanZh: cleanZh, obscurityOf: obscurityOf };
