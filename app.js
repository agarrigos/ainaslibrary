// =====================================================
//  Aina's Library — lógica de la app (Supabase)
// =====================================================

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && !SUPABASE_URL.includes('TU-PROYECTO');
const db = window.supabase.createClient(
  isConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co',
  isConfigured ? SUPABASE_ANON_KEY : 'placeholder',
);

const COVER_COLORS = [
  '#b9c7d8', '#efc39b', '#4a4a4c', '#a9c2b3',
  '#ecc5c5', '#bba98a', '#d8cfe6', '#f1e3b5',
];

const $ = (id) => document.getElementById(id);

let books = [];     // Biblioteca de la usuaria
let catalog = [];   // Libros de Explorar
let editingId = null;

// ---------- Pantallas ----------
function showScreen(name) {
  $('loading-screen').hidden = name !== 'loading';
  $('login-screen').hidden = name !== 'login';
  $('app').hidden = name !== 'app';
}

// ---------- Autenticación ----------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = $('login-error');
  errorEl.hidden = true;
  btn.disabled = true;

  const { error } = await db.auth.signInWithPassword({
    email: form.email.value.trim(),
    password: form.password.value,
  });

  btn.disabled = false;
  if (error) {
    errorEl.textContent = 'Email o contraseña incorrectos.';
    errorEl.hidden = false;
  } else {
    form.reset();
  }
});

$('btn-logout').addEventListener('click', () => db.auth.signOut());

let currentUserId = null;
db.auth.onAuthStateChange((event, session) => {
  if (!isConfigured) return;
  const userId = session?.user?.id ?? null;
  if (!userId) {
    currentUserId = null;
    books = [];
    catalog = [];
    petGreeted = false;
    currentUser = null;
    setAvatar(null);
    avatarStatus('');
    showScreen('login');
    return;
  }
  $('profile-email').textContent = session.user.email;
  showScreen('app');
  if (userId !== currentUserId) {
    currentUserId = userId;
    // Recién iniciada la sesión (no al reabrir la app con la sesión ya guardada)
    petIntroPending = event === 'SIGNED_IN';
    // Fuera del callback para no bloquear el cliente de Supabase
    setTimeout(() => {
      loadBooks();
      loadCatalog();
      loadAvatar(session.user);
    }, 0);
  }
});

// ---------- Datos ----------
async function loadBooks() {
  showEmpty('Cargando…');
  const { data, error } = await db
    .from('books')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    showEmpty('No se pudieron cargar los libros. Revisa la conexión.');
    return;
  }
  books = data;
  refresh();
}

let catalogLoaded = false;

async function loadCatalog() {
  catalogLoaded = false;
  showCatalogEmpty('Cargando…');
  const { data, error } = await db
    .from('catalog')
    .select('*')
    .order('category')
    .order('title');

  if (error) {
    console.error(error);
    showCatalogEmpty('No se pudo cargar el catálogo. Revisa la conexión.');
    return;
  }
  catalog = data;
  catalogLoaded = true;
  renderCatalog();
  greetOnce();
}

function refresh() {
  applySearch();
  updateStats();
}

// ¿Está este libro del catálogo ya en la biblioteca?
const sameBook = (a, b) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  a.author.trim().toLowerCase() === b.author.trim().toLowerCase();
const isInLibrary = (item) => books.some((b) => sameBook(b, item));

// ---------- Render ----------
function showEmpty(text) {
  $('book-grid').innerHTML = '';
  $('empty-msg').textContent = text;
  $('empty-msg').hidden = false;
}

function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5 ? '#efede8' : '#2b2b2b';
}

function createBookCard(book, onClick, { badge = false } = {}) {
  const el = document.createElement('button');
  el.className = 'book';
  el.setAttribute('aria-label', `${book.title}${book.author ? ', ' + book.author : ''}`);

  if (book.cover_url) {
    el.classList.add('has-image');
    el.style.setProperty('--cover', `url("${encodeURI(book.cover_url)}")`);
  } else {
    const color = book.cover_color || COVER_COLORS[0];
    el.style.setProperty('--cover', color);
    el.style.setProperty('--ink', inkFor(color));
  }

  const art = document.createElement('div');
  art.className = 'book-art';

  const title = document.createElement('div');
  title.className = 'book-title';
  title.textContent = book.title;

  const author = document.createElement('div');
  author.className = 'book-author';
  author.textContent = book.author;

  el.append(art, title, author);

  if (badge) {
    const b = document.createElement('span');
    b.className = 'book-badge';
    b.title = 'En tu biblioteca';
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    el.appendChild(b);
  }

  el.addEventListener('click', onClick);
  return el;
}

// ---------- Sub apartados de la Biblioteca ----------
let libraryStatus = 'reading';

const STATUS_EMPTY = {
  reading: 'No estás leyendo ningún libro ahora mismo.',
  read: 'Todavía no has marcado ningún libro como leído.',
  pending: 'No tienes libros pendientes. Añade alguno desde Explorar o pulsa +.',
};

document.querySelectorAll('#status-tabs .segment').forEach((btn) => {
  btn.addEventListener('click', () => {
    libraryStatus = btn.dataset.status;
    document.querySelectorAll('#status-tabs .segment').forEach((s) => {
      const active = s === btn;
      s.classList.toggle('is-active', active);
      s.setAttribute('aria-selected', String(active));
    });
    applySearch();
  });
});

function renderBooks(list, { searching = false } = {}) {
  const grid = $('book-grid');
  grid.innerHTML = '';
  // Al buscar se muestran resultados de los tres apartados
  $('status-tabs').classList.toggle('is-searching', searching);
  if (!searching) list = list.filter((b) => b.status === libraryStatus);
  const beforeFilters = list.length;
  list = applyPrefs('library', list);

  if (list.length === 0) {
    showEmpty(searching
      ? 'No se encontraron libros.'
      : books.length === 0
        ? 'Tu biblioteca está vacía. Añade libros desde Explorar o pulsa +.'
        : beforeFilters > 0
          ? 'Ningún libro coincide con los filtros.'
          : STATUS_EMPTY[libraryStatus]);
    return;
  }
  $('empty-msg').hidden = true;

  list.forEach((book) => {
    grid.appendChild(createBookCard(book, () => openBookDialog(book)));
  });
}

// ---------- Explorar ----------
function showCatalogEmpty(text) {
  $('catalog').innerHTML = '';
  $('catalog-empty').textContent = text;
  $('catalog-empty').hidden = false;
}

const openCategories = new Set(); // categorías desplegadas (se mantienen al refrescar)

function renderCatalog() {
  if (!catalogLoaded) return;
  const q = searchInput.value.trim().toLowerCase();
  const found = q ? catalog.filter((b) => matches(b, q)) : catalog;
  const list = applyPrefs('explore', found);

  const wrap = $('catalog');
  wrap.innerHTML = '';
  if (list.length === 0) {
    showCatalogEmpty(catalog.length === 0
      ? 'Todavía no hay libros para explorar.'
      : found.length > 0
        ? 'Ningún libro coincide con los filtros.'
        : 'No se encontraron libros.');
    return;
  }
  $('catalog-empty').hidden = true;

  // Agrupar por categoría (el orden dentro de cada una ya viene de applyPrefs)
  const groups = new Map();
  list.forEach((b) => {
    if (!groups.has(b.category)) groups.set(b.category, []);
    groups.get(b.category).push(b);
  });
  const categories = [...groups.keys()].sort(collator.compare);

  categories.forEach((category) => {
    const items = groups.get(category);
    const section = document.createElement('details');
    section.className = 'category';
    // Al buscar se abren todas las categorías con resultados
    section.open = Boolean(q) || openCategories.has(category);
    section.addEventListener('toggle', () => {
      if (q) return;
      if (section.open) openCategories.add(category);
      else openCategories.delete(category);
    });

    const h = document.createElement('summary');
    h.className = 'category-title';
    const name = document.createElement('span');
    name.textContent = category;
    const count = document.createElement('span');
    count.className = 'category-count';
    count.textContent = items.length;
    const chevron = document.createElement('span');
    chevron.className = 'category-chevron';
    chevron.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
    h.append(name, count, chevron);

    const grid = document.createElement('div');
    grid.className = 'book-grid';
    items.forEach((item) => {
      grid.appendChild(createBookCard(item, () => openCatalogDialog(item), {
        badge: isInLibrary(item),
      }));
    });

    section.append(h, grid);
    wrap.appendChild(section);
  });
}

const catalogDialog = $('catalog-dialog');
let catalogItem = null;

function updateAddButton() {
  const btn = $('btn-add-to-library');
  const added = isInLibrary(catalogItem);
  btn.textContent = added ? '✓ Ya está en tu biblioteca' : 'Añadir a mi biblioteca';
  btn.disabled = added;
}

function openCatalogDialog(item) {
  catalogItem = item;
  $('catalog-error').hidden = true;
  $('catalog-dialog-category').textContent = item.category;
  $('catalog-dialog-cover').src = item.cover_url || '';
  $('catalog-dialog-cover').hidden = !item.cover_url;
  $('catalog-dialog-title').textContent = item.title;
  $('catalog-dialog-author').textContent = item.author;
  updateAddButton();
  catalogDialog.showModal();
}

$('btn-close-catalog').addEventListener('click', () => catalogDialog.close());

$('btn-add-to-library').addEventListener('click', async () => {
  if (!catalogItem || isInLibrary(catalogItem)) return;
  const btn = $('btn-add-to-library');
  btn.disabled = true;
  $('catalog-error').hidden = true;

  const { data, error } = await db
    .from('books')
    .insert({
      title: catalogItem.title,
      author: catalogItem.author,
      cover_url: catalogItem.cover_url,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    btn.disabled = false;
    $('catalog-error').textContent = 'No se pudo añadir. Inténtalo de nuevo.';
    $('catalog-error').hidden = false;
    return;
  }
  books = [data, ...books];
  refresh();
  updateAddButton();
});

function updateStats() {
  const count = (s) => books.filter((b) => b.status === s).length;
  $('stat-read').textContent = count('read');
  $('stat-reading').textContent = count('reading');
  $('stat-pending').textContent = count('pending');
  document.querySelectorAll('#status-tabs [data-count]').forEach((el) => {
    el.textContent = count(el.dataset.count);
  });
}

// ---------- Navegación entre pestañas ----------
function goTo(view) {
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('is-active', v.id === `view-${view}`);
  });
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.goto === view);
  });
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => goTo(btn.dataset.goto));
});

// ---------- Búsqueda ----------
const searchBar = $('search-bar');
const searchInput = $('search-input');

const matches = (b, q) =>
  b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);

function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  renderBooks(q ? books.filter((b) => matches(b, q)) : books, { searching: Boolean(q) });
  renderCatalog();
}

$('btn-search').addEventListener('click', () => {
  searchBar.hidden = !searchBar.hidden;
  if (!searchBar.hidden) {
    // Busca en la pestaña actual si es Explorar; si no, en la Biblioteca
    if (!$('view-explore').classList.contains('is-active')) goTo('library');
    searchInput.focus();
  } else {
    searchInput.value = '';
    applySearch();
  }
});

searchInput.addEventListener('input', applySearch);

// ---------- Formulario de libro ----------
const dialog = $('book-dialog');
const bookForm = $('book-form');
let selectedColor = COVER_COLORS[0];

function renderSwatches() {
  const wrap = $('swatches');
  wrap.innerHTML = '';
  COVER_COLORS.forEach((c) => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch';
    s.style.setProperty('--c', c);
    s.setAttribute('aria-label', `Color ${c}`);
    s.setAttribute('aria-pressed', String(c === selectedColor));
    s.addEventListener('click', () => {
      selectedColor = c;
      renderSwatches();
    });
    wrap.appendChild(s);
  });
}

function openBookDialog(book = null) {
  editingId = book?.id ?? null;
  bookForm.reset();
  $('book-error').hidden = true;
  $('book-dialog-title').textContent = book ? 'Editar libro' : 'Nuevo libro';
  $('btn-delete').hidden = !book;

  if (book) {
    bookForm.title.value = book.title;
    bookForm.author.value = book.author;
    bookForm.status.value = book.status;
    bookForm.rating.value = book.rating ?? '';
    bookForm.finished_at.value = book.finished_at ?? '';
    bookForm.cover_url.value = book.cover_url ?? '';
    bookForm.notes.value = book.notes;
    selectedColor = book.cover_color;
  } else {
    bookForm.status.value = libraryStatus; // por defecto, el apartado en el que estás
    selectedColor = COVER_COLORS[books.length % COVER_COLORS.length];
  }
  renderSwatches();
  dialog.showModal();
}

$('btn-add').addEventListener('click', () => openBookDialog());
$('btn-close-dialog').addEventListener('click', () => dialog.close());

function showBookError(msg) {
  $('book-error').textContent = msg;
  $('book-error').hidden = false;
}

bookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: bookForm.title.value.trim(),
    author: bookForm.author.value.trim(),
    status: bookForm.status.value,
    rating: bookForm.rating.value ? Number(bookForm.rating.value) : null,
    finished_at: bookForm.finished_at.value || null,
    cover_url: bookForm.cover_url.value.trim() || null,
    cover_color: selectedColor,
    notes: bookForm.notes.value.trim(),
  };
  if (!payload.title) return showBookError('El título es obligatorio.');

  $('btn-save').disabled = true;
  const query = editingId
    ? db.from('books').update(payload).eq('id', editingId).select().single()
    : db.from('books').insert(payload).select().single();
  const { data, error } = await query;
  $('btn-save').disabled = false;

  if (error) {
    console.error(error);
    return showBookError('No se pudo guardar. Inténtalo de nuevo.');
  }

  if (editingId) {
    books = books.map((b) => (b.id === editingId ? data : b));
  } else {
    books = [data, ...books];
  }
  dialog.close();
  refresh();
});

$('btn-delete').addEventListener('click', async () => {
  if (!editingId || !confirm('¿Eliminar este libro? No se puede deshacer.')) return;
  const { error } = await db.from('books').delete().eq('id', editingId);
  if (error) {
    console.error(error);
    return showBookError('No se pudo eliminar. Inténtalo de nuevo.');
  }
  books = books.filter((b) => b.id !== editingId);
  dialog.close();
  refresh();
});

// ---------- Foto de perfil ----------
const AVATAR_BUCKET = 'avatars';
const AVATAR_SIZE = 512;
let currentUser = null;

function setAvatar(url) {
  const img = $('profile-avatar');
  const header = $('header-avatar');
  if (url) {
    img.src = url;
    header.src = url;
  } else {
    img.removeAttribute('src');
    header.removeAttribute('src');
  }
  img.hidden = !url;
  header.hidden = !url;
  $('header-avatar-icon').style.display = url ? 'none' : '';
  $('btn-remove-avatar').hidden = !url;
  $('avatar-initial').textContent = (currentUser?.email || '?').charAt(0);
}

function avatarStatus(text, isError = false) {
  const el = $('avatar-status');
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.toggle('is-error', isError);
}

async function loadAvatar(user) {
  currentUser = user;
  const path = user?.user_metadata?.avatar_path;
  if (!path) return setAvatar(null);
  const { data, error } = await db.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) {
    console.error(error);
    return setAvatar(null);
  }
  setAvatar(data.signedUrl);
}

// Recorta la imagen en cuadrado (centrada), la reduce y la convierte a JPEG.
// Al redibujarla se pierden los metadatos de la foto (EXIF, ubicación GPS…).
async function squareJpeg(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width;
  const h = source.height;
  const side = Math.min(w, h);
  const size = Math.min(AVATAR_SIZE, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.85));
}

$('btn-avatar').addEventListener('click', () => $('avatar-input').click());

$('avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentUser) return;
  if (!file.type.startsWith('image/')) return avatarStatus('Ese archivo no es una imagen.', true);

  const btn = $('btn-avatar');
  btn.classList.add('is-loading');
  avatarStatus('Subiendo foto…');
  try {
    const blob = await squareJpeg(file);
    const oldPath = currentUser.user_metadata?.avatar_path;
    // Nombre nuevo cada vez para que el móvil no muestre la foto antigua en caché
    const path = `${currentUser.id}/avatar-${Date.now()}.jpg`;

    const { error: upErr } = await db.storage.from(AVATAR_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (upErr) throw upErr;

    const { data, error: userErr } = await db.auth.updateUser({ data: { avatar_path: path } });
    if (userErr) throw userErr;
    if (oldPath) db.storage.from(AVATAR_BUCKET).remove([oldPath]); // no hace falta esperar

    await loadAvatar(data.user);
    avatarStatus('');
  } catch (err) {
    console.error(err);
    avatarStatus('No se pudo subir la foto. Inténtalo de nuevo.', true);
  } finally {
    btn.classList.remove('is-loading');
  }
});

$('btn-remove-avatar').addEventListener('click', async () => {
  const path = currentUser?.user_metadata?.avatar_path;
  if (!path || !confirm('¿Quitar la foto de perfil?')) return;
  avatarStatus('Quitando foto…');
  const { data, error } = await db.auth.updateUser({ data: { avatar_path: null } });
  if (error) {
    console.error(error);
    return avatarStatus('No se pudo quitar la foto. Inténtalo de nuevo.', true);
  }
  db.storage.from(AVATAR_BUCKET).remove([path]);
  currentUser = data.user;
  setAvatar(null);
  avatarStatus('');
});

// ---------- Ordenar y filtrar ----------
// Orden alfabético en español: ignora mayúsculas y acentos, y ordena números de forma natural
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const byText = (key) => (a, b) => collator.compare(a[key] || '', b[key] || '');
const byTitle = byText('title');
const thenTitle = (cmp) => (a, b) => cmp(a, b) || byTitle(a, b);

const SORTS = {
  'title-asc': { label: 'Título (A–Z)', short: 'A–Z', cmp: byTitle },
  'title-desc': { label: 'Título (Z–A)', short: 'Z–A', cmp: (a, b) => byTitle(b, a) },
  'author-asc': { label: 'Autor (A–Z)', short: 'Autor', cmp: thenTitle(byText('author')) },
  'recent': {
    label: 'Añadidos recientemente', short: 'Recientes',
    cmp: (a, b) => (b.created_at || '').localeCompare(a.created_at || ''),
  },
  'rating': {
    label: 'Mejor puntuados', short: 'Puntuación',
    cmp: thenTitle((a, b) => (b.rating || 0) - (a.rating || 0)),
  },
  'finished': {
    label: 'Terminados recientemente', short: 'Terminados',
    cmp: thenTitle((a, b) => (b.finished_at || '').localeCompare(a.finished_at || '')),
  },
};

const VIEW_OPTIONS = {
  library: {
    sorts: ['title-asc', 'title-desc', 'author-asc', 'recent', 'rating', 'finished'],
    defaults: { sort: 'title-asc', minRating: 0, withNotes: false },
  },
  explore: {
    sorts: ['title-asc', 'title-desc', 'author-asc'],
    defaults: { sort: 'title-asc', hideOwned: false },
  },
};

function loadPrefs(view) {
  try {
    const saved = JSON.parse(localStorage.getItem(`prefs-${view}`) || '{}');
    const prefs = { ...VIEW_OPTIONS[view].defaults, ...saved };
    if (!VIEW_OPTIONS[view].sorts.includes(prefs.sort)) prefs.sort = VIEW_OPTIONS[view].defaults.sort;
    return prefs;
  } catch {
    return { ...VIEW_OPTIONS[view].defaults };
  }
}
const prefs = { library: loadPrefs('library'), explore: loadPrefs('explore') };

function savePrefs(view) {
  localStorage.setItem(`prefs-${view}`, JSON.stringify(prefs[view]));
}

function activeFilterCount(view) {
  const p = prefs[view];
  return view === 'library'
    ? (p.minRating > 0 ? 1 : 0) + (p.withNotes ? 1 : 0)
    : (p.hideOwned ? 1 : 0);
}

function applyPrefs(view, list) {
  const p = prefs[view];
  let out = list;
  if (view === 'library') {
    if (p.minRating > 0) out = out.filter((b) => (b.rating || 0) >= p.minRating);
    if (p.withNotes) out = out.filter((b) => b.notes && b.notes.trim());
  } else if (p.hideOwned) {
    out = out.filter((b) => !isInLibrary(b));
  }
  return [...out].sort(SORTS[p.sort].cmp);
}

function updateSortChips() {
  document.querySelectorAll('[data-sort-view]').forEach((chip) => {
    const view = chip.dataset.sortView;
    const n = activeFilterCount(view);
    chip.querySelector('.chip-label').textContent =
      `${SORTS[prefs[view].sort].short}${n ? ` · ${n} ${n === 1 ? 'filtro' : 'filtros'}` : ''}`;
    chip.classList.toggle('has-filters', n > 0);
    chip.setAttribute('aria-label', `Ordenar y filtrar. Ahora: ${SORTS[prefs[view].sort].label}` +
      (n ? `, ${n} ${n === 1 ? 'filtro activo' : 'filtros activos'}` : ''));
  });
}

const sortDialog = $('sort-dialog');
let sortView = 'library';

function optionRow(labelText, input) {
  const label = document.createElement('label');
  label.className = 'option';
  const span = document.createElement('span');
  span.textContent = labelText;
  label.append(span, input);
  return label;
}

function renderSortDialog() {
  const p = prefs[sortView];

  const sortWrap = $('sort-options');
  sortWrap.innerHTML = '';
  VIEW_OPTIONS[sortView].sorts.forEach((key) => {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'sort';
    input.checked = p.sort === key;
    input.addEventListener('change', () => { p.sort = key; onPrefsChange(); });
    sortWrap.appendChild(optionRow(SORTS[key].label, input));
  });

  const filterWrap = $('filter-options');
  filterWrap.innerHTML = '';
  if (sortView === 'library') {
    const select = document.createElement('select');
    [['0', 'Todas'], ['3', '★★★ o más'], ['4', '★★★★ o más'], ['5', '★★★★★']].forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      select.appendChild(o);
    });
    select.value = String(p.minRating);
    select.addEventListener('change', () => { p.minRating = Number(select.value); onPrefsChange(); });
    filterWrap.appendChild(optionRow('Puntuación', select));

    const notes = document.createElement('input');
    notes.type = 'checkbox';
    notes.checked = p.withNotes;
    notes.addEventListener('change', () => { p.withNotes = notes.checked; onPrefsChange(); });
    filterWrap.appendChild(optionRow('Solo libros con notas', notes));
  } else {
    const hide = document.createElement('input');
    hide.type = 'checkbox';
    hide.checked = p.hideOwned;
    hide.addEventListener('change', () => { p.hideOwned = hide.checked; onPrefsChange(); });
    filterWrap.appendChild(optionRow('Ocultar los que ya están en mi biblioteca', hide));
  }
}

function onPrefsChange() {
  savePrefs(sortView);
  updateSortChips();
  applySearch(); // vuelve a pintar Biblioteca y Explorar
}

document.querySelectorAll('[data-sort-view]').forEach((chip) => {
  chip.addEventListener('click', () => {
    sortView = chip.dataset.sortView;
    renderSortDialog();
    sortDialog.showModal();
  });
});
$('btn-close-sort').addEventListener('click', () => sortDialog.close());
$('btn-done-sort').addEventListener('click', () => sortDialog.close());
$('btn-reset-sort').addEventListener('click', () => {
  prefs[sortView] = { ...VIEW_OPTIONS[sortView].defaults };
  renderSortDialog();
  onPrefsChange();
});

updateSortChips();

// ---------- Mascota ----------
const pet = $('pet');
const petBubble = $('pet-bubble');
let petTimer = null;
let lastPetMessage = '';
let petGreeted = false;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '¿Leyendo a estas horas? Yo te hago compañía. 🌙';
  if (h < 13) return '¡Buenos días! ¿Qué leemos hoy? ☀️';
  if (h < 21) return '¡Buenas tardes! ¿Un ratito de lectura? 📖';
  return '¡Buenas noches! Un capítulo más y a dormir. 🌙';
}

// Devuelve { text, action?: { label, run } }
function petMessages() {
  const reading = books.filter((b) => b.status === 'reading');
  const read = books.filter((b) => b.status === 'read');
  const pending = books.filter((b) => b.status === 'pending');
  const suggestions = catalog.filter((c) => !isInLibrary(c));
  const msgs = [{ text: greeting() }, { text: '¡Guau! Soy Jack. 🐾' }, { text: 'Me encanta que me leas en voz alta. 🐶' }];

  if (reading.length) {
    const b = pick(reading);
    msgs.push({ text: `¿Qué tal va «${b.title}»? ¡Ánimo, que tú puedes!` });
  }
  if (read.length) {
    msgs.push({ text: `Ya llevas ${read.length} ${read.length === 1 ? 'libro leído' : 'libros leídos'}. ¡Estoy muy orgulloso! 🦴` });
  }
  if (pending.length) {
    const b = pick(pending);
    msgs.push({
      text: `Tienes ${pending.length} ${pending.length === 1 ? 'libro pendiente' : 'libros pendientes'}. ¿Empezamos «${b.title}»?`,
      action: { label: 'Ver pendientes', run: () => showLibraryStatus('pending') },
    });
  }
  if (suggestions.length) {
    const s = pick(suggestions);
    msgs.push({
      text: `He olfateado un libro para ti: «${s.title}», de ${s.author}.`,
      action: { label: 'Ver libro', run: () => openCatalogDialog(s) },
    });
  }
  return msgs;
}

function petSay(msg) {
  $('pet-text').textContent = msg.text;
  const action = $('pet-action');
  action.hidden = !msg.action;
  if (msg.action) {
    action.textContent = msg.action.label;
    action.onclick = () => {
      hidePetBubble();
      msg.action.run();
    };
  }
  petBubble.hidden = false;
  lastPetMessage = msg.text;

  pet.classList.remove('is-happy');
  void pet.offsetWidth; // reinicia la animación
  pet.classList.add('is-happy');

  clearTimeout(petTimer);
  petTimer = setTimeout(hidePetBubble, msg.action ? 9000 : 6000);
}

function hidePetBubble() {
  petBubble.hidden = true;
  pet.classList.remove('is-happy');
}

$('pet-dog').addEventListener('click', (e) => {
  e.stopPropagation();
  const options = petMessages().filter((m) => m.text !== lastPetMessage);
  petSay(pick(options));
});

// Cerrar el bocadillo al tocar fuera
document.addEventListener('click', (e) => {
  if (!petBubble.hidden && !pet.contains(e.target)) hidePetBubble();
});

const PET_INTRO = 'Hola, me llamo Jack y seré tu compañero de lectura. 🐾';
let petIntroPending = false; // true justo después de iniciar sesión

function greetOnce() {
  if (petGreeted || document.body.classList.contains('pet-hidden')) return;
  petGreeted = true;
  const text = petIntroPending ? PET_INTRO : greeting();
  petIntroPending = false;
  setTimeout(() => petSay({ text }), 1200);
}

function showLibraryStatus(status) {
  goTo('library');
  document.querySelector(`#status-tabs .segment[data-status="${status}"]`)?.click();
}

// Mostrar / ocultar desde Perfil (se recuerda en este dispositivo)
const petToggle = $('pet-toggle');
function applyPetVisibility(visible) {
  document.body.classList.toggle('pet-hidden', !visible);
  petToggle.checked = visible;
  if (!visible) hidePetBubble();
}
applyPetVisibility(localStorage.getItem('pet-visible') !== 'false');
petToggle.addEventListener('change', () => {
  localStorage.setItem('pet-visible', String(petToggle.checked));
  applyPetVisibility(petToggle.checked);
});

// ---------- Inicio ----------
const initial = location.hash.slice(1);
goTo(['library', 'explore', 'discover', 'profile'].includes(initial) ? initial : 'library');

if (!isConfigured) {
  showScreen('loading');
  $('loading-screen').insertAdjacentHTML('beforeend',
    '<p class="muted" style="grid-row:2">Falta configurar Supabase en <code>config.js</code>.</p>');
}
