# 第三方数据与资源声明（Third-Party Notices）

本项目代码采用 **MIT 许可**（见 `LICENSE`）。词库数据由以下开源项目整合而来，版权归各自原作者所有：

## 数据源

| 项目 | 用途 | 许可 | 来源 |
|---|---|---|---|
| **ECDICT**（skywind3000/ECDICT） | 兜底词覆盖 + 音标/中文释义/词频/考试标签/柯林斯星级 | MIT | https://github.com/skywind3000/ECDICT |
| **Tofu-Xx/dictionary** | 中文释义 + 英美音标 | MIT | https://github.com/Tofu-Xx/dictionary |
| **KyleBing/english-vocabulary** | 逐词精讲（例句/短语/近义/同根/真题，用于"知识点"） | MIT | https://github.com/KyleBing/english-vocabulary |

> 整合逻辑见 `tools/build_unified_db.py`。首次构建会从上述仓库下载原始数据到 `data/`（未随本项目分发，请遵守各项目许可）。

## 样式设计

- **登录页样式**（`public/login.css`）的设计语言借鉴开源项目 **Pico CSS**（https://picocss.com），Copyright 2019-2025，MIT 许可（https://github.com/picocss/pico）。仅借鉴设计风格，未引入其运行时文件。

## 生成数据（不随本项目分发）

`data/db.json`、`data/db.lite.json` 等由上述数据源自动生成（`npm run build`），生成物同样受上述各项目许可约束，请自行确认在部署/分发时的合规性。
