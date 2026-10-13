"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  search: $("search"), form: $("searchForm"), genre: $("genre"), language: $("language"),
  sort: $("sort"), order: $("order"), reset: $("reset"), status: $("status"),
  grid: $("grid"), pager: $("pager"), modal: $("modal"), modalBody: $("modalBody"),
};

const DEFAULTS = { q: "", genre: "", language: "", sort: "title", order: "asc", page: 1 };
const state = { ...DEFAULTS };
let controller = null; // отмена устаревших запросов

// ---------- утилиты ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function coverStyle(title) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `--c1:hsl(${h} 55% 38%);--c2:hsl(${(h + 40) % 360} 60% 24%)`;
}

const stars = (r) => `★ ${r.toFixed(1)}`;

async function api(path, params = {}) {
  const url = new URL(API_URL + path);
  Object.entries(params).forEach(([k, v]) => v !== "" && v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { signal: controller?.signal });
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

function syncControls() {
  els.search.value = state.q;
  els.genre.value = state.genre;
  els.language.value = state.language;
  els.sort.value = state.sort;
  const text = state.sort === "title" || state.sort === "author"
    ? (state.order === "asc" ? "↑ А→Я" : "↓ Я→А")
    : (state.order === "asc" ? "↑ по возрастанию" : "↓ по убыванию");
  els.order.textContent = text;
}

// ---------- рендер ----------
function renderBooks(data) {
  els.status.textContent = data.total
    ? `Найдено книг: ${data.total}`
    : "Ничего не найдено. Попробуйте изменить запрос или сбросить фильтры.";
  els.grid.innerHTML = data.items.map((b) => `
    <article class="card" tabindex="0" data-id="${b.id}" aria-label="${esc(b.title)}">
      <div class="cover" style="${coverStyle(b.title)}"><span>${esc(b.title)}</span></div>
      <div class="card__body">
        <h3>${esc(b.title)}</h3>
        <p class="muted">${esc(b.author)}</p>
        <p class="meta"><span class="rating">${stars(b.rating)}</span><span>${b.year}</span></p>
        <span class="tag">${esc(b.genre)}</span>${b.has_file ? ' <span class="tag tag--pdf">PDF</span>' : ""}
      </div>
    </article>`).join("");
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

// ---------- загрузка ----------
async function load() {
  controller?.abort();
  controller = new AbortController();
  syncControls();
  writeUrl();
  renderSkeleton();
  try {
    renderBooks(await api("/api/books", { ...state, limit: 12 }));
  } catch (err) {
    if (err.name !== "AbortError") showError(err);
  }
}

async function loadFilters() {
  const fill = (select, items) => select.insertAdjacentHTML("beforeend",
    items.map((i) => `<option value="${esc(i.name)}">${esc(i.name)} (${i.count})</option>`).join(""));
  try {
    const [genres, languages] = await Promise.all([api("/api/genres"), api("/api/languages")]);
    fill(els.genre, genres);
    fill(els.language, languages);
  } catch { /* список фильтров не критичен; ошибку покажет основной запрос */ }
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

async function openBook(id) {
  try {
    const b = await api(`/api/books/${id}`);
    els.modalBody.innerHTML = `
      <div class="detail">
        <div class="cover cover--big" style="${coverStyle(b.title)}"><span>${esc(b.title)}</span></div>
        <div>
          <h2>${esc(b.title)}</h2>
          <p class="muted">${esc(b.author)}</p>
          <p class="rating">${stars(b.rating)}</p>
          <p>${esc(b.description)}</p>
          <dl>
            <dt>Жанр</dt><dd>${esc(b.genre)}</dd>
            <dt>Год</dt><dd>${b.year}</dd>
            <dt>Страниц</dt><dd>${b.pages}</dd>
            <dt>Язык</dt><dd>${esc(b.language)}</dd>
          </dl>
          ${b.has_file ? actionsHtml(b) : `<p class="muted nofile">Файл для этой книги пока не загружен.</p>`}
        </div>
      </div>`;
    els.modal.showModal();
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
  // рейтинг логичнее сразу показывать по убыванию, текст — по возрастанию
  update({ sort: els.sort.value, order: els.sort.value === "rating" ? "desc" : "asc", page: 1 });
});
els.order.addEventListener("click", () => update({ order: state.order === "asc" ? "desc" : "asc", page: 1 }));
els.reset.addEventListener("click", () => update({ ...DEFAULTS }));

els.pager.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-page]");
  if (!btn || btn.disabled) return;
  update({ page: +btn.dataset.page });
  window.scrollTo({ top: 0, behavior: "smooth" });
});

els.grid.addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (card) openBook(card.dataset.id);
});
els.grid.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const card = e.target.closest(".card[data-id]");
  if (card) openBook(card.dataset.id);
});

els.modalBody.addEventListener("click", (e) => {
  const btn = e.target.closest("#buyBtn");
  if (btn) buy(btn.dataset.id);
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
load();
