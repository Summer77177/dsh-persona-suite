/**
 * dsh-persona-card —— 浏览器半身（无构建，纯 ESM，浏览器侧模块加载器格式）
 *
 * 只做两件事：在设置面板左侧导航里加一项「人设卡」，页面里能看/改人设正文、切全局开关。
 * 会话级覆盖交给宿主半身的 `/persona` 斜杠命令 —— 命令回调拿到的是确定的会话 id，
 * 浏览器半身拿不到「当前会话」的可靠来源，所以不在这里假装能设置。
 *
 * 契约（照抄官方设置页与第三方插件的注册形状）：
 *   ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id, order, label }, Component))
 * 路由走**文档相对**路径（GUI 以 <base href="./"> 提供，`/api/...` 会跑出前缀）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-card',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    /** 硬依赖：slots 服务就绪前不激活（照抄 dsh-pet 客户端半身的 inject 形状）。 */
    const inject = ['slots'];

    const API = {
      get: 'api/dsh-persona-card/get',
      set: 'api/dsh-persona-card/set',
      reset: 'api/dsh-persona-card/reset',
    };

    /** 极简内联样式：只用当前主题的 CSS 变量，明暗主题都自动跟随。 */
    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      label: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, currentColor)' },
      meta: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)' },
      area: {
        width: '100%',
        minHeight: '260px',
        resize: 'vertical',
        padding: '10px',
        fontSize: '13px',
        lineHeight: 1.6,
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))',
        background: 'var(--dsw-alias-bg-layer-1, transparent)',
        color: 'var(--dsw-alias-label-primary, inherit)',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      },
      button: {
        padding: '5px 12px',
        fontSize: '13px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))',
        background: 'var(--dsw-alias-bg-layer-2, transparent)',
        color: 'var(--dsw-alias-label-primary, inherit)',
        cursor: 'pointer',
      },
      buttonPrimary: {
        padding: '5px 14px',
        fontSize: '13px',
        fontWeight: 600,
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-brand-primary, #3964FE)',
        background: 'var(--dsw-alias-brand-primary, #3964FE)',
        color: '#fff',
        cursor: 'pointer',
      },
      note: {
        fontSize: '12px',
        lineHeight: 1.7,
        padding: '8px 10px',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))',
        color: 'var(--dsw-alias-label-secondary, #888)',
      },
      err: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' },
      code: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12px',
        padding: '1px 5px',
        borderRadius: '4px',
        background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,.18))',
      },
    };

    /**
     * 一次 API 调用。
     * @param url - 文档相对地址
     * @param init - fetch 选项
     * @returns 解析后的响应
     */
    async function call(url, init) {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || data?.ok !== true) throw new Error(data?.error ?? `HTTP ${response.status}`);
      return data;
    }

    /** 设置页正文。 */
    function PersonaPanel() {
      const [text, setText] = React.useState('');
      const [enabled, setEnabled] = React.useState(true);
      const [file, setFile] = React.useState('');
      const [overrides, setOverrides] = React.useState([]);
      const [status, setStatus] = React.useState('加载中…');
      const [error, setError] = React.useState('');
      const [dirty, setDirty] = React.useState(false);
      const [busy, setBusy] = React.useState(false);

      const adopt = (data) => {
        setText(data.text ?? '');
        setEnabled(data.enabled !== false);
        setFile(data.file ?? '');
        setOverrides(Array.isArray(data.overrides) ? data.overrides : []);
      };

      const refresh = React.useCallback(async () => {
        try {
          const data = await call(API.get, { headers: { accept: 'application/json' } });
          adopt(data);
          setStatus('已是最新');
          setError('');
          setDirty(false);
        } catch (failure) {
          setError(String(failure?.message ?? failure));
          setStatus('读取失败');
        }
      }, []);

      React.useEffect(() => {
        refresh();
      }, [refresh]);

      const save = async () => {
        setBusy(true);
        try {
          const data = await call(API.set, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, enabled }),
          });
          adopt(data);
          setStatus('已保存，下一步对话即生效');
          setError('');
          setDirty(false);
        } catch (failure) {
          setError(String(failure?.message ?? failure));
          setStatus('保存失败');
        } finally {
          setBusy(false);
        }
      };

      const resetAll = async () => {
        setBusy(true);
        try {
          const data = await call(API.reset, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          adopt(data);
          setStatus('已清空全部「本对话」例外');
          setError('');
        } catch (failure) {
          setError(String(failure?.message ?? failure));
        } finally {
          setBusy(false);
        }
      };

      const overrideLine =
        overrides.length === 0
          ? '没有任何会话例外，全部对话都用同一张人设卡。'
          : `已有 ${overrides.length} 个会话设了例外：${overrides.map((entry) => `${entry.mode === 'off' ? '停用' : '启用'}`).join('、')}。`;

      return React.createElement(
        'div',
        { style: S.wrap },
        React.createElement('div', { style: S.label }, '人设卡（优先级最高的一段系统提示词）'),
        React.createElement(
          'div',
          { style: S.meta },
          `正文落盘在 ${file || '—'}，是纯文本，插件之外也能直接改；改完下一步对话生效，无需新会话。`,
        ),
        React.createElement(
          'div',
          { style: S.row },
          React.createElement('input', {
            type: 'checkbox',
            id: 'dsh-persona-card-enabled',
            checked: enabled,
            disabled: busy,
            onChange: (event) => {
              setEnabled(event.target.checked);
              setDirty(true);
            },
          }),
          React.createElement(
            'label',
            { htmlFor: 'dsh-persona-card-enabled', style: S.label },
            '全局启用（关掉 = 立刻不注入，任何对话都不用）',
          ),
        ),
        React.createElement('textarea', {
          style: S.area,
          value: text,
          spellCheck: false,
          disabled: busy,
          placeholder: '在这里写你的人设：身份、语气、称呼、习惯、禁忌……',
          onChange: (event) => {
            setText(event.target.value);
            setDirty(true);
          },
        }),
        React.createElement(
          'div',
          { style: S.row },
          React.createElement('button', { style: S.buttonPrimary, disabled: busy, onClick: save }, busy ? '处理中…' : '保存'),
          React.createElement('button', { style: S.button, disabled: busy, onClick: refresh }, '重新载入'),
          React.createElement(
            'button',
            {
              style: S.button,
              disabled: busy,
              onClick: () => {
                setText('');
                setDirty(true);
              },
            },
            '清空正文',
          ),
          React.createElement('span', { style: S.meta }, `${text.length} 字`),
          React.createElement('span', { style: S.meta }, dirty ? '有未保存改动' : status),
        ),
        error === '' ? null : React.createElement('div', { style: S.err }, error),
        React.createElement(
          'div',
          { style: S.note },
          '单个对话想例外，在该对话里直接发命令：',
          React.createElement('span', { style: S.code }, '/persona off'),
          ' 本对话停用、',
          React.createElement('span', { style: S.code }, '/persona on'),
          ' 强制启用、',
          React.createElement('span', { style: S.code }, '/persona inherit'),
          ' 改回跟随全局、',
          React.createElement('span', { style: S.code }, '/persona status'),
          ' 看当前状态。',
          React.createElement('div', { style: { marginTop: '6px' } }, overrideLine),
          overrides.length === 0
            ? null
            : React.createElement(
                'button',
                { style: { ...S.button, marginTop: '6px' }, disabled: busy, onClick: resetAll },
                '清空全部会话例外',
              ),
        ),
        React.createElement(
          'div',
          { style: S.note },
          '注入机制：宿主把它注册为系统提示词里 order = -100 的段 —— 早于部署级人设（0）与其余全部配置段，仅次于工具与沙箱安全所需的内核身份段（-1000）。段落正文自带优先级声明，唯一例外是你在当前对话里另行提出的要求。',
        ),
      );
    }

    /**
     * 浏览器半身入口。
     * @param ctx - 客户端 cordis 上下文
     */
    function apply(ctx) {
      try {
        registerSection(ctx);
      } catch (failure) {
        // 注册失败只影响这一页，绝不把异常抛回客户端启动流程。
        console.warn('[dsh-persona-card] 设置页注册失败：', failure);
      }
    }

    /**
     * 注册设置页（单独成函数，方便整体 try/catch 包住）。
     * @param ctx - 客户端 cordis 上下文
     */
    function registerSection(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'persona-card',
            order: 12,
            label: () => '人设卡',
          },
          PersonaPanel,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
