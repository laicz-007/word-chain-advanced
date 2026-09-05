'use strict';
/* 本地同屏"统计我的出词"测试：
 * A) usage.js 防疲劳按 myPlayerIdx 只记本人词（游客全局 / 账户同逻辑）
 * B) /api/start 接受 myPlayerIdx 且非法值忽略 */
var fs = require('fs');
var path = require('path');
var S = require('../server.js');
var PORT = 8201;
var BASE = 'http://127.0.0.1:' + PORT;

var pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function post(p, b) { return fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); }

// 打一轮 3 词：P0 cat → P1 atom → P0 omit
function playRound(g) {
  S.doAction(g, 'start', 'cat', false);
  S.doAction(g, 'chain', 'atom', false);
  S.doAction(g, 'chain', 'omit', false);
}

(async function () {
  /* A) 直接测 usage 过滤 */
  var g1 = S.createGame([{ name: 'P1', type: 'human' }, { name: 'P2', type: 'human' }]);
  g1.myPlayerIdx = 0;            // 我是 P1(下标0)
  S.resetUsage();
  playRound(g1);
  S.recordUsage(g1, 0);
  var u1 = S.globalUsage();
  check('追踪: 只记我的词(cat/omit)', u1['cat'] >= 1 && u1['omit'] >= 1);
  check('追踪: 不记别人的词(atom)', u1['atom'] === undefined);

  var g2 = S.createGame([{ name: 'P1', type: 'human' }, { name: 'P2', type: 'human' }]);
  S.resetUsage();
  playRound(g2);                 // 不设 myPlayerIdx(未勾选"统计我的出词")
  S.recordUsage(g2, 0);
  var u2 = S.globalUsage();
  check('不追踪: 全屏词都算(与旧行为一致)', u2['cat'] >= 1 && u2['atom'] >= 1 && u2['omit'] >= 1);

  /* B) /api/start 接受 myPlayerIdx(有效/越界) */
  await new Promise(function (res) { S.start(PORT); setTimeout(res, 250); });
  var uname = 'tt' + Math.random().toString(36).slice(2, 8);
  var reg = await post('/api/register', { username: uname, password: 'pass1234' });
  var st = await post('/api/start', { token: reg.token, myPlayerIdx: 1, playerArray: [{ name: 'P1', type: 'human' }, { name: 'P2', type: 'human' }] });
  check('start 带 myPlayerIdx=1 正常开局', !st.error && !!st.sessionId);
  var a1 = await post('/api/action', { sessionId: st.sessionId, kind: 'start', word: 'cat' });
  check('追踪开局后仍可正常出词', a1 && !a1.error);
  var st2 = await post('/api/start', { token: reg.token, myPlayerIdx: 99, playerArray: [{ name: 'P1', type: 'human' }, { name: 'P2', type: 'human' }] });
  check('start 越界 myPlayerIdx=99 忽略不报错', !st2.error && !!st2.sessionId);

  /* 清理 */
  try {
    var uf = path.join(__dirname, '..', 'data', 'users.json');
    var users = JSON.parse(fs.readFileSync(uf, 'utf8'));
    delete users[uname];
    fs.writeFileSync(uf, JSON.stringify(users));
    try { fs.unlinkSync(path.join(__dirname, '..', 'data', 'sync', uname + '.json')); } catch (e) {}
  } catch (e) {}
  S.resetUsage();
  try { S.server.close(); } catch (e) {}
  setTimeout(function () {
    console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  }, 120);
})();