const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const db = require('./db');
const auth = require('./auth');
const { startHeartbeat } = require('./heartbeat');
const { startSyncEngine } = require('./sync');
const { startLocalBackend, stopLocalBackend } = require('./backendLauncher');

// One SQLite file per machine, in the OS's standard per-user app data
// folder — this is the desktop's entire operational database. Nothing
// about normal POS operation ever depends on anything else existing.
const DB_PATH = path.join(app.getPath('userData'), 'everyday-wine-store-pos.db');

let mainWindow;
let database;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer-dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  database = db.openDb(DB_PATH);

  // --- IPC bridge: every one of these hits the LOCAL db only. ----------
  ipcMain.handle('pos:listProducts', (_e, params) => db.listProducts(database, params));
  ipcMain.handle('pos:createProduct', (_e, input) => db.createProduct(database, input));
  ipcMain.handle('pos:listCustomers', (_e, params) => db.listCustomers(database, params));
  ipcMain.handle('pos:createCustomer', (_e, input) => db.createCustomer(database, input));
  ipcMain.handle('pos:addStockBatch', (_e, input) => db.addStockBatch(database, input));
  ipcMain.handle('pos:createSale', (_e, input) => db.createSale(database)(input));
  ipcMain.handle('pos:deleteSale', (_e, saleId) => db.deleteSale(database)(saleId));
  ipcMain.handle('pos:addPayment', (_e, { saleId, amount }) => db.addPayment(database)(saleId, amount));
  ipcMain.handle('pos:listSales', (_e, params) => db.listSales(database, params));
  ipcMain.handle('pos:getSale', (_e, saleId) => db.getSale(database, saleId));
  ipcMain.handle('pos:pendingSyncCount', () =>
    database.prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'`).get().n
  );
  ipcMain.handle('pos:login', async (_e, { username, password }) => {
    await auth.login(database, username, password);
    return { ok: true };
  });
  ipcMain.handle('pos:isLoggedIn', () => Boolean(auth.getAccessToken(database)));
  ipcMain.handle('pos:getProfile', () => auth.getUserProfile(database));
  ipcMain.handle('pos:logout', () => {
    auth.logout(database);
    return { ok: true };
  });

  createWindow();

  // Local-testing convenience only — see backendLauncher.js. The window
  // is created immediately regardless; login just fails gracefully (same
  // as any other offline moment) until this finishes coming up, or
  // does nothing at all if a real remote backend URL is configured.
  startLocalBackend({
    onReady: () => console.log('[backend-launcher] backend is reachable'),
    onFail: (err) => console.warn('[backend-launcher] not running a local backend:', err.message),
  });

  // Background loops — see heartbeat.js and sync.js. Both are pure
  // "try, and quietly skip if offline" loops; neither can block or break
  // anything the cashier is doing at the till.
  startHeartbeat(database, { deviceName: os.hostname() });
  startSyncEngine(database);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => stopLocalBackend());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
