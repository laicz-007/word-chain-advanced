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
    └── db.json     # 统一词库（必须）
```

用 scp / rsync / git 任一方式上传到 VPS，例如：

```bash
# 本机执行（打包上传再解压）
tar -czf word-chain.tgz server.js package.json src public data/db.json
scp word-chain.tgz user@你的VPS:/home/user/
# VPS 上解压
cd /home/user && tar -xzf word-chain.tgz
```

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

`data/db.json`（词库，静态）、`data/users.json`（账户）、`data/sync/`（每人画像/记录）、`data/.secret`（token 密钥，务必一起备份，否则用户 token 全失效）。

## 8. 更新代码

```bash
# 重新上传 server.js / src / public，然后
sudo systemctl restart word-chain
```

## 9. 从"手动上传"升级为"git 一键更新"（推荐）

之前是手动传文件的，想改成**一条命令更新**？让 VPS 上也装 git，以后代码走 `git pull` 自动同步：

### 一次性迁移（只做一次，零风险流程：先 clone 新目录，原目录不动）

> ⚠️ **数据安全原则**：玩家数据全部在 `data/`（词库/账号/画像/密钥），它被 `.gitignore` 排除，git **不会碰**。但迁移操作本身要小心——**用"复制"data，不是"移动"；先跑通新的，再停旧的。**

```bash
cd /root
# 1) 安装 git（若没有）
sudo apt-get install -y git

# 2) 【先不动原目录】clone 到独立新目录
git clone https://github.com/laicz-007/word-chain-advanced.git word-chain-git

# 3) 把原项目的数据目录【复制】过去（cp 复制！不是 mv 移动）
cp -r /root/word-chain/data /root/word-chain-git/data

# 4) 【校验】词库/账号/密钥都过来了再继续
ls -lh /root/word-chain-git/data/db.json       # 应看到 90+MB 词库
ls /root/word-chain-git/data/users.json
ls /root/word-chain-git/data/.secret          # 密钥（有则老用户 token 不失效）

# 5) 用新目录试启动，浏览器访问确认"老玩家数据还在"
cd /root/word-chain-git && node server.js     # Ctrl+C 停掉

# 6) 确认无误后：停掉旧服务，切换 systemd 指向新目录，再启动
sudo systemctl stop word-chain
# 修改 /etc/systemd/system/word-chain.service 的 WorkingDirectory 为 /root/word-chain-git，
# 再：
sudo systemctl daemon-reload
sudo systemctl start word-chain

# 7) 旧目录 /root/word-chain 先留着（回滚保险），确认稳定几天后再删
```

> `data/`（db.json 词库、users.json 账号、sync/ 画像、.secret 密钥）被 `.gitignore` 排除，git 永远不碰它——新 clone 里 `data/` 是空的，所以**第 3 步的 `cp -r` 复制**是数据不缺的命根子。用"复制"而非"移动"，原目录始终留有备份，出问题能一键回滚。

### 以后每次更新（一条命令）

```bash
cd /root/word-chain && bash update.sh
```

等价于 `git pull origin main && 重启服务`。仓库里带了 `update.sh`，自动做这两步（检测到 systemd 服务就自动 `systemctl restart`，没有则提示手动重启命令）。

### 注意

- 如果以后**词库/数据**也有更新（比如发了新 db.json），git 不会带（被 ignore），需要另传 `data/` 下对应文件。
- `git pull` 前先确认 VPS 上没有手动改过被 git 跟踪的文件（否则会冲突）；正常只 pull 不会改，不会冲突。

---

### 端口/防火墙

若不用 Nginx、直接用 8080，记得放行：

```bash
sudo ufw allow 8080/tcp
```
