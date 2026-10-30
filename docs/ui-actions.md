# Mapa de ações da UI do GestãoX

Descoberto em 2026-07-29 lendo o código real das funções `view*()` da página
`/Chamados/TodosV2`. Não é suposição: cada URL abaixo saiu de um `radWin.setUrl(...)`.

## O achado central

Toda ação do GestãoX é uma **página `.aspx` independente**, aberta dentro de um RadWindow.
Isso significa que **não é preciso clicar em nada**: dá para navegar direto na URL da ação,
o que é muito mais estável do que simular cliques num RadGrid.

## O `id` criptografado

O parâmetro `id` de toda ação é o `Incidenteid` **criptografado** pelo servidor
(ex.: `rLaMWyqC1Lw=`). Ele **não é derivável** do código do chamado — só existe no
`onclick` da linha da grade. Por isso o fluxo é sempre:

1. Ler a grade `/Chamados/TodosV2`
2. Extrair o `onclick` de cada `<a>` da linha (`parseRowActions` em `src/web.mjs`)
3. Usar o `encryptedId` para montar a URL da ação

## Ações mapeadas

| Ação | Página | Parâmetros |
|---|---|---|
| **Alterar chamado** (detalhe/edição) | `/Chamados/viewVisualizaChamados.aspx` | `id`, `status=N`, `serv`, `Data`, `transfere=S`, `grupo=S`, `Retrabalho`, `criaproblema`, `Codigo`, `ServicoId`, `origem=TodosChamadosGrupo`, `chamadopai=S`, `oldstatus`, `width`, `height`, `chamado_filtrado` |
| **Histórico do chamado** | `/Chamados/viewHistoricoChamado.aspx` | `id`, `origem=TodosChamadosGrupo`, `width`, `height`, `chamado_filtrado` |
| **Histórico BPM** (chamado/atividade) | `/Chamados/viewHistoriaAtividade.aspx` | `id`, `Codigo`, `tipo=chamado\|atividade` |
| **Atividades do chamado** | `/Chamados/viewAtividadesChamado.aspx` | `id`, `Codigo`, `catalogoservicosid`, `origem`, `chamado_filtrado` |
| **Inserir atividade** | `/Chamados/viewInsereAtividade.aspx` | `id`, `Codigo`, `chamado_filtrado` |
| **Assumir chamado** | `/Chamados/viewAssumirChamados.aspx` | `id`, `tipoitem`, `responsaveluser`, `codigo`, `execucaoid`, `statusid`, `origem`, `width`, `height`, `chamado_filtrado` |
| **Assumir tarefa** | `/GestaoTarefas/viewAssumirTarefa.aspx` | `id`, `Codigo`, `origem=VisualizaTarefas`, `chamado_filtrado` |
| **Enviar para aprovação** | `/Chamados/viewEnviarChamadoAprovacao.aspx` | `id`, `Codigo`, `Empresaid`, `chamado_filtrado` |
| **Lançamento de horas** | `/Chamados/viewLancamentoHorasAvulso.aspx` | `status=inserir` |
| **Abrir chamado (novo)** | `/Chamados/viewIncidenteDireto.aspx` | `id=0`, `origem`, `chamada=master`, `incidenteid=0`, `Userid=0` |
| **Previsto x realizado** | `/Chamados/viewPrevistoRealizadoProjeto.aspx` | `chamadoid` |
| **Base de conhecimento** | (via `viewConsultaBaseConhecimento`) | — |

Outras funções presentes na página: `viewIncidenteResponsavel`, `viewAlteraAtividadeChamado`,
`viewManutencaoCorretiva`, `viewManutencaoPreventiva`, `viewUserAlterarMasterPage`,
`viewImpressaoProjeto`, `viewIncidenteDiretoMasterAtendente`.

## Estruturas internas confirmadas

**`/Chamados/TodosV2`**
- Grade: `div#ctl00_MainContent_gridchamados` — 35 colunas, `tr.rgRow`/`tr.rgAltRow`
- Paginação: `input.rgPageNext` / `a.rgPageNext`
- RadWindows de destino: `radChamado`, `RadWindow1`, `Assumir`, `cadIncidenteNoClose`

**`/Chamados/viewHistoricoChamado.aspx`**
- `div#gridHistorico` — colunas: Usuário, Descrição, Justificativa, Serviço, Status,
  Grupo, Data, Previsão, Tempo, Sla
- `div#gridAnexos`, `#gridTipoAnexos`, `#gridAnexosFilho`, `#gridProblema`, `#gridDetalhesMudanca`

> ⚠️ Armadilha: **não** usar heurística de "maior tabela da página" para achar a grade.
> As páginas têm um RadDatePicker cujo calendário é uma tabela maior que a grade de dados —
> o parser pegava o calendário e devolvia os dias do mês como se fossem histórico.

## Escrita: RESOLVIDA (2026-07-29) — como escrever num controle Telerik

Registrar andamento (`viewInsereAtividade.aspx`) **funciona**, validado em chamado real.
Três armadilhas precisaram ser vencidas, nesta ordem:

**1. O valor não chega ao servidor.** `page.fill()` é descartado e a digitação simulada
preenche a tela mas posta vazio — o servidor responde "campo obrigatório" com o campo
visivelmente preenchido. Os controles são `Telerik.Web.UI.RadTextBox` / `RadComboBox` e
guardam o valor num **ClientState** próprio. Solução: usar a API cliente —
`$find("edtDEsc").set_value(...)`, `$find("radGrupo").findItemByText(x).select()`.

**2. `arguments.callee.caller` versus modo estrito.** O `select()` do combo e o Salvar
disparam `_doPostBack`, que percorre `arguments.callee.caller`. Se **qualquer** frame da
pilha for estrito, o acesso a `.caller` lança `TypeError` — e o `page.evaluate` do
Playwright é sempre estrito. Solução: agendar a chamada com `setTimeout(fn, 0)` via
`window.eval`, para a pilha nascer do event loop do navegador, sem o nosso frame.

**3. A gravação demora a aparecer — e verificar cedo demais DUPLICA.** O histórico não
reflete a atividade imediatamente. A primeira versão declarou "não gravou", o chamador
repetiu, e o MIP000007155 ficou com **duas atividades idênticas** (18:19:52 e 18:29:47).
Solução: reler o histórico com várias tentativas (~15s) antes de acusar falha, e a
mensagem de erro manda conferir no GestãoX antes de repetir.

Campos obrigatórios da tela: **descrição**, **grupo responsável**, e **previsão OU
estimativa de tempo**. O campo de tempo é numérico simples (minutos): `"00:05"` vira `"000"`.

**4. SLA acima de 100% exige justificativa (2026-10-30).** Na tela de Detalhes
(`viewVisualizaChamados.aspx`), com o SLA do chamado acima de 100% o Salvar não grava nada e mostra no
topo *"O SLA do chamado está acima de 100%, favor preencher o campo justificativa do estouro do SLA!"*.
Não é `Page_Validators` nem dialog, então antes isso aparecia só como "não confirmada após ~15s"
(dois chamados com SLA estourado falharam 3× cada; um com SLA em 69% gravou de primeira).
O campo é a textarea `#edtJustificativa`, e `page.fill` funciona nela. `gestaox_comment_ticket` e
`gestaox_resolve_ticket` aceitam `justificativaSla`. O `updateTicket` barra antes de abrir a tela quando o
SLA da grade passa de 100% sem justificativa (`assertSlaJustification`) e, se o aviso aparecer mesmo
assim, falha com mensagem clara (`isSlaBlockMessage`) em vez de esperar a releitura do histórico.

## Histórico da investigação (obstáculo original)

Tela `viewInsereAtividade.aspx` (registrar andamento) — a ação central do atendimento.
Campos: `#edtDEsc` (descrição), `#edtTempoatd` (estimativa, numérico simples — "00:05" vira
"000"), `#rdNovaDataPrevisao`, `#radGrupo_Input` (combo), `#cbbUsrGroup_Input`, `#btnSalvar_input`.

Três campos obrigatórios descobertos por tentativa real: **descrição**, **grupo responsável** e
**previsão OU estimativa de tempo**.

**Obstáculo aberto:** os controles são **Telerik RadInput/RadComboBox**, não campos HTML comuns.
- `page.fill()` é descartado pelo controle (valor não persiste).
- `pressSequentially()` (digitação real) preenche a tela — confirmado visualmente —, mas ao
  salvar o servidor ainda responde "Descrição obrigatória!" e "Grupo obrigatório!", enquanto
  `Page_Validators` não acusa falha no cliente.
- Conclusão: o valor não chega ao servidor. O RadInput posta via **ClientState** próprio
  (hidden input `*_ClientState`), que a digitação simulada não está sincronizando.

**Próximo passo:** usar a **API cliente da Telerik** em vez de simular teclado —
`$find("edtDEsc").set_value(...)` / `$find("radGrupo").findItemByText(...).select()` — e
confirmar que o `_ClientState` foi atualizado antes do submit.

**Nenhum efeito colateral:** as tentativas falharam na validação e **não criaram nada** —
verificado em `viewAtividadesChamado` e `viewHistoriaAtividade` (zero ocorrências).

> Lição que vale para todas as telas: **verificar a gravação relendo o dado**, nunca confiar no
> clique. A primeira versão teria reportado sucesso três vezes sem ter gravado nada.

## Abertura de chamado (`viewIncidenteDireto.aspx`) — parcial

Combos em **cascata**: `rdCatalogo` (departamento) → `cbbServicos` (serviço) → `rdUser`.
Também: `cbbFilialSol`, `cbbUnidade`, `cbbImpacto`, `edtRamal`, `edtDEsc`.

Valores reais descobertos (2026-07-29):

- **Departamentos** (`rdCatalogo`): ex. `TI`, `RH`, `Financeiro`, `Facilities` (variam por tenant)
- **Serviços de TI** (`cbbServicos`, exemplos de árvore): `TI/Sistemas/<Sistema>/Manutenção`,
  `TI/Hardware/Desktop/Solicitar/...`
- **Filiais** (`cbbFilialSol`): ex. `EMP-Empresa Exemplo Ltda.`, `EMP2-Segunda Filial`
- **Impacto** (`cbbImpacto`): padrão `No meu trabalho`

Estado: departamento + serviço + descrição **funcionam** (validado por `dryRun`).

**Pendente — causa identificada:** `cbbFilialSol` fica com o placeholder "Campo obrigatório!"
porque o combo está **desabilitado** (`get_enabled() === false`, 5 itens carregados). Não é
falha de automação nem de ordem de preenchimento — testado com filial antes e depois do
serviço, mesmo resultado. O GestãoX só habilita filial/unidade após escolher o **solicitante**
(`rdUser`), que por sua vez depende do serviço. Próximo passo: preencher `rdUser` e reavaliar.

> Lição: sempre checar `get_enabled()`/`get_readOnly()` antes de concluir que a seleção falhou.
> `selectCombo` já reporta esses estados na mensagem de erro.

**RESOLVIDO — a cadeia correta é:** departamento → serviço → **solicitante** → (filial e
unidade se auto-preenchem). Escolher `rdUser` = "Fulano de Tal" preencheu sozinho
`cbbFilialSol` = "EMP-Empresa Exemplo Ltda." e `cbbUnidade` = "EMPRESA EXEMPLO".

`rdUser` é combo com **LoadOnDemand**: vem com 0 itens e só busca no servidor quando se digita.
`selectCombo` detecta combo vazio e chama `c.set_text(t); c.requestItems(t, false)` antes de
procurar o item. Exige o **nome completo** ("Fulano" não casa; "Fulano de Tal" sim).

**Ainda pendente:** o **botão de gravar** desta tela não foi identificado — não existe
`btnSalvar_input` aqui (só `btnSalvarOrcamento_input`/`btnSalvarCusto_input`, ambos ocultos).
`createTicket` falha explicitamente nesse ponto; `dryRun` valida toda a cascata. Nenhum
chamado foi criado nas tentativas.

## Limitação conhecida

Um perfil de Chrome não aceita **duas instâncias simultâneas**. Só pode existir uma
`BrowserSession` ativa por vez sobre o mesmo `profileDir`. O MCP usa um backend único,
então isso não afeta a operação normal — mas quebra se rodar dois processos ao mesmo tempo.
