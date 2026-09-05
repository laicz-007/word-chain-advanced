/* 规则引擎单元测试：node test/test.js */
'use strict';
var assert = require('assert');
var R = require('../public/logic.js');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '  => ' + (e && e.message)); }
}

/* 规则 1 */
t('rule1: 2字母匹配', function () {
  assert.strictEqual(R.matches('apple', 'lemon'), true); // apple -> le...
});
t('rule1: 3字母匹配', function () {
  assert.strictEqual(R.matches('abcde', 'defg'), true);  // 末2=de
  assert.strictEqual(R.matches('abcde', 'cdef'), true);  // 末3=cde
});
t('rule1: 不匹配', function () {
  assert.strictEqual(R.matches('apple', 'banana'), false);
});
t('rule1: 长度<3 只允许2字母匹配', function () {
  assert.strictEqual(R.matches('am', 'ami'), true);      // prev 长度2 -> 只剩2字母匹配
  assert.strictEqual(R.matches('am', 'milk'), false);    // milk 前2=mi != am
  assert.strictEqual(R.matches('take', 'ke'), true);     // word 长度2 -> 2字母匹配
  assert.strictEqual(R.matches('take', 'kez'), true);    // word 长度3, 前3=kez? 前2=ke -> 2字母匹配成立
});

/* 规则 2：元音 */
t('rule2: 结尾3字母含元音', function () {
  assert.strictEqual(R.hasVowelEnding('cat'), true);
  assert.strictEqual(R.hasVowelEnding('play'), true);   // 末3=lay -> a
  assert.strictEqual(R.hasVowelEnding('cry'), true);    // y 算元音
  assert.strictEqual(R.hasVowelEnding('st'), false);    // 末2=st 无元音
  assert.strictEqual(R.hasVowelEnding('abcd'), false);  // 末3=bcd 无元音
});

/* 规则 3：禁止结尾（ry/ht/ck，fh 已删） */
t('rule3: 禁止 ry/ht/ck', function () {
  assert.strictEqual(R.forbiddenEnding('berry'), true);  // ry
  assert.strictEqual(R.forbiddenEnding('light'), true);  // ht
  assert.strictEqual(R.forbiddenEnding('back'), true);   // ck
  assert.strictEqual(R.forbiddenEnding('wifh'), false);  // fh 已删除
  assert.strictEqual(R.forbiddenEnding('cat'), false);
  assert.strictEqual(R.forbiddenEnding('graph'), false); // ph 不在禁止之列
});

/* 规则 4：长度 */
t('rule4: 长度 >=2', function () {
  assert.strictEqual(R.satisfiesMinLength('am'), true);
  assert.strictEqual(R.satisfiesMinLength('a'), false);
});

/* canStart */
t('canStart: 合法', function () {
  var r = R.canStart('apple');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.word, 'apple');
});
t('canStart: 长度<3 拒绝', function () {
  assert.strictEqual(R.canStart('am').ok, false);
});
t('canStart: 结尾无元音 拒绝', function () {
  assert.strictEqual(R.canStart('cbt').ok, false);
});
t('canStart: ry结尾 拒绝', function () {
  assert.strictEqual(R.canStart('berry').ok, false); // ry 属于禁止结尾
});
t('canStart: 非纯字母 拒绝', function () {
  assert.strictEqual(R.canStart('hello world').ok, false);
});

/* canChain */
t('canChain: 合法接龙', function () {
  assert.strictEqual(R.canChain('apple', 'lemon').ok, true);
  assert.strictEqual(R.canChain('apple', 'lemonade').ok, true);
});
t('canChain: 不匹配 拒绝', function () {
  assert.strictEqual(R.canChain('apple', 'banana').ok, false);
});
t('canChain: 结尾无元音(词) 拒绝', function () {
  // lefth 以 le 开头(匹配), 但末尾3字母 fth 无元音
  assert.strictEqual(R.canChain('apple', 'lefth').ok, false);
});
t('canChain: ry结尾 拒绝', function () {
  // lery 以 le 开头(匹配), 但以 ry 结尾(禁止) -> 非法
  assert.strictEqual(R.canChain('apple', 'lery').ok, false);
});
t('canChain: ht/ck结尾 拒绝', function () {
  assert.strictEqual(R.canChain('apple', 'leight').ok, false); // ht 结尾
  assert.strictEqual(R.canChain('apple', 'leck').ok, false);   // ck 结尾
});

/* 边界：短前词(长度<3) */
t('canChain: 短前词(2字母) 报错不重复', function () {
  var r = R.canChain('in', 'expe');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, '需以「in」开头。', '不应出现"in 或 in"的重复废话');
});
t('canChain: 短前词 合法匹配', function () {
  assert.strictEqual(R.canChain('in', 'ink').ok, true);
  assert.strictEqual(R.canChain('in', 'into').ok, true); // 以 in 开头, 结尾含元音
});
t('canChain: 3字母前词 报出两种开头', function () {
  var r = R.canChain('cat', 'xx');
  assert.ok(r.reason.indexOf('「at」或「cat」') !== -1, '应报两字母与三字母两种开头, 实际 ' + r.reason);
});

/* WordStore */
var vocab = [
  { w: 'apple', zh: 'n.苹果', d: 1, f: 0.9 },
  { w: 'lemon', zh: 'n.柠檬', d: 2, f: 0.8 },
  { w: 'monkey', zh: 'n.猴子', d: 3, f: 0.7 },
  { w: 'keyboard', zh: 'n.键盘', d: 4, f: 0.6 },
  { w: 'board', zh: 'n.板', d: 2, f: 0.5 },
  { w: 'egg', zh: 'n.蛋', d: 1, f: 0.4 }
];
var store = new R.WordStore(vocab);

t('WordStore.lookup', function () {
  assert.strictEqual(store.lookup('APPLE').w, 'apple');
  assert.strictEqual(store.lookup('nope'), null);
});
t('WordStore.candidates: 2字母前缀', function () {
  var c = store.candidates('apple', null); // 末2=le, 末3=ppl
  var ws = c.map(function (x) { return x.w; });
  assert.ok(ws.indexOf('lemon') !== -1);
  assert.ok(ws.indexOf('keyboard') === -1);
});
t('WordStore.candidates: 3字母前缀也被纳入', function () {
  // prev='cable', 末2=le, 末3=ble -> 含以 ble... 开头的词
  var v = new R.WordStore([
    { w: 'app', zh: 'x', d: 1, f: 1 },
    { w: 'lemon', zh: 'x', d: 1, f: 1 },
    { w: 'bleach', zh: 'x', d: 1, f: 1 }
  ]);
  var c = v.candidates('cable', null);
  var ws = c.map(function (x) { return x.w; });
  assert.ok(ws.indexOf('lemon') !== -1, '应包含 lemon(2字母匹配)');
  assert.ok(ws.indexOf('bleach') !== -1, '应包含 bleach(3字母匹配)');
});
t('WordStore.candidates: used 过滤', function () {
  var c = store.candidates('apple', { lemon: true });
  var ws = c.map(function (x) { return x.w; });
  assert.ok(ws.indexOf('lemon') === -1);
});

/* aiChoose / scorePick（新评分：硬门禁 + 加权软分 × 随机） */
t('aiChoose: 无候选返回 null', function () {
  var s2 = new R.WordStore([{ w: 'aa', zh: 'x', d: 1, f: 1, has_succ: true, chain_idx: 0.5 }]);
  assert.strictEqual(R.aiChoose(s2, 'xxbb', null, null, 1), null);
});

function mk(w, d, f, extra) {
  var o = { w: w, zh: 'x', d: d, f: f }; Object.assign(o, extra || {});
  return o;
}
function trials(store, prev, usage, target, n) {
  var cnt = {};
  for (var k = 0; k < n; k++) {
    var c = R.aiChoose(store, prev, null, usage, target);
    if (c) cnt[c.w] = (cnt[c.w] || 0) + 1;
  }
  return cnt;
}

t('aiChoose: 死路词(has_succ=false)绝不入选(硬门禁)', function () {
  var v = new R.WordStore([
    mk('able', 3, 0.5, { has_succ: true, chain_idx: 0.5 }),
    mk('blex', 3, 0.5, { has_succ: true, chain_idx: 0.5 }),
    mk('leford', 3, 0.9, { has_succ: false, chain_idx: 0 })   // 死路, 即使词频高也绝不选
  ]);
  var c = trials(v, 'able', {}, 3, 80);
  assert.ok(!c['leford'], '死路词应从未被选, 实际出现 ' + (c['leford'] || 0));
});

t('aiChoose: 倾向难度贴近目标', function () {
  var v = new R.WordStore([
    mk('able', 2, 0.5, { has_succ: true, chain_idx: 0.5 }),
    mk('blex', 2, 0.5, { has_succ: true, chain_idx: 0.5 }),
    mk('lezz', 9, 0.5, { has_succ: true, chain_idx: 0.5 })
  ]);
  var c = trials(v, 'able', {}, 2, 80);
  assert.ok((c['able'] || 0) + (c['blex'] || 0) > 60, '难度2的词应大多数时候被选, 实际 ' + JSON.stringify(c));
});

t('aiChoose: 可接指数低(如缩写)被压低', function () {
  var v = new R.WordStore([
    mk('able', 3, 0.5, { has_succ: true, chain_idx: 0.8, kind: 0.9 }),
    mk('blex', 3, 0.5, { has_succ: true, chain_idx: 0.8, kind: 0.9 }),
    mk('lezz', 3, 0.5, { has_succ: true, chain_idx: 0.02, kind: 0.05 })  // 缩写/词型分低
  ]);
  var c = trials(v, 'able', {}, 3, 80);
  assert.ok((c['lezz'] || 0) <= 5, '可接指数低的词应几乎不被选, 实际 ' + JSON.stringify(c));
});

/* Game 状态机：人机 */
t('Game: 人机流程 开局->接龙->AI回应', function () {
  var g = new R.Game(store, [{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
  var s = g.submitStart('apple');
  assert.strictEqual(s.ok, true);
  assert.strictEqual(g.turn, 1);
  var ai = g.tickAI();
  assert.ok(ai);
  assert.ok(g.lastWord);
});

t('Game: 重复词被拒', function () {
  var g = new R.Game(store, [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]);
  g.submitStart('apple');
  assert.strictEqual(g.turn, 1);
  var r = g.submitChain('apple');
  assert.strictEqual(r.ok, false);
});

t('Game: 认输得分给上一个出词的人', function () {
  var g = new R.Game(store, [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]);
  g.submitStart('apple');  // A
  g.submitChain('lemon');  // B
  var c = g.concede('手动认输'); // A 认输
  assert.strictEqual(g.players[1].score, 1);
  assert.strictEqual(c.scorer, 'B');
  assert.strictEqual(g.starter, 0);
});

t('Game: 开局后立即认输, 开局者得分', function () {
  var g = new R.Game(store, [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]);
  g.submitStart('apple'); // A
  g.concede('无词可接');  // B 认输
  assert.strictEqual(g.players[0].score, 1);
});

t('Game: 认输后 newRound 清空重复', function () {
  var g = new R.Game(store, [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]);
  g.submitStart('apple');
  g.concede('x');
  g.newRound();
  assert.strictEqual(Object.keys(g.used).length, 0);
  assert.strictEqual(g.lastWord, null);
});

t('Game: aiTarget 取非AI玩家最近词难度均值', function () {
  var g = new R.Game(store, [{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
  g.submitStart('apple'); // d=1, pushRecent 人类
  assert.strictEqual(g.aiTarget(), 1);
  g.pushRecent(0, 'lemon'); // d=2
  assert.strictEqual(g.aiTarget(), 1.5);
});

t('Game: AI 开局 (AI成为starter)', function () {
  var g = new R.Game(store, [{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
  // 让 AI 当开局者
  g.starter = 1;
  g.turn = 1;
  var ai = g.tickAI(); // AI 需要给开局词
  assert.ok(ai);
  assert.strictEqual(ai.action, 'start');
  assert.ok(g.lastWord);
});

t('Game: 防疲劳 allUsed 跨轮累计', function () {
  var g = new R.Game(store, [{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
  g.submitStart('apple'); // 玩家用 apple
  assert.ok(g.allUsed['apple'], 'apple 应进入全时段集合');
  g.newRound();           // 换轮不清空 allUsed(防疲劳)
  assert.ok(g.allUsed['apple'], '换轮后 apple 仍在全时段集合');
  // 若 AI 是开局者, sampleStarts(allUsed) 不应给出 apple
  g.starter = 1; g.turn = 1;
  var starts = g.store.sampleStarts(g.allUsed);
  assert.strictEqual(starts.some(function (e) { return e.w === 'apple'; }), false, 'AI 开局不应再用 apple');
});

t('Game: 防疲劳 AI 接龙避开已用词', function () {
  // prev='able', 候选只有 apple 与 abx; 用掉 apple 后 AI 只能选 abx(若合法)
  var v = new R.WordStore([
    { w: 'able', zh: 'x', d: 1, f: 0.5 },
    { w: 'blex', zh: 'x', d: 1, f: 0.9 },
    { w: 'lexx', zh: 'x', d: 1, f: 0.9 }
  ]);
  var g = new R.Game(v, [{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
  g.submitStart('able');                 // 玩家开局 able
  g.allUsed['blex'] = true;              // 模拟 blex 已被用过
  var r = g.tickAI();                    // AI 接龙
  assert.ok(r && r.action === 'chain');
  assert.strictEqual(g.lastWord, 'lexx', 'AI 应避开已用的 blex, 选 lexx');
});

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
