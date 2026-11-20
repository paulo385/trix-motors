-- =====================================================================
--  Trix Motors · Venda e Impostos — banco de dados (Supabase)
--  Como usar: Supabase → SQL Editor → New query → cole TUDO → Run.
--  Pode rodar de novo sem problema: ele não apaga dados.
-- =====================================================================

-- 1) Quem pode usar o app ------------------------------------------------
--    Só e-mails cadastrados aqui conseguem ver e salvar vendas,
--    mesmo que alguém crie uma conta por fora.
create table if not exists public.membros (
  email      text primary key,
  nome       text,
  admin      boolean not null default false,   -- admin pode alterar as alíquotas
  criado_em  timestamptz not null default now()
);

-- 2) Dados do app ---------------------------------------------------------
create table if not exists public.vendas (
  id             text primary key,
  empresa        text not null,
  data_venda     date,
  placa          text,
  doc            jsonb not null,                -- venda completa (cliente, veículo, valores, alíquotas)
  criado_por     text default (auth.jwt() ->> 'email'),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists vendas_empresa_data_idx on public.vendas (empresa, data_venda);

create table if not exists public.fechamentos (
  id             text primary key,              -- ex.: TRIX-2026-T3
  doc            jsonb not null,
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.config (
  id             text primary key,              -- 'aliquotas'
  doc            jsonb not null,
  atualizado_em  timestamptz not null default now()
);

-- 3) Funções de apoio ------------------------------------------------------
create or replace function public.eh_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membros
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membros
                 where admin and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- Usada pelo GitHub (a cada 3 dias) para o banco grátis não ser pausado por falta de uso.
-- Não devolve nenhum dado.
create or replace function public.ping() returns integer
language sql stable security definer set search_path = public as $$
  select 1 + 0 * (select count(*) from public.config)::int;
$$;
grant execute on function public.ping() to anon, authenticated;

-- 4) Regras de acesso (Row Level Security) ---------------------------------
alter table public.membros     enable row level security;
alter table public.vendas      enable row level security;
alter table public.fechamentos enable row level security;
alter table public.config      enable row level security;

drop policy if exists "membro ve o proprio cadastro" on public.membros;
create policy "membro ve o proprio cadastro" on public.membros
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "membros leem vendas"     on public.vendas;
drop policy if exists "membros criam vendas"    on public.vendas;
drop policy if exists "membros alteram vendas"  on public.vendas;
drop policy if exists "membros apagam vendas"   on public.vendas;
create policy "membros leem vendas"    on public.vendas for select to authenticated using (public.eh_membro());
create policy "membros criam vendas"   on public.vendas for insert to authenticated with check (public.eh_membro());
create policy "membros alteram vendas" on public.vendas for update to authenticated using (public.eh_membro()) with check (public.eh_membro());
create policy "membros apagam vendas"  on public.vendas for delete to authenticated using (public.eh_membro());

drop policy if exists "membros leem fechamentos"   on public.fechamentos;
drop policy if exists "membros gravam fechamentos" on public.fechamentos;
drop policy if exists "membros alteram fechamentos" on public.fechamentos;
create policy "membros leem fechamentos"    on public.fechamentos for select to authenticated using (public.eh_membro());
create policy "membros gravam fechamentos"  on public.fechamentos for insert to authenticated with check (public.eh_membro());
create policy "membros alteram fechamentos" on public.fechamentos for update to authenticated using (public.eh_membro()) with check (public.eh_membro());

drop policy if exists "membros leem config"  on public.config;
drop policy if exists "admin grava config"   on public.config;
drop policy if exists "admin altera config"  on public.config;
create policy "membros leem config" on public.config for select to authenticated using (public.eh_membro());
create policy "admin grava config"  on public.config for insert to authenticated with check (public.eh_admin());
create policy "admin altera config" on public.config for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- 5) Atualização ao vivo entre aparelhos -----------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.vendas;      exception when others then null; end;
  begin alter publication supabase_realtime add table public.fechamentos; exception when others then null; end;
  begin alter publication supabase_realtime add table public.config;      exception when others then null; end;
end $$;

-- 6) CADASTRE AQUI QUEM PODE USAR O APP -------------------------------------
--    Troque pelos e-mails reais. Depois crie a senha de cada um em
--    Authentication → Users → Add user (mesmo e-mail).
--    admin = true pode alterar as alíquotas.
insert into public.membros (email, nome, admin) values
  ('seu-email@exemplo.com', 'Paulo', true)
  -- , ('vendedor@exemplo.com', 'Vendedor 1', false)
on conflict (email) do update set nome = excluded.nome, admin = excluded.admin;
