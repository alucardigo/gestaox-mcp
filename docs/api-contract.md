# Contrato da API GestãoX (EMX Tecnologia)

Descoberto a partir da página de contrato viva do próprio ambiente (`/API/Help`).
Não presumir nada além do que está aqui; a fonte é a Web API real, não a documentação do fornecedor.

## Fonte

- Base da API: `https://gestaox.example.com/API/`
- Página de contrato (ASP.NET Web API Help Page): `https://gestaox.example.com/API/Help`
- Detalhe de cada endpoint: `https://gestaox.example.com/API/Help/Api/<METODO>-api-<controller>-<Acao>_<params>`
- Stack: ASP.NET Web API 2 (`System.Web.Http`), respostas `HttpResponseMessage` com JSON no corpo.
- O portal web em `/Chamados/TodosV2` é WebForms + Telerik e **não** usa esta API (usa ViewState/postback).
  Esta API é o canal de integração (mobile/integrações). É por aqui que o plugin fala.

## Autenticação (CONFIRMADO 2026-07-29 por login real)

Não há OAuth. O padrão é um **token (string) exigido em quase toda chamada**, na query string.

- **Login é GET** (não POST — POST devolve `405`):
  `GET api/usuario/EfetuarLoginInterno?email={email}&senha={senha}`
- A resposta é o **objeto completo do usuário**: `IdUsu`, `Login`, `EmpresaId`, `FilialId`,
  `TipoUser`, `email`, ... e os campos de token: **`TOKEN`**, `VALIDA_TOKEN`, `DATA_TOKEN_LIBERADO`.
- O token de API vive no campo **`TOKEN`** (maiúsculo). Referência útil: `IdUsu` = `Usuarioid`,
  `EmpresaId` = `Empresaid` para os demais endpoints.
- Token inválido/ausente → **HTTP 500** com corpo JSON string `"TOKEN INVÁLIDO!"`.

### ⚠️ BLOQUEIO ATIVO: token de API não habilitado para a conta

Em teste real, uma conta comum de atendente pode logar (**200**) mas receber o
campo **`TOKEN` vazio**, e portanto `RetornaChamadosLista`, `RetornaChamadosDashboard`,
`RetornaDetalhesChamados` etc. respondem `500 "TOKEN INVÁLIDO!"`.

Isso é configuração no lado GestãoX/EMX, não do plugin. Para o backend `gestaox` funcionar
ponta a ponta é preciso **uma das duas**:
1. A EMX/EMP habilitar acesso de API por token para a conta (flags `VALIDA_TOKEN` /
   `AcessoRemoto` / `UsuarioVip`), ou
2. Um **usuário de integração** com token liberado; nesse caso use `GESTAOX_TOKEN` no ambiente
   e o plugin pula o login.

Enquanto o token não for liberado, o plugin opera em `mock` (padrão). O código já está alinhado
ao contrato real; falta só a liberação de acesso.

> Ainda **não confirmado** (depende de 1 chamada autenticada bem-sucedida): os nomes exatos das
> colunas do JSON de `RetornaChamadosLista`/`RetornaDetalhesChamados`. O `normalize.mjs` mapeia
> por apelidos e preserva `_raw`; travar os nomes assim que houver token válido.

## Controllers relevantes ao atendimento

### Chamado (leitura)

| Ação | Endpoint |
|---|---|
| Listar (visão atendente/tela) | `GET api/chamado/RetornaChamadosLista?Login={Login}&TipoTela={TipoTela}&DescricaoBusca={DescricaoBusca}&TipoBusca={TipoBusca}&MaximoRegistros={MaximoRegistros}&Token={Token}&ordenacao={ordenacao}` |
| Dashboard | `GET api/chamado/RetornaChamadosDashboard?Login&DescricaoBusca&TipoBusca&Token` |
| Detalhe | `GET api/chamado/RetornaDetalhesChamados?CodigoChamado={CodigoChamado}&Token={Token}` |
| Histórico | `GET api/chamado/RetornaHistoricoChamado?CodigoChamado&InformacaoPublica={bool}&Token` |
| Anexos | `GET api/chamado/RetornaAnexosChamado?CodigoChamado&Token` |
| FlexFields do chamado | `GET api/chamado/RetornaFlexfieldChamado?Incidenteid&Token` |
| FlexFields do serviço | `GET api/chamado/RetornaFlexfieldServico?CatalogoServicosid&Token` |
| Grupos p/ transferir | `GET api/chamado/RetornaGruposTransferencia?Login&Token` |
| Grupos resolvedores | `GET api/chamado/RetornaGruposResolvedores?Login&Token` |
| Usuários de um grupo | `GET api/chamado/RetornaUsuariosGrupo?Grupoid&Empresaid&Token` |
| Horas apontadas | `GET api/chamado/RetornaHoras?Incidenteid&Token` |

Defaults observados em `RetornaChamadosLista`: `DescricaoBusca` e `TipoBusca` = "nao possui",
`MaximoRegistros` = 200, `ordenacao` = 1.

### Chamado (escrita) — todas exigem confirmação + idempotência no plugin

| Ação | Endpoint | Corpo/params-chave |
|---|---|---|
| Assumir (com workflow) | `POST api/chamado/AssumirChamadoComWorkflow` | modelo Resolução (abaixo) |
| Resolver | `POST api/chamado/ResolverChamado` | `CodigoChamado`, `Descricao`, `LoginResponsavel` (obrigatórios) |
| Resolver (integração) | `POST api/chamado/ResolverChamadoIntegracao` | idem |
| Resolver c/ flexfield+workflow | `POST api/chamado/ResolverChamadoComFlexFieldResolucaoWorkflow` | modelo Resolução |
| Alterar campo (genérico) | `POST api/chamado/AlterarCampoChamado?Incidenteid&LoginResponsavel&Campo&Valor&Token` | — |
| Alterar chamado | `POST api/chamado/AlterarChamado` | modelo grande |
| Alterar prioridade/urgência | `POST api/chamado/AlterarPrioridadeUrgenciaChamado` | — |
| Máxima urgência | `POST api/chamado/DefinirChamadoMaximaUrgencia` | — |
| Devolver ao solicitante | `POST api/chamado/DevolucaoChamadoSolicitante` | — |
| Aprovar | `POST api/chamado/AprovarChamado` | — |
| Apontar hora | `POST api/chamado/InserirHora?Token` | — |
| Anexo | `POST api/chamado/GravaAnexoChamadao` | — |
| Abrir chamado | `POST api/chamado/AbrirChamado` | — |

### Modelo de Resolução (corpo de ResolverChamado / AssumirChamadoComWorkflow)

Campos confirmados pelo sample do Help:

```json
{
  "CodigoChamado": "string",
  "Descricao": "string",
  "LoginResponsavel": "string",
  "Status": "string",
  "Execucaoid": 0,
  "Prioridade": 0,
  "Urgencia": 0,
  "NovoGrupo": 0,
  "NovoLoginAtendente": "string",
  "CategoriaFechamentoChamado": "string",
  "CategoriaFechamentoItem": "string",
  "Token": "string",
  "FlexFieldAbertura1": "string"
  // ... FlexFieldAbertura1..N e FlexFieldResolucao1..N
}
```

Semântica prática das movimentações:
- **Assumir** um chamado → `AssumirChamadoComWorkflow` com `CodigoChamado` + `LoginResponsavel`.
- **Transferir de grupo** → `ResolverChamado`/modelo com `NovoGrupo` (e opcionalmente `NovoLoginAtendente`).
- **Responder mantendo aberto / registrar andamento** → o GestãoX não tem "add comment" puro;
  o andamento vai via `Descricao` de uma movimentação ou via `AlterarCampoChamado`. Não fingir
  um endpoint de comentário que não existe.
- **Resolver/fechar** → `ResolverChamado` com `Descricao` da solução + `CategoriaFechamento*`.

## Outros controllers (fora do escopo de atendimento, mapeados p/ referência)

`Usuario`, `Fornecedor`, `Ativos`, `Atualizador`, `Auditoria`, `Mudanca`, `Publico`, `Filial`,
`CentroCusto`, `Empresa`, `Webhook` (`GET/POST api/webhook`), `Manutencao`, `Email`, `Contratos`,
`Inventario`. Dump completo dos 191 endpoints preservado em `docs/api-endpoints.txt`.

## Como o plugin usa (mapa tool → endpoint)

| Tool MCP | Endpoint GestãoX |
|---|---|
| `gestaox_list_tickets` | `RetornaChamadosLista` |
| `gestaox_get_ticket` | `RetornaDetalhesChamados` (+ `RetornaHistoricoChamado`) |
| `gestaox_assume_ticket` | `AssumirChamadoComWorkflow` |
| `gestaox_resolve_ticket` | `ResolverChamado` |
| `gestaox_set_field` | `AlterarCampoChamado` |
| `gestaox_analyze_ticket` | (local, sem rede) |
| `gestaox_prepare_azure_ticket` | (local, prévia p/ ADO) |
