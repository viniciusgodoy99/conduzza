-- Cor de cada numero de WhatsApp (pedido do dono em 06/10/2026, escopo novo
-- autorizado por ele). Clinica com um numero por medico confundia as
-- conversas: a cor marca o numero no topo da conversa, no cartao da lista,
-- perto do campo de resposta, no filtro "Numero" e em Configuracoes.
--
-- Paleta FIXA com nome (decisao do dono): azul, rosa, verde, roxo, turquesa
-- e laranja. A lista vive aqui (CHECK) e em lib/domain/cor-do-numero.ts; os
-- tons, com contraste conferido no claro e no escuro, em app/globals.css
-- (--numero-<cor> e --numero-<cor>-bg, tests/unit/design/contrast.test.ts).
-- A cor nunca carrega sozinha o significado: o nome do numero vem sempre
-- escrito (CLAUDE.md, regra 5).
--
-- Sem indice unico de cor: a clinica nao tem limite de numeros (decisao 4 do
-- docs/07) e a paleta tem 6. A tela sugere a primeira cor livre e avisa
-- quando a escolhida ja e de outro numero.
--
-- whatsapp_account e tabela quente (toda reserva de slot de envio faz UPDATE
-- nela, achado 6 do docs/07): o ADD COLUMN com padrao constante e so
-- catalogo, e o aplicador roda com lock_timeout curto. Quem escreve a cor e
-- o mesmo de quem escreve o nome: o servidor (service role), pelas acoes de
-- Configuracoes, para administrador e gestor. Nenhuma policy nova: a RLS de
-- whatsapp_account continua so com SELECT para membro ativo.

alter table public.whatsapp_account
  add column cor text not null default 'azul';

alter table public.whatsapp_account
  add constraint whatsapp_account_cor_da_paleta
  check (cor in ('azul', 'rosa', 'verde', 'roxo', 'turquesa', 'laranja'));

comment on column public.whatsapp_account.cor is
  'Cor do numero na tela (paleta fixa: azul, rosa, verde, roxo, turquesa, laranja). So identifica o numero; o nome vem sempre escrito.';

-- Valor inicial: dentro de cada clinica, os ativos primeiro (o principal,
-- depois por ordem de cadastro) e os removidos por ultimo, cada um com a
-- proxima cor da paleta. O primeiro de cada clinica fica com o padrao sem
-- UPDATE (nenhum evento de Realtime para a clinica de um numero so).
update public.whatsapp_account a
   set cor = (array['azul', 'rosa', 'verde', 'roxo', 'turquesa', 'laranja'])
             [((o.n - 1) % 6) + 1]
  from (
    select w.id,
           row_number() over (
             partition by w.clinic_id
             order by (w.removido_em is null) desc, w.principal desc,
                      w.created_at, w.id
           ) as n
      from public.whatsapp_account w
  ) o
 where o.id = a.id
   and o.n > 1;
