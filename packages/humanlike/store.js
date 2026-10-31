/**
 * 落盘层：每个账本一个 JSON 文件，内存缓存 + 原子写。
 *
 * 沿用上游的落盘约定：<dataDir>/humanlike/{affinity,learn,life,together,mind}.json，一个模块一个文件。
 * clock 和 real 不落盘 —— 它们读的是当下的事实，不是账。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createStore(rootDir) {
  const cache = new Map()
  let dirReady = false

  async function ensureDir() {
    if (dirReady) return
    await mkdir(rootDir, { recursive: true })
    dirReady = true
  }

  return {
    dir: rootDir,

    /** 读一个账本；文件不存在或读坏了就用 makeDefault() 起一个新的。 */
    async read(name, makeDefault) {
      if (cache.has(name)) return cache.get(name)
      await ensureDir()
      let value
      try {
        value = JSON.parse(await readFile(join(rootDir, `${name}.json`), 'utf8'))
      } catch {
        value = makeDefault()
      }
      // 老版本账本可能缺字段，补齐默认值
      const base = makeDefault()
      if (value && typeof value === 'object' && base && typeof base === 'object') {
        value = mergeDefaults(base, value)
      }
      cache.set(name, value)
      return value
    },

    /** 写回一个账本并立刻落盘。 */
    async write(name, value) {
      cache.set(name, value)
      await ensureDir()
      const target = join(rootDir, `${name}.json`)
      const tmp = `${target}.tmp`
      await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
      await rename(tmp, target)
      return value
    },

    /** 掉一个账本的缓存（外部改过文件时用）。 */
    forget(name) {
      cache.delete(name)
    },

    /** 同步取缓存；没预热就是 undefined。section 只能走这条。 */
    peek(name) {
      return cache.get(name)
    },

    /** 换目录（测试用）。 */
    setDir(next) {
      cache.clear()
      dirReady = false
      this.dir = next
    },
  }
}

function mergeDefaults(base, value) {
  if (Array.isArray(base)) return Array.isArray(value) ? value : base
  const out = { ...value }
  for (const [key, fallback] of Object.entries(base)) {
    const current = value[key]
    if (current === undefined) {
      out[key] = fallback
    } else if (
      fallback && typeof fallback === 'object' && !Array.isArray(fallback)
      && current && typeof current === 'object' && !Array.isArray(current)
    ) {
      out[key] = mergeDefaults(fallback, current)
    }
  }
  return out
}

/** 当前时间戳（毫秒）。 */
export function now() {
  return Date.now()
}

/** 取一个长度不超过 n 的数组尾巴。 */
export function tail(list, n) {
  return list.length <= n ? list.slice() : list.slice(list.length - n)
}

/** 按分数从高到低排，稳定。 */
export function byScore(list, key = 'score') {
  return list.slice().sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
}

/** 生成短 id。 */
let counter = 0
export function shortId(prefix = 'id') {
  counter = (counter + 1) % 0xffff
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`
}
