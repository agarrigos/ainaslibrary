-- Crear un usuario nuevo para la app (se entra con NOMBRE DE USUARIO y contraseña).
--
-- 1. Cambia los dos valores de abajo:
--      usuario     -> el nombre de usuario (minúsculas, sin espacios; letras, números, . _ -)
--      contrasena  -> la contraseña que quieras
-- 2. Ejecuta en Supabase: SQL Editor > New query > pegar y "Run".
-- 3. Listo: en la app se entra con ese usuario y esa contraseña. Su biblioteca empieza vacía y es solo suya.
--
-- Por dentro, el correo de la cuenta es <usuario>@ainaslibrary.invalid (no existe ni recibe correos).
-- Ojo: la app está en internet; cuanto más fácil sea la contraseña, más fácil es que alguien la adivine.

do $$
declare
  usuario     text := 'aina';
  contrasena  text := 'CAMBIA_ESTA_CONTRASEÑA';
  correo      text;
  uid         uuid := gen_random_uuid();
begin
  usuario := lower(trim(usuario));
  if usuario !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Usuario no válido: usa entre 3 y 30 letras minúsculas, números, punto, guion o guion bajo';
  end if;
  if contrasena like 'CAMBIA\_ESTA%' or length(contrasena) < 4 then
    raise exception 'Pon una contraseña (de al menos 4 caracteres) en la línea "contrasena"';
  end if;
  correo := usuario || '@ainaslibrary.invalid';

  if exists (select 1 from auth.users where lower(email) = correo) then
    raise exception 'Ya existe el usuario "%". Para cambiarle la contraseña, usa las líneas del final de este archivo.', usuario;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', correo,
    crypt(contrasena, gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('username', usuario),
    now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), uid, uid::text, 'email',
    jsonb_build_object('sub', uid::text, 'email', correo, 'email_verified', true),
    now(), now(), now()
  );

  raise notice 'Listo: ya se puede entrar con el usuario "%"', usuario;
end $$;

-- Para cambiar la contraseña de un usuario más adelante (cambia los dos valores y ejecuta solo estas líneas,
-- quitando los dos guiones del principio):
-- update auth.users
--    set encrypted_password = crypt('NUEVA_CONTRASEÑA', gen_salt('bf')), updated_at = now()
--  where email = 'aina@ainaslibrary.invalid';
