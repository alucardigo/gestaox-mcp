import test from "node:test";
import assert from "node:assert/strict";
import { toTickets } from "../src/web.mjs";

// Cabeçalho real capturado da grade ctl00_MainContent_gridchamados em 2026-07-29.
const headers = [
  "Ordenação", "Código", "Tipo", "Impacto", "Relato", "Descrição", "Unidade", "Área/Ativo",
  "Área/Usuário", "Solicitante", "Prioridade Setor", "Status", "Centro de Custo", "Fornecedor",
  "Prot. Forn.", "Resp.", "Serviço", "Ramal", "Grupo", "Urg./Prior.", "Modelo do ativo",
  "Nome do ativo", "Numero de série do Ativo", "Patrimônio do Ativo", "Status do Ativo",
  "Tipo do ativo", "Abertura", "Ultima Alteração", "SLA atd.", "SLA Ativ.", "SLA", "Horas",
  "Previsão", "Anotações", "Número de Operações"
];

function row(overrides = {}) {
  const base = new Array(headers.length).fill("");
  const set = (col, value) => { base[headers.indexOf(col)] = value; };
  set("Código", "MIP000009028");
  set("Tipo", "Incidente");
  set("Descrição", "CTE 5107 não anexa nota fiscal no Fluig");
  set("Status", "EM ESPERA");
  set("Solicitante", "Luis Fernando Duarte Barbosa");
  set("Resp.", "Vinícius de Oliveira Garcia");
  set("Grupo", "SISTEMAS - FLUIG");
  set("Serviço", "TI/Sistemas/FLUIG/Manutenção");
  set("Abertura", "15/07/2026 16:45:54");
  set("Previsão", "27/07/2026 16:45:54");
  for (const [col, value] of Object.entries(overrides)) set(col, value);
  return base;
}

test("toTickets mapeia colunas reais da grade para o shape canônico", () => {
  const [ticket] = toTickets({ headers, rows: [row()] }, "https://gestaox.example.com");
  assert.equal(ticket.id, "MIP000009028");
  assert.equal(ticket.status, "EM ESPERA");
  assert.equal(ticket.requester, "Luis Fernando Duarte Barbosa");
  assert.equal(ticket.assignee, "Vinícius de Oliveira Garcia");
  assert.equal(ticket.group, "SISTEMAS - FLUIG");
  assert.equal(ticket.dueAt, "27/07/2026 16:45:54");
  assert.match(ticket.url, /gestaox.example.com/);
});

test("toTickets usa Descrição como título quando não há Relato", () => {
  const [ticket] = toTickets({ headers, rows: [row()] });
  assert.equal(ticket.title, "CTE 5107 não anexa nota fiscal no Fluig");
});

test("toTickets preserva todas as colunas em _raw", () => {
  const [ticket] = toTickets({ headers, rows: [row()] });
  assert.equal(ticket._raw["Serviço"], "TI/Sistemas/FLUIG/Manutenção");
  assert.equal(ticket._raw["Tipo"], "Incidente");
});

test("toTickets descarta linhas sem código (layout/agrupamento)", () => {
  const empty = new Array(headers.length).fill("");
  const tickets = toTickets({ headers, rows: [empty, row()] });
  assert.equal(tickets.length, 1);
});

test("toTickets respeita o limite", () => {
  const rows = [row({ "Código": "A1" }), row({ "Código": "A2" }), row({ "Código": "A3" })];
  assert.equal(toTickets({ headers, rows }, "", 2).length, 2);
});
