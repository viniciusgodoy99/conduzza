-- ---------------------------------------------------------------------------
-- A introducao da IA antes do bloco exato do preparo (06/11/2026)
-- ---------------------------------------------------------------------------
-- Decisao do dono em 06/11/2026, opcao A: "a IA escreve a conversa em volta e o
-- sistema envia a orientacao exata". O cadastro dos remedios NAO mexe no banco:
-- eles entram no texto da versao (comporTextoDoPreparo, lib/domain/preparo.ts),
-- com a mesma aprovacao do RT, o mesmo hash e as mesmas barreiras.
--
-- O QUE MUDA:
--   1. ai_turno_texto_coerente: a saida preparo tambem guarda texto (so a
--      introducao, enquanto o envio esta pendente), sempre com o hash. A
--      retomada remonta o mesmo corpo e confere com o hash da decisao.
--   2. preparo_introducao_valida (nova, sql, imutavel, sem grant): o formato e o
--      conteudo da introducao: uma linha de ate 160 caracteres, na regra do texto
--      (preparo_texto_valido), sem o que o banco recusa (preparo_texto_recusado)
--      e sem digito, unidade, numero por extenso, como tomar, assunto do remedio,
--      remedio do preparo nem sintoma (FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ, em
--      lib/domain/conformidade/filtro-deterministico.ts, byte a byte).
--   3. mensagem_ia_exige_aprovacao: so o passo 8 do ramo do preparo. O corpo e a
--      mensagem remontada da versao em vigor, sozinha ou depois de
--      "introducao + linha em branco". O resto do corpo fica igual, byte a byte
--      (blocos marcados [remedios do preparo]).
-- NAO MUDAM: mensagem_do_preparo, ler_preparo_para_envio (o bloco, sozinho),
-- preparo_em_vigor, ia_pode_falar_com, ai_decision_log e os CHECKs dela (a decisao
-- enviou_preparo guarda o hash do corpo inteiro e continua sem aprovado: o texto
-- do preparo nao passa pelo filtro; o filtro da introducao aparece na trilha, nas
-- versoes e no verificador da decisao). Nenhuma coluna nova, nenhuma linha muda.
--
-- ORDEM: a migration ANTES do codigo. O codigo de antes funciona com ela (o bloco
-- sozinho passa como sempre). O codigo novo sem ela: toda introducao falha no
-- CHECK do turno ou no gatilho, e a conversa passa para a equipe.
-- ROLLBACK: supabase/operacao/rollback/20261106120000-corpos-anteriores.sql.
--
-- LOCKS (lock_timeout de 3 s): ACCESS EXCLUSIVE em ai_turno, ate o commit, pelo
-- CHECK trocado (NOT VALID e VALIDATE; a tabela guarda poucas linhas). As funcoes
-- so mexem no catalogo: message nao e travada.
--
-- Ensaio (termina em ROLLBACK, com ENSAIO OK), no Postgres local:
-- ~/.claude/plans/agente-completo/remedios/ensaio-20261106120000.sql.

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) ai_turno: a saida preparo com o texto da introducao
-- ---------------------------------------------------------------------------

alter table public.ai_turno
  drop constraint ai_turno_texto_coerente;

alter table public.ai_turno
  add constraint ai_turno_texto_coerente
    check (texto is null or (saida in ('resposta', 'preparo') and texto_sha256 is not null)) not valid;

alter table public.ai_turno
  validate constraint ai_turno_texto_coerente;

comment on constraint ai_turno_texto_coerente on public.ai_turno is
  'O texto pendente de envio, sempre com o hash: a resposta inteira (saida resposta) ou, na saida preparo, so a introducao da IA, nunca o texto do preparo, que a retomada rele do banco (decisao do dono de 06/11/2026).';

-- ---------------------------------------------------------------------------
-- 2) preparo_introducao_valida: o que o gatilho aceita antes do bloco
-- ---------------------------------------------------------------------------
-- A regra do TS (problemaDaIntroducao, lib/domain/conformidade/preparo-aprovado.ts)
-- le o mesmo formato e o mesmo conteudo e, alem deles, os nomes de remedio do
-- texto aprovado. Tudo o que esta recusa, o TS recusa.
create function public.preparo_introducao_valida(p_texto text)
returns boolean
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select coalesce(
           char_length(p_texto) <= 160
           and position(E'\n' in p_texto) = 0
           and public.preparo_texto_valido(p_texto)
           and not public.preparo_texto_recusado(p_texto)
           and regexp_replace(regexp_replace(lower(normalize(p_texto, nfkd)), '[\u0300-\u036f]', '', 'g'), ' +', ' ', 'g')
               !~ '[0-9]|\m(?:mg|mcg|ug|ml|g|kg|l|ui|u|gotas?|gotinhas?|pingos?|comprimidos?|compr|capsulas?|cps?|caps|saches?|colher(?:es)?|colheradas?|doses?|ampolas?|jatos?|borrifadas?|puffs?|miligramas?|mililitros?|microgramas?|gramas?|litros?|seringas?|frascos?|copos?|xicaras?|unidades?|horas?|minutos?|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte|trinta|meio|meia|tome|toma|tomar|tomando|tomem|ingira|ingerir|ingerindo|beba|bebam|beber|bebendo|coma|comam|comer|comendo|engula|engolir|dilua|diluir|misture|misturar|aplique|aplicar|use|usar|usando|evite|evitar|suspenda|suspender|interrompa|interromper|pare|parar|jejum|dieta|laxantes?|remedios?|medicamentos?|medicac(?:ao|oes))\M|\m(?:bisacodil|dulcolax|bisalax|lacto purga|lactopurga|humectol|manitol|picossulfato|picosulfato|picoprep|pico prep|picolax|guttalax|macrogol|polietilenoglicol|muvinlax|muvilax|forlax|lactulos|lactulona|duphalac|sene\M|senosideo|tamarine|naturetti|agiolax|fosfato de sodio|phosfoenema|fleet\M|supositori|nujol|oleo mineral|oleo de ricino)|\m(?:colicas?|dor|dores|enjoos?|nauseas?|vomitos?|diarreias?|tonturas?|mal[- ]estar|inchacos?|vermelhid(?:ao|oes)|sangramentos?|coceiras?|ardencias?|ardor|queimac(?:ao|oes)|formigamentos?|febres?|fraquezas?|cansacos?|sonolencias?|gases|estufamentos?|desconfortos?|hematomas?|manchas?|reac(?:ao|oes)|sintomas?|efeitos? colaterais|efeito colateral|evacuac(?:ao|oes)|evacuar|sentir|doer|doi|doem|doendo|arder|arde|ardem|ardendo|cocar|coca|cocam|cocando|sangrar|sangra|sangram|sangrando|inchar|incha|incham|inchad[oa]|inchando|enjoar|enjoad[oa]|vomitar|formigar|formigando|latejar|lateja|latejando|queimar|queimando|incomodar|incomodo)\M',
           false)
$function$;

revoke all on function public.preparo_introducao_valida(text)
  from public, anon, authenticated, service_role;

comment on function public.preparo_introducao_valida(text) is
  'Interna (decisao do dono de 06/11/2026; nenhum papel da API executa: o gatilho de message roda como o dono). Verdadeiro se o texto serve de introducao da IA antes do bloco exato do preparo: uma linha de ate 160 caracteres, em preparo_texto_valido, sem o que preparo_texto_recusado recusa e sem digito, unidade, numero por extenso, como tomar, assunto do remedio, remedio do preparo nem sintoma. So bloqueia; o filtro de conformidade inteiro roda no servidor antes.';

-- ---------------------------------------------------------------------------
-- 3) mensagem_ia_exige_aprovacao: o passo 8 aceita a introducao
-- ---------------------------------------------------------------------------

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
  -- [remedios do preparo]
  v_bloco text;
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
  -- [remedios do preparo] inicio
  --    O corpo e o bloco exato, sozinho ou depois da introducao da IA: o que
  --    vem antes da linha em branco que abre o bloco tem de passar em
  --    preparo_introducao_valida, e o resto continua igual a versao em vigor.
  v_bloco := public.mensagem_do_preparo(v_versao);
  if not public.preparo_em_vigor(new.clinic_id, v_versao)
     or v_bloco is null
     or (new.body <> v_bloco
         and (right(new.body, char_length(v_bloco) + 2) <> E'\n\n' || v_bloco
              or not public.preparo_introducao_valida(
                left(new.body, char_length(new.body) - char_length(v_bloco) - 2))))
  then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  -- [remedios do preparo] fim
  return new;
  -- [AG7 preparo] fim
end;
$function$;

comment on function public.mensagem_ia_exige_aprovacao() is
  'Funcao dos gatilhos mensagem_ia_exige_aprovacao_ins e _upd de message (M1 e M3; AG7). Linha author = ia: exige job responder_com_ia em execucao da mesma clinica e conversa, conversa na IA sem responsavel, janela que confere, ia_pode_falar_com e decisao APROVADA do mesmo job com o mesmo hash do corpo (CZIA1 ia_sem_aprovacao; CZIA2 ia_nao_liberada); clinica e_de_teste sem job_id passa. Linha de outro autor com job responder_com_ia: clinica fora da fase controlada e nao de teste, CZIA2; fora de sistema, saida, texto, fora de nota, sem midia e com corpo, CZIA3 frase_divergente; a frase de escalonamento passa. AG7: a mensagem do preparo passa so com a decisao enviou_preparo do mesmo job, clinica e conversa com o hash do corpo e sem autor humano (senao CZIA3), as conferencias de liberacao do ramo ia (senao CZIA2 ia_nao_liberada), as travas da versao e do RT (FOR SHARE, nessa ordem; nunca o procedimento), a versao em vigor e o corpo IGUAL a mensagem remontada (mensagem_do_preparo; senao CZIA3 frase_divergente). Decisao do dono de 06/11/2026: o corpo tambem pode ser a introducao da IA, uma linha em branco e a mensagem remontada, com a introducao passando em preparo_introducao_valida; o hash da decisao e o do corpo inteiro.';
