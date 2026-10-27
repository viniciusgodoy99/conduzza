-- ---------------------------------------------------------------------------
-- Cadastro para o agente (AG1): onde fica a clinica, quando abre, o que o
-- procedimento exige do paciente, a idade e a grade de cada profissional, e
-- a prontidao do cadastro
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026: o agente de IA faz todo o atendimento e o
-- agendamento (horarios por medico, plano, valor, local da clinica,
-- procedimentos, excecoes e o que o procedimento exige do paciente). O
-- levantamento mostrou que falta DADO, nao codigo: a unidade so tem
-- `address` em texto livre (e nenhuma clinica real tem unidade cadastrada:
-- unit vazia na producao), nao existe requisito estruturado do
-- procedimento, e o profissional nao tem idade atendida nem grade. Esta
-- migration cria o CADASTRO desses dados. A IA NAO le nada disto ainda: as
-- ferramentas que leem sao a proxima etapa (AG2). A tela de Cadastros grava;
-- a Tela 6 mostra a prontidao.
--
-- O QUE MUDA (SO ACRESCIMO: nenhuma funcao, policy, gatilho ou constraint
-- que ja existe e trocada ou apagada; nenhuma linha muda de valor):
--   1. Duas funcoes de validacao, IMMUTABLE, search_path vazio, usadas so
--      nos CHECKs abaixo (EXECUTE de quem ja tinha por padrao: sao puras):
--      - cadastro_texto_valido(texto, maximo): nulo passa; senao de 1 ao
--        maximo de caracteres e APARADO pela regra do JavaScript (sem
--        nenhum dos 25 brancos que o .trim() tira nas pontas; o btrim com
--        a mesma lista de 20261026130000);
--      - horario_de_funcionamento_valido(jsonb): nulo passa; senao um objeto
--        com as chaves "0" a "6" (dia da semana, 0 = domingo, como
--        professional_schedule.weekday e extract(dow)), cada dia presente
--        com 1 a 4 faixas {"inicio": "HH:MM", "fim": "HH:MM"} (so essas duas
--        chaves; 00:00 a 23:59), o fim depois do inicio (a faixa nao vira o
--        dia) e as faixas do dia sem sobreposicao (encostar pode: 12:00 e
--        12:00). Dia fechado = chave ausente; objeto vazio e dia sem faixa
--        sao recusados (sem horario = nulo). Nunca lanca: forma errada e
--        falso.
--   2. unit, 13 colunas novas, todas anulaveis (o `address` de hoje fica: a
--      tela passa a compo-lo dos campos quando eles existem): logradouro
--      (ate 200), numero (20), complemento (100), bairro (100), cidade
--      (100), todas aparadas; uf (CHECK: uma das 27 siglas, maiusculas);
--      cep (CHECK: 8 digitos, sem mascara; guardado, NAO vai a IA);
--      referencia, estacionamento e acessibilidade (ate 200, aparadas);
--      link_do_mapa (CHECK: comeca com https://, com o endereco do site e
--      sem branco, ate 500); horario_de_funcionamento (jsonb, CHECK pela
--      funcao do item 1); observacao_ao_paciente (ate 300, aparada).
--   3. procedure_requirement (tabela nova): o que o procedimento exige do
--      paciente, para todos ou so para um convenio (insurance_id; ex.:
--      autorizacao previa so na Unimed). tipo numa lista fechada
--      (pedido_medico, autorizacao_previa, carteirinha, documento_com_foto,
--      exames_anteriores, acompanhante, chegar_antes_minutos, idade_minima,
--      avaliacao_previa, outro); valor_inteiro obrigatorio so em
--      chegar_antes_minutos (1 a 480 minutos) e idade_minima (1 a 120
--      anos), nulo nos outros; texto_ao_paciente ate 300, aparado,
--      obrigatorio em outro; ativo; created_at e updated_at (gatilho
--      set_updated_at). Um requisito ATIVO do mesmo tipo por procedimento e
--      convenio (o convenio nulo conta como um: NULLS NOT DISTINCT), menos
--      outro (indice unico parcial). FKs em cascata (clinica, procedimento
--      e convenio: o requisito de um convenio apagado nao faz sentido).
--      Gatilho exigir_requisito_da_mesma_clinica (SECURITY DEFINER, BEFORE
--      INSERT OR UPDATE das colunas de chave): procedimento e convenio da
--      clinica da linha, senao 23503 com a frase de sempre ("O
--      procedimento informado nao pertence a esta clinica."). Funcao
--      propria, como exigir_convenio_da_mesma_clinica, em vez de mais um
--      ramo em exigir_cadastro_da_mesma_clinica (que nao muda aqui). RLS no
--      padrao das tabelas de cadastro: le o membro ATIVO da clinica
--      (user_active_clinic_ids: pendente nao le; clinica suspensa, so o
--      super admin); escrevem o administrador e o gestor com escrita
--      (user_has_role admin/gestor e user_can_write; o Implementador e
--      admin). Grants como package_item: anon sem nada, authenticated sem
--      TRUNCATE.
--   4. professional, 3 colunas novas, anulaveis: idade_minima e idade_maxima
--      (0 a 120, minima <= maxima) e grade_minutos (5, 10, 15, 20, 30, 45 ou
--      60: o intervalo entre os inicios de consulta).
--   5. procedure.ia_pode_informar boolean not null default true: a IA pode
--      informar o preco e o que o procedimento exige mesmo quando nao marca
--      pela IA. INERTE ate a proxima etapa (decisao D-3 do dono pendente):
--      so a tela grava; nada le.
--   6. prontidao_do_cadastro_da_ia(p_clinic_id) returns jsonb: plpgsql,
--      STABLE, SECURITY DEFINER, search_path vazio. Guarda: com sessao, o
--      super admin ou o administrador ou gestor ATIVO da clinica com escrita
--      (a clinica suspensa recusa quem nao e super admin); sem sessao, a
--      service role e o SQL editor; os outros (anon, authenticated sem sub,
--      recepcao, profissional, leitura, pendente, outra clinica) 42501.
--      Depois: 22004 (clinica nula) e P0002 (clinica que nao existe). So
--      CONTAGENS e listas curtas de NOMES de cadastro (ate 10, por nome e
--      id), nunca dado de paciente (nao le contact, conversation, message
--      nem appointment). EXECUTE so para authenticated e service_role.
--
-- FORMATO EXATO do jsonb de prontidao_do_cadastro_da_ia (toda chave sempre
-- presente; "total" e a contagem inteira e "nomes" os 10 primeiros em ordem
-- de nome e id, [] quando nao ha):
-- {
--   "profissionais_sem_jornada":    {"total": int, "nomes": [text]},
--                                   ativos sem nenhuma faixa em professional_schedule
--   "procedimentos_sem_vinculo":    {"total": int, "nomes": [text]},
--                                   ativos com "IA pode agendar" sem vinculo que a IA use (vinculo ativo com
--                                   "IA pode agendar", profissional ativo e convenio nulo ou ativo, a regra
--                                   de lib/agente/ferramentas/buscar-procedimento.ts): sem duracao nem quem faca
--   "procedimentos_sem_preco":      {"total": int, "nomes": [text]},
--                                   os mesmos procedimentos COM vinculo que a IA usa, nenhum com preco
--                                   (price_cents) nem "Coberto"
--   "unidades_ativas":              int,
--   "nenhuma_unidade_ativa":        boolean,
--   "unidades_sem_endereco":        {"total": int, "nomes": [text]},
--                                   ativas sem logradouro, numero, bairro, cidade ou uf
--   "unidades_sem_horario":         {"total": int, "nomes": [text]},
--                                   ativas sem horario_de_funcionamento
--   "convenios_sem_cobertura":      {"total": int, "nomes": [text]},
--                                   ativos que nao cobrem nenhum procedimento ativo (procedure_insurance);
--                                   o nome com o plano entre parenteses, "Nome (Plano)", como na tela
--   "procedimentos_sem_requisitos": {"total": int, "nomes": [text]}
--                                   ativos sem requisito ativo (informativo: nem todo procedimento exige algo)
-- }
--
-- Producao em 26/10/2026 (q.js, so leitura, so contagens): 0 unidades; 21
-- profissionais, 16 procedimentos, 2 convenios, 16 vinculos, 10 faixas de
-- jornada, 0 pares em procedure_insurance e 1 em professional_insurance. Nas
-- clinicas reais: a teste123 tem 3 profissionais ativos (1 sem jornada), 2
-- procedimentos da IA com vinculo da IA sem preco e 1 convenio sem
-- cobertura; a Conduzza Teste, 1 profissional com jornada, 1 procedimento
-- com preco e 1 convenio sem cobertura; a Salud Care, 3 profissionais (2 sem
-- jornada) e nenhum procedimento; as outras tres, nada. Nenhuma tem unidade.
-- Os CHECKs novos valem para as linhas que existem: todas as colunas novas
-- nascem nulas (ia_pode_informar nasce verdadeira), entao nenhuma recusa.
--
-- TRAVAS: lock_timeout de 3 s (com a tabela ocupada, falha inteira com
-- 55P03 e roda de novo). ACCESS EXCLUSIVE ate o commit em unit (0 linhas),
-- professional (21) e procedure (16), nessa ordem: os ADD COLUMN sao so de
-- catalogo (anulaveis; o default constante de ia_pode_informar nao reescreve
-- a tabela) e os CHECKs novos varrem essas poucas linhas. Enquanto a
-- migration espera a trava, quem chega para ler essas tabelas espera atras
-- dela (no maximo os 3 s); depois, milissegundos. As FKs da tabela nova
-- seguram SHARE ROW EXCLUSIVE em clinic e insurance ate o commit (a leitura
-- segue; a escrita nessas tabelas, rara, espera). Nenhum ALTER em message,
-- conversation, contact, clinic_member, job_queue nem clinic, e nenhuma
-- linha delas muda. Nada levanta 40001 nem 40P01. Horario calmo.
--
-- ORDEM DE PUBLICACAO: a migration vai ANTES do codigo. O codigo publicado
-- hoje (main 922fb4b) nao le nem grava nada disto: o INSERT e o UPDATE de
-- unidade, profissional e procedimento dele nao mandam as colunas novas
-- (nascem nulas; ia_pode_informar, verdadeira), entao aplicar antes nao
-- muda nada para ninguem. O codigo novo (Cadastros e a Tela 6, branch
-- agente-completo) le as colunas, a tabela e a funcao: publicado antes da
-- migration, Cadastros cai no erro da pagina e o cartao da prontidao, no
-- erro dele. Os tipos de lib/supabase/database.types.ts foram escritos a
-- mao no formato do gerador; regenerar depois de aplicar.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo (o novo le as colunas,
-- a tabela e a funcao), DEPOIS, numa transacao, no SQL editor, o arquivo
-- supabase/operacao/rollback/20261027100000-corpos-anteriores.sql (apaga a
-- funcao da prontidao, a tabela procedure_requirement com o gatilho e a
-- funcao dele, as colunas novas com os CHECKs e as duas funcoes de
-- validacao; confere no fim). SE PERDE o que foi cadastrado nas colunas e
-- na tabela novas (endereco estruturado, horario, textos ao paciente,
-- requisitos, idades, grade e a chave ia_pode_informar); o `address` de
-- texto fica (a tela grava nele o endereco composto).
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) As funcoes de validacao dos CHECKs
-- ---------------------------------------------------------------------------

create function public.cadastro_texto_valido(p_texto text, p_maximo integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Nulo passa (a coluna e opcional). Senao: de 1 ao maximo de caracteres e
  -- sem nenhum dos 25 brancos do .trim() do JavaScript nas pontas (a tela
  -- apara com .trim(); o btrim sem lista so tiraria o espaco ASCII).
  select p_texto is null
      or (char_length(p_texto) between 1 and p_maximo
          and p_texto = btrim(p_texto, E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'))
$$;

comment on function public.cadastro_texto_valido(text, integer) is
  'CHECK dos textos do cadastro para o agente (migration 20261027100000_cadastro_para_o_agente.sql): nulo passa; senao de 1 a p_maximo caracteres e aparado pela regra do .trim() do JavaScript (os 25 brancos). Pura.';

create function public.horario_de_funcionamento_valido(p_horario jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_dia text;
  v_faixas jsonb;
  v_faixa jsonb;
  v_inicio integer;
  v_fim integer;
  v_fim_anterior integer;
begin
  -- Nulo passa (sem horario). Forma errada e falso, nunca erro.
  if p_horario is null then
    return true;
  end if;
  if jsonb_typeof(p_horario) <> 'object' or p_horario = '{}'::jsonb then
    return false;
  end if;
  for v_dia, v_faixas in select d.key, d.value from jsonb_each(p_horario) as d loop
    if v_dia !~ '^[0-6]$' then
      return false;
    end if;
    if jsonb_typeof(v_faixas) <> 'array'
       or jsonb_array_length(v_faixas) not between 1 and 4 then
      return false;
    end if;
    for v_faixa in select f.value from jsonb_array_elements(v_faixas) as f loop
      if jsonb_typeof(v_faixa) <> 'object'
         or (select count(*) from jsonb_object_keys(v_faixa)) <> 2
         or jsonb_typeof(v_faixa -> 'inicio') is distinct from 'string'
         or jsonb_typeof(v_faixa -> 'fim') is distinct from 'string'
         or (v_faixa ->> 'inicio') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (v_faixa ->> 'fim') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      then
        return false;
      end if;
      v_inicio := substr(v_faixa ->> 'inicio', 1, 2)::integer * 60 + substr(v_faixa ->> 'inicio', 4, 2)::integer;
      v_fim := substr(v_faixa ->> 'fim', 1, 2)::integer * 60 + substr(v_faixa ->> 'fim', 4, 2)::integer;
      if v_fim <= v_inicio then
        return false;
      end if;
    end loop;
    -- Sem sobreposicao: em ordem de inicio, cada faixa comeca no fim da
    -- anterior ou depois.
    v_fim_anterior := null;
    for v_inicio, v_fim in
      select substr(f.value ->> 'inicio', 1, 2)::integer * 60 + substr(f.value ->> 'inicio', 4, 2)::integer,
             substr(f.value ->> 'fim', 1, 2)::integer * 60 + substr(f.value ->> 'fim', 4, 2)::integer
        from jsonb_array_elements(v_faixas) as f
       order by 1, 2
    loop
      if v_fim_anterior is not null and v_inicio < v_fim_anterior then
        return false;
      end if;
      v_fim_anterior := v_fim;
    end loop;
  end loop;
  return true;
end;
$$;

comment on function public.horario_de_funcionamento_valido(jsonb) is
  'CHECK de unit.horario_de_funcionamento (migration 20261027100000_cadastro_para_o_agente.sql): nulo passa; senao objeto com as chaves "0" a "6" (0 = domingo), cada dia presente com 1 a 4 faixas {"inicio","fim"} em HH:MM (00:00 a 23:59), fim depois do inicio e sem sobreposicao no dia. Dia fechado = chave ausente. Forma errada e falso, nunca erro. Pura.';

-- ---------------------------------------------------------------------------
-- 2) unit: o endereco estruturado, o horario e o que vai ao paciente
-- ---------------------------------------------------------------------------

alter table public.unit
  add column logradouro text,
  add column numero text,
  add column complemento text,
  add column bairro text,
  add column cidade text,
  add column uf text,
  add column cep text,
  add column referencia text,
  add column estacionamento text,
  add column acessibilidade text,
  add column link_do_mapa text,
  add column horario_de_funcionamento jsonb,
  add column observacao_ao_paciente text,
  add constraint unit_logradouro_valido check (public.cadastro_texto_valido(logradouro, 200)),
  add constraint unit_numero_valido check (public.cadastro_texto_valido(numero, 20)),
  add constraint unit_complemento_valido check (public.cadastro_texto_valido(complemento, 100)),
  add constraint unit_bairro_valido check (public.cadastro_texto_valido(bairro, 100)),
  add constraint unit_cidade_valida check (public.cadastro_texto_valido(cidade, 100)),
  add constraint unit_uf_valida check (
    uf in ('AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
           'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO')),
  add constraint unit_cep_valido check (cep ~ '^[0-9]{8}$'),
  add constraint unit_referencia_valida check (public.cadastro_texto_valido(referencia, 200)),
  add constraint unit_estacionamento_valido check (public.cadastro_texto_valido(estacionamento, 200)),
  add constraint unit_acessibilidade_valida check (public.cadastro_texto_valido(acessibilidade, 200)),
  add constraint unit_link_do_mapa_valido check (
    char_length(link_do_mapa) <= 500 and link_do_mapa ~ '^https://[^\s/?#]+([/?#]\S*)?$'),
  add constraint unit_horario_de_funcionamento_valido check (
    public.horario_de_funcionamento_valido(horario_de_funcionamento)),
  add constraint unit_observacao_ao_paciente_valida check (
    public.cadastro_texto_valido(observacao_ao_paciente, 300));

comment on column public.unit.logradouro is
  'Rua, avenida ou travessa (ate 200, aparado). Com numero, bairro, cidade e uf compoe o endereco que a tela grava em address.';
comment on column public.unit.numero is
  'Numero do endereco, como a clinica escreve (ate 20, aparado; ex.: S/N).';
comment on column public.unit.complemento is
  'Sala, andar, bloco (ate 100, aparado).';
comment on column public.unit.bairro is 'Bairro (ate 100, aparado).';
comment on column public.unit.cidade is 'Cidade (ate 100, aparado).';
comment on column public.unit.uf is 'Sigla do estado, uma das 27, em maiusculas.';
comment on column public.unit.cep is
  'CEP com 8 digitos, sem mascara. Guardado no cadastro; nao vai a IA (o filtro de saida barra CEP).';
comment on column public.unit.referencia is
  'Ponto de referencia para chegar, texto ao paciente (ate 200, aparado; a tela confere com as regras do texto do agente).';
comment on column public.unit.estacionamento is
  'Como e o estacionamento, texto ao paciente (ate 200, aparado; a tela confere com as regras do texto do agente).';
comment on column public.unit.acessibilidade is
  'Acessibilidade da unidade, texto ao paciente (ate 200, aparado; a tela confere com as regras do texto do agente).';
comment on column public.unit.link_do_mapa is
  'Link do mapa (comeca com https://, ate 500). Guardado; o filtro de saida de hoje barra link na resposta da IA.';
comment on column public.unit.horario_de_funcionamento is
  'Horario de funcionamento: {"0".."6": [{"inicio":"HH:MM","fim":"HH:MM"}]} (0 = domingo; dia fechado = chave ausente; ate 4 faixas por dia, sem sobreposicao). Nulo = nao informado. CHECK por horario_de_funcionamento_valido.';
comment on column public.unit.observacao_ao_paciente is
  'Observacao ao paciente sobre a unidade (ate 300, aparado; a tela confere com as regras do texto do agente).';

-- ---------------------------------------------------------------------------
-- 3) procedure_requirement: o que o procedimento exige do paciente
-- ---------------------------------------------------------------------------

create table public.procedure_requirement (
  id uuid not null default gen_random_uuid(),
  clinic_id uuid not null,
  procedure_id uuid not null,
  insurance_id uuid,
  tipo text not null,
  valor_inteiro integer,
  texto_ao_paciente text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procedure_requirement_pkey primary key (id),
  constraint procedure_requirement_clinic_id_fkey
    foreign key (clinic_id) references public.clinic (id) on delete cascade,
  constraint procedure_requirement_procedure_id_fkey
    foreign key (procedure_id) references public.procedure (id) on delete cascade,
  constraint procedure_requirement_insurance_id_fkey
    foreign key (insurance_id) references public.insurance (id) on delete cascade,
  constraint procedure_requirement_tipo_valido check (
    tipo in ('pedido_medico', 'autorizacao_previa', 'carteirinha', 'documento_com_foto',
             'exames_anteriores', 'acompanhante', 'chegar_antes_minutos', 'idade_minima',
             'avaliacao_previa', 'outro')),
  constraint procedure_requirement_valor_coerente check (
    case tipo
      when 'chegar_antes_minutos' then valor_inteiro is not null and valor_inteiro between 1 and 480
      when 'idade_minima' then valor_inteiro is not null and valor_inteiro between 1 and 120
      else valor_inteiro is null
    end),
  constraint procedure_requirement_texto_valido check (
    public.cadastro_texto_valido(texto_ao_paciente, 300)),
  constraint procedure_requirement_outro_com_texto check (
    tipo <> 'outro' or texto_ao_paciente is not null)
);

create index procedure_requirement_clinic_id_idx
  on public.procedure_requirement (clinic_id);
create index procedure_requirement_procedure_id_idx
  on public.procedure_requirement (procedure_id);
create index procedure_requirement_insurance_id_idx
  on public.procedure_requirement (insurance_id);
-- Um requisito ATIVO do mesmo tipo por procedimento e convenio (o convenio
-- nulo, "todos", conta como um so), menos "outro", que pode repetir.
create unique index procedure_requirement_um_ativo_por_tipo
  on public.procedure_requirement (procedure_id, insurance_id, tipo) nulls not distinct
  where ativo and tipo <> 'outro';

comment on table public.procedure_requirement is
  'O que o procedimento exige do paciente (migration 20261027100000_cadastro_para_o_agente.sql): para todos (insurance_id nulo) ou so para um convenio. Um ativo do mesmo tipo por procedimento e convenio, menos outro. Le o membro ativo da clinica; escrevem o administrador e o gestor com escrita. A IA ainda nao le (proxima etapa).';
comment on column public.procedure_requirement.insurance_id is
  'Nulo: vale para todos (particular e qualquer convenio). Preenchido: so para esse convenio (ex.: autorizacao previa so na Unimed).';
comment on column public.procedure_requirement.tipo is
  'pedido_medico, autorizacao_previa, carteirinha, documento_com_foto, exames_anteriores, acompanhante, chegar_antes_minutos, idade_minima, avaliacao_previa ou outro.';
comment on column public.procedure_requirement.valor_inteiro is
  'Obrigatorio so em chegar_antes_minutos (1 a 480 minutos) e idade_minima (1 a 120 anos); nulo nos outros tipos.';
comment on column public.procedure_requirement.texto_ao_paciente is
  'O que dizer ao paciente sobre o requisito (ate 300, aparado; obrigatorio em outro; a tela confere com as regras do texto do agente).';

create function public.exigir_requisito_da_mesma_clinica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A FK so confere existencia, e a checagem de FK ignora RLS: sem isto, o
  -- gestor de uma clinica apontava o requisito para o cadastro de outra.
  -- A mesma frase para "de outra clinica" e "nao existe".
  if not exists (
    select 1 from public.procedure p
     where p.id = new.procedure_id
       and p.clinic_id = new.clinic_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'O procedimento informado não pertence a esta clínica.';
  end if;
  if new.insurance_id is not null and not exists (
    select 1 from public.insurance i
     where i.id = new.insurance_id
       and i.clinic_id = new.clinic_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'O convênio informado não pertence a esta clínica.';
  end if;
  return new;
end;
$$;

revoke all on function public.exigir_requisito_da_mesma_clinica() from public, anon, authenticated;

comment on function public.exigir_requisito_da_mesma_clinica() is
  'Gatilho de procedure_requirement (migration 20261027100000_cadastro_para_o_agente.sql): o procedimento e o convenio sao da clinica da linha, senao 23503.';

create trigger exigir_requisito_da_mesma_clinica
  before insert or update of clinic_id, procedure_id, insurance_id
  on public.procedure_requirement
  for each row execute function public.exigir_requisito_da_mesma_clinica();

create trigger set_updated_at
  before update on public.procedure_requirement
  for each row execute function public.set_updated_at();

alter table public.procedure_requirement enable row level security;

create policy "membro ativo le requisitos do procedimento"
  on public.procedure_requirement
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

create policy "admin e gestor escrevem requisitos do procedimento"
  on public.procedure_requirement
  for all to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor'])
         and public.user_can_write(clinic_id))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor'])
              and public.user_can_write(clinic_id));

revoke all on table public.procedure_requirement from anon;
revoke truncate on table public.procedure_requirement from authenticated;

-- ---------------------------------------------------------------------------
-- 4) professional: a idade atendida e a grade
-- ---------------------------------------------------------------------------

alter table public.professional
  add column idade_minima integer,
  add column idade_maxima integer,
  add column grade_minutos integer,
  add constraint professional_idade_minima_valida check (idade_minima between 0 and 120),
  add constraint professional_idade_maxima_valida check (idade_maxima between 0 and 120),
  add constraint professional_idades_coerentes check (idade_minima <= idade_maxima),
  add constraint professional_grade_minutos_valida check (grade_minutos in (5, 10, 15, 20, 30, 45, 60));

comment on column public.professional.idade_minima is
  'Idade minima atendida, em anos (0 a 120; nulo = sem minimo).';
comment on column public.professional.idade_maxima is
  'Idade maxima atendida, em anos (0 a 120, nunca abaixo da minima; nulo = sem maximo).';
comment on column public.professional.grade_minutos is
  'Grade de horarios: o intervalo entre os inicios de consulta, em minutos (5, 10, 15, 20, 30, 45 ou 60; nulo = sem grade definida).';

-- ---------------------------------------------------------------------------
-- 5) procedure.ia_pode_informar
-- ---------------------------------------------------------------------------

alter table public.procedure
  add column ia_pode_informar boolean not null default true;

comment on column public.procedure.ia_pode_informar is
  'A IA pode informar o preco e o que o procedimento exige mesmo quando nao marca pela IA (bookable_by_ai). INERTE ate a proxima etapa (decisao D-3 do dono pendente): so a tela grava.';

-- ---------------------------------------------------------------------------
-- 6) A prontidao do cadastro para o agente
-- ---------------------------------------------------------------------------

create function public.prontidao_do_cadastro_da_ia(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profissionais text[];
  v_sem_vinculo text[];
  v_sem_preco text[];
  v_unidades_ativas integer;
  v_sem_endereco text[];
  v_sem_horario text[];
  v_convenios text[];
  v_sem_requisitos text[];
begin
  -- Guarda: com sessao, o super admin ou o administrador ou gestor ativo da
  -- clinica com escrita (a clinica suspensa recusa quem nao e super admin);
  -- sem sessao, a service role e o SQL editor. O resto, 42501.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente o administrador ou o gestor da clínica vê a prontidão do cadastro.';
    end if;
  elsif not public.is_product_admin()
        and not (p_clinic_id is not null
                 and public.user_has_role(p_clinic_id, array['admin', 'gestor'])
                 and public.user_can_write(p_clinic_id))
  then
    raise exception using errcode = '42501',
      message = 'Somente o administrador ou o gestor da clínica vê a prontidão do cadastro.';
  end if;
  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;

  -- Profissionais ativos sem nenhuma faixa de jornada.
  select coalesce(array_agg(p.name order by p.name, p.id), '{}')
    into v_profissionais
    from public.professional p
   where p.clinic_id = p_clinic_id
     and p.active
     and not exists (
       select 1 from public.professional_schedule s
        where s.professional_id = p.id
     );

  -- Procedimentos ativos com "IA pode agendar": sem vinculo que a IA use, e
  -- com vinculo que a IA use mas nenhum com preco nem "Coberto". O vinculo
  -- que a IA usa e o de lib/agente/ferramentas/buscar-procedimento.ts:
  -- ativo, com "IA pode agendar", profissional ativo e convenio nulo ou
  -- ativo.
  with da_ia as (
    select r.id, r.name,
           count(l.id) as vinculos,
           count(l.id) filter (where l.price_cents is not null or l.covered_by_insurance) as com_preco
      from public.procedure r
      left join public.service_link l
        on l.procedure_id = r.id
       and l.clinic_id = p_clinic_id
       and l.active
       and l.bookable_by_ai
       and exists (
         select 1 from public.professional p
          where p.id = l.professional_id
            and p.active
       )
       and (l.insurance_id is null or exists (
         select 1 from public.insurance i
          where i.id = l.insurance_id
            and i.active
       ))
     where r.clinic_id = p_clinic_id
       and r.active
       and r.bookable_by_ai
     group by r.id, r.name
  )
  select coalesce(array_agg(d.name order by d.name, d.id) filter (where d.vinculos = 0), '{}'),
         coalesce(array_agg(d.name order by d.name, d.id) filter (where d.vinculos > 0 and d.com_preco = 0), '{}')
    into v_sem_vinculo, v_sem_preco
    from da_ia d;

  -- Unidades ativas, sem endereco estruturado e sem horario.
  select count(*)::integer,
         coalesce(array_agg(u.name order by u.name, u.id)
                    filter (where u.logradouro is null or u.numero is null or u.bairro is null
                               or u.cidade is null or u.uf is null), '{}'),
         coalesce(array_agg(u.name order by u.name, u.id)
                    filter (where u.horario_de_funcionamento is null), '{}')
    into v_unidades_ativas, v_sem_endereco, v_sem_horario
    from public.unit u
   where u.clinic_id = p_clinic_id
     and u.active;

  -- Convenios ativos que nao cobrem nenhum procedimento ativo.
  select coalesce(array_agg(i.name || coalesce(' (' || nullif(btrim(i.plan_name), '') || ')', '')
                            order by i.name, i.plan_name, i.id), '{}')
    into v_convenios
    from public.insurance i
   where i.clinic_id = p_clinic_id
     and i.active
     and not exists (
       select 1
         from public.procedure_insurance q
         join public.procedure r on r.id = q.procedure_id
        where q.insurance_id = i.id
          and r.active
     );

  -- Procedimentos ativos sem requisito ativo (informativo).
  select coalesce(array_agg(r.name order by r.name, r.id), '{}')
    into v_sem_requisitos
    from public.procedure r
   where r.clinic_id = p_clinic_id
     and r.active
     and not exists (
       select 1 from public.procedure_requirement q
        where q.procedure_id = r.id
          and q.ativo
     );

  return jsonb_build_object(
    'profissionais_sem_jornada',
      jsonb_build_object('total', cardinality(v_profissionais), 'nomes', to_jsonb(v_profissionais[1:10])),
    'procedimentos_sem_vinculo',
      jsonb_build_object('total', cardinality(v_sem_vinculo), 'nomes', to_jsonb(v_sem_vinculo[1:10])),
    'procedimentos_sem_preco',
      jsonb_build_object('total', cardinality(v_sem_preco), 'nomes', to_jsonb(v_sem_preco[1:10])),
    'unidades_ativas', v_unidades_ativas,
    'nenhuma_unidade_ativa', v_unidades_ativas = 0,
    'unidades_sem_endereco',
      jsonb_build_object('total', cardinality(v_sem_endereco), 'nomes', to_jsonb(v_sem_endereco[1:10])),
    'unidades_sem_horario',
      jsonb_build_object('total', cardinality(v_sem_horario), 'nomes', to_jsonb(v_sem_horario[1:10])),
    'convenios_sem_cobertura',
      jsonb_build_object('total', cardinality(v_convenios), 'nomes', to_jsonb(v_convenios[1:10])),
    'procedimentos_sem_requisitos',
      jsonb_build_object('total', cardinality(v_sem_requisitos), 'nomes', to_jsonb(v_sem_requisitos[1:10]))
  );
end;
$$;

revoke all on function public.prontidao_do_cadastro_da_ia(uuid) from public, anon;
grant execute on function public.prontidao_do_cadastro_da_ia(uuid) to authenticated, service_role;

comment on function public.prontidao_do_cadastro_da_ia(uuid) is
  'O que falta no cadastro para o agente de IA (migration 20261027100000_cadastro_para_o_agente.sql): profissionais ativos sem jornada, procedimentos da IA sem vinculo que a IA use ou sem preco, unidades ativas (e se nao ha nenhuma), unidades sem endereco estruturado ou sem horario, convenios ativos sem cobertura e procedimentos sem requisitos (informativo). So contagens e ate 10 nomes de cadastro por lista, nunca dado de paciente. Super admin, administrador ou gestor ativo da clinica com escrita, service role e SQL editor; o resto 42501. SECURITY DEFINER.';
