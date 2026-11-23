-- EJECUTAR UNA SOLA VEZ.
-- Quita de la Biblioteca los libros de dark romance que se cargaron al principio
-- (ahora están en Explorar, cargados con seed-dark-romance.sql), para que la
-- Biblioteca quede vacía y Aina añada los que quiera.

delete from public.books
where cover_url like 'https://covers.openlibrary.org/%';
