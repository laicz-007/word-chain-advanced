'use strict';
/* 账号系统集成测试：注册/登录/账户注入/存档/读取 */
var fs = require('fs');
var path = require('path');
var srv = require('../server.js');
var PORT = 8199;
var BASE = 'http://127.0.0.1:' + PORT;

var pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function post(p, b) { return fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); }
function get(p) { return fetch(BASE + p).then(function (r) { return r.json(); }); }

(async function () {
  await new Promise(function (res) { srv.start(PORT); setTimeout(res, 250); });
  var uname = 'test_' + Date.now();
  var token = '';

  // 注册
  var reg = await post('/api/register', { username: uname, password: 'pass1234' });
  check('注册返回 token+username', reg.ok && !!reg.token && reg.username === uname);
  token = reg.token;
  var reg2 = await post('/api/register', { username: uname, password: 'pass1234' });
  check('重复注册被拒', !!reg2.error);
  var reg3 = await post('/api/register', { username: 'bad name!', password: 'pass1234' });
  check('非法用户名被拒', !!reg3.error);

  // 登录
  var login = await post('/api/login', { username: uname, password: 'pass1234' });
  check('登录成功', login.ok && !!login.token);
  var bad = await post('/api/login', { username: uname, password: 'wrong' });
  check('密码错误被拒', !!bad.error);

  // me 空账户
  var me = await get('/api/me?token=' + encodeURIComponent(token));
  check('me 返回空账户', me.ok && me.username === uname && Array.isArray(me.games) && me.games.length === 0);

  // start 绑定账户 + 正常出词
  var st = await post('/api/start', { token: token, playerArray: [{ name: 'a', type: 'human' }, { name: 'AI', type: 'ai' }] });
  check('start 绑定账户', st.account === uname);
  var a1 = await post('/api/action', { sessionId: st.sessionId, kind: 'start', word: 'bat' });
  check('可开局出词', a1 && !a1.error && a1.log && a1.log.length >= 1);

  // 游客 start 不绑定账户
  var st2 = await post('/api/start', { playerArray: [{ name: 'g', type: 'human' }, { name: 'AI', type: 'ai' }] });
  check('游客 start 无账户', st2.account == null && st2.profile == null);

  // 存档到账户
  var rec = { at: Date.now(), words: [{ word: 'bat', zh: '蝙蝠', phonetic: '', d: 2, playerIdx: 0, playerType: 'human' }], stats: { total: 1, uniq: 1, avgD: 2, bestChain: 1, mode: 'pve', name: 'a' } };
  var rc = await post('/api/record', { token: token, record: rec });
  check('record 存入账户', rc.ok && rc.games.length === 1 && rc.best === 1);
  var me2 = await get('/api/me?token=' + encodeURIComponent(token));
  check('me 反映存档', me2.games.length === 1 && me2.best === 1 && me2.seen.indexOf('bat') >= 0);

  // 无效 token
  var meBad = await get('/api/me?token=garbage');
  check('无效 token 被拒', !!meBad.error);

  // 清理测试账户
  try {
    var usersFile = path.join(__dirname, '..', 'data', 'users.json');
    var users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    Object.keys(users).forEach(function (u) { if (u.indexOf('test_') === 0) delete users[u]; });
    fs.writeFileSync(usersFile, JSON.stringify(users));
  } catch (e) {}
  try { fs.unlinkSync(path.join(__dirname, '..', 'data', 'sync', uname + '.json')); } catch (e) {}

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();