-- A Tela 3 assina appointment e slot_hold por postgres_changes; sem as
-- tabelas na publicacao, o tempo real da agenda nao entrega nada (a RLS por
-- assinante continua valendo: o recorte do profissional vive na policy).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'appointment') then
      alter publication supabase_realtime add table public.appointment;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'slot_hold') then
      alter publication supabase_realtime add table public.slot_hold;
    end if;
  end if;
end;
$$;
