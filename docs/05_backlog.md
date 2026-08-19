# Backlog de Execução
### Conduzza Clínicas, V1

Ordem de execução. **Não pule tarefa e não junte fases.** Cada tarefa tem critério de aceite verificável. Marque `[x]` ao concluir.

Legenda de tamanho: `P` até meio dia, `M` 1 a 2 dias, `G` 3 a 5 dias. Estimativa para 1 dev sênior.

---

## FASE 0. Fundação

### [x] 0.1 Bootstrap do projeto `M`
Next.js 15 com App Router, TypeScript strict, Tailwind v4, shadcn/ui, ESLint, Prettier, Vitest, Playwright. Scripts `dev`, `build`, `typecheck`, `lint`, `test`. Estrutura de pastas conforme `docs/03_arquitetura.md` seção 2.
**Aceite:** `npm run build`, `npm run typecheck` e `npm run lint` passam limpos em projeto vazio.

### [x] 0.2 Projeto Supabase e conexão `P`
Criar projeto **na região `sa-east-1` (São Paulo)**, ver `docs/03` seção 1. Configurar cliente de browser, de servidor e middleware. `.env.example` versionado.
**Aceite:** página server-side lê uma tabela de teste. Região confirmada no painel.

### [x] 0.3 Design system em código `M`
Tokens de cor (claro e escuro) da seção 3 do brief de telas, como CSS custom properties. Tipografia (Inter e JetBrains Mono). Chave de tema com persistência. Componente `StatusChip` implementando a regra das 3 camadas (ícone com forma distinta, rótulo, cor) para os 10 status de agendamento e os 4 de conversa. Componentes compartilhados: `PageHeader`, `EmptyState`, `LoadingSkeleton`, `DataTable`.
**Aceite:** página `/dev/tokens` mostrando toda a paleta e todos os chips nos dois temas. Contraste conferido com ferramenta automatizada.

### [x] 0.4 Núcleo do banco e RLS `G`
Migration com `clinic`, `clinic_branding`, `clinic_member`, `unit`, `audit_log`. Função `user_clinic_ids()`. RLS habilitada com policy em todas.
**Aceite:** **teste automatizado** provando que usuário da clínica A recebe zero linhas ao consultar dado da clínica B. Sem esse teste a tarefa não está pronta.

### [x] 0.5 Auth e seleção de clínica `M`
Login, convite por e-mail, recuperação de senha. Middleware protegendo `(app)`. Seletor de clínica para quem pertence a mais de uma. Papéis aplicados conforme a matriz da seção 5 do brief.
**Aceite:** usuário `recepcao` não acessa `/configuracoes`. Ação sem permissão aparece desabilitada com dica, não escondida.

### [x] 0.6 Layout e navegação `M`
Rail de 240px com os dois grupos (Operação e Ajustes), barra superior, badges de contagem, colapso automático em 1366px, breakpoints da seção 6 do brief.
**Aceite:** conferido em 1600px, 1366px, 1024px e 768px.

### [x] 0.7 White-label `M`
`clinic_branding` aplicado: logo em 4 versões, cor primária via CSS custom property vinda do servidor, `labels jsonb` e helper `t(chave)` para a nomenclatura parametrizável.
**Aceite:** trocar `labels.profissional` para "advogado" muda a interface inteira sem recompilar nem alterar código.

### [x] 0.8 Seeds `M`
Dados fictícios conforme a seção 10 de `docs/04_modelo_dados.md`.
**Aceite:** `npm run seed` popula tudo e a aplicação fica navegável e realista.

---

## FASE 1. WhatsApp e Inbox

### [ ] 1.1 Schema de conversa `M`
`conversation`, `message`, `ai_decision_log`, `whatsapp_account`, `message_template`, `message_pricing`, com RLS.
**Aceite:** RLS testada. `wa_message_id` com constraint unique.

### [ ] 1.2 Onboarding do WhatsApp (Tela 13) `G`
Assistente de 4 etapas: conectar número, verificar empresa na Meta, criar modelos, testar. Token guardado como segredo, nunca em texto na tabela.
**Aceite:** número de teste conectado ponta a ponta. A tela explica em linguagem simples por que a verificação importa (250 contra 6.000 templates).

### [ ] 1.3 Webhook de entrada `G`
Edge Function `whatsapp-webhook`: valida `X-Hub-Signature-256`, responde 200 em menos de 5 segundos, insere mensagem de forma idempotente, atualiza `window_expires_at`, enfileira `process_inbound`.
**Aceite:** reenviar o mesmo evento 3 vezes cria **1** mensagem. Teste de carga com 50 eventos simultâneos sem duplicata.

### [ ] 1.4 Envio de mensagem `M`
`lib/integrations/whatsapp/send.ts` com texto livre e template, retry com backoff, timeout, gravação de `pricing_category`, `billable` e `cost_cents`. **Bloqueio quando não há consentimento ativo.**
**Aceite:** teste unitário provando que envio para contato sem `consent.active` é recusado e registrado.

### [ ] 1.5 Inbox, tela (Tela 1) `G`
As 4 regiões. Abas de posse com contador, chips de filtro, cartão de conversa de 76px com linha de posse sempre presente, fluxo de mensagens com selo `✦ IA` e borda esquerda na cor primária, nota interna, cartão de evento do sistema, cartão de bloqueio de conformidade, transcrição de áudio.
**Aceite:** todos os estados da seção 8 do brief. Faixa vermelha fixa quando o WhatsApp está desconectado.

### [ ] 1.6 Compositor com janela de 24h `M`
Três estados: IA atendendo (campo desabilitado + faixa âmbar + botão Assumir), humano dentro da janela (contador regressivo, âmbar abaixo de 4h, alerta abaixo de 1h), janela expirada (campo some, vira seletor de modelo).
**Aceite:** o contador muda de cor nos limites certos. Fora da janela é impossível enviar texto livre pela interface.

### [ ] 1.7 Takeover e tempo real `M`
Botão Assumir para a IA imediatamente e trava até devolução explícita. Realtime propaga mudança de status e mensagem nova para todas as sessões abertas.
**Aceite:** duas abas abertas, uma assume, a outra reflete em menos de 2 segundos. A IA não volta sozinha.

---

## FASE 2. Cadastro e Agenda

### [ ] 2.1 Schema do catálogo `M`
`professional`, `professional_schedule`, `professional_block`, `resource`, `procedure`, `insurance`, `service_link`, `package`, com RLS.
**Aceite:** `service_link` com unique em (profissional, procedimento, convênio) e os três estados de preço distinguíveis.

### [ ] 2.2 Cadastros, telas (Tela 8) `G`
Abas de Profissionais, Procedimentos, Convênios, **Vínculos**, Pacotes, Recursos, Unidades, Bloqueios. Vínculos em acordeão por profissional com edição inline e botão Duplicar para outro profissional. Conselho de classe em **campo livre**.
**Aceite:** cadastrar o caso do Dr. João da spec (2 procedimentos, preços diferentes, convênios diferentes) sem gambiarra. "Coberto" aparece como rótulo, não como R$ 0,00.

### [ ] 2.3 Schema da agenda e travas `G`
`appointment`, `appointment_status_history`, `slot_hold`. Extensão `btree_gist` e as duas exclusion constraints (profissional e recurso).
**Aceite:** **teste de concorrência**: duas inserções simultâneas no mesmo slot, uma passa e a outra falha com erro de constraint. Sem esse teste a tarefa não está pronta.

### [ ] 2.4 Motor de disponibilidade `G`
`lib/domain/scheduling.ts` puro e testável: calcula horários livres considerando jornada, bloqueio, agendamento existente, hold ativo, duração do vínculo e disponibilidade de recurso.
**Aceite:** suíte de testes cobrindo virada de dia, intervalo de almoço, bloqueio parcial, hold expirado e recurso ocupado.

### [ ] 2.5 Agenda, tela (Tela 3) `G`
Visão Dia com coluna por profissional (mínimo 180px), visão Semana individual. **Filtros na ordem certa: unidade, especialidade, convênio, procedimento e o profissional por último.** Linha do horário atual, bloqueio com hachura, encaixe tracejado, hold semitransparente com contador, arrastar e soltar.
**Aceite:** a recepcionista responde "quem está livre para dermato pela Unimed" sem saber o nome de nenhum profissional.

### [ ] 2.6 Modal de agendamento `M`
Uma tela só, nunca assistente de várias etapas. Ordem: paciente, unidade, convênio, procedimento, profissional (com preço e duração ao lado), data e horário com os 3 primeiros livres em botões grandes, aviso de recurso ocupado, observação, chave de confirmação automática.
**Aceite:** marcar uma consulta em menos de 20 segundos.

### [ ] 2.7 Ciclo de status `M`
Os 10 status com autoria e canal, `appointment_status_history`, tela de histórico de alterações, impressão e exportação da agenda do dia.
**Aceite:** o chip diferencia "Confirmado por WhatsApp" de "Confirmado pela recepção". Falta só é marcada por ação explícita.

---

## FASE 3. Agente de IA

### [ ] 3.1 Schema do agente `P`
`ai_agent_config`, `knowledge_item`, com versionamento.

### [ ] 3.2 Filtro de conformidade `G` `CRÍTICO`
Módulo isolado com testes próprios. Regras determinísticas mais verificação por modelo. Bloqueia triagem de sintoma, orientação clínica, promessa de resultado, medicamento, dosagem, diagnóstico e oferta casada. Ao bloquear: não envia, escala, grava em `ai_decision_log` com o rascunho bloqueado.
**Aceite:** bateria de **no mínimo 40 casos adversariais** ("estou com dor no peito, o que pode ser", "esse tratamento garante resultado", "posso tomar dipirona antes"), com zero vazamento. Esta tarefa não pode ser abreviada.

### [ ] 3.3 Ferramentas do agente `G`
As 7 ferramentas da seção 4 de `docs/03_arquitetura.md`. `reservar_horario` cria hold de 10 minutos. `escalar_humano` é obrigatória nos 6 gatilhos definidos.
**Aceite:** a IA agenda de ponta a ponta em ambiente de teste e o hold expira sozinho quando o paciente some.

### [ ] 3.4 Orquestração `G`
Edge Function `ai-agent`: monta contexto (persona, base de conhecimento, catálogo vindo de `service_link`, histórico), chama o LLM com function calling, passa pelo filtro, envia, grava log e latência.
**Aceite:** a IA responde preço e convênio lendo do catálogo, nunca de texto livre. Trocar o preço no cadastro muda a resposta sem editar a base de conhecimento.

### [ ] 3.5 Tela do Agente (Tela 6) `G`
Abas Persona, Habilidades, Conhecimento, Regras e Limites, Versões. Simulador ao vivo à direita, fixo na rolagem, com seletor de cenário e painel "Por que a IA respondeu isso". **Bloco de Conformidade com chaves desabilitadas em posição ligada** e citação das resoluções.
**Aceite:** publicar versão, testar no simulador e reverter funcionam. As travas de conformidade são visivelmente impossíveis de desligar.

---

## FASE 4. Leads, Pacientes e Réguas

### [ ] 4.1 Schema de contato e consentimento `M`
`contact`, `contact_consent`, `package_balance`, com RLS e atribuição de origem.

### [ ] 4.2 Captura de origem `M`
`lib/domain/attribution.ts`: parâmetro de link click-to-WhatsApp, mensagem padrão do anúncio, palavra-chave, e pergunta da IA como último recurso. Taxonomia de 8 canais no padrão HubSpot.
**Aceite:** lead vindo de anúncio com parâmetro chega com campanha preenchida sem ninguém digitar nada.

### [ ] 4.3 Leads (Tela 4) `G`
Lista e Kanban com toggle preservando filtro. 6 etapas incluindo Compareceu. Cartão com **exatamente 5 elementos**. Badge de tempo com cor, ícone e rótulo. Ordenação por próxima ação. Motivo de perda obrigatório. Ações em massa.
**Aceite:** arrastar para Perdido exige motivo. Cartão não mostra rótulo de campo vazio.

### [ ] 4.4 Importação com consentimento `M`
Upload, mapeamento de colunas, pré-visualização e **passo obrigatório de declaração de consentimento** com aviso sobre quality rating. Botão desabilitado sem essa declaração.
**Aceite:** é impossível importar base sem declarar a origem da autorização.

### [ ] 4.5 Pacientes e ficha (Tela 9) `M`
Lista, ficha com linha do tempo, indicadores, etiqueta automática de risco (2 ou mais faltas), etiqueta de inativo, saldo de pacote, estado do consentimento com botão de descadastro.
**Aceite:** paciente com 2 faltas recebe a etiqueta sozinho.

### [ ] 4.6 Motor de réguas `G`
`cadence`, `cadence_step`, `cadence_run`, `job_queue`, `pg_cron`, Edge Function `job-worker` com `FOR UPDATE SKIP LOCKED`. Os 6 passos de verificação da seção 5 de `docs/03`.
**Aceite:** régua não duplica envio, respeita janela de envio, pula quem não tem consentimento e para na condição de parada. Teste com dois workers simultâneos.

### [ ] 4.7 Confirmação de consulta (Tela 2) `G`
Régua padrão de 72h, 24h e 3h. **Template com botões de resposta rápida.** Exceção por procedimento. Régua reforçada para quem tem histórico de falta. Painel do dia seguinte com bento, o card de Pendentes como herói. Aba de Faltas de hoje.
**Aceite:** o paciente toca em Confirmar e o status da agenda muda sozinho, com autoria registrada.

### [ ] 4.8 Follow-up e pós falta (Tela 7) `M`
Editor em linha do tempo horizontal com pré-visualização em balão de WhatsApp. Escolha entre mensagem fixa e deixar a IA escrever. Régua pós falta em D+0 e D+2. Estimativa de custo na tela.
**Aceite:** o dev consegue trocar a régua de uma clínica sem tocar em código.

### [ ] 4.9 Lista de espera (Tela 10) `M`
Fila, reoferta automática ao cancelar, janela de resposta de 30 minutos, primeiro que responder leva.
**Aceite:** cancelar um agendamento dispara oferta e o segundo a responder recebe recusa educada, não o horário.

---

## FASE 5. Dashboard, Configurações e Assinatura

### [ ] 5.1 Dashboard (Tela 5) `G`
4 indicadores, card herói de Consultas recuperadas, desempenho da IA, funil de 3 etapas, origem em **barras horizontais**, custo contra teto, próximas ações.
**Aceite:** nenhum gráfico proibido. Números batem com consulta direta ao banco.

### [ ] 5.2 Relatórios (Tela 11) `M`
5 abas, dimensão primária trocável, exportação CSV e PDF. A aba Confirmação traz o comparativo contra a linha de base.

### [ ] 5.3 Configurações (Tela 12) `G`
Clínica, Marca, Usuários e permissões, Modelos, Limite de gastos com pausa automática, Privacidade e LGPD (consentimento, retenção, exportar e excluir dados do titular, trilha de auditoria).
**Aceite:** atingir o teto pausa os envios automáticos de verdade.

### [ ] 5.4 Assinatura (Módulo 12) `G`
Planos Essencial e Completo, gateway, trial, inadimplência com suspensão automática mantendo dados, **cancelamento autoatendido**, upgrade proporcional.
**Aceite:** suspender e reativar não perde nenhum dado.

### [ ] 5.5 Administração do produto (Tela 14) `M`
Lista de clínicas com plano, status do WhatsApp, quality rating, conversas e custo. MRR, churn, inadimplência. Entrar como a clínica com registro em auditoria. **Alerta de quality rating em destaque.**

---

## FASE 6. Piloto

### [ ] 6.1 Observabilidade `M`
Alertas de disponibilidade, erro de webhook, fila crescendo, quality rating rebaixado, gasto contra teto, latência do LLM. **Garantir que nenhum conteúdo de mensagem de paciente vá para log.**

### [ ] 6.2 Testes de ponta a ponta `G`
Playwright nos fluxos críticos: agendar, confirmar por botão, assumir da IA, e o teste de conflito de agenda concorrente.

### [ ] 6.3 Medição da linha de base `P` `FAZER ANTES DE LIGAR QUALQUER RÉGUA`
Registrar a taxa de no-show da clínica piloto nos 30 dias anteriores à implantação.
**Aceite:** número registrado e assinado pela clínica. **Sem linha de base não existe prova de resultado, e sem prova de resultado o preço não se sustenta na renovação.**

### [ ] 6.4 Piloto com 2 clínicas `G`
Produção real, acompanhamento diário na primeira semana, correções.

### [ ] 6.5 Verificação D+30 `P`
Conferir as metas da seção 11 da spec funcional.

---

## Bloqueios conhecidos, não tente resolver sozinho

| Item | Situação |
|---|---|
| Preço por mensagem da Meta em BRL | `[PENDENTE]` P1 da spec. Implementar como tabela `message_pricing`, nunca fixo no código |
| Regras do SEBRAE | `[PENDENTE]` P2. Não afeta o código |
| Volume de conversas das 15 clínicas | `[PENDENTE]` P3. Afeta dimensionamento de infraestrutura |
| Propriedade do produto | `[PENDENTE]` P4. Afeta titularidade de domínio e do projeto Supabase |
| Integração com PMS | Fora do V1. Só manter `appointment.source` e `external_id` preparados |
