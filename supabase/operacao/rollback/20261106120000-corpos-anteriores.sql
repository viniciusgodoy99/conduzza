-- Rollback manual da migration 20261106120000_remedios_do_preparo.sql (a
-- introducao da IA antes do bloco exato do preparo; 06/11/2026).
--
-- O QUE A MIGRATION FEZ: trocou o CHECK ai_turno_texto_coerente (a saida preparo
-- com texto), criou preparo_introducao_valida e trocou o corpo e o comentario de
-- mensagem_ia_exige_aprovacao. Nenhuma coluna nova.
--
-- O QUE ESTE ARQUIVO FAZ: devolve o corpo e o comentario de antes (20261103100000,
-- passo 9), tira a funcao nova, tira o texto dos turnos do preparo que ainda
-- esperam o envio e devolve o CHECK de antes (NOT VALID e VALIDATE, sem
-- comentario, como era). Sem IF EXISTS: com qualquer objeto faltando, falha e
-- desfaz tudo.
--
-- ORDEM: PRIMEIRO voltar o codigo, DEPOIS este arquivo. O codigo de antes
-- funciona com e sem a migration. Se o codigo novo ainda estiver no ar, a
-- introducao falha no CHECK do turno ou no gatilho (CZIA3), e a conversa passa
-- para a equipe: nada do que a IA escreveu sai sem passar.
--
-- O QUE SE PERDE: a introducao. Os turnos que ainda esperavam o envio com ela: a
-- retomada recusa (o hash da decisao e o do corpo com a introducao) e a conversa
-- passa para a equipe, sem frase. As mensagens ja enviadas com introducao ficam; o
-- gatilho nao as rele (so roda com o corpo mudando). Os remedios ficam: sao texto
-- da versao aprovada, e continuam saindo no bloco.
--
-- TRAVAS: ACCESS EXCLUSIVE em ai_turno ate o commit. lock_timeout de 3 s.

begin;
-- inicio do rollback
set local lock_timeout = '3s';

create or replace function public.mensagem_ia_exige_aprovacao()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_lista boolean;
  v_teste boolean;
  v_kind text;
  v_job_status text;
  v_job_clinica uuid;
  v_job_conversa text;
  v_job_criado timestamptz;
  v_status text;
  v_responsavel uuid;
  v_contato uuid;
  v_chave text;
  -- [AG7 preparo] inicio
  v_sha text;
  v_versao uuid;
  v_rt uuid;
  -- [AG7 preparo] fim
begin
  if new.author = 'ia' then
    select c.id = any (public.ia_clinicas_da_fase_controlada()), c.e_de_teste
      into v_lista, v_teste
      from public.clinic c
     where c.id = new.clinic_id;
    -- 1) fora das duas clinicas e nao de teste: nunca
    if not coalesce(v_lista, false) and not coalesce(v_teste, false) then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    -- 2) fixture e seed antigos em clinica de teste
    if coalesce(v_teste, false) and new.job_id is null then
      return new;
    end if;
    -- 3) forma
    if new.direction is distinct from 'saida'
       or new.job_id is null
       or new.author_user_id is not null
       or new.is_internal_note
       or new.content_type is distinct from 'texto'
       or new.media_url is not null
       or new.body is null
    then
      raise exception using errcode = 'CZIA1', message = 'ia_sem_aprovacao';
    end if;
    -- 4) job, conversa, janela e liberacao
    select j.kind, j.status, j.clinic_id, j.payload ->> 'conversation_id', j.created_at
      into v_kind, v_job_status, v_job_clinica, v_job_conversa, v_job_criado
      from public.job_queue j
     where j.id = new.job_id;
    if v_kind is distinct from 'responder_com_ia'
       or v_job_status is distinct from 'executando'
       or v_job_clinica is distinct from new.clinic_id
       or v_job_conversa is distinct from new.conversation_id::text
    then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    select c.status, c.assignee_user_id, c.contact_id
      into v_status, v_responsavel, v_contato
      from public.conversation c
     where c.id = new.conversation_id
       and c.clinic_id = new.clinic_id;
    if v_status is distinct from 'ia_atendendo' or v_responsavel is not null then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    select k.phone_key into v_chave
      from public.contact k
     where k.id = v_contato;
    if not exists (
      select 1 from public.ia_janela_da_conversa w
       where w.conversation_id = new.conversation_id
         and w.contact_id = v_contato
         and w.phone_key = v_chave
         and v_job_criado >= w.desde
    ) or not public.ia_pode_falar_com(new.clinic_id, new.whatsapp_account_id, v_chave)
    then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    -- 5) decisao aprovada do mesmo job com o mesmo hash
    if not exists (
      select 1 from public.ai_decision_log d
       where d.clinic_id = new.clinic_id
         and d.conversation_id = new.conversation_id
         and d.job_id = new.job_id
         and d.aprovado
         and not d.compliance_blocked
         and d.texto_sha256 = encode(sha256(convert_to(new.body, 'UTF8')), 'hex')
    ) then
      raise exception using errcode = 'CZIA1', message = 'ia_sem_aprovacao';
    end if;
    return new;
  end if;

  if new.job_id is null then
    return new;
  end if;
  select j.kind into v_kind
    from public.job_queue j
   where j.id = new.job_id;
  if v_kind is distinct from 'responder_com_ia' then
    return new;
  end if;

  select c.id = any (public.ia_clinicas_da_fase_controlada()), c.e_de_teste
    into v_lista, v_teste
    from public.clinic c
   where c.id = new.clinic_id;
  if not coalesce(v_lista, false) and not coalesce(v_teste, false) then
    raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
  end if;
  -- [AG7 preparo] inicio
  -- 3) a forma da linha: so sistema, saida, texto, fora de nota, sem midia,
  --    com corpo (o efeito de hoje: CZIA3).
  if new.author is distinct from 'sistema'
     or new.direction is distinct from 'saida'
     or new.content_type is distinct from 'texto'
     or new.is_internal_note
     or new.media_url is not null
     or new.body is null
  then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  -- 4) a frase de escalonamento: passa, sem conferir a conversa (e a
  --    passagem). Igual a hoje.
  if new.body = public.frase_de_escalonamento_da_ia() then
    return new;
  end if;
  -- 5) o preparo: a decisao enviou_preparo do MESMO job, clinica e conversa
  --    com o hash do corpo (a mais recente), sem autor humano.
  v_sha := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
  select d.preparo_versao_id into v_versao
    from public.ai_decision_log d
   where d.clinic_id = new.clinic_id
     and d.conversation_id = new.conversation_id
     and d.job_id = new.job_id
     and d.desfecho = 'enviou_preparo'
     and d.texto_sha256 = v_sha
     and d.preparo_versao_id is not null
   order by d.created_at desc, d.id desc
   limit 1;
  if v_versao is null or new.author_user_id is not null then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  -- 6) as conferencias de liberacao do ramo ia (o passo 4 dele): o job
  --    responder_com_ia em executando da mesma clinica e conversa, a
  --    conversa na IA sem responsavel, a janela e o telefone liberado.
  select j.status, j.clinic_id, j.payload ->> 'conversation_id', j.created_at
    into v_job_status, v_job_clinica, v_job_conversa, v_job_criado
    from public.job_queue j
   where j.id = new.job_id;
  if v_job_status is distinct from 'executando'
     or v_job_clinica is distinct from new.clinic_id
     or v_job_conversa is distinct from new.conversation_id::text
  then
    raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
  end if;
  select c.status, c.assignee_user_id, c.contact_id
    into v_status, v_responsavel, v_contato
    from public.conversation c
   where c.id = new.conversation_id
     and c.clinic_id = new.clinic_id;
  if v_status is distinct from 'ia_atendendo' or v_responsavel is not null then
    raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
  end if;
  select k.phone_key into v_chave
    from public.contact k
   where k.id = v_contato;
  if not exists (
    select 1 from public.ia_janela_da_conversa w
     where w.conversation_id = new.conversation_id
       and w.contact_id = v_contato
       and w.phone_key = v_chave
       and v_job_criado >= w.desde
  ) or not public.ia_pode_falar_com(new.clinic_id, new.whatsapp_account_id, v_chave)
  then
    raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
  end if;
  -- 7) as travas: a versao (FOR SHARE), depois o RT dela (FOR SHARE). Nunca
  --    o procedimento.
  perform 1 from public.preparo_do_procedimento v
   where v.id = v_versao
     and v.clinic_id = new.clinic_id
     for share;
  select v.rt_id into v_rt
    from public.preparo_do_procedimento v
   where v.id = v_versao
     and v.clinic_id = new.clinic_id;
  perform 1 from public.responsavel_tecnico r
   where r.id = v_rt
     for share;
  -- 8) em vigor e a mensagem remontada, palavra por palavra (um retrato novo,
  --    depois das travas).
  if not public.preparo_em_vigor(new.clinic_id, v_versao)
     or new.body is distinct from public.mensagem_do_preparo(v_versao)
  then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  return new;
  -- [AG7 preparo] fim
end;
$function$;

comment on function public.mensagem_ia_exige_aprovacao() is
  'Funcao dos gatilhos mensagem_ia_exige_aprovacao_ins e _upd de message (M1 e M3; AG7). Linha author = ia: exige job responder_com_ia em execucao da mesma clinica e conversa, conversa na IA sem responsavel, janela que confere, ia_pode_falar_com e decisao APROVADA do mesmo job com o mesmo hash do corpo (CZIA1 ia_sem_aprovacao; CZIA2 ia_nao_liberada); clinica e_de_teste sem job_id passa. Linha de outro autor com job responder_com_ia: clinica fora da fase controlada e nao de teste, CZIA2; fora de sistema, saida, texto, fora de nota, sem midia e com corpo, CZIA3 frase_divergente; a frase de escalonamento passa. AG7: a mensagem do preparo passa so com a decisao enviou_preparo do mesmo job, clinica e conversa com o hash do corpo e sem autor humano (senao CZIA3), as conferencias de liberacao do ramo ia (senao CZIA2 ia_nao_liberada), as travas da versao e do RT (FOR SHARE, nessa ordem; nunca o procedimento), a versao em vigor e o corpo IGUAL a mensagem remontada (mensagem_do_preparo; senao CZIA3 frase_divergente).';

drop function public.preparo_introducao_valida(text);

update public.ai_turno
   set texto = null
 where saida = 'preparo'
   and texto is not null;

alter table public.ai_turno
  drop constraint ai_turno_texto_coerente;

alter table public.ai_turno
  add constraint ai_turno_texto_coerente
    check (texto is null or (saida = 'resposta' and texto_sha256 is not null)) not valid;

alter table public.ai_turno
  validate constraint ai_turno_texto_coerente;
-- fim do rollback
commit;
