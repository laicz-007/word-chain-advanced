'use strict';
/* 账号系统集成测试：注册/登录/账户注入/存档/读取/修改密码 */
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

  /* ---- 修改密码 ---- */
  var cpNoAuth = await post('/api/change-password', { token: 'garbage', oldPassword: 'pass1234', newPassword: 'newpass99' });
  check('改密: 未登录被拒', !!cpNoAuth.error);
  var cpBadOld = await post('/api/change-password', { token: token, oldPassword: 'wrongpass', newPassword: 'newpass99' });
  check('改密: 原密码错误被拒', !!cpBadOld.error);
  var cpShort = await post('/api/change-password', { token: token, oldPassword: 'pass1234', newPassword: '12' });
  check('改密: 新密码过短被拒', !!cpShort.error);
  var cpSame = await post('/api/change-password', { token: token, oldPassword: 'pass1234', newPassword: 'pass1234' });
  check('改密: 新旧密码相同被拒', !!cpSame.error);
  var cpBadOldStill = await post('/api/login', { username: uname, password: 'pass1234' });
  check('改密失败后原密码仍可登录', cpBadOldStill.ok && !!cpBadOldStill.token);

  var cp = await post('/api/change-password', { token: token, oldPassword: 'pass1234', newPassword: 'newpass99' });
  check('改密成功并返回新 token', cp.ok && !!cp.token && cp.username === uname);

  var oldTokenMe = await get('/api/me?token=' + encodeURIComponent(token));
  check('改密后旧 token 立即失效', !!oldTokenMe.error);
  var newTokenMe = await get('/api/me?token=' + encodeURIComponent(cp.token));
  check('改密后新 token 可用', newTokenMe.ok && newTokenMe.username === uname);
  var oldPwLogin = await post('/api/login', { username: uname, password: 'pass1234' });
  check('改密后旧密码无法登录', !!oldPwLogin.error);
  var newPwLogin = await post('/api/login', { username: uname, password: 'newpass99' });
  check('改密后新密码可登录', newPwLogin.ok && !!newPwLogin.token);

  /* ---- 积分系统 ---- */
  var ptsName = 'test_p' + String(Date.now()).slice(-8);   // 注意用户名上限 20 字符
  var preg = await post('/api/register', { username: ptsName, password: 'pass1234' });
  check('积分: 测试账户注册成功', preg.ok === true && !!preg.token);
  var ptoken = preg.token;
  var pme0 = await get('/api/me?token=' + encodeURIComponent(ptoken));
  check('积分: 新账户 0 分且道具库存为空', pme0.points === 0 && pme0.items && Object.keys(pme0.items).length === 0);

  var pst = await post('/api/start', { token: ptoken, playerArray: [{ name: 'a', type: 'human' }, { name: 'AI', type: 'ai' }] });
  var pact = await post('/api/action', { sessionId: pst.sessionId, kind: 'start', word: 'apple' });
  check('积分: 动作响应回传账户积分', pact.accountPoints === srv.POINTS.perWord);
  check('积分: 快照含各方本局积分', Array.isArray(pact.players) && pact.players[0].points >= srv.POINTS.perWord);
  var pme1 = await get('/api/me?token=' + encodeURIComponent(ptoken));
  check('积分: 已持久化到账户', pme1.points === srv.POINTS.perWord);

  // 结算幂等性：同一局反复结算只写一次增量（否则积分会翻倍膨胀）
  var pg = srv.createGame([{ name: 'p', type: 'human' }, { name: 'AI', type: 'ai' }]);
  pg.user = ptsName;
  pg.submitStart('apple');
  check('积分结算: 首次结算写入增量', srv.points.credit(pg) === srv.POINTS.perWord);
  check('积分结算: 重复调用不重复加分', srv.points.credit(pg) === 0);
  check('积分结算: 账户积分正确累加', srv.loadUserData(ptsName).points === srv.POINTS.perWord * 2);

  // 游客/未登录对局不产生任何积分写入
  var gg = srv.createGame([{ name: '游客甲', type: 'human' }, { name: 'AI', type: 'ai' }]);
  gg.submitStart('apple');
  check('积分结算: 游客对局不写账户', srv.points.credit(gg) === 0);

  /* ---- 道具商店 ---- */
  var sme = await get('/api/shop?token=garbage');
  check('道具: 未登录不能查看商店', !!sme.error);
  var shop = await get('/api/shop?token=' + encodeURIComponent(ptoken));
  check('道具: 商店目录含三种卡且价格合法',
    shop.ok === true && shop.catalog.length === 3 &&
    shop.catalog.every(function (i) { return i.price > 0; }) &&
    shop.catalog.map(function (i) { return i.kind; }).sort().join(',') === 'reverse,skip,swap');
  check('道具: 商店返回每局上限', shop.quota === srv.R.ITEM_QUOTA);

  var poorBuy = await post('/api/shop/buy', { token: ptoken, item: 'skip' });
  check('道具: 积分不足时购买失败', !!poorBuy.error);

  var pd = srv.loadUserData(ptsName); pd.points = 100; srv.saveUserData(ptsName);
  var buy = await post('/api/shop/buy', { token: ptoken, item: 'skip' });
  check('道具: 购买成功并扣积分、加库存', buy.ok === true && buy.points === 70 && buy.items.skip === 1);

  var buyBad = await post('/api/shop/buy', { token: ptoken, item: '__nope__' });
  check('道具: 未知道具不可购买', !!buyBad.error);
  var buyUnknown = await post('/api/shop/buy', { token: ptoken, item: '__nope__' });
  check('道具: 未知道具不可购买', !!buyUnknown.error);

  var meItems = await get('/api/me?token=' + encodeURIComponent(ptoken));
  check('道具: me 反映库存与积分', meItems.items.skip === 1 && meItems.points === 70);

  /* ---- 道具使用（走完整服务端路径：模式校验 → 登录校验 → 库存校验 → 引擎 → 扣减）---- */
  // 用单人局，避免 AI 回合/认输带来的不确定性
  var ig = srv.createGame([{ name: 'p', type: 'human' }]);
  ig.user = ptsName;
  ig.mode = 'room';                            // 道具只在联机房间可用
  ig.submitStart('apple');
  var useNoInv = srv.doAction(ig, 'item', null, false, 'swap');
  check('道具: 没有库存时使用被拒', !!useNoInv.error && /没有/.test(useNoInv.error));

  // 非房间模式不允许用道具（用户确认：人机对战只挣分、不能用道具）
  var igPve = srv.createGame([{ name: 'p', type: 'human' }]);
  igPve.user = ptsName;                        // mode 默认 'pve'
  igPve.submitStart('apple');
  var usePve = srv.doAction(igPve, 'item', null, false, 'skip');
  check('道具: 人机对战模式不允许使用道具', !!usePve.error && /联机房间/.test(usePve.error));

  var igGuest = srv.createGame([{ name: '游客', type: 'human' }]);
  igGuest.mode = 'room';
  igGuest.submitStart('apple');
  var useGuest = srv.doAction(igGuest, 'item', null, false, 'skip');
  check('道具: 游客使用道具被拒（需登录）', !!useGuest.error && /登录/.test(useGuest.error));

  var okUse = srv.doAction(ig, 'item', null, false, 'skip');
  check('道具: 有库存时使用成功并扣减库存',
    !okUse.error && okUse.itemEffect && okUse.itemEffect.effect === 'skip' &&
    (srv.loadUserData(ptsName).items.skip || 0) === 0);

  var useAgain = srv.doAction(ig, 'item', null, false, 'skip');
  check('道具: 用完后再次使用被拒', !!useAgain.error && /没有/.test(useAgain.error));

  // AI 裁判答错 → 账户积分跟着扣（结算改为双向）
  var pBeforeV = srv.loadUserData(ptsName).points;
  var vg = srv.createGame([{ name: 'p', type: 'human' }]);
  vg.user = ptsName;
  vg.players[0].points = 5;
  srv.points.credit(vg);
  var afterCredit = srv.loadUserData(ptsName).points;
  vg.players[0].points = 4;                    // 模拟 AI 裁判答错扣 1 分
  var d2 = srv.points.credit(vg);
  check('AI 裁判: 答错扣分计入账户（双向结算）',
    afterCredit === pBeforeV + 5 && d2 === -1 && srv.loadUserData(ptsName).points === afterCredit - 1);

  // 清理测试账户
  try {
    var usersFile = path.join(__dirname, '..', 'data', 'users.json');
    var users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    Object.keys(users).forEach(function (u) { if (u.indexOf('test_') === 0) delete users[u]; });
    fs.writeFileSync(usersFile, JSON.stringify(users));
  } catch (e) {}
  try {
    var syncDir = path.join(__dirname, '..', 'data', 'sync');
    fs.readdirSync(syncDir).forEach(function (f) {
      if (f.indexOf('test_') === 0) { try { fs.unlinkSync(path.join(syncDir, f)); } catch (e) {} }
    });
  } catch (e) {}

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();