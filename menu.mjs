/**
 * The table behind `/cost`: every writable knob, its offered values and its patch.
 *
 * Rows of the panel (`lib/panel.mjs`) and the text commands both come from `FIELDS`, one exported
 * table (rule B): the panel has no private copy of a value list. `test/panel.test.mjs` cycles every
 * offered value through the panel and reads the file back.
 *
 * The settings adapter is not imported here: `index.ts` imports it statically and hands it to
 * `provideSettingsPanel()`, because a dynamic import of a host module from inside an extension is
 * resolved by Node and cannot resolve.
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

/** Seam for the settings adapter (`openPiSettings`), provided by the entry point. */
export const host = { settingsPanel: undefined };

/** Called once by `index.ts` with the adapter it imported statically. */
export function provideSettingsPanel(openPanel) {
  if (openPanel) host.settingsPanel = openPanel;
  return host.settingsPanel;
}
