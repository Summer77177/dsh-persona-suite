/**
 * 启动安全自测：像加载器那样 import 插件模块，并用假的 ctx 调 apply()。
 * 只要 apply() 抛错，桌面壳就会报 `web boot: 1 entry did not activate` 而起不来，
 * 所以这里把「注册了什么」「有没有抛」两件事都打出来。
 */
// 默认测「这个包自己的 lib/index.js」；也可以在命令行传插件模块路径（例如 profile 里那份）。
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 整个自测跑在一个临时 DSH_HOME 里：apply() 会往里落默认人设卡、状态文件和运行日志，
// 全都写进临时目录，跑完删掉 —— 绝不碰你真实的那份人设卡。
// 必须在 import 插件之前设好：插件在模块顶层就把 DSH_HOME 读走了。
const SANDBOX = process.env.PERSONA_CARD_TEST_HOME || mkdtempSync(join(tmpdir(), 'persona-card-selftest-'));
process.env.DSH_HOME = SANDBOX;

const url = process.argv[2]
  ? pathToFileURL(process.argv[2]).href
  : new URL('./lib/index.js', import.meta.url).href;

const registered = { sections: [], routes: [], commands: [] };
const liveRoutes = new Set();
let section = null;

const ctx = {
  logger: { warn: (error) => console.log('  [warn]', String(error).slice(0, 120)) },
  effect: (callback) => callback(),
  get: (name) => {
    if (name === 'webServer') {
      return {
        register: (route) => {
          // 照抄真实 webServer 的行为：同一 (kind, path) 重复注册会 throw。
          if (liveRoutes.has(route.path)) {
            throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
          }
          liveRoutes.add(route.path);
          registered.routes.push(route.path);
          return () => {
            liveRoutes.delete(route.path);
          };
        },
      };
    }
    if (name === 'commands') {
      return {
        register: (definition) => {
          registered.commands.push(definition.name);
          return () => {};
        },
      };
    }
    return undefined;
  },
  systemPrompt: {
    section: (candidate) => {
      section = candidate;
      registered.sections.push({ name: candidate.name, order: candidate.order });
      return () => {};
    },
  },
};

const module = await import(url);
console.log('exports:', Object.keys(module).join(', '));
console.log('inject:', JSON.stringify(module.inject));

try {
  module.apply(ctx);
  console.log('apply(): OK（没有抛错）');
} catch (error) {
  console.log('apply(): 抛错！', error);
  process.exitCode = 1;
}

console.log('注册结果:', JSON.stringify(registered, null, 2));

// 段落文本回调也要练一遍：正常装配上下文、空上下文、以及一个带 scope 的上下文。
for (const context of [undefined, {}, { scope: undefined }, { scope: { id: 'session-test-1' } }, { scope: 'raw-key' }]) {
  try {
    const text = section.text(context);
    console.log(`text(${JSON.stringify(context ?? null)}) -> ${text.length} 字符, 含人设卡标题=${text.includes('人设卡（最高优先级）')}`);
  } catch (error) {
    console.log('text() 抛错！', error);
    process.exitCode = 1;
  }
}

// 再练一遍「全局关闭」路径：把状态文件写成 enabled: false 后重新求值。
const { writeFileSync, readFileSync } = await import('node:fs');
const stateFile = join(SANDBOX, 'persona-card.yml');
// apply() 已经在这个沙箱里落过默认状态文件，所以这里一定读得到 —— 读不到就是前面坏了。
const backup = readFileSync(stateFile, 'utf8');
writeFileSync(stateFile, 'enabled: false\nsessions: {}\n', 'utf8');
try {
  const text = section.text({ scope: { id: 'session-test-1' } });
  console.log('全局关闭时注入长度:', text.length, '（应为 0）');
  if (text.length !== 0) process.exitCode = 1;
} finally {
  writeFileSync(stateFile, backup, 'utf8');
}

// 反复激活：宿主热重载 / 多个 fiber 会重跑 apply()，第二次不能再撞「重复路由」。
try {
  module.apply(ctx);
  module.apply(ctx);
  console.log(`重复 apply：第 2、3 次都没抛错，当前存活路由 ${liveRoutes.size} 条（应为 3）`);
  if (liveRoutes.size !== 3) process.exitCode = 1;
} catch (error) {
  console.log('重复 apply 抛错！', error);
  process.exitCode = 1;
}

// 再验「服务晚就绪」路径：这个 ctx 只有 ctx.inject，get() 当场拿不到服务。
const late = { routes: [], commands: [] };
const lateCtx = {
  logger: ctx.logger,
  effect: (callback) => callback(),
  get: () => undefined,
  inject: (deps, callback) => {
    const scope = {
      get: (service) => {
        if (service === 'webServer') {
          return {
            register: (route) => {
              late.routes.push(route.path);
              return () => {};
            },
          };
        }
        if (service === 'commands') {
          return {
            register: (definition) => {
              late.commands.push(definition.name);
              return () => {};
            },
          };
        }
        return undefined;
      },
    };
    callback(scope);
  },
  systemPrompt: ctx.systemPrompt,
};
try {
  module.apply(lateCtx);
  console.log(`ctx.inject 路径：${late.routes.length} 条路由、${late.commands.length} 个命令（应为 3 / 1）`);
  if (late.routes.length !== 3 || late.commands.length !== 1) process.exitCode = 1;
} catch (error) {
  console.log('ctx.inject 路径抛错！', error);
  process.exitCode = 1;
}

// 确认运行日志真的落盘了（note() 是自诊断手段，也是「apply 没抛错但也没干活」的证据）。
const logFile = join(SANDBOX, 'persona-card-log.txt');
if (readFileSync) {
  try {
    const lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    console.log(`运行日志: ${lines.length} 行，最后 3 行：`);
    for (const line of lines.slice(-3)) console.log('   ', line);
    const bad = lines.filter((line) => line.includes('FAILED'));
    if (bad.length > 0) {
      console.log('   日志里出现 FAILED（不该有）：', bad.join(' | '));
      process.exitCode = 1;
    }
  } catch (error) {
    console.log('运行日志: 读不到！note() 没写成功 ->', String(error));
    process.exitCode = 1;
  }
}

// 命令回调练一遍（不经过真实命令服务）。
// 沙箱收拾干净；如果是外面传进来的 PERSONA_CARD_TEST_HOME，就留着方便排查。
if (process.env.PERSONA_CARD_TEST_HOME) {
  console.log(`沙箱保留在 ${SANDBOX}`);
} else {
  try {
    rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* 删不掉只是留个临时目录，不影响结论 */
  }
}

console.log(process.exitCode ? '有检查没过。' : '完成。');
