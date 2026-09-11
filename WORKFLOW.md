# WORKFLOW.md — 项目维护与演进工作流

> 这份文档解决一个问题：**这个项目为什么容易越改越乱，以及每一步该怎么走才不会乱。**
> 所有结论都经过实际验证（命令、数字、行号可复查），不是泛泛的建议。
> 建议每次开工前先看第 4 节，改完对照第 5 节的验收关卡。

---

## 1. 项目概况（30 秒看懂）

### 1.1 三种交付形态

| 形态 | 入口 | 依赖 | 数据存哪 |
|---|---|---|---|
| **网站版** | `server.js` | 只需 Node.js（运行时零第三方依赖） | 服务端 `data/`，按账户 |
| **便携版** | `word-chain-standalone.html`（单文件 11MB） | 浏览器，零安装 | 浏览器 localStorage |
| **词库工具链** | `npm run build` | 额外需要 **Python 3** | 产出 `data/db.json` |

### 1.2 代码构成

| 语言 | 文件数 | 行数 | 占比 | 位置 |
|---|---|---|---|---|
| JavaScript | 24 | 3,905 | 87.6% | 运行时 / 前端 / 测试 / 大部分工具 |
| Python | 3 | 552 | 12.4% | **只在 `tools/`**，纯离线词库构建 |

**关键事实**：Python **完全不碰游戏规则**。三条规则（末尾 2/3 字母匹配、元音结尾、禁 `ry/ht/ck`）只存在于 `public/logic.js` 一处。Python 只做词库整理（合并释义、推导难度、提取知识点）。

### 1.3 当前基线（改动前请先记录，改动后用来对比）

| 指标 | 当前值 |
|---|---|
| 全量词库 `data/db.json` | **282,551** 词（83.67 MB） |
| 轻量词库 `data/db.lite.json` | **36,809** 词（11.86 MB） |
| 基础词库 `public/vocab.json` | **28,531** 词 |
| 测试 | 7 套全部通过（其中 6 套带计数，共 **124** 项检查） |
| 全量库 kind 分布 | 0.9→282,539 / 0.05→10 / 0.1→2 |

---

## 2. 系统联系图（谁依赖谁）

### 2.1 模块依赖（`require` 关系，实测生成）

```
server.js ──┬─> src/config.js
            ├─> src/db.js ──────> public/logic.js   ★ 共用规则引擎
            ├─> src/auth.js ────> src/config.js
            ├─> src/userdata.js ─> src/config.js, src/db.js
            ├─> src/usage.js ───> src/config.js, src/userdata.js
            ├─> src/view.js ────> src/db.js
            ├─> src/gameplay.js ─> src/db.js, src/view.js
            ├─> src/rooms.js ───> src/db.js, src/view.js, src/gameplay.js
            └─> src/api.js ─────> 上面全部 8 个模块

tools/compute_chain_idx.js ─> public/logic.js   ★ 同一份引擎
tools/analyze_hard_ends.js ─> public/logic.js   ★ 同一份引擎
tools/build_standalone.js  ─> （把 logic.js/app.js 内联进 HTML）
```

**★ 最重要的一条联系**：`public/logic.js` 被**服务端、浏览器、词库构建工具三方共用**。
它是唯一的规则真相源 —— 好处是规则绝不会前后端不一致；代价是**改它必须同时验证三边**。

### 2.2 数据流（源码 → 产物）

```
data/word.csv + word_translation.csv
        │  python tools/build_data.py
        ▼
   public/vocab.json ──────────────┐  （28,531 词，基础池）
                                    │  python tools/build_unified_db.py
   data/ecdict.csv ────────────────┤  （联网下载 ECDICT/Tofu/Kyle）
   data/tofu_words.csv ────────────┤
   data/kyle/*.jsonl ──────────────┘
                                    ▼
                        data/db.json（约 33 万词）
                                    │  node tools/compute_chain_idx.js
                                    │  （算可接指数 + 过滤缩写/专名）
                                    ▼
                        data/db.json（282,551 词）★ 服务端优先使用
                                    │
   data/db.lite.json ──────────────┴──> src/db.js（兜底）+ build_standalone.js
   （36,809 词，随仓库分发，克隆即可玩）

tools/analyze_hard_ends.js ─> tools/hard_ends_report.json ─> tools/print_hard_list.js
```

### 2.3 三条关键链路

**链路 A — 一次出词请求**
`浏览器 app.js` → `POST /api/action` → `src/api.js` → `src/gameplay.js` → `logic.js Game.submitChain` → `src/view.js snapshot` → 浏览器渲染

**链路 B — AI 选词**（核心算法）
`gameplay.advanceAI` → `logic.js Game.tickAI` → `store.candidates()`（用 `by2`/`by3` 前缀索引）→ `scorePick()` 四维加权评分 → `submitChain`

```
score = 硬门禁(合规+非死路) × (0.30·防疲劳 + 0.23·难度贴合 + 0.23·词频 + 0.24·可接指数)
        × 词型惩罚 × 结尾多样化系数 ×1.18(教学) × S5[0.93,1.07]随机
```

**链路 C — 词库构建**（见 2.2，注意它跨两种语言）

---

## 3. 易碎点清单（"难维护"的根因）

按危险程度排序。**每一条都有实证**。

| # | 风险 | 具体位置 | 后果 | 对策 |
|---|---|---|---|---|
| 1 | **过滤正则与数据格式脱节** | `compute_chain_idx.js:126` 锚定 `/^\[网络\]/`，但 283 个词里 `[网络]` **全在释义中间**，开头 0 个 | 规则看似存在，**实际删 0 个词**（空转） | 改过滤规则后**必须跑一次"实际删了多少"的验证**，不能只看代码 |
| 2 | ~~**专名识别基本失效**~~ ✅ **已修复** | 原 `compute_chain_idx.js:31-32` 要求 `[人名]` 或 `(国名…)`，但 ECDICT 真实写法是 `(Aage)人名；(丹)奥格`（"人名"在括号外） | 修复前：全量库 **7,056** 个专名注记词 **100% 漏网**，全被判为普通词（kind=0.9）→ 已改为 kind=0.10。**教训**：不能用宽泛的 `/人名\|地名\|姓氏/` —— `warehouse` 的释义含"以他人名义"，子串巧合会误伤真常用词；必须匹配"括号注记"上下文 |
| 3 | **可接指数被 2 字母回退顶满** | 规则允许"末尾 2 字母"匹配，`ar`/`er`/`le` 等高频结尾导致 `chain_idx≈0.9` | 946 个 `-lar` 结尾的**生僻医学形容词**全部拿到满分可接指数，AI 主动喂给玩家（如 `acromioclavicular`=肩锁骨的） | 改 `compute_chain_idx.js` 的供给口径，或对"高可接+无权威佐证"组合降权 |
| 4 | **生成物被当成源码入库** | `public/vocab.json`、`data/db.lite.json`、`tools/hard_ends_report.json` 都被 git 跟踪 | 会**静默漂移**：`hard_ends_report.json` 已是 8/31 基于 36,809 词的快照，早已过期 | 跟踪的生成物必须写明"由谁生成、何时生成" |
| 5 | **工具链断链** | `print_hard_list.js` 读 `rep.words`/`rep.summary`，实际字段是 `rep.rows`/`rep.meta` | 运行**立即崩溃**（`TypeError: Cannot read properties of undefined`） | 重构数据结构时同步改消费方；或让消费方做字段校验 |
| 6 | **双份前端代码** | `word-chain-standalone.html` 内嵌 `logic.js`/`app.js` 的副本 | 已发生：便携版（2026-09-05 生成）**缺** `pluralBase`（复数拒绝）和 `turnMsLeft`（倒计时修复） | **改前端后必须重跑** `node tools/build_standalone.js` |
| 7 | **规则常量重复** | `aeiouy` 出现在 **4 个文件 6 处**：`logic.js:22`、`analyze_hard_ends.js:23`、`build_unified_db.py:39`、`compute_chain_idx.js:30/40/124` | 改元音集合要改 6 处，极易漏 | 长期：收敛到一处；短期：改前先 grep |
| 8 | **有规则但没测试** | `pluralBase`（复数拒绝）在 `test/` 里出现 **0 次** | 改坏了没人知道 | 新增规则必须配套测试 |
| 9 | **环境陷阱** | ① PowerShell 下 `npm test` 被执行策略挡住（`npm.ps1` 无法加载）② `python3` 是坏的 Microsoft Store 别名 | 照 README 直接敲命令**会失败**，误判为项目坏了 | 用 `npm.cmd test`；用 `python`（不是 `python3`） |
| 10 | **链路描述重复 4 处** | `package.json` build / `build-db.sh` / `README.md` / `DEPLOY.md` | 改一步要同步 4 处，必然漂移 | 以 `package.json` 为唯一真相源，其余只做引用 |
| 11 | **重建词库代价高** | `compute_chain_idx.js` 遍历 33 万词约 **90 秒+**，`db.json` 84MB | 误跑/反复跑浪费时间，且会改动已入库的 `public/vocab.json` | 见第 5 节铁律：先备份、别乱跑 |
| 12 | **房间是内存态** | `src/rooms.js` 用普通对象存 `rooms`/`userRoom` | 服务重启房间全丢，无法多进程部署 | 现状可接受；若要多进程必须先落盘 |

---

## 4. 工作流：分阶段推进

**总原则：一次只动一层，每阶段结束时项目必须是"可运行 + 测试全绿"的状态。**

### Phase 0 — 基线固化（先做，约 20 分钟）

**目的**：让后面每一步都有对照，出问题能立刻知道是哪一步引入的。

| 步骤 | 动作 | 注意 | 验收 |
|---|---|---|---|
| 0.1 | 跑全套测试记录基线 | PowerShell 里必须用 **`npm.cmd test`**（`npm test` 会被执行策略挡住） | 7 套全绿，124 项 0 失败 |
| 0.2 | 记录词库基线数字 | 见 1.3 表格；数字变了说明词库被动过 | 282,551 / 36,809 / 28,531 |
| 0.3 | 建工作分支 | `git checkout -b fix/wordbank-quality`，别直接在 main 上改 | `git status` 干净 |
| 0.4 | 处理未提交改动 | 当前有一处未提交：`tools/compute_chain_idx.js`（`[网络]` 过滤）。**先决定它是留、是改、还是撤销**，别带着它开始新工作 | 工作区干净 |

> ⚠️ **0.4 是本阶段最容易踩的坑**：那处未提交改动正是"空转"的那条正则。带着它继续改，后面会分不清哪次改动导致了什么。

### Phase 1 — 低风险修复（收益最大、风险最小，约 1～2 小时）

**目的**：修掉"写了但没生效"的规则，让词库质量立刻提升。

| 步骤 | 动作 | 注意 | 验收 |
|---|---|---|---|
| 1.1 | 修 `[网络]` 正则锚点（`^` 去掉） | 改完**必须实测删了多少**。预期删 283 个；若删 0 个说明还是没匹配上 | 实测删除 283，且抽查被删词确为机翻/黑话 |
| ~~1.2~~ | ~~补专名正则~~ ✅ **已完成（并升级为"限额制度"）** | 见下方"专名限额制度"小节 | 专名漏网 7,056 → **0**；常见词零误伤（apple/water/warehouse/city 全部仍是 kind=0.9） |
| 1.3 | 重建离线单文件 | `node tools/build_standalone.js`；这会覆盖 11MB 的产物文件 | 便携版含 `pluralBase` 与 `turnMsLeft` |
| 1.4 | 提交 | 一个逻辑改动一次提交，中文提交信息写清"改了什么/为什么" | `git log` 清晰可回溯 |

> ⚠️ **Phase 1 的三个致命注意**：
> 1. **改 `compute_chain_idx.js` 后必须重跑整个构建**（`node tools/compute_chain_idx.js`，28 万词约 90 秒），否则改的是脚本、词库还是旧的。
> 2. **重跑只写 `data/db.json` 一个文件**（已实测确认，`public/vocab.json` 不受影响），而 `data/db.json` 被 gitignore 忽略 —— 所以重跑不会污染入库文件。备份建议用 `cp data/db.json data/db.bak.json`（这个名字匹配 `data/*.json`，会被自动忽略，不会弄脏 `git status`）。
> 3. **每次只改一条规则，立刻验证效果**。同时改 3 条，就再也分不清是哪条起了作用（`[网络]` 空转就是这么来的）。

> ✅ **关于"重跑是否有副作用"的实测结论**（2026-09，可用于判断能否放心重跑）：
> 在 28 万词库上重跑 `compute_chain_idx.js`，`chain_idx` 确实会被重算（因为供给口径取决于当前词库内的后继词），但**漂移极小**：63.6% 的词有变化，平均绝对变化仅 **0.0015**，最大 0.0443。
> 结论：**重跑近似幂等，可以放心执行**，不必担心"重跑一次词库就变样了"。

#### 专名限额制度（本项目的新设计约定，改动前必读）

**背景**：ECDICT 里 7,056 个人名/地名/姓氏之所以危害大，是因为它们被当成普通词（`kind=0.9`）——
在 AI 评分里既不被降权，又因"末尾 2 字母匹配"拿到极高可接指数，于是 AI 会把
`aage`（`n. (Aage)人名；(丹)奥格`）这类词主动喂给玩家。

**采用的方案：保留 + 降权 + 限额**（而**不是**从词库删除）：

| 层 | 做法 | 位置 |
|---|---|---|
| 词库 | 专名识别为 `kind=0.10`，**保留在词库中**（删掉会制造死路，玩家反而无词可接） | `tools/compute_chain_idx.js`：`PROPER_RE3` + 过滤条件写成 `kind < 0.1`（**注意是小于号**，写 `<=` 会把专名全删掉） |
| AI | `kind=0.10` 自动触发词型惩罚（`soft × 0.378`），可接指数从 ~0.9 掉到 ~0.1；额度用完后 AI 完全不选专名 | `public/logic.js`：`scorePick` 的 `ctx.noProper` + `tickAI` |
| 玩家 | 每人**每局**最多 `PROPER_QUOTA = 3` 个，超出即拒；**跨轮不重置** | `public/logic.js`：`properQuotaError` + `Game.submitStart/submitChain` |
| 前端 | 记分板显示「专名 N/3」，接龙面板给专名打「专名」徽章 | `public/app.js` + `public/style.css` |

**为什么按"局"而不是按"轮"**：`Game.newRound()` 只清空本轮重复判定，**不动** `players[].properUsed`。
若要改成按"轮"计，在 `newRound()` 里重置该字段即可 —— 但先想清楚：一轮可能只有几个词，按轮计等于几乎不限。

**改动这块时的注意**：
1. `PROPER_QUOTA` 与 `isProperEntry` 在 `logic.js` 里，被**服务端 / 浏览器 / 便携版三方共用**，改完必须重跑 `node tools/build_standalone.js`。
2. 词库侧（`kind`）与游戏侧（限额）是**两套独立机制**，可以分别调整：只想让 AI 少喂专名就只调权重；只想限制玩家用量就只调 `PROPER_QUOTA`。
3. **专名限额不解决** `-lar` 类问题（那些是 `kind=0.9` 的普通生僻词，比如 `acromioclavicular` = 肩锁骨的）—— 那属于 Phase 3.2/3.3，根因是"2 字母回退"把可接指数顶满。

### Phase 2 — 工具链与产物治理（约 1～2 小时）

**目的**：消灭"会自己腐烂"的东西，这是"免得难以维护"的关键。

| 步骤 | 动作 | 注意 | 验收 |
|---|---|---|---|
| 2.1 | 新建 `tools/check_db.js`：**词库体检脚本** | 一次输出：总词数、kind 分布、专名漏网数、无权威佐证且高可接指数的词数、`-lar` 类可疑结尾数 | 一条命令看清词库健康度 |
| 2.2 | 修 `print_hard_list.js` 字段（`rep.words`→`rep.rows`，`rep.summary.*`→`rep.meta`/`rep.hardCount`） | 改完**必须实际运行一次**（这个坑正是"没运行过"造成的） | 能正常输出难接结尾清单 |
| 2.3 | 重跑 `analyze_hard_ends.js` 刷新过期报告 | 它读 `data/db.json`，需要全量库在 | 报告 meta 的 vocabSize = 282,551 |
| 2.4 | 给 3 个入库生成物加"生成标记" | 在 README 或文件头注明：谁生成、用什么命令、何时生成 | 后续开发者知道不该手改 |

> ⚠️ **注意**：2.1 的体检脚本是**后续所有词库改动的安全网**。先有它，再动 Phase 3；否则 Phase 3 改了什么、好不好，全靠肉眼。

### Phase 3 — 词库质量（核心，工作量最大）

**目的**：解决"AI 把生僻词喂给玩家"的根本问题。

| 步骤 | 动作 | 注意 |
|---|---|---|
| 3.1 | **先量化，再改**：写模拟对局脚本，统计实际被 AI 选中的词里，生僻/专名/专业术语占比 | 不量化就改 = 盲改。用户明确提过"可结合模拟对局解析" |
| 3.2 | 处理"2 字母回退顶满可接指数" | ⚠️ **这是算法核心改动**：`chain_idx` 同时影响 AI 选词和前端"⚠️不好接"提示，改了口径两边都会变。必须先想清规则，改完跑模拟验证 |
| 3.3 | 结尾维度限制（`-lar` 类） | 946 个 `-lar` 词全部 `chain_idx≥0.8`，是本类问题的典型样本 |
| 3.4 | 领域专业术语限制（`[医]` 41,433 / `[化]` 13,431 / `[计]` 4,157） | 现有 `kind` 计算只覆盖**长度 ≤5** 的标签词，长词完全没管 |
| 3.5 | 每改一轮，跑 `check_db.js` 对比 + 跑模拟对局 | 用数据说话，不用感觉 |

> ⚠️ **Phase 3 三条铁律**：
> 1. **不要在一次提交里同时改"词库过滤"和"可接指数算法"** —— 效果会互相掩盖，无法归因。
> 2. **保留可回退的旧词库**：改动前 `cp data/db.json data/db.bak.json`（84MB，确认磁盘够）。
>    注意备份名必须是 `db.bak.json` 这种**仍以 `.json` 结尾**的形式 —— 写成 `db.json.bak` 不会被 `data/*.json` 忽略，会弄脏 `git status`。
> 3. **验收标准要事先定好**：例如"AI 选出的词中，无权威佐证词占比从 57.3% 降到 X%"。

### Phase 4 — 新功能（按依赖顺序，别并行）

**目的**：做"下个版本"的功能。**顺序很重要，后面的依赖前面的。**

| 步骤 | 功能 | 状态 | 注意 |
|---|---|---|---|
| 4.1 | **密码修改** | ✅ **已实现** | 已落地：`src/auth.js` 的 `changePw`（校验原密码 + scrypt 加盐重算）+ `POST /api/change-password` + 账号栏「修改密码」弹层。**额外安全加固**：用户记录加 `tv`（token 版本号），改密后 +1，使**其他设备上的旧 token 立即失效**；接口同时下发新 token 以保住当前设备登录态。测试见 `test/account-test.js`（新增 10 项） |
| 4.2 | **1v1 单挑 + 拒绝判负** | 完全未实现 | ⚠️ 会改 `rooms.js` 的房间模型（现在是 2–6 人通用）。**先明确规则**：谁发起？拒绝判负是立即扣分还是记一次？超时算不算拒绝？ |
| 4.3 | **积分系统** | 完全未实现 | ⚠️ 数据结构要落在 `data/sync/<用户>.json`（现有 schema: `usage`/`seen`/`best`/`games`），**加字段要考虑老数据兼容** |
| 4.4 | **道具（跳过/反转/修改卡）** | 完全未实现 | ⚠️ **最危险的一个**：「反转卡」（接龙逆序、自身不用接龙）会**改变回合语义**，而回合逻辑在 `logic.js Game` 里被服务端、浏览器、离线版三边共用 —— 改它等于改三处。必须先设计好规则，再写测试，最后写实现 |

> ⚠️ **Phase 4 的四条通用注意**：
> 1. **每个功能配一个 `test/` 下的测试文件**（现有 7 套测试是这项目的护城河，别让它退化）。
> 2. **先写测试，再写实现**：尤其 4.2 / 4.4 涉及回合规则，靠肉眼测不完。
> 3. **道具必须服务端权威**：客户端的积分/道具状态可被篡改（参考现有安全测试的思路）。
> 4. **4.4 之后必须重建离线单文件**，否则便携版又落后。

---

## 5. 铁律（每条都对应一个已发生的坑）

### 改代码前

1. **先跑基线**：`npm.cmd test` 必须全绿才开始改。
2. **一次只改一层**：词库过滤 / 选词算法 / 回合规则，**不要混在一次提交里**。
3. **grep 常量再改**：`aeiouy`、`ry|ht|ck`、`kind` 这类语义散落多处，改前先搜。

### 改代码时

4. **改 `public/logic.js`（共用引擎）→ 必须跑三边**：
   ```
   node test/test.js          # 规则单元
   node test/integration.js   # 真实词库
   node test/api-test.js      # 服务端
   node tools/build_standalone.js   # 重建便携版
   ```
5. **改 `tools/compute_chain_idx.js` → 必须重跑构建并实测效果**："写了规则"≠"规则生效"（`[网络]` 空转就是教训）。
6. **改过滤规则 → 必须双向验证**：既验证"该删的删了"，也验证"**不该删的没被删**"（常见词白名单抽查）。

### 改完代码后

7. **跑全套测试**：`npm.cmd test`（PowerShell 下 `npm test` 会被执行策略挡住）。
8. **同步 4 处描述**：如果改了构建步骤，`package.json` / `build-db.sh` / `README.md` / `DEPLOY.md` 都要看一遍。
9. **不要手改生成物**：`data/db.json`、`data/db.lite.json`、`public/vocab.json`、`hard_ends_report.json`、`word-chain-standalone.html` —— 改它们要通过生成脚本。

### 环境

10. **PowerShell 里用 `npm.cmd`**，不要用 `npm`（`npm.ps1` 被执行策略挡住）。
11. **Python 用 `python`**，不要用 `python3`（那是 Microsoft Store 的坏别名，会报"未找到"）。
12. **重建词库前先备份**：`node tools/compute_chain_idx.js` 会**覆盖** `data/db.json`，且耗时 90 秒+。

---

## 6. 验收关卡（每个阶段结束必须通过）

```powershell
cd "E:\WorkFolder\DSH Desktop\word-chain"

# 关卡 1：全套测试（必过）
npm.cmd test

# 关卡 2：服务端真能起来 + 接口正常
$env:PORT=8099; node server.js    # 另开窗口，看启动横幅是否打印词库来源
# 访问 http://localhost:8099 与 /api/lookup?word=apple

# 关卡 3：便携版能双击打开（改了前端时）

# 关卡 4：词库体检（Phase 2 之后）
node tools/check_db.js

# 关卡 5：git 状态干净、提交信息可读
git status
git log --oneline -5
```

---

## 7. 自查清单：项目开始"腐烂"的征兆

隔一段时间对照一次，中 3 条以上就该停下来治理：

- [ ] 有生成物被手改过（`git diff` 里出现 `data/` 或 `vocab.json` 的改动）
- [ ] 有工具脚本**跑不起来**了（字段名对不上、路径变了）
- [ ] 有规则**写了但没生效**（正则匹配不到数据）
- [ ] 入库的生成物**明显过期**（时间戳/规模与当前不符）
- [ ] 便携版**落后于源码**
- [ ] 新加的规则**没有配套测试**
- [ ] 同一常量/语义在 **3 处以上**重复定义
- [ ] README/DEPLOY/package.json 对同一件事的**描述不一致**
- [ ] 提交信息只写"优化""修复"，看不出改了什么

---

## 附：当前待办总览（承接第 3 节易碎点）

| 优先级 | 事项 | 归属阶段 | 预估 |
|---|---|---|---|
| ~~高~~ | ~~修 `[网络]` 正则锚点（空转）~~ ✅ **已完成**（删 283 词，0 误伤） | Phase 1 | — |
| 中 | `[网络]` 规则**精度**问题：该规则连带删掉了个别"生僻但真实"的词（如 `niqab` 尼卡布、`sawm` 斋戒）。更优做法是**降权**（把这些词的 `kind` 降到 0.1，让 AI 避开而不从词库删除），需要先定策略 | Phase 3 | 需先定策略 |
| 高 | 修专名正则（7,418 词漏网） | Phase 1 | 30 分钟 |
| ~~高~~ | ~~重建离线单文件（补齐 2 个修复）~~ ✅ **已完成**（随密码修改功能一起重建，已含 `pluralBase`+`turnMsLeft`） | Phase 1 | — |
| 中 | 新建 `check_db.js` 词库体检 | Phase 2 | 1 小时 |
| 中 | 修 `print_hard_list.js` + 刷新过期报告 | Phase 2 | 30 分钟 |
| 中 | 前端改完自动重建便携版（防再次落后） | Phase 2 | 20 分钟 |
| 中 | 补 `pluralBase` 的测试 | Phase 2 | 20 分钟 |
| 低 | 收敛 `aeiouy` 等重复常量 | Phase 2 | 1 小时 |
| 高 | 模拟对局量化"生僻词被喂给玩家"的比例 | Phase 3 | 2 小时 |
| 高 | 处理 2 字母回退导致的 `chain_idx` 虚高 | Phase 3 | 需先设计规则 |
| 中 | 领域专业术语（`[医]`/`[化]`）限制 | Phase 3 | 需先量化 |
| ~~—~~ | ~~密码修改~~ ✅ **已完成** | Phase 4 | — |
| — | 1v1 单挑 + 拒绝判负 | Phase 4 | 需先定规则 |
| — | 积分系统 | Phase 4 | 需先定数据结构 |
| — | 道具系统（跳过/反转/修改卡） | Phase 4 | 需先定回合语义 |
