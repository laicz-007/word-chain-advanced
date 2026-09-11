/* src/config.js — 路径与常量（服务端单一配置入口） */
'use strict';
var path = require('path');

var ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT: ROOT,
  PUBLIC: path.join(ROOT, 'public'),
  DATA: path.join(ROOT, 'data'),
  DB_PATH: path.join(ROOT, 'data', 'db.json'),              // 成品词库（npm run build 的第 3 步产出）
  USAGE_FILE: path.join(ROOT, 'data', 'usage.json'),
  USERS_FILE: path.join(ROOT, 'data', 'users.json'),
  SYNC_DIR: path.join(ROOT, 'data', 'sync'),
  SECRET_FILE: path.join(ROOT, 'data', '.secret'),
  PORT: Number(process.env.PORT || 8080),
  TOKEN_TTL: 30 * 24 * 3600 * 1000, // 登录 token 有效期 30 天
  MIME: {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  }
};