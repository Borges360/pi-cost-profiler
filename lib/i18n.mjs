import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const LOCALES = Object.freeze(['en', 'pt-BR']);

const EN = Object.freeze({
  title: 'Cost',
  summary: '{accounting} · {spend} · {coverage} priced · scope {scope}{unavailable}',
  accountingOn: 'Accounting on',
  accountingOff: 'Accounting off',
  summaryUnavailable: ' · summary unavailable',
  scopeSession: 'session',
  scopeProject: 'project',
  scopeTask: 'task {id}',
  scopeUnavailable: 'scope unavailable',
  localeEnglish: 'English (default)',
  localePortuguese: 'Português (Brasil)',
  languageTitle: 'Language',
  languageHelp: 'Choose English or Brazilian Portuguese for this project dashboard.',
  languageTrustRequired: 'Trust this project to save its language preference. English remains active.',
  languageInvalid: 'The saved language is invalid; English is active until you choose a language.',
  languageUnreadable: 'The saved language could not be read; English is active.',
  rowLanguage: 'Language',
  rowLanguageDescription: 'Dashboard language; saved only for this trusted project.',
  rowSpend: 'Spend in window',
  rowSpendDescription: 'Current spend, scope and number of calls.',
  rowCoverage: 'Price coverage',
  rowCoverageDescription: 'Calls without a known price stay visible.',
  rowLimits: 'Active limits',
  rowLimitsDescription: 'Hard limits and soft warnings for this project.',
  rowHelp: 'Command line',
  rowHelpDescription: 'Direct /cost commands and autocomplete remain available.',
  rowBudgetAmounts: 'Budget amount',
  rowBudgetAmountsDescription: 'Choose a hard limit; the soft warning is 80%.',
  rowBudgets: 'Budgets',
  rowBudgetsDescription: 'Add, edit or remove a project, task or session limit.',
  rowLocalModels: 'Local models',
  rowLocalModelsDescription: 'Selected models are costed by time, not API price.',
  rowEnabled: 'Accounting',
  rowEnabledDescription: 'Track provider usage and enforce configured limits.',
  rowWarnUnknownPricing: 'Unknown price warnings',
  rowWarnUnknownPricingDescription: 'Show a warning when a model has no known price.',
  rowCapOutput: 'Cap output tokens',
  rowCapOutputDescription: 'Apply the output limit even when no budget is armed.',
  rowAuditRequired: 'Require cost logging',
  rowAuditRequiredDescription: 'Reject dispatch when cost logging fails.',
  rowInputIncludesCache: 'Include cached input',
  rowInputIncludesCacheDescription: 'Apply the input price to cached tokens.',
  rowMaxRequestOutputTokens: 'Output token limit',
  rowMaxRequestOutputTokensDescription: 'Default limit used by caps and budget checks.',
  rowPriceCatalogTtlHours: 'Price catalog age',
  rowPriceCatalogTtlHoursDescription: 'Refresh locally cached model prices after this many hours.',
  rowLocalEnergyUsdPerHour: 'Local energy ($/h)',
  rowLocalEnergyUsdPerHourDescription: 'Hourly energy estimate for configured local models.',
  rowLocalDepreciationUsdPerHour: 'Local depreciation ($/h)',
  rowLocalDepreciationUsdPerHourDescription: 'Hourly hardware depreciation for local models.',
  rowOpportunityUsdPerHour: 'Opportunity cost ($/h)',
  rowOpportunityUsdPerHourDescription: 'Hourly time cost for local model use.',
  rowScopeSource: 'Accounting scope',
  rowScopeSourceDescription: 'Choose session, selected task or whole project.',
  rowScopeStrict: 'Strict scope',
  rowScopeStrictDescription: 'Keep calls outside the selected window separate.',
  valueOn: 'On',
  valueOff: 'Off',
  valueLimitCount: '{count} limit(s)',
  valueModelCount: '{count} model(s)',
  valueNone: 'none',
  valueLimit: '{scope}: hard limit USD {amount}',
  valueLimitUsage: '{scope}: hard limit USD {amount} · {percent}% used',
  sourceConfiguration: 'configuration',
  sourceCommand: 'command',
  dialogBudgets: 'Budgets',
  dialogBudgetAmount: 'Budget amount · {scope}',
  dialogLocalModels: 'Local models',
  choiceEditBudget: 'Edit {scope} limit · USD {amount}',
  choiceRemoveBudget: 'Remove {scope} limit',
  choiceSetBudget: '{prefix}Set {scope} limit',
  choiceRecommended: 'Recommended: ',
  choiceCurrent: ' (current)',
  choiceBudgetAmount: '{prefix}{scope} · USD {amount}',
  choiceCountLocal: '{prefix}Count {model} as local',
  choiceProviderPrice: 'Use provider pricing for {model}',
  prefixRecommended: 'Recommended: ',
  prefixEmptyRecommended: 'Recommended: ',
  reportDraftUpdated: 'Draft updated. Press Ctrl+S to save.',
  reportNoChanges: 'No unsaved changes.',
  reportSpendUnavailable: 'Spend summary unavailable: {error}',
  reportSpend: '{scope}: {spend} · {calls} call(s)',
  reportCoverage: '{priced}/{calls} calls priced',
  reportCoverageUnknown: '{priced}/{calls} calls priced · unknown: {models}',
  reportLimits: '{limits} · output cap {tokens} tokens · cap {cap}',
  reportHelp: '/cost now · task ID · project · compare · budget · export · reconcile · cap · audit · scope · local · help',
  reportNoLocalModels: 'No local model candidates. Use /scoped-models or /cost local add provider/model.',
  reportSaved: 'Saved {count} change(s). Cost settings are active.',
  reportLanguageSaved: 'Language saved: {language}.',
  reportSettingChanged: '{field} updated to {value}.',
  reportSaveFailed: 'Save failed: {error}',
  reportExitSaved: 'Cost · {count} change(s) saved\n{notes}\nSaved in {file}',
  reportExitNoChanges: 'Cost · no changes were saved.',
  shellBack: 'Back',
  shellAuthorize: 'Authorize',
  shellCanceled: 'Operation canceled.',
  shellFailed: 'Operation failed. Try again.',
  shellCanceling: 'Canceling…',
  shellWorking: 'Working… Esc cancels the operation.',
  shellUnsaved: 'Unsaved changes. Ctrl+S saves; press Esc again to discard.',
  shellChooseHelp: '↑↓ choose · Enter confirm · Esc back',
  shellMainHelp: '↑↓ navigate · Enter edit/open · Ctrl+S save · Esc close',
});

const PT = Object.freeze({
  title: 'Custos',
  summary: '{accounting} · {spend} · {coverage} com preço · escopo {scope}{unavailable}',
  accountingOn: 'Contabilidade ativa',
  accountingOff: 'Contabilidade desativada',
  summaryUnavailable: ' · resumo indisponível',
  scopeSession: 'sessão',
  scopeProject: 'projeto',
  scopeTask: 'tarefa {id}',
  scopeUnavailable: 'escopo indisponível',
  localeEnglish: 'English (padrão)',
  localePortuguese: 'Português (Brasil)',
  languageTitle: 'Idioma',
  languageHelp: 'Escolha inglês ou português brasileiro para o painel deste projeto.',
  languageTrustRequired: 'Confie neste projeto para salvar a preferência de idioma. O inglês continua ativo.',
  languageInvalid: 'O idioma salvo é inválido; o inglês fica ativo até você escolher outro.',
  languageUnreadable: 'Não foi possível ler o idioma salvo; o inglês fica ativo.',
  rowLanguage: 'Idioma',
  rowLanguageDescription: 'Idioma do painel, salvo apenas neste projeto confiável.',
  rowSpend: 'Gasto no período',
  rowSpendDescription: 'Gasto atual, escopo e quantidade de chamadas.',
  rowCoverage: 'Cobertura de preços',
  rowCoverageDescription: 'Chamadas sem preço conhecido continuam visíveis.',
  rowLimits: 'Limites ativos',
  rowLimitsDescription: 'Limites rígidos e avisos suaves deste projeto.',
  rowHelp: 'Linha de comando',
  rowHelpDescription: 'Comandos /cost diretos e autocomplete continuam disponíveis.',
  rowBudgetAmounts: 'Valor do limite',
  rowBudgetAmountsDescription: 'Escolha um limite rígido; o aviso suave ocorre em 80%.',
  rowBudgets: 'Orçamentos',
  rowBudgetsDescription: 'Adicione, edite ou remova um limite de projeto, tarefa ou sessão.',
  rowLocalModels: 'Modelos locais',
  rowLocalModelsDescription: 'Modelos selecionados são contabilizados por tempo, não pelo preço de API.',
  rowEnabled: 'Contabilidade',
  rowEnabledDescription: 'Registra uso do provedor e aplica os limites configurados.',
  rowWarnUnknownPricing: 'Avisos de preço desconhecido',
  rowWarnUnknownPricingDescription: 'Avisa quando um modelo não tem preço conhecido.',
  rowCapOutput: 'Limitar tokens de saída',
  rowCapOutputDescription: 'Aplica o limite de saída mesmo sem orçamento armado.',
  rowAuditRequired: 'Exigir registro de custo',
  rowAuditRequiredDescription: 'Recusa o despacho se o registro de custo falhar.',
  rowInputIncludesCache: 'Incluir entrada em cache',
  rowInputIncludesCacheDescription: 'Aplica o preço de entrada aos tokens em cache.',
  rowMaxRequestOutputTokens: 'Limite de tokens de saída',
  rowMaxRequestOutputTokensDescription: 'Limite padrão usado pelos tetos e pelas verificações de orçamento.',
  rowPriceCatalogTtlHours: 'Idade do catálogo de preços',
  rowPriceCatalogTtlHoursDescription: 'Atualiza o cache local de preços após este número de horas.',
  rowLocalEnergyUsdPerHour: 'Energia local ($/h)',
  rowLocalEnergyUsdPerHourDescription: 'Estimativa de energia por hora para modelos locais configurados.',
  rowLocalDepreciationUsdPerHour: 'Depreciação local ($/h)',
  rowLocalDepreciationUsdPerHourDescription: 'Depreciação de hardware por hora para modelos locais.',
  rowOpportunityUsdPerHour: 'Custo de oportunidade ($/h)',
  rowOpportunityUsdPerHourDescription: 'Custo do tempo de espera por hora para uso local.',
  rowScopeSource: 'Escopo da conta',
  rowScopeSourceDescription: 'Escolha sessão, tarefa selecionada ou projeto inteiro.',
  rowScopeStrict: 'Escopo estrito',
  rowScopeStrictDescription: 'Mantém separadas as chamadas fora do período escolhido.',
  valueOn: 'Ativa',
  valueOff: 'Desativada',
  valueLimitCount: '{count} limite(s)',
  valueModelCount: '{count} modelo(s)',
  valueNone: 'nenhum',
  valueLimit: '{scope}: limite rígido USD {amount}',
  valueLimitUsage: '{scope}: limite rígido USD {amount} · {percent}% consumido',
  sourceConfiguration: 'configuração',
  sourceCommand: 'comando',
  dialogBudgets: 'Orçamentos',
  dialogBudgetAmount: 'Valor do limite · {scope}',
  dialogLocalModels: 'Modelos locais',
  choiceEditBudget: 'Editar limite de {scope} · USD {amount}',
  choiceRemoveBudget: 'Remover limite de {scope}',
  choiceSetBudget: '{prefix}Definir limite de {scope}',
  choiceRecommended: 'Recomendado: ',
  choiceCurrent: ' (atual)',
  choiceBudgetAmount: '{prefix}{scope} · USD {amount}',
  choiceCountLocal: '{prefix}Contabilizar {model} como modelo local',
  choiceProviderPrice: 'Usar preço do provedor para {model}',
  prefixRecommended: 'Recomendado: ',
  prefixEmptyRecommended: 'Recomendado: ',
  reportDraftUpdated: 'Rascunho atualizado. Pressione Ctrl+S para salvar.',
  reportNoChanges: 'Não há alterações sem salvar.',
  reportSpendUnavailable: 'Resumo de gastos indisponível: {error}',
  reportSpend: '{scope}: {spend} · {calls} chamada(s)',
  reportCoverage: '{priced}/{calls} chamadas com preço',
  reportCoverageUnknown: '{priced}/{calls} chamadas com preço · sem preço: {models}',
  reportLimits: '{limits} · teto de saída {tokens} tokens · limite {cap}',
  reportHelp: '/cost now · task ID · project · compare · budget · export · reconcile · cap · audit · scope · local · help',
  reportNoLocalModels: 'Nenhum modelo local candidato. Use /scoped-models ou /cost local add provider/model.',
  reportSaved: '{count} alteração(ões) salva(s). As configurações de custo estão ativas.',
  reportLanguageSaved: 'Idioma salvo: {language}.',
  reportSettingChanged: '{field} atualizado para {value}.',
  reportSaveFailed: 'Falha ao salvar: {error}',
  reportExitSaved: 'Custos · {count} alteração(ões) salva(s)\n{notes}\nSalvo em {file}',
  reportExitNoChanges: 'Custos · nenhuma alteração foi salva.',
  shellBack: 'Voltar',
  shellAuthorize: 'Confirmar',
  shellCanceled: 'Operação cancelada.',
  shellFailed: 'A operação falhou. Tente novamente.',
  shellCanceling: 'Cancelando…',
  shellWorking: 'Trabalhando… Esc cancela a operação.',
  shellUnsaved: 'Há alterações sem salvar. Ctrl+S salva; pressione Esc novamente para descartar.',
  shellChooseHelp: '↑↓ escolher · Enter confirmar · Esc voltar',
  shellMainHelp: '↑↓ navegar · Enter editar/abrir · Ctrl+S salvar · Esc fechar',
});

export const CATALOGS = Object.freeze({ en: EN, 'pt-BR': PT });

export function translate(locale, key, values = {}) {
  const template = CATALOGS[locale]?.[key] ?? EN[key];
  if (typeof template !== 'string') return key;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

export function localeName(locale) {
  return translate(locale, locale === 'pt-BR' ? 'localePortuguese' : 'localeEnglish');
}

export function fieldDisplayValue(locale, fieldId, value) {
  if (value === 'on') return translate(locale, 'valueOn');
  if (value === 'off') return translate(locale, 'valueOff');
  if (fieldId === 'scopeSource') {
    if (value === 'session') return translate(locale, 'scopeSession');
    if (value === 'task') return translate(locale, 'scopeTask', { id: '' }).trim();
    if (value === 'project') return translate(locale, 'scopeProject');
  }
  return String(value);
}

export function localeShell(locale) {
  return {
    back: translate(locale, 'shellBack'),
    authorize: translate(locale, 'shellAuthorize'),
    canceled: translate(locale, 'shellCanceled'),
    failed: translate(locale, 'shellFailed'),
    canceling: translate(locale, 'shellCanceling'),
    working: translate(locale, 'shellWorking'),
    unsaved: translate(locale, 'shellUnsaved'),
    chooseHelp: translate(locale, 'shellChooseHelp'),
    mainHelp: translate(locale, 'shellMainHelp'),
  };
}

export async function readProjectLocale({ root, trusted }) {
  if (!trusted || typeof root !== 'string' || !root)
    return { locale: 'en', canPersist: false, issue: null, file: null };
  const projectRoot = resolve(root);
  const file = join(projectRoot, '.pi', 'pi-cost-profiler.locale.json');
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed?.schemaVersion !== 1 || !LOCALES.includes(parsed.locale))
      return { locale: 'en', canPersist: true, issue: 'invalid', file };
    return { locale: parsed.locale, canPersist: true, issue: null, file };
  } catch (error) {
    if (error?.code === 'ENOENT') return { locale: 'en', canPersist: true, issue: null, file };
    return { locale: 'en', canPersist: true, issue: 'unreadable', file };
  }
}

export async function writeProjectLocale({ root, trusted, locale, signal }) {
  if (!trusted || typeof root !== 'string' || !root)
    throw new Error('Project trust is required to save a project language preference.');
  if (!LOCALES.includes(locale)) throw new Error('Unsupported language preference.');
  if (signal?.aborted) throw signal.reason ?? new Error('Operation canceled');
  const file = join(resolve(root), '.pi', 'pi-cost-profiler.locale.json');
  const temp = file + '.' + randomUUID() + '.tmp';
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, JSON.stringify({ schemaVersion: 1, locale }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (signal?.aborted) throw signal.reason ?? new Error('Operation canceled');
    await rename(temp, file);
    return file;
  } finally {
    await unlink(temp).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
}

export function catalogKeys(locale = 'en') {
  return Object.keys(CATALOGS[locale] ?? EN);
}

export function placeholderNames(template) {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

/** Simple terminal-width wrapper used to verify localized copy at the standard widths. */
export function wrapPanelText(text, width) {
  const output = [];
  for (const sourceLine of String(text).split('\n')) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      if (word.length > width) {
        if (line) output.push(line);
        for (let i = 0; i < word.length; i += width) output.push(word.slice(i, i + width));
        line = '';
        continue;
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else { output.push(line); line = word; }
    }
    if (line) output.push(line);
  }
  return output;
}
