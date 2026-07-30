// Normaliza o JSON do GestãoX para o shape canônico que domain.mjs entende.
// Os nomes exatos das colunas ainda não foram travados numa chamada autenticada
// (ver docs/api-contract.md). Por isso o mapeamento é tolerante a apelidos e
// SEMPRE preserva o objeto original em `_raw` para não perder informação.

const FIELD_ALIASES = {
  id: ["Codigo", "CodigoChamado", "codigo", "Incidenteid", "IncidenteId", "Id"],
  title: ["Titulo", "Assunto", "Servico", "NomeServico", "titulo"],
  description: ["Descricao", "DescricaoChamado", "descricao", "Detalhe"],
  status: ["Status", "Situacao", "status", "StatusChamado"],
  requester: ["Solicitante", "NomeSolicitante", "Requester", "solicitante"],
  assignee: ["Responsavel", "Resp", "Atendente", "NomeResponsavel"],
  group: ["Grupo", "NomeGrupo", "GrupoResponsavel"],
  service: ["Servico", "CatalogoServico", "NomeServico"],
  openedAt: ["Abertura", "DataAbertura", "abertura"],
  dueAt: ["Previsao", "PrevisaoAtendimento", "SLA", "DataPrevisao", "previsao"],
  url: ["Url", "Link", "url"]
};

function pick(obj, aliases) {
  for (const key of aliases) {
    if (obj[key] != null && String(obj[key]).trim() !== "") return obj[key];
  }
  return undefined;
}

export function normalizeTicket(raw, fallbackId) {
  const source = unwrap(raw);
  const flat = Array.isArray(source) ? source[0] || {} : source || {};
  const ticket = { _raw: flat };
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    const value = pick(flat, aliases);
    if (value !== undefined) ticket[canonical] = value;
  }
  if (!ticket.id && fallbackId != null) ticket.id = String(fallbackId);
  return ticket;
}

export function normalizeList(raw) {
  const source = unwrap(raw);
  const rows = Array.isArray(source) ? source : source ? [source] : [];
  return rows.map((row) => normalizeTicket(row));
}

// GestãoX pode devolver array puro, {d:[...]}, ou um objeto envelope.
function unwrap(raw) {
  if (raw == null) return raw;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.d)) return raw.d;
  if (Array.isArray(raw.Dados)) return raw.Dados;
  if (Array.isArray(raw.dados)) return raw.dados;
  if (Array.isArray(raw.Result)) return raw.Result;
  return raw;
}
