# Prompt inicial para o Claude Code

Abra o Claude Code dentro da pasta `conduzza` e cole o bloco abaixo como primeira mensagem. Copie a partir da linha de traços.

---

```
Você vai construir o Conduzza Clínicas, um SaaS multi-tenant que coloca uma recepcionista de IA no WhatsApp de clínicas médicas e de estética.

Antes de escrever qualquer linha de código, leia nesta ordem:

1. CLAUDE.md               as regras permanentes do projeto. Elas têm precedência sobre qualquer suposição sua.
2. docs/03_arquitetura.md  stack, estrutura de pastas, fluxos e decisões técnicas já tomadas.
3. docs/04_modelo_dados.md o schema de referência do Postgres.
4. docs/05_backlog.md      as tarefas em ordem de execução.

Leia docs/01_spec_funcional_conduzza_clinicas.md quando for implementar um módulo específico, e docs/02_brief_telas_claude_design.md antes de construir qualquer tela. Não leia docs/benchmarks/ agora, é material de pesquisa.

Stack já decidida, não trocar: Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui, Supabase (Postgres com RLS, Auth, Realtime, Storage, Edge Functions), TanStack Query, react-hook-form com Zod, Lucide, date-fns em pt-BR.

Sua primeira tarefa é a FASE 0 do backlog, tarefas 0.1 a 0.8. Comece pela 0.1.

Antes de começar, faça três coisas:

1. Leia os quatro arquivos acima e me diga em no máximo 10 linhas o que você entendeu que é o produto, quais são as três regras que você não pode violar em hipótese alguma, e qual é a primeira tarefa.
2. Aponte qualquer contradição que você encontrar entre os documentos. Não escolha um lado sozinho, me pergunte.
3. Me mostre o plano da tarefa 0.1 e espere eu confirmar antes de criar arquivo.

Regras de trabalho, resumindo o que está no CLAUDE.md:

- Não invente escopo. Se não está na spec ou no backlog, pergunte antes de construir.
- Não invente dado. Se falta um número, pare e pergunte. Não preencha com valor plausível.
- Toda tabela de negócio tem clinic_id e RLS ligada, sem exceção. Isolamento de tenant vive no banco, não no código da aplicação.
- Conflito de horário na agenda é impedido por exclusion constraint no Postgres, não por checagem no código.
- O agente de IA nunca pode triar sintoma, prometer resultado, indicar medicamento ou fazer oferta casada. Isso é filtro na saída do modelo, não instrução de prompt.
- Nunca disparar mensagem para contato sem consentimento ativo.
- Nenhum travessão em texto de interface.
- Nenhum dado de paciente em log.

Se eu pedir algo que quebra uma dessas regras, me avise antes de fazer.
```

---

## Depois da Fase 0

A cada fase concluída, use este prompt de continuação:

```
Fase [N] concluída. Rode a checklist de definição de pronto do CLAUDE.md seção 6 e me mostre o resultado item por item, com a prova de cada um. Depois me mostre o plano da Fase [N+1] antes de começar.
```

## Quando o contexto encher

Sessão longa perde contexto. Quando notar o Claude Code esquecendo regra, mande:

```
Releia CLAUDE.md e docs/05_backlog.md. Me diga em que tarefa estamos, o que já está pronto e o que falta na fase atual.
```

## O que NÃO pedir para o Claude Code

- Integração com iClinic, Feegow ou qualquer outro sistema de gestão. Está fora do V1 por decisão documentada. Só o campo `appointment.source` fica preparado.
- Prontuário eletrônico. Está fora de escopo de propósito, ver spec seção 4, módulo 6.10.
- Prometer taxa de automação acima de 55% no terceiro mês. O estado da arte mundial é 57% a 70% e não vamos estrear no topo.

## Se ele travar em alguma pendência

Quatro dados ainda não existem e estão marcados no backlog. Se o Claude Code parar por causa de um deles, a resposta é sempre a mesma: **implemente como configuração, não como valor fixo no código, e siga em frente.**

| Pendência | O que fazer |
|---|---|
| Preço por mensagem da Meta em BRL | Tabela `message_pricing`, populada depois |
| Regras do SEBRAE | Não afeta o código, ignorar |
| Volume de conversas das clínicas | Não afeta o código, afeta dimensionamento |
| Quem é dono do produto | Afeta titularidade do domínio e do projeto Supabase, não o código |
