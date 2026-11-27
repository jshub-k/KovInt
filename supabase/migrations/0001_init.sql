-- =====================================================================
-- KovInt · esquema Supabase
-- Projeto novo: rodar no SQL Editor ou como migration.
-- =====================================================================

-- ── perfis ────────────────────────────────────────────────────────────
do $$ begin
  create type public.papel as enum ('viewer','contributor','editor','admin','owner');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  name       text not null default '',
  role       public.papel not null default 'viewer',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cria perfil automaticamente para novos usuários @kovi.com.br
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email not ilike '%@kovi.com.br' then
    raise exception 'Acesso restrito a contas @kovi.com.br';
  end if;
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helpers
create or replace function public.my_role() returns public.papel
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ── docs (generic key-value store – substitui todas as collections do artefato) ──
create table if not exists public.docs (
  collection  text not null,
  id          text not null,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id),
  primary key (collection, id)
);

create index if not exists docs_collection_idx on public.docs (collection);
create index if not exists docs_updated_idx    on public.docs (updated_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.docs      enable row level security;

-- profiles
create policy profiles_read   on public.profiles for select using (true);
create policy profiles_self   on public.profiles for update using (id = auth.uid());
create policy profiles_admin  on public.profiles for all using (public.my_role() in ('admin','owner'));

-- docs: authenticated users read; contributors+ write; admin/owner delete
create policy docs_read   on public.docs for select using (auth.role() = 'authenticated');
create policy docs_write  on public.docs for insert with check (
  public.my_role() in ('contributor','editor','admin','owner')
);
create policy docs_update on public.docs for update using (
  public.my_role() in ('contributor','editor','admin','owner')
);
create policy docs_delete on public.docs for delete using (
  public.my_role() in ('admin','owner')
    or (updated_by = auth.uid() and public.my_role() in ('editor','contributor'))
);

-- ── Storage ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 20971520)
on conflict (id) do nothing;

create policy arq_read on storage.objects for select using (
  bucket_id = 'documentos' and auth.role() = 'authenticated'
);
create policy arq_upload on storage.objects for insert with check (
  bucket_id = 'documentos' and auth.role() = 'authenticated'
);
create policy arq_delete on storage.objects for delete using (
  bucket_id = 'documentos' and (
    owner = auth.uid()
    or public.my_role() in ('admin','owner')
  )
);

-- ── Realtime ──────────────────────────────────────────────────────────
-- Habilite manualmente no dashboard: Database → Replication → docs, profiles
-- ou rode:
-- alter publication supabase_realtime add table public.docs, public.profiles;
