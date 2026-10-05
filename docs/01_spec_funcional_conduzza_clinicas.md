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

   > **"Criar lembrete" é uma atividade (escopo acrescentado em 02/10/2026):** no painel de contexto da conversa, a seção **Atividades** mostra as pendentes do contato e cria uma atividade nova ("O que fazer", detalhes, para quando no fuso da clínica com hora opcional, responsável), que guarda a conversa de onde saiu. É a mesma atividade do drawer do lead, da ficha do paciente e da página Atividades (Módulo 15). Quem cria e conclui segue a matriz de Leads e Pacientes: administrador, gestor e recepção; profissional e leitura só veem.

1.10. Notas internas (nunca visíveis ao paciente).
1.11. Respostas rápidas salvas.

   > **Mensagens padrão (escopo da spec construído em 02/10/2026):** na tela se chamam **"Mensagens padrão"** (para não confundir com os "Modelos de mensagem" da Meta). São da clínica, cadastradas por **administrador e gestor** em Configurações, **só texto** (decisão do dono em 02/10), com título, atalho (letras minúsculas, números e sublinhado, até 30), texto até 4096 caracteres com os campos `{{nome}}` e `{{clinica}}`, ativa ou desativada e uma ordem. No Atendimento, na resposta ao paciente (não na nota interna), quem pode responder digita **"/"** no começo de uma palavra e a lista abre filtrada pelo atalho e pelo título (no máximo 8 itens); o botão "Mensagens padrão" da barra abre a mesma lista. A escolhida entra no campo já com o nome do contato e o nome da clínica, **editável**, e **nunca é enviada sozinha**: passa pelo Enviar como qualquer mensagem humana (autorização para receber mensagens, custo e trilha de sempre). Contato sem nome: o nome sai do texto. Anexo fica para depois. O filtro de conformidade (2.8) ainda não existe; a regra "Nenhuma mensagem sai sem passar pelo filtro" (Regras, abaixo) contra a mensagem humana é ponto aberto para o dono, registrado no backlog (entrada de 02/10/2026).

1.12. Envio de mídia: imagem, áudio, documento.
1.13. **Indicador de janela de 24h com contador regressivo.** Fora da janela, o compositor bloqueia texto livre e exige template.
1.14. Histórico completo pesquisável.

   > **Mensagem enviada pelo celular aparece na conversa (pedido do dono em 05/10/2026):** o que a equipe manda direto pelo WhatsApp do número conectado (no celular, no WhatsApp Web ou em outro aparelho vinculado), sem passar pelo sistema, entra na conversa daquele número como mensagem enviada, com a linha **"Pelo WhatsApp"** e o ícone de celular no lugar do nome de quem enviou (o sistema não sabe quem digitou). Texto, foto, áudio, documento, figurinha e citação entram; reação e edição feitas no celular não (o texto fica o original). Vale só para **contato que já existe** na clínica: mensagem para um número que não está no sistema não cria contato, lead nem conversa (decisão padrão, aberta ao dono). Mensagem para outro número conectado da própria clínica, ou de outra clínica do Conduzza, também fica de fora (a do Conduzza fica com quem recebeu). A mensagem do celular **não custa nada** (custo zero, não cobrável), não mexe na autorização para receber mensagens e não pede nada ao uazapi além do que ele já entrega: o evento de mensagens que o webhook já assina traz o que sai do aparelho. Ela tira a conversa de "Aguardando você", como a resposta pelo Atendimento; a **resposta automática do app WhatsApp Business** (saudação, ausência), reconhecida por sair até 8 segundos depois da mensagem do paciente, aparece na conversa igual, mas não tira da espera nem conta como resposta da equipe nas métricas.
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
3.3. **Procedimentos:** nome, descrição, duração padrão, preço particular, exige avaliação prévia, orientação de preparo, agendável pela IA, **recurso necessário** (sala, cabine, equipamento). Desde 29/09/2026 o campo "recurso necessário" não aparece mais na tela (ver 3.7).
3.4. **Convênios:** nome, plano, carteirinha obrigatória, observações. Desde 02/10/2026 a clínica cadastra aqui todos os convênios e marca **quais cada profissional atende** (no cadastro do profissional) e **quais cobrem cada procedimento** (no cadastro do procedimento), ver 3.5.
3.5. **A matriz de vínculo** (o item mais enfatizado na reunião): relação de três pontas entre profissional, procedimento e convênio, cada combinação com preço e duração próprios.

   Exemplo que precisa funcionar: Dr. João, Endocrinologia, particular R$ 400, 40 min, atende Unimed e Bradesco. O mesmo Dr. João, Nutrologia, particular R$ 500, 60 min, só particular.

   > **Onde fica (decisão do dono em 29/09/2026):** a função continua a mesma, o lugar mudou. A matriz é feita **dentro do cadastro do Procedimento**, na seção "Quem faz e convênios": quem faz (vários profissionais), convênios aceitos (Particular sempre disponível), o preço e a duração do procedimento como padrão e a exceção por profissional ou convênio (preço próprio, "Coberto" ou duração própria) ali mesmo. "Agendável pela IA" é a chave do procedimento, e o vínculo segue essa chave (uma fonte só). Vínculo que já tem consulta é desativado, nunca apagado. A tela própria de vínculos saiu de Cadastros. O exemplo do Dr. João continua sendo o aceite, agora cadastrado pelo Procedimento.

   > **Convênio pelo médico (decisão do dono em 02/10/2026):** "O plano de saúde depende do médico: a gente cadastra todos os planos e, na hora de criar o médico, adiciona quais ele atende." A matriz continua a mesma (profissional, procedimento e convênio, com preço e duração) e continua sendo a fonte da agenda, da IA, do preço e das conversões. O que muda é **de onde vem o convênio** de cada combinação:
   > - **O profissional diz quais convênios atende** ("Convênios que atende", no cadastro do profissional). O Particular vale sempre e não é marcado.
   > - **O procedimento diz quais convênios o cobrem** ("Convênios que cobrem este procedimento", no cadastro do procedimento). Nem todo convênio cobre todo procedimento: procedimento sem nenhum é só Particular (ex.: Botox).
   > - **O convênio do profissional entra sozinho só onde ele faz o procedimento e o convênio cobre.** Marcar um convênio no profissional cria, em cada procedimento que ele faz e que o convênio cobre, a combinação "Coberto" com a duração do procedimento (se a combinação já existiu e foi desativada, ela volta com o preço e a duração que tinha). Marcar um convênio em "Convênios que cobrem" deixa o convênio já marcado, em "Quem faz e convênios", para cada profissional que faz o procedimento e atende o convênio.
   > - **O cadastro do profissional é o padrão; a exceção é por procedimento.** No procedimento, os convênios do profissional vêm marcados e dá para desmarcar só ali. A exceção fica enquanto o convênio não mudar; ela só deixa de valer quando o convênio é desmarcado e marcado de novo, e salvo, no profissional ou em "Convênios que cobrem". Preço próprio, "Coberto" e duração continuam por profissional e convênio, no procedimento. O Particular também pode ser desmarcado por procedimento, como antes.
   > - **Desmarcar um convênio** (no profissional ou no procedimento) desativa as combinações dele, nunca apaga: a consulta já marcada continua valendo. Antes de gravar, a tela diz quantas consultas futuras estão nessas combinações (e quando é a primeira) e só grava com a confirmação. Se o profissional só fazia um procedimento por aquele convênio, ele **deixa de fazer** o procedimento, também com confirmação antes; marcar o convênio de novo no profissional não o devolve ao procedimento (para voltar, inclui-se o profissional em "Quem faz", no procedimento).
   > - **Convênio desativado não entra** em lugar nenhum; se já estava marcado, continua à vista, com a situação "Inativo", e pode ser desmarcado.
   > - **Cadastro aberto em duas abas:** se o cadastro mudou enquanto alguém editava, o Salvar é recusado e pede para fechar, abrir de novo e salvar (antes, a última gravação vencia).
   > - **A Agenda não marca consulta nova numa combinação que acabou de sair** (outra tela tirou o convênio enquanto a Agenda estava aberta); a remarcação com o mesmo profissional mantém a combinação da consulta já marcada.
   > - **No dia da publicação nada muda na tela nem na agenda:** a carga inicial copia para os dois cadastros os convênios das combinações ativas de hoje.
   >
   > O aceite continua o do Dr. João, agora pelos dois cadastros: ele atende Unimed e Bradesco; Endocrinologia, coberta pelos dois, fica com particular R$ 400 e 40 min, mais Unimed e Bradesco; Nutrologia fica só particular, R$ 500 e 60 min, porque nenhum convênio a cobre ou, se a Unimed cobrir a Nutrologia, porque a Unimed foi desmarcada para ele só nesse procedimento (a exceção). Escolhas assumidas na recomendação do levantamento, que o dono pode rever, e o que ficou de fora: backlog, entrada "Convênio pelo médico".

3.6. **Unidades.**
3.7. **Recursos** (sala, cabine, equipamento). Exigência do nicho de estética: dois procedimentos podem precisar do mesmo aparelho de laser e não podem ser marcados no mesmo horário mesmo com profissionais diferentes.

   > **Onde fica (decisão do dono em 29/09/2026):** os recursos continuam no banco, com a **trava contra uso duplo mantida** (exclusion constraint por recurso, ver 4.8), mas **saíram da tela**: não há mais cadastro de recursos nem o campo "recurso necessário" no procedimento. Consequência: por enquanto uma clínica não configura recurso novo pela interface, e o caso do laser só é protegido para o que já estava gravado. Voltar a ter tela é decisão do dono.

3.8. **Pacotes de sessões:** procedimento vendido em N sessões, com controle de sessões usadas e restantes por paciente. Sem isso o produto não atende metade do nicho de estética declarado na reunião.

   > **Pacote com vários procedimentos (decisão do dono em 29/09/2026):** um pacote tem **nome** e junta **um ou mais procedimentos, cada um com as suas sessões** (ex.: "Harmonização" com Botox 2 sessões + Facelift 1 sessão). O cadastro mostra o **preço avulso** (soma de sessões x preço base de cada procedimento, calculado na hora e nunca gravado; com procedimento sem preço base a soma é dada como incompleta) ao lado do **preço do pacote** (o valor que a clínica define), com o desconto em porcentagem; pacote mais caro que o avulso aparece como acréscimo, nunca escondido. Regras: a **validade é do pacote**, não de cada procedimento; o **mesmo procedimento aparece uma vez só** no pacote; o **saldo vendido é por procedimento**; o preço do pacote **não é distribuído** entre os procedimentos. A sessão continua sendo descontada **só no Compareceu**: o procedimento da consulta casa com o saldo do mesmo procedimento do paciente, dentro da validade, com sessão sobrando, do pacote que vence primeiro (sem validade por último; no empate, o vendido antes). Pacote **já vendido** não muda os procedimentos nem as sessões (para mudar, cria-se um pacote novo); nome, preço, validade e "à venda" continuam editáveis.
3.9. **Bloqueios como entidade própria** (férias, congresso, almoço), criáveis em lote, com opção de impedir encaixe. Nunca agendamento falso.

   > **Onde fica (decisão do dono em 29/09/2026):** a função continua a mesma (entidade própria, em lote para vários profissionais, com opção de impedir encaixe), o lugar mudou: o bloqueio é **ação da Agenda** (Módulo 4). Cria pelo botão "Bloquear horário" da barra ou por "Bloquear este horário" no modal aberto pelo clique num horário vazio, e remove pela faixa do bloqueio na grade. Se já houver consultas no período, a tela avisa e só cria com confirmação explícita; o bloqueio não desmarca nada. A tela própria de bloqueios saiu de Cadastros.

   > **Consulta dentro do bloqueio (02/10/2026):** consulta comum não entra em horário bloqueado (o servidor recusa); encaixe entra só em bloqueio que permite encaixe ("Impedir encaixe" desmarcado).

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
4.8. **Verificação de disponibilidade de recurso** (sala, equipamento) no momento da marcação. A trava é do banco e continua valendo; desde 29/09/2026 os recursos não têm tela (ver 3.7).
4.9. Impressão e exportação da agenda do dia.
4.10. **Log de alterações** (quem mudou o quê e quando).

---

### MÓDULO 5. LEADS
**ICE: I=9, C=9, F=8**

**Dor:** *"CRM, mas sem campanha, sem muita complexidade para mexer, somente de dados."*

5.1. Base de leads separada da base de pacientes (decisão da reunião, e está correta).
5.2. **Lista e Kanban do mesmo dado, com toggle preservando o filtro.**
5.3. **Etapas padrão (editáveis):** Novo, Em contato, Aguardando resposta, Agendou, **Compareceu**, Perdido. A etapa Compareceu é o que o produto vende, não pode faltar no funil.

   > **Jornada da clínica (09/09/2026) e o que mudou em 02/10/2026.** As etapas são dados de cada clínica (tela "Jornada e conversões", em Configurações), e uma etapa pode ter **termos-chave**: quando um termo aparece na mensagem, o contato anda sozinho para a etapa (o termo mais longo vence, só para frente na jornada, nunca entra nem sai de Perdido). Desde 02/10/2026 (pedido do dono), cada etapa diz **quem escreve o termo**: **Paciente** (a mensagem que chega dele; o padrão, e o comportamento de toda etapa que já existia), **Clínica** (o texto ou a legenda de arquivo que a equipe envia pelo Atendimento, ou o que ela escreve no celular conectado) ou **Qualquer um**. A mesma regra vale para os dois lados. Cada mensagem do celular conectado anda o lead uma vez só (a reentrega do provedor não move de novo), e as mensagens da IA e da régua de follow-up não andam o lead por termo da clínica. Também desde 02/10, cada etapa pode ter uma **descrição** de até 140 caracteres, que aparece no Kanban logo abaixo do nome da coluna (nunca no cartão).

5.4. **Cartão de lead com no máximo 5 elementos:** nome, telefone, badge de origem, badge de tempo desde o último contato, avatar do responsável. A descrição da etapa e as atividades do lead (02/10/2026) não entram no cartão: ficam no cabeçalho da coluna e no drawer.
5.5. **Badge de tempo com cor, ícone e rótulo:** verde até 4h, âmbar de 4h a 24h, vermelho acima de 24h.
5.6. **Ordenação padrão por próxima ação**, não por data de criação.
5.7. Filtros: origem, etapa, responsável, período, procedimento de interesse.
5.8. Ações em massa: reatribuir, mudar etapa, etiquetar, disparar régua.
5.9. **Motivo de perda obrigatório** (preço, distância, horário, não respondeu, agendou em outro lugar).
5.10. Criação manual de lead.
5.11. **Importação por planilha com captura obrigatória de opt-in.** A tela exige que o gestor declare de onde veio o consentimento antes de permitir qualquer disparo para a base importada.
5.12. Conversão para paciente automática ao criar o agendamento, preservando o histórico do lead.

   > **Desde 02/10/2026:** o lead pode ser movido de etapa, etiquetado, ganhar atividade ou nota interna por uma **automação de fluxo** da clínica (Módulo 14). O drawer do lead ganhou a seção **Atividades** (Módulo 15). O "Mudar etapa" em massa avisa que mover também pode disparar as automações de fluxo da etapa de destino, para cada lead.

---

### MÓDULO 6. PACIENTES
**ICE: I=8, C=9, F=8**

6.1. Ficha com dados cadastrais, convênio, carteirinha, observações.
6.2. **Linha do tempo de agendamentos** com status de comparecimento.
6.3. **Indicadores automáticos:** total de consultas, total de faltas, taxa de comparecimento, dias desde a última consulta, valor total gerado.
6.4. **Etiqueta automática de risco:** 2 ou mais faltas entra em régua de confirmação reforçada.
6.5. **Etiqueta de inativo:** sem consulta há X dias, configurável por especialidade.
6.6. **Saldo de pacote:** sessões contratadas, usadas e restantes. Desde 29/09/2026 (pacote com vários procedimentos, ver 3.8), a ficha mostra **um cartão por venda**, com o nome do pacote, a validade da venda e **uma barra de sessões por procedimento**. A venda escolhe o pacote pelo nome e mostra o que ele inclui; o pacote em andamento (comprado antes do sistema) pede as sessões já usadas **de cada procedimento** e a data de início; o ajuste corrige as sessões usadas de cada procedimento e a validade, com um motivo só; o cancelamento é da venda inteira. A lista de pacientes e o filtro "Com pacote" somam as sessões restantes de todos os procedimentos dentro da validade.
6.7. Vínculo com a conversa do WhatsApp.
6.8. Origem preservada desde o lead.
6.9. **Estado de consentimento visível na ficha** (opt-in ativo, origem do consentimento, data, opção de descadastrar).
6.10. **Não tem prontuário.** Decisão consciente: prontuário puxa responsabilidade de guarda e certificação. Vira argumento de posicionamento: "não substituímos seu sistema, nós enchemos a agenda dele".

   > **Atividades na ficha (02/10/2026):** a ficha do paciente tem o cartão **Atividades**, com todas as pendentes e as últimas 5 concluídas, e cria atividade nova (Módulo 15). Atividade não é prontuário: é o que a equipe precisa fazer (ligar, retornar, conferir), com prazo e responsável.

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

   > **Follow-up e automações de fluxo (02/10/2026):** "quando o lead entrar na etapa, enviar mensagem" continua sendo a régua de follow-up da etapa (passo com espera zero), com janela de envio, autorização, número por tipo e métricas. As **automações de fluxo** (Módulo 14) **nunca** enviam mensagem ao paciente (decisão do dono em 02/10): elas movem de etapa, etiquetam, criam atividade ou deixam nota interna, e a tela delas leva até o follow-up. Mover o lead para fora de uma etapa, por pessoa ou por automação, encerra o follow-up daquela etapa.

---

### MÓDULO 8. CONFIRMAÇÃO DE CONSULTA
**ICE: I=10, C=9, F=7**

8.1. **Régua configurável por clínica.** Padrão sugerido `[PREMISSA]`: 72h, 24h e 3h antes. Não há benchmark que defina o número ideal de toques.
8.2. **Régua diferente por procedimento.** Procedimento com preparo recebe mais toques e a orientação junto. Justificativa: colonoscopia tem 41,3% de no-show contra 2,1% da média de exames no mesmo estudo.

   > **Régua vinculada (decisão do dono em 29/09/2026):** a régua de confirmação e a régua pós falta (8.8) podem ser vinculadas a **um médico, a uma especialidade ou a um procedimento**, um vínculo só por régua. Sem vínculo, é a **régua geral**. A especialidade é escolhida da lista das especialidades que os profissionais ativos já têm. Quando mais de uma régua ligada vale para a consulta, **a mais específica vence**: procedimento, depois médico, depois especialidade, depois a geral. Régua desligada não conta, e a consulta cai para a próxima que vale para ela. Dentro do mesmo nível, a reforçada (8.3) vence a comum para o paciente com histórico de falta. Se a régua que vale para a consulta muda no meio da sequência (troca de médico, régua mais específica ligada depois), os toques pendentes da régua antiga não saem.
8.3. **Régua reforçada automática para paciente com histórico de falta.**
8.4. **Template com botões de resposta rápida: Confirmar, Remarcar, Cancelar.** Não é estética, é margem: o toque no botão abre a janela de 24h e zera o custo do resto da conversa.
8.5. Resposta do paciente atualiza o status da agenda com autoria registrada.
8.6. **Cancelou pelo botão, dispara a lista de espera na hora** (Módulo 9).
8.7. **Painel de confirmações do dia seguinte:** confirmados, pendentes e cancelados, com botão de ligar ou cobrar manualmente. Primeira tela que a recepcionista abre de manhã.
8.8. **Régua pós falta (recuperação ativa):** paciente que faltou recebe contato automático em D+0 e D+2 oferecendo remarcação. Usa a mesma máquina de régua, custo marginal quase zero, e é o que impede o relatório de eficácia de mostrar falta sem ação associada. Desde 29/09/2026 também aceita régua vinculada a médico, especialidade ou procedimento, com a mesma precedência da confirmação (ver 8.2).
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

10.1. **Captura automática de origem** pelo anúncio de clique para WhatsApp da Meta, por parâmetro do link click-to-WhatsApp, pelo clique rastreado no site da clínica (anúncio do Google, 10.13), mensagem padrão do anúncio, palavra-chave na primeira mensagem, ou pergunta da IA como último recurso. Precedência: o anúncio da Meta vence o código do link, que vence o clique do site, que vence a mensagem padrão, que vence a palavra-chave. Depois de gravada, a origem não muda mais.
   - **Anúncio da Meta (Click-to-WhatsApp)** (decisão do dono D3 em 04/10/2026, "tire realmente da Meta"; construído e publicado em 04/10/2026): o canal do WhatsApp entrega o clique e o id do anúncio, nunca o nome da campanha nem o do conjunto. O lead nasce com canal Tráfego pago, origem Meta, a plataforma (Facebook ou Instagram) quando o canal informar, e método "Anúncio de clique para WhatsApp". A campanha e o conjunto são buscados na conta de anúncios da clínica (11.14) pelo id do anúncio, inclusive o anúncio sem gasto lido, arquivado ou apagado. Eles **nunca** são gravados como texto no contato: a fonte única é o mapa de anúncios da clínica, casado pelo id. Sem conta de anúncios e token de leitura configurados, o lead mostra "Campanha da Meta ainda não identificada". Não há cadastro manual de campanha (decisão D1 do dono, 04/10/2026).
   - A origem de anúncio só é gravada com prova de anúncio: o canal informou que é anúncio ou, sem essa informação, veio o id do clique. O clique numa publicação (post) com botão de WhatsApp não vira Tráfego pago e fica sem origem. O contato que já tem origem (manual, importação ou código de link) fica como está.
   - **Google Ads:** a mensagem do WhatsApp não traz marca nenhuma do anúncio do Google. Resposta do dono em 04/10/2026: o anúncio do Google leva ao **site** da clínica, e a origem e a campanha têm de vir do próprio Google, sem cadastro manual. O caminho é o clique rastreado pelo site (10.13; construído em 04/10/2026, ainda não aplicado no banco nem publicado). Sem a linha do site, ou com o rastreio desligado, o lead do Google só ganha origem pelos caminhos de texto acima. O nome da campanha e o investimento do Google dependem da conexão com o Google Ads (backlog, entrada "Origem e campanha do Google Ads", F2), que espera decisões do dono.
10.2. **Taxonomia enxuta, padrão HubSpot e não GA4** (o GA4 tem 19 canais fixos e métricas de site inúteis para clínica): Tráfego pago, Busca orgânica, Redes sociais, Doctoralia e diretórios, Indicação de paciente, Retorno, Offline, Direto.
10.3. Detalhamento por campanha quando o parâmetro vier no link. No anúncio do Google que leva ao site, o número da campanha vem do próprio clique (o `gad_campaignid` que o Google acrescenta ao endereço, ou o sufixo de URL final que a clínica põe no Google Ads, que vence quando os dois vêm), e o lead mostra "Campanha do Google {número}" até a conexão com o Google Ads trazer o nome (10.13).
10.4. **Funil visual:** Leads, Agendamentos, Comparecimentos, com taxa entre etapas.
10.5. **Faixa de 4 indicadores:** Leads no período, Agendamentos, Comparecimentos, Taxa de lead para comparecimento.
10.6. **Barras horizontais por canal, ordenadas por volume.** Proibido pizza, rosca, barra empilhada, medidor e 3D, que a NN/g classifica como ruído e que estão entre os gráficos com maior taxa de erro de leitura.
10.7. Tabela com dimensão primária trocável por dropdown.
10.8. **Bloco de desempenho da IA:** conversas atendidas, percentual resolvido sem humano, tempo médio de primeira resposta, escalonamentos, agendamentos feitos pela IA.
10.9. **Bloco de custo:** mensagens enviadas, custo do mês, comparação com o teto.
10.10. Comparação com o período anterior.
10.11. Exportação em CSV e PDF.
10.12. **Investimento em anúncio e custo por lead** (escopo decidido pelo dono em 29/09/2026; construído e publicado em 03/10/2026 na Fase 4 das métricas). O investimento é lido sozinho da conta de anúncios da Meta da clínica (11.14): por anúncio e por dia, mais o total da conta por dia.
   - **Quando lê:** uma vez por dia, a partir das 06:00 no fuso da clínica; logo depois de um teste de leitura que dá certo; e quando administrador ou gestor pede "Atualizar agora" em Configurações (no máximo um pedido a cada 10 minutos). Cada leitura regrava os últimos 30 dias, porque a Meta ainda ajusta o gasto até 28 dias depois. A primeira leitura, a de uma conta nova e a da volta depois de mais de 30 dias parada leem 60 dias (backlog D4; o dono manteve assim em 04/10/2026).
   - **Fuso:** os dias do investimento são os da conta de anúncios, que é como a Meta entrega. Quando o fuso da conta tem outro horário que o da clínica, a tela avisa.
   - **Ligação com o lead só por identificador, nunca por nome:** o anúncio de onde o lead veio (capturado do clique no anúncio Click-to-WhatsApp) e, sem ele, o id da campanha. A campanha de cada anúncio vem dos dados da própria Meta: da leitura do investimento e, desde 04/10/2026, também da consulta do anúncio pelo id (10.1), que cobre o anúncio sem gasto lido. O primeiro anúncio vence: um clique seguinte em outro anúncio não muda a campanha do lead. O lead que chega por link com código ou palavra-chave não é ligado ao investimento e entra em Campanhas como campanha fora da Meta, sem investimento (backlog D1: o dono decidiu em 04/10/2026 que não haverá cadastro manual de campanhas).
   - **Custo por lead** = investimento total da conta no período ÷ leads de anúncio do período, isto é, os que chegaram com o clique do anúncio ou com o id do anúncio ou da campanha (backlog D2; o dono manteve assim em 04/10/2026; trocar o divisor é trocar uma constante). Só há número quando o período inteiro foi lido e a conta é em real; senão a tela diz "Ainda não medido" e o porquê. Conta em outra moeda nunca é convertida.
   - **Tabela de campanhas:** por campanha da Meta, investimento, leads, custo por lead, agendados e conversão. A campanha da clínica que não é da Meta (nome digitado ou importado) conta leads, sem investimento. Embaixo, as linhas de conferência: o investimento que não casou com lead nenhum, os leads sem campanha e os leads de anúncio sem campanha reconhecida.
   - **Valores em reais só para administrador e gestor**, no banco e na tela. As contagens de leads são as mesmas para todo papel.
   - Ler o investimento não envia dado de paciente à Meta: a leitura só pede números da conta de anúncios.
   - **Origem gravada do lead de anúncio** (backlog D3, respondida pelo dono em 04/10/2026; construída e publicada em 04/10/2026): o lead de anúncio ganha canal Tráfego pago, origem Meta, plataforma quando o canal informar e método "Anúncio de clique para WhatsApp" (10.1), e passa a contar em Tráfego pago na Origem dos leads e no detalhe por canal. Os contatos que já tinham chegado com o clique do anúncio (8 de uma clínica) foram corrigidos uma vez, sem plataforma, quando a mudança foi aplicada no banco.
   - **Google** (04/10/2026): o lead do clique no site (10.13) **não** entra no divisor do custo por lead da Meta, porque o Google nunca grava o clique, o anúncio nem a campanha da Meta no contato. Resposta do dono em 04/10/2026: o investimento do Google entra no custo por lead **separado por plataforma**; é a F2 do backlog (conexão com o Google Ads), que depende de decisões do dono e ainda não foi construída. Até lá, Resultados não muda: o lead do Google conta em Tráfego pago na Origem dos leads e, em Campanhas, entra em "Leads sem campanha".
10.13. **Clique rastreado pelo site (anúncio do Google)** (pedido do dono em 04/10/2026: o anúncio do Google leva ao site da clínica, e a origem e a campanha vêm do Google, sem cadastro manual; construído em 04/10/2026, migration ainda não aplicada e nada publicado; backlog, entrada "Origem e campanha do Google Ads", F1). Não usa credencial nenhuma do Google.
   - **Como funciona:** a clínica liga o rastreio em Configurações (11.15) e cola uma linha de script em todas as páginas do site. A linha só age em visita que veio de anúncio do Google (o endereço traz `gclid`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid` ou o sufixo `cz_campanha` e `cz_grupo`); o sinal vale também nas páginas seguintes da mesma aba. No toque no botão do WhatsApp do site (link `wa.me` seguido do número, `api.whatsapp.com/send`, `web.whatsapp.com/send` ou `whatsapp://send`), ela acrescenta ao texto da mensagem um código novo por clique, no mesmo formato do código do link (" [#K7Q2MX]"), e avisa o sistema. Botão sem texto pronto leva "Olá! [#código]" (texto provisório, a confirmar pelo dono). Texto que já tem um código do link não é tocado: o código do link vence. A pessoa vai direto ao WhatsApp, sem passar por endereço do Conduzza: se o sistema estiver fora do ar, só a atribuição se perde. O endereço do Conduzza nunca vai no anúncio.
   - **Quando a mensagem chega com o código:** o contato ganha canal Tráfego pago, origem Google, método "Clique no site" e o número da campanha e o do grupo de anúncios do Google, quando o clique os trouxe. Meio e campanha em texto ficam vazios; o nome da campanha só chega com a conexão com o Google Ads.
   - **Regras:** cada código vale **7 dias**, só na mesma clínica, e serve uma vez só (uma mensagem encaminhada com um código já usado não casa). O anúncio da Meta e o código do link vencem o clique do site. Quem já tem origem, ou já tem sinal de anúncio da Meta, só ganha o vínculo com o clique, e a origem não muda. Contato antigo ainda sem origem ganha a do clique numa mensagem posterior com o código. Clique que não serve (rastreio desligado, aviso que não chegou, limite, mais de 7 dias) segue a precedência de sempre: no contato novo, a mensagem padrão (comparando o texto também sem o código) e depois a palavra-chave. Se o banco falhar ao casar o código, a origem fica vazia.
   - **Se a pessoa apagar o código antes de enviar**, o lead chega sem a origem do Google (vale a precedência de sempre e, sem outro sinal, fica sem origem), e a recepção pode preencher depois. O rastreio nunca grava uma origem errada.
   - **Privacidade:** o clique guarda só o código, os identificadores do Google (gclid, gbraid e wbraid), o número da campanha e do grupo e o endereço do site (só o domínio), nunca IP, navegador ou a página visitada. Os cliques só o sistema lê. Clique não usado é apagado 1 dia depois de vencer (8 dias depois do clique); no clique usado, gclid, gbraid e wbraid são apagados 90 dias depois do clique (recomendação da crítica de 04/10/2026, a confirmar pelo dono). Nada é enviado ao Google: devolver a conversão pelo gclid continua dependendo da D6 de LGPD.
   - **Limites por clínica:** 30 cliques por minuto e até 2.000 cliques ainda não usados guardados; cheio, sai o que vence primeiro.
   - **Limitações conhecidas:** botão que abre o WhatsApp por JavaScript, link curto do WhatsApp Business (`wa.me/message/...`) e encurtadores não recebem o código; texto pronto do botão com uma hashtag que parece código (como "#agendar") também não, porque é tratado como código do link; no iPhone pode não vir gclid (fica o `gad_campaignid`); site que recusa parâmetro desconhecido no endereço; que o `gad_campaignid` seja igual ao número da campanha no Google Ads ainda precisa ser conferido no primeiro clique real.

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
11.14. **Conta de anúncios da Meta e token de leitura** (aba Anúncios da Meta; a leitura do investimento foi construída em 03/10/2026, Fase 4 das métricas). Uma conta de anúncios por clínica, gravada sempre como `act_` seguido dos números: a tela aceita só os números, com ou sem act_ na frente, e o link do Gerenciador de Anúncios. A mesma conta serve à devolução de conversões e à leitura do investimento (10.12).
   - O **token de leitura de anúncios** (permissão ads_read na conta) é um segredo próprio, separado do token da API de conversões. Pode ser o mesmo valor, se esse token tiver a permissão. Só se cola: nunca volta para a tela nem para log, e só o servidor o lê.
   - **"Testar leitura"** confere na hora o token e a conta, e mostra o nome da conta, a moeda e os avisos (outra moeda, conta inativa, fuso com outro horário). Salvar um token novo testa em seguida.
   - Se a Meta recusa o token, a permissão ou a conta, a leitura diária para até o teste dar certo, um token novo ser salvo ou a conta mudar.
   - **A mesma conta e o mesmo token buscam a campanha e o conjunto dos anúncios de onde os leads vieram** (10.1; construído e publicado em 04/10/2026). A busca roda sozinha quando chega o primeiro clique de um anúncio, ao fim de cada leitura do investimento que dá certo e depois de um "Testar leitura" que dá certo; a tela não muda. A recusa de um anúncio só (de outra conta, de uma agência, ainda sem entrega) fica registrada só para aquele anúncio e não pausa a leitura diária; a leitura só para, como acima, quando a própria conta salva também é recusada (regra a confirmar pelo dono, backlog). O anúncio recusado por acesso ou por ser de outra conta só é buscado de novo quando a conta ou o token mudam.
   - Administrador e gestor. Salvar, testar, remover o token e pedir atualização vão para a trilha de auditoria, sem o valor do token.
   - **Conectar com a Meta** (pedido do dono em 04/10/2026: o token resolvido pelo próprio sistema, sem colar): é a F3 do backlog (entrada "Origem e campanha do Google Ads"), ainda não construída. Depende das decisões do dono e do passo a passo dele na Meta (verificação da empresa, aplicativo, revisão do aplicativo). Até lá, o token continua só colado, como acima.
11.15. **Anúncios do Google** (aba de Configurações; F1 construída em 04/10/2026, publicação pendente; 10.13).
   - **Rastreio do site:** ligar e desligar; a linha de script pronta para copiar e colar no site; "Gerar nova chave"; a situação só com totais (último clique recebido, cliques e quantos chegaram ao WhatsApp nos últimos 7 dias); e o passo a passo de instalação no site e no Google Ads (marcação automática ligada e o sufixo de URL final `cz_campanha={campaignid}&cz_grupo={adgroupid}`, para copiar).
   - **A chave do site** é pública (vai no código da página) e só serve para achar a clínica: nunca é o identificador da clínica no sistema (slug) nem o código de cadastro, que dá entrada como membro pendente (3.4 do CLAUDE.md). Nasce no banco quando o rastreio é ligado pela primeira vez e troca quando a clínica quiser; a chave antiga para de valer na hora, e os cliques já recebidos continuam valendo.
   - Com o rastreio desligado, nenhum clique é registrado, mas a linha que ficou no site continua acrescentando o código à mensagem.
   - Administrador e gestor ligam, desligam e geram a chave nova; ligar, desligar e trocar a chave vão para a trilha de auditoria, sem a chave. Ninguém vê pela tela o gclid, o código ou quem clicou: quem clicou aparece no lead, quando a pessoa envia a mensagem com o código.
   - **Conectar com o Google (em breve):** visível e desabilitado. Trazer o nome das campanhas e o investimento do Google é a F2 do backlog, que depende das decisões e do passo a passo do dono.

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

### MÓDULO 14. AUTOMAÇÕES DE FLUXO (escopo acrescentado em 02/10/2026)

Pedido do dono em 02/10/2026. Fica em Configurações, na aba "Automações de fluxo", ao lado de "Jornada e conversões", porque toda regra parte de uma etapa da jornada. Administrador e gestor criam, editam, ligam e excluem; recepção, profissional e leitura não veem a aba (Configurações não aparece para eles).

14.1. **Uma regra é: quando o lead está na etapa X e acontece o gatilho, a automação faz uma ação.** Regra em campos fixos, sem linguagem de programação.
14.2. **Gatilhos:**
   - **Ficou um tempo na etapa:** de 1 hora a 90 dias, contados da entrada na etapa.
   - **Ficou um tempo sem responder na etapa:** de 1 hora a 90 dias, contados da entrada na etapa ou da última mensagem do lead, o que for mais recente (quem escreveu antes de entrar na etapa conta da entrada). Mensagem da clínica não zera o tempo.
   - **Entrou na etapa:** qualquer entrada (Kanban, Atendimento, ação em massa, termo-chave, Agenda, outra automação) e o lead novo que já nasce na etapa.
   - **Mandou mensagem estando na etapa:** a primeira fala do contato novo não conta: a mensagem que cria o contato e as que chegam até 2 minutos depois do nascimento dele (o lead costuma dividir a primeira fala em várias mensagens). Se a mensagem tiver um termo da jornada, o termo vence.
14.3. **Ações (decisão do dono em 02/10/2026):**
   - **Mover para outra etapa.** Agendou e Compareceu nunca são destino (são marcados pela Agenda, e mover para lá viraria conversão falsa para os anúncios da Meta). Para a etapa de perda, o motivo é sempre "Não respondeu", e quem tem consulta futura marcada fica onde está. Quando a etapa de destino envia conversão para a Meta, a tela avisa que cada lead movido conta como conversão.
   - **Colocar etiqueta** do catálogo da clínica na **conversa mais recente** do lead. Lead sem conversa fica sem a etiqueta, e o histórico mostra o motivo.
   - **Criar atividade** (Módulo 15) com o título da regra e prazo em N dias (de 0 a 365) contados de hoje no fuso da clínica. O responsável é quem atende a conversa mais recente do lead, se ainda está ativo na equipe; senão, a atividade fica sem responsável.
   - **Deixar nota interna** com um texto fixo da regra na conversa mais recente, sem pessoa como autora: no Atendimento ela aparece assinada "Automação". O paciente nunca vê.
   - **Enviar mensagem ao paciente não é ação desta tela**, nem vai ser: é a régua de follow-up da etapa (Módulo 7), e a tela mostra o atalho "Abrir o follow-up".
14.4. **Travas** (do plano aprovado; o dono pode ajustar):
   - **Uma vez por entrada na etapa.** Sair e voltar à etapa conta como entrada nova e rearma a regra.
   - **Não é retroativa.** Vale para o que vencer ou acontecer depois de ligada (ou de mudar o gatilho, a etapa ou o tempo). Ao ligar, a tela mostra quantos leads já passaram do ponto e não serão afetados.
   - **Só leads.** Paciente nunca é movido por automação, e os importados que nunca mudaram de etapa ficam de fora.
   - **O movimento humano vence.** Se alguém (ou o termo-chave) mudou o lead de etapa antes de a automação rodar, ela não faz nada e o histórico diz por quê.
   - **Sem laço.** Uma regra ligada que fecharia um ciclo com outra (o lead indo e voltando entre etapas sozinho) é recusada ao salvar e ao ligar, e a tela mostra o caminho das etapas. Automações em cadeia param no 3º salto, e um lead é movido por automação no máximo 10 vezes em 24 horas.
   - **Etapa ou etiqueta usada por automação não se exclui**, com mensagem dizendo para excluir a automação ou trocar a etapa (ou a etiqueta) dela na aba Automações de fluxo antes.
14.5. **Quando roda:** sozinha, pelo motor da plataforma, em até 1 minuto depois do que aconteceu (a mensagem recebida espera uns 15 segundos a mais, para o termo da jornada andar antes). A regra nasce desligada.
14.6. **Histórico:** as últimas 50 execuções, com filtro por automação: Aguardando, Feita (o que fez naquela execução: de onde para onde, a etiqueta com o nome que tinha na hora, a atividade criada ou a nota; editar a regra depois não muda o que o histórico conta), Pulada (o motivo em português, como "o lead já tinha mudado de etapa" ou "o lead tem consulta marcada") e Falhou (com um código para o suporte). Nunca mostra conteúdo de mensagem. Cada linha mostra o nome do lead, por isso a leitura do histórico vai para a trilha de auditoria.
14.7. **Trilha:** toda ação da automação vai para o `audit_log` como ação do sistema (sem usuário e sem conteúdo): moveu de etapa, etiquetou, criou atividade, deixou nota. Criar, editar, ligar, desligar e excluir uma regra também vão para a trilha, sem o texto.

---

### MÓDULO 15. ATIVIDADES (escopo acrescentado em 02/10/2026)

O que a equipe precisa fazer por um lead ou paciente, com prazo e responsável: "ligar para lembrar do retorno", "conferir a carteirinha". Cumpre o "criar lembrete" do 1.9. Item próprio no menu lateral, logo depois de Leads (decisão do dono em 02/10/2026), porque vale para lead e paciente.

15.1. **Campos:** o que fazer (2 a 120 caracteres), detalhes (opcional, até 2000), para quando (dia obrigatório, no fuso da clínica; hora opcional; com hora, o dia acompanha o instante, inclusive quando a clínica troca de fuso, e sem hora o dia escolhido não muda), responsável (padrão: quem criou; pode ficar sem responsável) e a conversa de onde saiu, quando foi criada pela conversa.
15.2. **Situação:** pendente, concluída ou cancelada. Na tela, a pendente aparece como **Atrasada** (com hora, a hora já passou; sem hora, o dia já passou), **Para hoje** (o dia é hoje no fuso da clínica e ainda não atrasou) ou **Pendente**. Quem concluiu ou cancelou, e quando, fica gravado.
15.3. **Onde se cria:** no drawer do lead, no painel da conversa e na ficha do paciente, além da própria página. A automação de fluxo também cria (Módulo 14), marcada "Criada por automação".
15.4. **Página Atividades:** filtros Minhas e Todas; situação (todas as pendentes, atrasadas, para hoje, próximas, concluídas dos últimos 30 dias); responsável, em Todas (inclusive "Sem responsável"); busca por paciente, telefone ou texto; e o recorte de um contato só (o "Ver todas" do drawer, da conversa e da ficha). Lista agrupada por prazo: Atrasadas, Hoje, Amanhã, Próximos 7 dias, Depois e Concluídas.
15.5. **Ações:** concluir (com "Desfazer"), reabrir, editar, adiar (para amanhã, daqui a 7 e daqui a 30 dias, mantendo a hora), cancelar (com "Desfazer"), abrir a conversa e abrir a ficha. **Não existe apagar:** cancela-se. A atividade sai junto com o contato quando ele é excluído (11.11).
15.6. **Início:** em Próximas ações, "Suas atividades atrasadas" e "Suas atividades para hoje", com link para a página já filtrada. Também na visão do profissional.
15.7. **Quem faz o quê:** a matriz de Leads e Pacientes. Administrador, gestor e recepção criam, editam, concluem e cancelam qualquer atividade da clínica; profissional e leitura só veem.
15.8. **Dado sensível:** o texto da atividade pode ser dado de saúde. Fica isolado por clínica no banco, toda leitura por pessoa vai para a trilha de auditoria e o texto nunca vai para log.
15.9. **Fora desta versão:** contador no menu (fica para depois) e marca no cartão do Kanban (regra dos 5 elementos).

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
Pacote (nome, preco, validade, ativo)       <- desde 29/09/2026
 |- ItemPacote (procedimento_id, qtd_sessoes) <- 1 ou mais; procedimento unico no pacote
Convenio (nome, plano, exige_carteirinha)
ConvenioDoProfissional (profissional_id, convenio_id)   <- desde 02/10/2026: o profissional atende o convenio
ConvenioDoProcedimento (procedimento_id, convenio_id)   <- desde 02/10/2026: o convenio cobre o procedimento

VinculoAtendimento          <- a matriz de tres pontas (continua a fonte da agenda, da IA e do preco)
 |- profissional_id, procedimento_id, convenio_id (nulo = particular)
 |- preco, duracao, agendavel_por_ia, ativo

Contato                     <- entidade unica, evita duplicidade
 |- telefone (chave), nome, cpf, email
 |- origem, campanha, midia, data_entrada, metodo_captura
 |- tipo: lead | paciente
 |- etapa_funil, motivo_perda, tags[]
 |- Consentimento (canal, origem, data, ativo, data_revogacao)
 |- SaldoPacote (pacote_id, validade)        <- a venda
     |- ItemSaldo (procedimento_id, sessoes_total, sessoes_usadas) <- copia dos itens na venda

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
 |- vinculo opcional, um so: procedimento_id | profissional_id | especialidade   <- 29/09/2026, so confirmacao e pos_falta
 |- Passo (offset, template_id ou usar_ia, condicao_parada)
 |- Execucao (contato_id, passo_id, enviado_em, entregue, respondido, custo)

EventoAtribuicao (contato_id, canal, origem, midia, campanha, capturado_em, metodo)
LogAuditoria (usuario_id, acao, entidade, entidade_id, quando, ip)

ContaDeAnuncios (conta act_..., pixel, token_conversoes*, token_leitura*)   <- * segredo, so o servidor le
 |- LeituraDoInvestimento (situacao, problema, lido_desde, lido_ate, atualizado_em)  <- 03/10/2026, so o sistema escreve
 |- GastoPorAnuncioNoDia (dia da conta, anuncio, campanha, valor)                    <- 03/10/2026, so admin e gestor leem
 |- GastoDaContaNoDia (dia da conta, valor)                                           <- 03/10/2026, total da conta
 |- Anuncio (anuncio, campanha, nome da campanha)                                     <- 03/10/2026, sem valor

EtapaDaJornada (chave, nome, papel, termos_chave[], termos_de_quem, descricao)  <- termos_de_quem e descricao desde 02/10/2026
MensagemPadrao (atalho, titulo, corpo, ativo, posicao)                        <- 02/10/2026, so texto
Atividade (contato_id, conversa_id, titulo, detalhes, para_o_dia, hora, responsavel_id,
           status: pendente | concluida | cancelada, origem: manual | automacao)  <- 02/10/2026
AutomacaoDeFluxo (etapa, gatilho, espera, acao, destino | etiqueta | atividade | nota, ativa)  <- 02/10/2026
 |- Execucao (contato_id, entrada_na_etapa, status, motivo, acao, etiqueta)  <- uma por entrada na etapa;
                                                                   acao e etiqueta: o que fez naquela execucao
```

---

## 6. CORTE DE ESCOPO: V1 CONTRA V2

**Critério:** entra no V1 só o que é necessário para a IA atender sozinha, agendar, confirmar, recuperar e provar o resultado.

### V1 (entra)

| Módulo | O que entra |
|---|---|
| 1. Inbox | Completo, com takeover, estados, contador de janela 24h, transcrição de áudio, log da IA |
| 2. Agente IA | Persona, conhecimento, habilidades, horário, simulador, guardrail de conformidade, versionamento |
| 3. Cadastro | Profissionais, horários, procedimentos, convênios, matriz de vínculo, recursos, pacotes, bloqueios, unidades. Desde 29/09/2026 as funções continuam e o lugar mudou: a matriz de vínculo é feita dentro do Procedimento, o bloqueio é ação da Agenda e os recursos ficam só no banco, com a trava, sem tela. Desde 02/10/2026 o convênio é marcado no profissional (quais atende) e no procedimento (quais cobrem) |
| 4. Agenda | Visão dia multi profissional, visão semana individual, arrastar e soltar, 10 status, reserva temporária, log |
| 5. Leads | Lista e kanban, 6 etapas, filtros, motivo de perda, importação com opt-in |
| 6. Pacientes | Ficha, linha do tempo, indicadores, etiquetas de risco e inativo, saldo de pacote, consentimento |
| 7. Follow-up | Réguas por etapa, texto fixo ou IA, janela de envio, bloqueio sem opt-in, métricas |
| 8. Confirmação | Régua geral por clínica e régua vinculada a médico, especialidade ou procedimento (confirmação e pós falta, desde 29/09/2026), botões de resposta rápida, painel do dia, régua pós falta, relatório de eficácia |
| 9. Lista de espera | Fila, reoferta automática ao cancelar, métrica de recuperação |
| 10. Dashboard | 4 indicadores, funil, origem por canal, desempenho da IA, custo. Desde 03/10/2026 (publicado): investimento lido da conta de anúncios da Meta, custo por lead e as colunas de investimento da tabela de campanhas (10.12). Desde 04/10/2026 (construído, publicação pendente): origem e número da campanha do Google pelo clique rastreado no site (10.13) |
| 11. Config | Multi-tenant, white-label, perfis, Cloud API, verificação Meta, templates, teto de gasto, opt-in, auditoria, anúncios da Meta (11.14) e do Google (11.15) |
| 12. Assinatura | Planos, gateway, inadimplência, cancelamento autoatendido, painel do dono |
| 14. Automações de fluxo | Escopo acrescentado em 02/10/2026: mover de etapa, etiquetar, criar atividade e nota interna por gatilho de etapa, sem envio ao paciente |
| 15. Atividades | Escopo acrescentado em 02/10/2026: atividades do lead e do paciente, página própria, Início e "criar lembrete" do Inbox |

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
