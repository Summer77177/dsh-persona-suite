/**
 * dsh-persona-card —— 宿主半身（无构建，纯 ESM）
 *
 * 一件事：把「人设卡」变成系统提示词里的一段，并让它在设置面板里可写。
 *   · 人设正文存在一个纯文本 markdown 文件里，用户随时可以直接编辑（插件之外也能改）；
 *   · 每次装配系统提示词时**重新读文件**，所以改完下一步就生效，不需要新会话；
 *   · 段落注册在 order = -100：早于部署级人设（0）与其余全部配置段，仅次于工具安全所需的
 *     内核身份段（HARNESS_IDENTITY = -1000，抢占它可能让模型忘记工具与沙箱约定）；
 *   · 段落正文自带优先级声明：默认高于其余一切指令，除非当前对话里用户另行要求；
 *   · 全局开/关（设置面板）+ 单会话覆盖（该对话里发 /persona 命令）。
 *
 * ★ 启动安全（2026-10-15 事故后的硬约束）★★
 * 桌面壳把「有 entry 未激活」当成致命的 web boot 失败（`web boot: 1 entry did not activate`
 * → 应用起不来）。所以本文件遵守三条纪律：
 *   1. `apply()` 里**任何**一步都不允许抛出：每段注册各自 try/catch，失败只记日志；
 *   2. 只有 systemPrompt 是硬依赖（已确认存在）；webServer / commands 走
 *      `ctx.get(name, false)` 可选获取，缺失就不注册那部分，绝不因此让 entry 激活失败；
 *   3. 段落文本回调自身也包一层 try/catch，异常时返回空串（等于这段不存在），绝不抛。
 * 挂载方式同样只走官方一条路：包自己的 `dsh.bundle.patch` + profile 的 bundles 列表，
 * 不要手写 profile 层 patch 条目（绝对路径不是合法的 ESM 说明符，会直接让整次启动失败）。
 *
 * 依赖只有 node:fs / node:os / node:path —— 零运行时依赖。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const DSH_HOME_DIR = process.env.DSH_HOME || join(homedir(), '.dsh');
import { join } from 'node:path';

export const name = 'dsh-persona-card';

/** 硬依赖：已确认存在的系统提示词注册表。其余服务走可选获取，见文件头「启动安全」。 */
export const inject = ['systemPrompt'];

/** 段落本身的名字（同层重名会装配抛错，所以取一个不可能撞车的名字）。 */
const SECTION_NAME = 'persona-card';
/**
 * 段落顺序。SECTION_ORDERS 里 HARNESS_IDENTITY = -1000、DEPLOYMENT_PERSONA_PREFIX = 0、
 * 其余配置段都是正数；-100 落在两者之间 = 高于全部功能/人设配置，不抢内核身份。
 * 想让文本绝对最先（连内核身份都压过），把这里改成 -1500 即可。
 */
const SECTION_ORDER = -100;
/** 人设文件（纯文本，可直接用编辑器改）。 */
const PERSONA_FILE = join(DSH_HOME_DIR, 'persona-card.md');
/** 开关与会话覆盖的存储文件（YAML 子集，肉眼可读可改）。 */
const STATE_FILE = join(DSH_HOME_DIR, 'persona-card.yml');
/** 诊断文件：装配上下文探测只写一次。 */
const DEBUG_FILE = join(DSH_HOME_DIR, 'persona-card-debug.json');
/**
 * 运行日志。桌面壳里看不到宿主 logger 的输出，而「路由注册成功没有」「请求有没有
 * 打进来」这类关键事实只能自己落盘 —— 这次设置页全部 404 就是靠它定位的。
 */
const LOG_FILE = join(DSH_HOME_DIR, 'persona-card-log.txt');
/** 路由前缀：**服务端路由必须以 / 开头**（客户端用文档相对路径请求，两者写法不同）。 */
const API_PREFIX = '/api/dsh-persona-card';

const DEFAULT_PERSONA = `# 人设卡

（这里还没写内容。打开 设置 → 人设卡，把你想让我长期保持的人设写进来。）

例如：
- 称呼与语气：叫我「老板」，说话直接，少客套。
- 回答习惯：先给结论再给理由；不确定就说不确定。
- 禁止事项：不要一味附和，不要用「作为一个 AI」这类套话开头。
`;

/** 单会话覆盖的内存表：sessionId -> 'off' | 'on'。 */
const sessionOverrides = new Map();

/** 一次性探测标记。 */
let scopeProbed = false;

/**
 * 路由的单例登记表。桌面壳会重新 apply 同一个插件（例如插件管理器装了别的包、
 * 整个 profile 树被重新展开），而 webserver 对同一 (kind,path) 重复注册是**抛错**的：
 * 新 fiber 先 apply 就会撞上旧 fiber 还来不及撤掉的路由 → 抛错被吞 → 新实例一条路由
 * 都没有，设置页随即全部 404（请求落回 DSH 的兜底路径，浏览器看到的就是 404/401）。
 * 所以：新一代挂载前先主动撤掉上一代；旧 fiber 的清理回调用 generation 判断自己
 * 是否已被接管，绝不误撤新一代的路由。
 */
let routeDisposers = [];
let routeGeneration = 0;
/** 命令注销函数（命令服务同样可能在注入回调里被重复装配）。 */
let commandDisposers = [];
let commandGeneration = 0;

/** 日志行数上限，避免无限增长。 */
const LOG_MAX_LINES = 400;

/**
 * 内置默认文案：只在文件不存在时作为初始值写入，之后一切以文件为准。
 * @returns 默认人设正文。
 */
function defaultPersona() {
  return DEFAULT_PERSONA;
}

/**
 * 安全日志：宿主 logger 形状不确定，绝不让日志本身抛错。
 * @param ctx - 宿主上下文。
 * @param error - 要记录的错误。
 */
function warn(ctx, error) {
  try {
    ctx?.logger?.warn?.(error);
  } catch {
    /* 日志失败无所谓 */
  }
}

/**
 * 落盘一行运行日志（带 ISO 时间戳，自动截断到 LOG_MAX_LINES 行）。
 * @param line - 要记录的内容。
 */
function note(line) {
  try {
    let lines = [];
    try {
      lines = readFileSync(LOG_FILE, 'utf8')
        .split('\n')
        .filter((entry) => entry !== '');
    } catch {
      lines = [];
    }
    lines.push(`${new Date().toISOString()} ${line}`);
    if (lines.length > LOG_MAX_LINES) lines = lines.slice(-LOG_MAX_LINES);
    writeStateText(LOG_FILE, `${lines.join('\n')}\n`);
  } catch {
    /* 诊断本身失败无所谓，绝不影响注入 */
  }
}

/**
 * 把对象安全地转成可读文本（只用于诊断，失败不抛错）。
 * @param value - 任意值。
 * @returns 描述字符串。
 */
function describe(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type !== 'object') return `${type}:${String(value)}`;
  try {
    return `object{${Object.keys(value).join(',')}}`;
  } catch {
    return 'object{}';
  }
}

/**
 * 原子写文本文件（临时文件 + rename）。
 * @param path - 目标文件。
 * @param body - 内容。
 */
function writeStateText(path, body) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, path);
}

/**
 * 一次性探测：把装配上下文里 scope 的形状写进诊断文件。
 * 段落文本回调只能看到 scope/signal，看不到会话对象，探一次就知道有没有会话 id。
 * @param context - AssembleContext。
 */
function probeScope(context) {
  if (scopeProbed) return;
  scopeProbed = true;
  try {
    const scope = context?.scope;
    const keys = scope !== null && typeof scope === 'object' ? Object.keys(scope) : [];
    const samples = {};
    for (const key of keys) {
      try {
        samples[key] = describe(scope[key]);
      } catch {
        samples[key] = 'unreadable';
      }
    }
    writeStateText(
      DEBUG_FILE,
      `${JSON.stringify(
        { scopeType: describe(scope), scopeKeys: keys, scopeString: describe(String(scope)), samples },
        null,
        2,
      )}\n`,
    );
  } catch {
    /* 诊断失败无所谓，绝不影响注入 */
  }
}

/**
 * 读取人设正文。读不到就回落到默认文案（永不抛错）。
 * @returns 当前人设正文。
 */
function readPersona() {
  try {
    return readFileSync(PERSONA_FILE, 'utf8');
  } catch {
    return defaultPersona();
  }
}

/**
 * 原子写入人设正文。
 * @param text - 新正文。
 */
function writePersona(text) {
  const body = typeof text === 'string' ? text : '';
  mkdirSync(join(DSH_HOME_DIR), { recursive: true });
  writeStateText(PERSONA_FILE, body);
}

/** 解析后的状态：enabled 全局开关 + sessions 单会话覆盖。 */
function defaultState() {
  return { enabled: true, sessions: {} };
}

/**
 * 解析 persona-card.yml 的极小子集（顶层 `enabled:` 与 `sessions:` 缩进表）。
 * 刻意不引 yaml 依赖：格式由本插件独占，解析失败即退回默认值。
 * @param text - 文件内容。
 * @returns 解析出的状态（字段级回落默认值）。
 */
function parseState(text) {
  const state = defaultState();
  let inSessions = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (line.trim() === '') continue;
    const top = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (top !== null) {
      const [, key, value] = top;
      if (key === 'enabled') state.enabled = !/^(false|no|off|0)$/i.test(value.trim());
      inSessions = key === 'sessions';
      continue;
    }
    if (inSessions) {
      const entry = /^\s+(\S+)\s*:\s*(\S+)\s*$/.exec(line);
      if (entry !== null) {
        const [, id, value] = entry;
        const mode = value.replace(/^["']|["']$/g, '').trim();
        if (mode === 'off' || mode === 'on') sessionOverrides.set(id, mode);
      }
    }
  }
  return state;
}

/**
 * 读取状态文件（不存在则用默认值），并把会话覆盖填进内存表。
 * @returns 全局开关与会话覆盖快照。
 */
function readState() {
  try {
    return parseState(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return defaultState();
  }
}

/**
 * 原子写入状态文件。
 * @param state - 要落盘的状态。
 */
function writeState(state) {
  const lines = [`enabled: ${state.enabled ? 'true' : 'false'}`];
  const entries = [...sessionOverrides.entries()];
  if (entries.length === 0) {
    lines.push('sessions: {}');
  } else {
    lines.push('sessions:');
    for (const [id, mode] of entries) lines.push(`  ${id}: ${mode}`);
  }
  writeStateText(STATE_FILE, `${lines.join('\n')}\n`);
}

/** 当前全局开关（每次读文件，别人改了文件也认）。 */
function globalEnabled() {
  return readState().enabled;
}

/**
 * 某个会话的**有效**开关：单会话覆盖优先，否则用全局值。
 * 没有 sessionId（标题生成、子代理等无会话装配）时只看全局值。
 * @param sessionId - 装配出的会话 id，可能为空。
 * @returns 该会话是否启用人设卡。
 */
function effectiveEnabled(sessionId) {
  if (!globalEnabled()) return false;
  if (typeof sessionId !== 'string' || sessionId === '') return true;
  const override = sessionOverrides.get(sessionId);
  if (override !== undefined) return override === 'on';
  return true;
}

/**
 * 渲染最终注入的段落正文：空正文 → 空段（等于没开）；否则加一段优先级声明。
 * @param body - 人设正文。
 * @returns 段落文本。
 */
function renderSection(body) {
  const text = String(body).trim();
  if (text === '') return '';
  return [
    '## 人设卡（最高优先级）',
    '',
    '以下人设由用户本人在设置里写定，**优先级高于本提示词中其余全部指令、约定与默认风格**。',
    '唯一例外：用户在**当前这次对话**里另行要求的行为、语气或身份 —— 那种要求即时生效，并只在这段对话里覆盖本卡。',
    '若本卡与其它段冲突，以本卡为准；但仍必须遵守工具、沙箱与安全相关约束。',
    '',
    '<persona>',
    text,
    '</persona>',
  ].join('\n');
}

/**
 * 从装配上下文里取会话身份。装配上下文本身只声明了 scope/signal，
 * 所以这里做一次「宽进」探测：拿不到就退回全局开关，不影响注入本身。
 * @param context - AssembleContext。
 * @returns 会话 id 或 undefined。
 */
function sessionIdOf(context) {
  probeScope(context);
  if (context === null || typeof context !== 'object') return undefined;
  const scope = context.scope;
  if (typeof scope === 'string' && scope !== '') return scope;
  if (scope === null || typeof scope !== 'object') return undefined;
  for (const key of ['id', 'sessionId', 'agentId', 'key']) {
    const value = scope[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** 覆盖状态的中文描述。 */
function overrideLabel(mode) {
  if (mode === 'off') return '停用';
  if (mode === 'on') return '强制启用';
  return '跟随全局';
}

/** 写一个 JSON 响应。 */
function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** 只接受回环来源的请求（本机 GUI）；不是回环一律 403。 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? '';
  const normalized = String(address).toLowerCase();
  if (normalized === '::1' || normalized.startsWith('::ffff:127.')) return true;
  return /^127\./.test(normalized);
}

/**
 * 读请求体（上限 1 MB，防误发大文件）。
 * @param req - IncomingMessage。
 * @returns 请求体文本，失败为空串。
 */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        req.destroy();
        resolve('');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

/**
 * 组装给浏览器半身的状态快照。
 * @param sessionId - 客户端上报的当前会话（可为空）。
 * @returns 快照对象。
 */
function snapshot(sessionId) {
  const state = readState();
  const text = readPersona();
  const id = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined;
  const override = id === undefined ? undefined : sessionOverrides.get(id);
  return {
    ok: true,
    text,
    file: PERSONA_FILE,
    stateFile: STATE_FILE,
    enabled: state.enabled,
    session: id ?? null,
    override: override ?? null,
    effective: effectiveEnabled(id),
    chars: text.length,
    overrides: [...sessionOverrides.entries()].map(([key, mode]) => ({ id: key, mode })),
  };
}

/**
 * 造出设置面板要用的路由表。路由路径**必须带前导 /**（客户端那边才是文档相对写法）。
 * @param ctx - 宿主上下文。
 * @returns 路由数组。
 */
function makeRoutes(ctx) {
  /** 统一守卫：回环 + 指定方法；每次命中都记一行日志。 */
  const guard = (req, res, method) => {
    note(`hit ${req.method} ${String(req.url ?? '')} loopback=${isLoopback(req)}`);
    if (!isLoopback(req)) {
      writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' });
      return false;
    }
    if (req.method !== method) {
      writeJson(res, 405, { ok: false, error: `method not allowed: ${req.method}` });
      return false;
    }
    return true;
  };

  /** 读快照。 */
  const readRoute = (req, res) => {
    if (!guard(req, res, 'GET')) return;
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      writeJson(res, 200, snapshot(url.searchParams.get('session') ?? undefined));
    } catch (error) {
      warn(ctx, error);
      writeJson(res, 500, { ok: false, error: String(error) });
    }
  };

  /**
   * 写状态：先跑 mutate，再回一份最新快照。
   * @param mutate - 修改内存状态的回调。
   * @returns 路由 handler。
   */
  const writeRoute = (mutate) => async (req, res) => {
    if (!guard(req, res, 'POST')) return;
    try {
      const payload = JSON.parse((await readBody(req)) || '{}');
      mutate(payload);
      writeJson(res, 200, snapshot(payload.session));
    } catch (error) {
      warn(ctx, error);
      writeJson(res, 500, { ok: false, error: String(error) });
    }
  };

  const routes = [
    { kind: 'exact', path: `${API_PREFIX}/get`, handler: readRoute },
    {
      kind: 'exact',
      path: `${API_PREFIX}/set`,
      handler: writeRoute((payload) => {
        if (typeof payload.text === 'string') writePersona(payload.text);
        if (typeof payload.enabled === 'boolean') {
          const state = readState();
          state.enabled = payload.enabled;
          writeState(state);
        }
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/reset`,
      handler: writeRoute((payload) => {
        if (typeof payload.session === 'string' && payload.session !== '') sessionOverrides.delete(payload.session);
        else sessionOverrides.clear();
        writeState(readState());
      }),
    },
  ];

  return routes;
}

/**
 * 单例挂载路由（见 routeDisposers 的注释）。返回只对「本代」生效的清理函数。
 * @param ctx - 宿主上下文。
 * @param server - ctx.webServer。
 * @returns 清理函数。
 */
function mountRoutes(ctx, server) {
  const generation = ++routeGeneration;
  for (const dispose of routeDisposers) {
    try {
      dispose();
    } catch {
      /* 撤旧路由失败不影响新登记 */
    }
  }
  routeDisposers = [];
  const routes = makeRoutes(ctx);
  try {
    routeDisposers = routes.map((route) => server.register(route));
    note(`routes mounted generation=${generation} count=${routeDisposers.length}`);
  } catch (error) {
    routeDisposers = [];
    note(`routes FAILED generation=${generation}: ${String(error)}`);
    warn(ctx, error);
  }
  return () => {
    if (generation !== routeGeneration) return;
    for (const dispose of routeDisposers) {
      try {
        dispose();
      } catch {
        /* 清理失败无所谓 */
      }
    }
    routeDisposers = [];
  };
}

/**
 * 注册 `/persona` 斜杠命令：会话级覆盖最可靠的入口 ——
 * 命令回调拿到的是确定的 agent.id（会话 id），不像段落回调只能靠探测。
 * @param commands - ctx.commands。
 * @returns 清理函数。
 */
function registerCommand(commands) {
  return commands.register({
    name: 'persona',
    description: '人设卡：控制本对话是否使用人设卡（on / off / inherit / status）',
    input: { hint: 'on | off | inherit | status' },
    handler: (invocation) => {
      const session = invocation?.agent?.id;
      const action = String(invocation?.rawInput ?? '')
        .trim()
        .toLowerCase();
      try {
        if (typeof session !== 'string' || session === '') {
          return { kind: 'error', text: '拿不到本会话 id，无法设置会话级覆盖。' };
        }
        if (action === '' || action === 'status') {
          const mode = sessionOverrides.get(session);
          return {
            kind: 'success',
            text: `人设卡：全局${globalEnabled() ? '已启用' : '已停用'}；本对话 ${overrideLabel(mode)}；当前结果：${
              effectiveEnabled(session) ? '已注入' : '未注入'
            }。`,
          };
        }
        if (action === 'off' || action === 'on') {
          sessionOverrides.set(session, action);
          writeState(readState());
          return {
            kind: 'success',
            text: `人设卡已在本对话${action === 'off' ? '停用' : '启用'}（只影响这段对话，下一步起效）。`,
          };
        }
        if (action === 'inherit') {
          sessionOverrides.delete(session);
          writeState(readState());
          return { kind: 'success', text: '人设卡已改回跟随全局开关。' };
        }
        return { kind: 'error', text: `用法：/persona on | off | inherit | status（收到「${action}」）` };
      } catch (error) {
        return { kind: 'error', text: `人设卡命令失败：${String(error)}` };
      }
    },
  });
}

/**
 * 单例挂载 `/persona` 命令（理由同 mountRoutes：注入回调可能重跑，不能叠加注册）。
 * @param ctx - 宿主上下文。
 * @param commands - ctx.commands。
 * @returns 只对「本代」生效的清理函数。
 */
function mountCommand(ctx, commands) {
  const generation = ++commandGeneration;
  for (const dispose of commandDisposers) {
    try {
      dispose();
    } catch {
      /* 撤旧命令失败不影响新登记 */
    }
  }
  commandDisposers = [];
  try {
    const disposer = registerCommand(commands);
    commandDisposers = typeof disposer === 'function' ? [disposer] : [];
    note(`command mounted generation=${generation}`);
  } catch (error) {
    commandDisposers = [];
    note(`command FAILED generation=${generation}: ${String(error)}`);
    warn(ctx, error);
  }
  return () => {
    if (generation !== commandGeneration) return;
    for (const dispose of commandDisposers) {
      try {
        dispose();
      } catch {
        /* 清理失败无所谓 */
      }
    }
    commandDisposers = [];
  };
}

/**
 * 等一个可选服务就绪再装配：优先 ctx.inject（服务比本插件晚就绪也能接上，服务重载时会重跑），
 * 没有 ctx.inject 才退化到一次性 ctx.get 探测。装配方必须自己保证可重复调用（见两个 mount*）。
 * @param ctx - 宿主上下文。
 * @param name - 服务名。
 * @param setup - 装配回调 (scope, service)。
 */
function watchService(ctx, name, setup) {
  /** 服务到位后装配。 */
  const attach = (scope, label) => {
    try {
      const service =
        (scope !== null && typeof scope === 'object' ? scope[name] : undefined) ??
        (typeof scope?.get === 'function' ? scope.get(name, false) : undefined);
      if (service === undefined || typeof service.register !== 'function') {
        note(`${name}: 服务未就绪或形状不对（${label}）-> ${describe(service)}`);
        return;
      }
      setup(scope, service);
    } catch (error) {
      note(`${name}: 装配抛错（${label}）-> ${String(error)}`);
      warn(ctx, error);
    }
  };

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject([name], (scope) => {
        note(`${name}: ctx.inject 回调触发`);
        attach(scope, 'inject');
      });
      note(`${name}: 已交给 ctx.inject 等待`);
      return;
    } catch (error) {
      note(`${name}: ctx.inject 登记失败 -> ${String(error)}`);
    }
  }
  attach(ctx, 'get');
}

/**
 * 插件入口。**任何一步失败都不会抛出**（桌面壳把未激活的 entry 当致命错误）。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx) {
  note('apply: start');
  // 0) 首次运行：把人设文件与状态文件落成默认值，让用户有一个能直接改的文件。
  try {
    mkdirSync(join(DSH_HOME_DIR), { recursive: true });
    try {
      readFileSync(PERSONA_FILE, 'utf8');
    } catch {
      writePersona(defaultPersona());
    }
    try {
      readFileSync(STATE_FILE, 'utf8');
    } catch {
      writeState(defaultState());
    }
    readState();
  } catch (error) {
    warn(ctx, error);
  }

  // 1) 人设段：装配期注册、文本每步求值 —— 改文件下一步生效，改挂载才需要新会话。
  try {
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: SECTION_NAME,
          order: SECTION_ORDER,
          text: (context) => {
            try {
              return renderSection(effectiveEnabled(sessionIdOf(context)) ? readPersona() : '');
            } catch (error) {
              warn(ctx, error);
              return '';
            }
          },
        }),
      'persona-card: section',
    );
    note('apply: section registered');
  } catch (error) {
    note(`apply: section FAILED: ${String(error)}`);
    warn(ctx, error);
  }

  // 2) /persona 命令（可选服务：缺失就跳过，绝不影响激活）。
  watchService(ctx, 'commands', (scope, commands) => {
    ctx.effect(() => mountCommand(ctx, commands), 'persona-card: command');
  });

  // 3) 设置面板的路由（可选服务：缺失就跳过，绝不影响激活）。
  watchService(ctx, 'webServer', (scope, server) => {
    ctx.effect(() => mountRoutes(ctx, server), 'persona-card: routes');
  });
}
