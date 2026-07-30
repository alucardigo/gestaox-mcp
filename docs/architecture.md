# Arquitetura

## A decisão central (2026-07-29)

O GestãoX oferece **duas superfícies**, e nenhuma delas é ideal. A escolha foi feita com base
em evidência, não em preferência:

| Caminho | Estado | Veredito |
|---|---|---|
| **API REST oficial** (`/API`, 191 endpoints) | Contrato mapeado, código pronto | **Bloqueado**: a EMX não vai liberar token de integração. Login retorna `TOKEN` vazio → `500 "TOKEN INVÁLIDO!"` |
| **Banco de dados direto** | Investigado | **Impossível**: o GestãoX é SaaS hospedado na EMX; não há base acessível no ambiente do cliente. |
| **Replay de postback WebForms headless** | Avaliado | **Rejeitado**: ViewState de ~190 KB + EventValidation por interação; quebra a cada atualização do Telerik/EMX. Fragilidade sem contrapartida. |
| **UI dirigida por navegador** | ✅ **Implementado** | Reusa a sessão real, não depende de liberação da EMX, e o GestãoX aplica as próprias regras de workflow. |

## Backends

- **`mock`** (padrão) — desenvolvimento e testes, sem rede nem credencial.
- **`web`** — dirige o Chrome instalado via Playwright, reusando um **perfil persistente**.
- **`gestaox`** — cliente da API REST oficial. Pronto e testado contra o contrato; ativa-se
  sozinho no dia em que existir um token (`GESTAOX_TOKEN`). Não foi jogado fora de propósito.

## Autenticação do backend `web`

Perfil de navegador dedicado em `%LOCALAPPDATA%\gestaox-atendimento\browser-profile`.
Você loga **uma vez** (`npm run login`, Chrome visível) e a sessão persiste no perfil.

O plugin **nunca** armazena senha, em nenhum lugar. Quando a sessão expira, as operações falham
com `SessionExpiredError` e a instrução de rodar `npm run login` de novo — em vez de tentar
adivinhar credencial ou falhar em silêncio.

Restrição do ambiente: o Defender ASR desta estação bloqueia binário novo, então **não** se usa
o Chromium que o Playwright baixaria. Usa-se `channel: "chrome"` (o Chrome já instalado e
confiável). Verificado funcionando em 2026-07-29.

## Seletores confirmados (tela /Chamados/TodosV2)

- Grid: `div#ctl00_MainContent_gridchamados` (Telerik RadGrid)
- Cabeçalho: `table.rgMasterTable thead th` — 35 colunas
- Linhas: `tr.rgRow`, `tr.rgAltRow`

O mapa coluna→campo canônico vive em `COLUMN_MAP` (`src/web.mjs`). Toda coluna é preservada em
`_raw`, então nada se perde por causa do mapeamento.

## Escrita

A leitura (listar, analisar, priorizar, redigir resposta, preparar work item ADO) é onde está a
maior parte do valor e já funciona pelo backend `web`.

A **escrita pela UI ainda não está implementada**. Cada ação do GestãoX (assumir, resolver,
transferir) abre um RadWindow próprio com validação de workflow e campos obrigatórios que variam
por serviço. Mapear isso por adivinhação produziria movimentação errada em chamado com SLA — por
isso as ações de escrita do backend `web` falham explicitamente em vez de fingir que funcionaram.
Implementar uma ação por vez, com evidência da tela real.

O contrato de escrita (`confirmed` + `idempotencyKey`) permanece na camada MCP e vale para todos
os backends. A idempotência não é uma trava de confirmação: é a garantia de que uma repetição
(retry, reexecução de hook, agente reiniciado) não movimenta o mesmo chamado duas vezes.

## Fluxo

1. Consultar e analisar o chamado (leitura).
2. Gerar prévia da resposta, movimentação ou work item ADO.
3. Validar campos, duplicidade, dados pessoais e vínculo entre sistemas.
4. Executar a escrita com chave de idempotência.
5. Registrar apenas conhecimento operacional sanitizado na memória local.
