# Aina's Library

App web (PWA) para gestionar una biblioteca personal. Frontend estático (HTML/CSS/JS) + [Supabase](https://supabase.com) como base de datos.

## Configurar Supabase (una sola vez)

1. **Crear el proyecto:** regístrate en supabase.com → *New project*. Elige una región cercana (p. ej. *West EU*) y guarda la contraseña de la base de datos.
2. **Crear las tablas:** en el panel, ve a *SQL Editor* → *New query*, pega y ejecuta (*Run*) en este orden:
   - [`supabase/schema.sql`](supabase/schema.sql) – tabla `books` (la Biblioteca de Aina)
   - [`supabase/catalog.sql`](supabase/catalog.sql) – tabla `catalog` (los libros de Explorar)
   - [`supabase/seed-dark-romance.sql`](supabase/seed-dark-romance.sql) – libros de Explorar (y cualquier otro `seed-*.sql`)
   - [`supabase/avatars.sql`](supabase/avatars.sql) – espacio privado para la foto de perfil
   - [`supabase/reading-sessions.sql`](supabase/reading-sessions.sql) – sesiones de la pestaña Lectura
   - [`supabase/mejoras.sql`](supabase/mejoras.sql) – progreso por páginas, sagas, «Lo tengo» y deseados, categorías y citas
   - [`supabase/limpieza-catalogo.sql`](supabase/limpieza-catalogo.sql) – corrige categorías, títulos y autores del catálogo (solo si ya ejecutaste `seed-categorias-3.sql` antes de la corrección)
   - [`supabase/sagas.sql`](supabase/sagas.sql) – saga y tomo de los libros de Explorar (para «Agrupar por: Saga»)
3. **Desactivar registros públicos** (para que solo entre Aina): *Authentication* → *Sign In / Providers* → desactiva *Allow new users to sign up*.
4. **Crear el usuario de Aina:** *Authentication* → *Users* → *Add user* → *Create new user*. Pon email y contraseña y marca *Auto Confirm User*. Después, para entrar con nombre de usuario en vez de correo, rellena y ejecuta [`supabase/usuario.sql`](supabase/usuario.sql).
5. **Conectar la app:** en *Project Settings* → *API* copia la *Project URL* y la clave *anon public* en [`config.js`](config.js).

## Probar en local

Abre `index.html` en el navegador, o usa la extensión *Live Server* de VS Code.

## Archivos

- `index.html` – estructura (login, biblioteca, explorar, lectura, perfil, formularios)
- `styles.css` – diseño
- `app.js` – lógica: login, biblioteca (añadir/editar/borrar), explorar (añadir a la biblioteca), búsqueda, pestañas
- `config.js` – datos de conexión a Supabase
- `sw.js` – service worker: abre la app al instante, funciona sin conexión y guarda las portadas
- `icon-180.jpg`, `icon-192.jpg`, `icon-512.jpg`, `jack-240.jpg` – el icono en tamaños ligeros (el original es `icon.png.jpg`)
- `supabase/schema.sql` – tabla `books` (Biblioteca) y reglas de seguridad
- `supabase/catalog.sql` – tabla `catalog` (Explorar), solo lectura desde la app
- `supabase/seed-*.sql` – libros de cada categoría para Explorar
- `supabase/avatars.sql` – almacenamiento privado de la foto de perfil (Supabase Storage)
- `supabase/reading-sessions.sql` – tabla `reading_sessions` (temporizador de Lectura)
- `supabase/mejoras.sql` – columnas de progreso, saga y categoría, «Lo tengo» (`owned`), estado «deseado» y tabla `quotes` (citas)
- `supabase/usuario.sql` – cambia el inicio de sesión de correo a nombre de usuario (se ejecuta una vez, con los valores rellenados)
- `supabase/mover-a-explorar.sql` – migración de un solo uso (ya no hace falta en instalaciones nuevas)
