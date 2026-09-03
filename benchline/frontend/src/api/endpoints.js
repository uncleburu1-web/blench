import client from './client';

export const auth = {
  login: (username, password) => client.post('/auth/login/', { username, password }),
  register: (payload) => client.post('/auth/register/', payload),
  me: () => client.get('/me/'),
};

export const dashboard = {
  stats: () => client.get('/dashboard/stats/'),
  activity: () => client.get('/dashboard/activity/'),
};

export const inventory = {
  list: (params) => client.get('/inventory/items/', { params }),
  get: (id) => client.get(`/inventory/items/${id}/`),
  create: (data) => client.post('/inventory/items/', data),
  update: (id, data) => client.patch(`/inventory/items/${id}/`, data),
  remove: (id) => client.delete(`/inventory/items/${id}/`),
  addBatch: (id, data) => client.post(`/inventory/items/${id}/batches/`, data),
};

export const batches = {
  update: (id, data) => client.patch(`/inventory/batches/${id}/`, data),
  remove: (id) => client.delete(`/inventory/batches/${id}/`),
};

export const suppliers = {
  list: (params) => client.get('/suppliers/', { params }),
  create: (data) => client.post('/suppliers/', data),
  update: (id, data) => client.patch(`/suppliers/${id}/`, data),
  remove: (id) => client.delete(`/suppliers/${id}/`),
};

export const repairs = {
  list: (params) => client.get('/repairs/tickets/', { params }),
  create: (data) => client.post('/repairs/tickets/', data),
  update: (id, data) => client.patch(`/repairs/tickets/${id}/`, data),
  remove: (id) => client.delete(`/repairs/tickets/${id}/`),
  addPayment: (id, amount) => client.post(`/repairs/tickets/${id}/add-payment/`, { amount }),
};

export const sales = {
  list: (params) => client.get('/sales/', { params }),
  create: (data) => client.post('/sales/', data),
  remove: (id) => client.delete(`/sales/${id}/`),
  addPayment: (id, amount) => client.post(`/sales/${id}/add-payment/`, { amount }),
  replaceItem: (id, data) => client.post(`/sales/${id}/replace-item/`, data),
};

export const workers = {
  list: (params) => client.get('/workers/', { params }),
  create: (data) => client.post('/workers/', data),
  update: (id, data) => client.patch(`/workers/${id}/`, data),
  remove: (id) => client.delete(`/workers/${id}/`),
};

export const liabilities = {
  list: (params) => client.get('/liabilities/', { params }),
  create: (data) => client.post('/liabilities/', data),
  update: (id, data) => client.patch(`/liabilities/${id}/`, data),
  remove: (id) => client.delete(`/liabilities/${id}/`),
};

export const subscription = {
  status: () => client.get('/subscription/status/'),
  checkout: (callback_url) => client.post('/subscription/checkout/', { callback_url }),
  verify: (reference) => client.get('/subscription/verify/', { params: { reference } }),
};

export const reports = {
  salesSummary: (params) => client.get('/reports/sales-summary/', { params }),
  salesByItem: (params) => client.get('/reports/sales-by-item/', { params }),
  bestSelling: (params) => client.get('/reports/best-selling/', { params }),
  salesByCategory: (params) => client.get('/reports/sales-by-category/', { params }),
  salesByStaff: (params) => client.get('/reports/sales-by-staff/', { params }),
  paymentMethod: (params) => client.get('/reports/payment-method/', { params }),
  salesByCustomer: (params) => client.get('/reports/sales-by-customer/', { params }),
  tax: (params) => client.get('/reports/tax/', { params }),
  expiringInventory: (params) => client.get('/reports/expiring-inventory/', { params }),
  inventoryValuation: () => client.get('/reports/inventory-valuation/'),
  netWorth: () => client.get('/reports/net-worth/'),
};

