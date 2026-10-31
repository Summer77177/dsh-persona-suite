/**
 * 冒烟测试：把 7 个模块的 ensure 和 25 个工具全部跑一遍，
 * 用工作区临时目录当账本，不碰真实 $DSH_HOME/humanlike。
 *
 * 跑法：node test.mjs <临时账本目录>
 */
import { resolveConfig } from './config.js'
import { createStore } from './store.js'
import { createAffinity } from './modules/affinity.js'
import { createLearn } from './modules/learn.js'
import { createLife } from './modules/life.js'
import { createClock } from './modules/clock.js'
import { createTogether } from './modules/together.js'
import { createMind } from './modules/mind.js'
import { createReal } from './modules/real.js'

const dir = process.argv[2]
if (!dir) {
  console.error('用法：node test.mjs <账本目录>')
  process.exit(2)
}

const cfg = resolveConfig({ dataDir: dir })
const store = createStore(cfg.dataDir)
const reports = {
  prefix: () => '[prefix 报告占位]',
  config: () => '[config 报告占位]',
}

const modules = {
  affinity: createAffinity({ store, cfg }),
  learn: createLearn({ store, cfg }),
  life: createLife({ store, cfg }),
  clock: createClock({ store, cfg }),
  together: createTogether({ store, cfg }),
  mind: createMind({ store, cfg }),
  real: createReal({ store, cfg, reports }),
}

const ok = []
const bad = []

for (const [name, mod] of Object.entries(modules)) {
  try {
    await mod.ensure?.()
    ok.push(`ensure ${name}`)
  } catch (error) {
    bad.push(`ensure ${name}: ${error?.message ?? error}`)
  }
}

// 收集全部工具
const tools = new Map()
for (const [name, mod] of Object.entries(modules)) {
  for (const tool of mod.tools ?? []) tools.set(tool.name, { tool, module: name })
}

const calls = {
  humanlike_affinity_get: { who: 'master' },
  humanlike_affinity_adjust: { who: 'master', delta: 2, reason: '测试一下加分' },
  humanlike_affinity_list: {},
  humanlike_learn_note: { kind: 'term', key: '破防', meaning: '心理防线被击破', usage: '他一输游戏就说，带自嘲，不是真生气' },
  humanlike_learn_recall: {},
  humanlike_learn_forget: { key: '压根没学过的词' },
  humanlike_life_now: {},
  humanlike_life_set: { activity: '在调一个插件，快好了' },
  humanlike_life_event: { text: '今天把插件装上了' },
  humanlike_life_tick: {},
  humanlike_life_reach: {},
  humanlike_clock_now: {},
  humanlike_together_note: { text: '一起把 humanlike 搬进 DSH', who: 'master' },
  humanlike_together_recall: {},
  humanlike_mind_want: { text: '试试新插件好不好用', why: '想知道有没有白写', afterMinutes: 30 },
  humanlike_mind_list: {},
  humanlike_real_desk: {},
  humanlike_real_cost: {},
  humanlike_real_prefix: {},
  humanlike_real_config: {},
}

for (const [name, args] of Object.entries(calls)) {
  const entry = tools.get(name)
  if (!entry) {
    bad.push(`缺少工具 ${name}`)
    continue
  }
  try {
    const value = await entry.tool.execute(args, {})
    const text = typeof value?.text === 'string' ? value.text : JSON.stringify(value)
    ok.push(`${name} → ${text.replace(/\n/g, ' ⏎ ').slice(0, 150)}`)
  } catch (error) {
    bad.push(`${name}: ${error?.message ?? error}`)
  }
}

// 依赖上一步产出的工具
const mindId = (() => {
  const list = tools.get('humanlike_mind_list')
  return list ? null : null
})()

for (const name of ['humanlike_mind_list']) {
  const entry = tools.get(name)
  if (!entry) continue
  try {
    const value = await entry.tool.execute({}, {})
    const text = String(value?.text ?? '')
    const match = /\[(m\d+)\]/.exec(text)
    if (match) {
      for (const follow of ['humanlike_mind_done', 'humanlike_mind_drop']) {
        const target = tools.get(follow)
        if (!target) continue
        try {
          const result = await target.tool.execute({ id: match[1] }, {})
          ok.push(`${follow}(follow) → ${String(result?.text ?? '').replace(/\n/g, ' ⏎ ').slice(0, 120)}`)
        } catch (error) {
          bad.push(`${follow}(follow): ${error?.message ?? error}`)
        }
      }
    }
  } catch (error) {
    bad.push(`${name}(second): ${error?.message ?? error}`)
  }
}

// thread / resolve
const threadEntry = tools.get('humanlike_together_thread')
if (threadEntry) {
  const threadTool = threadEntry.tool
  try {
    const result = await threadTool.execute({ text: '他说明天要交的东西还没弄完', who: 'master' }, {})
    ok.push(`thread → ${String(result?.text ?? '').replace(/\n/g, ' ⏎ ').slice(0, 120)}`)
    const recall = tools.get('humanlike_together_recall')
    const value = await recall.tool.execute({}, {})
    const match = /\[(t\d+|thr-\d+)\]/i.exec(String(value?.text ?? ''))
    if (match) {
      const resolveTool = tools.get('humanlike_together_resolve')
      const done = await resolveTool.tool.execute({ id: match[1] }, {})
      ok.push(`resolve → ${String(done?.text ?? '').replace(/\n/g, ' ⏎ ').slice(0, 120)}`)
    }
  } catch (error) {
    bad.push(`together_thread: ${error?.message ?? error}`)
  }
}

// 各模块 prompt
for (const [name, mod] of Object.entries(modules)) {
  try {
    const text = mod.prompt?.() ?? ''
    ok.push(`prompt ${name}: ${text.length} 字`)
  } catch (error) {
    bad.push(`prompt ${name}: ${error?.message ?? error}`)
  }
}

console.log('=== OK ===')
for (const line of ok) console.log('  ' + line)
if (bad.length) {
  console.log('=== FAIL ===')
  for (const line of bad) console.log('  ' + line)
  process.exitCode = 1
} else {
  console.log('=== 全部通过 ===')
}
