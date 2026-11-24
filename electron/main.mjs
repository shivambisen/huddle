// Huddle desktop app: runs the Huddle server inside the app and shows it in a window.
// Everything stays on this computer; the window just talks to http://localhost:4317.
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, screen, session, shell, systemPreferences } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROTOCOL = 'huddle';
// huddle://p/<team id>/meet opens that call; huddle://background starts Huddle quietly with
// no window (Claude Code's Huddle plugin does this so you never have to open the app yourself).
const HERE = path.dirname(fileURLToPath(import.meta.url));

// HUDDLE_USER_DATA runs a separate copy (its own profile and single-instance lock), for testing.
if (process.env.HUDDLE_USER_DATA) app.setPath('userData', path.resolve(process.env.HUDDLE_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();

// Data and speech models live in the user's app-data folder, never inside the app bundle.
process.env.HUDDLE_EMBEDDED = '1';
process.env.HUDDLE_DATA ||= path.join(app.getPath('userData'), 'data');
process.env.HUDDLE_MODELS ||= app.getPath('userData');
process.env.PORT ||= '4317';

if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(PROTOCOL);

let win = null;
let baseUrl = null;
const isBackgroundLink = (link) => /^huddle:\/\/background\/?$/i.test(link || '');
const launchLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
let startHidden = process.argv.includes('--background') || isBackgroundLink(launchLink);
let pendingRoute = isBackgroundLink(launchLink) ? null : routeFrom(launchLink);
let tray = null;
let serverReady = false;

// huddle://p/abc/meet -> #/p/abc/meet
function routeFrom(link) {
  if (!link) return null;
  try {
    const u = new URL(link);
    const p = `${u.host}${u.pathname}`.replace(/^\/+|\/+$/g, '');
    return /^[\w/-]*$/.test(p) ? `#/${p}` : '#/';
  } catch { return null; }
}

function showDock() { if (process.platform === 'darwin') app.dock?.show(); }
function hideDock() { if (process.platform === 'darwin') app.dock?.hide(); }

function openRoute(route, { fromLink = false } = {}) {
  if (!route) return;
  // A call opened from outside (Claude Code's Join button) starts in the floating mini window.
  if (fromLink && /\/meet$/.test(route) && serverReady) return openMini(callIdOf(route));
  // Opening that same call in the big window takes it back from the mini one.
  if (mini && !mini.isDestroyed() && callIdOf(route) && callIdOf(route) === callIdOf(new URL(mini.webContents.getURL()).hash)) closeMini();
  if (!serverReady) { pendingRoute = route; startHidden = false; return; }
  if (!win) { pendingRoute = route; showDock(); createWindow(); return; }
  win.loadURL(`${baseUrl}/${route}`);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- the floating mini call ----------
// A small always-on-top window in the corner of the screen, like Meet's floating call.
// Only one window holds a call at a time, so voices never double up.
let mini = null;
const callIdOf = (route) => (String(route || '').match(/^#\/p\/([\w-]+)\/(meet|mini)/) || [])[1] || null;

function externalLinks(w) {
  const origin = new URL(baseUrl).origin;
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(origin)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function openMini(pid) {
  if (!pid) return;
  // Hand the call over from the big window, if it had it.
  if (win && !win.isDestroyed() && win.webContents.getURL().includes(`/p/${pid}/meet`)) win.loadURL(`${baseUrl}/#/`);
  const url = `${baseUrl}/#/p/${pid}/mini`;
  if (mini && !mini.isDestroyed()) { if (!mini.webContents.getURL().endsWith(`/p/${pid}/mini`)) mini.loadURL(url); mini.showInactive(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  const w = 328, h = 252, m = 20;
  mini = new BrowserWindow({
    width: w, height: h, x: workArea.x + workArea.width - w - m, y: workArea.y + workArea.height - h - m,
    minWidth: 240, minHeight: 180, frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: true,
    fullscreenable: false, maximizable: false, minimizable: false, hasShadow: true, roundedCorners: true,
    backgroundColor: '#202124', show: false, title: 'Huddle call',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  mini.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') mini.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  externalLinks(mini);
  mini.loadURL(url);
  mini.once('ready-to-show', () => mini.showInactive()); // don't steal focus from whatever you're working in
  mini.on('closed', () => { mini = null; });
}

function closeMini() { if (mini && !mini.isDestroyed()) mini.close(); mini = null; }

function expandCall(pid) {
  closeMini();
  openRoute(`#/p/${pid}/meet`);
}

// The Huddle server runs in this same process; it calls these for the call screen's buttons.
globalThis.huddleApp = { desktop: true, mini: openMini, closeMini, expand: expandCall };

async function startServer() {
  try {
    const { ready } = await import('../server.js');
    return (await ready).url;
  } catch (e) {
    // Another Huddle (say, `npm start` in a terminal) already has the port: use that one.
    if (e.code === 'EADDRINUSE') {
      const url = `http://localhost:${process.env.PORT}`;
      try {
        const r = await fetch(`${url}/api/settings`);
        if (r.ok) return url;
      } catch {}
      throw new Error(`Port ${process.env.PORT} is used by another program. Quit it and open Huddle again.`);
    }
    throw e;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    title: 'Huddle',
    backgroundColor: '#f6f5f1',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  const origin = new URL(baseUrl).origin;

  // Links to anywhere else open in the normal browser. The pop-out window is allowed.
  externalLinks(win);
  // Minimising during a call keeps the call going in the floating mini window, like Meet.
  win.on('minimize', () => { const pid = callIdOf(new URL(win.webContents.getURL()).hash); if (pid) openMini(pid); });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  win.loadURL(`${baseUrl}/${pendingRoute || ''}`);
  pendingRoute = null;
  win.on('closed', () => { win = null; });
  showDock();
}

app.on('second-instance', (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (isBackgroundLink(link) || argv.includes('--background')) return; // already running: nothing to do
  const route = routeFrom(link);
  if (route) openRoute(route, { fromLink: true });
  else openRoute('#/');
});
// macOS delivers links through open-url, possibly before the app is ready: catch them early.
app.on('will-finish-launching', () => {
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (isBackgroundLink(url)) { if (!serverReady) startHidden = true; return; }
    openRoute(routeFrom(url) || '#/', { fromLink: true });
  });
});

// Huddle lives in the menu bar (tray on Windows) so it can run with no window.
function createTray() {
  const icon = process.platform === 'darwin'
    ? nativeImage.createFromPath(path.join(HERE, 'trayTemplate.png'))
    : nativeImage.createFromPath(path.join(HERE, 'tray-win.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Huddle');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Huddle', click: () => openRoute('#/') },
    { type: 'separator' },
    { label: 'Quit Huddle', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  if (process.platform !== 'darwin') tray.on('click', () => openRoute('#/'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Huddle website', click: () => shell.openExternal('https://huddle-seven-kappa.vercel.app') }, { label: 'Source code', click: () => shell.openExternal('https://github.com/shivambisen/huddle') }] },
  ]));

  try {
    baseUrl = await startServer();
  } catch (e) {
    dialog.showErrorBox("Huddle couldn't start", e.message);
    app.quit();
    return;
  }

  // Microphone and camera for Huddle's own pages only.
  const origin = new URL(baseUrl).origin;
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    let ok = false;
    try { ok = new URL(wc.getURL()).origin === origin && allowed.has(permission); } catch {}
    cb(ok);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => requestingOrigin === origin && allowed.has(permission));
  if (process.platform === 'darwin') systemPreferences.askForMediaAccess('microphone').catch(() => {});

  serverReady = true;
  createTray();
  if (startHidden && !pendingRoute) hideDock();
  else createWindow();
  app.on('activate', () => { if (!win) openRoute('#/'); });
});

// Closing the window leaves Huddle running in the menu bar / tray, so Claude Code can keep
// talking to your team. Quit from the menu-bar icon.
app.on('window-all-closed', () => { hideDock(); });
