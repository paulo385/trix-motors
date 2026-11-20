-- =====================================================================
--  Trix Motors · Privacidade: retenção, exclusão, auditoria e pedidos de clientes
--  Rode DEPOIS do setup.sql e do 002: Supabase → SQL Editor → New query →
--  cole TUDO → Run (confirme o aviso). Pode rodar de novo sem problema.
--
--  O que este script faz:
--  1. "Remover acesso" passa a apagar também a conta de login da pessoa.
--  2. Limpeza diária: pedidos recusados há mais de 30 dias e contas sem acesso.
--  3. Anonimização anual: vendas cujo prazo de guarda fiscal acabou perdem os
--     dados do cliente (ficam só os valores para relatórios).
--  4. Registro de auditoria (só inclusão): quem criou, alterou ou apagou
--     vendas, aprovou ou removeu usuários e mudou alíquotas.
--  5. Funções para atender pedidos de clientes (apagar contato ou anonimizar).
-- =====================================================================

-- 0) Quem pode rodar as rotinas administrativas ------------------------------
--    Administrador logado no app, ou o próprio banco (rotina agendada, sem login).
create or replace function public.pode_administrar() returns boolean
language sql stable security definer set search_path = public as $$
  select case when coalesce(auth.jwt() ->> 'email', '') = '' then current_user in ('postgres', 'supabase_admin')
              else public.eh_admin() end;
$$;

-- 1) Remover acesso apaga também a conta de login -----------------------------
create or replace function public.remover_usuario(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Somente o administrador pode remover usuários.'; end if;
  if lower(p_email) = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Você não pode remover o seu próprio acesso.';
  end if;
  delete from public.membros      where lower(email) = lower(p_email);
  delete from public.solicitacoes where lower(email) = lower(p_email);
  begin
    delete from auth.users where lower(email) = lower(p_email);
  exception when others then
    raise notice 'Conta de login não apagada (%). Apague em Authentication → Users.', sqlerrm;
  end;
end $$;

-- 2) Limpeza de cadastros -------------------------------------------------------
create or replace function public.limpar_cadastros() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; k integer;
begin
  if not public.pode_administrar() then raise exception 'Somente o administrador.'; end if;
  -- 2a) pedidos recusados há mais de 30 dias
  with apagados as (
    delete from public.solicitacoes
     where status = 'recusado' and criado_em < now() - interval '30 days'
    returning email)
  select count(*) into k from apagados; n := n + k;
  -- 2b) contas de login sem acesso: não são membros e não têm pedido pendente (ex.: recusados, removidos)
  begin
    with apagados as (
      delete from auth.users u
       where u.created_at < now() - interval '7 days'
         and not exists (select 1 from public.membros m where lower(m.email) = lower(u.email))
         and not exists (select 1 from public.solicitacoes s where lower(s.email) = lower(u.email) and s.status = 'pendente')
      returning u.id)
    select count(*) into k from apagados; n := n + k;
  exception when others then
    raise notice 'Contas de login não apagadas: %', sqlerrm;
  end;
  -- 2c) auditoria com mais de 5 anos
  delete from public.auditoria where em < now() - interval '5 years';
  return n;
end $$;

-- 3) Anonimização de vendas após o prazo de guarda fiscal ------------------------
--    Padrão: 5 anos contados a partir do 1º dia do ano seguinte à venda
--    (referência: CTN, arts. 173 e 174 — validar com o contador).
--    Ex.: venda em 2026 → dados do cliente removidos em janeiro de 2032.
create or replace function public.anonimizar_doc(d jsonb, p_completo boolean) returns jsonb
language sql immutable as $$
  select case when p_completo then
      (d - 'cliente')
      || jsonb_build_object('cliente', jsonb_build_object('nome', '(dados removidos)', 'doc', '', 'endereco', '', 'telefone', '', 'cidade', coalesce(d #>> '{cliente,cidade}', ''), 'uf', coalesce(d #>> '{cliente,uf}', '')))
      || jsonb_build_object('veiculo', coalesce(d -> 'veiculo', '{}'::jsonb) - 'placa' - 'renavam' - 'chassi' || jsonb_build_object('placa', '', 'renavam', '', 'chassi', ''))
      || jsonb_build_object('anonimizado_em', to_char(now(), 'YYYY-MM-DD'))
    else
      jsonb_set(jsonb_set(d, '{cliente,endereco}', '""'::jsonb, true), '{cliente,telefone}', '""'::jsonb, true)
      || jsonb_build_object('contato_removido_em', to_char(now(), 'YYYY-MM-DD'))
    end;
$$;

create or replace function public.anonimizar_vendas_antigas(p_anos integer default 5) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.pode_administrar() then raise exception 'Somente o administrador.'; end if;
  if p_anos < 5 then raise exception 'O prazo mínimo é 5 anos (guarda fiscal).'; end if;
  update public.vendas
     set doc = public.anonimizar_doc(doc, true), placa = null, atualizado_em = now()
   where data_venda < make_date(extract(year from now())::int - p_anos, 1, 1)
     and not (doc ? 'anonimizado_em');
  get diagnostics n = row_count;
  return n;
end $$;

-- 4) Pedidos de clientes (direitos do titular) ------------------------------------
--    p_completo = false → apaga só endereço e telefone (não são necessários à guarda fiscal)
--    p_completo = true  → remove todos os dados do cliente e do veículo; use só quando
--                         não houver obrigação de guarda (ex.: prazo fiscal vencido)
create or replace function public.anonimizar_cliente(p_cpf text, p_completo boolean default false) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if not public.eh_admin() then raise exception 'Somente o administrador pode atender pedidos de clientes.'; end if;
  if length(v_cpf) not in (11, 14) then raise exception 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).'; end if;
  update public.vendas
     set doc = public.anonimizar_doc(doc, p_completo),
         placa = case when p_completo then null else placa end,
         atualizado_em = now()
   where regexp_replace(coalesce(doc #>> '{cliente,doc}', ''), '\D', '', 'g') = v_cpf;
  get diagnostics n = row_count;
  insert into public.auditoria (acao, tabela, registro, detalhe)
  values ('pedido_titular', 'vendas', '***' || right(v_cpf, 4), jsonb_build_object('tipo', case when p_completo then 'anonimizacao_completa' else 'remocao_contato' end, 'vendas', n));
  return n;
end $$;

-- 5) Registro de auditoria (somente inclusão) --------------------------------------
create table if not exists public.auditoria (
  id        bigint generated always as identity primary key,
  em        timestamptz not null default now(),
  quem      text default coalesce(auth.jwt() ->> 'email', current_user),
  acao      text not null,
  tabela    text not null,
  registro  text,
  detalhe   jsonb not null default '{}'::jsonb
);
create index if not exists auditoria_em_idx on public.auditoria (em desc);

alter table public.auditoria enable row level security;
revoke all on public.auditoria from anon, authenticated;
grant select on public.auditoria to authenticated;
drop policy if exists "admin le auditoria" on public.auditoria;
create policy "admin le auditoria" on public.auditoria for select to authenticated using (public.eh_admin());

-- ninguém altera ou apaga linhas pela API; só a limpeza de 5 anos (função do banco)
create or replace function public.auditoria_imutavel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then raise exception 'O registro de auditoria não pode ser alterado.'; end if;
  if tg_op = 'DELETE' and old.em >= now() - interval '5 years' then
    raise exception 'O registro de auditoria só pode ser apagado depois de 5 anos.';
  end if;
  return old;
end $$;
drop trigger if exists auditoria_imutavel on public.auditoria;
create trigger auditoria_imutavel before update or delete on public.auditoria
  for each row execute function public.auditoria_imutavel();

-- grava a ação sem copiar dados de clientes (só o identificador do registro)
create or replace function public.registrar_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reg text; v_det jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'vendas' then
    v_reg := coalesce(new.id, old.id);
    if tg_op = 'UPDATE' then
      v_det := jsonb_build_object('campos', (
        select coalesce(jsonb_agg(k), '[]'::jsonb) from (
          select key as k from jsonb_each(new.doc) n
           where n.value is distinct from (old.doc -> n.key)
          union select 'placa' where new.placa is distinct from old.placa) x));
    end if;
  elsif tg_table_name in ('membros', 'solicitacoes') then
    v_reg := coalesce(new.email, old.email);
    if tg_table_name = 'membros' and tg_op <> 'DELETE' then v_det := jsonb_build_object('admin', new.admin); end if;
    if tg_table_name = 'solicitacoes' and tg_op <> 'DELETE' then v_det := jsonb_build_object('status', new.status); end if;
  else
    v_reg := coalesce(new.id, old.id);
  end if;
  insert into public.auditoria (acao, tabela, registro, detalhe)
  values (lower(tg_op), tg_table_name, v_reg, v_det);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['vendas', 'membros', 'solicitacoes', 'config', 'fechamentos'] loop
    execute format('drop trigger if exists trix_auditoria on public.%I', t);
    execute format('create trigger trix_auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()', t);
  end loop;
end $$;

-- 6) Permissões -------------------------------------------------------------------
revoke all on function public.pode_administrar()                     from public, anon;
revoke all on function public.limpar_cadastros()                     from public, anon;
revoke all on function public.anonimizar_vendas_antigas(integer)     from public, anon;
revoke all on function public.anonimizar_cliente(text, boolean)      from public, anon;
revoke all on function public.anonimizar_doc(jsonb, boolean)         from public, anon;
revoke all on function public.registrar_auditoria()                  from public, anon, authenticated;
grant execute on function public.pode_administrar()                  to authenticated;
grant execute on function public.limpar_cadastros()                  to authenticated;
grant execute on function public.anonimizar_vendas_antigas(integer)  to authenticated;
grant execute on function public.anonimizar_cliente(text, boolean)   to authenticated;

-- 7) Agendamento automático (pg_cron) ------------------------------------------------
--    Se der erro aqui, ative a extensão em Database → Extensions → pg_cron e rode o script de novo.
do $$
begin
  create extension if not exists pg_cron;
  begin perform cron.unschedule('trix-limpeza-diaria');   exception when others then null; end;
  begin perform cron.unschedule('trix-anonimizar-anual'); exception when others then null; end;
  perform cron.schedule('trix-limpeza-diaria',   '17 6 * * *', 'select public.limpar_cadastros()');          -- todo dia, 03:17 de Brasília
  perform cron.schedule('trix-anonimizar-anual', '23 7 2 1 *', 'select public.anonimizar_vendas_antigas(5)'); -- 2 de janeiro, 04:23 de Brasília
exception when others then
  raise notice 'Agendamento não criado (%). Ative pg_cron em Database → Extensions e rode de novo.', sqlerrm;
end $$;
