// Каталог: поиск, фильтры, сортировка, пагинация, адрес страницы, окно книги, ошибки API.
import { chromium } from 'playwright';
import { newPage, startServer, reporter, BOOKS, sessionAt } from './harness.mjs';

const { ok, done } = reporter('Каталог');
const server = await startServer();
const browser = await chromium.launch();
const cards = (p) => p.locator('.card[data-id]');
const settle = (p) => p.waitForFunction(() => !document.querySelector('.card--skeleton'));

let p = await newPage(browser, server.origin);
await p.goto(server.origin + '/'); await p.waitForSelector('.card[data-id]');
ok('первая страница: 12 карточек из 14', await cards(p).count() === 12 && (await p.textContent('#status')).includes('14'));
ok('фильтры жанра и языка загружены', await p.locator('#genre option').count() === 4 && await p.locator('#language option').count() === 3);
ok('пагинация: 2 страницы', await p.locator('.pager [data-page]').count() >= 3);

await p.fill('#search', 'алхимик'); await p.waitForTimeout(700); await settle(p);
ok('поиск без учёта регистра', await cards(p).count() === 1 && (await p.textContent('.card h3')) === 'Алхимик');
await p.fill('#search', 'абракадабра'); await p.waitForTimeout(700); await settle(p);
ok('ничего не найдено — сообщение', (await p.textContent('#status')).includes('Ничего не найдено') && await cards(p).count() === 0);
await p.click('#reset'); await p.waitForSelector('.card[data-id]');
ok('«Сбросить» возвращает каталог', await cards(p).count() === 12 && await p.inputValue('#search') === '');

await p.selectOption('#genre', 'Фантастика'); await settle(p);
ok('фильтр по жанру', await cards(p).count() === 6 && (await p.locator('.card .tag:not(.tag--pdf)').allTextContents()).every((t) => t === 'Фантастика'));
await p.selectOption('#language', 'Русский'); await settle(p);
ok('жанр + язык вместе', (await p.textContent('#status')).includes('Найдено книг: 2'));
await p.click('#reset'); await p.waitForSelector('.card[data-id]');

await p.selectOption('#sort', 'year'); await settle(p);
const years = async () => (await p.locator('.card .meta span:last-child').allTextContents()).map(Number);
let ys = await years();
ok('сортировка по году по возрастанию', JSON.stringify(ys) === JSON.stringify([...ys].sort((a, b) => a - b)) && ys[0] === 1992);
await p.click('#order'); await settle(p); ys = await years();
ok('кнопка направления: по убыванию', ys[0] > ys[1] && ys[0] === 2004);
await p.selectOption('#sort', 'rating'); await settle(p);
ok('рейтинг по умолчанию — по убыванию', (await p.textContent('#order')).includes('убыванию'));
ok('состояние в адресе', ['sort=rating', 'order=desc'].every((x) => p.url().includes(x)));

await p.click('#reset'); await p.waitForSelector('.card[data-id]');
await p.click('.pager [data-page="2"]'); await settle(p);
ok('страница 2: 2 карточки, ?page=2 в адресе', await cards(p).count() === 2 && p.url().includes('page=2'));
await p.reload(); await p.waitForSelector('.card[data-id]');
ok('после перезагрузки остаёмся на странице 2', await p.locator('.pager .btn--active').textContent() === '2');
await p.goto(server.origin + '/?genre=Классика&sort=year&order=desc'); await p.waitForSelector('.card[data-id]'); await p.waitForTimeout(500);
ok('фильтры из адреса применяются и показываются в селектах', await p.inputValue('#genre') === 'Классика' && await p.inputValue('#sort') === 'year');

// окно книги
await p.goto(server.origin + '/'); await p.waitForSelector('.card[data-id]');
await p.click('.card[data-id="2"]'); await p.waitForSelector('#modal[open]');
ok('окно книги: описание и характеристики', (await p.textContent('#modalBody')).includes('Описание 2') && (await p.textContent('#modalBody')).includes('Жанр'));
await p.keyboard.press('Escape');
ok('Esc закрывает окно', await p.locator('#modal[open]').count() === 0);
await p.click('.card[data-id="3"]'); await p.waitForSelector('#modal[open]');
ok('книга без файла: пояснение, без кнопок', (await p.textContent('.nofile')).includes('не загружен') && await p.locator('.actions').count() === 0);
await p.keyboard.press('Escape');
ok('значок PDF только у книг с файлом', await p.locator('.card .tag--pdf').count() ===
  [...BOOKS].sort((a, b) => a.title.localeCompare(b.title, 'ru')).slice(0, 12).filter((b) => b.has_file).length);

// тема и телефон
const before = await p.evaluate(() => document.documentElement.dataset.theme || '');
await p.click('#themeToggle');
ok('тема переключается', (await p.evaluate(() => document.documentElement.dataset.theme)) !== before);
await p.setViewportSize({ width: 375, height: 800 }); await p.goto(server.origin + '/'); await p.waitForSelector('.card[data-id]');
ok('телефон: без горизонтального скролла, 2 колонки', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length === 2));
await p.context().close();

// ошибка API
p = await newPage(browser, server.origin);
await p.route('http://localhost:8000/api/books?**', (r) => r.abort());
await p.goto(server.origin + '/'); await p.waitForSelector('#retry');
ok('API недоступен: сообщение и «Повторить»', (await p.textContent('.error')).includes('Не удалось загрузить'));

ok('ошибок JS на страницах нет', p.errs.length === 0);
await browser.close(); server.close();
done();
