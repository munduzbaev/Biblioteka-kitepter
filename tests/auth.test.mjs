// Вход, регистрация, выход, обновление токена, защита чтения и покупки. Supabase Auth — имитация.
import { chromium } from 'playwright';
import { newPage, startServer, reporter, sessionAt, makePdf } from './harness.mjs';

const { ok, done } = reporter('Вход и доступ');
const server = await startServer();
const browser = await chromium.launch();
const O = server.origin;
const pdf = makePdf(12);
const fill = async (p, email, pass) => { await p.fill('#email', email); await p.fill('#password', pass); await p.click('#submit'); };
const msg = (p, text) => p.waitForFunction((t) => document.getElementById('msg').textContent.includes(t), text);
const stored = (p) => p.evaluate(() => localStorage.getItem('library-session'));

// ---------- гость ----------
let p = await newPage(browser, O, { pdf });
await p.goto(O + '/?q=' + encodeURIComponent('Тестовая')); await p.waitForSelector('.card[data-id="1"]');
ok('шапка гостя: «Войти», без «Выйти»', await p.isVisible('#loginLink') && !(await p.isVisible('#logoutBtn')));
await p.click('.card[data-id="1"]'); await p.waitForSelector('#modal[open]');
ok('гость: «Войти, чтобы читать» ведёт на вход с возвратом', (await p.textContent('.actions a')).includes('Войти, чтобы читать') && decodeURIComponent(await p.getAttribute('.actions a', 'href')) === 'login.html?next=read.html?id=1');
ok('цена видна в кнопке покупки', (await p.textContent('#buyBtn')).includes('350'));
await p.click('#buyBtn'); await p.waitForURL('**/login.html?next=*');
ok('гость: «Купить» ведёт на вход', true);
await p.goto(O + '/read.html?id=1&page=3'); await p.waitForURL('**/login.html**');
ok('гость: читалка перекидывает на вход и помнит страницу', decodeURIComponent(p.url()).includes('next=read.html?id=1&page=3'));
ok('гость: файл не запрашивался', !p.calls.some((c) => c[1] === '/api/books/1/file-url'));

// ---------- вход ----------
await p.goto(O + '/login.html?next=read.html%3Fid%3D1');
await fill(p, 'reader@example.kg', 'wrong'); await msg(p, 'Неверная');
ok('неверный пароль: понятная ошибка', true);
await fill(p, 'new@example.kg', 'secret1'); await msg(p, 'не подтверждена');
ok('неподтверждённая почта: понятная ошибка', true);
await fill(p, 'reader@example.kg', 'secret1');
await p.waitForURL('**/read.html?id=1');
await p.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 20000 });
ok('вошли: вернулись в читалку, книга открылась', (await p.textContent('#rTitle')) === 'Тестовая книга' && (await p.textContent('#pageTotal')) === '12');
ok('файл запрошен с токеном читателя', p.calls.some((c) => c[1] === '/api/books/1/file-url' && c[2] === 'Bearer tok-1'));
ok('сессия сохранена в браузере', !!JSON.parse(await stored(p)).access_token);

// ---------- вошедший ----------
await p.goto(O + '/?q=' + encodeURIComponent('Тестовая')); await p.waitForSelector('.card[data-id="1"]');
ok('шапка: почта и «Выйти»', (await p.textContent('#authEmail')) === 'reader@example.kg' && await p.isVisible('#logoutBtn') && !(await p.isVisible('#loginLink')));
await p.click('.card[data-id="1"]'); await p.waitForSelector('#modal[open]');
ok('вошедший: «Читать онлайн» ведёт в читалку', (await p.textContent('.actions a')).includes('Читать онлайн') && (await p.getAttribute('.actions a', 'href')) === 'read.html?id=1');
await p.click('#buyBtn'); await p.waitForFunction(() => document.getElementById('buyMsg').textContent.length > 0);
ok('покупка: «Покупка пока недоступна» (Mbank позже)', (await p.textContent('#buyMsg')).includes('Покупка пока недоступна'));
await p.keyboard.press('Escape');
await p.click('#logoutBtn'); await p.waitForTimeout(300);
ok('выход: сессия стёрта, сервер уведомлён', (await stored(p)) === null && p.calls.some((c) => c[0] === 'logout' && c[1] === 'Bearer tok-1'));
ok('после выхода снова «Войти»', await p.isVisible('#loginLink'));
await p.goto(O + '/read.html?id=1'); await p.waitForURL('**/login.html**');
ok('после выхода читалка закрыта', true);

// ---------- токен ----------
const setSession = (s) => p.evaluate((x) => localStorage.setItem('library-session', JSON.stringify(x)), s);
await setSession(sessionAt(-10, 'old', 'ref-1')); p.calls.length = 0;
await p.goto(O + '/read.html?id=1'); await p.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 20000 });
ok('просроченный токен обновился (refresh), книга открылась', p.calls.some((c) => c[0] === 'token' && c[1] === 'refresh_token') && p.calls.some((c) => c[2] === 'Bearer tok-2'));
await setSession(sessionAt(-10, 'old', 'dead'));
await p.goto(O + '/read.html?id=1'); await p.waitForURL('**/login.html**');
ok('refresh не удался: на вход, сессия стёрта', (await stored(p)) === null);
await setSession(sessionAt(3000, 'revoked', 'r'));
await p.goto(O + '/read.html?id=1'); await p.waitForURL('**/login.html**'); await p.waitForTimeout(800);
ok('токен отозван (401): на вход, сессия стёрта, без цикла переходов', p.url().includes('login.html') && (await stored(p)) === null);

// ---------- безопасность адреса возврата ----------
for (const evil of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)']) {
  await p.evaluate(() => localStorage.clear());
  await p.goto(O + '/login.html?next=' + encodeURIComponent(evil));
  await fill(p, 'reader@example.kg', 'secret1');
  await p.waitForURL((u) => u.origin === O && !u.pathname.includes('login'));
  ok('чужой адрес возврата отброшен: ' + evil, new URL(p.url()).origin === O);
}
await p.evaluate(() => localStorage.clear());
await p.goto(O + '/login.html'); await fill(p, 'reader@example.kg', 'secret1');
await p.waitForURL((u) => !u.pathname.includes('login'));
ok('вход без адреса возврата ведёт на главную, а не на себя', new URL(p.url()).pathname === '/');

// ---------- регистрация ----------
await p.evaluate(() => localStorage.clear());
await p.goto(O + '/login.html'); await p.click('#tabSignup');
ok('режим регистрации: кнопка, нет «Забыли пароль»', (await p.textContent('#submit')) === 'Зарегистрироваться' && !(await p.isVisible('#forgot')));
await fill(p, 'a@example.kg', '123');
ok('короткий пароль отклонён без обращения к серверу', (await p.textContent('#msg')).includes('не короче 6') && !p.calls.some((c) => c[0] === 'signup'));
await fill(p, 'taken@example.kg', 'secret1'); await msg(p, 'уже зарегистрирована');
ok('занятая почта: понятная ошибка', true);
await fill(p, 'brand@example.kg', 'secret1'); await p.waitForURL((u) => !u.pathname.includes('login'));
ok('регистрация со входом (без подтверждения почты)', true);
ok('ошибок JS нет', p.errs.length === 0);
await p.context().close();

p = await newPage(browser, O, { signupConfirm: true });
await p.goto(O + '/login.html?mode=signup'); await fill(p, 'brand@example.kg', 'secret1'); await msg(p, 'письмо');
ok('регистрация с подтверждением: просит открыть письмо', p.url().includes('login.html') && (await p.textContent('#submit')) === 'Войти');
await p.fill('#email', 'reader@example.kg'); await p.click('#forgot'); await msg(p, 'ссылку для сброса');
ok('«Забыли пароль» отправляет запрос', p.calls.some((c) => c[0] === 'recover'));
await p.context().close();

p = await newPage(browser, O, { key: 'YOUR-ANON-PUBLIC-KEY' });
await p.goto(O + '/login.html'); await p.waitForTimeout(400);
ok('ключ не настроен: понятное сообщение администратору', (await p.textContent('#msg')).includes('SUPABASE_ANON_KEY'));
await fill(p, 'reader@example.kg', 'secret1'); await p.waitForTimeout(400);
ok('ключ не настроен: обращений к серверу входа нет', !p.calls.some((c) => c[0] === 'token'));

await browser.close(); server.close();
done();
