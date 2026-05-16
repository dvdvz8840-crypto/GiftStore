const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.MONGODB_URI;
const DB_NAME = 'giftstore';

let client = null;

async function getDb() {
  if (!client) {
    client = new MongoClient(URI, { maxPoolSize: 5 });
    await client.connect();
  }
  return client.db(DB_NAME);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ─── USERS ───────────────────────────────────────────────
async function getUser(id) {
  const db = await getDb();
  return db.collection('users').findOne({ id: String(id) });
}

async function createUser({ id, username, firstName, referrerId }) {
  const db = await getDb();
  const user = {
    id: String(id),
    username: username || null,
    firstName: firstName || 'User',
    balance: 0,
    referrerId: referrerId ? String(referrerId) : null,
    referralCount: 0,
    usedPromos: [],
    createdAt: new Date()
  };
  await db.collection('users').insertOne(user);
  return user;
}

async function updateUser(id, fields) {
  const db = await getDb();
  await db.collection('users').updateOne({ id: String(id) }, { $set: fields });
  return db.collection('users').findOne({ id: String(id) });
}

async function addBalance(userId, amount) {
  const db = await getDb();
  const result = await db.collection('users').findOneAndUpdate(
    { id: String(userId) },
    { $inc: { balance: Number(amount) } },
    { returnDocument: 'after' }
  );
  return result?.balance ?? 0;
}

async function incrementReferrals(userId) {
  const db = await getDb();
  await db.collection('users').updateOne({ id: String(userId) }, { $inc: { referralCount: 1 } });
}

async function getReferrals(userId) {
  const db = await getDb();
  return db.collection('users').find({ referrerId: String(userId) }).toArray();
}

async function getAllUsers() {
  const db = await getDb();
  return db.collection('users').find().toArray();
}

// ─── PRODUCTS ────────────────────────────────────────────
async function getProducts() {
  const db = await getDb();
  return db.collection('products').find({ deleted: { $ne: true } }).toArray();
}

async function getProduct(id) {
  const db = await getDb();
  return db.collection('products').findOne({ id });
}

async function addProduct({ name, emoji, description, price, limit }) {
  const db = await getDb();
  const lim = limit && Number(limit) > 0 ? Number(limit) : null;
  const product = {
    id: genId(),
    name, emoji: emoji || '🎁',
    description: description || '',
    price: Number(price),
    limit: lim,
    stock: lim,
    sold: 0,
    deleted: false,
    createdAt: new Date()
  };
  await db.collection('products').insertOne(product);
  return product;
}

async function updateProduct(id, fields) {
  const db = await getDb();
  const update = { ...fields };
  if (update.price !== undefined) update.price = Number(update.price);
  if (update.limit !== undefined) {
    const lim = update.limit && Number(update.limit) > 0 ? Number(update.limit) : null;
    update.limit = lim;
    if (lim !== null) update.stock = lim;
  }
  await db.collection('products').updateOne({ id }, { $set: update });
  return db.collection('products').findOne({ id });
}

async function deleteProduct(id) {
  const db = await getDb();
  await db.collection('products').updateOne({ id }, { $set: { deleted: true } });
}

async function decrementStock(id) {
  const db = await getDb();
  const p = await db.collection('products').findOne({ id });
  if (p && p.limit !== null) {
    await db.collection('products').updateOne({ id }, { $inc: { stock: -1, sold: 1 } });
  } else {
    await db.collection('products').updateOne({ id }, { $inc: { sold: 1 } });
  }
}

// ─── ORDERS ──────────────────────────────────────────────
async function getAllOrders() {
  const db = await getDb();
  return db.collection('orders').find().sort({ createdAt: -1 }).toArray();
}

async function getUserOrders(userId) {
  const db = await getDb();
  return db.collection('orders').find({ userId: String(userId) }).sort({ createdAt: -1 }).toArray();
}

async function createOrder({ userId, username, productId, productName, productEmoji, price, payMethod }) {
  const db = await getDb();
  const order = {
    id: genId(),
    userId: String(userId),
    username: username || String(userId),
    productId, productName, productEmoji,
    price: Number(price),
    payMethod,
    status: 'pending',
    createdAt: new Date()
  };
  await db.collection('orders').insertOne(order);
  return order;
}

async function updateOrderStatus(id, status) {
  const db = await getDb();
  await db.collection('orders').updateOne({ id }, { $set: { status, updatedAt: new Date() } });
  return db.collection('orders').findOne({ id });
}

async function getOrder(id) {
  const db = await getDb();
  return db.collection('orders').findOne({ id });
}

// ─── PROMOS ──────────────────────────────────────────────
async function getPromos() {
  const db = await getDb();
  return db.collection('promos').find().toArray();
}

async function addPromo({ code, amount, maxUses }) {
  const db = await getDb();
  const promo = {
    id: genId(),
    code: code.toUpperCase().trim(),
    amount: Number(amount),
    maxUses: maxUses ? Number(maxUses) : null,
    uses: 0,
    createdAt: new Date()
  };
  await db.collection('promos').insertOne(promo);
  return promo;
}

async function applyPromo(userId, code) {
  const db = await getDb();
  const promo = await db.collection('promos').findOne({ code: code.toUpperCase().trim() });
  if (!promo) return { ok: false, error: 'Промокод не найден' };
  if (promo.maxUses !== null && promo.uses >= promo.maxUses) return { ok: false, error: 'Промокод исчерпан' };

  const user = await db.collection('users').findOne({ id: String(userId) });
  if (!user) return { ok: false, error: 'Пользователь не найден' };
  if ((user.usedPromos || []).includes(promo.id)) return { ok: false, error: 'Промокод уже использован' };

  await db.collection('users').updateOne(
    { id: String(userId) },
    { $push: { usedPromos: promo.id }, $inc: { balance: promo.amount } }
  );
  await db.collection('promos').updateOne({ id: promo.id }, { $inc: { uses: 1 } });

  return { ok: true, amount: promo.amount };
}

// ─── STATS ───────────────────────────────────────────────
async function getStats() {
  const db = await getDb();
  const [users, orders, products, promos] = await Promise.all([
    db.collection('users').countDocuments(),
    db.collection('orders').countDocuments(),
    db.collection('products').countDocuments({ deleted: { $ne: true } }),
    db.collection('promos').countDocuments()
  ]);
  const starsResult = await db.collection('orders').aggregate([
    { $group: { _id: null, total: { $sum: '$price' } } }
  ]).toArray();
  const pendingOrders = await db.collection('orders').countDocuments({ status: 'pending' });

  return {
    totalUsers: users,
    totalOrders: orders,
    totalStarsGiven: starsResult[0]?.total || 0,
    totalProducts: products,
    totalPromos: promos,
    pendingOrders
  };
}

async function seedDefaultProducts() {
  const db = await getDb();
  const count = await db.collection('products').countDocuments();
  if (count === 0) {
    await Promise.all([
      addProduct({ name: 'Мишка Premium', emoji: '🐻', description: 'Анлимитный подарок', price: 15, limit: null }),
      addProduct({ name: 'Алмаз', emoji: '💎', description: 'Редкий подарок — Алмаз', price: 100, limit: null }),
      addProduct({ name: 'Роза', emoji: '🌹', description: 'Нежная Роза в подарок', price: 50, limit: null }),
      addProduct({ name: 'Шампанское', emoji: '🍾', description: 'VIP подарок', price: 200, limit: 5 }),
      addProduct({ name: 'Трофей', emoji: '🏆', description: 'Легендарный подарок', price: 500, limit: 3 }),
    ]);
  }
}

module.exports = {
  getUser, createUser, updateUser, addBalance, incrementReferrals, getReferrals, getAllUsers,
  getProducts, getProduct, addProduct, updateProduct, deleteProduct, decrementStock,
  getAllOrders, getUserOrders, createOrder, updateOrderStatus, getOrder,
  getPromos, addPromo, applyPromo,
  getStats, seedDefaultProducts
};
