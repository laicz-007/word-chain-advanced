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
tar -czf word-chain.tgz server.js package.json src public data/db.json
scp word-chain.tgz user@你的VPS:/home/user/
# VPS 上解压
cd /home/user && tar -xzf word-chain.tgz
```

> **词库只有一份**：`data/db.json`（成品，约 30.7 万词 / 96MB）。
> - 先在本机跑 `npm run build` 生成它（需要 Python 3），再传上去
> - **VPS 上不需要安装 Python**：`npm run build` 只在你自己的机器上执行，`db.json` 只是一个普通数据文件
> - 没传词库时服务启动会直接报错，并提示你运行 `npm run build`
>
> **不需要传** `data/db.raw.json`（33 万词的原始库，54MB）—— 那只是构建时的中间产物，游戏不读它。
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

## 8. 更新代码

```bash
# 重新上传 server.js / src / public，然后
sudo systemctl restart word-chain
```

---

### 端口/防火墙

若不用 Nginx、直接用 8080，记得放行：

```bash
sudo ufw allow 8080/tcp
```
