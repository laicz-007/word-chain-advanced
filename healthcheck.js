/* healthcheck.js — 部署后健康检查（自测全流程）
 * 用法：node healthcheck.js [端口]      # 默认 8080，或 PORT 环境变量
 * 说明：对"已运行的服务器"发起真实 HTTP 请求，走完 人机 + 联机 全流程，
 *       逐项打印 ✅/❌，最后自动清理测试账号并给出结论。
 * 退出码：0=全部通过，1=有失败（供 CI/systemd 判断）。
 */
'use strict';
var fs = require('fs');
var path = require('path');

var PORT = Number(process.argv[2] || process.env.PORT || 8080);
var BASE = 'http://127.0.0.1:' + PORT;

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } }
function post(p, b) { return fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); }
function get(p) { return fetch(BASE + p).then(function (r) { return r.json(); }); }

(async function () {
  console.log('='.repeat(46));
  console.log('单词接龙 · 部署健康检查  目标: ' + BASE);
  console.log('='.repeat(46));

  // 0) 服务器可达 + 首页
  try {
    var home = await fetch(BASE + '/');
    ok('服务器可达，首页 ' + home.status, home.status === 200);
    var html = await home.text();
    ok('首页含登录页', html.indexOf('login-card') !== -1);
    ok('首页含联机房间入口', html.indexOf('value="online"') !== -1);
  } catch (e) {
    ok('服务器可达', false);
    console.log('\n❌ 无法连接服务器，请确认：');
    console.log('  1) 服务已启动（node server.js 或 systemd）');
    console.log('  2) 端口是 ' + PORT + '（可用 `node healthcheck.js 端口号` 指定）');
    console.log('  3) 防火墙已放行');
    finish();
    return;
  }

  var stem = 'hc' + Math.random().toString(36).slice(2, 8);
  var A = stem + '_a', B = stem + '_b';

  // 1) 注册 / 登录
  var regA = await post('/api/register', { username: A, password: 'pass1234' });
  ok('注册账号 A', regA.ok && !!regA.token);
  var regB = await post('/api/register', { username: B, password: 'pass1234' });
  ok('注册账号 B', regB.ok && !!regB.token);
  if (!regA.ok || !regB.ok) { finish(); return; }

  ok('重复注册被拒', !!(await post('/api/register', { username: A, password: 'pass1234' })).error);
  ok('错误密码被拒', !!(await post('/api/login', { username: A, password: 'wrong' })).error);
  ok('正确密码登录成功', (await post('/api/login', { username: A, password: 'pass1234' })).ok === true);

  // 2) 密码散列（不明文）
  var usersFile = path.join(__dirname, 'data', 'users.json');
  var u = JSON.parse(fs.readFileSync(usersFile, 'utf8'))[A];
  ok('密码为加盐散列(非明文)', u && !u.password && typeof u.salt === 'string' && typeof u.hash === 'string');

  // 3) 人机：登录开局绑定账户 + 画像
  var pve = await post('/api/start', { token: regA.token, playerArray: [{ name: 'p', type: 'human' }, { name: 'AI', type: 'ai' }] });
  ok('人机开局返回会话', pve && !!pve.sessionId);
  ok('人机开局绑定账户', pve && pve.account === A);
  ok('人机开局返回画像', pve && pve.profile != null);
  var a1 = await post('/api/action', { sessionId: pve.sessionId, kind: 'start', word: 'cat' });
  ok('人机出词成功', a1 && !a1.error && a1.log && a1.log.length >= 1);

  // 4) 联机全流程
  var cr = await post('/api/room/create', { token: regA.token });
  ok('创建房间(6位)', cr.ok && /^\d{6}$/.test(cr.roomId));
  if (!cr.ok) { finish(); return; }
  var rid = cr.roomId;
  ok('加入房间', (await post('/api/room/join', { token: regB.token, roomId: rid })).ok);
  ok('非房主开局被拒', !!(await post('/api/room/start', { token: regB.token, roomId: rid })).error);
  ok('房主开局成功', (await post('/api/room/start', { token: regA.token, roomId: rid })).ok);

  var stA = await get('/api/room/state?token=' + regA.token + '&roomId=' + rid);
  var stB = await get('/api/room/state?token=' + regB.token + '&roomId=' + rid);
  ok('开局后轮到房主 A', stA.status === 'playing' && stA.myTurn === true);
  ok('开局后 B 非当前回合', stB.myTurn === false);

  var mA = await post('/api/room/action', { token: regA.token, roomId: rid, kind: 'start', word: 'cat' });
  ok('A 开局出词', mA.ok);
  ok('A 越回合被拒', !!(await post('/api/room/action', { token: regA.token, roomId: rid, kind: 'chain', word: 'atom' })).error);
  var mB = await post('/api/room/action', { token: regB.token, roomId: rid, kind: 'chain', word: 'atom' });
  ok('B 正常接龙', mB.ok);
  ok('房主终止对局', (await post('/api/room/terminate', { token: regA.token, roomId: rid })).ok);
  ok('房主解散房间', (await post('/api/room/dissolve', { token: regA.token, roomId: rid })).ok);

  // 5) 安全：路径穿越 / 伪造 token
  var tr = await fetch(BASE + '/%2e%2e/%2e%2e/server.js');
  ok('路径穿越被拒(非200)', tr.status !== 200);
  ok('伪造 token 被拒', !!(await get('/api/me?token=forged.token.abc')).error);

  finish();

  function finish() {
    // 清理测试账号
    try {
      var all = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      [A, B].forEach(function (n) { delete all[n]; });
      fs.writeFileSync(usersFile, JSON.stringify(all), 'utf8');
      [A, B].forEach(function (n) { try { fs.unlinkSync(path.join(__dirname, 'data', 'sync', n + '.json')); } catch (e) {} });
    } catch (e) {}
    console.log('='.repeat(46));
    console.log('结果：' + pass + ' 通过, ' + fail + ' 失败');
    if (fail === 0) {
      console.log('🎉 全部通过，服务可上线。');
    } else {
      console.log('⚠️  存在失败项，请按上面 ❌ 排查。');
    }
    console.log('='.repeat(46));
    process.exit(fail ? 1 : 0);
  }
})();
