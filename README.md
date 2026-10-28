# DSH Plugins by hdy

这是 hdy 制作的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件与配套 skills 合集。每个插件保留独立目录、说明文档和许可证；新插件可继续加入这里。

## 插件

| 插件 | 说明 | 目录 |
|---|---|---|
| **Hover Index** | 在聊天代码中悬停函数、变量、类等符号，查看定义并跳转到 VS Code | [`hover-index/`](hover-index/) |
| **Struct Map** | 从工作区的 `*.struct.json` 生成右侧栏实体关系结构图 | [`struct-map/`](struct-map/) |

## 安装

从各自目录以本地路径安装：

```sh
dsh plugin --profile web add "<本仓库路径>/hover-index"
dsh plugin --profile web add "<本仓库路径>/struct-map"
```

也可从 GitHub 子目录直接安装（若当前 DSH 版本支持 Git 子目录安装）：

```sh
dsh plugin --profile web add github:moyudamowang/dsh-plugins#path=hover-index
dsh plugin --profile web add github:moyudamowang/dsh-plugins#path=struct-map
```

详细需求、配置和边界见各插件的 README。

## Skills

可复用的 DSH skills 放在 [`skills/`](skills/) 下，每个 skill 使用独立子目录和 `SKILL.md`，例如 [`skills/struct-map/SKILL.md`](skills/struct-map/SKILL.md)。

## 仓库布局

```text
hover-index/          DSH 代码符号悬停插件
struct-map/           DSH 结构图插件
skills/<skill-name>/  可复用 DSH skills
```

## 许可证

各子项目按其目录中的 `LICENSE` 文件授权。合集根目录本身仅提供索引和安装说明。
