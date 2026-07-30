import { BrowserSession } from "./browser-session.mjs";
import { assertWriteAuthorized } from "./domain.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Backend que lê o GestãoX pela própria interface web, reusando a sessão do perfil.
// Seletores confirmados em 2026-07-29 na tela /Chamados/TodosV2:
//   grid ....... div#ctl00_MainContent_gridchamados  (Telerik RadGrid)
//   cabeçalho .. table.rgMasterTable thead th        (35 colunas)
//   linhas ..... tr.rgRow, tr.rgAltRow
const GRID = "#ctl00_MainContent_gridchamados";
const LIST_PATH = "/Chamados/TodosV2";

// Cada ação do GestãoX é uma página .aspx própria, aberta num RadWindow.
// As URLs abaixo vieram do código real das funções view*() da página (2026-07-29),
// não de suposição. `id` é o Incidenteid CRIPTOGRAFADO, lido do onclick da linha.
export const ACTION_URLS = {
  detalhe: ({ id, codigo, servicoId = "", data = "", oldstatus = "", retrabalho = "N", criaproblema = "S" }) =>
    `/Chamados/viewVisualizaChamados.aspx?id=${enc(id)}&status=N&serv=${enc(servicoId)}&Data=${enc(data)}` +
    `&transfere=S&grupo=S&Retrabalho=${enc(retrabalho)}&criaproblema=${enc(criaproblema)}&Codigo=${enc(codigo)}` +
    `&ServicoId=${enc(servicoId)}&origem=TodosChamadosGrupo&chamadopai=S&oldstatus=${enc(oldstatus)}` +
    `&width=1400&height=800&chamado_filtrado=N`,
  historico: ({ id }) =>
    `/Chamados/viewHistoricoChamado.aspx?id=${enc(id)}&origem=TodosChamadosGrupo&width=1400&height=800&chamado_filtrado=N`,
  historiaBpm: ({ id, codigo, tipo = "chamado" }) =>
    `/Chamados/viewHistoriaAtividade.aspx?id=${enc(id)}&Codigo=${enc(codigo)}&tipo=${enc(tipo)}`,
  atividades: ({ id, codigo, catalogoServicosId = "" }) =>
    `/Chamados/viewAtividadesChamado.aspx?id=${enc(id)}&Codigo=${enc(codigo)}` +
    `&catalogoservicosid=${enc(catalogoServicosId)}&origem=TodosChamadosGrupo&chamado_filtrado=N`,
  inserirAtividade: ({ id, codigo }) =>
    `/Chamados/viewInsereAtividade.aspx?id=${enc(id)}&Codigo=${enc(codigo)}&chamado_filtrado=N`,
  assumir: ({ id, codigo, tipoItem = "", responsavelUser = "", execucaoid = "", statusid = "", origem = "TodosChamadosGrupo" }) =>
    `/Chamados/viewAssumirChamados.aspx?id=${enc(id)}&tipoitem=${enc(tipoItem)}&responsaveluser=${enc(responsavelUser)}` +
    `&codigo=${enc(codigo)}&execucaoid=${enc(execucaoid)}&statusid=${enc(statusid)}&origem=${enc(origem)}` +
    `&width=1400&height=800&chamado_filtrado=N`,
  enviarAprovacao: ({ id, codigo, empresaId = "" }) =>
    `/Chamados/viewEnviarChamadoAprovacao.aspx?id=${enc(id)}&Codigo=${enc(codigo)}&Empresaid=${enc(empresaId)}&chamado_filtrado=N`
};

const enc = encodeURIComponent;
const clean = (value) => String(value ?? "").trim();

// Lê os argumentos reais das funções view*() no onclick de cada linha da grade.
// É daqui que sai o Incidenteid criptografado — não há como derivá-lo de outro jeito.
export function parseRowActions(onclicks) {
  const actions = {};
  for (const raw of onclicks) {
    const call = String(raw).replace(/^return\s+/, "").trim();
    const match = call.match(/^(\w+)\(([^)]*)\)/);
    if (!match) continue;
    const [, fn, argsRaw] = match;
    const args = argsRaw.split(",").map((a) => a.trim().replace(/^['"]|['"];?$/g, ""));
    actions[fn] = args;
  }
  const incidente = actions.viewIncidente;
  const historico = actions.viewHistoricoChamado;
  const assumir = actions.viewAssumirChamados;
  return {
    encryptedId: incidente?.[0] || historico?.[0] || assumir?.[0] || null,
    codigo: incidente?.[6] || historico?.[2] || null,
    servicoId: incidente?.[7] || "",
    data: incidente?.[3] || "",
    oldstatus: incidente?.[8] || "",
    retrabalho: incidente?.[4] || "N",
    criaproblema: incidente?.[5] || "S",
    assumirArgs: assumir ? { tipoItem: assumir[2], responsavelUser: assumir[3], execucaoid: assumir[5], statusid: assumir[6], origem: assumir[7] } : null,
    disponiveis: Object.keys(actions)
  };
}

// Colunas da grade -> campos canônicos que domain.mjs entende.
const COLUMN_MAP = {
  "Código": "id",
  "Descrição": "description",
  "Relato": "title",
  "Status": "status",
  "Solicitante": "requester",
  "Resp.": "assignee",
  "Grupo": "group",
  "Serviço": "service",
  "Unidade": "unit",
  "Tipo": "type",
  "Abertura": "openedAt",
  "Previsão": "dueAt",
  "SLA": "sla",
  "Urg./Prior.": "urgency",
  "Centro de Custo": "costCenter",
  "Ultima Alteração": "updatedAt"
};

export class WebBackend {
  static async create(env) {
    return new WebBackend(BrowserSession.fromEnv(env), {
      dataDir: env.GESTAOX_DATA_DIR || join(process.cwd(), "runtime"),
      baseUrl: (env.GESTAOX_WEB_URL || "https://gestaox.example.com").replace(/\/$/, "")
    });
  }

  constructor(session, cfg) {
    this.session = session;
    this.cfg = cfg;
  }

  async health() {
    const authenticated = await this.session.isAuthenticated();
    return {
      backend: "web",
      baseUrl: this.cfg.baseUrl,
      profileDir: this.session.cfg.profileDir,
      authenticated,
      hint: authenticated ? null : "Rode `npm run login` para autenticar este perfil uma vez."
    };
  }

  // Lê a grade de chamados da tela Todos, percorrendo TODAS as páginas do RadGrid.
  // A grade pagina por padrão; ler só a página visível esconde chamados silenciosamente.
  async list(filters = {}) {
    const page = await this.session.open(LIST_PATH);
    try {
      await page.waitForSelector(`${GRID} table.rgMasterTable`, { state: "attached" });
      const maxPages = Number(filters.maxPages || 20);
      const all = [];
      const seen = new Set();

      for (let index = 0; index < maxPages; index++) {
        const chunk = await this.readPage(page);
        const tickets = toTickets(chunk, this.cfg.baseUrl);
        let added = 0;
        for (const ticket of tickets) {
          if (seen.has(ticket.id)) continue;
          seen.add(ticket.id);
          all.push(ticket);
          added++;
        }
        if (filters.limit && all.length >= filters.limit) return all.slice(0, filters.limit);
        if (added === 0) break;
        if (!(await this.goToNextPage(page))) break;
      }
      return filters.limit ? all.slice(0, filters.limit) : all;
    } finally {
      await page.close();
    }
  }

  async readPage(page) {
    return page.evaluate((gridSel) => {
        const grid = document.querySelector(gridSel);
        if (!grid) return { headers: [], rows: [], actions: [] };
        const headers = [...grid.querySelectorAll("table.rgMasterTable thead th")]
          .map((th) => th.textContent.trim());
        const trs = [...grid.querySelectorAll("tr.rgRow, tr.rgAltRow")];
        const rows = trs.map((tr) =>
          [...tr.querySelectorAll("td")].map((td) => td.textContent.replace(/\s+/g, " ").trim())
        );
        // onclick de cada linha: contém o Incidenteid criptografado
        const actions = trs.map((tr) =>
          [...tr.querySelectorAll("a[onclick]")].map((a) => a.getAttribute("onclick"))
        );
        return { headers, rows, actions };
    }, GRID);
  }

  // Avança para a próxima página do RadGrid. Retorna false quando já está na última.
  async goToNextPage(page) {
    const next = page.locator(`${GRID} input.rgPageNext, ${GRID} a.rgPageNext`).first();
    if (!(await next.count())) return false;
    if (await next.isDisabled().catch(() => false)) return false;
    const before = await this.firstRowSignature(page);
    await next.click();
    try {
      // O RadGrid faz postback AJAX; espera a primeira linha mudar.
      await page.waitForFunction(
        ([sel, previous]) => {
          const row = document.querySelector(`${sel} tr.rgRow, ${sel} tr.rgAltRow`);
          return row && row.textContent.replace(/\s+/g, " ").trim() !== previous;
        },
        [GRID, before],
        { timeout: this.session.cfg.timeout }
      );
    } catch {
      return false; // não mudou: última página
    }
    return true;
  }

  async firstRowSignature(page) {
    return page.evaluate((sel) => {
      const row = document.querySelector(`${sel} tr.rgRow, ${sel} tr.rgAltRow`);
      return row ? row.textContent.replace(/\s+/g, " ").trim() : "";
    }, GRID);
  }

  // Localiza o chamado por código, robusto a filtros/abas da fila.
  // Usa o filtro de coluna do RadGrid (FilterTextBox_CODIGO), que sobrepõe o
  // filtro de status/grupo — sem isso, um chamado fora do filtro atual "some".
  async get(id) {
    const alvo = String(id).trim();
    const page = await this.session.open(LIST_PATH);
    try {
      await page.waitForSelector(`${GRID} table.rgMasterTable`, { state: "attached" });
      const filtro = page.locator("input[id*='FilterTextBox_CODIGO']").first();
      if (await filtro.count()) {
        await filtro.fill(alvo);
        await filtro.press("Enter");
        await page.waitForTimeout(3000);
      }
      const tickets = toTickets(await this.readPage(page), this.cfg.baseUrl);
      const found = tickets.find((t) => String(t.id).trim() === alvo);
      if (!found) throw new Error(`Chamado não encontrado na busca por código: ${id}`);
      return found;
    } finally {
      await page.close();
    }
  }

  // Histórico completo: abre a página real viewHistoricoChamado.aspx.
  async history(id) {
    const ticket = await this.get(id);
    const handles = ticket._actions;
    if (!handles?.encryptedId) throw new Error(`Sem handle de ação para o chamado ${id}.`);
    const page = await this.session.open(ACTION_URLS.historico({ id: handles.encryptedId }));
    try {
      await page.waitForLoadState("domcontentloaded");
      // Grades confirmadas em viewHistoricoChamado.aspx: #gridHistorico (movimentações)
      // e #gridAnexos. Nada de heurística de "maior tabela" — isso pegava o calendário.
      const data = await page.evaluate(() => {
        const readGrid = (sel) => {
          const grid = document.querySelector(sel);
          if (!grid) return { headers: [], rows: [] };
          const headers = [...grid.querySelectorAll("table.rgMasterTable thead th")]
            .map((th) => th.textContent.trim()).filter(Boolean);
          const rows = [...grid.querySelectorAll("tr.rgRow, tr.rgAltRow")]
            .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.replace(/\s+/g, " ").trim()));
          return { headers, rows };
        };
        return { historico: readGrid("#gridHistorico"), anexos: readGrid("#gridAnexos") };
      });
      const entries = data.historico.rows.map((cells) => {
        const entry = {};
        data.historico.headers.forEach((header, i) => { if (header) entry[header] = cells[i] ?? ""; });
        return entry;
      });
      return {
        ticketId: id,
        headers: data.historico.headers,
        entries,
        anexos: data.anexos.rows.map((cells) => cells.filter(Boolean).join(" | ")).filter(Boolean)
      };
    } finally {
      await page.close();
    }
  }

  // Detalhe completo do chamado (tela de alteração), com todos os campos do formulário.
  async detail(id) {
    const ticket = await this.get(id);
    const h = ticket._actions;
    if (!h?.encryptedId) throw new Error(`Sem handle de ação para o chamado ${id}.`);
    const page = await this.session.open(ACTION_URLS.detalhe({
      id: h.encryptedId, codigo: h.codigo || id, servicoId: h.servicoId,
      data: h.data, oldstatus: h.oldstatus, retrabalho: h.retrabalho, criaproblema: h.criaproblema
    }));
    try {
      await page.waitForLoadState("domcontentloaded");
      const fields = await page.evaluate(() =>
        [...document.querySelectorAll("input[type=text], textarea, select")]
          .filter((el) => el.id && !el.disabled)
          .map((el) => ({
            id: el.id,
            tag: el.tagName.toLowerCase(),
            label: (document.querySelector(`label[for="${el.id}"]`)?.textContent || "").replace(/\s+/g, " ").trim() || null,
            value: (el.value || "").slice(0, 300),
            readOnly: Boolean(el.readOnly)
          }))
      );
      return { ticketId: id, grid: ticket, fields };
    } finally {
      await page.close();
    }
  }

  // Registra um andamento no chamado (tela viewInsereAtividade.aspx).
  // É a ação central do atendimento: descreve o que foi feito e, opcionalmente,
  // aponta tempo. Verifica o resultado relendo o histórico — não confia no clique.
  async addActivity(id, input) {
    assertWriteAuthorized(input);
    if (!clean(input.descricao)) throw new Error("Descrição do andamento é obrigatória.");

    // Ensaio a seco não consome chave de idempotência (não escreveu nada).
    const executar = async () => {
      const before = await this.history(id);
      const ticket = await this.get(id);
      const h = ticket._actions;
      if (!h?.encryptedId) throw new Error(`Sem handle de ação para o chamado ${id}.`);

      const grupo = clean(input.grupo) || clean(ticket.group);
      if (!grupo) throw new Error("Grupo responsável pela atividade é obrigatório (campo exigido pela tela).");

      const page = await this.session.open(ACTION_URLS.inserirAtividade({ id: h.encryptedId, codigo: h.codigo || id }));
      let validacao = null;
      try {
        await page.waitForSelector("#edtDEsc", { state: "visible" });
        await this.setTextBox(page, "edtDEsc", input.descricao);
        // Estimativa em minutos (campo numérico simples: "00:05" vira "000").
        await this.setTextBox(page, "edtTempoatd", input.tempoAtendimento ?? 5);
        await this.selectCombo(page, "radGrupo", grupo);
        // Transferência de responsável: o combo de usuário só carrega após o grupo.
        if (clean(input.usuario)) await this.selectCombo(page, "cbbUsrGroup", clean(input.usuario));

        // Ensaio a seco: preenche e valida tudo, mas NÃO grava. Serve para conferir
        // que grupo/usuário existem e que a tela aceitou os valores, sem deixar rastro.
        if (input.dryRun) {
          const estado = await this.setTelerik(page, `
            (function () {
              return {
                descricao: $find("edtDEsc").get_value(),
                tempo: $find("edtTempoatd").get_value(),
                grupo: $find("radGrupo").get_text(),
                usuario: $find("cbbUsrGroup") ? $find("cbbUsrGroup").get_text() : null
              };
            })()`);
          return { dryRun: true, ok: true, ticketId: id, gravado: false, preenchido: estado };
        }

        await page.click("#btnSalvar_input").catch(async () => {
          // Se o clique esbarrar no _doPostBack estrito, dispara pelo event loop.
          await this.setTelerikAsync(page, `document.getElementById("btnSalvar_input").click();`);
        });
        await page.waitForTimeout(4000);
        // Só os validadores que REALMENTE falharam. Ler todos os spans vermelhos
        // devolvia a lista inteira da página, inclusive os que estavam satisfeitos.
        validacao = await page.evaluate(() => {
          const validators = window.Page_Validators || [];
          const falhas = [...validators]
            .filter((v) => v.isvalid === false)
            .map((v) => (v.textContent || v.innerText || "").replace(/\s+/g, " ").trim())
            .filter(Boolean);
          return falhas.length ? falhas.join(" | ") : null;
        });
      } finally {
        await page.close();
      }

      // Evidência: o histórico tem que ter crescido.
      //
      // CUIDADO: o GestãoX demora a refletir a gravação. Declarar falha cedo demais é
      // pior que esperar — o chamador tenta de novo e cria DUPLICATA (aconteceu de
      // verdade em 2026-07-29: duas atividades idênticas no MIP000007155). Por isso
      // aqui se insiste algumas vezes antes de dizer que não gravou.
      let after = null;
      for (let tentativa = 0; tentativa < 6; tentativa++) {
        await new Promise((r) => setTimeout(r, 2500));
        after = await this.history(id);
        if (after.entries.length > before.entries.length) break;
      }
      const gravou = after && after.entries.length > before.entries.length;
      if (!gravou) {
        throw new Error(
          `Andamento aparentemente NÃO foi gravado no chamado ${id} ` +
          `(histórico segue com ${before.entries.length} entradas após ~15s).` +
          (validacao ? ` Validação da tela: ${validacao}` : "") +
          " ATENÇÃO: confirme no GestãoX antes de repetir — o sistema pode gravar com atraso e a repetição duplica o andamento."
        );
      }
      return {
        ok: true,
        ticketId: id,
        entradasAntes: before.entries.length,
        entradasDepois: after.entries.length,
        ultimaEntrada: after.entries[after.entries.length - 1],
        validacao
      };
    };

    return input.dryRun ? executar() : this.once(input.idempotencyKey, executar);
  }

  // Abre um chamado novo (tela viewIncidenteDireto.aspx).
  // Os combos são em CASCATA: departamento -> serviço -> (usuário). Cada seleção
  // dispara postback, por isso selectCombo espera entre uma etapa e a seguinte.
  async createTicket(input) {
    assertWriteAuthorized(input);
    for (const campo of ["departamento", "servico", "descricao"]) {
      if (!clean(input[campo])) throw new Error(`Campo obrigatório para abrir chamado: ${campo}.`);
    }

    const executar = async () => {
      const page = await this.session.open(
        "/Chamados/viewIncidenteDireto.aspx?id=0&origem=ChamadosGrupo&chamada=master&width=1400&height=800&incidenteid=0&Userid=0"
      );
      try {
        await page.waitForSelector("#edtDEsc", { state: "visible" });
        await page.waitForTimeout(1500);

        // Ordem obrigatória da cascata: departamento -> serviço -> solicitante.
        // Escolher o solicitante auto-preenche filial, unidade e centro de custo
        // (get_enabled()===false nesses campos antes do solicitante).
        await this.selectCombo(page, "rdCatalogo", clean(input.departamento));
        await this.selectCombo(page, "cbbServicos", clean(input.servico));
        await this.selectCombo(page, "rdUser", clean(input.solicitante));
        await this.setTextBox(page, "edtDEsc", input.descricao);
        // Ramal e centro de custo são obrigatórios; usa o que veio auto-preenchido
        // do solicitante quando o input não especifica.
        await this.setTextBox(page, "edtRamal", clean(input.ramal) || "0");
        if (clean(input.centroCusto)) await this.selectCombo(page, "cbbCentroCusto", clean(input.centroCusto));
        if (clean(input.filial)) await this.selectCombo(page, "cbbFilialSol", clean(input.filial));
        if (clean(input.unidade)) await this.selectCombo(page, "cbbUnidade", clean(input.unidade));
        if (clean(input.impacto)) await this.selectCombo(page, "cbbImpacto", clean(input.impacto));
        // Atalhos de workflow na própria abertura.
        if (input.assumir) await page.check("#chkAssumir").catch(() => {});
        if (input.resolvidoPrimeiroContato) await page.check("#chkTelefone").catch(() => {});

        const preenchido = await this.setTelerik(page, `
          (function () {
            var g = function (id) { var c = $find(id); return c ? (c.get_text ? c.get_text() : c.get_value()) : null; };
            return { departamento: g("rdCatalogo"), servico: g("cbbServicos"), solicitante: g("rdUser"),
                     filial: g("cbbFilialSol"), unidade: g("cbbUnidade"), centroCusto: g("cbbCentroCusto"),
                     impacto: g("cbbImpacto"), ramal: (document.getElementById("edtRamal")||{}).value,
                     descricao: g("edtDEsc") };
          })()`);

        if (input.screenshotPath) await page.screenshot({ path: input.screenshotPath, fullPage: true });
        if (input.dryRun) return { dryRun: true, ok: true, criado: false, preenchido };

        // Botão de gravar confirmado por screenshot: btnSalvaChamado_input.
        const antes = await this.listCodigos();
        await this.setTelerikAsync(page, `var b = document.getElementById("btnSalvaChamado_input"); if (b) b.click();`);
        await page.waitForTimeout(5000);
        const erroTela = await page.evaluate(() =>
          [...(window.Page_Validators || [])].filter((v) => v.isvalid === false)
            .map((v) => (v.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ") || null
        ).catch(() => null);

        // Evidência: um código novo tem que aparecer na grade.
        let novo = null;
        for (let i = 0; i < 6 && !novo; i++) {
          await new Promise((r) => setTimeout(r, 2500));
          novo = (await this.listCodigos()).find((c) => !antes.includes(c)) || null;
        }
        if (!novo) {
          throw new Error(
            "Chamado aparentemente não foi criado (nenhum código novo na grade após ~15s)." +
            (erroTela ? ` Validação da tela: ${erroTela}.` : "") +
            " Confira no GestãoX antes de repetir."
          );
        }
        return { ok: true, criado: true, ticketId: novo, preenchido };
      } finally {
        await page.close();
      }
    };

    return input.dryRun ? executar() : this.once(input.idempotencyKey, executar);
  }

  async listCodigos() {
    return (await this.list({})).map((t) => t.id);
  }

  // === Tela unificada de atendimento (viewVisualizaChamados, aba Detalhes) ===
  // Este é o caminho CORRETO para comentar, mudar status e resolver: NÃO cria
  // atividade de workflow (diferente de viewInsereAtividade). Campos confirmados:
  //   rdStatus (combo Novo status), edtDescPublica (comentário),
  //   rblTipoDescricao_0/1 (público/interno), btnSalvar_input (Salvar).
  async updateTicket(id, input) {
    assertWriteAuthorized(input);
    if (!clean(input.comentario) && !clean(input.status)) {
      throw new Error("updateTicket exige ao menos comentário ou status.");
    }
    const executar = async () => {
      const before = await this.history(id);
      const ticket = await this.get(id);
      const hd = ticket._actions;
      if (!hd?.encryptedId) throw new Error(`Sem handle de ação para o chamado ${id}.`);

      const page = await this.session.open(ACTION_URLS.detalhe({
        id: hd.encryptedId, codigo: hd.codigo || id, servicoId: hd.servicoId,
        data: hd.data, oldstatus: hd.oldstatus, retrabalho: hd.retrabalho, criaproblema: hd.criaproblema
      }));
      let validacao = null;
      try {
        // Abrindo a URL direto, a própria página é a tela de detalhe (os campos
        // ficam no main frame). Se algum dia vier embutida em iframe, cai no filho.
        await page.waitForSelector("#edtDescPublica", { state: "visible", timeout: 25000 })
          .catch(() => {});
        let frame = (await page.$("#edtDescPublica"))
          ? page.mainFrame()
          : page.frames().find((f) => /viewVisualizaChamados/i.test(f.url()) && f !== page.mainFrame());
        if (!frame) throw new Error("Tela de detalhe do chamado não carregou (#edtDescPublica ausente).");
        await frame.waitForSelector("#edtDescPublica", { state: "visible", timeout: 20000 });
        await new Promise((r) => setTimeout(r, 1500));

        const set = async (code) => { await frame.waitForFunction(() => typeof window.$find === "function", null, { timeout: 20000 }); return frame.evaluate((c) => window.eval(c), code); };
        const setAsync = async (code) => { await frame.evaluate((c) => window.eval(`setTimeout(function(){${c}},0)`), code); await new Promise((r) => setTimeout(r, 2500)); };

        if (input.interno) await frame.check("#rblTipoDescricao_1").catch(() => {});

        // Comentário: edtDescPublica é textarea comum (fill funciona aqui).
        if (clean(input.comentario)) {
          await frame.fill("#edtDescPublica", input.comentario)
            .catch(async () => { await frame.click("#edtDescPublica"); await frame.locator("#edtDescPublica").pressSequentially(input.comentario, { delay: 3 }); });
        }

        // Novo status (combo Telerik: item.select dispara postback).
        if (clean(input.status)) {
          const existe = await set(`(function(){var c=$find("rdStatus");if(!c)return {e:"nocombo"};if(c.findItemByText(${JSON.stringify(input.status)}))return {ok:1};var a=[],it=c.get_items();for(var i=0;i<Math.min(it.get_count(),12);i++)a.push(it.getItem(i).get_text());return {e:"notfound",a:a};})()`);
          if (existe?.e) throw new Error(`Status "${input.status}" não existe. Opções: ${(existe.a || []).join(" / ") || existe.e}`);
          await setAsync(`var c=$find("rdStatus");var it=c.findItemByText(${JSON.stringify(input.status)});if(it)it.select();`);
        }

        if (input.dryRun) {
          const estado = await set(`(function(){return {status:$find("rdStatus")?$find("rdStatus").get_text():null, comentario:(document.getElementById("edtDescPublica")||{}).value};})()`);
          return { dryRun: true, ok: true, gravado: false, estado };
        }

        await setAsync(`var b=document.getElementById("btnSalvar_input"); if(b) b.click();`);
        await page.waitForTimeout(4000);
        validacao = await frame.evaluate(() => [...(window.Page_Validators || [])].filter((v) => v.isvalid === false).map((v) => (v.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ") || null).catch(() => null);
      } finally {
        await page.close();
      }

      // Evidência: histórico cresceu OU o status passou a ser o pedido.
      // Um status de fechamento (RESOLVIDO/CANCELADO...) TIRA o chamado da fila
      // de pendentes; nesse caso o próprio sumiço da fila confirma a mudança.
      const statusFecha = /RESOLVIDO|CANCELAD|FECHAD|CONCLU/i.test(clean(input.status).toUpperCase());
      let after = { entries: [] }, confirmado = false, statusAtual = null, saiuDaFila = false;
      for (let i = 0; i < 6 && !confirmado; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          after = await this.history(id);
          statusAtual = (await this.get(id)).status;
          confirmado = after.entries.length > before.entries.length ||
            (clean(input.status) && clean(statusAtual).toUpperCase() === clean(input.status).toUpperCase());
        } catch (e) {
          if (/não encontrado/i.test(e.message) && statusFecha) {
            confirmado = true; saiuDaFila = true; statusAtual = clean(input.status).toUpperCase();
          } else if (i >= 5) {
            throw e;
          }
        }
      }
      if (!confirmado) {
        throw new Error(
          `Atualização do chamado ${id} não confirmada após ~15s.` +
          (validacao ? ` Validação: ${validacao}.` : "") +
          " Confira no GestãoX antes de repetir (o sistema grava com atraso; repetir duplica)."
        );
      }
      return { ok: true, ticketId: id, statusAtual, saiuDaFila, entradasAntes: before.entries.length, entradasDepois: after.entries.length, validacao };
    };
    return input.dryRun ? executar() : this.once(input.idempotencyKey, executar);
  }

  // Transferir chamado = andamento com grupo (e opcionalmente usuário) de destino.
  // É a mesma tela; o GestãoX não tem ação separada de transferência.
  async transfer(id, input) {
    if (!clean(input.grupo)) throw new Error("Grupo de destino é obrigatório para transferir.");
    return this.addActivity(id, {
      ...input,
      descricao: clean(input.descricao) ||
        `Chamado transferido para ${clean(input.grupo)}${clean(input.usuario) ? ` / ${clean(input.usuario)}` : ""}.`
    });
  }

  // Preenche um controle Telerik pela API cliente dele.
  //
  // Duas armadilhas resolvidas aqui:
  // 1. RadTextBox/RadComboBox mantêm o valor num ClientState próprio. Escrever no DOM
  //    (fill) ou digitar (pressSequentially) NÃO chega ao servidor — a tela mostra o
  //    texto e o postback vai vazio, gerando "campo obrigatório" com o campo preenchido.
  // 2. `select()` do RadComboBox dispara `_doPostBack`, que percorre
  //    `arguments.callee.caller`. Se QUALQUER frame da pilha for estrito, o acesso a
  //    `.caller` lança TypeError — e o page.evaluate do Playwright é sempre estrito.
  //    Solução: agendar a chamada com setTimeout, para a pilha nascer do event loop
  //    do próprio navegador, sem o nosso frame no meio.
  async setTelerik(page, expressao) {
    // Após um postback de combo em cascata a página recarrega e o $find some por
    // alguns instantes. Sem esperar, o próximo passo estoura "$find is not defined".
    await page.waitForFunction(() => typeof window.$find === "function", null, { timeout: 20000 });
    return page.evaluate((code) => window.eval(code), expressao);
  }

  // Executa código que dispara postback, fora da nossa pilha de chamada.
  async setTelerikAsync(page, corpo) {
    await page.waitForFunction(() => typeof window.$find === "function", null, { timeout: 20000 });
    await page.evaluate((code) => window.eval(`setTimeout(function () { ${code} }, 0)`), corpo);
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => typeof window.$find === "function", null, { timeout: 20000 }).catch(() => {});
  }

  async setTextBox(page, id, valor) {
    const ok = await this.setTelerik(page, `
      (function () {
        var c = $find(${JSON.stringify(id)});
        if (!c) return "controle nao encontrado";
        c.set_value(${JSON.stringify(String(valor))});
        return String(c.get_value());
      })()`);
    if (ok === "controle nao encontrado") throw new Error(`Controle Telerik ausente: ${id}`);
    return ok;
  }

  // Seleciona item de RadComboBox pelo texto exato. Falha explicitamente se não existir,
  // em vez de salvar com o valor errado.
  async selectCombo(page, comboId, texto) {
    // 0) Combo com carregamento sob demanda (LoadOnDemand) vem vazio: só busca no
    //    servidor quando o usuário digita. Dispara a busca antes de procurar o item.
    const vazio = await this.setTelerik(page, `
      (function () {
        var c = $find(${JSON.stringify(comboId)});
        return c && c.get_items ? c.get_items().get_count() === 0 : false;
      })()`);
    if (vazio) {
      await this.setTelerikAsync(page, `
        var c = $find(${JSON.stringify(comboId)});
        if (c && c.requestItems) { c.set_text(${JSON.stringify(texto)}); c.requestItems(${JSON.stringify(texto)}, false); }`);
      await page.waitForTimeout(2500);
    }

    // 1) Confere que o item existe — leitura pura, sem postback.
    const existe = await this.setTelerik(page, `
      (function () {
        var c = $find(${JSON.stringify(comboId)});
        if (!c) return { erro: "combo nao encontrado" };
        if (c.findItemByText(${JSON.stringify(texto)})) return { ok: true };
        var amostra = [], itens = c.get_items();
        for (var i = 0; i < Math.min(itens.get_count(), 8); i++) amostra.push(itens.getItem(i).get_text());
        return { erro: "item nao encontrado", amostra: amostra };
      })()`);
    if (existe?.erro) {
      throw new Error(`Opção "${texto}" não existe no combo ${comboId}. Amostra: ${(existe.amostra || []).join(" / ")}`);
    }

    // 2) Seleciona fora da nossa pilha (o select dispara postback).
    await this.setTelerikAsync(page, `
      var c = $find(${JSON.stringify(comboId)});
      var item = c.findItemByText(${JSON.stringify(texto)});
      if (item) item.select();`);

    // 3) Evidência de que pegou. O select de um combo em cascata dispara postback
    //    pesado (recarrega dependentes); a confirmação precisa de retry porque o
    //    $find fica indisponível por um instante enquanto a página reinicializa.
    let estado = null;
    for (let i = 0; i < 6; i++) {
      estado = await this.setTelerik(page, `
        (function () {
          var c = $find(${JSON.stringify(comboId)});
          if (!c) return { indisponivel: true };
          return {
            texto: c.get_text(),
            habilitado: c.get_enabled ? c.get_enabled() : null,
            somenteLeitura: c.get_readOnly ? c.get_readOnly() : null,
            qtdItens: c.get_items ? c.get_items().get_count() : null
          };
        })()`);
      if (estado && !estado.indisponivel && clean(estado.texto) === clean(texto)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!estado || estado.indisponivel || clean(estado.texto) !== clean(texto)) {
      throw new Error(
        `Combo ${comboId} não assumiu "${texto}" (está "${estado?.texto ?? "indisponível"}"). ` +
        `habilitado=${estado?.habilitado} somenteLeitura=${estado?.somenteLeitura} itens=${estado?.qtdItens}`
      );
    }
    return { ok: true, texto: estado.texto };
  }

  // Assume o chamado (viewAssumirChamados = diálogo "Sim/Não").
  // Verifica relendo a grade: quando assumido, a ação de assumir some da linha.
  async assume(id, input) {
    assertWriteAuthorized(input);
    const executar = async () => {
      const ticket = await this.get(id);
      const h = ticket._actions;
      if (!h?.assumirArgs) {
        return { ok: true, ticketId: id, jaAssumido: true, assignee: ticket.assignee || null };
      }
      const url = ACTION_URLS.assumir({ id: h.encryptedId, codigo: h.codigo || id, ...h.assumirArgs });
      const page = await this.session.open(url);
      try {
        await page.waitForSelector("#btnSalvaChamado_input", { state: "visible" });
        if (input.dryRun) {
          const pergunta = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 120));
          return { dryRun: true, ok: true, assumido: false, telaConfirma: pergunta };
        }
        await this.setTelerikAsync(page, `var b=document.getElementById("btnSalvaChamado_input"); if(b) b.click();`);
        await page.waitForTimeout(3000);
      } finally {
        await page.close();
      }
      // Evidência: a ação de assumir deve ter sumido da linha.
      let depois = null;
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        depois = await this.get(id);
        if (!depois._actions?.assumirArgs) break;
      }
      if (depois?._actions?.assumirArgs) {
        throw new Error(`Chamado ${id} não parece ter sido assumido (ação de assumir ainda presente após ~13s). Confira no GestãoX.`);
      }
      return { ok: true, ticketId: id, assignee: depois.assignee || null, status: depois.status || null };
    };
    return input.dryRun ? executar() : this.once(input.idempotencyKey, executar);
  }

  // resolve/mudança de status é feito por updateTicket({status}).

  async once(key, action) {
    const file = join(this.cfg.dataDir, "idempotency", `${encodeURIComponent(key)}.json`);
    try { return { ...JSON.parse(await readFile(file, "utf8")), replayed: true }; } catch {}
    const value = await action();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value), { encoding: "utf8", flag: "wx" });
    return { ...value, replayed: false };
  }
}

// Converte a matriz da grade em tickets canônicos, preservando tudo em _raw.
export function toTickets({ headers, rows, actions = [] }, baseUrl = "", limit) {
  const out = [];
  for (const [rowIndex, cells] of rows.entries()) {
    const raw = {};
    headers.forEach((header, index) => {
      if (header && cells[index] !== undefined) raw[header] = cells[index];
    });
    const ticket = { _raw: raw };
    for (const [column, field] of Object.entries(COLUMN_MAP)) {
      const value = raw[column];
      if (value !== undefined && value !== "") ticket[field] = value;
    }
    if (!ticket.id) continue; // linha de layout/agrupamento
    if (!ticket.title) ticket.title = ticket.description || ticket.service || "";
    // Handles das ações (id criptografado etc.) — necessários para abrir detalhe,
    // histórico e as telas de escrita. Sem isso o chamado é só leitura de grade.
    const rowActions = actions[rowIndex];
    if (rowActions?.length) ticket._actions = parseRowActions(rowActions);
    ticket.url = `${baseUrl}/Chamados/TodosV2#${encodeURIComponent(ticket.id)}`;
    out.push(ticket);
    if (limit && out.length >= limit) break;
  }
  return out;
}
