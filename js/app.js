"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  search: $("search"), form: $("searchForm"), genre: $("genre"), language: $("language"),
  sort: $("sort"), order: $("order"), reset: $("reset"), status: $("status"),
  grid: $("grid"), pager: $("pager"), modal: $("modal"), modalBody: $("modalBody"),
  categories: $("categories"), shelf: $("newShelf"), newList: $("newList"),
};

const DEFAULTS = { q: "", category: "", genre: "", language: "", sort: "title", order: "asc", page: 1 };
const state = { ...DEFAULTS };
const DESC_FIRST = ["rating", "new", "views"];   // эти сортировки логичнее сразу показывать по убыванию
let controller = null; // отмена устаревших запросов каталога
let categories = [];

// ---------- утилиты ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function coverStyle(title) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `--c1:hsl(${h} 55% 38%);--c2:hsl(${(h + 40) % 360} 60% 24%)`;
}

const stars = (r) => `★ ${r.toFixed(1)}`;

/** «1 том», «3 тома», «5 томов». */
function volumesLabel(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} том`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} тома`;
  return `${n} томов`;
}

const FORMAT_LABEL = { pdf: "PDF", epub: "EPUB", txt: "TXT" };

async function api(path, params = {}, { signal } = {}) {
  const url = new URL(API_URL + path);
  Object.entries(params).forEach(([k, v]) => v !== "" && v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Ошибка API: ${res.status}`);
  return res.json();
}

// ---------- состояние <-> URL ----------
function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const key of Object.keys(DEFAULTS)) {
    const v = p.get(key);
    state[key] = v == null ? DEFAULTS[key] : key === "page" ? Math.max(1, +v || 1) : v;
  }
}

function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v !== DEFAULTS[k]) p.set(k, v);
  history.replaceState(null, "", p.size ? `?${p}` : location.pathname);
}

const filtered = () => !!(state.q || state.category || state.genre || state.language);

function syncControls() {
  els.search.value = state.q;
  els.genre.value = state.genre;
  els.language.value = state.language;
  els.sort.value = state.sort;
  const text = state.sort === "title" || state.sort === "author"
    ? (state.order === "asc" ? "↑ А→Я" : "↓ Я→А")
    : (state.order === "asc" ? "↑ по возрастанию" : "↓ по убыванию");
  els.order.textContent = text;
  els.categories.querySelectorAll("[data-category]").forEach((chip) =>
    chip.setAttribute("aria-pressed", chip.dataset.category === state.category));
  // «Новинки» — витрина главной страницы: при поиске и фильтрах она только мешает
  els.shelf.hidden = filtered() || state.page !== 1 || !els.newList.children.length;
}

// ---------- рендер ----------
/** Обложка: картинка из админки, а если её нет или не загрузилась — цветная заглушка с названием. */
function coverHtml(b, extra = "") {
  const img = b.cover_url ? `<img src="${esc(b.cover_url)}" alt="" loading="lazy" decoding="async">` : "";
  const badges = [
    b.is_new ? `<span class="badge badge--new">NEW</span>` : "",
    b.has_file && b.file_format ? `<span class="badge">${FORMAT_LABEL[b.file_format] || ""}</span>` : "",
  ].join("");
  return `<div class="cover ${extra}" style="${coverStyle(b.title)}"><span>${esc(b.title)}</span>${img}` +
    (badges ? `<div class="badges">${badges}</div>` : "") + `</div>`;
}

function seriesNote(b) {
  if (!b.series_id) return "";
  return b.series_count > 1
    ? `<p class="series">📚 ${esc(b.series_title)} · ${volumesLabel(b.series_count)}</p>`
    : `<p class="series">📚 ${esc(b.series_title)}</p>`;
}

function cardHtml(b) {
  return `
    <article class="card" tabindex="0" data-id="${b.id}" aria-label="${esc(b.title)}">
      ${coverHtml(b)}
      <div class="card__body">
        <h3>${esc(b.title)}</h3>
        <p class="muted">${esc(b.author)}</p>
        ${seriesNote(b)}
        <p class="meta"><span class="rating">${stars(b.rating)}</span><span class="year">${b.year}</span></p>
        <p class="meta"><span class="tag">${esc(b.genre)}</span><span title="Просмотры">👁 ${b.views ?? 0}</span></p>
      </div>
    </article>`;
}

function renderBooks(data) {
  els.status.textContent = data.total
    ? `Найдено книг: ${data.total}`
    : "Ничего не найдено. Попробуйте изменить запрос или сбросить фильтры.";
  els.grid.innerHTML = data.items.map(cardHtml).join("");
  renderPager(data);
}

function renderPager({ page, pages }) {
  if (pages <= 1) { els.pager.innerHTML = ""; return; }
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums.at(-1) !== "…") nums.push("…");
  }
  els.pager.innerHTML =
    `<button class="btn" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>←</button>` +
    nums.map((n) => n === "…" ? `<span class="dots">…</span>`
      : `<button class="btn ${n === page ? "btn--active" : ""}" data-page="${n}" ${n === page ? 'aria-current="page"' : ""}>${n}</button>`).join("") +
    `<button class="btn" data-page="${page + 1}" ${page === pages ? "disabled" : ""}>→</button>`;
}

function renderSkeleton() {
  els.status.textContent = "Загрузка…";
  els.grid.innerHTML = Array.from({ length: 8 }, () => `<div class="card card--skeleton"></div>`).join("");
}

function showError(err) {
  els.status.textContent = "";
  els.pager.innerHTML = "";
  els.grid.innerHTML = `<div class="error">
    <p><strong>Не удалось загрузить книги.</strong></p>
    <p class="muted">${esc(err.message)}. Проверьте, что API доступен: ${esc(API_URL)}</p>
    <button class="btn btn--active" id="retry">Повторить</button></div>`;
  $("retry").onclick = load;
}

function renderCategories() {
  els.categories.hidden = !categories.length;
  els.categories.innerHTML = `<button class="chip" type="button" data-category="">Все</button>` +
    categories.map((c) => `<button class="chip" type="button" data-category="${c.id}">${esc(c.name)} <span>${c.count}</span></button>`).join("");
}

// ---------- загрузка ----------
async function load() {
  controller?.abort();
  controller = new AbortController();
  syncControls();
  writeUrl();
  renderSkeleton();
  try {
    // многотомник в каталоге — одной карточкой; в поиске показываем все тома
    const params = { ...state, limit: 12, collapse_series: state.q ? "" : "true" };
    renderBooks(await api("/api/books", params, { signal: controller.signal }));
  } catch (err) {
    if (err.name !== "AbortError") showError(err);
  }
}

async function loadFilters() {
  const fill = (select, items) => select.insertAdjacentHTML("beforeend",
    items.map((i) => `<option value="${esc(i.name)}">${esc(i.name)} (${i.count})</option>`).join(""));
  const [genres, languages, cats] = await Promise.allSettled([api("/api/genres"), api("/api/languages"), api("/api/categories")]);
  // списки фильтров не критичны; ошибку покажет основной запрос
  if (genres.status === "fulfilled") fill(els.genre, genres.value);
  if (languages.status === "fulfilled") fill(els.language, languages.value);
  if (cats.status === "fulfilled") { categories = cats.value; renderCategories(); }
}

async function loadNew() {
  try {
    const data = await api("/api/books", { only_new: "true", sort: "new", order: "desc", limit: 12 });
    els.newList.innerHTML = data.items.map(cardHtml).join("");
  } catch { /* витрина необязательна */ }
  syncControls();
}

// Окно книги: читать может любой вошедший читатель, скачивание — платное (оплата Mbank пока не подключена)
function actionsHtml(b) {
  const loggedIn = !!Auth.session();
  const readHref = loggedIn ? `read.html?id=${b.id}` : Auth.loginUrl(`read.html?id=${b.id}`);
  const price = b.price > 0 ? `${b.price.toLocaleString("ru-RU")} сом` : "цена не назначена";
  return `<div class="actions">
      <a class="btn btn--active" href="${readHref}">${loggedIn ? "📖 Читать онлайн" : "🔐 Войти, чтобы читать"}</a>
      <button class="btn" id="buyBtn" type="button" data-id="${b.id}">⬇ Купить файл · ${price}</button>
    </div>
    <p class="muted buymsg" id="buyMsg" role="status" aria-live="polite"></p>`;
}

async function buy(id) {
  const msg = $("buyMsg");
  const session = await Auth.validSession();
  if (!session) { location.href = Auth.loginUrl("./"); return; }
  try {
    const res = await fetch(`${API_URL}/api/books/${id}/download`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (res.status === 401) { Auth.clear(); location.href = Auth.loginUrl("./"); return; }
    const data = await res.json().catch(() => ({}));
    msg.textContent = res.status === 402 ? "Покупка пока недоступна. Оплата через Mbank появится позже." : (data.detail || "Не удалось начать покупку");
  } catch {
    msg.textContent = "Нет связи с сервером. Попробуйте позже.";
  }
}

/** Просмотр считается при открытии карточки. Ошибка не мешает показать книгу. */
function countView(id) {
  fetch(`${API_URL}/api/books/${id}/view`, { method: "POST" }).catch(() => {});
}

async function loadVolumes(b) {
  const box = $("volumes");
  try {
    const series = await api(`/api/series/${b.series_id}`);
    box.innerHTML = `<h3>Тома серии</h3><ol class="volumes">` + series.books.map((v) => `
      <li><button type="button" class="volume ${v.id === b.id ? "volume--current" : ""}" data-volume="${v.id}"
        ${v.id === b.id ? 'aria-current="true"' : ""}>
        <b>${v.volume ? `Том ${v.volume}` : "—"}</b> ${esc(v.title)}</button></li>`).join("") + `</ol>`;
  } catch {
    box.innerHTML = "";
  }
}

async function openBook(id) {
  try {
    const b = await api(`/api/books/${id}`);
    countView(b.id);
    const cats = b.categories?.length
      ? `<p class="cats">${b.categories.map((c) => `<button type="button" class="tag tag--link" data-pick-category="${c.id}">${esc(c.name)}</button>`).join(" ")}</p>`
      : "";
    const series = b.series_id
      ? `<dt>Серия</dt><dd>${esc(b.series_title)}${b.volume ? `, том ${b.volume}` : ""}</dd>` : "";
    els.modalBody.innerHTML = `
      <div class="detail">
        ${coverHtml(b, "cover--big")}
        <div>
          <h2>${esc(b.title)}</h2>
          <p class="muted">${esc(b.author)}</p>
          <p class="meta meta--start"><span class="rating">${stars(b.rating)}</span><span title="Просмотры">👁 ${b.views ?? 0}</span></p>
          ${cats}
          <p>${esc(b.description)}</p>
          <dl>
            <dt>Жанр</dt><dd>${esc(b.genre)}</dd>
            ${series}
            <dt>Год</dt><dd>${b.year}</dd>
            <dt>Страниц</dt><dd>${b.pages}</dd>
            <dt>Язык</dt><dd>${esc(b.language)}</dd>
            ${b.has_file ? `<dt>Формат</dt><dd>${FORMAT_LABEL[b.file_format] || "PDF"}</dd>` : ""}
          </dl>
          ${b.has_file ? actionsHtml(b) : `<p class="muted nofile">Файл для этой книги пока не загружен.</p>`}
          ${b.series_id ? `<div id="volumes"></div>` : ""}
        </div>
      </div>`;
    if (!els.modal.open) els.modal.showModal();
    if (b.series_id) loadVolumes(b);
  } catch (err) {
    els.status.textContent = err.message;
  }
}

// ---------- события ----------
const update = (patch) => { Object.assign(state, patch); load(); };

let timer;
els.search.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => update({ q: els.search.value.trim(), page: 1 }), 300);
});
els.form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); update({ q: els.search.value.trim(), page: 1 }); });
els.genre.addEventListener("change", () => update({ genre: els.genre.value, page: 1 }));
els.language.addEventListener("change", () => update({ language: els.language.value, page: 1 }));
els.sort.addEventListener("change", () => {
  update({ sort: els.sort.value, order: DESC_FIRST.includes(els.sort.value) ? "desc" : "asc", page: 1 });
});
els.order.addEventListener("click", () => update({ order: state.order === "asc" ? "desc" : "asc", page: 1 }));
els.reset.addEventListener("click", () => update({ ...DEFAULTS }));
els.categories.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-category]");
  if (chip) update({ category: chip.dataset.category, page: 1 });
});

els.pager.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-page]");
  if (!btn || btn.disabled) return;
  update({ page: +btn.dataset.page });
  window.scrollTo({ top: 0, behavior: "smooth" });
});

for (const list of [els.grid, els.newList]) {
  list.addEventListener("click", (e) => {
    const card = e.target.closest(".card[data-id]");
    if (card) openBook(card.dataset.id);
  });
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest(".card[data-id]");
    if (card) openBook(card.dataset.id);
  });
}

// обложка не загрузилась — остаётся цветная заглушка с названием
document.addEventListener("error", (e) => {
  if (e.target.matches?.(".cover img")) e.target.remove();
}, true);

els.modalBody.addEventListener("click", (e) => {
  const buyBtn = e.target.closest("#buyBtn");
  if (buyBtn) return buy(buyBtn.dataset.id);
  const volume = e.target.closest("[data-volume]");
  if (volume) return openBook(volume.dataset.volume);
  const cat = e.target.closest("[data-pick-category]");
  if (cat) {
    els.modal.close();
    update({ ...DEFAULTS, category: cat.dataset.pickCategory });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

function renderAuthBox() {
  const session = Auth.session();
  $("authEmail").hidden = !session;
  $("authEmail").textContent = session?.user?.email || "";
  $("logoutBtn").hidden = !session;
  $("loginLink").hidden = !!session;
  $("loginLink").href = Auth.loginUrl(location.pathname.split("/").pop() + location.search);
}
$("logoutBtn").addEventListener("click", async () => { await Auth.signOut(); renderAuthBox(); });
renderAuthBox();

$("modalClose").addEventListener("click", () => els.modal.close());
els.modal.addEventListener("click", (e) => { if (e.target === els.modal) els.modal.close(); }); // клик по фону

$("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* приватный режим */ }
});
try {
  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.dataset.theme = saved;
} catch { /* ignore */ }

// ---------- старт ----------
readUrl();
syncControls();
loadFilters().then(syncControls); // значения селектов можно выставить только после загрузки опций
loadNew();
load();
