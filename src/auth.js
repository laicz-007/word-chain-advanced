/* src/auth.js — 账号：注册/登录/退出 + 密码散列 + HMAC token */
'use strict';
var fs = require('fs');
var crypto = require('crypto');
var config = require('./config');

// 用户表 { username: { salt, hash, createdAt } }（空原型，避免 "__proto__" 等用户名污染原型）
var users = Object.create(null);
try { users = Object.assign(Object.create(null), JSON.parse(fs.readFileSync(config.USERS_FILE, 'utf8'))); } catch (e) { users = Object.create(null); }
function persistUsers() { try { fs.writeFileSync(config.USERS_FILE, JSON.stringify(users), 'utf8'); } catch (e) {} }

// token 签名密钥（自生成并持久化，重启不失效）
var SECRET = '';
try { SECRET = fs.readFileSync(config.SECRET_FILE, 'utf8').trim(); } catch (e) {}
if (!SECRET || SECRET.length < 16) {
  SECRET = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(config.SECRET_FILE, SECRET, 'utf8'); } catch (e) {}
}

// 密码散列（scrypt 加盐，不存明文）
function hashPw(password, salt) { return crypto.scryptSync(String(password), salt, 64).toString('hex'); }
function makeUser(name, password) { var salt = crypto.randomBytes(16).toString('hex'); return { salt: salt, hash: hashPw(password, salt), createdAt: Date.now() }; }
function verifyPw(user, password) {
  try {
    var a = Buffer.from(user.hash, 'hex');
    var b = Buffer.from(hashPw(password, user.salt), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

// token：HMAC 签名（无状态），语义 = username + 过期时间
function signToken(b64) { return crypto.createHmac('sha256', SECRET).update(b64).digest('hex'); }
function makeToken(name) {
  var p = { u: name, exp: Date.now() + config.TOKEN_TTL };
  var b = Buffer.from(JSON.stringify(p)).toString('base64url');
  return b + '.' + signToken(b);
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  var i = token.lastIndexOf('.'); if (i <= 0) return null;
  var b = token.slice(0, i), sig = token.slice(i + 1);
  if (signToken(b) !== sig) return null;
  try {
    var p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (!p || !p.u || Date.now() > p.exp) return null;
    return p.u;
  } catch (e) { return null; }
}

function validUsername(name) { return typeof name === 'string' && /^[A-Za-z0-9_-]{2,20}$/.test(name); }
function validPassword(pw) { return typeof pw === 'string' && pw.length >= 4 && pw.length <= 64; }
function hasUser(name) { return !!users[name]; }

module.exports = {
  users: users,
  persistUsers: persistUsers,
  hashPw: hashPw,
  makeUser: makeUser,
  verifyPw: verifyPw,
  makeToken: makeToken,
  verifyToken: verifyToken,
  validUsername: validUsername,
  validPassword: validPassword,
  hasUser: hasUser
};