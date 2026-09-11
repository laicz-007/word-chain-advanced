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

/* ---- 专名（人名/地名/姓氏）限额制度 ---- */
// 用一个"专名可自我衔接"的最小词库：cola 末尾 la → la*la 系列词都以 la 开头且以 la 结尾
function properFixture() {
  return new R.WordStore([
    { w: 'cola', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 },
    { w: 'laala', zh: 'x', d: 1, f: 0.9, kind: 0.1, has_succ: true, chain_idx: 0.9 },
    { w: 'labla', zh: 'x', d: 1, f: 0.9, kind: 0.1, has_succ: true, chain_idx: 0.9 },
    { w: 'lacla', zh: 'x', d: 1, f: 0.9, kind: 0.1, has_succ: true, chain_idx: 0.9 },
    { w: 'ladla', zh: 'x', d: 1, f: 0.9, kind: 0.1, has_succ: true, chain_idx: 0.9 }
  ]);
}

t('专名: isProperEntry 判定与 PROPER_QUOTA', function () {
  assert.strictEqual(R.isProperEntry({ w: 'a', kind: 0.1 }), true);
  assert.strictEqual(R.isProperEntry({ w: 'a', kind: 0.9 }), false);
  assert.strictEqual(R.isProperEntry({ w: 'a', kind: 0.05 }), false, '缩写碎片不算专名');
  assert.strictEqual(R.isProperEntry({ w: 'a' }), false, '无 kind 字段(vocab.json 场景)按普通词处理');
  assert.strictEqual(R.isProperEntry(null), false);
  assert.strictEqual(R.PROPER_QUOTA, 3);
});

t('专名限额: 房间模式下每局每人 3 个, 第 4 个被拒', function () {
  var g = new R.Game(properFixture(), [{ name: '我', type: 'human' }]);
  g.mode = 'room';                    // 专名限额只在联机房间生效
  assert.ok(g.submitStart('cola').ok, '普通词开局应成功');
  assert.strictEqual(g.players[0].properUsed, 0, '普通词不消耗专名额度');
  assert.ok(g.submitChain('laala').ok, '第 1 个专名应可用');
  assert.ok(g.submitChain('labla').ok, '第 2 个专名应可用');
  assert.ok(g.submitChain('lacla').ok, '第 3 个专名应可用');
  assert.strictEqual(g.players[0].properUsed, 3);
  var r = g.submitChain('ladla');
  assert.strictEqual(r.ok, false, '第 4 个专名应被拒');
  assert.ok(/专名/.test(r.reason || ''), '拒绝原因应说明是专名限额, 实际: ' + r.reason);
  assert.strictEqual(g.players[0].properUsed, 3, '被拒后额度不应增加');
});

t('专名限额: 非房间模式（人机/同屏/离线）不限制专名个数', function () {
  var g = new R.Game(properFixture(), [{ name: '我', type: 'human' }]);   // 默认 mode='pve'
  assert.ok(g.submitStart('cola').ok);
  assert.ok(g.submitChain('laala').ok);
  assert.ok(g.submitChain('labla').ok);
  assert.ok(g.submitChain('lacla').ok);
  assert.ok(g.submitChain('ladla').ok, '非房间模式第 4 个专名也应放行');
});

t('专名限额: 换轮不重置（额度按"局"计，不按"轮"计）', function () {
  var g = new R.Game(properFixture(), [{ name: '我', type: 'human' }]);
  g.mode = 'room';
  g.submitStart('cola');
  g.submitChain('laala'); g.submitChain('labla'); g.submitChain('lacla');
  g.concede('测试认输');
  g.newRound();
  assert.strictEqual(g.players[0].properUsed, 3, '换轮后已用额度应保留');
  var r = g.submitStart('ladla');   // 专名作开局词
  assert.strictEqual(r.ok, false, '换轮后专名额度不应重置');
});

t('专名限额: 每位玩家各自独立计数', function () {
  var v = properFixture();
  var g = new R.Game(v, [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.mode = 'room';
  g.submitStart('cola');                       // 甲 开局
  assert.ok(g.submitChain('laala').ok);        // 乙 用第 1 个
  assert.ok(g.submitChain('labla').ok);        // 甲 用第 1 个
  assert.strictEqual(g.players[0].properUsed, 1, '甲 用了 1 个');
  assert.strictEqual(g.players[1].properUsed, 1, '乙 用了 1 个');
});

t('专名限额: AI 有额度时会选专名（对照）', function () {
  var g = new R.Game(properFixture(), [{ name: 'AI', type: 'ai' }]);
  g.submitStart('cola');
  assert.ok(g.tickAI(), 'AI 应有动作');
  // 4 个专名统计特征完全相同（同 d/f/chain_idx/kind），选哪个由随机因子决定，
  // 所以只断言"选中的确实是专名"，不断言具体是哪个词（否则会随机失败）
  assert.ok(R.isProperEntry(g.store.lookup(g.lastWord)), '有额度时 AI 会选专名, 实际选了 ' + g.lastWord);
  assert.strictEqual(g.players[0].properUsed, 1, 'AI 用掉 1 个专名额度');
});

t('专名限额: AI 额度用完后不再选专名（宁可认输）', function () {
  // 开局：候选含普通词 cola 与专名 laala，额度已满 → 应选普通词
  var g = new R.Game(properFixture(), [{ name: 'AI', type: 'ai' }]);
  g.players[0].properUsed = R.PROPER_QUOTA;
  var r = g.tickAI();
  assert.ok(r, 'AI 应有动作');
  assert.strictEqual(g.lastWord, 'cola', '额度已满时 AI 开局应选普通词');
  // 接龙：从 cola 只能接专名 laala → 额度已满，应认输而不是违规选专名
  var r2 = g.tickAI();
  assert.ok(r2 && r2.action === 'concede', '额度用完后 AI 不应选专名, 实际 ' + JSON.stringify(r2));
});

/* ---- AI 词条可信度 conf / 难度猜测标记 dGuess ---- */
// scorePick 内含 S5∈[0.93,1.07] 随机因子，单次结果不稳，故用多次试验看胜率
function winRate(a, b, target, trials) {
  var wa = 0;
  for (var i = 0; i < trials; i++) {
    var r = R.scorePick([a, b], {}, target, {});
    if (r && r.w === a.w) wa++;
  }
  return wa;
}

t('AI 可信度: 难度为"词长兜底推断"(dGuess) 的词不再被难度贴合奖励', function () {
  // 两词各项相同、d 都=5；只有 dGuess 不同。target=5 时旧逻辑会给两者同样满分 S2=1.0。
  var base = { w: 'aaa', d: 5, f: 0.8, kind: 0.9, has_succ: true, chain_idx: 0.9, conf: 0.9 };
  var known = Object.assign({}, base, { dGuess: false });   // 有真实难度佐证
  var guessed = Object.assign({}, base, { w: 'bbb', dGuess: true }); // 难度仅由词长兜底
  var wins = winRate(known, guessed, 5, 60);
  assert.ok(wins >= 45, '有真实难度的词应稳定胜出, 实际 ' + wins + '/60');
});

t('AI 可信度: conf 低的冷僻条目被降权', function () {
  var base = { d: 3, f: 0.8, kind: 0.9, has_succ: true, chain_idx: 0.9 };
  var good = Object.assign({}, base, { w: 'aaa', conf: 0.9 });
  var bad = Object.assign({}, base, { w: 'bbb', conf: 0.3 });
  var wins = winRate(good, bad, 3, 60);
  assert.ok(wins >= 45, '高可信度条目应稳定胜出, 实际 ' + wins + '/60');
});

t('AI 可信度: 缺 conf / dGuess 字段时不被单方面惩罚（兼容 vocab.json 等旧词库）', function () {
  var base = { d: 3, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 };
  var a = Object.assign({}, base, { w: 'aaa' });   // 两个词条都不带 conf/dGuess
  var b = Object.assign({}, base, { w: 'bbb' });
  var wa = winRate(a, b, 3, 60);
  assert.ok(wa > 10 && wa < 50, '两者应互有胜负(说明未被单方面惩罚), 实际 ' + wa + '/60');
});

t('AI 可信度: 专业术语(conf=0.3) 显著劣于精讲词(conf=0.9)', function () {
  var base = { d: 5, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.9 };
  var curated = Object.assign({}, base, { w: 'aaa', conf: 0.9, has_note: true });
  var jargon = Object.assign({}, base, { w: 'bbb', conf: 0.3 });
  var wins = winRate(curated, jargon, 5, 60);
  assert.ok(wins >= 45, '精讲词应稳定胜出, 实际 ' + wins + '/60');
});

/* ---- 积分系统（正反馈）---- */
t('积分: 每成功出词 +perWord', function () {
  var g = new R.Game(store, [{ name: '甲', type: 'human' }]);
  assert.strictEqual(g.players[0].points, 0, '初始为 0');
  g.submitStart('apple');
  assert.strictEqual(g.players[0].points, R.POINTS.perWord, '开局出词应加分');
  g.submitChain('lemon');
  assert.strictEqual(g.players[0].points, R.POINTS.perWord * 2, '接龙出词应加分');
});

t('积分: 被拒绝的出词不加分', function () {
  var g = new R.Game(store, [{ name: '甲', type: 'human' }]);
  g.submitStart('apple');
  var before = g.players[0].points;
  var r = g.submitChain('monkey');            // 与 apple 不匹配
  assert.strictEqual(r.ok, false);
  assert.strictEqual(g.players[0].points, before, '失败出词不应加分');
});

t('积分: 赢一轮获得 winRound，认输方不得分', function () {
  var g = new R.Game(store, [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.submitStart('apple');                     // 甲 出词 +1
  assert.strictEqual(g.players[0].points, R.POINTS.perWord);
  g.concede('乙认输');                         // 轮到乙(1)，上一个出词的是甲(0) → 甲赢
  assert.strictEqual(g.players[0].score, 1, '甲得分');
  assert.strictEqual(g.players[0].points, R.POINTS.perWord + R.POINTS.winRound, '甲应+winRound');
  assert.strictEqual(g.players[1].points, 0, '认输方不得分');
});

t('积分: 长接龙额外奖励（pointsForWin）', function () {
  assert.strictEqual(R.pointsForWin(0), R.POINTS.winRound, '短接龙只有基础分');
  assert.strictEqual(R.pointsForWin(R.POINTS.longChainFrom), R.POINTS.winRound, '刚好达到阈值不加成');
  assert.strictEqual(R.pointsForWin(R.POINTS.longChainFrom + 5),
    R.POINTS.winRound + 5 * R.POINTS.longChainBonus, '超出部分按 bonus 累加');
});

t('积分: 重复认输不会重复计分（防刷分）', function () {
  var g = new R.Game(store, [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.submitStart('apple');
  g.concede('乙认输');                          // 甲 赢本轮
  var pts = g.players[0].points, sc = g.players[0].score;
  assert.strictEqual(sc, 1, '甲得 1 分');
  var dup = g.concede('再次认输');               // 本轮已结束
  assert.strictEqual(dup.alreadyEnded, true, '应识别为"本轮已结束"');
  assert.strictEqual(g.players[0].points, pts, '重复认输不应再加积分');
  assert.strictEqual(g.players[0].score, sc, '重复认输不应再加分数');
});

/* ---- 道具系统 ---- */
function itemFixture() {
  return new R.WordStore([
    { w: 'abler', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 },
    { w: 'erlow', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.1 },
    { w: 'erhigh', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.9 }
  ]);
}

t('道具: 商店目录含三种卡且字段完整', function () {
  var cat = R.shopCatalog();
  var kinds = cat.map(function (i) { return i.kind; }).sort();
  assert.deepStrictEqual(kinds, ['reverse', 'skip', 'swap'], '三种卡都应可售');
  assert.ok(cat.every(function (i) { return i.price > 0 && i.name && i.desc; }), '目录项应含价格与说明');
  assert.strictEqual(R.ITEM_QUOTA, 3);
  assert.strictEqual(R.itemInfo('nope'), null, '未知道具返回 null');
  assert.strictEqual(R.itemInfo('reverse').available, true, '反转卡已开放（按"回合逆序"实现）');
});

t('道具-跳过卡: 跳过本次接龙（待接词不变、不算认输）', function () {
  var g = new R.Game(itemFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.submitStart('abler');                       // 甲 开局
  var w = g.lastWord;
  assert.strictEqual(g.turn, 1, '轮到乙');
  var r = g.useItem('skip');
  assert.ok(r.ok && r.effect === 'skip', '跳过卡应生效');
  assert.strictEqual(g.lastWord, w, '待接词应保持不变');
  assert.strictEqual(g.turn, 0, '应轮到下一位');
  assert.strictEqual(g.players[1].itemsUsed, 1, '计入该玩家本局道具次数');
  assert.strictEqual(g.players[1].score, 0, '跳过不算认输，不得分');
  assert.strictEqual(g.roundActive, true, '本轮仍在进行');
});

t('道具-修改卡: 把待接词换成可接指数更高的合法后继', function () {
  var g = new R.Game(itemFixture(), [{ name: '我', type: 'human' }]);
  g.submitStart('abler');
  g.submitChain('erlow');
  assert.strictEqual(g.lastWord, 'erlow');
  var ownerBefore = g.lastWordOwner, ptsBefore = g.players[0].points;
  var r = g.useItem('swap');
  assert.ok(r.ok && r.effect === 'swap', '修改卡应生效');
  assert.strictEqual(g.lastWord, 'erhigh', '应换成可接指数更高的词(0.1 → 0.9)');
  assert.strictEqual(g.players[0].itemsUsed, 1, '计入本局道具次数');
  assert.strictEqual(g.players[0].points, ptsBefore, '道具换词不算玩家出词，不应加分');
  assert.strictEqual(g.lastWordOwner, ownerBefore, 'lastWordOwner 不应被道具改变');
});

t('道具-修改卡: 找不到更好接的词时失败且不消耗次数', function () {
  var v = new R.WordStore([
    { w: 'abler', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 },
    { w: 'erbest', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.9 }
  ]);
  var g = new R.Game(v, [{ name: '我', type: 'human' }]);
  g.submitStart('abler');
  g.submitChain('erbest');
  var r = g.useItem('swap');
  assert.ok(r.error, '没有更好接的词应返回错误');
  assert.strictEqual(g.players[0].itemsUsed, 0, '失败不应消耗道具次数');
  assert.strictEqual(g.lastWord, 'erbest', '待接词不应被改动');
});

t('道具: 每局每人最多 3 次（跨轮不重置）', function () {
  var g = new R.Game(itemFixture(), [{ name: '我', type: 'human' }]);
  g.submitStart('abler');
  assert.ok(g.useItem('skip').ok, '第 1 次');
  assert.ok(g.useItem('skip').ok, '第 2 次');
  assert.ok(g.useItem('skip').ok, '第 3 次');
  var r = g.useItem('skip');
  assert.ok(r.error, '第 4 次应被拒');
  assert.ok(/3 次/.test(r.error), '拒绝原因应说明每局上限, 实际: ' + r.error);
  g.concede('测试'); g.newRound();
  assert.strictEqual(g.players[0].itemsUsed, R.ITEM_QUOTA, '换轮后已用次数应保留');
  assert.ok(g.useItem('skip').error, '换轮后仍应被拒');
});

t('道具: 未知道具不可用', function () {
  var g = new R.Game(itemFixture(), [{ name: '我', type: 'human' }]);
  g.submitStart('abler');
  var r = g.useItem('__nope__');
  assert.ok(r.error, '未知道具应被拒');
  assert.strictEqual(g.players[0].itemsUsed, 0, '失败不应消耗次数');
});

/* 反转卡 = 回合逆序：只倒转"谁先出词"，接龙匹配规则完全不变 */
t('道具-反转卡: 倒转出词顺序且自身本轮免接', function () {
  var g = new R.Game(itemFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }, { name: '丙', type: 'human' }]);
  g.submitStart('abler');                       // 甲 开局 → 正序轮到乙
  assert.strictEqual(g.turn, 1, '正序轮到乙');
  var r = g.useItem('reverse');
  assert.ok(r.ok && r.effect === 'reverse' && r.reversed === true, '反转卡应生效');
  assert.strictEqual(g.reverseTurn, true);
  assert.strictEqual(g.turn, 0, '倒转后应轮到甲（乙自己被跳过）');
  assert.strictEqual(g.players[1].itemsUsed, 1, '计入使用者的道具次数');
  assert.strictEqual(g.lastWord, 'abler', '待接词不变');
  // 关键：接龙规则不变 —— 仍然按"末尾 2 字母"接
  var ok = g.submitChain('erlow');
  assert.ok(ok.ok, '反转后接龙规则不变，erlow 仍能接 abler');
  assert.strictEqual(g.turn, 2, '继续倒转：0 → 2（丙）');
});

t('道具-反转卡: 再用一次可恢复正序', function () {
  var g = new R.Game(itemFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }, { name: '丙', type: 'human' }]);
  g.submitStart('abler');
  g.useItem('reverse');                          // 乙：1 → 0，反序生效
  assert.strictEqual(g.turn, 0);
  var r2 = g.useItem('reverse');                 // 甲：再按一次 → 恢复正序，0 → 1
  assert.ok(r2.ok);
  assert.strictEqual(g.reverseTurn, false, '应恢复正序');
  assert.strictEqual(g.turn, 1, '恢复正序后 0 → 1');
});

t('道具-反转卡: 效果跨轮保留', function () {
  var g = new R.Game(itemFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.submitStart('abler');
  g.useItem('reverse');
  g.concede('测试'); g.newRound();
  assert.strictEqual(g.reverseTurn, true, '换轮后反转仍生效（本局内持续）');
});

t('道具: countWords 计入"代打的词"、排除纯道具日志（甲算、乙不算）', function () {
  var chain = [
    { kind: 'start', word: 'a' }, { kind: 'chain', word: 'b' },
    { kind: 'item', item: 'skip' },                    // 纯道具日志：不是词，不数
    { kind: 'chain', byItem: 'swap', word: 'c' }       // 修改卡代打的词：计入接龙长度
  ];
  assert.strictEqual(R.countWords(chain), 3, '跳过卡不算词；修改卡代打的词计 1');
  // 前端靠 byItem 把"代打的词"排除在"你出过的词"之外（记录 / 生词表）
  var mine = chain.filter(function (e) { return !e.byItem && (e.kind === 'start' || e.kind === 'chain'); });
  assert.strictEqual(mine.length, 2, '"你出的词"应排除 byItem 条目');
});

/* ---- 禁止回声（用户反馈：xxxlar → 对手回 lar，生僻却能接，像在偷懒）---- */
t('禁止回声: isEcho 判定', function () {
  assert.strictEqual(R.isEcho('apple', 'le'), true, '末尾2字母');
  assert.strictEqual(R.isEcho('apple', 'ple'), true, '末尾3字母');
  assert.strictEqual(R.isEcho('apple', 'lemon'), false);
  assert.strictEqual(R.isEcho('apple', 'ap'), false, '不是末尾');
  assert.strictEqual(R.isEcho('apple', 'apple'), false, '长度>3 不可能是回声');
  assert.strictEqual(R.isEcho('am', 'am'), true, '整词即末尾2字母');
});

t('禁止回声: 只有 strictEcho（联机房间）才拦，其它模式放行', function () {
  // 默认（人机对战 / 本地同屏）：允许回声
  assert.strictEqual(R.canChain('apple', 'le').ok, true, '非房间模式应允许回声');
  assert.strictEqual(R.canChain('abarticular', 'lar').ok, true, '非房间模式允许回声');
  // 联机房间（strictEcho）：拦
  var r1 = R.canChain('apple', 'le', { strictEcho: true });
  assert.strictEqual(r1.ok, false, '房间模式应拒绝回声');
  assert.ok(/结尾/.test(r1.reason), '原因应说明不能拿结尾当词, 实际: ' + r1.reason);
  var r2 = R.canChain('abarticular', 'lar', { strictEcho: true });
  assert.strictEqual(r2.ok, false, 'lar 是 abarticular 的末尾，应被拒');
  var r3 = R.canChain('abarticular', 'large', { strictEcho: true });
  assert.strictEqual(r3.ok, true, 'large 以 lar 开头但不是回声，应放行');
  var r4 = R.canChain('abate', 'ate', { strictEcho: true });
  assert.strictEqual(r4.ok, false, 'ate 是 abate 的末尾，应被拒');
});

t('禁止回声: candidates() 在 strictEcho 下不再把回声列为可接词', function () {
  var v = new R.WordStore([
    { w: 'abler', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 },
    { w: 'er', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 },
    { w: 'erlow', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 }
  ]);
  var plain = v.candidates('abler', null).map(function (x) { return x.w; });
  assert.ok(plain.indexOf('er') !== -1, '非房间模式：回声词应可接');
  var strict = v.candidates('abler', null, { strictEcho: true }).map(function (x) { return x.w; });
  assert.strictEqual(strict.indexOf('er'), -1, '房间模式：回声词不应出现在可接列表');
  assert.ok(strict.indexOf('erlow') !== -1, '非回声词应保留');
});

t('禁止回声: 房间模式下提交回声词被拒且不加分', function () {
  var v = new R.WordStore([
    { w: 'abler', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 },
    { w: 'er', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 },
    { w: 'erlow', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5 }
  ]);
  var g = new R.Game(v, [{ name: '我', type: 'human' }]);
  g.mode = 'room';                      // 只有房间模式才拦回声
  g.submitStart('abler');
  var before = g.players[0].points;
  var r = g.submitChain('er');
  assert.strictEqual(r.ok, false, '房间模式下回声词应被拒');
  assert.strictEqual(g.lastWord, 'abler', '待接词不应改变');
  assert.strictEqual(g.players[0].points, before, '被拒不应加分');
  // 同样条件下非房间模式应放行
  var g2 = new R.Game(v, [{ name: '我', type: 'human' }]);
  g2.submitStart('abler');
  assert.ok(g2.submitChain('er').ok, '非房间模式（人机/同屏/离线）应允许回声');
});

/* ---- 回声门控：高频词允许回声，生僻词不允许（用户要求）---- */
t('回声门控: isTrustedEntry 判定（柯林斯≥1 / f≥0.65 / 有精讲）', function () {
  assert.strictEqual(R.isTrustedEntry({ w: 'x', collins: 1 }), true);
  assert.strictEqual(R.isTrustedEntry({ w: 'x', collins: 0, f: 0.7 }), true);
  assert.strictEqual(R.isTrustedEntry({ w: 'x', collins: 0, f: 0.2, has_note: true }), true);
  assert.strictEqual(R.isTrustedEntry({ w: 'x', collins: 0, f: 0.3 }), false, '生僻词不可信');
  assert.strictEqual(R.isTrustedEntry({ w: 'x' }), false);
  assert.strictEqual(R.isTrustedEntry(null), true, '词库外的词不拦回声');
  assert.strictEqual(R.ECHO_KEEP_F, 0.65);
});

t('回声门控: 房间模式下高频词放行、生僻词拦截', function () {
  assert.strictEqual(R.canChain('into', 'to').ok, true, '非房间模式：一律放行');
  assert.strictEqual(R.canChain('into', 'to', { strictEcho: true, echoOk: true }).ok, true, '房间模式：高频词放行');
  assert.strictEqual(R.canChain('into', 'to', { strictEcho: true }).ok, false, '房间模式：未标 echoOk 的回声拦截');
  assert.strictEqual(R.canChain('into', 'tonic', { strictEcho: true }).ok, true, '非回声词不受影响');
});

t('回声门控: 房间模式下 candidates() 放行高频回声词、拦掉生僻回声词', function () {
  // 高频回声词（le 是 able 的末尾 2 字母，但 collins=5 → 可信）→ 放行
  var v1 = new R.WordStore([
    { w: 'able', zh: 'x', d: 1, f: 0.9, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 3 },
    { w: 'le', zh: 'x', d: 1, f: 0.9, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 5 },
    { w: 'lemon', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 0 }
  ]);
  var ws1 = v1.candidates('able', null, { strictEcho: true }).map(function (x) { return x.w; });
  assert.ok(ws1.indexOf('le') !== -1, '高频回声词应放行');
  assert.ok(ws1.indexOf('lemon') !== -1, '非回声词应保留');

  // 生僻回声词（lar 是 abarticular 的末尾 3 字母，但无佐证且 f 低）→ 拦掉
  var v2 = new R.WordStore([
    { w: 'abarticular', zh: 'x', d: 1, f: 0.9, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 3 },
    { w: 'lar', zh: 'x', d: 1, f: 0.3, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 0 },
    { w: 'large', zh: 'x', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 0 }
  ]);
  var ws2 = v2.candidates('abarticular', null, { strictEcho: true }).map(function (x) { return x.w; });
  assert.strictEqual(ws2.indexOf('lar'), -1, '生僻回声词应被拦（用户抱怨的偷懒招）');
  assert.ok(ws2.indexOf('large') !== -1, '非回声词应保留');
});

/* ---- AI 裁判（验词）---- */
function refereeFixture() {
  return new R.WordStore([
    { w: 'abler', zh: '可开局的词', d: 1, f: 0.9, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 3 },
    { w: 'erlow', zh: '生僻接龙词', d: 1, f: 0.3, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 0 },
    { w: 'erup', zh: '另一个词', d: 1, f: 0.5, kind: 0.9, has_succ: true, chain_idx: 0.5, collins: 0 }
  ]);
}
// 假裁判：一律判可疑，从而不依赖真实词库的阈值
function alwaysSuspect(game, pi, entry) {
  if (!entry) return null;
  return {
    playerIdx: pi, playerName: game.players[pi].name, word: entry.w,
    options: ['选项A', '选项B', '选项C', '以上都不对'], answerIdx: 1,
    correctZh: '选项B', reasons: ['测试']
  };
}

t('AI 裁判: 可疑出词会暂停本轮等作答（回合不推进）', function () {
  var g = new R.Game(refereeFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.aiReferee = alwaysSuspect;
  var s = g.submitStart('abler');
  assert.ok(s.verify, '可疑开局词应触发验词');
  assert.ok(g.verify, 'game.verify 应已挂上');
  assert.strictEqual(g.turn, 0, '等作答期间回合不推进');
  assert.strictEqual(g.lastWord, 'abler', '词本身已被接受（接龙会继续）');
  assert.strictEqual(g.verify.options.length, 4, '应是四选一（3 释义 + 以上都不对）');
  assert.strictEqual(g.verify.options[3], '以上都不对');
});

t('AI 裁判: 答错扣 1 分且接龙继续；答对不扣', function () {
  // 答错
  var g = new R.Game(refereeFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.aiReferee = alwaysSuspect;
  g.submitStart('abler');
  var pts0 = g.players[0].points;
  var bad = (g.verify.answerIdx + 1) % g.verify.options.length;
  var r = g.answerVerify(bad);
  assert.strictEqual(r.correct, false, '应判为答错');
  assert.strictEqual(r.penalty, R.VERIFY_WRONG_PENALTY);
  assert.strictEqual(g.players[0].points, pts0 - R.VERIFY_WRONG_PENALTY, '应扣 1 分');
  assert.strictEqual(g.verify, null, '作答后清空验词');
  assert.strictEqual(g.turn, 1, '接龙继续（回合推进到乙）');
  assert.ok(g.log.some(function (e) { return e.kind === 'verify' && e.correct === false; }), '日志应记录验词结果');

  // 答对
  var g2 = new R.Game(refereeFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g2.aiReferee = alwaysSuspect;
  g2.submitStart('abler');
  var pts2 = g2.players[0].points;
  var r2 = g2.answerVerify(g2.verify.answerIdx);
  assert.strictEqual(r2.correct, true);
  assert.strictEqual(r2.penalty, 0);
  assert.strictEqual(g2.players[0].points, pts2, '答对不扣分');
  assert.strictEqual(g2.turn, 1, '接龙继续');
});

t('AI 裁判: 未作答时不能继续出词；无效选项被拒', function () {
  var g = new R.Game(refereeFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.aiReferee = alwaysSuspect;
  g.submitStart('abler');
  assert.ok(g.verify, '应有待作答的验词');
  assert.strictEqual(g.answerVerify(99).error ? true : false, true, '越界选项应被拒');
  assert.strictEqual(g.answerVerify(-1).error ? true : false, true, '负数选项应被拒');
  assert.ok(g.verify, '无效作答不应清空题目');
  // 引擎层面：验词期间再次提交应被 gameplay 层拦住（此处直接验证 answerVerify 后回合才推进）
  var r = g.answerVerify(g.verify.answerIdx);
  assert.ok(r.ok);
  assert.strictEqual(g.turn, 1);
});

t('AI 裁判: 无验词时作答返回错误；换轮清空未作答的题', function () {
  var g = new R.Game(refereeFixture(), [{ name: '甲', type: 'human' }]);
  assert.ok(g.answerVerify(0).error, '没有验词时应报错');
  // 换轮清空
  var g2 = new R.Game(refereeFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g2.aiReferee = alwaysSuspect;
  g2.submitStart('abler');
  assert.ok(g2.verify);
  g2.concede('测试'); g2.newRound();
  assert.strictEqual(g2.verify, null, '换轮应清掉未作答的验词');
});

t('AI 裁判: 钩子返回 null 时不触发（常用词不受影响）', function () {
  var g = new R.Game(refereeFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  g.aiReferee = function () { return null; };
  var s = g.submitStart('abler');
  assert.ok(!s.verify, '不应触发验词');
  assert.strictEqual(g.verify, null);
  assert.strictEqual(g.turn, 1, '回合正常推进');
});

t('AI 裁判: 未注入钩子时完全不介入（离线/旧行为）', function () {
  var g = new R.Game(refereeFixture(), [{ name: '甲', type: 'human' }, { name: '乙', type: 'human' }]);
  var s = g.submitStart('abler');
  assert.ok(!s.verify && !g.verify, '没有裁判钩子时不该有验词');
  assert.strictEqual(g.turn, 1);
});

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
