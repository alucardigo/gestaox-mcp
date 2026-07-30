# GestãoX Atendimento — MCP

Servidor **MCP** (Model Context Protocol) local para consultar, analisar, atender e movimentar
chamados do **GestãoX** (plataforma de service desk da EMX Tecnologia) e transformá-los em work
items do **Azure DevOps** — direto de um agente de IA como o Claude Code.

Como a API oficial do GestãoX depende de um token que a EMX libera por conta (ver abaixo), o
backend padrão de produção **dirige a própria interface web** via Playwright, reusando a sua
sessão autenticada. Nada de credencial em código.

## Começando

```bash
git clone https://github.com/alucardigo/gestaox-mcp.git
cd gestaox-mcp/server
npm install
```

Configure a URL do **seu** GestãoX e faça o login manual uma única vez (a sessão fica salva no
perfil de navegador, fora do repositório):

```bash
# defina no ambiente do MCP, nunca em arquivo versionado:
#   GESTAOX_BACKEND=web
#   GESTAOX_WEB_URL=https://SEU-GESTAOX.exemplo.com
npm run login     # abre o navegador para você logar; a sessão fica salva
npm test          # 26 testes, backend mock, sem rede
```

O `.mcp.json` versionado vem com `GESTAOX_BACKEND=mock` (seguro, offline). Troque para `web`
no ambiente quando for apontar para um GestãoX real.

## Como ele fala com o GestãoX

O GestãoX expõe duas superfícies. A escolha foi feita por evidência, não por preferência —
ver [docs/architecture.md](docs/architecture.md).

| Backend | Estado | Quando usar |
|---|---|---|
| **`web`** | ✅ **em uso** | Dirige a UI real reusando sua sessão. Funciona hoje, sem depender da EMX. |
| `mock` | ✅ | Desenvolvimento e testes, sem rede nem credencial. |
| `gestaox` | ⏸ pronto, bloqueado | Cliente da API REST oficial (191 endpoints mapeados). Espera a EMX liberar token de integração. |

A API oficial **não** está disponível: o login retorna `TOKEN` vazio e todo endpoint responde
`500 "TOKEN INVÁLIDO!"`. O código está pronto e ativa sozinho no dia em que existir um token.

## Ferramentas do MCP (15)

**Leitura**
- `gestaox_health_check` — backend, perfil e se a sessão está viva
- `gestaox_list_tickets` — fila de chamados (percorre todas as páginas da grade)
- `gestaox_get_ticket` — chamado por código, robusto a filtro/aba (busca na coluna Código)
- `gestaox_get_detail` — todos os campos do formulário de alteração
- `gestaox_get_history` — movimentações completas (usuário, status, grupo, data, SLA) e anexos
- `gestaox_analyze_ticket` — triagem: completude, SLA, risco, prioridade e rascunho de resposta
- `gestaox_prepare_azure_ticket` — prévia de work item ADO + termo de busca de duplicidade
- `gestaox_memory_recent` / `gestaox_memory_record` — memória operacional sanitizada

**Escrita** (exigem `confirmed: true` + `idempotencyKey`; todas aceitam `dryRun`) —
validadas ponta a ponta em chamado real (criar→assumir→comentar→resolver):
- `gestaox_create_ticket` — abre chamado novo (cascata departamento→serviço→solicitante)
- `gestaox_assume_ticket` — assume o chamado (diálogo Sim/Não)
- `gestaox_comment_ticket` — andamento/comentário pela tela de atendimento (público ou interno)
- `gestaox_resolve_ticket` — muda status (RESOLVIDO, CANCELADO, EM ANÁLISE, ...) com descrição
- `gestaox_transfer_ticket` — transfere para outro grupo/atendente
- `gestaox_add_activity` — insere atividade **no fluxo BPM** (delega tarefa; ver aviso abaixo)

### `dryRun`: ensaio a seco

Toda escrita aceita `dryRun: true`. Ele **preenche e valida** a tela (confirma que grupo,
usuário e campos existem e foram aceitos) e **não grava nada** — nem consome a chave de
idempotência. Use antes do primeiro disparo real de qualquer ação.

## Regras que o plugin segue

1. **Escrita só retorna sucesso se o dado reaparecer na leitura.** Nunca confia no clique.
2. **Idempotência obrigatória.** A mesma chave nunca escreve duas vezes — protege contra
   retry, reexecução de hook e agente reiniciado.
3. **Verificação com retry (~15s).** Declarar falha cedo demais faz o chamador repetir e
   **duplicar** o registro. Já aconteceu; ver [docs/ui-actions.md](docs/ui-actions.md).
4. **Nenhuma senha é armazenada.** A sessão vem do perfil de navegador; o `session.json`
   guarda cookie de sessão (equivalente a credencial) em `%LOCALAPPDATA%`, fora do repositório.

## Dois jeitos de "comentar" — use o certo

O GestãoX é **BPM**, e isso separa duas coisas que parecem iguais:

- **`gestaox_comment_ticket`** (tela de atendimento) — registra andamento/resposta **sem** mexer
  no fluxo. É o comentário normal do atendente. **Use este por padrão.**
- **`gestaox_add_activity`** (viewInsereAtividade) — cria uma **atividade no fluxo BPM**: uma
  tarefa aberta que alguém precisa assumir/resolver. Isso coloca o chamado em estado de workflow.
  Use só quando quiser realmente **delegar uma tarefa**, não para comentar.

## Modelo de filas (importante para leitura)

A aba "Todos" mostra só **pendentes** (o filtro exclui RESOLVIDO/CANCELADO). Um chamado resolvido
"some" da fila — isso é esperado, não erro. `gestaox_get_ticket` busca pela coluna Código, então
acha qualquer chamado **pendente** independente do filtro; chamados já fechados ficam em
"Meus chamados" (`/Chamados/UsuarioV2`).

## Documentação

- [Arquitetura e decisão de backend](docs/architecture.md)
- [Mapa de ações da UI](docs/ui-actions.md) — as telas, o id criptografado e as armadilhas Telerik
- [Contrato da API REST](docs/api-contract.md) + [191 endpoints](docs/api-endpoints.txt)
- [Configuração](docs/configuration.md)

## Aviso

Projeto **independente**, sem afiliação, patrocínio ou endosso da EMX Tecnologia ou de qualquer
provedor do GestãoX. "GestãoX" e "EMX" pertencem aos seus respectivos donos e são citados apenas
para descrever o sistema que este MCP integra. O backend `web` automatiza a interface do usuário:
use-o **apenas** em ambientes que você está autorizado a acessar, respeitando os termos de uso da
sua instância. Sem garantia — a automação de UI pode quebrar quando o fornecedor muda o layout.

## Licença

[MIT](LICENSE).
