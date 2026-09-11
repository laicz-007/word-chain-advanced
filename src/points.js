/* src/points.js — 把对局中累积的积分结算到账户（幂等）
 *
 * 对局里各玩家的积分（game.players[i].points）由共用引擎 logic.js 累加；
 * 本模块负责在合适的时机把它写进账户文件。设计要点：
 *
 *  1) 幂等：记录"每个座位已结算到多少分"（game._credited），只结算增量。
 *     所以每次 /api/action 后调用都安全，不会重复加分。
 *  2) 归属（谁的积分算到哪个账户）：
 *     - 本地同屏勾了"统计我的出词" → 只有 myPlayerIdx 那一位结算到对局账户
 *     - 联机房间 → 玩家名就是用户名，各自结算到自己的账户
 *     - 人机对战 → 昵称未必是用户名，人类玩家的积分归到该对局绑定的账户
 *  3) 只处理真实存在的账户（auth.hasUser），游客/未登录一律跳过。
 */
'use strict';
var auth = require('./auth');
var userdata = require('./userdata');

// 返回该座位应结算到的用户名，或 null（不结算）
function ownerOf(game, p, i) {
  if (game.mode === 'local') return null;   // 本地同屏不结算积分（用户确认：同一台设备自己玩，不挣分）
  if (game.myPlayerIdx != null) return (i === game.myPlayerIdx) ? (game.user || null) : null;
  if (auth.hasUser(p.name)) return p.name;
  if (game.user && p.type === 'human') return game.user;
  return null;
}

// 结算增量积分，返回本次实际写入的分数（跨所有账户求和）
function credit(game) {
  if (!game || !game.players) return 0;
  if (!game._credited) game._credited = Object.create(null);
  var total = 0;
  game.players.forEach(function (p, i) {
    var uname = ownerOf(game, p, i);
    if (!uname || !auth.hasUser(uname)) return;
    var done = game._credited[i] || 0;
    var cur = p.points || 0;
    var delta = cur - done;
    // 双向结算：AI 裁判答错会扣分（负增量），账户也要跟着扣，否则惩罚只停留在界面显示上
    if (delta !== 0) {
      userdata.addPoints(uname, delta);
      game._credited[i] = cur;
      total += delta;
    }
  });
  return total;
}

module.exports = { credit: credit, ownerOf: ownerOf };
