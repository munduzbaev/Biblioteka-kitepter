// Адрес API. Локально — uvicorn на :8000, в проде подставьте адрес деплоя из Vercel.
window.API_URL =
  ["localhost", "127.0.0.1", ""].includes(location.hostname)
    ? "http://localhost:8000"
    : "https://a-book-edu-api.vercel.app";
window.API_URL = window.API_URL.replace(/\/+$/, "");   // лишний «/» на конце ломает запросы (Vercel отвечает редиректом без CORS)

// Вход читателей — Supabase Auth. Адрес проекта и публичный (anon / publishable) ключ:
// Supabase -> Project Settings -> API. Этот ключ публичный по замыслу, его можно держать в коде.
// НИКОГДА не вставляйте сюда service_role / secret ключ.
window.SUPABASE_URL = "https://osqhovztyoofpoeebeav.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zcWhvdnp0eW9vZnBvZWViZWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzQ5MDUsImV4cCI6MjEwNzQ1MDkwNX0.2wOG_E_xmTq1HqBc4ecueLBwa7XMy-73uji9jt5W8Cg";
