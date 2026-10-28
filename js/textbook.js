"use strict";

/*
 * EPUB и TXT для читалки — как в UNIVER PLUS: книга превращается в простые блоки
 * (заголовок, абзац, цитата, пункт списка, картинка) с оглавлением, а затем раскладывается по страницам.
 *
 * Безопасность: разметку из книги в страницу не вставляем. Читаем из неё только текст, жирность/курсив
 * и картинки, а элементы создаём сами (textContent), поэтому скрипты, стили и ссылки из EPUB не работают.
 * Картинки показываются как blob: из самого архива — внешних запросов книга сделать не может.
 */
const TextBook = (() => {
  // логический размер страницы: раскладка не зависит от экрана, страница масштабируется целиком (--tscale)
  const PAGE_W = 400, PAGE_H = 588;
  const PART_SIZE = 25000; // знаков в части TXT, если глав в файле нет
  const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
  const BLOCK_TAGS = new Set(["p", "div", "section", "article", "header", "footer", "aside", "main", "li", "blockquote",
    "tr", "ul", "ol", "table", "dl", "dt", "dd", "figure", "figcaption", "pre", "center", "body"]);
  const SKIP_TAGS = new Set(["script", "style", "head", "title", "noscript", "iframe", "object", "embed", "audio", "video", "math", "form", "input", "button", "select", "textarea"]);
  const TXT_HEADING = /^(глава|часть|пролог|эпилог|предисловие|введение|заключение|интерлюдия|chapter|part|prologue|epilogue)(?=$|[\s.:\-–—\d])/i;

  const tags = (node, name) => [...node.getElementsByTagNameNS("*", name)];

  // ---------- TXT ----------
  function decodeText(bytes) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return new TextDecoder("windows-1251").decode(bytes); }
  }

  function openTxt(bytes) {
    const lines = decodeText(bytes).replace(/\r\n?/g, "\n").split("\n");
    const nonEmpty = lines.filter((l) => l.trim()).length;
    const blank = lines.length - nonEmpty;
    // абзацы разделены пустыми строками (текст переносится вручную) или каждая строка — абзац
    const byBlankLines = blank >= nonEmpty * 0.15;
    const chapters = [];
    let current = { title: "", blocks: [] }, buffer = [];
    const flush = () => {
      const text = buffer.join(" ").replace(/\s+/g, " ").trim();
      if (text) current.blocks.push({ type: "p", runs: [{ t: text }] });
      buffer = [];
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /^[=\-_*~#\s]{3,}$/.test(line)) { flush(); continue; }
      if (line.length < 80 && TXT_HEADING.test(line)) {
        flush();
        if (current.blocks.length || current.title) chapters.push(current);
        current = { title: line, blocks: [{ type: "h", level: 2, runs: [{ t: line }] }] };
        continue;
      }
      buffer.push(line);
      if (!byBlankLines) flush();
    }
    flush();
    if (current.blocks.length) chapters.push(current);
    if (chapters.length > 1 || chapters[0]?.title) return { chapters };

    // глав нет: делим на части только для оглавления, без разрыва страниц
    const blocks = chapters[0]?.blocks || [];
    const parts = [];
    let size = PART_SIZE;
    for (const block of blocks) {
      if (size >= PART_SIZE) { parts.push({ title: `Часть ${parts.length + 1}`, blocks: [], flow: parts.length > 0 }); size = 0; }
      parts.at(-1).blocks.push(block);
      size += block.runs[0].t.length;
    }
    return { chapters: parts.length > 1 ? parts : parts.map((p) => ({ ...p, title: "" })) };
  }

  // ---------- EPUB ----------
  function resolve(base, href) {
    const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
    const parts = clean.startsWith("/") ? [] : base.split("/").slice(0, -1);
    for (const seg of clean.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg && seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  }

  function parseXml(text, html = false) {
    const parser = new DOMParser();
    if (!html) {
      const doc = parser.parseFromString(text, "application/xhtml+xml");
      if (!doc.getElementsByTagName("parsererror").length) return doc;
    }
    return parser.parseFromString(text, "text/html"); // запасной разбор «грязного» XHTML
  }

  async function readFile(zip, path) {
    const file = zip.file(path);
    if (!file) throw new Error(`В EPUB нет файла ${path}`);
    return file.async("string");
  }

  async function imageUrl(zip, path, cache) {
    if (cache.has(path)) return cache.get(path);
    const type = IMAGE_TYPES[path.split(".").pop().toLowerCase()];
    const file = type && zip.file(path);
    const url = file ? URL.createObjectURL(new Blob([await file.async("uint8array")], { type })) : null;
    cache.set(path, url);
    return url;
  }

  /** Блоки одной главы XHTML. */
  async function chapterBlocks(doc, path, zip, images) {
    const blocks = [];
    let cur = null;
    const flush = () => {
      if (cur && cur.runs.some((r) => r.t.trim())) {
        cur.runs[0].t = cur.runs[0].t.trimStart();
        blocks.push(cur);
      }
      cur = null;
    };
    const addText = (text, style, type) => {
      text = text.replace(/\s+/g, " ");
      if (!text || (!cur && !text.trim())) return;
      cur ||= { type, runs: [] };
      cur.runs.push({ t: text, b: style.b, i: style.i });
    };
    const walk = async (node, style, type) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { addText(child.nodeValue, style, type); continue; }
        if (child.nodeType !== 1) continue;
        const tag = child.localName.toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;
        if (tag === "img" || tag === "image") {
          const src = child.getAttribute("src") || child.getAttribute("xlink:href") || child.getAttribute("href");
          const url = src && await imageUrl(zip, resolve(path, src), images);
          if (url) { flush(); blocks.push({ type: "img", src: url }); }
          continue;
        }
        if (tag === "br") { flush(); continue; }
        if (/^h[1-6]$/.test(tag)) {
          flush();
          await walk(child, { ...style, b: true }, "h");
          if (cur) cur.level = Math.min(4, Math.max(2, +tag[1]));
          flush();
          continue;
        }
        if (BLOCK_TAGS.has(tag)) {
          flush();
          const inner = tag === "li" ? "li" : tag === "blockquote" ? "quote" : type === "h" ? "h" : type === "quote" ? "quote" : "p";
          await walk(child, style, inner);
          flush();
          continue;
        }
        const b = style.b || tag === "b" || tag === "strong";
        const i = style.i || tag === "i" || tag === "em" || tag === "cite";
        await walk(child, { b, i }, type);
      }
    };
    const body = doc.body || tags(doc, "body")[0] || doc.documentElement;
    await walk(body, { b: false, i: false }, "p");
    flush();
    return blocks;
  }

  function navToc(doc, navPath) {
    const nav = tags(doc, "nav").find((n) => (n.getAttribute("epub:type") || n.getAttribute("type") || "").includes("toc"))
      || tags(doc, "nav")[0];
    return nav ? tags(nav, "a").map((a) => ({ title: a.textContent.replace(/\s+/g, " ").trim(), path: resolve(navPath, a.getAttribute("href") || "") })) : [];
  }

  function ncxToc(doc, ncxPath) {
    return tags(doc, "navPoint").map((p) => ({
      title: (tags(p, "text")[0]?.textContent || "").replace(/\s+/g, " ").trim(),
      path: resolve(ncxPath, tags(p, "content")[0]?.getAttribute("src") || ""),
    }));
  }

  async function openEpub(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const container = parseXml(await readFile(zip, "META-INF/container.xml"));
    const opfPath = tags(container, "rootfile")[0]?.getAttribute("full-path");
    if (!opfPath) throw new Error("В EPUB не найдено описание книги");
    const opf = parseXml(await readFile(zip, opfPath));
    const manifest = new Map(tags(opf, "item").map((it) => [it.getAttribute("id"), {
      path: resolve(opfPath, it.getAttribute("href") || ""), type: it.getAttribute("media-type") || "", props: it.getAttribute("properties") || "",
    }]));
    const spine = tags(opf, "itemref").map((r) => manifest.get(r.getAttribute("idref"))).filter((it) => it && /html/.test(it.type));
    if (!spine.length) throw new Error("В EPUB нет глав");

    let toc = [];
    const nav = [...manifest.values()].find((it) => it.props.split(/\s+/).includes("nav"));
    const ncxId = tags(opf, "spine")[0]?.getAttribute("toc");
    const ncx = manifest.get(ncxId) || [...manifest.values()].find((it) => it.type === "application/x-dtbncx+xml");
    try {
      if (nav) toc = navToc(parseXml(await readFile(zip, nav.path)), nav.path);
      if (!toc.length && ncx) toc = ncxToc(parseXml(await readFile(zip, ncx.path)), ncx.path);
    } catch { toc = []; }   // без оглавления книга всё равно читается

    const images = new Map(), chapters = [];
    for (const [index, item] of spine.entries()) {
      const text = await readFile(zip, item.path).catch(() => "");
      const blocks = text ? await chapterBlocks(parseXml(text, !/xhtml|xml/.test(item.type)), item.path, zip, images) : [];
      const title = toc.find((t) => t.path === item.path)?.title || "";
      if (blocks.length) chapters.push({ title: title || (toc.length ? "" : `Глава ${index + 1}`), blocks });
    }
    return { chapters, images: [...images.values()].filter(Boolean) };
  }

  async function open(bytes, format) {
    return format === "epub" ? openEpub(bytes) : openTxt(bytes);
  }

  // ---------- раскладка по страницам ----------
  function blockElement(block, cont) {
    if (block.type === "h") { const h = document.createElement(`h${block.level || 2}`); h.className = "tp-h"; return h; }
    const p = document.createElement("p");
    if (block.type === "quote") p.className = "tp-quote";
    if (block.type === "li") p.className = "tp-li";
    if (cont) p.classList.add("tp-cont");   // продолжение абзаца с прошлой страницы: без красной строки и маркера
    return p;
  }

  /** Слова с пробелом после и стилем — так абзац можно разрезать между страницами. */
  function tokenize(block) {
    const out = [];
    for (const run of block.runs) for (const t of run.t.split(/(?<=\s)/)) if (t) out.push({ t, b: run.b, i: run.i });
    return out;
  }

  function render(block, tokens, from, to, cont) {
    const el = blockElement(block, cont);
    let i = from;
    while (i < to) {
      const { b, i: it } = tokens[i];
      let text = "";
      while (i < to && !!tokens[i].b === !!b && !!tokens[i].i === !!it) text += tokens[i++].t;
      let node = document.createTextNode(text);
      if (it) { const em = document.createElement("i"); em.append(node); node = em; }
      if (b && block.type !== "h") { const strong = document.createElement("b"); strong.append(node); node = strong; }
      el.append(node);
    }
    return el;
  }

  function newPageShell(cls = "") {
    const page = document.createElement("div");
    page.className = `tpage ${cls}`.trim();
    const body = document.createElement("div");
    body.className = "tpage__body";
    page.append(body);
    return { page, body };
  }

  /**
   * Раскладывает книгу по страницам. Возвращает { pages: [div.tpage], toc: [{title, page}], texts: [string] }.
   * onProgress(доля 0..1) — для «Подготовка страниц… N%».
   */
  async function paginate(book, meta, onProgress = () => {}) {
    const measure = newPageShell("tpage--measure");
    document.body.append(measure.page);
    const body = measure.body;
    const fits = () => body.scrollHeight <= body.clientHeight + 1;
    const pages = [], toc = [];

    // титульная страница
    const title = newPageShell("tpage--title");
    const h = document.createElement("h1"); h.textContent = meta.title;
    const a = document.createElement("p"); a.textContent = meta.author;
    title.body.append(h, a);
    pages.push(title.page);

    const closePage = () => {
      if (!body.childNodes.length) return;
      // заголовок не оставляем последней строкой страницы — переносим его на следующую
      const last = body.lastElementChild;
      const carry = last?.classList.contains("tp-h") && body.children.length > 1 ? last : null;
      if (carry) carry.remove();
      const { page, body: target } = newPageShell();
      target.append(...body.childNodes);
      pages.push(page);
      if (carry) body.append(carry);
    };

    const total = book.chapters.reduce((n, c) => n + c.blocks.length, 0) || 1;
    let done = 0;
    for (const chapter of book.chapters) {
      if (!chapter.flow) closePage();   // глава — с новой страницы
      if (chapter.title) toc.push({ title: chapter.title, page: pages.length });   // индекс страницы, которая сейчас заполняется
      for (const block of chapter.blocks) {
        if (++done % 40 === 0) { onProgress(done / total); await new Promise((r) => setTimeout(r)); }
        if (block.type === "img") {
          const img = document.createElement("img");
          img.className = "tp-img"; img.alt = ""; img.src = block.src;
          await img.decode().catch(() => {});
          if (!img.naturalWidth) continue;
          body.append(img);
          if (!fits() && body.children.length > 1) { img.remove(); closePage(); body.append(img); }
          continue;
        }
        const tokens = tokenize(block);
        let from = 0;
        while (from < tokens.length) {
          const el = render(block, tokens, from, tokens.length, from > 0);
          body.append(el);
          if (fits()) break;
          el.remove();
          // сколько слов помещается на эту страницу: двоичный поиск
          let lo = from, hi = tokens.length - 1;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            const part = render(block, tokens, from, mid, from > 0);
            body.append(part);
            const ok = fits();
            part.remove();
            if (ok) lo = mid; else hi = mid - 1;
          }
          if (block.type === "h" && lo < tokens.length && body.childNodes.length) { closePage(); continue; }
          if (lo === from) {
            if (body.childNodes.length) { closePage(); continue; }
            lo = from + 1;   // даже одно слово не влезает на пустую страницу — ставим как есть
          }
          const head = render(block, tokens, from, lo, from > 0);
          head.classList.add("tp-split");   // абзац продолжится на следующей странице: последнюю строку растягиваем
          body.append(head);
          closePage();
          from = lo;
        }
      }
    }
    closePage();
    measure.page.remove();
    pages.forEach((page, i) => {
      if (i === 0) return;
      const num = document.createElement("div");
      num.className = "tpage__num"; num.textContent = i + 1;
      page.append(num);
    });
    onProgress(1);
    return { pages, toc, texts: pages.map((p) => p.querySelector(".tpage__body").textContent.replace(/\s+/g, " ").trim()) };
  }

  return { open, paginate, PAGE_W, PAGE_H };
})();
