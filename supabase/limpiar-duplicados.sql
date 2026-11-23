-- Elimina los duplicados en inglés de los libros que tienen título distinto en español.
-- Se puede ejecutar sin riesgo aunque no haya duplicados (en ese caso no borra nada).

-- 1) Explorar: quitar la versión en inglés de los 7 libros traducidos
delete from public.catalog
where title in (
  'Haunting Adeline',
  'Hunting Adeline',
  'Captive in the Dark',
  'Den of Vipers',
  'The Sweetest Oblivion',
  'The Maddest Obsession',
  'The Never King'
);

-- 2) Biblioteca: quitar los libros de la carga inicial (si no se ejecutó mover-a-explorar.sql)
delete from public.books
where cover_url like 'https://covers.openlibrary.org/%';

-- 3) Comprobación: debería mostrar catalogo = 22 y biblioteca = 0
select
  (select count(*) from public.catalog) as catalogo,
  (select count(*) from public.books)   as biblioteca;
