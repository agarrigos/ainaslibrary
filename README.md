# Aina's Library

App web (PWA) para gestionar una biblioteca personal. Frontend estático (HTML/CSS/JS) + [Supabase](https://supabase.com) como base de datos.

## Configurar Supabase (una sola vez)

1. **Crear el proyecto:** regístrate en supabase.com → *New project*. Elige una región cercana (p. ej. *West EU*) y guarda la contraseña de la base de datos.
2. **Crear las tablas:** en el panel, ve a *SQL Editor* → *New query*, pega y ejecuta (*Run*) en este orden:
   - [`supabase/schema.sql`](supabase/schema.sql) – tabla `books` (la Biblioteca de Aina)
   - [`supabase/catalog.sql`](supabase/catalog.sql) – tabla `catalog` (los libros de Explorar)
   - [`supabase/seed-dark-romance.sql`](supabase/seed-dark-romance.sql) – libros de Explorar (y cualquier otro `seed-*.sql`)
3. **Desactivar registros públicos** (para que solo entre Aina): *Authentication* → *Sign In / Providers* → desactiva *Allow new users to sign up*.
4. **Crear el usuario de Aina:** *Authentication* → *Users* → *Add user* → *Create new user*. Pon email y contraseña y marca *Auto Confirm User*.
5. **Conectar la app:** en *Project Settings* → *API* copia la *Project URL* y la clave *anon public* en [`config.js`](config.js).

## Probar en local

Abre `index.html` en el navegador, o usa la extensión *Live Server* de VS Code.

## Archivos

- `index.html` – estructura (login, biblioteca, explorar, descubrir, perfil, formularios)
- `styles.css` – diseño
- `app.js` – lógica: login, biblioteca (añadir/editar/borrar), explorar (añadir a la biblioteca), búsqueda, pestañas
- `config.js` – datos de conexión a Supabase
- `supabase/schema.sql` – tabla `books` (Biblioteca) y reglas de seguridad
- `supabase/catalog.sql` – tabla `catalog` (Explorar), solo lectura desde la app
- `supabase/seed-*.sql` – libros de cada categoría para Explorar
- `supabase/mover-a-explorar.sql` – migración de un solo uso (ya no hace falta en instalaciones nuevas)
