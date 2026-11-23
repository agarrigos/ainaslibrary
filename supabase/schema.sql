-- Esquema de Aina's Library
-- Ejecutar una sola vez en Supabase: panel > SQL Editor > New query > pegar y "Run".

create table if not exists public.books (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  author      text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'reading', 'read')),
  rating      smallint check (rating between 1 and 5),
  notes       text not null default '',
  cover_color text not null default '#b9c7d8',
  cover_url   text,
  finished_at date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists books_user_id_idx on public.books (user_id, created_at desc);

-- Actualiza updated_at automáticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists books_set_updated_at on public.books;
create trigger books_set_updated_at
  before update on public.books
  for each row execute function public.set_updated_at();

-- Seguridad: solo usuarios con sesión iniciada pueden usar la tabla...
revoke all on public.books from anon;
grant select, insert, update, delete on public.books to authenticated;

-- ...y cada usuario solo puede ver y modificar sus propios libros
alter table public.books enable row level security;

drop policy if exists "books_select_own" on public.books;
drop policy if exists "books_insert_own" on public.books;
drop policy if exists "books_update_own" on public.books;
drop policy if exists "books_delete_own" on public.books;

create policy "books_select_own" on public.books
  for select to authenticated using (user_id = auth.uid());

create policy "books_insert_own" on public.books
  for insert to authenticated with check (user_id = auth.uid());

create policy "books_update_own" on public.books
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "books_delete_own" on public.books
  for delete to authenticated using (user_id = auth.uid());
