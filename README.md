# Pi Cost Profiler

Local cost accounting and budget controls for Pi model calls, organized by session, task and project.

**Manifest:** pi-cost-profiler · **version:** 0.3.0
**Status:** The manifest is private. Registry availability and publication have not been verified; CT59 owns any publication decision. This README does not claim a registry install path.
**Compatibility:** Node.js >=20; Pi peer packages are declared as *. The real-host smoke was verified on Pi 1.4.0; that check is not a compatibility matrix.

## English

### What it does

/cost records usage and cost metadata from model calls handled by Pi, keeps JSON/JSONL state locally, summarizes session/task/project totals, and can deny a new dispatch when a configured hard budget would be exceeded. It uses pricing exposed by the Pi model metadata and keeps price snapshots; an unknown price remains unknown rather than being reported as zero.

Soft budgets warn. Hard budgets reserve against the configured scope before dispatch, but cannot stop a request that has already started or control requests that bypass this extension. Local models can be listed for time-based accounting; energy and depreciation estimates stay separate from API spend.

### Install

For a source checkout with its dependencies installed, load the extension for the current Pi session from the repository root:

~~~sh
npm ci --ignore-scripts --legacy-peer-deps
pi -e ./index.ts
~~~

The package is private and registry publication is unverified. Do not assume a registry install path; CT59 owns registry verification and publication.

### Use

In a Pi TUI, /cost with no arguments opens the dashboard. In a client without custom-screen support, it prints a summary and the direct command forms. Dashboard edits remain a draft until Ctrl+S validates and saves them. Esc returns from a submenu; at the root, it warns about a draft and a second Esc discards it. A failed save keeps the draft available for another attempt.

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

/cost reconcile expects a local JSON array such as [{"providerRequestId":"request-id","observedCostUsd":0.05}] and asks for confirmation before importing observed billing values. Export supports JSON and CSV; an export is a report, not an invoice. Inspect files before sharing them.

### Configuration and state

Defaults enable accounting, use a session scope, warn on unknown prices, and leave budgets empty. For a trusted project, configuration is read from .pi/pi-suite.yaml; otherwise the shared configuration is ~/.pi/agent/pi-suite/config.yaml. Defaults are merged with global and trusted-project settings, then global locked policy values take precedence. The dashboard stages edits locally and writes the applicable configuration file only after Ctrl+S.

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

Ledger collections are local JSONL files under Pi Suite's per-project state directory. They include accounting events such as model/provider identifiers, usage, pricing snapshots, task/session identifiers and cost outcomes. The extension does not act as a provider gateway or replace Pi's authentication and network controls.

### Language

This README is available in English and Brazilian Portuguese. In a trusted Pi project, open /cost and choose Language to preview English or Português (Brasil). Ctrl+S stores the preference only in that project's .pi/pi-cost-profiler.locale.json file; first use and invalid or missing values use English. Esc keeps the existing draft warning and discard behavior. Command names, IDs and configuration keys do not change.

### Privacy and security

The extension stores its ledger and project configuration locally. It does not send cost data to a service in the documented local checks. Pi's own provider traffic is separate. Hard limits only govern dispatches this extension can observe before they start. Reconcile reads a user-selected local billing file; exports can contain project usage details, so review them before sharing.

### Troubleshooting and limits

- If totals show an unknown price, check the model's pricing metadata or add a confirmed local model with /cost local add provider/model; unknown values are not treated as free.
- If project settings are not applied, verify that Pi trusts the project and inspect .pi/pi-suite.yaml plus any global locked settings.
- Run npm test for the unit suite and npm run smoke for the panel smoke. The smoke uses synthetic ledger/state data with Pi's local loader and TUI; it does not call a model or provider. The accepted CT52 smoke used Pi 1.4.0.
- The extension cannot cancel provider billing already in progress or govern calls made by other extensions.

### License

The repository does not currently specify a license for the product code.

## Português (Brasil)

### O que faz

/cost registra uso e metadados de custo das chamadas de modelo processadas pelo Pi, mantém estado local em JSON/JSONL, resume totais por sessão, tarefa ou projeto e pode negar um novo despacho quando um limite rígido configurado seria excedido. Usa os preços expostos pelos metadados de modelos do Pi e guarda snapshots de preços. Preço desconhecido continua desconhecido; não é apresentado como zero.

Limites suaves geram avisos. Limites rígidos reservam o valor para o escopo configurado antes do despacho, mas não param uma solicitação que já começou nem controlam chamadas que não passam por esta extensão. Modelos locais podem ser contabilizados por tempo; estimativas de energia e depreciação ficam separadas do gasto de API.

### Instalação

Em um checkout do código-fonte com as dependências instaladas, carregue a extensão na sessão atual do Pi a partir da raiz do repositório:

~~~sh
npm ci --ignore-scripts --legacy-peer-deps
pi -e ./index.ts
~~~

O pacote está privado e a publicação no registry não foi verificada. Não presuma que exista um caminho de instalação pelo registry; a verificação e eventual publicação cabem ao CT59.

### Uso

Na TUI do Pi, /cost sem argumentos abre o painel. Em clientes sem suporte a tela customizada, mostra um resumo e os formatos dos comandos diretos. As edições ficam em rascunho até Ctrl+S validar e salvar. Esc volta do submenu; na tela inicial, avisa sobre o rascunho e uma segunda pressão descarta as mudanças. Se o salvamento falhar, o rascunho fica disponível para nova tentativa.

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

/cost reconcile espera um array JSON local como [{"providerRequestId":"request-id","observedCostUsd":0.05}] e pede confirmação antes de importar valores observados de cobrança. A exportação aceita JSON e CSV; o arquivo é um relatório, não uma fatura. Revise-o antes de compartilhar.

### Configuração e estado

Por padrão, a contabilidade fica ativa, o escopo é a sessão, preços desconhecidos geram aviso e não há limites configurados. Em projeto confiável, a configuração vem de .pi/pi-suite.yaml; caso contrário, usa-se ~/.pi/agent/pi-suite/config.yaml. Os padrões são combinados com as configurações global e do projeto confiável; valores de política global em locked têm precedência. O painel mantém as edições no rascunho e só grava no arquivo aplicável após Ctrl+S.

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

As coleções do ledger são arquivos JSONL locais no diretório de estado do Pi Suite por projeto. Elas incluem eventos contábeis como identificadores de modelo/provedor, uso, snapshots de preço, IDs de tarefa/sessão e resultados de custo. A extensão não funciona como gateway de provedor nem substitui a autenticação e os controles de rede do Pi.

### Idioma

Este README está disponível em inglês e português brasileiro. Em um projeto confiável no Pi, abra /cost e escolha Idioma para visualizar o painel em inglês ou português brasileiro. Ctrl+S salva a preferência somente em .pi/pi-cost-profiler.locale.json, dentro deste projeto; na primeira execução e com valor ausente ou inválido, o idioma é inglês. Esc mantém o aviso de rascunho e a confirmação de descarte. Nomes de comandos, IDs e chaves de configuração não mudam.

### Privacidade e segurança

A extensão mantém o ledger e a configuração do projeto localmente. Nas verificações locais documentadas, ela não envia dados de custo a um serviço. O tráfego do Pi com provedores é independente. Limites rígidos só governam despachos que a extensão consegue observar antes de começarem. O comando de reconciliação lê um arquivo de cobrança local escolhido pelo usuário; exportações podem conter detalhes de uso do projeto, portanto revise os arquivos antes de compartilhá-los.

### Diagnóstico e limites

- Se o total mostrar preço desconhecido, confira os metadados de preço do modelo ou adicione um modelo local confirmado com /cost local add provider/model; valores desconhecidos não são tratados como gratuitos.
- Se as configurações do projeto não forem aplicadas, verifique se o Pi confia no projeto e confira .pi/pi-suite.yaml e as configurações globais em locked.
- Execute npm test para a suíte unitária e npm run smoke para o smoke do painel. O smoke usa dados sintéticos de ledger/estado com o loader e a TUI locais do Pi; não chama modelo nem provedor. O smoke aceito no CT52 usou Pi 1.4.0.
- A extensão não cancela cobranças de provedores já iniciadas nem controla chamadas feitas por outras extensões.

### Licença

O repositório não especifica atualmente uma licença para o código do produto.
