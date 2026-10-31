/**
 * mind —— 它自己惦记的事。
 *
 * 这个模块只做一件事：把**她自己记下的「我想做点什么」按她定的时间还给她**。
 * 它不生成任何一句话——推回去的正文是她写下的原文，所以她不会被安上没说过的话；
 * 它也不替她决定做不做，到点只是提醒「这是你自己说的」。
 *
 * 账本落 <dataDir>/mind.json。
 */
const RECENT_CAP = 30
const TEXT_MAX = 200
const WHY_MAX = 200
const ABOUT_MAX = 40

const freshData = () => ({
  version: 1,
  items: [],
  recent: [],
  day: '',
  pushesToday: 0,
  lastPushAt: 0,
  freeToday: 0,
  lastFreeAt: 0,
  lastDigestDay: '',
})

function isoNow(date = new Date()) {
  return date.toISOString()
}

function today(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function clockText(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '（时间未知）'
  const mm = String(date.getMonth() + 1)
  const dd = String(date.getDate())
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

export function createMind({ store, cfg }) {
  const conf = cfg.mind
  const startedAt = Date.now()

  let data = freshData()
  let nextId = 1

  const persist = () => { void store.write('mind', data) }

  const pending = () => data.items

  const retire = (item, patch) => {
    Object.assign(item, patch)
    data.items = data.items.filter((i) => i.id !== item.id)
    data.recent = [item, ...data.recent].slice(0, RECENT_CAP)
  }

  const inQuietHours = (date = new Date()) => {
    const from = conf.quietFrom
    const to = conf.quietTo
    if (from === to) return false
    const h = date.getHours() % 24
    if (from > to) return h >= from || h < to
    return h >= from && h < to
  }

  /** 一次 tick：跨天重置 → 过期清理 → 标记到点。 */
  const runTick = () => {
    const day = today()
    if (data.day !== day) {
      data.day = day
      data.pushesToday = 0
      data.freeToday = 0
      persist()
    }

    const expireMs = Math.max(1, conf.expireAfterH) * 3_600_000
    const now = Date.now()
    let changed = false
    for (const item of [...data.items]) {
      if (!item.pushedCount || !item.lastPushedAt) continue
      const at = Date.parse(item.lastPushedAt)
      if (!Number.isFinite(at) || now - at < expireMs) continue
      retire(item, { droppedAt: isoNow() })
      changed = true
    }
    if (changed) persist()
  }

  return {
    async ensure() {
      const raw = await store.read('mind', freshData)
      const items = Array.isArray(raw.items)
        ? raw.items.filter((i) => i && typeof i.text === 'string')
          .map((i) => ({ ...i, pushedCount: Number.isFinite(i.pushedCount) ? i.pushedCount : 0 }))
        : []
      const recent = Array.isArray(raw.recent) ? raw.recent.slice(0, RECENT_CAP) : []
      const maxId = Math.max(
        0,
        ...[...items, ...recent]
          .map((i) => Number(String(i.id ?? '').replace(/^m/, '')))
          .filter((n) => Number.isFinite(n)),
      )
      data = {
        version: 1,
        items,
        recent,
        day: typeof raw.day === 'string' ? raw.day : '',
        pushesToday: Number.isFinite(raw.pushesToday) ? raw.pushesToday : 0,
        lastPushAt: Number.isFinite(raw.lastPushAt) ? raw.lastPushAt : 0,
        freeToday: Number.isFinite(raw.freeToday) ? raw.freeToday : 0,
        lastFreeAt: Number.isFinite(raw.lastFreeAt) ? raw.lastFreeAt : 0,
        lastDigestDay: typeof raw.lastDigestDay === 'string' ? raw.lastDigestDay : '',
      }
      nextId = maxId + 1
      runTick()

      const timer = setInterval(runTick, Math.max(10, conf.tickSec) * 1000)
      timer.unref?.()
    },

    tools: [
      {
        name: 'humanlike_mind_want',
        description: '记一件：**想做什么**、**为什么**、（可选）**关于谁**、**什么时候提醒你**。'
          + '挂着的是你心里真放着的事，不是待办清单。理由要写——写不出为什么，多半就是不必记。'
          + `手上同时最多 ${conf.maxPending} 件，攒多了那不叫你。`,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', maxLength: TEXT_MAX, description: '一句话：你想做什么（上限 200 字）' },
            why: { type: 'string', maxLength: WHY_MAX, description: '为什么想做——没有理由的事不值得记（上限 200 字）' },
            about: { type: 'string', maxLength: ABOUT_MAX, description: '可选：这事关于谁，或者要发给谁（写对方的标识）。到点会原样提醒你' },
            afterMinutes: {
              type: 'integer',
              minimum: 1,
              maximum: 20160,
              description: '多少分钟之后提醒我（1 分钟 ~ 14 天）',
            },
            atTime: { type: 'string', description: '或者直接给钟点，形如 "21:30"；已经过了就是明天这个点' },
          },
          required: ['text', 'why'],
        },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(args) {
          const text = str(args.text)
          const why = str(args.why)
          if (!text) return { text: 'text 不能为空——要记的是你想做的那件事。' }
          if (!why) return { text: 'why 不能为空——没有理由的事不值得占一个位置。' }

          const limit = Math.max(1, conf.maxPending)
          if (pending().length >= limit) {
            const lines = pending().map((i) => `- [${i.id}] ${i.text}`)
            return {
              text: `已经惦记着 ${pending().length} 件了（上限 ${limit}）。先 humanlike_mind_done 或 humanlike_mind_drop 掉一件，\n`
                + `或者干脆别记——手上这些做完了再说。\n${lines.join('\n')}`,
            }
          }

          let dueAt
          const after = Number(args.afterMinutes)
          if (Number.isFinite(after) && after > 0) {
            dueAt = isoNow(new Date(Date.now() + Math.min(after, 20160) * 60_000))
          } else {
            const at = str(args.atTime)
            const match = /^(\d{1,2}):(\d{2})$/.exec(at)
            if (match) {
              const hh = Number(match[1])
              const mm = Number(match[2])
              if (hh <= 23 && mm <= 59) {
                const target = new Date()
                target.setHours(hh, mm, 0, 0)
                if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1)
                dueAt = isoNow(target)
              }
            }
          }

          const about = str(args.about)
          const item = {
            id: `m${nextId++}`,
            text: text.slice(0, TEXT_MAX),
            why: why.slice(0, WHY_MAX),
            createdAt: isoNow(),
            pushedCount: 0,
          }
          if (about) item.about = about.slice(0, ABOUT_MAX)
          if (dueAt) item.dueAt = dueAt
          data.items.push(item)
          await store.write('mind', data)

          return {
            text: dueAt
              ? `记下了 [${item.id}]：${item.text}\n到点（${clockText(new Date(Date.parse(dueAt)))}）我会把你这句话还给你一次，做不做那时候再说。`
              : `记下了 [${item.id}]：${item.text}\n没定时间——它只挂在 humanlike_mind_list 里，你想起来的时候自己看。`,
          }
        },
      },
      {
        name: 'humanlike_mind_list',
        description: '看看手上还挂着什么、最近了结了什么。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute() {
          const now = Date.now()
          const head = pending().length
            ? pending().map((i) => {
              const when = i.dueAt
                ? (Date.parse(i.dueAt) <= now ? '**已到点**' : `到点 ${clockText(new Date(Date.parse(i.dueAt)))}`)
                : '没定时间'
              return `- [${i.id}] ${i.text}${i.about ? `（关于 ${i.about}）` : ''}\u3000${when}\u3000（因为：${i.why}）`
            }).join('\n')
            : '（手上没有惦记的事——这很正常。）'
          const recent = data.recent.slice(0, 8).map((i) => `- [${i.id}] ${i.text}\u3000→ ${
            i.doneAt ? `做完了${i.outcome ? `：${i.outcome}` : ''}` : i.droppedAt ? '放下了' : '过期了'
          }`).join('\n')
          return {
            text: `还惦记着的（${pending().length}/${conf.maxPending}）：\n${head}${recent ? `\n\n最近了结的：\n${recent}` : ''}`,
          }
        },
      },
      {
        name: 'humanlike_mind_done',
        description: '做完了，顺手记一句结果。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: '条目编号，如 m1' },
            outcome: { type: 'string', maxLength: TEXT_MAX, description: '可选：后来怎么了' },
          },
          required: ['id'],
        },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(args) {
          const raw = str(args.id).replace(/^\[|\]$/g, '')
          const item = data.items.find((i) => i.id === raw)
          if (!item) return { text: `没有编号 ${raw} 这一条（用 humanlike_mind_list 看编号）。` }
          const outcome = str(args.outcome)
          retire(item, { doneAt: isoNow(), ...(outcome ? { outcome: outcome.slice(0, TEXT_MAX) } : {}) })
          await store.write('mind', data)
          return { text: `了了 [${raw}]：${item.text}${outcome ? `\n（记了一句：${outcome}）` : ''}` }
        },
      },
      {
        name: 'humanlike_mind_drop',
        description: '不想做了，放掉。放下也是回答，别让它在账上反复出现。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string', description: '条目编号，如 m1' } },
          required: ['id'],
        },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(args) {
          const raw = str(args.id).replace(/^\[|\]$/g, '')
          const item = data.items.find((i) => i.id === raw)
          if (!item) return { text: `没有编号 ${raw} 这一条（用 humanlike_mind_list 看编号）。` }
          retire(item, { droppedAt: isoNow() })
          await store.write('mind', data)
          return { text: `放下了 [${raw}]：${item.text}` }
        },
      },
    ],

    prompt() {
      const now = Date.now()
      const live = pending()
      const due = live.filter((i) => i.dueAt && Date.parse(i.dueAt) <= now)
      const summary = live.length
        ? `记着 ${live.length} 件，其中 ${due.length} 件已到点。用 humanlike_mind_list 查看条目内容。`
        : '（现在没有惦记着的事——这很正常。）'

      return [
        '## 它自己惦记的事',
        '',
        '这里是你自己的账，不是待办清单。挂着的是**你心里真放着的事**：',
        '',
        summary,
        ...(due.length ? ['', '**已到点的**：' + due.map((i) => `[${i.id}] ${i.text}`).join('；')] : []),
        '',
        '### 怎么用',
        '',
        `- \`humanlike_mind_want\` —— 记一件：**想做什么**、**为什么**、（可选）**关于谁**、**什么时候提醒你**`,
        '  （`afterMinutes` 40 就是四十分钟后；`atTime` "21:30" 就是今晚九点半，过了就是明天）。',
        '- `humanlike_mind_list` —— 看看手上还挂着什么、最近了结了什么。',
        '- `humanlike_mind_done` —— 做完了，顺手记一句结果。',
        '- `humanlike_mind_drop` —— 不想做了，放掉。',
        '',
        '到点我会把你写下的那句话**原样还给你一次**——不是催你，也不是替你说，就是提醒你',
        '"这是你自己说的"。**那一刻做不做还是你定**：想动手就动手（发消息使用当前渠道已提供的发送工具；',
        '没有发送工具时不假装发出），不想做就 `humanlike_mind_drop`。**没做也是一种回答**，过一天它自己会清掉。',
        '',
        '### 几条分寸',
        '',
        `- **别排满。** 手上同时最多 ${conf.maxPending} 件，攒多了那不叫我。真心里挂着才记。`,
        '- **理由要写。** 写不出为什么，多半就是不必记。',
        '- **一件只提醒一次。** 所以别指望它当闹钟反复叫你——到点那一下之后，靠你自己。',
        `- **夜里不响。** ${conf.quietFrom} 点到 ${conf.quietTo} 点那个点攒着，早上再说。`,
      ].join('\n')
    },
  }
}
