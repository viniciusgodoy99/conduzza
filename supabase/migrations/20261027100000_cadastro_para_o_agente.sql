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
-- migration cria o CADASTRO desses dados. A IA le estes dados pelas
-- ferramentas da AG2 (consultar_unidades, consultar_requisitos,
-- buscar_profissionais e buscar_procedimento ampliada), que vao ao ar no
-- mesmo pacote de codigo, DEPOIS desta migration. A tela de Cadastros grava;
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
--      pela IA. Lida pela buscar_procedimento da AG2, so para o
--      procedimento que a IA nao marca (decisao D-3 do dono pendente;
--      padrao: sim).
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
--   7. salvar_requisitos_do_procedimento(p_procedure_id, p_itens,
--      p_ids_na_abertura) returns jsonb: o Salvar de "O que o paciente
--      precisa" numa transacao so (revisao de 27/10/2026: a action apagava,
--      mudava e criava em chamadas separadas; trocar o tipo ou o convenio
--      entre dois ativos batia no indice unico, e a falha no meio deixava
--      gravado o que veio antes). plpgsql, SECURITY DEFINER, search_path
--      vazio. Guarda antes de tudo: sem sessao, a service role e o SQL
--      editor; com sessao, as regras da policy de escrita da tabela (membro
--      ATIVO administrador ou gestor da clinica do procedimento, com
--      user_can_write: a clinica suspensa recusa, e o super admin sem vinculo
--      tambem); os outros (anon sem EXECUTE, authenticated sem sub, recepcao,
--      leitura, profissional, pendente, outra clinica, e o procedimento de
--      outra clinica ou que nao existe) 42501. Sem sessao: 22004
--      (procedimento nulo) e P0002 (que nao existe). Trava a linha do
--      procedimento (FOR NO KEY UPDATE: dois Salvar do mesmo procedimento vao
--      em fila) e as dos requisitos dele, em ordem de id. Confere a forma
--      (22023: ate 30 objetos, so as seis chaves, tipo e ativo obrigatorios,
--      id e convenio em formato uuid, numero inteiro, cada id uma vez; ate
--      120 ids na abertura, sem nulo), as regras dos CHECKs (23514) e um
--      ativo do mesmo tipo e convenio na lista (23505, como o indice). O que
--      mudou desde que o modal abriu (id da lista que nao e deste
--      procedimento, ou item ativo que bate com um ativo que outra pessoa
--      criou com o modal aberto): CZ409, nada gravado; nunca 40001 nem 40P01.
--      Depois, nesta ordem: apaga so o que estava na abertura e saiu da lista
--      (o que outra pessoa criou fica), desativa antes os ativos que mudam de
--      tipo ou de convenio ou que ficam inativos (a troca entre dois ativos
--      nao bate no indice), grava os valores finais (o gatilho de mesma
--      clinica confere o convenio: 23503), cria os novos e, se algo mudou,
--      grava a trilha editou_requisitos_do_procedimento (entity procedure;
--      user_id da sessao, nulo sem sessao; nunca o conteudo). Qualquer erro
--      desfaz tudo. Devolve {apagados, alterados, criados, requisitos: a
--      lista inteira do procedimento, em ordem de criacao}. EXECUTE so para
--      authenticated e service_role.
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
-- TRAVAS (medidas no Postgres local: pg_locks da transacao depois da
-- migration). TODAS no comeco, no bloco 0, antes de qualquer mudanca, numa
-- ordem fixa e cada uma ja no modo mais forte que a migration pede na
-- tabela: procedure, professional e unit em ACCESS EXCLUSIVE (os ALTER;
-- em procedure, tambem a FK da tabela nova); clinic e insurance em SHARE
-- ROW EXCLUSIVE (as FKs da tabela nova). Cada tentativa pede as cinco com
-- NOWAIT; com uma ocupada, solta as que pegou (o savepoint do bloco),
-- espera 100 ms SEM trava nenhuma e tenta de novo, ate 30 vezes (uns 3 s);
-- depois falha inteira com 55P03, nada gravado: rodar de novo. Assim a
-- migration nunca espera trava com outra na mao e nao fecha ciclo (40P01)
-- com sessao nenhuma. (A revisao de 27/10/2026 achou o ciclo na versao
-- anterior: a FK pegava SHARE ROW EXCLUSIVE em procedure antes do ALTER de
-- professional, o ALTER de procedure no fim subia para ACCESS EXCLUSIVE, e
-- a transacao que ja tinha lido procedure e esperava professional ou unit
-- levava 40P01. O teste de concorrencia do harness reproduz esse caso, o
-- espelho dele e a escrita em insurance: ~/.claude/plans/agente-completo/
-- ag1/banco/travas.) Depois do bloco, a migration so pede travas que ja tem
-- (ou mais fracas, nas mesmas tabelas) e nunca espera; o lock_timeout de
-- 3 s fica de rede. Quanto tempo: do bloco ao commit, de 12 a 20 ms no
-- Postgres local (5 rodadas, com o commit; o bloco pega as cinco de uma
-- vez quando ninguem as segura): os ADD COLUMN sao so de catalogo
-- (anulaveis; o default constante de ia_pode_informar nao reescreve a
-- tabela) e os CHECKs novos varrem as poucas linhas de hoje (unit 0,
-- professional 21, procedure 16). Nesse tempo, procedure, professional e
-- unit nem leem nem gravam (quem chega espera os milissegundos); clinic e
-- insurance seguem lendo, e a escrita nelas (rara) espera. Nenhuma trava em
-- message, conversation, contact, clinic_member, job_queue nem audit_log, e
-- nenhuma linha delas muda. Nada levanta 40001 nem 40P01. Horario calmo.
--
-- ORDEM DE PUBLICACAO: a migration vai ANTES do codigo. O codigo publicado
-- hoje (main 922fb4b) nao le nem grava nada disto: o INSERT e o UPDATE de
-- unidade, profissional e procedimento dele nao mandam as colunas novas
-- (nascem nulas; ia_pode_informar, verdadeira), entao aplicar antes nao
-- muda nada para ninguem. O codigo novo (Cadastros e a Tela 6, branch
-- agente-completo) le as colunas, a tabela e a prontidao e grava os
-- requisitos pela RPC do item 7: publicado antes da migration, Cadastros
-- cai no erro da pagina e o cartao da prontidao, no erro dele. Os tipos de
-- lib/supabase/database.types.ts foram escritos a mao no formato do
-- gerador; regenerar depois de aplicar.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo (o novo le as colunas,
-- a tabela e as funcoes), DEPOIS, numa transacao, no SQL editor, o arquivo
-- supabase/operacao/rollback/20261027100000-corpos-anteriores.sql (apaga a
-- RPC do Salvar e a funcao da prontidao, a tabela procedure_requirement com
-- o gatilho e a funcao dele, as colunas novas com os CHECKs e as duas
-- funcoes de validacao; confere no fim; as travas dele estao no cabecalho
-- dele, e pegam ACCESS EXCLUSIVE tambem em clinic e insurance). SE PERDE o
-- que foi cadastrado nas colunas e na tabela novas (endereco estruturado,
-- horario, textos ao paciente, requisitos, idades, grade e a chave
-- ia_pode_informar); o `address` de texto fica (a tela grava nele o
-- endereco composto).
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 0) As travas, todas aqui, antes de qualquer mudanca (cabecalho, TRAVAS)
-- ---------------------------------------------------------------------------
-- Ordem fixa, cada tabela ja no modo mais forte que a migration pede nela.
-- NOWAIT: tabela ocupada solta o que esta tentativa pegou (o savepoint do
-- bloco) e espera 100 ms sem trava nenhuma; 30 tentativas, depois 55P03 e
-- nada gravado. Nunca espera com trava na mao: nao fecha ciclo com sessao.

do $travas$
declare
  v_tentativas integer := 0;
begin
  loop
    begin
      lock table public.procedure, public.professional, public.unit
        in access exclusive mode nowait;
      lock table public.clinic, public.insurance
        in share row exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 30 then
        raise exception using errcode = 'lock_not_available',
          message = 'Migration 20261027100000: procedure, professional, unit, clinic ou insurance seguiu ocupada por 3 s. Nada foi gravado: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

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
  'O que o procedimento exige do paciente (migration 20261027100000_cadastro_para_o_agente.sql): para todos (insurance_id nulo) ou so para um convenio. Um ativo do mesmo tipo por procedimento e convenio, menos outro. Le o membro ativo da clinica; escrevem o administrador e o gestor com escrita. A IA le pela consultar_requisitos (AG2).';
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
  'A IA pode informar o preco e o que o procedimento exige mesmo quando nao marca pela IA (bookable_by_ai). Lida pela buscar_procedimento (AG2), so para o procedimento que a IA nao marca (decisao D-3 do dono pendente; padrao: sim).';

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

-- ---------------------------------------------------------------------------
-- 7) O Salvar de "O que o paciente precisa", numa transacao so
-- ---------------------------------------------------------------------------

create function public.salvar_requisitos_do_procedimento(
  p_procedure_id uuid,
  p_itens jsonb,
  p_ids_na_abertura uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_item jsonb;
  v_ids uuid[];
  v_mudam uuid[];
  v_apagados integer := 0;
  v_criados integer := 0;
  v_sem_permissao constant text := 'Somente administradores e gestores alteram os cadastros.';
  v_lista_invalida constant text := 'A lista do que o paciente precisa é inválida.';
  v_mudou constant text := 'O cadastro mudou enquanto você editava. Feche, abra de novo e salve.';
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 1. Guarda sem sessao: so a service role e o SQL editor (anon nem tem
  -- EXECUTE; authenticated sem sub, 42501).
  if auth.uid() is null and coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception using errcode = '42501', message = v_sem_permissao;
  end if;

  -- 2. O procedimento, travado ate o fim (FOR NO KEY UPDATE): dois Salvar do
  -- mesmo procedimento vao em fila, e o segundo le o que o primeiro gravou.
  -- A FK de quem grava algo que aponta para ele (FOR KEY SHARE) nao espera.
  select p.clinic_id into v_clinic_id
    from public.procedure p
   where p.id = p_procedure_id
     for no key update;

  -- 3. Guarda com sessao: as regras da policy de escrita de
  -- procedure_requirement (administrador ou gestor ATIVO da clinica do
  -- procedimento, com escrita; a clinica suspensa recusa). O procedimento de
  -- outra clinica, ou que nao existe, da o mesmo 42501: a sessao nao
  -- descobre se ele existe.
  if auth.uid() is not null
     and not (public.user_has_role(v_clinic_id, array['admin', 'gestor'])
              and public.user_can_write(v_clinic_id)) then
    raise exception using errcode = '42501', message = v_sem_permissao;
  end if;
  if p_procedure_id is null then
    raise exception using errcode = '22004', message = 'Informe o procedimento.';
  end if;
  if v_clinic_id is null then
    raise exception using errcode = 'P0002', message = 'Procedimento não encontrado.';
  end if;

  -- 4. A forma (22023): uma lista de ate 30 objetos, cada um so com as seis
  -- chaves, tipo em texto e ativo em booleano (obrigatorios), id e convenio
  -- em formato uuid ou nulos, o numero inteiro ou nulo, o texto em texto ou
  -- nulo, e cada id uma vez; os ids da abertura, uma lista sem nulo, ate
  -- 120. Nada aqui lanca erro de conversao: so 22023.
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or p_ids_na_abertura is null then
    raise exception using errcode = '22023', message = v_lista_invalida;
  end if;
  if coalesce(array_ndims(p_ids_na_abertura), 1) <> 1 then
    raise exception using errcode = '22023', message = v_lista_invalida;
  end if;
  if cardinality(p_ids_na_abertura) > 120 or array_position(p_ids_na_abertura, null) is not null then
    raise exception using errcode = '22023', message = v_lista_invalida;
  end if;
  if jsonb_array_length(p_itens) > 30 then
    raise exception using errcode = '22023',
      message = 'Um procedimento tem no máximo 30 itens em O que o paciente precisa.';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_itens) as e loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = v_lista_invalida;
    end if;
    if not (v_item ? 'tipo' and v_item ? 'ativo')
       or exists (select 1
                    from jsonb_object_keys(v_item) as k (chave)
                   where k.chave not in ('id', 'tipo', 'insurance_id', 'valor_inteiro',
                                         'texto_ao_paciente', 'ativo'))
       or jsonb_typeof(v_item -> 'tipo') <> 'string'
       or jsonb_typeof(v_item -> 'ativo') <> 'boolean'
       or coalesce(jsonb_typeof(v_item -> 'id'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_item -> 'insurance_id'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_item -> 'valor_inteiro'), 'null') not in ('number', 'null')
       or coalesce(jsonb_typeof(v_item -> 'texto_ao_paciente'), 'null') not in ('string', 'null')
       or (jsonb_typeof(v_item -> 'id') = 'string' and (v_item ->> 'id') !~ v_uuid)
       or (jsonb_typeof(v_item -> 'insurance_id') = 'string' and (v_item ->> 'insurance_id') !~ v_uuid)
       or (jsonb_typeof(v_item -> 'valor_inteiro') = 'number'
           and (v_item ->> 'valor_inteiro') !~ '^-?[0-9]{1,9}$')
    then
      raise exception using errcode = '22023', message = v_lista_invalida;
    end if;
  end loop;
  v_ids := array(
    select d.id
      from jsonb_to_recordset(p_itens) as d (id uuid)
     where d.id is not null
  );
  if cardinality(v_ids) <> (select count(distinct x.id) from unnest(v_ids) as x (id)) then
    raise exception using errcode = '22023', message = v_lista_invalida;
  end if;

  -- 5. As regras de cada item, as mesmas dos CHECKs da tabela (23514), e um
  -- ativo do mesmo tipo e convenio na lista, menos "outro" (23505, como o
  -- indice unico, o convenio nulo contando como um), antes de gravar.
  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as d (tipo text, valor_inteiro integer, texto_ao_paciente text)
     where d.tipo not in ('pedido_medico', 'autorizacao_previa', 'carteirinha', 'documento_com_foto',
                          'exames_anteriores', 'acompanhante', 'chegar_antes_minutos', 'idade_minima',
                          'avaliacao_previa', 'outro')
        or not (case d.tipo
                  when 'chegar_antes_minutos' then d.valor_inteiro is not null and d.valor_inteiro between 1 and 480
                  when 'idade_minima' then d.valor_inteiro is not null and d.valor_inteiro between 1 and 120
                  else d.valor_inteiro is null
                end)
        or not public.cadastro_texto_valido(d.texto_ao_paciente, 300)
        or (d.tipo = 'outro' and d.texto_ao_paciente is null)
  ) then
    raise exception using errcode = '23514',
      message = 'Confira o que o paciente precisa: um item ficou fora das regras.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as d (tipo text, insurance_id uuid, ativo boolean)
     where d.ativo
       and d.tipo <> 'outro'
     group by d.tipo, d.insurance_id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'Já existe um item ativo deste tipo para este convênio neste procedimento.';
  end if;

  -- 6. Os requisitos do procedimento, travados em ordem de id (quem grava
  -- direto na tabela espera o fim; a ordem fixa nao abre ciclo entre dois
  -- Salvar), e o que mudou desde que o modal abriu: CZ409, nada gravado
  -- (nunca 40001: o PostgREST repetiria sem fim).
  perform 1
     from public.procedure_requirement q
    where q.procedure_id = p_procedure_id
    order by q.id
      for update;
  -- Item da lista que nao e deste procedimento (sumiu no meio da edicao).
  if exists (
    select 1
      from unnest(v_ids) as x (id)
     where not exists (
       select 1 from public.procedure_requirement q
        where q.id = x.id
          and q.procedure_id = p_procedure_id
     )
  ) then
    raise exception using errcode = 'CZ409', message = v_mudou;
  end if;
  -- Item ativo da lista que bate com um ativo que outra pessoa criou com o
  -- modal aberto (nem na lista nem na abertura): quem salva nao viu esse.
  if exists (
    select 1
      from public.procedure_requirement q
      join jsonb_to_recordset(p_itens) as d (tipo text, insurance_id uuid, ativo boolean)
        on d.tipo = q.tipo
       and d.insurance_id is not distinct from q.insurance_id
     where q.procedure_id = p_procedure_id
       and q.ativo
       and q.tipo <> 'outro'
       and d.ativo
       and not (q.id = any (v_ids))
       and not (q.id = any (p_ids_na_abertura))
  ) then
    raise exception using errcode = 'CZ409', message = v_mudou;
  end if;

  -- 7. Apaga so o que estava na abertura e saiu da lista (o que outra pessoa
  -- criou com o modal aberto fica).
  delete from public.procedure_requirement q
   where q.procedure_id = p_procedure_id
     and q.id = any (p_ids_na_abertura)
     and not (q.id = any (v_ids));
  get diagnostics v_apagados = row_count;

  -- 8. O que muda: qualquer campo diferente do gravado.
  v_mudam := array(
    select q.id
      from public.procedure_requirement q
      join jsonb_to_recordset(p_itens)
             as d (id uuid, tipo text, insurance_id uuid, valor_inteiro integer,
                   texto_ao_paciente text, ativo boolean)
        on d.id = q.id
     where q.procedure_id = p_procedure_id
       and (q.tipo, q.insurance_id, q.valor_inteiro, q.texto_ao_paciente, q.ativo)
           is distinct from (d.tipo, d.insurance_id, d.valor_inteiro, d.texto_ao_paciente, d.ativo)
  );
  -- Primeiro desativa os ativos que mudam de tipo ou de convenio, ou que
  -- ficam inativos: fora do indice unico, a troca entre dois ativos (A
  -- carteirinha para documento com foto, B o inverso) nao bate nele. Os
  -- ativos que sobram sao os que nao mudam de chave, e a lista final ja foi
  -- conferida sem repeticao (passos 5 e 6).
  update public.procedure_requirement q
     set ativo = false
    from jsonb_to_recordset(p_itens) as d (id uuid, tipo text, insurance_id uuid, ativo boolean)
   where q.id = d.id
     and q.id = any (v_mudam)
     and q.ativo
     and (not d.ativo
          or d.tipo is distinct from q.tipo
          or d.insurance_id is distinct from q.insurance_id);
  -- Depois os valores finais (o gatilho de mesma clinica confere o
  -- convenio: de outra clinica, 23503, e tudo volta).
  update public.procedure_requirement q
     set tipo = d.tipo,
         insurance_id = d.insurance_id,
         valor_inteiro = d.valor_inteiro,
         texto_ao_paciente = d.texto_ao_paciente,
         ativo = d.ativo
    from jsonb_to_recordset(p_itens)
           as d (id uuid, tipo text, insurance_id uuid, valor_inteiro integer,
                 texto_ao_paciente text, ativo boolean)
   where q.id = d.id
     and q.id = any (v_mudam);

  -- 9. Os novos.
  insert into public.procedure_requirement
    (clinic_id, procedure_id, insurance_id, tipo, valor_inteiro, texto_ao_paciente, ativo)
  select v_clinic_id, p_procedure_id, d.insurance_id, d.tipo, d.valor_inteiro,
         d.texto_ao_paciente, d.ativo
    from jsonb_to_recordset(p_itens)
           as d (id uuid, tipo text, insurance_id uuid, valor_inteiro integer,
                 texto_ao_paciente text, ativo boolean)
   where d.id is null;
  get diagnostics v_criados = row_count;

  -- 10. A trilha, so quando algo mudou: quem, quando e qual procedimento,
  -- nunca o conteudo.
  if v_apagados + cardinality(v_mudam) + v_criados > 0 then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (v_clinic_id, auth.uid(), 'editou_requisitos_do_procedimento', 'procedure', p_procedure_id);
  end if;

  return jsonb_build_object(
    'apagados', v_apagados,
    'alterados', cardinality(v_mudam),
    'criados', v_criados,
    'requisitos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'procedure_id', q.procedure_id, 'insurance_id', q.insurance_id,
               'tipo', q.tipo, 'valor_inteiro', q.valor_inteiro,
               'texto_ao_paciente', q.texto_ao_paciente, 'ativo', q.ativo)
             order by q.created_at, q.id)
        from public.procedure_requirement q
       where q.procedure_id = p_procedure_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.salvar_requisitos_do_procedimento(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.salvar_requisitos_do_procedimento(uuid, jsonb, uuid[]) to authenticated, service_role;

comment on function public.salvar_requisitos_do_procedimento(uuid, jsonb, uuid[]) is
  'O Salvar de "O que o paciente precisa" de um procedimento, numa transacao so (migration 20261027100000_cadastro_para_o_agente.sql): apaga o que estava na abertura (p_ids_na_abertura) e saiu da lista, desativa antes os ativos que mudam de tipo ou de convenio (a troca nao bate no indice unico), grava os valores finais, cria os novos e grava a trilha editou_requisitos_do_procedimento quando algo mudou; o que outra pessoa criou com o modal aberto fica. Tudo ou nada. Com sessao, administrador ou gestor ativo da clinica do procedimento com escrita (a policy de escrita da tabela); sem sessao, service role e SQL editor; o resto 42501. 22004, P0002, 22023 (forma), 23514 (regras dos CHECKs), 23505 (dois ativos do mesmo tipo e convenio), 23503 (convenio de outra clinica) e CZ409 (o cadastro mudou desde que o modal abriu); nunca 40001 nem 40P01. Devolve {apagados, alterados, criados, requisitos}. SECURITY DEFINER.';
