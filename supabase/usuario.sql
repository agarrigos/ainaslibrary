-- Cambiar el inicio de sesión de correo a NOMBRE DE USUARIO, sin crear una cuenta nueva
-- (se mantiene el mismo usuario, así que se conservan sus libros, lecturas y foto).
--
-- 1. Cambia los dos valores de abajo:
--      correo_actual  -> el correo con el que entra ahora
--      usuario        -> el nombre de usuario que quieres (minúsculas, sin espacios; letras, números, . _ -)
-- 2. Ejecuta en Supabase: SQL Editor > New query > pegar y "Run".
-- 3. A partir de ahí, en la app se entra con el usuario y la MISMA contraseña.
--
-- El correo interno queda como <usuario>@ainaslibrary.invalid. El dominio .invalid está reservado:
-- nadie puede registrarlo y nunca llega ningún correo (por eso la recuperación de contraseña por
-- email deja de funcionar; para cambiar la contraseña, ver el final de este archivo).

do $$
declare
  correo_actual text := 'CORREO_ACTUAL@ejemplo.com';
  usuario       text := 'aina';
  nuevo_correo  text;
  uid           uuid;
begin
  usuario := lower(trim(usuario));
  if usuario !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Usuario no válido: usa entre 3 y 30 letras minúsculas, números, punto, guion o guion bajo';
  end if;
  nuevo_correo := usuario || '@ainaslibrary.invalid';

  select id into uid from auth.users where lower(email) = lower(trim(correo_actual));
  if uid is null then
    raise exception 'No hay ningún usuario con el correo %', correo_actual;
  end if;
  if exists (select 1 from auth.users where lower(email) = nuevo_correo and id <> uid) then
    raise exception 'Ese nombre de usuario ya está en uso';
  end if;

  update auth.users
     set email = nuevo_correo,
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', usuario),
         updated_at = now()
   where id = uid;

  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', nuevo_correo),
         updated_at = now()
   where user_id = uid and provider = 'email';

  raise notice 'Listo: ahora se entra con el usuario "%"', usuario;
end $$;

-- Para cambiar la contraseña más adelante (cambia los dos valores y ejecuta solo estas líneas):
-- update auth.users
--    set encrypted_password = crypt('NUEVA_CONTRASEÑA', gen_salt('bf')), updated_at = now()
--  where email = 'aina@ainaslibrary.invalid';
