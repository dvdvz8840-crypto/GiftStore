const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      users: [],
      products: [],
      orders: [],
      promos: [],
      stats: { totalUsers: 0, totalOrders: 0, totalStarsGiven: 0 }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { users: [], products: [], orders: [], promos: [], stats: { totalUsers: 0, totalOrders: 0, totalStarsGiven: 0 } };
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ─── USERS ───────────────────────────────────────────────
function getUser(id) {
  const db = load();
  return db.users.find(u => String(u.id) === String(id)) || null;
}

function createUser({ id, username, firstName, referrerId }) {
  const db = load();
  const user = {
    id: String(id),
    username: username || null,
    firstName: firstName || 'User',
    balance: 0,
    referrerId: referrerId ? String(referrerId) : null,
    referralCount: 0,
    usedPromos: [],
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  save(db);
  return user;
}

function updateUser(id, fields) {
  const db = load();
  const idx = db.users.findIndex(u => String(u.id) === String(id));
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...fields };
  save(db);
  return db.users[idx];
}

function addBalance(userId, amount) {
  const db = load();
  const idx = db.users.findIndex(u => String(u.id) === String(userId));
  if (idx === -1) return;
  db.users[idx].balance = Math.max(0, (db.users[idx].balance || 0) + Number(amount));
  save(db);
  return db.users[idx].balance;
}

function incrementReferrals(userId) {
  const db = load();
  const idx = db.users.findIndex(u => String(u.id) === String(userId));
  if (idx === -1) return;
  db.users[idx].referralCount = (db.users[idx].referralCount || 0) + 1;
  save(db);
}

function getReferrals(userId) {
  const db = load();
  return db.users.filter(u => String(u.referrerId) === String(userId));
}

function getAllUsers() {
  return load().users;
}

// ─── PRODUCTS ────────────────────────────────────────────
function getProducts() {
  return load().products.filter(p => !p.deleted);
}

function getProduct(id) {
  return load().products.find(p => p.id === id) || null;
}

function addProduct({ name, emoji, description, price, limit }) {
  const db = load();
  const lim = limit && Number(limit) > 0 ? Number(limit) : null;
  const product = {
    id: genId(),
    name, emoji,
    description: description || '',
    price: Number(price),
    limit: lim,
    stock: lim,
    sold: 0,
    deleted: false,
    createdAt: new Date().toISOString()
  };
  db.products.push(product);
  save(db);
  return product;
}

function updateProduct(id, fields) {
  const db = load();
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) return null;
  if (fields.price !== undefined) fields.price = Number(fields.price);
  if (fields.limit !== undefined) {
    const lim = fields.limit && Number(fields.limit) > 0 ? Number(fields.limit) : null;
    fields.limit = lim;
    if (lim !== null) fields.stock = lim;
  }
  db.products[idx] = { ...db.products[idx], ...fields };
  save(db);
  return db.products[idx];
}

function deleteProduct(id) {
  const db = load();
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) return;
  db.products[idx].deleted = true;
  save(db);
}

function decrementStock(id) {
  const db = load();
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) return;
  if (db.products[idx].stock !== null) {
    db.products[idx].stock = Math.max(0, db.products[idx].stock - 1);
  }
  db.products[idx].sold = (db.products[idx].sold || 0) + 1;
  save(db);
}

// ─── ORDERS ──────────────────────────────────────────────
function getAllOrders() {
  return load().orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getUserOrders(userId) {
  return load().orders
    .filter(o => String(o.userId) === String(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function createOrder({ userId, username, productId, productName, productEmoji, price, payMethod }) {
  const db = load();
  const order = {
    id: genId(),
    userId: String(userId),
    username: username || String(userId),
    productId, productName, productEmoji,
    price: Number(price),
    payMethod,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.orders.push(order);
  save(db);
  return order;
}

function updateOrderStatus(id, status) {
  const db = load();
  const idx = db.orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  db.orders[idx].status = status;
  db.orders[idx].updatedAt = new Date().toISOString();
  save(db);
  return db.orders[idx];
}

// ─── PROMOS ──────────────────────────────────────────────
function getPromos() {
  return load().promos;
}

function addPromo({ code, amount, maxUses }) {
  const db = load();
  const promo = {
    id: genId(),
    code: code.toUpperCase().trim(),
    amount: Number(amount),
    maxUses: maxUses ? Number(maxUses) : null,
    uses: 0,
    createdAt: new Date().toISOString()
  };
  db.promos.push(promo);
  save(db);
  return promo;
}

function applyPromo(userId, code) {
  const db = load();
  const promo = db.promos.find(p => p.code === code.toUpperCase().trim());
  if (!promo) return { ok: false, error: 'Промокод не найден' };
  if (promo.maxUses !== null && promo.uses >= promo.maxUses) return { ok: false, error: 'Промокод исчерпан' };

  const userIdx = db.users.findIndex(u => String(u.id) === String(userId));
  if (userIdx === -1) return { ok: false, error: 'Пользователь не найден' };
  if ((db.users[userIdx].usedPromos || []).includes(promo.id)) return { ok: false, error: 'Промокод уже использован' };

  db.users[userIdx].usedPromos = [...(db.users[userIdx].usedPromos || []), promo.id];
  db.users[userIdx].balance = (db.users[userIdx].balance || 0) + promo.amount;

  const promoIdx = db.promos.findIndex(p => p.id === promo.id);
  db.promos[promoIdx].uses += 1;

  save(db);
  return { ok: true, amount: promo.amount };
}

// ─── STATS ───────────────────────────────────────────────
function getStats() {
  const db = load();
  return {
    ...db.stats,
    totalProducts: db.products.filter(p => !p.deleted).length,
    totalPromos: db.promos.length,
    pendingOrders: db.orders.filter(o => o.status === 'pending').length
  };
}

function incrementStat(key, amount = 1) {
  const db = load();
  db.stats[key] = (db.stats[key] || 0) + Number(amount);
  save(db);
}

module.exports = {
  getUser, createUser, updateUser, addBalance, incrementReferrals, getReferrals, getAllUsers,
  getProducts, getProduct, addProduct, updateProduct, deleteProduct, decrementStock,
  getAllOrders, getUserOrders, createOrder, updateOrderStatus,
  getPromos, addPromo, applyPromo,
  getStats, incrementStat
};
