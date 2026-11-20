-- =====================================================================
--  Trix Motors · Cadastro com aprovação do administrador
--  Rode DEPOIS do setup.sql: Supabase → SQL Editor → New query →
--  cole TUDO → Run. Pode rodar de novo sem problema.
--
--  Como funciona:
--  1. A pessoa toca em "Criar conta" no app e preenche nome, e-mail e senha.
--  2. O banco cria um pedido (tabela solicitacoes) automaticamente.
--  3. O administrador aprova ou recusa na aba "Usuários" do app.
--  4. Só depois de aprovada a pessoa vê e salva vendas.
-- =====================================================================

-- 1) Pedidos de acesso ---------------------------------------------------------
create table if not exists public.solicitacoes (
  email      text primary key,
  nome       text,
  status     text not null default 'pendente' check (status in ('pendente', 'recusado')),
  criado_em  timestamptz not null default now()
);

alter table public.solicitacoes enable row level security;
grant select on public.solicitacoes to authenticated;
revoke all on public.solicitacoes from anon;

drop policy if exists "ve o proprio pedido ou admin ve todos" on public.solicitacoes;
create policy "ve o proprio pedido ou admin ve todos" on public.solicitacoes
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.eh_admin());

-- O administrador também enxerga a lista completa de membros
drop policy if exists "admin ve todos os membros" on public.membros;
create policy "admin ve todos os membros" on public.membros
  for select to authenticated using (public.eh_admin());

-- 2) Cada conta nova vira um pedido automaticamente -----------------------------
create or replace function public.nova_solicitacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null then return new; end if;
  if exists (select 1 from public.membros where lower(email) = lower(new.email)) then
    return new;  -- já é membro (ex.: criado pelo painel): não precisa de pedido
  end if;
  insert into public.solicitacoes (email, nome)
  values (lower(new.email),
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), split_part(new.email, '@', 1)))
  on conflict (email) do update
    set nome = excluded.nome, status = 'pendente', criado_em = now();
  return new;
end $$;

drop trigger if exists trix_nova_solicitacao on auth.users;
create trigger trix_nova_solicitacao
  after insert on auth.users
  for each row execute function public.nova_solicitacao();

-- 3) Ações do administrador -----------------------------------------------------
create or replace function public.aprovar_usuario(p_email text, p_admin boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if not public.eh_admin() then raise exception 'Somente o administrador pode aprovar usuários.'; end if;
  select nome into v_nome from public.solicitacoes where lower(email) = lower(p_email);
  insert into public.membros (email, nome, admin)
  values (lower(p_email), coalesce(v_nome, split_part(p_email, '@', 1)), coalesce(p_admin, false))
  on conflict (email) do update set admin = excluded.admin;
  delete from public.solicitacoes where lower(email) = lower(p_email);
end $$;

create or replace function public.recusar_usuario(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente o administrador pode recusar usuários.'; end if;
  update public.solicitacoes set status = 'recusado' where lower(email) = lower(p_email);
end $$;

create or replace function public.remover_usuario(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente o administrador pode remover usuários.'; end if;
  if lower(p_email) = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Você não pode remover o seu próprio acesso.';
  end if;
  delete from public.membros where lower(email) = lower(p_email);
end $$;

create or replace function public.definir_admin(p_email text, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente o administrador pode mudar permissões.'; end if;
  if lower(p_email) = lower(coalesce(auth.jwt() ->> 'email', '')) and not p_admin then
    raise exception 'Você não pode tirar o seu próprio acesso de administrador.';
  end if;
  update public.membros set admin = p_admin where lower(email) = lower(p_email);
end $$;

revoke all on function public.aprovar_usuario(text, boolean) from public, anon;
revoke all on function public.recusar_usuario(text)          from public, anon;
revoke all on function public.remover_usuario(text)          from public, anon;
revoke all on function public.definir_admin(text, boolean)   from public, anon;
grant execute on function public.aprovar_usuario(text, boolean) to authenticated;
grant execute on function public.recusar_usuario(text)          to authenticated;
grant execute on function public.remover_usuario(text)          to authenticated;
grant execute on function public.definir_admin(text, boolean)   to authenticated;

-- 4) Lista de pedidos atualiza ao vivo para o administrador ----------------------
do $$
begin
  begin alter publication supabase_realtime add table public.solicitacoes; exception when others then null; end;
  begin alter publication supabase_realtime add table public.membros;      exception when others then null; end;
end $$;
