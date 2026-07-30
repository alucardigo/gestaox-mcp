# Memória operacional

- O ambiente usa `https://gestaox.example.com`.
- A entrada pública observada em 2026-07-29 é ASP.NET WebForms com `Login.aspx`.
- Contrato REAL obtido em 2026-07-29 via `/API/Help` (ASP.NET Web API 2, 191 endpoints). Ver `docs/api-contract.md`.
- Auth: login GET `api/usuario/EfetuarLoginInterno?email&senha`; token no campo `TOKEN`; erro = 500 `"TOKEN INVÁLIDO!"`.
- BLOQUEIO: a conta `atendente` faz login (200) mas o campo `TOKEN` volta vazio → API de chamados não liberada. Depende de a EMX habilitar token de integração ou fornecer usuário de integração (GESTAOX_TOKEN). Até lá o plugin roda em `mock`.
- Toda escrita remota exige prévia, confirmação e chave de idempotência.
- GestãoX é a origem do chamado; Azure DevOps recebe um vínculo com o ID e a URL do chamado, sem copiar anexos ou dados pessoais desnecessários.
- Registrar aqui somente decisões estáveis e sanitizadas. Nunca registrar senha, token, cookie, código 2FA ou conteúdo pessoal de chamado.
