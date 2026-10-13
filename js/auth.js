"use strict";

// Вход читателей через Supabase Auth (REST). Сессия хранится в localStorage этого браузера.
const Auth = (() => {
  const KEY = "library-session";
  const REFRESH_BEFORE = 60;   // секунд до истечения, когда токен обновляем заранее
  let memory = null;           // запасной вариант, если localStorage недоступен (приватный режим)

  class AuthError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || memory; } catch { return memory; }
  };
  const write = (session) => {
    memory = session;
    try { session ? localStorage.setItem(KEY, JSON.stringify(session)) : localStorage.removeItem(KEY); } catch { /* ignore */ }
  };

  const configured = () => !!window.SUPABASE_ANON_KEY && !String(window.SUPABASE_ANON_KEY).startsWith("YOUR");

  async function call(path, { body, token } = {}) {
    if (!configured()) throw new AuthError("not_configured", "Вход не настроен: впишите SUPABASE_ANON_KEY в js/config.js");
    let res;
    try {
      res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AuthError("network", "Нет связи с сервером входа");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AuthError(data.error_code || data.code || data.error || String(res.status), data.msg || data.message || data.error_description || "");
    return data;
  }

  const toSession = (d) => ({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user: { id: d.user?.id, email: d.user?.email },
  });

  // Понятные тексты вместо ответов сервера
  function errorText(err) {
    const code = err.code || "";
    const map = {
      invalid_credentials: "Неверная почта или пароль",
      email_not_confirmed: "Почта не подтверждена. Откройте письмо, которое мы отправили при регистрации",
      user_already_exists: "Эта почта уже зарегистрирована. Попробуйте войти",
      weak_password: "Пароль слишком простой: используйте не меньше 6 символов",
      over_request_rate_limit: "Слишком много попыток. Подождите немного и повторите",
      over_email_send_rate_limit: "Слишком много писем. Подождите немного и повторите",
      validation_failed: "Проверьте правильность почты",
      email_address_invalid: "Проверьте правильность почты",
      signup_disabled: "Регистрация сейчас закрыта",
      network: "Нет связи с сервером входа. Проверьте интернет",
      not_configured: err.message,
    };
    return map[code] || (/already registered/i.test(err.message) ? map.user_already_exists : "Не удалось выполнить действие. Попробуйте позже");
  }

  return {
    AuthError,
    errorText,
    configured,

    /** Стереть сессию только локально: сервер счёл токен недействительным (отозван, пользователь удалён). */
    clear: () => write(null),

    /** Текущая сессия без сетевых запросов (может быть просрочена). */
    session: () => read(),

    /** Сессия с живым токеном: при необходимости обновляет его. null — нужно войти заново. */
    async validSession() {
      const s = read();
      if (!s?.access_token) return null;
      if (s.expires_at - Math.floor(Date.now() / 1000) > REFRESH_BEFORE) return s;
      try {
        const fresh = toSession(await call("/token?grant_type=refresh_token", { body: { refresh_token: s.refresh_token } }));
        write(fresh);
        return fresh;
      } catch (err) {
        if (err.code === "network") return s.expires_at > Math.floor(Date.now() / 1000) ? s : null;  // нет сети: пока токен жив, работаем
        write(null);
        return null;
      }
    },

    async signIn(email, password) {
      const session = toSession(await call("/token?grant_type=password", { body: { email, password } }));
      write(session);
      return session;
    },

    /** Возвращает { signedIn }: false — сервер просит подтвердить почту по письму. */
    async signUp(email, password) {
      const data = await call("/signup", { body: { email, password } });
      if (data.access_token) { write(toSession(data)); return { signedIn: true }; }
      return { signedIn: false };
    },

    async recover(email) { await call("/recover", { body: { email } }); },

    async signOut() {
      const s = read();
      write(null);   // выходим локально сразу, даже если сервер не ответил
      if (s?.access_token) { try { await call("/logout", { token: s.access_token }); } catch { /* ignore */ } }
    },

    /** Куда отправить на вход, чтобы после него вернуться на нужную страницу (относительный путь). */
    loginUrl(next) { return `login.html?next=${encodeURIComponent(next)}`; },

    /** Безопасный адрес возврата: только внутри этого сайта (защита от открытого редиректа). */
    safeNext(next) {
      if (!next || String(next).startsWith("//")) return "./";
      try {
        const url = new URL(next, location.href);
        if (url.origin !== location.origin) return "./";
        const target = url.pathname.split("/").pop() + url.search + url.hash;
        return !target || target.startsWith("login.html") ? "./" : target;   // не возвращаем на саму страницу входа
      } catch { return "./"; }
    },
  };
})();
