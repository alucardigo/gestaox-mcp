import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createBackend } from "./backend.mjs";
import { analyzeTicket, draftReply, prepareAzureWorkItem } from "./domain.mjs";
import { OperationalMemory } from "./memory.mjs";

const backend = await createBackend();
const memory = new OperationalMemory(process.env.GESTAOX_DATA_DIR || new URL("../runtime", import.meta.url).pathname);
const server = new McpServer({ name: "gestaox-atendimento", version: "0.2.0" });

const ticketId = z.string().min(1).describe("Código exato do chamado GestãoX (ex.: MIP000009028).");
const writeGuard = {
  confirmed: z.literal(true).describe("Confirmação explícita do usuário após revisar a prévia."),
  idempotencyKey: z.string().min(8).max(128).describe("Chave única e estável para impedir escrita duplicada.")
};
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

server.registerTool("gestaox_health_check", {
  description: "Verifica o backend configurado (mock ou gestaox) sem alterar dados.",
  inputSchema: {},
  annotations: readOnly
}, async () => result(await backend.health()));

server.registerTool("gestaox_list_tickets", {
  description: "Lista chamados da fila do atendente no GestãoX (RetornaChamadosLista). Somente leitura.",
  inputSchema: {
    tipoTela: z.string().optional().describe('Tela/aba do GestãoX. Padrão "Todos".'),
    busca: z.string().optional().describe("Texto de busca; padrão sem filtro."),
    limit: z.number().int().min(1).max(500).optional().describe("Máximo de registros (padrão 200).")
  },
  annotations: readOnly
}, async (filters) => result(await backend.list(filters)));

server.registerTool("gestaox_get_ticket", {
  description: "Detalhe de um chamado (RetornaDetalhesChamados). Somente leitura.",
  inputSchema: { ticketId },
  annotations: readOnly
}, async ({ ticketId }) => result(await backend.get(ticketId)));

server.registerTool("gestaox_get_history", {
  description: "Histórico completo do chamado: todas as movimentações (usuário, status, grupo, data, SLA, descrição) e anexos. Somente leitura.",
  inputSchema: { ticketId, publicOnly: z.boolean().default(true).describe("Só interações públicas.") },
  annotations: readOnly
}, async ({ ticketId, publicOnly }) => result(await backend.history(ticketId, { publicOnly })));

server.registerTool("gestaox_get_detail", {
  description: "Detalhe completo do chamado com todos os campos do formulário de alteração. Somente leitura.",
  inputSchema: { ticketId },
  annotations: readOnly
}, async ({ ticketId }) => {
  if (typeof backend.detail !== "function") throw new Error("Backend atual não suporta detalhe de formulário (use GESTAOX_BACKEND=web).");
  return result(await backend.detail(ticketId));
});

server.registerTool("gestaox_analyze_ticket", {
  description: "Analisa completude, SLA, risco e próximos passos, e gera rascunho de resposta. Sem rede além da leitura do chamado.",
  inputSchema: { ticketId },
  annotations: readOnly
}, async ({ ticketId }) => {
  const ticket = await backend.get(ticketId);
  return result({ ticket, analysis: analyzeTicket(ticket), draftReply: draftReply(ticket) });
});

server.registerTool("gestaox_prepare_azure_ticket", {
  description: "Gera prévia de work item ADO + termo de busca de duplicidade a partir do chamado. NÃO cria o item.",
  inputSchema: { ticketId },
  annotations: readOnly
}, async ({ ticketId }) => result(prepareAzureWorkItem(await backend.get(ticketId))));

server.registerTool("gestaox_comment_ticket", {
  description: "Registra andamento/comentário no chamado pela tela de atendimento (NÃO cria atividade de workflow). Escrita.",
  inputSchema: {
    ticketId,
    comentario: z.string().min(1).max(8000).describe("Texto do andamento."),
    interno: z.boolean().default(false).describe("Comentário interno (só responsáveis) em vez de público."),
    dryRun: z.boolean().default(false),
    ...writeGuard
  },
  annotations: write
}, async ({ ticketId, comentario, interno, dryRun, ...guard }) => {
  if (typeof backend.updateTicket !== "function") throw new Error("Use GESTAOX_BACKEND=web.");
  return result(await backend.updateTicket(ticketId, { comentario, interno, dryRun, ...guard }));
});

server.registerTool("gestaox_resolve_ticket", {
  description: "Resolve/fecha ou muda o status do chamado pela tela de atendimento. Status válidos incluem RESOLVIDO, CANCELADO, EM ANÁLISE etc. Escrita.",
  inputSchema: {
    ticketId,
    status: z.string().min(1).describe("Novo status exato (ex.: RESOLVIDO)."),
    comentario: z.string().min(1).max(8000).describe("Descrição da resolução/mudança."),
    interno: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    ...writeGuard
  },
  annotations: write
}, async ({ ticketId, status, comentario, interno, dryRun, ...guard }) => {
  if (typeof backend.updateTicket !== "function") throw new Error("Use GESTAOX_BACKEND=web.");
  return result(await backend.updateTicket(ticketId, { status, comentario, interno, dryRun, ...guard }));
});

server.registerTool("gestaox_add_activity", {
  description: "Registra um andamento no chamado (tela Inserir atividade). Verifica a gravação relendo o histórico. Escrita.",
  inputSchema: {
    ticketId,
    descricao: z.string().min(1).max(4000).describe("Descrição do andamento."),
    grupo: z.string().optional().describe("Grupo responsável; padrão o grupo atual do chamado."),
    tempoAtendimento: z.number().int().min(0).optional().describe("Estimativa em minutos (padrão 5)."),
    dryRun: z.boolean().default(false).describe("Ensaio a seco: preenche e valida sem gravar."),
    ...writeGuard
  },
  annotations: write
}, async ({ ticketId, ...input }) => {
  if (typeof backend.addActivity !== "function") throw new Error("Backend atual não suporta andamento (use GESTAOX_BACKEND=web).");
  return result(await backend.addActivity(ticketId, input));
});

server.registerTool("gestaox_create_ticket", {
  description: "Abre um novo chamado no GestãoX (viewIncidenteDireto). Cascata departamento→serviço→solicitante. Escrita.",
  inputSchema: {
    departamento: z.string().min(1).describe("Ex.: TI, EMX, PROJETOS, SGI."),
    servico: z.string().min(1).describe("Serviço exato, ex.: TI/Sistemas/FLUIG/Manutenção."),
    solicitante: z.string().min(1).describe("Nome completo do solicitante (combo LoadOnDemand)."),
    descricao: z.string().min(1).max(4000),
    centroCusto: z.string().optional().describe("Centro de custo exato; obrigatório na tela."),
    ramal: z.string().optional().describe("Ramal/telefone; padrão 0."),
    impacto: z.string().optional(),
    assumir: z.boolean().default(false).describe("Marca 'Assumir o chamado' na abertura."),
    resolvidoPrimeiroContato: z.boolean().default(false).describe("Marca 'Resolvido em primeiro contato'."),
    dryRun: z.boolean().default(false),
    ...writeGuard
  },
  annotations: write
}, async (input) => {
  if (typeof backend.createTicket !== "function") throw new Error("Backend atual não suporta abertura (use GESTAOX_BACKEND=web).");
  return result(await backend.createTicket(input));
});

server.registerTool("gestaox_transfer_ticket", {
  description: "Transfere o chamado para outro grupo (e opcionalmente atendente). No GestãoX transferir é um andamento com grupo de destino. Escrita.",
  inputSchema: {
    ticketId,
    grupo: z.string().min(1).describe("Grupo de destino, texto exato como aparece no GestãoX."),
    usuario: z.string().optional().describe("Atendente de destino dentro do grupo."),
    descricao: z.string().max(4000).optional().describe("Justificativa; se omitida, gera texto padrão."),
    tempoAtendimento: z.number().int().min(0).optional(),
    dryRun: z.boolean().default(false).describe("Ensaio a seco: preenche e valida sem gravar."),
    ...writeGuard
  },
  annotations: write
}, async ({ ticketId, ...input }) => {
  if (typeof backend.transfer !== "function") throw new Error("Backend atual não suporta transferência (use GESTAOX_BACKEND=web).");
  return result(await backend.transfer(ticketId, input));
});

server.registerTool("gestaox_assume_ticket", {
  description: "Assume o chamado para o atendente (diálogo Sim/Não). Verifica que a ação de assumir sumiu da linha. Escrita.",
  inputSchema: {
    ticketId,
    dryRun: z.boolean().default(false).describe("Ensaio a seco: abre a confirmação sem clicar Sim."),
    ...writeGuard
  },
  annotations: write
}, async ({ ticketId, ...input }) => {
  if (typeof backend.assume !== "function") throw new Error("Use GESTAOX_BACKEND=web.");
  return result(await backend.assume(ticketId, input));
});

server.registerTool("gestaox_memory_recent", {
  description: "Lê notas operacionais sanitizadas gravadas pelo plugin.",
  inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
  annotations: readOnly
}, async ({ limit }) => result(await memory.recent(limit)));

server.registerTool("gestaox_memory_record", {
  description: "Registra decisão/aprendizado sanitizado; nunca use para credenciais ou dado pessoal.",
  inputSchema: {
    ticketId: z.string().optional(),
    kind: z.enum(["decision", "runbook", "lesson", "note"]),
    note: z.string().min(1).max(4000)
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
}, async (entry) => result(await memory.record(entry)));

await server.connect(new StdioServerTransport());

function result(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}
