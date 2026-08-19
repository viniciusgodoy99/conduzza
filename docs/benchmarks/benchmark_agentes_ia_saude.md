# Benchmark: Agentes de IA para Atendimento e Agendamento em Saúde

Clínicas médicas, odontológicas e de estética. Brasil e exterior.

Data da pesquisa: 14 de agosto de 2026.

Metodologia e regra de honestidade: toda afirmação numérica traz URL de origem. Quando um dado não foi localizado em fonte pública, o campo está marcado como "não encontrado". Números de marketing divulgados pelos próprios fornecedores estão explicitamente rotulados como autodeclarados, porque não passam por auditoria independente.

---

## Sumário

1. Bloco 1: players brasileiros
2. Bloco 2: players do exterior
3. Bloco 3: dados de mercado com fonte
4. Bloco 4: regulatório e técnico brasileiro
5. Leitura estratégica: o que copiar, o que precificar, o que restringe o desenho

---

# BLOCO 1 - Brasil

## Visão geral do mercado brasileiro

O mercado brasileiro se divide em três camadas distintas, e essa separação importa para posicionamento:

**Camada A. Plataformas horizontais de atendimento multicanal e CRM.** Zaia, Digisac, Botconversa, Take Blip, Zenvia, Umbler Talk, Kommo, Huggy, Tallos e Robbu. Vendem caixa de entrada compartilhada, chatbot e IA genérica. Nenhuma delas tem agenda clínica nativa. Todas dependem de integração com o software de gestão da clínica para virar produto de saúde.

**Camada B. Players nichados em saúde.** Clinia, Cloudia, PevIA, Secretária IA, Laura Ai, Viti.ai. Vendem agente que agenda, confirma e reduz falta, integrado a sistemas de gestão clínica. Preço muito mais baixo que a camada A quando publicado, e quase sempre com agendamento como funcionalidade central e não como add-on.

**Camada C. Softwares de gestão clínica que estão adicionando IA.** Feegow, Clinicorp, Simples Dental, Doctoralia. Não foram objeto principal desta pesquisa, mas aparecem como parceiros de integração da camada B e são o caminho de distribuição mais óbvio.

A conclusão comercial mais importante deste bloco: quem publica preço no Brasil publica preço baixo. A faixa de entrada dos players nichados fica entre R$ 297 e R$ 897 por mês. Já as plataformas horizontais grandes começam em R$ 600 a R$ 3.900 por mês e não entregam agendamento clínico.

---

## Camada A. Plataformas horizontais

### Zaia

**O que faz.** Plataforma no-code descrita pela empresa como "Agentic OS" para criar agentes de IA autônomos. Componentes: Vibe Agent (criação de agente conversando com a IA), Squads (times de agentes), CRM nativo com tickets e histórico, e mais de 60 integrações via MCP. Canais: WhatsApp, Instagram, widget e API.
Fonte: https://zaia.app/

**Preço publicado.** Plano gratuito para começar, sem cartão de crédito. Plano pago citado a partir de R$ 150 por mês. Enterprise sob medida a partir de R$ 5.000 por mês em assinatura anual.
Fonte: https://zaia.app/

**API oficial do WhatsApp.** Não confirmado na página institucional. A Zaia lista WhatsApp como canal, mas não declara publicamente se a conexão é via Cloud API da Meta ou via conexão não oficial. Marcado como não encontrado.

**Agendamento nativo.** Não. Google Calendar aparece na lista de integrações nativas, o que significa agendamento por integração, não agenda clínica própria com bloqueio de horário por profissional, sala, convênio ou duração de procedimento.
Fonte: https://zaia.app/

**Leitura.** Zaia é infraestrutura de agente, não produto de saúde. Um concorrente indireto que vira fornecedor de camada se você quiser terceirizar orquestração.

---

### Digisac

**O que faz.** Plataforma multicanal de atendimento que centraliza WhatsApp, Instagram, Telegram e webchat em um só ambiente, com chatbots, funis de venda, agentes inteligentes e relatórios em tempo real. Tem vertical declarada para saúde com a promessa de "organizar agendamentos, confirmações e retornos", e o agente inteligente inclui "integração com agendamentos".
Fonte: https://digisac.com.br/

**Preço publicado.** Não encontrado. A Digisac não expõe tabela pública; o site direciona para consultor comercial e oferece teste gratuito de 7 dias.
Fonte: https://digisac.com.br/

**API oficial do WhatsApp.** Sim. O site declara explicitamente centralizar conversas de "WhatsApp (via API Oficial)".
Fontes: https://digisac.com.br/ e https://digisac.com.br/canais/whatsapp-api

**Agendamento nativo.** Parcial. Existe "integração com agendamentos", ou seja, o agendamento acontece no sistema da clínica e a Digisac orquestra a conversa. Não é agenda própria.
Fonte: https://digisac.com.br/

---

### Botconversa

**O que faz.** Automação de WhatsApp com construtor de fluxo e IA, voltada a vendas e atendimento. Posicionamento de massa, forte no público de infoprodutores e pequenas empresas.
Fonte: https://www.botconversa.com.br/

**Preço publicado.** Plano Starter a R$ 189 por mês. Plano Pro com API Oficial a R$ 199 por mês, com 17% de desconto no anual.
Fonte: https://www.botconversa.com.br/

**API oficial do WhatsApp.** Depende do plano, e esse é o ponto crítico. O plano Starter NÃO inclui a API oficial. Somente o plano Pro inclui a "API Oficial da META", com o argumento de que "reduz risco de bloqueio", e oferece "conexão de coexistência", descrita como o nível mais avançado da API oficial da Meta. No plano Pro há custo adicional por mensagem, além da mensalidade.
Fonte: https://www.botconversa.com.br/

**Agendamento nativo.** Não encontrado como funcionalidade nativa de agenda clínica.

**Leitura.** O fato de o plano de entrada não usar API oficial é exatamente o risco que uma clínica não pode correr: número bloqueado significa agenda parada. Isso é argumento de venda direto contra a categoria.

---

### Take Blip

**O que faz.** Plataforma de experiência conversacional de grande porte, parceira oficial da Meta com certificação Business Solution Provider. Foco em operações enterprise.
Fonte: https://www.blip.ai/planos/

**Preço publicado.**
- Gratuito: até 2 atendentes, conversas limitadas.
- Plus: até 30 atendentes, 2 mil conversas únicas por mês, R$ 1,40 por conversa adicional, R$ 150 por atendente adicional, suporte 8x5, SLA 95%.
- Super: até 50 atendentes, 5 mil conversas únicas por mês, R$ 1,25 por conversa adicional, R$ 100 por atendente adicional, suporte 24x7, SLA 99,5%.
- Enterprise: atendentes ilimitados, conversas sob demanda, valor sob consulta.
Fonte: https://www.blip.ai/planos/

Observação: o valor mensal dos planos Plus e Super não aparece explicitado na página consultada, apenas os limites e os excedentes. Valor de mensalidade: não encontrado.

**API oficial do WhatsApp.** Sim. Parceira oficial da Meta, com WhatsApp incluído nos planos Startup, Lite, Plus e Super. No Enterprise o canal WhatsApp é cobrado separadamente conforme uso.
Fonte: https://www.blip.ai/planos/

**Agendamento nativo.** Não encontrado.

---

### Zenvia

**O que faz.** Zenvia Customer Cloud, plataforma de comunicação e CX multicanal (SMS, WhatsApp, e-mail, voz) com camada de automação e IA.
Fonte: https://www.zenvia.com/precos/

**Preço publicado.** Software:
- Starter: R$ 0 por mês, 1 usuário, 100 "interactionz".
- Specialist: R$ 600 por mês, 10 usuários, 500 interactionz.
- Expert: R$ 1.800 por mês, 30 usuários, 2.000 interactionz.
- Professional: R$ 3.900 por mês, 50 usuários, 5.000 interactionz.
- Enterprise: sob consulta.

Pacotes de canais, cobrados à parte:
- R$ 100 por mês: até 1.000 SMS ou 182 WhatsApp.
- R$ 250 por mês: até 2.942 SMS ou 472 WhatsApp.
- R$ 500 por mês: até 6.250 SMS ou 981 WhatsApp.
- R$ 1.000 por mês: até 13.334 SMS ou 2.041 WhatsApp.
- R$ 2.000 por mês: até 28.572 SMS ou 4.256 WhatsApp.
Fonte: https://www.zenvia.com/precos/

**API oficial do WhatsApp.** Sim, com exigência de registro empresarial (CNPJ) conforme política da Meta.
Fonte: https://www.zenvia.com/precos/

**Agendamento nativo.** Não. Nenhuma menção a agendamento na página de preços.
Fonte: https://www.zenvia.com/precos/

**Leitura de precificação relevante.** O pacote de canais da Zenvia implica um custo aproximado de R$ 0,49 a R$ 0,55 por conversa de WhatsApp (R$ 100 dividido por 182; R$ 2.000 dividido por 4.256). Compare com o custo de mensagem utility da Meta, discutido no Bloco 4. Isso mostra a margem embutida por revendedores brasileiros e é uma oportunidade de posicionamento por transparência de custo.

---

### Umbler Talk

**O que faz.** Chatbot e caixa de entrada de WhatsApp para pequenas e médias empresas, com construtor visual de chatbot, campanhas e agentes de IA.
Fonte: https://a.umbler.com/br/talk/

**Preço publicado.**
- Basic, apenas anual: R$ 69 por mês, 2 agentes, 1 número de WhatsApp, sem campanhas em massa e sem API.
- Professional: R$ 79 por mês no anual ou R$ 99 no trimestral, até 3 números de WhatsApp, construtor visual de chatbot, agendamento de mensagens e campanhas.
- Enterprise: R$ 109 por mês no anual ou R$ 129 no trimestral, até 3 números mais 1 adicional por agente, agentes de IA avançados com bônus de 400 respostas, integração via API e logs de atividade.
Fonte: https://a.umbler.com/br/talk/

**API oficial do WhatsApp.** Sim. A página declara uso da API oficial do WhatsApp.
Fonte: https://a.umbler.com/br/talk/

**Agendamento nativo.** Não de consulta. O que existe é "agendamento de mensagens", ou seja, disparo programado. Isso é diferente de agenda clínica.
Fonte: https://a.umbler.com/br/talk/

---

### Kommo

**O que faz.** CRM de mensagens com pipeline visual, integrações de canais e automações. É o player horizontal que mais se aproxima do nosso caso de uso.
Fonte: https://www.kommo.com/pricing/

**Preço publicado.**
- Base: US$ 15 por usuário por mês.
- Advanced: US$ 25 por usuário por mês.
- Pro: US$ 45 por usuário por mês.
- Enterprise: preço customizado.
Faturamento mínimo de 6 meses, sem opção mensal avulsa.
Fonte: https://www.kommo.com/pricing/

**API oficial do WhatsApp.** Sim. O site declara conexão direta com a "official WhatsApp Business Platform".
Fonte: https://www.kommo.com/pricing/

**Agendamento nativo.** Sim, mas só a partir do plano Pro (US$ 45 por usuário por mês). Inclui criação de páginas de agendamento, compartilhamento de link de calendário, automação de confirmações e lembretes, e um "AI booking agent" que, segundo a Kommo, cuida de agendamento, checagem de disponibilidade e conversas de reserva automaticamente dentro do chat. Os planos Base e Advanced não incluem booking.
Fonte: https://www.kommo.com/pricing/

**Leitura.** Kommo é o benchmark mais direto de "agente de IA que agenda" entre os horizontais. E é caro para clínica: uma clínica com 4 pessoas no Pro paga US$ 180 por mês, algo em torno de R$ 900 a R$ 1.000, ainda sem integração com a agenda clínica real (disponibilidade por profissional, convênio, tipo de procedimento).

---

### Huggy

**O que faz.** Plataforma de atendimento digital multicanal com filas, departamentos, fluxos e relatórios.
Fonte: https://www.huggy.io/pt-br/pricing

**Preço publicado.**
- Starter: R$ 0 por mês, 1 usuário conectado, mais R$ 69,90 por mês por usuário adicional. Gestão de contatos, fila de atendimento, envio de arquivos, multicontas, indicadores, app mobile e todos os canais.
- Intermediário: a partir de R$ 579 por mês, 1 usuário conectado, mais R$ 119,90 por usuário adicional. Adiciona departamentos, horário comercial, timeline do contato, campos personalizados, monitoramento de chat, relatórios, API e webhooks, fluxos e histórico.
- Custom: a partir de R$ 989 por mês, 1 usuário conectado, mais R$ 189,90 por usuário adicional. Adiciona dashboard, distribuição automática, histórico ilimitado, fluxos ilimitados.
Desconto de 20% no anual. WhatsApp disponível em todos os planos, com restrições no Starter.
Fonte: https://www.huggy.io/pt-br/pricing

**API oficial do WhatsApp.** Não declarado explicitamente na página de preços. Marcado como não encontrado.

**Agendamento nativo.** Não encontrado.

---

### Tallos (hoje RD Station Conversas)

**O que faz.** A Tallos foi integrada ao portfólio da RD Station e é comercializada como RD Station Conversas: atendimento multicanal com copiloto de IA, qualificação inteligente de leads e transcrição de áudio com sugestão de resposta.
Fonte: https://rdstation.com/planos/tallos/

**Preço publicado.**
- Basic: R$ 989 por mês, até 500 clientes por mês.
- Pro: R$ 2.699 por mês, até 3.000 clientes por mês.
- Advanced: sob consulta, 5.000 ou mais.
Desconto de 10% no anual. Carteira de créditos cobrada à parte, mínimo de R$ 300 anuais, para envios via WhatsApp Business API, com custo variável por categoria (marketing, utilidade ou autenticação).
Fonte: https://rdstation.com/planos/tallos/

**API oficial do WhatsApp.** Sim. Parceira oficial BSP da Meta.
Fonte: https://rdstation.com/planos/tallos/

**Agendamento nativo.** Não de consulta. Existe "agendamento de envios" para campanhas.
Fonte: https://rdstation.com/planos/tallos/

---

### Robbu

**O que faz.** Plataforma de comunicação omnichannel com o produto Positus / WhatsApp Studio para WhatsApp Business API, chatbot IDR e automação de vendas e cobrança.
Fontes: https://robbu.com.br/planos/ e https://robbu.global/produtos/whatsapp-studio-positus/

**Preço publicado.**
- Essencial: a partir de R$ 1.200 por mês, 1.200 contatos mensais, atendimento ilimitado, chatbot IDR, números de WhatsApp ilimitados. Contato adicional a R$ 1,10.
- Performance: a partir de R$ 3.000 por mês, 3.000 contatos mensais, mesmas inclusões. Contato adicional a R$ 1,05.
- Enterprise: sob consulta, números e usuários ilimitados.
Fonte: https://robbu.com.br/planos/

**API oficial do WhatsApp.** Sim. A Robbu opera como provedor de WhatsApp Business API através do Positus.
Fonte: https://robbu.global/produtos/whatsapp-studio-positus/

**Agendamento nativo.** Não encontrado.

**Leitura de precificação.** O modelo de "contato único mensal" a R$ 1,00 a R$ 1,10 é o mais caro por unidade de conversa entre os brasileiros analisados, e é ordens de grandeza acima do custo de mensagem da Meta. Isso confirma que precificação por conversa no Brasil ainda é uma caixa preta favorável a quem vende.

---

### Lais.ai / Laís IA

Atenção a uma ambiguidade de marca importante. Há duas empresas com nome semelhante:

**lais.ai** é IA para o mercado imobiliário, não saúde.
Fonte: https://lais.ai/

**lais.app (Laís IA)** é a plataforma brasileira que une IA, CRM e WhatsApp oficial. Atende múltiplos setores, incluindo clínicas e consultórios, com palavras-chave declaradas de "chatbot para clínicas" e "automação para consultórios", além de "sistema agendamento whatsapp".
Fonte: https://lais.app/

**Preço publicado.** Não encontrado.

**API oficial do WhatsApp.** Sim, declarado como "WhatsApp oficial".
Fonte: https://lais.app/

**Agendamento nativo.** Referenciado como sistema de agendamento por WhatsApp, mas sem detalhamento público de agenda clínica. Parcialmente confirmado.
Fonte: https://lais.app/

---

## Camada B. Players nichados em clínica (os concorrentes diretos)

Esta é a camada que importa. São os que já resolveram o posicionamento, a integração e o preço.

### Clinia

**O que faz.** Plataforma de IA para clínicas e hospitais que automatiza agendamento, confirmação e atendimento 24 horas por dia via WhatsApp. Centraliza a comunicação, automatiza fluxos e entrega analytics operacional.
Fonte: https://clinia.io/

**Preço publicado.** Não encontrado. O site oferece teste gratuito e referencia uma página de planos, mas sem valores expostos.
Fonte: https://clinia.io/

**API oficial do WhatsApp.** Sim, confirmado no FAQ do próprio site: "A plataforma utiliza a API Oficial do WhatsApp Business para automatizar a comunicação com os pacientes."
Fonte: https://clinia.io/

**Agendamento nativo.** Sim, com agendamento, confirmação e reagendamento automatizados.

**Integrações declaradas.** Feegow, Clinicorp, Gesthor, Interprocess, Optimus Clinic e Amigo. A Clinia se posiciona como camada ao lado do sistema de gestão existente, conectando via API, e não como substituta.
Fonte: https://clinia.io/

**Leitura.** É o concorrente brasileiro mais bem posicionado que encontramos. A lista de integrações é o ativo defensável, não a IA.

---

### Cloudia

**O que faz.** "Secretária virtual" com IA para saúde, automatizando comunicação de pacientes em WhatsApp, Instagram, Facebook e site. Agendamento de consultas, respostas a dúvidas e follow-up.
Fontes: https://cloudia.com.br/ e https://cloudia.com.br/precos/

**Preço publicado.** Parcialmente publicado, com estrutura visível mas valores de mensalidade não expostos:
- Cloudia Pro [IA]: 5 usuários atendentes, IA, CRM, relatórios, suporte via WhatsApp. Recursos: agente de IA, interpretação de imagem, chatbot tradicional, resposta a áudio. Valor da mensalidade não encontrado.
- Cloudia Elite: sob consulta. Adiciona resumo e sugestões por IA, integrações personalizadas, agendamento por IA, lembretes automatizados e pesquisa de satisfação.

Faixas de volume oferecidas no seletor: 200, 400, 600, 900 e 1.200 pacientes por mês.

Módulos adicionais com preço publicado:
- Resumo e sugestões por IA: R$ 100 por mês.
- Número adicional de WhatsApp: R$ 200 por número por mês.
- Atendente adicional: R$ 30 por usuário por mês.
- Onboarding a partir de R$ 700.
Desconto de 8% a 16% no anual.
Fonte: https://cloudia.com.br/precos/

**API oficial do WhatsApp.** Sim, declarado.
Fonte: https://cloudia.com.br/

**Agendamento nativo.** Sim, agendamento de consultas como funcionalidade central.

**Integrações declaradas.** Mais de 15 sistemas de gestão em saúde, incluindo ClinicWeb, Moderna, Dental Office e SISO.
Fonte: https://cloudia.com.br/

**Resultado numérico divulgado (autodeclarado).** "Mais de 1.000 clínicas" usando a plataforma. Não é métrica de eficácia, é métrica de base instalada.
Fonte: https://cloudia.com.br/

**Leitura de modelo de negócio.** A Cloudia precifica por volume de pacientes por mês, não por usuário. Esse é o modelo correto para saúde e é o que devemos copiar: alinha preço a valor entregue (volume de conversa e de agenda preenchida) e não a headcount da recepção, que é pequeno e não cresce.

---

### PevIA

**O que faz.** Agente de IA especializado em clínicas odontológicas. Atendimento por WhatsApp, agendamento 24 horas por dia, lembretes, redução de faltas, além de módulo de marketing para conteúdo de redes sociais.
Fonte: https://pevia.com.br/

**Preço publicado. Este é o benchmark de preço mais claro do mercado brasileiro nichado.**
- Start: R$ 297 por mês. Agente de IA no WhatsApp 24 horas por dia, agendamento inteligente, lembretes, dashboard básico, 1 atendente humano. Setup único de R$ 500.
- Pro: R$ 497 por mês. Tudo do Start mais CRM odontológico completo, campanhas de reativação de pacientes inativos, acompanhamento de funil de conversão, campanhas segmentadas, até 3 atendentes humanos, roteamento por setor, relatórios avançados e suporte prioritário. Setup gratuito por tempo limitado.
- Ultra: R$ 897 por mês. Tudo do Pro mais até 10 atendentes humanos, módulo de marketing incluso, pesquisa de satisfação automática com solicitação de avaliação no Google, agendamento multi-dentista, tokens de IA dobrados (600 mil mensais), onboarding dedicado e suporte prioritário.
Sem contrato, cancelamento a qualquer momento, garantia de satisfação de 7 dias, ativação em 24 horas.
Fonte: https://pevia.com.br/planos.php

**API oficial do WhatsApp.** Não confirmado explicitamente. A página diz que o agente opera "via WhatsApp, que sua clínica já usa", o que é ambíguo e pode indicar conexão não oficial. Marcado como não encontrado.
Fonte: https://pevia.com.br/

**Agendamento nativo.** Sim, com sincronização com a disponibilidade real da clínica.

**Integrações declaradas.** Software odontológico, Google Agenda, planilhas e ferramentas existentes.
Fonte: https://pevia.com.br/

**Resultados numéricos divulgados (autodeclarados, sem metodologia publicada).**
- 98% de uptime.
- 3 segundos de tempo médio de resposta.
- 52% de redução em no-shows.
- 38% de aumento em conversão de agendamentos.
- Payback em menos de 2 consultas.
Fonte: https://pevia.com.br/

**Leitura.** O argumento de "payback em menos de 2 consultas" é a peça de copy mais eficiente que encontramos em todo o benchmark brasileiro. Com mensalidade de R$ 297 e ticket médio odontológico acima de R$ 150, o argumento se fecha sozinho na cabeça do dono da clínica.

---

### Secretária IA

**O que faz.** Atendimento e agendamento via WhatsApp com IA, confirmações automáticas e lembretes, para médicos e dentistas.
Fonte: https://usesecretariaia.com/

**Preço publicado.** Não encontrado para os planos de entrada. Há um "plano personalizado Profissional" sob consulta para clínicas de maior volume.
Fonte: https://usesecretariaia.com/

**API oficial do WhatsApp.** Indicado pelo uso da plataforma Meta e logos de integração, mas sem declaração textual inequívoca. Parcialmente confirmado.
Fonte: https://usesecretariaia.com/

**Agendamento nativo.** Sim. "Agenda Google Calendar Nativa" com sincronização automática de agendamentos, reagendamentos e cancelamentos em tempo real.
Fonte: https://usesecretariaia.com/

**Integrações declaradas.** Nativamente Google Calendar, Clinicorp e Feegow. Sob contratação, outros sistemas com API aberta como DentalOffice e Clínica nas Nuvens.
Fonte: https://usesecretariaia.com/

**Resultados numéricos divulgados (autodeclarados).** Mais de 300 consultórios ativos, e conversão de "95% desses leads automaticamente", com ressalva do próprio site de que é estimativa interna.
Fonte: https://usesecretariaia.com/

---

### Laura Ai

**O que faz.** Agente de IA no WhatsApp para automatizar agendamentos de clínica médica, com atendimento 24 horas por dia e configuração declarada em 15 minutos.
Fonte: https://lauraai.com.br/

**Preço publicado.** Não encontrado.

**API oficial do WhatsApp.** Não encontrado.

**Agendamento nativo.** Sim, é a proposta central.

**Resultado numérico divulgado (autodeclarado).** "Automatize até 90% dos agendamentos da sua clínica médica."
Fonte: https://lauraai.com.br/

---

### Viti.ai

**O que faz.** Agente de IA treinado especificamente para clínicas de estética e odontológicas. Agenda consultas, confirma horários, reduz no-shows e reativa pacientes automaticamente no WhatsApp.
Fonte: https://viti.ai/

**Preço publicado.** Não encontrado.

**API oficial do WhatsApp.** Não encontrado.

**Agendamento nativo.** Declarado, sem detalhamento técnico público.

**Resultados numéricos.** Não encontrado.

**Leitura.** É o player brasileiro com posicionamento mais próximo do nosso (estética mais odontologia), e o mais opaco em informação pública. Vale monitorar.

---

## Tabela consolidada Brasil

| Player | Camada | Preço publicado (mês) | API oficial WhatsApp | Agendamento nativo |
|---|---|---|---|---|
| Zaia | Horizontal | Grátis; R$ 150; Enterprise a partir de R$ 5.000 | Não encontrado | Não (via Google Calendar) |
| Digisac | Horizontal | Não encontrado | Sim | Parcial (integração) |
| Botconversa | Horizontal | R$ 189 Starter; R$ 199 Pro | Só no plano Pro | Não encontrado |
| Take Blip | Horizontal | Mensalidade não encontrada; R$ 1,25 a R$ 1,40 por conversa excedente | Sim (BSP Meta) | Não encontrado |
| Zenvia | Horizontal | R$ 0 / 600 / 1.800 / 3.900 + pacote de canal | Sim | Não |
| Umbler Talk | Horizontal | R$ 69 / 79 / 109 (anual) | Sim | Não (só agendamento de mensagem) |
| Kommo | Horizontal | US$ 15 / 25 / 45 por usuário | Sim | Sim, a partir do Pro, com AI booking agent |
| Huggy | Horizontal | R$ 0 / 579 / 989 + por usuário | Não encontrado | Não encontrado |
| Tallos (RD Conversas) | Horizontal | R$ 989 / 2.699 / sob consulta | Sim (BSP Meta) | Não (só envio agendado) |
| Robbu | Horizontal | R$ 1.200 / 3.000 / sob consulta | Sim (Positus) | Não encontrado |
| Laís IA (lais.app) | Horizontal com verticalização | Não encontrado | Sim | Parcial |
| Clinia | Nichado saúde | Não encontrado | Sim | Sim, com 6 integrações de gestão |
| Cloudia | Nichado saúde | Módulos publicados; mensalidade não encontrada | Sim | Sim, com mais de 15 integrações |
| PevIA | Nichado odonto | R$ 297 / 497 / 897 | Não encontrado | Sim |
| Secretária IA | Nichado saúde | Não encontrado | Parcial | Sim (Google Calendar nativo) |
| Laura Ai | Nichado saúde | Não encontrado | Não encontrado | Sim |
| Viti.ai | Nichado estética/odonto | Não encontrado | Não encontrado | Sim |

---

# BLOCO 2 - Exterior

Objetivo deste bloco: extrair ideias de produto e, principalmente, entender qual métrica cada líder escolheu para vender. A escolha da métrica é a decisão de posicionamento.

## Assort Health

**Dor que resolve.** Gargalo de acesso do paciente: fila de espera no telefone, agendamento manual, triagem complexa e ausência de resposta fora do horário. Posiciona o agente de IA explicitamente como substituto superior ao URA/IVR tradicional.
Fonte: https://www.assorthealth.com/

**Funcionalidades de destaque.**
- Agendamento e gestão de consultas 24 horas por dia.
- Triagem e roteamento inteligente.
- Intake (admissão) do paciente.
- Automação de encaminhamentos (referrals).
- Resolução de pagamentos.
- Rastreamento de tarefas.
- Atendimento fora do horário.
- Contato proativo (outbound) com pacientes.
- Cobertura de mais de 23 especialidades médicas, com agentes especialidade-específicos.
Fonte: https://www.assorthealth.com/

**Preço.** Não publicado no site oficial; direciona para demo.
Fonte: https://www.assorthealth.com/
Terceiro reporta faixa de US$ 1.500 por mês para clínicas pequenas até US$ 10.000 ou mais por mês para grandes organizações. Fonte de terceiro, não oficial: https://emitrr.com/blog/assort-health-pricing/

**Resultados numéricos divulgados.**
Do site oficial:
- Nota 4,3 de 5 em 344 mil avaliações de pacientes.
- US$ 3,3 milhões de receita anual por 100 profissionais.
- Aumento de 5% no volume de agendamentos.
- Aumento de 115% em capacidade de trabalho.
- Redução de 89% a 97% no tempo de espera em casos específicos.
- Redução de 75% a 81% na taxa de abandono de chamadas.
- Receita capturada de US$ 1,3 milhão a US$ 2,3 milhões em casos individuais.
Fonte: https://www.assorthealth.com/

Do comunicado oficial da Série B:
- 89% de redução no tempo de espera do paciente ao telefone.
- 98% de taxa de resolução de chamadas.
- PSAT (satisfação do paciente) acima de 94%.
- Dezenas de milhões de interações de pacientes em milhares de prestadores.
Fonte: https://www.prnewswire.com/news-releases/assort-health-secures-102-million-to-scale-nations-first-agentic-ai-platform-that-solves-longstanding-frustrations-tied-to-patient-access-and-experience-302570046.html

**Capital.** US$ 102 milhões totais captados, dos quais US$ 76 milhões na Série B liderada pela Lightspeed Venture Partners, com Felicis, First Round Capital, Chemistry, A*, Liquid2 e Quiet Capital. Série A concluída apenas quatro meses antes.
Fonte: https://www.prnewswire.com/news-releases/assort-health-secures-102-million-to-scale-nations-first-agentic-ai-platform-that-solves-longstanding-frustrations-tied-to-patient-access-and-experience-302570046.html

**Ideia a roubar.** Agentes especialidade-específicos. A Assort não vende "um agente de IA". Vende um agente de ortopedia, um de gastro, um de oftalmo. Em saúde, a especificidade é a barreira de entrada, porque cada especialidade tem seu próprio vocabulário, preparo de exame, duração de procedimento e regra de convênio. O equivalente brasileiro seria agente de odontologia, agente de estética, agente de dermatologia, cada um com base de conhecimento própria.

---

## Arini

**Dor que resolve.** Perda de receita por chamadas não atendidas e agendamento manual em consultórios odontológicos. Foco declarado em odontologia e DSOs (grupos de clínicas).
Fonte: https://www.arini.ai/

**Funcionalidades de destaque.**
- Recepcionista de IA que atende chamadas, agenda consultas e reativa pacientes.
- Confirmação de consulta com contato automático para reduzir faltas.
- Agendamento online integrado aos sistemas existentes.
- "Watchtower": painel de analytics que monitora a performance dos agentes de IA por unidade. Este é um diferencial relevante para redes com múltiplas unidades.
- Time de engenharia dedicado para DSOs grandes.
- Calculadora de ROI pública no site.
Fonte: https://www.arini.ai/

**Preço.** Não publicado. Apenas "Book a Demo" e calculadora de ROI.
Fonte: https://www.arini.ai/

**Resultados numéricos divulgados (estudos de caso da própria empresa).**
- Normandy Lake: mais de US$ 1,5 milhão de produção gerada e mais de 1.600 chamadas por mês.
- Wolfe Dental: US$ 140 mil de produção adicional em duas unidades.
- Unified Dental Care: mais de US$ 1 milhão em produção e 12% de crescimento de receita.
- Snow Orthodontics: US$ 125 mil de valor recuperado em chamadas perdidas.
- Acumulado da plataforma: 1 milhão de agendamentos marcados.
Fonte: https://www.arini.ai/

**Ideias a roubar.**
1. **Calculadora de ROI pública** como ferramenta de topo de funil. Transforma uma venda consultiva em autoatendimento.
2. **Métrica de produção em dinheiro, não em percentual.** A Arini não fala "reduzimos no-show em X%". Fala "geramos US$ 1,5 milhão de produção". Dono de clínica compra receita, não percentual.
3. **Painel de performance por unidade**, indispensável para vender para redes e franquias, que é justamente o segmento de maior ticket em odontologia e estética no Brasil.

---

## Hello Patient

**Dor que resolve.** Sobrecarga do front office. A empresa trata explicitamente o caos operacional em que pacientes esperam e equipes se esgotam.
Fonte: https://www.hellopatient.com/

**Funcionalidades de destaque.**
- Agendamento 24 horas por dia.
- Verificação de convênio e coleta antecipada de dados do paciente.
- Cobrança automatizada com assistente de RCM (revenue cycle management).
- Recuperação de faltas: reconecta com o paciente que faltou.
- Campanhas de recall para reconverter pacientes inativos.
- Opera por chamada, SMS e chat web, em múltiplas especialidades.
Fonte: https://www.hellopatient.com/

**Preço.** Não publicado.
Fonte: https://www.hellopatient.com/

**Resultados numéricos divulgados.**
- 100% de taxa de resposta em chamadas, SMS e chat, declarado como 25 pontos acima da média.
- 18% mais agendamentos, com média de 3 agendamentos adicionais por unidade por dia.
- 95% de redução no tempo de espera do paciente.
- Volume processado: 1,3 milhão de conversas, 327 mil chamadas e 993 mil mensagens.
Fonte: https://www.hellopatient.com/

**Conformidade.** HIPAA e SOC 2 Type 2 certificados. Isso é vendido como funcionalidade de produto, não como nota de rodapé.
Fonte: https://www.hellopatient.com/

**Capital.** US$ 22,5 milhões em Série A anunciada em 2025.
Fonte: https://www.businesswire.com/news/home/20250904242038/en/Hello-Patient-Raises-%2422.5-Million-Series-A-to-Fix-the-Front-Door-of-Healthcare-With-Conversational-AI

**Ideia a roubar.** A métrica "3 agendamentos adicionais por unidade por dia" é a tradução perfeita de percentual em unidade operacional que o gestor entende. É a métrica que devemos adotar no Brasil, convertida em reais pelo ticket médio da clínica.

---

## Parakeet Health

**Dor que resolve.** Acesso e agendamento. A tese da empresa está sintetizada na frase do próprio site: "Patients don't leave because of poor care. They leave because of poor access." Endereça perda de receita por chamadas não atendidas, cancelamentos e faltas, encaminhamentos não convertidos e pacientes inativos.
Fonte: https://www.parakeethealth.com/

**Funcionalidades de destaque.**
- Agendamento, remarcação e cancelamento automáticos.
- Processamento de fax e agendamento de encaminhamentos (relevante nos EUA, sem paralelo direto no Brasil).
- Recuperação de cancelamentos e remarcação de pacientes faltosos.
- Recall e reativação de pacientes.
- Respostas automáticas a FAQ (convênio, preparo de exame, localização).
- Disponibilidade 24 horas por dia, 7 dias por semana, 365 dias por ano.
- Canais: voz, SMS, fax e e-mail, integrados a EHR (Epic, Cerner, athenahealth entre outros).
Fonte: https://www.parakeethealth.com/

**Preço. Este é o item mais interessante do bloco.** Modelo pay-for-performance declarado: a empresa cobra apenas sobre resultados comprovados acima da linha de base do próprio cliente. O site é explícito: "No software seats. No vanity metrics." Não há custos fixos publicados.
Fonte: https://www.parakeethealth.com/

**Resultados numéricos divulgados.**
- 38% mais consultas agendadas em piloto head-to-head.
- 6x maior conversão em outbound.
- 42% mais chamadas atendidas.
- 60% de redução em custos operacionais de call center.
- ROI médio de 360% em 6 meses.
- 51% de redução no custo de aquisição de paciente.
- Implementação em 4 a 6 semanas com menos de 6 horas de trabalho interno do cliente.
Fonte: https://www.parakeethealth.com/

**Ideia a roubar, e é a maior deste relatório.** Precificação por performance com baseline. A Parakeet mede a taxa de no-show e a taxa de conversão da clínica ANTES de ligar o agente, estabelece a linha de base, e cobra sobre o delta. Isso elimina a objeção de preço, transfere risco do cliente para o fornecedor, e cria um dado proprietário (baseline de mercado por especialidade) que ninguém mais tem. Exige, em contrapartida, instrumentação de métricas desde o dia zero do produto.

---

## Simbie AI

**Dor que resolve.** Três dores declaradas: alta rotatividade de pessoal e custo de treinamento; erro humano e ineficiência em processos manuais; burnout de médicos e equipe.
Fonte: https://www.simbie.ai/

**Funcionalidades de destaque.**
- Registro e agendamento de pacientes, com coleta de informação pré-consulta.
- Chamadas de entrada e de saída automatizadas.
- Integração com EMR e documentação automática no prontuário do paciente.
- Gestão de medicação e remarcação.
- Educação do paciente e triagem.
Fonte: https://www.simbie.ai/

**Preço.** Não publicado. Modelo declarado como baseado em utilização, com convite para uma "calculadora de redução de custos".
Fonte: https://www.simbie.ai/

**Resultados numéricos divulgados.**
- 60% de economia em custos de pessoal administrativo.
- 24 horas por dia sem chamadas perdidas.
- Centenas de chamadas simultâneas com zero tempo de espera.
Fonte: https://www.simbie.ai/

**Capital.** Duas rodadas, incluindo pre-seed liderada pela Y Combinator. Valores exatos não divulgados publicamente.
Fonte: https://www.crunchbase.com/organization/simbie-health

**Ideia a roubar.** A documentação automática no prontuário é o que separa "chatbot" de "colega de trabalho". Se o agente conversa com o paciente e escreve o resultado dentro do sistema de gestão da clínica, ele deixa de ser um canal e passa a ser um funcionário. No Brasil, isso significa escrever de volta no Feegow, Clinicorp, iClinic ou Simples Dental, não apenas ler a agenda.

---

## Weave

**Dor que resolve.** Comunicação e operação de front office em consultórios de pequeno e médio porte, com integração de telefonia (VoIP), mensagens, formulários digitais, pagamentos e avaliações.
Fontes: https://www.getweave.com/ e https://www.getweave.com/pricing/

**Funcionalidades de destaque.**
- AI Receptionist: atende chamadas, agenda consultas e processa pagamentos.
- Response Assistant: responde avaliações automaticamente. Argumento da empresa: 97% das pessoas que leem avaliações também leem as respostas da empresa.
- Email Assistant.
- Transcrição de voicemail.
- Call Intelligence: analisa gravações e detecta oportunidades de receita.
- Confirmação de consulta por SMS.
- Recursos específicos por vertical: verificação de convênio apenas para odontologia, lembrete de vacinação apenas para veterinária.
Fontes: https://www.getweave.com/ e https://www.getweave.com/pricing/

**Preço publicado.** A partir de US$ 199 por mês. Três planos (Pro, Elite, Ultimate) com valores específicos não expostos.
- Pro: mensageria básica (1.500 mensagens), formulários digitais, chat de equipe.
- Elite: mensageria expandida (3.000 mensagens), analytics de chamadas.
- Ultimate: até 15 telefones VoIP, 15.000 mensagens mensais, treinamento personalizado.
Fonte: https://www.getweave.com/pricing/

**Verticais atendidas.** Odontologia, veterinária, medicina e optometria.
Fonte: https://www.getweave.com/pricing/

**Resultados numéricos divulgados.** Limitados e em formato de depoimento:
- Smith Dental: aumento de 28% em novos pacientes.
- Beaches Dental: economia de US$ 3.500 por ano.
Fonte: https://www.getweave.com/pricing/

**Ideias a roubar.**
1. **Verticalização de funcionalidade dentro do mesmo produto.** Uma funcionalidade aparece ou desaparece conforme a especialidade. É barato de implementar e muda a percepção de "feito para mim".
2. **Cota de mensagens no plano.** Weave vende 1.500, 3.000 ou 15.000 mensagens por plano. Isso resolve elegantemente a repassagem do custo variável da Meta, que é o principal problema de unit economics de qualquer produto de WhatsApp no Brasil (ver Bloco 4).
3. **Call Intelligence.** Analisar gravação de chamada para encontrar receita perdida é um produto adjacente de alta margem. No Brasil, o equivalente é analisar as conversas de WhatsApp já existentes da clínica e mostrar quantos leads morreram sem resposta. É um diagnóstico gratuito que vende o produto sozinho.

---

## Artera

**Dor que resolve.** Outreach manual que consome milhões em receita anualmente. Volume de chamadas, tempo de espera, burnout da equipe, gargalo de acesso, faltas e cancelamentos, agendamento complexo e verificação de convênio.
Fonte: https://www.artera.io/

**Funcionalidades de destaque.**
- Agentes de voz com IA em múltiplos canais (voz, texto, e-mail).
- "AI Service Squads": solução customizada combinada com especialistas humanos de saúde.
- Plataforma "Harmony", que coordena a IA ao longo de toda a jornada do paciente, com handoff para humano.
- Integração com os principais sistemas de EHR.
- Suporte multilíngue nativo nas conversas.
- Disponibilidade 24 horas por dia, com agendamento e triagem fora do horário.
Fonte: https://www.artera.io/

**Preço.** Não publicado no site oficial.
Fonte: https://www.artera.io/
Terceiro reporta faixa acima de US$ 20 mil por ano. Fonte de terceiro, não oficial: https://noshowcost.com/tools/artera-pricing

**Resultados numéricos divulgados.**
- Satisfação do paciente de 4,7 de 5.
- Taxa de conclusão de tarefa pela IA de 65%.
- Redução de 67% em abandono de chamada em um cliente.
- **Redução de 14% em no-show em um FQHC multilíngue.**
- Melhoria de 15% na taxa de confirmação.
- Mais de 1.250 horas de equipe recuperadas em 60 dias em uma clínica.
- 43 mil conversas automatizadas em 60 dias em um grupo de ortopedia.
- Base: mais de 1.000 organizações de saúde e mais de 2 bilhões de interações anuais com pacientes.
Fonte: https://www.artera.io/

**Ideia a roubar.** O suporte multilíngue foi o que produziu a redução de 14% de no-show no caso citado. O paralelo brasileiro não é idioma, é **registro de linguagem e canal**: paciente de estética conversa por áudio no WhatsApp, paciente idoso de convênio prefere ligação, paciente jovem quer link. Um agente que responde áudio com áudio, e que sabe quando ligar em vez de mandar mensagem, ataca o mesmo problema de acessibilidade que a Artera atacou com idioma.

---

## Klara

**Dor que resolve.** Comunicação fragmentada entre paciente e equipe, tarefas manuais repetitivas e ausência de automação em consultórios.
Fonte: https://www.klara.com/

**Funcionalidades de destaque.**
- Mensageria multicanal (SMS, chat web, chamadas).
- Agendamento pelo próprio paciente.
- Envio de formulários online sem exigir portal do paciente. Este ponto é importante: a Klara elimina o portal, que é a principal fonte de atrito em engajamento digital de paciente.
- Roteamento inteligente de mensagens.
- Automação de lembretes de consulta.
- Transcrição de voicemail.
- Integração com farmácias e laboratórios.
Fonte: https://www.klara.com/

**Preço.** Não publicado; apenas demonstração personalizada gratuita.
Fonte: https://www.klara.com/

**Resultados numéricos divulgados.**
- 84% de taxa de utilização em 2022, declarada como até 3 vezes maior que portais de paciente tradicionais.
- Centenas de horas economizadas em chamadas.
- NPS de pacientes baseado em 21 mil respostas.
Fonte: https://www.klara.com/

**Ideia a roubar.** "Sem portal do paciente." A métrica de 84% de utilização contra portais tradicionais é o argumento mais forte a favor do WhatsApp como canal no Brasil: o paciente já está lá, não precisa baixar nada, não precisa lembrar senha. Devemos usar essa lógica explicitamente no material de venda.

---

## Zocdoc

**Dor que resolve.** Aquisição de novos pacientes por marketplace e, mais recentemente, atendimento telefônico de agendamento com IA.
Fonte: https://www.zocdoc.com/join-zocdoc/pricing/

**Modelo de precificação. É o mais instrutivo de todo o benchmark.**
- Basic: gratuito, sem taxa mensal de plataforma. Perfil verificado e otimizado para SEO.
- Growth: taxa por agendamento de paciente novo (new patient booking fee), sem taxa mensal de plataforma. Acesso ao marketplace.
- Advanced: taxa por agendamento de paciente novo mais US$ 250 por profissional por mês. Inclui agendamento no site próprio da clínica e o Zo AI Phone Assistant.
Fonte: https://www.zocdoc.com/join-zocdoc/pricing/

Sobre a taxa por agendamento: o valor varia por especialidade e localização, e não é publicado em número absoluto. A taxa incide apenas em agendamentos de pacientes novos, no momento do agendamento. Pacientes existentes nunca geram taxa. A empresa pode isentar a taxa se o paciente cancelar em até 24 horas, e se o paciente foi marcado como novo mas já usara o Zocdoc antes, a clínica pode abrir uma reivindicação em até 7 dias para receber crédito. A clínica pode configurar teto mensal de gasto, pausar a visibilidade para pacientes novos, ou desligar profissionais individualmente. Canais gratuitos permanecem gratuitos: botão de agendamento no site próprio, agendamento pelo Google Business Profile e integrações.
Fonte: https://thepapergown.zocdoc.com/facts/pay-per-booking-fees-explained/

**Zo by Zocdoc: funcionalidades e resultados.**
- Atende chamadas de agendamento com conversa natural, substituindo a URA de "digite 1".
- Opera 24 horas por dia sem limite de chamadas simultâneas.
- Integra-se a sistemas de telefonia e EHR existentes.
- Encaminha casos complexos para a equipe humana.
- **Resolve até 70% das chamadas de agendamento sem intervenção humana.**
- Tempo médio de chamada abaixo de 3 minutos e 30 segundos, do primeiro toque ao desligamento, com zero espera.
- CSAT acima de 80%.
- Contexto declarado: em clínicas movimentadas, até 20% das chamadas ficam sem resposta hoje.
- Modelo de cobrança: o prestador paga por resultado, sem taxa por tempo de uso, sem taxa de licença, sem custo de implementação e sem compromisso de longo prazo.
Fonte: https://www.zocdoc.com/about/news/zocdoc-launches-zo-by-zocdoc-an-ai-phone-assistant-that-vanquishes-hold-times-and-maximizes-appointment-scheduling/

**Ideias a roubar.**
1. **Teto de gasto configurável e botão de pausa.** Reduz drasticamente o medo de contratar. Nenhum player brasileiro oferece isso.
2. **Política de crédito por engano de classificação.** Cria confiança na cobrança variável, que é onde todo modelo de performance quebra.
3. **A métrica de 70% de resolução autônoma** é o benchmark honesto do estado da arte. Qualquer promessa brasileira acima de 90% de automação total deve ser lida com ceticismo, e nós não devemos fazê-la.

---

## Luma Health

**Dor que resolve.** Gargalos ao longo da jornada do paciente, do agendamento ao pagamento.
Fonte: https://www.lumahealth.io/

**Funcionalidades de destaque.** Quatro áreas operacionais:
- Acesso: orquestração de pedidos, fax, encaminhamentos e gestão de lista de espera.
- Engajamento: conversas por IA e mensagens bidirecionais.
- Admissão: formulários responsivos e gestão de fluxo clínico.
- Pagamentos: verificação de elegibilidade e automação de cobrança.
- "Spark": núcleo de IA treinado em fluxos reais de saúde que coordena múltiplas capacidades.
Fonte: https://www.lumahealth.io/

**Preço.** Não publicado.
Fonte: https://www.lumahealth.io/

**Resultados numéricos divulgados.**
- Redução média de 61 dias no tempo até o cuidado.
- 2 a 3 horas economizadas por dia em ligações manuais.
- Aumento médio de 47% em receita.
- 95% de automação de ligações fora do expediente (caso UAMS).
- Mais de 800 horas economizadas anualmente apenas com cancelamentos noturnos.
Fonte: https://www.lumahealth.io/

**Alerta metodológico importante.** Um dos estudos de caso da Luma Health que aparece bem posicionado em busca ("Hayes Valley Health", com 5% de redução de no-show e 11% de aumento em deliverability) é declarado pela própria empresa como estudo de caso FICTÍCIO, criado para fins ilustrativos. Não deve ser citado como evidência.
Fonte: https://www.lumahealth.io/how-hayes-valley-health-cut-no-shows-and-boosted-staff-efficiency-with-smarter-patient-engagement-ai/

**Ideia a roubar.** "Lista de espera inteligente." Quando alguém cancela, o sistema oferece o horário vago automaticamente para a fila. Isso converte cancelamento em receita em vez de perda, e é a funcionalidade de maior ROI e menor esforço técnico do benchmark inteiro. É onde os 800 horas e os cancelamentos noturnos viram dinheiro.

---

## Notable

**Dor que resolve.** Sobrecarga administrativa das equipes de acesso do paciente, ineficiência no ciclo de receita (glosas, atraso de reembolso) e fragmentação de dados. Posicionamento declarado: "Healthcare teams get more time for patients, less time on admin work."
Fonte: https://www.notablehealth.com/

**Funcionalidades de destaque.**
- AI Agents para automação de fluxos.
- Flow Builder, ferramenta low-code para criar automações customizadas. Este é o diferencial arquitetural: a Notable vende a plataforma de construção, não apenas o agente pronto.
- Sidekick, assistente de IA em linguagem natural.
- Integrações amplas com o ecossistema de saúde.
Fonte: https://www.notablehealth.com/

**Preço.** Não publicado.
Fonte: https://www.notablehealth.com/

**Resultados numéricos divulgados.**
- Mais de US$ 350 mil em economia anual projetada (Catholic Health).
- 57% de taxa de contenção (containment rate), ou seja, chamadas resolvidas sem escalar para humano.
- Mais de 25 mil chamadas geridas desde o lançamento.
- Mais de 50 mil prontuários revisados (New York Health Systems).
- Aumento de 7% na taxa de fechamento de lacunas de cuidado (care gaps).
- Redução de 14 para 3 dias no trabalho de encaminhamento (Montage Health).
- 1,5 milhão de tarefas automatizadas diariamente.
Fonte: https://www.notablehealth.com/

**Ideia a roubar.** "Containment rate" como métrica-produto central. Notable reporta 57%, Zocdoc reporta até 70%, Artera reporta 65% de conclusão de tarefa. Essa é a métrica honesta e comparável do setor. Devemos instrumentar e reportar containment rate no nosso painel desde o MVP, porque é o número que um comprador sofisticado vai pedir.

---

## Tabela consolidada exterior

| Player | Foco | Preço publicado | Métrica-âncora divulgada |
|---|---|---|---|
| Assort Health | Multiespecialidade, agentes por especialidade | Não publicado (terceiro: US$ 1.500 a 10.000+/mês) | 98% de resolução de chamadas; 89% menos espera |
| Arini | Odontologia e DSOs | Não publicado | US$ 1,5M de produção gerada em um cliente; 1M de agendamentos |
| Hello Patient | Front office multiespecialidade | Não publicado | 18% mais agendamentos; 3 a mais por unidade por dia |
| Parakeet Health | Acesso e agendamento | Pay-for-performance sobre baseline | 38% mais consultas; ROI 360% em 6 meses |
| Simbie AI | Voz clínica com documentação em EMR | Não publicado (baseado em uso) | 60% de economia em pessoal administrativo |
| Weave | Odonto, vet, médico, ótica (SMB) | A partir de US$ 199/mês | 28% mais novos pacientes (um cliente) |
| Artera | Enterprise, jornada completa | Não publicado (terceiro: US$ 20 mil+/ano) | 14% de redução de no-show; 65% de conclusão por IA |
| Klara | Comunicação de consultório | Não publicado | 84% de utilização, 3x portais tradicionais |
| Zocdoc | Marketplace + Zo AI de voz | US$ 250 por profissional/mês + taxa por agendamento | 70% de resolução autônoma; CSAT acima de 80% |
| Luma Health | Jornada do paciente ponta a ponta | Não publicado | 47% de aumento de receita; 95% de automação após expediente |
| Notable | Enterprise, plataforma de agentes | Não publicado | 57% de containment rate; 1,5M de tarefas/dia |

---

# BLOCO 3 - Dados de mercado com fonte

## 3.1 Taxa média de no-show

### No mundo

**Referência global mais citada: 23%.** Estudo brasileiro publicado na revista Saberes Plurais (UFRGS) cita a taxa média global de não comparecimento de 23%, com variação regional relevante: África com 43% e Oceania com 13,2%, atribuindo a Dantas et al., 2018.
Fonte: https://seer.ufrgs.br/index.php/saberesplurais/article/view/151127/97616

**Faixa ambulatorial de 23% a 33%,** com faixa geral nos EUA de 5,5% a 50% e média global de 23,5%. Atenção: esta é uma compilação de terceiro (empresa fornecedora do setor), não um paper revisado por pares, e as fontes primárias citadas são artigos do PMC sem identificação completa. Use com ressalva.
Fonte: https://www.dialoghealth.com/post/patient-no-show-statistics

**Meta-análise de lembretes (Cochrane) fornece a linha de base mais confiável:** a taxa de comparecimento sem lembrete algum foi de 67,8%, o que implica no-show de aproximadamente 32,2% nas populações estudadas.
Fonte: https://www.cochrane.org/CD007458/EPOC_mobile-phone-messaging-reminders-attendance-healthcare-appointments

### No Brasil

Não existe uma estatística nacional consolidada de no-show em clínicas privadas brasileiras publicada por associação setorial ou órgão oficial. O que existe são estudos locais, quase todos no SUS, e levantamentos de fornecedores. Isso é, em si, uma informação estratégica: **o dado não existe, e quem produzir o primeiro dado nacional confiável ganha autoridade de categoria.**

Estudos acadêmicos localizados:

**Hospital-Escola Emílio Carlos, Catanduva, São Paulo, 2023. Taxa geral de 20,06%.** 45.825 consultas agendadas, das quais 9.193 não foram realizadas. Variação por especialidade: Infectologia com 33,67% (maior) e Cardiologia e Urologia com 16,90% (menores). Autores: Ana Beatriz Quinzani Baptista, Rafaela Franco da Silva, Giselle Fernandes de Oliveira e João Marcelo Caetano José Floridi Porcionato, 2024.
Fonte: https://docs.fundacaopadrealbino.com.br/media/documentos/76cdfc6e9b45391b3d40d63388ea9030.pdf

**Município da Região das Hortênsias, Rio Grande do Sul, primeiro semestre de 2023.**
- Consultas especializadas: 13,1% (1.306 faltas em 9.935 consultas).
- Exames especializados: 2,1% (390 ausências em 18.735 procedimentos).
- Variação extrema por especialidade: Urologia com 26,9%, Pneumologia com 11,5%.
- Variação extrema por exame: **Colonoscopia com 41,3%**, Ressonância com 0,2%.
Fonte: https://seer.ufrgs.br/index.php/saberesplurais/article/view/151127/97616

O dado da colonoscopia (41,3%) é o mais acionável de todos: procedimentos com preparo complexo têm no-show catastrófico, e são exatamente os que mais se beneficiam de um agente que explica o preparo, confirma e reconfirma. Isso vale igualmente para procedimentos estéticos com pré-cuidados e para cirurgias odontológicas.

**Santa Maria, Rio Grande do Sul, 2016 a 2021. Taxa média do período de 9,4%.**
- 2016: 14,9%
- 2017: 8,9%
- 2018: 4,9%
- 2019: 9,7%
- 2020: 9,3%
- 2021: 9,6%
Total: 14.659 consultas não realizadas de 156.348 agendadas.
Fonte: https://ojs.brazilianjournals.com.br/ojs/index.php/BJHR/article/download/74064/51723/182816

**Levantamento setorial (Doctoralia, Panorama das Clínicas e Hospitais 2025, quinta edição).**
- 31% das instituições apresentavam taxa de absenteísmo superior a 11%.
- Não comparecimento aparece como o quarto maior desafio operacional.
- Metodologia e tamanho de amostra: não encontrado no material público consultado; o relatório completo exige download separado.
Fonte: https://pro.doctoralia.com.br/blog/clinicas/dados-de-saude-no-brasil-panorama-das-clinicas-e-hospitais

**Reportagem citando Conclínica e Doctoralia.** O no-show "pode comprometer até 32% da agenda em algumas clínicas" e "pode ultrapassar 30% em determinados contextos". Impacto financeiro em reais: não apresentado.
Fonte: https://acontecendoaqui.com.br/empreendedorismo/alerta-falta-de-pacientes-pode-comprometer-ate-32-da-agenda-de-clinicas-no-pais/

### Faixa defensável para uso comercial

Com base nas fontes acima, a faixa que podemos afirmar com respaldo é: **no-show entre 9% e 32% no Brasil, com concentração entre 13% e 20% em ambulatório e picos acima de 40% em procedimentos com preparo.** Qualquer número único ("a média brasileira é X%") seria invenção.

---

## 3.2 Impacto financeiro do no-show por consulta

### Brasil

**Estudo de Santa Maria, RS.** Valor unitário de repasse por consulta especializada de R$ 10,00, com perda direta acumulada de R$ 146.590,00 entre 2016 e 2021 sobre 14.659 consultas não realizadas.
Fonte: https://ojs.brazilianjournals.com.br/ojs/index.php/BJHR/article/download/74064/51723/182816

Ressalva crítica de interpretação: esses R$ 10,00 são o valor de repasse do SUS ao município, não o custo real da consulta nem o ticket de uma clínica privada. **Este número NÃO deve ser usado para dimensionar perda de clínica privada.** Serve apenas como evidência acadêmica de que a perda é mensurável e contabilizada.

**Impacto financeiro do no-show por consulta em clínica privada no Brasil, com fonte primária:** não encontrado. Não localizamos estudo, associação ou órgão oficial que publique custo médio de uma consulta perdida em clínica privada brasileira.

Consequência prática: o cálculo de ROI deve ser feito com o ticket médio DA CLÍNICA do prospect, não com uma média de mercado. Isso é, aliás, metodologicamente mais defensável e mais persuasivo. É o que a Arini faz com sua calculadora de ROI.

### Exterior

**Custo médio de US$ 200 ou mais por consulta perdida e US$ 150 bilhões por ano de custo total ao sistema de saúde dos EUA.** Estes são os números mais repetidos do setor. Importante: a rastreabilidade é fraca. A compilação que os divulga atribui a si mesma (Dialog Health, 2025), citando artigos do PMC sem identificação completa.
Fonte: https://www.dialoghealth.com/post/patient-no-show-statistics

Uma segunda fonte reproduz "US$ 150 bilhões anualmente" e "cada horário vago custa ao médico 60 minutos e US$ 200 em média", atribuindo a Jamie Gier / Healthcare Innovation, mas **sem fornecer a referência primária rastreável**.
Fonte: https://mtaccoalition.org/nemt_data_point/missed-appointments-cost-the-u-s-healthcare-system-150b-each-year-data-point-1/

**Recomendação:** usar US$ 200 e US$ 150 bilhões apenas com atribuição explícita à fonte secundária e nunca como afirmação própria. A fonte primária desses números: não encontrada.

**Custo por lembrete, com fonte revisada por pares.** A revisão sistemática de Hasvold e Wootton (Journal of Telemedicine and Telecare, 2011) estimou custo médio de **€ 0,41 por lembrete**. Esse número é útil como âncora de unit economics.
Fonte: https://journals.sagepub.com/doi/full/10.1258/jtt.2011.110707

---

## 3.3 Eficácia comprovada de lembretes na redução de no-show

Esta é a parte com melhor qualidade de evidência de todo o relatório. Há revisões Cochrane e sistemáticas com dados robustos.

### Revisão Cochrane (Gurol-Urganci et al., 2013)

Título: "Mobile phone messaging reminders for attendance at healthcare appointments".

Resultados:
- **SMS versus nenhum lembrete: risco relativo de 1,14 (IC 95%: 1,03 a 1,26)**, com 7 estudos e 5.841 participantes, qualidade de evidência moderada. Ou seja, aumento de aproximadamente 14% no comparecimento.
- SMS versus lembrete por telefone: RR de 0,99 (IC 95%: 0,95 a 1,02), 3 estudos, 2.509 participantes, qualidade moderada. **Interpretação: SMS é estatisticamente equivalente à ligação telefônica em eficácia, e muito mais barato.** Este é o achado economicamente mais importante.
- SMS mais carta postal versus carta apenas: RR de 1,10 (IC 95%: 1,02 a 1,19), 1 estudo, 291 participantes, qualidade baixa.

Taxas de comparecimento observadas:
- Sem lembrete: 67,8%
- Com SMS: 78,6%
- Com telefonema: 80,3%
Fonte: https://www.cochrane.org/CD007458/EPOC_mobile-phone-messaging-reminders-attendance-healthcare-appointments

Revisão completa: https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD007458.pub3/full

### Revisão sistemática Hasvold e Wootton (2011)

Título: "Use of telephone and SMS reminders to improve attendance at hospital appointments: a systematic review", Journal of Telemedicine and Telecare.

- 29 estudos analisados, gerando 33 estimativas (4 estudos com dois braços de intervenção): 18 intervenções com telefonema manual, 15 com lembrete automatizado (SMS ou voz).
- **Telefonema manual: redução de 39% sobre a taxa de base de não comparecimento.**
- **SMS ou chamada automatizada: redução de 29% sobre a taxa de base.**
- Síntese ponderada: redução relativa média de **34%** na taxa de não comparecimento.
- Custo médio de € 0,41 por lembrete.
- Todos os estudos exceto um reportaram melhoria na taxa de falta.
- Recomendação final dos autores: "all hospitals should consider using automated reminders to reduce non-attendance at appointments."
Fonte: https://journals.sagepub.com/doi/full/10.1258/jtt.2011.110707

### Estudo brasileiro (São Paulo)

"The impact of short message service text messages sent as appointment reminders to patients' cell phones at outpatient clinics in São Paulo, Brazil", publicado no International Journal of Medical Informatics.
Fontes: https://pubmed.ncbi.nlm.nih.gov/19783204/ e https://www.sciencedirect.com/science/article/abs/pii/S1386505609001336

Ressalva de honestidade: não conseguimos extrair os percentuais exatos do abstract, porque tanto o PubMed quanto o ScienceDirect bloquearam o acesso automatizado (reCAPTCHA e robots.txt). **Os números específicos deste estudo brasileiro: não encontrados nesta pesquisa.** A referência está validada e existe, e recomendamos obtenção manual do PDF, porque é o único estudo brasileiro de SMS e no-show identificado e teria grande valor de credibilidade local.

### Estudo com sistema combinado (SMS mais confirmação mais telefone), 2025

Brancewicz, M.; Robakowska, M.; Śliwiński, M.; Rystwej, D. (2025), "SMS and Telephone Communication as Tools to Reduce Missed Medical Appointments", Applied Sciences.

- Taxa de não comparecimento em 2019 (antes): **18,55%** (3.305 faltas em 17.819 registros).
- Taxa em 2023 (depois): **7,01%** (1.184 faltas em 17.025 registros).
- Redução de **11,54 pontos percentuais**, aproximadamente 62% de melhoria relativa.
- Taxa de retorno de formulários: 55,41% (4.479 respostas de 8.084 enviados).
- 93% dos pacientes avaliaram o sistema como intuitivo.
- **55,4% dos pacientes preferiram SMS a chamada telefônica.**
- Maior engajamento na faixa de 35 a 44 anos (74,58%).
Fonte: https://www.mdpi.com/2076-3417/15/17/9773

Ressalva metodológica: é um estudo pré e pós, não randomizado, em clínica de saúde mental. A redução de 62% não é atribuível somente ao SMS. Serve como teto otimista, não como expectativa.

### Resultados divulgados por fornecedores (não revisados por pares)

- Artera: 14% de redução de no-show em FQHC multilíngue, e 15% de melhoria na taxa de confirmação. https://www.artera.io/
- PevIA: 52% de redução em no-shows (autodeclarado, sem metodologia). https://pevia.com.br/

### Síntese defensável para o material comercial

O número que podemos afirmar com respaldo de evidência revisada por pares é: **lembretes automatizados reduzem o não comparecimento em aproximadamente 29% a 34% sobre a taxa de base da clínica**, com aumento de comparecimento de 67,8% para 78,6% no comparativo Cochrane. Prometer 50% ou mais não tem respaldo em literatura e nos expõe.

---

## 3.4 Tempo que a recepção gasta em telefone e WhatsApp por dia

### Dado com metodologia publicada

**66 minutos por dia de sobrecarga telefônica por médico**, sem contar o tempo produtivo de conversa. Metodologia declarada:
- 53 chamadas de pacientes por dia por profissional, derivadas de 21 chamadas por 1.000 pacientes (média de 7 fontes) e painel médio de 1.500 pacientes por médico.
- 97 segundos de overhead por chamada recebida e 45 segundos por chamada realizada, incluindo espera, voicemail, transcrição, anotação e transferência.
- Fontes de dados citadas: estudos publicados em NEJM, JABFM e JGIM, mais dados internos de prática de atenção primária.
- Potencial de recuperação estimado: 57 minutos por dia, ou 86% do tempo perdido, com modernização tecnológica.
Fonte: https://sprucehealth.com/blog/doctors-losing-hour-day-phone-call-overhead/

Ressalva: é um blog corporativo de fornecedor, porém com metodologia explícita e fontes citadas, o que o torna substancialmente mais confiável que a média das estatísticas do setor.

### Dado de fornecedor

Luma Health: **2 a 3 horas economizadas por dia em ligações manuais** e mais de 800 horas economizadas por ano apenas com cancelamentos noturnos.
Fonte: https://www.lumahealth.io/

### Contexto de canais no Brasil

Doctoralia, Panorama das Clínicas e Hospitais 2025:
- **Telefone segue como canal mais utilizado: 90% das clínicas.**
- **WhatsApp: 79% das instituições**, com percentual praticamente idêntico para confirmação de consultas.
- Site próprio: 66% de adoção.
Fonte: https://pro.doctoralia.com.br/blog/clinicas/dados-de-saude-no-brasil-panorama-das-clinicas-e-hospitais

### Tempo específico gasto por recepção de clínica brasileira em telefone e WhatsApp por dia

**Não encontrado.** Não localizamos estudo brasileiro que meça em horas o tempo diário da recepção em telefone ou WhatsApp. Esta é a segunda lacuna de dados nacionais relevante identificada, e também uma oportunidade de pesquisa proprietária.

---

# BLOCO 4 - Regulatório e técnico brasileiro

Este bloco contém as restrições que efetivamente mudam o desenho do produto, não apenas o texto do contrato.

## 4.1 WhatsApp Business Cloud API: janela de 24 horas, templates e precificação

### A janela de atendimento ao cliente (customer service window)

Regra confirmada na documentação oficial da Meta:

Quando um usuário envia uma mensagem ou faz uma chamada para o negócio, inicia-se um temporizador de 24 horas. Se o usuário enviar mensagem ou ligar novamente antes de o temporizador expirar, o temporizador reinicia para 24 horas.

Dentro da janela aberta, o negócio pode enviar mensagens de serviço em formato livre (free-form) via Messages API: texto, imagem, documento, botões interativos e outros formatos.

Quando a janela se fecha, o negócio **só pode enviar templates pré-aprovados**, nas categorias marketing, utility ou authentication.

Em qualquer caso, dentro ou fora da janela, só é permitido enviar mensagem a usuários que tenham dado opt-in para receber mensagens do negócio.
Fonte: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages

### Precificação vigente: por mensagem, não por conversa

Confirmado na documentação oficial da Meta:

**A partir de 1º de julho de 2025, a Meta cobra por mensagem, e não mais por conversa.** Citação da documentação: "effective July 1, 2025, we now charge on a per-message basis".
Fonte: https://developers.facebook.com/docs/whatsapp/pricing

A Meta mantém a documentação da precificação por conversa marcada explicitamente como depreciada.
Fonte: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing

Histórico das mudanças, conforme a Meta:
| Data | Mudança |
|---|---|
| 1º de outubro de 2024 | Atualização de taxas de conversas de marketing em Índia, Arábia Saudita, EAU e Reino Unido |
| 1º de novembro de 2024 | Conversas de serviço passaram a ser gratuitas |
| 1º de julho de 2025 | Transição para precificação por mensagem |
Fonte: https://developers.facebook.com/docs/whatsapp/pricing

### O que é cobrado e o que é gratuito

Cobrado:
- Templates de **marketing**: sempre cobrados, dentro ou fora da janela.
- Templates de **utility** e **authentication**: cobrados apenas fora da janela de atendimento.

Gratuito:
- Todas as mensagens não-template (texto, imagem e outros tipos) dentro de uma janela de atendimento aberta.
- Templates de **utility** enviados dentro de uma janela de atendimento aberta.
- Todas as mensagens nas primeiras 72 horas quando a conversa é iniciada por um anúncio Click-to-WhatsApp (free entry point window).
Fonte: https://developers.facebook.com/docs/whatsapp/pricing

Exemplo prático publicado pela Meta, que vale reproduzir porque explicita a lógica:
| Hora | Ação | Cobrança |
|---|---|---|
| 0 | Template de marketing enviado | Cobrado (marketing) |
| 2 | Usuário responde | Janela de 24h aberta |
| 3 | Mensagem de texto não-template | Gratuita |
| 4 | Template utility dentro da janela | Gratuito |
| 30 | Template utility fora da janela | Cobrado (utility) |
Total cobrado: 2 mensagens.
Fonte: https://developers.facebook.com/docs/whatsapp/pricing

Há ainda tiers de volume: desde julho de 2025, existem tarifas menores para templates de utility e authentication conforme o volume mensal cresce.
Fontes: https://developers.facebook.com/docs/whatsapp/pricing e https://whatsappbusiness.com/products/platform-pricing/

A documentação também sinaliza atualizações de preço para "Meta Business Agent, service e utility messages" com efeito em 1º de agosto de 2026 e 1º de outubro de 2026, sem detalhamento de valores na página consultada.
Fonte: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

### Preço específico para o Brasil

A Meta publica as tarifas por país e moeda (USD, BRL entre outras) em tabelas CSV e em ferramenta interativa em whatsappbusiness.com, mas **os valores do Brasil não são renderizados de forma estática e não foram capturáveis nesta pesquisa via acesso automatizado**. Portanto, o valor oficial da Meta para o Brasil: **não confirmado em fonte primária nesta pesquisa.**
Fonte tentada: https://whatsappbusiness.com/products/platform-pricing/

Valores reportados por fonte secundária brasileira, a serem confirmados diretamente com a Meta ou com o BSP antes de qualquer uso em modelagem financeira:
- Marketing: US$ 0,0625 por mensagem.
- Utility: US$ 0,0375 por mensagem.
- Authentication: US$ 0,0375 por mensagem.
- Service dentro da janela de 24 horas: gratuito.
A mesma fonte indica que a cobrança local em reais é esperada para o segundo semestre de 2026, e que as conversões em BRL são estimativas de câmbio.
Fonte secundária: https://www.socialhub.pro/blog/preco-whatsapp-api-2026-brasil/

### Regras de templates

- Todo template deve ser classificado em uma das três categorias: AUTHENTICATION, MARKETING ou UTILITY. A categoria é validada na criação.
- Fluxo de aprovação em duas etapas: validação de categoria (imediata) e revisão de conteúdo (status PENDING).
- Status possíveis: APPROVED, PENDING, REJECTED.
- Motivos de rejeição documentados: TAG_CONTENT_MISMATCH (conteúdo não corresponde à categoria) e INCORRECT_CATEGORY.
- Limites de quantidade: negócio não verificado tem máximo de 250 templates por conta; negócio verificado com nome de exibição aprovado pode ter até 6.000 templates.
- Recomendação da Meta: incluir botão de Quick Reply para descadastro em mensagens de marketing, o que melhora conformidade e a taxa de qualidade.
Fonte: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates

### O que isso muda no desenho do produto

1. **A economia unitária inverte-se completamente sob o modelo por mensagem.** Antes, uma conversa era cobrada uma vez em 24 horas. Agora, cada template disparado é cobrado individualmente. Um fluxo de confirmação com três toques (lembrete D-2, confirmação D-1, aviso no dia) custa três utilities, não uma conversa. O custo por paciente por ciclo precisa ser modelado por número de toques, não por paciente.

2. **A regra de ouro do produto: fazer o paciente responder.** Se o paciente responde ao primeiro template, abre-se a janela de 24 horas e tudo o que vier depois (texto livre e templates utility) é gratuito. Isso significa que o primeiro template deve ser desenhado para maximizar resposta, com botões de resposta rápida ("Confirmar" / "Remarcar"), não como aviso unidirecional. Uma taxa de resposta alta é literalmente uma alavanca de margem bruta.

3. **Click-to-WhatsApp vira canal privilegiado.** As primeiras 72 horas de conversa iniciada por anúncio são gratuitas. Para clínicas de estética, que dependem de tráfego pago, isso permite um agente de captação e agendamento com custo de mensagem praticamente zero na janela crítica de conversão.

4. **Marketing é sempre cobrado, sem exceção.** Portanto, reativação de paciente inativo (a funcionalidade mais desejada por clínicas) é a mais cara. Precisa ter precificação e limite próprios no plano, no modelo de cotas da Weave.

5. **Templates precisam ser gerenciados como ativo do produto.** Aprovação, categoria correta, rejeições, limites de 250 versus 6.000. Isso exige uma camada de gestão de templates no produto, com verificação de negócio (Meta Business Verification) como pré-requisito de onboarding se quisermos escalar templates por cliente.

---

## 4.2 LGPD aplicada a dado de saúde

Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais).
Fonte oficial: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm

### Enquadramento

**Art. 5º, II.** Dado pessoal sensível é definido como "dado pessoal sobre origem racial ou étnica, convicção religiosa, opinião política, filiação a sindicato ou a organização de caráter religioso, filosófico ou político, **dado referente à saúde ou à vida sexual**, dado genético ou biométrico".

Consequência direta: uma conversa de WhatsApp em que o paciente diz "quero marcar com o dermatologista para tratar acne" é dado pessoal sensível. Não é dado cadastral comum. Isso puxa o regime jurídico inteiro para o nível mais restritivo da lei.

### Bases legais aplicáveis

**Art. 11.** O tratamento de dado sensível só pode ocorrer quando:
- o titular ou seu responsável legal **consentir, de forma específica e destacada, para finalidades específicas**; ou
- sem consentimento, nas hipóteses em que for indispensável, entre elas a **"tutela da saúde, exclusivamente, em procedimento realizado por profissionais de saúde, serviços de saúde ou autoridade sanitária"**.
Fonte: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm

Ponto de atenção prática: a base de "tutela da saúde" é restrita a procedimento realizado por profissionais ou serviços de saúde. Um SaaS de agendamento é operador a serviço da clínica (que é controladora e é serviço de saúde), o que sustenta o enquadramento, mas a arquitetura contratual precisa ser explícita quanto a esses papéis. Note também que o consentimento genérico do tipo "aceito os termos" não atende a exigência de ser **específico e destacado**.

**Art. 11, § 4º.** "É vedada a comunicação ou o uso compartilhado entre controladores de dados pessoais sensíveis referentes à saúde com objetivo de obter vantagem econômica, exceto nas hipóteses relativas a prestação de serviços de saúde."
Fonte: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm

Esta é a restrição de produto mais dura de todas. Ela inviabiliza qualquer modelo de monetização baseado em compartilhar dado de paciente entre clínicas, vender lead de paciente, ou usar base de pacientes de um cliente para beneficiar outro. Também torna delicado qualquer uso cruzado de dados para treinar modelos que sirvam a outros clientes.

### Obrigações operacionais do SaaS

**Art. 37.** Controlador e operador devem manter registro das operações de tratamento de dados pessoais que realizarem. Na prática: log de acesso, log de tratamento, rastreabilidade de quem viu qual conversa.

**Art. 41.** O controlador deve indicar encarregado (DPO) para receber reclamações e comunicações da autoridade nacional e orientar funcionários.

**Arts. 46 a 48.** Os agentes de tratamento devem adotar medidas de segurança técnicas e administrativas aptas a proteger os dados de acesso não autorizado. O controlador deve comunicar à ANPD e ao titular a ocorrência de incidente de segurança que possa acarretar risco ou dano relevante.

**Art. 33.** Transferência internacional de dados é permitida para países ou organismos que proporcionem grau de proteção adequado ao previsto na lei, entre outras hipóteses.
Fonte de todos os artigos acima: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm

O Art. 33 é decisivo para qualquer produto de IA brasileiro, porque enviar a conversa de um paciente para um modelo de linguagem hospedado nos Estados Unidos é transferência internacional de dado pessoal sensível. Precisa de base válida, cláusulas contratuais, e transparência ao titular.

### Orientações da ANPD

**Relatório de Impacto à Proteção de Dados Pessoais (RIPD).** A ANPD define o RIPD como documentação que descreve processos de tratamento que possam gerar alto risco às garantias da LGPD e aos direitos fundamentais dos titulares, incluindo medidas, salvaguardas e mecanismos de mitigação de risco (LGPD, art. 5º, XVII e art. 38).

A ANPD recomenda o RIPD em contextos que envolvam, entre outros:
- operações de alto risco que afetem direitos fundamentais;
- tratamento em larga escala ou com impacto significativo;
- **tecnologias emergentes, vigilância de área pública, ou decisões automatizadas**;
- **dados pessoais sensíveis ou populações vulneráveis** (crianças, adolescentes, idosos).

A LGPD exige o RIPD especificamente em: art. 4º, § 3º (segurança pública, defesa nacional, investigação criminal), art. 10, § 3º (uso de legítimo interesse como base legal), art. 32 (agentes públicos) e art. 38 (controladores em operações de alto risco). A ANPD pode ainda exigir o RIPD em atividade de fiscalização.

A ANPD enfatiza que o tratamento de dado pessoal sensível funciona como critério específico de risco, e que organizações devem elaborar RIPD ao tratar dado sensível em larga escala, aplicando o princípio de responsabilização e prestação de contas (art. 6º, X).
Fonte: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd

Documentos técnicos e orientativos da ANPD (índice geral, com radares tecnológicos, estudos técnicos de anonimização e notas técnicas de 2022 a 2026): https://www.gov.br/anpd/pt-br/centrais-de-conteudo/documentos-tecnicos-orientativos

Ressalva: não localizamos um guia orientativo da ANPD dedicado especificamente a SaaS de saúde, IA conversacional ou tratamento de dado de paciente por chatbot. Guia específico da ANPD sobre este caso de uso: **não encontrado.**

### Checklist do que um SaaS que trafega conversa de paciente precisa observar

1. Contrato de operador com cada clínica, definindo a clínica como controladora e o SaaS como operador (LGPD arts. 5º, VI e VII, e 39).
2. Consentimento específico e destacado do paciente, ou enquadramento explícito e documentado em tutela da saúde (art. 11).
3. RIPD elaborado, porque há dado sensível, larga escala e decisão automatizada (art. 38 e orientação ANPD).
4. Encarregado (DPO) nomeado e publicado (art. 41).
5. Registro de operações de tratamento com logs auditáveis (art. 37).
6. Criptografia em trânsito e em repouso, controle de acesso por perfil, e segregação por cliente (arts. 46 a 48).
7. Plano e prazo de resposta a incidente, com comunicação à ANPD e ao titular (art. 48).
8. Mapeamento e base legal para transferência internacional se qualquer LLM, hospedagem ou subprocessador estiver fora do Brasil (art. 33).
9. Política de retenção e eliminação: por quanto tempo a conversa fica armazenada e o que acontece no fim do contrato (art. 16).
10. Vedação absoluta de compartilhamento de dado de saúde entre controladores para vantagem econômica (art. 11, § 4º). Isso precisa estar codificado na arquitetura, não apenas na política.

---

## 4.3 CFM: publicidade médica e teleatendimento

### Resolução CFM nº 2.336/2023 (publicidade médica)

Texto oficial: https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2023/2336_2023.pdf
Portal do CFM sobre a norma: https://publicidademedica.cfm.org.br/

Dispositivos que afetam diretamente um agente de IA conversando com paciente:

**Art. 11, inciso XII.** É vedado "garantir, prometer ou insinuar bons resultados do tratamento".

**Art. 11, inciso IV.** Vedado participar de propaganda ou publicidade de medicamento, insumo médico, equipamento, alimento e quaisquer outros produtos "induzindo à garantia de resultados".

**Art. 11, inciso XVI.** Vedado "portar-se de forma sensacionalista ou autopromocional, praticar concorrência desleal ou divulgar conteúdo inverídico".

**Art. 11, § 4º, alínea c.** Veda ofertas casadas, do tipo "faça o procedimento e ganhe desconto em exames".

**Art. 9º, incisos VI a VIII.** Autoriza anunciar valores e descontos. Ou seja, informar preço é permitido; condicionar preço a combinação de procedimentos não é.

**Art. 14, inciso II, alínea b.** Demonstrações de antes e depois só são permitidas em conjunto contendo indicações, evoluções satisfatórias, insatisfatórias e complicações.

**Art. 14, alínea f.** É vedada qualquer edição, manipulação ou melhoramento das imagens.

**Art. 6º.** As informações descritas no art. 4º devem estar dispostas na página principal do perfil.

**Art. 8º.** Permite o uso de redes sociais próprias, expressamente incluindo **WhatsApp**, Instagram, Facebook, TikTok e LinkedIn, desde que em conformidade com as regras éticas.
Fonte de todos os artigos acima: https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2023/2336_2023.pdf

Contexto complementar: https://portal.cfm.org.br/noticias/cfm-atualiza-resolucao-da-publicidade-medica/

### Resolução CFM nº 2.314/2022 (telemedicina)

Texto oficial: https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2022/2314_2022.pdf

Pontos relevantes:

**Definição.** Telemedicina é o exercício da medicina através de tecnologias digitais, de informação e comunicação, para fins de assistência, educação, pesquisa, prevenção de doenças e lesões, gestão e promoção de saúde.

**Teleconsulta.** Consulta médica a distância entre profissional e paciente em espaços diferentes. Exige consulta presencial a cada 180 dias para doenças crônicas. A primeira consulta pode ser virtual se for seguida de presencial.

**Teletriagem.** "Ato realizado por um médico, com avaliação dos sintomas do paciente, a distância, para regulação ambulatorial ou hospitalar." Deve ser registrada como impressão diagnóstica apenas, não como consulta.

**Telemonitoramento.** Monitoramento de parâmetros de saúde sob coordenação, indicação, orientação e supervisão de médico.

**Requisitos.** Apenas médicos podem realizar atendimentos clínicos. Exige assinatura digital qualificada padrão ICP-Brasil. Todo atendimento exige documentação em prontuário eletrônico. É obrigatório termo de concordância e autorização do paciente, enviado eletronicamente ou com gravação de áudio confirmando concordância.

**Proibições explícitas.**
- A telemedicina jamais poderá substituir o compromisso constitucional de garantir assistência presencial.
- Não substitui exame físico completo.
- **Sistemas automatizados não podem substituir avaliação médica profissional.**
- **Não-médicos não podem executar atos clínicos, apenas auxiliar sob supervisão.**
Fonte: https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2022/2314_2022.pdf

### O que isso muda no desenho do produto

Esta é a restrição mais subestimada por quem constrói agente de IA para saúde no Brasil.

**1. O agente NÃO pode fazer triagem clínica.** A teletriagem é definida pelo CFM como ato realizado por médico. Um agente de IA que pergunta sintomas e sugere especialidade, urgência ou conduta está executando ato médico sem médico. O produto precisa de uma barreira dura: coleta de motivo de contato para fins administrativos, sim; avaliação de sintoma com output clínico, não. Isso deve ser um guardrail no prompt e no código, com escalonamento obrigatório para humano ao detectar conteúdo clínico ou de urgência.

**2. O agente não pode prometer resultado.** Art. 11, XII. Isso proíbe copy do tipo "esse tratamento vai resolver sua acne" ou "com esse procedimento você fica com o sorriso perfeito". Como o texto é gerado por LLM, a proibição não pode depender de instrução no prompt apenas: precisa de filtro de saída (guardrail pós-geração) que bloqueie promessa de resultado. Este é um requisito de engenharia, não de política.

**3. O agente não pode enviar antes e depois isolado.** Art. 14. Se a clínica de estética pedir para o agente mandar foto de resultado no WhatsApp, o envio de um par isolado de imagens viola a resolução, que exige conjunto com evoluções insatisfatórias e complicações, e proíbe edição de imagem. O produto deve ter biblioteca de mídia com validação de conformidade, ou simplesmente não permitir envio de antes e depois.

**4. Não pode oferta casada.** Art. 11, § 4º, c. Campanhas de reativação com "faça a limpeza e ganhe desconto na aplicação" são vedadas. As campanhas automatizadas de reativação, que são o principal upsell do produto, precisam de validação de conformidade no momento da criação da campanha.

**5. Preço pode ser informado.** Art. 9º, VI a VIII. Isso é uma boa notícia e diferencia o Brasil de outros mercados: o agente pode responder "quanto custa" com o valor, o que aumenta muito a taxa de conversão sem risco ético.

**6. Identificação como IA.** O CFM 2.336/2023 exige transparência e veda conteúdo inverídico (art. 11, XVI). Um agente que se apresenta como pessoa humana ("Oi, sou a Ana da recepção") em nome de um médico é terreno de risco. O desenho seguro é identificar-se como assistente virtual da clínica e oferecer transferência para humano a qualquer momento.

**7. Odontologia tem norma própria.** As regras de publicidade odontológica são do Conselho Federal de Odontologia, notadamente a Resolução CFO-196/2019, que trata da divulgação de trabalhos odontológicos e das condições para imagens de antes e depois. Precisa de análise dedicada antes de lançar o vertical odontológico.
Fontes: https://website.cfo.org.br/resolucao-cfo-196-2019/ e https://crosp.org.br/noticia/fique-em-dia-com-a-publicidade-odontologica-imagens-de-antes-e-depois-podem-ser-permitidas/

---

# 5. Leitura estratégica

## 5.1 Funcionalidades que os líderes têm e devemos copiar

Ordenadas por relação entre impacto e esforço.

**Alto impacto, baixo esforço.**

1. **Lista de espera inteligente.** Cancelou, o horário é ofertado automaticamente para a fila. Luma Health atribui a isso mais de 800 horas anuais recuperadas só em cancelamentos noturnos. Converte perda em receita e é a funcionalidade de melhor ROI do benchmark. https://www.lumahealth.io/

2. **Primeiro template com botões de resposta rápida.** Além de melhorar confirmação, abre a janela de 24 horas e zera o custo das mensagens seguintes. É funcionalidade e margem ao mesmo tempo. https://developers.facebook.com/docs/whatsapp/pricing

3. **Calculadora de ROI pública** com o ticket médio do próprio prospect, como a Arini. https://www.arini.ai/

4. **Teto de gasto configurável e botão de pausa**, como o Zocdoc. Remove o principal medo de contratar cobrança variável. https://thepapergown.zocdoc.com/facts/pay-per-booking-fees-explained/

5. **Diagnóstico gratuito das conversas existentes** da clínica, mostrando quantos leads morreram sem resposta. É o equivalente ao Call Intelligence da Weave aplicado ao WhatsApp. https://www.getweave.com/

**Alto impacto, esforço médio.**

6. **Escrita de volta no sistema de gestão da clínica**, não só leitura da agenda. É o que a Simbie faz com o EMR e o que separa canal de colega de trabalho. https://www.simbie.ai/

7. **Recuperação ativa de falta.** Quem faltou recebe contato automático para remarcar, funcionalidade central de Hello Patient e Parakeet. https://www.hellopatient.com/ e https://www.parakeethealth.com/

8. **Agentes por especialidade**, com base de conhecimento própria por vertical (odonto, estética, dermato). É a estratégia da Assort e cobre 23 especialidades. https://www.assorthealth.com/

9. **Painel de performance por unidade** para redes e franquias, o "Watchtower" da Arini. É o que permite subir ticket. https://www.arini.ai/

10. **Containment rate no painel do cliente.** Notable reporta 57%, Zocdoc até 70%, Artera 65%. Instrumentar desde o MVP.

11. **Cota de mensagens embutida no plano**, como Weave (1.500 / 3.000 / 15.000). Resolve o repasse do custo variável da Meta. https://www.getweave.com/pricing/

12. **Áudio nativo.** Responder áudio com áudio, e escolher entre mensagem e ligação conforme o perfil do paciente. É o análogo brasileiro do multilíngue que rendeu 14% de redução de no-show à Artera. https://www.artera.io/

**O que NÃO copiar.** Portal do paciente. A própria Klara vende como diferencial a ausência de portal, com 84% de utilização contra portais tradicionais. https://www.klara.com/

## 5.2 Números de no-show que justificam o preço

A cadeia de argumentação que sustenta preço, toda com fonte:

- No-show ambulatorial no Brasil medido academicamente: 20,06% em hospital-escola em São Paulo em 2023, e 13,1% em consultas especializadas no RS, com picos de 26,9% em urologia e 41,3% em colonoscopia. https://docs.fundacaopadrealbino.com.br/media/documentos/76cdfc6e9b45391b3d40d63388ea9030.pdf e https://seer.ufrgs.br/index.php/saberesplurais/article/view/151127/97616
- 31% das instituições brasileiras têm absenteísmo acima de 11%. https://pro.doctoralia.com.br/blog/clinicas/dados-de-saude-no-brasil-panorama-das-clinicas-e-hospitais
- Lembretes automatizados reduzem falta em 29% sobre a taxa de base; telefonema manual em 39%; média ponderada de 34%. Custo de € 0,41 por lembrete. https://journals.sagepub.com/doi/full/10.1258/jtt.2011.110707
- Cochrane: comparecimento sobe de 67,8% sem lembrete para 78,6% com SMS. RR 1,14 (IC 95%: 1,03 a 1,26). E SMS é estatisticamente equivalente a ligação (RR 0,99), portanto muito mais barato pelo mesmo efeito. https://www.cochrane.org/CD007458/EPOC_mobile-phone-messaging-reminders-attendance-healthcare-appointments
- Referência global de 23% de no-show. https://seer.ufrgs.br/index.php/saberesplurais/article/view/151127/97616
- Tempo de recepção: 66 minutos por dia de overhead telefônico por médico, com 86% recuperável. https://sprucehealth.com/blog/doctors-losing-hour-day-phone-call-overhead/

**Conta de guardanapo defensável.** Clínica com 20 consultas por dia, 22 dias úteis, 440 consultas por mês. No-show de 18% equivale a 79 faltas por mês. Redução de 30% (respaldada pela literatura) recupera 24 consultas por mês. Com ticket de R$ 200, são R$ 4.752 por mês recuperados. Contra a faixa de mensalidade nichada brasileira de R$ 297 a R$ 897, o ROI é de 5x a 16x. Os percentuais são de fonte; o ticket precisa ser sempre o do prospect, nunca uma média inventada.

**Preços de referência do mercado.** PevIA R$ 297 / 497 / 897 (https://pevia.com.br/planos.php). Weave a partir de US$ 199 (https://www.getweave.com/pricing/). Zocdoc US$ 250 por profissional/mês mais taxa por agendamento (https://www.zocdoc.com/join-zocdoc/pricing/). Kommo Pro US$ 45 por usuário (https://www.kommo.com/pricing/).

## 5.3 Restrições que mudam o desenho do produto

1. **Cobrança por mensagem desde 1º de julho de 2025.** Modelar custo por número de toques, não por paciente. https://developers.facebook.com/docs/whatsapp/pricing
2. **Resposta do paciente é alavanca de margem.** Tudo depois da resposta é gratuito por 24 horas. Desenhar o primeiro template para provocar resposta. https://developers.facebook.com/docs/whatsapp/pricing
3. **Marketing sempre é cobrado.** Reativação de inativo precisa de cota e preço próprios. https://developers.facebook.com/docs/whatsapp/pricing
4. **Click-to-WhatsApp dá 72 horas grátis.** Vantagem estrutural no vertical de estética. https://developers.facebook.com/docs/whatsapp/pricing
5. **Verificação de negócio destrava 6.000 templates contra 250.** Vira etapa obrigatória de onboarding. https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
6. **Conversa de paciente é dado sensível (LGPD art. 5º, II).** Consentimento específico e destacado, ou tutela da saúde documentada (art. 11). https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
7. **Art. 11, § 4º proíbe compartilhar dado de saúde entre controladores para vantagem econômica.** Mata modelos de marketplace de lead de paciente e exige isolamento por cliente na arquitetura. https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
8. **LLM fora do Brasil é transferência internacional (art. 33).** Precisa de base legal, cláusulas e transparência.
9. **RIPD é esperado**, porque há dado sensível, larga escala e decisão automatizada. https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd
10. **O agente não pode fazer triagem clínica.** Teletriagem é ato médico pela CFM 2.314/2022, e sistemas automatizados não substituem avaliação médica. Guardrail obrigatório. https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2022/2314_2022.pdf
11. **O agente não pode prometer resultado (CFM 2.336/2023, art. 11, XII).** Exige filtro de saída no LLM, não apenas instrução de prompt. https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2023/2336_2023.pdf
12. **Antes e depois isolado é vedado (art. 14) e oferta casada é vedada (art. 11, § 4º, c).** Campanhas automatizadas precisam de validação de conformidade. Preço, por outro lado, pode ser informado (art. 9º).
13. **Odontologia responde ao CFO**, com a Resolução CFO-196/2019, e exige análise própria. https://website.cfo.org.br/resolucao-cfo-196-2019/

## 5.4 Lacunas de dados identificadas (oportunidade)

- Taxa de no-show em clínicas privadas brasileiras: não existe estatística nacional consolidada.
- Impacto financeiro por consulta perdida em clínica privada brasileira: não encontrado.
- Tempo diário da recepção brasileira em telefone e WhatsApp: não encontrado.
- Preço oficial da Meta por mensagem para o Brasil: não confirmado em fonte primária nesta pesquisa.

As três primeiras lacunas são oportunidade de pesquisa proprietária. Quem publicar o primeiro estudo nacional de no-show em clínicas privadas ganha autoridade de categoria e um ativo de marketing permanente.

---

## Fontes

### Bloco 1
- https://zaia.app/
- https://digisac.com.br/ e https://digisac.com.br/canais/whatsapp-api
- https://www.botconversa.com.br/
- https://www.blip.ai/planos/
- https://www.zenvia.com/precos/
- https://a.umbler.com/br/talk/
- https://www.kommo.com/pricing/
- https://www.huggy.io/pt-br/pricing
- https://rdstation.com/planos/tallos/
- https://robbu.com.br/planos/ e https://robbu.global/produtos/whatsapp-studio-positus/
- https://lais.app/ e https://lais.ai/
- https://clinia.io/
- https://cloudia.com.br/ e https://cloudia.com.br/precos/
- https://pevia.com.br/ e https://pevia.com.br/planos.php
- https://usesecretariaia.com/
- https://lauraai.com.br/
- https://viti.ai/

### Bloco 2
- https://www.assorthealth.com/
- https://www.prnewswire.com/news-releases/assort-health-secures-102-million-to-scale-nations-first-agentic-ai-platform-that-solves-longstanding-frustrations-tied-to-patient-access-and-experience-302570046.html
- https://emitrr.com/blog/assort-health-pricing/
- https://www.arini.ai/
- https://www.hellopatient.com/
- https://www.businesswire.com/news/home/20250904242038/en/Hello-Patient-Raises-%2422.5-Million-Series-A-to-Fix-the-Front-Door-of-Healthcare-With-Conversational-AI
- https://www.parakeethealth.com/
- https://www.simbie.ai/ e https://www.crunchbase.com/organization/simbie-health
- https://www.getweave.com/ e https://www.getweave.com/pricing/
- https://www.artera.io/ e https://noshowcost.com/tools/artera-pricing
- https://www.klara.com/
- https://www.zocdoc.com/join-zocdoc/pricing/
- https://thepapergown.zocdoc.com/facts/pay-per-booking-fees-explained/
- https://www.zocdoc.com/about/news/zocdoc-launches-zo-by-zocdoc-an-ai-phone-assistant-that-vanquishes-hold-times-and-maximizes-appointment-scheduling/
- https://www.lumahealth.io/
- https://www.lumahealth.io/how-hayes-valley-health-cut-no-shows-and-boosted-staff-efficiency-with-smarter-patient-engagement-ai/
- https://www.notablehealth.com/

### Bloco 3
- https://docs.fundacaopadrealbino.com.br/media/documentos/76cdfc6e9b45391b3d40d63388ea9030.pdf
- https://seer.ufrgs.br/index.php/saberesplurais/article/view/151127/97616
- https://ojs.brazilianjournals.com.br/ojs/index.php/BJHR/article/download/74064/51723/182816
- https://pro.doctoralia.com.br/blog/clinicas/dados-de-saude-no-brasil-panorama-das-clinicas-e-hospitais
- https://acontecendoaqui.com.br/empreendedorismo/alerta-falta-de-pacientes-pode-comprometer-ate-32-da-agenda-de-clinicas-no-pais/
- https://www.cochrane.org/CD007458/EPOC_mobile-phone-messaging-reminders-attendance-healthcare-appointments
- https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD007458.pub3/full
- https://journals.sagepub.com/doi/full/10.1258/jtt.2011.110707
- https://www.mdpi.com/2076-3417/15/17/9773
- https://pubmed.ncbi.nlm.nih.gov/19783204/ e https://www.sciencedirect.com/science/article/abs/pii/S1386505609001336
- https://sprucehealth.com/blog/doctors-losing-hour-day-phone-call-overhead/
- https://www.dialoghealth.com/post/patient-no-show-statistics
- https://mtaccoalition.org/nemt_data_point/missed-appointments-cost-the-u-s-healthcare-system-150b-each-year-data-point-1/

### Bloco 4
- https://developers.facebook.com/docs/whatsapp/pricing
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing
- https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
- https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- https://whatsappbusiness.com/products/platform-pricing/
- https://www.socialhub.pro/blog/preco-whatsapp-api-2026-brasil/ (fonte secundária)
- https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd
- https://www.gov.br/anpd/pt-br/centrais-de-conteudo/documentos-tecnicos-orientativos
- https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2023/2336_2023.pdf
- https://publicidademedica.cfm.org.br/
- https://portal.cfm.org.br/noticias/cfm-atualiza-resolucao-da-publicidade-medica/
- https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2022/2314_2022.pdf
- https://website.cfo.org.br/resolucao-cfo-196-2019/
- https://crosp.org.br/noticia/fique-em-dia-com-a-publicidade-odontologica-imagens-de-antes-e-depois-podem-ser-permitidas/
