// Huddle desktop app: runs the Huddle server inside the app and shows it in a window.
// Everything stays on this computer; the window just talks to http://localhost:4317.
import { app, BrowserWindow, Menu, dialog, session, shell, systemPreferences } from 'electron';
import path from 'node:path';

const PROTOCOL = 'huddle'; // huddle://p/<team id>/meet opens that call (Claude Code's Huddle button uses it)

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
let pendingRoute = routeFrom(process.argv.find((a) => a.startsWith(`${PROTOCOL}://`)));

// huddle://p/abc/meet -> #/p/abc/meet
function routeFrom(link) {
  if (!link) return null;
  try {
    const u = new URL(link);
    const p = `${u.host}${u.pathname}`.replace(/^\/+|\/+$/g, '');
    return /^[\w/-]*$/.test(p) ? `#/${p}` : '#/';
  } catch { return null; }
}

function openRoute(route) {
  if (!route) return;
  if (!win || !baseUrl) { pendingRoute = route; return; }
  win.loadURL(`${baseUrl}/${route}`);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(origin)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  win.loadURL(`${baseUrl}/${pendingRoute || ''}`);
  pendingRoute = null;
  win.on('closed', () => { win = null; });
}

app.on('second-instance', (_e, argv) => {
  const route = routeFrom(argv.find((a) => a.startsWith(`${PROTOCOL}://`)));
  if (route) openRoute(route);
  else if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('open-url', (e, url) => { e.preventDefault(); openRoute(routeFrom(url) || '#/'); });

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

  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

// On a Mac the app keeps running (and your agents keep working) with no window open, like most Mac apps.
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
