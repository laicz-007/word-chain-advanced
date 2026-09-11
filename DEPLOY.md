# 部署到 VPS（上线指南）

项目是**纯 Node.js 内置模块**，无第三方依赖，部署很简单。以下按常见 VPS（Ubuntu/Debian）给出步骤。

## 0. 你需要准备的

- 一台有公网 IP 的 VPS（Ubuntu 20.04+ / Debian 11+ 均可）
- 一个域名（可选，用于 HTTPS；没有也行，用 IP 访问）
- 本机已能 `node server.js` 跑通（`http://localhost:8080`）

## 1. 安装 Node.js（≥14，建议 18/20 LTS）

```bash
# Ubuntu/Debian 用 NodeSource 源
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 应 >= 14
```

## 2. 上传项目文件

只需要这些目录/文件（不含数据源下载物）：

```
word-chain/
├── server.js
├── package.json
├── src/            # 8 个逻辑模块
├── public/         # 前端（index.html/app.js/style.css/login.css/主题/logic.js）
└── data/
    └── db.json     # 词库（必须，见下方说明）
```

用 scp / rsync / git 任一方式上传到 VPS，例如：

```bash
# 本机执行（打包上传再解压）。注意必须带上 data/db.json —— 没有词库服务起不来
tar -czf word-chain.tgz server.js package.json src public data/db.json data/db.build.json
scp word-chain.tgz user@你的VPS:/home/user/
# VPS 上解压
cd /home/user && tar -xzf word-chain.tgz
```

> **词库只有一份**：`data/db.json`（成品，约 30.7 万词 / 96MB）—— **它不在 git 里**，`git pull` 拿不到。
> 从 [GitHub Release](https://github.com/laicz-007/word-chain-advanced/releases/latest) 下载最省事：
>
> ```bash
> mkdir -p data && cd data
> curl -LO https://github.com/laicz-007/word-chain-advanced/releases/latest/download/db.json.gz
> curl -LO https://github.com/laicz-007/word-chain-advanced/releases/latest/download/db.build.json
> gunzip -f db.json.gz
> ```
>
> 也可以在本机跑 `npm run build` 生成后再传（见 8.2），或用上面的 `tar` 整包上传。
> **VPS 上不需要安装 Python**：`db.json` 只是一个普通数据文件。
> 没传词库时服务启动会直接报错，并提示你怎么做。
>
> **`data/db.build.json`**（274 字节）是它的构建元数据，建议一起拿 ——
> 有了它，`node tools/check_db.js` 才能回答"这份词库是不是用当前代码构建的"。
> 不拿也能正常玩，只是体检时会提示"无法判断是否同版"。
>
> **不需要** `data/db.raw.json`（33 万词的原始库，54MB）—— 那只是构建时的中间产物，游戏不读它。
>
> > 2026-09 起不再有轻量词库 `db.lite.json`。它曾经让"只传 12MB 就能跑"，但**没有生成脚本、会静默过期**，
> > 导致线上词库与代码长期不一致（留着已清理的缩写词、常用词被误判成专名）。现在统一用一份可重现的成品库。

> `data/usage.json`、`data/users.json`、`data/sync/`、`data/.secret` 会在首次运行时自动生成。

## 3. 本地先跑通（验证）

```bash
cd /home/user/word-chain
npm start        # 等价 node server.js
# 访问 http://你的VPS:8080
```

### 3.1 一键健康检查（推荐）

服务启动后，另开一个终端跑：

```bash
cd /home/user/word-chain
node healthcheck.js          # 默认测 8080
# 或指定端口：node healthcheck.js 9000
```

它会自动：注册两个临时账号 → 测登录/密码散列 → 人机开局绑定账户+画像 → 联机建房/加入/开局/出词/接龙/终止/解散 → 测路径穿越和伪造 token → **自动清理测试账号**，最后打印「✅ 全部通过，服务可上线」。

看到 26 项全 ✅ 就说明部署没问题；若有 ❌ 会提示排查方向。

先在 VPS 上手动跑一遍确认能访问，再进行下面的"常驻 + 反向代理"。

## 4. 用 systemd 常驻（推荐，开机自启 + 崩溃自动重启）

创建服务文件 `/etc/systemd/system/word-chain.service`：

```ini
[Unit]
Description=Word Chain Game
After=network.target

[Service]
Type=simple
User=你的用户名
WorkingDirectory=/home/user/word-chain
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now word-chain
sudo systemctl status word-chain   # 看是否 running
```

## 5. Nginx 反向代理 + HTTPS（推荐）

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

站点配置 `/etc/nginx/sites-available/word-chain`：

```nginx
server {
    listen 80;
    server_name 你的域名;   # 或 _ 表示任意

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/word-chain /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 申请免费 HTTPS 证书（有域名时）
sudo certbot --nginx -d 你的域名
```

> 说明：联机房间用**轮询**（约 0.8s/次），无需 WebSocket；Nginx 默认即可，不需额外长连接配置。

## 6. 安全要点（本项目已内置）

- **密码**：`scrypt` 加盐散列（`data/users.json` 只存 `salt`+`hash`，**不存明文**），核验用 `timingSafeEqual`。
- **登录态**：HMAC 签名 token（30 天），密钥自动生成并持久化在 `data/.secret`（**别外泄**）。
- **路径穿越**：静态文件服务限制在 `public/` 内（边界判断）。
- **原型污染**：用户名/词字符串作键的对象均用空原型 `Object.create(null)`。
- **权限**：创建/加入/开局/解散房间均要求登录；回合由服务端强制，越回合直接拒绝。

## 7. 数据备份

全部运行数据都在 `data/` 目录，定期备份即可：

```bash
tar -czf backup-$(date +%F).tgz data/
```

`data/db.json`（词库，静态，属可重新获取的文件）、`data/users.json`（账户）、`data/sync/`（每人画像/记录）、`data/.secret`（token 密钥，务必一起备份，否则用户 token 全失效）。

## 8. 部署 / 更新

### 8.0 一条命令（推荐）

仓库里带了一个 `deploy.sh`，**首次部署和以后更新是同一件事** —— 重复执行不会出错：

```bash
# 首次部署
git clone https://github.com/laicz-007/word-chain-advanced.git ~/word-chain
cd ~/word-chain && bash deploy.sh

# 以后更新（就这一条）
cd ~/word-chain && bash deploy.sh
```

它依次做四件事：

| 步骤 | 做什么 |
|---|---|
| 1/4 | `git pull` 更新代码 |
| 2/4 | 从**最新 Release** 下载词库（词库不在 git 里，约 16MB） |
| 3/4 | `node tools/check_db.js` 体检（20 项硬指标 + 校验词库与代码是否同版） |
| 4/4 | 重启 systemd 服务并跑 `node healthcheck.js` 自检 |

只想看看要不要更新、不做任何改动：

```bash
bash deploy.sh --check
```

> **为什么词库要单独下载**：`data/db.json` 有 96MB，不适合进 git（也超过仓库单文件限制）。
> 它作为**发布附件**挂在 [Releases](https://github.com/laicz-007/word-chain-advanced/releases/latest) 上，
> 所以 VPS 全程只跟 GitHub 打交道，不用碰你自己的电脑。

### 8.1 手动更新（想看清楚每一步时）

```bash
cd ~/word-chain

# ① 先备份账户数据（git 不会碰它们，但改版前留个底总没错）
cp data/users.json data/users.json.bak 2>/dev/null; cp -r data/sync data/sync.bak 2>/dev/null

# ② 取词库（96MB 的东西不在 git 里，必须单独拿）
cd data
curl -LO https://github.com/laicz-007/word-chain-advanced/releases/latest/download/db.json.gz
curl -LO https://github.com/laicz-007/word-chain-advanced/releases/latest/download/db.build.json
gunzip -f db.json.gz
cd ..

# ③ 拉代码
git pull

# ④ 体检 + 重启 + 自检
node tools/check_db.js
sudo systemctl restart word-chain
node healthcheck.js           # 26 项自检，确认真的活着
```

> ### ⚠️ 三个必须知道的坑
>
> **① 词库不会跟着 git 走。** `data/db.json` 约 96MB，被 `.gitignore` 排除（太大，且受多个开源词典
> 许可约束）。`git pull` **只带来代码，不带来词库** —— 必须单独取（`deploy.sh` 里的第 2 步）。
>
> **② 从 2026-09 之前的版本升级时，`git pull` 会删掉 `data/db.lite.json`。**
> 那个文件已被移除，而旧版的服务在没有 `data/db.json` 时会退回去用它 ——
> 拉完代码它没了，服务就**起不来**了（会报"找不到词库文件"）。
> **正确顺序：先取词库，再 `git pull`，最后重启。**（`deploy.sh` 已经按这个顺序做）
>
> **③ `word-chain-standalone.html`（离线便携版）已废弃**，旧部署目录里若有这个文件，可以手动删掉，
> 它不再被维护。

### 8.2 单独更新词库（词库变了时）

> **怎么知道该不该传？** 在 VPS 上跑 `node tools/check_db.js`，看这两行：
> - `✅ 词库与规则同版` + `✅ 词库与构建脚本同版` → **不用传**
> - 出现 `⚠️ 词库是用【旧规则】构建的` 或 `⚠️ 词库是用【旧版构建脚本】产出的` → **要传**
>
> 判断依据是构建时写进 `data/db.build.json` 的两个指纹。所以**元数据要跟词库一起拿**（见下）。

#### 方式一：从 GitHub Release 下载（推荐，全程在 VPS 上完成）

词库作为**发布附件**挂在 Release 上（`db.json.gz` 约 16MB + `db.build.json` 274B）。
这样它不受 git 单文件限制、不占仓库历史，VPS 上一条命令就拿到：

```bash
cd /home/user/word-chain/data
curl -LO https://github.com/laicz-007/word-chain-advanced/releases/latest/download/db.json.gz
curl -LO https://github.com/laicz-007/word-chain-advanced/releases/latest/download/db.build.json
gunzip -f db.json.gz

cd .. && node tools/check_db.js && sudo systemctl restart word-chain
```

`releases/latest/download/...` 永远指向**最新**那个 release，所以不用改版本号。

**发新版本时（在你自己电脑上）**：

```powershell
cd "E:\WorkFolder\DSH Desktop\word-chain"
npm run build                                   # 重建词库（约 11 秒）
node -e "var fs=require('fs'),z=require('zlib');fs.writeFileSync('db.json.gz',z.gzipSync(fs.readFileSync('data/db.json'),{level:9}))"
gh release create v1.2.0 db.json.gz data/db.build.json --title "v1.2.0" --notes "词库更新"
Remove-Item db.json.gz
```

#### 方式二：本机 scp 上传（没有 gh、或想省 GitHub 流量时）

```powershell
cd "E:\WorkFolder\DSH Desktop\word-chain"
tar -czf dbpack.tgz -C data db.json db.build.json     # 96MB -> 约 16MB
scp dbpack.tgz user@你的VPS:/home/user/word-chain/data/
Remove-Item dbpack.tgz
```

```bash
cd /home/user/word-chain/data
tar -xzf dbpack.tgz && rm dbpack.tgz
cd .. && node tools/check_db.js && sudo systemctl restart word-chain
```

> **`db.build.json` 是什么**：274 字节的构建元数据（构建时间、词条数、两个指纹）。
> 它让 `check_db.js` 能回答"这份词库是不是用当前代码构建的"。
> **少了它也不影响游戏运行**，只是体检时会提示"无法判断是否同版"。
>
> VPS 上**不需要** Python，也不建议在服务器上跑 `npm run build`（要下载 130MB 数据源、且构建时需约 2GB 内存）。
> 在本机构建好、通过 Release 分发，是更省事也更可控的做法。

### 8.3 不用 git 的更新方式

```bash
# 本机打包（注意必须带 data/db.json）
tar -czf update.tgz server.js package.json src public data/db.json
scp update.tgz user@你的VPS:/home/user/
# VPS 上解压覆盖后重启
cd /home/user/word-chain && tar -xzf ../update.tgz && sudo systemctl restart word-chain
```

---

### 端口/防火墙

若不用 Nginx、直接用 8080，记得放行：

```bash
sudo ufw allow 8080/tcp
```
