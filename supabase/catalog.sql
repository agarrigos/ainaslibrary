-- Catálogo de "Explorar": libros disponibles para añadir a la biblioteca.
-- Ejecutar una vez en Supabase: SQL Editor > New query > pegar y "Run".
-- Solo se modifica desde el SQL Editor (archivos seed-*.sql); desde la app solo se puede leer.

create table if not exists public.catalog (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  author     text not null default '',
  cover_url  text,
  category   text not null,
  created_at timestamptz not null default now(),
  unique (title, author)
);

create index if not exists catalog_category_idx on public.catalog (category, title);

revoke all on public.catalog from anon, authenticated;
grant select on public.catalog to authenticated;

alter table public.catalog enable row level security;

drop policy if exists "catalog_select_authenticated" on public.catalog;
create policy "catalog_select_authenticated" on public.catalog
  for select to authenticated using (true);
