/* 服务端 API/引擎集成测试：node test/api-test.js
 * 需要 data/db.json 已生成（build_unified_db.py）。
 * 直接使用 server.js 导出的对象（内存态），无需开端口。
 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');

if (!fs.existsSync(path.join(__dirname, '..', 'data', 'db.json'))) {
  console.log('未找到 data/db.json，请先运行: python tools/build_unified_db.py');
  process.exit(2);
}

var S = require('../server.js');
var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' => ' + e.message); }
}

t('词库已加载且规模合理', function () {
  assert.ok(S.store.list.length > 30000, '词条数应>30000, 实际 ' + S.store.list.length);
});

t('单词查询与知识点字段', function () {
  var e = S.store.lookup('apple');
  assert.ok(e, 'apple 应在词库');
  // 词库词应带 zh
  assert.ok(e.zh && e.zh.length > 0, 'apple 应有中文释义');
  assert.ok('d' in e && 'f' in e, '应含 difficulty(d) 与 常见度(f)');
});

var game;
t('createGame 人机', function () {
  game = S.createGame([{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
  assert.ok(game);
});

t('doAction start 与快照', function () {
  var out = S.doAction(game, 'start', 'apple', false);
  assert.ok(out.ok, 'start 应成功');
  var snap = S.snapshot(game, 's1', out.lastAI, out.pending);
  assert.strictEqual(snap.log[0].word, 'apple', '第一条日志应是玩家开局 apple');
  assert.ok(snap.log.length >= 2, 'AI 应自动回应, 日志>=2');
  assert.ok(snap.lastWord && snap.lastWord !== 'apple', 'lastWord 应是 AI 的接龙词');
});

t('AI 自动接龙(防疲劳+难度匹配)', function () {
  // 玩家开局 apple 后，doAction 内部会自动推进 AI
  var game2 = S.createGame([{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
  var out = S.doAction(game2, 'start', 'apple', false);
  assert.ok(out.ok, 'start 成功');
  var snap = S.snapshot(game2, 's1', out.lastAI, out.pending);
  assert.ok(snap.lastWord, '应产生新词(AI已回应)');
  assert.ok(snap.allUsedCount >= 2, '防疲劳集合应累积(玩家+AI词), 实际 ' + snap.allUsedCount);
  assert.ok(snap.log.length >= 2, '日志应>=2');
});

t('非词库词: 返回 pending', function () {
  var g = S.createGame([{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]);
  S.doAction(g, 'start', 'apple', false);
  var out = S.doAction(g, 'chain', 'leyo', false); // 以le开头, 满足规则, 但不在词库
  assert.ok(out && out.pending && out.pending.word === 'leyo', '非词库词应进入待确认');
});

t('知识点: 有 note 的词携带 note/has_note', function () {
  // 找一个带精讲的词
  var w = null;
  for (var i = 0; i < S.dbVocab.length; i++) {
    if (S.dbVocab[i].has_note) { w = S.dbVocab[i].w; break; }
  }
  assert.ok(w, '应存在至少一个带精讲的词');
  var g = S.createGame([{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]);
  var out = S.doAction(g, 'start', w, false);
  assert.ok(out.ok);
  var snap = S.snapshot(g, 's2', out.lastAI, out.pending);
  var entry = snap.log[snap.log.length - 1];
  assert.strictEqual(entry.has_note, true, '该词应 has_note');
  assert.ok(entry.note && entry.note.length > 0, '应有 note 文本');
});

t('常态防疲劳: 持久化 继承历史 + 记录新词', function () {
  S.resetUsage();
  var g1 = S.createGame([{ name: 'A', type: 'human' }, { name: 'AI', type: 'ai' }]);
  S.seedUsage(g1);
  var out = S.doAction(g1, 'start', 'apple', false);
  assert.ok(out.ok, 'start 成功');
  S.recordUsage(g1, 0);   // 记录 apple + AI词
  var u = S.globalUsage();
  assert.ok(u['apple'] >= 1, 'apple 应被持久化记录');
  var before = Object.keys(u).length;

  // 新局应继承历史使用（常态化防疲劳）
  var g2 = S.createGame([{ name: 'A', type: 'human' }, { name: 'AI', type: 'ai' }]);
  S.seedUsage(g2);
  assert.ok(Object.keys(g2.allUsed).length >= before, '新局 allUsed 应继承历史');
  assert.ok(g2.allUsed['apple'], '新局 allUsed 应含 apple');
  S.resetUsage();   // 清理测试污染
});

t('探索·发现: interestingStarts 有词且满足有趣条件', function () {
  var ints = S.store.interestingStarts({});
  assert.ok(ints.length > 1000, '应有大量有趣开局词, 实际 ' + ints.length);
  var e = ints[0];
  assert.ok(e.has_note, '应带知识点');
  assert.ok(e.d >= 2 && e.d <= 8, '难度应适中');
  assert.notStrictEqual(e.has_succ, false, '不应是死路');
});

t('探索·发现: explore 模式 AI 先手给出有趣开局词', function () {
  var g = S.createGame([{ name: '人', type: 'human' }, { name: 'AI', type: 'ai' }]);
  g.explore = true; g.starter = 1; g.turn = 1;
  var r = g.tickAI();
  assert.ok(r && r.action === 'start', '探索模式 AI 应先开局');
  assert.ok(g.lastWord, '应有开局词');
  var e = S.store.lookup(g.lastWord);
  assert.ok(e && e.has_note, '开局词应带知识点(有趣)');
  assert.strictEqual(g.turn, 0, 'AI 开局后应轮到玩家');
});

t('AI 认输: 暂停待确认 + continue-round 进入下一轮', function () {
  var W = S.R.WordStore, G = S.R.Game;
  var small = new W([
    { w: 'able', zh: 'x', d: 1, f: 0.5, has_succ: true, chain_idx: 0.5, kind: 0.9 },
    { w: 'lemon', zh: 'x', d: 1, f: 0.5, has_succ: true, chain_idx: 0.5, kind: 0.9 }
  ]);
  var g = new G(small, [{ name: '人', type: 'human' }, { name: 'AI', type: 'ai' }]);
  var out = S.doAction(g, 'start', 'lemon', false);   // 人类开局 lemon, AI 无词可接
  assert.ok(out.aiConceded === true, 'AI 应认输并暂停待确认');
  assert.strictEqual(g.roundActive, false, '回合应暂停');
  var snap = S.snapshot(g, 's', out.lastAI, out.pending, out.aiConceded);
  assert.strictEqual(snap.aiConceded, true, '快照应标记 aiConceded');

  var out2 = S.doAction(g, 'continue-round', null, false);   // 玩家确认继续
  assert.ok(out2.ok, 'continue-round 应成功');
  var snap2 = S.snapshot(g, 's', out2.lastAI, out2.pending, out2.aiConceded);
  assert.strictEqual(snap2.aiConceded, false, '继续后清除 aiConceded');
  assert.ok(g.roundActive, '新回合开始');
});

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
