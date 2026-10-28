# Discussion Tree（主线讨论树）

> 作者：hdy · MIT

DSH 右侧栏的实时讨论树：把多会话的话题树画在面板里，谁在主线、谁被折叠，一眼看清。

## 能力

- **实时视图**：右侧栏按工作区读取讨论树文件并周期刷新；每个会话的归属一目了然。
- **按会话开关**：启用/停用某个会话参与讨论树；fork 出来的子会话自动继承父会话的归属；也可以「脱离」拿到自己的独立副本。
- **记录会话**：绑定一个「记录员」会话并一键唤醒，向它推送主线摘要（支持手动对齐与自动复述）。
- **手动整理**：移除节点、标记标准答案 / 重开、折叠子树——所有改动经 `/tree` 命令落到工作区文件并留痕。

## 数据放在哪

树与状态都存在**工作区**内的 `tmp/讨论树/`：

```
tmp/讨论树/
├── tree.json            # 话题树本体
├── state.json           # 每会话的参与状态与默认开关
└── sessions/<id>.json   # 每个会话自己的树片段
```

纯文件存储，没有数据库、没有后台进程；删除目录即完全重置。

## 安装

从本地克隆或下载后的合集仓库根目录运行：

```sh
dsh plugin --profile web add "<本仓库绝对路径>/discussion-tree"
```

安装后刷新页面，右侧栏出现「讨论树」标签页。

也可从合集仓库直接安装（需当前 DSH CLI 支持 Git 子目录安装）：

```sh
dsh plugin --profile web add github:moyudamowang/dsh-plugins#path=discussion-tree
```

## 依赖与兼容

- Web 双面插件：宿主半（`lib/index.js`）注册 `/tree` 命令，浏览器半（`lib/client.js`）渲染右侧栏面板。
- 客户端注入 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-workspace-files`、`@deepseek-ai/dsh-client-ui-sidebar-right`、`@deepseek-ai/dsh-client-ui-renderer`，需要较新的 DSH 0.2.x 宿主。

## 许可证

MIT，详见 [`LICENSE`](LICENSE)。
