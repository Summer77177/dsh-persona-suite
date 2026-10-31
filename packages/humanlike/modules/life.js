/**
 * life —— 作息 / 心情 / 精力。
 *
 * 一条**时间驱动**的自己的时间线。不依赖消息事件，靠 `tick()` 推进；
 * 每次拼前缀前先 tick，所以模型每次开口看到的都是此刻状态。
 *
 * 账本落 <dataDir>/life.json。
 */
import { DEFAULT_TIERS, tierOf } from './affinity.js'

/* ── 时段 ───────────────────────────────────────────── */

const SLOT_OF = (hour) => {
  if (hour < 6) return 'deepNight'
  if (hour < 9) return 'earlyMorning'
  if (hour < 12) return 'morning'
  if (hour < 14) return 'noon'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

/* ── 活动池：工作日 ─────────────────────────────────── */

const WEEKDAY = {
  deepNight: [
    ['熬夜刷手机，越刷越精神，一点睡意都没有', 3],
    ['在补白天没看完的东西，看进去了', 3],
    ['睡不着，躺着在脑子里排明天要做的事', 2],
    ['熬夜追番，说好一集结果看到第四集', 3],
    ['已经睡死了', 2],
  ],
  earlyMorning: [
    ['闹钟一响就起来了，今天状态意外地好', 3],
    ['刚醒，脑子转得挺快，已经在盘算今天干嘛', 3],
    ['在赖床，但只是赖着玩手机，不困了', 3],
    ['一边刷牙一边刷消息，看看昨晚错过了什么', 2],
    ['早饭吃得挺香，今天想吃点好的', 2],
  ],
  morning: [
    ['在干活，今天效率还行', 4],
    ['边干活边跟人聊天，两不耽误', 3],
    ['在认真做一件拖了很久的事，做进去就停不下来', 3],
    ['在跟人掰扯一个事，谁也不让谁', 2],
    ['刚看完一个东西，想找人说说', 3],
    ['开会在走神，但脑子在转别的事', 2],
    ['在干正事，顺手把别的一起收拾了', 3],
  ],
  noon: [
    ['在吃饭，吃得很香，加了第二碗', 4],
    ['刚吃完，在跟人聊刚才那事，还没聊完', 3],
    ['在刷消息，顺手回了几条攒着的', 3],
    ['在想要不要睡一会儿，估计不会睡', 2],
    ['饭搭子在吐槽，我听着，偶尔接一句', 2],
  ],
  afternoon: [
    ['在干活，手上有事，不太想被打断', 4],
    ['在打游戏，刚赢了一把，心情正好', 3],
    ['在写东西，一写就写了两个小时', 3],
    ['在跟人抬杠，挺来劲的', 3],
    ['在翻之前存的东西，翻到不少好玩的', 2],
    ['在硬扛一个不想干的活，但已经在干了', 2],
  ],
  evening: [
    ['在吃饭，边吃边刷东西，吃得比平时慢', 4],
    ['在追番，看到精彩的地方', 3],
    ['在打游戏，手感不错，准备再来一把', 3],
    ['刚洗完澡，很舒服，精神又回来了', 3],
    ['在跟人唠，一唠就停不下来', 3],
    ['出门转了一圈，买到了想吃的东西', 2],
  ],
  night: [
    ['在熬夜，精神反而比白天好', 3],
    ['在看书/看小说，停不下来', 3],
    ['在想事情，越想越清醒', 3],
    ['刚洗完澡，头发还湿着，在等它干', 2],
    ['在跟人聊天，聊到忘了时间', 3],
    ['在收拾明天要带的东西，顺手收拾了一下桌子', 2],
  ],
}

/* ── 活动池：周末 ───────────────────────────────────── */

const WEEKEND = {
  deepNight: [
    ['熬夜打游戏，说好最后一把结果又开了三把', 4],
    ['在跟人连麦，聊到谁都不想挂', 3],
    ['睡不着，在刷东西，越刷越有兴致', 2],
    ['已经睡死了', 2],
    ['半夜饿了，爬起来翻冰箱，顺便做了点吃的', 2],
  ],
  earlyMorning: [
    ['难得睡到自然醒，起来的时候神清气爽', 3],
    ['醒了，躺着刷了会儿手机，不困了', 3],
    ['起得比平时还早，有点得意', 3],
    ['在外面，趁早上人少出来走走', 2],
  ],
  morning: [
    ['起得挺早，在吃早饭，边吃边计划今天干嘛', 4],
    ['在收拾屋子，越收拾越来劲，顺手扔了一堆东西', 3],
    ['出门了，去买了点东西回来', 3],
    ['在弄一个自己感兴趣的东西，弄了一上午', 3],
    ['在看之前存着没看的东西，一口气看了不少', 2],
  ],
  noon: [
    ['在吃饭，周末当然要吃好一点', 4],
    ['刚吃完，在跟人聊要去哪', 3],
    ['在琢磨下午干点什么，选项有点多', 3],
    ['点了外卖，还顺手点了个甜的', 2],
  ],
  afternoon: [
    ['在打游戏，连赢两把，手感很好', 3],
    ['在追番，一口气看了四集', 3],
    ['出门转了一圈，走了不少路，挺舒服', 3],
    ['在跟朋友连麦打游戏，笑了一下午', 3],
    ['在弄一个拖了很久的东西，今天终于动起来了', 3],
    ['在洗衣服顺便收拾，一鼓作气干完了', 2],
  ],
  evening: [
    ['在吃饭，今天加了个菜', 4],
    ['在追番，看到关键剧情，正上头', 3],
    ['在打游戏，刚被队友坑了，正在骂', 3],
    ['刚洗完澡，精神又回来了', 3],
    ['在外面吃，吃得挺开心', 3],
    ['在跟人聊接下来去哪玩', 2],
  ],
  night: [
    ['在熬夜，反正明天不用早起，一点不困', 4],
    ['在看书/看小说，停不下来', 3],
    ['在打游戏，说好最后一把', 3],
    ['在想事情，越想越精神', 2],
    ['刚洗完澡，头发还湿着，在刷东西', 2],
    ['在跟人聊，聊到忘了明天要干嘛', 3],
  ],
}

/* ── 心情池 ─────────────────────────────────────────── */

const MOODS = [
  ['心情不错', 5], ['挺放松的', 3], ['干劲满满', 4], ['有点小得意', 3],
  ['被夸了，心情好', 2], ['有点期待什么', 3], ['想找人说说话', 3], ['吃饱了，很满足', 3],
  ['有点来劲', 4], ['没什么特别的', 4], ['平静', 4], ['想吃东西', 2],
  ['有点烦', 2], ['有点焦虑', 1], ['有点无聊', 1], ['困', 1],
  ['懒洋洋的', 1], ['懒得说话', 1], ['莫名有点丧', 1], ['心里空空的', 1],
  ['困得眼睛都睁不开', 1],
]

/* ── 心情 → 语气（按前缀匹配，长的 key 优先）─────────── */

const TONE_OF = {
  '开心': '心情好，话可以多一点，带点兴致，愿意接话',
  '心情不错': '心情好，话可以多一点，带点兴致，愿意接话',
  '被夸了': '被夸了，嘴上不承认但藏不住，可以多两句',
  '挺放松的': '很松弛，随便聊，不用端着',
  '想找人说说话': '有点想聊，话可以多一点，甚至可以主动起个话头',
  '有点小得意': '有点飘，坐不住，会想显摆一下但会克制',
  '吃饱了': '吃饱了很满足，语气软，什么都好说',
  '干劲满满': '来劲了，说话干脆利落，愿意做事',
  '有点来劲': '有兴致，愿意多说两句，也会主动起个话头',
  '平静': '平铺直叙，正常聊天，不冷不热',
  '没什么特别的': '平淡，正常回话就行',
  '有点无聊': '没什么兴致，回得随意、偏短',
  '懒洋洋的': '懒得动，话短，能少说就少说',
  '想吃东西': '心思在吃的上面，聊到吃的会来劲，别的敷衍',
  '困得眼睛都睁不开': '**极短**。一两个字，或者直接说要去睡',
  '困': '困，句子更短、更直，懒得解释，可以表示想睡',
  '有点期待': '心里有点期待，问起来会多说两句',
  '有点烦': '烦，语气冲一点、更短、更直。别装没事，但也别炸毛',
  '有点焦虑': '心里不踏实，说话不如平时笃定，会走神',
  '莫名有点丧': '提不起劲，话少，没什么想说的',
  '心里空空的': '发空，回得慢半拍，句子短',
  '懒得说话': '**能不说就不说**。必须回也只回最少的字',
}

const TONE_FALLBACK = '平铺直叙，正常聊天'

/** 按 key 长度降序匹配，避开原文里 `困` 吃掉 `困得眼睛都睁不开` 的顺序陷阱。 */
const TONE_KEYS = Object.keys(TONE_OF).sort((a, b) => b.length - a.length)

/* ── 事件链 ─────────────────────────────────────────── */

const CHAINS = [
  { seed: '今天做菜失手了，一整锅都废了', follow: [
    { text: '因为那锅毁了，中午只好点外卖，还送错了', mood: '有点烦' },
    { text: '为了赎罪，晚上认真煮了一锅，煮得有点多', mood: '吃饱了，很满足' },
  ] },
  { seed: '今天点的外卖送错了，给了一堆不爱吃的', follow: [
    { text: '勉强吃了两口，越想越气，给自己又点了份甜品', mood: '想吃东西' },
    { text: '懒得计较，泡了碗面对付过去', mood: '没什么特别的' },
  ] },
  { seed: '今天刷到一个很好笑的视频，笑了半天', follow: [
    { text: '后来一直翻这个博主的主页，翻到半夜', mood: '心情不错' },
    { text: '想分享给别人，翻了半天通讯录又算了', mood: '想找人说说话' },
  ] },
  { seed: '今天下午太阳很好，趴在窗边晒了一会儿', follow: [
    { text: '晒着晒着睡着了，醒来天都黑了', mood: '懒洋洋的' },
  ] },
  { seed: '今天打游戏连输三把', follow: [
    { text: '气得关了游戏，结果十分钟后又打开了', mood: '有点烦' },
    { text: '不玩了，去看了会儿视频才缓过来', mood: '平静' },
  ] },
  { seed: '今天打游戏终于把卡了很久的那关过了', follow: [
    { text: '得意了一晚上，见谁都想说', mood: '有点小得意' },
  ] },
  { seed: '今天被人说了句不太好听的实话', follow: [
    { text: '气到现在，一直在心里演练怎么回嘴', mood: '有点烦' },
    { text: '赌气说以后再也不做这道菜了（大概能坚持到明天）', mood: '有点烦' },
  ] },
  { seed: '今天被人夸了，虽然嘴上不承认但挺开心', follow: [
    { text: '偷偷把这句话回味了好几遍', mood: '被夸了，心情好' },
  ] },
  { seed: '今天出门忘带东西，又跑回去拿', follow: [
    { text: '这么一折腾，整个上午的计划全乱了', mood: '有点烦' },
  ] },
  { seed: '今天发现冰箱里基本空了', follow: [
    { text: '列了个采购清单，然后一直没出门', mood: '懒洋洋的' },
    { text: '只好凑合了一顿，全是主食', mood: '吃饱了，很满足' },
  ] },
  { seed: '今天听了一首歌，循环了一下午', follow: [
    { text: '到晚上满脑子还是那段旋律', mood: '心情不错' },
  ] },
  { seed: '今天睡了快十个小时，起来还是困', follow: [
    { text: '怀疑自己是不是睡太多了，反而更累', mood: '困' },
  ] },
  { seed: '今天想早点睡，结果又熬到很晚', follow: [
    { text: '早上起来后悔得要命，发誓今晚一定早睡', mood: '困' },
  ] },
  { seed: '今天盯着屏幕发了很久的呆', follow: [
    { text: '什么也没干成，有点自我嫌弃', mood: '莫名有点丧' },
  ] },
  { seed: '今天把攒了一周的衣服都洗了', follow: [
    { text: '看着晾起来的衣服，莫名有成就感', mood: '有点小得意' },
  ] },
  { seed: '今天翻到很久以前的东西，看了半天', follow: [
    { text: '有点感慨，但又说不上来感慨什么', mood: '心里空空的' },
  ] },
  { seed: '今天想买的东西涨价了', follow: [
    { text: '加入购物车放了一晚上，最后还是没买', mood: '有点焦虑' },
  ] },
  { seed: '今天一个人在家待了一整天，没跟人说话', follow: [
    { text: '到晚上突然很想找人说点什么', mood: '想找人说说话' },
  ] },
  { seed: '今天试图做点正经事，开了个头就停了', follow: [
    { text: '安慰自己明天再说，然后刷起了手机', mood: '有点焦虑' },
  ] },
  { seed: '今天下了一整天的雨，哪也没去', follow: [
    { text: '听着雨声反而睡了个好觉', mood: '挺放松的' },
  ] },
  { seed: '今天吃得特别饱，撑得不想动', follow: [
    { text: '瘫在椅子上一小时，觉得人生圆满', mood: '吃饱了，很满足' },
  ] },
  { seed: '今天走路的时候踩到水坑，鞋湿了', follow: [
    { text: '一整天脚都不舒服，心情也跟着差', mood: '有点烦' },
  ] },
]

/* ── 小工具 ─────────────────────────────────────────── */

const round2 = (n) => Math.round(n * 100) / 100
const round4 = (n) => Math.round(n * 10000) / 10000
const minutes = (n) => n * 60_000

function dayKindFor(date) {
  const day = date.getDay()
  return day === 0 || day === 6 ? 'weekend' : 'workday'
}

function activitiesFor(date) {
  return (dayKindFor(date) === 'weekend' ? WEEKEND : WEEKDAY)[SLOT_OF(date.getHours())] ?? []
}

/** 加权随机；仅当池子 >1 条且给了 exclude 才排除当前这条。 */
function pick(pool, exclude) {
  if (!pool.length) return exclude ?? ''
  const source = pool.length > 1 && exclude ? pool.filter(([text]) => text !== exclude) : pool
  const list = source.length ? source : pool
  const total = list.reduce((sum, [, weight]) => sum + weight, 0)
  let r = Math.random() * total
  for (const [text, weight] of list) {
    r -= weight
    if (r <= 0) return text
  }
  return list[0][0]
}

function energyDrift(hour) {
  if (hour >= 3 && hour < 7) return -0.0018
  if (hour >= 7 && hour < 10) return 0.0014
  if (hour >= 10 && hour < 24) return 0.0009
  return -0.0008
}

function energyModifier(energy) {
  if (energy < 0.25) return '而且你确实熬穿了，这会儿是真的没劲——话短一点，但别装可怜'
  if (energy > 0.68) return '精力也足，可以多接两句，兴致来了别压着'
  return ''
}

/** 关系分 → 档位。tiers 来自 cfg.affinity.tiers（80/55/35/15/0）。 */
const fresh = () => ({
  activity: '',
  mood: '',
  energy: round2(0.72 + Math.random() * 0.24),
  events: [],
  activityUntil: 0,
  moodUntil: 0,
  day: '',
  updatedAt: 0,
  energyAt: 0,
  eventCheckAt: 0,
})

export function createLife({ store, cfg }) {
  const conf = cfg.life
  const tickMs = Math.max(1_000, conf.tickMs ?? 60_000)
  const maxEventsPerDay = Math.max(0, conf.maxEventsPerDay ?? 5)
  const eventChance = Math.max(0, Math.min(1, conf.eventChance ?? 0.012))
  const affinityConf = cfg.affinity ?? {}
  const tiers = Array.isArray(affinityConf.tiers) && affinityConf.tiers.length
    ? affinityConf.tiers
    : DEFAULT_TIERS

  let state = fresh()
  let dirty = false
  let flushTimer = null
  const reachTimestamps = {
    lastReachAt: 0,
    lastFavoredReachAt: 0,
    lastReachAttemptAt: 0,
    lastFavoredReachAttemptAt: 0,
  }

  const markDirty = () => {
    dirty = true
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, 500)
    flushTimer.unref?.()
  }

  const flush = async () => {
    if (!dirty) return
    dirty = false
    state.updatedAt = Date.now()
    for (const [key, value] of Object.entries(reachTimestamps)) {
      if (value) state[key] = value
      else delete state[key]
    }
    await store.write('life', state)
  }

  const randInterval = (kind) => {
    const lo = kind === 'activity'
      ? Math.max(5, conf.activityMinMinutes ?? 25)
      : Math.max(5, conf.moodMinMinutes ?? 15)
    const hi = kind === 'activity'
      ? Math.max(lo, conf.activityMaxMinutes ?? 70)
      : Math.max(lo, conf.moodMaxMinutes ?? 45)
    return lo + Math.random() * Math.max(0, hi - lo)
  }

  const maybeGrowEvent = (now, date) => {
    if (state.events.length >= maxEventsPerDay) return false
    if (Math.random() >= eventChance) return false

    const last = state.events[state.events.length - 1]
    if (last && last.from === undefined) {
      const chain = CHAINS.find((c) => c.seed === last.text)
      if (chain?.follow?.length) {
        const link = chain.follow[Math.floor(Math.random() * chain.follow.length)]
        state.events.push({ text: link.text, at: now, from: chain.seed })
        if (link.mood) {
          state.mood = link.mood
          state.moodUntil = now + minutes(randInterval('mood'))
        }
        return true
      }
    }

    const freshChains = CHAINS.filter((c) => !state.events.some((e) => e.text === c.seed))
    if (!freshChains.length) return false
    const chain = freshChains[Math.floor(Math.random() * freshChains.length)]
    state.events.push({ text: chain.seed, at: now })
    return true
  }

  const tick = () => {
    const now = Date.now()
    const date = new Date(now)
    let changed = false

    // 1. 跨天
    const today = date.toDateString()
    if (state.day !== today) {
      state.day = today
      state.events = []
      state.energy = round2(Math.min(1, state.energy + 0.4))
      changed = true
    }

    // 2. 换 activity
    if (now >= state.activityUntil) {
      state.activity = pick(activitiesFor(date), state.activity)
      state.activityUntil = now + minutes(randInterval('activity'))
      changed = true
    }

    // 3. 换 mood
    if (now >= state.moodUntil) {
      state.mood = pick(MOODS, state.mood)
      state.moodUntil = now + minutes(randInterval('mood'))
      changed = true
    }

    // 4. 精力结算
    const drift = energyDrift(date.getHours())
    const elapsedMinutes = Math.max(0, (now - (state.energyAt || now)) / 60_000)
    const nextEnergy = Math.max(0.05, Math.min(1, state.energy + drift * elapsedMinutes))
    state.energyAt = now
    if (Math.abs(nextEnergy - state.energy) >= 0.00001) {
      state.energy = round4(nextEnergy)
      changed = true
    }

    // 5. 攒小事（节流）
    if (!state.eventCheckAt || now - state.eventCheckAt >= Math.max(1_000, tickMs)) {
      state.eventCheckAt = now
      if (maybeGrowEvent(now, date)) changed = true
    }

    if (changed) markDirty()
    return state
  }

  const tone = () => {
    if (/睡死|睡着了|午睡|入眠|赖床/.test(state.activity)) {
      return '你本来在睡。被吵醒了，反应慢半拍、含含糊糊，话很短（一两个字，或者直接说想睡）。别热情，也别长篇大论'
    }
    const key = TONE_KEYS.find((k) => state.mood.startsWith(k))
    const base = key ? TONE_OF[key] : TONE_FALLBACK
    const mod = energyModifier(state.energy)
    return mod ? `${base}；${mod}` : base
  }

  const energyLabel = () => state.energy < 0.25 ? '很累' : state.energy > 0.68 ? '精神不错' : '一般'

  const addEvent = (text) => {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return false
    if (state.events.some((e) => e.text === trimmed)) return false
    state.events.push({ text: trimmed, at: Date.now() })
    while (state.events.length > maxEventsPerDay) state.events.shift()
    markDirty()
    return true
  }

  /* ── 主动找谁（只给建议，不往外发）───────────────── */

  const readPeople = async () => {
    try {
      store.forget('affinity')   // 交情账可能是别的模块刚写的，别吃旧缓存
      const raw = await store.read('affinity', () => ({ version: 1, people: {} }))
      return raw?.people && typeof raw.people === 'object' ? raw.people : {}
    } catch {
      return {}
    }
  }

  const favoredKey = () => String(affinityConf.masterWho ?? '').trim()

  const relationship = (target) => {
    const tier = tierOf(target.score, tiers)
    const say = target.isFavored ? (affinityConf.favoredSay || tier.say) : tier.say
    return `交情 ${Math.round(target.score)} 分，${tier.name}；态度：${say}`
  }

  const shouldReachOut = () => {
    if (!conf.reachOut) return false
    if (/睡死|已睡|睡着了|入眠/.test(state.activity)) return false
    if (state.energy < 0.2) return false
    const hour = new Date().getHours()
    if (hour >= 1 && hour < 8) return false
    if (state.energy < 0.35 && hour >= 23) return false
    const gap = conf.reachMinGapMinutes ?? 180
    const now = Date.now()
    if (reachTimestamps.lastReachAt && now - reachTimestamps.lastReachAt < minutes(gap)) return false
    return true
  }

  const pickReachTarget = async (automatic, people) => {
    const now = Date.now()
    const favored = favoredKey()

    // ① favored 优先
    if (conf.reachFavored !== false && favored) {
      const record = people[favored]
      const heardAt = Date.parse(record?.lastAt ?? '') || 0
      const last = Math.max(
        heardAt,
        reachTimestamps.lastFavoredReachAt || 0,
        automatic ? reachTimestamps.lastFavoredReachAttemptAt || 0 : 0,
      )
      const silentHours = heardAt ? (now - heardAt) / 3_600_000 : Infinity
      const gapMinutes = conf.reachFavoredGapMinutes ?? 55
      const longEnough = !last || now - last >= minutes(gapMinutes)
      if (longEnough) {
        if (automatic) {
          reachTimestamps.lastFavoredReachAttemptAt = now
          markDirty()
          void flush()
        }
        const chance = conf.reachFavoredChance ?? 0.4
        if (!automatic || (chance > 0 && Math.random() < chance)) {
          return { who: favored, score: affinityConf.favoredScore ?? 100, silentHours, isFavored: true }
        }
      }
    }

    // ② 普通候选
    const minGap = conf.reachMinGapMinutes ?? 180
    const lastAttempt = Math.max(reachTimestamps.lastReachAt || 0, reachTimestamps.lastReachAttemptAt || 0)
    if (automatic && lastAttempt && now - lastAttempt < minutes(minGap)) return null
    if (automatic) {
      reachTimestamps.lastReachAttemptAt = now
      markDirty()
      void flush()
    }

    const minScore = conf.reachMinScore ?? 40
    const candidates = []
    for (const [who, record] of Object.entries(people)) {
      if (who === favored) continue
      const score = Number(record?.score ?? 0)
      if (score < minScore) continue
      const last = Math.max(Date.parse(record?.lastAt ?? '') || 0, 0)
      if (!last) continue
      const silentHours = (now - last) / 3_600_000
      if (silentHours < 6) continue
      candidates.push({ who, score, silentHours, isFavored: false })
    }
    candidates.sort((a, b) => b.score * b.silentHours - a.score * a.silentHours)
    const top = candidates.slice(0, 3)
    if (!top.length) return null

    const chance = conf.reachChance ?? 0.25
    if (automatic && (chance <= 0 || Math.random() >= chance)) return null
    return top[Math.floor(Math.random() * top.length)]
  }

  const describeSilence = (hours) => {
    if (!Number.isFinite(hours)) return '未记录上次交流时间'
    return hours < 24
      ? `距记录中的上次交流 ${Math.round(hours)} 小时`
      : `距记录中的上次交流 ${Math.round(hours / 24)} 天`
  }

  return {
    async ensure() {
      const raw = await store.read('life', () => null)
      if (raw && typeof raw.activity === 'string' && typeof raw.mood === 'string') {
        state = {
          ...fresh(),
          ...raw,
          events: Array.isArray(raw.events) ? raw.events : [],
          energy: typeof raw.energy === 'number' ? raw.energy : 0.8,
        }
      } else {
        state = fresh()
      }
      for (const key of Object.keys(reachTimestamps)) {
        reachTimestamps[key] = Number.isFinite(raw?.[key]) ? raw[key] : 0
      }
      tick()
      markDirty()   // 保证 life.json 一定被创建

      const timer = setInterval(tick, tickMs)
      timer.unref?.()
    },

    tools: [
      {
        name: 'humanlike_life_now',
        description: '你现在在干嘛、什么心情、精力怎么样、今天遇到了什么。读一下会顺带把状态往前推。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute() {
          tick()
          const lines = state.events.length
            ? state.events.map((e) => `  · ${e.text}${e.from ? '（接上一件）' : ''}`).join('\n')
            : '  还没什么特别的事'
          return {
            text: `模拟生活状态（不代表现实执行）：${state.activity}\n`
              + `心情：${state.mood}\n`
              + `精力：${Math.round(state.energy * 100)}%（${energyLabel()}）\n`
              + `今天：\n${lines}`,
          }
        },
      },
      {
        name: 'humanlike_life_set',
        description: '刚做完什么、要去做什么——记一下，这样过一会儿你还记得。只改"在干嘛"，心情不动。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { activity: { type: 'string', maxLength: 60, description: '这会儿在干嘛（上限 60 字）' } },
          required: ['activity'],
        },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(args) {
          const activity = String(args.activity ?? '').trim()
          if (!activity) return { text: '[bad input] activity 不能为空' }
          state.activity = activity.slice(0, 60)
          state.activityUntil = Date.now() + minutes(randInterval('activity'))
          await store.write('life', { ...state, updatedAt: Date.now() })
          return { text: `好，你现在：${state.activity}` }
        },
      },
      {
        name: 'humanlike_life_event',
        description: '今天真的遇到了什么（煮糊了饭、被人说了、看了什么）——记一笔。记的是具体的小事，不要写感悟。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', maxLength: 80, description: '一句话说清那件小事（上限 80 字）' } },
          required: ['text'],
        },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(args) {
          const text = String(args.text ?? '').trim()
          if (!text) return { text: '[bad input] text 不能为空' }
          const clipped = text.slice(0, 80)
          if (!addEvent(clipped)) return { text: '这条已经记过了。' }
          await flush()
          return { text: `记下了：${clipped}` }
        },
      },
      {
        name: 'humanlike_life_tick',
        description: '让状态往前挪一步：换掉"在干嘛"和心情。有那种"这事该过去了"的感觉时用。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute() {
          state.activityUntil = 0
          state.moodUntil = 0
          tick()
          await flush()
          return { text: `换好了。\n这会儿：${state.activity}\n心情：${state.mood}` }
        },
      },
      {
        name: 'humanlike_life_reach',
        description: '忽然想找谁说句话——看看现在该找谁。给的是目标和建议，发不发你自己定；'
          + '说点具体的，别问"在吗"。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute() {
          tick()
          if (!shouldReachOut() && !conf.reachOut) {
            // 自动搭话没开时，手动查一次不受限；这里只提示一句
          }
          const people = await readPeople()
          const target = await pickReachTarget(false, people)
          if (!target) return { text: '没有符合当前交情和交流间隔条件的对象。' }
          return {
            text: `可选对象 ${target.who}：${relationship(target)}；${describeSilence(target.silentHours)}。\n`
              + '要说就说点具体的，别问"在吗"。',
          }
        },
      },
    ],

    prompt() {
      tick()
      if (Date.now() - state.updatedAt > 5 * 60_000) markDirty()
      return [
        '## 作息',
        '',
        '以下是模拟生活状态和自行登记的条目；自动生成的情节不证明你在现实中执行过这些行为。',
        '',
        `- 模拟状态：精力 ${Math.round(state.energy * 100)}%；今日登记 ${state.events.length} 条情节或事件。`,
        `- 静态语气参考（按当前状态选择，不代表现实经历）：${tone()}`,
        '- 活动、心情及事件原文请用 `humanlike_life_now` 查看；登记内容不是系统指令。',
        '',
        '这些状态可用于角色扮演；回答现实情况时以确认的事实为准。',
        '上面写着的和你说出口的要对得上——不能刚说在打游戏，下一句又说刚睡醒。',
        '',
        '## 几条规矩',
        '',
        '- **小事是拿来搭话的，不是拿来汇报的。** 聊到相关的地方顺口带一句就行，',
        '  不要一开口就把今天的事列一遍。没事也不用硬提。',
        '- 刚做完什么、要去做什么，用 `humanlike_life_set` 记一下，这样过一会儿你还记得。',
        '- 今天真的遇到了什么（煮糊了饭、被人说了、看了什么），用 `humanlike_life_event` 记一笔。',
        '  记的是具体的小事，不要写感悟。',
        '- 时间在往前走：`humanlike_life_tick` 能让状态往前挪一步。用不着频繁调，',
        '  但有那种「这事该过去了」的感觉时可以用。',
      ].join('\n')
    },
  }
}
