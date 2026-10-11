# pi-cost-profiler

Contabilidade e limites para **Pi 1.1.0 / Node >=20**, com interface discreta. Sem banco: coleções append-only JSONL e relatórios JSON/CSV, isolados por raiz Git canônica.

```sh
npm ci --ignore-scripts --legacy-peer-deps
pi -e ./index.ts
```

## Interface

`/cost now`,` task TASK-ID`,` project --last 30d`,` compare PROVIDER/MODEL PROVIDER/MODEL`,` budget task|session|project 0.50 USD`,` export --format json|csv --scope current-project`,` reconcile billing.json`,` help`.

Autocomplete de argumentos nativo: `task` mostra os IDs de tarefa gravados para este repositório (mais recentes primeiro), `compare` mostra os modelos efetivamente vistos com nº de chamadas e custo conhecido, `budget` explica o que cada escopo limita e sugere valores, `project --last` oferece 7d/30d/90d, `export --format` oferece json|csv. `/cost` sem argumento dá o resumo da sessão; um comando errado devolve a gramática.

O tag de tarefa é compartilhado no branch com o gate. Sem tarefa: `unattributed`. Reconcile importa `[{"providerRequestId":"id","observedCostUsd":0.05}]` após confirmação humana, preservando estimativa e snapshot histórico. Export é agregado sem prompts/credenciais; custo estimado nunca é apresentado como fatura.

## Contabilidade

Input/output/cache read/cache write/reasoning (se divulgado), classificação, retries, ferramentas, latência, tokens/s, troca de modelo, falha, aceite verificado, custo por tarefa aceita/tentativa, revisão humana e retrabalho. Reasoning é subconjunto de output e não é cobrado duas vezes. Configure `inputIncludesCache` conforme semântica do provedor.

Instrumenta os provedores **nativos** preservando autenticação, modelos e conversão/streaming. Observa solicitações diretas (compaction, classificação, auxiliares), incluindo chamadas feitas dentro de ferramentas. Soma o uso próprio dos tool results por raiz e desconta os provedores nativos já instrumentados; preserva uso auxiliar reportado por extensões. Em paralelismo sem identificação suficiente registra atribuição incerta, sem duplicar cobrança nem fingir cobertura completa. `responseId`/callId dão idempotência. Preços são snapshots versionados do registry nativo; novas chamadas registram alterações sem reprecificar história. Zero sem indicação explícita de modelo local é preço desconhecido.

Custos reportados no stream e importados por reconcile têm precedência sobre estimativa; cobertura e desconhecidos são explícitos. Configure `localModels` para gasto de API local zero; energia/depreciação/oportunidade ficam em campos separados e não são somados ao gasto de API.

## Orçamentos

Soft: avisos deduplicados em 50/80/100%. Hard: reserva atômica antes do dispatch, incluindo requisições simultâneas; todos os limites aplicáveis compõem, de modo que um task limite folgado não relaxa project/locked. Preço desconhecido com hard limit falha fechado. Com limite hard, o cap preventivo de saída é `maxRequestOutputTokens` (padrão 2048); pode ser configurado conscientemente. Sem limite hard, a observabilidade não modifica o limite nativo de saída (a menos que` capOutput: true` seja explicitamente solicitado). Falha de storage informativo preserva a resposta e avisa cobertura incompleta; política financeira/auditoria obrigatória falha fechado. Estimativa de input é aproximada e rotulada.

Não promete parar faturamento remoto iniciado nem controlar chamadas fora do Pi. Outro plugin com as mesmas permissões pode substituir provedores; uma política financeira organizacional rígida requer gateway/SO. Ao desligar a extensão, seus wrappers são removidos e o provedor anterior é restaurado.

## Arquivos e testes

`model-calls`,` pricing-snapshots`,` tool-calls`,` tasks`,` outcomes`,` model-routes`,` gate-receipts`,` budgets`,` reservations`,` reconciliations`,` audit`: arquivos JSONL, nenhum SQL/driver/banco. Esquema versionado, lock de escritor, fsync e exports por rename atômico. Lock/reserva interrompidos por queda exigem inspeção/recuperação manual: não são apagados automaticamente para relaxar limites.

`npm test` valida cache, billing precedence, coortes, dedup, todos os limites e bloqueio antes de dispatch com provedor fake. Provedores externos não foram cobrados nos testes. Instalar/remover:` pi install ./pi-cost-profiler` /` pi remove ./pi-cost-profiler`.
