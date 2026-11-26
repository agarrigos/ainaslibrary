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
  if (name === 'app') placeTabIndicator(); // ahora la barra ya tiene tamaño para medir
}

// ---------- Autenticación ----------
// Se entra con nombre de usuario: internamente es <usuario>@ainaslibrary.invalid
// (ver supabase/usuario.sql). Si se escribe un correo completo, también funciona.
const USERNAME_DOMAIN = 'ainaslibrary.invalid';
const toLoginEmail = (value) => {
  const v = value.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${USERNAME_DOMAIN}`;
};
function displayName(user) {
  if (!user) return '';
  if (user.user_metadata?.username) return user.user_metadata.username;
  const email = user.email || '';
  return email.endsWith(`@${USERNAME_DOMAIN}`) ? email.slice(0, -USERNAME_DOMAIN.length - 1) : email;
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = $('login-error');
  errorEl.hidden = true;
  btn.disabled = true;

  const { error } = await db.auth.signInWithPassword({
    email: toLoginEmail(form.username.value),
    password: form.password.value,
  });

  btn.disabled = false;
  if (error) {
    errorEl.textContent = 'Usuario o contraseña incorrectos.';
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
    sessions = [];
    quoteCount = 0;
    clearDataCache(); // al cerrar sesión no se dejan sus datos en el móvil
    renderSessions();
    petGreeted = false;
    currentUser = null;
    setAvatar(null);
    avatarStatus('');
    showScreen('login');
    return;
  }
  $('profile-email').textContent = displayName(session.user);
  showScreen('app');
  if (userId !== currentUserId) {
    currentUserId = userId;
    // Recién iniciada la sesión (no al reabrir la app con la sesión ya guardada)
    petIntroPending = event === 'SIGNED_IN';
    // Fuera del callback para no bloquear el cliente de Supabase
    dataReady = { books: false, sessions: false, quotes: false };
    setTimeout(() => {
      checkExtras();
      loadBooks();
      loadCatalog();
      loadAvatar(session.user);
      loadSessions();
      loadQuoteCount();
      applyChallengeFromUser(session.user);
      applyFavoritesFromUser(session.user);
      applyFavAuthorsFromUser(session.user);
    }, 0);
  }
});

// ---------- Datos ----------
async function loadBooks() {
  // Lo último guardado en el móvil se muestra al instante; después se actualiza
  const cached = readCache('books');
  if (cached) {
    books = cached;
    dataReady.books = true;
    refresh();
  } else {
    showSkeleton();
  }
  const { data, error } = await db
    .from('books')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    if (!cached) showEmpty('No se pudieron cargar los libros. Revisa la conexión.');
    return;
  }
  books = data;
  dataReady.books = true;
  refresh();
}

// ¿Se ha ejecutado supabase/mejoras.sql? Si no, la app sigue funcionando sin las columnas nuevas.
// Se comprueba cada columna por separado: si falta solo una (p. ej. «owned», que llegó más tarde),
// lo demás (páginas, saga, categoría) sigue funcionando.
let hasExtras = true;   // páginas, saga y categoría
let hasOwned = true;    // «Lo tengo»
const EXTRA_FIELDS = ['total_pages', 'current_page', 'series', 'series_number', 'category', 'owned'];
let missingCols = new Set();
let dataReady = { books: false, sessions: false, quotes: false };

async function checkExtras() {
  const results = await Promise.all(EXTRA_FIELDS.map((c) => db.from('books').select(c).limit(1)));
  missingCols = new Set(EXTRA_FIELDS.filter((c, i) => results[i].error));
  hasExtras = !missingCols.has('total_pages') && !missingCols.has('current_page');
  hasOwned = !missingCols.has('owned');
  if (missingCols.size) console.warn('Falta ejecutar (otra vez) supabase/mejoras.sql. Columnas que faltan:', [...missingCols]);
}
function cleanBook(payload) {
  if (!missingCols.size) return payload;
  const p = { ...payload };
  missingCols.forEach((k) => delete p[k]);
  return p;
}

// Actualiza un libro, lo sustituye en la lista y avisa de los cambios importantes
async function updateBook(id, changes) {
  const before = books.find((b) => b.id === id);
  const { data, error } = await db.from('books').update(cleanBook(changes)).eq('id', id).select().single();
  if (error) throw error;
  books = books.map((b) => (b.id === id ? data : b));
  refresh();
  afterBookChange(before, data);
  return data;
}

function afterBookChange(before, after) {
  if (after && after.status === 'read' && before && before.status !== 'read') celebrateFinish(after);
}

let catalogLoaded = false;

let catalogHasSeries = true; // se pone a false si la tabla catalog aún no tiene las columnas de saga

async function loadCatalog() {
  const cached = readCache('catalog');
  if (cached) {
    catalog = cached;
    catalogLoaded = true;
    renderCatalog();
    renderFormLists();
    greetOnce();
  } else {
    catalogLoaded = false;
    showCatalogSkeleton();
  }
  // Supabase devuelve como mucho 1000 filas por petición: el catálogo (~4000 libros) se pide por bloques
  // La saga (series, series_number) solo existe si se ejecutó supabase/sagas.sql: si falta, se pide sin ella
  const PAGE = 1000;
  let data = [];
  let error = null;
  let cols = catalogHasSeries ? 'id, title, author, cover_url, category, series, series_number' : 'id, title, author, cover_url, category';
  for (let from = 0; ; from += PAGE) {
    const res = await db
      .from('catalog')
      .select(cols)
      .order('category')
      .order('title')
      .order('id')
      .range(from, from + PAGE - 1);
    if (res.error && catalogHasSeries && /series/i.test(res.error.message || '')) {
      catalogHasSeries = false;
      cols = 'id, title, author, cover_url, category';
      data = [];
      from = -PAGE;
      continue;
    }
    if (res.error) { error = res.error; break; }
    data = data.concat(res.data || []);
    if (!res.data || res.data.length < PAGE) break;
  }

  if (error) {
    console.error(error);
    if (!cached) showCatalogEmpty('No se pudo cargar el catálogo. Revisa la conexión.');
    return;
  }
  catalog = data;
  writeCache('catalog', data);
  catalogLoaded = true;
  renderCatalog();
  renderFormLists();
  greetOnce();
}

// ---------- Datos guardados en el móvil (para abrir al instante) ----------
// Se muestra lo último que se vio y, a la vez, se piden los datos frescos a Supabase.
const cacheKey = (name) => `cache-${currentUserId}-${name}`;
function readCache(name) {
  if (!currentUserId) return null;
  try { return JSON.parse(localStorage.getItem(cacheKey(name))); } catch { return null; }
}
function writeCache(name, data) {
  if (!currentUserId) return;
  try { localStorage.setItem(cacheKey(name), JSON.stringify(data)); } catch { /* sin espacio: no pasa nada */ }
}
function clearDataCache() {
  Object.keys(localStorage).filter((k) => k.startsWith('cache-')).forEach((k) => localStorage.removeItem(k));
}

function refresh() {
  if (dataReady.books) writeCache('books', books);
  applySearch();
  updateStats();
  renderReadingBookOptions();
  renderChallenge();
  renderFormLists();
  checkAchievements();
  renderAuthorsView();
  if (authorDialog.open) renderAuthorDialog();
}

// ¿Está este libro del catálogo ya en la biblioteca?
const sameBook = (a, b) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  a.author.trim().toLowerCase() === b.author.trim().toLowerCase();
const isInLibrary = (item) => books.some((b) => sameBook(b, item));

// ---------- Render ----------
// Esqueletos mientras cargan los datos
function skeletonCard() {
  const card = document.createElement('div');
  card.className = 'skeleton-card';
  card.innerHTML = '<div class="skeleton skeleton-cover"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div>';
  return card;
}
function showSkeleton() {
  const grid = $('book-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 8; i++) grid.appendChild(skeletonCard());
  $('empty-msg').hidden = true;
}
function showCatalogSkeleton() {
  const wrap = $('catalog');
  wrap.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const row = document.createElement('div');
    row.className = 'skeleton skeleton-row';
    wrap.appendChild(row);
  }
  $('catalog-empty').hidden = true;
}

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

// Portadas de Open Library: -S (pequeña), -M (mediana), -L (grande)
const coverSize = (url, size) => (url && url.includes('covers.openlibrary.org') ? url.replace(/-[SML]\.jpg$/, `-${size}.jpg`) : url);

function createBookCard(book, onClick, { badge = false, badgeTitle = 'En tu biblioteca', volume = null } = {}) {
  // Tarjeta: portada arriba + título y autor debajo
  const el = document.createElement('button');
  el.className = 'book-item';
  el.setAttribute('aria-label', `${book.title}${book.author ? ', ' + book.author : ''}`);

  const cover = document.createElement('div');
  cover.className = 'book';
  if (book.cover_url) {
    cover.classList.add('has-image');
    // <img> perezosa: solo se descarga cuando está a punto de verse (no las de categorías cerradas)
    // y en tamaño mediano, que para la cuadrícula sobra (pesa ~2,5 veces menos que la grande)
    const img = document.createElement('img');
    img.className = 'book-img';
    img.src = coverSize(book.cover_url, 'M');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => cover.classList.add('is-loaded'), { once: true });
    // Si no carga, queda la portada de color (nunca el icono de imagen rota)
    img.addEventListener('error', () => img.remove(), { once: true });
    cover.appendChild(img);
  } else {
    const color = book.cover_color || COVER_COLORS[0];
    cover.style.setProperty('--cover', color);
    cover.style.setProperty('--ink', inkFor(color));
  }

  const art = document.createElement('div');
  art.className = 'book-art';

  const title = document.createElement('div');
  title.className = 'book-title';
  title.textContent = book.title;

  const author = document.createElement('div');
  author.className = 'book-author';
  author.textContent = book.author;

  cover.append(art, title, author);

  // Barrita de progreso en los libros que se están leyendo
  if (book.status === 'reading' && book.total_pages && book.current_page) {
    const pct = Math.min(100, Math.round((book.current_page / book.total_pages) * 100));
    const bar = document.createElement('span');
    bar.className = 'book-progress';
    bar.innerHTML = `<span style="width:${pct}%"></span>`;
    bar.title = `${pct}% leído`;
    cover.appendChild(bar);
    el.setAttribute('aria-label', `${el.getAttribute('aria-label')}, ${pct}% leído`);
  }

  // Número de tomo (Explorar agrupado por saga)
  if (volume != null) {
    const v = document.createElement('span');
    v.className = 'book-volume';
    v.textContent = `#${Number(volume)}`;
    cover.appendChild(v);
    el.setAttribute('aria-label', `Tomo ${Number(volume)}: ${el.getAttribute('aria-label')}`);
  }

  if (badge) {
    const b = document.createElement('span');
    b.className = 'book-badge';
    b.title = badgeTitle;
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    cover.appendChild(b);
  }

  const caption = document.createElement('div');
  caption.className = 'book-caption';
  const capTitle = document.createElement('span');
  capTitle.className = 'caption-title';
  capTitle.textContent = book.title;
  caption.appendChild(capTitle);
  if (book.author) {
    const capAuthor = document.createElement('span');
    capAuthor.className = 'caption-author';
    capAuthor.textContent = book.author;
    caption.appendChild(capAuthor);
  }

  el.append(cover, caption);

  el.addEventListener('click', onClick);
  return el;
}

// ---------- Sub apartados de la Biblioteca ----------
// Dos secciones:
//   Mi lectura    -> Leyendo · Leídos · Pendientes   (en qué punto está de cada libro)
//   Mi estantería -> En propiedad · Deseados         (qué libros tiene y cuáles quiere)
let libraryStatus = 'reading';
const SHELF_TABS = ['owned', 'wishlist'];
const lastTabOf = { reading: 'reading', shelf: 'owned' }; // se recuerda la última pestaña de cada sección

const isOwned = (b) => b.status !== 'wishlist' && b.owned !== false;
const inLibraryTab = (b, tab) => (tab === 'owned' ? isOwned(b) : b.status === tab);

const STATUS_EMPTY = {
  reading: 'No estás leyendo ningún libro ahora mismo.',
  read: 'Todavía no has marcado ningún libro como leído.',
  pending: 'No tienes libros pendientes. Añade alguno desde Explorar o pulsa +.',
  owned: 'Aquí aparecen los libros que tienes, en papel o digital. Márcalos con «Lo tengo» en la ficha de cada libro.',
  wishlist: 'No tienes libros deseados. Guarda aquí los que te gustaría tener: desde Explorar, con ♡, o al añadir uno con +.',
};
const TAB_HINT = {
  owned: 'Todos los libros que tienes, en papel o digital, los hayas leído o no.',
  wishlist: 'Libros que te gustaría tener. Cuando consigas uno, ábrelo y marca «Lo tengo».',
};

function setLibraryTab(tab) {
  libraryStatus = tab;
  const group = SHELF_TABS.includes(tab) ? 'shelf' : 'reading';
  lastTabOf[group] = tab;
  document.querySelectorAll('.library-section').forEach((s) => {
    const on = s.dataset.group === group;
    s.classList.toggle('is-active', on);
    s.setAttribute('aria-selected', String(on));
  });
  $('status-tabs').dataset.group = group;
  document.querySelectorAll('#status-tabs .segment').forEach((s) => {
    s.hidden = s.dataset.group !== group;
    const active = s.dataset.status === tab;
    s.classList.toggle('is-active', active);
    s.setAttribute('aria-selected', String(active));
  });
  $('library-hint').textContent = TAB_HINT[tab] || '';
  $('library-hint').hidden = !TAB_HINT[tab];
  applySearch();
}

document.querySelectorAll('#status-tabs .segment').forEach((btn) => {
  btn.addEventListener('click', () => setLibraryTab(btn.dataset.status));
});
document.querySelectorAll('.library-section').forEach((btn) => {
  btn.addEventListener('click', () => setLibraryTab(lastTabOf[btn.dataset.group]));
});

function renderBooks(list, { searching = false } = {}) {
  const grid = $('book-grid');
  grid.innerHTML = '';
  // Al buscar se muestran resultados de todos los apartados
  $('status-tabs').classList.toggle('is-searching', searching);
  if (!searching) list = list.filter((b) => inLibraryTab(b, libraryStatus));
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
    // En «En propiedad» se marca cuáles ya ha leído
    grid.appendChild(createBookCard(book, () => openDetailDialog(book), {
      badge: libraryStatus === 'owned' && !searching && book.status === 'read',
      badgeTitle: 'Leído',
    }));
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
  renderForYou(q);
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

  // Agrupar por categoría o por saga (el orden dentro de cada categoría ya viene de applyPrefs;
  // dentro de una saga, siempre por número de tomo)
  const bySaga = prefs.explore.group === 'series';
  const sagaKey = (b) => (b.series ? `${b.series.trim().toLowerCase()}|${authorKeysOf(b)[0] || ''}` : '');
  const groups = new Map();
  const sagaName = new Map();
  list.forEach((b) => {
    const key = bySaga ? sagaKey(b) : b.category;
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
    if (bySaga && !sagaName.has(key)) sagaName.set(key, { name: b.series.trim(), author: splitAuthors(b.author)[0] || '' });
  });
  if (bySaga) {
    // Una saga con un solo libro en Explorar no agrupa nada
    for (const [k, items] of groups) {
      if (items.length < 2) groups.delete(k);
      else items.sort(bySeriesNumber);
    }
    if (!groups.size) {
      showCatalogEmpty(q
        ? 'Ninguna saga coincide con la búsqueda.'
        : 'Todavía no hay sagas en Explorar.');
      return;
    }
  }
  const labelOf = (key) => (bySaga ? sagaName.get(key).name : key);
  const categories = [...groups.keys()].sort((a, b) => collator.compare(labelOf(a), labelOf(b)));

  // Mismo aspecto que los desplegables de Ajustes: filas dentro de una tarjeta redondeada
  const catList = document.createElement('div');
  catList.className = 'settings catalog-list';
  wrap.appendChild(catList);

  categories.forEach((category) => {
    const items = groups.get(category);
    const section = document.createElement('div');
    section.className = 'setting-group category';
    // Al buscar se abren todas las categorías con resultados
    const startOpen = Boolean(q) || openCategories.has(category);
    section.classList.toggle('is-open', startOpen);

    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'setting setting-toggle category-title';
    h.setAttribute('aria-expanded', String(startOpen));
    h.addEventListener('click', () => {
      const open = !section.classList.contains('is-open');
      if (open) fillGrid();
      section.classList.toggle('is-open', open);
      h.setAttribute('aria-expanded', String(open));
      if (q) return;
      if (open) openCategories.add(category);
      else openCategories.delete(category);
    });
    const name = document.createElement('span');
    name.className = 'category-name';
    if (bySaga) {
      const { name: saga, author } = sagaName.get(category);
      name.classList.add('saga-name');
      name.textContent = saga;
      if (author) {
        const sub = document.createElement('span');
        sub.className = 'saga-author';
        sub.textContent = author;
        name.appendChild(sub);
      }
    } else {
      name.textContent = category;
    }
    const count = document.createElement('span');
    count.className = 'category-count';
    count.textContent = items.length;
    if (bySaga) count.title = `${items.length} libros de la saga`;
    const chevron = document.createElement('span');
    chevron.className = 'category-chevron';
    chevron.innerHTML = '<svg viewBox="0 0 24 24" class="setting-chevron"><path d="M6 9l6 6 6-6"/></svg>';
    // Portadas en abanico (se ven con la categoría cerrada)
    const peek = document.createElement('span');
    peek.className = 'category-peek';
    peek.setAttribute('aria-hidden', 'true');
    items.filter((it) => it.cover_url).slice(0, 3).forEach((it) => {
      const img = document.createElement('img');
      img.src = coverSize(it.cover_url, 'S');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      // Nunca el icono de imagen rota: si no carga, se quita
      img.addEventListener('error', () => img.remove(), { once: true });
      peek.appendChild(img);
    });
    h.append(name, count, peek, chevron);

    // Las portadas de cada categoría solo se crean al abrirla por primera vez
    const grid = document.createElement('div');
    grid.className = 'book-grid';
    const fillGrid = () => {
      if (grid.childElementCount) return;
      items.forEach((item) => {
        grid.appendChild(createBookCard(item, () => openCatalogDialog(item), {
          badge: isInLibrary(item),
          volume: bySaga ? item.series_number : null,
        }));
      });
    };
    if (startOpen) fillGrid();

    const panel = document.createElement('div');
    panel.className = 'setting-panel';
    const inner = document.createElement('div');
    inner.className = 'setting-panel-inner';
    inner.appendChild(grid);
    panel.appendChild(inner);

    section.append(h, panel);
    catList.appendChild(section);
  });
}

const catalogDialog = $('catalog-dialog');
let catalogItem = null;

function updateAddButton() {
  const btn = $('btn-add-to-library');
  const wish = $('btn-add-to-wishlist');
  const owned = books.find((b) => sameBook(b, catalogItem));
  if (owned?.status === 'wishlist') {
    // Está en deseados: si ya lo tiene, pasa a Pendientes
    btn.textContent = 'Ya lo tengo: pasar a Pendientes';
    btn.disabled = false;
    wish.textContent = '♥ Está en tus deseados';
    wish.disabled = true;
  } else {
    btn.textContent = owned ? '✓ Ya está en tu biblioteca' : 'Ya lo tengo · Añadir a Pendientes';
    btn.disabled = Boolean(owned);
    wish.textContent = '♡ Lo quiero · Añadir a deseados';
    wish.disabled = Boolean(owned);
  }
  wish.hidden = Boolean(owned) && owned.status !== 'wishlist';
}

async function addCatalogItem(status) {
  if (!catalogItem) return;
  const owned = books.find((b) => sameBook(b, catalogItem));
  $('catalog-error').hidden = true;
  $('btn-add-to-library').disabled = true;
  $('btn-add-to-wishlist').disabled = true;
  try {
    if (owned) {
      if (owned.status !== 'wishlist') return;
      await updateBook(owned.id, { status, owned: status !== 'wishlist' });
    } else {
      const { data, error } = await db.from('books').insert(cleanBook({
        title: catalogItem.title,
        author: catalogItem.author,
        cover_url: catalogItem.cover_url,
        category: catalogItem.category,
        status,
        owned: status !== 'wishlist',
      })).select().single();
      if (error) throw error;
      books = [data, ...books];
      refresh();
    }
  } catch (err) {
    console.error(err);
    $('catalog-error').textContent = `No se pudo añadir. ${explainError(err, 'mejoras.sql')}`;
    $('catalog-error').hidden = false;
  } finally {
    updateAddButton();
  }
}

$('btn-add-to-wishlist').addEventListener('click', () => addCatalogItem('wishlist'));

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

$('btn-add-to-library').addEventListener('click', () => addCatalogItem('pending'));

function updateStats() {
  const count = (s) => books.filter((b) => inLibraryTab(b, s)).length;
  $('stat-read').textContent = count('read');
  $('stat-reading').textContent = count('reading');
  $('stat-pending').textContent = count('pending');
  if (catalogItem && catalogDialog.open) updateAddButton();
  document.querySelectorAll('#status-tabs [data-count]').forEach((el) => {
    el.textContent = count(el.dataset.count);
  });
}

// ---------- Navegación entre pestañas ----------
let currentView = null;

// El fondo resaltado de la barra inferior se desliza hasta la pestaña activa (como Instagram)
// y se adapta al tamaño de cada opción: lo que ocupan su icono y su nombre, más un margen.
// (Usa getElementById/querySelector porque se llama antes de que existan otras constantes.)
function placeTabIndicator() {
  const tabbar = document.querySelector('.tabbar');
  const tab = tabbar?.querySelector('.tab.is-active');
  if (!tab) return;
  const content = Math.max(...[...tab.children].map((el) => el.getBoundingClientRect().width));
  const width = Math.min(tab.offsetWidth - 8, content + 28);
  tabbar.style.setProperty('--ind-w', `${Math.round(width)}px`);
  tabbar.style.setProperty('--ind-x', `${Math.round(tab.offsetLeft + (tab.offsetWidth - width) / 2)}px`);
  // La primera vez se coloca sin animación
  if (!tabbar.classList.contains('is-ready')) requestAnimationFrame(() => requestAnimationFrame(() => tabbar.classList.add('is-ready')));
}
window.addEventListener('resize', placeTabIndicator);
document.fonts?.ready.then(placeTabIndicator); // al cargar la fuente cambia el ancho de los nombres

function goTo(view) {
  currentView = view;
  document.body.dataset.view = view; // p. ej. el botón + solo se ve en la Biblioteca
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('is-active', v.id === `view-${view}`);
  });
  const tabs = [...document.querySelectorAll('.tabbar .tab')];
  tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.goto === view));
  placeTabIndicator();
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  window.scrollTo(0, 0);
  updatePetMode();
}

document.querySelectorAll('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => goTo(btn.dataset.goto));
});

// ---------- Deslizar el dedo para cambiar de pestaña ----------
// La pestaña actual se mueve con el dedo y deja ver la siguiente; al soltar, se completa el cambio si
// has deslizado lo suficiente (o rápido) y si no, vuelve a su sitio. Solo se engancha a gestos claramente
// horizontales: el scroll vertical, los carruseles, los campos de texto, las ventanas y la guía no se tocan.
const VIEW_ORDER = ['library', 'explore', 'reading', 'profile'];
const SWIPE_EASE = 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)';
let drag = null;

function scrollsSideways(el) {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.matches('input, textarea, select, [contenteditable], .no-swipe')) return true;
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) return true;
  }
  return false;
}

// Coloca la vista vecina a un lado, fija bajo la cabecera, como si ya estuviera arriba del todo
function preparePeek(view) {
  const el = $(`view-${view}`);
  const box = document.querySelector('.content').getBoundingClientRect();
  const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
  Object.assign(el.style, {
    display: 'block', position: 'fixed', top: `${Math.max(0, top)}px`, left: `${box.left}px`,
    width: `${box.width}px`, bottom: '0', padding: '20px 20px 0', overflow: 'hidden',
    zIndex: '5', animation: 'none', willChange: 'transform', pointerEvents: 'none',
  });
  return el;
}
function resetPeek(el) { if (el) el.removeAttribute('style'); }

function renderDrag() {
  drag.raf = 0;
  const i = VIEW_ORDER.indexOf(currentView);
  const dir = drag.dx < 0 ? 1 : -1;
  const target = VIEW_ORDER[i + dir];
  // En la primera y la última pestaña, el gesto ofrece resistencia y no hay nada detrás
  const dx = target ? drag.dx : drag.dx * 0.25;
  if (target !== drag.target) {
    resetPeek(drag.peek);
    drag.peek = target ? preparePeek(target) : null;
    drag.target = target;
  }
  drag.cur.style.transform = `translate3d(${dx}px, 0, 0)`;
  if (drag.peek) drag.peek.style.transform = `translate3d(${dx + (dir > 0 ? drag.width : -drag.width)}px, 0, 0)`;
}

function endDrag(commit) {
  const d = drag;
  drag = null;
  if (d.raf) cancelAnimationFrame(d.raf);
  const dir = d.dx < 0 ? 1 : -1;
  [d.cur, d.peek].forEach((el) => { if (el) el.style.transition = SWIPE_EASE; });
  if (commit) {
    d.cur.style.transform = `translate3d(${-dir * d.width}px, 0, 0)`;
    d.peek.style.transform = 'translate3d(0, 0, 0)';
  } else {
    d.cur.style.transform = 'translate3d(0, 0, 0)';
    if (d.peek) d.peek.style.transform = `translate3d(${dir * d.width}px, 0, 0)`;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    document.body.dataset.swipe = 'drag'; // sin la animación de entrada: la vista ya está en su sitio
    resetPeek(d.peek);
    d.cur.removeAttribute('style');
    if (commit) goTo(d.target);
    document.body.classList.remove('is-swiping');
    requestAnimationFrame(() => { delete document.body.dataset.swipe; });
  };
  d.cur.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 340);
}

document.addEventListener('touchstart', (e) => {
  if (drag) return;
  if (e.touches.length !== 1 || document.body.classList.contains('touring')) return;
  if (document.querySelector('dialog[open]') || !e.target.closest('.content')) return;
  if (scrollsSideways(e.target)) return;
  const t = e.touches[0];
  drag = { x: t.clientX, y: t.clientY, time: Date.now(), lock: null, dx: 0 };
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!drag) return;
  const t = e.touches[0];
  const dx = t.clientX - drag.x;
  const dy = t.clientY - drag.y;
  if (!drag.lock) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.3) { drag = null; return; } // es scroll vertical
    drag.lock = true;
    drag.x = t.clientX; // empieza desde aquí para que no dé un salto
    drag.cur = $(`view-${currentView}`);
    drag.width = document.querySelector('.content').getBoundingClientRect().width;
    document.body.classList.add('is-swiping');
    return;
  }
  e.preventDefault();
  drag.dx = t.clientX - drag.x;
  if (!drag.raf) drag.raf = requestAnimationFrame(renderDrag);
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!drag) return;
  if (!drag.lock) { drag = null; return; }
  if (drag.raf) { cancelAnimationFrame(drag.raf); renderDrag(); } // aplica el último movimiento pendiente
  const speed = Math.abs(drag.dx) / Math.max(1, Date.now() - drag.time);
  const commit = Boolean(drag.peek) && (Math.abs(drag.dx) > drag.width * 0.33 || (speed > 0.45 && Math.abs(drag.dx) > 40));
  endDrag(commit);
}, { passive: true });

document.addEventListener('touchcancel', () => { if (drag?.lock) endDrag(false); else drag = null; }, { passive: true });

// ---------- Búsqueda ----------
const searchBar = $('search-bar');
const searchInput = $('search-input');

// Búsqueda por título, autor o saga, sin importar acentos, mayúsculas, signos ni el orden de las
// palabras: «garcia marquez», «douglas penelope» o «jrr tolkien» encuentran lo que se espera.
const searchText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/(\b\w)\.\s*(?=\w\b\.?)/g, '$1') // «j. r. r.» -> «jrr»
  .replace(/[^a-z0-9ñ]+/g, ' ').trim();
const searchIndex = new WeakMap(); // texto ya preparado de cada libro (no se recalcula en cada letra)
function matches(b, q) {
  const words = searchText(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  let text = searchIndex.get(b);
  if (!text) {
    const author = searchText(b.author);
    // también el autor sin espacios entre iniciales («j r r tolkien» -> «jrr tolkien»)
    text = ` ${searchText(b.title)} ${author} ${author.replace(/\b(\w) (?=\w\b)/g, '$1')} ${searchText(b.series)} `;
    searchIndex.set(b, text);
  }
  return words.every((w) => text.includes(w));
}

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

// Al escribir se espera un instante para no repintar las listas con cada letra
let searchDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(applySearch, 140);
});

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

// ---------- Añadir libro: solo desde la búsqueda ----------
// Se busca (o se escanea), se elige el resultado y se indican estado, puntuación y notas,
// igual que en la ficha de un libro. El formulario completo queda para «Editar detalles».
let newPick = null;     // libro elegido en la búsqueda
let newStatus = 'pending';
let newRating = null;

function renderNewPick() {
  document.querySelectorAll('#new-status .segment').forEach((seg) => {
    const on = seg.dataset.status === newStatus;
    seg.classList.toggle('is-active', on);
    seg.setAttribute('aria-checked', String(on));
  });
  const stars = $('new-stars');
  stars.innerHTML = '';
  for (let n = 1; n <= 5; n++) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = `star${(newRating || 0) >= n ? ' is-on' : ''}`;
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-checked', String(newRating === n));
    s.setAttribute('aria-label', `${n} ${n === 1 ? 'estrella' : 'estrellas'}`);
    s.innerHTML = STAR_SVG;
    s.addEventListener('click', () => { newRating = newRating === n ? null : n; renderNewPick(); });
    stars.appendChild(s);
  }
  $('btn-save').disabled = !editingId && !newPick;
}

function pickNewBook(c) {
  newPick = c;
  const cover = $('new-pick-cover');
  cover.style.backgroundImage = c.cover_url ? `url("${c.cover_url.replace('-L.jpg', '-M.jpg')}")` : '';
  $('new-pick-title').textContent = c.title;
  $('new-pick-meta').textContent = [
    c.author,
    c.series ? `${c.series} #${c.series_number}` : '',
    c.total_pages ? `${c.total_pages} págs.` : '',
  ].filter(Boolean).join(' · ');
  const owned = books.find((x) => sameBook(x, c));
  lookupStatus(owned ? 'Ojo: este libro ya está en tu biblioteca.' : '');
  // Se esconde la búsqueda y aparece el libro elegido
  $('lookup-results').hidden = true;
  $('lookup').querySelector('.lookup-bar').hidden = true;
  $('new-pick').hidden = false;
  renderNewPick();
}

function unpickNewBook() {
  newPick = null;
  $('new-pick').hidden = true;
  $('lookup-results').hidden = false;
  $('lookup').querySelector('.lookup-bar').hidden = false;
  lookupStatus('');
  renderNewPick();
  $('lookup-input').focus();
}

document.querySelectorAll('#new-status .segment').forEach((seg) => {
  seg.addEventListener('click', () => { newStatus = seg.dataset.status; renderNewPick(); });
});
$('new-pick-change').addEventListener('click', unpickNewBook);

function openBookDialog(book = null) {
  editingId = book?.id ?? null;
  bookForm.reset();
  $('book-error').hidden = true;
  $('book-dialog-title').textContent = book ? 'Editar libro' : 'Añadir libro';
  $('btn-delete').hidden = !book;

  // Añadir: solo búsqueda + estado/puntuación/notas. Editar: formulario completo.
  $('manual-fields').hidden = !book;
  bookForm.noValidate = !book; // los campos ocultos del formulario completo no deben bloquear el guardado
  newPick = null;
  newStatus = libraryStatus === 'owned' ? 'pending' : (['pending', 'reading', 'read', 'wishlist'].includes(libraryStatus) ? libraryStatus : 'pending');
  newRating = null;
  $('new-notes').value = '';
  $('new-pick').hidden = true;
  $('lookup-results').hidden = false;
  $('lookup').querySelector('.lookup-bar').hidden = false;
  renderNewPick();

  // El buscador solo aparece al añadir
  $('lookup').hidden = Boolean(book);
  $('lookup-input').value = '';
  $('lookup-results').innerHTML = '';
  lookupStatus('');
  // Los campos nuevos solo si se ejecutó mejoras.sql
  ['series', 'series_number', 'total_pages', 'current_page', 'category'].forEach((name) => {
    bookForm[name].closest('.field').hidden = missingCols.has(name);
  });

  if (book) {
    bookForm.title.value = book.title;
    bookForm.author.value = book.author;
    bookForm.status.value = book.status;
    bookForm.rating.value = book.rating ?? '';
    bookForm.finished_at.value = book.finished_at ?? '';
    bookForm.cover_url.value = book.cover_url ?? '';
    bookForm.notes.value = book.notes;
    bookForm.series.value = book.series ?? '';
    bookForm.series_number.value = book.series_number ?? '';
    bookForm.total_pages.value = book.total_pages ?? '';
    bookForm.current_page.value = book.current_page ?? '';
    bookForm.category.value = book.category ?? categoryOf(book) ?? '';
    bookForm.owned.checked = isOwned(book);
    selectedColor = book.cover_color;
  } else {
    // Por defecto, el apartado en el que estás («En propiedad» = pendiente y lo tiene)
    bookForm.status.value = libraryStatus === 'owned' ? 'pending' : libraryStatus;
    bookForm.owned.checked = libraryStatus !== 'wishlist';
    selectedColor = COVER_COLORS[books.length % COVER_COLORS.length];
  }
  syncOwnedField();
  renderSwatches();
  dialog.showModal();
}

// «Deseado» significa que aún no lo tiene: el interruptor «Lo tengo» se oculta
function syncOwnedField() {
  const wish = bookForm.status.value === 'wishlist';
  $('owned-field').hidden = !hasOwned || wish;
  if (wish) bookForm.owned.checked = false;
}
bookForm.status.addEventListener('change', () => {
  if (bookForm.status.value !== 'wishlist' && !bookForm.owned.checked && $('owned-field').hidden) bookForm.owned.checked = true;
  syncOwnedField();
});

// Sugerencias de sagas y categorías al escribir
function renderFormLists() {
  const fill = (id, values) => {
    const list = $(id);
    list.innerHTML = '';
    [...new Set(values.filter(Boolean))].sort(collator.compare).forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      list.appendChild(o);
    });
  };
  fill('series-list', books.map((b) => b.series));
  fill('category-list', [...catalog.map((c) => c.category), ...books.map((b) => b.category)]);
}

const intOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));

// Guarda el libro elegido en la búsqueda
async function saveNewBook() {
  if (!newPick) return showBookError('Busca el libro y elígelo de la lista.');
  const c = newPick;
  const payload = {
    title: c.title,
    author: c.author || '',
    cover_url: c.cover_url || null,
    cover_color: selectedColor,
    series: c.series || null,
    series_number: c.series_number ?? null,
    total_pages: c.total_pages || null,
    category: categoryOf(c) || null,
    status: newStatus,
    rating: newRating,
    notes: $('new-notes').value.trim(),
    owned: newStatus !== 'wishlist',
    // Igual que en la ficha: al marcarlo como leído se pone la fecha de hoy
    finished_at: newStatus === 'read' ? todayISO() : null,
  };
  $('btn-save').disabled = true;
  const { data, error } = await db.from('books').insert(cleanBook(payload)).select().single();
  $('btn-save').disabled = false;
  if (error) {
    console.error(error);
    return showBookError(`No se pudo guardar. ${explainError(error, 'mejoras.sql')}`);
  }
  books = [data, ...books];
  dialog.close();
  refresh();
  // Se muestra en su apartado
  setLibraryTab(data.status === 'wishlist' ? 'wishlist' : data.status);
}

$('btn-add').addEventListener('click', () => openBookDialog());
$('btn-close-dialog').addEventListener('click', () => dialog.close());

function showBookError(msg) {
  $('book-error').textContent = msg;
  $('book-error').hidden = false;
}

bookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editingId) return saveNewBook();
  const payload = {
    title: bookForm.title.value.trim(),
    author: bookForm.author.value.trim(),
    status: bookForm.status.value,
    rating: bookForm.rating.value ? Number(bookForm.rating.value) : null,
    finished_at: bookForm.finished_at.value || null,
    cover_url: bookForm.cover_url.value.trim() || null,
    cover_color: selectedColor,
    notes: bookForm.notes.value.trim(),
    series: bookForm.series.value.trim() || null,
    series_number: bookForm.series_number.value === '' ? null : Number(bookForm.series_number.value),
    total_pages: intOrNull(bookForm.total_pages.value) || null,
    current_page: intOrNull(bookForm.current_page.value),
    category: bookForm.category.value.trim() || null,
    owned: bookForm.status.value !== 'wishlist' && bookForm.owned.checked,
  };
  if (!payload.title) return showBookError('El título es obligatorio.');
  if (payload.total_pages && payload.current_page > payload.total_pages) {
    return showBookError('La página actual no puede ser mayor que el total de páginas.');
  }

  $('btn-save').disabled = true;
  const before = editingId ? books.find((b) => b.id === editingId) : null;
  const query = editingId
    ? db.from('books').update(cleanBook(payload)).eq('id', editingId).select().single()
    : db.from('books').insert(cleanBook(payload)).select().single();
  const { data, error } = await query;
  $('btn-save').disabled = false;

  if (error) {
    console.error(error);
    return showBookError(`No se pudo guardar. ${explainError(error, 'mejoras.sql')}`);
  }

  if (editingId) {
    books = books.map((b) => (b.id === editingId ? data : b));
  } else {
    books = [data, ...books];
  }
  dialog.close();
  refresh();
  afterBookChange(before, data);
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

// ---------- Apariencia (automático / claro / oscuro) ----------
const THEME_KEY = 'theme';
const PALETTE_KEY = 'palette';
// Fondo de cada tema (claro / oscuro), para la barra superior del iPhone
const PALETTE_SURFACES = {
  cafe: { light: '#f6f2e9', dark: '#1c1916' },
  rosa: { light: '#fbf5f4', dark: '#1d1719' },
  salvia: { light: '#f3f5ee', dark: '#171c18' },
  lavanda: { light: '#f6f3fa', dark: '#19161f' },
  oceano: { light: '#f2f6f8', dark: '#141a1f' },
  gotico: { light: '#f7f4f3', dark: '#120d0e' },
};
const currentPalette = () => (PALETTE_SURFACES[localStorage.getItem(PALETTE_KEY)] ? localStorage.getItem(PALETTE_KEY) : 'cafe');

function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
  else delete root.dataset.theme;
  const palette = currentPalette();
  if (palette === 'cafe') delete root.dataset.palette;
  else root.dataset.palette = palette;
  // Color de la barra superior del navegador / iPhone
  const colors = PALETTE_SURFACES[palette];
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const media = meta.getAttribute('media') || '';
    const auto = media.includes('dark') ? colors.dark : colors.light;
    meta.setAttribute('content', choice === 'light' || choice === 'dark' ? colors[choice] : auto);
  });
}

const paletteSelect = $('palette-select');
paletteSelect.value = currentPalette();
paletteSelect.addEventListener('change', () => {
  if (paletteSelect.value === 'cafe') localStorage.removeItem(PALETTE_KEY);
  else localStorage.setItem(PALETTE_KEY, paletteSelect.value);
  applyTheme(themeSelect.value);
});

const themeSelect = $('theme-select');
themeSelect.value = localStorage.getItem(THEME_KEY) || 'auto';
if (!themeSelect.value) themeSelect.value = 'auto';
applyTheme(themeSelect.value);
themeSelect.addEventListener('change', () => {
  if (themeSelect.value === 'auto') localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, themeSelect.value);
  applyTheme(themeSelect.value);
});

// ---------- Ficha de un libro de la Biblioteca ----------
const detailDialog = $('detail-dialog');
let detailBook = null;
let detailTimeRequest = 0;

const STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';
const finishedFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' });

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function formatDateOnly(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return finishedFmt.format(new Date(y, m - 1, d));
}

function renderDetail() {
  const b = detailBook;
  if (!b) return;

  const cover = $('detail-cover');
  cover.textContent = '';
  if (b.cover_url) {
    // Primero la mediana (que normalmente ya está guardada de la cuadrícula) y, en cuanto llega, la grande
    const quick = coverSize(b.cover_url, 'M');
    const big = coverSize(b.cover_url, 'L');
    cover.style.setProperty('--cover', `url("${encodeURI(quick)}")`);
    cover.style.removeProperty('--ink');
    if (big !== quick) {
      const pre = new Image();
      pre.onload = () => { if (detailBook?.id === b.id) cover.style.setProperty('--cover', `url("${encodeURI(big)}")`); };
      pre.src = big;
    }
  } else {
    const color = b.cover_color || COVER_COLORS[0];
    cover.style.setProperty('--cover', color);
    cover.style.setProperty('--ink', inkFor(color));
    cover.textContent = b.title;
  }
  $('detail-title').textContent = b.title;
  $('detail-author').textContent = b.author || '';
  $('detail-author').hidden = !b.author;

  // Fondo: la propia portada difuminada (o su color)
  const bg = $('detail-hero-bg');
  bg.style.background = b.cover_url
    ? `center / cover no-repeat url("${encodeURI(coverSize(b.cover_url, 'M'))}")`
    : (b.cover_color || COVER_COLORS[0]);

  // Etiquetas: categoría, saga y páginas
  const tags = $('detail-tags');
  tags.innerHTML = '';
  [
    categoryOf(b),
    b.series ? `${b.series}${b.series_number != null ? ` #${Number(b.series_number)}` : ''}` : '',
    b.total_pages ? `${b.total_pages} páginas` : '',
  ].filter(Boolean).forEach((text) => {
    const t = document.createElement('span');
    t.className = 'detail-tag';
    t.textContent = text;
    tags.appendChild(t);
  });
  tags.hidden = !tags.children.length;

  // Estrellas
  const stars = $('detail-stars');
  stars.innerHTML = '';
  for (let n = 1; n <= 5; n++) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = `star${(b.rating || 0) >= n ? ' is-on' : ''}`;
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-checked', String(b.rating === n));
    s.setAttribute('aria-label', `${n} ${n === 1 ? 'estrella' : 'estrellas'}`);
    s.innerHTML = STAR_SVG;
    // Tocar la misma estrella otra vez quita la puntuación
    s.addEventListener('click', () => saveDetail({ rating: b.rating === n ? null : n }));
    stars.appendChild(s);
  }

  // Estado
  document.querySelectorAll('#detail-status .segment').forEach((seg) => {
    const on = seg.dataset.status === b.status;
    seg.classList.toggle('is-active', on);
    seg.setAttribute('aria-checked', String(on));
    seg.setAttribute('role', 'radio');
  });

  // Fecha de fin (solo si está leído)
  const showFinished = b.status === 'read' && b.finished_at;
  $('detail-finished-row').hidden = !showFinished;
  if (showFinished) $('detail-finished').textContent = formatDateOnly(b.finished_at);

  // ¿Lo tiene? (no aplica a los deseados)
  $('detail-owned-row').hidden = !hasOwned || b.status === 'wishlist';
  $('detail-owned').checked = isOwned(b);

  renderDetailProgress();
  renderDetailSeries();

  // Reseña (no se pisa mientras se está escribiendo)
  const review = $('detail-review');
  if (document.activeElement !== review) review.value = b.notes || '';
}

// Progreso: página actual, porcentaje y cuánto falta a su ritmo
let detailSeconds = 0;
function renderDetailProgress() {
  const b = detailBook;
  const row = $('detail-progress-row');
  row.hidden = !hasExtras || b.status === 'wishlist';
  if (row.hidden) return;
  const cur = b.current_page || 0;
  const total = b.total_pages || 0;
  const pct = total ? Math.min(100, Math.round((cur / total) * 100)) : 0;
  $('detail-progress-text').textContent = total
    ? (cur ? `Pág. ${cur} de ${total} · ${pct}%` : `${total} páginas · Añadir página`)
    : (cur ? `Pág. ${cur}` : 'Añadir página');
  $('detail-progress-track').hidden = !(total && cur);
  $('detail-progress-bar').style.width = `${pct}%`;

  const eta = $('detail-progress-eta');
  const canEstimate = total && cur > 0 && cur < total && detailSeconds >= 600 && b.status !== 'read';
  eta.hidden = !canEstimate;
  if (canEstimate) {
    const remaining = ((total - cur) * detailSeconds) / cur;
    eta.textContent = `Te faltan unas ${fmtDuration(remaining)} a tu ritmo`;
  }
}

// Saga: los tomos en orden y cuál toca después
const sameSeries = (a, b) => a.series && b.series && a.series.trim().toLowerCase() === b.series.trim().toLowerCase();
const bySeriesNumber = (a, b) => (Number(a.series_number) || 999) - (Number(b.series_number) || 999) || byTitle(a, b);

function nextInSeries(book) {
  if (!book.series || book.series_number == null) return null;
  const n = Math.floor(Number(book.series_number)) + 1;
  return { number: n, book: books.find((x) => sameSeries(x, book) && Number(x.series_number) === n) || null };
}

function renderDetailSeries() {
  const b = detailBook;
  const box = $('detail-series');
  box.hidden = !b.series;
  if (!b.series) return;
  const saga = books.filter((x) => sameSeries(x, b)).sort(bySeriesNumber);
  $('detail-series-title').textContent = `Saga ${b.series.trim()}`;

  const list = $('detail-series-list');
  list.innerHTML = '';
  saga.forEach((x) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `series-item${x.id === b.id ? ' is-current' : ''}${x.status === 'read' ? ' is-read' : ''}`;
    item.setAttribute('aria-label', `${x.series_number != null ? `Tomo ${x.series_number}: ` : ''}${x.title}${x.status === 'read' ? ', leído' : ''}`);
    const cover = document.createElement('span');
    cover.className = 'series-cover';
    if (x.cover_url) cover.style.backgroundImage = `url("${encodeURI(x.cover_url.replace('-L.jpg', '-M.jpg'))}")`;
    else cover.style.background = x.cover_color || COVER_COLORS[0];
    const num = document.createElement('span');
    num.className = 'series-num';
    num.textContent = x.series_number != null ? `#${Number(x.series_number)}` : '·';
    item.append(cover, num);
    if (x.id !== b.id) item.addEventListener('click', () => openDetailDialog(x));
    list.appendChild(item);
  });

  const nextEl = $('detail-series-next');
  const next = nextInSeries(b);
  nextEl.hidden = true;
  nextEl.innerHTML = '';
  if (!next || b.status === 'wishlist' || b.status === 'pending') return;
  if (next.book && next.book.status !== 'read') {
    nextEl.append(`Siguiente: tomo ${next.number}, `);
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'link-btn';
    link.textContent = `«${next.book.title}»`;
    link.addEventListener('click', () => openDetailDialog(next.book));
    nextEl.appendChild(link);
    nextEl.hidden = false;
  } else if (!next.book && b.status === 'read') {
    nextEl.textContent = `El tomo ${next.number} aún no está en tu biblioteca. ¿Lo añades a deseados?`;
    nextEl.hidden = false;
  }
}

// Reseña: se guarda sola al dejar de escribir
let reviewTimer = null;
$('detail-review').addEventListener('input', () => {
  clearTimeout(reviewTimer);
  const status = $('detail-review-status');
  status.hidden = true;
  reviewTimer = setTimeout(async () => {
    if (!detailBook) return;
    const notes = $('detail-review').value.trim();
    if (notes === (detailBook.notes || '')) return;
    await saveDetail({ notes });
    status.textContent = 'Guardado ✓';
    status.hidden = false;
  }, 800);
});
$('detail-owned').addEventListener('change', (e) => {
  if (detailBook) saveDetail({ owned: e.target.checked });
});
$('detail-progress-row').addEventListener('click', () => {
  if (detailBook) openProgressDialog(detailBook);
});

document.querySelectorAll('#detail-status .segment').forEach((seg) => {
  seg.addEventListener('click', () => {
    if (!detailBook || seg.dataset.status === detailBook.status) return;
    const changes = { status: seg.dataset.status };
    // Al marcarlo como leído se pone la fecha de hoy (si no tenía)
    if (changes.status === 'read' && !detailBook.finished_at) changes.finished_at = todayISO();
    // Deseado = aún no lo tiene; al salir de deseados se entiende que ya lo tiene
    if (hasOwned && changes.status === 'wishlist') changes.owned = false;
    else if (hasOwned && detailBook.status === 'wishlist') changes.owned = true;
    saveDetail(changes);
  });
});

async function saveDetail(changes) {
  const before = detailBook;
  $('detail-error').hidden = true;
  // Se actualiza al momento y se guarda en segundo plano
  detailBook = { ...before, ...changes };
  renderDetail();

  const { data, error } = await db.from('books').update(cleanBook(changes)).eq('id', before.id).select().single();
  if (error) {
    console.error(error);
    if (detailBook && detailBook.id === before.id) {
      detailBook = before;
      renderDetail();
    }
    $('detail-error').textContent = `No se pudo guardar el cambio. ${explainError(error, changes.status === 'wishlist' ? 'mejoras.sql' : 'schema.sql')}`;
    $('detail-error').hidden = false;
    return;
  }
  const original = books.find((b) => b.id === data.id) || before;
  books = books.map((b) => (b.id === data.id ? data : b));
  if (detailBook && detailBook.id === data.id) {
    detailBook = data;
    renderDetail();
  }
  refresh();
  afterBookChange(original, data);
}

async function loadDetailTime(bookId) {
  const req = ++detailTimeRequest;
  $('detail-time').textContent = 'Calculando…';
  const { data, error } = await db.from('reading_sessions').select('duration_seconds').eq('book_id', bookId);
  if (req !== detailTimeRequest) return; // se abrió otro libro mientras tanto
  if (error) {
    console.error(error);
    $('detail-time').textContent = '—';
    return;
  }
  const total = (data || []).reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
  detailSeconds = total;
  if (detailBook) renderDetailProgress();
  $('detail-time').textContent = total
    ? `${fmtDuration(total)} · ${data.length} ${data.length === 1 ? 'lectura' : 'lecturas'}`
    : 'Aún sin lecturas';
}

function openDetailDialog(book) {
  detailBook = book;
  detailSeconds = 0;
  $('detail-error').hidden = true;
  $('detail-review-status').hidden = true;
  $('detail-review').value = book.notes || '';
  renderDetail();
  loadDetailTime(book.id);
  loadQuotes(book.id);
  if (!detailDialog.open) detailDialog.showModal();
  detailDialog.scrollTop = 0;
}

$('btn-close-detail').addEventListener('click', () => detailDialog.close());
detailDialog.addEventListener('close', () => {
  // El aviso de «cerrado» llega un instante después: si ya se ha abierto otra ficha, no se toca
  if (detailDialog.open) return;
  // Si se cierra justo después de escribir la reseña, se guarda igualmente
  if (reviewTimer && detailBook) {
    clearTimeout(reviewTimer);
    const notes = $('detail-review').value.trim();
    if (notes !== (detailBook.notes || '')) saveDetail({ notes });
  }
  reviewTimer = null;
  detailBook = null;
});

// La ficha es solo de consulta: los datos del libro no se editan aquí, pero sí se puede eliminar
$('btn-detail-delete').addEventListener('click', async () => {
  const book = detailBook;
  if (!book || !confirm(`¿Eliminar «${book.title}» de tu biblioteca? Se borrarán también sus citas. No se puede deshacer.`)) return;
  const { error } = await db.from('books').delete().eq('id', book.id);
  if (error) {
    console.error(error);
    $('detail-error').textContent = `No se pudo eliminar. ${explainError(error, 'schema.sql')}`;
    $('detail-error').hidden = false;
    return;
  }
  books = books.filter((b) => b.id !== book.id);
  detailDialog.close();
  refresh();
});

$('btn-detail-read').addEventListener('click', () => {
  const book = detailBook;
  detailDialog.close();
  if (!book) return;
  goTo('reading');
  if (!timer) {
    readingBookTouched = true;
    $('reading-book').value = book.id;
  }
});

// ---------- Explicar errores de Supabase ----------
// Traduce los errores más habituales a un mensaje que diga qué hacer.
function explainError(err, setupFile) {
  const msg = String(err?.message || err?.error || err || '');
  const code = String(err?.code || err?.statusCode || '');
  if (/could not find the '.*' column|column .* does not exist|books_status_check|PGRST204|42703|23514/i.test(`${msg} ${code}`)) {
    return 'Falta actualizar Supabase: ejecuta supabase/mejoras.sql en el SQL Editor.';
  }
  if (/bucket not found/i.test(msg) || code === 'PGRST205' || /could not find the table/i.test(msg)) {
    return `Falta configurar Supabase: ejecuta supabase/${setupFile} en el SQL Editor.`;
  }
  if (/row-level security|permission denied|42501|Unauthorized|403/i.test(msg + code)) {
    return `Supabase no ha dado permiso. Vuelve a ejecutar supabase/${setupFile} en el SQL Editor.`;
  }
  if (/mime|not supported|invalid_mime/i.test(msg)) return 'Ese tipo de imagen no está permitido.';
  if (/size|too large|exceeded/i.test(msg)) return 'La imagen es demasiado grande.';
  if (/fetch|network|Failed to fetch/i.test(msg)) return 'Sin conexión. Revisa internet e inténtalo de nuevo.';
  return msg ? `Error: ${msg}` : 'Error desconocido.';
}

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
  $('avatar-initial').textContent = (displayName(currentUser) || '?').charAt(0);
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
  const saved = readCache('avatar');
  if (saved && saved.path === path && saved.expires > Date.now()) return setAvatar(saved.url);
  const { data, error } = await db.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) {
    console.error(error);
    return setAvatar(null);
  }
  // Válido 7 días; se guarda para 6 y así no se pide cada vez que se abre la app
  writeCache('avatar', { path, url: data.signedUrl, expires: Date.now() + 6 * 24 * 3600 * 1000 });
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
    avatarStatus(`No se pudo subir la foto. ${explainError(err, 'avatars.sql')}`, true);
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
    return avatarStatus(`No se pudo quitar la foto. ${explainError(error, 'avatars.sql')}`, true);
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
  'series': {
    label: 'Por saga (en orden)', short: 'Saga',
    // Primero los libros con saga, agrupados y en orden de tomo; después el resto por título
    cmp: (a, b) => (a.series ? 0 : 1) - (b.series ? 0 : 1)
      || collator.compare(a.series || '', b.series || '')
      || bySeriesNumber(a, b),
  },
};

const VIEW_OPTIONS = {
  library: {
    sorts: ['title-asc', 'title-desc', 'author-asc', 'recent', 'rating', 'finished', 'series'],
    defaults: { sort: 'title-asc', minRating: 0, withNotes: false },
  },
  explore: {
    sorts: ['title-asc', 'title-desc', 'author-asc'],
    defaults: { sort: 'title-asc', hideOwned: false, group: 'category' },
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
    const sagas = view === 'explore' && prefs.explore.group === 'series';
    chip.querySelector('.chip-label').textContent = sagas
      ? `Por saga${n ? ` · ${n} ${n === 1 ? 'filtro' : 'filtros'}` : ''}`
      : `${SORTS[prefs[view].sort].short}${n ? ` · ${n} ${n === 1 ? 'filtro' : 'filtros'}` : ''}`;
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
    const group = document.createElement('select');
    [['category', 'Categoría'], ['series', 'Saga']].forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      group.appendChild(o);
    });
    group.value = p.group;
    group.addEventListener('change', () => { p.group = group.value; onPrefsChange(); });
    filterWrap.appendChild(optionRow('Agrupar por', group));

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

// ---------- Lectura (temporizador) ----------
// El estado se guarda en el dispositivo con marcas de tiempo reales, así el tiempo
// sigue siendo correcto aunque se cierre la app o se bloquee el móvil.
const TIMER_KEY = 'reading-timer';
const GOAL_KEY = 'daily-goal-min';
const GOAL_DONE_KEY = 'goal-celebrated';
const RING_LENGTH = 339.292; // 2 * PI * 54
let todaySeconds = 0;        // lo leído hoy en lecturas ya guardadas

const goalMinutes = () => Number(localStorage.getItem(GOAL_KEY)) || 20;
const todayStamp = () => new Date().toDateString();

function updateClock() {
  const ms = elapsedMs();
  const el = $('timer-time');
  el.textContent = fmtClock(ms);
  el.classList.toggle('has-hours', ms >= 3600000);
  renderRing();
}

// Anillo: lo leído hoy (guardado + lectura en curso) respecto al objetivo diario
// El círculo empieza vacío en cada lectura y se llena con el tiempo de esta lectura
// (lleno = tiempo del objetivo diario). Debajo, «Hoy X / Y min» sigue sumando todo el día.
function renderRing() {
  const session = Math.round(elapsedMs() / 1000);
  const total = todaySeconds + session;
  const goal = goalMinutes();
  const p = Math.min(1, session / (goal * 60));
  $('ring-progress').style.strokeDashoffset = String(RING_LENGTH * (1 - p));
  $('ring-progress').style.opacity = p > 0 ? '1' : '0'; // sin el puntito del extremo redondeado a 0
  $('timer-goal').textContent = `Hoy ${Math.floor(total / 60)} / ${goal} min`;
  const ring = document.querySelector('.timer-ring');
  ring.classList.toggle('is-full', p >= 1);                          // círculo completo
  ring.classList.toggle('is-complete', total >= goal * 60);         // objetivo del día cumplido
}

// true solo la primera vez que se alcanza el objetivo cada día
function goalJustReached() {
  const total = todaySeconds + Math.round(elapsedMs() / 1000);
  if (total < goalMinutes() * 60 || localStorage.getItem(GOAL_DONE_KEY) === todayStamp()) return false;
  localStorage.setItem(GOAL_DONE_KEY, todayStamp());
  return true;
}

const goalSelect = $('goal-select');
goalSelect.value = String(goalMinutes());
if (!goalSelect.value) goalSelect.value = '20';
goalSelect.addEventListener('change', () => {
  localStorage.setItem(GOAL_KEY, goalSelect.value);
  renderRing();
});
const MIN_SESSION_MS = 10000; // por debajo de 10 s no se guarda
let sessions = [];
let sessionsError = false;
let timerTick = null;
let readingBookTouched = false;

function loadTimer() {
  try {
    const t = JSON.parse(localStorage.getItem(TIMER_KEY));
    return t && (t.status === 'running' || t.status === 'paused') ? t : null;
  } catch {
    return null;
  }
}
let timer = loadTimer(); // { status, bookId, bookTitle, startedAt, segmentStart, accumulated }

function saveTimer() {
  if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  else localStorage.removeItem(TIMER_KEY);
}

function elapsedMs() {
  if (!timer) return 0;
  return timer.accumulated + (timer.status === 'running' ? Date.now() - timer.segmentStart : 0);
}

const pad2 = (n) => String(n).padStart(2, '0');
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}
function fmtDuration(sec) {
  if (sec < 60) return '<1 min';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

function timerError(msg) {
  $('timer-error').textContent = msg || '';
  $('timer-error').hidden = !msg;
}

function renderTimer() {
  const status = timer?.status || 'idle';
  updateClock();
  const box = document.querySelector('.timer');
  box.classList.toggle('is-running', status === 'running');
  box.classList.toggle('is-paused', status === 'paused');
  $('timer-status').textContent =
    status === 'running' ? (timer.bookTitle ? `Leyendo «${timer.bookTitle}»` : 'Leyendo…')
      : status === 'paused' ? 'En pausa'
        : 'Listo para empezar';
  $('btn-timer-start').hidden = status !== 'idle';
  $('btn-timer-pause').hidden = status === 'idle';
  $('btn-timer-pause').textContent = status === 'paused' ? 'Reanudar' : 'Pausar';
  $('btn-timer-finish').hidden = status === 'idle';
  $('reading-book').disabled = status !== 'idle';
  refreshSettingGroup('reading-book');
  const dot = $('reading-dot');
  dot.hidden = status === 'idle';
  dot.classList.toggle('is-paused', status === 'paused');

  clearInterval(timerTick);
  if (status === 'running') {
    timerTick = setInterval(() => {
      updateClock();
      if (goalJustReached()) {
        petSay({ text: `🎉 ¡Objetivo de hoy conseguido! Llevas ${fmtDuration(todaySeconds + Math.round(elapsedMs() / 1000))} leídos hoy.` });
      }
    }, 1000);
  }
  updatePetMode();
  syncWakeLock();
}

function renderReadingBookOptions() {
  const sel = $('reading-book');
  const previous = timer ? timer.bookId || '' : sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Sin libro concreto';
  sel.appendChild(none);

  [['reading', 'Leyendo'], ['pending', 'Pendientes'], ['read', 'Leídos']].forEach(([status, label]) => {
    const list = books.filter((b) => b.status === status).sort(byTitle);
    if (!list.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    list.forEach((b) => {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.author ? `${b.title} — ${b.author}` : b.title;
      group.appendChild(o);
    });
    sel.appendChild(group);
  });

  // Si la sesión en marcha es de un libro que ya no está, se muestra igualmente
  if (timer?.bookId && !books.some((b) => b.id === timer.bookId)) {
    const o = document.createElement('option');
    o.value = timer.bookId;
    o.textContent = timer.bookTitle || 'Libro';
    sel.appendChild(o);
  }

  const firstReading = books.filter((b) => b.status === 'reading').sort(byTitle)[0];
  const wanted = timer || readingBookTouched ? previous : (firstReading?.id || '');
  sel.value = [...sel.options].some((o) => o.value === wanted) ? wanted : '';
  refreshSettingGroup('reading-book');
}
$('reading-book').addEventListener('change', () => { readingBookTouched = true; });

$('btn-timer-start').addEventListener('click', () => {
  timerError('');
  const book = books.find((b) => b.id === $('reading-book').value);
  timer = {
    status: 'running',
    bookId: book?.id || null,
    bookTitle: book?.title || null,
    startedAt: new Date().toISOString(),
    segmentStart: Date.now(),
    accumulated: 0,
  };
  saveTimer();
  renderTimer();

  // Si el libro estaba en Pendientes, pasa a Leyendo
  if (book && book.status === 'pending') {
    db.from('books').update({ status: 'reading' }).eq('id', book.id).select().single()
      .then(({ data, error }) => {
        if (error) return console.error(error);
        books = books.map((b) => (b.id === data.id ? data : b));
        refresh();
      });
  }
});

$('btn-timer-pause').addEventListener('click', () => {
  if (!timer) return;
  if (timer.status === 'running') {
    timer.accumulated += Date.now() - timer.segmentStart;
    timer.status = 'paused';
  } else {
    timer.segmentStart = Date.now();
    timer.status = 'running';
  }
  saveTimer();
  renderTimer();
});

$('btn-timer-finish').addEventListener('click', async () => {
  if (!timer) return;
  timerError('');
  // Congelar el tiempo mientras se guarda
  if (timer.status === 'running') {
    timer.accumulated += Date.now() - timer.segmentStart;
    timer.status = 'paused';
    saveTimer();
    renderTimer();
  }
  const ms = elapsedMs();
  if (ms < MIN_SESSION_MS) {
    timer = null;
    saveTimer();
    renderTimer();
    $('timer-status').textContent = 'Lectura demasiado corta, no se ha guardado.';
    return;
  }

  const btn = $('btn-timer-finish');
  btn.disabled = true;
  const seconds = Math.round(ms / 1000);
  const { data, error } = await db.from('reading_sessions').insert({
    book_id: timer.bookId,
    book_title: timer.bookTitle,
    started_at: timer.startedAt,
    ended_at: new Date().toISOString(),
    duration_seconds: seconds,
  }).select().single();
  btn.disabled = false;

  if (error) {
    console.error(error);
    // El temporizador se queda en pausa para poder reintentar sin perder el tiempo
    return timerError(`No se pudo guardar la lectura. ${explainError(error, 'reading-sessions.sql')} Tu tiempo sigue guardado: vuelve a pulsar «Finalizar lectura».`);
  }

  const title = timer.bookTitle;
  const finishedBook = books.find((b) => b.id === timer.bookId);
  timer = null;
  saveTimer();
  sessions = [data, ...sessions];
  sessionsError = false;
  renderTimer();
  renderSessions();
  $('timer-status').textContent = `¡Lectura guardada! ${fmtDuration(seconds)} de lectura.`;
  if (!document.body.classList.contains('pet-hidden')) {
    const reached = goalJustReached();
    petSay({
      text: reached
        ? `🎉 ¡Objetivo de hoy conseguido! Has leído ${fmtDuration(seconds)}${title ? ` de «${title}»` : ''}.`
        : `¡Muy bien! Has leído ${fmtDuration(seconds)}${title ? ` de «${title}»` : ''}. 🐾`,
    });
  }
  // Apuntar por qué página va: se pregunta siempre al terminar (si la lectura era «sin libro
  // concreto», en la ventana se elige el libro). Y queda un botón por si se cierra sin apuntarla.
  noteBookId = finishedBook && finishedBook.status !== 'read' ? finishedBook.id : null;
  $('btn-note-page').hidden = !books.length;
  if (books.length && (!finishedBook || finishedBook.status !== 'read')) {
    setTimeout(() => openProgressDialog(books.find((b) => b.id === noteBookId) || null), 500);
  }
});

let noteBookId = null; // libro de la última lectura terminada
$('btn-note-page').addEventListener('click', () => openProgressDialog(books.find((b) => b.id === noteBookId) || null));
$('btn-timer-start').addEventListener('click', () => { $('btn-note-page').hidden = true; });

// ---------- Progreso por páginas ----------
const progressDialog = $('progress-dialog');
const progressForm = $('progress-form');
let progressBookId = null;

// Sin libro (lectura «Sin libro concreto»): se elige en la propia ventana
function openProgressDialog(book = null) {
  progressForm.reset();
  $('progress-error').hidden = true;
  const pick = $('progress-pick');
  pick.hidden = Boolean(book);
  if (!book) {
    const sel = $('progress-book-select');
    sel.innerHTML = '';
    [['reading', 'Leyendo'], ['pending', 'Pendientes'], ['read', 'Leídos']].forEach(([status, label]) => {
      const list = books.filter((b) => b.status === status).sort(byTitle);
      if (!list.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      list.forEach((b) => { const o = document.createElement('option'); o.value = b.id; o.textContent = b.title; g.appendChild(o); });
      sel.appendChild(g);
    });
    if (!sel.options.length) return; // no hay libros en la biblioteca
    sel.onchange = () => fillProgress(books.find((b) => b.id === sel.value));
    book = books.find((b) => b.id === sel.value);
  }
  fillProgress(book);
  progressDialog.showModal();
  setTimeout(() => progressForm.current_page.focus(), 50);
}
function fillProgress(book) {
  progressBookId = book.id;
  $('progress-book').textContent = $('progress-pick').hidden ? book.title : '';
  progressForm.current_page.value = book.current_page ?? '';
  progressForm.total_pages.value = book.total_pages ?? '';
}

$('btn-close-progress').addEventListener('click', () => progressDialog.close());
$('btn-skip-progress').addEventListener('click', () => progressDialog.close());

progressForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const book = books.find((b) => b.id === progressBookId);
  if (!book) return progressDialog.close();
  const cur = intOrNull(progressForm.current_page.value);
  const total = intOrNull(progressForm.total_pages.value) || null;
  const showErr = (msg) => { $('progress-error').textContent = msg; $('progress-error').hidden = false; };
  if (!hasExtras) return showErr('Para guardar la página hay que ejecutar supabase/mejoras.sql en Supabase (SQL Editor).');
  if (cur == null || cur < 0) return showErr('Escribe la página por la que vas.');
  if (total && cur > total) return showErr('La página no puede ser mayor que el total.');

  const changes = { current_page: cur, total_pages: total };
  if (cur > 0 && (book.status === 'pending' || book.status === 'wishlist')) changes.status = 'reading';
  if (book.status === 'wishlist' && cur > 0 && hasOwned) changes.owned = true;
  // Última página: libro terminado
  if (total && cur >= total && book.status !== 'read') {
    changes.status = 'read';
    if (!book.finished_at) changes.finished_at = todayISO();
  }

  $('btn-save-progress').disabled = true;
  try {
    const data = await updateBook(book.id, changes);
    progressDialog.close();
    $('btn-note-page').hidden = true; // ya apuntada
    if (detailBook && detailBook.id === data.id) {
      detailBook = data;
      renderDetail();
    }
  } catch (err) {
    console.error(err);
    showErr(`No se pudo guardar. ${explainError(err, 'mejoras.sql')}`);
  } finally {
    $('btn-save-progress').disabled = false;
  }
});

// ---------- Pantalla encendida mientras se lee ----------
let wakeLock = null;
let wakeLockBusy = false;
async function syncWakeLock() {
  const want = timer?.status === 'running' && !document.hidden;
  if (!('wakeLock' in navigator) || wakeLockBusy) return;
  wakeLockBusy = true;
  try {
    if (want && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (err) {
    console.warn('No se pudo mantener la pantalla encendida:', err);
  } finally {
    wakeLockBusy = false;
  }
}

async function loadSessions() {
  const cached = readCache('sessions');
  if (cached) {
    sessions = cached;
    dataReady.sessions = true;
    renderSessions();
  }
  // Todas (para las estadísticas del año y las rachas); para una persona son pocas filas
  const { data, error } = await db
    .from('reading_sessions')
    .select('id, book_id, book_title, started_at, duration_seconds')
    .order('started_at', { ascending: false })
    .limit(5000);
  if (error) {
    console.error(error);
    if (cached) return; // sin conexión: se quedan las guardadas
  }
  sessionsError = Boolean(error);
  sessions = data || [];
  dataReady.sessions = true;
  renderSessions();
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const sessionDateFmt = new Intl.DateTimeFormat('es', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

function renderSessions() {
  if (dataReady.sessions && !sessionsError) writeCache('sessions', sessions);
  const now = new Date();
  const todayKey = dayKey(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));

  let today = 0;
  let week = 0;
  const days = new Set();
  sessions.forEach((s) => {
    const d = new Date(s.started_at);
    days.add(dayKey(d));
    if (dayKey(d) === todayKey) today += s.duration_seconds;
    if (d >= weekStart) week += s.duration_seconds;
  });

  // Días seguidos leyendo (cuenta desde hoy, o desde ayer si hoy aún no has leído)
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  todaySeconds = today;
  renderRing();
  $('reading-today').textContent = today ? fmtDuration(today) : '0 min';
  $('reading-week').textContent = week ? fmtDuration(week) : '0 min';
  $('reading-streak').textContent = streak;

  const list = $('sessions-list');
  list.innerHTML = '';
  sessions.slice(0, 10).forEach((s) => {
    const li = document.createElement('li');
    li.className = 'session';
    const info = document.createElement('div');
    info.className = 'session-info';
    const book = document.createElement('div');
    book.className = 'session-book';
    book.textContent = s.book_title || 'Lectura libre';
    const date = document.createElement('div');
    date.className = 'session-date';
    date.textContent = sessionDateFmt.format(new Date(s.started_at));
    info.append(book, date);
    const dur = document.createElement('div');
    dur.className = 'session-duration';
    dur.textContent = fmtDuration(s.duration_seconds);
    // Miniatura de la portada (o un icono si es lectura libre o no tiene portada)
    const thumb = document.createElement('span');
    thumb.className = 'session-cover';
    thumb.setAttribute('aria-hidden', 'true');
    const b = s.book_id && books.find((x) => x.id === s.book_id);
    if (b?.cover_url) thumb.style.backgroundImage = `url("${encodeURI(coverSize(b.cover_url, 'M'))}")`;
    else if (b) thumb.style.background = b.cover_color || COVER_COLORS[0];
    else thumb.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M10 3h4M12 3v3"/></svg>';
    li.append(thumb, info, dur);
    list.appendChild(li);
  });
  checkAchievements();
  const empty = $('sessions-empty');
  empty.hidden = sessions.length > 0;
  empty.textContent = sessionsError
    ? 'No se pudieron cargar las sesiones.'
    : 'Todavía no has registrado ninguna lectura.';
}

// Al volver a la app (p. ej. tras bloquear el móvil) se actualiza el reloj
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderTimer();
});

renderTimer();

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
  const goal = challengeGoal();
  const doneThisYear = readThisYear().length;
  if (goal && doneThisYear < goal) {
    const left = goal - doneThisYear;
    msgs.push({ text: `Te ${left === 1 ? 'queda 1 libro' : `quedan ${left} libros`} para tu reto de ${new Date().getFullYear()}. ¡Vamos a por ello! 💪` });
  }
  const topAuthor = authorRanking()[0];
  if (topAuthor && topAuthor.avg != null) {
    msgs.push({
      text: `Tu escritor favorito es ${topAuthor.name}: le das un ★ ${fmtAvg(topAuthor.avg)} de media. ¿Buscamos otro libro suyo? 🐾`,
      action: { label: 'Ver escritor', run: () => openAuthor(topAuthor.name) },
    });
  }
  const wished = books.filter((b) => b.status === 'wishlist');
  if (wished.length) {
    const b = pick(wished);
    msgs.push({
      text: `Sigo soñando con «${b.title}» de tus deseados… ¿Algún día lo tendremos? 🎁`,
      action: { label: 'Ver deseados', run: () => showLibraryStatus('wishlist') },
    });
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
  // Hablar siempre lo despierta y vuelve a contar los 10 segundos
  pet.classList.remove('is-lying');
  scheduleNap();
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

// Si nadie toca a Jack en 10 segundos, se tumba a dormir; al tocarlo se levanta
const PET_NAP_MS = 10000;
const WAKE_MESSAGES = [
  '¡Uy! Me había quedado dormido… ¿Seguimos leyendo? 🐾',
  '¡Ya estoy despierto! ¿Qué leemos? 📖',
  'Zzz… ¡Ah, hola! Estaba soñando con libros. 🦴',
];
let petNapTimer = null;

function scheduleNap() {
  clearTimeout(petNapTimer);
  petNapTimer = setTimeout(() => {
    if (pet.classList.contains('is-reading')) return; // leyendo no se duerme
    hidePetBubble();
    pet.classList.add('is-lying');
  }, PET_NAP_MS);
}

// Jack lee contigo: con el temporizador en marcha y en la pestaña Lectura,
// se despierta, crece y se pone a leer en la parte inferior de la pantalla.
// (Usa getElementById porque se llama antes de que se definan las constantes de esta sección.)
function updatePetMode() {
  const el = document.getElementById('pet');
  const reading = timer?.status === 'running' && currentView === 'reading';
  if (reading === el.classList.contains('is-reading')) return;
  el.classList.toggle('is-reading', reading);
  document.body.classList.toggle('pet-reading', reading);
  if (reading) {
    el.classList.remove('is-lying');
    clearTimeout(petNapTimer);
  } else {
    scheduleNap();
  }
}

function readingMessages() {
  const mins = fmtDuration(Math.round(elapsedMs() / 1000));
  return [
    '¡Shhh! Que estoy en la mejor parte. 📖',
    '¿Pasamos página? 🐾',
    `Llevamos ${mins} leyendo. ¡Sigue así!`,
    timer?.bookTitle ? `Me está encantando «${timer.bookTitle}». 🐶` : 'Me encanta leer contigo. 🐶',
  ];
}

$('pet-dog').addEventListener('click', (e) => {
  e.stopPropagation();
  if (pet.classList.contains('is-reading')) {
    petSay({ text: pick(readingMessages().filter((t) => t !== lastPetMessage)) });
    return;
  }
  if (pet.classList.contains('is-lying')) {
    const pool = isNight() ? NIGHT_WAKE_MESSAGES : WAKE_MESSAGES;
    petSay({ text: pick(pool.filter((t) => t !== lastPetMessage)) });
    return;
  }
  const options = petMessages().filter((m) => m.text !== lastPetMessage);
  petSay(pick(options));
});

// Cerrar el bocadillo al tocar fuera
document.addEventListener('click', (e) => {
  if (!petBubble.hidden && !pet.contains(e.target)) hidePetBubble();
});

const PET_INTRO = 'Hola, me llamo Jack y seré tu compañero de lectura. 🐾';
let petIntroPending = false; // true justo después de iniciar sesión

// De noche (de 23:00 a 7:00) Jack está dormido al abrir la app
const isNight = () => { const h = new Date().getHours(); return h >= 23 || h < 7; };
const NIGHT_WAKE_MESSAGES = [
  'Zzz… ¿Todavía despierta? Un capítulo más y a dormir. 🌙',
  '*bosteza* Es tardísimo… pero si lees, yo te acompaño. 🌙',
  'Estaba soñando con huesos de papel… ¿Leemos un poquito? 💤',
];

function greetOnce() {
  if (petGreeted) return;
  // Guía de Jack (de momento siempre, para revisarla; ver TOUR_MODE)
  if (shouldShowTour()) {
    petGreeted = true;
    petIntroPending = false;
    setTimeout(startTour, 900);
    return;
  }
  if (document.body.classList.contains('pet-hidden')) return;
  petGreeted = true;
  if (isNight() && !petIntroPending) {
    hidePetBubble();
    pet.classList.add('is-lying');
    clearTimeout(petNapTimer);
    return;
  }
  const text = petIntroPending ? PET_INTRO : greeting();
  petIntroPending = false;
  setTimeout(() => petSay({ text }), 1200);
}

// ---------- Guía de Jack ----------
// TOUR_MODE:
//   'always' -> cada vez que se abre la app (para revisarla)
//   'first'  -> solo la primera vez que se inicia sesión (se guarda en la cuenta: tour_done)
const TOUR_MODE = 'first';

function shouldShowTour() {
  if (TOUR_MODE === 'always') return true;
  return petIntroPending && !currentUser?.user_metadata?.tour_done;
}

const TOUR_STEPS = [
  {
    view: 'library', tab: 'reading', target: null,
    text: '¡Hola! Me llamo Jack, aunque creo que ya me conoces. 🐾 ¡Voy a explicarte cómo funciona tu nueva biblioteca!',
    intro: true, // Jack en grande, en el centro, saludando
  },
  {
    view: 'library', tab: 'reading', target: '#status-tabs',
    text: 'En «Mi lectura» tienes tus libros según cómo vas: los que estás leyendo, los que ya has leído y los pendientes.',
  },
  {
    view: 'library', tab: 'owned', target: '.library-sections',
    text: 'En «Mi estantería» ves los libros que tienes en propiedad (en papel o digital) y los deseados, los que te gustaría tener.',
  },
  {
    view: 'library', tab: 'reading', target: '#btn-add',
    text: 'Con el botón + añades un libro. Búscalo por título o escanea el código de barras de la contraportada, ¡y yo relleno el resto!',
  },
  {
    view: 'library', tab: 'reading', target: '#book-grid .book-item, #book-grid',
    text: 'Toca una portada para ver su ficha: ahí puedes puntuarlo, apuntar por qué página vas, escribir tu reseña y guardar tus citas favoritas.',
  },
  {
    view: 'explore', target: '#for-you:not([hidden]), #catalog',
    text: 'En Explorar tienes ideas por categorías. En «Para ti» te recomiendo libros según lo que más te gusta. 👃📚',
  },
  {
    view: 'reading', target: '.timer',
    text: 'Este es el cronómetro de lectura. Elige el libro, pulsa «Iniciar lectura» y yo me pongo a leer contigo. Al terminar te preguntaré por qué página vas.',
  },
  {
    view: 'reading', target: '.reading-stats',
    text: 'Cada lectura suma para tu objetivo diario y tu racha de días seguidos. ¡Intenta no romperla! 🔥',
  },
  {
    view: 'profile', target: '#challenge',
    text: 'En tu perfil puedes ponerte un reto de libros para este año y ver tus estadísticas y tu resumen del año.',
  },
  {
    view: 'profile', target: '#wardrobe',
    text: 'Y este es mi armario. Cuando consigas logros desbloquearé accesorios… ¡Yo quiero la corona! 👑',
  },
  {
    view: 'library', tab: 'reading', target: null,
    text: '¡Ya está! Si alguna vez quieres que te lo vuelva a explicar, está en Perfil › Ajustes › «Ver la guía de Jack». Y si me tocas, te diré cosas. ¡A leer! 📚',
  },
];

let tourIndex = -1;

function startTour() {
  const el = document.getElementById('tour');
  if (!el || !el.hidden) return;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  hidePetBubble();
  document.body.classList.add('touring');
  pet.classList.remove('is-lying');
  clearTimeout(petNapTimer);
  el.hidden = false;
  showTourStep(0);
}

function endTour() {
  const el = document.getElementById('tour');
  if (el.hidden) return;
  el.hidden = true;
  document.body.classList.remove('touring', 'tour-intro');
  tourIndex = -1;
  goTo('library');
  setLibraryTab('reading');
  scheduleNap();
  // Modo 'first': no volver a mostrarla en esta cuenta.
  // (En modo 'always' no se guarda, para que las pruebas no la marquen como vista.)
  if (TOUR_MODE === 'first' && !currentUser?.user_metadata?.tour_done) {
    db.auth.updateUser({ data: { tour_done: true } })
      .then(({ data }) => { if (data?.user) currentUser = data.user; })
      .catch((err) => console.error(err));
  }
}

function showTourStep(i) {
  tourIndex = i;
  const step = TOUR_STEPS[i];
  if (step.view !== currentView) goTo(step.view);
  if (step.tab && step.tab !== libraryStatus) setLibraryTab(step.tab);

  // Primer paso: Jack en grande, en el centro, saludando. Al seguir, vuelve a su sitio.
  document.body.classList.toggle('tour-intro', Boolean(step.intro));
  $('tour-card').classList.toggle('is-intro', Boolean(step.intro));
  $('tour-text').textContent = step.text;
  $('tour-step').textContent = `${i + 1} de ${TOUR_STEPS.length}`;
  $('tour-back').hidden = i === 0;
  $('tour-next').textContent = i === 0 ? '¡Vamos!' : i === TOUR_STEPS.length - 1 ? '¡A leer!' : 'Siguiente';
  $('tour-skip').hidden = i === TOUR_STEPS.length - 1;

  // Saltito de Jack en cada paso
  pet.classList.remove('is-happy');
  void pet.offsetWidth;
  pet.classList.add('is-happy');

  const target = step.target ? document.querySelector(step.target) : null;
  if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
  else window.scrollTo(0, 0);
  positionTour();
  requestAnimationFrame(positionTour); // por si el navegador aún no había recolocado la página
  $('tour-next').focus({ preventScroll: true });
}

// Coloca el foco de luz sobre la zona y el bocadillo donde no la tape
function positionTour() {
  if (tourIndex < 0) return;
  const step = TOUR_STEPS[tourIndex];
  const spot = $('tour-spot');
  const card = $('tour-card');
  const target = step.target ? document.querySelector(step.target) : null;
  const vh = window.innerHeight;
  if (target) {
    const r = target.getBoundingClientRect();
    const pad = 8;
    const top = Math.max(6, r.top - pad);
    const bottom = Math.min(vh - 6, r.bottom + pad);
    spot.style.left = `${r.left - pad}px`;
    spot.style.top = `${top}px`;
    spot.style.width = `${r.width + pad * 2}px`;
    spot.style.height = `${Math.max(0, bottom - top)}px`;
    spot.classList.remove('is-empty');
    // El bocadillo va abajo (junto a Jack) si cabe sin tapar la zona; si no, arriba
    const cardH = card.offsetHeight;
    const tabbar = document.querySelector('.tabbar').offsetHeight;
    const bottomCardTop = vh - tabbar - 96 - cardH;
    const topCardBottom = 70 + cardH;
    const overlapBottom = Math.max(0, bottom - bottomCardTop);
    const overlapTop = Math.max(0, topCardBottom - top);
    card.classList.toggle('is-top', overlapBottom > 0 && overlapTop < overlapBottom);
  } else {
    spot.classList.add('is-empty');
    card.classList.remove('is-top');
  }
}

$('tour-next').addEventListener('click', () => {
  if (tourIndex >= TOUR_STEPS.length - 1) endTour();
  else showTourStep(tourIndex + 1);
});
$('tour-back').addEventListener('click', () => { if (tourIndex > 0) showTourStep(tourIndex - 1); });
$('tour-skip').addEventListener('click', endTour);
document.addEventListener('keydown', (e) => {
  if (tourIndex < 0) return;
  if (e.key === 'Escape') endTour();
  else if (e.key === 'ArrowRight') $('tour-next').click();
  else if (e.key === 'ArrowLeft') $('tour-back').click();
});
window.addEventListener('resize', positionTour);
window.addEventListener('scroll', positionTour, { passive: true });
$('btn-tour').addEventListener('click', () => {
  closeSettingGroups(null);
  startTour();
});

// ¡Libro terminado! Confeti y Jack lo celebra
function celebrateFinish(book) {
  launchConfetti();
  if (document.body.classList.contains('pet-hidden')) return;
  const year = new Date().getFullYear();
  const count = readThisYear().length;
  const goal = challengeGoal();
  let text = `🎉 ¡Has terminado «${book.title}»! Ya ${count === 1 ? 'llevas 1 libro' : `llevas ${count} libros`} en ${year}.`;
  if (goal && count === goal) text += ' ¡Reto anual completado! 👑';
  else if (goal && count < goal) text += ` Te ${goal - count === 1 ? 'queda 1' : `quedan ${goal - count}`} para tu reto.`;
  const next = nextInSeries(book);
  let action;
  if (next?.book && next.book.status !== 'read') {
    text += ` Lo siguiente de la saga: «${next.book.title}».`;
    action = { label: 'Ver siguiente', run: () => openDetailDialog(next.book) };
  }
  setTimeout(() => petSay({ text, action }), 400);
}

function launchConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#9b6a45', '#e0a82e', '#3f7d57', '#c97b84', '#7d93b5', '#efc39b'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('span');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    p.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    p.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    p.style.setProperty('--spin', `${Math.random() * 720 - 360}deg`);
    wrap.appendChild(p);
  }
  // Si hay una ventana abierta, encima de ella (las ventanas tapan el resto)
  (document.querySelector("dialog[open]") || document.body).appendChild(wrap);
  setTimeout(() => wrap.remove(), 3500);
}

function showLibraryStatus(status) {
  goTo('library');
  setLibraryTab(status);
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

scheduleNap();

// ---------- Ajustes: desplegables en línea ----------
// Convierte cada <select> oculto de Ajustes en una fila que, al tocarla, despliega
// sus opciones debajo y desplaza el resto de filas. El <select> sigue guardando el valor
// y lanzando su evento «change», así que la lógica de tema y objetivo no cambia.
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" class="setting-chevron"><path d="M6 9l6 6 6-6"/></svg>';

function closeSettingGroups(except) {
  // (Las categorías de Explorar usan el mismo aspecto, pero se abren y cierran por su cuenta)
  document.querySelectorAll('.setting-group.is-open:not(.category)').forEach((g) => {
    if (g === except) return;
    g.classList.remove('is-open');
    g.querySelector('.setting-toggle').setAttribute('aria-expanded', 'false');
  });
}

// Para refrescar un desplegable cuando cambian sus opciones o se bloquea.
// (Declaración de función: se puede llamar antes de que se construyan los desplegables.)
function refreshSettingGroup(selectId) {
  const g = document.querySelector(`.setting-group[data-for="${selectId}"]`);
  if (g && g._refresh) g._refresh();
}

// Muestra de color de un tema: círculo partido con su color principal y su fondo
function swatchFor(opt) {
  const [a, b] = opt.dataset.swatch.split(',');
  const s = document.createElement('span');
  s.className = 'setting-swatch';
  s.style.background = `linear-gradient(135deg, ${a} 50%, ${b} 50%)`;
  s.setAttribute('aria-hidden', 'true');
  return s;
}

function buildSettingGroup(group) {
  const select = document.getElementById(group.dataset.for);
  const labelText = group.querySelector('.setting-label').textContent;
  const isPicker = group.classList.contains('is-picker'); // fila que muestra solo el valor (selector de libro)

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'setting setting-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  if (isPicker) toggle.setAttribute('aria-label', labelText);
  const label = document.createElement('span');
  label.className = 'setting-label';
  label.textContent = labelText;
  const value = document.createElement('span');
  value.className = 'setting-value';
  if (isPicker) toggle.append(value);
  else toggle.append(label, value);
  toggle.insertAdjacentHTML('beforeend', CHEVRON_SVG);

  const panel = document.createElement('div');
  panel.className = 'setting-panel';
  const inner = document.createElement('div');
  inner.className = 'setting-panel-inner';
  inner.setAttribute('role', 'radiogroup');
  inner.setAttribute('aria-label', labelText);
  panel.appendChild(inner);

  let options = [];

  function makeOption(opt) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'setting-option';
    b.setAttribute('role', 'radio');
    b.tabIndex = group.classList.contains('is-open') ? 0 : -1;
    if (opt.dataset.swatch) b.appendChild(swatchFor(opt));
    const t = document.createElement('span');
    t.className = 'setting-option-text';
    t.textContent = opt.textContent;
    b.appendChild(t);
    b.insertAdjacentHTML('beforeend', CHECK_SVG);
    b.addEventListener('click', () => {
      if (select.value !== opt.value) {
        select.value = opt.value;
        select.dispatchEvent(new Event('change'));
      }
      sync();
      setOpen(false);
    });
    options.push({ b, opt });
    return b;
  }

  // (Re)crea las opciones a partir del <select>, respetando los grupos (<optgroup>)
  function rebuild() {
    inner.innerHTML = '';
    options = [];
    [...select.children].forEach((child) => {
      if (child.tagName === 'OPTGROUP') {
        const head = document.createElement('div');
        head.className = 'setting-option-group';
        head.textContent = child.label;
        inner.appendChild(head);
        [...child.children].forEach((opt) => inner.appendChild(makeOption(opt)));
      } else {
        inner.appendChild(makeOption(child));
      }
    });
  }

  function sync() {
    const current = select.options[select.selectedIndex];
    value.textContent = current ? current.textContent : '';
    if (current?.dataset.swatch) value.prepend(swatchFor(current));
    options.forEach(({ b, opt }) => b.setAttribute('aria-checked', String(opt.value === select.value)));
    toggle.disabled = select.disabled;
    group.classList.toggle('is-disabled', select.disabled);
    if (select.disabled) setOpen(false);
  }
  function setOpen(open) {
    if (open) closeSettingGroups(group);
    group.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    options.forEach(({ b }) => { b.tabIndex = open ? 0 : -1; });
  }

  toggle.addEventListener('click', () => setOpen(!group.classList.contains('is-open')));
  select.addEventListener('change', sync);
  group.append(toggle, panel);
  group._refresh = () => { rebuild(); sync(); };
  group._refresh();
}
document.querySelectorAll('.setting-group[data-for]').forEach(buildSettingGroup);
// Al salir de Perfil se cierran los desplegables
document.querySelectorAll('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => closeSettingGroups(null));
});

// ---------- Citas favoritas ----------
let quoteCount = 0;
let quotesRequest = 0;

async function loadQuoteCount() {
  const { count, error } = await db.from('quotes').select('id', { count: 'exact', head: true });
  if (error) console.warn('Citas no disponibles (¿falta mejoras.sql?):', error.message);
  quoteCount = count || 0;
  dataReady.quotes = true;
  checkAchievements();
}

async function loadQuotes(bookId) {
  const req = ++quotesRequest;
  const list = $('detail-quotes');
  const empty = $('detail-quotes-empty');
  list.innerHTML = '';
  empty.hidden = true;
  const { data, error } = await db.from('quotes').select('*').eq('book_id', bookId).order('created_at', { ascending: false });
  if (req !== quotesRequest) return;
  if (error) {
    console.error(error);
    empty.textContent = `No se pudieron cargar las citas. ${explainError(error, 'mejoras.sql')}`;
    empty.hidden = false;
    return;
  }
  renderQuotes(data || []);
}

function renderQuotes(quotes) {
  const list = $('detail-quotes');
  const empty = $('detail-quotes-empty');
  list.innerHTML = '';
  empty.textContent = 'Aún no has guardado ninguna cita.';
  empty.hidden = quotes.length > 0;
  quotes.forEach((q) => {
    const li = document.createElement('li');
    li.className = 'quote';
    const text = document.createElement('blockquote');
    text.textContent = q.text;
    const meta = document.createElement('div');
    meta.className = 'quote-meta';
    const page = document.createElement('span');
    page.textContent = q.page ? `pág. ${q.page}` : '';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'link-btn quote-delete';
    del.textContent = 'Borrar';
    del.setAttribute('aria-label', 'Borrar esta cita');
    del.addEventListener('click', async () => {
      if (!confirm('¿Borrar esta cita?')) return;
      const { error } = await db.from('quotes').delete().eq('id', q.id);
      if (error) {
        console.error(error);
        return alert(`No se pudo borrar. ${explainError(error, 'mejoras.sql')}`);
      }
      quoteCount = Math.max(0, quoteCount - 1);
      li.remove();
      if (!$('detail-quotes').children.length) $('detail-quotes-empty').hidden = false;
    });
    meta.append(page, del);
    li.append(text, meta);
    list.appendChild(li);
  });
}

$('quote-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const text = form.text.value.trim();
  if (!text || !detailBook) return;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  const bookId = detailBook.id;
  const { error } = await db.from('quotes').insert({ book_id: bookId, text, page: intOrNull(form.page.value) || null });
  btn.disabled = false;
  if (error) {
    console.error(error);
    $('detail-quotes-empty').textContent = `No se pudo guardar la cita. ${explainError(error, 'mejoras.sql')}`;
    $('detail-quotes-empty').hidden = false;
    return;
  }
  form.reset();
  quoteCount++;
  checkAchievements();
  if (detailBook?.id === bookId) loadQuotes(bookId);
});

// ---------- Buscar libros en Open Library ----------
let lookupRequest = 0;
let lookupDebounce = null;

function lookupStatus(text) {
  $('lookup-status').textContent = text || '';
  $('lookup-status').hidden = !text;
}

// "Alas de sangre (Empíreo 1)" -> título "Alas de sangre", saga "Empíreo", tomo 1
function splitSeries(title) {
  // También «Nova - The Renegades #2»
  const m = title.match(/^(.+?)\s*\(([^()]+?)[,\s]+(?:#|n[º°.]?\s*|vol\.?\s*|libro\s*|tomo\s*)?(\d+(?:[.,]5)?)\)\s*$/i)
    || title.match(/^(.+?)\s+[-–]\s+(.+?)\s*#\s*(\d+(?:[.,]5)?)\s*$/);
  if (!m) return { title: title.trim() };
  return { title: m[1].trim(), series: m[2].trim(), series_number: Number(m[3].replace(',', '.')) };
}

function toCandidate(doc) {
  const ed = doc.editions?.docs?.[0];
  const rawTitle = ed?.title || doc.title || '';
  const cover = ed?.cover_i || doc.cover_i;
  return {
    ...splitSeries(rawTitle),
    author: (doc.author_name || [])[0] || '',
    cover_url: cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg` : null,
    total_pages: ed?.number_of_pages || doc.number_of_pages_median || null,
  };
}

async function runLookup() {
  clearTimeout(lookupDebounce);
  const q = $('lookup-input').value.trim();
  const results = $('lookup-results');
  if (q.length < 3) {
    lookupRequest++;
    results.innerHTML = '';
    lookupStatus('');
    return;
  }
  const req = ++lookupRequest;
  lookupStatus('Buscando…');
  const isbn = q.replace(/[-\s]/g, '');
  const query = /^(97[89])?\d{9}[\dXx]$/.test(isbn) ? `isbn:${isbn}` : q;
  const fields = 'key,title,author_name,cover_i,number_of_pages_median,editions,editions.title,editions.cover_i,editions.language,editions.number_of_pages';
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&lang=es&limit=10&fields=${fields}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (req !== lookupRequest) return;
    const seen = new Set();
    const items = (data.docs || []).map(toCandidate).filter((c) => {
      const key = `${c.title.toLowerCase()}|${c.author.toLowerCase()}`;
      if (!c.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
    renderLookupResults(items);
    lookupStatus(items.length ? '' : 'No se ha encontrado nada. Prueba con otras palabras o rellénalo a mano.');
  } catch (err) {
    if (req !== lookupRequest) return;
    console.error(err);
    results.innerHTML = '';
    lookupStatus('No se pudo buscar. Revisa la conexión e inténtalo de nuevo.');
  }
}

function renderLookupResults(items) {
  const wrap = $('lookup-results');
  wrap.innerHTML = '';
  items.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lookup-item';
    const img = document.createElement('span');
    img.className = 'lookup-cover';
    if (c.cover_url) img.style.backgroundImage = `url("${c.cover_url.replace('-L.jpg', '-M.jpg')}")`;
    const info = document.createElement('span');
    info.className = 'lookup-info';
    const t = document.createElement('span');
    t.className = 'lookup-title';
    t.textContent = c.title;
    const meta = document.createElement('span');
    meta.className = 'lookup-meta';
    meta.textContent = [
      c.author,
      c.series ? `${c.series} #${c.series_number}` : '',
      c.total_pages ? `${c.total_pages} págs.` : '',
    ].filter(Boolean).join(' · ');
    info.append(t, meta);
    if (books.some((x) => sameBook(x, c))) {
      const tag = document.createElement('span');
      tag.className = 'lookup-owned';
      tag.textContent = 'Ya está en tu biblioteca';
      info.appendChild(tag);
    }
    b.append(img, info);
    b.addEventListener('click', () => {
      bookForm.title.value = c.title;
      bookForm.author.value = c.author;
      bookForm.cover_url.value = c.cover_url || '';
      if (hasExtras) {
        bookForm.series.value = c.series || '';
        bookForm.series_number.value = c.series_number ?? '';
        bookForm.total_pages.value = c.total_pages || '';
      }
      wrap.querySelectorAll('.lookup-item').forEach((x) => x.classList.toggle('is-selected', x === b));
      pickNewBook(c);
    });
    wrap.appendChild(b);
  });
}

$('lookup-input').addEventListener('input', () => {
  clearTimeout(lookupDebounce);
  lookupDebounce = setTimeout(runLookup, 450);
});
$('lookup-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault(); // no enviar el formulario
    runLookup();
  }
});

// ---------- Escáner de código de barras (ISBN) ----------
const scannerDialog = $('scanner-dialog');
let scanControls = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

$('btn-scan').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    lookupStatus('Este dispositivo no permite usar la cámara aquí. Escribe el ISBN en el buscador.');
    return;
  }
  const status = $('scanner-status');
  status.textContent = 'Abriendo la cámara…';
  scannerDialog.showModal();
  try {
    if (!window.ZXingBrowser) await loadScript('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js');
    if (!scannerDialog.open) return;
    const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    scanControls = await reader.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      $('scanner-video'),
      (result, _err, controls) => {
        if (!result) return;
        const code = result.getText().replace(/\D/g, '');
        if (!/^97[89]\d{10}$/.test(code)) {
          status.textContent = 'Ese código no es un ISBN. Busca el que empieza por 978 o 979.';
          return;
        }
        controls.stop();
        scanControls = null;
        scannerDialog.close();
        $('lookup-input').value = code;
        runLookup();
      },
    );
    if (!scannerDialog.open) { scanControls.stop(); scanControls = null; return; }
    status.textContent = 'Apunta al código de barras de la contraportada.';
  } catch (err) {
    console.error(err);
    status.textContent = err?.name === 'NotAllowedError'
      ? 'Necesito permiso para usar la cámara. Actívalo en Ajustes del iPhone > Safari > Cámara.'
      : 'No se pudo abrir la cámara. Escribe el ISBN en el buscador.';
  }
});

$('btn-close-scanner').addEventListener('click', () => scannerDialog.close());
scannerDialog.addEventListener('close', () => {
  if (scanControls) scanControls.stop();
  scanControls = null;
});

// ---------- Reto anual ----------
const CHALLENGE_KEY = 'yearly-goal';
const challengeSelect = $('challenge-select');

function challengeGoal() {
  return Number(localStorage.getItem(CHALLENGE_KEY)) || 0;
}
// Libros terminados este año (con fecha de fin de este año)
function readThisYear(year = new Date().getFullYear()) {
  return books.filter((b) => b.status === 'read' && b.finished_at && b.finished_at.startsWith(`${year}-`));
}

function applyChallengeFromUser(user) {
  // El reto se guarda en la cuenta, así se ve igual en todos los dispositivos
  const saved = user?.user_metadata?.yearly_goal;
  if (saved != null) localStorage.setItem(CHALLENGE_KEY, String(saved));
  challengeSelect.value = String(challengeGoal());
  if (!challengeSelect.value) challengeSelect.value = '0';
  refreshSettingGroup('challenge-select');
  renderChallenge();
}

challengeSelect.value = String(challengeGoal());
if (!challengeSelect.value) challengeSelect.value = "0";
refreshSettingGroup("challenge-select");
challengeSelect.addEventListener('change', async () => {
  localStorage.setItem(CHALLENGE_KEY, challengeSelect.value);
  renderChallenge();
  checkAchievements();
  const { error } = await db.auth.updateUser({ data: { yearly_goal: Number(challengeSelect.value) } });
  if (error) console.error(error);
});

function renderChallenge() {
  const now = new Date();
  const year = now.getFullYear();
  const goal = challengeGoal();
  const done = readThisYear(year).length;
  $('challenge-title').textContent = `Reto ${year}`;
  $('challenge-count').textContent = goal ? `${done} / ${goal} libros` : `${done} ${done === 1 ? 'libro' : 'libros'}`;
  const bar = $('challenge-bar');
  bar.parentElement.hidden = !goal;
  bar.style.width = `${goal ? Math.min(100, (done / goal) * 100) : 0}%`;
  $('challenge').classList.toggle('is-complete', goal > 0 && done >= goal);

  let note;
  if (!goal) {
    note = 'Ponte un reto de libros para este año en Ajustes.';
  } else if (done >= goal) {
    note = '¡Reto completado! 👑 Jack está orgullosísimo.';
  } else {
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    const expected = goal * ((now - start) / (end - start));
    const diff = Math.round(done - expected);
    const daysLeft = Math.ceil((end - now) / 86400000);
    const every = Math.max(1, Math.floor(daysLeft / (goal - done)));
    note = diff > 0
      ? `Vas ${diff === 1 ? '1 libro' : `${diff} libros`} por delante del ritmo. ¡Genial!`
      : diff < 0
        ? `Vas ${-diff === 1 ? '1 libro' : `${-diff} libros`} por detrás: toca uno cada ${every} ${every === 1 ? 'día' : 'días'}.`
        : `Vas justo a tu ritmo: un libro cada ${every} ${every === 1 ? 'día' : 'días'}.`;
  }
  $('challenge-note').textContent = note;
}

// ---------- Estadísticas ----------
const statsDialog = $('stats-dialog');
const monthShort = new Intl.DateTimeFormat('es', { month: 'short' });
const monthLong = new Intl.DateTimeFormat('es', { month: 'long' });
const weekdayShort = new Intl.DateTimeFormat('es', { weekday: 'short' });
const dayLabel = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function categoryOf(book) {
  return book.category || catalog.find((c) => sameBook(c, book))?.category || null;
}

// Racha más larga de días seguidos con alguna lectura
function bestStreak() {
  const days = [...new Set(sessions.map((s) => {
    const d = new Date(s.started_at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  days.forEach((t) => {
    // 36 h de margen por los cambios de hora
    run = prev != null && t - prev <= 36 * 3600000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  });
  return best;
}
const totalReadingSeconds = () => sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);

// Gráfico de barras sencillo (una serie). Tocar o pasar por una barra muestra su valor.
function barChart({ title, items, format, summary, horizontal = false }) {
  const box = document.createElement('section');
  box.className = `chart${horizontal ? ' chart-h' : ''}`;
  const head = document.createElement('div');
  head.className = 'chart-head';
  const h = document.createElement('h3');
  h.className = 'chart-title';
  h.textContent = title;
  const readout = document.createElement('span');
  readout.className = 'chart-readout';
  readout.textContent = summary;
  head.append(h, readout);

  const plot = document.createElement('div');
  plot.className = 'chart-plot';
  const max = Math.max(1, ...items.map((i) => i.value));
  let active = null;
  const select = (bar, item) => {
    if (active) active.classList.remove('is-active');
    if (active === bar) { active = null; readout.textContent = summary; return; }
    active = bar;
    bar.classList.add('is-active');
    readout.textContent = `${item.full || item.label}: ${format(item.value)}`;
  };
  items.forEach((item) => {
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = `chart-bar${item.highlight ? ' is-highlight' : ''}`;
    bar.setAttribute('aria-label', `${item.full || item.label}: ${format(item.value)}`);
    const fill = document.createElement('span');
    fill.className = 'chart-fill';
    const pct = item.value ? Math.max(3, (item.value / max) * 100) : 0;
    fill.style.setProperty('--v', `${pct}%`);
    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = item.label;
    if (horizontal) {
      const val = document.createElement('span');
      val.className = 'chart-value';
      val.textContent = format(item.value);
      const track = document.createElement('span');
      track.className = 'chart-track';
      track.appendChild(fill);
      bar.append(label, track, val);
    } else {
      const track = document.createElement('span');
      track.className = 'chart-track';
      track.appendChild(fill);
      bar.append(track, label);
    }
    bar.addEventListener('click', () => select(bar, item));
    bar.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') select(bar, item); });
    plot.appendChild(bar);
  });
  plot.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && active) { active.classList.remove('is-active'); active = null; readout.textContent = summary; }
  });
  box.append(head, plot);
  return box;
}

const fmtMinutes = (sec) => (sec ? fmtDuration(sec) : '0 min');

function renderStats() {
  const body = $('stats-body');
  body.innerHTML = '';
  const now = new Date();
  const year = now.getFullYear();
  const yearSessions = sessions.filter((s) => new Date(s.started_at).getFullYear() === year);
  const yearSeconds = yearSessions.reduce((sum, s) => sum + s.duration_seconds, 0);
  const finished = readThisYear(year);

  // --- Resumen del año (tipo "Wrapped") ---
  const minutesByMonth = Array(12).fill(0);
  yearSessions.forEach((s) => { minutesByMonth[new Date(s.started_at).getMonth()] += s.duration_seconds; });
  const topMonth = minutesByMonth.some(Boolean) ? minutesByMonth.indexOf(Math.max(...minutesByMonth)) : -1;
  const best = [...finished].filter((b) => b.rating).sort((a, b) => b.rating - a.rating || (b.finished_at || '').localeCompare(a.finished_at || ''))[0];
  const catCount = new Map();
  (finished.length ? finished : books.filter((b) => b.status !== 'wishlist')).forEach((b) => {
    const c = categoryOf(b);
    if (c) catCount.set(c, (catCount.get(c) || 0) + 1);
  });
  const favCat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const wrapped = document.createElement('section');
  wrapped.className = 'wrapped';
  wrapped.innerHTML = `
    <p class="wrapped-kicker">Tu ${year} en libros</p>
    <div class="wrapped-hero"><strong></strong><span></span></div>
    <div class="wrapped-grid">
      <div><strong data-k="hours"></strong><span>de lectura</span></div>
      <div><strong data-k="streak"></strong><span>racha más larga</span></div>
      <div><strong data-k="month"></strong><span>tu mes más lector</span></div>
      <div><strong data-k="cat"></strong><span>categoría favorita</span></div>
    </div>
    <p class="wrapped-best"></p>`;
  wrapped.querySelector('.wrapped-hero strong').textContent = finished.length;
  wrapped.querySelector('.wrapped-hero span').textContent = finished.length === 1 ? 'libro terminado' : 'libros terminados';
  const streak = bestStreak();
  wrapped.querySelector('[data-k="hours"]').textContent = fmtMinutes(yearSeconds);
  wrapped.querySelector('[data-k="streak"]').textContent = `${streak} ${streak === 1 ? 'día' : 'días'}`;
  wrapped.querySelector('[data-k="month"]').textContent = topMonth >= 0 ? cap(monthLong.format(new Date(year, topMonth, 1))) : '—';
  wrapped.querySelector('[data-k="cat"]').textContent = favCat || '—';
  const bestEl = wrapped.querySelector('.wrapped-best');
  if (best) bestEl.textContent = `Tu favorito: «${best.title}» ${'★'.repeat(best.rating)}`;
  else bestEl.hidden = true;
  body.appendChild(wrapped);

  // --- Últimos 7 días ---
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ d, key: dayKey(d), value: 0 });
  }
  sessions.forEach((s) => {
    const k = dayKey(new Date(s.started_at));
    const day = days.find((x) => x.key === k);
    if (day) day.value += s.duration_seconds;
  });
  const weekTotal = days.reduce((sum, d) => sum + d.value, 0);
  body.appendChild(barChart({
    title: 'Últimos 7 días',
    summary: `Total: ${fmtMinutes(weekTotal)}`,
    format: fmtMinutes,
    items: days.map((d, i) => ({
      label: i === 6 ? 'Hoy' : cap(weekdayShort.format(d.d)).replace('.', ''),
      full: i === 6 ? 'Hoy' : cap(dayLabel.format(d.d)),
      value: d.value,
      highlight: i === 6,
    })),
  }));

  // --- Por día de la semana (últimas 8 semanas, media) ---
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 55);
  const byWeekday = Array(7).fill(0);
  sessions.forEach((s) => {
    const d = new Date(s.started_at);
    if (d >= since) byWeekday[(d.getDay() + 6) % 7] += s.duration_seconds;
  });
  const names = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const fullNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const avg = byWeekday.map((v) => v / 8);
  const bestDay = avg.some(Boolean) ? avg.indexOf(Math.max(...avg)) : -1;
  body.appendChild(barChart({
    title: 'Media por día de la semana',
    summary: bestDay >= 0 ? `Tu día: ${fullNames[bestDay].toLowerCase()}` : 'Últimas 8 semanas',
    format: (v) => `${fmtMinutes(v)} de media`,
    items: avg.map((v, i) => ({ label: names[i], full: fullNames[i], value: v, highlight: i === bestDay })),
  }));

  // --- Libros terminados por mes ---
  const perMonth = Array(12).fill(0);
  finished.forEach((b) => { perMonth[Number(b.finished_at.slice(5, 7)) - 1]++; });
  const fmtBooks = (n) => `${n} ${n === 1 ? 'libro' : 'libros'}`;
  body.appendChild(barChart({
    title: `Libros terminados en ${year}`,
    summary: `Total: ${fmtBooks(finished.length)}`,
    format: fmtBooks,
    items: perMonth.map((v, i) => ({
      label: cap(monthShort.format(new Date(year, i, 1))).replace('.', '').slice(0, 3),
      full: cap(monthLong.format(new Date(year, i, 1))),
      value: v,
      highlight: i === now.getMonth(),
    })),
  }));

  // --- Categorías favoritas ---
  const cats = new Map();
  books.filter((b) => b.status === 'read' || b.status === 'reading').forEach((b) => {
    const c = categoryOf(b) || 'Sin categoría';
    cats.set(c, (cats.get(c) || 0) + 1);
  });
  const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).slice(0, 6);
  if (topCats.length) {
    body.appendChild(barChart({
      title: 'Categorías favoritas',
      summary: 'Leídos y leyendo',
      format: fmtBooks,
      horizontal: true,
      items: topCats.map(([label, value]) => ({ label, value })),
    }));
  }

  if (sessionsError) {
    const p = document.createElement('p');
    p.className = 'form-error';
    p.textContent = 'No se pudieron cargar las lecturas; algunos datos pueden faltar.';
    body.appendChild(p);
  }
}

$('btn-stats').addEventListener('click', () => {
  renderStats();
  statsDialog.showModal();
  statsDialog.scrollTop = 0;
});
$('btn-close-stats').addEventListener('click', () => statsDialog.close());

// ---------- Logros y accesorios de Jack ----------
const ACCESSORIES = [
  { id: 'glasses', icon: '👓', name: 'Gafas de lectura', slot: 'eyes', req: 'Termina 3 libros', got: (s) => [s.read, 3] },
  { id: 'scarf', icon: '🧣', name: 'Bufanda', slot: 'neck', req: 'Lee 7 días seguidos', got: (s) => [s.streak, 7] },
  { id: 'hat', icon: '🧶', name: 'Gorrito de lana', slot: 'head', req: 'Suma 10 horas leyendo', got: (s) => [Math.floor(s.hours), 10] },
  { id: 'bowtie', icon: '🎀', name: 'Pajarita', slot: 'neck', req: 'Guarda 5 citas', got: (s) => [s.quotes, 5] },
  { id: 'crown', icon: '👑', name: 'Corona', slot: 'head', req: 'Completa tu reto anual', got: (s) => (s.goal ? [s.yearRead, s.goal] : [0, 1]) },
];
const WEAR_KEY = 'pet-wear';
const UNLOCKED_KEY = 'pet-unlocked';

function achievementStats() {
  return {
    read: books.filter((b) => b.status === 'read').length,
    streak: bestStreak(),
    hours: totalReadingSeconds() / 3600,
    quotes: quoteCount,
    goal: challengeGoal(),
    yearRead: readThisYear().length,
  };
}
function unlockedIds(stats = achievementStats()) {
  return ACCESSORIES.filter((a) => { const [have, need] = a.got(stats); return have >= need; }).map((a) => a.id);
}
function loadList(key) {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : null; } catch { return null; }
}

function applyWear() {
  const el = document.getElementById('pet');
  const unlocked = unlockedIds();
  const wear = (loadList(WEAR_KEY) || []).filter((id) => unlocked.includes(id));
  ACCESSORIES.forEach((a) => el.classList.toggle(`wear-${a.id}`, wear.includes(a.id)));
  return wear;
}

function setWear(id, on) {
  const acc = ACCESSORIES.find((a) => a.id === id);
  let wear = (loadList(WEAR_KEY) || []).filter((x) => x !== id);
  if (on) wear = [...wear.filter((x) => ACCESSORIES.find((a) => a.id === x)?.slot !== acc.slot), id]; // uno por sitio
  localStorage.setItem(WEAR_KEY, JSON.stringify(wear));
  renderWardrobe();
}
const toggleWear = (id) => setWear(id, !(loadList(WEAR_KEY) || []).includes(id));

function renderWardrobe() {
  const wrap = $('wardrobe');
  const stats = achievementStats();
  const unlocked = unlockedIds(stats);
  const wear = applyWear();
  wrap.innerHTML = '';
  ACCESSORIES.forEach((a) => {
    const [have, need] = a.got(stats);
    const open = unlocked.includes(a.id);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `wardrobe-item${open ? '' : ' is-locked'}${wear.includes(a.id) ? ' is-worn' : ''}`;
    tile.disabled = !open;
    tile.setAttribute('aria-pressed', String(wear.includes(a.id)));
    const icon = document.createElement('span');
    icon.className = 'wardrobe-icon';
    icon.textContent = open ? a.icon : '🔒';
    const name = document.createElement('span');
    name.className = 'wardrobe-name';
    name.textContent = a.name;
    const req = document.createElement('span');
    req.className = 'wardrobe-req';
    req.textContent = open
      ? (wear.includes(a.id) ? 'Puesto ✓' : 'Toca para ponérselo')
      : `${a.req}${a.id === 'crown' && !stats.goal ? '' : ` · ${Math.min(have, need)}/${need}`}`;
    tile.append(icon, name, req);
    tile.setAttribute('aria-label', `${a.name}. ${open ? (wear.includes(a.id) ? 'Puesto' : 'Desbloqueado') : `Bloqueado: ${a.req}`}`);
    if (open) tile.addEventListener('click', () => toggleWear(a.id));
    wrap.appendChild(tile);
  });
}

// Avisa (una vez) cuando se desbloquea un accesorio y se lo pone
function checkAchievements() {
  if (!$('wardrobe')) return;
  renderWardrobe();
  if (!dataReady.books || !dataReady.sessions || !dataReady.quotes) return;
  const unlocked = unlockedIds();
  const known = loadList(UNLOCKED_KEY);
  localStorage.setItem(UNLOCKED_KEY, JSON.stringify([...new Set([...(known || []), ...unlocked])]));
  if (!known) return; // primera vez en este dispositivo: sin avisos
  const fresh = unlocked.filter((id) => !known.includes(id));
  if (!fresh.length) return;
  const acc = ACCESSORIES.find((a) => a.id === fresh[0]);
  setWear(acc.id, true);
  if (!document.body.classList.contains('pet-hidden')) {
    setTimeout(() => petSay({
      text: `¡Guau! He conseguido ${acc.name.toLowerCase()} ${acc.icon} por «${acc.req.toLowerCase()}». ¿A que estoy guapo?`,
      action: { label: 'Ver armario', run: () => goTo('profile') },
    }), 2600);
  }
}

// ---------- Recomendaciones en Explorar ----------
// Puntúa las categorías según lo que lee y cómo lo valora
function favoriteCategories() {
  const score = new Map();
  books.forEach((b) => {
    const c = categoryOf(b);
    if (!c) return;
    const w = b.status === 'read' ? (b.rating ? b.rating - 1 : 2)
      : b.status === 'reading' ? 2 : b.status === 'wishlist' ? 1.5 : 1;
    score.set(c, (score.get(c) || 0) + w);
  });
  return [...score.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
}

// Barajado estable durante el día (no cambia en cada repintado)
function dailyShuffle(list) {
  const seed = Number(todayISO().replace(/-/g, ''));
  const hash = (s) => { let h = seed; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761); return h >>> 0; };
  return [...list].sort((a, b) => hash(a.title) - hash(b.title));
}

// Categorías favoritas elegidas a mano (si no hay, se deducen con favoriteCategories)
const FAV_KEY = 'fav-categories';
const allCategories = () => [...new Set(catalog.map((c) => c.category))].sort(collator.compare);
function chosenFavorites() {
  const valid = new Set(allCategories());
  return (loadList(FAV_KEY) || []).filter((c) => valid.has(c));
}

// "A", "A y B", "A, B y C", "A, B y 3 más"
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} y ${names.length - 2} más`;
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

function renderForYou(q) {
  const box = $('for-you');
  box.hidden = Boolean(q) || !catalogLoaded;
  if (box.hidden) return;

  const chosen = chosenFavorites();
  const auto = favoriteCategories();
  // Elegidas a mano: primero las que más lee; si no, las deducidas
  const cats = chosen.length
    ? [...chosen].sort((a, b) => (auto.indexOf(a) + 1 || 99) - (auto.indexOf(b) + 1 || 99) || collator.compare(a, b))
    : auto;
  const per = chosen.length ? Math.max(2, Math.ceil(12 / cats.length)) : 0;
  // Primero, libros que no tienes de tus escritores guardados y de los mejor valorados (nota ≥ 4)
  const topAuthors = [...favAuthors(), ...authorRanking().filter((a) => a.avg >= 4).slice(0, 3).map((a) => a.name)];
  const topKeys = new Set(topAuthors.map(authorKey));
  const authorPicks = topKeys.size
    ? dailyShuffle(catalog.filter((x) => authorKeysOf(x).some((k) => topKeys.has(k)) && !isInLibrary(x))).slice(0, 4)
    : [];
  const picks = [...authorPicks, ...cats.flatMap((c, i) =>
    dailyShuffle(catalog.filter((x) => x.category === c && !isInLibrary(x))).slice(0, per || (i === 0 ? 6 : 4)))]
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(0, 12);

  const chip = $('btn-fav-cats');
  chip.querySelector('span').textContent = chosen.length ? `Favoritas · ${chosen.length}` : 'Favoritas';
  chip.classList.toggle('has-filters', chosen.length > 0);
  $('fav-settings-value').textContent = chosen.length
    ? `${chosen.length} ${chosen.length === 1 ? 'elegida' : 'elegidas'}`
    : 'Automático';

  const list = $('for-you-list');
  list.innerHTML = '';
  const empty = picks.length === 0;
  $('for-you-empty').hidden = !empty;
  list.hidden = empty;
  $('for-you-why').hidden = empty;
  if (empty) {
    $('for-you-empty').querySelector('p').textContent = chosen.length
      ? '¡Ya tienes todos los libros de tus categorías favoritas! Elige alguna más.'
      : 'Elige tus categorías favoritas y te recomendaré libros de ellas.';
    return;
  }
  const names = cats.filter((c) => picks.some((p) => p.category === c));
  $('for-you-why').textContent = (names.length
    ? (chosen.length
      ? `De tus favoritas: ${joinNames(names)}`
      : `Porque te gusta${names.length > 1 ? 'n' : ''} ${joinNames(names)}`)
    : 'De tus escritores favoritos')
    + (authorPicks.length && names.length ? ', y de tus escritores favoritos' : '');
  picks.forEach((item) => list.appendChild(createBookCard(item, () => openCatalogDialog(item))));
}

// Ventana para elegirlas
const favDialog = $('fav-dialog');
let favDraft = [];

function renderFavChips() {
  const wrap = $('fav-chips');
  wrap.innerHTML = '';
  allCategories().forEach((cat) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fav-chip';
    const on = favDraft.includes(cat);
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    b.append(cat);
    b.addEventListener('click', () => {
      favDraft = favDraft.includes(cat) ? favDraft.filter((c) => c !== cat) : [...favDraft, cat];
      renderFavChips();
    });
    wrap.appendChild(b);
  });
}

function openFavDialog() {
  favDraft = chosenFavorites();
  renderFavChips();
  favDialog.showModal();
}

function saveFavorites(list) {
  if (list.length) localStorage.setItem(FAV_KEY, JSON.stringify(list));
  else localStorage.removeItem(FAV_KEY);
  renderCatalog();
  // También en la cuenta, para verlas igual en todos los dispositivos
  db.auth.updateUser({ data: { fav_categories: list } }).then(({ error }) => { if (error) console.error(error); });
}

function applyFavoritesFromUser(user) {
  const saved = user?.user_metadata?.fav_categories;
  if (!Array.isArray(saved)) return;
  if (saved.length) localStorage.setItem(FAV_KEY, JSON.stringify(saved));
  else localStorage.removeItem(FAV_KEY);
  renderCatalog();
}

$('btn-fav-cats').addEventListener('click', openFavDialog);
$('btn-fav-cats-empty').addEventListener('click', openFavDialog);
$('btn-fav-settings').addEventListener('click', () => { closeSettingGroups(null); openFavDialog(); });
$('btn-close-fav').addEventListener('click', () => favDialog.close());
$('btn-fav-done').addEventListener('click', () => { saveFavorites(favDraft); favDialog.close(); });
$('btn-fav-auto').addEventListener('click', () => { favDraft = []; saveFavorites([]); favDialog.close(); });

// ---------- Autores: buscar escritores, guardarlos y ranking por tu nota media ----------
// Un libro con varios autores («Terry Pratchett y Neil Gaiman») cuenta para cada uno.
// Solo se parte por «,», «y», «and» o «&» si a ambos lados hay un nombre completo: así «Ortega y Gasset»
// sigue siendo uno, «Williams, Stephen» pasa a «Stephen Williams» y «Charles H. Elliott, Ph.D.» pierde el título.
const AUTHOR_TITLES = /^(ph\.?\s?d|m\.?\s?d|jr|sr|i{2,3}|iv|sir|dr)\.?$/i;
const fullName = (p) => p.split(/\s+/).filter(Boolean).length >= 2;
const authorsCache = new Map();
function splitAuthors(s) {
  const str = String(s || '').replace(/\s*\([^)]*\)/g, '').trim();
  if (authorsCache.has(str)) return authorsCache.get(str);
  let parts = str.split(/\s*,\s*/).map((p) => p.replace(/(\p{L}{3,})\.$/u, '$1')).filter(Boolean);
  if (parts.length > 1 && !parts.every(fullName)) {
    const rest = parts.slice(1).filter((p) => !AUTHOR_TITLES.test(p));
    parts = [rest.length === 1 && !fullName(parts[0]) ? `${rest[0]} ${parts[0]}` : parts[0]];
  }
  const out = parts.flatMap((p) => {
    const sub = p.split(/\s+(?:y|and|&)\s+|\s*&\s*/);
    return sub.length > 1 && sub.every(fullName) ? sub : [p];
  }).map((x) => x.trim()).filter(Boolean);
  authorsCache.set(str, out);
  return out;
}
const keyCache = new Map();
const authorKey = (name) => {
  let k = keyCache.get(name);
  if (k === undefined) { k = searchText(name); keyCache.set(name, k); }
  return k;
};
const authorKeysOf = (b) => splitAuthors(b.author).map(authorKey);
const byAuthor = (name) => { const k = authorKey(name); return (b) => authorKeysOf(b).includes(k); };
const fmtAvg = (n) => n.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Escritores de la biblioteca con sus cifras
function libraryAuthors() {
  const map = new Map();
  books.forEach((b) => splitAuthors(b.author).forEach((n) => {
    const k = authorKey(n);
    if (!k) return;
    if (!map.has(k)) map.set(k, { key: k, name: n, books: [] });
    map.get(k).books.push(b);
  }));
  for (const a of map.values()) {
    a.read = a.books.filter((b) => b.status === 'read');
    const rated = a.read.filter((b) => b.rating);
    a.rated = rated.length;
    a.avg = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null;
    a.todo = a.books.filter((b) => b.status !== 'read').length;
  }
  return map;
}

let authorSort = 'avg';
const AUTHOR_SORTS = {
  // Nota media (y, a igualdad, el que tenga más libros valorados)
  avg: (a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.rated - a.rated || b.read.length - a.read.length || collator.compare(a.name, b.name),
  count: (a, b) => b.read.length - a.read.length || (b.avg ?? -1) - (a.avg ?? -1) || collator.compare(a.name, b.name),
  name: (a, b) => collator.compare(a.name, b.name),
};
// Ranking por nota media: solo escritores de los que has leído algo
function authorRanking() {
  return [...libraryAuthors().values()].filter((a) => a.read.length).sort(AUTHOR_SORTS.avg);
}

// Escritores guardados (en la cuenta, como las categorías favoritas)
const FAV_AUTHORS_KEY = 'fav-authors';
const favAuthors = () => loadList(FAV_AUTHORS_KEY) || [];
const isFavAuthor = (name) => favAuthors().some((n) => authorKey(n) === authorKey(name));
function toggleFavAuthor(name) {
  const list = isFavAuthor(name) ? favAuthors().filter((n) => authorKey(n) !== authorKey(name)) : [...favAuthors(), name];
  if (list.length) localStorage.setItem(FAV_AUTHORS_KEY, JSON.stringify(list));
  else localStorage.removeItem(FAV_AUTHORS_KEY);
  db.auth.updateUser({ data: { fav_authors: list } }).then(({ error }) => { if (error) console.error(error); });
  renderAuthorsView();
  renderCatalog(); // «Para ti» tiene en cuenta a tus escritores
  if (authorDialog.open) renderAuthorDialog();
}
function applyFavAuthorsFromUser(user) {
  const saved = user?.user_metadata?.fav_authors;
  if (!Array.isArray(saved)) return;
  if (saved.length) localStorage.setItem(FAV_AUTHORS_KEY, JSON.stringify(saved));
  else localStorage.removeItem(FAV_AUTHORS_KEY);
}

const initialsOf = (name) => name.split(/\s+/).filter((w) => /\p{L}/u.test(w[0] || '')).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Fila de escritor (mismo estilo que Ajustes)
function authorRow(name, { stats = null, rank = 0, meta = '', olKey = null } = {}) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'setting author-row';
  const badge = document.createElement('span');
  badge.className = `author-badge${rank ? ` is-rank${rank <= 3 ? ` rank-${rank}` : ''}` : ''}`;
  badge.textContent = rank || initialsOf(name);
  const info = document.createElement('span');
  info.className = 'author-info';
  const n = document.createElement('span');
  n.className = 'author-name';
  n.textContent = name;
  const m = document.createElement('span');
  m.className = 'author-meta';
  m.textContent = meta || (stats
    ? [
      stats.read.length ? `${stats.read.length} ${stats.read.length === 1 ? 'leído' : 'leídos'}` : '',
      stats.todo ? `${stats.todo} por leer` : '',
    ].filter(Boolean).join(' · ') || 'En tu biblioteca'
    : '');
  info.append(n, m);
  row.append(badge, info);
  if (stats?.avg != null) {
    const s = document.createElement('span');
    s.className = 'author-score';
    s.textContent = `★ ${fmtAvg(stats.avg)}`;
    s.title = `Nota media de ${stats.rated} ${stats.rated === 1 ? 'libro' : 'libros'}`;
    row.appendChild(s);
  } else if (stats && stats.read.length) {
    const s = document.createElement('span');
    s.className = 'author-score is-empty';
    s.textContent = 'sin nota';
    row.appendChild(s);
  }
  if (isFavAuthor(name)) {
    const h = document.createElement('span');
    h.className = 'author-heart';
    h.textContent = '♥';
    h.setAttribute('aria-label', 'Guardado');
    row.appendChild(h);
  }
  row.insertAdjacentHTML('beforeend', CHEVRON_RIGHT_SVG);
  row.addEventListener('click', () => openAuthor(name, olKey));
  return row;
}
const CHEVRON_RIGHT_SVG = '<svg viewBox="0 0 24 24" class="setting-chevron author-chevron" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

function renderAuthorsView() {
  if ($('explore-authors').hidden) return;
  const lib = libraryAuthors();
  const ranking = authorRanking();
  const rankOf = (name) => ranking.findIndex((a) => a.key === authorKey(name)) + 1;

  // Guardados: ordenados por tu ranking (los que aún no has leído, al final)
  const favs = favAuthors().slice().sort((x, y) => (rankOf(x) || 999) - (rankOf(y) || 999) || collator.compare(x, y));
  const favWrap = $('fav-authors');
  favWrap.innerHTML = '';
  favs.forEach((name) => favWrap.appendChild(authorRow(name, { stats: lib.get(authorKey(name)), rank: rankOf(name) })));
  favWrap.hidden = !favs.length;
  $('fav-authors-empty').hidden = favs.length > 0;

  // Ranking
  const list = [...ranking].sort(AUTHOR_SORTS[authorSort]);
  const rankWrap = $('author-ranking');
  rankWrap.innerHTML = '';
  list.forEach((a) => rankWrap.appendChild(authorRow(a.name, { stats: a, rank: rankOf(a.name) })));
  rankWrap.hidden = !list.length;
  $('author-ranking-empty').hidden = list.length > 0;
  $('author-sort').hidden = list.length < 2;
}

document.querySelectorAll('#author-sort .segment').forEach((seg) => {
  seg.addEventListener('click', () => {
    authorSort = seg.dataset.sort;
    document.querySelectorAll('#author-sort .segment').forEach((s) => s.classList.toggle('is-active', s === seg));
    renderAuthorsView();
  });
});

// Libros / Autores en Explorar
function setExploreMode(mode) {
  document.querySelectorAll('#explore-modes .segment').forEach((s) => {
    const on = s.dataset.mode === mode;
    s.classList.toggle('is-active', on);
    s.setAttribute('aria-selected', String(on));
  });
  $('explore-books').hidden = mode !== 'books';
  $('explore-authors').hidden = mode !== 'authors';
  renderAuthorsView();
}
document.querySelectorAll('#explore-modes .segment').forEach((s) => s.addEventListener('click', () => setExploreMode(s.dataset.mode)));

// Buscar escritores: los que ya conoces (biblioteca y Explorar) y, además, en Open Library
let authorSearchTimer = null;
let authorSearchReq = 0;
$('author-search').addEventListener('input', () => {
  clearTimeout(authorSearchTimer);
  authorSearchTimer = setTimeout(runAuthorSearch, 300);
});
async function runAuthorSearch() {
  const q = $('author-search').value.trim();
  const sec = $('author-results-sec');
  const wrap = $('author-results');
  const status = $('author-results-status');
  const req = ++authorSearchReq;
  if (q.length < 2) { sec.hidden = true; return; }
  sec.hidden = false;
  wrap.innerHTML = '';
  const words = searchText(q).split(' ');
  const lib = libraryAuthors();
  const known = new Map();
  [...books, ...catalog].forEach((b) => splitAuthors(b.author).forEach((n) => { if (!known.has(authorKey(n))) known.set(authorKey(n), n); }));
  const local = [...known.entries()].filter(([k]) => words.every((w) => k.includes(w))).slice(0, 8);
  local.forEach(([k, name]) => {
    const inCatalog = catalog.filter(byAuthor(name)).length;
    wrap.appendChild(authorRow(name, lib.get(k)
      ? { stats: lib.get(k) }
      : { meta: `${inCatalog} ${inCatalog === 1 ? 'libro' : 'libros'} en Explorar` }));
  });
  wrap.hidden = !local.length;
  status.textContent = 'Buscando en Open Library…';
  status.hidden = false;
  try {
    const res = await fetch(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(q)}&limit=8`);
    const data = await res.json();
    if (req !== authorSearchReq) return;
    // Una sola ficha por nombre (Open Library a veces tiene duplicados): la que tiene más obras
    const byName = new Map();
    (data.docs || []).filter((d) => d.name && !known.has(authorKey(d.name)) && (d.work_count || 0) > 1).forEach((d) => {
      const prev = byName.get(authorKey(d.name));
      if (!prev || (d.work_count || 0) > (prev.work_count || 0)) byName.set(authorKey(d.name), d);
    });
    const extra = [...byName.values()].sort((a, b) => (b.work_count || 0) - (a.work_count || 0)).slice(0, 6);
    extra.forEach((d) => wrap.appendChild(authorRow(d.name, {
      olKey: d.key,
      meta: [`${d.work_count} obras`, d.top_work ? `«${d.top_work}»` : ''].filter(Boolean).join(' · '),
    })));
    wrap.hidden = !wrap.children.length;
    status.hidden = Boolean(wrap.children.length);
    status.textContent = 'No he encontrado a ningún escritor con ese nombre.';
  } catch (err) {
    if (req !== authorSearchReq) return;
    status.textContent = local.length ? '' : 'No se pudo buscar en Open Library. Revisa la conexión.';
    status.hidden = !status.textContent;
  }
}

// ---------- Ficha de un escritor ----------
const authorDialog = $('author-dialog');
let currentAuthor = null;      // { name, olKey }
let authorFilter = 'mine';
const authorWorksCache = new Map(); // libros de Open Library por escritor

function openAuthor(name, olKey = null) {
  currentAuthor = { name, olKey };
  const mine = books.filter(byAuthor(name)).length;
  authorFilter = mine ? 'mine' : 'discover';
  renderAuthorDialog();
  loadAuthorPhoto();
  if (!authorDialog.open) authorDialog.showModal();
  authorDialog.scrollTop = 0;
}

function renderAuthorDialog() {
  if (!currentAuthor) return;
  const { name } = currentAuthor;
  const stats = libraryAuthors().get(authorKey(name));
  const ranking = authorRanking();
  const pos = ranking.findIndex((a) => a.key === authorKey(name)) + 1;
  $('author-name').textContent = name;
  $('author-initials').textContent = initialsOf(name);
  $('author-rank').textContent = pos === 1 && stats?.avg != null
    ? '⭐ Tu escritor favorito'
    : pos ? `Nº ${pos} de tu ranking` : 'Aún no has leído nada suyo';
  const fav = isFavAuthor(name);
  const save = $('btn-author-save');
  save.textContent = fav ? '♥ Guardado' : '♡ Guardar escritor';
  save.setAttribute('aria-pressed', String(fav));
  save.classList.toggle('is-saved', fav);
  $('author-read').textContent = stats ? stats.read.length : 0;
  $('author-avg').textContent = stats?.avg != null ? `★ ${fmtAvg(stats.avg)}` : '—';
  $('author-pending').textContent = stats ? stats.todo : 0;
  document.querySelectorAll('#author-filter .segment').forEach((s) => s.classList.toggle('is-active', s.dataset.filter === authorFilter));
  renderAuthorBooks();
}

async function renderAuthorBooks() {
  const { name } = currentAuthor;
  const grid = $('author-books');
  const empty = $('author-books-empty');
  grid.innerHTML = '';
  empty.hidden = true;
  const mine = books.filter(byAuthor(name));
  const show = (list, onClick, emptyText) => {
    list.forEach((b) => grid.appendChild(createBookCard(b, () => onClick(b))));
    empty.textContent = emptyText;
    empty.hidden = list.length > 0;
  };
  if (authorFilter === 'mine') return show(mine, openDetailDialog, 'Aún no tienes ningún libro suyo. Mira en «Descubrir».');
  if (authorFilter === 'read') return show(mine.filter((b) => b.status === 'read').sort((a, b) => (b.rating || 0) - (a.rating || 0)), openDetailDialog, 'Todavía no has leído ningún libro suyo.');
  if (authorFilter === 'todo') return show(mine.filter((b) => b.status !== 'read'), openDetailDialog, 'No tienes libros suyos pendientes.');

  // Descubrir: los de Explorar que no tienes y, además, los de Open Library
  const fromCatalog = catalog.filter(byAuthor(name)).filter((c) => !isInLibrary(c));
  show(fromCatalog, openCatalogDialog, '');
  const k = authorKey(name);
  if (!authorWorksCache.has(k)) {
    empty.textContent = 'Buscando más libros suyos…';
    empty.hidden = false;
    try {
      const fields = 'key,title,author_name,cover_i,number_of_pages_median,editions,editions.title,editions.cover_i,editions.language,editions.number_of_pages';
      const res = await fetch(`https://openlibrary.org/search.json?author=${encodeURIComponent(name)}&lang=es&limit=30&sort=editions&fields=${fields}`);
      const data = await res.json();
      // Edición en castellano si la hay; si no, el título y la portada originales (no una edición en otro idioma)
      authorWorksCache.set(k, (data.docs || []).filter((d) => (d.author_name || []).some((n) => authorKey(n) === k)).map((d) => {
        const ed = d.editions?.docs?.[0];
        const spa = Boolean(ed && (ed.language || []).includes('spa'));
        const cover = (spa && ed.cover_i) || d.cover_i;
        return {
          ...splitSeries((spa && ed.title) || d.title || ''),
          author: name,
          cover_url: cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg` : null,
          total_pages: (spa && ed.number_of_pages) || d.number_of_pages_median || null,
        };
      }));
    } catch (err) {
      console.error(err);
      authorWorksCache.set(k, null);
    }
    if (currentAuthor?.name !== name || authorFilter !== 'discover') return;
  }
  const works = authorWorksCache.get(k);
  const seen = [...books, ...fromCatalog];
  const extra = (works || []).filter((w) => w.cover_url && !seen.some((b) => sameBook(b, w)))
    .filter((w, i, arr) => arr.findIndex((x) => searchText(x.title) === searchText(w.title)) === i)
    .slice(0, 18);
  extra.forEach((w) => grid.appendChild(createBookCard(w, () => openCatalogDialog({ ...w, category: null }))));
  const total = fromCatalog.length + extra.length;
  empty.textContent = works === null && !total
    ? 'No se pudo buscar en Open Library. Revisa la conexión.'
    : 'No he encontrado más libros suyos que no tengas.';
  empty.hidden = total > 0;
}

document.querySelectorAll('#author-filter .segment').forEach((seg) => {
  seg.addEventListener('click', () => {
    authorFilter = seg.dataset.filter;
    document.querySelectorAll('#author-filter .segment').forEach((s) => s.classList.toggle('is-active', s === seg));
    renderAuthorBooks();
  });
});
$('btn-author-save').addEventListener('click', () => { if (currentAuthor) toggleFavAuthor(currentAuthor.name); });
$('btn-close-author').addEventListener('click', () => authorDialog.close());

// Foto del escritor (Open Library); si no hay, se quedan sus iniciales
async function loadAuthorPhoto() {
  const img = $('author-img');
  img.hidden = true;
  img.removeAttribute('src');
  const name = currentAuthor.name;
  let key = currentAuthor.olKey;
  try {
    if (!key) {
      const res = await fetch(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(name)}&limit=1`);
      const d = (await res.json()).docs?.[0];
      if (d && authorKey(d.name) === authorKey(name)) key = d.key;
    }
  } catch { /* sin foto */ }
  if (!key || currentAuthor?.name !== name) return;
  img.onload = () => { if (img.naturalWidth > 10) img.hidden = false; };
  img.onerror = () => { img.hidden = true; };
  img.src = `https://covers.openlibrary.org/a/olid/${key}-M.jpg?default=false`;
}

// ---------- Inicio ----------
const initial = location.hash.slice(1);
goTo(['library', 'explore', 'reading', 'profile'].includes(initial) ? initial : 'library');

if (!isConfigured) {
  showScreen('loading');
  $('loading-screen').insertAdjacentHTML('beforeend',
    '<p class="muted" style="grid-row:2">Falta configurar Supabase en <code>config.js</code>.</p>');
}

// ---------- Modo sin conexión y apertura instantánea (service worker) ----------
// Solo funciona servido por internet (GitHub Pages), no abriendo el archivo directamente.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker:', err));
  });
  // Hay una versión nueva ya descargada: se ofrece recargar
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'app-updated') $('update-toast').hidden = false;
  });
  $('btn-update').addEventListener('click', () => location.reload());
}
