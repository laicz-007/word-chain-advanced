/* tools/rules_fingerprint.js — 规则指纹
 *
 * 【解决什么问题】
 * 词库 `data/db.json` 里的 `chain_idx`/`has_succ` 是**用某一版规则算出来的**。
 * 如果之后有人改了规则却没重跑构建，词库就与运行期判据脱节了 —— 而且**症状是静默的**：
 * 测试全绿、服务照常启动，只是 AI 会以为某个词接得下去，运行时却被拒绝。
 *
 * 做法：构建时把"规则指纹"写进 `data/db.build.json`；
 *       `check_db.js` 再算一遍对比，不一致就提醒"词库是用旧规则构建的，请重跑 npm run build"。
 *
 * 【为什么用"行为特征"而不是源码文本】
 * 直接哈希函数源码很脆：改个注释、调个格式就会误报。
 * 这里改用一组固定的探针词/探针词条，把规则在它们身上的**实际输出**压成指纹 ——
 * 注释和排版怎么改都不影响，只有**行为变了**指纹才变。
 */
'use strict';
var crypto = require('crypto');
var R = require('../public/logic.js');

// 探针词：覆盖元音结尾、禁结尾、短词、边界情况
var PROBE_WORDS = [
  'a', 'ab', 'abc', 'hello', 'water', 'oat', 'to', 'be', 'as',
  'sorry', 'very', 'light', 'right', 'back', 'rock',           // ry / ht / ck 禁结尾
  'ry', 'ht', 'ck', 'rhy', 'myth', 'sky', 'y',                 // 边界
  'aeiouy', 'xyz', 'bcdfg', 'aa', 'zoa', 'oy', 'ey'
];

// 探针词条：覆盖 isTrustedEntry 的每个分支（柯林斯 / 常见度 f / 有精讲 / 空词条 / 阈值边界）
// ⚠️ 必须包含 null 与 undefined：那对应"词库外的词（玩家自己填的）"这一支，
//    漏了它就会出现盲区 —— 实测改这一支的行为时指纹不变，等于白设防。
var PROBE_ENTRIES = [
  null,
  undefined,
  { w: 'a', collins: 0, f: 0.10, has_note: false },   // 都不满足 → 不可信
  { w: 'b', collins: 1, f: 0.10, has_note: false },   // 柯林斯≥1 → 可信
  { w: 'c', collins: 0, f: 0.99, has_note: false },   // f 很高 → 可信
  { w: 'd', collins: 0, f: 0.10, has_note: true },    // 有精讲 → 可信
  { w: 'e', collins: 0, f: 0.00, has_note: false },   // 零值兜底
  { w: 'f', collins: 0, f: 0.65, has_note: false },   // 恰好落在阈值上
  { w: 'g', collins: 0, f: 0.64, has_note: false }    // 恰好差一点
];

/* 规则的"行为签名"：把每条规则在探针上的输出拼成一个字符串。
 * 任何一条规则的行为变化都会改变它 —— 不依赖源码文本，因此改注释/格式不会误报。 */
function signature() {
  var bits = [];

  // 常量本身也参与（它们直接决定行为）
  bits.push('VOWELS=' + R.VOWELS);
  bits.push('ECHO_KEEP_F=' + R.ECHO_KEEP_F);

  // 规则2/3：末尾元音、禁结尾
  PROBE_WORDS.forEach(function (w) {
    bits.push(w + ':' + (R.hasVowelEnding(w) ? '1' : '0') + (R.forbiddenEnding(w) ? '1' : '0'));
  });

  // 高频/可信口径（构建期清理与运行期回声豁免共用）
  PROBE_ENTRIES.forEach(function (e, i) {
    bits.push('e' + i + ':' + (R.isTrustedEntry(e) ? '1' : '0'));
  });

  return bits.join('|');
}

function compute() {
  return crypto.createHash('sha1').update(signature()).digest('hex').slice(0, 12);
}

module.exports = {
  compute: compute,
  signature: signature,
  PROBE_WORDS: PROBE_WORDS,
  PROBE_ENTRIES: PROBE_ENTRIES
};
