# TTP Web UI

一个基于 [TTP (Template Text Parser)](https://github.com/dmulyalin/ttp) 的可视化 Web 应用，提供交互式模板构建、文本解析测试和配置生成功能。

> **致谢 / Acknowledgements**
>
> 本项目的核心解析引擎来源于 [dmulyalin/ttp](https://github.com/dmulyalin/ttp)，感谢作者及社区贡献者在 TTP 项目上的出色工作，使得半结构化文本解析变得如此简单高效。
>
> The core parsing engine is powered by [dmulyalin/ttp](https://github.com/dmulyalin/ttp). We are grateful to the author and community contributors for their excellent work on the TTP project.

## 项目概览

本仓库包含两个相关部分：

1. **TTP 核心库** (`ttp/`) — 原始 TTP Python 解析器，将模板语法转换为正则驱动的解析结果。
2. **TTP Web UI** (`backend/` + `frontend/`) — 基于 FastAPI + React 的 Web 应用，用于交互式构建模板、测试解析输出并持久化保存模板。

## 功能特性

- **模板构建器** — 可视化编辑 TTP 模板，支持变量、分组的右键创建与范围跟踪
- **测试与结果** — 对一个或多个模板批量测试输入文件，支持 JSON / CSV / Checkup CSV 下载
- **配置生成** — 基于已解析数据渲染 Jinja2 配置模板，支持多源模板绑定与批量渲染

## 快速开始

### 环境要求

- Python 3.8+
- Node.js 18+
- Poetry

### 一键启动（开发模式）

```bash
# Linux / macOS
./start-dev.sh

# Windows
start-dev.bat
```

脚本会自动检测端口占用（8000 / 5173），确认后端就绪再启动前端。

### 手动启动

**安装核心依赖**

```bash
poetry install
```

**启动后端**

```bash
cd backend && pip install -r requirements.txt
cd backend && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**启动前端**

```bash
cd frontend && npm install
cd frontend && npm run dev -- --host 127.0.0.1 --port 5173
```

启动后访问 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

## 运行测试

```bash
# 运行全部测试（必须在 test/pytest 目录下执行）
cd test/pytest && poetry run pytest -vv

# 运行 Web UI 相关测试
cd test/pytest && poetry run pytest test_web_ui_template_service.py -vv
cd test/pytest && poetry run pytest test_web_ui_csv_output.py -vv
cd test/pytest && poetry run pytest test_web_ui_parse_api.py -vv
cd test/pytest && poetry run pytest test_web_ui_generation_api.py -vv
```

## 架构概览

```
ip_ttp/
├── ttp/              # TTP 核心解析引擎（来自 dmulyalin/ttp）
├── backend/          # FastAPI 后端
│   └── app/
│       ├── routers/  # parse / templates / generation 路由
│       └── services/ # TTP 集成、SQLite 持久化、配置生成
├── frontend/         # React + Vite 前端
│   └── src/
│       ├── components/  # TemplateBuilder / TestResults / ConfigGeneration
│       ├── store/       # Zustand 全局状态
│       └── services/    # Axios API 封装
└── test/pytest/      # 核心库 + Web UI 后端测试
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/parse` | 用模板解析文本 |
| `POST` | `/api/parse/file` | 解析上传的文件 |
| `GET` | `/api/patterns` | 获取内置模式目录 |
| `GET/POST/PUT/DELETE` | `/api/templates` | 保存的模板 CRUD |
| `GET/POST/PUT/DELETE` | `/api/generation/templates` | 配置生成模板 CRUD |
| `POST` | `/api/generation/render` | 批量渲染配置 |

## 关于 TTP

TTP (Template Text Parser) 是一个使用模板进行半结构化文本解析的 Python 库。其核心能力包括：

- 从模板动态生成正则表达式进行文本匹配
- 使用丰富的内置函数对匹配结果进行实时处理
- 将结果组合成任意层次结构
- 支持多种输出格式（JSON、CSV、tabulate 等）

完整文档请参阅 [ttp.readthedocs.io](https://ttp.readthedocs.io)。

## 贡献

欢迎提交 Issue、报告 Bug 或提出功能需求。
