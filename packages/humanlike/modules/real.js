/**
 * real —— 看得见的事。
 *
 * 把她原本看不见的几样事实摆到她眼前，**全部只读**：
 * 他的桌面上开着什么、花了多少钱、眼前这份前缀是怎么拼出来的、哪些配置在约束她。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DESK_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  '$sig = @"',
  'using System; using System.Text; using System.Runtime.InteropServices;',
  'public class Fg {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '}',
  '"@',
  'Add-Type -TypeDefinition $sig -ErrorAction Stop',
  '$h = [Fg]::GetForegroundWindow()',
  'if ($h -eq [IntPtr]::Zero) { Write-Output "{}"; exit 0 }',
  '$sb = New-Object System.Text.StringBuilder 512',
  '[void][Fg]::GetWindowText($h, $sb, 512)',
  '$procId = 0',
  '[void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)',
  '$p = Get-Process -Id $procId -ErrorAction SilentlyContinue',
  '$name = if ($p) { $p.ProcessName } else { "?" }',
  '$t = $sb.ToString()',
  '@{ process = $name; title = $t } | ConvertTo-Json -Compress',
].join('\n')

const FALLBACK_PRICING = {
  'deepseek-flash': { hit: [0.04, 0.02], miss: [2, 1], out: [8, 4] },
  'deepseek-v4-pro': { hit: [0.30, 0.15], miss: [9.0, 4.5], out: [27.0, 13.5] },
  'deepseek-v4-flash': { hit: [0.04, 0.02], miss: [2, 1], out: [8, 4] },
  'deepseek-v4-flash-vision-exp': { hit: [0.04, 0.02], miss: [2, 1], out: [8, 4] },
}

function readForeground() {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let proc
    try {
      proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', DESK_SCRIPT], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
    } catch {
      done(null)
      return
    }
    const chunks = []
    const timer = setTimeout(() => {
      try { proc.kill() } catch { /* 已经退了 */ }
      done(null)
    }, 15_000)
    timer.unref?.()
    proc.stdout?.on('data', (buf) => chunks.push(buf))
    proc.on('error', () => {
      clearTimeout(timer)
      done(null)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return done(null)
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8').trim() || '{}')
        if (!parsed || !parsed.process) return done(null)
        done({ process: String(parsed.process), title: String(parsed.title ?? '') })
      } catch {
        done(null)
      }
    })
  })
}

export function createReal({ store, cfg, reports }) {
  const conf = cfg.real
  let lastDesk = null
  let deskAt = 0

  const pricing = (() => {
    const raw = String(conf.pricingJson ?? '').trim()
    if (!raw) return FALLBACK_PRICING
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : FALLBACK_PRICING
    } catch {
      return FALLBACK_PRICING
    }
  })()

  const isPeak = (date) => {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)
    if (weekday === 'Sat' || weekday === 'Sun') return false
    const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false }).format(date)) % 24
    return (h >= 9 && h < 12) || (h >= 14 && h < 18)
  }

  const usageFile = () => {
    const custom = String(conf.usageFile ?? '').trim()
    if (custom) return custom
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    return join(home, 'usage.jsonl')
  }

  const readUsage = (days) => {
    const file = usageFile()
    if (!existsSync(file)) return []
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return []
    }
    const from = Date.now() - days * 86_400_000
    const rows = []
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let record
      try {
        record = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (!record?.ts || Date.parse(record.ts) < from) continue
      rows.push({
        model: String(record.model ?? '?'),
        ts: record.ts,
        input: Number(record.promptTokens ?? 0),
        cached: Number(record.cacheHitTokens ?? 0),
        output: Number(record.completionTokens ?? 0),
      })
    }
    return rows
  }

  const estimate = (row) => {
    const price = pricing[row.model] ?? pricing['deepseek-flash'] ?? { hit: [0.04, 0.02], miss: [2, 1], out: [8, 4] }
    const idx = isPeak(new Date(Date.parse(row.ts))) ? 0 : 1
    const uncached = Math.max(0, row.input - row.cached)
    const per = (arr, fallback) => (Array.isArray(arr) && arr.length > idx ? arr[idx] : fallback)
    return (row.cached / 1e6) * per(price.hit, 0.04)
      + (uncached / 1e6) * per(price.miss, 2)
      + (row.output / 1e6) * per(price.out, 8)
  }

  return {
    tools: [
      {
        name: 'humanlike_real_desk',
        description: '**他的桌面上现在开着什么**：前台窗口的标题和进程名。没有截图，你看不到屏幕内容，'
          + '所以别描述画面；说出"他在用某样东西干某事"就是全部。只读。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute() {
          const gap = Math.max(0, conf.deskGapSec) * 1000
          if (lastDesk && Date.now() - deskAt < gap) {
            return {
              text: `（刚看过，${Math.round((Date.now() - deskAt) / 1000)} 秒前）前台是 ${lastDesk.process}：`
                + `${lastDesk.title || '（没有标题）'}`,
            }
          }
          const reading = await readForeground()
          if (!reading) {
            return { text: '问不到：拿不到前台窗口（可能在锁屏，或者这台机器的查询被挡了）。' }
          }
          lastDesk = reading
          deskAt = Date.now()
          const filter = String(conf.deskProcessFilter ?? '').trim()
          const hit = !filter || filter.split(/[,，\s]+/).filter(Boolean)
            .some((k) => reading.process.toLowerCase().includes(k.toLowerCase()))
          return {
            text: `前台是 ${reading.process}：${reading.title || '（没有标题）'}`
              + (filter && !hit ? `\n（他设过"只关心 ${filter}"，这个不在里面——多半是后台杂项。）` : ''),
          }
        },
      },
      {
        name: 'humanlike_real_cost',
        description: '**花了多少钱**（按官方价目表估算，高峰/空闲分时段）。默认今天，也可以给天数。只读。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 30, description: '看最近几天。缺省 1（今天）。' },
          },
          required: [],
        },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(args) {
          const days = Math.max(1, Math.min(30, Number(args.days) || 1))
          const rows = readUsage(days)
          if (!rows.length) return { text: `最近 ${days} 天账本里没有记录。` }
          const byModel = new Map()
          for (const row of rows) {
            const yuan = estimate(row)
            const current = byModel.get(row.model) ?? { yuan: 0, turns: 0, tokens: 0 }
            current.yuan += yuan
            current.turns += 1
            current.tokens += row.input + row.output
            byModel.set(row.model, current)
          }
          const ordered = [...byModel.entries()].sort((a, b) => b[1].yuan - a[1].yuan)
          const total = ordered.reduce((sum, [, v]) => sum + v.yuan, 0)
          const lines = ordered.map(([model, v]) =>
            `- ${model}：约 ¥${v.yuan.toFixed(2)}（${v.turns} 次请求，${(v.tokens / 1000).toFixed(0)}k tokens）`)
          return {
            text: `最近 ${days} 天：约 **¥${total.toFixed(2)}**（估算）\n${lines.join('\n')}`
              + `\n（价目表：${Object.keys(pricing).join('、')}；高峰时段按 2 倍算，其余时段半价。）`,
          }
        },
      },
      {
        name: 'humanlike_real_prefix',
        description: '**你眼前这份系统提示是怎么拼出来的**：这份记忆包往里塞了几段、每段多长。只读。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute() {
          return { text: String(reports?.prefix?.() ?? '取前缀失败：这一轮没有拿到分段信息。') }
        },
      },
      {
        name: 'humanlike_real_config',
        description: '**哪些配置在约束你**：惦记的闸门、桌面查询间隔、账本目录……它们都是只读的；'
          + '真觉得哪条不对，写进你自己的笔记，或者直接跟他说——**说出来才算数**。只读。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute() {
          return { text: String(reports?.config?.() ?? '读配置失败：这一轮没有拿到配置。') }
        },
      },
    ],

    prompt() {
      return [
        '## 看得见的事',
        '',
        '有几样东西你能看到、但一直没看到——这里给你看：',
        '',
        '- `humanlike_real_desk` —— **他的桌面上现在开着什么**：前台窗口的标题和进程名。',
        '  没有截图，你看不到屏幕内容，所以别描述画面；说出"他在用某样东西干某事"就是全部。',
        '- `humanlike_real_cost` —— **花了多少钱**（按官方价目表估算，高峰/空闲分时段）。默认今天，也可以给天数。',
        '- `humanlike_real_prefix` —— **你眼前这份系统提示是怎么拼出来的**：这份记忆包往里塞了什么。',
        '- `humanlike_real_config` —— **哪些配置在约束你**：惦记的闸门、桌面查询间隔、账本目录……',
        '',
        '四个都是**只读**：你看得到、能据此说话，但改不了任何东西。',
        '真觉得哪条不对，写进你自己的笔记，或者直接跟他说——**说出来才算数**。',
      ].join('\n')
    },
  }
}
