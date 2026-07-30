# Configuração

## Modo mock

É o padrão do plugin e funciona sem credenciais:

```text
GESTAOX_BACKEND=mock
```

## Modo HTTP

Defina as variáveis no ambiente do MCP, nunca em arquivos versionados:

```text
GESTAOX_BACKEND=http
GESTAOX_BASE_URL=https://gestaox.example.com
GESTAOX_AUTH_HEADER=Authorization
GESTAOX_API_TOKEN=<segredo no cofre>
GESTAOX_ROUTES_FILE=C:\caminho\seguro\routes.local.json
```

Formato do arquivo de rotas:

```json
{
  "list": {"method": "GET", "path": "/api/chamados"},
  "get": {"method": "GET", "path": "/api/chamados/{id}"},
  "comment": {"method": "POST", "path": "/api/chamados/{id}/comentarios"},
  "move": {"method": "POST", "path": "/api/chamados/{id}/movimentacoes"}
}
```

Os nomes e caminhos acima são apenas o formato esperado, não rotas confirmadas do GestãoX. Substitua-os pelo contrato fornecido pela EMX ou por rotas observadas numa sessão autorizada.

Cookies de sessão não devem ser gravados no repositório ou na memória. Prefira token/API oficial. Se o ambiente oferecer apenas WebForms autenticado, solicite à EMX um usuário técnico e o contrato de integração antes de automatizar escritas.
