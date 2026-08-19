# Spec Funcional: SaaS de Atendimento com IA para Clínicas
### Projeto Conduzza Clínicas, V1
Versão 1.1 (auditada e corrigida) | 14/08/2026 | Autor: Claude para Vinicius Godoy

---

## TESE

**O produto não é "um software de clínica". É uma recepcionista digital que trabalha 24 horas e devolve consulta perdida em dinheiro.** Agenda, cadastro e CRM existem só para dar insumo à IA e para provar o resultado no dashboard. Quem tentar competir com iClinic e Feegow em prontuário morre. Quem vende no-show recuperado sobrevive, porque **nenhum dos dois grupos que dominam o mercado (Afya, dona do iClinic e do Shosp, e Docplanner, dona da Doctoralia e da Feegow) tem agente autônomo falando com paciente hoje.** A janela existe, mas não está vazia: Clinicorp e Amplimed já têm agente próprio e são a concorrência direta real.

---

## GLOSSÁRIO

| Sigla | Significado |
|---|---|
| SaaS | Software as a Service, software vendido como assinatura |
| MVP | Minimum Viable Product, produto mínimo viável |
| PMS | Practice Management System, o software de gestão da clínica (iClinic, Feegow) |
| CRM | Customer Relationship Management, gestão de relacionamento com o lead |
| Lead | Contato interessado que ainda não virou paciente |
| No-show | Paciente que faltou à consulta sem avisar |
| Handoff | Transferência do atendimento da IA para o humano |
| Janela 24h | Período em que a Meta permite mensagem livre após o paciente responder |
| Template (HSM) | Mensagem pré-aprovada pela Meta, obrigatória para iniciar conversa |
| Cloud API | API oficial do WhatsApp, hospedada pela Meta |
| Opt-in | Consentimento registrado do paciente para receber mensagens |
| Quality rating | Nota de qualidade do número atribuída pela Meta. Nota baixa reduz o limite de envio |
| RIPD | Relatório de Impacto à Proteção de Dados Pessoais (LGPD) |
| MRR | Monthly Recurring Revenue, receita recorrente mensal |
| SLA | Service Level Agreement, prazo contratado de resposta |
| ICE | Impacto, Confiança, Facilidade (priorização) |
| Tenant | Cada clínica dentro do sistema, com dados isolados das demais |

**Como ler:** Seção 1 é a Ficha de Entrega. Seção 2 é o benchmark (fonte primária). Seção 3 é o alerta comercial que precisa ser lido antes de assinar qualquer coisa. Seção 4 são os módulos. Seção 5 é o modelo de dados. Seção 6 é o corte V1 contra V2. Seção 7 é infraestrutura e manutenção. Seção 8 é o cronograma. Seção 9 é a Matriz de Aceite. Seção 10 são as pendências.

**Régua de confiança usada neste documento:**

| Marcação | Significado |
|---|---|
| `[FONTE]` | Sustentado por benchmark com URL nos arquivos anexos |
| `[PREMISSA]` | Hipótese de trabalho minha, sem fonte externa. Precisa ser validada |
| `[PENDENTE]` | Dado necessário que ainda não foi levantado |

---

## 1. FICHA DE ENTREGA

**O QUÊ:** Especificação funcional do V1 de um SaaS vertical de atendimento com IA para clínicas médicas e de estética, com corte de escopo, modelo de dados, infraestrutura e cronograma. Documento irmão: `02_brief_telas_claude_design.md`, com **14 telas**, pronto para colar no Claude Design.

**POR QUÊ:** A reunião definiu a ideia em linguagem falada. Sem spec escrita, o design vira chute, o orçamento vira estimativa sem base e o desenvolvimento entrega outra coisa. A barreira de entrada dessa categoria é baixa (dito na própria reunião) e o tempo é o ativo mais escasso.

**DE ONDE:**
- Transcrição da reunião com a Conduzza.
- https://conduzza.com.br (agência de aceleração de clínicas médicas, método BPM, dor declarada "secretárias com baixa conversão").
- `benchmark_softwares_clinicas.md` (11 concorrentes, preços e APIs, URL por afirmação).
- `benchmark_agentes_ia_saude.md` (agentes de IA Brasil e exterior, no-show, regras Meta, LGPD, CFM).
- `benchmark_ux_telas.md` (anatomia de tela de Chatwoot, Pipedrive, Feegow, HubSpot, Material 3, WCAG).

**COMO:** Benchmark profundo primeiro, recorte funcional por dor, modelo de dados, brief de design com componentes por tela, auditoria adversarial do próprio documento.

**RISCOS (as 3 razões reais para dar errado):**
1. **Escopo infla e o produto vira PMS.** A reunião já cita agenda, CRM, cadastro completo, integração com dois sistemas, dashboard e IA. Isso é roadmap de 18 meses. Se tudo virar V1, nada sai.
2. **A economia não fecha em 15 clientes.** Ver Seção 3. O próprio cliente levantou isso e a conta confirma.
3. **Compliance e infraestrutura de mensageria matam o produto depois de pronto.** Dado de saúde é sensível na LGPD, o CFM proíbe triagem automatizada, e disparo sem opt-in derruba o quality rating do número da clínica. Se o guardrail não nascer com o produto, o primeiro incidente apaga a margem.

**RECOMENDAÇÃO:** Construir o V1 como recortado na Seção 6. Cobrar por clínica (não por profissional) na faixa de **R$ 597 a R$ 897**. Vender no-show recuperado, não lista de funcionalidades. Antes de escrever a primeira linha de código, fechar as decisões D1, D2 e D3 da Seção 3.

**IMPACTO (1 a 10): 9.**

---

## 2. O QUE O BENCHMARK PROVA

### 2.1 A lacuna existe, mas é menor do que parece

`[FONTE]` Os dois grandes grupos não têm agente autônomo de atendimento ao paciente. O iClinic Assist (Afya) e o Noa Notes (Docplanner) são IA de **documentação clínica**, sem interação com paciente. O Noa Booking, agendamento por IA da Doctoralia, está anunciado como "em breve". Prova econômica forte: a própria Feegow indica terceiros (Cloudia, Nina) para chatbot em vez de resolver nativamente.

**Mas a concorrência direta real existe e precisa ser dita:**

| Concorrente | O que já tem | Preço |
|---|---|---|
| **Clinicorp** | Três agentes de IA no WhatsApp, com handoff e execução de ações no sistema. Classificado no benchmark como nível alto de IA de atendimento | Não publica preço da IA. Plataforma a R$ 159,90 e R$ 369,90 por clínica, usuários ilimitados |
| **Amplimed** | Amélia Agendamento, com autonomia declarada | Não publica preço da IA |
| **Secretar.AI** | IA de atendimento pura, sem PMS | R$ 360 (solo), R$ 720 (5 usuários), R$ 1.080 (15 usuários) |
| **PevIA** | IA com agendamento nativo | R$ 297, R$ 497, R$ 897 |

**Consequência:** o discurso de venda não pode ser "somos os únicos". Tem que ser "somos os únicos que juntam agente de IA, agenda, CRM de leads e prova de origem de campanha no mesmo lugar, com SLA publicado". A diferenciação é o pacote e o atendimento, não o ineditismo.

**Risco a monitorar:** se o Docplanner embutir o Noa Booking nos planos de R$ 429 a R$ 679, agendamento por IA vira commodity dentro do PMS. Isso reforça a decisão de fazer rápido.

### 2.2 A integração com iClinic não existe do jeito que foi assumido na reunião

`[FONTE]` Na reunião foi dito que iClinic e Feegow são "os dois que a gente tem mais abertura". O benchmark contradiz:

| Sistema | API pública documentada? | Viabilidade | Observação |
|---|---|---|---|
| **Feegow** | Sim. REST em docs.feegow.com, token do próprio cliente, webhooks, 200+ funções | **Alta** | A Feegow declara que não presta apoio a integrações |
| **Ninsaúde Apolo** | Sim. OAuth2, webhooks, Postman público | **Alta** | |
| **Docplanner / Doctoralia** | Sim. OAuth2 com IP whitelisting, notificações push e pull | **Média** | Voltada a PMS parceiros, exige acordo |
| **Trinks** | Existe sob solicitação, token em 48h, com webhooks | **Média** | Nicho de estética e beleza |
| **Shosp** | Sim, com **acesso controlado**. Integração aparece como recurso do plano Excellence (R$ 229), sugerindo gating por plano. Webhooks não documentados | **Média** | |
| **iClinic** | **Não.** Sem API REST pública. Só Google Calendar e Apple Calendar (esta só leitura) | **Baixa** | Exige negociação bilateral com a Afya |
| Amplimed, Clinicorp, Belle, Avec | Não publicada | Nula sem acordo | |
| Simples Dental | Declara oficialmente que não tem API | Nula | |

Evidência corroborante: Cloudia (40+ integrações) e Clinia listam Feegow e Clinicorp e **não** listam iClinic.

**Consequência:** a ordem de integração do V2 é **Feegow primeiro, Ninsaúde e Shosp em seguida, iClinic como projeto comercial separado**. Isso precisa ser dito ao cliente antes de virar promessa de contrato.

### 2.3 O preço pretendido está certo e tem âncora

`[FONTE]` O cliente falou em R$ 600 a R$ 700. Âncoras: Secretar.AI a R$ 720 no plano de consultório e R$ 1.080 no de clínica; PevIA a R$ 897 no topo; Doctoralia a R$ 679 por mês **por profissional** sem agente autônomo.

**Recomendação: R$ 597 (Essencial) e R$ 897 (Completo), por clínica, usuários ilimitados.**

Cobrar por clínica é diferenciação contra o mercado médico generalista (iClinic, Feegow, Amplimed, Shosp e Doctoralia cobram por profissional e punem quem cresce). Não é inédito: Clinicorp, Simples Dental e Trinks já cobram por estabelecimento, e o Clinicorp tem a melhor reputação médica da amostra (8,3/10). Abaixo de R$ 400 o produto colide com PMS completo e perde o enquadramento de categoria nova.

`[FONTE]` Quatro sustentações do preço premium, cada uma atacando uma queixa documentada, todas de custo de produto próximo de zero:
1. **SLA publicado em horas.** Simples Dental responde em 14 horas e tem 100% de recompra. iClinic responde em 16 dias e 21 horas e tem 50%. Feegow em 21 dias e 9 horas com 25 reclamações sem resposta. SLA sozinho justifica preço.
2. **Preço público com cancelamento autoatendido.** "Dificuldade de cancelar" é a reclamação nº1 da Doctoralia (18% de 699 reclamações).
3. **Tudo incluso, sem módulo à parte.** "Cobrança indevida" lidera as reclamações de Simples Dental (35,29%), Trinks (15,72%) e iClinic (8,11%), puxada por empacotamento predatório (teleconsulta a R$ 35 à parte no iClinic, WhatsApp a R$ 229 à parte no Belle).
4. **ROI amarrado a no-show recuperado**, medido contra a linha de base da própria clínica.

### 2.4 Os números que justificam o preço na frente do cliente

`[FONTE]` Não existe estatística nacional consolidada de no-show em clínica privada brasileira. Isso, em si, é oportunidade de pesquisa proprietária. O que existe:

- **20,06%** de faltas em hospital-escola de Catanduva/SP em 2023 (9.193 faltas em 45.825 consultas).
- **13,1%** em consultas especializadas no RS. No mesmo estudo, exames têm taxa geral de **2,1%**, mas **colonoscopia chega a 41,3%**. Procedimento com preparo complexo tem no-show desproporcional e é o que mais ganha com régua reforçada.
- **31% das instituições brasileiras** têm absenteísmo acima de 11% (Doctoralia, Panorama 2025).
- **Cochrane** (Gurol-Urganci et al., 2013): comparecimento sobe de **67,8% sem lembrete para 78,6% com SMS**, RR 1,14 (IC 95%: 1,03 a 1,26). Lembrete por texto é estatisticamente equivalente a ligação (RR 0,99), com custo muito menor.
- **Hasvold e Wootton (2011)**, 29 estudos: lembrete automatizado reduz falta em 29% sobre a base, média ponderada de 34%.
- **66 minutos por dia de overhead telefônico por médico**, com 86% considerado recuperável. Atenção: esse dado é **por médico**, não por recepção. Não existe medida equivalente publicada para recepção brasileira. `[PENDENTE]`

**Memória de cálculo do ROI (usar SEMPRE o ticket real do prospect):**

```
Consultas por mês:                       440
Taxa de no-show:                          18%
Faltas por mês:            440 x 0,18  =  79,2 consultas
Redução com régua ativa:                  30%   [entre o piso de 29% e a média de 34% da literatura]
Consultas recuperadas:    79,2 x 0,30  =  23,76 consultas
Ticket médio da clínica:                  R$ 200
Receita recuperada:      23,76 x 200   =  R$ 4.752 / mês

Contra o plano Essencial (R$ 597):   4.752 / 597 = 7,96x de retorno
Contra o plano Completo  (R$ 897):   4.752 / 897 = 5,30x de retorno

Tempo de mensalidade coberto pela receita recuperada:
   Essencial: 597 / 4.752 = 0,126 mês (3,8 dias)
   Completo:  897 / 4.752 = 0,189 mês (5,7 dias)
```

Nota de exibição: 79,2 e 23,76 são frações porque a taxa é média mensal. Ao apresentar arredondado (79 faltas, 24 recuperadas), o produto muda para R$ 4.800. Usar sempre a mesma base na proposta, para não dar munição a um prospect com calculadora.

**Não confundir com payback de investimento.** Payback real exige o custo de desenvolvimento, que ainda não está fechado.

### 2.5 Restrições técnicas que MUDAM o desenho

`[FONTE]` **A Meta cobra por mensagem desde 01/07/2025**, não mais por conversa. Um fluxo de confirmação com três toques custa três mensagens utility. **Mas se o paciente responde, abre a janela de 24h e tudo depois fica gratuito.**

Consequência grande: **o primeiro template tem que ser desenhado para provocar resposta.** Taxa de resposta deixa de ser métrica de marketing e vira alavanca de margem bruta. Por isso o template de confirmação nasce com botões de resposta rápida (Confirmar, Remarcar, Cancelar), não com texto solto.

Click-to-WhatsApp dá **72h** de janela gratuita. Como a Conduzza roda Google Ads e a estética vive de tráfego pago, isso é vantagem estrutural a explorar.

Mensagens de marketing (reativação de inativo) são sempre cobradas. Logo, reativação precisa de cota própria e teto de gasto configurável.

**Verificação de negócio na Meta destrava 6.000 templates contra 250 sem verificação.** Com régua por procedimento mais réguas de follow-up por etapa, o teto de 250 estoura rápido. Verificação vira etapa obrigatória de onboarding, não item opcional.

**Opt-in é exigência da Meta e da LGPD ao mesmo tempo.** Sem consentimento registrado, o disparo em base importada derruba o quality rating do número, a Meta reduz o tier de envio e a régua para de funcionar para todo mundo naquela clínica.

**LGPD:** conversa de paciente é dado sensível (art. 5º, II). O art. 11, § 4º proíbe compartilhar dado de saúde entre controladores para vantagem econômica, o que exige **isolamento de dados por clínica na arquitetura**, não só na política de privacidade. LLM hospedado fora do Brasil configura transferência internacional (art. 33). RIPD é esperado pela ANPD por combinar dado sensível, larga escala e decisão automatizada. Consentimento para dado sensível precisa ser específico e destacado: "aceito os termos" não serve.

**CFM, o ponto mais subestimado da reunião:** teletriagem é ato médico privativo (Resolução CFM 2.314/2022). **O agente não pode triar sintoma.** A Resolução 2.336/2023, art. 11, XII veda prometer resultado, e como o texto é gerado por LLM isso exige **filtro na saída, não só instrução no prompt**. Antes e depois isolado é vedado (art. 14) e oferta casada também. Odontologia responde ao CFO (Resolução 196/2019) e exige análise separada. Boa notícia: informar preço é permitido (art. 9º), o que eleva conversão sem risco.

### 2.6 O que copiar dos líderes de fora

`[FONTE]`
- **Lista de espera com reoferta automática.** A Luma Health atribui a isso mais de 800 horas por ano recuperadas. No Brasil, Doctoralia VIP e Feegow já têm alguma forma de lista de espera, então não é inédito, mas ninguém junta com reoferta disparada por IA no WhatsApp.
- **Escrita de volta no sistema de gestão**, não só leitura. É o que separa "canal" de "funcionário".
- **Calculadora de ROI pública** com o ticket do próprio prospect (Arini).
- **Teto de gasto configurável com botão de pausa** (Zocdoc). Remove o medo de contratar.
- **Diagnóstico gratuito das conversas existentes** da clínica, mostrando leads mortos sem resposta (análogo ao Call Intelligence da Weave). Melhor argumento de venda que existe, e usa dado do próprio cliente.
- **Cota de mensagens embutida no plano** (Weave vende 1.500, 3.000 e 15.000). Resolve o repasse do custo variável da Meta sem susto.
- **Recuperação ativa de falta** (Hello Patient, Parakeet): o paciente que faltou recebe contato automático no mesmo dia.

Benchmark honesto de automação: Zocdoc Zo resolve **até 70%** das chamadas sem humano, Artera 65%, Notable 57%. Promessas brasileiras de "90% de automação" e "95% de conversão" estão fora do estado da arte. **Não fazer essas promessas.**

**Não copiar:** portal do paciente. A Klara vende a ausência dele como diferencial (84% de utilização contra portais tradicionais). O paciente já está no WhatsApp.

---

## 3. ALERTA COMERCIAL (verdade acima de agrado)

O cliente disse na reunião: *"a gente tem hoje aqui 15 clientes, se todo mundo fosse ter, e não vai ser isso, a gente teria uma fonte de renda baixa, que talvez não fizesse tanto sentido para o trabalho que isso vai dar."*

**Ele está certo, e a conta prova.**

```
Premissas [PREMISSA, todas a validar]:
  Custo mensal do time mínimo (1 dev pleno + infra + suporte):  R$ 15.000
  Custo variável por clínica (mensagens Meta + LLM):            [PENDENTE, ver P1]
  Taxa de adoção interna em 12 meses:                            60%

Receita:
  Cenário otimista (15 de 15 adotam):
     15 x R$ 597 = R$  8.955 / mês      déficit contra o time: R$  6.045
     15 x R$ 897 = R$ 13.455 / mês      déficit contra o time: R$  1.545

  Cenário realista (9 de 15 adotam):
      9 x R$ 597 = R$  5.373 / mês      déficit: R$ 9.627
      9 x R$ 897 = R$  8.073 / mês      déficit: R$ 6.927

Piso teórico de equilíbrio (SEM custo variável, portanto otimista):
  15.000 / 597 = 25,1  ->  26 clínicas
  15.000 / 897 = 16,7  ->  17 clínicas
```

**Conclusão inevitável: nem o cenário otimista de adoção interna paga o time.** São necessárias entre 17 e 26 clínicas só para empatar, e o número real é maior porque o custo variável ainda não entrou na conta.

**Isso não é um produto interno da Conduzza que por acaso pode ser vendido.** Ou nasce com plano de ir a mercado (aquisição própria, meta de clientes externos definida), ou é ferramenta interna de agência e o orçamento precisa ser tratado como despesa de operação, não como investimento em produto.

### As três decisões que precisam ser fechadas ANTES do design

**D1. Quem é dono do produto?** Software da Conduzza com desenvolvimento terceirizado, ou co-propriedade com divisão de receita? Muda precificação, contrato e quem carrega o risco. Ficou ambíguo na reunião.

**D2. O SEBRAE cobre o quê?** Foi dito que o projeto foi aprovado, com subsídio de 70% e os 30% restantes em 12 vezes. `[PENDENTE]` **Isso precisa ser confirmado documentalmente antes de virar premissa de caixa.** Programas de subsídio do SEBRAE têm regra de percentual, teto por projeto, escopo elegível e, na maioria dos casos, **credenciamento obrigatório do prestador**. Se o desenvolvedor não for credenciado, o subsídio não sai. Pedir o edital ou termo de aprovação.

**D3. Qual a meta de clientes externos no mês 12?** Sem esse número não existe decisão de arquitetura nem de investimento.

---

## 4. MÓDULOS E FUNCIONALIDADES

---

### MÓDULO 1. INBOX DE ATENDIMENTO
**ICE: I=10, C=9, F=6**

**Dor:** *"De noite e aí de manhã no outro dia, ela chega e tem que fazer confirmação de consulta e não consegue ter tempo para atender aquelas pessoas durante a manhã."*

1.1. Caixa única de conversas do WhatsApp da clínica, multi-atendente.
1.2. **Estado de posse com a IA como cidadã de primeira classe** (padrão Chatwoot): `IA atendendo`, `Aguardando humano`, `Em atendimento`, `Resolvida`.
1.3. **Botão Assumir (takeover)** no compositor. Para a IA imediatamente e trava até devolução explícita. A IA nunca volta sozinha.
1.4. Indicador ao vivo de "IA digitando".
1.5. Abas de posse: Minhas, Sem atendente, IA atendendo, Resolvidas, Todas.
1.6. Filtros: não lidas, escaladas, por etiqueta, por profissional mencionado, por origem, por período.
1.7. Etiquetas por conversa, com tela de gestão de etiquetas.
1.8. Painel de contexto com dados do contato, origem da campanha, tipo (lead ou paciente), histórico de agendamentos, próxima consulta, procedimentos de interesse.
1.9. Ações rápidas: agendar, adicionar à lista de espera, marcar como paciente, criar lembrete.
1.10. Notas internas (nunca visíveis ao paciente).
1.11. Respostas rápidas salvas.
1.12. Envio de mídia: imagem, áudio, documento.
1.13. **Indicador de janela de 24h com contador regressivo.** Fora da janela, o compositor bloqueia texto livre e exige template.
1.14. Histórico completo pesquisável.
1.15. Transcrição automática de áudio recebido.
1.16. **Log de decisão da IA visível na conversa** (o que consultou, por que escalou, se houve bloqueio de conformidade).

**Regras:**
- Toda conversa nasce com a IA, salvo se a clínica desativar o agente por horário.
- Escalonamento obrigatório quando: paciente descreve sintoma, pede humano, demonstra insatisfação, IA falha 2 vezes, assunto envolve valor fora da tabela, ou paciente é menor de idade.
- Nenhuma mensagem sai sem passar pelo filtro de conformidade (2.8).

---

### MÓDULO 2. CÉREBRO DO AGENTE DE IA
**ICE: I=10, C=8, F=5**

**Dor:** *"Cada time vai ter seu agente, porque cada um tem coisas diferentes."*

2.1. **Persona:** nome do atendente virtual, tom de voz (formal, cordial, próximo), saudação, encerramento, uso de emoji.
2.2. **Base de conhecimento por clínica:** endereço, estacionamento, horário, formas de pagamento, política de cancelamento, orientações de preparo, o que levar. Editor de perguntas e respostas mais upload de documento.
2.3. **A IA consome automaticamente o cadastro clínico** (Módulo 3). Cadastrou procedimento novo com preço, a IA já sabe responder. Base duplicada manualmente é o que faz esses produtos apodrecerem.
2.4. **Habilidades ligáveis por chave:** responder dúvida (sempre ligada), informar preço, informar convênios, consultar horário, agendar, remarcar, cancelar, confirmar presença, captar dados do lead, oferecer horário de lista de espera.
2.5. **Horário de operação:** 24h, só fora do expediente, ou só se ninguém responder em X minutos. Por dia da semana.
2.6. **Regras por procedimento:** qual exige avaliação prévia, qual não pode ser agendado por IA, qual exige contato humano obrigatório.
2.7. **Simulador de teste** com cenários prontos e botão de publicar versão. Sem isso ninguém confia para ligar.
2.8. **Filtro de conformidade na saída (guardrail duro, não desligável):** bloqueia antes de enviar se contiver orientação clínica ou triagem de sintoma (CFM 2.314/2022), promessa ou garantia de resultado (CFM 2.336/2023, art. 11, XII), oferta casada, diagnóstico, indicação de medicamento ou dosagem. Ao bloquear, escala para humano e registra no log.
2.9. **Log de decisão** para depuração e auditoria LGPD.
2.10. **Aprendizado supervisionado leve:** o humano corrige a IA e transforma a correção em item da base de conhecimento com um clique.
2.11. **Versionamento com reversão.**

---

### MÓDULO 3. CADASTRO CLÍNICO
**ICE: I=9, C=10, F=8**

3.1. **Profissionais:** nome, foto, **conselho de classe em campo livre** (CRM, CRO, CREFITO, CRBM, CRN, ou "sem conselho" para esteticista), número, especialidades, unidade, cor na agenda, ativo ou inativo.
3.2. **Horário de atendimento por profissional**, por dia da semana, com intervalos, por unidade.
3.3. **Procedimentos:** nome, descrição, duração padrão, preço particular, exige avaliação prévia, orientação de preparo, agendável pela IA, **recurso necessário** (sala, cabine, equipamento).
3.4. **Convênios:** nome, plano, carteirinha obrigatória, observações.
3.5. **A matriz de vínculo** (o item mais enfatizado na reunião): relação de três pontas entre profissional, procedimento e convênio, cada combinação com preço e duração próprios.

   Exemplo que precisa funcionar: Dr. João, Endocrinologia, particular R$ 400, 40 min, atende Unimed e Bradesco. O mesmo Dr. João, Nutrologia, particular R$ 500, 60 min, só particular.

3.6. **Unidades.**
3.7. **Recursos** (sala, cabine, equipamento). Exigência do nicho de estética: dois procedimentos podem precisar do mesmo aparelho de laser e não podem ser marcados no mesmo horário mesmo com profissionais diferentes.
3.8. **Pacotes de sessões:** procedimento vendido em N sessões, com controle de sessões usadas e restantes por paciente. Sem isso o produto não atende metade do nicho de estética declarado na reunião.
3.9. **Bloqueios como entidade própria** (férias, congresso, almoço), criáveis em lote, com opção de impedir encaixe. Nunca agendamento falso.

---

### MÓDULO 4. AGENDA
**ICE: I=9, C=9, F=6**

4.1. **Visão Dia com uma coluna por profissional** (mínimo 180px por coluna). Coluna lado a lado só funciona em visão de dia.
4.2. **Visão Semana sempre de um único profissional.**
4.3. **Filtro por especialidade, convênio, procedimento e unidade ANTES do nome do profissional.** A recepção pergunta "quem está livre para dermato pela Unimed", não "abra a agenda do Dr. Fulano".
4.4. Arrastar e soltar para remarcar, com confirmação e disparo opcional de aviso ao paciente.
4.5. **Status com autoria e canal explícitos:**
   - Agendado
   - Aguardando confirmação
   - Confirmado pelo paciente via WhatsApp
   - Confirmado pela recepção
   - **Aguardando na recepção (check-in)**
   - **Em atendimento**
   - Compareceu
   - Cancelado pelo paciente
   - Cancelado pela clínica
   - Faltou (no-show)

   Falta é sempre ação explícita, nunca inferida pelo sistema.
4.6. Encaixe (overbooking controlado) com marcação visual distinta.
4.7. **Busca de primeiro horário disponível com reserva temporária (hold).** Quando a IA oferece um horário ao paciente, o slot fica reservado por N minutos (padrão de 10). Sem isso, a IA oferece um horário, o paciente demora 40 segundos, a recepcionista marca outro paciente no mesmo slot e a clínica tem dois pacientes no mesmo horário. Esse erro isolado faz a clínica desligar o agente e não voltar.
4.8. **Verificação de disponibilidade de recurso** (sala, equipamento) no momento da marcação.
4.9. Impressão e exportação da agenda do dia.
4.10. **Log de alterações** (quem mudou o quê e quando).

---

### MÓDULO 5. LEADS
**ICE: I=9, C=9, F=8**

**Dor:** *"CRM, mas sem campanha, sem muita complexidade para mexer, somente de dados."*

5.1. Base de leads separada da base de pacientes (decisão da reunião, e está correta).
5.2. **Lista e Kanban do mesmo dado, com toggle preservando o filtro.**
5.3. **Etapas padrão (editáveis):** Novo, Em contato, Aguardando resposta, Agendou, **Compareceu**, Perdido. A etapa Compareceu é o que o produto vende, não pode faltar no funil.
5.4. **Cartão de lead com no máximo 5 elementos:** nome, telefone, badge de origem, badge de tempo desde o último contato, avatar do responsável.
5.5. **Badge de tempo com cor, ícone e rótulo:** verde até 4h, âmbar de 4h a 24h, vermelho acima de 24h.
5.6. **Ordenação padrão por próxima ação**, não por data de criação.
5.7. Filtros: origem, etapa, responsável, período, procedimento de interesse.
5.8. Ações em massa: reatribuir, mudar etapa, etiquetar, disparar régua.
5.9. **Motivo de perda obrigatório** (preço, distância, horário, não respondeu, agendou em outro lugar).
5.10. Criação manual de lead.
5.11. **Importação por planilha com captura obrigatória de opt-in.** A tela exige que o gestor declare de onde veio o consentimento antes de permitir qualquer disparo para a base importada.
5.12. Conversão para paciente automática ao criar o agendamento, preservando o histórico do lead.

---

### MÓDULO 6. PACIENTES
**ICE: I=8, C=9, F=8**

6.1. Ficha com dados cadastrais, convênio, carteirinha, observações.
6.2. **Linha do tempo de agendamentos** com status de comparecimento.
6.3. **Indicadores automáticos:** total de consultas, total de faltas, taxa de comparecimento, dias desde a última consulta, valor total gerado.
6.4. **Etiqueta automática de risco:** 2 ou mais faltas entra em régua de confirmação reforçada.
6.5. **Etiqueta de inativo:** sem consulta há X dias, configurável por especialidade.
6.6. **Saldo de pacote:** sessões contratadas, usadas e restantes.
6.7. Vínculo com a conversa do WhatsApp.
6.8. Origem preservada desde o lead.
6.9. **Estado de consentimento visível na ficha** (opt-in ativo, origem do consentimento, data, opção de descadastrar).
6.10. **Não tem prontuário.** Decisão consciente: prontuário puxa responsabilidade de guarda e certificação. Vira argumento de posicionamento: "não substituímos seu sistema, nós enchemos a agenda dele".

---

### MÓDULO 7. FOLLOW-UP AUTOMÁTICO DE LEADS
**ICE: I=9, C=8, F=7**

**Dor:** *"Para cada pessoa a gente cria uma automação dentro do n8n."* Não escala.

7.1. **Réguas por etapa do funil**, não por pessoa.
7.2. Editor simples: gatilho, espera, mensagem, condição de parada. Parada automática quando o lead responde, agenda ou é marcado como perdido.
7.3. **Mensagem fixa OU delegada ao agente de IA** (pedido explícito da reunião).
7.4. Janela de envio permitida (não mandar às 23h, respeitar domingo).
7.5. **Alerta de custo:** quantas mensagens a régua dispara por mês e custo estimado.
7.6. **Bloqueio de envio para contato sem opt-in**, com contagem de quantos foram bloqueados.
7.7. Teste de envio para número interno antes de publicar.
7.8. Métricas por régua: enviadas, entregues, respondidas, agendadas, descadastros, custo.

---

### MÓDULO 8. CONFIRMAÇÃO DE CONSULTA
**ICE: I=10, C=9, F=7**

8.1. **Régua configurável por clínica.** Padrão sugerido `[PREMISSA]`: 72h, 24h e 3h antes. Não há benchmark que defina o número ideal de toques.
8.2. **Régua diferente por procedimento.** Procedimento com preparo recebe mais toques e a orientação junto. Justificativa: colonoscopia tem 41,3% de no-show contra 2,1% da média de exames no mesmo estudo.
8.3. **Régua reforçada automática para paciente com histórico de falta.**
8.4. **Template com botões de resposta rápida: Confirmar, Remarcar, Cancelar.** Não é estética, é margem: o toque no botão abre a janela de 24h e zera o custo do resto da conversa.
8.5. Resposta do paciente atualiza o status da agenda com autoria registrada.
8.6. **Cancelou pelo botão, dispara a lista de espera na hora** (Módulo 9).
8.7. **Painel de confirmações do dia seguinte:** confirmados, pendentes e cancelados, com botão de ligar ou cobrar manualmente. Primeira tela que a recepcionista abre de manhã.
8.8. **Régua pós falta (recuperação ativa):** paciente que faltou recebe contato automático em D+0 e D+2 oferecendo remarcação. Usa a mesma máquina de régua, custo marginal quase zero, e é o que impede o relatório de eficácia de mostrar falta sem ação associada.
8.9. Envio de orientação de preparo junto com a confirmação.
8.10. **Relatório de eficácia:** taxa de confirmação, no-show antes e depois, consultas recuperadas, receita recuperada. É a ferramenta de renovação do contrato.

---

### MÓDULO 9. LISTA DE ESPERA E REOFERTA
**ICE: I=9, C=7, F=7**

Não foi citada na reunião. Entra no V1 porque é o recurso de maior ROI da lista e porque a máquina de régua já está construída.

9.1. Fila por profissional e por procedimento, com preferência de turno e dias.
9.2. **Reoferta automática ao cancelar:** dispara para os N primeiros, e o primeiro que responder leva o horário.
9.3. Janela de resposta configurável (padrão de 30 minutos) antes de passar adiante.
9.4. Entrada na fila pela IA, pela recepção ou pelo próprio paciente na conversa.
9.5. **Métrica no dashboard:** horários recuperados no mês e receita associada.

---

### MÓDULO 10. DASHBOARD E ATRIBUIÇÃO DE ORIGEM
**ICE: I=8, C=8, F=7**

10.1. **Captura automática de origem** por parâmetro do link click-to-WhatsApp, mensagem padrão do anúncio, palavra-chave na primeira mensagem, ou pergunta da IA como último recurso.
10.2. **Taxonomia enxuta, padrão HubSpot e não GA4** (o GA4 tem 19 canais fixos e métricas de site inúteis para clínica): Tráfego pago, Busca orgânica, Redes sociais, Doctoralia e diretórios, Indicação de paciente, Retorno, Offline, Direto.
10.3. Detalhamento por campanha quando o parâmetro vier no link.
10.4. **Funil visual:** Leads, Agendamentos, Comparecimentos, com taxa entre etapas.
10.5. **Faixa de 4 indicadores:** Leads no período, Agendamentos, Comparecimentos, Taxa de lead para comparecimento.
10.6. **Barras horizontais por canal, ordenadas por volume.** Proibido pizza, rosca, barra empilhada, medidor e 3D, que a NN/g classifica como ruído e que estão entre os gráficos com maior taxa de erro de leitura.
10.7. Tabela com dimensão primária trocável por dropdown.
10.8. **Bloco de desempenho da IA:** conversas atendidas, percentual resolvido sem humano, tempo médio de primeira resposta, escalonamentos, agendamentos feitos pela IA.
10.9. **Bloco de custo:** mensagens enviadas, custo do mês, comparação com o teto.
10.10. Comparação com o período anterior.
10.11. Exportação em CSV e PDF.

---

### MÓDULO 11. CONFIGURAÇÕES, ACESSO E CONFORMIDADE
**ICE: I=7, C=10, F=8**

11.1. **Multi-tenant com isolamento de dados por clínica** (LGPD art. 11, § 4º, não é preferência técnica).
11.2. **White-label parametrizado no dia 1:** logo (versão clara e escura), cor primária, nome do produto, subdomínio, remetente de e-mail.
11.3. **Nomenclatura parametrizável:** "profissional" vira "advogado", "procedimento" vira "serviço", "paciente" vira "cliente". Rótulos em arquivo de tradução, nunca fixos no código.
11.4. **Perfis de acesso:** Administrador, Gestor, Recepção, Profissional, Somente leitura. Matriz de permissão por módulo e por ação.
11.5. **Conexão do WhatsApp via Cloud API oficial**, com assistente passo a passo. Não usar API não oficial, sob pena de banimento do número da clínica.
11.6. **Verificação de negócio na Meta como etapa obrigatória do onboarding** (destrava 6.000 templates contra 250).
11.7. **Gestão de templates** com contador por tenant e biblioteca de templates padrão reaproveitáveis.
11.8. **Teto de gasto de mensagens com pausa automática** e alertas em 50%, 80% e 95%.
11.9. **Gestão de consentimento (opt-in):** registro por contato com origem, canal e data. Botão de descadastro nos templates de marketing. Bloqueio de envio para contato sem consentimento.
11.10. **Trilha de auditoria:** quem acessou qual dado de paciente e quando.
11.11. Exportação e exclusão de dados do titular (LGPD, arts. 18 e 19).
11.12. Termo de uso e política de privacidade por clínica, com aceite registrado.
11.13. Retenção configurável de conversa.

---

### MÓDULO 12. ASSINATURA E COBRANÇA DO PRÓPRIO SAAS
**ICE: I=7, C=9, F=6**

Não estava previsto e vai doer no mês 3 se ficar de fora. Com 9 a 15 tenants, cobrança e suspensão viram planilha manual. E o benchmark mostra que "cobrança indevida" é a reclamação nº1 de Simples Dental (35,29%) e aparece em iClinic (8,11%).

12.1. Planos, ciclo de cobrança e período de teste.
12.2. Integração com gateway de pagamento (cartão recorrente e boleto ou Pix).
12.3. Régua de inadimplência com aviso e suspensão automática, mantendo os dados intactos.
12.4. Upgrade e downgrade de plano com cobrança proporcional.
12.5. **Cancelamento autoatendido** (é uma das quatro sustentações do preço premium).
12.6. Painel do dono do produto: tenants ativos, MRR, churn, inadimplência.

**Alternativa aceitável no V1:** declarar explicitamente que a cobrança será feita fora do sistema, por contrato direto, e adiar o módulo. Mas isso precisa estar escrito, não implícito.

---

### MÓDULO 13. INTEGRAÇÕES (V2)

13.1. Feegow (primeiro, API pública documentada).
13.2. Ninsaúde Apolo e Shosp (segundo, com ressalva de gating por plano no Shosp).
13.3. Docplanner e Trinks (terceiro, exigem acordo).
13.4. iClinic (só com acordo comercial com a Afya).
13.5. Google Calendar (leitura e escrita, cobre parte do iClinic por caminho indireto).
13.6. Webhook genérico de saída e n8n ou Zapier (cobre o resto do mercado sem custo de engenharia por parceiro).

**Regra de arquitetura obrigatória no V1:** modelar a agenda com camada de abstração de origem (`fonte: interna | externa`) desde já. Custo agora é baixo. Retrofit depois é reescrita da agenda inteira.

---

## 5. MODELO DE DADOS (mínimo do V1)

```
Tenant (clinica)
 |- Unidade
 |- Usuario (perfil, permissoes[])
 |- Branding (logo_claro, logo_escuro, cor_primaria, nomenclatura{})
 |- Assinatura (plano, ciclo, status, gateway_id)
 |- ConfiguracaoAgente (persona, habilidades[], horario, versao)
 |- BaseConhecimento (pergunta, resposta, arquivo)
 |- ContaWhatsApp (numero, status_verificacao, quality_rating, templates[])

Profissional
 |- conselho_tipo (livre), conselho_numero
 |- HorarioAtendimento (dia, inicio, fim, unidade)
 |- Bloqueio (inicio, fim, motivo, impede_encaixe)

Recurso (sala | cabine | equipamento, unidade_id)
Procedimento (duracao, preco_base, exige_avaliacao, agendavel_por_ia, preparo, recurso_id)
Pacote (procedimento_id, qtd_sessoes, preco, validade)
Convenio (nome, plano, exige_carteirinha)

VinculoAtendimento          <- a matriz de tres pontas
 |- profissional_id, procedimento_id, convenio_id (nulo = particular)
 |- preco, duracao, agendavel_por_ia, ativo

Contato                     <- entidade unica, evita duplicidade
 |- telefone (chave), nome, cpf, email
 |- origem, campanha, midia, data_entrada, metodo_captura
 |- tipo: lead | paciente
 |- etapa_funil, motivo_perda, tags[]
 |- Consentimento (canal, origem, data, ativo, data_revogacao)
 |- SaldoPacote (pacote_id, sessoes_usadas, sessoes_restantes)

Conversa
 |- contato_id, status (ia_atendendo | aguardando_humano | em_atendimento | resolvida)
 |- responsavel_id, janela_24h_expira_em, tags[]
 |- Mensagem (direcao, tipo, conteudo, autor: paciente|ia|usuario, custo, template_id)
 |- LogDecisaoIA (habilidade, consultou, motivo_escalonamento, bloqueio_conformidade)

Agendamento
 |- contato_id, vinculo_id, profissional_id, unidade_id, recurso_id
 |- inicio, fim, status, confirmado_por, canal_confirmacao
 |- fonte: interna | externa, id_externo
 |- HistoricoStatus (status, quem, quando)

ReservaTemporaria (slot, profissional_id, contato_id, expira_em)   <- trava de concorrencia

ListaEspera (contato_id, procedimento_id, profissional_id, preferencias, prioridade)

Regua (tipo: followup | confirmacao | pos_falta | reativacao)
 |- Passo (offset, template_id ou usar_ia, condicao_parada)
 |- Execucao (contato_id, passo_id, enviado_em, entregue, respondido, custo)

EventoAtribuicao (contato_id, canal, origem, midia, campanha, capturado_em, metodo)
LogAuditoria (usuario_id, acao, entidade, entidade_id, quando, ip)
```

---

## 6. CORTE DE ESCOPO: V1 CONTRA V2

**Critério:** entra no V1 só o que é necessário para a IA atender sozinha, agendar, confirmar, recuperar e provar o resultado.

### V1 (entra)

| Módulo | O que entra |
|---|---|
| 1. Inbox | Completo, com takeover, estados, contador de janela 24h, transcrição de áudio, log da IA |
| 2. Agente IA | Persona, conhecimento, habilidades, horário, simulador, guardrail de conformidade, versionamento |
| 3. Cadastro | Profissionais, horários, procedimentos, convênios, matriz de vínculo, recursos, pacotes, bloqueios, unidades |
| 4. Agenda | Visão dia multi profissional, visão semana individual, arrastar e soltar, 10 status, reserva temporária, log |
| 5. Leads | Lista e kanban, 6 etapas, filtros, motivo de perda, importação com opt-in |
| 6. Pacientes | Ficha, linha do tempo, indicadores, etiquetas de risco e inativo, saldo de pacote, consentimento |
| 7. Follow-up | Réguas por etapa, texto fixo ou IA, janela de envio, bloqueio sem opt-in, métricas |
| 8. Confirmação | Régua por clínica e por procedimento, botões de resposta rápida, painel do dia, régua pós falta, relatório de eficácia |
| 9. Lista de espera | Fila, reoferta automática ao cancelar, métrica de recuperação |
| 10. Dashboard | 4 indicadores, funil, origem por canal, desempenho da IA, custo |
| 11. Config | Multi-tenant, white-label, perfis, Cloud API, verificação Meta, templates, teto de gasto, opt-in, auditoria |
| 12. Assinatura | Planos, gateway, inadimplência, cancelamento autoatendido, painel do dono |

### V2 (não entra, e precisa estar escrito no contrato)

Integrações com PMS (Módulo 13), campanha de reativação de inativo, aplicativo móvel, teleconsulta, financeiro e faturamento de convênio, prontuário eletrônico, NPS pós consulta, agente de voz, canais adicionais (Instagram Direct, e-mail), relatório comparativo entre clínicas para a agência.

---

## 7. INFRAESTRUTURA, SEGURANÇA E MANUTENÇÃO

Pedido na reunião e ausente da versão anterior deste documento.

### 7.1 Infraestrutura

**Recomendação: VPS nova e dedicada, não reaproveitar a existente.** Na reunião foi dito, sobre a VPS atual: *"faz um tempo que a gente não faz um preventivo nele, pode ser que alguém esteja farmando bitcoin lá e a gente não sabe."* Isso, dito em voz alta sobre um servidor que vai hospedar dado de saúde de paciente, é motivo suficiente para não usar aquela máquina.

| Item | Recomendação | Justificativa |
|---|---|---|
| Servidor de produção | VPS dedicada, exclusiva do produto, em datacenter no Brasil | LGPD art. 33: manter o dado no país remove a discussão de transferência internacional para tudo que não seja o LLM |
| Ambiente de homologação | VPS menor, separada, com dados fictícios | Testar régua de mensagem em produção significa mandar mensagem errada para paciente real |
| Banco de dados | Instância gerenciada ou com backup automático diário, retenção de 30 dias, restauração testada | Backup que nunca foi restaurado não é backup |
| Domínio | Titularidade no CNPJ da dona do produto, definida em D1. Subdomínio por clínica para o white-label | Domínio no nome pessoal de um sócio ou do desenvolvedor é passivo jurídico |
| Certificado TLS | Automático, renovação monitorada | |
| Monitoramento | Disponibilidade, erro, fila de mensagens, quality rating da Meta por tenant | O quality rating cair é um incidente de produto, não de marketing |
| Logs | Retenção mínima de 6 meses, com trilha de acesso a dado de paciente | Exigência prática do RIPD |
| Auditoria da VPS atual | Fazer, independentemente da decisão acima | Se houver comprometimento, ele afeta os clientes atuais da agência hoje |

`[PENDENTE]` Dimensionamento e custo mensal de infraestrutura dependem do volume de conversas das 15 clínicas (P3).

### 7.2 Manutenção recorrente

`[PREMISSA]` Não há benchmark público de preço de manutenção nesse recorte. O que segue é recomendação de estrutura, não de valor.

A manutenção precisa ser vendida como contrato com escopo, não como "o que aparecer". Estrutura sugerida:

| Faixa | O que cobre |
|---|---|
| **Sustentação (base)** | Correção de defeito, atualização de dependência e de segurança, monitoramento, backup, suporte ao time da agência dentro do SLA |
| **Evolução (banco de horas)** | Melhoria e funcionalidade nova, consumida por hora, com saldo mensal e acúmulo limitado |
| **Fora do contrato** | Integração nova com PMS, novo nicho white-label, migração de infraestrutura |

**SLA precisa estar escrito em horas**, porque é a variável de maior correlação com recompra no benchmark do setor (Simples Dental responde em 14 horas e tem 100% de recompra; iClinic responde em 16 dias e 21 horas e tem 50%). Sugestão de três níveis: crítico (sistema fora ou WhatsApp desconectado) em 2 horas úteis, alto (funcionalidade principal quebrada) em 8 horas úteis, normal em 3 dias úteis.

**Atenção comercial:** o valor da manutenção é o que vai para o SEBRAE segundo o que foi combinado na reunião. Ele precisa ser definido junto com o valor de desenvolvimento, não depois, porque o subsídio incide sobre o valor cheio do projeto.

---

## 8. CRONOGRAMA

`[PREMISSA]` Estimativa a validar com o time que vai desenvolver. Premissa: 1 desenvolvedor full stack sênior em tempo integral mais 1 designer em tempo parcial nas 4 primeiras semanas. Com 2 desenvolvedores, as fases 2 a 5 podem correr em paralelo e o total cai para cerca de 13 semanas.

| Fase | Semanas | Entrega | Marco de aceite |
|---|---|---|---|
| **0. Design e arquitetura** | 1 a 3 | 14 telas em alta fidelidade (claro e escuro), modelo de dados aprovado, decisões D1 a D3 fechadas | Telas aprovadas pela Conduzza e por 1 recepcionista real |
| **1. Fundação e WhatsApp** | 3 a 7 | Multi-tenant, autenticação, perfis, white-label, conexão Cloud API, verificação Meta, templates, Inbox completo | Uma clínica real conversando pelo Inbox, com takeover funcionando |
| **2. Cadastro e Agenda** | 6 a 10 | Módulos 3 e 4, incluindo matriz de vínculo, recursos, pacotes e reserva temporária | Recepcionista marca, remarca e cancela sem apoio |
| **3. Agente de IA** | 9 a 13 | Módulo 2 completo, com simulador, guardrail de conformidade e log | Agente responde preço, convênio e agenda sozinho em 20 conversas de teste, com zero violação de conformidade |
| **4. Leads, Pacientes e Réguas** | 12 a 16 | Módulos 5, 6, 7, 8 e 9 | Régua de confirmação rodando com botões de resposta rápida e status atualizando sozinho |
| **5. Dashboard, Config e Assinatura** | 15 a 18 | Módulos 10, 11 e 12 | Relatório de eficácia gerando o número de consultas recuperadas |
| **6. Piloto e ajuste** | 18 a 21 | 2 clínicas em produção, medição de linha de base, correções | Verificação D+30 da Seção 11 |

**Total estimado: 21 semanas, cerca de 5 meses**, do design ao piloto medido.

**Regra de sequenciamento não negociável:** medir a linha de base de no-show da clínica piloto **antes** de ligar qualquer régua. Sem linha de base não existe prova de resultado, e sem prova de resultado o preço não se sustenta na renovação.

---

## 9. MATRIZ DE ACEITE

| # | Critério | Atende? | Prova |
|---|---|---|---|
| 1 | Cobre tudo que foi dito na reunião | ✓ | Fila noturna (M1), preço R$ 600-700 (2.3), nicho médico e estético (M3.1, 3.7, 3.8), white-label multi nicho (11.2 e 11.3), agente por clínica (M2), matriz de vínculo (M3.5), agenda própria (M4), iClinic e Feegow (2.2 e M13), leads separados de pacientes (M5 e M6), follow-up saindo do n8n (M7), confirmação configurável (M8.1), dashboard de origem (M10), API oficial (11.5), VPS e domínio (7.1), manutenção recorrente (7.2), SEBRAE (D2 e P2), cronograma (Seção 8) |
| 2 | Diz o que é V1 e o que é V2 | ✓ | Seção 6, com justificativa do corte |
| 3 | Benchmark como fonte primária | ✓ | Seção 2, três relatórios anexos com URL por afirmação |
| 4 | Todo número com memória de cálculo | ✓ | Seções 2.4 (ROI, com a fração exata) e 3 (MRR, déficit e equilíbrio nos dois preços) |
| 5 | Nenhum dado alucinado, e o que não tem fonte está marcado | ✓ | Régua de confiança no topo. Marcados como `[PREMISSA]`: adoção de 60%, custo de time de R$ 15.000, régua de 72h/24h/3h, estrutura e SLA de manutenção, cronograma. Marcados como `[PENDENTE]`: custo por mensagem, regras do SEBRAE, volume de conversas, tempo de recepção brasileira |
| 6 | Riscos nomeados | ✓ | Ficha de Entrega (3 riscos), Seção 3 (alerta comercial), 2.5 (restrições legais e de mensageria) |
| 7 | Recomendação acionável, nunca "depende" | ✓ | Dois planos definidos (R$ 597 e R$ 897), ordem de integração definida, corte de escopo definido, VPS nova recomendada, cronograma de 21 semanas |
| 8 | Pronto para virar tela sem retrabalho | ✓ | `02_brief_telas_claude_design.md`, **14 telas** com componentes, estados, matriz de permissão, breakpoints numéricos e paleta validada em contraste |
| 9 | Sem travessão no corpo do texto | ✓ | Varredura programática, zero ocorrências |
| 10 | Alerta sobre decisão de alto impacto | ✓ | Seção 3, decisões D1, D2 e D3 travando o início do design |
| 11 | Documento auditado por terceiro | ✓ | Auditoria adversarial rodada sobre a versão 1.0. Correções aplicadas: erro aritmético no ROI, tese factualmente errada sobre concorrência, contagem de telas, três provas falsas nesta própria matriz, ausência de cronograma, infraestrutura e manutenção, e cinco lacunas de produto (opt-in, cobrança, verificação Meta, trava de concorrência, recuperação de falta) |

**Nada passou por média.** As quatro pendências da Seção 10 estão declaradas, não escondidas.

---

## 10. PENDÊNCIAS

**P1. Custo variável por clínica não fechado.** Falta a tabela vigente de preço por mensagem da Meta no Brasil (utility e marketing, em BRL, 2026) e o custo de LLM por conversa. Sem esses dois números a margem bruta é chute. **Ação: levantar antes de precificar.**

**P2. Regras do SEBRAE não confirmadas.** Percentual real, teto por projeto, escopo elegível, e se o prestador precisa ser credenciado. **Ação: pedir o edital ou termo de aprovação ao cliente antes de embutir o subsídio na proposta.**

**P3. Volume de conversas atual das 15 clínicas.** Sem isso não dá para dimensionar infraestrutura nem custo de mensagem por cliente.

**P4. Decisão D1 (propriedade do produto) em aberto**, e ela determina titularidade de domínio, contrato de manutenção e modelo de receita.

---

## 11. VERIFICAÇÃO D+30

A entrega só conta quando o número se move.

| Métrica | Meta | Base |
|---|---|---|
| Conversas resolvidas sem humano | ≥ 45% no mês 1, ≥ 55% no mês 3 | Abaixo do estado da arte de propósito (Notable 57%, Artera 65%, Zocdoc até 70%). Prometer 65% no mês 3 é prometer o topo mundial na estreia |
| Tempo médio de primeira resposta | Definir na primeira semana de piloto | `[PENDENTE]` Sem âncora de benchmark. Medir a linha de base humana antes de estipular meta |
| Taxa de confirmação | Melhoria de ≥ 20 pontos percentuais contra a linha de base da clínica | Não existe patamar absoluto publicado. Só delta contra a própria clínica é honesto |
| Redução de no-show | ≥ 25% contra a linha de base | Piso da literatura é 29% (Hasvold). Meta abaixo do piso, de propósito |
| Horas de recepção liberadas | Medir, não estipular | `[PENDENTE]` O dado de 66 minutos por dia é por médico e é de overhead telefônico. Não existe equivalente publicado para recepção brasileira |
| Consultas recuperadas por lista de espera | ≥ 4 por mês por clínica | `[PREMISSA]` A validar no piloto |

**Regra:** medir a linha de base ANTES de ligar o sistema.
