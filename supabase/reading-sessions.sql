-- Sesiones de lectura (pestaña "Lectura").
-- Ejecutar una vez en Supabase: SQL Editor > New query > pegar y "Run".

create table if not exists public.reading_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id          uuid references public.books (id) on delete set null,
  book_title       text,            -- se guarda aparte para no perder el historial si se borra el libro
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  created_at       timestamptz not null default now()
);

create index if not exists reading_sessions_user_idx on public.reading_sessions (user_id, started_at desc);

revoke all on public.reading_sessions from anon;
grant select, insert, delete on public.reading_sessions to authenticated;

alter table public.reading_sessions enable row level security;

drop policy if exists "sessions_select_own" on public.reading_sessions;
drop policy if exists "sessions_insert_own" on public.reading_sessions;
drop policy if exists "sessions_delete_own" on public.reading_sessions;

create policy "sessions_select_own" on public.reading_sessions
  for select to authenticated using (user_id = auth.uid());

create policy "sessions_insert_own" on public.reading_sessions
  for insert to authenticated with check (user_id = auth.uid());

create policy "sessions_delete_own" on public.reading_sessions
  for delete to authenticated using (user_id = auth.uid());
