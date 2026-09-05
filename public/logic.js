/*!
 * 单词接龙 核心规则引擎 + 人机难度匹配 AI
 * 纯逻辑模块：不依赖 DOM，可在浏览器与 Node 中运行。
 *
 * 规则要点（与用户确认）：
 *  - 规则1：新词开头2字母 = 上词末尾2字母，或 开头3字母 = 上词末尾3字母。
 *           任一方长度 < 3 时，只考虑 2 字母匹配。
 *  - 规则2：结尾3字母（不足3取全部）必须含元音 a e i o u y。
 *  - 规则3：不能以 ry / fh 结尾。
 *  - 规则4：长度 >= 2。
 *  - 规则5：同一轮内单词不得重复；认输后下一轮清空重复判定。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WCRules = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VOWELS = 'aeiouy';

  function normalize(w) {
    return String(w == null ? '' : w).trim().toLowerCase();
  }

  function isAlphaLower(w) {
    return /^[a-z]+$/.test(w);
  }

  function lastN(w, n) {
    return w.length <= n ? w : w.slice(-n);
  }

  // 规则2：结尾最多3个字母（不足3取全部）必须含1个元音
  function hasVowelEnding(w) {
    var tail = lastN(w, 3);
    for (var i = 0; i < tail.length; i++) {
      if (VOWELS.indexOf(tail.charAt(i)) !== -1) return true;
    }
    return false;
  }

  // 规则3：数据驱动的"常见却难接"禁止结尾 ry / ht / ck（fh 已删除）
  function forbiddenEnding(w) {
    return /(ry|ht|ck)$/.test(w);
  }

  // 规则4：长度 >= 2
  function satisfiesMinLength(w) {
    return w.length >= 2;
  }

  // 规则1：单词是否跟得上 prev
  function matches(prev, word) {
    if (prev.length < 2 || word.length < 2) return false;
    // 2 字母匹配
    if (word.indexOf(prev.slice(-2)) === 0) return true;
    // 3 字母匹配（仅当两级都 >= 3 时）
    if (prev.length >= 3 && word.length >= 3) {
      if (word.indexOf(prev.slice(-3)) === 0) return true;
    }
    return false;
  }

  // 开局词校验：需满足规则2、3、4 且长度 >= 3
  function canStart(raw) {
    var w = normalize(raw);
    if (!isAlphaLower(w)) return { ok: false, reason: '只接受英文单词（纯字母）。' };
    if (w.length < 3) return { ok: false, reason: '开局词至少要有 3 个字母。' };
    if (w.length < 2) return { ok: false, reason: '单词至少要有 2 个长度。' };
    if (!hasVowelEnding(w)) return { ok: false, reason: '结尾 3 个字母必须含有 1 个元音（a e i o u y）。' };
    if (forbiddenEnding(w)) return { ok: false, reason: '不能以 ry / ht / ck 结尾。' };
    return { ok: true, word: w };
  }

  // 接龙词校验：需满足规则1、2、3、4
  function canChain(rawPrev, rawWord) {
    var prev = normalize(rawPrev);
    var w = normalize(rawWord);
    if (!isAlphaLower(w)) return { ok: false, reason: '只接受英文单词（纯字母）。' };
    if (!satisfiesMinLength(w)) return { ok: false, reason: '单词至少要有 2 个长度。' };
    if (!matches(prev, w)) {
      // 短词(长度<3)只有 2 字母匹配，避免报"用 A 或 A 开头"的重复废话
      var p2 = prev.slice(-2);
      if (prev.length < 3) {
        return { ok: false, reason: '需以「' + p2 + '」开头。' };
      }
      return { ok: false, reason: '需以「' + p2 + '」或「' + prev.slice(-3) + '」开头。' };
    }
    if (!hasVowelEnding(w)) return { ok: false, reason: '结尾 3 个字母必须含有 1 个元音（a e i o u y）。' };
    if (forbiddenEnding(w)) return { ok: false, reason: '不能以 ry / ht / ck 结尾。' };
    return { ok: true, word: w };
  }

  /* ---- 词库存储器 ---- */
  function WordStore(vocab) {
    this.byWord = Object.create(null);   // 空原型：避免 "constructor"/"__proto__" 等词撞上继承属性
    this.by2 = Object.create(null);
    this.by3 = Object.create(null);
    this.list = [];
    this.startable = [];                // 预计算：可开局词(fast path)
    this.interesting = [];              // 预计算："有趣"开局词(fast path)
    for (var i = 0; i < vocab.length; i++) {
      var e = vocab[i];
      var w = normalize(e.w);
      e.w = w;
      if (/[^a-z]/.test(w) || w.length < 2) continue;
      this.list.push(e);
      this.byWord[w] = e;               // 重复词条后者覆盖（数据已去重，见 tools/sort_db.js）
      var p2 = w.slice(0, 2);
      (this.by2[p2] = this.by2[p2] || []).push(e);
      if (w.length >= 3) {
        var p3 = w.slice(0, 3);
        (this.by3[p3] = this.by3[p3] || []).push(e);
      }
    }
    for (var j = 0; j < this.list.length; j++) {
      var x = this.list[j];
      if (canStart(x.w).ok) this.startable.push(x);
      if (isInterestingStart(x)) this.interesting.push(x);
    }
  }

  // "有趣"开局词的静态条件(与 used 无关的部分)
  function isInterestingStart(e) {
    if (e.has_succ === false) return false;
    if (!e.has_note) return false;
    if ((e.kind != null ? e.kind : 0.9) < 0.5) return false;
    if ((e.d != null ? e.d : 5) < 2 || (e.d != null ? e.d : 5) > 8) return false;
    if ((e.chain_idx != null ? e.chain_idx : 0) < 0.15) return false;
    return true;
  }

  WordStore.prototype.lookup = function (raw) {
    return this.byWord[normalize(raw)] || null;
  };

  WordStore.prototype.candidates = function (rawPrev, used) {
    var prev = normalize(rawPrev);
    var out = [];
    var seen = {};
    var pushSet, i, e;

    pushSet = function (arr) {
      for (i = 0; i < arr.length; i++) {
        e = arr[i];
        if (seen[e.w]) continue;
        seen[e.w] = true;
        out.push(e);
      }
    };

    if (prev.length >= 2 && this.by2[prev.slice(-2)]) pushSet(this.by2[prev.slice(-2)]);
    if (prev.length >= 3 && this.by3[prev.slice(-3)]) pushSet(this.by3[prev.slice(-3)]);

    return out.filter(function (e) {
      if (used && used[e.w]) return false;
      return canChain(prev, e.w).ok;
    });
  };

  WordStore.prototype.sampleStarts = function (used) {
    var res = [];
    var src = this.startable;   // 预计算列表：只过滤已用词，避免每轮重复 canStart 全表扫描
    for (var i = 0; i < src.length; i++) {
      var e = src[i];
      if (used && used[e.w]) continue;
      res.push(e);
    }
    return res;
  };

  // "探索·发现"用：随机挑一个"比较有趣"的开局词
  // 条件：可开局 + 非死路 + 有知识点 + 词型分正常(非缩写/人名) + 难度适中 + 可接性尚可
  WordStore.prototype.interestingStarts = function (used) {
    var res = [];
    var src = this.interesting; // 预计算列表：只过滤已用词
    for (var i = 0; i < src.length; i++) {
      var e = src[i];
      if (used && used[e.w]) continue;
      res.push(e);
    }
    return res;
  };

  /* ---- 选词评分：硬门禁 + 加权软分 × 随机 ---- */
  // 权重(可调)：S1防疲劳 / S2难度贴合 / S3词频 / S4可接指数
  // 说明：把 chainIdx 从 0.30 略降到 0.24(减少"唯好接"), 热度给 diff/freq 增加选词多样性; 防疲劳保持高强度
  var AI_WEIGHTS = { fatigue: 0.30, diff: 0.23, freq: 0.23, chainIdx: 0.24 };
  var AI_DIV = { window: 10, penalty: 0.10, floor: 0.55 };  // 结尾多样化激励参数
  var TEACH_NEW = 0.18;  // 教学导向：优先喂"含知识点且你未见过的新词"的加成

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  // 统计 recentEnds(最近喂给玩家的结尾, 最近在末) 中某结尾出现次数
  function countEnd(recentEnds, end) {
    var n = 0;
    for (var i = 0; i < recentEnds.length; i++) if (recentEnds[i] === end) n++;
    return n;
  }

  // 对候选列表打分并返回最优(或 null)。usage: 会话使用次数(word->count), target: 玩家目标难度(null则中性)
  // ctx: { recentEnds: [...最近AI喂给玩家的结尾] } 用于结尾多样化激励
  function scorePick(cands, usage, target, ctx) {
    ctx = ctx || {};
    var recentEnds = ctx.recentEnds || [];
    var scored = [];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var kind = (c.kind != null ? c.kind : 0.9);
      // 硬门禁1：死路(has_succ===false)
      if (c.has_succ === false) continue;
      // 硬门禁2：纯缩写/碎片(kind<=0.05) 不出现在 AI 选词里
      if (kind < 0.06) continue;
      var cnt = (usage && usage[c.w]) || 0;
      var S1 = Math.pow(0.5, cnt);                                  // 防疲劳: 没用过=1
      var S2 = (target == null) ? 0.5 : Math.max(0, 1 - Math.abs((c.d || 5) - target) / 10); // 难度贴合
      var S3 = clamp01(c.f || 0);                                   // 词频
      var S4 = clamp01(c.chain_idx != null ? c.chain_idx : ((c.kind != null ? c.kind : 0.5) * 0.5)); // 可接指数
      // 对可接指数做非线性饱和：墙(低值)仍压到很低, 但避免对"高产带"(0.8~0.95)过度拉开, 减小带状集中
      S4 = clamp01(Math.pow(S4, 0.7));
      var soft = AI_WEIGHTS.fatigue * S1 + AI_WEIGHTS.diff * S2 + AI_WEIGHTS.freq * S3 + AI_WEIGHTS.chainIdx * S4;
      // 词型惩罚：专名/地名/人名(kind=0.10) 大幅降权(但仍可选)
      if (kind < 0.90) soft = soft * (0.30 + 0.70 * (kind / 0.90));
      // 结尾多样化：这个候选的结尾若最近已被 AI 频繁喂给玩家, 则降权 —— 逼它换开头
      var end = c.w.length >= 2 ? c.w.slice(-2) : c.w;
      var endCnt = countEnd(recentEnds, end);
      var S6 = Math.max(AI_DIV.floor, 1 - AI_DIV.penalty * endCnt);
      soft = soft * S6;
      // 教学导向：优先喂"含知识点且你没见过"的新词, 帮你在玩中学
      if (ctx.profile && ctx.profile.hasData && c.has_note && !ctx.profile.knownSet[c.w]) {
        soft = soft * (1 + TEACH_NEW);
      }
      var S5 = 0.93 + 0.14 * Math.random();                         // 随机因子 [0.93,1.07]
      scored.push({ c: c, score: soft * S5 });
    }
    if (!scored.length) return null;
    var best = scored[0];
    for (var j = 1; j < scored.length; j++) {
      if (scored[j].score > best.score) best = scored[j];
    }
    return best.c;
  }

  // 接龙选词：prev 上词；usedRound 本轮已用(规则5硬性)；usage 会话使用次数(防疲劳软性)；target 玩家目标难度
  function aiChoose(store, rawPrev, usedRound, usage, target, ctx) {
    return scorePick(store.candidates(rawPrev, usedRound), usage, target, ctx);
  }

  /* ---- 用户学习画像（离线端：localengine 读取 localStorage 后调用）----
   * data = { games:[{words:[{word,d,playerIdx}], stats:{total,avgD,bestChain}}],
   *          usage:{word:count}, seen:[words], best:number }
   * 产出全方位画像：难度舒适区 skill / 已知词 known / 结尾→接词习惯 endingWords /
   *                薄弱结尾 weakEndings / 知识面 noteSeen / 接龙长度。
   */
  function computeUserProfile(store, data) {
    data = data || {};
    var games = data.games || [];
    var usage = data.usage || {};
    var seen = data.seen || [];
    var best = data.best || 0;
    var knownSet = Object.create(null), knownCount = 0;
    var dSum = 0, dCnt = 0, noteSeen = 0;
    Object.keys(usage).forEach(function (w) {
      var c = usage[w] || 0; if (c <= 0) return;
      knownSet[w] = 1; knownCount++;
      var e = store.lookup(w);
      if (e) { dSum += (e.d || 5) * c; dCnt += c; if (e.has_note) noteSeen++; }
    });
    // 难度舒适区：主要看用过的词(按次数加权) + 局平均难度
    var skill = dCnt ? (dSum / dCnt) : 5;
    var bestChain = best || 0, totalLens = 0, gAvgD = 0, gAvgN = 0, nGames = 0;
    games.forEach(function (g) {
      nGames++;
      var st = g.stats || {};
      if (st.bestChain && st.bestChain > bestChain) bestChain = st.bestChain;
      totalLens += (st.total || (g.words ? g.words.length : 0));
      if (st.avgD) { gAvgD += st.avgD; gAvgN++; }
    });
    var avgChain = nGames ? (totalLens / nGames) : 0;
    if (gAvgN) skill = 0.6 * skill + 0.4 * (gAvgD / gAvgN);
    // 接龙越长水平越高
    if (bestChain >= 20) skill += 1.2;
    else if (bestChain >= 12) skill += 0.6;
    else if (bestChain >= 8) skill += 0.3;
    skill = Math.max(1, Math.min(10, Math.round(skill)));

    // 结尾→接词习惯：从每局接龙序列提取"某结尾被接成了什么词"
    var endingWords = Object.create(null), userEndingWords = Object.create(null);
    games.forEach(function (g) {
      var ws = (g.words || []);
      for (var i = 1; i < ws.length; i++) {
        var prev = (ws[i - 1] || {}).word, cur = (ws[i] || {}).word;
        if (!prev || !cur) continue;
        if (!matches(prev, cur)) continue;
        var end = prev.length >= 2 ? prev.slice(-2) : prev;
        (endingWords[end] = endingWords[end] || {})[cur] = (endingWords[end][cur] || 0) + 1;
        // 归属判断(以浏览器为"一个人"): 非 AI 玩家的词都算用户; 旧记录无 playerType 时退化为 playerIdx===0
        var curPl = ws[i] || {};
        var isUser = curPl.playerType != null ? (curPl.playerType !== 'ai') : (curPl.playerIdx === 0);
        if (isUser) {
          (userEndingWords[end] = userEndingWords[end] || {})[cur] = (userEndingWords[end][cur] || 0) + 1;
        }
      }
    });
    // 薄弱结尾：用户/整体接法"不同词很少"的结尾(且非死路)
    var weakEndings = [];
    Object.keys(endingWords).forEach(function (end) {
      var picks = userEndingWords[end] && Object.keys(userEndingWords[end]).length
        ? userEndingWords[end] : endingWords[end];
      var distinct = Object.keys(picks).length;
      if (distinct <= 2) weakEndings.push(end);
    });

    return {
      skill: skill, hasData: dCnt >= 8,
      knownSet: knownSet, knownCount: knownCount,
      endingWords: endingWords, userEndingWords: userEndingWords,
      weakEndings: weakEndings, noteSeen: noteSeen,
      bestChain: bestChain, avgChain: avgChain, games: nGames
    };
  }

  /* ---- 游戏状态机 ---- */
  // players: [{name, type:'human'|'ai'}]
  function Game(store, players) {
    this.store = store;
    this.players = players.map(function (p, i) {
      return {
        name: p.name,
        type: p.type,
        score: 0,
        recent: [] // {w, d} 最近5个词库词 (供AI匹配难度)
      };
    });
    this.turn = 0;
    this.starter = 0;
    this.lastWord = null;
    this.lastWordOwner = -1;
    this.used = Object.create(null);
    this.round = 1;
    this.roundActive = true;
    this.log = [];
    this.chain = []; // 本轮接龙词（每轮清空），用于接龙面板
    this.allUsed = Object.create(null); // 会话级全时段已用计数(防疲劳软性，跨轮累计，换局才清空)
    this.aiEnds = [];  // 最近 AI 喂给玩家的结尾(末2字母), 用于结尾多样化激励
    this.profile = null; // 用户学习画像(离线端由 localengine 注入), 用于难度贴合+教学导向
    this.explore = false; // 探索·发现：AI 随机给有趣的初始词
  }

  Game.prototype.addLog = function (entry) {
    entry.at = this.log.length;
    this.log.push(entry);
    return entry;
  };

  Game.prototype.currentPlayer = function () {
    return this.players[this.turn];
  };

  // 当前回合需要的是“开局词”还是“接龙词”
  Game.prototype.needsStart = function () {
    return this.lastWord == null;
  };

  // AI 的目标难度 = 融合(用户学习画像 skill, 本局最近词均值)
  // 画像为主(持久), 本局最近词为辅 —— 不再只停留在最近5个词
  Game.prototype.aiTarget = function () {
    var arr = [];
    for (var i = 0; i < this.players.length; i++) {
      var pl = this.players[i];
      if (pl.type === 'ai') continue;
      for (var j = 0; j < pl.recent.length; j++) {
        arr.push(pl.recent[j].d);
      }
    }
    var recent = arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null;
    if (this.profile && this.profile.hasData) {
      var s = Number(this.profile.skill);
      if (recent == null) return s;
      return 0.70 * s + 0.30 * recent;   // 持久画像为主
    }
    return recent;
  };

  Game.prototype.pushRecent = function (playerIdx, word) {
    var pl = this.players[playerIdx];
    var e = this.store.lookup(word);
    if (!e) return; // 非词库词不计入难度统计
    pl.recent.push({ w: e.w, d: e.d });
    if (pl.recent.length > 5) pl.recent.shift();
  };

  Game.prototype.startNextTurn = function () {
    this.turn = (this.turn + 1) % this.players.length;
  };

  // 提交开局词
  Game.prototype.submitStart = function (raw, opts) {
    opts = opts || {};
    var res = canStart(raw);
    if (!res.ok) return { ok: false, reason: res.reason };
    var w = res.word;
    var pl = this.currentPlayer();
    var inVocab = !!this.store.lookup(w);

    if (this.used[w]) return { ok: false, reason: '本回合已出现过这个词。' };

    // 非词库词：先提示用户确认，再决定是否接受
    if (!inVocab && !opts.confirmed) {
      return { ok: false, pending: 'non-vocab', word: w, reason: '「' + w + '」不在词库中，不计入难度统计，请确认是否使用。' };
    }

    this.used[w] = true;
    this.allUsed[w] = (this.allUsed[w] || 0) + 1;
    this.lastWord = w;
    this.lastWordOwner = this.turn;
    this.pushRecent(this.turn, w);

    this.chain.push(this.addLog({
      kind: 'start',
      player: pl.name,
      playerIdx: this.turn,
      playerType: pl.type,
      word: w,
      zh: inVocab ? this.store.lookup(w).zh : '',
      d: inVocab ? this.store.lookup(w).d : null,
      f: inVocab ? this.store.lookup(w).f : null,
      inVocab: inVocab,
      note: inVocab ? '' : '（不在词库中，不计入难度统计）'
    }));

    this.startNextTurn();
    return { ok: true, word: w, inVocab: inVocab };
  };

  // 提交接龙词（人类玩家调用）
  Game.prototype.submitChain = function (raw, opts) {
    opts = opts || {};
    if (this.needsStart()) return { ok: false, reason: '当前需要先给出开局词。' };
    var res = canChain(this.lastWord, raw);
    if (!res.ok) return { ok: false, reason: res.reason };
    var w = res.word;
    var pl = this.currentPlayer();

    if (this.used[w]) return { ok: false, reason: '本回合已出现过这个词，不能重复。' };

    var inVocab = !!this.store.lookup(w);
    // 非词库词：先提示用户确认，再决定是否接受
    if (!inVocab && !opts.confirmed) {
      return { ok: false, pending: 'non-vocab', word: w, reason: '「' + w + '」不在词库中，不计入难度统计，请确认是否使用。' };
    }

    this.used[w] = true;
    this.allUsed[w] = (this.allUsed[w] || 0) + 1;
    this.lastWord = w;
    this.lastWordOwner = this.turn;
    this.pushRecent(this.turn, w);

    this.chain.push(this.addLog({
      kind: 'chain',
      player: pl.name,
      playerIdx: this.turn,
      playerType: pl.type,
      word: w,
      zh: inVocab ? this.store.lookup(w).zh : '',
      d: inVocab ? this.store.lookup(w).d : null,
      f: inVocab ? this.store.lookup(w).f : null,
      inVocab: inVocab,
      note: inVocab ? '' : '（不在词库中，不计入难度统计）'
    }));

    this.startNextTurn();
    return { ok: true, word: w, inVocab: inVocab };
  };

  // 认输 / AI 无词可接。返回本轮得分与新的 starter。
  Game.prototype.concede = function (reason) {
    var loser = this.currentPlayer();
    // 上一个成功出词的人得分
    var scorer = this.lastWordOwner >= 0 ? this.lastWordOwner : -1;

    if (scorer >= 0 && scorer !== this.turn) {
      this.players[scorer].score += 1;
    } else if (scorer >= 0 && scorer === this.turn) {
      // 理论上不会发生；保险起见不计分
    }

    this.addLog({
      kind: 'concede',
      player: loser.name,
      playerIdx: this.turn,
      scorer: scorer >= 0 ? this.players[scorer].name : null,
      scorerIdx: scorer,
      reason: reason || '认输'
    });

    // 认输方成为下一轮的开局者
    this.starter = this.turn;
    this.turn = this.starter;
    this.roundActive = false;
    return { player: loser.name, scorer: scorer >= 0 ? this.players[scorer].name : null };
  };

  // 开始新一轮
  Game.prototype.newRound = function () {
    this.used = {};
    this.lastWord = null;
    this.lastWordOwner = -1;
    this.turn = this.starter;
    this.round += 1;
    this.roundActive = true;
    this.chain = [];
  };

  // 记录一个"AI 喂给玩家"的结尾(末2字母), 供结尾多样化激励
  Game.prototype.pushAiEnd = function (word) {
    var e = word.length >= 2 ? word.slice(-2) : word;
    this.aiEnds.push(e);
    if (this.aiEnds.length > AI_DIV.window) this.aiEnds.shift();
  };

  // AI 行动：若轮到 AI 且是 AI 回合，自动处理。
  // 返回 null 表示无需处理（不是 AI 回合），否则返回被调用的动作类型。
  Game.prototype.tickAI = function () {
    if (this.roundActive === false) return null;
    var pl = this.currentPlayer();
    if (pl.type !== 'ai') return null;

    if (this.needsStart()) {
      // AI 作为开局者：探索·发现模式随机给有趣的词；否则评分挑一个好开的词
      var target = this.aiTarget();
      var ctx = { recentEnds: this.aiEnds, profile: this.profile };
      var choice;
      if (this.explore) {
        // 探索·发现："有趣"开局词也结合画像 —— 难度贴合 + 优先"含知识点且你未见过"的新词
        var ints = this.store.interestingStarts(this.allUsed);
        if (ints.length) {
          choice = scorePick(ints, this.allUsed, target, ctx);
          if (!choice) choice = ints[Math.floor(Math.random() * ints.length)];
        } else {
          choice = scorePick(this.store.sampleStarts(this.used), this.allUsed, target, ctx);
        }
      } else {
        choice = scorePick(this.store.sampleStarts(this.used), this.allUsed, target, ctx);
      }
      if (!choice) {
        this.concede('AI 无词可开局');
        return 'concede';
      }
      var res = this.submitStart(choice.w);
      this.pushAiEnd(choice.w);
      return { action: 'start', result: res, target: target };
    } else {
      // AI 接龙：本轮已用(硬)+会话使用次数(软防疲劳)
      var target2 = this.aiTarget();
      var cand = aiChoose(this.store, this.lastWord, this.used, this.allUsed, target2, { recentEnds: this.aiEnds, profile: this.profile });
      if (!cand) {
        this.concede('AI 没有合法的接龙词');
        return { action: 'concede' };
      }
      var res2 = this.submitChain(cand.w);
      this.pushAiEnd(cand.w);
      return {
        action: 'chain',
        result: res2,
        target: target2,
        candidate: { w: cand.w, d: cand.d, f: cand.f, chainIdx: cand.chain_idx }
      };
    }
  };

  return {
    normalize: normalize,
    VOWELS: VOWELS,
    lastN: lastN,
    hasVowelEnding: hasVowelEnding,
    forbiddenEnding: forbiddenEnding,
    satisfiesMinLength: satisfiesMinLength,
    matches: matches,
    canStart: canStart,
    canChain: canChain,
    WordStore: WordStore,
    aiChoose: aiChoose,
    scorePick: scorePick,
    computeUserProfile: computeUserProfile,
    Game: Game
  };
});
