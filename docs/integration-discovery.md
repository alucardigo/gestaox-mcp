# Descoberta da integração GestãoX

O portal responde em `https://gestaox.example.com` e a página não autenticada é ASP.NET WebForms (`Login.aspx`). A página pública da EMX confirma integração com sistemas externos por APIs, mas não expõe OpenAPI ou rotas.

Para fechar a integração real:

1. Solicitar à EMX a documentação da API do tenant, ambientes de homologação e produção, autenticação, limites, paginação e catálogo de status.
2. Obter usuário técnico de menor privilégio e homologação.
3. No navegador, com autorização, registrar a operação de consultar, comentar e movimentar um chamado usando a aba Network; guardar apenas método, rota, nomes de campos e exemplos anonimizados.
4. Preencher `routes.local.json` fora do repositório.
5. Validar primeiro consultas; depois comentário num chamado de teste; por último movimentação.
6. Confirmar idempotência, auditoria, anexos, encoding, timezone e comportamento de SLA.

Não automatizar o POST de `Login.aspx`, reutilizar senha pessoal ou manter cookie capturado como solução permanente.
