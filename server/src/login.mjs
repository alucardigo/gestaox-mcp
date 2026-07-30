// Login manual, uma vez por perfil. Uso: npm run login
// Abre o Chrome visível na tela de login do GestãoX e espera você autenticar.
// A senha é digitada por você, no navegador — nunca passa pelo plugin.
import { BrowserSession } from "./browser-session.mjs";

const session = BrowserSession.fromEnv();
console.log("Abrindo o GestãoX para login manual...");
console.log(`Perfil: ${session.cfg.profileDir}`);
const result = await session.interactiveLogin();
console.log(`Login concluído. ${result.cookies} cookie(s) de sessão salvos em: ${result.sessionFile}`);
if (!result.cookies) {
  console.error("ATENÇÃO: nenhum cookie capturado — o login pode não ter concluído.");
  process.exit(1);
}
