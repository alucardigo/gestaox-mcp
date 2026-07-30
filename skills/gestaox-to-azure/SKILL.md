---
name: gestaox-to-azure
description: Transformar um chamado GestãoX/EMX em work item do Azure DevOps, verificando duplicidade, definindo nível correto, vinculando origem e mantendo rastreabilidade. Usar quando o usuário pedir ticket, card, task, projeto, demanda ou registro no ADO a partir de um chamado de atendimento.
---

# GestãoX para Azure DevOps

## Fluxo obrigatório

1. Ler o chamado com `gestaox_get_ticket` e analisar com `gestaox_analyze_ticket`.
2. Usar `gestaox_prepare_azure_ticket` para gerar a prévia e o termo `duplicateSearch`.
3. Carregar e seguir `azure-devops-ticket-standard`.
4. Consultar o projeto `Produtos Digitais` por tag, título e ID do GestãoX antes de criar.
5. Escolher o nível:
   - `Task` para correção ou ação granular com um responsável.
   - `Projetos` apenas para iniciativa nova com JTBD e objetivos fornecidos pelo usuário.
   - `Milestone` somente dentro da hierarquia oficial.
6. Mostrar tipo, título, descrição, pai, área, iteração, responsável e tags.
7. Criar somente após confirmação explícita do usuário.
8. Adicionar ao chamado GestãoX o ID e a URL do ADO somente após a criação confirmada.

## Regras

- Preservar `GestãoX-<id>` nas tags e o link de origem na descrição.
- Não copiar anexos, CPF, credenciais, conversas pessoais ou dados sem necessidade.
- Não marcar `Done` nem fechar o chamado só porque o work item foi criado.
- Se já existir item para o chamado, atualizar ou comentar o existente em vez de duplicar.
- Se faltarem Como, Quero e Para para `Projetos`, pedir ao usuário; não inventar motivação de negócio.
- Ler [mapeamento](references/mapping.md) quando houver dúvida de tipo ou campos.
