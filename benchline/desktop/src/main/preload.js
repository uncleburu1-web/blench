const { contextBridge, ipcRenderer } = require('electron');

// Everything the renderer (the React UI) is allowed to do — a deliberately
// narrow surface, no direct filesystem/db/network access from the
// renderer process at all.
contextBridge.exposeInMainWorld('pos', {
  listProducts: (params) => ipcRenderer.invoke('pos:listProducts', params),
  createProduct: (input) => ipcRenderer.invoke('pos:createProduct', input),
  listCustomers: (params) => ipcRenderer.invoke('pos:listCustomers', params),
  createCustomer: (input) => ipcRenderer.invoke('pos:createCustomer', input),
  addStockBatch: (input) => ipcRenderer.invoke('pos:addStockBatch', input),
  createSale: (input) => ipcRenderer.invoke('pos:createSale', input),
  deleteSale: (saleId) => ipcRenderer.invoke('pos:deleteSale', saleId),
  addPayment: (saleId, amount) => ipcRenderer.invoke('pos:addPayment', { saleId, amount }),
  listSales: (params) => ipcRenderer.invoke('pos:listSales', params),
  getSale: (saleId) => ipcRenderer.invoke('pos:getSale', saleId),
  pendingSyncCount: () => ipcRenderer.invoke('pos:pendingSyncCount'),
  login: (username, password) => ipcRenderer.invoke('pos:login', { username, password }),
  isLoggedIn: () => ipcRenderer.invoke('pos:isLoggedIn'),
  getProfile: () => ipcRenderer.invoke('pos:getProfile'),
  logout: () => ipcRenderer.invoke('pos:logout'),
});
