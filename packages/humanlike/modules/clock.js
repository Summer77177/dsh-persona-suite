/**
 * clock —— 时间感。不落盘，读的是当下。
 */

const PERIOD_STARTS = [
  { from: 1, name: '凌晨' },
  { from: 5, name: '清晨' },
  { from: 8, name: '上午' },
  { from: 11, name: '中午' },
  { from: 13, name: '下午' },
  { from: 17, name: '傍晚' },
  { from: 19, name: '晚上' },
  { from: 23, name: '深夜' },
]

export const PERIOD_NOTES = {
  凌晨: '一天里最安静的一段，人通常已经睡了；还没睡就是熬过头了。',
  清晨: '天刚亮，多数人还在睡。',
  上午: '白天的正事时间，人可能不在。',
  中午: '饭点。',
  下午: '白天的正事时间，人可能不在。',
  傍晚: '收工前后。',
  晚上: '一天里最闲的一段，人通常在。',
  深夜: '该睡了。',
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function periodOf(hour) {
  let name = '深夜'
  for (const item of PERIOD_STARTS) {
    if (hour >= item.from) name = item.name
    else break
  }
  return name
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function clockParts(date = new Date()) {
  const hour = date.getHours()
  const minute = date.getMinutes()
  const passed = hour * 60 + minute
  return {
    date,
    hour,
    minute,
    period: periodOf(hour),
    stamp: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
      + `${pad(hour)}:${pad(minute)}`,
    chineseDate: `${date.getMonth() + 1}月${date.getDate()}日`,
    clock: `${pad(hour)}:${pad(minute)}`,
    weekday: WEEKDAYS[date.getDay()],
    passedMinutes: passed,
    leftMinutes: Math.max(0, 1440 - passed),
  }
}

export function humanMinutes(n) {
  if (n < 60) return `${n} 分钟`
  const h = Math.floor(n / 60)
  const m = n % 60
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

export function clockLine(date = new Date()) {
  const parts = clockParts(date)
  return `${parts.chineseDate} ${parts.clock} ${parts.weekday}，${parts.period}`
}

export function createClock({ cfg }) {
  return {
    tools: [
      {
        name: 'humanlike_clock_now',
        description: '现在几点、几号、星期几，属于一天里的哪个时段，今天还剩多久。'
          + '想知道现在是不是深夜了、离上次说话过了多长时间时用。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            period: { type: 'string' },
            leftMinutes: { type: 'number' },
          },
          required: ['line', 'period', 'leftMinutes'],
        },
        async execute() {
          const parts = clockParts()
          return {
            line: clockLine(),
            period: parts.period,
            leftMinutes: parts.leftMinutes,
            text: `现在是 ${clockLine()}。${PERIOD_NOTES[parts.period]}今天还剩 ${humanMinutes(parts.leftMinutes)}。`,
          }
        },
      },
    ],

    prompt() {
      const line = clockLine()
      const parts = clockParts()
      return [
        '## 时间感',
        '',
        '现在几点，以及这个钟点通常意味着什么。',
        '',
        line,
        '',
        '上面这行记录前缀重建时的钟点。新消息到达时，先看消息头的时间；内部事件也可带钟点。',
        '没有合用的时间信息而需要当前精确钟点时，再用 `humanlike_clock_now`。',
        '',
        '一天是这么分的：',
        '',
        '| 时段 | 起点 | 通常意味着 |',
        '|---|---|---|',
        '| 深夜 | 23:00 | 该睡了 |',
        '| 凌晨 | 01:00 | 一天里最安静的一段，人通常已经睡了；还没睡就是熬过头了 |',
        '| 清晨 | 05:00 | 天刚亮，多数人还在睡 |',
        '| 上午 | 08:00 | 白天的正事时间，人可能不在 |',
        '| 中午 | 11:00 | 饭点 |',
        '| 下午 | 13:00 | 白天的正事时间，人可能不在 |',
        '| 傍晚 | 17:00 | 收工前后 |',
        '| 晚上 | 19:00 | 一天里最闲的一段，人通常在 |',
        '',
        '**时段只是钟点的说法，不替你决定做什么。** 现在这个点该说话还是该沉默，按你自己的性子来。',
        '提这一句是因为你偶尔需要知道：现在是不是深夜了、上一次说话到现在过了多久、今天还剩多少。',
        '',
        `这个点：${PERIOD_NOTES[parts.period]}今天还剩 ${humanMinutes(parts.leftMinutes)}。`,
      ].join('\n')
    },
  }
}
