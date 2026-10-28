"use strict";

pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const $ = (id) => document.getElementById(id);
const bookId = Number(new URLSearchParams(location.search).get("id"));
const ZOOM_MIN = 1, ZOOM_MAX = 3, ZOOM_STEP = 0.25;
const KEEP_AHEAD = 4, KEEP_BEHIND = 3;   // сколько страниц вокруг текущей держим отрендеренными
const MAX_CANVAS_PX = 2400;
const SEARCH_LIMIT = 200;

// text — книга EPUB или TXT: страницы готовы заранее (TextBook), рендерить ничего не нужно
const state = { pdf: null, text: false, flip: null, total: 0, ratio: 0.7, zoom: 1, page: 0, sound: false };
const canvases = [];              // canvas каждой страницы (индекс с 0)
const renderedAt = new Map();     // индекс -> ширина в px, при которой страница отрендерена
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- загрузка ----------
function goLogin() {
  location.replace(Auth.loginUrl(`read.html${location.search}`));
}

function fail(message) {
  $("loading").hidden = false;
  $("loading").innerHTML = `<p><strong>${esc(message)}</strong></p><a href="./">← Вернуться в каталог</a>`;
}

async function loadMeta() {
  const res = await fetch(`${API_URL}/api/books/${bookId}`);
  if (res.status === 404) throw new Error("Книга не найдена");
  if (!res.ok) throw new Error("Не удалось получить данные книги");
  const book = await res.json();
  $("rTitle").textContent = book.title;
  $("rAuthor").textContent = book.author;
  document.title = `${book.title} — читать`;
  if (!book.has_file) throw new Error("Для этой книги файл ещё не загружен");
  return book;
}

class LoginRequired extends Error {}

// Ссылку на файл выдаёт API только вошедшему читателю (временная подписанная ссылка Supabase Storage)
async function fileUrl() {
  const session = await Auth.validSession();
  if (!session) throw new LoginRequired();
  const res = await fetch(`${API_URL}/api/books/${bookId}/file-url`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (res.status === 401) { Auth.clear(); throw new LoginRequired(); }
  if (res.status === 404) throw new Error("Для этой книги файл ещё не загружен");
  if (!res.ok) throw new Error("Не удалось получить файл книги. Попробуйте позже.");
  const data = await res.json();
  return { url: data.url, format: data.format || "pdf" };
}

async function openPdf(url) {
  // isEvalSupported: false — защита от вредоносных шрифтов в PDF (CVE-2024-4367 в PDF.js 3.x)
  try {
    return await pdfjsLib.getDocument({ url, isEvalSupported: false }).promise;
  } catch (first) {
    // запасной вариант: если хранилище не принимает Range-запросы, качаем файл целиком
    return await pdfjsLib.getDocument({ url, isEvalSupported: false, disableRange: true, disableStream: true }).promise;
  }
}

// EPUB и TXT: качаем файл целиком, разбираем и раскладываем по страницам заранее
async function openText(url, format, book) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("download");
  const parsed = await TextBook.open(new Uint8Array(await res.arrayBuffer()), format);
  const progress = (share) => { $("loading").textContent = `Подготовка страниц… ${Math.round(share * 100)}%`; };
  return TextBook.paginate(parsed, book, progress);
}

// ---------- размеры ----------
function baseSize() {
  const stage = $("stage");
  const availW = Math.max(200, stage.clientWidth - 32), availH = Math.max(200, stage.clientHeight - 32);
  const portrait = availW < 700;
  const pageH = Math.min(availH, availW / (portrait ? 1 : 2) / state.ratio);
  const pageW = pageH * state.ratio;
  return { w: Math.round(portrait ? pageW : pageW * 2), h: Math.round(pageH), pageW, portrait };
}

// StPageFlip выбирает режим по ширине контейнера (портрет, если она < 2·minWidth), а при зуме контейнер растёт
// и режим переключился бы сам. Поэтому режим (разворот / одна страница) задаём явно: minWidth влияет только на этот выбор.
function setOrientation(portrait) {
  state.flip.getSettings().minWidth = portrait ? 1e6 : 1;
}

function applySize() {
  const { w, h, portrait } = baseSize();
  state.flip && setOrientation(portrait);
  const zoomer = $("zoomer");
  zoomer.style.width = `${w * state.zoom}px`;
  zoomer.style.height = `${h * state.zoom}px`;
  // текстовая страница свёрстана в логическом размере и масштабируется целиком
  $("book").style.setProperty("--tscale", (baseSize().pageW * state.zoom) / TextBook.PAGE_W);
  state.flip?.update();
  $("zoomVal").textContent = `${Math.round(state.zoom * 100)}%`;
  $("zoomOut").disabled = state.zoom <= ZOOM_MIN;
  $("zoomIn").disabled = state.zoom >= ZOOM_MAX;
  renderAround(state.page);   // при увеличении перерисовываем страницы в большем разрешении
}

// ---------- рендер страниц (лениво) ----------
async function renderPage(index) {
  const canvas = canvases[index];
  const { pageW } = baseSize();
  const target = Math.min(MAX_CANVAS_PX, Math.round(pageW * state.zoom * (window.devicePixelRatio || 1)));
  if ((renderedAt.get(index) || 0) >= target * 0.8) return;
  renderedAt.set(index, target);
  const page = await state.pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale: target / page.getViewport({ scale: 1 }).width });
  const buffer = document.createElement("canvas");  // рисуем во внешний canvas, чтобы страница не мигала
  buffer.width = Math.round(viewport.width);
  buffer.height = Math.round(viewport.height);
  await page.render({ canvasContext: buffer.getContext("2d"), viewport }).promise;
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  canvas.getContext("2d").drawImage(buffer, 0, 0);
}

function renderAround(index) {
  if (state.text) return;
  const from = Math.max(0, index - KEEP_BEHIND), to = Math.min(state.total - 1, index + KEEP_AHEAD);
  for (let i = from; i <= to; i++) renderPage(i).catch(() => renderedAt.delete(i));
  for (const i of [...renderedAt.keys()]) {        // освобождаем память далёких страниц
    if (i < from - 4 || i > to + 4) { canvases[i].width = canvases[i].height = 0; renderedAt.delete(i); }
  }
}

// ---------- навигация ----------
function setPage(index) {
  state.page = index;
  $("pageInput").value = index + 1;
  $("prev").disabled = index <= 0;
  $("next").disabled = index >= state.total - 1;
  const url = new URL(location.href);
  url.searchParams.set("page", index + 1);
  history.replaceState(null, "", url);
  renderAround(index);
}

function goTo(index) {
  index = Math.min(state.total - 1, Math.max(0, index));
  state.flip.turnToPage(index);
  setPage(index);
}

// ---------- звук (синтезируется, без файлов) ----------
let audio;
function pageSound() {
  if (!state.sound) return;
  try {
    audio ||= new AudioContext();
    const len = Math.floor(audio.sampleRate * 0.22), buf = audio.createBuffer(1, len, audio.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    filter.type = "bandpass"; filter.frequency.value = 2200; gain.gain.value = 0.35;
    src.buffer = buf; src.connect(filter).connect(gain).connect(audio.destination); src.start();
  } catch { /* звук не критичен */ }
}

// ---------- поиск по тексту ----------
let pageTexts = null, searchToken = 0;

async function loadTexts(token) {
  pageTexts = [];
  for (let i = 1; i <= state.total; i++) {
    if (token !== searchToken) return false;
    const content = await (await state.pdf.getPage(i)).getTextContent();
    pageTexts.push(content.items.map((it) => it.str).join(" ").replace(/\s+/g, " "));
    if (i % 5 === 0) $("searchStatus").textContent = `Индексирую текст… ${i} / ${state.total}`;
  }
  return true;
}

async function search(query) {
  const token = ++searchToken, list = $("searchResults");
  list.innerHTML = "";
  query = query.trim();
  if (!query) { $("searchStatus").textContent = ""; return; }
  $("searchStatus").textContent = "Ищу…";
  if (!pageTexts && !(await loadTexts(token))) return;
  if (token !== searchToken) return;
  if (!pageTexts.some((t) => t.length)) {
    $("searchStatus").textContent = "В этом PDF нет текстового слоя (это скан), поиск недоступен.";
    return;
  }
  const q = query.toLowerCase(), hits = [];
  for (let i = 0; i < pageTexts.length && hits.length < SEARCH_LIMIT; i++) {
    const at = pageTexts[i].toLowerCase().indexOf(q);
    if (at >= 0) hits.push({ page: i, at });
  }
  $("searchStatus").textContent = hits.length ? `Найдено страниц: ${hits.length}${hits.length >= SEARCH_LIMIT ? "+" : ""}` : "Ничего не найдено";
  list.innerHTML = hits.map(({ page, at }) => {
    const text = pageTexts[page], s = Math.max(0, at - 30);
    const snippet = `${esc(text.slice(s, at))}<mark>${esc(text.slice(at, at + query.length))}</mark>${esc(text.slice(at + query.length, at + query.length + 40))}`;
    return `<li><button type="button" data-page="${page}"><b>стр. ${page + 1}</b>${snippet}</button></li>`;
  }).join("");
}

// ---------- события ----------
function bindUi() {
  $("prev").onclick = () => state.flip.flipPrev();
  $("next").onclick = () => state.flip.flipNext();
  $("pageInput").onchange = (e) => goTo((parseInt(e.target.value, 10) || 1) - 1);
  $("zoomIn").onclick = () => { state.zoom = Math.min(ZOOM_MAX, state.zoom + ZOOM_STEP); applySize(); };
  $("zoomOut").onclick = () => { state.zoom = Math.max(ZOOM_MIN, state.zoom - ZOOM_STEP); applySize(); };

  $("fsBtn").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
  document.addEventListener("fullscreenchange", () => { $("fsBtn").setAttribute("aria-pressed", !!document.fullscreenElement); applySize(); });

  $("soundBtn").onclick = () => {
    state.sound = !state.sound;
    $("soundBtn").textContent = state.sound ? "🔊" : "🔇";
    $("soundBtn").setAttribute("aria-pressed", state.sound);
    try { localStorage.setItem("reader-sound", state.sound ? "1" : "0"); } catch { /* ignore */ }
  };

  const panel = $("searchPanel"), tocPanel = $("tocPanel");
  $("searchBtn").onclick = () => { tocPanel.hidden = true; panel.hidden = !panel.hidden; if (!panel.hidden) $("searchInput").focus(); };
  $("tocBtn").onclick = () => { panel.hidden = true; tocPanel.hidden = !tocPanel.hidden; };
  $("tocClose").onclick = () => { tocPanel.hidden = true; };
  $("tocList").onclick = (e) => {
    const btn = e.target.closest("[data-page]");
    if (btn) { goTo(+btn.dataset.page); if (innerWidth < 700) tocPanel.hidden = true; }
  };
  $("searchClose").onclick = () => { panel.hidden = true; };
  $("searchForm").onsubmit = (e) => { e.preventDefault(); search($("searchInput").value); };
  $("searchResults").onclick = (e) => {
    const btn = e.target.closest("[data-page]");
    if (btn) { goTo(+btn.dataset.page); if (innerWidth < 700) panel.hidden = true; }
  };

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input")) { if (e.key === "Escape") e.target.blur(); return; }
    const keys = {
      ArrowRight: () => state.flip.flipNext(), ArrowLeft: () => state.flip.flipPrev(),
      "+": () => $("zoomIn").click(), "=": () => $("zoomIn").click(), "-": () => $("zoomOut").click(),
      f: () => $("fsBtn").click(), F: () => $("fsBtn").click(), Escape: () => { panel.hidden = true; tocPanel.hidden = true; },
    };
    keys[e.key]?.();
  });

  let wheelLock = false;   // в полноэкранном режиме колесо листает страницы, в обычном — страница скроллится как обычно
  document.addEventListener("wheel", (e) => {
    if (!document.fullscreenElement || state.zoom > 1 || wheelLock || Math.abs(e.deltaY) < 10) return;
    wheelLock = true; setTimeout(() => (wheelLock = false), 600);
    e.deltaY > 0 ? state.flip.flipNext() : state.flip.flipPrev();
  }, { passive: true });

  let resizeTimer;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(applySize, 150); });

  if (history.length > 1 && document.referrer.startsWith(location.origin)) {
    $("back").addEventListener("click", (e) => { e.preventDefault(); history.back(); });
  }
}

// ---------- старт ----------
async function main() {
  if (!Number.isInteger(bookId) || bookId <= 0) return fail("Не указана книга");
  try { state.sound = localStorage.getItem("reader-sound") === "1"; } catch { /* ignore */ }
  $("soundBtn").textContent = state.sound ? "🔊" : "🔇";
  $("soundBtn").setAttribute("aria-pressed", state.sound);

  if (!(await Auth.validSession())) return goLogin();   // читать могут только вошедшие
  let layout = null;
  try {
    const meta = await loadMeta();
    const file = await fileUrl();
    if (file.format === "pdf") state.pdf = await openPdf(file.url);
    else layout = await openText(file.url, file.format, meta);
  } catch (err) {
    if (err instanceof LoginRequired) return goLogin();
    return fail(err.message.startsWith("Книга") || err.message.startsWith("Для") || err.message.startsWith("Не удалось получить")
      ? err.message : "Не удалось открыть файл книги. Попробуйте позже.");
  }

  const book = $("book");
  if (layout) {
    state.text = true;
    state.total = layout.pages.length;
    state.ratio = TextBook.PAGE_W / TextBook.PAGE_H;
    pageTexts = layout.texts;   // поиск идёт по готовому тексту страниц
    for (const page of layout.pages) {
      const box = document.createElement("div");
      box.className = "rpagebox rpagebox--text";
      box.append(page);
      book.append(box);
    }
    if (layout.toc.length > 1) {
      $("tocBtn").hidden = false;
      $("tocList").innerHTML = layout.toc.map((t) =>
        `<li><button type="button" data-page="${t.page}"><b>${t.page + 1}</b>${esc(t.title)}</button></li>`).join("");
    }
  } else {
    state.total = state.pdf.numPages;
    const first = await state.pdf.getPage(1), v = first.getViewport({ scale: 1 });
    state.ratio = v.width / v.height;
    for (let i = 0; i < state.total; i++) {
      const box = document.createElement("div");
      box.className = "rpagebox";
      if (i === 0 || i === state.total - 1) box.dataset.density = "hard";   // твёрдая обложка
      const canvas = document.createElement("canvas");
      canvases.push(canvas);
      box.append(canvas);
      book.append(box);
    }
  }
  $("pageTotal").textContent = state.total;
  $("pageInput").max = state.total;

  const { w, h, pageW } = baseSize();
  $("zoomer").style.width = `${w}px`;
  $("zoomer").style.height = `${h}px`;
  state.flip = new St.PageFlip(book, {
    width: Math.round(pageW), height: h, size: "stretch",
    minWidth: 100, maxWidth: 2400, minHeight: 160, maxHeight: 3200,
    showCover: true, usePortrait: true, mobileScrollSupport: false, maxShadowOpacity: 0.45, flippingTime: 700,
  });
  state.flip.loadFromHTML(document.querySelectorAll(".rpagebox"));
  setOrientation(baseSize().portrait);   // после loadFromHTML: конструктор UI использует minWidth для CSS
  state.flip.on("flip", (e) => { setPage(e.data); pageSound(); });

  bindUi();
  const start = Math.min(state.total, Math.max(1, parseInt(new URLSearchParams(location.search).get("page"), 10) || 1)) - 1;
  applySize();   // сначала размер и ориентация (разворот / одна страница), потом переход на нужную страницу
  $("loading").hidden = true;
  if (start) state.flip.turnToPage(start);
  setPage(start);
}

main();
