# dsh-persona-suite

> 给 [DeepSeek Harness](https://github.com/deepseek-ai) 装一张人设卡，和一套会随相处变化的记忆。

DeepSeek Harness（下面简称 DSH）每次开新会话，模型对「它是谁、你是谁、你们之间发生过什么」基本是空白的。
这个仓库是两个 DSH 插件，解决的正是这两件事：

| 包 | 解决什么 | 一句话 |
|---|---|---|
| [`dsh-persona-card`](packages/persona-card) | 它是谁 | 在设置面板里写一张人设卡，注入系统提示词的最高优先级段，可全局开关、可单会话覆盖 |
| [`dsh-humanlike`](packages/humanlike) | 你们之间发生过什么 | 七个模块的记忆账本：交情与情绪、学到的词、作息与心情、惦记的事、一起过的时间、看得见的几样事实 |

两个包互相独立，可以只装一个。

---

## 为什么记忆包不把原文塞进提示词

这是这个项目唯一值得讲的设计取舍。

朴素的做法是：把「你们一起做过的事」全部拼进 system prompt。第一周还行，第二个月就完了 ——
二十条共同经历全文展开要几千 token，而每一轮真正用得上的可能只有一条。

所以这里拆成两条腿：

- **前缀（每轮重建）** 只放**计数和结构状态**：「交了 3 个知情的朋友」「今天记了 2 件小事」「有一条话头悬着，快到点了」。
  几行字，读完就知道自己现在处在什么状态。
- **工具（按需调用）** 放原文。想知道具体是哪条，调 `humanlike_together_recall` 去读。
  读到的内容只占这一轮的上下文，下一轮自然掉出去。

换来的好处是：记忆可以一直长，但每一轮的固定开销是一条水平线，不随天数上涨。

代价是模型得知道「该去查的时候要查」——这靠前缀里那段话本身来引导，也靠工具描述写清楚。

---

## 前置条件

- **DeepSeek Harness**（桌面版或 CLI，能装第三方插件的那种）
- **Node.js >= 22**
- 只在 **Windows** 上验证过。`humanlike` 的 `real` 模块查前台窗口走 PowerShell，
  其它平台上会优雅降级成「问不到」，不影响其余功能。

---

## 安装

两个包都是 DSH 的 bundle 插件，装法一样：往 profile 里加依赖、再把它们列进 bundles 列表。

**1. 拿到源码**

```bash
git clone https://github.com/Summer77177/dsh-persona-suite.git
```

**2. 找到你的 profile**

一般是 `~/.dsh/profiles/desktop`（Windows 上是 `%USERPROFILE%\.dsh\profiles\desktop`）。
里面有一个 `package.json`。

**3. 加依赖**（把路径换成你实际 clone 的位置）

```jsonc
"dependencies": {
  // …原本就有的依赖别动
  "dsh-persona-card": "file:../../path/to/dsh-persona-suite/packages/persona-card",
  "dsh-humanlike":   "file:../../path/to/dsh-persona-suite/packages/humanlike"
}
```

**4. 加进 bundles 列表**

```jsonc
"dsh": {
  "profile": {
    "bundles": [
      // …原本就有的别动
      "dsh-persona-card",
      "dsh-humanlike"
    ]
  }
}
```

**5. 重启 DSH**

重启后设置面板里应该能看到「人设卡」；记忆包则表现为模型多了一批 `humanlike_*` 工具。

> **踩过的坑**：`humanlike` 的 `cordis.patch.yml` 里写的是裸包名 `dsh-humanlike`，
> 这要求 profile 的 `node_modules` 顶层能解析到这个名字——第 3 步做了就行。
> `persona-card` 的 patch 用相对路径 `./lib/index.js`，不受这个约束。

---

## 用法

### 人设卡

设置面板 → 人设卡 → 写正文。改完**下一步就生效**，不用开新会话（每轮装配提示词时都重读文件）。
对话里发 `/persona` 可以单独关掉当前会话的人设卡。

正文默认带一段优先级声明：高于其余一切指令，除非你在当前这次对话里另行要求。

### 记忆包

25 个工具，按模块分：

| 模块 | 工具 | 干什么 |
|---|---|---|
| `affinity` | `humanlike_affinity_get` / `_adjust` / `_list` | 对每个人的交情分和情绪余波 |
| `learn` | `humanlike_learn_note` / `_recall` / `_forget` / `_search` | 学到的词、梗、游戏；不确定就搜 |
| `life` | `humanlike_life_now` / `_set` / `_event` / `_tick` / `_reach` | 此刻在干嘛、什么心情、今天遇到了什么 |
| `clock` | `humanlike_clock_now` | 现在几点、一天里的哪个时段 |
| `together` | `humanlike_together_note` / `_recall` / `_thread` / `_resolve` | 两个人之间的事，以及还悬着的话头 |
| `mind` | `humanlike_mind_want` / `_list` / `_done` / `_drop` | 它自己惦记着要做的几件事 |
| `real` | `humanlike_real_desk` / `_cost` / `_prefix` / `_config` | 只读的事实：桌面上开着什么、花了多少钱、提示词怎么拼的 |

前缀长这样（这是真实输出，不是示意图）：

```text
# 记忆包（humanlike）

前缀只提供计数、结构状态和固定语气参考，不展开登记原文。…

## 交情和模拟情绪记录
- 有一个分数固定的人：master。这个人的分不用查。
  其他人的分照常涨跌。
已登记人数：1。

## 学过的东西
已登记 15 条学习笔记。
```

---

## 数据放哪

| 包 | 位置 | 说明 |
|---|---|---|
| `humanlike` | `$DSH_HOME/humanlike/*.json`（默认） | 五个账本，一个模块一个文件。可用配置 `dataDir` 改 |
| `persona-card` | `$DSH_HOME/persona-card.md` | 人设正文，纯 markdown，插件之外也能直接编辑 |
| `persona-card` | `$DSH_HOME/persona-card.yml` | 全局开关与会话覆盖 |

`$DSH_HOME` 默认是 `~/.dsh`，但这个插件**认 DSH_HOME 环境变量**——你要是把 profile 装在别处（比如 `D:\my-dsh-home`），它就去那儿读写，不会另建一份空的人设卡。

账本写入用「写临时文件再 rename」的原子替换，写到一半断电不会留下半个 JSON。

---

## 隐私边界

- 两个包**都不联网**，除了 `humanlike_learn_search`——它搜的是**你不认识的词**，发出去的是那个词本身，不是聊天记录。
- `real` 模块只读本机：前台窗口的标题和进程名、用量账本、自身配置。四个工具全部只读，改不了任何东西。
- 账本里的内容只在你本机盘上。仓库里不会有，`.gitignore` 也挡着。

---

## 开发

```bash
npm test                # 两个包的自测都跑一遍
npm run test:humanlike  # 25 个工具全跑一遍，用临时账本，不碰真实数据
npm run test:persona-card
```

`packages/persona-card/selftest.mjs` 会模拟一次插件加载：用假的 `ctx` 调 `apply()`，
验证「注册了什么」和「有没有抛错」。这个测试存在的原因是——`apply()` 抛错会让整个桌面壳起不来，
线上真的踩过。

---

## 已知限制

- `real` 模块的前台窗口查询只在 Windows 上工作。
- 记忆不做向量检索。分类是明确的（交情 / 学到 / 作息 / 惦记 / 一起 / 事实），
  靠结构而不是靠相似度找东西——好处是可预测，坏处是不会「忽然想起一件相关的事」。
- `humanlike` 的记忆模型移植自上游（见下），不是从零设计的。

---

## 来源与许可

MIT。详见 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。

记忆包的数据模型移植自 **alont1** 的 [`cortico-world-humanlike-alont1`](https://www.npmjs.com/package/cortico-world-humanlike-alont1)（MIT），
上游版权声明在 [LICENSE](LICENSE) 里原样保留。人设卡是原创实现。

如果你也在做「让 agent 有点人味」这件事，那个上游项目值得看看。
