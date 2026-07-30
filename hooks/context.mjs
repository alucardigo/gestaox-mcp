import { readFile } from "node:fs/promises";
import { join } from "node:path";

const input = await readStdin();
const event = input.hook_event_name;
const prompt = String(input.prompt ?? "");
const relevant = /gest[aã]o\s*x|chamado|atendimento|service\s*desk|azure\s*devops|\bado\b/i.test(prompt);

if (event === "UserPromptSubmit" && !relevant) process.exit(0);

const root = process.env.PLUGIN_ROOT;
let memory = "";
if (root) {
  try {
    memory = await readFile(join(root, "memory", "operational.md"), "utf8");
  } catch {
    memory = "Memória operacional indisponível.";
  }
}

const additionalContext = [
  "GestãoX: separar consulta, análise, prévia e execução.",
  "Nunca inventar rotas ou estados. Escritas exigem confirmação explícita e idempotencyKey.",
  "Antes de criar ADO, consultar duplicidade e seguir a skill azure-devops-ticket-standard.",
  memory
].join("\n\n");

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: event,
    additionalContext
  }
}));

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
