# Hover Index（代码悬停）

DSH 的通用插件：聊天里出现的代码词，悬停出卡片，点击用编辑器打开对应行。

> 作者：hdy · MIT

## 能力

- 悬停函数名、变量名、类名、参数名、`文件名:行号`，显示：类型、声明行原文、注释、被调用次数、继承关系。
- 多项目：从 DSH 工作区注册表自动发现项目根；有 `codegraph` 索引的项目查索引，没有的直接扫源码。
- 点击卡片行：宿主进程调用 `code.vscode -g <文件>:<行>` 打开编辑器（绕开浏览器对外部协议的拦截）。

## 安装

从本地克隆或下载后的合集仓库根目录运行：

```sh
dsh plugin --profile web add "<本仓库绝对路径>/hover-index"
```

安装后刷新页面。也可从本合集仓库直接安装（需当前 DSH CLI 支持 Git 子目录安装）：

```sh
dsh plugin --profile web add github:moyudamowang/dsh-plugins#path=hover-index
```

## 配置（`cordis.patch.yml`）

```yaml
config:
  autoDiscover: true     # 从工作区注册表发现项目
  projectRoots: []       # 额外项目根
  autoSync: false        # 索引过期时后台跑 codegraph sync（每项目每分钟最多一次）
  scanUnindexed: false   # 多项目时是否也扫描无索引项目
  maxItems: 12
  maxScanFiles: 20000    # 单次扫描文件上限
  scanBudgetMs: 1200     # 单次扫描时间上限
  excludeDirs: []
```

## 接口（仅回环地址）

| 路由 | 用途 |
|---|---|
| `GET /hover-index?name=<词>` | 查询符号 |
| `GET /hover-index-open?file=<相对路径>&line=<行>&root=<项目根>` | 打开文件到行 |
| `GET /hover-index-roots` | 列出发现的项目根 |

## 依赖与兼容

- 索引快路径依赖 Node 的 `node:sqlite`（Node ≥ 22.5）。不可用时插件仍能工作，只退化为源码扫描。
- 编辑器打开依赖 VS Code 的命令行（`code.cmd` 在 PATH 或默认安装位置）。
- 打开编辑器目前只支持 VS Code；其他编辑器需扩展 `resolveCodeCli`。

## 开发

```sh
node --check index.js
node --check client.js
```

## 已知边界

- 只匹配声明行，不解析重载、泛型与作用域；同名候选最多 12 条，按项目代码、框架、工具排序。
- 注释来自索引的 docstring 或源码 `///`、`#`、`##` 行；没有就为空。
- 只有行号没有文件名的片段（如 `:40`）无法解析。
- 路由使用 `sec-fetch-site` 做同源校验；非浏览器客户端不发送该头时仍可访问。

## 许可证

MIT，详见 [`LICENSE`](LICENSE)。
