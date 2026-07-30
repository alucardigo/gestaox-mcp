import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTicket, assertWriteAuthorized, prepareAzureWorkItem, sanitizeMemory, parseTicketDate, parseSlaPercent } from "../src/domain.mjs";

// Regressão: o GestãoX entrega data pt-BR. `new Date("21/05/2026")` é Invalid Date,
// o que fazia TODO chamado atrasado ser reportado como em dia.
test("parseTicketDate entende o formato pt-BR do GestãoX", () => {
  const d = parseTicketDate("21/05/2026 17:25:53");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4); // maio
  assert.equal(d.getDate(), 21);
  assert.equal(d.getHours(), 17);
  assert.equal(parseTicketDate(""), null);
  assert.equal(parseTicketDate("lixo"), null);
});

test("parseSlaPercent lê o percentual da grade", () => {
  assert.equal(parseSlaPercent("621%"), 621);
  assert.equal(parseSlaPercent("80%"), 80);
  assert.equal(parseSlaPercent(""), null);
});

test("chamado com previsão vencida em pt-BR é atrasado e prioritário", () => {
  const analysis = analyzeTicket({
    id: "MIP000007155",
    title: "Protocolo de recebimento",
    description: "Fluxo de protocolo",
    status: "ANÁLISE AGENDADA",
    requester: "Samuel",
    dueAt: "21/05/2026 17:25:53",
    sla: "621%"
  }, new Date("2026-07-29T12:00:00-03:00"));
  assert.equal(analysis.overdue, true);
  assert.equal(analysis.slaPercent, 621);
  assert.equal(analysis.priority, "alta");
  assert.match(analysis.nextActions.join(" "), /SLA estourado \(621%\)/);
});

test("status de fechamento é reconhecido (regex de RESOLVIDO/CANCELADO)", () => {
  const fecha = (s) => /RESOLVIDO|CANCELAD|FECHAD|CONCLU/i.test(String(s).toUpperCase());
  assert.equal(fecha("RESOLVIDO"), true);
  assert.equal(fecha("CANCELADO"), true);
  assert.equal(fecha("EM ESPERA"), false);
  assert.equal(fecha("ANÁLISE AGENDADA"), false);
});

test("SLA acima de 100% marca atraso mesmo sem previsão", () => {
  const analysis = analyzeTicket({ id: "X", title: "t", description: "d", status: "EM ESPERA", requester: "r", sla: "200%" });
  assert.equal(analysis.overdue, true);
});

test("chamado fechado não conta como atrasado", () => {
  const analysis = analyzeTicket({ id: "X", title: "t", description: "d", status: "Resolvido", requester: "r", dueAt: "01/01/2020 10:00:00", sla: "900%" });
  assert.equal(analysis.overdue, false);
});

const ticket = {
  id: "GX-42",
  title: "Erro <crítico>",
  description: "Tela falha ao salvar & retorna 500.",
  status: "Em atendimento",
  requester: "Pessoa teste",
  url: "https://gestaox.example.com/Chamados/42"
};

test("triagem pronta sugere validação", () => {
  const analysis = analyzeTicket(ticket, new Date("2026-07-29T12:00:00Z"));
  assert.equal(analysis.ready, true);
  assert.equal(analysis.priority, "normal");
  assert.match(analysis.nextActions.join(" "), /Validar/);
});

test("triagem identifica campos ausentes e risco de segurança", () => {
  const analysis = analyzeTicket({ id: "1", title: "Token vazou" });
  assert.equal(analysis.ready, false);
  assert.equal(analysis.securityRisk, true);
  assert.equal(analysis.priority, "alta");
  assert.deepEqual(analysis.missingFields, ["description", "status", "requester"]);
});

test("payload ADO escapa HTML e preserva vínculo", () => {
  const payload = prepareAzureWorkItem(ticket);
  assert.match(payload.title, /GestãoX #GX-42/);
  assert.match(payload.description, /salvar &amp; retorna 500/);
  assert.equal(payload.duplicateSearch, "GestãoX-GX-42");
  assert.equal(payload.source.id, "GX-42");
});

test("escrita exige confirmação e idempotência válida", () => {
  assert.throws(() => assertWriteAuthorized({ confirmed: false, idempotencyKey: "abcdefgh" }), /bloqueada/);
  assert.throws(() => assertWriteAuthorized({ confirmed: true, idempotencyKey: "curta" }), /idempotencyKey/);
  assert.doesNotThrow(() => assertWriteAuthorized({ confirmed: true, idempotencyKey: "GX-42:comment:1" }));
});

test("memória remove segredos e CPF", () => {
  const value = sanitizeMemory("token=abc123 senha: xyz CPF 123.456.789-00");
  assert.equal(value, "token=[REDACTED] senha=[REDACTED] CPF [REDACTED_CPF]");
});
