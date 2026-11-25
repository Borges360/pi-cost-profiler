# Pi Cost Profiler

Local cost accounting and budget controls for Pi model calls, organized by session, task and project.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Validate](https://github.com/Borges360/pi-cost-profiler/actions/workflows/test.yml/badge.svg)](https://github.com/Borges360/pi-cost-profiler/actions/workflows/test.yml)

**English** · [Português (Brasil)](#português-brasil)

| | |
| --- | --- |
| Package | `pi-cost-profiler` · `0.3.0` · private, not published to npm |
| Status | Development release. Install from Git or from a source checkout. The panel smoke has run against Pi `1.6.0` only. |
| Compatibility | Node.js `>=22.19.0` (required by `pi-tui` `1.6.0`). Pi peer packages: `>=1.5.2 <1.7.0`. CI runs `npm test` on Node 22 and 24, Linux and Windows. This is not a compatibility matrix. |

## English

### What it does

`/cost` records usage and cost metadata from model calls handled by Pi, keeps JSON/JSONL state locally, summarizes session, task and project totals, and can deny a new dispatch when a configured hard budget would be exceeded. Prices come from the Pi model metadata and are kept as snapshots. An unknown price stays unknown; it is never reported as zero.

Soft budgets warn. Hard budgets reserve against the configured scope before dispatch.

> Hard budgets cannot stop a request that has already started, and they do not control requests that bypass this extension.

Local models can be listed for time-based accounting. Energy and depreciation estimates stay separate from API spend.

### Install

From a source checkout, install the dependencies and load the extension for the current Pi session from the repository root:

~~~sh
npm ci --ignore-scripts --legacy-peer-deps
pi -e ./index.ts
~~~

The manifest declares the extension in `pi.extensions`, so Pi can also install it from Git:

~~~sh
pi install git:github.com/Borges360/pi-cost-profiler
~~~

This installs from Git, not from the npm registry. The package is private and has not been published to npm.

### Use

In a Pi TUI, `/cost` with no arguments opens the settings panel at once. Spend, price coverage and active limits fill in as soon as the local ledger is read. In a client without custom-screen support, `/cost` prints a summary and the direct command forms.

- `↑`/`↓` move. `Enter` edits a value or runs a row; on a yes/no setting it switches the value. `Space` toggles a local model, `/` searches the rows, `Tab` reaches `[Save changes]` `[Help]` `[Close]`.
- Edits stay a draft (the title shows `*`) until `Ctrl+S` validates and saves them. The panel stays open after saving.
- `Esc` in a field or list goes back without applying it. At the root, `Esc` with a draft warns; a second `Esc` discards the changes and closes.
- `Esc` during a save or a refresh cancels it. A failed or cancelled save keeps the draft for another `Ctrl+S`. If a save cannot be confirmed, `Ctrl+S` (or `[Check storage]`) rereads the stored settings before writing again.
- Budgets are one setting per level (project, task, session): no limit, or a hard amount with the soft warning at 80%. Values set outside the panel stay selectable.
- Settings locked by the global policy show `[source: global policy]` and are never written by the panel.

~~~text
/cost now
/cost task TASK-ID
/cost project --last 7d
/cost compare provider/model provider/model
/cost budget project 5.00 USD
/cost export --format json
/cost reconcile ./billing.json
/cost local add provider/model
/cost on
/cost off
/cost help
~~~

`/cost reconcile` expects a local JSON array such as `[{"providerRequestId":"request-id","observedCostUsd":0.05}]` and asks for confirmation before importing observed billing values. `/cost export` supports JSON and CSV. An export is a report, not an invoice.

### Configuration and state

Defaults enable accounting, use the session scope, warn on unknown prices and leave budgets empty.

The shared configuration is `~/.pi/agent/pi-suite/config.yaml`. In a trusted project, `.pi/pi-suite.yaml` is also read. Defaults are merged with the global and trusted-project settings, then values under `locked` in the global configuration take precedence. The panel keeps edits as a draft and writes the applicable file (the project file when the project is trusted, otherwise the global one) only after `Ctrl+S`.

Example project configuration:

~~~yaml
costProfiler:
  enabled: true
  scope:
    source: project
    strict: true
  budgets:
    project:
      softUsd: 4
      hardUsd: 5
~~~

Ledger collections are local JSONL files in the per-project state directory, `~/.pi/agent/pi-suite/projects/<project-id>/`. They hold accounting events: model and provider identifiers, usage, price snapshots, task and session identifiers, and cost outcomes. The extension is not a provider gateway and does not replace Pi's authentication or network controls.

Themes: on load, the extension copies the color themes of its terminal adapter to `<agent-dir>/themes/`, so they are listed in `/settings` → **Theme**. It never changes the selected theme and never overwrites a theme file you edited. Set `PI_DESIGN_THEMES=off` to skip the copy.

### Language

This README is available in English and Brazilian Portuguese. In a trusted Pi project, open `/cost` and choose **Language** to preview the panel in English or Português (Brasil). `Ctrl+S` stores the preference only in that project's `.pi/pi-cost-profiler.locale.json`. On first use, and when the value is missing or invalid, the panel uses English. `Esc` keeps the usual draft warning and discard behavior. Command names, IDs and configuration keys do not change.

### Privacy and security

The extension stores its ledger and project configuration locally. In the documented local checks it does not send cost data to any service. Pi's own traffic to providers is separate. Hard limits govern only dispatches this extension can observe before they start.

`/cost reconcile` reads a local billing file you choose. Exports can contain project usage details; review them before sharing.

### Troubleshooting and limits

- **Totals show an unknown price.** Check the model's pricing metadata, or add a confirmed local model with `/cost local add provider/model`. Unknown values are not treated as free.
- **Project settings are not applied.** Check that Pi trusts the project, then inspect `.pi/pi-suite.yaml` and any `locked` values in the global configuration.
- **A call was billed despite a hard limit.** The extension cannot cancel provider billing already in progress or govern calls made by other extensions.

### Contributing

Set up a checkout and run the checks:

~~~sh
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run smoke
~~~

`npm test` runs the unit suite. `npm run smoke` needs an installed Pi `1.6.0`: it stages an installed copy of the package, loads it with that release's loader (default `~/.pi/agent/install/releases/1.6.0`; set `PI_HOST_DIR` to use another release directory) and drives the panel with that release's `pi-tui`. It uses synthetic ledger and state data in temporary directories and does not call a model or provider. It does not replace a manual check in a real terminal.

Open pull requests against `develop`. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

### License

MIT, see [LICENSE](LICENSE). Third-party code in `vendor/` keeps its own license; see [`vendor/THIRD_PARTY_NOTICES.md`](vendor/THIRD_PARTY_NOTICES.md).

## Português (Brasil)

### O que faz

`/cost` registra uso e metadados de custo das chamadas de modelo processadas pelo Pi, mantém estado local em JSON/JSONL, resume totais por sessão, tarefa e projeto e pode negar um novo despacho quando um limite rígido configurado seria excedido. Os preços vêm dos metadados de modelos do Pi e ficam guardados como snapshots. Preço desconhecido continua desconhecido; nunca é apresentado como zero.

Limites suaves geram avisos. Limites rígidos reservam o valor no escopo configurado antes do despacho.

> Limites rígidos não param uma solicitação que já começou e não controlam chamadas que não passam por esta extensão.

Modelos locais podem ser contabilizados por tempo. Estimativas de energia e depreciação ficam separadas do gasto de API.

### Instalação

Em um checkout do código-fonte, instale as dependências e carregue a extensão na sessão atual do Pi a partir da raiz do repositório:

~~~sh
npm ci --ignore-scripts --legacy-peer-deps
pi -e ./index.ts
~~~

O manifesto declara a extensão em `pi.extensions`, então o Pi também pode instalá-la pelo Git:

~~~sh
pi install git:github.com/Borges360/pi-cost-profiler
~~~

Essa instalação usa o Git, não o registry do npm. O pacote é privado e ainda não foi publicado no npm.

### Uso

Na TUI do Pi, `/cost` sem argumentos abre o painel de configurações na hora. Gasto, cobertura de preços e limites ativos aparecem assim que o ledger local é lido. Em clientes sem suporte a tela customizada, `/cost` mostra um resumo e os formatos dos comandos diretos.

- `↑`/`↓` movem. `Enter` edita um valor ou executa uma linha; numa opção sim/não, alterna o valor. `Espaço` marca um modelo local, `/` busca linhas, `Tab` leva a `[Salvar alterações]` `[Ajuda]` `[Fechar]`.
- As edições ficam em rascunho (o título mostra `*`) até `Ctrl+S` validar e salvar. O painel continua aberto depois de salvar.
- `Esc` num campo ou lista volta sem aplicar. Na tela inicial, `Esc` com rascunho avisa; um segundo `Esc` descarta as mudanças e fecha.
- `Esc` durante um salvamento ou uma atualização cancela a operação. Salvamento com falha ou cancelado mantém o rascunho para outro `Ctrl+S`. Se o salvamento não puder ser confirmado, `Ctrl+S` (ou `[Conferir armazenamento]`) relê a configuração gravada antes de gravar de novo.
- Os orçamentos são uma opção por nível (projeto, tarefa, sessão): sem limite, ou um valor rígido com aviso suave em 80%. Valores definidos fora do painel continuam selecionáveis.
- Opções travadas pela política global mostram `[origem: política global]` e nunca são gravadas pelo painel.

~~~text
/cost now
/cost task TASK-ID
/cost project --last 7d
/cost compare provider/model provider/model
/cost budget project 5.00 USD
/cost export --format json
/cost reconcile ./billing.json
/cost local add provider/model
/cost on
/cost off
/cost help
~~~

`/cost reconcile` espera um array JSON local como `[{"providerRequestId":"request-id","observedCostUsd":0.05}]` e pede confirmação antes de importar valores observados de cobrança. `/cost export` aceita JSON e CSV. O arquivo exportado é um relatório, não uma fatura.

### Configuração e estado

Por padrão, a contabilidade fica ativa, o escopo é a sessão, preços desconhecidos geram aviso e não há limites configurados.

A configuração compartilhada é `~/.pi/agent/pi-suite/config.yaml`. Em projeto confiável, `.pi/pi-suite.yaml` também é lido. Os padrões são combinados com as configurações global e do projeto confiável; depois, os valores em `locked` na configuração global têm precedência. O painel mantém as edições em rascunho e só grava no arquivo aplicável (o do projeto, quando ele é confiável; caso contrário, o global) após `Ctrl+S`.

Exemplo de configuração do projeto:

~~~yaml
costProfiler:
  enabled: true
  scope:
    source: project
    strict: true
  budgets:
    project:
      softUsd: 4
      hardUsd: 5
~~~

As coleções do ledger são arquivos JSONL locais no diretório de estado por projeto, `~/.pi/agent/pi-suite/projects/<project-id>/`. Elas guardam eventos contábeis: identificadores de modelo e provedor, uso, snapshots de preço, IDs de tarefa e sessão e resultados de custo. A extensão não é um gateway de provedor e não substitui a autenticação nem os controles de rede do Pi.

Temas: ao carregar, a extensão copia os temas de cores do seu adaptador de terminal para `<agent-dir>/themes/`, e eles aparecem em `/settings` → **Theme**. Ela nunca troca o tema escolhido nem sobrescreve um arquivo de tema que você editou. Defina `PI_DESIGN_THEMES=off` para não copiar.

### Idioma

Este README está disponível em inglês e português brasileiro. Em um projeto confiável no Pi, abra `/cost` e escolha **Idioma** para visualizar o painel em inglês ou português brasileiro. `Ctrl+S` salva a preferência somente em `.pi/pi-cost-profiler.locale.json`, dentro desse projeto. Na primeira execução, e com valor ausente ou inválido, o painel usa inglês. `Esc` mantém o aviso de rascunho e a confirmação de descarte. Nomes de comandos, IDs e chaves de configuração não mudam.

### Privacidade e segurança

A extensão mantém o ledger e a configuração do projeto localmente. Nas verificações locais documentadas, ela não envia dados de custo a nenhum serviço. O tráfego do Pi com provedores é independente. Limites rígidos só governam despachos que a extensão consegue observar antes de começarem.

`/cost reconcile` lê um arquivo de cobrança local escolhido por você. Exportações podem conter detalhes de uso do projeto; revise-as antes de compartilhar.

### Diagnóstico e limites

- **O total mostra preço desconhecido.** Confira os metadados de preço do modelo ou adicione um modelo local confirmado com `/cost local add provider/model`. Valores desconhecidos não são tratados como gratuitos.
- **As configurações do projeto não são aplicadas.** Verifique se o Pi confia no projeto e confira `.pi/pi-suite.yaml` e os valores em `locked` na configuração global.
- **Houve cobrança apesar de um limite rígido.** A extensão não cancela cobranças de provedores já iniciadas nem controla chamadas feitas por outras extensões.

### Contribuição

Prepare um checkout e rode as verificações:

~~~sh
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run smoke
~~~

`npm test` roda a suíte unitária. `npm run smoke` exige um Pi `1.6.0` instalado: monta uma cópia instalada do pacote, carrega-a com o loader dessa versão (padrão `~/.pi/agent/install/releases/1.6.0`; defina `PI_HOST_DIR` para usar o diretório de outra versão) e conduz o painel com o `pi-tui` dessa versão. Usa dados sintéticos de ledger e estado em diretórios temporários e não chama modelo nem provedor. Não substitui uma verificação manual num terminal real.

Abra pull requests contra `develop`. Veja [CONTRIBUTING.md](CONTRIBUTING.md) e [SECURITY.md](SECURITY.md).

### Licença

MIT, veja [LICENSE](LICENSE). O código de terceiros em `vendor/` mantém a própria licença; veja [`vendor/THIRD_PARTY_NOTICES.md`](vendor/THIRD_PARTY_NOTICES.md).
