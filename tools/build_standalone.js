/* build_standalone.js — 把整个游戏打包成一个可直接双击打开的单文件 HTML
 * 内嵌：词库数据 + 规则/AI 引擎 + 本地引擎 + 前端 + 全部样式(原版+3主题)。
 * 产出：word-chain-standalone.html
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

var base = read('public/index.html');
var baseCss = read('public/style.css');
var loginCss = read('public/login.css');
var themes = ['theme-claude.css', 'theme-gradient.css', 'theme-own.css'].map(function (f) {
  return { f: f, css: read('public/' + f) };
});
var logic = read('public/logic.js');
var local = read('tools/localengine.js');
var app = read('public/app.js');
var dbRaw = fs.readFileSync(path.join(ROOT, 'data', 'db.lite.json'), 'utf8');   // 离线单文件用轻量词库(3.6万), 保持双击秒开; 服务器版用全量 data/db.json

// 处理 </script> 安全（理论上无，保险起见替换为转义形式）
var dbJs = dbRaw.replace(/<\/script/gi, '<\\/script');

// 样式块：基础常开 + 登录页 + 主题(默认禁用,切换)
var styleBlock = '<style>\n' + baseCss + '\n</style>\n<style>\n' + loginCss + '\n</style>\n';
themes.forEach(function (t) { styleBlock += '<style data-theme-file="' + t.f + '" disabled>\n' + t.css + '\n</style>\n'; });

// 脚本块：数据 -> 引擎 -> 本地引擎 -> 应用
var scriptBlock =
  '<script>window.__DB__=' + dbJs + ';</script>\n' +
  '<script>\n' + logic + '\n</script>\n' +
  '<script>\n' + local + '\n</script>\n' +
  '<script>\n' + app + '\n</script>';

// 替换 外部样式/脚本 为内联
base = base.replace(/<link rel="stylesheet" href="style\.css" \/>\s*<link id="theme-style" rel="stylesheet" href="" \/>/, styleBlock);
base = base.replace(/<script src="app\.js"><\/script>/, scriptBlock);

// 移除对已内联资源的任何残留引用
base = base.replace(/<link rel="stylesheet" href="[^"]+" \/>/g, '');
base = base.replace(/<script src="[^"]+"><\/script>/g, '');

var out = path.join(ROOT, 'word-chain-standalone.html');
fs.writeFileSync(out, base, 'utf8');
console.log('已生成: ' + out);
console.log('  大小: ' + (fs.statSync(out).size / 1024 / 1024).toFixed(2) + ' MB');
