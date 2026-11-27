/**
 * The `/cost` panel.
 *
 * Money questions want the number first: what this session spent, what fraction of the
 * calls actually have a price, which limit is armed and how close it is. The screen shows
 * that, then the dials. Every change is applied and persisted the moment it is made.
 *
 * Rows come from `FIELDS`, one exported table (rule B): the panel has no private copy of
 * a value list. `test/panel-parity.test.mjs` cycles every offered value and reads the
 * file back, which is the generic form of the economist's `selected-as` bug.
 *
 * The host modules are not imported here — `index.ts` imports them statically and hands
 * them to `provideHost()`, because a dynamic `await import('@earendil-works/pi-tui')`
 * from inside an extension is resolved by Node and cannot resolve.
 */
import { defaults } from './extension.mjs';

/** Levels a limit can be attached to, and what each one actually covers. */
export const BUDGET_LEVELS = [
  { value: 'project', description: 'toda despesa do projeto, com ou sem task' },
  { value: 'task', description: 'só as chamadas com o taskId selecionado' },
  { value: 'session', description: 'só esta sessão' },
];

/** Amounts the table offers; `$` figures are hard caps, soft warns at 80%. */
export const BUDGET_AMOUNTS = ['0.50', '1.00', '5.00', '20.00', '100.00'];

const rate = (v) => Number(v);

/** One table for every writable knob. `patch` returns keys inside `costProfiler`. */
export const FIELDS = {
  enabled: {
    label: 'Contabilidade',
    lock: 'enabled',
    values: ['on', 'off'],
    current: (c) => (c.enabled ? 'on' : 'off'),
    patch: (v) => ({ enabled: v === 'on' }),
    note: (v) => (v === 'on' ? 'contabilidade ligada' : 'contabilidade desligada — nada é medido, orçamentos não bloqueiam'),
    hint: 'on registra cada chamada; off desliga medição e limites',
  },
  warnUnknownPricing: {
    label: 'Avisar preço desconhecido',
    lock: 'warnUnknownPricing',
    values: ['on', 'off'],
    current: (c) => (c.warnUnknownPricing ? 'on' : 'off'),
    patch: (v) => ({ warnUnknownPricing: v === 'on' }),
    note: (v) => `aviso de preço desconhecido → ${v}`,
    hint: 'o preço vem do catálogo do host; sem preço, a conta é estimada ou nula',
  },
  capOutput: {
    label: 'Limitar tokens de saída',
    lock: 'capOutput',
    values: ['on', 'off'],
    current: (c) => (c.capOutput === true ? 'on' : 'off'),
    patch: (v) => ({ capOutput: v === 'on' }),
    note: (v, c) =>
      v === 'on'
        ? `⚠ toda chamada passa a pedir no máximo ${(c.maxRequestOutputTokens ?? 2048)} tokens de saída`
        : 'sem orçamento armado, o modelo usa o teto dele',
    hint: 'on corta `max_tokens` mesmo sem orçamento — pode truncar respostas longas',
  },
  auditRequired: {
    label: 'Contabilidade obrigatória',
    lock: 'auditRequired',
    values: ['on', 'off'],
    current: (c) => (c.auditRequired === true ? 'on' : 'off'),
    patch: (v) => ({ auditRequired: v === 'on' }),
    note: (v) =>
      v === 'on'
        ? '⚠ se o registro de custo falhar, o pedido é NEGADO em vez de seguir sem medir'
        : 'falha de registro é avisada e o pedido segue',
    hint: 'transforma o contador de informação em pré-condição do despacho',
  },
  inputIncludesCache: {
    label: 'Entrada inclui cache',
    lock: 'inputIncludesCache',
    values: ['on', 'off'],
    current: (c) => (c.inputIncludesCache ? 'on' : 'off'),
    patch: (v) => ({ inputIncludesCache: v === 'on' }),
    note: (v) => `preço de entrada aplicado ao cache → ${v}`,
    hint: 'muda a estimativa, não o que o provedor cobra',
  },
  maxRequestOutputTokens: {
    label: 'Teto de tokens de saída',
    lock: 'maxRequestOutputTokens',
    values: ['1024', '2048', '4096', '8192'],
    current: (c) => String(c.maxRequestOutputTokens ?? 2048),
    patch: (v) => ({ maxRequestOutputTokens: rate(v) }),
    note: (v) => `teto de saída → ${v} tokens`,
    hint: 'usado quando há orçamento ou "Limitar tokens de saída" ligado',
  },
  priceCatalogTtlHours: {
    label: 'Validade do catálogo de preços',
    lock: 'priceCatalogTtlHours',
    values: ['6', '24', '72', '168'],
    current: (c) => String(c.priceCatalogTtlHours ?? 24),
    patch: (v) => ({ priceCatalogTtlHours: rate(v) }),
    note: (v) => `revalida preços a cada ${v}h`,
    hint: 'cache local do catálogo; maior é mais rápido e mais velho',
  },
  localEnergyUsdPerHour: {
    label: 'Energia local ($/h)',
    lock: 'localEnergyUsdPerHour',
    values: ['0', '0.05', '0.2', '0.5', '1'],
    current: (c) => String(c.localEnergyUsdPerHour ?? 0),
    patch: (v) => ({ localEnergyUsdPerHour: rate(v) }),
    note: (v) => `energia → $${v}/h para modelos locais`,
    hint: 'só entra na conta dos modelos em "Modelos locais"',
  },
  localDepreciationUsdPerHour: {
    label: 'Depreciação local ($/h)',
    lock: 'localDepreciationUsdPerHour',
    values: ['0', '0.2', '0.5', '1', '2'],
    current: (c) => String(c.localDepreciationUsdPerHour ?? 0),
    patch: (v) => ({ localDepreciationUsdPerHour: rate(v) }),
    note: (v) => `depreciação → $${v}/h`,
    hint: 'hardware local, não cobrança de provedor',
  },
  opportunityUsdPerHour: {
    label: 'Custo de oportunidade ($/h)',
    lock: 'opportunityUsdPerHour',
    values: ['0', '5', '20', '50', '100'],
    current: (c) => String(c.opportunityUsdPerHour ?? 0),
    patch: (v) => ({ opportunityUsdPerHour: rate(v) }),
    note: (v) => `tempo de espera → $${v}/h`,
    hint: 'entra em `totalCostUSD` e na decisão de orçamento local',
  },
  scopeSource: {
    label: 'Escopo da conta',
    lock: 'scope',
    values: ['session', 'task', 'project'],
    current: (c) => c.scope?.source ?? 'session',
    patch: (v) => ({ scope: { source: v } }),
    note: (v) =>
      v === 'session'
        ? '"gasto atual" = esta sessão (o que /cost now sempre mostrou)'
        : v === 'task'
          ? '"gasto atual" = a task selecionada; sem /cost task <ID> nada é atribuído'
          : '"gasto atual" = o projeto inteiro',
    hint: 'define a janela que o painel e os avisos usam',
  },
  scopeStrict: {
    label: 'Escopo estrito',
    lock: 'scope',
    values: ['on', 'off'],
    current: (c) => (c.scope?.strict === false ? 'off' : 'on'),
    patch: (v) => ({ scope: { strict: v === 'on' } }),
    note: (v) =>
      v === 'on'
        ? 'chamada sem task, com o escopo em task, aparece out-of-scope em vez de entrar no total'
        : 'chamada fora do escopo entra no total do janela (soma maior, menos fiel)',
    hint: 'não muda cobrança nem limites: muda o que a janela mostra',
  },
  budgets: {
    label: 'Orçamentos (persistidos)',
    lock: 'budgets',
    kind: 'list',
    listKey: 'budgets',
    accepts: (v) => /^(set|remove):(project|task|session)(:[0-9]+(\.[0-9]+)?)?$/.test(String(v)),
    values: (c) => [
      ...BUDGET_LEVELS.filter((l) => !Object.hasOwn(c.budgets ?? {}, l.value)).map(
        (l) => `set:${l.value}`,
      ),
      ...BUDGET_LEVELS.filter((l) => Object.hasOwn(c.budgets ?? {}, l.value)).map(
        (l) => `remove:${l.value}`,
      ),
    ],
    current: (c) => `${Object.keys(c.budgets ?? {}).length} limite(s) no arquivo`,
    patch: (v, c) => {
      const [op, level, amount] = String(v).split(':');
      const budgets = { ...(c.budgets ?? {}) };
      if (op === 'remove') {
        delete budgets[level];
        return { budgets };
      }
      const n = Number(amount ?? BUDGET_AMOUNTS[0]);
      return { budgets: { ...budgets, [level]: { hardUsd: n, softUsd: Number((n * 0.8).toFixed(4)) } } };
    },
    note: (v) =>
      String(v).startsWith('remove:')
        ? `limite de ${v.slice(7)} saiu do arquivo`
        : `⚠ limite de ${v.split(':')[1]} escrito no arquivo: vale para toda sessão deste projeto`,
    hint: 'escreve em costProfiler.budgets (persistente) — `/cost budget task 0.50 USD` é só desta task/sessão',
  },
  localModels: {
    label: 'Modelos locais',
    lock: 'localModels',
    kind: 'list',
    listKey: 'localModels',
    accepts: (v) => /^(add|remove):[\w.:@/+-]{1,120}$/.test(String(v)),
    values: (c, state = {}) => [
      ...(c.localModels ?? []).map((m) => `remove:${m}`),
      ...(state.routable ?? [])
        .filter((m) => !(c.localModels ?? []).includes(m))
        .map((m) => `add:${m}`),
    ],
    current: (c) => `${(c.localModels ?? []).length} modelo(s)`,
    patch: (v, c) => {
      const list = c.localModels ?? [];
      return {
        localModels: String(v).startsWith('add:')
          ? [...new Set([...list, v.slice(4)])]
          : list.filter((m) => m !== v.slice(7)),
      };
    },
    note: (v) =>
      String(v).startsWith('add:')
        ? `${v.slice(4)} passa a ser contabilizado por tempo, não por preço de API`
        : `${v.slice(7)} volta a usar o catálogo de preços`,
    hint: 'candidatos vêm de /scoped-models quando ele não está vazio',
  },
};

export const c0 = () => defaults.costProfiler;

/** Value list of a field, always through the table. */
export function fieldValues(id, conf = c0(), state = {}) {
  const field = FIELDS[id];
  if (!field) throw Error(`campo desconhecido: ${id}`);
  return typeof field.values === 'function' ? field.values(conf ?? c0(), state) : field.values;
}

/** The one writer for both paths (panel and text command): lock, membership, patch. */
export function applyField(conf, id, value, { locked = {}, state = {} } = {}) {
  const field = FIELDS[id];
  if (!field) throw Error(`campo desconhecido: ${id}`);
  if (Object.hasOwn(locked, field.lock))
    throw Error(`costProfiler.${field.lock} está travado por política global.`);
  const allowed = fieldValues(id, conf, state);
  if (!allowed.includes(value) && !(field.accepts?.(value) ?? false))
    throw Error(`Invalid ${id}: ${value}\nUse: ${allowed.join(' | ') || '(nada a oferecer agora)'}`);
  return { patch: field.patch(value, conf), note: field.note(value, conf), id, value };
}

/** Enum rows, derived from the table, in table order, minus locked keys. */
export function enumItems({ conf, locked = {} }) {
  return Object.entries(FIELDS)
    .filter(([, field]) => field.kind !== 'list')
    .filter(([id]) => !Object.hasOwn(locked, FIELDS[id].lock))
    .map(([id, field]) => ({
      id,
      label: field.label,
      currentValue: field.current(conf),
      values: fieldValues(id, conf),
      description: `${field.hint} · ${field.note(field.current(conf), conf)}`,
    }));
}

/** List rows (membership, not scalars) — budget levels and local models. */
export function listItems(conf, { locked = {}, state = {} } = {}) {
  return Object.entries(FIELDS)
    .filter(([, field]) => field.kind === 'list')
    .filter(([id]) => !Object.hasOwn(locked, FIELDS[id].lock))
    .map(([id, field]) => ({
      id,
      label: field.label,
      currentValue: field.current(conf),
      submenu: true,
      description: fieldValues(id, conf, state).length
        ? field.hint
        : `${field.hint} · nada pendente`,
    }));
}

/** Amount rows for one budget level: the second level of the `budgets` submenu. */
export function amountRows(level, conf) {
  const current = conf.budgets?.[level]?.hardUsd;
  return BUDGET_AMOUNTS.map((amount, i) => ({
    value: `set:${level}:${amount}`,
    label: `${i === 0 ? '▸ recomendado ' : ''}${level} $${amount}`,
    description:
      Number(current) === Number(amount)
        ? 'valor atual'
        : `hard $${amount} · avisa em ${(amount * 0.8).toFixed(2)} · persiste no arquivo`,
  }));
}

/** State rows: what the money did, not what the config says. */
export function stateItems(state) {
  return [
    {
      id: 'spend',
      label: 'Gasto da janela',
      currentValue: state.spendText ?? '—',
      submenu: true,
      description: `${state.scopeLabel ?? 'sessão'} · ${state.calls ?? 0} chamada(s)`,
    },
    {
      id: 'coverage',
      label: 'Cobertura de preço',
      currentValue: `${state.priced ?? 0}/${state.calls ?? 0}`,
      submenu: true,
      description: 'chamadas sem preço ficam visíveis, não somadas como zero',
    },
    {
      // Second level of `budgets`: `navigateTo` opens it after a scope is picked, and
      // the row carries which scope the amounts belong to.
      id: 'budgetAmounts',
      label: 'Valor do limite',
      currentValue: '—',
      submenu: true,
      description: 'hard e soft (avisa em 80%) para o escopo escolhido',
    },
    {
      id: 'limits',
      label: 'Limites ativos',
      currentValue: state.limitText ?? 'nenhum',
      submenu: true,
      description: 'quanto falta para o soft e para o hard de cada escopo',
    },
    {
      id: 'help',
      label: 'Modo linha de comando',
      currentValue: '—',
      submenu: true,
      description: 'os comandos diretos continuam válidos e têm autocomplete',
    },
  ];
}

export function panelItems({ conf, locked = {}, state }) {
  return [
    ...stateItems(state),
    ...listItems(conf, { locked, state }),
    ...enumItems({ conf, locked }),
  ];
}

export function panelTitle(conf, state) {
  return [
    'Cost',
    conf.enabled ? 'ON' : 'off',
    `${state.spendText ?? '—'}`,
    `${state.priced ?? 0}/${state.calls ?? 0} com preço`,
    `escopo ${conf.scope?.source ?? 'session'}`,
  ].join(' · ');
}

/** Coverage lines: unknown price is a scope fact about the session, not a zero. */
export function coverageLines(state) {
  const rows = state.unpriced ?? [];
  return [
    `${state.calls ?? 0} chamada(s) na janela · ${state.priced ?? 0} com preço conhecido`,
    rows.length
      ? `fora do escopo de preço (${rows.length}): ${rows.map((r) => r.model).join(', ')}`
      : 'nenhuma chamada sem preço na janela',
    rows.length
      ? 'sem preço não há estimativa honesta: declare o modelo em "Modelos locais" ou use um modelo do catálogo'
      : '',
    conf_note(state),
  ]
    .filter(Boolean)
    .join('\n')
    .split('\n');
}

const conf_note = (state) =>
  `strict ${state.strict ? 'on' : 'off'}: chamadas fora da janela ${state.strict ? 'aparecem como out-of-scope' : 'entram na soma'}`;

/** Lines for the `limits` screen, in the order the dispatcher applies them. */
export function limitLines(conf, state) {
  const rows = Object.entries(conf.budgets ?? {}).map(
    ([level, b]) =>
      `${level}: hard $${b.hardUsd} · soft $${b.softUsd} · ${state.percent?.[level] ?? 0}% consumido`,
  );
  if (!rows.length)
    return [
      'Nenhum limite em costProfiler.budgets (o arquivo).',
      '/cost budget project 5.00 USD armazena um limite só desta task/sessão; o painel persiste.',
    ];
  return [
    ...rows,
    'com hard no arquivo, toda nova chamada é negada antes do despacho se o preço for desconhecido',
  ];
}
/* ------------------------------------------------------------------ *\n   Host seam (M1/M2): the entry point wires the real modules in.\n   ------------------------------------------------------------------ */

/** Test/production seam for the host modules. */
export const host = { tui: undefined, agent: undefined, settingsPanel: undefined };

/** Called once by `index.ts` with the modules it imported statically. */
export function provideHost(tui, agent) {
  if (tui) host.tui = tui;
  if (agent) host.agent = agent;
  return host;
}

/** The generic workspace panel is statically imported by the Pi entry point. */
export function provideSettingsPanel(openPanel) {
  if (openPanel) host.settingsPanel = openPanel;
  return host.settingsPanel;
}

/** Which export the screen needs, and from which package (checked by the smoke). */
export const HOST_EXPORTS = {
  '@earendil-works/pi-tui': ['Container', 'SettingsList', 'SelectList', 'Text', 'Input'],
  '@earendil-works/pi-coding-agent': [
    'DynamicBorder',
    'getSettingsListTheme',
    'getSelectListTheme',
  ],
};
/** Optional niceties: used when present, literal fallbacks when not. */
export const OPTIONAL_EXPORTS = {
  '@earendil-works/pi-coding-agent': ['keyHint', 'keyText'],
};

/** Name the exports the host does not provide (a missing module is all of them). */
export function missingHostExports(tuiPkg, agentPkg) {
  const mods = {
    '@earendil-works/pi-tui': tuiPkg,
    '@earendil-works/pi-coding-agent': agentPkg,
  };
  return Object.entries(HOST_EXPORTS).flatMap(([name, exports]) =>
    exports.filter((key) => typeof mods[name]?.[key] !== 'function').map((key) => `${name}.${key}`),
  );
}

function why(error) {
  return String(error?.code ?? error?.message ?? error).split('\n')[0];
}

/** Degradation is allowed; silence is not. */
function degrade(ctx, reason) {
  try {
    ctx?.ui?.notify?.(`Cost sem painel interativo: ${reason}`, 'warning');
  } catch {
    /* the reason stays, a broken notify must not add a second error */
  }
  return false;
}

/**
 * Show the panel. Returns false when the host cannot run a custom screen, so the caller
 * falls back to a text panel that leads with state.
 */
export async function runDashboard(deps, injection = {}) {
  const { ctx, title, items, onChange, menus } = deps;
  if (ctx.mode !== 'tui' || typeof ctx.ui.custom !== 'function') return false;
  let tuiPkg = injection.tuiPkg ?? host.tui,
    agentPkg = injection.agentPkg ?? host.agent;
  if (!tuiPkg) {
    try {
      tuiPkg = await import('@earendil-works/pi-tui');
    } catch (error) {
      return degrade(ctx, `@earendil-works/pi-tui indisponível (${why(error)})`);
    }
  }
  if (!agentPkg) {
    try {
      agentPkg = await import('@earendil-works/pi-coding-agent');
    } catch (error) {
      return degrade(ctx, `@earendil-works/pi-coding-agent indisponível (${why(error)})`);
    }
  }
  const missing = missingHostExports(tuiPkg, agentPkg);
  if (missing.length)
    return degrade(
      ctx,
      `faltam exports: ${missing.join(', ')} — este pi não expõe a tela customizada esperada`,
    );
  const { Container, SettingsList, SelectList, Text, Input } = tuiPkg;
  const { DynamicBorder, getSettingsListTheme, getSelectListTheme, keyHint, keyText } = agentPkg;
  const changed = [];
  await ctx.ui.custom((tuiRef, theme, keybindings, done) => {
    const cancel = (data) => keybindings?.matches?.(data, 'tui.select.cancel') === true;
    const navHint =
      typeof keyText === 'function'
        ? `  ${keyText('tui.select.up')}/${keyText('tui.select.down')} navegar · ${keyText('tui.select.confirm')} escolher · ${keyText('tui.select.cancel')} voltar`
        : '  ↑↓ navegar · enter escolher · esc voltar';
    const backHint =
      typeof keyHint === 'function' ? `  ${keyHint('tui.select.cancel', 'voltar')}` : '  esc voltar';
    const box = new Container();
    box.addChild(new DynamicBorder((str) => theme.fg('accent', str)));
    box.addChild(new Text(theme.fg('accent', theme.bold ? theme.bold(title) : title), 1, 0));
    const list = new SettingsList(
      items,
      Math.min(items.length, 12),
      getSettingsListTheme(),
      (id, value) => {
        const note = onChange(id, value, (target, replacement) =>
          list.updateValue(target, replacement),
        );
        return Promise.resolve(note).then((text) => {
          if (text) changed.push(text);
          ctx.ui.notify(text ?? `${id} → ${value}`, 'info');
          tuiRef.requestRender();
          return text;
        });
      },
      () => done({ changed }),
    );
    const frame = (heading) => {
      const inner = new Container();
      inner.addChild(new Text(theme.fg('accent', heading), 1, 0));
      return inner;
    };
    const screen = (heading, rows, onPick, onClose) => {
      const inner = frame(heading);
      const select = new SelectList(rows || [], Math.min(rows?.length || 1, 8), getSelectListTheme());
      select.onSelect = (item) => onPick(item.value);
      select.onCancel = () => onClose();
      inner.addChild(select);
      inner.addChild(new Text(theme.fg('dim', navHint.trim()), 1, 0));
      return {
        render: (width) => inner.render(width),
        invalidate: () => inner.invalidate(),
        handleInput: (data) => {
          select.handleInput(data);
          tuiRef.requestRender();
        },
      };
    };
    const textScreen = (heading, lines, onClose) => {
      const inner = frame(heading);
      const rows = lines == null ? ['(vazio)'] : Array.isArray(lines) ? lines : [lines];
      for (const line of rows.flatMap((l) => String(l).split('\n')))
        inner.addChild(new Text(theme.fg('muted', `  ${line}`), 0, 0));
      inner.addChild(new Text(theme.fg('dim', backHint.trim()), 1, 0));
      return {
        render: (width) => inner.render(width),
        invalidate: () => inner.invalidate(),
        handleInput: (data) => {
          if (cancel(data)) onClose();
        },
      };
    };
    const panels = {
      spend: (_c, close) => textScreen('Gasto da janela', menus.spend(), () => close()),
      coverage: (_c, close) => textScreen('Cobertura de preço', menus.coverage(), () => close()),
      limits: (_c, close) => textScreen('Limites', menus.limits(), () => close()),
      help: (_c, close) => textScreen('Linha de comando', menus.help(), () => close()),
      budgets: (_c, close) =>
        screen(
          'Orçamentos · escolha o escopo; o valor vem em seguida',
          menus.budgets(),
          (value) => {
            if (value === 'noop' || String(value).startsWith('remove:')) return close(value);
            const level = String(value).startsWith('edit:') ? value.slice(5) : value.slice(4);
            // `navigateTo` re-selects AND activates the target
            // (`settings-list.js:222-233`): the amount list opens by itself, and a
            // second Enter would pick one of ITS rows.
            const row = items.find((i) => i.id === 'budgetAmounts');
            if (row) row.currentValue = level;
            return close(undefined, { navigateTo: 'budgetAmounts' });
          },
          () => close(),
        ),
      budgetAmounts: (current, close) =>
        screen(
          `Valor do limite${current ? ` · ${current}` : ''}`,
          menus.amounts(current || 'project'),
          (value) => close(value),
          () => close(),
        ),
      localModels: (_c, close) =>
        screen(
          'Modelos locais · candidatos vêm de /scoped-models quando ele não está vazio',
          menus.localModels(),
          (value) => close(value),
          () => close(),
        ),
    };;
    for (const item of items) {
      if (item.submenu !== true) continue;
      const panel = panels[item.id];
      if (!panel) continue;
      item.submenu = (currentValue, close) =>
        panel(currentValue === '—' ? undefined : currentValue, close);
    }
    box.addChild(list);
    box.addChild(new DynamicBorder((str) => theme.fg('accent', str)));
    return {
      render: (width) => box.render(width),
      invalidate: () => box.invalidate(),
      handleInput: (data) => {
        list.handleInput(data);
        tuiRef.requestRender();
      },
    };
  });
  return { changed };
}
