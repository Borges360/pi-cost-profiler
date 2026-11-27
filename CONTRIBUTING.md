# Contributing

**English** · [Português (Brasil)](#português-brasil)

## English

Bug reports, fixes and documentation improvements are welcome. For a change in behavior, open an issue first so the approach can be agreed before you write the code. Do not report security problems in a public issue; follow [SECURITY.md](SECURITY.md).

### Set up

Requirements: Node.js `>=22.19.0` and npm. Running the extension needs a Pi host in the range declared in `package.json`.

~~~sh
git clone https://github.com/Borges360/pi-cost-profiler.git
cd pi-cost-profiler
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run smoke
~~~

`npm run smoke` loads the extension in a real Pi host and needs Pi 1.6 installed.

### Branches and commits

- Branch from `develop` as `feature/<short-name>` and open the pull request against `develop`. `main` only receives releases.
- Write commits in [Conventional Commits](https://www.conventionalcommits.org/) form (`feat:`, `fix:`, `docs:`, `chore:`). Versions and the changelog are derived from them.
- Keep each pull request to one subject.

### Before you open the pull request

- The checks above pass locally, and new behavior has a test.
- Text shown to users exists in English and Brazilian Portuguese.
- When behavior changes, the README is updated in both languages and `CHANGELOG.md` has an entry under `Unreleased`.
- `/cost` keeps the menu contract: the root command opens the menu without side effects, edits stay a draft until `Ctrl+S`, `Esc` goes back and a second `Esc` discards the draft, and long operations can be cancelled.
- Colors come from the Pi host theme; do not add fixed ANSI colors.
- `vendor/inteiro-terminal/` is a vendored copy with recorded hashes. Do not edit it by hand: the tests fail when it diverges from `VENDOR.json`. Report the change upstream instead.
- No secrets, tokens, personal paths or private hostnames in code, tests, fixtures or logs.

### License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).

## Português (Brasil)

Relatos de bug, correções e melhorias de documentação são bem-vindos. Para mudar um comportamento, abra uma issue antes, para combinar a abordagem antes de escrever o código. Não relate problemas de segurança em issue pública; siga o [SECURITY.md](SECURITY.md).

### Preparação

Requisitos: Node.js `>=22.19.0` e npm. Para executar a extensão, é preciso um host Pi na faixa declarada no `package.json`.

~~~sh
git clone https://github.com/Borges360/pi-cost-profiler.git
cd pi-cost-profiler
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run smoke
~~~

`npm run smoke` carrega a extensão num host Pi real e exige o Pi 1.6 instalado.

### Branches e commits

- Crie o branch a partir de `develop` como `feature/<nome-curto>` e abra o pull request contra `develop`. `main` só recebe releases.
- Escreva os commits no formato [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`). A versão e o changelog derivam deles.
- Mantenha cada pull request em um único assunto.

### Antes de abrir o pull request

- As verificações acima passam localmente, e o comportamento novo tem teste.
- O texto exibido ao usuário existe em inglês e em português brasileiro.
- Quando o comportamento muda, o README é atualizado nos dois idiomas e o `CHANGELOG.md` ganha uma entrada em `Unreleased`.
- `/cost` mantém o contrato do menu: o comando raiz abre o menu sem efeitos colaterais, as edições ficam em rascunho até `Ctrl+S`, `Esc` volta e um segundo `Esc` descarta o rascunho, e operações longas podem ser canceladas.
- As cores vêm do tema do host Pi; não acrescente cores ANSI fixas.
- `vendor/inteiro-terminal/` é uma cópia vendorizada com hashes registrados. Não a edite à mão: os testes falham quando ela diverge do `VENDOR.json`. Proponha a mudança na origem.
- Nada de segredos, tokens, caminhos pessoais ou hostnames privados no código, nos testes, nas fixtures ou nos logs.

### Licença

Ao contribuir, você concorda que sua contribuição é licenciada sob a [licença MIT](LICENSE).
