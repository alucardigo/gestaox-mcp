import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertWriteAuthorized } from "./domain.mjs";
import { normalizeTicket, normalizeList } from "./normalize.mjs";

// Cliente da API real do GestãoX (EMX). Contrato em docs/api-contract.md.
// Auth por Token (query string), obtido via EfetuarLoginInterno. Sem OAuth.
export class GestaoxBackend {
  static async create(env) {
    const base = (env.GESTAOX_BASE_URL || "https://gestaox.example.com/API/").replace(/\/?$/, "/");
    const login = env.GESTAOX_LOGIN || env.GESTAOX_EMAIL || "";
    if (!login) throw new Error("GESTAOX_LOGIN é obrigatório no backend gestaox (login do atendente).");
    return new GestaoxBackend({
      base,
      login,
      email: env.GESTAOX_EMAIL || "",
      senha: env.GESTAOX_SENHA || "",
      token: env.GESTAOX_TOKEN || "",
      tipoTela: env.GESTAOX_TIPO_TELA || "Todos",
      dataDir: env.GESTAOX_DATA_DIR || join(process.cwd(), "runtime")
    });
  }

  constructor(cfg) {
    this.cfg = cfg;
    this.token = cfg.token || "";
  }

  async health() {
    return {
      backend: "gestaox",
      baseUrl: this.cfg.base,
      login: this.cfg.login,
      tokenSource: this.cfg.token ? "env" : this.cfg.email ? "login" : "ausente",
      hasToken: Boolean(this.token)
    };
  }

  // Garante um Token válido: usa o de ambiente ou faz login com email/senha.
  // Confirmado em 2026-07-29: login é GET e o token vem no campo `TOKEN`.
  async ensureToken() {
    if (this.token) return this.token;
    if (!this.cfg.email || !this.cfg.senha) {
      throw new Error("Sem Token: defina GESTAOX_TOKEN ou GESTAOX_EMAIL+GESTAOX_SENHA para login.");
    }
    const url = this.url("api/usuario/EfetuarLoginInterno", { email: this.cfg.email, senha: this.cfg.senha });
    const body = await this.fetchJson("GET", url);
    this.user = { idUsu: body.IdUsu, empresaId: body.EmpresaId, login: body.Login };
    this.token = extractToken(body);
    if (!this.token) {
      throw new Error(
        "Login OK mas o campo TOKEN veio vazio: o acesso via API por token não está habilitado " +
        "para esta conta no GestãoX. Peça à EMP/EMX para liberar token de integração " +
        "(flags VALIDA_TOKEN/AcessoRemoto) ou forneça um usuário de integração e use GESTAOX_TOKEN."
      );
    }
    return this.token;
  }

  async list(filters = {}) {
    const token = await this.ensureToken();
    const url = this.url("api/chamado/RetornaChamadosLista", {
      Login: filters.login || this.cfg.login,
      TipoTela: filters.tipoTela || this.cfg.tipoTela,
      DescricaoBusca: filters.busca || "nao possui",
      TipoBusca: filters.tipoBusca || "nao possui",
      MaximoRegistros: filters.limit || 200,
      ordenacao: filters.ordenacao || 1,
      Token: token
    });
    return normalizeList(await this.fetchJson("GET", url));
  }

  async get(id) {
    const token = await this.ensureToken();
    const detalhe = await this.fetchJson("GET", this.url("api/chamado/RetornaDetalhesChamados", { CodigoChamado: id, Token: token }));
    return normalizeTicket(detalhe, id);
  }

  async history(id, { publicOnly = true } = {}) {
    const token = await this.ensureToken();
    return this.fetchJson("GET", this.url("api/chamado/RetornaHistoricoChamado", {
      CodigoChamado: id, InformacaoPublica: publicOnly, Token: token
    }));
  }

  async assume(id, input) {
    assertWriteAuthorized(input);
    const token = await this.ensureToken();
    return this.once(input.idempotencyKey, () => this.fetchJson("POST", this.url("api/chamado/AssumirChamadoComWorkflow"), {
      CodigoChamado: String(id),
      LoginResponsavel: input.loginResponsavel || this.cfg.login,
      Descricao: input.descricao || "",
      Token: token
    }));
  }

  async resolve(id, input) {
    assertWriteAuthorized(input);
    const token = await this.ensureToken();
    return this.once(input.idempotencyKey, () => this.fetchJson("POST", this.url("api/chamado/ResolverChamado"), {
      CodigoChamado: String(id),
      Descricao: input.descricao,
      LoginResponsavel: input.loginResponsavel || this.cfg.login,
      Status: input.status || "",
      NovoGrupo: input.novoGrupo || 0,
      NovoLoginAtendente: input.novoLoginAtendente || "",
      CategoriaFechamentoChamado: input.categoriaChamado || "",
      CategoriaFechamentoItem: input.categoriaItem || "",
      Token: token
    }));
  }

  async setField(id, input) {
    assertWriteAuthorized(input);
    const token = await this.ensureToken();
    const url = this.url("api/chamado/AlterarCampoChamado", {
      Incidenteid: id,
      LoginResponsavel: input.loginResponsavel || this.cfg.login,
      Campo: input.campo,
      Valor: input.valor,
      Token: token
    });
    return this.once(input.idempotencyKey, () => this.fetchJson("POST", url));
  }

  // --- infra HTTP ---
  url(path, params = {}) {
    const u = new URL(path, this.cfg.base);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    return u;
  }

  async fetchJson(method, url, body) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
    // GestãoX sinaliza token inválido com HTTP 500 e corpo string "TOKEN INVÁLIDO!".
    if (typeof json === "string" && /TOKEN\s+INV[ÁA]LIDO/i.test(json)) {
      this.token = ""; // força novo login na próxima chamada
      const err = new Error("GestãoX recusou o token (TOKEN INVÁLIDO). Conta sem acesso de API habilitado ou token expirado.");
      err.status = res.status;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`GestãoX ${method} ${url.pathname} falhou: HTTP ${res.status}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  // Idempotência persistente: mesma chave nunca escreve duas vezes.
  async once(key, action) {
    const file = join(this.cfg.dataDir, "idempotency", `${encodeURIComponent(key)}.json`);
    try { return { ...JSON.parse(await readFile(file, "utf8")), replayed: true }; } catch {}
    const value = await action();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value), { encoding: "utf8", flag: "wx" });
    return { ...value, replayed: false };
  }
}

// A resposta de login não tem schema publicado (HttpResponseMessage).
// Tolerante: tenta os nomes prováveis; senão devolve null e o corpo fica em _raw.
export function extractToken(body) {
  if (!body || typeof body !== "object") return "";
  const direct = body.TOKEN ?? body.Token ?? body.token ?? body.Chave ?? body.chave ?? body.Codigo ?? body.codigo;
  if (typeof direct === "string" && direct.length >= 8) return direct;
  for (const value of Object.values(body)) {
    if (value && typeof value === "object") {
      const nested = extractToken(value);
      if (nested) return nested;
    }
  }
  return "";
}
