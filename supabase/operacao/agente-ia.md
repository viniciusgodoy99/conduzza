# Agente de IA no WhatsApp (E3): operação

Como está ligado hoje, como fazer o primeiro teste, como desligar em segundos e religar, o que acompanhar, o que fazer em cada incidente e como voltar atrás.

**E4 (20/10/2026; construída e revisada, migration `20261020130000` aplicada na produção e código publicado no mesmo dia, `0e66cb2`; às 18h27 de 20/10/2026, nenhuma das duas clínicas tinha ligado a agenda):** a IA marca consulta. Como ligar a agenda numa das duas clínicas, o que conferir e como desligar: seção "Agenda pela IA (E4)", abaixo de "Encerrar uma conversa da IA".

Construído em 13/10/2026 (plano aprovado pelo dono em 13/10, "pode") e publicado em 19/10/2026 (`1c36327`; o telefone pelo administrador em `24058b1` e os vários números em `a87e01e`). **Migrations aplicadas:** M1 `20261013100000_ia_whatsapp_fila.sql`, M3 `20261013110000_ia_whatsapp_gatilho_mensagem.sql` e M2 `20261013120000_ia_whatsapp_funcoes_quentes.sql` em 13/10/2026, nessa ordem; `20261019100000_ia_telefone_pelo_administrador.sql` e `20261019110000_ia_varios_numeros.sql` em 19/10/2026 (md5 conferidos na produção: "Como foi ligado"). Contrato do banco no `docs/04`, 17.13; turno e travas no `docs/03`, seção 14; estado e decisões no `docs/05`, Fase 3, entrada "E3"; o motor da IA em `supabase/operacao/motor-por-cron.md`, "Resposta da IA no WhatsApp (motor-ia)".

---

## Regras que valem em todo passo

- A IA existe **só** na **teste123** (`acd9c539-585e-4f2a-a195-712c70099564`) e na **Conduzza Teste** (`f0c115dd-e98c-4767-a1bb-93d517844852`). Selecione **sempre por id**, nunca por nome: existe outra clínica chamada "Conduzza Teste" (`e2d2e43f`), mais "Clinica conduzza teste" (`6180eafd`) e "Vinicius teste" (`628d92b7`), todas fora da lista.
- A salud-care e qualquer outra clínica, **nunca**. Nenhum comando deste arquivo escreve em outra clínica.
- A IA conversa só com os **telefones da equipe** ligados na aba Agente de IA. Paciente nenhum, inclusive os que escrevem para o mesmo número.
- **Nunca imprima telefone** no SQL editor, em chat, ticket ou print: as consultas abaixo devolvem contagens, ids e o rótulo do telefone ("De quem é"). Neste arquivo, os números de WhatsApp aparecem só pelo id e pelo final.
- **Nunca copie texto de conversa nem o rascunho bloqueado** para fora do sistema (chat, ticket, log, planilha). Conversa de paciente é dado de saúde (LGPD, art. 5º, II).
- **Quem faz o quê nesta fase** (decisões do dono de 13/10 e 19/10/2026; `docs/05`, entrada "E3"):
  - **só a equipe Conduzza** (super admin na aba, ou o SQL editor): o interruptor geral, ligar o modo "Conversar com a equipe", ligar um número e o "Usar mesmo assim (fica registrado)" do telefone de paciente (este, só com o ok do dono; o administrador da clínica nunca vê a opção);
  - **o administrador da clínica** (e a equipe Conduzza): cadastrar e ligar os telefones da equipe ("Adicionar" e "Ligar de novo"), sempre com a confirmação do aviso da OpenAI, que vai para a trilha no nome de quem adicionou;
  - **qualquer administrador da clínica**: desligar o modo, um número ou um telefone, e deve desligar em caso de dúvida. Desligar vale na hora e, para ele, não tem volta pela tela: religar o modo e o número é só da equipe Conduzza ("Religar", abaixo).
- **Vários números** (decisão do dono de 19/10/2026, migration `20261019110000` aplicada): a clínica pode ter mais de um número ligado ao assistente, e o mesmo telefone da equipe tem uma conversa em cada número. Cada número liga e desliga sozinho. O assistente responde por qualquer número ligado e conectado.
- **O dono não é membro da Conduzza Teste** (decisão de 19/10/2026): ele não abre a aba, o Atendimento nem a Tela 6 de lá. O acompanhamento da Conduzza Teste é do **administrador de lá**, pela tela, e das **consultas A a J** ("Acompanhamento"), pelo dono, sem conteúdo de conversa. Consequências: o "Ver o que a IA ia responder" de lá não tem quem leia nesta fase (para o administrador, o botão fica desabilitado); o dono não cadastra telefone lá; religar o modo ou um número de lá é só pelo SQL editor.
- Nenhum comando aqui levanta 40001 ou 40P01. Não rode `update` direto em `conversation.status`, `ai_turno`, `ia_janela_da_conversa` nem `job_queue` fora do que este arquivo manda.

---

## Estado em 19/10/2026

Conferido na produção, só leitura, às 15:13 de 19/10/2026. Horários no fuso de Fortaleza. Tudo foi ligado por conexão direta ao banco, como pelo SQL editor, com o ok do dono (na trilha, "sem nome").

**teste123** (`acd9c539-585e-4f2a-a195-712c70099564`):

- Modo "Conversar com a equipe" (`contatos`), desde 09:08.
- Número ligado ao assistente: "Número principal", final 1318 (`2067be80-aabe-40c8-adc3-da78937b15aa`), conectado, desde 09:08.
- Versão 1 publicada às 09:08: a padrão (nome "Assistente", tom cordial, sem emoji, sem saudação, sem encerramento, 24 horas, habilidades padrão, base vazia).
- Telefones da equipe: uma linha, "Vinicius" (`31d0e6e8-b6cf-4497-8055-16363cf02144`), que é o próprio final 1318 e nunca aciona o assistente. Desligar.
- Quem acompanha: o dono, pela tela e pelas consultas.

**Conduzza Teste** (`f0c115dd-e98c-4767-a1bb-93d517844852`):

- Modo "Conversar com a equipe" (`contatos`), desde 09:08.
- Números ligados ao assistente, os dois conectados: "Número principal", final 0914 (`35fa44ef-6761-4293-88f9-b492f065f48f`, o que atende pacientes de verdade), desde 12:15; "Numero 2 teste pessoal", final 9018 (`d73d3e43-e299-4433-8f52-9f9cde6da5b9`), desde 09:08.
- Versão 1 publicada às 09:08, igual à da teste123.
- Telefones da equipe: nenhum. O administrador de lá cadastra.
- **Mudança de 20/10/2026** (conferida na produção, só leitura, depois da mudança):
  - O administrador de lá (Victor Torres, o único membro) **tirou o final 9018 da clínica**: `d73d3e43` removido e desconectado, e a linha dele em `ia_numero_liberado` desligada. O assistente segue só no final 0914.
  - O dono pediu para usar esse mesmo celular (o final 9018, agora pessoal do Victor) como telefone de teste: "pode liberar para ele adicionar, pode retirar ele de cliente". A trava de número da plataforma já não o recusa (o número saiu da clínica). Mas o contato dele na Conduzza Teste tem sinal de paciente: `kind` paciente e uma consulta de 18/09/2026, aguardando confirmação. Por isso a aba recusaria o cadastro.
  - **Cadastrado pelo forçar da equipe Conduzza**, pela conexão direta, com o ok do dono: linha "Victor" (`d07b3a0b-fa28-420b-94c7-ce84b8365dfc`), ativa e `forcado`. A trilha tem o forçar e a confirmação do aviso da OpenAI, sem nome. O contato e a consulta ficaram como estavam.
  - **Consequência:** se o Victor desligar essa linha, o "Ligar de novo" da aba é recusado (sinal de paciente). Religar é só pela equipe Conduzza, com o forçar, no SQL editor:

    ```sql
    select public.definir_contato_liberado_da_ia(
      p_clinic_id                => 'f0c115dd-e98c-4767-a1bb-93d517844852',
      p_telefone_e164            => (select l.phone_key from public.ia_contato_liberado l
                                      where l.id = 'd07b3a0b-fa28-420b-94c7-ce84b8365dfc'),
      p_rotulo                   => null,
      p_ativo                    => true,
      p_forcar_contato_existente => true);
    ```

    Esta é a única receita deste arquivo com o forçar, e vale só para essa linha, já autorizada pelo dono.

  - **Primeiro teste no WhatsApp (20/10/2026):** às 13h39 o Victor assumiu a conversa aberta desse celular no final 0914 (`0ed9746c`), respondeu e a devolveu para a IA. Às 13h40 o assistente respondeu (`respondeu`, aprovado pelo filtro, 8 s, `gpt-6-luna`): a primeira resposta da IA num WhatsApp de verdade. Na mensagem seguinte ("Quero marcar uma consulta") passou para a equipe com a frase fixa (`escalou`, `pedido_de_agenda`), como manda esta fase: marcar consulta é a E4, ainda não construída. Custo da clínica até ali: 5 chamadas, US$ 0,0006.
- Quem acompanha: o administrador de lá, pela tela; o dono, só pelas consultas.

**Nas duas:**

- **Teto:** US$ 5 a cada 24 horas e até 20 respostas por conversa por hora.
- **As duas clínicas ligadas juntas,** por decisão do dono de 19/10/2026 (o motivo gravado na liberação das duas e no interruptor). Antes, a Conduzza Teste só entraria depois de 3 a 5 dias limpos na teste123.
- **Interruptor geral ligado** às 09:12, com o motivo "Dono em 19/10/2026: teste com telefones da equipe na teste123 e na Conduzza Teste; frase fixa aprovada; rodada paga dispensada nesta fase". Foi ligado antes de qualquer telefone válido (a ordem segura deixa o interruptor por último, D33): por isso **o telefone da equipe é o único portão que falta nas duas clínicas**, e cadastrar um telefone válido liga a IA na hora, sem diálogo de confirmação, em todos os números ligados da clínica (na Conduzza Teste, inclusive o final 0914). Os pacientes que escrevem para esses números continuam só com a equipe.
- **Frase fixa (D5) aprovada** pelo dono em 19/10/2026: "Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível." Se o texto mudar, ele muda no código (`lib/domain/conformidade/frase-fixa.ts`) e no banco (`frase_de_escalonamento_da_ia()`) na mesma leva.
- **Rodada paga de aceite do filtro do CFM (D34):** dispensada pelo dono em 19/10/2026 para esta fase (só telefones da equipe); **obrigatória antes de qualquer paciente.**
- **Motor da IA:** `motor-ia` no pg_cron a cada 10 s, agendado em 19/10/2026, sem falha; a rota nunca foi chamada, porque ainda não houve resposta devida.
- **OpenAI:** nenhuma chamada até agora, nem pelo simulador (`ia_uso` vazio). A primeira simulação é o primeiro teste da chave, do modelo e do segredo ("Roteiro do primeiro teste", passo 5).
- **Vercel (Production):** `OPENAI_API_KEY` e `IA_SEGREDO_DO_IDENTIFICADOR` cadastrados com redeploy, segundo o dono. O banco não confere isso: quem confere é a aba sem o motivo de ambiente e a simulação.

**O que falta para a IA responder:** um telefone da equipe válido, cadastrado e ligado em cada clínica (D1), sem conversa aberta com a equipe nos números ligados ("Roteiro do primeiro teste", passos 1 a 3).

**Publicado depois deste retrato:** as correções da revisão para produção de 19/10/2026 (`docs/05`, entrada "E3"), entre elas o portão de entrada afrouxado e o nome da clínica no prompt. Saíram em `d2a7fc0`, com a migration `20261019120000_ia_ajustes_do_teste.sql` aplicada em 19/10/2026 ("Como foi ligado", passo 8). O que este arquivo marca como "depois da migration `20261019120000`" ou "depois do deploy" já vale, e o passo 8 do roteiro (as mensagens que passavam para a equipe à toa) não se aplica mais.

---

## Roteiro do primeiro teste

Em cada clínica, na ordem. Na teste123 quem faz é o dono; na Conduzza Teste, o administrador de lá, e o dono acompanha pelas consultas.

**Antes de escrever:**

1. **Escolher o celular de teste (D1):** que **não** seja o final 0914, o final 9018 nem o final 1318 (nenhum número conectado ao Conduzza, de clínica nenhuma). A aba recusa número conectado com "Este telefone não pode ser usado como telefone da equipe. Use o celular pessoal de alguém da equipe.", a IA nunca responde a ele, e a mensagem de um número da clínica para outro da mesma clínica nem é gravada. Quem usa o celular recebe o aviso por escrito (D32): o que escrever vai para a OpenAI, nos EUA, e só dados de teste.
2. **Cadastrar o telefone** (administrador da clínica; aba Agente de IA de Configurações, cartão "Telefones da equipe"): "De quem é", "Telefone", a confirmação "Quem usa este celular sabe que o que escrever vai para a OpenAI, nos EUA, e vai usar só dados de teste." e "Adicionar". A linha tem de ficar "Conversa com o assistente", nunca "Não aciona o assistente". Na teste123, "Desligar" na linha "Vinicius" (é o próprio final 1318). Se a aba disser "Este telefone é de um paciente da clínica...", **pare** e fale com o dono; na Conduzza Teste o "Usar mesmo assim" nem existe pela tela (o administrador não força, e o dono não é membro).
3. **Resolver a conversa aberta antes:** conversa aberta com a equipe não passa para a IA e não avisa nada: a mensagem cai na conversa velha, em "Aguardando você", sem resposta e sem evento. Em 19/10/2026, **todos** os contatos das duas clínicas tinham conversa aberta (na Conduzza Teste, nenhuma conversa foi resolvida até hoje): se o celular de teste já escreveu para um dos números, a conversa dele está aberta. A linha do telefone mostra, uma vez por número com conversa aberta, "Tem conversa aberta com a equipe no número {nome}." com "Para o assistente começar neste número, assuma e resolva a conversa aberta no Atendimento." e o botão "Abrir conversa", que leva à conversa no Atendimento (sem a lista de números, "Tem conversa aberta com a equipe num dos números ligados."). Isso vale depois da migration `20261019120000` e do deploy do código; até lá, a linha diz só "Tem conversa aberta com a equipe num dos números ligados: nesse número, o assistente começa na próxima conversa.", sem o número nem o botão. Nos dois casos, a consulta I diz em qual número e dá o link (que só abre para quem é membro da clínica). No Atendimento, em cada uma: **Assumir conversa** e **Resolver**. Na Conduzza Teste, conferir os dois números.
4. **Aba verde, sem motivo:** "Conversando com a equipe", sem nenhum motivo de parada; o telefone em "Conversa com o assistente"; os números em "Em uso pelo assistente". Se aparecer o motivo de que a equipe Conduzza ainda não ativou o assistente (para o super admin, depois do deploy das correções de 19/10/2026, "A chave da OpenAI ou o segredo do identificador não estão no ambiente de produção da Vercel."), é a Vercel (sem `OPENAI_API_KEY`, sem `IA_SEGREDO_DO_IDENTIFICADOR` de 32 caracteres ou mais, ou fora de Production): pare (na Conduzza Teste, o administrador avisa o dono). Se aparecer o motor parado: `supabase/operacao/motor-por-cron.md`, "Resposta da IA no WhatsApp (motor-ia)".
5. **Simular primeiro** (tela Agente de IA, do menu, no simulador): uma pergunta, cerca de US$ 0,01 (conta no teto de US$ 5 e aparece na consulta G como `simulador`). Na Conduzza Teste, "Quanto custa a Prostota?" (a resposta tem de trazer R$ 500,00); na teste123, que não tem preço cadastrado, um cumprimento ("oi"). **Só siga se a resposta vier.** Se vier a frase fixa ou um aviso de ambiente ("A chave da OpenAI ainda não está configurada." e afins), pare e abra "Por que a IA respondeu isso": o problema (chave, crédito, modelo ou segredo) se repetiria no WhatsApp.
6. **Avisar quem atende os números pelo celular,** principalmente o final 0914 (com pacientes reais), para **não responder ao celular de teste**. Resposta pelo aparelho até uns 8 segundos depois da mensagem é tomada por resposta automática, a conversa continua na IA e o contato recebe as duas; resposta mais lenta tira a conversa da IA ("Alguém respondeu pelo celular. A IA parou de responder nesta conversa."). A saudação e a ausência automáticas do WhatsApp Business continuam nos números (D4 de 13/10/2026): o celular de teste pode receber uma mensagem a mais, que aparece no fio como "Pelo WhatsApp" e fica fora do que vai ao modelo.

**Durante:**

7. **Uma pergunta por vez, esperando até 1 minuto** pela resposta antes da próxima. Os tempos: mensagens com menos de 4 s entre elas viram um turno só (cada uma empurra mais 4 s, até 15 s depois da primeira); o motor da IA olha a fila a cada 10 s; o turno tem até 45 s. O esperado é de 15 a 40 s. Sem resposta, em cerca de 3 minutos (a varredura roda a cada minuto) a conversa volta para a equipe com "A IA não respondeu a tempo. A conversa voltou para a equipe." e o contato não recebe nada. Não assuma antes disso: Assumir descarta o turno em voo.
8. **Até a correção do portão de entrada ser publicada** (decisão do dono de 19/10/2026; `docs/05`, entrada "E3"), estas mensagens ainda passam para a equipe na hora: "!!!" ou "????", mensagem em caixa alta, "alguém aí?", "tá demorando", nome como Socorro, Dores, Dolores, Remédios ou Dan ao se apresentar, e "exame" em pergunta de preço. Para testar outra coisa, evite-as.
9. **Depois de uma passagem para a equipe** (o celular recebe a frase fixa; no fio, "A IA passou a conversa para a equipe: <motivo>."; a conversa vai para "Aguardando você"), mensagem nova do mesmo celular naquele número fica com a equipe, e a IA não responde mais nela. Para seguir, no Atendimento, um dos dois:
   - **Assumir conversa** e **Resolver**: a próxima mensagem abre conversa nova, já na IA;
   - **Assumir conversa**, responder alguma coisa e **Devolver para a IA** (antes de responder, o botão fica desabilitado com "Responda o paciente antes de devolver para a IA."): a IA recomeça na próxima mensagem, sem ler o que veio antes.

   Depois, **escreva de novo**.

10. **Em cada pergunta:** as consultas C e F mostram o job; depois, D e E dizem o desfecho e o motivo, inclusive a causa técnica de uma falha, que a tela só chama de "falha técnica".

**Verificação com os dados de hoje:**

1. Preço: na Conduzza Teste, a Prostota com R$ 500,00, no WhatsApp e no Atendimento (bolha do "Assistente", com o selo "IA"). Na teste123, sem preço cadastrado, a pergunta de preço termina na frase fixa até o dono cadastrar o preço ("Dados do dono para o teste valer", item 1).
2. Convênio: nas duas, sem convênio ligado a procedimento, termina na frase fixa (item 2 da mesma lista).
3. Sintoma ("estou com dor"): chega a frase fixa; no fio, "A IA passou a conversa para a equipe: o paciente descreveu um sintoma."; a conversa em "Aguardando você".
4. Devolver: depois do 3, Assumir conversa, responder, Devolver para a IA e mandar mensagem nova: a IA volta a responder, sem citar o que veio antes do Devolver.
5. Assumir enquanto a IA pensa: nada sai da IA.
6. Responder pelo celular conectado, mais de 10 segundos depois da mensagem do contato: a conversa sai da IA, com "Alguém respondeu pelo celular. A IA parou de responder nesta conversa.".
7. Outro celular, fora da lista, escrevendo para o mesmo número: só a equipe vê; a IA não responde.
8. Desligar ("Desligar em segundos"): em segundos nada mais responde e a conversa volta com "O assistente foi desligado. A conversa voltou para a equipe.". Na Conduzza Teste, só com o dono pronto para religar pelo SQL editor ("Religar").
9. A consulta J em zero.

**Primeira semana:** na teste123, o dono revisa 100% das conversas, bloqueios e escalonamentos, pelos links das consultas C, D e E. Na Conduzza Teste, o administrador de lá acompanha pela tela, e o dono pelas consultas A, B, D, E, F, G e J, sem conteúdo e sem o rascunho bloqueado.

---

## Dados do dono para o teste valer

Ninguém preenche estes dados no lugar do dono. Sem eles, a IA não tem o que responder e passa para a equipe com a frase fixa, que é o comportamento certo, mas não testa a habilidade. Estado em 19/10/2026:

1. **Preço dos dois procedimentos da teste123** ("Colocar o osso no lugar" e "Limpeza de ouvido"): sem preço base e sem preço no vínculo. A IA lê o preço do vínculo (quem faz o procedimento), e só com "IA pode agendar" no procedimento e no vínculo; o preço base chega ao vínculo que segue o padrão quando o procedimento é salvo. Na Conduzza Teste, a Prostota tem R$ 500,00 particular.
2. **Convênios ligados aos procedimentos:** nenhuma das duas tem convênio ligado a procedimento ("Petrobras", plano "Particular", na teste123; "Unimed", plano "Unimed", na Conduzza Teste). Quais convênios, planos e coberturas são reais é do dono.
3. **Perguntas da base** (Tela 6, Conhecimento, e depois **publicar de novo**, porque o WhatsApp usa só a versão publicada): a base está vazia nas duas. Sem ela, endereço, horário de funcionamento, estacionamento e formas de pagamento terminam na frase fixa.
4. **Nome do assistente:** hoje "Assistente", o padrão (sem título de profissional de saúde).
5. **Saudação e encerramento:** hoje nenhum dos dois (texto do dono, se quiser; com saudação, a IA para de cumprimentar sozinha).
6. **Nomes no Cadastro que a IA repete ao contato:** os procedimentos ("Prostota"; "Colocar o osso no lugar", que descreve uma lesão e pode levar o classificador a apontar sintoma numa simples pergunta de preço), os profissionais ("VInicius", com a caixa trocada, e "Teste profissional") e, quando a correção do nome da clínica no prompt for publicada (decisão de 19/10/2026), o nome cadastrado da clínica (hoje "teste123" e "Conduzza Teste").
7. **Para a agenda pela IA (E4, depois da migration e do código):** profissionais com horário de atendimento, procedimentos com "IA pode agendar" (a chave do procedimento, que os vínculos seguem), com quem faz e a duração, o preço particular, os convênios que cada profissional atende, a antecedência mínima e o horizonte da Tela 6 e a versão publicada com "Agendar consulta" ligada ("Agenda pela IA (E4)", passos 1 a 5).

---

## Desligar em segundos

Desligar **nunca envia nada** ao contato: as conversas da IA voltam para a equipe com o evento "O assistente foi desligado. A conversa voltou para a equipe." e os pendentes são cancelados. O job que estiver em voo para nas guardas (antes do modelo, entre rodadas, logo antes do provedor e no gatilho de `message`).

- **Uma clínica:** na aba Agente de IA, "Desligado" (o administrador da clínica também pode). Pelo SQL editor (na Conduzza Teste, o caminho do dono):

  ```sql
  select public.definir_liberacao_da_ia('<id da clínica>', false, null, 'motivo curto');
  ```

- **Só um número ou só um telefone:** "Desligar" na linha do número (cartão "Números do assistente") ou do telefone (cartão "Telefones da equipe"). Pelo SQL editor, sempre por id e por nome de parâmetro, **sem digitar o telefone** (os ids saem das consultas de "Religar", passo 1):

  ```sql
  -- um número
  select public.definir_numero_da_ia(
    p_clinic_id           => '<id da clínica>',
    p_whatsapp_account_id => '<id do número>',
    p_ativo               => false);

  -- um telefone da equipe, pelo id da linha
  select public.definir_contato_liberado_da_ia(
    p_clinic_id     => '<id da clínica>',
    p_telefone_e164 => (select l.phone_key from public.ia_contato_liberado l
                         where l.id = '<id da linha>' and l.clinic_id = '<id da clínica>'),
    p_rotulo        => null,
    p_ativo         => false);
  ```

  Na teste123, a linha "Vinicius" (o próprio final 1318) é `31d0e6e8-b6cf-4497-8055-16363cf02144`. `p_rotulo => null` mantém o "De quem é"; id errado faz a subconsulta voltar vazia, e a RPC recusa (22004) sem mudar nada. Desligar um número devolve só as conversas dele e **não mexe nos outros números ligados**: para parar a clínica inteira, "Desligado" no modo.

- **Tudo, nas duas clínicas:** o interruptor geral na aba (super admin) ou:

  ```sql
  select public.definir_interruptor_da_ia(false, 'motivo curto');
  ```

  Se o `audit_log` mostrar `ia_interruptor_varredura_falhou`, a flag está desligada mas sobraram conversas na IA: repetir a chamada (`docs/04`, 17.5).

- **Parar só o motor da IA** (não mexe nas réguas): `select public.motor_ia_desagendar();`. As conversas continuam na IA, mas ninguém responde: a varredura de 3 minutos as devolve para a equipe. Use junto com um dos desligamentos acima, não no lugar.
- **Último recurso:** revogar a `OPENAI_API_KEY` no painel da OpenAI (T1). Nada mais chama o modelo; as conversas passam para a equipe por falha técnica.
- **Conferir** (as duas em zero):

  ```sql
  select count(*) from public.conversation
  where status = 'ia_atendendo'
    and clinic_id = any (public.ia_clinicas_da_fase_controlada());

  select count(*) from public.job_queue
  where kind = 'responder_com_ia' and status in ('pendente', 'executando');
  ```

**Desligar é sempre pela RPC ou pela aba.** `update` direto em `ia_interruptor`, `ia_liberacao` ou `ia_numero_liberado` é só recuo (se a RPC falhar): desliga sem devolver as conversas, que ficam em `ia_atendendo` até a varredura ou até alguém rodar `select public.ia_desligar(array['<clinic_id>']::uuid[]);` no SQL editor.

---

## Religar

Só com o ok do dono e só depois de entender o que fez desligar (a consulta H mostra quem mexeu, quando e em quê). **O administrador da clínica não religa o modo nem um número** (nem volta de "Só simulador" para "Conversar com a equipe"): na teste123, o dono religa pela aba; na Conduzza Teste, onde ele não é membro, só pelo SQL editor, com as receitas abaixo. Um telefone da equipe desligado o administrador religa sozinho, na aba ("Ligar de novo").

Cada receita grava a trilha (`editou`, "sem nome" na consulta H) e devolve para a equipe, sem enviar nada, as conversas que deixaram de valer. Se der 55P03 (trava ocupada), nada mudou: repita em alguns minutos.

1. **Achar os ids**, sem imprimir telefone:

   ```sql
   -- números da clínica: id, nome, conexão e se está ligado ao assistente
   select w.id as numero, w.nome, w.connection_status as conexao,
          coalesce(n.ativo, false) as ligado_ao_assistente
   from public.whatsapp_account w
   left join public.ia_numero_liberado n on n.whatsapp_account_id = w.id
   where w.clinic_id = '<id da clínica>' and w.removido_em is null
   order by w.nome;

   -- telefones da equipe: id da linha e "De quem é"
   select l.id, l.rotulo as de_quem, l.ativo, l.forcado
   from public.ia_contato_liberado l
   where l.clinic_id = '<id da clínica>'
   order by l.rotulo;
   ```

2. **O modo "Conversar com a equipe"** (também desfaz um "Só simulador"). O motivo substitui o anterior em `ia_liberacao.motivo` (até 500 caracteres):

   ```sql
   begin;
   set local lock_timeout = '5s';
   select public.definir_liberacao_da_ia(
     p_clinic_id => '<id da clínica>',
     p_liberada  => true,
     p_modo      => 'contatos',
     p_motivo    => 'Dono em <data>: <motivo curto>');
   commit;
   ```

3. **Um número** (ligar um não desliga os outros). A RPC não tem motivo: a trilha registra só `editou`. Número desconectado liga, mas não responde até reconectar na aba WhatsApp:

   ```sql
   begin;
   set local lock_timeout = '5s';
   select public.definir_numero_da_ia(
     p_clinic_id           => '<id da clínica>',
     p_whatsapp_account_id => '<id do número>',
     p_ativo               => true);
   commit;
   ```

4. **Um telefone que já está na lista**, pelo id da linha, sem digitar o telefone:

   ```sql
   begin;
   set local lock_timeout = '5s';
   select public.definir_contato_liberado_da_ia(
     p_clinic_id     => '<id da clínica>',
     p_telefone_e164 => (select l.phone_key from public.ia_contato_liberado l
                          where l.id = '<id da linha>' and l.clinic_id = '<id da clínica>'),
     p_rotulo        => null,
     p_ativo         => true);
   commit;
   ```

   Só para linha que já existe, como o "Ligar de novo" da aba (sem a confirmação do aviso da OpenAI): telefone novo é sempre pela aba, que pede a confirmação e a manda. Nenhuma receita deste arquivo cria telefone (as duas vão pelo id da linha). Depois da migration `20261019120000`, o próprio banco recusa telefone fora da lista sem `p_confirmou_aviso_da_openai => true`, inclusive pelo SQL editor (23514 `aviso_da_openai_nao_confirmado`, nada muda), e, com ela, grava a trilha `confirmou_aviso_da_openai` na mesma transação ("sem nome" pelo SQL editor); antes dela, o parâmetro nem existe e a chamada com ele falha. **Nunca** passe `p_forcar_contato_existente`: o telefone com sinal de paciente é recusado (23514 `contato_de_paciente`), e o forçar é só pela aba, pelo super admin, com o ok do dono. O número de WhatsApp de qualquer clínica do Conduzza também é recusado (23514 `telefone_invalido_para_equipe`).

5. **O interruptor geral:** o dono religa na aba da teste123 (cartão "Interruptor geral") ou com `select public.definir_interruptor_da_ia(true, 'motivo curto');`.

Conferir depois: consulta A (e a I, se mexeu em telefone).

---

## Acompanhamento

### Durante o teste: consultas A a J

Rodar no SQL editor. Nenhuma escreve e nenhuma devolve texto de mensagem, rascunho, `context_read` nem telefone (a E compara o texto do evento com o rótulo do motivo, e a J só calcula o hash, como a auditoria 3). Os links abrem a conversa no Atendimento da clínica ativa de quem clica: os da Conduzza Teste só abrem para o administrador de lá. Conferidas na produção, só leitura, em 19/10/2026.

| Quando                                                      | Consultas |
| ----------------------------------------------------------- | --------- |
| Antes do teste                                              | A, B e J  |
| Logo depois de cadastrar um telefone, antes de escrever     | I         |
| Em cada mensagem de teste (o job)                           | C e F     |
| Depois de cada resposta ou passagem (o desfecho e o motivo) | D e E     |
| A cada 10 a 15 minutos; B também logo depois da 1ª mensagem | A, B e J  |
| No fim do dia (custo e trilha)                              | G e H     |

**A. Painel das duas clínicas**

```sql
select c.name as clinica,
       l.liberada, l.modo, l.pausada_pela_clinica as pausada,
       (select i.ligado from public.ia_interruptor i where i.id) as interruptor,
       (select count(*) from public.ia_numero_liberado n
          join public.whatsapp_account w on w.id = n.whatsapp_account_id
         where n.clinic_id = c.id and n.ativo and w.removido_em is null) as numeros_ligados,
       (select count(*) from public.ia_numero_liberado n
          join public.whatsapp_account w on w.id = n.whatsapp_account_id
         where n.clinic_id = c.id and n.ativo and w.removido_em is null
           and w.connection_status = 'conectado') as numeros_conectados,
       (select count(*) from public.ia_contato_liberado k
         where k.clinic_id = c.id and k.ativo) as telefones_ativos,
       jsonb_array_length(x.s -> 'telefones_invalidos')
         + jsonb_array_length(x.s -> 'telefones_sem_autorizacao') as telefones_que_nao_acionam,
       jsonb_array_length(x.s -> 'telefones_com_conversa_aberta') as telefones_com_conversa_aberta,
       (x.s ->> 'versao_publicada')::int as versao_publicada,
       (x.s ->> 'motor_parado')::boolean as motor_parado,
       (x.s ->> 'teto_atingido')::boolean as teto_atingido,
       round(coalesce((select sum(u.custo_microdolar) from public.ia_uso u
                        where u.clinic_id = c.id
                          and u.created_at >= now() - interval '24 hours'), 0) / 1e6, 4) as gasto_24h_usd,
       l.teto_diario_centavos_usd / 100.0 as teto_usd,
       (select count(*) from public.conversation v
         where v.clinic_id = c.id and v.status = 'ia_atendendo') as conversas_na_ia,
       (select count(*) from public.job_queue j
         where j.clinic_id = c.id and j.kind = 'responder_com_ia'
           and j.status in ('pendente', 'executando')) as jobs_vivos
from public.clinic c
join public.ia_liberacao l on l.clinic_id = c.id
cross join lateral (select public.situacao_da_ia_na_clinica(c.id) as s) x
where c.id = any (public.ia_clinicas_da_fase_controlada())
order by c.name;
```

Em 19/10/2026, antes do primeiro telefone: as duas liberadas em `contatos`, interruptor ligado, versão 1, motor e teto em falso, gasto zero; Conduzza Teste com 2 números ligados e conectados e nenhum telefone; teste123 com 1 número e 1 telefone ativo que não aciona (o próprio final 1318).

**B. Motor da IA**

```sql
select (public.saude_do_motor() -> 'ia') as ia,   -- agendado e vigiado true, devidos 0, alerta false
       (select row_to_json(r) from (
          select count(*) as execucoes_10min,
                 count(*) filter (where d.status <> 'succeeded') as falhas_10min
            from cron.job_run_details d
            join cron.job j on j.jobid = d.jobid
           where j.jobname = 'motor-ia'
             and d.start_time >= now() - interval '10 minutes') r) as cron_motor_ia,
       (select row_to_json(r) from (
          select count(*) filter (where h.content like '%"motor":"ia"%') as chamadas_da_rota_ia,
                 max(h.created) filter (where h.content like '%"motor":"ia"%') as ultima_chamada,
                 (array_agg(h.content order by h.created desc)
                    filter (where h.content like '%"motor":"ia"%'))[1] as ultimo_resumo,
                 count(*) filter (where h.status_code is distinct from 200) as nao_200_de_qualquer_motor
            from net._http_response h
           where h.created >= now() - interval '30 minutes') r) as rota_30min,
       (select ultimo_erro from public.worker_heartbeat
         where worker_id = 'motor-planner') as planner_erro;  -- ia_sem_resposta:<n> = varredura de 3 min
```

Como ler: a rota só é chamada quando há resposta devida (sem teste, tudo em zero é o normal). Rota chamada com `"reivindicados":0` e `devidos` maior que zero: a Vercel está sem a chave ou o segredo (a rota bate o ponto e não pega nada). `nao_200` subindo com `chamadas_da_rota_ia` em zero: segredo divergente (401) ou rota ausente (404). `ultimo_resumo` com `falhos`: olhar a D.

**C. Conversas na IA agora**

```sql
select c.name as clinica,
       w.nome as numero,
       v.status, v.awaiting_reply as contato_esperando,
       date_trunc('second', now() - v.last_inbound_at) as desde_a_ultima_do_contato,
       (select count(*) from public.job_queue j
         where j.kind = 'responder_com_ia' and j.status in ('pendente', 'executando')
           and j.payload ->> 'conversation_id' = v.id::text) as jobs_vivos,
       (select count(*) from public.message m
         where m.conversation_id = v.id and m.author = 'ia') as respostas_da_ia,
       'https://conduzza.vercel.app/atendimento?conversa=' || v.id as link
from public.conversation v
join public.clinic c on c.id = v.clinic_id
left join public.whatsapp_account w on w.id = v.whatsapp_account_id
where v.clinic_id = any (public.ia_clinicas_da_fase_controlada())
  and v.status = 'ia_atendendo'
order by v.last_inbound_at;
```

**D. Cada turno: o que decidiu e por quê** (é onde aparece o motivo da falha e o que o filtro barrou)

```sql
select to_char(d.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI:SS') as quando,
       c.name as clinica,
       d.desfecho,                 -- respondeu | escalou | bloqueou | falhou
       d.escalation_reason,        -- por que passou para a equipe
       d.gatilho_entrada,          -- o classificador de entrada que disparou
       d.compliance_rule,          -- o que o filtro do CFM barrou
       d.camada,                   -- regra | modelo | falha
       d.motivo_da_falha,          -- o detalhe tecnico (a tela so diz "falha tecnica")
       d.latency_ms,
       d.tokens_entrada, d.tokens_saida, d.tokens_cache,
       d.agente_modelo, d.config_version,
       t.estado as turno, t.saida,
       (select j.last_error from public.job_queue j where j.id = d.job_id) as erro_do_job,
       'https://conduzza.vercel.app/atendimento?conversa=' || d.conversation_id as link
from public.ai_decision_log d
join public.clinic c on c.id = d.clinic_id
left join public.ai_turno t on t.job_id = d.job_id
where d.clinic_id = any (public.ia_clinicas_da_fase_controlada())
  and d.created_at >= now() - interval '6 hours'
order by d.created_at desc;
```

**E. Eventos no fio das conversas dos telefones da equipe**, pelo código do motivo (inclui `parada`, `celular`, `sem_resposta` e `desligada`, que não têm decisão)

```sql
with motivos(codigo) as (
  values ('sintoma'), ('pedido_humano'), ('insatisfacao'), ('menor_de_idade'),
         ('valor_fora_da_tabela'), ('falhas_seguidas'), ('assunto_clinico'),
         ('midia_nao_suportada'), ('tentativa_de_manipulacao'), ('conformidade'),
         ('agente_pediu'), ('teto_atingido'), ('regra_do_procedimento'),
         ('falha_tecnica'), ('teto_de_respostas'), ('nao_individual'),
         ('pedido_de_agenda'), ('fora_do_horario'), ('horario_nao_suportado'),
         ('sem_versao_publicada'), ('liberacao_perdida'), ('numero_desconectado'),
         ('envio_incerto'), ('aviso_nao_enviado'), ('celular'), ('sem_resposta'),
         ('desligada'), ('parada'), ('sem_autorizacao')
)
select to_char(m.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI:SS') as quando,
       c.name as clinica,
       coalesce(mo.codigo,
                case when m.body like '% devolveu a conversa para a IA' then 'devolveu_para_ia'
                     when m.body like '% assumiu a conversa' then 'assumiu'
                     when m.body like '% passou a conversa para %' then 'transferiu'
                     else 'outro_evento' end) as evento,
       'https://conduzza.vercel.app/atendimento?conversa=' || m.conversation_id as link
from public.message m
join public.clinic c on c.id = m.clinic_id
left join motivos mo on public.rotulo_do_motivo_da_ia(mo.codigo) = m.body
where m.clinic_id = any (public.ia_clinicas_da_fase_controlada())
  and m.content_type = 'evento'
  and m.created_at >= now() - interval '6 hours'
  -- so as conversas dos telefones da equipe (o escopo do teste), sem imprimir telefone
  and exists (select 1
                from public.conversation v
                join public.contact k on k.id = v.contact_id
                join public.ia_contato_liberado l
                  on l.clinic_id = v.clinic_id and l.phone_key = k.phone_key
               where v.id = m.conversation_id)
order by m.created_at desc;
```

**F. Fila da IA** (vivos e o que terminou nas últimas 2 horas)

```sql
select c.name as clinica,
       j.status, j.last_error, j.ultimo_motivo_devolucao,
       j.attempts, j.devolucoes,
       to_char(j.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI:SS') as criado,
       to_char(j.run_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI:SS') as roda_em,
       j.locked_by is not null as com_posse,
       date_trunc('second', now() - j.created_at) as idade,
       'https://conduzza.vercel.app/atendimento?conversa=' || (j.payload ->> 'conversation_id') as link
from public.job_queue j
join public.clinic c on c.id = j.clinic_id
where j.kind = 'responder_com_ia'
  and (j.status in ('pendente', 'executando') or j.updated_at >= now() - interval '2 hours')
order by j.created_at desc;
```

`last_error = 'ia_fora_do_ambiente'`: a Vercel está sem a chave ou o segredo.

**G. Gasto: 24 horas (a janela do teto) e hoje, no fuso da clínica**

```sql
select c.name as clinica,
       u.origem,                      -- whatsapp | simulador
       u.papel,                       -- agente | verificador | classificador
       u.modelo,
       count(*) filter (where not u.reserva) as chamadas,
       count(*) filter (where u.reserva) as reservas_em_aberto,
       count(*) filter (where u.reserva and u.created_at < now() - interval '5 minutes') as reservas_presas,
       round(coalesce(sum(u.custo_microdolar)
               filter (where u.created_at >= now() - interval '24 hours'), 0) / 1e6, 4) as usd_24h,
       round(coalesce(sum(u.custo_microdolar)
               filter (where (u.created_at at time zone 'America/Fortaleza')::date
                             = (now() at time zone 'America/Fortaleza')::date), 0) / 1e6, 4) as usd_hoje
from public.ia_uso u
join public.clinic c on c.id = u.clinic_id
where u.created_at >= now() - interval '48 hours'
group by rollup ((c.name), (u.origem, u.papel, u.modelo))
order by c.name nulls last, u.origem nulls last, u.papel;
```

`reservas_presas` maior que zero: turno que morreu no meio; a reserva (o custo máximo) conta no teto por 24 horas.

**H. Trilha do teste** (quem mexeu na IA, quem confirmou o aviso, quem leu rascunho; inclui o interruptor geral, que não tem clínica)

```sql
select to_char(a.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI:SS') as quando,
       coalesce(c.name, 'as duas (interruptor geral)') as clinica,
       coalesce(p.name, 'sem nome') as quem,
       a.action, a.entity,
       case when a.entity = 'ia_contato_liberado'
            then (select l.rotulo from public.ia_contato_liberado l where l.id = a.entity_id)
       end as telefone_de_quem,
       case when a.entity = 'conversation'
            then 'https://conduzza.vercel.app/atendimento?conversa=' || a.entity_id
       end as link
from public.audit_log a
left join public.clinic c on c.id = a.clinic_id
left join public.profile p on p.user_id = a.user_id
where (a.clinic_id = any (public.ia_clinicas_da_fase_controlada())
       or (a.clinic_id is null and a.entity like 'ia\_interruptor%'))
  and a.created_at >= now() - interval '24 hours'
  and (a.entity in ('ia_liberacao', 'ia_numero_liberado', 'ia_contato_liberado')
       or a.entity like 'ia\_interruptor%'
       or a.action in ('devolveu_para_ia', 'leu_rascunho_bloqueado',
                       'forcou_telefone_de_paciente_na_ia', 'confirmou_aviso_da_openai')
       or a.action like 'ia\_%')
order by a.created_at desc;
```

"sem nome": mudança feita pelo SQL editor (ou por outra conexão direta ao banco).

**I. Telefones da equipe: o banco deixa? tem conversa aberta?**

```sql
select c.name as clinica,
       l.rotulo as de_quem,
       l.ativo, l.forcado,
       w.nome as numero,
       w.connection_status as conexao,
       public.ia_atende_no_whatsapp(l.clinic_id, n.whatsapp_account_id, l.phone_key) as conversa_nova_entra_na_ia,
       public.telefone_e_numero_da_plataforma(l.phone_key) as e_numero_da_plataforma,
       public.contato_tem_sinal_de_paciente(l.clinic_id, l.phone_key) as tem_sinal_de_paciente,
       (select v.status from public.conversation v
          join public.contact k on k.id = v.contact_id
         where v.clinic_id = l.clinic_id and k.phone_key = l.phone_key
           and v.whatsapp_account_id = n.whatsapp_account_id
           and v.status <> 'resolvida'
         limit 1) as conversa_aberta_neste_numero,
       (select 'https://conduzza.vercel.app/atendimento?conversa=' || v.id from public.conversation v
          join public.contact k on k.id = v.contact_id
         where v.clinic_id = l.clinic_id and k.phone_key = l.phone_key
           and v.whatsapp_account_id = n.whatsapp_account_id
           and v.status <> 'resolvida'
         limit 1) as link
from public.ia_contato_liberado l
join public.clinic c on c.id = l.clinic_id
join public.ia_numero_liberado n on n.clinic_id = l.clinic_id and n.ativo
join public.whatsapp_account w on w.id = n.whatsapp_account_id and w.removido_em is null
where l.clinic_id = any (public.ia_clinicas_da_fase_controlada())
order by c.name, l.rotulo, w.nome;
```

Antes de escrever, cada linha do telefone novo tem de ter `conversa_nova_entra_na_ia` verdadeiro e `conversa_aberta_neste_numero` vazia; preenchida, a IA não começa nesse número até Assumir e Resolver (o link leva até a conversa). Em 19/10/2026: só a linha "Vinicius" da teste123, com `conversa_nova_entra_na_ia` falso e `e_numero_da_plataforma` verdadeiro.

**J. Os contadores que têm de ficar em zero** (as auditorias 1 a 6 numa linha)

```sql
select
  (select count(*) from public.conversation c
    where c.status = 'ia_atendendo' and c.awaiting_reply
      and c.last_inbound_at < now() - interval '3 minutes') as a1_esperando_mais_de_3min,
  (select count(*) from public.message m
     join public.conversation c on c.id = m.conversation_id
     join public.contact k on k.id = c.contact_id
    where m.author = 'ia' and m.job_id is not null
      and (not exists (select 1 from public.ia_contato_liberado l
                        where l.clinic_id = m.clinic_id and l.phone_key = k.phone_key)
           or not exists (select 1 from public.ia_numero_liberado n
                           where n.whatsapp_account_id = m.whatsapp_account_id))) as a2_ia_fora_da_lista,
  (select count(*) from public.message m
    where m.author = 'ia' and m.deleted_at is null and m.job_id is not null
      and not exists (select 1 from public.ai_decision_log d
                       where d.job_id = m.job_id and d.aprovado
                         and d.conversation_id = m.conversation_id
                         and d.texto_sha256 = encode(sha256(convert_to(m.body, 'UTF8')), 'hex'))) as a3_ia_sem_decisao,
  (select count(*) from public.message m join public.clinic c on c.id = m.clinic_id
    where m.author = 'ia' and not c.e_de_teste
      and m.clinic_id <> all (public.ia_clinicas_da_fase_controlada()))
  + (select count(*) from public.job_queue j join public.clinic c on c.id = j.clinic_id
    where j.kind = 'responder_com_ia' and not c.e_de_teste
      and j.clinic_id <> all (public.ia_clinicas_da_fase_controlada()))
  + (select count(*) from public.ia_uso u join public.clinic c on c.id = u.clinic_id
    where not c.e_de_teste and u.clinic_id <> all (public.ia_clinicas_da_fase_controlada()))
  + (select count(*) from public.ai_decision_log d join public.clinic c on c.id = d.clinic_id
    where not c.e_de_teste and d.clinic_id <> all (public.ia_clinicas_da_fase_controlada())) as a4_ia_fora_das_duas,
  (select count(*) from public.conversation c
     join public.contact k on k.id = c.contact_id
     left join public.ia_janela_da_conversa w on w.conversation_id = c.id
    where c.status = 'ia_atendendo'
      and (w.conversation_id is null or w.contact_id <> c.contact_id or w.phone_key <> k.phone_key)) as a5_janela_errada,
  (select count(*) from public.ia_contato_liberado l
    where l.forcado
      and not exists (select 1 from public.audit_log a
                       where a.clinic_id = l.clinic_id
                         and a.action = 'forcou_telefone_de_paciente_na_ia'
                         and a.entity_id = l.id))
  + (select count(*) from public.conversation c
       join public.contact k on k.id = c.contact_id
      where c.status = 'ia_atendendo'
        and c.updated_at < now() - interval '3 minutes'
        and public.contato_tem_sinal_de_paciente(c.clinic_id, k.phone_key)
        and not exists (select 1 from public.ia_contato_liberado l
                         where l.clinic_id = c.clinic_id and l.phone_key = k.phone_key
                           and l.ativo and l.forcado)) as a6_paciente;
```

Em 19/10/2026: tudo em zero. Qualquer coluna de `a2` a `a6` acima de zero: "Incidente: a IA falou com quem não devia", abaixo.

### Primeira semana e depois

```sql
-- Turnos por desfecho e motivo, últimas 24 horas
select d.clinic_id, d.desfecho, d.escalation_reason, d.compliance_rule, d.motivo_da_falha, count(*)
from public.ai_decision_log d
where d.created_at >= now() - interval '24 hours'
group by 1, 2, 3, 4, 5 order by 6 desc;

-- Gasto das últimas 24 horas por clínica, contra o teto (inclui reservas ainda não acertadas, como o teto conta)
select u.clinic_id,
       round(sum(u.custo_microdolar) / 1e6, 4) as gasto_usd,
       l.teto_diario_centavos_usd / 100.0 as teto_usd
from public.ia_uso u
join public.ia_liberacao l on l.clinic_id = u.clinic_id
where u.created_at >= now() - interval '24 hours'
group by u.clinic_id, l.teto_diario_centavos_usd;

-- Custo médio por resposta enviada e acerto do cache, últimos 7 dias (só WhatsApp)
select u.clinic_id,
       round(sum(u.custo_microdolar) filter (where not u.reserva) / 1e6
             / nullif((select count(*) from public.ai_decision_log d
                       where d.clinic_id = u.clinic_id and d.desfecho = 'respondeu'
                         and d.created_at >= now() - interval '7 days'), 0), 5) as usd_por_resposta,
       round(100.0 * sum(u.tokens_cache_lidos)
             / nullif(sum(u.tokens_entrada + u.tokens_cache_lidos + u.tokens_cache_gravados), 0), 1) as pct_cache
from public.ia_uso u
where u.origem = 'whatsapp' and u.created_at >= now() - interval '7 days'
group by u.clinic_id;

-- Latência do turno (p50 e p95), últimos 7 dias
select percentile_cont(0.5) within group (order by latency_ms) as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms
from public.ai_decision_log
where created_at >= now() - interval '7 days' and latency_ms is not null;
```

A revisão das conversas é pelo Atendimento, pelos links das consultas C, D e E, nunca exportando o texto. O chip "IA atendendo" só conta a conversa enquanto ela está na IA: depois de uma passagem, ela vai para "Aguardando você", no meio das outras, e o link é o jeito mais rápido de achá-la. O rascunho bloqueado, só o super admin abre ("Ver o que a IA ia responder", no cartão de bloqueio), e cada leitura fica na trilha (`leu_rascunho_bloqueado`); na Conduzza Teste, ninguém o abre nesta fase.

---

## Consultas de auditoria (os contadores que têm de ficar em zero)

Rodar no SQL editor, todo dia na primeira semana e depois de qualquer incidente. Todas devolvem só contagens. A consulta J faz as seis numa linha.

```sql
-- 1. Conversa da IA com o paciente esperando há mais de 3 minutos
--    (a varredura devolve; acima de zero por mais de uma passagem, o motor da IA não está dando conta)
select count(*) from public.conversation c
where c.status = 'ia_atendendo' and c.awaiting_reply
  and c.last_inbound_at < now() - interval '3 minutes';

-- 2. Mensagem da IA para telefone ou número fora da lista (em qualquer momento)
select count(*) from public.message m
join public.conversation c on c.id = m.conversation_id
join public.contact k on k.id = c.contact_id
where m.author = 'ia' and m.job_id is not null
  and (not exists (select 1 from public.ia_contato_liberado l
                   where l.clinic_id = m.clinic_id and l.phone_key = k.phone_key)
    or not exists (select 1 from public.ia_numero_liberado n
                   where n.whatsapp_account_id = m.whatsapp_account_id));

-- 3. Mensagem da IA sem decisão aprovada do mesmo job e do mesmo texto
--    (o gatilho de message exige ia_atendendo na hora do INSERT: zero aqui prova os dois)
select count(*) from public.message m
where m.author = 'ia' and m.deleted_at is null and m.job_id is not null
  and not exists (select 1 from public.ai_decision_log d
                  where d.job_id = m.job_id and d.aprovado
                    and d.conversation_id = m.conversation_id
                    and d.texto_sha256 = encode(sha256(convert_to(m.body, 'UTF8')), 'hex'));

-- 4. Qualquer coisa da IA fora das duas clínicas (inclui a salud-care), sem contar clínica de teste automático
select
  (select count(*) from public.message m join public.clinic c on c.id = m.clinic_id
    where m.author = 'ia' and not c.e_de_teste
      and m.clinic_id <> all (public.ia_clinicas_da_fase_controlada())) as mensagens,
  (select count(*) from public.job_queue j join public.clinic c on c.id = j.clinic_id
    where j.kind = 'responder_com_ia' and not c.e_de_teste
      and j.clinic_id <> all (public.ia_clinicas_da_fase_controlada())) as jobs,
  (select count(*) from public.ia_uso u join public.clinic c on c.id = u.clinic_id
    where not c.e_de_teste
      and u.clinic_id <> all (public.ia_clinicas_da_fase_controlada())) as uso,
  (select count(*) from public.ai_decision_log d join public.clinic c on c.id = d.clinic_id
    where not c.e_de_teste
      and d.clinic_id <> all (public.ia_clinicas_da_fase_controlada())) as decisoes;

-- 5. Conversa da IA cujo contato ou telefone não bate com a janela
select count(*) from public.conversation c
join public.contact k on k.id = c.contact_id
left join public.ia_janela_da_conversa w on w.conversation_id = c.id
where c.status = 'ia_atendendo'
  and (w.conversation_id is null or w.contact_id <> c.contact_id or w.phone_key <> k.phone_key);

-- 6. Sinal de paciente (decisao D-B da revisao de 13/10/2026). O telefone
--    ligado cujo contato VIROU paciente depois, sem o forcar, nao aciona mais
--    o assistente (a aba mostra "Nao aciona o assistente"); isso e normal.
--    Incidente e: (a) telefone forcado sem a trilha do forcar; (b) conversa
--    na IA de telefone com sinal de paciente sem o forcar ha mais de 3
--    minutos (a ingestao e a varredura de cada minuto a devolvem).
select
  (select count(*) from public.ia_contato_liberado l
    where l.forcado
      and not exists (select 1 from public.audit_log a
                      where a.clinic_id = l.clinic_id
                        and a.action = 'forcou_telefone_de_paciente_na_ia'
                        and a.entity_id = l.id)) as forcado_sem_trilha,
  (select count(*) from public.conversation c
     join public.contact k on k.id = c.contact_id
    where c.status = 'ia_atendendo'
      and c.updated_at < now() - interval '3 minutes'
      and public.contato_tem_sinal_de_paciente(c.clinic_id, k.phone_key)
      and not exists (select 1 from public.ia_contato_liberado l
                      where l.clinic_id = c.clinic_id and l.phone_key = k.phone_key
                        and l.ativo and l.forcado)) as paciente_na_ia;
```

Qualquer contador acima de zero nas consultas 2 a 6: siga "Incidente: a IA falou com quem não devia", abaixo.

---

## Incidentes

**A IA falou com quem não devia** (auditoria 2 a 6 acima de zero, ou alguém viu resposta da IA a paciente):

1. Desligue **tudo**: interruptor geral e `select public.motor_ia_desagendar();`.
2. Confira que zerou ("Desligar em segundos", "Conferir").
3. Avise o dono. Não apague nada: `ai_decision_log`, `ai_turno`, a janela e a trilha são a prova.
4. Ache o caminho pelo `job_id` da mensagem (sem copiar o texto): `select * from public.ai_decision_log where job_id = '<job_id>';` (não selecione `blocked_draft`), `select estado, saida, mensagens_lidas, created_at from public.ai_turno where job_id = '<job_id>';`, `select contact_id, desde, aberta_por from public.ia_janela_da_conversa where conversation_id = '<conversa>';`.
5. Se houve dado de paciente enviado à OpenAI ou mensagem da IA a paciente real, é incidente de dado pessoal: o dono decide a comunicação (LGPD, art. 48).
6. Só religa depois de corrigido, testado e com o ok do dono ("Religar").

**O celular de teste escreveu e nada aconteceu** (nenhum job na consulta F, nada no fio): o mais provável é conversa aberta com a equipe naquele número (consulta I, `conversa_aberta_neste_numero`): Assumir conversa e Resolver, e escrever de novo. Depois, telefone que não aciona (consulta I, `conversa_nova_entra_na_ia` falso) ou celular que é número conectado ao Conduzza (a IA nunca responde a ele, e de um número da clínica para outro da mesma clínica a mensagem nem é gravada).

**O monitor acusou `ia_parada`** ou a aba mostra o motor parado: para o super admin, "O motor do assistente não está rodando. Siga o diagnóstico rápido do motor-ia em supabase/operacao/motor-por-cron.md." (depois do deploy das correções de 19/10/2026; até lá, o mesmo texto dos outros); para quem não é super admin (o administrador e o gestor da clínica), "O motor do assistente não está rodando. Avise a equipe Conduzza.". Nos dois casos: `supabase/operacao/motor-por-cron.md`, "Resposta da IA no WhatsApp (motor-ia)", "Diagnóstico rápido". Enquanto isso, a varredura devolve para a equipe a conversa sem resposta em 3 minutos; se demorar, desligue a clínica para a equipe atender sem esperar.

**`ia_sem_resposta:<n>` no `planner_erro`:** `n` conversas voltaram para a equipe porque a IA não respondeu em 3 minutos. Mesmo diagnóstico do `ia_parada`.

**OpenAI fora, cota ou erro em série** (muitos `desfecho = 'falhou'` com `motivo_da_falha` de `timeout`, `conexao`, `limite`, `cota`, `sobrecarga`, `servidor`, `autenticacao`): cada turno falho passa a conversa para a equipe com a frase fixa (falha fechada). A tela só diz "o assistente teve uma falha técnica": a causa está na consulta D (`motivo_da_falha`) e na F (`last_error`). Não há desligamento automático nesta fase (D40): se repetir, desligue a clínica e confira a chave e o limite do projeto na OpenAI. `cota` não é repetido pelo cliente: só volta depois de ajustar o limite.

**Bloqueio de conformidade:** a resposta não sai, a conversa passa para a equipe com a frase fixa e o cartão "Resposta da IA bloqueada pela conformidade" aparece no fio. O super admin pode abrir o rascunho (registrado); na Conduzza Teste, ninguém o abre nesta fase. Bloqueio frequente com o mesmo `compliance_rule` vira ajuste da base ou das instruções na Tela 6, nunca afrouxar o filtro.

**"A IA pode não ter enviado a última resposta. A conversa voltou para a equipe."** (`envio_incerto`): o provedor não confirmou. A IA **não** reenvia. A equipe confere no celular se a mensagem chegou e responde se precisar.

**"O aviso automático ao contato não foi enviado."**: a conversa passou para a equipe, mas a frase fixa não saiu (canal ocupado ou falha). Nunca é tentada de novo: a equipe responde o contato.

**Número desconectado:** as conversas da IA naquele número voltam para a equipe ("o número do assistente está desconectado"); a IA não espera a reconexão. Reconectar na aba WhatsApp. Com outro número ligado e conectado, o assistente continua respondendo por ele: a aba fica em "Conversando com a equipe" e só a linha do número caído mostra o aviso. Com nenhum ligado conectado, a aba mostra "Ligado, mas parado" com o motivo de cada número, pelo nome, até reconectar.

**Teto de gasto atingido:** conversa nova do telefone da equipe nasce com a equipe (evento "parada"); a conversa que já estava na IA recebe a frase fixa e passa ("o limite de gasto de hoje acabou"). Volta sozinho quando o gasto mais antigo sai da janela de 24 horas. Mudar o teto é só com o ok do dono, pelo SQL editor, na clínica da lista: `update public.ia_liberacao set teto_diario_centavos_usd = <centavos> where clinic_id = '<id da clínica>';`.

**O contato recebeu duas respostas, a da IA e outra pelo celular:** alguém respondeu pelo aparelho até uns 8 segundos depois da mensagem, e o banco tomou a resposta por automática do app; a conversa continuou na IA. Avise quem atende o número ("Roteiro do primeiro teste", passo 6).

**Saiu da IA "por celular" sem ninguém ter respondido:** o eco da nossa própria resposta não foi reconhecido. Desde a revisão de 13/10/2026 o eco só é reconhecido pelo texto (o hash de uma resposta aprovada da conversa nos últimos 10 minutos, ou a frase fixa); se o provedor devolver o texto alterado, a conversa sai da IA (o lado seguro: qualquer outro texto pelo celular é de uma pessoa e sempre tira). Nada se perde: a equipe usa Devolver para a IA, se quiser continuar o teste. Se repetir, registre os ids da conversa e da mensagem para o desenvolvimento.

**Telefone do contato editado ou conversa trocada de contato:** a IA para e devolve ("o assistente deixou de estar liberado para este telefone ou este número"). É a trava funcionando.

**Job da IA preso:** o lease é de 90 s; o claim seguinte retoma ou enterra (`lease_expirado`) sozinho, e a varredura devolve a conversa. Para cancelar um pendente à mão (só pendente, nunca executando):

```sql
update public.job_queue set status = 'cancelado', last_error = 'cancelada_pela_operacao'
where id = '<job_id>' and kind = 'responder_com_ia' and status = 'pendente';
```

---

## Encerrar uma conversa da IA

Nesta fase a IA não resolve conversa sozinha e o botão Resolver não aparece para conversa da IA (D42): ele só aparece na conversa que está com você. Para encerrar: **Assumir conversa** e depois **Resolver**. Para a IA voltar a responder a mesma conversa: **Devolver para a IA** (só na conversa que está com você, sem pergunta do paciente pendente, de telefone liberado e que não é paciente, com o contato autorizado a receber mensagens e sem a conversa ter chegado ao teto de respostas da IA na última hora); a IA começa da próxima mensagem do contato, sem ler o que veio antes.

---

## Agenda pela IA (E4)

A IA marca consulta pelo WhatsApp: oferece até 3 horários livres da Agenda, reserva o escolhido por 10 minutos, pergunta "Confirma ...?" com dia, hora, profissional e procedimento e marca quando a pessoa confirma numa mensagem nova. A consulta nasce **pendente** e aparece em "Pendente de você", na Agenda, como "Marcada pela IA": a equipe aprova (liga a confirmação automática) ou recusa (a conversa volta para a equipe com "A equipe recusou a consulta marcada pela IA. Avise o paciente."). "Confirmar presença" confirma a consulta já marcada, quando há uma só aguardando confirmação. Remarcar, cancelar, lista de espera e encaixe continuam com a equipe. Decisões do dono de 20/10/2026 e pendências: `docs/05`, Fase 3, entrada "E4"; banco no `docs/04`, seção 21; motor no `docs/03`, seção 14, "A IA marca consulta".

**Publicação (20/10/2026, com o ok do dono):** (1) o ensaio `~/.claude/plans/e4-agenda/ensaio-20261020130000.sql` rodou na produção (`ENSAIO OK`, 88 chamadas conferidas, tudo desfeito no fim); (2) a migration `20261020130000_ia_agenda.sql` foi aplicada logo depois; (3) os tipos foram conferidos com os gerados (iguais em tudo o que a E4 criou) e as permissões, na produção (`reservar_horario_da_ia` e `agendar_pela_ia` só para `service_role`; `devolver_conversa_da_consulta_recusada` para `authenticated` e `service_role`; `conferir_horario_da_ia` para nenhum papel da API; `anon` em nenhuma delas); (4) `npm run test:rls -- tests/rls/ia-agenda.test.ts` (14 de 14) e `npm run test:integration -- tests/integration/ia-agenda-concorrencia.test.ts` (12 de 12) verdes, com as suítes que já existiam; (5) o código publicado no commit `0e66cb2` (deploy da Vercel concluído às 17h48 de Fortaleza). **Nunca o código antes da migration:** a Tela 6 e o turno da IA no WhatsApp leem as colunas novas, e a IA das duas clínicas pararia de responder. **Falta ligar numa clínica** ("Ligar numa das duas clínicas", abaixo): preencher os limites, ligar "Agendar consulta" e publicar uma versão nova. Em 20/10/2026, às 18h27, nenhuma das duas tinha ligado (a Conduzza Teste na versão 2 publicada, sem os limites).

**Conferir que a migration está no banco** (`true` nas cinco):

```sql
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'ai_agent_config'
             and column_name = 'agenda_horizonte_dias') as limites_na_config,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'slot_hold'
             and column_name = 'job_id_do_agendar') as reserva_da_ia,
  to_regprocedure('public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid)') is not null as reservar,
  to_regprocedure('public.agendar_pela_ia(uuid, uuid, uuid)') is not null as agendar,
  to_regprocedure('public.devolver_conversa_da_consulta_recusada(uuid, uuid)') is not null as devolver;
```

### Antes de ligar: o telefone de teste precisa ser forçado

**Decisão do dono de 20/10/2026: nesta fase de teste, a agenda pela IA ("Agendar consulta" e "Confirmar presença") é só com telefone forçado pela equipe Conduzza** (a Tela 6 mostra a nota embaixo das duas habilidades; a migration em que a consulta pendente não converte o lead é pré-requisito para pacientes reais: `docs/05`, entrada "E4", decisão 6). O motivo: a consulta que a IA marca faz o contato virar paciente, e a trava do E3 (decisão D-B de 13/10/2026) tira da IA o telefone da equipe que **não** foi forçado pela equipe Conduzza. Com telefone não forçado, depois do "sim" a consulta fica marcada, mas a resposta não sai, a conversa volta para a equipe sem a frase fixa ("A IA passou a conversa para a equipe: o assistente deixou de estar liberado para este telefone ou este número.") e o telefone passa a "Não aciona o assistente" para sempre, mesmo se a equipe recusar a consulta. "Confirmar presença" só funciona com telefone forçado. Por isso:

- **Conduzza Teste:** testar só com a linha "Victor" (`d07b3a0b-fa28-420b-94c7-ce84b8365dfc`), que já é `forcado` (a consulta I mostra `forcado` verdadeiro).
- **teste123:** **não** ligar "Agendar consulta" (em 19/10/2026, o único telefone de lá era o próprio final 1318, que nunca aciona o assistente; um telefone de teste novo, sem o forçar, cairia na trava depois da primeira consulta). Forçar um telefone é só com o ok do dono, pela equipe Conduzza.

### Ligar numa das duas clínicas

Na Conduzza Teste quem faz é o administrador de lá (o dono não é membro); na teste123, o dono. Valores e dados são do dono: ninguém inventa.

1. **Cadastro** (Cadastros): pelo menos um profissional ativo com **horário de atendimento** e um procedimento ativo com **"IA pode agendar"** marcado (a chave do procedimento, que os vínculos seguem), com esse profissional em "Quem faz e convênios" e a duração; o preço particular, para a IA dizer o valor quando o convênio não é atendido; os convênios que cada profissional atende, se o teste for passar por convênio. A consulta K mostra o que a IA enxerga.
2. **Tela 6, Regras e limites, "Limites para marcar consulta":** preencher "Antecedência mínima para marcar (horas)" (0 a 720) e "Até quantos dias à frente" (1 a 365) e "Salvar limites". Com um dos dois vazio, "Agendar consulta" não liga.
3. **Tela 6, Habilidades:** ligar "Agendar consulta" (e, se o dono quiser, "Confirmar presença"). Sem os limites, a chave fica desabilitada com "Preencha a antecedência e o horizonte em Regras e limites.".
4. **Simular** (simulador da Tela 6, cenário "Paciente querendo agendar"): a busca lê a Agenda de verdade e reservar e marcar **não gravam nada** ("No simulador, nada foi gravado." na trilha). Em "Por que a IA respondeu isso", conferir "Consultou a agenda de ...: encontrou ..." com horários dentro da jornada, depois da antecedência e antes do horizonte. Cada rodada conta no teto de gasto. **Só siga se os horários fizerem sentido.**
5. **Publicar alterações:** o WhatsApp usa só a versão publicada. A lista tem de trazer "Agendar consulta: ligada", "Antecedência mínima para marcar: N horas" e "Até quantos dias à frente: N dias".
6. **Conferir** a consulta K (`agendar_ligada` verdadeiro, os dois limites preenchidos, vínculos e profissionais com jornada acima de zero) e a consulta I (o telefone de teste com `conversa_nova_entra_na_ia` e `forcado` verdadeiros).
7. **O teste com o celular** (o do Victor, na Conduzza Teste), uma mensagem por vez, esperando até 1 minuto: pedir para marcar um procedimento; escolher um dos horários oferecidos; a IA reserva (o bloco "Reservado pela IA" aparece na Agenda) e pergunta "Confirma ...?"; responder "sim"; a IA diz que a consulta ficou marcada, pendente da aprovação da equipe, e que a confirmação chega por aqui; no fio, o evento "A IA marcou ..., pendente de aprovação da equipe."; na Agenda, a consulta em "Pendente de você" como "Marcada pela IA" (painel a partir de 1280px de largura; abaixo disso, pelo menu da consulta). Depois, **Aprovar** (a confirmação automática passa a valer) ou **Recusar** (a conversa volta para "Aguardando você" com o evento; avisar o paciente pelo Atendimento). Também vale testar: o convênio que o profissional não atende (a IA oferece o particular), demorar mais de 10 minutos para confirmar (a IA busca de novo) e pedir para remarcar ou cancelar (passa para a equipe).

### Acompanhar: consultas K a N

Rodar no SQL editor. Nenhuma escreve e nenhuma devolve nome, telefone nem texto de mensagem. Os eventos novos ("A IA marcou ..." e "A equipe recusou ...") aparecem na consulta E como `outro_evento`.

**K. A agenda da IA em cada clínica** (o que a versão publicada liga e o que a IA enxerga no Cadastro)

```sql
select c.name as clinica,
       v.version as versao_publicada,
       (v.skills ->> 'agendar') = 'true' as agendar_ligada,
       (v.skills ->> 'confirmar_presenca') = 'true' as confirmar_ligada,
       v.agenda_antecedencia_horas as antecedencia_horas,
       v.agenda_horizonte_dias as horizonte_dias,
       (select count(*) from public.service_link sl
          join public.procedure pr on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
          join public.professional pf on pf.id = sl.professional_id and pf.clinic_id = sl.clinic_id
         where sl.clinic_id = c.id and sl.active and sl.bookable_by_ai
           and pr.active and pr.bookable_by_ai and pf.active) as vinculos_que_a_ia_marca,
       (select count(distinct s.professional_id) from public.professional_schedule s
          join public.professional pf on pf.id = s.professional_id and pf.clinic_id = s.clinic_id
         where s.clinic_id = c.id and pf.active) as profissionais_com_jornada
from public.clinic c
left join lateral (
  select a.version, a.skills, a.agenda_antecedencia_horas, a.agenda_horizonte_dias
    from public.ai_agent_config a
   where a.clinic_id = c.id and a.status = 'publicada'
   order by a.version desc
   limit 1) v on true
where c.id = any (public.ia_clinicas_da_fase_controlada())
order by c.name;
```

`agendar_ligada` verdadeiro com um limite nulo não marca nada (o banco diz `agenda_nao_configurada` e a IA passa para a equipe).

**L. Reservas da IA nas últimas 24 horas** (e no que viraram)

```sql
select c.name as clinica,
       to_char(h.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI:SS') as reservou_em,
       to_char(h.starts_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') as horario,
       case when h.consumido_em is not null then 'virou consulta'
            when h.expires_at > now() then 'viva'
            else 'vencida' end as reserva,
       a.status as consulta, a.approval_status as aprovacao,
       'https://conduzza.vercel.app/atendimento?conversa=' || h.conversation_id as link
from public.slot_hold h
join public.clinic c on c.id = h.clinic_id
left join public.appointment a on a.id = h.appointment_id
where h.clinic_id = any (public.ia_clinicas_da_fase_controlada())
  and h.created_by = 'ia'
  and h.created_at >= now() - interval '24 hours'
order by h.created_at desc;
```

A reserva vencida não consumida sai sozinha na manutenção do motor (a cada minuto); a que virou consulta fica (é o elo com a conversa). Mais de uma reserva `viva` na mesma conversa não pode existir: se aparecer, desligue a agenda ("Desligar a agenda", abaixo) e avise o desenvolvimento.

**M. Consultas que a IA marcou** (últimos 7 dias)

```sql
select c.name as clinica,
       to_char(a.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') as marcada_em,
       to_char(a.starts_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') as horario,
       a.status, a.approval_status as aprovacao,
       a.send_confirmation as confirmacao_automatica,
       a.oferecer_vaga_ao_cancelar as oferece_a_vaga
from public.appointment a
join public.clinic c on c.id = a.clinic_id
where a.clinic_id = any (public.ia_clinicas_da_fase_controlada())
  and a.created_by = 'ia' and not a.is_overbooking
  and a.created_at >= now() - interval '7 days'
order by a.created_at desc;
```

Como ler: `pendente` com `confirmacao_automatica` falso é o normal até a equipe decidir; `aprovado` tem de ter `confirmacao_automatica` e `oferece_a_vaga` verdadeiros; `recusado` vem com `cancelado_clinica` e `oferece_a_vaga` falso. Uma `pendente` que ninguém aprova nem recusa não recebe a régua de confirmação: cobrar a equipe.

**N. Turnos de agenda** (a ferramenta que mais pesou em cada turno)

```sql
select to_char(d.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI:SS') as quando,
       c.name as clinica,
       d.tool_used,          -- agendar | confirmar_presenca | reservar_horario | buscar_horario
       d.desfecho, d.escalation_reason, d.motivo_da_falha, d.latency_ms,
       'https://conduzza.vercel.app/atendimento?conversa=' || d.conversation_id as link
from public.ai_decision_log d
join public.clinic c on c.id = d.clinic_id
where d.clinic_id = any (public.ia_clinicas_da_fase_controlada())
  and d.tool_used in ('buscar_horario', 'reservar_horario', 'agendar', 'confirmar_presenca')
  and d.created_at >= now() - interval '24 hours'
order by d.created_at desc;
```

Como ler: `desfecho` `falhou` com `motivo_da_falha` `desconhecida` num turno de agenda é leitura da agenda ou RPC que falhou (falha fechada: a frase fixa e a equipe); `liberacao_suspensa` logo depois de um `agendar` é a trava do ponto 1 (telefone não forçado). Turno de agenda perto de 45 s (`latency_ms`) é o risco de prazo: anotar para a simulação paga.

### Desligar a agenda (sem desligar a IA)

- **Pela Tela 6** (administrador ou gestor da clínica; na Conduzza Teste, o administrador de lá): desligar "Agendar consulta" (e "Confirmar presença") e **Publicar alterações**. Salvar no rascunho não basta: o WhatsApp e o banco olham a versão publicada. Depois de publicar, a IA passa para a equipe quem pedir para marcar, e as RPCs recusam com `agenda_nao_configurada` qualquer reserva ou marcação.
- **Pelo SQL editor não há receita só da agenda:** a versão publicada é imutável (P0001), e não se mexe em `ai_agent_config`, `slot_hold` nem `appointment` à mão. Para parar já, sem esperar a tela: desligar a clínica inteira ("Desligar em segundos").
- **O que fica:** as reservas vivas vencem sozinhas em até 10 minutos; as consultas pendentes continuam em "Pendente de você" para a equipe aprovar ou recusar (recusar devolve a conversa, com o evento).

**Rollback da E4:** primeiro voltar o código; depois `supabase/operacao/rollback/20261020130000-corpos-anteriores.sql` inteiro, numa transação, em horário calmo (`docs/04`, seção 21.10). As consultas que a IA marcou ficam.

---

## Como foi ligado (referência para ligar do zero)

Para ligar de novo depois de um rollback ou de um desligamento total: cada passo com o ok do dono, por id, e só depois do anterior conferido. A ordem segura deixa o interruptor geral por último (D33); em 19/10/2026 o dono ligou o interruptor antes do telefone.

**No banco e no código (feitos):**

1. Corpos anteriores salvos em `supabase/operacao/rollback/20261013100000-corpos-anteriores.sql` (M1) e `20261013120000-corpos-anteriores.sql` (M2); o `20261013110000-corpos-anteriores.sql` (M3) só desfaz os dois gatilhos.
2. M1, M3 e M2 ensaiadas e aplicadas em 13/10/2026, uma de cada vez (`docs/04`, 17.13).
3. Tipos gerados (`supabase gen types typescript --project-id imizkroxevcawomvgrbn`) e comparados com os escritos à mão.
4. Código publicado na Vercel (`1c36327`, `24058b1` e `a87e01e`).
5. RLS, integração e e2e do E3 verdes contra o banco em 13/10/2026. Os testes de RLS e de integração das duas mudanças de 19/10/2026 estão escritos e ainda não rodaram.
6. **Telefone pelo administrador:** o ensaio `~/.claude/plans/e3-whatsapp/ensaios/ensaio-m4-20261019100000.sql` ('ENSAIO OK'), a migration `20261019100000_ia_telefone_pelo_administrador.sql` (sem trava de tabela), aplicada em 19/10/2026, e só depois o código da aba que habilita "Adicionar" e "Ligar de novo" para o administrador. Corpo anterior em `supabase/operacao/rollback/20261019100000-corpos-anteriores.sql`. Conferido em 19/10/2026: md5 do corpo de `definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean)`, a de cinco parâmetros, igual a `277d6a2d9d9570d053cc0f5babf2c464`. A migration `20261019120000` (passo 8) apaga essa assinatura e cria a de seis: depois dela, a conferência é a do passo 8.
7. **Vários números:** o ensaio `~/.claude/plans/e3-whatsapp/ensaios/ensaio-m5-20261019110000.sql` ('ENSAIO OK'; recusa se o corpo ou o comentário de `definir_numero_da_ia` mudou desde a leitura), a migration `20261019110000_ia_varios_numeros.sql` (sem trava de tabela), aplicada em 19/10/2026, e só depois o código da aba "Números do assistente" (com o código antigo, "Usar este número" passaria a somar o número em vez de trocar, e o cartão antigo mostraria só um deles). Corpo e comentário anteriores em `supabase/operacao/rollback/20261019110000-corpos-anteriores.sql`. Conferido em 19/10/2026 (`true` e `true`):

   ```sql
   select md5(prosrc) = 'd9652bcf92f369fd9c84f7578690b6ac' as varios_numeros,
          md5(obj_description(oid, 'pg_proc')) = '06f03c959ff4426654aaf9b3bccd4e11' as comentario
   from pg_proc
   where oid = 'public.definir_numero_da_ia(uuid, uuid, boolean)'::regprocedure;
   ```

**No banco e no código (construídos, NÃO aplicados nem publicados):**

8. **Ajustes da revisão de produção de 19/10/2026:** o ensaio `~/.claude/plans/e3-whatsapp/ensaios/ensaio-m6-20261019120000.sql` ('ENSAIO OK'; recusa se algum dos quatro corpos de produção mudou desde a leitura), a migration `20261019120000_ia_ajustes_do_teste.sql` (só funções, sem trava de tabela, só com o ok do dono) e só depois o código: com o código novo antes da migration, a aba mostra o erro de leitura e adicionar telefone falha. Quatro funções: `situacao_da_ia_na_clinica` (a chave nova `conversas_abertas`), `definir_contato_liberado_da_ia` (assinatura nova, com `p_confirmou_aviso_da_openai`), `ia_devolver_disponivel` (a pergunta pendente depois da liberação) e `rotulo_do_motivo_da_ia` (o texto novo de `parada`). Corpos anteriores em `supabase/operacao/rollback/20261019120000-corpos-anteriores.sql`. **Estes md5 valem depois de aplicar a `20261019120000`** (antes dela, as colunas voltam falsas, e a da assinatura nova, nula); conferir (`true` nas cinco):

   ```sql
   select
     (select md5(prosrc) = 'e3511c98e850a1c864583bb7a18d810c' from pg_proc
       where oid = to_regprocedure('public.situacao_da_ia_na_clinica(uuid)')) as conversas_abertas,
     (select md5(prosrc) = 'fb255417969a243fb52b8c1ec81dec33'
             and md5(obj_description(oid, 'pg_proc')) = 'a1750ae97cad6839e7dad8c4ef28539a'
        from pg_proc
       where oid = to_regprocedure('public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean)')) as aviso_da_openai_no_banco,
     (select md5(prosrc) = 'faa9933cb6dfd6375e33d2ba22d7f6bc' from pg_proc
       where oid = to_regprocedure('public.ia_devolver_disponivel(uuid)')) as devolver,
     (select md5(prosrc) = 'ffb97d9cafc2f4762ba7360d3ad3e938' from pg_proc
       where oid = to_regprocedure('public.rotulo_do_motivo_da_ia(text)')) as parada_neutra,
     to_regprocedure('public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean)') is null
       as assinatura_antiga_saiu;
   ```

Conferir que as três migrations do E3 estão no banco:

```sql
select
  to_regclass('public.ai_turno') is not null as m1_tabelas,
  exists (select 1 from pg_trigger where tgname = 'mensagem_ia_exige_aprovacao_ins') as m3_gatilho,
  exists (select 1 from pg_proc where proname = 'ia_pode_falar_com') as m1_funcoes,
  exists (select 1 from information_schema.columns
          where table_name = 'ia_contato_liberado' and column_name = 'forcado') as m1_forcado,
  exists (select 1 from pg_proc
          where proname = 'ingest_inbound_message' and prosrc like '%v_candidata%') as m2_ingestao;
```

**Na Vercel, só em Production:** `OPENAI_API_KEY` (projeto `producao-agente` da OpenAI), `IA_SEGREDO_DO_IDENTIFICADOR` (32 caracteres ou mais) e `MOTOR_TICK_SECRET` (o mesmo de hoje; a IA reaproveita). Segundo o dono, cadastrados em 19/10/2026, com redeploy.

**Do dono:**

- **D1 (pendente):** o celular de teste, que não pode ser número conectado ao Conduzza ("Roteiro do primeiro teste", passo 1).
- **D5:** a frase fixa, aprovada em 19/10/2026 ("Estado em 19/10/2026").
- **D32:** o aviso por escrito a quem usa o celular de teste: o que escrever vai para a OpenAI, nos EUA, e só dados de teste. O formulário do telefone pede a confirmação sempre, e ela vai para a trilha.
- **D34:** a rodada paga de aceite do filtro do CFM. Dispensada pelo dono em 19/10/2026 para esta fase (só telefones da equipe); **obrigatória antes de qualquer paciente.**
- Os dados de "Dados do dono para o teste valer".

**A operação, na ordem segura** (o estado de 19/10/2026 em cada passo):

1. **Publicar a versão do assistente** (Tela 6, por administrador, gestor ou super admin). Modo de horário **24 horas** ou **Só fora do expediente** ("Se a equipe não responder" ainda não funciona no WhatsApp: a conversa passaria para a equipe). Em 19/10/2026: a versão 1, padrão, publicada às 09:08 nas duas.
2. **Telefones da equipe** (o administrador da clínica): "Roteiro do primeiro teste", passos 1 a 3. Em 19/10/2026: pendente. O dono não cadastra telefone na Conduzza Teste (decisão de 19/10/2026: ele não é membro de lá, e quem cadastra é o administrador de lá, pela aba). A confirmação do aviso da OpenAI vai para a trilha (`confirmou_aviso_da_openai`) no nome de quem adiciona: hoje a action grava, pela sessão de quem é membro ativo da clínica; depois da migration `20261019120000`, quem grava é a própria `definir_contato_liberado_da_ia`, na mesma transação, e o banco recusa telefone novo sem a confirmação.
3. **Ligar os números e o modo** (equipe Conduzza): na aba, "Ligar" em cada número do cartão "Números do assistente" (um não desliga o outro) e depois "Conversar com a equipe"; pelo SQL editor, as receitas de "Religar". A aba mostra "Ligado, mas parado" com os motivos que ainda faltam: é o esperado neste passo. Em 19/10/2026: o modo nas duas às 09:08; o final 1318 (`2067be80`) e o final 9018 (`d73d3e43`) às 09:08; o final 0914 (`35fa44ef`) às 12:15.
4. **Agendar o motor da IA** (SQL editor). Agendar é inerte enquanto não houver resposta devida: a guarda não chama a Vercel. Em 19/10/2026: agendado.

   ```sql
   select decrypted_secret ~ '/api/webhooks/motor$' as url_ok
   from vault.decrypted_secrets where name = 'motor_tick_url';
   -- url_ok tem de ser verdadeiro; senão, pare e corrija a URL

   select public.motor_ia_agendar();
   -- 'motor-ia (10s) agendado'
   ```

5. **Ligar o interruptor geral** (super admin, aba Agente de IA, cartão "Interruptor geral", ou `select public.definir_interruptor_da_ia(true, 'motivo curto');`). Isso também libera o simulador. Em 19/10/2026: às 09:12, antes do passo 2.
6. **Conferir:** a aba de cada clínica em "Conversando com a equipe", **sem nenhum motivo** de parada (na Conduzza Teste, quem vê é o administrador de lá; o dono confere pela consulta A); a consulta I com `conversa_nova_entra_na_ia` verdadeiro e sem conversa aberta; a consulta B com `agendado` e `vigiado` verdadeiros, `devidos` 0 e `alerta` falso (pelo SQL editor, que é o servidor: pela sessão de quem não é super admin, a chave `ia` vem nula); a Tela 6 mostrando "Em uso no WhatsApp".
7. **O primeiro teste:** "Roteiro do primeiro teste".

---

## Rollback

Na ordem. Detalhe e lista exata de objetos no `docs/04`, 17.13, "Rollback".

**Só a agenda pela IA (migration `20261020130000`, depois de aplicada; sem desfazer o E3):** primeiro voltar o código para o de antes da E4 (o novo lê e grava as colunas da agenda e chama as três RPCs); depois rodar `supabase/operacao/rollback/20261020130000-corpos-anteriores.sql` inteiro, numa transação, no SQL editor, em horário calmo (`lock_timeout` de 3 s; ACCESS EXCLUSIVE em `ai_agent_config` e `slot_hold`), e conferir os quatro md5 do cabeçalho do arquivo, nenhuma das quatro funções novas e nenhuma das oito colunas novas. As consultas que a IA marcou ficam; os limites preenchidos se perdem. Detalhe no `docs/04`, 21.10. Se o E3 também for desfeito, este vem antes.

**Só os ajustes da revisão de produção (migration `20261019120000`, depois de aplicada):** primeiro voltar o código para o de antes das correções (o novo lê a chave `conversas_abertas` como obrigatória e chama `definir_contato_liberado_da_ia` com `p_confirmou_aviso_da_openai`); depois rodar `supabase/operacao/rollback/20261019120000-corpos-anteriores.sql` inteiro no SQL editor (sem trava de tabela: apaga a função de seis parâmetros, recria a de cinco com os grants de hoje e devolve às outras três o corpo de antes) e conferir os quatro md5 do cabeçalho do arquivo. As linhas de telefone e as trilhas gravadas no meio continuam válidas. Com a migration aplicada, este rollback vem **antes** de qualquer outro deste bloco: o corpo do rollback do telefone pelo administrador recria a função de cinco parâmetros, e com a de seis ainda no banco ficariam as duas.

**Só os vários números (migration `20261019110000`, sem desfazer o E3):** primeiro desligar pela aba ("Desligar" em "Números do assistente") ou pela RPC os números que sobrarem, deixando **um só** ligado por clínica (na Conduzza Teste, hoje, um dos dois; o corpo antigo só mexe nos outros ao ligar: os que ficaram ligados juntos continuam ligados, e a IA continua respondendo por todos). Conferir: `select clinic_id, count(*) filter (where ativo) as ligados from public.ia_numero_liberado group by clinic_id;` (nenhuma com mais de um). Depois reaplicar o corpo e o comentário de `supabase/operacao/rollback/20261019110000-corpos-anteriores.sql` (sem trava de tabela) e voltar o código da aba. O código novo sem a migration: ligar um segundo número desligaria o primeiro na mesma operação (o banco de antes), e a aba mostraria isso depois de recarregar; nada se perde.

**Só o telefone pelo administrador (migration `20261019100000`, sem desfazer o E3):** reaplicar o corpo de `supabase/operacao/rollback/20261019100000-corpos-anteriores.sql` (sem trava de tabela); ligar telefone volta a ser só da equipe Conduzza. Os telefones que o administrador ligou continuam ligados: desligar pela aba se o dono quiser. O código novo sem a migration mostra o texto de permissão ao administrador que tenta ligar; nada é gravado. Para desfazer o E3 inteiro, este passo não é preciso: o passo 6 apaga a função de cinco argumentos de qualquer jeito.

1. Desligar tudo ("Desligar em segundos": interruptor geral) e `select public.motor_ia_desagendar();`.
2. Conferir zero conversas na IA e zero `responder_com_ia` pendentes ou executando; cancelar os pendentes que sobrarem.
3. Reverter o deploy na Vercel para o código anterior ao E3.
4. **M2:** repor os dois corpos de `supabase/operacao/rollback/20261013120000-corpos-anteriores.sql` (`ingest_inbound_message` e `registrar_mensagem_do_celular`).
5. **M3:** `supabase/operacao/rollback/20261013110000-corpos-anteriores.sql` (`drop trigger mensagem_ia_exige_aprovacao_ins` e `mensagem_ia_exige_aprovacao_upd` em `public.message`, com `lock_timeout` de 3 s, em horário calmo).
6. **M1:** repor as funções de `supabase/operacao/rollback/20261013100000-corpos-anteriores.sql` (inclusive `definir_contato_liberado_da_ia` com a assinatura antiga, depois de apagar a nova), apagar as funções novas (a lista completa está no cabeçalho da M1, passo 5, com `ia_jobs_devidos` e `ia_estado_do_motor`), o índice e o CHECK de payload da fila, as linhas do kind, voltar o CHECK do kind **com** `enviar_mensagem_agendada`, apagar as três tabelas novas, o gatilho e a função `ia_contato_liberado_forcado_so_pela_funcao` e a coluna `ia_contato_liberado.forcado`, e desfazer as mudanças em `ai_decision_log` (CHECK, colunas e o grant de SELECT de tabela). O harness local do E3 aplica essa sequência inteira sobre as três migrations.
7. Regenerar os tipos e anotar no `docs/05`.
