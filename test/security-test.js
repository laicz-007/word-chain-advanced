'use strict';
/* 安全测试：密码不明文 / 路径穿越 / token 伪造 / 原型污染 / 继承属性词 / 房间号校验 */
var fs = require('fs');
var path = require('path');
var srv = require('../server.js');
var PORT = 8202;
var BASE = 'http://127.0.0.1:' + PORT;

var pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function post(p, b) { return fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); }
function get(p) { return fetch(BASE + p).then(function (r) { return r.json(); }); }
function getStatus(p) { return fetch(BASE + p).then(function (r) { return r.status; }); }

(async function () {
  await new Promise(function (res) { srv.start(PORT); setTimeout(res, 250); });
  var uname = 'sec' + Math.random().toString(36).slice(2, 8);
  var usersFile = path.join(__dirname, '..', 'data', 'users.json');

  /* 1) 密码不明文 + 加盐散列 */
  var reg = await post('/api/register', { username: uname, password: 'secret-pass' });
  check('注册成功', reg.ok && !!reg.token);
  var u = JSON.parse(fs.readFileSync(usersFile, 'utf8'))[uname];
  check('账户不含明文密码字段', u && u.password === undefined);
  check('密码为 加盐散列(salt+hash)', u && typeof u.salt === 'string' && typeof u.hash === 'string' && u.hash !== 'secret-pass');

  /* 2) 登录校验 */
  check('错误密码被拒', !!(await post('/api/login', { username: uname, password: 'wrong' })).error);
  check('正确密码登录成功', (await post('/api/login', { username: uname, password: 'secret-pass' })).ok === true);

  /* 3) token 伪造/无效 */
  check('伪造 token 被拒', !!(await get('/api/me?token=forged.token.abc')).error);
  check('无 token 查 me 被拒', !!(await get('/api/me')).error);

  /* 4) 路径穿越（编码 .. / \ 被解码后应被拒） */
  check('路径穿越 %2e%2e 被拒', (await getStatus('/%2e%2e/%2e%2e/server.js')) !== 200);
  check('路径穿越 %2f 被拒', (await getStatus('/..%2f..%2f/server.js')) !== 200);

  /* 5) 房间号非 6 位数字被拒 */
  check('房间号 __proto__ 被拒', !!(await post('/api/room/join', { token: reg.token, roomId: '__proto__' })).error);
  check('房间号过短被拒', !!(await post('/api/room/join', { token: reg.token, roomId: '123' })).error);

  /* 6) "__proto__" 用户名不污染原型 */
  await post('/api/register', { username: '__proto__', password: 'x123456' });
  check('注册 __proto__ 后 Object.prototype 未被污染', ({}).polluted === undefined && Object.prototype.polluted === undefined);

  /* 7) 继承属性词 "constructor" 可正常开局(修复普通对象键撞原型) */
  var e = srv.store.lookup('constructor');
  check('词 constructor 在词库', !!e);
  var g = srv.createGame([{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]);
  var out = srv.doAction(g, 'start', 'constructor', false);
  check('constructor 可被接受为开局词', out && !out.error);

  /* 清理 */
  try {
    var users2 = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    [uname, '__proto__'].forEach(function (n) { delete users2[n]; });
    fs.writeFileSync(usersFile, JSON.stringify(users2));
    [uname, '__proto__'].forEach(function (n) { try { fs.unlinkSync(path.join(__dirname, '..', 'data', 'sync', n + '.json')); } catch (e) {} });
  } catch (e) {}

  try { srv.server.close(); } catch (e) {}
  setTimeout(function () {
    console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  }, 120);
})();