import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Sessão de navegador reutilizável contra o GestãoX.
//
// Por que assim: o GestãoX é WebForms + Telerik (ViewState de ~190 KB, EventValidation).
// Replay de postback headless quebra a cada atualização do fornecedor. Dirigir a UI real
// é o único caminho estável que não depende de liberação de API pela EMX.
//
// Autenticação: você loga uma vez (`npm run login`) e a sessão é reaproveitada.
// O plugin NUNCA guarda senha em arquivo nem no código.
//
// Pegadinha confirmada em 2026-07-29: o GestãoX usa cookie de sessão NÃO-PERSISTENTE
// (ASP.NET). O perfil do Chrome sozinho não basta — o cookie é descartado quando o
// navegador fecha. Por isso os cookies são capturados com o contexto ainda vivo e
// re-injetados nas execuções seguintes.

const LOGIN_PATH = "/Login.aspx";

export class BrowserSession {
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = null;
  }

  static fromEnv(env = process.env) {
    return new BrowserSession({
      baseUrl: (env.GESTAOX_WEB_URL || "https://gestaox.example.com").replace(/\/$/, ""),
      profileDir: env.GESTAOX_PROFILE_DIR ||
        `${env.LOCALAPPDATA || env.HOME}\\gestaox-atendimento\\browser-profile`,
      sessionFile: env.GESTAOX_SESSION_FILE ||
        join(env.GESTAOX_DATA_DIR || `${env.LOCALAPPDATA || env.HOME}\\gestaox-atendimento`, "session.json"),
      headless: env.GESTAOX_HEADLESS !== "false",
      timeout: Number(env.GESTAOX_TIMEOUT_MS || 30000)
    });
  }

  async context() {
    if (this.ctx) return this.ctx;
    this.ctx = await chromium.launchPersistentContext(this.cfg.profileDir, {
      channel: "chrome",
      headless: this.cfg.headless,
      viewport: { width: 1600, height: 1000 }
    });
    this.ctx.setDefaultTimeout(this.cfg.timeout);
    await this.restoreCookies();
    return this.ctx;
  }

  // Cookie de sessão do ASP.NET não sobrevive ao fechamento do navegador,
  // então ele é gravado explicitamente enquanto o contexto está vivo.
  async saveCookies(ctx) {
    const cookies = await ctx.cookies(this.cfg.baseUrl);
    await mkdir(dirname(this.cfg.sessionFile), { recursive: true });
    await writeFile(this.cfg.sessionFile, JSON.stringify(cookies), { encoding: "utf8", mode: 0o600 });
    return cookies.length;
  }

  async restoreCookies() {
    try {
      const cookies = JSON.parse(await readFile(this.cfg.sessionFile, "utf8"));
      if (Array.isArray(cookies) && cookies.length) await this.ctx.addCookies(cookies);
    } catch {
      // sem sessão salva: open() cai no Login.aspx e orienta o usuário.
    }
  }

  // Abre uma página garantindo que a sessão está viva.
  // Se cair no Login.aspx, falha com instrução clara em vez de tentar adivinhar credencial.
  async open(path) {
    const ctx = await this.context();
    const page = await ctx.newPage();
    await page.goto(`${this.cfg.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    if (page.url().includes(LOGIN_PATH)) {
      await page.close();
      throw new SessionExpiredError(
        "Sessão do GestãoX expirada ou perfil sem login. Rode `npm run login` no diretório server/ " +
        "para autenticar uma vez neste perfil; a sessão fica salva e o plugin volta a operar."
      );
    }
    return page;
  }

  async isAuthenticated() {
    try {
      const page = await this.open("/Paginas/Portal");
      await page.close();
      return true;
    } catch (error) {
      if (error instanceof SessionExpiredError) return false;
      throw error;
    }
  }

  // Abre o navegador visível para o login manual e espera você concluir.
  async interactiveLogin() {
    const ctx = await chromium.launchPersistentContext(this.cfg.profileDir, {
      channel: "chrome",
      headless: false,
      viewport: { width: 1400, height: 900 }
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(`${this.cfg.baseUrl}${LOGIN_PATH}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => !String(url).includes(LOGIN_PATH), { timeout: 5 * 60 * 1000 });
    await page.waitForTimeout(1500); // deixa o portal assentar antes de capturar
    const saved = await this.saveCookies(ctx);
    await ctx.close();
    return { ok: true, profileDir: this.cfg.profileDir, sessionFile: this.cfg.sessionFile, cookies: saved };
  }

  async close() {
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }
}

export class SessionExpiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionExpiredError";
    this.code = "SESSION_EXPIRED";
  }
}
