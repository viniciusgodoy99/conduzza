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

> **Mudança de rumo (19/08/2026):** canal inicial via **uazapi** (não oficial) com camada adaptadora; migração futura para a Cloud API oficial vira configuração. Ver CLAUDE.md 3.3. A tarefa 1.2 muda de "onboarding Meta" para "camada de canal + conexão por QR"; janela de 24h e templates ficam atrás de `isOfficialChannel`.

### [x] 1.1 Schema de conversa `M`
`conversation`, `message`, `ai_decision_log`, `whatsapp_account`, `message_template`, `message_pricing`, com RLS.
**Aceite:** RLS testada. `wa_message_id` com constraint unique.

### [x] 1.2 Onboarding do WhatsApp (Tela 13) `G`
Assistente de 4 etapas: conectar número, verificar empresa na Meta, criar modelos, testar. Token guardado como segredo, nunca em texto na tabela.
**Aceite:** número de teste conectado ponta a ponta. A tela explica em linguagem simples por que a verificação importa (250 contra 6.000 templates).

### [x] 1.3 Webhook de entrada `G`
Edge Function `whatsapp-webhook`: valida `X-Hub-Signature-256`, responde 200 em menos de 5 segundos, insere mensagem de forma idempotente, atualiza `window_expires_at`, enfileira `process_inbound`.
**Aceite:** reenviar o mesmo evento 3 vezes cria **1** mensagem. Teste de carga com 50 eventos simultâneos sem duplicata.

### [x] 1.4 Envio de mensagem `M`
`lib/integrations/whatsapp/send.ts` com texto livre e template, retry com backoff, timeout, gravação de `pricing_category`, `billable` e `cost_cents`. **Bloqueio quando não há consentimento ativo.**
**Aceite:** teste unitário provando que envio para contato sem `consent.active` é recusado e registrado.

### [x] 1.5 Inbox, tela (Tela 1) `G`
As 4 regiões. Abas de posse com contador, chips de filtro, cartão de conversa de 76px com linha de posse sempre presente, fluxo de mensagens com selo `✦ IA` e borda esquerda na cor primária, nota interna, cartão de evento do sistema, cartão de bloqueio de conformidade, transcrição de áudio.
**Aceite:** todos os estados da seção 8 do brief. Faixa vermelha fixa quando o WhatsApp está desconectado.

### [x] 1.6 Compositor com janela de 24h `M`
Três estados: IA atendendo (campo desabilitado + faixa âmbar + botão Assumir), humano dentro da janela (contador regressivo, âmbar abaixo de 4h, alerta abaixo de 1h), janela expirada (campo some, vira seletor de modelo).
**Aceite:** o contador muda de cor nos limites certos. Fora da janela é impossível enviar texto livre pela interface.

### [x] 1.7 Takeover e tempo real `M`
Botão Assumir para a IA imediatamente e trava até devolução explícita. Realtime propaga mudança de status e mensagem nova para todas as sessões abertas.
**Aceite:** duas abas abertas, uma assume, a outra reflete em menos de 2 segundos. A IA não volta sozinha.

---

---

## ESCOPO ACRESCENTADO (fora do backlog original)

### [x] Cadastro self-service de clínicas `G`
Decisão do dono em 20/08/2026, no modelo do projeto `mdrepresentacoes`. Cadastro público com bifurcação: criar a clínica (vira administradora) ou pedir entrada com o código da clínica. Gatilho no banco cria clínica, marca e vínculo numa transação. Quem entra por código nasce **pendente** e não vê dado de paciente até a liberação. Código rotacionável e desligável; convite por e-mail mantido.
**Aceite:** provado por `npx tsx scripts/dev/prova-de-fluxo.ts` (17 verificações contra o banco real) e por 12 testes de RLS.

### [x] Painel de aprovação de encaixe da IA `P`
Decisão do dono em 24/08/2026, resolvendo a contradição entre o handoff (que desenhava o fluxo) e a spec (que não o previa): `appointment` ganhou `created_by` e `approval_status`, e a Agenda ganhou o painel "Pendente de você" com Aprovar/Recusar. Nasce funcional (vazio) e a Fase 3 passa a criar encaixes por ele.

### [x] Criação de clínica pelo dono do produto `P`
O super administrador precisava poder criar a primeira clínica, senão o produto era inutilizável para ele. Versão mínima da Tela 14 (tarefa 5.5).

### [x] Equipe, papéis e WhatsApp em Configurações `M`
Decisão do dono em 25/08/2026: as abas de **WhatsApp** e **Papéis** foram antecipadas da tarefa 5.3, porque conectar o número e ajustar quem faz o quê não podia esperar a Fase 5. Junto vieram três mudanças de regra: (1) **gestor** passa a gerenciar equipe, papéis e conexão do WhatsApp, divergência consciente do brief `docs/02` seção 5, onde a célula Configurações/Gestor era somente ver; (2) **tirar acesso desativa o vínculo** (`status = 'inativo'`), reversível, em vez de apagar, para preservar o histórico; (3) travas novas no banco, não só na tela: gestor não cria, altera, remove nem desativa quem tem papel de administrador, e a clínica nunca fica sem administrador ativo.
**Aceite:** o gestor não consegue se promover por triangulação e o último administrador não consegue se remover, provado contra o banco, não por inspeção da tela.

### [x] Atendimento: mídia, ordem da fila, citar e apagar `G`
Pedido do dono em 01/09/2026, em cinco partes. O mapeamento revelou que uma delas era mais grave do que parecia: **quando um paciente mandava foto ou documento, a clínica via uma bolha vazia.** O arquivo era baixado e guardado certo, mas nada no sistema sabia transformá-lo em algo exibível. Responder citando e apagar não existiam de forma alguma (sem coluna, sem método no provedor, sem policy).

Entregue em oito fases, cada uma um commit fechado:

1. **Balde fechado.** Policy em `storage.objects` amarrando o caminho `clinic_id/message_id` à mensagem que o usuário pode ler. Assinar a URL com service role seria filtrar a clínica no `if` do TypeScript, o que a regra 3.1 proíbe: a rota assina com o **cliente de sessão**, e quem decide é o Postgres. O recorte do papel `profissional` vale de graça, porque a policy do balde consulta `message`.
2. **Bolha honesta.** Imagem, documento e vídeo passam a dizer o que são, com ícone, rótulo e cor.
3. **Ordem da fila.** Coluna `last_inbound_at`, escrita só no recebimento. `last_message_at` sobe também quando a clínica responde, e era isso que jogava a conversa respondida para o topo.
4. **Metadados da mídia**, que chegavam e eram descartados.
5. **Ver de verdade.** Rota de mídia com auditoria **bloqueante** (arquivo de paciente sem registro de quem abriu é pior que arquivo indisponível), miniatura, player de áudio e cartão de documento.
6. **Enviar mídia**, incluindo arrastar e soltar e gravação de nota de voz. O `/send/media` do uazapi quer **base64, não URL pública**, o que foi descoberto contra a instância real: a alternativa obrigaria a expor foto de paciente publicamente.
7. **Responder citando.** Duas colunas, porque existe caso em que a citada nunca virou linha nossa (mensagem anterior à conexão, ou perdida pelo webhook).
8. **Apagar**, em dois escopos. Prazo de 60 horas, que é o do WhatsApp. Apaga quem escreveu, mais administrador e gestor, nunca `leitura`. O conteúdo vai para a tabela cofre `message_apagada` e a linha viva fica com o corpo **anulado**: `message` está publicada no tempo real, e deixar o texto faria o apagamento empurrar por websocket para todas as abas o que alguém acabou de apagar.

**Revisão adversarial (03/09/2026):** 10 lentes independentes sobre o commit, cada achado passando por 2 céticos encarregados de refutá-lo. 66 achados brutos, 26 sobreviveram, ~15 defeitos distintos, todos corrigidos. Os dois graves:

1. **Uma nota interna podia sair para o paciente.** O plano do compositor era derivado da citação enquanto `mode` ficava parado por baixo: citar uma nota ligava o modo âmbar, a pessoa escrevia, cancelava a citação com Escape, e o compositor voltava para Responder **com o texto intacto**. Mesma família do defeito fatal do anexo: dois estados que precisam concordar morando em componentes diferentes. Agora o plano mora junto da citação, e quem escolhe uma escolhe a outra no mesmo gesto.
2. **Mídia revogada pelo paciente era baixada depois e guardada para sempre.** O download é enfileirado na chegada e roda em outro processo; o worker não olhava `deleted_at`, então os bytes que o paciente revogou eram gravados no acervo e `media_url` voltava para a linha recém-anulada. Corrigido nas duas pontas (antes de baixar, e no update final com `is deleted_at null`).

Os demais, resumidos: o eco do nosso próprio apagamento era registrado como "o paciente apagou" (o provedor avisa todo mundo, e ninguém revoga mensagem alheia: agora a direção decide); apagar "só aqui" era beco sem saída, sem caminho para depois tirar do celular do paciente; a citação do paciente a uma conversa anterior era descartada e a bolha afirmava algo falso; falha ao registrar o apagamento respondia 200 e nunca era reconciliada; a dica de ação sem permissão era inalcançável (item desabilitado não dispara tooltip nem recebe foco), contra a regra 5; o menu de ações ficava invisível em tablet (o guarda era largura, não ponteiro); a explicação de por que "apagar para todos" não cabe tinha contraste 2,3:1; trocar para a aba de nota descartava o anexo em silêncio; a lápide de nota interna dizia "o paciente ainda vê".

**Fica em aberto:** a prévia da última mensagem no cartão da conversa (o cartão ainda repete "Lead, Novo contato" em vez do trecho, como o brief pede).

**Aceite:** 6 testes de isolamento do acervo de mídia e 14 das regras de apagar, todos chamando a RPC pela sessão, sem passar pela tela. O canal real foi provado por `npx tsx scripts/dev/prova-de-midia.mts` e `prova-de-citar-e-apagar.mts`, que mandam para o próprio número da instância.

### [ ] Resultados: atribuição Meta e retorno de conversão `G` (em andamento)
Frente nova decidida pelo dono em 08/09/2026 para **substituir o Tintim** (Caminho B do `docs/06_resultados_atribuicao_e_retorno_meta.md`, que é o plano da frente; `docs/07` é o critério de leitura da captura). Feito até aqui: tela de Resultados v1 (indicadores, funil, origem por canal), a **estrutura de captura do `ctwa_clid`** (colunas em `contact`, extração defensiva no parser, primeiro clique vence, provada por 5 testes de unidade e 2 de integração), o **R2** (virou a tela Jornada, entrada abaixo) e, em 09/09/2026, **R3+R4+R6 construídos com o envio desligado**: gatilho registra `conversion_event` no movimento do funil (uma conversão por contato por etapa, valor fixo ou do agendamento), adaptador `lib/integrations/meta/` (formato business_messaging confirmado na doc, telefone só hasheado), job `enviar_conversao_meta` no motor, aba "Anúncios da Meta" (token write-only na tabela-secret) e o painel "Conversões devolvidas à Meta" em Resultados. **O envio só liga com a decisão D6 (LGPD) + credenciais do dono**; até lá tudo fica em `registrado`. Falta: D6, credenciais e a validação com `test_event_code` no Gerenciador de Eventos. O R5 (período, tabela por campanha, exportação) fechou em 18/09/2026 com as tarefas 5.1 e 5.2. **Tintim segue ligado até a captura provar que enche.**

### [x] Jornada configurável da clínica `G` (09/09/2026)
Decisão do dono, fora do backlog original: "preciso que seja tudo configurável, para realmente ser escalável", no modelo da Jornada de Compra do Tintim. As etapas do funil viraram dados por clínica (`funnel_stage_def`), com **papéis de sistema** (`entrada`, `agendou`, `compareceu`, `perdido`) garantidos em toda jornada por gatilho (semeadura na criação da clínica, chave e papel imutáveis, etapa de sistema indelével, etapa ocupada não se exclui), então os literais das chaves de sistema seguem seguros no código. `contact.funnel_stage` continua texto, validado por gatilho (23514 preservado como contrato). A tela **Jornada e conversões** (Configurações) absorveu a aba Conversões: renomear, reordenar, criar etapa própria, termos-chave e os campos de conversão da Meta num formulário só; `funnel_conversion_map` caiu (migration 20260909130000). **Termo-chave** move o contato de etapa quando a mensagem do paciente contém um termo configurado: mais longo vence (como na atribuição), só para frente na jornada, nunca sai de nem entra na perda, guardado contra mensagens simultâneas e auditado como movimento de sistema.
**Aceite:** 14 testes de RLS e estrutura (`tests/rls/jornada.test.ts`, contra o banco remoto), 11 de unidade da decisão por termo (`jornada-termo.test.ts`) e os de agrupamento do Kanban com jornada própria (`leads-ui.test.ts`). Kanban, filtros, drawer, Inbox e Resultados leem a jornada da clínica, não mais um dicionário fixo.

### [x] Melhorias de uso real: mídia nas réguas, Inbox operacional, conexão viva `G` (19/09/2026)
Sete pedidos do dono vindos do uso diário, decididos em 19/09/2026: **anexo por passo de régua** (foto, áudio ou PDF; um por passo; texto opcional quando há anexo, pode ser só o áudio; vale para TODAS as réguas, e na confirmação o toque vira duas mensagens, a mídia e depois os botões, como UM par no espaçamento anti-ban); **assumir a conversa move o lead de Novo para Em contato** (regra pura por papel de etapa: quem já avançou não volta, e a clínica que excluiu a etapa Em contato desliga a automação por consequência); **trocar a etapa do contato dentro da conversa** (mesma action e mesmo modal de motivo de perda do Kanban, matriz de leads); **Marcar consulta na conversa** (deep link `/agenda?agendar=` no padrão do `/espera?adicionar=`); e a **faixa de conexão viva** (vigia no cliente com Realtime + polling de reserva; reconectar o celular não exige mais F5 em tela nenhuma), com **Verificar conexão** na própria faixa (action de membro que devolve só o status, sem QR) e **Verificar agora** na aba WhatsApp. Aviso de desconexão é só dentro do sistema, por decisão do dono. O anexo vive no balde `midia-de-regua` e é copiado para `midia-conversas` em nome da message no envio, então policies, rota de mídia e apagar valem sem exceção.
**Aceite:** 4 testes de integração do envio com mídia contra o banco real (cópia byte a byte, só-áudio, passo sem conteúdo, confirmação em duas mensagens), 4 de RLS do balde novo, 6 de unidade da regra do assumir; revisão adversarial do lote ao final.

### [x] Etiquetas de conversa com catálogo por clínica `M` (21/09/2026)
Pedido do dono: "preciso adicionar tags, cada clínica deveria criar a sua, e um filtro dessas tags na conversa". Fecha dois itens da spec nunca construídos: **1.7** (etiquetas por conversa com tela de gestão) e a parte "por etiqueta" do **1.6** (filtros do Inbox), mais o que o brief pedia no cartão (`docs/02:312`) e nos chips de filtro (`docs/02:304`).
Decisões do dono: a etiqueta vive na **conversa** (não no contato); **admin e gestor** mantêm o catálogo e **quem atende aplica**; cor da paleta do sistema; catálogo nasce com quatro etiquetas; marcar várias no filtro **soma** os resultados.
Desenho: `conversation_tag_def` no molde da jornada (chave estável, nome renomeável de graça, cor), com **duas divergências conscientes**: a exclusão é real e **limpa as conversas no mesmo gatilho** (etiqueta aplicada em conversa resolvida nunca sairia do arquivo, então recusar a exclusão tornaria uma etiqueta com erro de digitação indelével para sempre; e chave pendurada faria o validador recusar toda edição futura de etiqueta naquela conversa), e a semeadura só traz **estado de conversa**, nunca dado já estruturado (no-show é status de agendamento, convênio é `insurance_id`: etiqueta que repete dado estruturado vira terceira fonte de verdade e envenena relatório). Validação por dois gatilhos com `WHEN`, de forma que o caminho quente da ingestão não pague nada. Sem índice GIN: a filtragem é no cliente sobre as 300 carregadas, e um GIN encareceria a escrita mais quente para zero leitor.
**Pendência registrada:** `contact.tags` (as etiquetas de Leads) continua texto livre sem catálogo, o mesmo problema que a Jornada resolveu para as etapas. Ou converge para este catálogo, ou sai. Enquanto isso, a tela distingue: "Etiquetas do lead" em Leads, "Sinais automáticos" para as derivadas de Pacientes (risco de falta, inativo).
**Aceite:** 16 testes de RLS (isolamento com contraprova, recepção aplica mas não cria, profissional só a conversa dele, chave imutável até pelo service role, teto de 8, e a invariante da limpeza ao excluir) e 8 de unidade da lógica pura.

### [x] Revisão de liberação para a primeira clínica `G` (23 e 24/09/2026)
Pedido do dono: deixar redondo tudo o que já existe para liberar uma clínica real, com agente de IA e Resultados adiados. Revisão com 12 revisores por área e dois céticos por achado: 142 achados, 134 confirmados. Decisões do dono em 24/09: remarcação avisa o paciente por mensagem automática e volta a pedir confirmação; gestor gerencia o código de entrada; atendimento primeiro (a resposta da recepção não espera a fila das automáticas, confirmação antes de follow-up, importado não entra no follow-up); Compareceu direto.
Leva 1 (núcleo, commits 1bf3529 e 7934498): telefone com e sem nono dígito casado por chave canônica (`contact.phone_key`), réguas (toque atrasado, áudio com texto, dois trilhos no slot anti-ban, prioridade), interceptador de respostas só no contexto certo, lista de espera que não oferece vaga inexistente, agenda (remarcação com aviso, falta só depois do horário, Compareceu direto, faltas contadas pelo banco), isolamento entre clínicas por gatilho em todas as FKs de agenda e catálogo. Leva 2: correções de cada tela, junto com o layout do design system novo.
**Pendências do dono:** plano Pro do Supabase (o Free não tem backup) com restauração testada; plano da Vercel; `MOTOR_SAUDE_SECRET` e o monitor externo; colar os modelos de e-mail no painel; conferir nome e fuso da clínica; linha de base de faltas (6.3).

### [x] Design system novo como fonte visual `G` (24/09/2026)
Pedido do dono: usar a pasta `Conduzza Design System/` como base do layout do que existe e do que vai existir. Especificação de adoção em `docs/06_adocao_design_system.md`, com os 37 conflitos e as decisões do dono (tons e tamanhos ajustados para AA e 40px, ícone de 2px, menu recolhido em 64px abaixo de 1600px, e do kit: saudação no Início, filtro em Confirmações, ações no topo da conversa, indicadores em Pacientes). Base visual publicada em 1286e7e (tema claro e escuro, fontes, componentes, shell, ícones); telas em lotes na leva 2.

### [x] Vários números de WhatsApp por clínica `G` (25/09/2026)
Pedido do dono: a clínica pode ter mais de uma instância do uazapi, com a quantidade de números podendo virar plano no futuro (ainda sem definição). Desenho técnico em `docs/07_multiplos_numeros_whatsapp.md`. Decisões do dono em 25/09: **uma conversa por número**; as automáticas saem pelo **último número com que o paciente conversou** (sem conversa, pelo principal), com a opção de a clínica fixar **"sempre pelo número X"**; **nome livre e unidade opcional**; **sem limite por enquanto**, com `clinic.limite_de_numeros` preparado (nulo = sem limite, só o dono do produto altera). As decisões assumidas pela recomendação (D1 a D9) estão no docs/07.
Quatro fases publicáveis. Fases 1A e 1B (expansão do banco, commit eee4508): número com chave própria, segredo por número, política de envio, número em conversa, mensagem e job, com a suíte inteira passando sem mudança de código como prova de compatibilidade. Fase 2 (372c3de): o código trabalha por número (envio pela conversa, webhook com a URL nova `?clinic=&account=&secret=` e a antiga valendo para sempre, régua e eco pelo número do job, trava contra o mesmo celular em duas instâncias). Fases 3 e 4: contrato (NOT NULL, conversa aberta por número, fila reivindicada por **raia**, então dois números da mesma clínica enviam em paralelo) e as telas (cartões por número em Configurações, "Número das mensagens automáticas" em Automações, selo, filtro e cabeçalho por número no Inbox, faixa que nomeia o número desconectado).
**Regras de operação:** número desconectado faz o envio esperar e nunca troca de número sozinho; número removido tem os jobs redistribuídos e a instância apagada no provedor; o eco da resposta ao toque sai sempre pelo número que recebeu. Depois das Fases 3 e 4, **não há volta de código** para clínica com dois números.
**Aceite:** testes de RLS e integração por número (isolamento, limite em concorrência, um principal por clínica, política de envio, duas conversas para o mesmo contato, raias sem bloqueio mútuo), e2e com o provedor fake e dois números; revisão adversarial por fase.
**Revisto em 29/09/2026:** a escolha do número das automáticas passou a ser **por tipo de mensagem** (confirmação, pós falta, follow-up, lista de espera e aviso de remarcação, cada um com "último número usado pelo paciente" ou "sempre pelo número X"), como está em `docs/07_multiplos_numeros_whatsapp.md` ("Decisão do dono (29/09/2026)") e na frente "Número de envio por tipo" da entrada de 29/09 abaixo.

### [ ] Métricas do design, régua vinculada e Cadastros enxutos `G` (29/09/2026, em andamento)
Pedido do dono em 29/09/2026, ao comparar as telas com o protótipo do design system: (1) cartões de métrica como o `StatCard` do design, **construindo os dados que faltam**; (2) régua de confirmação e de pós falta **vinculada a um médico, a uma especialidade ou a um procedimento**; (3) cadastro em **modal central**; (4) Cadastros **sem as abas Vínculos, Recursos e Bloqueios**. Quatro fases publicáveis, cada uma com revisão adversarial.
**Decisões do dono (29/09):** o vínculo passa a ser feito **dentro do Procedimento** ("Quem faz e convênios", com o preço e a duração do procedimento como padrão e a exceção por profissional ou convênio ali mesmo); o **bloqueio vira ação da Agenda**; os **recursos saem da tela** e a trava do banco continua. Régua: **um vínculo por régua** (médico, especialidade ou procedimento), especialidade escolhida da lista das que os profissionais já têm, vale para **confirmação e pós falta**, precedência **procedimento, médico, especialidade, geral**. Métricas: faturamento estimado é o preço das consultas com comparecimento (preço do vínculo; na falta, o preço base do procedimento; convênio "Coberto" sem valor não soma e é contado à parte); investimento em anúncio **puxado da Meta automaticamente**; paciente ativo é quem compareceu nos últimos 12 meses; retorno em 90 dias é o percentual dos que compareceram com outra consulta até 90 dias depois; satisfação fica para depois ("Ainda não medido").
**Fase 1, Cadastros (construída, código publicado nesta leva):** modal central em todo cadastro (520px, ou 640px com tabela dentro); cinco abas, com os links antigos redirecionados; seção "Quem faz e convênios" no modal do Procedimento, gravada pela RPC `sincronizar_vinculos_do_procedimento` (migration `20260929100000`: cria, reativa, desativa sem apagar o vínculo com consulta, e a chave da IA segue o procedimento); bloqueio na Agenda ("Bloquear horário" na barra, "Bloquear este horário" no modal aberto pelo clique num horário vazio, remoção pela faixa hachurada); recursos fora da tela. Registro nos docs: 01 (3.5, 3.7, 3.9), 02 (Telas 3 e 8), 04 (catálogo), 06 (5.6, 5.11 e C38) e a 2.2 acima.
**Fase 2, régua vinculada (construída, código publicado nesta leva):** migration `20260929110000` (`cadence.professional_id` e `cadence.specialty`, um vínculo só por régua, índice único recriado, `cadence` no gatilho de mesma clínica, `chave_de_especialidade`, `regua_da_consulta` e o `planejar_reguas` usando a função na confirmação e no pós falta); o executor pula a run da régua que deixou de valer para a consulta; tela "Réguas vinculadas" nas abas Confirmação e Pós falta de Automações, com o chip de 3 estados no cartão da aba. Registro nos docs: 01 (8.2 e 8.8), 02 (Tela 7), 04 (seção 7), 06 (5.10).
**Pacote com vários procedimentos (construído, código publicado nesta leva):** pedido do dono em 29/09. Migration `20260929120000`, em modo expand: `package.name`; `package_item` (os procedimentos do pacote, cada um uma vez, com as suas sessões); `package_balance_item` (o saldo vendido por procedimento, uma cópia dos itens feita na venda); RPCs `salvar_pacote`, `vender_pacote` (com as sessões já usadas de cada procedimento na venda em andamento) e `ajustar_saldo_de_pacote(uuid, jsonb, date, text)`; o Compareceu desconta do item do procedimento da consulta; item de pacote vendido fica congelado (nome, preço, validade e "à venda" continuam editáveis); o preço avulso é calculado na tela e nunca gravado. Telas: aba Pacotes com o modal largo e a ficha do paciente com um cartão por venda e uma barra por procedimento. O código antigo segue funcionando pelos gatilhos legados até o contrato (item "Contrato dos pacotes" abaixo). Registro nos docs: 01 (3.8 e 6.6), 02 (Telas 8 e 9), 04 (seção 2), 06 (5.5 e 5.11).
**Número de envio por tipo (construído, código publicado nesta leva):** decisão do dono em 29/09, revendo a decisão 2 do `docs/07`. Migration `20260929130000`: `whatsapp_envio_automatico.tipo` com cinco tipos (confirmação, pós falta, follow-up, lista de espera e aviso de remarcação), cada um com "último número usado" (o padrão quando o tipo não tem linha) ou "fixo"; a linha que existia por clínica foi copiada para os cinco tipos; `resolver_conta_de_envio`, `conta_de_envio` e `contas_de_envio` recebem o tipo, e a fila tira o tipo do job por `tipo_de_envio_do_job`. Tela: "Número das mensagens automáticas" em Automações, com um seletor por tipo e "Salvar escolhas". O eco da resposta ao toque continua saindo pelo número que recebeu. Registro no `docs/07`.
**Publicação:** as quatro migrations (`20260929100000` a `20260929130000`) foram aplicadas em produção em 29/09, antes do código, e o código sai publicado nesta leva. A ordem importava: sem a primeira, o Salvar do procedimento gravaria o procedimento e avisaria que quem faz e os convênios não foram salvos; sem a segunda, as telas de Confirmações e Automações quebrariam e os toques de confirmação e pós falta falhariam. A terceira é expand: o código anterior continua funcionando pelos gatilhos legados. A quarta não é: até o código novo sair, o Salvar antigo de "Número das mensagens automáticas" falha com o erro genérico (a chave passou a ser clínica e tipo), e a leitura antiga da escolha dá erro em clínica que já tenha linhas (nenhuma em produção em 02/10). Nada sai por número errado, porque a fila e o banco já decidem por tipo. Depois que alguma clínica salvar escolhas por tipo, voltar ao código anterior quebra o cartão e o Salvar de Automações.
**Provas escritas (rodam com as migrations aplicadas):** integração da sincronização de vínculos (não apaga vínculo com consulta) e da escolha da régua em cada nível (`tests/integration/vinculos-do-procedimento.test.ts`, `tests/integration/regua-vinculada.test.ts`); RLS das réguas vinculadas, com profissional e procedimento de outra clínica recusados e recepção e leitura sem escrita (`tests/rls/reguas.test.ts`), e recepção e leitura também sem gravar vínculo do procedimento; e2e do procedimento com "Quem faz", do bloqueio pela Agenda e da régua vinculada a médico (`procedimento-quem-faz.spec.ts`, `agenda-bloqueio.spec.ts`, `automacoes-vinculada.spec.ts`); unidade da régua vigente, do vínculo da régua, dos vínculos do procedimento e do bloqueio.
**Falta:** **Fase 3**, o cartão de métrica único e o conteúdo de cada tela igual ao protótipo (Início, Confirmações, Pacientes, Lista de espera, Resultados), com os dados novos em funções de agregado pela sessão e com RLS (faturamento estimado, ativos em 12 meses, retorno em 90 dias, sem contato há 6 meses, variação do dia, meta de conversão). **Fase 4**, o investimento da Meta automático (token de leitura de anúncios, insights diários por anúncio, tabela de gasto diário, job de sincronização, casamento com o lead só por id, nunca por nome), que revoga a C25 do `docs/06`.
**Ponto para o dono:** com os recursos fora da tela, uma clínica não configura recurso novo pela interface; o caso do laser (spec 3.7) fica protegido só para o que já estava gravado.
**Decisão informada ao dono em 29/09 (régua vinculada):** quando a régua vigente de uma consulta muda no meio da sequência (troca de médico, régua vinculada ligada, desligada ou excluída), o toque da régua nova cujo momento já passou há mais de 30 minutos **não é recuperado**: o paciente pode ficar sem esse toque, mas **nunca recebe toque em dobro**. Registrado no `docs/04` (seção 7, planner).
**Rodada de correção (02/10/2026):** revisão adversarial da leva antes de publicar, com dois céticos por achado. O que foi corrigido:
- Banco, migration `20261002100000_saldo_de_pacote_sem_edicao_direta.sql` (aplicada em produção em 02/10, antes do código): o saldo por item (`package_balance_item`) deixa de aceitar edição direta de `sessions_total` pela API (pela sessão, o UPDATE fica só em `sessions_used`, que a RPC de ajuste grava; o total, o procedimento e a venda do item ficam os da venda); e o desconto de pacote da consulta fica travado (gatilho `travar_desconto_de_pacote`: depois de preenchidos, `appointment.package_balance_id` e `package_balance_item_id` não mudam mais, então ninguém apaga o rastro do débito para liberar o cancelamento de uma venda já descontada). O resto da escrita direta em `package_balance_item` e o INSERT direto em `package_balance` fecham no contrato dos pacotes (item abaixo).
- Agenda: a grade (Dia e Semana) se estende para mostrar o bloqueio que fica inteiro fora do horário de atendimento (antes ele não aparecia e não havia onde removê-lo); o servidor recusa consulta comum sobre bloqueio ("Este horário está bloqueado na agenda do profissional. Escolha outro horário."), e o encaixe segue o "Impedir encaixe" do bloqueio; o bloqueio coberto por uma consulta se remove pelo menu da consulta, na seção "Horário bloqueado", com "Remover bloqueio".
- Cadastros: o modal do Procedimento mantém como opção o convênio e o profissional inativos que já estavam gravados (desmarcar por engano tem volta no mesmo modal) e não regrava os vínculos quando eles não mudaram (salvar só a descrição não mexe em quem faz); o Salvar do procedimento alinha sozinho o "IA pode agendar" dos vínculos com o do procedimento, sem criar nem desativar vínculo.
- Confirmações: no empate de horário entre a run da régua que deixou de valer (pulada) e a da régua vigente, o chip de confirmação prefere a enviada.
- WhatsApp: o diálogo de remover o último número deixa de prometer que as automáticas passam a sair pelo último número usado, porque não sobra número nenhum.

### [ ] Contrato dos pacotes
Migration de contrato do pacote com vários procedimentos (a `20260929120000` foi o expand). **Só roda depois do código novo publicado**: até lá, o código antigo depende dos gatilhos legados.
**Pré-requisitos (migrar antes para `package_item` e `package_balance_item`):**
- `scripts/dev/demo-catalogo.ts`, que ainda cria o pacote de demonstração por `package.procedure_id` e `sessions`, sem `name` (hoje funciona pelos gatilhos `espelhar_item_do_pacote_legado` e `preencher_nome_do_pacote_legado`; sem eles, cai no NOT NULL de `name`). É usado por `scripts/seed/020-catalogo.ts` e por `scripts/dev/criar-clinica-teste.ts --com-demonstracao`.
- As fixtures de teste que inserem `package.procedure_id`/`sessions` ou `package_balance.sessions_total`. Em 02/10: `tests/rls/saldo-de-pacote.test.ts`, `tests/rls/leads.test.ts`, `tests/rls/cadastros-isolamento.test.ts`, `tests/integration/funil-e-atribuicao.test.ts` e `tests/e2e/fixtures.ts` (que já semeia por itens, mas ainda manda `sessions_total: null` na venda); o bloco "código publicado antes da troca (modo expand)" de `tests/integration/pacote-com-varios-procedimentos.test.ts` prova o caminho antigo e sai junto com ele. Para listar de novo antes de escrever a migration: `grep -rnE 'from\("package(_balance)?"\)|sessions_total' tests scripts`, e conferir quais desses ainda usam as colunas legadas.

**O que o contrato apaga** (a lista do cabeçalho da `20260929120000`):
- os gatilhos e funções `preencher_nome_do_pacote_legado`, `espelhar_item_do_pacote_legado`, `criar_itens_da_venda_legada` e `espelhar_totais_no_saldo_legado`;
- `package.procedure_id` (FK e `package_procedure_id_idx`) e `package.sessions` (e `package_sessions_check`); sai o ramo `package` de `exigir_cadastro_da_mesma_clinica` e o `procedure_id` da lista de colunas do gatilho em `package`;
- `package_balance.sessions_total` e `sessions_used`, com os CHECKs `package_balance_check`, `_sessions_total_check` e `_sessions_used_check`;
- a assinatura antiga `ajustar_saldo_de_pacote(uuid, integer, date, text)`.
- reescrever na mesma migration, com `create or replace` (um `ALTER FUNCTION` não basta), as RPCs que ficam e ainda tocam as colunas apagadas: `salvar_pacote` (tirar `procedure_id = null, sessions = null` do UPDATE em `package`), `vender_pacote` (tirar `sessions_total` e `sessions_used` do INSERT em `package_balance`) e `cancelar_venda_de_pacote` (tirar o ramo da venda sem item, que lê `v_saldo.sessions_total` e `v_saldo.sessions_used`). O `DROP COLUMN` não acusa coluna usada dentro de PL/pgSQL: a migration passa e o erro só aparece no Salvar e no Vender. Por isso o ensaio do contrato deve chamar, depois dos drops, `salvar_pacote`, `vender_pacote` e `cancelar_venda_de_pacote` com uma sessão de administrador simulada.
- Fica: `appointment.package_balance_id` (a ficha e a trava de cancelamento leem a venda); `package_balance_item_id` é o detalhe.

**Endurecimento pendente (na mesma migration):** passar `vender_pacote`, `ajustar_saldo_de_pacote` e `cancelar_venda_de_pacote` para `SECURITY DEFINER`, com `user_has_role` e a clínica conferidos explicitamente (hoje isso vem da RLS, porque são `SECURITY INVOKER`); depois, revogar de `authenticated` o insert, update e delete de `package_balance_item` e o insert de `package_balance`. Com isso o saldo só muda pelo débito do Compareceu e pelas RPCs (o ajuste com a trilha em `package_balance_adjustment`). Cobrir com teste de RLS: a recepção não muda item direto (nem sessões usadas, nem item novo numa venda feita) e a gestão não apaga item direto, com o caminho pela RPC passando ao lado. Depois do contrato, regenerar `lib/supabase/database.types.ts`.

---

## FASE 2. Cadastro e Agenda

### [x] 2.1 Schema do catálogo `M`
`professional`, `professional_schedule`, `professional_block`, `resource`, `procedure`, `insurance`, `service_link`, `package`, com RLS.
**Aceite:** `service_link` com unique em (profissional, procedimento, convênio) e os três estados de preço distinguíveis.

### [x] 2.2 Cadastros, telas (Tela 8) `G`
Desenho entregue (valeu até 28/09/2026, ver a mudança abaixo): abas de Profissionais, Procedimentos, Convênios, **Vínculos**, Pacotes, Recursos, Unidades, Bloqueios. Vínculos em acordeão por profissional com edição inline e botão Duplicar para outro profissional. Conselho de classe em **campo livre**.
**Aceite:** cadastrar o caso do Dr. João da spec (2 procedimentos, preços diferentes, convênios diferentes) sem gambiarra. "Coberto" aparece como rótulo, não como R$ 0,00.
> **Mudança (29/09/2026), decisão do dono:** Cadastros fica com cinco abas (Profissionais, Procedimentos, Convênios, Pacotes, Unidades) e todo cadastro abre em **modal central** (520px, ou 640px com tabela dentro), no lugar do painel lateral. O vínculo (profissional x procedimento x convênio, com preço, duração e "Coberto") passa a ser feito **dentro do modal do Procedimento** ("Quem faz e convênios", com o preço e a duração do procedimento como padrão e a exceção por profissional ou convênio ali mesmo); a aba Vínculos sai. O **bloqueio de horário vira ação da Agenda** ("Bloquear horário" na barra, "Bloquear este horário" no modal aberto pelo clique num horário vazio, remoção pela faixa hachurada); a aba Bloqueios sai. **Recursos saem da tela** (a coluna e a trava do banco continuam). Link antigo não quebra: `?aba=vinculos` abre Procedimentos, `?aba=recursos` e `?aba=bloqueios` abrem a aba padrão. O aceite do caso do Dr. João continua valendo, agora cadastrado pelo Procedimento. Brief nas Telas 8 e 3 do `docs/02`, aparência no `docs/06` (5.11, 5.6 e C38), modelo no `docs/04` (seção 2).

### [x] 2.3 Schema da agenda e travas `G`
`appointment`, `appointment_status_history`, `slot_hold`. Extensão `btree_gist` e as duas exclusion constraints (profissional e recurso).
**Aceite:** **teste de concorrência**: duas inserções simultâneas no mesmo slot, uma passa e a outra falha com erro de constraint. Sem esse teste a tarefa não está pronta.

### [x] 2.4 Motor de disponibilidade `G`
`lib/domain/scheduling.ts` puro e testável: calcula horários livres considerando jornada, bloqueio, agendamento existente, hold ativo, duração do vínculo e disponibilidade de recurso.
**Aceite:** suíte de testes cobrindo virada de dia, intervalo de almoço, bloqueio parcial, hold expirado e recurso ocupado.

### [x] 2.5 Agenda, tela (Tela 3) `G`
Visão Dia com coluna por profissional (mínimo 180px), visão Semana individual. **Filtros na ordem certa: unidade, especialidade, convênio, procedimento e o profissional por último.** Linha do horário atual, bloqueio com hachura, encaixe tracejado, hold semitransparente com contador, arrastar e soltar.
**Aceite:** a recepcionista responde "quem está livre para dermato pela Unimed" sem saber o nome de nenhum profissional.

### [x] 2.6 Modal de agendamento `M`
Uma tela só, nunca assistente de várias etapas. Ordem: paciente, unidade, convênio, procedimento, profissional (com preço e duração ao lado), data e horário com os 3 primeiros livres em botões grandes, aviso de recurso ocupado, observação, chave de confirmação automática.
**Aceite:** marcar uma consulta em menos de 20 segundos.

### [x] 2.7 Ciclo de status `M`
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

**Mudança de rumo (25/08/2026).** A Fase 3 (agente de IA) foi **adiada** por decisão do dono, que precisava liberar o sistema para clínicas testarem antes do agente existir. A Fase 4 foi construída sem ele, com estes degrades registrados:

- **Atribuição de origem (4.2):** três mecanismos determinísticos (código no link, mensagem padrão do anúncio, palavra-chave). O quarto mecanismo previsto na spec 10.1, a pergunta da IA, fica para a fase do agente. O aceite não depende dele.
- **Resposta do paciente (4.7):** interpretada por regra determinística em português, aceitando tanto o botão quanto o número do texto de reserva. Resposta que não se reconhece vai para a recepção, que é o comportamento seguro.
- **Texto escrito pela IA (4.8):** `cadence_step.use_ai` existe no schema mas o banco **recusa** o valor verdadeiro, porque texto de modelo de linguagem sem o filtro de conformidade violaria a regra 3.2 do CLAUDE.md. O cartão aparece na tela desabilitado, com a dica de que chega com o agente.
- **Lista de espera conversada pela IA (4.9):** a entrada na fila é da recepção ou do paciente respondendo, e a reoferta é mecânica de fila, com autoria `sistema`.

### [x] 4.1 Schema de contato e consentimento `M`
`contact`, `contact_consent`, `package_balance`, com RLS e atribuição de origem.

### [x] 4.2 Captura de origem `M`
`lib/domain/attribution.ts`: parâmetro de link click-to-WhatsApp, mensagem padrão do anúncio, palavra-chave, e pergunta da IA como último recurso. Taxonomia de 8 canais no padrão HubSpot.
**Aceite:** lead vindo de anúncio com parâmetro chega com campanha preenchida sem ninguém digitar nada.

### [x] 4.3 Leads (Tela 4) `G`
Lista e Kanban com toggle preservando filtro. 6 etapas incluindo Compareceu. Cartão com **exatamente 5 elementos**. Badge de tempo com cor, ícone e rótulo. Ordenação por próxima ação. Motivo de perda obrigatório. Ações em massa.
**Aceite:** arrastar para Perdido exige motivo. Cartão não mostra rótulo de campo vazio.

### [x] 4.4 Importação com consentimento `M`
Upload, mapeamento de colunas, pré-visualização e **passo obrigatório de declaração de consentimento** com aviso sobre quality rating. Botão desabilitado sem essa declaração.
**Aceite:** é impossível importar base sem declarar a origem da autorização.

### [x] 4.5 Pacientes e ficha (Tela 9) `M`
Lista, ficha com linha do tempo, indicadores, etiqueta automática de risco (2 ou mais faltas), etiqueta de inativo, saldo de pacote, estado do consentimento com botão de descadastro.
**Aceite:** paciente com 2 faltas recebe a etiqueta sozinho.

### [x] 4.6 Motor de réguas `G`
`cadence`, `cadence_step`, `cadence_run`, `job_queue`. Os 6 passos de verificação da seção 5 de `docs/03`.
**Aceite:** régua não duplica envio, respeita janela de envio, pula quem não tem consentimento e para na condição de parada. Teste com dois workers simultâneos.

**Degrade de infraestrutura (31/08/2026):** a extensão `pg_cron` **não está disponível** neste projeto Supabase, e não existe Edge Function `job-worker`. O executor é um **processo Node** (`npm run worker`), e a exclusão mútua entre workers vive no banco, na RPC `claim_jobs` com `FOR UPDATE SKIP LOCKED` (o contrato do aceite está cumprido, o hospedeiro é que mudou). Consequências que o time precisa conhecer: o deploy tem **dois processos** e o worker precisa de supervisão com reinício automático; a tabela `worker_heartbeat` e a faixa "as mensagens automáticas estão paradas" existem porque, sem elas, um worker morto era indistinguível de operação normal. Migrar para `pg_cron` + Edge Function continua desejável e vira tarefa própria quando a extensão estiver disponível.
**Superado em 02/09/2026:** o `pg_cron` foi ligado e o motor passou a rodar por ele, chamando `/api/webhooks/motor` na Vercel (runbook `supabase/operacao/motor-por-cron.md`). Não há mais worker em servidor.

### [x] 4.7 Confirmação de consulta (Tela 2) `G`
Régua padrão de 72h, 24h e 3h. **Template com botões de resposta rápida.** Exceção por procedimento. Régua reforçada para quem tem histórico de falta. Painel do dia seguinte com bento, o card de Pendentes como herói. Aba de Faltas de hoje.
**Aceite:** o paciente toca em Confirmar e o status da agenda muda sozinho, com autoria registrada.

### [x] 4.8 Follow-up e pós falta (Tela 7) `M` (15/09/2026)
Editor em linha do tempo horizontal com pré-visualização em balão de WhatsApp (botões reais na confirmação), chips de campos com aviso de campo inexistente, CRUD de passos com o sentido do momento travado pelo tipo no servidor, exceções por procedimento e régua reforçada (o planner escolhe a mais específica), e o **follow-up de leads por etapa da jornada configurável**: âncora `contact.funnel_stage_changed_at` carimbada no gatilho de validação, terceiro CTE em `planejar_reguas`, paradas estruturais (mudou de etapa, respondeu, reentrada obsoleta), uma régua por etapa, etapa com régua não se exclui. "Deixar a IA escrever" segue desabilitado com dica (regra 3.2; o CHECK `use_ai = false` fica). Estimativa honesta: volume por janela fechada de 30 dias; custo em reais só quando `message_pricing` tiver preço (pendência P1). Teste de envio para o próprio número da instância (destino validado como número) e métricas por régua sem número inventado. O bloco de ativação virou componente compartilhado com a Tela 2.
**Aceite:** o dev consegue trocar a régua de uma clínica sem tocar em código. Cumprido pela tela; provas: 24 de RLS das réguas, 6 de integração do follow-up contra o banco real, revisão adversarial com 17 achados corrigidos.

> **Mudança (29/09/2026), decisão do dono:** as "exceções por procedimento" viraram **réguas vinculadas** a um médico, a uma especialidade ou a um procedimento, na confirmação e no pós falta, com a precedência procedimento, médico, especialidade, geral decidida no banco (`regua_da_consulta`). Ver a entrada "Métricas do design, régua vinculada e Cadastros enxutos" no escopo acrescentado.

**Antecipado na 4.7:** a régua pós falta (D+0 e D+2) já existe inteira, com motor, planejamento, executor e o interruptor próprio na aba "Depois da falta" do painel de Mensagens automáticas da Tela 2. Ela foi trazida para cá porque o motor já a executava e deixá-la sem tela de ativação seria construir código que nunca poderia rodar. O que falta para a 4.8 é a **edição** dos textos, não a ativação. Escolher a IA para escrever continua desabilitado enquanto a Fase 3 não existir (regra 3.2).

### [x] 4.9 Lista de espera (Tela 10) `M` (15/09/2026)
Fila por contato com preferências (turno e dias no fuso da clínica), reoferta automática ao cancelar (gatilho no banco cobre todos os caminhos; encaixe e horário passado ficam fora), onda configurável por clínica (padrão 5) com janela configurável (padrão 30 minutos), primeiro que responder leva (RPC com FOR UPDATE; corrida com marcação manual arbitrada pela exclusion constraint), recusa sai só da oferta e a recusa geral adianta a próxima onda, expiração no motor por minuto. Tela 10 completa: métricas (recuperados, receita, tempo até preencher), faixa da reoferta com contagem regressiva e cancelamento, fila com arrasto e botões, adicionar manualmente, entradas pela ficha e pelo Inbox, cartão Recuperadas real na Tela 2.
**Aceite:** cancelar um agendamento dispara oferta e o segundo a responder recebe recusa educada, não o horário. Provado por teste de integração pelo caminho real do interceptador (mais 5 cenários: onda com prioridade/corte/consentimento, corrida, expiração em cascata, recusa que adianta, encaixe mudo).

---

## FASE 5. Dashboard, Configurações e Assinatura

### [x] 5.1 Dashboard (Tela 5) `G` (18/09/2026)
4 indicadores, card herói de Consultas recuperadas, desempenho da IA, funil de 3 etapas, origem em **barras horizontais**, custo contra teto, próximas ações.
Entregue como o Início com painel: bento de últimos 30 dias contra os 30 anteriores, pelas mesmas 3 RPCs de agregado por período da Tela 11 (`funil_do_periodo`, `agenda_do_periodo`, `atendimento_do_periodo`, migration 20260918100000, SECURITY INVOKER). Degrades honestos registrados: o card de desempenho da IA mostra o atendimento HUMANO (mediana e p90 da primeira resposta) e as métricas do agente ficam desabilitadas com dica (Fase 3); "custo contra teto" vira volume de mensagens com a frase do canal QR (`message_pricing` vazia é a pendência P1 e não se inventa valor); o card herói não inclui o contrafactual "confirmações que evitaram falta" (não mensurável), e sim recuperadas pela lista de espera + receita + remarcações pós-falta como número factual. O checklist de primeiros passos continua acima do painel enquanto houver pendência. Papel profissional vê só o próprio recorte, com trava NO BANCO (RPC devolve null para agregado da clínica).
**Aceite:** nenhum gráfico proibido. Números batem com consulta direta ao banco (provado por `tests/integration/relatorios.test.ts`, fixtures data a data).

### [x] 5.2 Relatórios (Tela 11) `M` (18/09/2026)
5 abas, dimensão primária trocável, exportação CSV e PDF. A aba Confirmação traz o comparativo contra a linha de base.
Entregue: período livre em dias civis da clínica na URL com comparação contra o anterior; abas Origem (canal/campanha), Agendamentos (profissional/procedimento/situação), IA (só o real), Confirmação (confirmadas pela trilha como "X de Y", recuperadas com receita e "sem preço" contado à parte, pivô antes/depois da primeira régua, comparativo contra a linha de base REGISTRADA) e Custos (volume). Exportação da aba ativa em CSV e impressão (o "PDF" é imprimir-para-PDF do navegador, com layout próprio via portal; PDF gerado não existe no sistema), sempre com trilha em `audit_log` antes do download. Deltas honestos: % nos fluxos comparáveis, taxa de coorte sem seta (maturidade diferente).

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
Parcial (24/09/2026): `/api/webhooks/saude` responde 503 quando o motor para, atrasa ou o planner erra, para um monitor externo (UptimeRobot ou BetterStack) que o dono configura seguindo o runbook; poda diária de `cron.job_run_details`. Falta o resto da lista.

### [ ] 6.2 Testes de ponta a ponta `G`
Playwright nos fluxos críticos: agendar, confirmar por botão, assumir da IA, e o teste de conflito de agenda concorrente.

### [ ] 6.3 Medição da linha de base `P` `FAZER ANTES DE LIGAR QUALQUER RÉGUA`
Registrar a taxa de no-show da clínica piloto nos 30 dias anteriores à implantação.
A metade que vive no sistema foi entregue em 18/09/2026 junto com a 5.2: tabela `no_show_baseline` (append-only, só admin registra, corrigir é registrar de novo) e o formulário na aba Confirmação de Resultados, com aviso quando a régua já disparou. Falta a metade humana: medir o número da clínica piloto e colher a assinatura.
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
