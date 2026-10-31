/**
 * affinity —— 交情与情绪。
 *
 * 好感度是长期的关系分，情绪余波是「刚才那事我还没过去」。
 * 账本落 <dataDir>/affinity.json。
 */
import { shortId } from '../store.js'

/** 一个关系档位。分数落在哪一档，就用哪一档的态度说话。 */
export const DEFAULT_TIERS = [
  { min: 80, name: '好朋友', say: '很亲近。会关心他、会惦记他，软的那面露得多一点' },
  { min: 55, name: '朋友', say: '不用装了。会主动说话、会开玩笑、愿意帮忙' },
  { min: 35, name: '熟人', say: '能聊两句了。会接梗、会搭话，但还端着' },
  { min: 15, name: '眼熟', say: '认识的人。他跟我说话我会接，就是不热络' },
  { min: 0, name: '陌生群友', say: '客气。他跟我说话我回，但话短、别热络，私人问题敷衍过去' },
]

const round1 = (n) => Math.round(n * 10) / 10

export function tierOf(score, tiers = DEFAULT_TIERS) {
  const sorted = [...tiers].sort((a, b) => b.min - a.min)
  return sorted.find((t) => score >= t.min) ?? sorted[sorted.length - 1]
}

function nextTier(score, tiers = DEFAULT_TIERS) {
  const higher = [...tiers].sort((a, b) => a.min - b.min).find((t) => t.min > score)
  return higher ? { tier: higher, need: round1(higher.min - score) } : null
}

function isoNow() {
  return new Date().toISOString()
}

function dayOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function createAffinity({ store, cfg }) {
  const conf = cfg.affinity
  const tiers = () => (Array.isArray(conf.tiers) && conf.tiers.length > 0 ? conf.tiers : DEFAULT_TIERS)

  const makeDefault = () => ({ version: 1, people: {} })
  let data = makeDefault()

  const key = (who) => String(who ?? '').trim()

  const isFavored = (who) => {
    const id = key(who)
    if (!id) return false
    if (conf.masterWho && id === conf.masterWho) return true
    const numeric = Number(id)
    return conf.favoredId !== 0 && Number.isFinite(numeric) && numeric === Number(conf.favoredId)
  }

  const scoreOf = (who, rec) => (isFavored(who) ? conf.favoredScore : rec.score)

  const ensure = (who) => {
    const id = key(who)
    let rec = data.people[id]
    if (!rec) {
      const start = isFavored(id) ? conf.favoredScore : conf.startScore
      rec = { score: start, msgs: 0, best: start, firstAt: '', lastAt: '', note: '' }
      data.people[id] = rec
    }
    return rec
  }

  const decayedIntensity = (emotion) => {
    const elapsed = Date.now() - Date.parse(emotion.peakAt)
    if (!Number.isFinite(elapsed) || elapsed <= 0) return emotion.intensity
    return emotion.intensity * Math.pow(0.5, elapsed / emotion.halfLifeMs)
  }

  const liveEmotions = (rec) => (rec.emotions ?? [])
    .map((e) => ({ e, now: decayedIntensity(e) }))
    .filter((x) => x.now >= conf.emotionFloor)

  const recordEmotion = (rec, delta, reason) => {
    const intensity = Math.min(1, Math.max(0.3, Math.abs(delta) / 3))
    const emotion = {
      kind: delta < 0 ? 'upset' : 'happy',
      intensity: round1(intensity),
      reason: reason || '（没记原因）',
      peakAt: isoNow(),
      halfLifeMs: conf.emotionHalfLifeMinutes * 60_000,
    }
    rec.emotions = [emotion, ...(rec.emotions ?? [])].slice(0, 3)
  }

  const describe = (who, rec) => {
    const id = key(who)
    if (isFavored(id)) {
      const fixed = [`${id}：分数固定 ${conf.favoredScore}，不进涨跌。`]
      if (conf.favoredSay) fixed.push(`态度：${conf.favoredSay}`)
      fixed.push('这个是固定的，不会掉，也不需要理由。')
      return fixed.join('\n')
    }
    const score = scoreOf(id, rec)
    const tier = tierOf(score, tiers())
    const lines = [
      `${id}：好感 ${round1(score)} / 100，档位「${tier.name}」，聊过 ${rec.msgs} 句。`,
      `态度：${tier.say}`,
    ]
    const up = nextTier(score, tiers())
    if (up) lines.push(`再涨 ${up.need} 分进「${up.tier.name}」档。`)
    if (rec.best >= conf.friendFloor) lines.push(`他做过朋友，所以掉不破 ${conf.friendFloor} 分。`)
    if (rec.note) lines.push(`上次变动：${rec.note}`)

    const live = liveEmotions(rec)
    if (live.length) {
      const first = live[0]
      const mins = Math.max(0, Math.round((Date.now() - Date.parse(first.e.peakAt)) / 60_000))
      const feel = first.e.kind === 'upset' ? '还有点气' : '还挺高兴'
      const fresh = mins < 60 ? `${mins} 分钟前` : `${Math.round(mins / 60)} 小时前`
      lines.push(`情绪：${fresh}${first.e.reason ? `因为「${first.e.reason}」` : ''}，你现在${feel}（${round1(first.now * 100)}%）`)
    }
    return lines.join('\n')
  }

  const emotionBlock = () => {
    const rows = []
    for (const [who, rec] of Object.entries(data.people)) {
      for (const { e, now } of liveEmotions(rec)) {
        rows.push({
          who,
          kind: e.kind,
          strength: Math.round(now * 100),
          minutes: Math.max(0, Math.round((Date.now() - Date.parse(e.peakAt)) / 60_000)),
        })
      }
    }
    if (!rows.length) return ''
    rows.sort((a, b) => b.strength - a.strength)
    const lines = ['模拟情绪记录（是否及如何回应由 Persona 结合上下文决定）：']
    for (const row of rows.slice(0, conf.emotionInPrompt)) {
      lines.push(`${row.who}：类型 ${row.kind}，当前强度 ${row.strength}%，记录距今 ${row.minutes} 分钟。`)
    }
    lines.push('原始原因请用 humanlike_affinity_get 按需核对；记录不证明相关事件真实发生。')
    return lines.join('\n')
  }

  const favoredHint = () => (conf.favoredId === 0 && !conf.masterWho ? '' : `分数固定的那个人是 ${conf.masterWho || conf.favoredId}。`)

  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  return {
    async ensure() {
      data = await store.read('affinity', makeDefault)
    },

    tools: [
      {
        name: 'humanlike_affinity_get',
        description: '查某个人跟你的交情：多少分、什么档位、该用什么态度对他。'
          + '这段上下文里查过的人不用再查，分数变了以 adjust 的返回为准。重复查询不加分。'
          + '对方的标识在消息里；分数固定的那个人是 ' + (conf.masterWho || 'master') + '。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            who: { type: 'string', description: `对方的标识（QQ 号或 '${conf.masterWho || 'master'}'）。${favoredHint()}` },
          },
          required: ['who'],
        },
        outputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        async execute(args) {
          const id = key(args.who)
          if (!id) return { text: '[bad input] who 不能是空的' }
          const rec = ensure(id)
          await store.write('affinity', data)
          return { text: describe(id, rec) }
        },
      },
      {
        name: 'humanlike_affinity_adjust',
        description: '记一笔交情的变化。他做了让你高兴或生气的事，就调一下他的分数，并写一句为什么。'
          + `普通搭话已由扩展自动记分，不要再手动加；每日加分上限 ${conf.dailyGainCap}。参考：夸你／说好话 +${conf.gainPraise}；`
          + `跟你分享他自己的事 +${conf.gainShare}；骂你（笨／傻／滚）-${conf.lossInsult}；`
          + `**${conf.lossHarshNote} -${conf.lossHarsh}**；命令式使唤 -${conf.lossCommand}。`
          + '别为了讨好谁乱加分——你现在怎么记的，以后就怎么对他。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            who: { type: 'string', description: '对方的标识。' },
            delta: { type: 'number', description: '变化量，正数涨、负数跌。一次不要超过 ±3。' },
            reason: { type: 'string', description: '为什么变。一句话。他看不到，是给你自己以后看的。' },
          },
          required: ['who', 'delta'],
        },
        outputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        async execute(args) {
          const id = key(args.who)
          const delta = num(args.delta)
          const reason = String(args.reason ?? '').trim()
          if (!id) return { text: '[bad input] who 不能是空的' }
          if (delta === null || delta === 0) return { text: '[bad input] delta 要是非零数字' }
          if (Math.abs(delta) > 3) return { text: '[bad input] 一次最多 ±3，要更多就分几次' }
          if (isFavored(id)) return { text: `这个人的分数固定在 ${conf.favoredScore}，不进涨跌。` }

          const rec = ensure(id)
          const before = rec.score
          let next = before + delta

          if (delta > 0) {
            const today = dayOf()
            if (rec.day !== today) {
              rec.day = today
              rec.gainedToday = 0
            }
            const room = Math.max(0, conf.dailyGainCap - (rec.gainedToday ?? 0))
            next = before + Math.min(delta, room)
          }

          if (rec.best >= conf.friendFloor && next < conf.friendFloor) next = conf.friendFloor
          next = Math.min(conf.maxScore, Math.max(conf.minScore, next))

          rec.score = round1(next)
          rec.best = Math.max(rec.best, rec.score)
          const applied = round1(rec.score - before)
          if (applied > 0) rec.gainedToday = round1((rec.gainedToday ?? 0) + applied)
          if (applied !== 0) {
            if (reason) rec.note = `${applied > 0 ? '+' : ''}${applied} ${reason}`
            recordEmotion(rec, applied, reason)
          }
          await store.write('affinity', data)

          if (applied === 0) {
            return { text: `${rec.score} → ${rec.score}\n分数未变：已达${delta > 0 ? '每日加分上限或分数上限' : '分数下限或朋友保底'}。` }
          }
          const from = tierOf(before, tiers()).name
          const to = tierOf(rec.score, tiers()).name
          const bumped = from !== to ? `（${from} → **${to}**）` : ''
          const feel = applied < 0 ? '你现在还有点气，别装作没事' : '你现在心情不错，这股劲会持续一阵'
          return {
            text: `${round1(before)} → ${rec.score}${bumped}\n现在：${tierOf(rec.score, tiers()).say}\n（${feel}）`,
          }
        },
      },
      {
        name: 'humanlike_affinity_list',
        description: '看看你心里排前面的几个人。想知道"我跟他熟不熟"的全局时用。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        async execute() {
          const rows = Object.entries(data.people)
            .map(([who, rec]) => ({ who, rec, score: scoreOf(who, rec) }))
            .sort((a, b) => b.score - a.score)
          if (!rows.length) return { text: '还没有记下任何人。' }
          const top = rows.slice(0, 25)
          const lines = top.map(({ who, rec, score }, i) => {
            const label = isFavored(who) ? '固定' : tierOf(score, tiers()).name
            return `${i + 1}. ${who} — ${round1(score)} 分 · ${label} · 聊过 ${rec.msgs} 句`
          })
          if (rows.length > top.length) lines.push(`…另外还有 ${rows.length - top.length} 个人`)
          return { text: lines.join('\n') }
        },
      },
    ],

    prompt() {
      if (!data) return ''
      const favoredLine = (!conf.favoredId && !conf.masterWho)
        ? '- 没有分数固定的人：所有人都按分数说话。\n'
        : `- 有一个分数固定的人：${conf.masterWho || conf.favoredId}。这个人的分不用查。\n`
          + (conf.favoredSay ? `  对这个人：${conf.favoredSay}\n` : '')
          + '  其他人的分照常涨跌。\n'
      const emotions = emotionBlock()
      return [
        '## 交情和模拟情绪记录',
        '',
        favoredLine,
        `已登记人数：${Object.keys(data.people).length}。`,
        '',
        emotions || '（当前没有有效模拟情绪记录。）',
        '',
        'humanlike_affinity_get 可查询分数、分类及原始原因。humanlike_affinity_adjust 可登记有依据的交情变化；'
        + '普通消息的基础计分由扩展处理，不重复人工加分。情绪枚举、强度和时间只是记录，是否及如何回应由 Persona '
        + '结合当前对话与人物设定决定，不要求反击或采用特定语气。',
        '',
        `本包账本保存在 \`${store.dir}\` 下，不读取或改写 Persona Memory。`,
      ].join('\n')
    },
  }
}
