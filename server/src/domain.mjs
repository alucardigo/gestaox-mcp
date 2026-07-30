const requiredForTriage = ["id", "title", "description", "status", "requester"];

export function analyzeTicket(ticket, now = new Date()) {
  const missingFields = requiredForTriage.filter((field) => !clean(ticket[field]));
  const dueAt = parseTicketDate(ticket.dueAt);
  const slaPercent = parseSlaPercent(ticket.sla);
  // Duas fontes de atraso: a previsão vencida e o próprio % de SLA do GestãoX
  // (a grade já mostra 621%, por exemplo). Qualquer uma basta.
  const overdue = !isClosed(ticket.status) && Boolean(
    (dueAt && dueAt < now) || (slaPercent !== null && slaPercent > 100)
  );
  const signals = `${ticket.title ?? ""} ${ticket.description ?? ""}`.toLowerCase();
  const securityRisk = /(senha|token|vazamento|phishing|ransomware|acesso indevido|lgpd)/i.test(signals);
  const priority = securityRisk || overdue ? "alta" : missingFields.length ? "média" : "normal";

  return {
    ticketId: String(ticket.id ?? ""),
    ready: missingFields.length === 0,
    missingFields,
    overdue,
    dueAt: dueAt ? dueAt.toISOString() : null,
    slaPercent,
    securityRisk,
    priority,
    nextActions: [
      ...(overdue ? [`SLA estourado${slaPercent !== null ? ` (${slaPercent}%)` : ""}: priorizar e comunicar o solicitante.`] : []),
      ...(securityRisk ? ["Aplicar o fluxo de incidente de segurança e limitar a exposição de dados."] : []),
      ...(missingFields.length ? [`Solicitar os campos ausentes: ${missingFields.join(", ")}.`] : []),
      ...(!missingFields.length ? ["Validar a reprodução e preparar uma resposta objetiva."] : []),
      "Gerar prévia antes de comentar ou movimentar o chamado."
    ]
  };
}

export function draftReply(ticket, analysis = analyzeTicket(ticket)) {
  if (!analysis.ready) {
    return `Olá! Para avançarmos no chamado ${ticket.id}, precisamos confirmar: ${analysis.missingFields.join(", ")}.`;
  }
  const subject = clean(ticket.title) || "solicitação";
  return `Olá! Analisamos o chamado ${ticket.id} (${subject}). Estamos validando a ocorrência e registraremos aqui o próximo resultado objetivo.`;
}

export function prepareAzureWorkItem(ticket, analysis = analyzeTicket(ticket)) {
  const title = `[GestãoX #${escapeText(ticket.id)}] ${escapeText(ticket.title || "Chamado sem título")}`.slice(0, 255);
  const sourceUrl = clean(ticket.url);
  const description = [
    "<h3>Origem</h3>",
    `<p>Chamado GestãoX <strong>#${escapeHtml(ticket.id)}</strong>${sourceUrl ? ` — <a href="${escapeHtml(sourceUrl)}">abrir chamado</a>` : ""}</p>`,
    "<h3>Contexto</h3>",
    `<p>${escapeHtml(ticket.description || "Descrição não informada.")}</p>`,
    "<h3>Triagem</h3>",
    `<ul><li>Prioridade sugerida: ${escapeHtml(analysis.priority)}</li><li>Status de origem: ${escapeHtml(ticket.status || "não informado")}</li></ul>`,
    "<h3>Critérios de aceite</h3>",
    "<ul><li>Causa ou necessidade validada.</li><li>Solução validada com evidência.</li><li>Chamado GestãoX atualizado com o resultado.</li></ul>"
  ].join("");

  return {
    workItemType: "Task",
    title,
    description,
    tags: ["GestãoX", `GestãoX-${escapeText(ticket.id)}`],
    source: { system: "GestãoX", id: String(ticket.id), url: sourceUrl || null },
    duplicateSearch: `GestãoX-${escapeText(ticket.id)}`
  };
}

export function assertWriteAuthorized(input) {
  if (input.confirmed !== true) throw new Error("Escrita bloqueada: gere a prévia e confirme explicitamente.");
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(String(input.idempotencyKey ?? ""))) {
    throw new Error("Escrita bloqueada: idempotencyKey deve ter 8-128 caracteres seguros.");
  }
}

export function sanitizeMemory(text) {
  return String(text)
    .replace(/(password|senha|token|cookie|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[REDACTED_CPF]")
    .slice(0, 4000);
}

// O GestãoX entrega data em pt-BR ("27/07/2026 16:45:54"). `new Date()` lê isso como
// mês 27 e devolve Invalid Date — o que fazia todo chamado atrasado passar por em dia.
export function parseTicketDate(value) {
  const text = clean(value);
  if (!text) return null;
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = br;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

// "621%" -> 621. A grade do GestãoX já calcula o consumo do SLA.
export function parseSlaPercent(value) {
  const match = clean(value).match(/(-?\d+(?:[.,]\d+)?)\s*%/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function isClosed(status) {
  return /^(fechado|resolvido|conclu[ií]do|done)$/i.test(clean(status));
}

function clean(value) {
  return String(value ?? "").trim();
}

function escapeText(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
