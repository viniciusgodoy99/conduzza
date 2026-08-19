# Benchmark: Softwares de Gestão para Clínicas Médicas e de Estética no Brasil

Data da coleta: 14 de agosto de 2026.
Metodologia: coleta direta nas páginas oficiais de preços, documentações técnicas de API, centrais de ajuda e Reclame Aqui. Toda afirmação tem URL. Onde o preço não está publicado, está escrito "não publicado".

---

## 1. Sumário do cenário competitivo

O mercado brasileiro já passou por duas ondas de consolidação relevantes:

| Comprador | Alvo | Referência |
|---|---|---|
| Afya | iClinic (R$ 182,7 milhões) | [Exame](https://exame.com/negocios/de-olho-no-setor-de-telemedicina-afya-compra-iclinic-por-r-1827-milhoes/) |
| Afya | Shosp (R$ 5,98 milhões anunciados) | [Medicina S/A](https://medicinasa.com.br/afya-shosp/) |
| Doctoralia / Docplanner | Feegow (25/10/2022, valor não divulgado) | [Press Doctoralia](https://press.doctoralia.com.br/212904-doctoralia-anuncia-aquisicao-da-feegow) |

Consequência prática: iClinic e Shosp são hoje o mesmo grupo (Afya), e Feegow e Doctoralia são o mesmo grupo (Docplanner). Isso reduz o número real de compradores independentes e explica por que a marca de IA "Noa" aparece tanto no plano VIP da Feegow quanto nos planos da Doctoralia.

---

## 2. Fichas por fornecedor

### 2.1 iClinic (Afya iClinic)

**Funcionalidades principais**
Agenda médica, prontuário eletrônico personalizável, agendamento online, prescrição eletrônica, multiprocedimentos, relatórios, cadastro de pacientes, lembretes e assinatura digital estão em todos os planos. Lembrete e confirmação por WhatsApp, faturamento TISS, SMS com resposta, chat interno e pesquisa de satisfação só a partir do plano Plus. Controle financeiro, repasse, relatórios financeiros, estoque e campanhas de e-mail só a partir do plano Pro. Fonte: [iclinic.com.br/precos](https://iclinic.com.br/precos/)

**Preço publicado (por profissional/mês)**
Starter R$ 99,00 | Plus R$ 129,00 | Pro R$ 169,00 | Premium R$ 299,00. Teleconsulta é adicional de R$ 35,00/mês nos planos Starter, Plus e Pro, e ilimitada apenas no Premium. SMS a R$ 0,09 por envio. Clínicas com 5 ou mais profissionais têm orçamento personalizado. Fonte: [iclinic.com.br/precos](https://iclinic.com.br/precos/)

**API pública**
Não foi localizada documentação pública de API REST. O domínio [docs.iclinic.com.br](https://docs.iclinic.com.br/) contém apenas modelos de importação de dados (Paciente, Prontuário, Agendamento, Anexo), sem endpoints, autenticação ou webhooks. A página oficial de extensões lista somente Google Calendar e Apple Calendar, sendo esta última apenas leitura. Fonte: [suporte.iclinic.com.br/adicionar-extensoes](https://suporte.iclinic.com.br/pt-br/adicionar-extensoes)

Evidência indireta reforçando a ausência: os principais fornecedores brasileiros de agente de IA para WhatsApp publicam listas de sistemas integráveis que incluem Feegow e Clinicorp mas não incluem iClinic. Fontes: [Cloudia](https://cloudia.com.br/) e [Clinia](https://clinia.io/)

**Conclusão de integrabilidade: alta dificuldade.** Integrar com iClinic hoje depende de negociação bilateral, não de API autoatendida.

**Agente de IA / WhatsApp nativo**
Existe o iClinic Assist, incluso em todos os planos sem custo adicional. Ele organiza histórico clínico, transcreve automaticamente a consulta, gera resumos e sugere hipóteses diagnósticas, além de prever faltas. É apoio ao médico, não atendimento automatizado ao paciente. A própria fonte afirma que a ferramenta não faz consultas automatizadas por WhatsApp nem interações diretas com pacientes. Fonte: [blog.iclinic.com.br/prontuario-eletronico-com-ia-iclinic-assist](https://blog.iclinic.com.br/prontuario-eletronico-com-ia-iclinic-assist/)

**Nível de IA de atendimento: zero.** O que existe é IA de documentação clínica.

**Reclamações recorrentes**
Reclame Aqui: nota 6,5/10, reputação "Regular", 79 reclamações, 70% de índice de solução, apenas 50% voltariam a fazer negócio, tempo médio de resposta de 16 dias e 21 horas. Principal categoria citada: cobranças recorrentes não autorizadas (8,11%). Fonte: [Reclame Aqui iClinic](https://www.reclameaqui.com.br/empresa/iclinic/)

Temas recorrentes nos títulos das reclamações: dificuldade de cancelamento da assinatura ([1](https://www.reclameaqui.com.br/iclinic/quero-cancelar-a-assinatura_tjMmWhyK4SdK6ZQQ/), [2](https://www.reclameaqui.com.br/iclinic/dificuldade-para-cancelamento__a5cH2VyPJIfB2hF/)), impossibilidade de encerrar conta ([3](https://www.reclameaqui.com.br/iclinic/nao-consigo-encerrar-minha-conta_UdvmWhJouQkoKBph/)), instabilidade do sistema e da teleconsulta com ausência de suporte ([4](https://www.reclameaqui.com.br/iclinic/sistema-nao-funciona-teleconsulta-nao-funciona-sem-suporte_wm3ZiA3KfICMoGxg/)) e dificuldade de contato com o suporte ([5](https://www.reclameaqui.com.br/iclinic/contato-com-o-suporte-muito-dificil_Gc6Zem9ncpyChUlC/)).

---

### 2.2 Feegow

**Funcionalidades principais**
Starter: agenda múltipla, TISS, controle financeiro, prontuário eletrônico, perfil no marketplace, check-in e agendamento online limitado. Plus adiciona gestão de glosas, relatórios personalizados e assinatura digital. VIP adiciona Noa Notes (assistente de IA), modelos personalizáveis e NFS-e. Fonte: [feegowclinic.com.br/precos-e-planos](https://feegowclinic.com.br/precos-e-planos)

**Preço publicado (por profissional/mês)**
Starter R$ 129 | Plus R$ 199 | VIP R$ 249 | Personalizado sob cotação para 10 ou mais profissionais. Fonte: [feegowclinic.com.br/precos-e-planos](https://feegowclinic.com.br/precos-e-planos)

**API pública**
Sim, e é o ponto forte da Feegow. Documentação REST aberta e navegável em [docs.feegow.com](https://docs.feegow.com/). Autenticação por token no header `x-access-token`, gerado pelo próprio usuário master em Configurações, Outras Configurações, API Pública, com permissões granulares por token. Grupos de endpoints: agendamentos, pacientes, profissionais, financeiro, convênios, empresa/unidades, procedimentos e especialidades, estoque, relatórios, cartões de benefício, prontuário e bloqueios de agenda. Há suporte a webhooks. Fontes: [docs.feegow.com](https://docs.feegow.com/) e [Central de Ajuda Feegow](https://ajuda.feegow.com/support/solutions/articles/67000714396-como-integrar-o-feegow-via-api-com-outros-sistemas-)

A própria Feegow declara: "Além das mais de 200 funções, nossa API é aberta para que você possa integrar o Feegow a qualquer outro sistema." Fonte: [feegowclinic.com.br/destaques/interoperabilidade](https://feegowclinic.com.br/destaques/interoperabilidade)

Ponto de atenção comercial e operacional: a Feegow declara explicitamente que "integrações via API são de responsabilidade do cliente, exigindo empresa ou profissional tecnicamente capaz. Nosso time de desenvolvimento esclarece a documentação mas não realiza integrações nem recomenda parceiros." Fonte: [Central de Ajuda Feegow](https://ajuda.feegow.com/support/solutions/articles/67000714396-como-integrar-o-feegow-via-api-com-outros-sistemas-)

**Conclusão de integrabilidade: alta e autoatendida.** Feegow é o caminho de menor atrito para um produto de atendimento plugado.

**Agente de IA / WhatsApp nativo**
O Noa Notes do plano VIP é IA de anotação clínica, não de atendimento. O atendimento por WhatsApp é resolvido por terceiros no ecossistema oficial da Feegow, que lista Cloudia (chatbot), Nina (confirmações automatizadas) e integração com WhatsApp como soluções relacionadas. Fonte: [feegowclinic.com.br/destaques/interoperabilidade](https://feegowclinic.com.br/destaques/interoperabilidade). Existem integradores comerciais dedicados, como o ChatLabs, que vendem confirmação por botão e por palavra-chave conectada aos status de agenda da Feegow. Fonte: [chatlabs.com.br/feegow-clinic-whatsapp-api](https://www.chatlabs.com.br/feegow-clinic-whatsapp-api)

**Nível de IA de atendimento: baixo no produto nativo, delegado a parceiros.**

**Reclamações recorrentes**
Reclame Aqui: nota 6,9/10, reputação "Regular", 96 reclamações, 75% de solução, 71,4% voltariam, taxa de resposta de apenas 71,9% e tempo médio de resposta de 21 dias e 9 horas, com 25 reclamações ainda sem resposta. Categorias: softwares (61,98%) e mau atendimento no SAC (13,22%). Fonte: [Reclame Aqui Feegow](https://www.reclameaqui.com.br/empresa/feegow/)

Temas recorrentes: dificuldade intencional de cancelamento ([1](https://www.reclameaqui.com.br/feegow/feegow-dificulta-intencionalmente-o-cancelamento-de-assinatura_okNeEaP7VfHYG5SX/), [2](https://www.reclameaqui.com.br/feegow/dificuldade-para-cancelar-o-sistema-feegow_36CcyoTbUl4LPjoj/)), suporte técnico ineficaz ([3](https://www.reclameaqui.com.br/feegow/suporte-tecnico-ineficaz-feegow-e-um-pessimo-sistema-para-sua-clinica_ytcMHObQTMOkRM1S/), [4](https://www.reclameaqui.com.br/feegow/pensando-em-usar-o-feegow-cuidado-nao-ha-suporte_kdUVnC1w-Gw2jvzk/)), falha no envio de receita digital ([5](https://www.reclameaqui.com.br/feegow/plataforma-feegow-falha-no-envio-de-receita-digital-e-dificuldade-no-cancelamento-do-contrato_JjvmewuT7AWcZS2B/)) e cobrança indevida por usuário adicional ([6](https://www.reclameaqui.com.br/feegow/cobranca-indevida-por-segundo-usuario-nao-autorizado-no-sistema-feegow_Jo4hbcfoFDDEnrBQ/)).

---

### 2.3 Ninsaúde Apolo

**Funcionalidades principais**
Sistema de gestão para clínicas e franquias, com presença em mais de 10 países e mais de 5.000 usuários segundo a própria empresa. Fonte: [ninsaude.com/pt-br/desenvolvedores](https://www.ninsaude.com/pt-br/desenvolvedores/)

**Preço publicado**
Não publicado. Não foi localizada página pública de planos e preços nos domínios ninsaude.com nem apolo.app durante esta coleta (as URLs testadas de preços retornaram erro 404).

**API pública**
Sim, e tecnicamente a mais bem descrita do grupo. API RESTful com autenticação OAuth2, dois tipos de token (Refresh Token sem expiração e Access Token com validade de 15 minutos), documentação com "milhares de rotas disponíveis" e gatilhos (webhooks) que notificam aplicações externas sobre inserção, alteração ou exclusão de registros, retornando o objeto JSON correspondente com logs de monitoramento. A documentação é distribuída via coleção pública no Postman. Fonte: [ninsaude.com/pt-br/desenvolvedores](https://www.ninsaude.com/pt-br/desenvolvedores/)

**Conclusão de integrabilidade: alta.**

**Agente de IA / WhatsApp nativo**
Não foi localizada documentação pública de agente de IA de atendimento por WhatsApp nativo.

**Reclamações recorrentes**
Não foi localizada página de empresa no Reclame Aqui para Ninsaúde ou Ninsaúde Apolo, o que sugere baixa exposição ao consumidor final brasileiro ou base pequena no Brasil.

---

### 2.4 Amplimed

**Funcionalidades principais**
Agendamento online 24 horas, prontuário digital, financeiro com TISS, NFS-e, módulo de pagamento e repasse a profissionais, teleconsulta, painel de chamadas, controle de estoque e vacinas, pesquisas de satisfação, e-mail marketing, SMS e WhatsApp Connect. Fonte: [amplimed.com.br](https://www.amplimed.com.br/)

**Preço publicado**
Consultórios (1 a 2 profissionais): Lite R$ 89/mês por profissional e Pro R$ 139/mês por profissional. Fonte: [amplimed.com.br/consultorio-planos](https://www.amplimed.com.br/consultorio-planos/)

Clínicas (3 ou mais profissionais): quatro planos (Pro, Plus, Premium e Enterprise), todos com preço "sob consulta". Fonte: [amplimed.com.br/clinicas-planos](https://www.amplimed.com.br/clinicas-planos)

Atenção ao empacotamento: confirmações por WhatsApp e Amélia Transcrição são módulos contratados separadamente, não estão no preço base. Fonte: [amplimed.com.br/consultorio-planos](https://www.amplimed.com.br/consultorio-planos/)

**API pública**
Não foi localizada documentação pública de API. A página institucional não menciona API pública nem integrações com terceiros. Fonte: [amplimed.com.br](https://www.amplimed.com.br/)

**Agente de IA / WhatsApp nativo**
Sim, e é o mais avançado entre os players médicos generalistas nesta amostra. A Amélia Agendamento permite que o paciente agende diretamente pelo WhatsApp de forma automática, 24 horas por dia. A empresa descreve autonomia real: o sistema "interpreta mensagens livres, consulta a agenda em tempo real e confirma o agendamento sem precisar de intervenção da equipe", cobrindo agendamento, confirmação e remarcação. Preço não publicado. Fonte: [amplimed.com.br/amelia-agendamento](https://www.amplimed.com.br/amelia-agendamento/)

Há também Amélia Copilot (incluso no plano Pro) e Amélia Transcrição (módulo à parte).

**Nível de IA de atendimento: médio a alto na promessa, sem preço público.**

**Reclamações recorrentes**
Reclame Aqui: nota 6,9/10, reputação "Regular", 46 reclamações no período de 01/08/2025 a 31/07/2026, 69,6% de solução e apenas 47,8% voltariam a fazer negócio. Consumidores destacam suporte ineficiente, demora na resolução de problemas técnicos e insatisfação com o pós-venda, incluindo queixas relacionadas a integração de APIs. Fonte: [Reclame Aqui Amplimed](https://www.reclameaqui.com.br/empresa/amplimed/)

---

### 2.5 Clinicorp (odontologia e clínicas)

**Funcionalidades principais**
Agenda inteligente, prontuário digital, CRM, financeiro, integração com WhatsApp, confirmações e alertas, agendamento online e usuários ilimitados em ambos os planos. O Premium adiciona réguas de cobrança automatizadas, meios de pagamento integrados e dashboard analítico estratégico. Fonte: [clinicorp.com/planos](https://www.clinicorp.com/planos)

**Preço publicado (por clínica, usuários ilimitados)**
Standard R$ 159,90/mês (ou R$ 127,19/mês no trimestral) | Premium R$ 369,90/mês (ou R$ 330,00/mês no trimestral). Combo Clinicorp IA e Combo Agentes Clinicorp IA: sob consulta. Implantação obrigatória cobrada à parte no primeiro mês. Fonte: [clinicorp.com/planos](https://www.clinicorp.com/planos)

Este é o único player da amostra com precificação por clínica com usuários ilimitados, o que muda completamente a economia unitária em clínicas com muitos profissionais.

**API pública**
Não foi localizada documentação pública de API. O Clinicorp aparece como sistema integrável nas listas públicas de fornecedores de IA de atendimento, o que indica existência de integração mas não de documentação aberta. Fontes: [Cloudia](https://cloudia.com.br/) e [Clinia](https://clinia.io/)

**Agente de IA / WhatsApp nativo**
Sim, e é a oferta mais estruturada da amostra. São três agentes: Agente de Agendamento (reativo, cuida de marcação, lembretes, remarcação e cancelamento), Agente de Relacionamento (proativo, confirmações, retorno de faltas, orçamentos abertos e lembretes de pagamento) e Agente de Captação (proativo e reativo, identifica contatos de campanhas de CRM, nutre leads e converte em agendamento). Operam no WhatsApp 24/7, executam ações diretamente no sistema e permitem handoff humano com devolução da conversa ao agente. Preço não publicado. Fonte: [clinicorp.com/agentes-clinicorp-ia](https://www.clinicorp.com/agentes-clinicorp-ia)

**Nível de IA de atendimento: alto. É o principal concorrente conceitual de um produto posicionado como "resolve atendimento".**

**Reclamações recorrentes**
Reclame Aqui: nota 8,3/10, reputação "Ótima", 64 reclamações, 96,9% de solução, 71,9% voltariam, taxa de resposta de 92,2% e tempo médio de 11 dias e 10 horas. Principais problemas: demora na execução (17,89%) e problemas no módulo administrativo (30,08%). Fonte: [Reclame Aqui Clinicorp](https://www.reclameaqui.com.br/empresa/clinicorp/)

---

### 2.6 Shosp (grupo Afya)

**Funcionalidades principais**
Free: agenda de paciente, base de pacientes, integração com WhatsApp, apps mobile, chat interno e suporte, limitado a 5 usuários, sem prontuário eletrônico, sem teleconsulta e sem financeiro. Fellowship adiciona usuários ilimitados, prontuário eletrônico, teleconsulta, gestão financeira, TISS, integração com WhatsApp, assinatura digital e relacionamento com pacientes. Excellence adiciona engajamento automatizado, integração via API, telemedicina gratuita, repasse personalizável, centros de custo, agendamento de campanhas, 100 créditos mensais por profissional e relatórios com BI. Fonte: [shosp.com.br/precos](https://www.shosp.com.br/precos)

**Preço publicado**
Free R$ 0/mês para sempre, com taxa de implantação de R$ 299 | Fellowship R$ 149/mês por profissional | Excellence R$ 229/mês por profissional | Enterprise para 10 ou mais profissionais sob consulta. Fonte: [shosp.com.br/precos](https://www.shosp.com.br/precos)

**API pública**
Sim, mas com acesso controlado. "Disponibilizamos nossa API de agenda através de uma chave personalizada e um ID", com documentação em sistema.shosp.com.br/api/docs/. A API permite agendamento online customizado em sites, apps próprios e conexão de sistemas de terceiros. Relevante: a integração via API aparece listada como recurso do plano Excellence (R$ 229), o que sugere gating por plano. Fontes: [shosp.com.br/desenvolvedores](https://www.shosp.com.br/desenvolvedores) e [shosp.com.br/precos](https://www.shosp.com.br/precos)

**Agente de IA / WhatsApp nativo**
Há integração com WhatsApp em todos os planos e engajamento automatizado no Excellence, mas não foi localizada documentação de agente de IA conversacional autônomo.

**Reclamações recorrentes**
Não foi localizada página dedicada no Reclame Aqui durante esta coleta. Contexto relevante: a Afya opera Shosp e iClinic em paralelo, com página de migração cruzada entre as marcas. Fonte: [lps.iclinic.com.br/shosp](https://lps.iclinic.com.br/shosp/)

---

### 2.7 Doctoralia / Docplanner

**Funcionalidades principais**
Starter: perfil pago na Doctoralia, agendamento online, lembretes por e-mail e app, e Noa Notes (IA para anotações). Plus adiciona prontuário eletrônico, lembretes por WhatsApp, e-mail, app e SMS, prescrições eletrônicas, teleconsultas e campanhas por e-mail e SMS (1.000/mês). VIP adiciona perfil avançado, campanhas de 5.000/mês, pagamentos online, estatísticas avançadas de performance e lista de espera inteligente. Fonte: [pro.doctoralia.com.br/preco](https://pro.doctoralia.com.br/preco)

**Preço publicado (por profissional, plano anual em 12x)**
Starter R$ 429/mês | Plus R$ 529/mês | VIP R$ 679/mês. Adicionais: Noa Notes R$ 199/mês, Site Profissional R$ 99/mês, First Class e Mídia 360 com preço variável. Fonte: [pro.doctoralia.com.br/preco](https://pro.doctoralia.com.br/preco)

Para clínicas, os preços não são publicados: a página oferece Doctoralia Pro, Feegow e o combo "Pack Pro + Feegow", todos mediante solicitação de proposta. Fonte: [pro.doctoralia.com.br/preco/clinicas](https://pro.doctoralia.com.br/preco/clinicas)

**Este é o teto de preço público do mercado brasileiro para software de gestão e captação por profissional, e o ponto de comparação direto para a faixa de R$ 600 a R$ 700.**

**API pública**
Sim, existe a Docplanner Integrations API, tecnicamente robusta e explicitamente voltada a sistemas de gestão parceiros ("DocplannerPMS API clients"). Autenticação OAuth2 com IP whitelisting (lista de IPs publicada em `/public/docs/public-ips.json`). Recursos: Facilities, Doctors, Addresses, Services, Insurances, Calendars e Slots, Bookings e Patient Presence. Notificações em dois modelos, push (envio em tempo real para endpoint do cliente) e pull (`GET /notifications`, FIFO, válidas por 72 horas), cobrindo agendamentos, cancelamentos, movimentações e alterações de serviços. Fonte: [docplanner.github.io/integrations-hub-front-app/docs](https://docplanner.github.io/integrations-hub-front-app/docs/)

Observação: o cadastro parece ser controlado, voltado a parceiros aprovados, não autoatendido.

**Agente de IA / WhatsApp nativo**
A marca de IA é a Noa. Produtos: Noa Notes (anotações automáticas de prontuário), Noa Evidence (respostas clínicas baseadas em estudos revisados por pares) e Noa Booking, anunciado como "em breve". A página menciona que a Noa "atende as ligações", mas sem detalhamento público do escopo. Preços não exibidos na página da Noa. Fonte: [noa.ai/pt-br](https://noa.ai/pt-br/)

**Nível de IA de atendimento: baixo hoje, com roadmap declarado (Noa Booking "em breve"). Este é o risco competitivo de médio prazo mais relevante da amostra.**

**Reclamações recorrentes**
Reclame Aqui: nota 7,2/10, reputação "Boa", 699 reclamações (volume muito superior ao dos demais), 81,8% de solução, apenas 58,3% voltariam a fazer negócio, taxa de resposta de 84% e tempo médio de 7 dias e 6 horas. Principais problemas: dificuldade para cancelar serviços (18%), exclusão de perfil e dados, cancelamento de consultas sem reembolso e problemas com cobranças e assinaturas. Fonte: [Reclame Aqui Doctoralia](https://www.reclameaqui.com.br/empresa/doctoralia/). Há reclamação específica sobre divergência de preços entre o anunciado e o cobrado nos planos para profissionais de saúde. Fonte: [Reclame Aqui, divergência de preços](https://www.reclameaqui.com.br/doctoralia/divergencia-de-precos-no-plano-doctoralia-para-profissionais-da-saude_zZECENzYe0mriN7j/)

---

### 2.8 Simples Dental (odontologia)

**Funcionalidades principais**
Basic: agenda online e link de agendamento, prontuário eletrônico, confirmação automática por WhatsApp, site para clínica, apps para dentistas e pacientes, receituário digital, conta digital e IA para criação de evoluções por voz. Plus adiciona nota fiscal, consulta de crédito, comissionamento automático, maquininha integrada, fluxo de caixa, relatórios em Excel, controle de ortodontia e Copiloto WhatsApp Web. Pro adiciona contratos integrados ao orçamento, armazenamento ilimitado de imagens, integração WhatsApp Web, funil CRM, faceograma digital e gerenciador de indicações. Fonte: [simplesdental.com/planos-e-precos](https://www.simplesdental.com/planos-e-precos)

**Preço publicado (por clínica)**
Basic R$ 137,41/mês no anual ou R$ 149,90/mês no mensal | Plus R$ 229,08/mês no anual ou R$ 249,90/mês no mensal | Pro R$ 320,74/mês no anual ou R$ 349,90/mês no mensal. Alguns recursos marcados com asterisco são serviços pagos à parte. Fonte: [simplesdental.com/planos-e-precos](https://www.simplesdental.com/planos-e-precos)

**API pública**
Não. A resposta oficial da central de ajuda é categórica: "O Simples Dental não possui API de integração com outros softwares ou sistemas." Fonte: [ajuda.simplesdental.com](https://ajuda.simplesdental.com/pt-BR/articles/2667300-o-simples-dental-tem-integracao-via-api-com-outros-softwares)

**Conclusão de integrabilidade: nula por caminho oficial.**

**Agente de IA / WhatsApp nativo**
Existe IA para criação de evoluções por voz (Basic) e "Copiloto WhatsApp Web" (Plus e Pro). O termo "copiloto" e a dependência de WhatsApp Web indicam assistência ao operador humano, não agente autônomo com API oficial do WhatsApp. Fonte: [simplesdental.com/planos-e-precos](https://www.simplesdental.com/planos-e-precos)

**Nível de IA de atendimento: baixo.**

**Reclamações recorrentes**
Reclame Aqui: melhor reputação da amostra, nota 9,6/10 "Ótima", apenas 18 reclamações, 92,3% de solução, 100% voltariam a fazer negócio, 100% de taxa de resposta e tempo médio de 14 horas. Principais problemas: cobrança indevida (35,29%) e problemas com atendimento (20,17%). Fonte: [Reclame Aqui Simples Dental](https://www.reclameaqui.com.br/empresa/simples-dental/)

---

### 2.9 Belle Software (estética)

**Funcionalidades principais**
Modelo em nuvem com usuários ilimitados para administração e recepção, base de dados em AWS, agenda, suporte remoto e treinamento inclusos. As agendas liberadas variam conforme o plano contratado. Fonte: [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/)

**Preço publicado**
Mensalidade base: **não publicado**. A página de preços permite selecionar periodicidade (mensal, 1 ano com 15% de desconto e 2 anos com 26% de desconto) mas não exibe o valor da mensalidade sem contato comercial.

Módulos adicionais com preço publicado: BelleMessage (integração WhatsApp) R$ 229/mês, BI/Relatórios R$ 150/mês, Automação de Marketing R$ 150/mês, NFS-e R$ 70/mês, Check-in com Biometria R$ 90/mês. Fonte: [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/)

Comparativo de terceiro cita adicionalmente assinatura eletrônica R$ 45/mês, NFC-e R$ 90/mês e app próprio R$ 150/mês, além de multa de cancelamento de 50% do saldo remanescente. Fonte: [Agendiva](https://agendiva.com.br/melhores-sistemas-para-clinica-de-estetica)

Observação estratégica: o módulo de WhatsApp sozinho (R$ 229/mês) custa mais do que planos inteiros de concorrentes médicos. É evidência direta de que o mercado de estética já aceita pagar caro especificamente por comunicação com o cliente.

**API pública**
Não foi localizada API pública. As integrações documentadas são via conectores de terceiros: Markkit, plataforma Pluga (Facebook Leads Ads, RD Station, WooCommerce), Solutto, VTEX, PagoLivre, Plugbank e Pagar.me. Fonte: [ajuda.bellesoftware.com.br/integracoes](https://ajuda.bellesoftware.com.br/knowledge-base/integracoes/). A Cloudia mantém página de integração com Belle Software. Fonte: [cloudia.com.br/integracao/belle-software](https://cloudia.com.br/integracao/belle-software/)

**Agente de IA / WhatsApp nativo**
Não foi localizada oferta de agente de IA. O BelleMessage é integração de mensagens, e a central de ajuda documenta integração de WhatsApp via PlugZapi (não oficial). Fonte: [ajuda.bellesoftware.com.br](https://ajuda.bellesoftware.com.br/knowledge-base/integracao-com-o-whatsapp-plugzapi/)

**Reclamações recorrentes**
A empresa mantenedora é a Geinfo. No Reclame Aqui a Geinfo aparece "Sem Reputação", com 12 reclamações, 100% de taxa de resposta, 60% de solução e tempo médio de 12 dias e 23 horas. Fonte: [Reclame Aqui Geinfo](https://www.reclameaqui.com.br/empresa/geinfo/). Há reclamações específicas sobre falha grave do sistema. Fonte: [Reclame Aqui, falha grave](https://www.reclameaqui.com.br/geinfo/sistema-belle-software-com-falha-grave-falta-de-respeito-com-o-cliente_K2HnkTOGWJ2jlHv1/)

---

### 2.10 Trinks (beleza e estética)

**Funcionalidades principais**
Agenda online, site e app para agendamento, gestão financeira e relatórios (mais de 130 relatórios financeiros customizados citados), conta digital integrada, pacotes, serviços e promoções, controle de estoque, app do profissional, comunidade e treinamentos. Recursos adicionais disponíveis em todos os planos: aplicativo exclusivo, clube de assinaturas, mensagens WhatsApp, SMS e e-mail, programa de fidelidade, lembretes automáticos, autoatendimento e emissão de notas fiscais. Fontes: [negocios.trinks.com/planos](https://negocios.trinks.com/planos/) e [negocios.trinks.com](https://negocios.trinks.com)

**Preço publicado**
1 a 2 profissionais: R$ 76/mês no anual ou R$ 110/mês no mensal. Faixas de 3 a 4, 5 a 10, 11 a 20 e 21 ou mais profissionais: **sob consulta**. Onboarding personalizado a partir de 5 profissionais e migração assistida a partir de 11. Teste grátis de 5 dias sem taxa de adesão. Fonte: [negocios.trinks.com/planos](https://negocios.trinks.com/planos/)

**API pública**
Existe mas não é aberta. O acesso exige que o responsável esteja cadastrado no Trinks com perfil vinculado ao estabelecimento e solicite liberação pelo canal de suporte; o token é disponibilizado em até 48 horas no painel. Endpoints cobrem agendamentos, clientes, profissionais, catálogo de serviços e produtos, transações financeiras, meios de pagamento, fidelidade e clube de assinatura, além de etiquetas. Há webhooks para eventos como fechamento de conta, estornos, cadastro de cliente, atualização de profissional, alterações no estabelecimento e mudanças de agendamento. A documentação afirma que a integração exige serviço técnico contratado pelo cliente. Fonte: [trinks.readme.io/reference/introducao](https://trinks.readme.io/reference/introducao)

**Agente de IA / WhatsApp nativo**
A comunicação institucional menciona "WhatsApp que trabalha 24 horas por você" e mensagens WhatsApp como recurso adicional, mas não foi localizada documentação de agente de IA conversacional autônomo. Fonte: [negocios.trinks.com](https://negocios.trinks.com)

**Nível de IA de atendimento: baixo, mais próximo de automação de mensagens do que de agente.**

**Reclamações recorrentes**
Reclame Aqui: nota 8,5/10 "Ótima", 98 reclamações, 100% de taxa de resposta, 93,5% de solução, 76,1% voltariam e tempo médio de resposta de 2 dias e 9 horas (o melhor tempo da amostra depois do Simples Dental). Principais problemas: cobrança indevida (15,72%), problemas com o aplicativo (8,76%) e acesso ao cadastro (2,06%). Fonte: [Reclame Aqui Trinks](https://www.reclameaqui.com.br/empresa/trinks/)

---

### 2.11 Avec (Hyperlocal, beleza e estética)

**Funcionalidades principais**
Plataforma completa de gestão para negócios de beleza, com histórico de atuação também como fintech do setor. Fonte: [Correio Braziliense](https://www.correiobraziliense.com.br/app/noticia/economia/2019/08/15/internas_economia,777227/avec-fintech-do-setor-de-beleza-agora-entra-no-segmento-de-cartoes.shtml)

**Preço publicado**
**Não publicado nesta coleta.** A página oficial de planos existe em [negocios.avec.app/planos](https://negocios.avec.app/planos) mas está bloqueada para coleta automatizada (robots.txt), impedindo a extração dos valores. Comparativo independente também registra o preço como "consultar no site". Fonte: [Agendiva](https://agendiva.com.br/melhores-sistemas-para-clinica-de-estetica)

**API pública**
Não foi localizada documentação pública de API.

**Agente de IA / WhatsApp nativo**
Não foi localizada documentação pública de agente de IA nativo.

**Reclamações recorrentes**
Reclame Aqui (empresa Hyperlocal, confirmada como mantenedora do Avec): nota 6,3/10, reputação "Regular", 142 reclamações (o maior volume entre os players de beleza da amostra), 73,3% de solução e apenas 42,2% voltariam a fazer negócio, com nota média do consumidor de 4,16/10. Principais categorias: software (38,57%) e mau atendimento (23,12%). Fonte: [Reclame Aqui Hyperlocal](https://www.reclameaqui.com.br/empresa/hyperlocal/)

Há reclamações específicas sobre dificuldade de uso e suporte ineficiente do sistema e sobre migração de sistema. Fontes: [Belezasoft/Avec](https://www.reclameaqui.com.br/belezasoft/dificuldade-de-uso-e-suporte-ineficiente-do-sistema-avec-app-para-salao-de-beleza__CAdC7UkOPYd_mNo/) e [Migração Az para Avec](https://www.reclameaqui.com.br/hyperlocal/migracao-de-sistema-az-para-avec_Cn3GgOka08UOGhkI/)

---

## 3. Tabela comparativa de preços

| Fornecedor | Plano de entrada | Plano intermediário | Plano topo publicado | Unidade de cobrança | Fonte |
|---|---|---|---|---|---|
| iClinic | Starter R$ 99,00 | Plus R$ 129,00 / Pro R$ 169,00 | Premium R$ 299,00 | Por profissional/mês | [iclinic.com.br/precos](https://iclinic.com.br/precos/) |
| Feegow | Starter R$ 129,00 | Plus R$ 199,00 | VIP R$ 249,00 | Por profissional/mês | [feegowclinic.com.br/precos-e-planos](https://feegowclinic.com.br/precos-e-planos) |
| Ninsaúde Apolo | não publicado | não publicado | não publicado | não publicado | página de preços não localizada |
| Amplimed | Lite R$ 89,00 | Pro R$ 139,00 | Clínicas 3+ sob consulta | Por profissional/mês | [consultorio-planos](https://www.amplimed.com.br/consultorio-planos/) e [clinicas-planos](https://www.amplimed.com.br/clinicas-planos) |
| Clinicorp | Standard R$ 159,90 | Premium R$ 369,90 | Combos IA sob consulta | Por clínica/mês, usuários ilimitados | [clinicorp.com/planos](https://www.clinicorp.com/planos) |
| Shosp | Free R$ 0 (implantação R$ 299) | Fellowship R$ 149,00 | Excellence R$ 229,00 | Por profissional/mês | [shosp.com.br/precos](https://www.shosp.com.br/precos) |
| Doctoralia | Starter R$ 429,00 | Plus R$ 529,00 | VIP R$ 679,00 | Por profissional/mês (anual 12x) | [pro.doctoralia.com.br/preco](https://pro.doctoralia.com.br/preco) |
| Simples Dental | Basic R$ 137,41 anual / R$ 149,90 mensal | Plus R$ 229,08 anual / R$ 249,90 mensal | Pro R$ 320,74 anual / R$ 349,90 mensal | Por clínica/mês | [simplesdental.com/planos-e-precos](https://www.simplesdental.com/planos-e-precos) |
| Belle Software | não publicado | não publicado | não publicado | Por agendas contratadas | [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/) |
| Trinks | R$ 76,00 anual / R$ 110,00 mensal (1 a 2 profissionais) | 3 a 10 profissionais sob consulta | 11+ sob consulta | Por estabelecimento, por faixa de profissionais | [negocios.trinks.com/planos](https://negocios.trinks.com/planos/) |
| Avec | não publicado | não publicado | não publicado | não publicado | [negocios.avec.app/planos](https://negocios.avec.app/planos) (bloqueado para coleta) |

### Add-ons e módulos com preço publicado

| Item | Preço | Fornecedor | Fonte |
|---|---|---|---|
| Teleconsulta (Starter, Plus, Pro) | R$ 35,00/mês | iClinic | [iclinic.com.br/precos](https://iclinic.com.br/precos/) |
| SMS avulso | R$ 0,09 por envio | iClinic | [iclinic.com.br/precos](https://iclinic.com.br/precos/) |
| Noa Notes (IA de anotação) | R$ 199,00/mês | Doctoralia | [pro.doctoralia.com.br/preco](https://pro.doctoralia.com.br/preco) |
| Site profissional | R$ 99,00/mês | Doctoralia | [pro.doctoralia.com.br/preco](https://pro.doctoralia.com.br/preco) |
| BelleMessage (WhatsApp) | R$ 229,00/mês | Belle Software | [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/) |
| BI / Relatórios | R$ 150,00/mês | Belle Software | [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/) |
| Automação de Marketing | R$ 150,00/mês | Belle Software | [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/) |
| NFS-e | R$ 70,00/mês | Belle Software | [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/) |
| Check-in com biometria | R$ 90,00/mês | Belle Software | [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/) |
| Taxa de implantação do plano Free | R$ 299,00 (única) | Shosp | [shosp.com.br/precos](https://www.shosp.com.br/precos) |

### Preços de referência do mercado adjacente de IA de atendimento

Este bloco é o mais relevante para definir a faixa do produto novo, porque representa o preço que a clínica já paga hoje **apenas para resolver atendimento**, sem gestão.

| Fornecedor | Preço publicado | Escopo | Fonte |
|---|---|---|---|
| Secretar.AI | Solo R$ 360/mês (1 usuário, 1.000 créditos de IA) | WhatsApp, agenda, prontuário, financeiro, CRM e agentes de IA | [secretar.ai](https://secretar.ai/) |
| Secretar.AI | Consultório R$ 720/mês (5 usuários, 2.000 créditos) | Idem | [secretar.ai](https://secretar.ai/) |
| Secretar.AI | Clínica R$ 1.080/mês (15 usuários, 3.000 créditos) | Idem | [secretar.ai](https://secretar.ai/) |
| Cloudia | não publicado (tabela por volume de 200 a 1.200 pacientes/mês, valores ocultos) | Secretária virtual com IA no WhatsApp, integra 40+ sistemas incluindo Feegow, Clinicorp e Belle | [cloudia.com.br](https://cloudia.com.br/) |
| Clinia | não publicado | IA no WhatsApp, integra Feegow, Clinicorp, Gesthor, Interprocess, Optimus Clinic, Amigo | [clinia.io](https://clinia.io/) |
| ChatLabs (integrador Feegow) | não publicado | Confirmação por botão e palavra-chave ligada aos status de agenda da Feegow | [chatlabs.com.br](https://www.chatlabs.com.br/feegow-clinic-whatsapp-api) |

---

## 4. Lacunas funcionais consistentes no mercado

Estas são as falhas que aparecem de forma repetida em fornecedores diferentes, com evidência documental.

### 4.1 Ninguém resolve atendimento de ponta a ponta dentro do próprio sistema de gestão

Os dois maiores grupos entregam IA de documentação clínica, não IA de atendimento ao paciente. O iClinic Assist é explicitamente "exclusivamente um sistema de apoio de back-office para o profissional médico", sem interação com paciente. Fonte: [blog.iclinic.com.br](https://blog.iclinic.com.br/prontuario-eletronico-com-ia-iclinic-assist/). O Noa Notes da Doctoralia e da Feegow é anotação de prontuário, com o Noa Booking ainda "em breve". Fonte: [noa.ai/pt-br](https://noa.ai/pt-br/)

A prova mais forte da lacuna é econômica: a própria Feegow lista Cloudia e Nina como soluções relacionadas para chatbot e confirmações automatizadas em vez de oferecer o recurso nativamente. Fonte: [feegowclinic.com.br/destaques/interoperabilidade](https://feegowclinic.com.br/destaques/interoperabilidade). Existe um mercado inteiro de terceiros (Cloudia com 40+ integrações, Clinia, ChatLabs, Secretar.AI) vivendo exatamente do buraco que os PMS não fecham.

Exceções parciais: Clinicorp (três agentes autônomos no WhatsApp, sem preço público) e Amplimed (Amélia Agendamento, sem preço público). Ambos são odontologia/médico generalista e nenhum publica o preço, o que indica que ainda tratam isso como venda consultiva de alto valor.

### 4.2 Preço de clínica é sistematicamente opaco

Em praticamente todos os fornecedores, o preço só é público na faixa de consultório pequeno e vira "sob consulta" exatamente onde está o dinheiro:

- Amplimed publica R$ 89 e R$ 139 para 1 a 2 profissionais e esconde os quatro planos de clínicas com 3 ou mais. Fonte: [clinicas-planos](https://www.amplimed.com.br/clinicas-planos)
- Trinks publica R$ 76 e R$ 110 para 1 a 2 profissionais e esconde todas as faixas de 3 em diante. Fonte: [negocios.trinks.com/planos](https://negocios.trinks.com/planos/)
- Doctoralia publica preços por profissional mas esconde totalmente a oferta para clínicas, incluindo o combo com Feegow. Fonte: [pro.doctoralia.com.br/preco/clinicas](https://pro.doctoralia.com.br/preco/clinicas)
- iClinic publica até 4 profissionais e manda clínicas com 5 ou mais para orçamento personalizado. Fonte: [iclinic.com.br/precos](https://iclinic.com.br/precos/)
- Feegow publica até 9 profissionais e manda 10 ou mais para cotação. Fonte: [feegowclinic.com.br/precos-e-planos](https://feegowclinic.com.br/precos-e-planos)
- Belle e Avec não publicam sequer a mensalidade base.

**Oportunidade: transparência de preço em faixa de clínica é um diferencial de posicionamento sem custo de produto.**

### 4.3 Empacotamento predatório: o essencial é add-on

O padrão do mercado é vender barato a entrada e cobrar à parte tudo que a clínica realmente usa:

- iClinic cobra teleconsulta R$ 35/mês à parte em três dos quatro planos e só libera controle financeiro no terceiro nível (R$ 169). Fonte: [iclinic.com.br/precos](https://iclinic.com.br/precos/)
- Amplimed vende confirmações por WhatsApp e Amélia Transcrição como módulos separados do plano base. Fonte: [consultorio-planos](https://www.amplimed.com.br/consultorio-planos/)
- Belle cobra R$ 229/mês só pelo módulo de WhatsApp, mais R$ 150 de BI, mais R$ 150 de automação de marketing, sobre uma mensalidade base sequer divulgada. Fonte: [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/)
- Doctoralia cobra R$ 199/mês pelo Noa Notes sobre planos que já custam R$ 429 a R$ 679. Fonte: [pro.doctoralia.com.br/preco](https://pro.doctoralia.com.br/preco)

Efeito colateral visível: "cobrança indevida" é a categoria número um de reclamação no Simples Dental (35,29%) e no Trinks (15,72%), e cobranças recorrentes não autorizadas lideram no iClinic (8,11%). Fontes: [Simples Dental](https://www.reclameaqui.com.br/empresa/simples-dental/), [Trinks](https://www.reclameaqui.com.br/empresa/trinks/), [iClinic](https://www.reclameaqui.com.br/empresa/iclinic/)

### 4.4 Suporte e SLA são a ferida aberta do setor

Os tempos médios de resposta no Reclame Aqui são desastrosos entre os líderes médicos:

| Fornecedor | Tempo médio de resposta | Voltariam a fazer negócio | Fonte |
|---|---|---|---|
| Feegow | 21 dias e 9 horas (25 reclamações sem resposta) | 71,4% | [RA](https://www.reclameaqui.com.br/empresa/feegow/) |
| iClinic | 16 dias e 21 horas | 50,0% | [RA](https://www.reclameaqui.com.br/empresa/iclinic/) |
| Clinicorp | 11 dias e 10 horas | 71,9% | [RA](https://www.reclameaqui.com.br/empresa/clinicorp/) |
| Doctoralia | 7 dias e 6 horas | 58,3% | [RA](https://www.reclameaqui.com.br/empresa/doctoralia/) |
| Avec (Hyperlocal) | 4 dias e 13 horas | 42,2% | [RA](https://www.reclameaqui.com.br/empresa/hyperlocal/) |
| Trinks | 2 dias e 9 horas | 76,1% | [RA](https://www.reclameaqui.com.br/empresa/trinks/) |
| Simples Dental | 14 horas | 100% | [RA](https://www.reclameaqui.com.br/empresa/simples-dental/) |

A correlação é direta e visível: quem responde rápido tem NPS de recompra alto. Simples Dental responde em 14 horas e tem 100% de recompra; iClinic responde em quase 17 dias e tem 50%. **Suporte rápido é, sozinho, um argumento de precificação premium neste mercado.**

Complemento qualitativo: a Amplimed acumula queixas explícitas de "suporte ineficiente" e problemas com integração de APIs. Fonte: [RA Amplimed](https://www.reclameaqui.com.br/empresa/amplimed/)

### 4.5 Fricção de cancelamento é sistêmica e cria janela de churn

"Dificuldade para cancelar" é o problema número um da Doctoralia (18% das 699 reclamações) e aparece em múltiplas reclamações tituladas do iClinic e da Feegow, uma delas literalmente intitulada "Feegow dificulta intencionalmente o cancelamento de assinatura". A Belle é apontada por multa de cancelamento de 50% do saldo remanescente. Fontes: [Doctoralia RA](https://www.reclameaqui.com.br/empresa/doctoralia/), [Feegow RA](https://www.reclameaqui.com.br/feegow/feegow-dificulta-intencionalmente-o-cancelamento-de-assinatura_okNeEaP7VfHYG5SX/), [iClinic RA](https://www.reclameaqui.com.br/iclinic/dificuldade-para-cancelamento__a5cH2VyPJIfB2hF/), [Agendiva sobre Belle](https://agendiva.com.br/melhores-sistemas-para-clinica-de-estetica)

Isso significa duas coisas: existe insatisfação represada (demanda latente) e existe fricção contratual real para migrar (barreira de entrada para quem vende substituição, mas não para quem vende camada complementar).

### 4.6 Interoperabilidade é um mosaico, não um padrão

Não há padrão de mercado. O cenário real, verificado:

| Sistema | API pública documentada | Autenticação | Webhooks | Fonte |
|---|---|---|---|---|
| Feegow | Sim, aberta e autoatendida | Token `x-access-token` gerado pelo master | Sim | [docs.feegow.com](https://docs.feegow.com/) |
| Ninsaúde Apolo | Sim, coleção Postman pública | OAuth2 (refresh + access de 15 min) | Sim (gatilhos) | [ninsaude.com/desenvolvedores](https://www.ninsaude.com/pt-br/desenvolvedores/) |
| Docplanner/Doctoralia | Sim, mas voltada a parceiros PMS aprovados | OAuth2 + IP whitelisting | Sim (push e pull FIFO 72h) | [docplanner.github.io](https://docplanner.github.io/integrations-hub-front-app/docs/) |
| Shosp | Sim, chave + ID; parece atrelada ao plano Excellence | Chave personalizada e ID | não documentado publicamente | [shosp.com.br/desenvolvedores](https://www.shosp.com.br/desenvolvedores) |
| Trinks | Existe, sob solicitação (token em até 48h) | Token vinculado ao estabelecimento | Sim | [trinks.readme.io](https://trinks.readme.io/reference/introducao) |
| iClinic | Não localizada | não aplicável | não aplicável | [docs.iclinic.com.br](https://docs.iclinic.com.br/) e [extensões](https://suporte.iclinic.com.br/pt-br/adicionar-extensoes) |
| Simples Dental | Não existe (declaração oficial) | não aplicável | não aplicável | [ajuda.simplesdental.com](https://ajuda.simplesdental.com/pt-BR/articles/2667300-o-simples-dental-tem-integracao-via-api-com-outros-softwares) |
| Amplimed | Não localizada | não aplicável | não aplicável | [amplimed.com.br](https://www.amplimed.com.br/) |
| Clinicorp | Não localizada (integrável via terceiros) | não aplicável | não aplicável | [cloudia.com.br](https://cloudia.com.br/) |
| Belle | Não localizada (integra via Pluga e conectores) | não aplicável | não aplicável | [ajuda.bellesoftware.com.br](https://ajuda.bellesoftware.com.br/knowledge-base/integracoes/) |
| Avec | Não localizada | não aplicável | não aplicável | busca sem resultado |

### 4.7 Resposta direta à pergunta crítica: dá para integrar com iClinic e Feegow?

**Feegow: sim, com baixo atrito.** API aberta, documentada publicamente, token autogerado pelo cliente com permissões granulares, webhooks, mais de 200 funções, cobrindo agendamentos, pacientes, profissionais, financeiro e prontuário. O risco é operacional, não técnico: a Feegow declara que não presta apoio à integração além de esclarecer a documentação. Fontes: [docs.feegow.com](https://docs.feegow.com/) e [ajuda.feegow.com](https://ajuda.feegow.com/support/solutions/articles/67000714396-como-integrar-o-feegow-via-api-com-outros-sistemas-)

**iClinic: não por caminho público.** Não foi localizada nenhuma documentação de API REST, autenticação, endpoints ou webhooks. O único material técnico público é de importação de planilhas, e as únicas extensões oficiais são Google Calendar e Apple Calendar (esta última somente leitura). O ecossistema de fornecedores de IA de atendimento não lista iClinic entre seus sistemas integráveis, ao contrário de Feegow e Clinicorp. Integrar com iClinic exigirá negociação bilateral com a Afya, ou alternativas fora do caminho oficial. Fontes: [docs.iclinic.com.br](https://docs.iclinic.com.br/), [suporte.iclinic.com.br](https://suporte.iclinic.com.br/pt-br/adicionar-extensoes), [Cloudia](https://cloudia.com.br/), [Clinia](https://clinia.io/)

**Implicação de roadmap: lançar integrando Feegow, Ninsaúde e Shosp (todos com API documentada) e tratar iClinic como projeto separado de parceria comercial com a Afya.**

---

## 5. Faixa de preço realista para um SaaS "mais caro porém resolve atendimento"

### 5.1 Onde ficam as âncoras reais de preço

**Teto público do PMS puro por profissional:** Doctoralia VIP a R$ 679/mês, com Plus a R$ 529 e Starter a R$ 429. Fonte: [pro.doctoralia.com.br/preco](https://pro.doctoralia.com.br/preco)

**Teto público do PMS por clínica:** Clinicorp Premium a R$ 369,90/mês com usuários ilimitados. Fonte: [clinicorp.com/planos](https://www.clinicorp.com/planos)

**Preço já praticado por IA de atendimento pura, sem gestão:** Secretar.AI a R$ 360 (solo), R$ 720 (consultório, 5 usuários) e R$ 1.080 (clínica, 15 usuários). Fonte: [secretar.ai](https://secretar.ai/)

**Preço já praticado só pelo módulo de WhatsApp em estética:** Belle BelleMessage a R$ 229/mês, isolado, sobre a mensalidade base. Fonte: [bellesoftware.com.br/precos](https://www.bellesoftware.com.br/precos/)

### 5.2 O que os números dizem sobre R$ 600 a R$ 700

A intuição do cliente está correta e é defensável com dados públicos. R$ 600 a R$ 700 por mês:

1. **Fica abaixo do teto público existente por profissional.** A Doctoralia já cobra R$ 679/mês por profissional em plano anual, e é um produto de captação e agenda, sem agente autônomo de atendimento. Vender R$ 600 a R$ 700 por clínica (não por profissional) é objetivamente mais barato que uma única assinatura VIP da Doctoralia. Fonte: [pro.doctoralia.com.br/preco](https://pro.doctoralia.com.br/preco)
2. **Fica dentro da faixa já validada por concorrentes diretos de atendimento com IA.** O plano Consultório da Secretar.AI custa exatamente R$ 720/mês. Ou seja, a faixa de R$ 600 a R$ 700 não é uma aposta, é o meio da distribuição já paga. Fonte: [secretar.ai](https://secretar.ai/)
3. **É defensável contra a soma do stack atual da clínica.** Uma clínica de 4 profissionais no Feegow VIP paga 4 x R$ 249 = R$ 996/mês só de gestão, e ainda precisa contratar Cloudia, Clinia ou ChatLabs separadamente para resolver WhatsApp. Fontes: [feegowclinic.com.br/precos-e-planos](https://feegowclinic.com.br/precos-e-planos) e [feegowclinic.com.br/destaques/interoperabilidade](https://feegowclinic.com.br/destaques/interoperabilidade)

### 5.3 Recomendação de estrutura de preço

**Faixa recomendada: R$ 597 a R$ 897 por clínica/mês, com usuários ilimitados e cobrança por clínica, não por profissional.**

Justificativa das três decisões:

**Por que por clínica e não por profissional.** Todo o mercado médico cobra por profissional (iClinic, Feegow, Amplimed, Shosp, Doctoralia), o que penaliza justamente a clínica que cresce e é a mesma clínica que mais sofre com atendimento. O Clinicorp já provou que dá para cobrar por clínica com usuários ilimitados (R$ 369,90 Premium) e tem a melhor reputação da amostra médica (8,3/10). Cobrar por clínica é diferenciação de modelo, não só de preço. Fonte: [clinicorp.com/planos](https://www.clinicorp.com/planos)

**Por que começar em torno de R$ 600 e não abaixo.** Abaixo de R$ 400 o produto colide com PMS completo (Clinicorp Premium R$ 369,90, Simples Dental Pro R$ 349,90) e perde o enquadramento de "resolve atendimento". A posição precisa ser lida como categoria diferente, não como PMS caro.

**Por que ter um degrau até cerca de R$ 900.** A Secretar.AI já cobra R$ 1.080 no plano de 15 usuários, o que mostra que o teto de disposição a pagar da clínica média está acima de R$ 700. Fonte: [secretar.ai](https://secretar.ai/)

Estrutura sugerida (a validar comercialmente):

| Faixa | Preço sugerido | Perfil |
|---|---|---|
| Consultório | R$ 597/mês | Até 3 profissionais, 1 unidade |
| Clínica | R$ 897/mês | Até 10 profissionais, agentes proativos de reativação e cobrança |
| Rede | sob consulta | Multiunidade, SLA contratual |

### 5.4 Como sustentar o preço premium (o que precisa estar na promessa)

Cada item abaixo ataca uma lacuna documentada acima, e é o que permite cobrar 2x a 4x o preço de um PMS:

1. **SLA de suporte publicado em horas, não em dias.** É a variável com correlação mais forte com recompra na amostra (Simples Dental: 14 horas de resposta, 100% de recompra; iClinic: 16 dias e 21 horas, 50%). Fontes: [RA Simples Dental](https://www.reclameaqui.com.br/empresa/simples-dental/) e [RA iClinic](https://www.reclameaqui.com.br/empresa/iclinic/)
2. **Preço público e cancelamento autoatendido.** Ataca diretamente a queixa número um da Doctoralia (18% das reclamações são dificuldade de cancelamento) e as reclamações tituladas de iClinic e Feegow. Transformar isso em promessa de marca custa zero em produto. Fonte: [RA Doctoralia](https://www.reclameaqui.com.br/empresa/doctoralia/)
3. **Tudo incluso, sem módulo à parte.** Ataca a origem estrutural das reclamações de cobrança indevida, que lideram no Simples Dental (35,29%) e são o topo no iClinic (8,11%). Fontes: [RA Simples Dental](https://www.reclameaqui.com.br/empresa/simples-dental/) e [RA iClinic](https://www.reclameaqui.com.br/empresa/iclinic/)
4. **Agente com autonomia real e handoff, não chatbot.** O padrão de referência a bater é o trio da Clinicorp (agendamento reativo, relacionamento proativo, captação), que é a oferta mais completa da amostra e não tem preço público. Fonte: [clinicorp.com/agentes-clinicorp-ia](https://www.clinicorp.com/agentes-clinicorp-ia)
5. **Métrica de ROI explícita na proposta.** O mercado inteiro vende redução de no-show mas ninguém publica preço junto com a métrica. Amarrar o preço a taxa de comparecimento recuperada é o argumento que converte R$ 600 em decisão fácil.

### 5.5 Riscos de precificação a monitorar

- **Noa Booking da Doctoralia está anunciado como "em breve".** Se o Docplanner embutir agendamento por IA nos planos que já custam R$ 429 a R$ 679, o diferencial de agendamento automatizado vira commodity dentro do PMS. Fonte: [noa.ai/pt-br](https://noa.ai/pt-br/)
- **Clinicorp e Amplimed já têm agentes, apenas não publicam preço.** A ausência de preço público sugere venda consultiva de alto ticket, o que valida a faixa mas indica que a briga será comercial, não de feature. Fontes: [clinicorp.com/agentes-clinicorp-ia](https://www.clinicorp.com/agentes-clinicorp-ia) e [amplimed.com.br/amelia-agendamento](https://www.amplimed.com.br/amelia-agendamento/)
- **Dependência de API de terceiros é risco de plataforma.** Feegow declara que não presta suporte a integrações e as considera responsabilidade do cliente. Qualquer mudança de contrato de API é risco direto de receita. Fonte: [ajuda.feegow.com](https://ajuda.feegow.com/support/solutions/articles/67000714396-como-integrar-o-feegow-via-api-com-outros-sistemas-)

---

## 6. Limitações desta coleta

- Preço base do **Belle Software**, do **Avec** e do **Ninsaúde Apolo**: não publicado ou não acessível. A página de planos do Avec está bloqueada para coleta automatizada por robots.txt e as URLs de preços do Ninsaúde retornaram erro 404.
- Preços de faixas de clínica de **Amplimed**, **Trinks**, **Doctoralia** e **Feegow (10+)**: sob consulta, sem valores públicos.
- Preços dos agentes de IA de **Clinicorp** e **Amplimed**: não publicados.
- Preços de **Cloudia**, **Clinia** e **ChatLabs**: não publicados.
- As avaliações internacionais (Capterra/GetApp) têm volume muito baixo para os players brasileiros desta amostra (Feegow tem 1 avaliação verificada no GetApp, nota 4,0). Fonte: [GetApp Feegow](https://www.getapp.com/healthcare-pharmaceuticals-software/a/feegow/). Por isso o Reclame Aqui foi usado como fonte primária de reputação, por ter volume estatisticamente utilizável no Brasil.
