-- ---------------------------------------------------------------------------
-- Saldo de pacote sem edicao direta pela API
-- ---------------------------------------------------------------------------
-- Revisao adversarial da leva de 29/09/2026 (fatia pacote-banco, achados 0 e
-- 1; o achado 0 da fatia pacote-tela e o mesmo). Pressupoe a
-- 20260929120000_pacote_com_varios_procedimentos.sql aplicada (producao
-- desde 29/09) e NAO a edita.
--
-- O que faz:
--
--   1. package_balance_item: UPDATE pela sessao so em sessions_used.
--      A 120000 fechou a edicao direta em package_balance (so expires_at
--      ficou), mas o saldo de verdade mora no item, e ali authenticated
--      tinha UPDATE em todas as colunas. Pela API, a recepcao aumentava
--      sessions_total de um item vendido (5 sessoes viravam 50; o espelho
--      legado levava a diferenca para package_balance) ou trocava o
--      procedimento, sem nenhuma linha em package_balance_adjustment.
--      Agora sessions_total, procedure_id, package_balance_id e clinic_id do
--      item nascem no INSERT da venda e so mudam pelos caminhos SECURITY
--      DEFINER (debito do Compareceu e espelhos legados).
--      sessions_used continua com UPDATE porque ajustar_saldo_de_pacote (as
--      duas assinaturas, SECURITY INVOKER) grava essa coluna pela sessao de
--      quem chama. updated_at vem do gatilho set_updated_at, e mudanca feita
--      por gatilho em NEW nao passa por privilegio de coluna.
--      Conferido em 02/10/2026 (pg_get_functiondef no banco e grep em app,
--      lib, components, scripts e tests, no codigo novo e no de HEAD que
--      roda em producao): nenhum caminho pela sessao grava outra coluna do
--      item. vender_pacote so insere; cancelar_venda_de_pacote so apaga;
--      consumir_sessao_de_pacote, criar_itens_da_venda_legada e
--      espelhar_totais_no_saldo_legado sao DEFINER; o codigo de HEAD vende
--      por INSERT em package_balance (o item nasce no gatilho DEFINER),
--      ajusta pela assinatura antiga e cancela pela RPC; fixtures e testes
--      escrevem no item com service_role.
--
--   2. appointment: o desconto de pacote da consulta nao muda depois de
--      gravado. Gatilho travar_desconto_de_pacote (BEFORE UPDATE OF
--      package_balance_id, package_balance_item_id): se a consulta ja tinha
--      desconto (qualquer das duas colunas preenchida) e o comando muda
--      qualquer uma delas, recusa com 23514. Sem isso, quem tem escrita na
--      consulta (recepcao, gestao, profissional na propria agenda) limpava
--      as duas colunas de uma consulta em Compareceu pela API, e entao:
--        - cancelar_venda_de_pacote deixava de achar a consulta e cancelava
--          venda com sessao ja usada, perdendo o vinculo consulta e debito;
--        - sair de compareceu e voltar a ele debitava de novo (o retorno
--          antecipado de consumir_sessao_de_pacote depende dessas colunas).
--      Nenhum caminho legitimo muda esses valores depois de preenchidos:
--        - consumir_sessao_de_pacote so preenche quando estao null, e escreve
--          em NEW (nao entra no "OF" deste gatilho, que olha so o SET do
--          comando). Se o mesmo comando limpar as colunas e marcar
--          compareceu, o debito novo chega aqui com OLD preenchido e o
--          comando inteiro e desfeito, debito junto;
--        - cancelar_venda_de_pacote recusa a venda com consulta, o ajuste
--          nao toca em appointment, e as duas FKs sao NO ACTION (nenhum set
--          null por cascata);
--        - o backfill da 120000 so foi de null para valor, e ja rodou;
--        - remarcacao muda horario, profissional e vinculo, e
--          preparar_remarcacao recusa remarcar consulta encerrada; INSERT
--          (nova consulta, lista de espera, fixtures) nao passa por aqui;
--        - o app nunca grava essas colunas (codigo novo e o de HEAD).
--      Vale para todo papel, inclusive service_role e postgres: desconto
--      errado se corrige pelo ajuste de saldo na ficha.
--      Sem pg_trigger_depth(): o gatilho irmao consumir_sessao_de_pacote
--      roda na mesma profundidade de um UPDATE da API, entao a profundidade
--      nao separa nada (e nao precisa separar). O nome vem DEPOIS de
--      consumir_sessao_de_pacote e de exigir_cadastro_da_mesma_clinica na
--      ordem alfabetica (os BEFORE rodam assim): ve o NEW que o debito
--      montou, e o isolamento entre clinicas responde antes.
--
-- O que fica ABERTO, no mesmo nivel de antes desta leva (as RPCs SECURITY
-- INVOKER e o codigo de HEAD dependem dessas permissoes):
--   - UPDATE direto de package_balance_item.sessions_used pela recepcao e
--     gestao, sem trilha (a policy deixa; e a coluna que a RPC de ajuste
--     grava pela sessao);
--   - INSERT direto de item numa venda ja feita (vender_pacote insere os
--     itens pela sessao);
--   - DELETE direto de item pela gestao (cancelar_venda_de_pacote apaga os
--     itens pela sessao);
--   - INSERT direto em package_balance com sessions_total livre (e a venda
--     do codigo de HEAD; criar_itens_da_venda_legada copia o total para o
--     item);
--   - consulta SEM desconto pode ganhar package_balance_id ou
--     package_balance_item_id por UPDATE direto sem debitar (o Compareceu
--     dela nao desconta e a venda apontada nao se cancela).
--
-- FUTURA MIGRATION DE CONTRATO (somar a lista da 20260929120000):
--   - passar vender_pacote(uuid, uuid, date, jsonb), ajustar_saldo_de_pacote
--     (uuid, jsonb, date, text) e cancelar_venda_de_pacote(uuid, text) para
--     SECURITY DEFINER, com set search_path = public e papel e clinica
--     conferidos de forma explicita (hoje vem da RLS): user_has_role(
--     clinica da venda, admin/gestor/recepcao) no ajuste, respondendo P0002
--     a quem nao pode (nao revela venda de outra clinica); user_has_role(
--     ..., admin/gestor) no cancelamento; auth.uid() na trilha;
--   - entao revogar insert, update e delete de package_balance_item e
--     insert de package_balance para authenticated.
--
-- Rollback (reabre os dois buracos; so se esta migration quebrar algo):
--   grant update on table public.package_balance_item to authenticated;
--   drop trigger if exists travar_desconto_de_pacote on public.appointment;
--   drop function if exists public.travar_desconto_de_pacote();

-- ---------------------------------------------------------------------------
-- 1) package_balance_item: so sessions_used e editavel pela sessao
-- ---------------------------------------------------------------------------

revoke update on table public.package_balance_item from authenticated;
grant update (sessions_used) on table public.package_balance_item
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2) appointment: o desconto de pacote da consulta nao muda
-- ---------------------------------------------------------------------------

create or replace function public.travar_desconto_de_pacote()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.package_balance_id is not null
      or old.package_balance_item_id is not null)
     and (new.package_balance_id is distinct from old.package_balance_id
          or new.package_balance_item_id
               is distinct from old.package_balance_item_id)
  then
    raise exception using errcode = 'check_violation',
      message = 'O desconto de pacote desta consulta não muda. Para corrigir, ajuste o saldo na ficha do paciente.';
  end if;
  return new;
end;
$$;

-- Funcao de gatilho: ninguem chama direto (o gatilho dispara sem conferir
-- execute de quem faz o UPDATE).
revoke execute on function public.travar_desconto_de_pacote()
  from public, anon, authenticated;

drop trigger if exists travar_desconto_de_pacote on public.appointment;
create trigger travar_desconto_de_pacote
  before update of package_balance_id, package_balance_item_id
  on public.appointment
  for each row execute function public.travar_desconto_de_pacote();
