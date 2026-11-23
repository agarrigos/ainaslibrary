-- Libros de la categoría "Dark romance" para Explorar (portadas de Open Library)
-- Títulos de la edición en español; si la edición española conserva el título original
-- o el libro no está publicado en español, se deja el título original.
-- Requiere haber ejecutado antes catalog.sql.
-- Ejecutar en Supabase: SQL Editor > New query > pegar y "Run". Se puede repetir sin duplicar.

insert into public.catalog (title, author, cover_url, category)
values
  ('Haunting Adeline. Nunca te dejaré', 'H. D. Carlton',    'https://covers.openlibrary.org/b/id/12992962-L.jpg', 'Dark romance'),
  ('Hunting Adeline. Te encontraré',    'H. D. Carlton',    'https://covers.openlibrary.org/b/id/14614757-L.jpg', 'Dark romance'),
  ('Corrupt',               'Penelope Douglas', 'https://covers.openlibrary.org/b/id/10226443-L.jpg', 'Dark romance'),
  ('Hideaway',              'Penelope Douglas', 'https://covers.openlibrary.org/b/id/9185661-L.jpg',  'Dark romance'),
  ('Credence',              'Penelope Douglas', 'https://covers.openlibrary.org/b/id/11311896-L.jpg', 'Dark romance'),
  ('Punk 57',               'Penelope Douglas', 'https://covers.openlibrary.org/b/id/10107803-L.jpg', 'Dark romance'),
  ('Cautiva en la oscuridad',           'C. J. Roberts',    'https://covers.openlibrary.org/b/id/7627885-L.jpg',  'Dark romance'),
  ('Nido de víboras',                   'K. A. Knight',     'https://covers.openlibrary.org/b/id/15115000-L.jpg', 'Dark romance'),
  ('Butcher & Blackbird',   'Brynne Weaver',    'https://covers.openlibrary.org/b/id/15256803-L.jpg', 'Dark romance'),
  ('Leather & Lark',        'Brynne Weaver',    'https://covers.openlibrary.org/b/id/14753300-L.jpg', 'Dark romance'),
  ('God of Malice',         'Rina Kent',        'https://covers.openlibrary.org/b/id/13291765-L.jpg', 'Dark romance'),
  ('Deviant King',          'Rina Kent',        'https://covers.openlibrary.org/b/id/10355106-L.jpg', 'Dark romance'),
  ('El olvido más dulce',               'Danielle Lori',    'https://covers.openlibrary.org/b/id/10831263-L.jpg', 'Dark romance'),
  ('La locura más ardiente',            'Danielle Lori',    'https://covers.openlibrary.org/b/id/11699161-L.jpg', 'Dark romance'),
  ('The Ritual',            'Shantel Tessier',  'https://covers.openlibrary.org/b/id/15104748-L.jpg', 'Dark romance'),
  ('Dark Notes',            'Pam Godwin',       'https://covers.openlibrary.org/b/id/10672263-L.jpg', 'Dark romance'),
  ('Twist Me',              'Anna Zaires',      'https://covers.openlibrary.org/b/id/8851882-L.jpg',  'Dark romance'),
  ('Bound by Honor',        'Cora Reilly',      'https://covers.openlibrary.org/b/id/10558598-L.jpg', 'Dark romance'),
  ('Gothikana',             'RuNyx',            'https://covers.openlibrary.org/b/id/14616326-L.jpg', 'Dark romance'),
  ('El rey de Nunca Jamás',             'Nikki St. Crowe',  'https://covers.openlibrary.org/b/id/14626982-L.jpg', 'Dark romance'),
  ('Twisted Love',          'Ana Huang',        'https://covers.openlibrary.org/b/id/12940491-L.jpg', 'Dark romance'),
  ('Ruthless People',       'J. J. McAvoy',     'https://covers.openlibrary.org/b/id/8988271-L.jpg',  'Dark romance')
on conflict (title, author) do nothing;
