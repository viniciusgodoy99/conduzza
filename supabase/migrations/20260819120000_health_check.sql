-- Tabela de fumaca da tarefa 0.2: prova a conexao server-side e serve de
-- verificacao de disponibilidade (reaproveitada pela observabilidade em 6.1).
-- Nao e tabela de negocio: nao tem clinic_id, mas RLS fica ligada mesmo assim.

create table public.health_check (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  created_at timestamptz not null default now()
);

alter table public.health_check enable row level security;

create policy "leitura liberada para autenticados e anonimos"
  on public.health_check for select
  to authenticated, anon
  using (true);

insert into public.health_check (label)
values ('Conexão com o banco funcionando');
