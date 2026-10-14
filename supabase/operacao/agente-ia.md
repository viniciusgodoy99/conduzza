# Agente de IA no WhatsApp (E3): operação

Como ligar a IA no WhatsApp na teste123, como desligar em segundos, o que conferir todo dia, o que fazer em cada incidente e como voltar atrás.

Construído em 13/10/2026 (plano aprovado pelo dono em 13/10, "pode"). **As migrations ainda não estão aplicadas** (M1 `20261013100000_ia_whatsapp_fila.sql`, M3 `20261013110000_ia_whatsapp_gatilho_mensagem.sql`, M2 `20261013120000_ia_whatsapp_funcoes_quentes.sql`, nessa ordem). Contrato do banco no `docs/04`, 17.13; turno e travas no `docs/03`, seção 14; estado e decisões no `docs/05`, Fase 3, entrada "E3"; o motor da IA em `supabase/operacao/motor-por-cron.md`, "Resposta da IA no WhatsApp (motor-ia)".

---

## Regras que valem em todo passo

- A IA existe **só** na **teste123** (`acd9c539-585e-4f2a-a195-712c70099564`) e na **Conduzza Teste** (`f0c115dd-e98c-4767-a1bb-93d517844852`). Selecione **sempre por id**, nunca por nome: existe outra clínica chamada "Conduzza Teste" (`e2d2e43f`), mais "Clinica conduzza teste" (`6180eafd`) e "Vinicius teste" (`628d92b7`), todas fora da lista.
- A salud-care e qualquer outra clínica, **nunca**. Nenhum comando deste arquivo escreve em outra clínica.
- A IA conversa só com os **telefones da equipe** ligados na aba Agente de IA. Paciente nenhum.
- **Nunca imprima telefone** no SQL editor, em chat, ticket ou print: as consultas abaixo devolvem contagens, ids e o rótulo do telefone ("De quem é").
- **Nunca copie texto de conversa nem o rascunho bloqueado** para fora do sistema (chat, ticket, log, planilha). Conversa de paciente é dado de saúde (LGPD, art. 5º, II).
- Ligar é **só da equipe Conduzza** (super admin) nesta fase. Desligar, qualquer administrador da clínica também pode, e deve, em caso de dúvida.
- Nenhum comando aqui levanta 40001 ou 40P01. Não rode `update` direto em `conversation.status`, `ai_turno`, `ia_janela_da_conversa` nem `job_queue` fora do que este arquivo manda.

---

## Antes de ligar: o que precisa estar pronto

**No banco e no código** (cada passo só com o ok do dono):

1. Corpos anteriores salvos em `supabase/operacao/rollback/20261013100000-corpos-anteriores.sql` (M1) e `20261013120000-corpos-anteriores.sql` (M2); o `20261013110000-corpos-anteriores.sql` (M3) só desfaz os dois gatilhos.
2. M1, M3 e M2 ensaiadas e aplicadas, uma de cada vez, de madrugada ou em horário calmo (`docs/04`, 17.13).
3. Tipos gerados (`supabase gen types typescript --project-id imizkroxevcawomvgrbn`) e comparados com os escritos à mão.
4. Código publicado na Vercel (inerte até a operação).
5. RLS, integração e e2e do E3 verdes contra o banco.

Conferir que as três migrations estão no banco:

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

**Na Vercel, só em Production:** `OPENAI_API_KEY` (projeto `producao-agente` da OpenAI), `IA_SEGREDO_DO_IDENTIFICADOR` (32 caracteres ou mais) e `MOTOR_TICK_SECRET` (o mesmo de hoje; a IA reaproveita).

**Do dono (bloqueiam o ligar):**

- **D1:** o celular de teste, que não pode ser o número da clínica.
- **D5:** a frase fixa aprovada por escrito. Hoje é provisória: "Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível." Se o texto mudar, ele muda no código (`lib/domain/conformidade/frase-fixa.ts`) e no banco (`frase_de_escalonamento_da_ia()`) na mesma leva.
- **D32:** o aviso por escrito a quem usa o celular de teste: o que escrever vai para a OpenAI, nos EUA, e só dados de teste.
- **D34:** a rodada paga de aceite do filtro do CFM, salvo dispensa por escrito.
- Também: a confirmação das ids (D38) e o interruptor geral só no passo 6 abaixo (D33).

---

## Ligar na teste123

Na ordem. Cada passo só depois do anterior conferido.

1. **Publicar a primeira versão do assistente** (Tela 6 da teste123, por administrador, gestor ou super admin). Modo de horário **24 horas** ou **Só fora do expediente** ("Se a equipe não responder" ainda não funciona no WhatsApp: a conversa passaria para a equipe).

2. **Trocar o telefone da equipe** (super admin, aba Agente de IA da teste123):
   - desligar o telefone cadastrado hoje: é o número da própria clínica e aparece como "Não aciona o assistente";
   - adicionar o celular de quem vai testar, com "De quem é" e marcando a confirmação "Quem usa este celular sabe que o que escrever vai para a OpenAI, nos EUA, e vai usar só dados de teste." (vai para a trilha);
   - se a aba recusar com "Este telefone é de um paciente da clínica...", **pare** e fale com o dono. "Usar mesmo assim (fica registrado)" só com o ok dele, e fica na trilha.

3. **Conferir conversa aberta** do celular de teste no número que será escolhido. Conversa aberta com a equipe não passa para a IA; a IA começa na próxima conversa nova.

   ```sql
   select l.rotulo, c.id as conversa, c.status
   from public.ia_contato_liberado l
   join public.contact k on k.clinic_id = l.clinic_id and k.phone_key = l.phone_key
   join public.conversation c on c.contact_id = k.id
   where l.clinic_id = 'acd9c539-585e-4f2a-a195-712c70099564'
     and l.ativo
     and c.whatsapp_account_id = '2067be80-aabe-40c8-adc3-da78937b15aa'
     and c.status in ('aguardando_humano', 'em_atendimento');
   ```

   Com alguma linha: no Atendimento, **Assumir** e **Resolver** essa conversa.

4. **Escolher o número e o modo** (super admin, na aba): "Usar este número" no `2067be80` e depois "Conversar com a equipe". A aba vai mostrar "Ligado, mas parado" com os motivos que ainda faltam (interruptor, motor): é o esperado neste passo.

5. **Agendar o motor da IA** (SQL editor):

   ```sql
   select decrypted_secret ~ '/api/webhooks/motor$' as url_ok
   from vault.decrypted_secrets where name = 'motor_tick_url';
   -- url_ok tem de ser verdadeiro; senão, pare e corrija a URL

   select public.motor_ia_agendar();
   -- 'motor-ia (10s) agendado'
   ```

   Agendar é inerte enquanto não houver resposta devida: a guarda não chama a Vercel.

6. **Ligar o interruptor geral** (super admin, aba Agente de IA, cartão "Interruptor geral"). Isso também libera o simulador da teste123. A **Conduzza Teste continua parada**: só a equipe Conduzza a liga, e ela não tem modo, número nem telefone ligados.

7. **Conferir:**
   - a aba da teste123 em "Conversando com a equipe", **sem nenhum motivo** de parada;
   - a decisão do banco, sem digitar nem imprimir o telefone:

     ```sql
     select l.rotulo,
            public.ia_atende_no_whatsapp(l.clinic_id, n.whatsapp_account_id, l.phone_key) as atende
     from public.ia_contato_liberado l
     join public.ia_numero_liberado n on n.clinic_id = l.clinic_id and n.ativo
     where l.clinic_id = 'acd9c539-585e-4f2a-a195-712c70099564' and l.ativo;
     -- atende = true
     ```

   - a saúde do motor: `select saude_do_motor() -> 'ia';` (no SQL editor, que é o servidor; pela sessão de quem não é super admin a chave vem nula desde a revisão de 13/10/2026) com `agendado` e `vigiado` verdadeiros, `devidos` 0 e `alerta` falso; e a aba sem o motivo "motor parado" (`situacao_da_ia_na_clinica(...) ->> 'motor_parado'` falso);
   - a Tela 6 mostrando "Em uso no WhatsApp".

8. **Verificação final com o celular de teste:**
   1. Preço: a IA responde com o valor do Cadastro, no WhatsApp e no Atendimento (bolha com o selo "IA").
   2. Convênio: resposta pelo Cadastro.
   3. Sintoma: chega a frase fixa; no fio, "A IA passou a conversa para a equipe: o paciente descreveu um sintoma."; a conversa em "Aguardando você".
   4. Devolver para a IA e mandar mensagem nova: a IA volta a responder, sem citar o que veio antes do Devolver.
   5. Assumir enquanto a IA pensa: nada sai da IA.
   6. Responder pelo celular conectado: a conversa sai da IA, com "Alguém respondeu pelo celular. A IA parou de responder nesta conversa.".
   7. Outro celular, fora da lista, escrevendo para o mesmo número: só a equipe vê; a IA não responde.
   8. Desligar (abaixo): em segundos nada mais responde e a conversa volta com o evento.
   9. As consultas de auditoria 1 a 6 em zero.

9. **Primeira semana:** o dono revisa 100% das conversas, bloqueios e escalonamentos (consultas de "Acompanhamento", abaixo).

10. **Conduzza Teste**, só depois de 3 a 5 dias limpos na teste123 e das 20 conversas revisadas: os mesmos passos, pela equipe Conduzza, com o número `d73d3e43-e299-4433-8f52-9f9cde6da5b9` (D37). O administrador de lá não liga nada. **Antes do passo 2**, o super admin entra como membro ativo da Conduzza Teste (D37): a confirmação do aviso da OpenAI vai para a trilha com a sessão de quem adiciona o telefone, e a política do `audit_log` só aceita membro ativo. Sem isso, o telefone é gravado, mas a confirmação fica só no log da aplicação (`ia_aviso_da_openai_sem_trilha`), sem linha na trilha. Na teste123 ele já é membro ativo.

---

## Desligar em segundos

Desligar **nunca envia nada** ao contato: as conversas da IA voltam para a equipe com o evento "O assistente foi desligado. A conversa voltou para a equipe." e os pendentes são cancelados. O job que estiver em voo para nas guardas (antes do modelo, entre rodadas, logo antes do provedor e no gatilho de `message`).

- **Uma clínica:** na aba Agente de IA, "Desligado" (o administrador da clínica também pode). Pelo SQL editor:

  ```sql
  select public.definir_liberacao_da_ia('acd9c539-585e-4f2a-a195-712c70099564', false, null, 'motivo curto');
  ```

- **Só o número ou só um telefone:** "Parar de usar" ou "Desligar" na aba (ou `definir_numero_da_ia(..., false)` e `definir_contato_liberado_da_ia(p_clinic_id => ..., p_telefone_e164 => ..., p_rotulo => null, p_ativo => false)`, sempre por nome de parâmetro).
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

**Religar** é só da equipe Conduzza, pelos passos de "Ligar", e só depois de entender o que fez desligar.

---

## Consultas de auditoria (os contadores que têm de ficar em zero)

Rodar no SQL editor, todo dia na primeira semana e depois de qualquer incidente. Todas devolvem só contagens.

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

## Acompanhamento (primeira semana e depois)

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

A revisão das conversas é pelo Atendimento (aba "IA atendendo" e o fio de cada conversa), nunca exportando o texto. O rascunho bloqueado, só o super admin abre ("Ver o que a IA ia responder", no cartão de bloqueio), e cada leitura fica na trilha (`leu_rascunho_bloqueado`).

---

## Incidentes

**A IA falou com quem não devia** (auditoria 2 a 6 acima de zero, ou alguém viu resposta da IA a paciente):

1. Desligue **tudo**: interruptor geral e `select public.motor_ia_desagendar();`.
2. Confira que zerou ("Desligar em segundos", "Conferir").
3. Avise o dono. Não apague nada: `ai_decision_log`, `ai_turno`, a janela e a trilha são a prova.
4. Ache o caminho pelo `job_id` da mensagem (sem copiar o texto): `select * from public.ai_decision_log where job_id = '<job_id>';` (não selecione `blocked_draft`), `select estado, saida, mensagens_lidas, created_at from public.ai_turno where job_id = '<job_id>';`, `select contact_id, desde, aberta_por from public.ia_janela_da_conversa where conversation_id = '<conversa>';`.
5. Se houve dado de paciente enviado à OpenAI ou mensagem da IA a paciente real, é incidente de dado pessoal: o dono decide a comunicação (LGPD, art. 48).
6. Só religa depois de corrigido, testado e com o ok do dono.

**O monitor acusou `ia_parada`** ou a aba mostra "O motor do assistente não está rodando. Avise a equipe Conduzza.": `supabase/operacao/motor-por-cron.md`, "Resposta da IA no WhatsApp (motor-ia)", "Diagnóstico rápido". Enquanto isso, a varredura devolve para a equipe a conversa sem resposta em 3 minutos; se demorar, desligue a clínica para a equipe atender sem esperar.

**`ia_sem_resposta:<n>` no `planner_erro`:** `n` conversas voltaram para a equipe porque a IA não respondeu em 3 minutos. Mesmo diagnóstico do `ia_parada`.

**OpenAI fora, cota ou erro em série** (muitos `desfecho = 'falhou'` com `motivo_da_falha` de `timeout`, `conexao`, `limite`, `cota`, `sobrecarga`, `servidor`, `autenticacao`): cada turno falho passa a conversa para a equipe com a frase fixa (falha fechada). Não há desligamento automático nesta fase (D40): se repetir, desligue a clínica e confira a chave e o limite do projeto na OpenAI. `cota` não é repetido pelo cliente: só volta depois de ajustar o limite.

**Bloqueio de conformidade:** a resposta não sai, a conversa passa para a equipe com a frase fixa e o cartão "Resposta da IA bloqueada pela conformidade" aparece no fio. O super admin pode abrir o rascunho (registrado). Bloqueio frequente com o mesmo `compliance_rule` vira ajuste da base ou das instruções na Tela 6, nunca afrouxar o filtro.

**"A IA pode não ter enviado a última resposta. A conversa voltou para a equipe."** (`envio_incerto`): o provedor não confirmou. A IA **não** reenvia. A equipe confere no celular se a mensagem chegou e responde se precisar.

**"O aviso automático ao contato não foi enviado."**: a conversa passou para a equipe, mas a frase fixa não saiu (canal ocupado ou falha). Nunca é tentada de novo: a equipe responde o contato.

**Número desconectado:** as conversas da IA voltam para a equipe ("o número do assistente está desconectado"); a IA não espera a reconexão. Reconectar na aba WhatsApp. A aba Agente de IA mostra o motivo até lá.

**Teto de gasto atingido:** conversa nova do telefone da equipe nasce com a equipe (evento "parada"); a conversa que já estava na IA recebe a frase fixa e passa ("o limite de gasto de hoje acabou"). Volta sozinho quando o gasto mais antigo sai da janela de 24 horas. Mudar o teto é só com o ok do dono, pelo SQL editor, na clínica da lista: `update public.ia_liberacao set teto_diario_centavos_usd = <centavos> where clinic_id = '<id da clínica>';`.

**Saiu da IA "por celular" sem ninguém ter respondido:** o eco da nossa própria resposta não foi reconhecido. Desde a revisão de 13/10/2026 o eco só é reconhecido pelo texto (o hash de uma resposta aprovada da conversa nos últimos 10 minutos, ou a frase fixa); se o provedor devolver o texto alterado, a conversa sai da IA (o lado seguro: qualquer outro texto pelo celular é de uma pessoa e sempre tira). Nada se perde: a equipe usa Devolver para a IA, se quiser continuar o teste. Se repetir, registre os ids da conversa e da mensagem para o desenvolvimento.

**Telefone do contato editado ou conversa trocada de contato:** a IA para e devolve ("o assistente deixou de estar liberado para este telefone ou este número"). É a trava funcionando.

**Job da IA preso:** o lease é de 90 s; o claim seguinte retoma ou enterra (`lease_expirado`) sozinho, e a varredura devolve a conversa. Para cancelar um pendente à mão (só pendente, nunca executando):

```sql
update public.job_queue set status = 'cancelado', last_error = 'cancelada_pela_operacao'
where id = '<job_id>' and kind = 'responder_com_ia' and status = 'pendente';
```

---

## Encerrar uma conversa da IA

Nesta fase a IA não resolve conversa sozinha e o botão Resolver não aparece para conversa da IA (D42). Para encerrar: **Assumir conversa** e depois **Resolver**. Para a IA voltar a responder a mesma conversa: **Devolver para a IA** (só na conversa que está com você, sem pergunta do paciente pendente, de telefone liberado e que não é paciente, com o contato autorizado a receber mensagens e sem a conversa ter chegado ao teto de respostas da IA na última hora); a IA começa da próxima mensagem do contato, sem ler o que veio antes.

---

## Rollback

Na ordem. Detalhe e lista exata de objetos no `docs/04`, 17.13, "Rollback".

1. Desligar tudo ("Desligar em segundos": interruptor geral) e `select public.motor_ia_desagendar();`.
2. Conferir zero conversas na IA e zero `responder_com_ia` pendentes ou executando; cancelar os pendentes que sobrarem.
3. Reverter o deploy na Vercel para o código anterior ao E3.
4. **M2:** repor os dois corpos de `supabase/operacao/rollback/20261013120000-corpos-anteriores.sql` (`ingest_inbound_message` e `registrar_mensagem_do_celular`).
5. **M3:** `supabase/operacao/rollback/20261013110000-corpos-anteriores.sql` (`drop trigger mensagem_ia_exige_aprovacao_ins` e `mensagem_ia_exige_aprovacao_upd` em `public.message`, com `lock_timeout` de 3 s, em horário calmo).
6. **M1:** repor as funções de `supabase/operacao/rollback/20261013100000-corpos-anteriores.sql` (inclusive `definir_contato_liberado_da_ia` com a assinatura antiga, depois de apagar a nova), apagar as funções novas (a lista completa está no cabeçalho da M1, passo 5, com `ia_jobs_devidos` e `ia_estado_do_motor`), o índice e o CHECK de payload da fila, as linhas do kind, voltar o CHECK do kind **com** `enviar_mensagem_agendada`, apagar as três tabelas novas, o gatilho e a função `ia_contato_liberado_forcado_so_pela_funcao` e a coluna `ia_contato_liberado.forcado`, e desfazer as mudanças em `ai_decision_log` (CHECK, colunas e o grant de SELECT de tabela). O harness local do E3 aplica essa sequência inteira sobre as três migrations.
7. Regenerar os tipos e anotar no `docs/05`.
