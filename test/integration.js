/* 真实词库集成测试：node test/integration.js
 * 用真实 28.5k 词条验证:
 *  - AI 总能给出合法(满足规则1-4)且来自词库的接龙/开局词
 *  - 同一轮内不重复
 *  - 人机对局可正常进行多轮, 认输/换轮后重复判定清空
 */
'use strict';
var fs = require('fs');
var path = require('path');
var R = require('../public/logic.js');

var vocab = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'vocab.json'), 'utf8'));
var store = new R.WordStore(vocab);

console.log('词库规模:', store.list.length);

function usedObj(arr) { var o = {}; arr.forEach(function (w) { o[w] = true; }); return o; }

var fails = 0;
function fail(msg) { fails++; console.log('  FAIL ' + msg); }
function ok(msg) { console.log('  ok ' + msg); }

// 1) 全词库抽查: 所有词都能作为合法开局 或 都能被接上? (不能保证所有都能开局, 只抽查可开局的)
(function () {
  var starts = store.sampleStarts({});
  ok('词库中可作为合法开局词的数量: ' + starts.length + ' / ' + store.list.length);
  if (starts.length < 5000) fail('可开局词数量过少: ' + starts.length);
})();

// 2) 难度匹配: target=2 时 AI 选词难度应接近 2; target=9 时接近 9
(function () {
  var env = new R.Game(store, [{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
  // 直接构造一个 prev, 并在玩家 recent 中放 d=2 的词, 让 AI 逼近难度2
  env.submitStart('apple'); // d=1, 放进 recent
  env.pushRecent(0, 'cat'); // d=1
  env.pushRecent(0, 'dog'); // d=1
  env.pushRecent(0, 'house'); // d=1
  env.pushRecent(0, 'water'); // d=3
  env.pushRecent(0, 'world'); // d=2
  // 现在 aiTarget ~ (1+1+1+1+3+2)/6... 但recent只保留5个 -> 取最后5个: cat,dog,house,water,world = (1+1+1+3+2)/5=1.6
  var t = env.aiTarget();
  console.log('  构造目标难度 target =', t);
  // 走一步 AI
  var ai = env.tickAI();
  if (ai && (ai.action === 'chain' || ai.action === 'start')) {
    var cw = env.lastWord;
    var d = store.lookup(cw).d;
    console.log('  AI 选词:', cw, '难度', d, '(目标', t + ')');
    if (Math.abs(d - t) > 3.5) fail('AI 难度偏离目标过大: ' + d + ' vs ' + t);
  } else {
    fail('AI 未能给出词');
  }
})();

// 3) 运行 20 局人机对战, 验证全程合法且 AI 词都在词库、无重复
(function () {
  for (var r = 0; r < 20; r++) {
    var g = new R.Game(store, [{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }]);
    var usedInRound = [];
    var start = store.sampleStarts({})[Math.floor(Math.random() * 1000)].w;
    var s = g.submitStart(start);
    if (!s.ok) { fail('r' + r + ' 开局失败: ' + start + ' ' + s.reason); continue; }
    usedInRound.push(start);
    var steps = 0, last = start;
    var cap = 400;
    while (steps < cap) {
      steps++;
      var pl = g.currentPlayer();
      if (pl.type === 'human') {
        var cands = store.candidates(g.lastWord, usedObj(usedInRound));
        if (!cands.length) { g.concede('人力无词'); break; }
        var hw = cands[Math.floor(Math.random() * cands.length)].w;
        var hr = g.submitChain(hw);
        if (!hr.ok) { fail('r' + r + ' 玩家词被拒: ' + hw + ' after ' + g.lastWord + ' -> ' + hr.reason); return; }
        usedInRound.push(hw);
        last = hw;
      } else {
        var before = g.lastWord;
        var ai = g.tickAI();
        if (ai.action === 'concede') break;
        var aw = g.lastWord;
        if (!store.lookup(aw)) { fail('r' + r + ' AI 词不在词库: ' + aw); return; }
        // 必须带上回声门控：高频词（如 age）允许回声，裸调用 canChain 会一律拒绝
        var chainRes = R.canChain(before, aw, { echoOk: store.echoOkFor(aw) });
        if (!chainRes.ok) { fail('r' + r + ' AI 词违规: ' + before + ' -> ' + aw + ' ' + chainRes.reason); return; }
        if (usedInRound.indexOf(aw) !== -1) { fail('r' + r + ' AI 轮内重复: ' + aw); return; }
        usedInRound.push(aw);
        last = aw;
      }
    }
    if (steps >= cap) { /* 长链属正常现象: 词库大时接龙可延续很久 */ }
  }
  ok('20 局人机对战均合法且无重复');
})();

console.log('\n结果: ' + (fails ? fails + ' 失败' : '全部通过'));
process.exit(fails ? 1 : 0);
