// Общая обвязка браузерных тестов: статический сервер сайта, тестовый PDF, имитация API и Supabase.
// Настоящие сервисы не используются: ни база, ни Supabase Auth, ни аккаунты.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const API = 'http://localhost:8000';
export const SB = 'https://test-project.supabase.co';
export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,apikey,range',
  'access-control-expose-headers': 'content-range,accept-ranges',
};
const NO_EXTRAS = { views: 0, is_new: false, created_at: '2020-01-01T00:00:00Z', cover_url: null, file_format: null,
  categories: [], series_id: null, series_title: null, series_count: null, volume: null };
export const meta = {
  ...NO_EXTRAS, id: 1, title: 'Тестовая книга', author: 'Автор А.', genre: 'Тест', year: 2000, pages: 12,
  rating: 4, language: 'Русский', description: 'Описание', price: 350, has_file: true, file_format: 'pdf',
};
/** Картинка 1×1 (обложка, иллюстрация в EPUB). */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
export const CATEGORIES = [{ id: 1, name: 'Наука' }, { id: 2, name: 'История' }];
export const SERIES = { id: 7, title: 'Трилогия', description: '' };
/**
 * Каталог из 14 книг: id 1 — meta, id 5 — «Алхимик», остальные «Книга NN».
 * Файлы у чётных: id 4 — EPUB, id 6 — TXT, остальные PDF. Новинки — id 2 и 3. Категории: нечётные — «Наука»,
 * кратные 3 — «История». id 15–17 — тома 1–3 серии «Трилогия» (в каталоге — одна карточка).
 */
export const BOOKS = Array.from({ length: 17 }, (_, i) => {
  const id = i + 1;
  if (id === 1) return meta;
  const inSeries = id >= 15;
  return {
    ...NO_EXTRAS,
    id, title: inSeries ? `Трилогия, том ${id - 14}` : id === 5 ? 'Алхимик' : `Книга ${String(id).padStart(2, '0')}`, author: id % 2 ? 'Автор Б.' : 'Автор В.',
    genre: id % 2 && !inSeries ? 'Фантастика' : 'Классика', year: inSeries ? 1995 : 1990 + id, pages: 100 + id, rating: 3 + (id % 3) * 0.5,
    language: id % 3 ? 'Английский' : 'Русский', description: `Описание ${id}`, price: 0, has_file: id % 2 === 0,
    file_format: id % 2 ? null : id === 4 ? 'epub' : id === 6 ? 'txt' : 'pdf',
    views: (id * 7) % 23, is_new: id === 2 || id === 3, created_at: id <= 3 ? `2026-10-2${id}T00:00:00Z` : `2020-01-${String(id).padStart(2, '0')}T00:00:00Z`,
    categories: [...(id % 2 ? [CATEGORIES[0]] : []), ...(id % 3 ? [] : [CATEGORIES[1]])],
    ...(id === 2 ? { cover_url: `${SB}/storage/v1/object/public/covers/ok.png` } : id === 3 ? { cover_url: `${SB}/storage/v1/object/public/covers/missing.png` } : {}),
    ...(inSeries ? { series_id: SERIES.id, series_title: SERIES.title, series_count: 3, volume: id - 14 } : {}),
  };
});

export function queryBooks(params) {
  const q = (params.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
  let items = BOOKS.filter((b) => q.every((w) => `${b.title} ${b.author} ${b.description}`.toLowerCase().includes(w)));
  if (params.get('genre')) items = items.filter((b) => b.genre === params.get('genre'));
  if (params.get('language')) items = items.filter((b) => b.language === params.get('language'));
  if (params.get('category')) items = items.filter((b) => b.categories.some((c) => c.id === +params.get('category')));
  if (params.get('series')) items = items.filter((b) => b.series_id === +params.get('series'));
  if (params.get('only_new') === 'true') items = items.filter((b) => b.is_new);
  if (params.get('collapse_series') === 'true' && !q.length) {   // из серии остаётся первый подходящий том
    items = items.filter((b) => !b.series_id || b === items.filter((x) => x.series_id === b.series_id).sort((x, y) => x.volume - y.volume)[0]);
  }
  const sort = { new: 'created_at' }[params.get('sort')] || params.get('sort') || 'title', dir = params.get('order') === 'desc' ? -1 : 1;
  const key = (b) => (typeof b[sort] === 'string' ? b[sort].toLowerCase() : b[sort]);
  items = [...items].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : a.id - b.id) * dir);
  const limit = +params.get('limit') || 12, page = +params.get('page') || 1;
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit, pages: Math.max(1, Math.ceil(items.length / limit)) };
}

export const sessionAt = (secondsFromNow, token = 'tok-1', refresh = 'ref-1') => ({
  access_token: token, refresh_token: refresh, expires_at: Math.floor(Date.now() / 1000) + secondsFromNow,
  user: { id: 'u1', email: 'reader@example.kg' },
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

/** Статический сервер для папки сайта на свободном порту. */
export function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(SITE, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () =>
    resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

/** Настоящий PDF: `pages` страниц, на странице 7 есть слово «zebra» (для проверки поиска). */
export function makePdf(pages = 12) {
  const objs = [null, null];
  const add = (s) => objs.push(s) && objs.length;
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let i = 1; i <= pages; i++) {
    const text = `BT /F1 28 Tf 40 520 Td (Page ${i}) Tj 0 -40 Td /F1 16 Tf (alpha beta gamma${i === 7 ? ' zebra' : ''}) Tj ET 0.2 0.4 0.9 rg 40 40 ${20 * i} 20 re f`;
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/** Счётчик проверок: PASS/FAIL в консоль, ненулевой код выхода при любой ошибке. */
export function reporter(title) {
  let failed = 0, passed = 0;
  console.log(`\n== ${title} ==`);
  return {
    ok(name, cond) { cond ? passed++ : failed++; console.log(cond ? 'PASS' : 'FAIL', name); },
    done() {
      console.log(`${passed} passed, ${failed} failed`);
      if (failed) process.exitCode = 1;
    },
  };
}

const json = (r, status, body, extra = {}) =>
  r.fulfill({ status, headers: { ...cors, ...extra }, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Новая страница с имитацией API (localhost:8000) и Supabase.
 * opts: key — anon-ключ в config.js; signupConfirm — регистрация просит подтвердить почту;
 *       session — сессия, заранее лежащая в localStorage; pdf — файл книги.
 * page.calls — журнал обращений к имитациям; page.errs — ошибки JS на странице.
 */
export async function newPage(browser, origin, { key = 'test-anon-key', signupConfirm = false, session = null, pdf = makePdf(), epub = null, txt = null, viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.errs = []; page.calls = [];
  page.on('pageerror', (e) => page.errs.push(e.message));
  if (session) await ctx.addInitScript((s) => { if (!localStorage.getItem('library-session')) localStorage.setItem('library-session', JSON.stringify(s)); }, session);

  // в репозитории в config.js реальные адреса; тесту нужны свои
  await page.route(origin + '/js/config.js', (r) => r.fulfill({
    status: 200, contentType: 'text/javascript',
    body: `window.API_URL = ${JSON.stringify(API)}; window.SUPABASE_URL = ${JSON.stringify(SB)}; window.SUPABASE_ANON_KEY = ${JSON.stringify(key)};`,
  }));

  await page.route(SB + '/**', async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': '*' } });
    const body = req.method() === 'POST' ? req.postDataJSON?.() ?? {} : {};
    if (u.pathname === '/auth/v1/token') {
      const grant = u.searchParams.get('grant_type');
      page.calls.push(['token', grant]);
      if (grant === 'password') {
        if (body.email === 'reader@example.kg' && body.password === 'secret1')
          return json(r, 200, { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600, user: { id: 'u1', email: body.email } });
        if (body.email === 'new@example.kg') return json(r, 400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
        return json(r, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (grant === 'refresh_token') {
        if (body.refresh_token === 'ref-1') return json(r, 200, { access_token: 'tok-2', refresh_token: 'ref-2', expires_in: 3600, user: { id: 'u1', email: 'reader@example.kg' } });
        return json(r, 400, { error_code: 'refresh_token_not_found', msg: 'bad' });
      }
    }
    if (u.pathname === '/auth/v1/signup') {
      page.calls.push(['signup']);
      if (body.email === 'taken@example.kg') return json(r, 422, { error_code: 'user_already_exists', msg: 'User already registered' });
      if (signupConfirm) return json(r, 200, { id: 'u2', email: body.email, confirmation_sent_at: 'now' });
      return json(r, 200, { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600, user: { id: 'u2', email: body.email } });
    }
    if (u.pathname === '/auth/v1/logout') { page.calls.push(['logout', req.headers()['authorization']]); return r.fulfill({ status: 204, headers: cors }); }
    if (u.pathname === '/auth/v1/recover') { page.calls.push(['recover']); return json(r, 200, {}); }
    if (u.pathname === '/storage/v1/object/public/covers/ok.png') return r.fulfill({ status: 200, headers: cors, contentType: 'image/png', body: PNG });
    if (u.pathname === '/storage/v1/object/sign/books/x.epub') return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/epub+zip' }, body: epub });
    if (u.pathname === '/storage/v1/object/sign/books/x.txt') return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain' }, body: txt });
    if (u.pathname.startsWith('/storage/v1/object/sign/')) {   // «подписанная ссылка» на PDF, с поддержкой Range
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] || '');
      if (!range) return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/pdf', 'accept-ranges': 'bytes' }, body: pdf });
      const s = +range[1], e = range[2] ? Math.min(+range[2], pdf.length - 1) : pdf.length - 1;
      return r.fulfill({ status: 206, headers: { ...cors, 'content-type': 'application/pdf', 'content-range': `bytes ${s}-${e}/${pdf.length}`, 'accept-ranges': 'bytes' }, body: pdf.subarray(s, e + 1) });
    }
    return json(r, 404, {});
  });

  // API: файл — только по токену tok-1 / tok-2 (как и настоящий)
  await page.route(API + '/**', async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': '*' } });
    const auth = req.headers()['authorization'] || '';
    const authed = ['Bearer tok-1', 'Bearer tok-2'].includes(auth);
    page.calls.push(['api', u.pathname, auth]);
    if (u.pathname === '/api/books') return json(r, 200, queryBooks(u.searchParams));
    if (u.pathname === '/api/categories')
      return json(r, 200, CATEGORIES.map((c) => ({ ...c, count: BOOKS.filter((b) => b.categories.some((x) => x.id === c.id)).length })));
    if (u.pathname === `/api/series/${SERIES.id}`)
      return json(r, 200, { ...SERIES, books: BOOKS.filter((b) => b.series_id === SERIES.id).sort((a, b) => a.volume - b.volume) });
    const view = /^\/api\/books\/(\d+)\/view$/.exec(u.pathname);
    if (view && req.method() === 'POST') return json(r, 200, { views: 1 });
    const file = /^\/api\/books\/(4|6)\/file-url$/.exec(u.pathname);
    if (file) {
      const format = file[1] === '4' ? 'epub' : 'txt';
      return authed ? json(r, 200, { url: `${SB}/storage/v1/object/sign/books/x.${format}?token=t`, format, expires_in: 3600 }) : json(r, 401, { detail: 'Войдите в аккаунт' });
    }
    if (u.pathname === '/api/genres' || u.pathname === '/api/languages') {
      const field = u.pathname.endsWith('genres') ? 'genre' : 'language', counts = {};
      BOOKS.forEach((b) => { counts[b[field]] = (counts[b[field]] || 0) + 1; });
      return json(r, 200, Object.entries(counts).map(([name, count]) => ({ name, count })));
    }
    const one = /^\/api\/books\/(\d+)$/.exec(u.pathname);
    if (one) { const b = BOOKS.find((x) => x.id === +one[1]); return b ? json(r, 200, b) : json(r, 404, { detail: 'Книга не найдена' }); }
    if (u.pathname === '/api/books/1/file-url')
      return authed ? json(r, 200, { url: SB + '/storage/v1/object/sign/books/x.pdf?token=t', format: 'pdf', expires_in: 3600 }) : json(r, 401, { detail: 'Войдите в аккаунт' });
    if (u.pathname === '/api/books/1/download')
      return authed ? json(r, 402, { detail: 'Покупка пока недоступна' }) : json(r, 401, { detail: 'Войдите в аккаунт' });
    return json(r, 404, { detail: 'Книга не найдена' });
  });
  return page;
}
