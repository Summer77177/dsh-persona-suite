# dsh-humanlike

> 一套会随相处变化的记忆，给 [DeepSeek Harness](https://github.com/deepseek-ai) 里那个陪你说话的模型。

模型每轮都在重新认识你。它记得你说过要早睡，但它不知道自己三天前答应过要问你交没交。
这个插件补的就是这一段：**让「你们之间发生过什么」能累积下来，而且不把上下文撑爆**。

七个模块，各管一段：

| 模块 | 管什么 | 落盘 |
|---|---|---|
| `affinity` | 对每个人的交情分，以及「刚才那事我还没过去」的情绪余波 | `affinity.json` |
| `learn` | 学到的词、梗、游戏、某个人 | `learn.json` |
| `life` | 此刻在干嘛、什么心情、精力、今天遇到了什么 | `life.json` |
| `clock` | 现在几点、一天里的哪个时段 | 不落盘 |
| `together` | 你和某个特定的人之间的事，以及还悬着的话头 | `together.json` |
| `mind` | 它自己惦记着要做的几件事 | `mind.json` |
| `real` | 只读的几样事实：桌面上开着什么、花了多少钱、前缀怎么拼的 | 不落盘 |

`clock` 和 `real` 不落盘是有意的：它们读的是**当下的事实**，不是账。存下来就成了假话。

---

## 两条腿

```
        ┌──────────────────────────────────────────┐
每轮 ──▶│ systemPrompt.section('humanlike-memory') │
        │  只放计数与结构状态："学了 15 条"        │
        └──────────────────────────────────────────┘
                            ▲
      读内存快照，同步求值   │   写盘
                            │
        ┌──────────────────────────────────────────┐
        │  tools：humanlike_* ← 模型自己读写账本    │
        └──────────────────────────────────────────┘
```

- **前缀**（`index.js` 里注册的那个 section）每轮重建，只读内存快照、同步求值，不在这里等 IO。
  所以它不会拖慢对话，代价是可能落后一次 tick。
- **工具**负责真正的内容。想知道「上一次聊到几点」，模型得自己调 `humanlike_together_recall`，
  读到的原文只占那一轮的上下文。

这样记忆可以一直长，固定开销却是水平线。

---

## 文件结构

```
index.js          插件入口：注册工具、挂系统前缀
config.js         全部配置项与默认值
store.js          落盘层：每本账一个 JSON，内存缓存 + 原子写
modules/
  affinity.js     交情与情绪
  learn.js        学到的词（含联网搜索）
  life.js         作息与心情
  clock.js        时间感
  together.js     一起过的时间
  mind.js         它自己惦记的事
  real.js         看得见的事
locale/{zh,en}.json
icon.svg
cordis.patch.yml  告诉 DSH 怎么装这个 bundle
test.mjs          冒烟测试：25 个工具全跑一遍
```

---

## 数据结构

每个账本就是一个 JSON 文件，`store.js` 读的时候用 `mergeDefaults` 补老版本缺的字段
（升级不炸老数据），写的时候先写 `.tmp` 再 `rename`（断电不留半个文件）。

```jsonc
// together.json
{
  "version": 1,
  "moments": [ { "id": "m1", "at": "2026-10-31T07:22:00.000Z", "kind": "session", "text": "…" } ],
  "threads": [ { "id": "t1", "text": "…", "open": true, "dueAt": "2026-11-01T00:00:00.000Z" } ],
  "perDay": { "2026-10-31": 3 },
  "nextThreadId": 2
}
```

账本目录默认 `$DSH_HOME/humanlike`，没有 `DSH_HOME` 就退回 `~/.dsh/humanlike`。

---

## 配置

完整默认值在 [`config.js`](config.js)。挑几个值得改的：

```jsonc
{
  "dataDir": "",                  // 空 = $DSH_HOME/humanlike

  "affinity": {
    "masterWho": "master",        // 谁是分数固定的那个人——他的分不涨不跌
    "favoredScore": 100,          // 固定分
    "favoredSay": "",             // 对这个人的态度，会拼进前缀；空 = 用你自己的人设
    "gainPerMessage": 0.4,        // 普通一句话涨多少
    "dailyGainCap": 12,           // 一天最多涨多少，防刷分
    "lossInsult": 1.5,            // 被骂掉多少
    "emotionHalfLifeMinutes": 90  // 情绪余波多久衰减一半
  },

  "life": {
    "reachOut": false,            // 允不允许它自己主动找你
    "reachFavored": true,         // 对分数固定的人可以更频繁地找
    "eventChance": 0.012          // 每分钟攒一件小事的概率（≈1.4 小时一件）
  },

  "mind": {
    "maxPending": 5,              // 手上同时最多惦记几件
    "quietFrom": 23, "quietTo": 9 // 这个区间不响
  },

  "real": {
    "deskGapSec": 60              // 查前台窗口的最小间隔
  }
}
```

`reachOut` 默认是 **false**。自己主动找人这件事，得你自己决定要不要开。

---

## 写一个新模块

模块就是个对象，接口只有四个字段：

```js
export function createWeather({ store, cfg }) {
  const data = store.read('weather.json', { days: [] })

  return {
    // 可选。异步预热，比如加载 locale
    async ensure() { /* … */ },

    // 必须。返回这一轮进系统提示的文本。只读内存，别在这等 IO。
    prompt() {
      if (!data.days.length) return ''
      return `## 天气\n记着 ${data.days.length} 天的天气。`
    },

    // 必须。工具阵列，格式同 DSH 的 ctx.tools.register
    tools: [{
      name: 'humanlike_weather_now',
      description: '读今天记下的天气。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        return store.write('weather.json', data)  // 记得写回
      },
    }],
  }
}
```

然后在 `index.js` 的 `modules` 数组里加一行。就这么多。

> 坑：`prompt()` 是**同步**调用的，整个前缀拼装在同一个事件循环里跑完。
> 在里面 `await` 任何东西都会让这一段变空，而不是变慢。

---

## 测试

```bash
node test.mjs .tmp-ledger
```

25 个工具全跑一遍，用临时账本目录，碰不到真实数据。输出会告诉你每个模块的前缀多长：

```
affinity  418 字
learn     800 字
life      535 字
clock     539 字
together 1070 字
mind      647 字
real      400 字
```

这是一份设计约束的体检表——**前缀超了，不是文件长了，是信息架构坏了**，该往工具里挪。

---

## 隐私

- 账本只在你本机盘上，不上传、不同步。
- 唯一联网的是 `humanlike_learn_search`：它去 B站/贴吧/萌娘百科搜一个词，
  发出去的是**那个词本身**，不是聊天记录。超时 15 秒，单源最多取 8 条。
- `real` 的四个工具全部只读，改不了任何东西。

---

## 来源

MIT。数据模型移植自 **alont1** 的 [`cortico-world-humanlike-alont1`](https://www.npmjs.com/package/cortico-world-humanlike-alont1)（MIT），
搬了什么、改了什么写在仓库根的 [NOTICE.md](../../NOTICE.md)。
