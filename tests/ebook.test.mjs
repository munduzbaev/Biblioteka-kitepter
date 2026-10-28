// Возможности как в E-Book UNIVER PLUS: новинки, категории, серии, просмотры, обложки, чтение EPUB и TXT.
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { newPage, startServer, reporter, sessionAt, BOOKS, PNG } from './harness.mjs';

const JSZip = createRequire(import.meta.url)('../vendor/jszip.min.js');
const { ok, done } = reporter('E-Book: новинки, категории, серии, EPUB, TXT');
const server = await startServer();
const browser = await chromium.launch();
const grid = (p) => p.locator('#grid .card[data-id]');
const settle = (p) => p.waitForFunction(() => !document.querySelector('.card--skeleton'));

// ---------- тестовые книги ----------
const para = (n, extra = '') => Array.from({ length: n }, (_, i) =>
  `<p>Абзац ${i + 1}. ${'Длинный текст для проверки раскладки по страницам. '.repeat(6)}${extra}</p>`).join('');

async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
    <manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
      <item id="img" href="images/pic.png" media-type="image/png"/>
    </manifest>
    <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
    <nav epub:type="toc"><ol><li><a href="text/ch1.xhtml">Глава первая</a></li><li><a href="text/ch2.xhtml#start">Глава вторая</a></li></ol></nav></body></html>`);
  // в главе — скрипт, обработчик onerror и внешняя картинка: ничего из этого не должно сработать
  zip.file('OEBPS/text/ch1.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title>
    <script>window.hacked = 1</script><style>body{display:none}</style></head><body>
    <h1>Глава первая</h1><p>Начало <b>жирное</b> и <i>курсив</i>.</p>
    <img src="../images/pic.png" alt="рисунок" onerror="window.hacked = 2"/>
    <img src="https://evil.example/track.png"/>
    ${para(30)}<blockquote>Цитата</blockquote><ul><li>Пункт списка</li></ul></body></html>`);
  zip.file('OEBPS/text/ch2.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1 id="start">Глава вторая</h1>${para(5, 'zebra')}</body></html>`);
  zip.file('OEBPS/images/pic.png', PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Windows-1251 вручную: в Node нет кодировщика в эту кодировку. */
function cp1251(text) {
  return Buffer.from([...text].map((ch) => {
    const c = ch.codePointAt(0);
    if (c < 128) return c;
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
    return { 'Ё': 0xa8, 'ё': 0xb8, '—': 0x97, '«': 0xab, '»': 0xbb }[ch] ?? 0x3f;
  }));
}
const txt = cp1251(`Глава 1\n\nЖил-был кот.\n\n${'Кот гулял по крыше и смотрел на луну. '.repeat(120)}\n\nГлава 2\n\nКонец истории — «финал».\n`);

// ---------- каталог ----------
let p = await newPage(browser, server.origin);
await p.goto(server.origin + '/'); await p.waitForSelector('#grid .card[data-id]');
await p.waitForSelector('#newShelf:not([hidden]) .card');
ok('витрина «Новинки» на главной: только новые книги', await p.locator('#newList .card').count() === BOOKS.filter((b) => b.is_new).length);
ok('значок NEW у новинок', await p.locator('#newList .badge--new').count() === 2);
await p.fill('#search', 'книга'); await p.waitForTimeout(700); await settle(p);
ok('при поиске витрина скрыта', await p.locator('#newShelf').isHidden());
await p.click('#reset'); await p.waitForSelector('#grid .card[data-id]');

ok('категории: «Все» и по одной кнопке на категорию', (await p.locator('#categories .chip').allTextContents()).map((t) => t.replace(/\s+\d+$/, '')).join('|') === 'Все|Наука|История');
await p.click('#categories [data-category="2"]'); await settle(p);
const inHistory = BOOKS.filter((b) => b.categories.some((c) => c.id === 2) && (!b.series_id || b.volume === 1)).length;
ok('фильтр по категории', await grid(p).count() === inHistory && p.url().includes('category=2'));
ok('выбранная категория отмечена', await p.getAttribute('#categories [data-category="2"]', 'aria-pressed') === 'true');
await p.click('#categories [data-category=""]'); await settle(p);

await p.goto(server.origin + '/?page=2'); await p.waitForSelector('#grid .card[data-id]');   // «Трилогия» по алфавиту — на 2-й странице
ok('серия в каталоге — одна карточка (первый том)', await p.locator('#grid .card[data-id="15"]').count() === 1
  && await p.locator('#grid .card[data-id="16"], #grid .card[data-id="17"]').count() === 0);
ok('у серии подпись «3 тома»', (await p.textContent('#grid .card[data-id="15"] .series')).includes('3 тома'));
await p.click('#grid .card[data-id="15"]'); await p.waitForSelector('#volumes .volume');
ok('окно книги: список томов серии', await p.locator('#volumes .volume').count() === 3 && await p.getAttribute('#volumes [data-volume="15"]', 'aria-current') === 'true');
ok('просмотр засчитан при открытии карточки', p.calls.some((c) => c[1] === '/api/books/15/view'));
await p.click('#volumes [data-volume="16"]'); await p.waitForFunction(() => document.querySelector('#modalBody h2')?.textContent.includes('том 2'));
ok('переход к другому тому в том же окне', (await p.textContent('#modalBody dl')).includes('Трилогия, том 2'));
await p.keyboard.press('Escape');

await p.goto(server.origin + '/'); await p.waitForSelector('#grid .card[data-id]');
await p.selectOption('#sort', 'views'); await settle(p);
const views = (await p.locator('#grid .card .meta span[title="Просмотры"]').allTextContents()).map((t) => +t.replace(/\D/g, ''));
ok('«Популярные»: по убыванию просмотров', p.url().includes('sort=views') && p.url().includes('order=desc') && views[0] >= views[1] && views[1] >= views.at(-1));
await p.selectOption('#sort', 'new'); await settle(p);
ok('«Сначала новые»: первыми новинки', ['2', '3'].includes(await grid(p).first().getAttribute('data-id')));

await p.goto(server.origin + '/'); await p.waitForSelector('#grid .card[data-id]');
await p.waitForFunction(() => [...document.querySelectorAll('.card[data-id="2"] .cover img')].some((i) => i.complete && i.naturalWidth > 0));
ok('обложка из хранилища показывается', true);
await p.waitForFunction(() => !document.querySelector('.card[data-id="3"] .cover img'));
ok('битая обложка заменяется заглушкой с названием', (await p.textContent('#newList .card[data-id="3"] .cover span')) === 'Книга 03');
await p.click('#grid .card[data-id="5"]'); await p.waitForSelector('#modal[open]');
await p.click('#modalBody [data-pick-category="1"]'); await settle(p);
ok('категория в окне книги ведёт в каталог категории', p.url().includes('category=1') && await p.locator('#modal[open]').count() === 0);
ok('каталог: ошибок JS нет', p.errs.length === 0);
await p.context().close();

// ---------- читалка: EPUB ----------
const session = sessionAt(3000);
const open = async (page, id) => {
  await page.goto(`${server.origin}/read.html?id=${id}`);
  await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 30000 });
};
const pageNo = (page) => page.inputValue('#pageInput').then(Number);
const noOverflow = (page) => page.evaluate(() => [...document.querySelectorAll('.tpage__body')].every((b) => b.scrollHeight <= b.clientHeight + 1));

p = await newPage(browser, server.origin, { session, epub: await makeEpub() });
await open(p, 4);
const total = +(await p.textContent('#pageTotal'));
ok('EPUB открылся и разложен по страницам', total > 4 && (await p.textContent('.tpage--title h1')) === 'Книга 04');
ok('текст не вылезает за страницы', await noOverflow(p));
ok('жирный, курсив, цитата и список сохранены', await p.locator('.tpage b', { hasText: 'жирное' }).count() === 1
  && await p.locator('.tpage i', { hasText: 'курсив' }).count() === 1 && await p.locator('.tp-quote').count() === 1 && await p.locator('.tp-li').count() === 1);
ok('картинка из EPUB показана (blob:), внешняя — нет', await p.evaluate(() => {
  const imgs = [...document.querySelectorAll('.tp-img')];
  return imgs.length === 1 && imgs[0].src.startsWith('blob:') && imgs[0].naturalWidth > 0;
}));
ok('скрипты и обработчики из книги не выполняются', await p.evaluate(() => window.hacked === undefined)
  && !p.calls.some((c) => String(c[1]).includes('evil')));
ok('кнопка оглавления видна, в оглавлении 2 главы', await p.isVisible('#tocBtn') && (await p.locator('#tocList button').allTextContents()).map((t) => t.replace(/^\d+/, '')).join('|') === 'Глава первая|Глава вторая');
await p.click('#tocBtn'); await p.click('#tocList li:nth-child(2) button'); await p.waitForTimeout(900);
const ch2 = +(await p.getAttribute('#tocList li:nth-child(2) button', 'data-page')) + 1;
ok('оглавление переходит к главе', Math.abs((await pageNo(p)) - ch2) <= 1 && ch2 > 3);
await p.click('#searchBtn'); await p.fill('#searchInput', 'ZEBRA'); await p.press('#searchInput', 'Enter');
await p.waitForSelector('#searchResults button');
ok('поиск по тексту EPUB', (await p.textContent('#searchStatus')).includes('Найдено') && +(await p.getAttribute('#searchResults button', 'data-page')) + 1 >= ch2);
await p.click('#next');
ok('EPUB: ошибок JS нет', p.errs.length === 0);
await p.context().close();

// ---------- читалка: TXT в Windows-1251, телефон ----------
p = await newPage(browser, server.origin, { session, txt, viewport: { width: 390, height: 780 } });
await open(p, 6);
ok('TXT в Windows-1251 раскодирован', (await p.textContent('#book')).includes('Жил-был кот.') && (await p.textContent('#book')).includes('«финал»'));
ok('TXT: главы найдены по «Глава N»', (await p.locator('#tocList button').count()) === 2);
ok('TXT: несколько страниц, текст не вылезает', +(await p.textContent('#pageTotal')) > 3 && await noOverflow(p));
ok('телефон: одна страница, без горизонтального скролла', await p.evaluate(() => {
  const r = document.getElementById('book').getBoundingClientRect();
  return r.width / r.height < 1 && document.documentElement.scrollWidth <= innerWidth;
}));
const scale = async () => +(await p.evaluate(() => getComputedStyle(document.getElementById('book')).getPropertyValue('--tscale')));
const before = await scale();
await p.click('#zoomIn');
ok('зум увеличивает текстовую страницу', (await scale()) > before);
ok('TXT: ошибок JS нет', p.errs.length === 0);
await p.context().close();

await browser.close(); server.close();
done();
