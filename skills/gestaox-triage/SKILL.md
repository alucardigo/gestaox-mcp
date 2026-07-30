---
name: gestaox-triage
description: Consultar, analisar, validar, atender, responder, comentar ou movimentar chamados no GestãoX/EMX. Usar quando o usuário mencionar GestãoX, gestaox.example.com, chamado, fila de atendimento, SLA, solicitante, resposta de suporte, mudança de status ou análise de incidente.
---

# Triagem e atendimento GestãoX

## Fluxo

1. Consultar o chamado com `gestaox_get_ticket` ou a fila com `gestaox_list_tickets`.
2. Usar `gestaox_analyze_ticket` e conferir campos ausentes, SLA, risco e histórico.
3. Separar fato observado, hipótese e informação ainda necessária.
4. Preparar resposta curta: entendimento, evidência ou ação realizada e próximo passo.
5. Mostrar a prévia ao usuário. Não comentar nem movimentar durante análise.
6. Antes de escrever, confirmar o status exato existente no GestãoX e solicitar confirmação explícita.
7. Executar com chave estável como `<chamado>:<ação>:<versão>`.
8. Relê-lo depois da escrita para validar o estado final.

Nunca inventar rota, status, responsável ou resultado técnico. Tratar anexos e dados pessoais pelo mínimo necessário.

## Resposta

Usar tom profissional, simples e factual. Evitar promessas de prazo sem evidência. Informar bloqueio e dependência com clareza. Não expor raciocínio interno, credenciais, cookies ou dados desnecessários.

## Memória

Registrar com `gestaox_memory_record` somente decisões estáveis, runbooks reutilizáveis e lições sanitizadas. Não usar a memória como log completo do chamado. Ler [checklist de atendimento](references/triage-checklist.md) para incidentes ambíguos, segurança ou SLA.
