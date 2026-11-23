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
db.auth.onAuthStateChange((_event, session) => {
  if (!isConfigured) return;
  const userId = session?.user?.id ?? null;
  if (!userId) {
    currentUserId = null;
    books = [];
    catalog = [];
    petGreeted = false;
    showScreen('login');
    return;
  }
  $('profile-email').textContent = session.user.email;
  showScreen('app');
  if (userId !== currentUserId) {
    currentUserId = userId;
    // Fuera del callback para no bloquear el cliente de Supabase
    setTimeout(() => {
      loadBooks();
      loadCatalog();
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

  if (list.length === 0) {
    showEmpty(searching
      ? 'No se encontraron libros.'
      : books.length === 0
        ? 'Tu biblioteca está vacía. Añade libros desde Explorar o pulsa +.'
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
  const list = q ? catalog.filter((b) => matches(b, q)) : catalog;

  const wrap = $('catalog');
  wrap.innerHTML = '';
  if (list.length === 0) {
    showCatalogEmpty(catalog.length === 0
      ? 'Todavía no hay libros para explorar.'
      : 'No se encontraron libros.');
    return;
  }
  $('catalog-empty').hidden = true;

  // Agrupar por categoría
  const groups = new Map();
  list.forEach((b) => {
    if (!groups.has(b.category)) groups.set(b.category, []);
    groups.get(b.category).push(b);
  });

  groups.forEach((items, category) => {
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
  const msgs = [{ text: greeting() }, { text: '¡Guau! 🐾' }, { text: 'Me encanta que me leas en voz alta. 🐶' }];

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

function greetOnce() {
  if (petGreeted || document.body.classList.contains('pet-hidden')) return;
  petGreeted = true;
  setTimeout(() => petSay({ text: greeting() }), 1200);
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
