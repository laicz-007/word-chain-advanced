/* 读取 hard_ends_report.json, 输出人类可读的双辅音清单(分组) */
'use strict';
var fs = require('fs');
var path = require('path');
var rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'hard_ends_report.json'), 'utf8'));

var byMN = {};
rep.words.forEach(function (x) { (byMN[x.mn] = byMN[x.mn] || []).push(x); });

var lines = [];
lines.push('# 难接双辅音结尾清单（判据 = 每个词真正可接的词数 reach，含 2 字母 MNxxx 与 3 字母 XMNxxx 两种开头）');
lines.push('');
lines.push('统计：双辅音结尾词 = ' + rep.summary.doubleConsonantWords +
  '；DEAD(无词可接) = ' + rep.summary.deadEndWords +
  '；HARD(<=1词可接) = ' + rep.summary.hardWords +
  '；三辅音结尾 = ' + rep.summary.cc3Words);
lines.push('');

var mns = Object.keys(byMN);
mns.sort(function (a, b) {
  var da = byMN[a].filter(function (x) { return x.reach === 0; }).length;
  var db = byMN[b].filter(function (x) { return x.reach === 0; }).length;
  var ha = byMN[a].filter(function (x) { return x.reach <= 1; }).length;
  var hb = byMN[b].filter(function (x) { return x.reach <= 1; }).length;
  if (db - da !== 0) return db - da;
  return hb - ha;
});

mns.forEach(function (mn) {
  var arr = byMN[mn];
  var dead = arr.filter(function (x) { return x.reach === 0; });
  var hard = arr.filter(function (x) { return x.reach > 0 && x.reach <= 1; });
  var reach2 = arr[0].reach2;
  if (dead.length + hard.length === 0) return; // 只列有难接词的结尾
  lines.push('## 结尾 "' + mn + '"   (末尾词 ' + arr.length + ' 个 | DEAD ' + dead.length + ' | HARD ' + hard.length + ')');
  function show(list, tag) {
    if (!list.length) return;
    var items = list.slice(0, 8).map(function (x) { return x.w; });
    var more = list.length - 8;
    lines.push('   [' + tag + '] ' + items.join(', ') + (more > 0 ? ('  …（共' + list.length + '个）') : ''));
  }
  show(dead, '死路');
  show(hard, '难接');
});

var out = lines.join('\n');
console.log(out);
