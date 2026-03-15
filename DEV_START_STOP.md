# 开发环境启动与关闭

本文档整理 TTP Web 项目前后端开发环境的启动、关闭与排障命令。

## 访问地址

- 前端: `http://127.0.0.1:5173/`
- 后端: `http://127.0.0.1:8000/`
- 后端文档: `http://127.0.0.1:8000/docs`

## 分开启动

### 启动后端

```bash
cd "D:/2026/ip_ttp/backend"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 启动前端

```bash
cd "D:/2026/ip_ttp/frontend"
npm run dev -- --host 127.0.0.1 --port 5173
```

## 一键启动

### Windows

```bat
start-dev.bat
```

### Git Bash / Linux / macOS

```bash
./start-dev.sh
```

## 正常关闭

### 手动启动时

如果前后端是分别在两个终端里启动的，直接在各自终端按：

```bash
Ctrl+C
```

### 使用 `start-dev.bat` 启动时

会弹出两个终端窗口，直接关闭对应窗口即可。

## 强制关闭占用端口的旧进程

如果前端或后端已经退出，但端口还被旧进程占用，可以执行下面的 PowerShell 命令：

```powershell
powershell -NoProfile -Command "$ports = @(5173,8000,8001); $connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }; $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($procId in $pids) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }"
```

## 常见问题

### 1. 前端启动时报找不到 `package.json`

说明你在仓库根目录执行了前端命令。前端命令必须在 `frontend/` 目录执行：

```bash
cd "D:/2026/ip_ttp/frontend"
npm run dev -- --host 127.0.0.1 --port 5173
```

### 2. 后端启动时报端口占用

例如：

```text
[Errno 10048] ... only one usage of each socket address ... is normally permitted
```

说明 `8000` 端口已经被旧进程占用。先执行上面的强制关闭命令，再重新启动后端。

### 3. 页面改了但功能没生效

通常是因为：

- 前端 dev server 没重启
- 后端还在跑旧进程
- 代理指向了错误端口

建议顺序：

1. 关闭前后端
2. 清理旧端口进程
3. 重新启动后端
4. 重新启动前端
5. 刷新浏览器
