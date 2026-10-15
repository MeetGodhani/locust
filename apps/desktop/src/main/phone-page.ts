/*
 * The page a phone opens (0.775, shared/phone.ts). One file, no scripts from anywhere else (the host's CSP allows
 * none), dark like Locust's own window. Every word from a run goes in with textContent, never as HTML. The key
 * arrives in the address's #fragment, is kept in the phone's storage, and is taken out of the address bar at once.
 */
const STYLE = `
:root { color-scheme: dark; --bg: #0b0d0e; --raised: #16191a; --raised-2: #1d2122; --line: rgba(255,255,255,0.08);
  --text: #f2efe9; --muted: #8b9190; --soft: #c7c3bc; --green: #7fc97f; --amber: #efc969; --red: #e4685d;
  --bubble: #23282a; --button: #f2efe9; --button-text: #0b0d0e; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-text-size-adjust: 100%;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); min-height: 100dvh; }
header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 14px 16px;
  background: rgba(11,13,14,0.92); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
header h1 { font-size: 17px; font-weight: 600; margin: 0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
.dot[data-on] { background: var(--green); }
.back { border: 0; background: none; color: var(--soft); font: inherit; font-size: 15px; padding: 4px 8px 4px 0; }
main { padding: 12px 16px 24px; display: grid; gap: 22px; }
h2 { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.card { background: var(--raised); border: 1px solid var(--line); border-radius: 14px; padding: 14px; display: grid; gap: 10px; }
.card[data-waiting] { border-color: rgba(233,185,73,0.35); }
.who { font-size: 13px; color: var(--amber); }
.what { white-space: pre-wrap; word-break: break-word; font-size: 15px; }
.row { display: flex; gap: 10px; }
button.act { flex: 1; min-height: 44px; border-radius: 10px; font: inherit; font-weight: 600; border: 1px solid var(--line); }
button.yes { background: var(--button); color: var(--button-text); border-color: transparent; }
button.no { background: var(--raised-2); color: var(--text); }
button:disabled { opacity: 0.5; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
li > button.convo { width: 100%; text-align: left; background: var(--raised); color: var(--text); border: 1px solid var(--line);
  border-radius: 14px; padding: 12px 14px; font: inherit; display: grid; gap: 3px; }
.title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 13px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.meta[data-running] { color: var(--green); }
.snippet { font-size: 14px; color: var(--soft); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.empty, .note { color: var(--muted); font-size: 15px; }
.turns { display: grid; gap: 14px; padding-bottom: 120px; }
.asked { justify-self: end; max-width: 85%; background: var(--bubble); border-radius: 16px 16px 4px 16px; padding: 10px 13px; white-space: pre-wrap; word-break: break-word; }
.answer { white-space: pre-wrap; word-break: break-word; color: var(--text); }
.by { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.working { color: var(--green); font-size: 14px; }
form.compose { position: fixed; left: 0; right: 0; bottom: 0; display: flex; gap: 8px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  background: rgba(11,13,14,0.96); border-top: 1px solid var(--line); }
form.compose textarea { flex: 1; resize: none; min-height: 44px; max-height: 140px; border-radius: 12px; border: 1px solid var(--line);
  background: var(--raised); color: var(--text); font: inherit; padding: 10px 12px; }
form.compose button { min-width: 72px; border-radius: 12px; border: 0; background: var(--button); color: var(--button-text); font: inherit; font-weight: 600; }
.pair { padding: 48px 24px; display: grid; gap: 12px; text-align: center; }
.pair strong { font-size: 18px; }
.toast { position: fixed; left: 16px; right: 16px; bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--raised-2);
  border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; font-size: 14px; }
:focus-visible { outline: 2px solid var(--soft); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) { button { transition: opacity 120ms; } }
`

const SCRIPT = `
(function () {
  var KEY = 'locust-phone-key';
  var key = null;
  try { key = localStorage.getItem(KEY); } catch (e) {}
  var fromCode = location.hash.length > 1 ? location.hash.slice(1) : '';
  if (/^[A-Za-z0-9_-]{32}$/.test(fromCode)) {
    key = fromCode;
    try { localStorage.setItem(KEY, key); } catch (e) {}
  }
  if (location.hash) history.replaceState(null, '', location.pathname);

  var root = document.getElementById('root');
  var open = null;       // the conversation shown, by its newest turn's id
  var openTitle = '';
  var state = null;
  var timer = null;
  var draft = '';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) for (var name in attrs) {
      if (name === 'text') node.textContent = attrs[name];
      else if (name === 'on') for (var ev in attrs.on) node.addEventListener(ev, attrs.on[ev]);
      else if (attrs[name] !== false && attrs[name] != null) node.setAttribute(name, attrs[name] === true ? '' : attrs[name]);
    }
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }
  function when(at) {
    var then = new Date(at), now = new Date();
    if (isNaN(then)) return '';
    var mins = Math.round((now - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 60 * 24) return Math.round(mins / 60) + ' h ago';
    return then.toLocaleDateString();
  }
  function phaseWords(phase) {
    return phase === 'running' ? 'working' : phase === 'completed' ? 'done' : phase === 'failed' ? 'stopped with an error'
      : phase === 'cancelled' ? 'stopped' : 'stopped before it finished';
  }
  function toast(text) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var t = el('div', { class: 'toast', role: 'status', text: text });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }
  function api(path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { authorization: 'Bearer ' + key, 'content-type': 'application/json' } : { authorization: 'Bearer ' + key },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      if (res.status === 401) { key = null; try { localStorage.removeItem(KEY); } catch (e) {} render(); throw new Error('unpaired'); }
      return res.json().then(function (data) { if (!res.ok) throw new Error(data && data.message || 'Locust did not answer.'); return data; });
    });
  }
  function header(title, back) {
    return el('header', null, [
      back ? el('button', { class: 'back', type: 'button', 'aria-label': 'Back to conversations', text: '‹ Back', on: { click: back } }) : null,
      el('h1', { text: title }),
      el('span', { class: 'dot', 'data-on': state !== null, title: state !== null ? 'Connected to Locust' : 'Not reaching Locust' })
    ]);
  }
  function pairScreen() {
    root.replaceChildren(el('div', { class: 'pair' }, [
      el('strong', { text: 'Pair this phone with Locust' }),
      el('div', { class: 'note', text: 'On your computer, open Locust, then Settings › Your phone, and scan the code with this phone’s camera.' })
    ]));
  }
  function waitingCard(item) {
    var card = el('div', { class: 'card', 'data-waiting': true });
    var buttons = [
      el('button', { class: 'act yes', type: 'button', text: 'Allow once' }),
      el('button', { class: 'act no', type: 'button', text: 'Deny' })
    ];
    buttons.forEach(function (button, index) {
      button.addEventListener('click', function () {
        buttons.forEach(function (b) { b.disabled = true; });
        api('/api/decide', { approvalId: item.approvalId, approve: index === 0 }).then(function (r) {
          toast(r.ok ? (index === 0 ? 'Allowed once.' : 'Denied.') : 'That card was already answered.');
          refresh();
        }).catch(function (e) { buttons.forEach(function (b) { b.disabled = false; }); if (e.message !== 'unpaired') toast(e.message); });
      });
    });
    card.append(el('div', { class: 'who', text: (item.name ? item.name + ' asks' : 'An agent asks') + ' · ' + when(item.requestedAt) }),
      el('div', { class: 'what', text: item.summary }), el('div', { class: 'row' }, buttons));
    return card;
  }
  function listScreen() {
    var parts = [header('Locust')];
    var main = el('main');
    if (state === null) main.append(el('div', { class: 'note', text: 'Reaching Locust…' }));
    else {
      if (state.waiting.length > 0) {
        var section = el('section', null, [el('h2', { text: 'Waiting on you' })]);
        var stack = el('div', { style: 'display:grid;gap:10px' });
        state.waiting.forEach(function (item) { stack.append(waitingCard(item)); });
        section.append(stack); main.append(section);
      }
      var convos = el('section', null, [el('h2', { text: 'Conversations' })]);
      if (state.conversations.length === 0) convos.append(el('div', { class: 'empty', text: 'No conversations yet. Start one in Locust on your computer.' }));
      else {
        var list = el('ul');
        state.conversations.forEach(function (c) {
          list.append(el('li', null, [el('button', { class: 'convo', type: 'button', on: { click: function () { open = c.missionId; openTitle = c.title; draft = ''; render(); refresh(); } } }, [
            el('span', { class: 'title', text: c.title }),
            el('span', { class: 'meta', 'data-running': c.phase === 'running', text: c.agent + ' · ' + phaseWords(c.phase) + ' · ' + when(c.at) }),
            c.snippet ? el('span', { class: 'snippet', text: c.snippet }) : null
          ])]));
        });
        convos.append(list);
      }
      main.append(convos);
    }
    parts.push(main);
    root.replaceChildren.apply(root, parts);
  }
  var turns = null;
  function threadScreen() {
    var main = el('main');
    var list = el('div', { class: 'turns' });
    if (turns === null) list.append(el('div', { class: 'note', text: 'Opening…' }));
    else turns.forEach(function (turn) {
      if (turn.asked) list.append(el('div', { class: 'asked', text: turn.asked }));
      var said = el('div', null, [el('div', { class: 'by', text: turn.agent })]);
      if (turn.answer) said.append(el('div', { class: 'answer', text: turn.answer }));
      if (turn.phase === 'running') said.append(el('div', { class: 'working', text: 'Working…' }));
      else if (!turn.answer) said.append(el('div', { class: 'note', text: 'This turn ' + phaseWords(turn.phase) + ' without an answer.' }));
      list.append(said);
    });
    main.append(list);
    var box = el('textarea', { rows: '1', placeholder: 'Send the next message', 'aria-label': 'Message' });
    box.value = draft;
    box.addEventListener('input', function () { draft = box.value; box.style.height = 'auto'; box.style.height = box.scrollHeight + 'px'; });
    var send = el('button', { type: 'submit', text: 'Send' });
    var running = turns !== null && turns.length > 0 && turns[turns.length - 1].phase === 'running';
    send.disabled = running;
    if (running) box.placeholder = 'Wait for this turn to finish';
    var form = el('form', { class: 'compose', on: { submit: function (event) {
      event.preventDefault();
      var text = box.value.trim(); if (!text || !turns || turns.length === 0) return;
      send.disabled = true;
      api('/api/send', { missionId: turns[turns.length - 1].missionId, text: text }).then(function (r) {
        if (!r.ok) { send.disabled = false; toast(r.message || 'Locust could not send that.'); return; }
        draft = ''; toast('Sent.'); refresh();
      }).catch(function (e) { send.disabled = false; if (e.message !== 'unpaired') toast(e.message); });
    } } }, [box, send]);
    var focused = document.activeElement && document.activeElement.tagName === 'TEXTAREA';
    root.replaceChildren(header(openTitle, function () { open = null; turns = null; render(); refresh(); }), main, form);
    if (focused) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }
  function render() {
    if (!key) { pairScreen(); return; }
    if (open) threadScreen(); else listScreen();
  }
  function refresh() {
    clearTimeout(timer);
    if (!key) return;
    var asked = open;
    var work = asked
      ? api('/api/turns?id=' + encodeURIComponent(asked)).then(function (r) {
          if (open !== asked) return;
          var before = turns === null ? 0 : turns.length;
          turns = r.turns;
          // A message sent from here starts a newer turn: follow it.
          if (turns.length > 0) open = turns[turns.length - 1].missionId;
          var atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
          render();
          if (turns.length !== before || atEnd) window.scrollTo(0, document.body.scrollHeight);
        })
      : api('/api/state').then(function (r) { state = r; render(); });
    work.catch(function (e) {
      if (e.message === 'unpaired') return;
      if (!asked) { state = null; render(); }
    }).then(function () {
      if (key && document.visibilityState === 'visible') timer = setTimeout(refresh, 3000);
    });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh(); });
  // A new code opened in this same tab changes only the #fragment, which reloads nothing: take its key here.
  window.addEventListener('hashchange', function () {
    var next = location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{32}$/.test(next)) return;
    key = next;
    try { localStorage.setItem(KEY, key); } catch (e) {}
    history.replaceState(null, '', location.pathname);
    open = null; turns = null; state = null;
    render(); refresh();
  });
  render();
  refresh();
})();
`

export function phonePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0d0e">
<meta name="referrer" content="no-referrer">
<title>Locust</title>
<style>${STYLE}</style>
</head>
<body>
<div id="root"></div>
<script>${SCRIPT}</script>
</body>
</html>`
}
