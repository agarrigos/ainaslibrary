-- Mejoras: progreso por páginas, sagas, lista de deseos, categoría de cada libro y citas favoritas.
-- Ejecutar una vez en Supabase: SQL Editor > New query > pegar y "Run".
-- Se puede volver a ejecutar sin problema.

-- 1. Nuevas columnas en los libros
alter table public.books add column if not exists total_pages   integer check (total_pages > 0);
alter table public.books add column if not exists current_page  integer check (current_page >= 0);
alter table public.books add column if not exists series        text;
alter table public.books add column if not exists series_number numeric(5,1);
alter table public.books add column if not exists category      text;

-- 2. Nuevo estado "wishlist" (lista de deseos)
alter table public.books drop constraint if exists books_status_check;
alter table public.books add constraint books_status_check
  check (status in ('pending', 'reading', 'read', 'wishlist'));

-- 2b. ¿Lo tiene? (en papel o digital). Los "deseados" son los que aún no tiene.
alter table public.books add column if not exists owned boolean not null default true;
update public.books set owned = false where status = 'wishlist' and owned;

-- 3. Rellena la categoría de los libros que vinieron de Explorar
update public.books b
   set category = c.category
  from public.catalog c
 where b.category is null
   and lower(trim(b.title)) = lower(trim(c.title))
   and lower(trim(b.author)) = lower(trim(c.author));

-- 4. Citas favoritas
create table if not exists public.quotes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id    uuid not null references public.books (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 2000),
  page       integer check (page > 0),
  created_at timestamptz not null default now()
);

create index if not exists quotes_book_idx on public.quotes (book_id, created_at desc);

revoke all on public.quotes from anon;
grant select, insert, delete on public.quotes to authenticated;

alter table public.quotes enable row level security;

drop policy if exists "quotes_select_own" on public.quotes;
drop policy if exists "quotes_insert_own" on public.quotes;
drop policy if exists "quotes_delete_own" on public.quotes;

create policy "quotes_select_own" on public.quotes
  for select to authenticated using (user_id = auth.uid());

create policy "quotes_insert_own" on public.quotes
  for insert to authenticated with check (user_id = auth.uid());

create policy "quotes_delete_own" on public.quotes
  for delete to authenticated using (user_id = auth.uid());
