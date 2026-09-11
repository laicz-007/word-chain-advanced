# 架构梳理 · word-chain（单词接龙）

> **本文回答"现在是什么样"。** 想知道"该怎么改、按什么顺序改、踩过哪些坑"，看 `WORKFLOW.md`。
> 本文所有依赖关系、行数、耗时都是**实测**得出，不是照着代码想象出来的。
>
> 最近一次全面梳理：2026-09。

---

## 1. 一句话概括

**一个零第三方运行时依赖的 Node.js 单体服务 + 一个薄浏览器前端，共用同一份规则引擎（`public/logic.js`）。**

```
                        ┌──────────────────────────────┐
   浏览器               │  public/logic.js             │   ← 规则与 AI 的唯一真相源
   public/app.js  ──────┤  （UMD：浏览器 / Node 都能加载）│
   public/index.html    └──────────────┬───────────────┘
                                       │ require
   Node 服务端                          ▼
   server.js ──> src/api.js ──> src/rooms.js / src/gameplay.js ──> src/db.js ──> logic.js
                                       │
   Python/Node 构建脚本 ────────────────┘（构建期也用它校验规则，见 §4.2）
```

**技术选型的四个硬约束**（都写在 README 里，不是我的推测）：

| 约束 | 原因 |
|---|---|
| 运行时**零第三方依赖** | 部署简单：`node server.js` 就能跑，`npm install` 都不需要 |
| 词库**由脚本生成**，不入 git | 30 万词 ≈ 96MB，且受多个开源词典许可约束 |
| **零构建**的前端 | 不用打包器：`public/` 直接就是静态文件，浏览器原生加载 |
| 规则引擎**前后端共用一份** | 避免"前端说合法、后端说非法"这类最难查的不一致 |

---

## 2. 运行时架构（分层）

### 2.1 分层图

```
第 0 层  基础
   src/config.js          路径与常量（无任何依赖）
   public/logic.js        规则/AI 引擎（无依赖，UMD 自包含）

第 1 层  数据
   src/db.js         ──> config, logic          加载词库、建 WordStore
   src/auth.js       ──> config                 注册/登录/token
   src/userdata.js   ──> config, db             账户数据 + 学习画像

第 2 层  领域
   src/view.js       ──> db                     快照/提示/AI 说明（组装给前端）
   src/ai.js         ──> auth, db, userdata     AI 裁判（验词）
   src/points.js     ──> auth, userdata         积分结算
   src/usage.js      ──> config, userdata       使用统计

第 3 层  编排
   src/gameplay.js   ──> ai, auth, db, userdata, view       对局编排
   src/rooms.js      ──> ai, db, gameplay, points, userdata, view   联机房间

第 4 层  接口
   src/api.js        ──> 上面 9 个模块            25 个 HTTP 路由
   server.js         ──> 全部 11 个模块           组装根 + 静态文件 + 启动
```

### 2.2 依赖矩阵（实测，被依赖次数）

| 模块 | 被几个文件依赖 | 谁依赖它 |
|---|---|---|
| **`public/logic.js`** | **5** | src/db.js、test/test.js、test/integration.js、tools/compute_chain_idx.js、tools/analyze_hard_ends.js |
| **`src/db.js`** | **8** | server、api、ai、gameplay、rooms、userdata、view、tools/check_db.js |
| `src/userdata.js` | 7 | server、api、ai、gameplay、points、rooms、usage |
| `src/config.js` | 6 | server、api、auth、db、usage、userdata |
| `src/auth.js` | 5 | server、api、ai、gameplay、points |
| `src/view.js` | 4 | server、api、gameplay、rooms |
| `src/gameplay.js` / `src/points.js` / `src/ai.js` | 3 | — |
| `src/rooms.js` / `src/usage.js` | 2 | server、api |

### 2.3 三条关键结论

1. **`public/logic.js` 是全项目耦合中心**（965 行，5 个依赖方，横跨服务端/浏览器/构建工具三种运行环境）。
   它是"规则绝不分叉"的保证，代价是**改它要同时验证三边**。这是设计意图，不是意外。

2. **`src/db.js` 是第二大枢纽**（8 个依赖方）——但它的内容极薄（63 行），只做"加载词库 + 建索引"。
   依赖它的人其实依赖的是"词库对象"，不是它的逻辑。这是健康的。

3. **分层总体是干净的**，只有两处"上穿"（下层反过来被上层用，见 §6.2）。

---

## 3. 数据流

### 3.1 请求链路（玩家出一次词）

```
浏览器 app.js
   │  POST /api/action  {token, word, item, choice}
   ▼
src/api.js           路由分发 + 取 token 对应的账户
   ▼
src/gameplay.js      doAction()：校验轮次 → 调引擎 → 处理"验词"闸门 → 落账
   ▼
public/logic.js      Game.submitChain()：判断接龙合法性（唯一的规则判定点）
   ▼
src/ai.js            （仅联机房间）判断这次出词可不可疑 → 生成四选一验词题
   ▼
src/points.js        结算积分（幂等：game._credited[i]）
   ▼
src/view.js          组装快照（含 AI 说明、专名额度和道具状态）
   ▼
浏览器               渲染
```

### 3.2 构建链路（词库）

```
data/word.csv + word_translation.csv
        │  [1] python tools/build_data.py           0.6 秒
        ▼
   public/vocab.json（28,531 词）★ 唯一入库的词库文件
        │
data/ecdict.csv + tofu_words.csv + kyle/*.jsonl
        │  [2] python tools/build_unified_db.py     8.3 秒
        ▼
   data/db.raw.json（331,961 词）★ 原始库，只读
        │  [3] node tools/compute_chain_idx.js      1.7 秒
        │      （过滤 + 算 kind/可接指数/conf）
        ▼
   data/db.json（307,113 词）★ 成品库，游戏加载它
```

**全链路约 11 秒**（第 3 步曾经占 100 秒，2026-09 优化后占 0.26 秒，见 §7）。

### 3.3 三种存储，三种生命周期

| 存储 | 位置 | 生命周期 | 丢失后果 |
|---|---|---|---|
| 词库（成品） | `data/db.json` | 可由 `npm run build` 重建 | 无（重建即可） |
| 账户 | `data/users.json` + `data/sync/` | **持久，要备份** | 用户积分/画像/记录全丢 |
| 对局与房间 | 内存（`src/rooms.js` 的普通对象） | **进程重启即清空** | 进行中的房间消失（可接受） |
| token 密钥 | `data/.secret` | **持久，必须备份** | 所有用户登录态失效 |
| 游客数据 | 浏览器 localStorage | 跟随浏览器 | 记录丢失（可接受） |

---

## 4. 模块清单

### 服务端（`src/`，11 个模块，约 1,300 行）

| 模块 | 行数 | 职责 | 备注 |
|---|---|---|---|
| `api.js` | 329 | 25 个 HTTP 路由 | ⚠️ 路由 + 处理逻辑混在一起，见 §6.1 |
| `rooms.js` | 358 | 联机房间全生命周期 | 含单挑、回合计时、验词计时 |
| `ai.js` | 195 | AI 裁判：判断可疑 + 出题 | 只有联机房间启用 |
| `view.js` | 134 | 组装给前端的快照 | 防作弊：剥掉答案字段 |
| `gameplay.js` | 113 | 对局编排 + 本地/人机/房间的模式判定 | `game.mode` 的设置处之一 |
| `userdata.js` | 101 | 账户数据读写 + 画像计算入口 | |
| `auth.js` | 87 | 注册/登录/密码/token | scrypt 散列 + token 版本号 |
| `points.js` | 49 | 积分归属判定与幂等结算 | |
| `db.js` | 63 | 加载词库 + 建 WordStore | 只依赖 config 和 logic |
| `usage.js` | 42 | 使用统计 | |
| `config.js` | 27 | 路径与常量 | 无依赖 |

### 前端（`public/`，约 2,250 行）

| 文件 | 行数 | 职责 |
|---|---|---|
| `app.js` | 1,388 | 全部 UI 逻辑：登录门、三种模式、房间、商店、验词弹窗、主题 |
| `logic.js` | 965 | ⭐ 规则/AI 引擎（UMD，服务端也用） |
| `index.html` | 269 | 结构 |
| `style.css` + 3 主题 + `login.css` | 727 | 样式 |

### 构建工具（`tools/`，9 个脚本）

| 脚本 | 语言 | 作用 |
|---|---|---|
| `build_data.py` | Python | word.csv → vocab.json |
| `build_unified_db.py` | Python | 整合 4 个数据源 → db.raw.json |
| `compute_chain_idx.js` | Node | 过滤 + 可接指数：db.raw.json → db.json |
| `check_db.js` | Node | **词库体检**（20 项硬指标 + 短词风险面） |
| `check_echo.js` | Node | 回声规则/清理效果验收 |
| `diff_db.js` | Node | **两份词库逐字段对拍**（改算法后证明结果没变） |
| `analyze_hard_ends.js` / `print_hard_list.js` | Node | 难接结尾分析（报告 + 打印） |
| `sort_db.js` / `fetch.py` | — | 可选工具（排序去重 / 分块下载） |

### 测试（`test/`，7 套，239 项）

单测 76 · 集成 · API 25 · 账号 45 · 房间 73 · 追踪 6 · 安全 14

---

## 5. 关键设计决策

| 决策 | 为什么 | 代价 |
|---|---|---|
| 规则引擎用 UMD 共用 | 杜绝前后端规则分叉 | 前端拿到全部 AI 评分逻辑（可被玩家研究，但这是学习类游戏，不算问题） |
| `game.mode` 单一开关 | 竞技规则只在联机房间生效 | 每加一条规则都要先问"属于哪个模式" |
| 词库分层：raw → 成品 | 过滤规则改错不会永久丢词 | 多一个中间文件（54MB） |
| 词条带 `kind`/`conf`/`chain_idx` 等预计算字段 | 运行时零计算，AI 打分只是查表 | 改规则必须重跑构建 |
| 房间状态放内存 | 实现简单，无需数据库 | 重启丢房间，无法多进程 |
| 游客数据放 localStorage | 无需注册即可玩 | 换浏览器就丢 |

---

## 6. 结构评估

### 6.1 值得改的问题

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| 1 | **`src/api.js` 是"路由 + 业务"混合体** | 25 个路由写成一条 300 行的 `if (pathname === ...)` 链，每个分支里还有 5~15 行处理逻辑 | 加一个接口要翻整条链；无法单独测某个路由 | 拆出 `routes/` 目录 + 一张路由表 `{method, path, handler}`；把分支里的逻辑挪进对应的领域模块 |
| 2 | **前端 `app.js` 单文件 1,388 行且零测试** | 它承担登录门/三种模式/房间/商店/验词/主题全部 UI | 改 UI 全靠手点，回归只能靠人 | 按功能拆文件（至少要拆出 `room-ui` / `shop-ui` / `verify-ui`）；用 `node --check` 兜住语法 |
| 3 | **`userdata.js` 反向依赖 `db.js`** | `userdata.js:60` 调 `db.R.computeUserProfile(db.store, …)` | 数据层被塞进了"用词库算画像"的职责 | 把画像计算移到 `view.js` 或新建 `profile.js`，让 `userdata` 只做存取 |
| 4 | **`ai.js` 反向依赖 `auth.js`** | `ai.js:71`：`auth.hasUser(p.name) ? userdata.accountProfile(p.name) : null` | AI 模块认识账户系统 | 把"取画像"抽成一个注入的钩子（项目已有 `game.aiReferee` 这类先例） |
| 5 | ~~**规则常量重复**~~ ✅ **已修复** | 原 `aeiouy` 出现在 4 个文件 6 处；`ECHO_KEEP_F` 在 logic.js 与 compute_chain_idx.js 各一份；末尾元音/禁结尾规则在两个文件各实现一遍 | ⚠️ **构建期规则 ≠ 运行期规则**，症状是静默的：词库照常生成、测试全绿，但 AI 会以为某个词接得下去、运行时却被拒绝 | 构建工具改为**直接调用 `logic.js` 导出的规则**（`hasVowelEnding`/`forbiddenEnding`/`isTrustedEntry`/`VOWELS`/`ECHO_KEEP_F`），结构上只剩一份实现；另加**规则指纹**闸（见 §8.2） |

### 6.2 目前健康的地方

- **分层没有被破坏**：除了上面 2 处上穿，依赖方向一律向下，没有循环依赖。
- **无第三方运行时依赖**：`package.json` 里没有 `dependencies`，供应链风险为零。
- **有真测试**：239 项，且覆盖了规则引擎、房间生命周期、账号安全（含路径穿越/token 伪造/原型污染）。
- **构建产物有防线**：`check_db.js`（20 项硬指标）+ `diff_db.js`（改算法对拍）两道闸。
- **不静默失败**：关键路径的失败会给中文提示 + 非零退出码（`db.js` 找不到词库、`compute_chain_idx.js` 找不到原始库、非法词条校验）。

### 6.3 一句话总评

**结构是健康的：分层清晰、耦合有明确的中心且那个中心是刻意设计的、零依赖、有测试和产物防线。**
主要的技术债集中在**两个"大文件"**（`src/api.js` 的路由混合、`public/app.js` 的 UI 全包），
以及**少量反向依赖**。这些都不影响正确性，但会持续抬高"加新功能"的成本。

---

## 7. 性能：构建链路（2026-09 优化）

### 7.1 优化前后

| 步骤 | 优化前 | 优化后 |
|---|---|---|
| [1] build_data.py | 0.6 秒 | 0.6 秒 |
| [2] build_unified_db.py | 8.3 秒 | 8.3 秒 |
| [3] compute_chain_idx.js | **102.4 秒** | **1.7 秒** ⬅ **60×** |
| **合计** | **约 111 秒** | **约 11 秒** |

第 3 步内部的净耗时（优化后）：读取 0.38s → 算 kind 0.11s → 过滤 0.30s → **可接指数 0.25s** → 写盘 0.68s。

### 7.2 用了什么手法（OI 视角）

原实现的复杂度是 `O(Σ_w [B(末2(w)) + B(末3(w))])`，其中 `B(P)` = 以 P 开头的词数。
英语前缀是重尾分布（`in`/`re`/`er`/`st` 开头的词成千上万），大量词又共享同一个词尾，
于是这个求和是**准平方级**的 —— 33 万词要跑 100 秒。

**关键观察（把聚合提到循环外 / 离线预处理）**：判断 `isChainable(prev, s)` 里，
除了一句 `s.w === prev`（排除自己），其余两条（末尾含元音、禁 `ry/ht/ck`）
**只取决于 `s`，与 `prev` 无关**。所以同一个前缀桶对所有候选的贡献完全一样 ——
可以对每个前缀桶**只聚合一次**，之后每词 O(1) 查表：

```
succ_cnt(w) = cnt[末2(w)] + cnt[末3(w)] − |A∩B| − 自己
```

两项修正都可 O(1) 判定：

- **交集 `A∩B`**：`B ⊆ A` 当且仅当 `末2` 恰好等于 `末3` 的前两字母。
  设 a,b,c 为末三个字母的序号，该条件即 `26(a−b) + (b−c) = 0`；
  由于 `|26(a−b)| ≤ 650` 而 `|b−c| ≤ 25`，只能 `a = b = c` —— **末三字母全同**（`ooo`/`sss`）。
- **自己**：`w` 若以自己开头（`first2(w)=last2(w)` 或 `first3(w)=last3(w)`），减 1。

**其他配套手法**：

| 手法 | 效果 |
|---|---|
| **完美哈希**代替字符串 key：2 字母 → `[0,676)`，3 字母 → `[0,17576)`，直接下标定长 `Int32Array`/`Float64Array` | 消除字符串哈希与 GC 压力 |
| 去掉每词一个 `Object.create(null)` 的去重表（33 万次分配） | 显著减少 GC |
| `Math.pow` 从"每候选算一次"（约 10⁸ 次）变成"每词算一次"（33 万次） | 保留原样以确保结果逐位一致 |
| **对拍验证**（`tools/diff_db.js`） | 证明优化后整数字段逐位相同、浮点误差 < 1e-13 |

### 7.3 剩下的瓶颈

现在最慢的是**第 2 步 `build_unified_db.py`（8.3 秒，占 75%）**，其中大部分在解析
62MB 的 `ecdict.csv` 与 62MB 的 Kyle jsonl。若要继续优化，方向是：
用 `csv.reader` 替代 `csv.DictReader`（后者每行建一个 dict）、或把解析结果缓存成二进制中间格式。
**但目前 11 秒的全链路已经不需要优化了** —— 收益远小于引入缓存带来的复杂度。

---

## 8. 一致性防线（2026-09 新增）

架构梳理时发现，本项目最危险的一类 bug 是**"同一规则存在两份实现，其中一份悄悄过期"**。
它不会报错、不会让测试变红，只会让线上行为变得莫名其妙。为此加了三道防线：

### 8.1 规则单一真相源（结构上消除，而不是靠约定）

构建工具 `compute_chain_idx.js` 现在**直接 require `public/logic.js`** 并调用
`hasVowelEnding` / `forbiddenEnding` / `isTrustedEntry` / `VOWELS` / `ECHO_KEEP_F`，
不再自己实现一遍。以前那两份实现只能靠注释提醒"⚠️ 两边要一致" —— 那种约定迟早分叉。

> 历史教训（都真实发生过）：
> · `isTrusted` 在 logic.js 与构建脚本各一份；
> · `[网络]` 过滤正则曾锚定 `^\[网络\]`，但数据里该标签从不在开头 → 规则看似存在却**一个词都没匹配到**；
> · 可接指数曾在过滤**之前**计算 → 把已删除的词算成后继（29,770 个词虚高）。

### 8.2 规则指纹（防止"词库与规则脱节"）

`data/db.json` 里的 `chain_idx`/`has_succ` 是**用某一版规则算出来的**。规则改了却没重建，
词库就与运行期判据脱节 —— 症状同样是静默的。

做法：构建时把规则指纹写进 `data/db.build.json`；`check_db.js` 再算一遍对比，不一致就提醒重跑构建。

指纹用**行为特征**而不是源码文本：拿一组固定的探针词/探针词条（含 `null` 边界），
把规则在它们身上的实际输出压成哈希。实测效果：

| 改动 | 指纹 |
|---|---|
| 只改注释 / 调格式 | **不变** ✓（不误报） |
| 去掉 `ck` 禁结尾 | 变 ✓ |
| 高频阈值 0.65 → 0.70 | 变 ✓ |
| 元音集合去掉 `y` | 变 ✓ |
| `isTrustedEntry` 对空词条的处理翻转 | 变 ✓（补了 `null` 探针才有此覆盖） |
| 末尾元音从看 3 字母改为看 2 字母 | 变 ✓ |

### 8.3 界面文字防漂移（`test/test.js` 新增 3 项）

页面上有**两处把规则抄成了文字**：「查看规则」面板与开局提示。
引擎改了规则而文字没跟着改，页面就会**对玩家撒谎**，且没有任何报错。

测试的做法是**从引擎反推真相**（穷举 676 个 2 字母组合，看哪些被 `forbiddenEnding` 拒绝），
再与 `index.html` / `app.js` 里的文字比对。已实测：故意把 `ck` 改成 `xy` → 测试立刻失败并指出差异。

### 8.4 改生成算法时的对拍（`tools/diff_db.js`）

优化/重构生成算法后，用它对拍新旧两份词库：整数字段必须逐位相同，浮点字段允许 1e-12 以内的
求和顺序误差。本次重构实测**所有字段 0 差异**（含浮点），即纯粹的行为保持重构。
