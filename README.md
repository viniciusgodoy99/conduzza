# Conduzza Clínicas

SaaS multi-tenant de atendimento com IA para clínicas médicas e de estética. Uma recepcionista digital que trabalha 24 horas no WhatsApp, agenda, confirma consulta e devolve consulta perdida em dinheiro.

Documentação de produto e handoff de engenharia do V1.

---

## Comece por aqui

**Abra o Claude Code nesta pasta e cole o conteúdo de `PROMPT_INICIAL.md`.** Ele já diz ao Claude Code o que ler, em que ordem, e qual é a primeira tarefa.

---

## Como rodar: o motor roda sozinho (ver supabase/operacao/motor-por-cron.md)

```bash
npm run dev      # a aplicação
npm run worker   # o motor de automação, em outro terminal
```

Em produção, `npm run build && npm start` mais `npm run worker`, este último **com supervisão e reinício automático** (systemd, pm2 ou equivalente).

**Não existe `pg_cron` neste projeto.** O worker é o único executor de tudo que é automático: planejamento e envio das réguas de confirmação e pós falta, o botão "Cobrar agora", o download de mídia que o paciente manda e a limpeza das reservas de horário. Com ele fora do ar a aplicação abre, a agenda funciona e **nenhuma mensagem sai nem entra na automação**. Quando isso acontece, o sistema mostra a faixa "as mensagens automáticas estão paradas" no topo de todas as telas.

Para conferir que a corrente inteira está funcionando (planejamento, envio, webhook, resposta do paciente, pós falta), com os dois processos de pé:

```bash
npm run prova:motor
```

Ele cria uma clínica descartável com canal de mentira, exercita o caminho completo contra o banco e o webhook reais, e apaga tudo no fim. Nenhum paciente de verdade é tocado.

O canal WhatsApp precisa de um endereço público estável em `PUBLIC_APP_URL`: é ele que o provedor chama de volta com as respostas dos pacientes, e ele fica **gravado no momento da conexão**. Trocar a variável não basta, é preciso reconectar o número. Detalhes em `.env.example`.

---

## Estrutura

```
conduzza/
├── CLAUDE.md                 regras permanentes do projeto, lidas pelo Claude Code em toda sessão
├── PROMPT_INICIAL.md         o texto para colar na primeira mensagem
├── .env.example              variáveis de ambiente
├── README.md                 este arquivo
└── docs/
    ├── 01_spec_funcional_conduzza_clinicas.md   spec, escopo V1 e V2, alerta comercial, cronograma
    ├── 02_brief_telas_claude_design.md          14 telas, paleta validada, componentes e estados
    ├── 03_arquitetura.md                        stack, pastas, fluxos, RLS, concorrência de agenda
    ├── 04_modelo_dados.md                       schema SQL de referência
    ├── 05_backlog.md                            tarefas em ordem, com critério de aceite
    └── benchmarks/                              pesquisa de origem, com URL em cada afirmação
```

## Por onde cada pessoa começa

| Se você é | Leia |
|---|---|
| Desenvolvedor | `CLAUDE.md`, depois `docs/03`, `docs/04` e `docs/05` |
| Designer | `docs/02`. É autocontido, dá para colar no Claude Design |
| Sócio ou decisor | `docs/01`, seções 1 (Ficha de Entrega), 2 (benchmark) e **3 (alerta comercial)** |

---

## As cinco regras que não se negociam

1. **RLS em toda tabela.** Isolamento entre clínicas vive no Postgres, não no código da aplicação. Dado de saúde é dado sensível na LGPD.
2. **O agente de IA não faz triagem de sintoma nem promete resultado.** Filtro na saída do modelo, não instrução de prompt. Resoluções CFM 2.314/2022 e 2.336/2023.
3. **Conflito de agenda é impedido pelo banco**, com exclusion constraint. Checagem em código perde a corrida entre a IA e a recepcionista.
4. **Nunca disparar para contato sem consentimento ativo.** Derruba o quality rating do número e trava os envios da clínica inteira.
5. **Nenhum travessão em texto de interface e nenhum dado de paciente em log.**

---

## Decisões já tomadas

| Decisão | Valor |
|---|---|
| Corte do V1 | MVP fechado, agenda própria, sem integração com sistema de gestão |
| Stack | Next.js 15 + TypeScript + Tailwind + shadcn/ui + Supabase |
| Região do banco | `sa-east-1` (São Paulo), para remover a discussão de transferência internacional |
| Preço | R$ 597 (Essencial) e R$ 897 (Completo), por clínica, usuários ilimitados |
| Visual | Claro por padrão, escuro obrigatório (decisão de 19/08/2026, revisando o brief) |
| Arquitetura | Nasce clínicas, com white-label e nomenclatura parametrizados desde o dia 1 |
| Ordem de integração (V2) | Feegow, depois Ninsaúde e Shosp, iClinic por último e só com acordo com a Afya |
| Prazo estimado | 21 semanas do design ao piloto medido, com 1 dev em tempo integral |

## Três decisões travadas (seção 3 da spec)

- **D1** Quem é dono do produto: Conduzza com desenvolvimento terceirizado, ou co-propriedade com divisão de receita
- **D2** O que exatamente o SEBRAE cobre, com o edital ou termo de aprovação em mãos
- **D3** Meta de clientes externos no mês 12

**A conta não fecha em 15 clientes.** No cenário otimista (15 de 15 adotando a R$ 897) são R$ 13.455 de MRR contra um time mínimo de R$ 15.000. São necessárias entre 17 e 26 clínicas só para empatar, sem contar custo variável. A memória de cálculo está na seção 3 da spec.

## Quatro pendências de dado (seção 10 da spec)

- **P1** Preço por mensagem da Meta no Brasil em BRL, mais custo de LLM por conversa
- **P2** Regras do SEBRAE: percentual, teto, escopo elegível, credenciamento do prestador
- **P3** Volume atual de conversas das 15 clínicas
- **P4** Decisão D1 em aberto

Nenhuma delas bloqueia o código. Todas viram configuração, nunca valor fixo.

---

## Régua de confiança

Os documentos usam três marcações:

- `[FONTE]` sustentado por benchmark com URL em `docs/benchmarks/`
- `[PREMISSA]` hipótese de trabalho sem fonte externa, a validar
- `[PENDENTE]` dado necessário ainda não levantado

Todo número tem memória de cálculo aberta. O que não tem fonte está marcado, não escondido.
