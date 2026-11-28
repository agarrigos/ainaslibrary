-- Dejar una cuenta como recién creada, como si nunca hubiera entrado en la app:
-- vuelve a salir la guía completa de Jack (y la felicitación de cumpleaños, en la cuenta «aina») y se
-- borran las preferencias guardadas (reto anual, categorías y escritores favoritos, regalos canjeados...).
--
-- 1. Cambia el usuario de abajo si no es «aina».
-- 2. Ejecuta en Supabase: SQL Editor > New query > pegar y "Run".
-- 3. Si también quieres borrar lo que se añadió al probar (libros, lecturas, citas), mira el PASO 2 al final.
--
-- No cambia el usuario ni la contraseña. Después, cierra sesión en la app y vuelve a entrar
-- (o entra por primera vez): la guía sale al iniciar sesión.

-- PASO 1: preferencias de la cuenta (guía, cumpleaños, reto, favoritos, regalos...)
update auth.users
   set raw_user_meta_data = jsonb_build_object('username', 'aina'),
       updated_at = now()
 where email = 'aina@ainaslibrary.invalid';

-- Comprobación: debe salir una fila con solo {"username": "aina"}
select email, raw_user_meta_data from auth.users where email = 'aina@ainaslibrary.invalid';


-- PASO 2 (opcional): borrar también los datos que se añadieron al probar con su cuenta.
-- ¡Esto no se puede deshacer! Para ejecutarlo, quita los dos guiones del principio de cada línea.
--
-- delete from public.quotes           where user_id = (select id from auth.users where email = 'aina@ainaslibrary.invalid');
-- delete from public.reading_sessions where user_id = (select id from auth.users where email = 'aina@ainaslibrary.invalid');
-- delete from public.books            where user_id = (select id from auth.users where email = 'aina@ainaslibrary.invalid');
