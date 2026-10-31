/**
 * 配置：键名与默认值沿用上游记忆扩展的设计，
 * 结构上把 `worlds.humanlike.<模块>.<键>` 拍平成 `config.<模块>.<键>`。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_CONFIG = {
  /** 账本目录；空 = $DSH_HOME/humanlike，再退回 ~/.dsh/humanlike */
  dataDir: '',

  /** 交情与情绪 */
  affinity: {
    /** 特别优待的那个人的标识（QQ 号，或 DSH 里的 'master'）。0/'' = 不设 */
    favoredId: 0,
    /** DSH 适配：谁是那个分数固定的人。他的分按 favoredScore 算，不涨不跌 */
    masterWho: 'master',
    favoredScore: 100,
    /** 对那个人的态度，会拼进系统前缀。空 = 不输出这一段，用你自己的设定 */
    favoredSay: '',
    startScore: 0,
    gainPerMessage: 0.4,
    dailyGainCap: 12,
    gainPraise: 0.6,
    gainShare: 0.8,
    lossInsult: 1.5,
    lossHarsh: 3,
    lossHarshNote: '拿身体或外貌开那种玩笑（说了会立刻炸毛的那类）',
    lossCommand: 0.3,
    friendFloor: 55,
    minScore: 0,
    maxScore: 100,
    /** 关系档位表；空数组 = 用内置 DEFAULT_TIERS */
    tiers: [],
    emotionHalfLifeMinutes: 90,
    emotionFloor: 0.15,
    emotionInPrompt: 3,
  },

  /** 学过的词、梗、人 */
  learn: {
    maxNotes: 120,
    /** 保留兼容（前缀不再展开原文） */
    injectCount: 12,
    searchTimeoutMs: 15_000,
    resultsPerSource: 8,
  },

  /** 作息、心情、精力 */
  life: {
    tickMs: 60_000,
    activityMinMinutes: 25,
    activityMaxMinutes: 70,
    moodMinMinutes: 15,
    moodMaxMinutes: 45,
    maxEventsPerDay: 5,
    /** 每次 tick 攒一条小事的概率（0.012 ≈ 每 1.4 小时一件） */
    eventChance: 0.012,
    reachOut: false,
    reachMinGapMinutes: 180,
    reachChance: 0.25,
    reachMinScore: 40,
    reachFavored: true,
    reachFavoredGapMinutes: 55,
    reachFavoredChance: 0.4,
  },

  /** 时间感 */
  clock: {
    announce: 'quiet-hours',
    announceGapMinutes: 30,
  },

  /** 一起过的时间 */
  together: {
    keepDays: 21,
    momentsInPrompt: 6,
    threadsInPrompt: 4,
    threadExpireDays: 14,
    maxMomentsPerDay: 12,
    /** 那个人的标识；填了之后只有他的事进这个账。空 = 谁都可以 */
    favoredKey: 'master',
    /** 账本里怎么称呼他。空 = 直接用 favoredKey */
    favoredName: '',
  },

  /** 它自己惦记的事 */
  mind: {
    tickSec: 60,
    maxPending: 5,
    pushGapSec: 900,
    dailyPushes: 8,
    quietFrom: 23,
    quietTo: 9,
    expireAfterH: 24,
    /** DSH 没有独立唤醒通道，默认不给「自己的时间」 */
    freeTimePerDay: 0,
    freeTimeGapMin: 180,
    digestAt: '',
    digestEvents: 24,
  },

  /** 看得见的事 */
  real: {
    deskGapSec: 60,
    deskProcessFilter: '',
    /** 空 = $DSH_HOME/usage.jsonl */
    usageFile: '',
    /** 空 = 内置价目表 */
    pricingJson: '',
  },

  /** 每段前缀在系统提示里的落点 */
  prompt: {
    order: 100,
  },
}

function pick(source, keys) {
  if (!source || typeof source !== 'object') return undefined
  const out = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function resolveConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')

  const cfg = {
    ...DEFAULT_CONFIG,
    dataDir: typeof input.dataDir === 'string' && input.dataDir.trim()
      ? input.dataDir.trim()
      : join(home, 'humanlike'),
  }

  for (const section of ['affinity', 'learn', 'life', 'clock', 'together', 'mind', 'real', 'prompt']) {
    cfg[section] = { ...DEFAULT_CONFIG[section], ...pick(input[section], Object.keys(DEFAULT_CONFIG[section])) }
  }

  cfg.affinity.favoredScore = numberOr(cfg.affinity.favoredScore, 100)
  cfg.affinity.emotionHalfLifeMinutes = numberOr(cfg.affinity.emotionHalfLifeMinutes, 90)
  cfg.learn.maxNotes = numberOr(cfg.learn.maxNotes, 120)
  cfg.learn.injectCount = numberOr(cfg.learn.injectCount, 12)
  cfg.life.activityMinMinutes = numberOr(cfg.life.activityMinMinutes, 25)
  cfg.life.activityMaxMinutes = numberOr(cfg.life.activityMaxMinutes, 70)
  cfg.clock.announceGapMinutes = numberOr(cfg.clock.announceGapMinutes, 30)
  cfg.together.keepDays = numberOr(cfg.together.keepDays, 21)
  cfg.together.momentsInPrompt = numberOr(cfg.together.momentsInPrompt, 6)
  cfg.together.threadExpireDays = numberOr(cfg.together.threadExpireDays, 14)
  cfg.together.maxMomentsPerDay = numberOr(cfg.together.maxMomentsPerDay, 12)
  cfg.mind.tickSec = numberOr(cfg.mind.tickSec, 60)
  cfg.mind.maxPending = numberOr(cfg.mind.maxPending, 5)
  cfg.mind.pushGapSec = numberOr(cfg.mind.pushGapSec, 900)
  cfg.mind.dailyPushes = numberOr(cfg.mind.dailyPushes, 8)
  cfg.mind.quietFrom = numberOr(cfg.mind.quietFrom, 23)
  cfg.mind.quietTo = numberOr(cfg.mind.quietTo, 9)
  cfg.mind.expireAfterH = numberOr(cfg.mind.expireAfterH, 24)
  cfg.mind.freeTimePerDay = numberOr(cfg.mind.freeTimePerDay, 0)
  cfg.mind.freeTimeGapMin = numberOr(cfg.mind.freeTimeGapMin, 180)
  cfg.mind.digestEvents = numberOr(cfg.mind.digestEvents, 24)
  cfg.real.deskGapSec = numberOr(cfg.real.deskGapSec, 60)
  cfg.prompt.order = numberOr(cfg.prompt.order, 100)

  return cfg
}
