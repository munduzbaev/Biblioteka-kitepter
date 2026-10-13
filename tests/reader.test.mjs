// Читалка (read.html): листание, переход, зум, поиск, телефон, ошибки. Нужен вошедший читатель.
import { chromium } from 'playwright';
import { newPage, startServer, reporter, sessionAt, makePdf } from './harness.mjs';

const { ok, done } = reporter('Читалка');
const server = await startServer();
const browser = await chromium.launch();
const pdf = makePdf(12);
const session = sessionAt(3000);
const open = async (p, query = 'id=1') => {
  await p.goto(`${server.origin}/read.html?${query}`);
  await p.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 20000 });
};
const pageNo = (p) => p.inputValue('#pageInput').then(Number);

let p = await newPage(browser, server.origin, { session, pdf });
await open(p);
ok('книга открылась: заголовок и 12 страниц', (await p.textContent('#rTitle')) === 'Тестовая книга' && (await p.textContent('#pageTotal')) === '12');
await p.waitForFunction(() => document.querySelector('.rpagebox canvas').width > 0, null, { timeout: 15000 });
ok('страница 1 отрисована', true);
ok('компьютер: разворот (книга шире высоты)', await p.evaluate(() => { const r = document.getElementById('book').getBoundingClientRect(); return r.width / r.height > 1.1; }));
ok('файл запрошен с токеном читателя', p.calls.some((c) => c[1] === '/api/books/1/file-url' && c[2] === 'Bearer tok-1'));

await p.click('#next'); await p.waitForTimeout(1300);
ok('«вперёд» листает', (await pageNo(p)) > 1);
await p.fill('#pageInput', '8'); await p.press('#pageInput', 'Enter'); await p.waitForTimeout(800);
ok('переход на стр. 8, ?page=8 в адресе', (await pageNo(p)) === 8 && p.url().includes('page=8'));
await p.waitForFunction(() => document.querySelectorAll('.rpagebox canvas')[7].width > 0, null, { timeout: 15000 });
ok('страница 8 отрисована лениво', true);
await p.fill('#pageInput', '12'); await p.press('#pageInput', 'Enter'); await p.waitForTimeout(600);
ok('далёкие страницы освобождают память (стр. 1 при чтении стр. 12)', await p.evaluate(() => document.querySelectorAll('.rpagebox canvas')[0].width === 0));

const zoomerWidth = () => p.evaluate(() => document.getElementById('zoomer').getBoundingClientRect().width);
const z0 = await zoomerWidth();
await p.click('#zoomIn'); await p.click('#zoomIn'); await p.waitForTimeout(500);
ok('зум +50%', Math.abs((await zoomerWidth()) / z0 - 1.5) < 0.05 && (await p.textContent('#zoomVal')) === '150%');
for (let i = 0; i < 6; i++) await p.click('#zoomOut', { force: true });
ok('зум не меньше 100%', (await p.textContent('#zoomVal')) === '100%' && await p.isDisabled('#zoomOut'));

await p.click('#searchBtn'); await p.fill('#searchInput', 'ZEBRA'); await p.press('#searchInput', 'Enter');
await p.waitForSelector('#searchResults button', { timeout: 15000 });
ok('поиск нашёл стр. 7 без учёта регистра', await p.locator('#searchResults button').count() === 1 && (await p.textContent('#searchResults button')).includes('стр. 7'));
await p.click('#searchResults button'); await p.waitForTimeout(600);
ok('клик по результату открывает стр. 7', (await pageNo(p)) === 7);
await p.fill('#searchInput', 'nonexistentword'); await p.press('#searchInput', 'Enter'); await p.waitForTimeout(500);
ok('поиск без результатов', (await p.textContent('#searchStatus')).includes('Ничего'));
await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement.blur());
await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(1200);
ok('стрелка влево листает назад', (await pageNo(p)) < 7);
await p.click('#soundBtn');
ok('звук включается', (await p.getAttribute('#soundBtn', 'aria-pressed')) === 'true');
ok('нет кнопок скачать / печать / поделиться', await p.locator('a[download], [aria-label*="качать" i], [aria-label*="ечат" i], [aria-label*="елиться" i]').count() === 0);
ok('ошибок JS нет', p.errs.length === 0);
await p.context().close();

// телефон: одна страница, зум не переключает режим
p = await newPage(browser, server.origin, { session, pdf, viewport: { width: 390, height: 780 } });
await open(p, 'id=1&page=3'); await p.waitForTimeout(1500);
const bookRatio = () => p.evaluate(() => { const r = document.getElementById('book').getBoundingClientRect(); return r.width / r.height; });
ok('телефон: одна страница, без горизонтального скролла', (await bookRatio()) < 1 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
ok('телефон: старт со ?page=3', (await pageNo(p)) === 3);
await p.click('#zoomIn'); await p.click('#zoomIn'); await p.click('#zoomIn'); await p.waitForTimeout(800);
ok('телефон: при зуме остаётся одна страница', (await bookRatio()) < 1 && (await p.textContent('#zoomVal')) === '175%');
await p.click('#next'); await p.waitForTimeout(1200);
ok('телефон: «вперёд» на зуме листает', (await pageNo(p)) === 4);
await p.context().close();

// ошибки
p = await newPage(browser, server.origin, { session, pdf });
await p.goto(`${server.origin}/read.html?id=3`); await p.waitForSelector('#loading:not([hidden]) a');   // у книги 3 файла нет
ok('книга без файла: понятное сообщение', (await p.textContent('#loading')).includes('файл ещё не загружен'));
await p.goto(`${server.origin}/read.html?id=999`); await p.waitForSelector('#loading:not([hidden]) a');
ok('несуществующая книга', (await p.textContent('#loading')).includes('не найдена'));
await p.goto(`${server.origin}/read.html`); await p.waitForSelector('#loading:not([hidden]) a');
ok('адрес без id', (await p.textContent('#loading')).includes('Не указана'));
await p.context().close();

await browser.close(); server.close();
done();
