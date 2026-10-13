"use strict";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const next = Auth.safeNext(params.get("next"));
let mode = params.get("mode") === "signup" ? "signup" : "login";

function setMessage(text, kind = "error") {
  $("msg").textContent = text;
  $("msg").dataset.kind = kind;
}

function setMode(newMode) {
  mode = newMode;
  const signup = mode === "signup";
  $("tabLogin").setAttribute("aria-selected", String(!signup));
  $("tabSignup").setAttribute("aria-selected", String(signup));
  $("submit").textContent = signup ? "Зарегистрироваться" : "Войти";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("forgot").hidden = signup;
  setMessage("");
}

async function submit(e) {
  e.preventDefault();
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || !password) return setMessage("Введите почту и пароль");
  if (mode === "signup" && password.length < 6) return setMessage("Пароль должен быть не короче 6 символов");
  $("submit").disabled = true;
  setMessage("Подождите…", "info");
  try {
    if (mode === "signup") {
      const { signedIn } = await Auth.signUp(email, password);
      if (!signedIn) {
        setMode("login");
        setMessage("Мы отправили письмо на вашу почту. Подтвердите её по ссылке из письма, затем войдите.", "info");
        return;
      }
    } else {
      await Auth.signIn(email, password);
    }
    location.replace(next);
  } catch (err) {
    setMessage(Auth.errorText(err));
  } finally {
    $("submit").disabled = false;
  }
}

async function forgot() {
  const email = $("email").value.trim();
  if (!email) return setMessage("Введите почту, на которую отправить ссылку для сброса пароля");
  try {
    await Auth.recover(email);
    setMessage("Если такая почта зарегистрирована, мы отправили на неё ссылку для сброса пароля.", "info");
  } catch (err) {
    setMessage(Auth.errorText(err));
  }
}

$("tabLogin").onclick = () => setMode("login");
$("tabSignup").onclick = () => setMode("signup");
$("authForm").onsubmit = submit;
$("forgot").onclick = forgot;

if (next !== "./") $("reason").textContent = "Войдите, чтобы продолжить.";
Auth.validSession().then((s) => { if (s) location.replace(next); });   // уже вошли — сразу возвращаем
setMode(mode);
if (!Auth.configured()) setMessage("Вход ещё не настроен: администратору нужно вписать SUPABASE_ANON_KEY в js/config.js.");
