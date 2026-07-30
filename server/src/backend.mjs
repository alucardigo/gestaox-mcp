import { assertWriteAuthorized } from "./domain.mjs";
import { GestaoxBackend } from "./gestaox.mjs";
import { WebBackend } from "./web.mjs";

// mock    → desenvolvimento e testes, sem rede.
// web     → dirige a UI reusando a sessão do perfil (funciona hoje, sem depender da EMX).
// gestaox → API REST oficial; pronta, mas bloqueada até a EMX liberar token de integração.
export async function createBackend(env = process.env) {
  const kind = env.GESTAOX_BACKEND || "mock";
  if (kind === "mock") return new MockBackend();
  if (kind === "web") return WebBackend.create(env);
  if (kind === "gestaox") return GestaoxBackend.create(env);
  throw new Error(`GESTAOX_BACKEND inválido: ${kind} (use "mock", "web" ou "gestaox").`);
}

// Backend de desenvolvimento. Mesma superfície que o GestaoxBackend real,
// para os testes e a prévia funcionarem sem rede nem credenciais.
class MockBackend {
  constructor() {
    this.tickets = new Map([
      ["GX-1001", {
        id: "GX-1001",
        title: "Falha ao acessar o GestãoX",
        description: "Usuário recebe erro ao abrir o planejamento da obra 357.",
        status: "Em atendimento",
        requester: "Usuário de homologação",
        assignee: "Fulano de Tal",
        group: "SISTEMAS - FLUIG",
        service: "TI/Sistemas/Portal",
        dueAt: "2026-07-30T18:00:00-03:00",
        url: "https://gestaox.example.com/Chamados/Detalhe/GX-1001",
        comments: []
      }]
    ]);
    this.keys = new Map();
  }

  async health() { return { backend: "mock", ok: true }; }
  async list() { return [...this.tickets.values()].map((ticket) => structuredClone(ticket)); }
  async get(id) { return structuredClone(this.require(id)); }
  async history(id) { return { ticketId: id, entries: [] }; }

  async assume(id, input) {
    assertWriteAuthorized(input);
    return this.once(input.idempotencyKey, () => {
      const ticket = this.require(id);
      ticket.assignee = input.loginResponsavel || "atendente";
      ticket.status = "Em atendimento";
      return { ok: true, ticketId: id, assignee: ticket.assignee, status: ticket.status };
    });
  }

  async resolve(id, input) {
    assertWriteAuthorized(input);
    return this.once(input.idempotencyKey, () => {
      const ticket = this.require(id);
      const previousStatus = ticket.status;
      ticket.status = input.status || "Resolvido";
      ticket.comments.push({ kind: "resolucao", text: input.descricao, at: new Date().toISOString() });
      return { ok: true, ticketId: id, previousStatus, status: ticket.status };
    });
  }

  async setField(id, input) {
    assertWriteAuthorized(input);
    return this.once(input.idempotencyKey, () => {
      const ticket = this.require(id);
      ticket[input.campo] = input.valor;
      return { ok: true, ticketId: id, campo: input.campo, valor: input.valor };
    });
  }

  require(id) {
    const ticket = this.tickets.get(String(id));
    if (!ticket) throw new Error(`Chamado não encontrado: ${id}`);
    return ticket;
  }

  once(key, action) {
    if (this.keys.has(key)) return { ...this.keys.get(key), replayed: true };
    const value = action();
    this.keys.set(key, value);
    return { ...value, replayed: false };
  }
}
