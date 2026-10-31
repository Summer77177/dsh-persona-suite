# 来源与致谢

## 移植来源

`packages/humanlike` 的记忆模型移植自 **cortico-world-humanlike-alont1**
（npm 包同名，版本 0.2.0），原作者 **alont1**，MIT 许可。

具体来说，下面这些东西是从那份实现搬过来的，不是凭空设计：

- 五个账本的数据形状与落盘约定（`affinity` / `learn` / `life` / `together` / `mind` 各一个 JSON）
- 配置项的键名与默认值（好感度涨跌幅度、每日上限、情绪半衰期、惦记的静默时段……）
- 分档算法（`tierOf` / `nextTier`）与分数保留一位小数的取整方式
- 「前缀只放计数与结构状态，原文靠工具按需读」这个信息架构

移植时的改动：

- TypeScript → 纯 ESM JavaScript，去掉全部类型标注
- 宿主从上游的 world 运行时改为 DeepSeek Harness 的 Cordis 插件上下文（`ctx.tools` / `ctx.systemPrompt`）
- `clock` 与 `real` 两个模块在 DSH 侧重写（读的是当下事实，不落盘）
- 工具全部重新命名并统一成 `humanlike_*` 前缀
- 新增双语 locale、图标、冒烟测试

上游 MIT 许可要求保留版权声明，那条声明在根目录 `LICENSE` 里原样保留，**不删不改**。

## 原创的部分

`packages/persona-card` 是原创实现，没有上游。它的几条设计约束——段落 order 取 -100、
`apply()` 任何一步失败都不抛错、路由单例登记防重复注册——来自一次真实的启动失败排查，
细节写在 `packages/persona-card/README.md`。
