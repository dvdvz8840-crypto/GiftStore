const express = require('express');
const db = require('../lib/db');
const bot = require('../lib/bot');

const app = express();
app.use(express.json());

const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBAPP_URL = process.env.WEBAPP_URL || '';

function isAdmin(userId) { return String(userId) === ADMIN_ID; }

// ─── USERS ───────────────────────────────────────────────
app.post('/api/users/register', async (req, res) => {
  try {
    const { id, username, firstName, referrerId } = req.body;
    if (!id) return res.status(400).json({ error: 'No id' });
    let user = await db.getUser(id);
    const isNew = !user;
    if (isNew) {
      user = await db.createUser({ id, username, firstName, referrerId });
      if (referrerId && String(referrerId) !== String(id)) {
        await db.addBalance(referrerId, 10);
        await db.incrementReferrals(referrerId);
        bot.telegram.sendMessage(referrerId, '🎉 По вашей ссылке пришёл новый пользователь!\n+10 ⭐ зачислено!').catch(() => {});
      }
      await db.seedDefaultProducts();
    } else {
      user = await db.updateUser(id, { username, firstName });
    }
    res.json({ user, isNew, isAdmin: isAdmin(id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await db.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ ...user, isAdmin: isAdmin(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users', async (req, res) => {
  try {
    const { userid } = req.headers;
    if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
    res.json(await db.getAllUsers());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PRODUCTS ────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try { res.json(await db.getProducts()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { userid } = req.headers;
    if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
    const { name, emoji, description, price, limit } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'name and price required' });
    res.json(await db.addProduct({ name, emoji, description, price, limit }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { userid } = req.headers;
    if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
    const product = await db.updateProduct(req.params.id, req.body);
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(product);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { userid } = req.headers;
    if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
    await db.deleteProduct(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ORDERS ──────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const { userid } = req.headers;
    if (isAdmin(userid)) res.json(await db.getAllOrders());
    else res.json(await db.getUserOrders(userid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { userid } = req.headers;
    const { productId, payMethod } = req.body;
    const user = await db.getUser(userid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const product = await db.getProduct(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.limit !== null && product.stock <= 0) return res.status(400).json({ error: 'Товар закончился' });
    if (payMethod === 'stars' && user.balance < product.price) return res.status(400).json({ error: 'Недостаточно звёзд на балансе' });

    if (payMethod === 'stars') await db.addBalance(userid, -product.price);
    if (product.limit !== null) await db.decrementStock(productId);

    const order = await db.createOrder({
      userId: userid, username: user.username,
      productId, productName: product.name,
      productEmoji: product.emoji, price: product.price, payMethod
    });

    bot.telegram.sendMessage(ADMIN_ID,
      `🛒 *Новый заказ* #${order.id}\n\n${product.emoji} ${product.name}\n👤 @${user.username || userid}\n💰 ${product.price} ⭐\n💳 ${payMethod}\n⏰ ${new Date().toLocaleString('ru')}`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[
          { text: '✅ Доставить', callback_data: `deliver_${order.id}` },
          { text: '❌ Отменить', callback_data: `cancel_${order.id}` }
        ]]}
      }
    ).catch(() => {});

    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { userid } = req.headers;
    if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
    const { status } = req.body;
    const order = await db.updateOrderStatus(req.params.id, status);
    if (!order) return res.status(404).json({ error: 'Not found' });
    if (status === 'cancelled' && order.payMethod === 'stars') await db.addBalance(order.userId, order.price);
    const msg = status === 'delivered'
      ? `✅ Ваш заказ доставлен!\n\n${order.productEmoji} *${order.productName}*\n\nСпасибо за покупку! 🎁`
      : `❌ Заказ #${order.id} отменён.${order.payMethod === 'stars' ? '\n⭐ Баланс возвращён.' : ''}`;
    bot.telegram.sendMessage(order.userId, msg, { parse_mode: 'Markdown' }).catch(() => {});
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── REFERRALS ───────────────────────────────────────────
app.get('/api/referrals', async (req, res) => {
  try {
    const { userid } = req.headers;
    res.json(await db.getReferrals(userid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PROMOS ──────────────────────────────────────────────
app.get('/api/promos', async (req, res) => {
  try {
    const { userid } = req.headers;
    if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
    res.json(await db.getPromos());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/promos', async (req, res) => {
  try {
    const { userid } = req.headers;
    if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
    const { code, amount, maxUses } = req.body;
    if (!code || !amount) return res.status(400).json({ error: 'code and amount required' });
    res.json(await db.addPromo({ code, amount, maxUses }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/promo/apply', async (req, res) => {
  try {
    const { userid } = req.headers;
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'No code' });
    const result = await db.applyPromo(userid, code);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, amount: result.amount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── STATS ───────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try { res.json(await db.getStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PAYMENT INVOICE ─────────────────────────────────────
app.post('/api/payment/invoice', async (req, res) => {
  try {
    const { userid } = req.headers;
    const { amount } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid amount' });
    const link = await bot.telegram.createInvoiceLink({
      title: 'Пополнение баланса',
      description: `+${amount} ⭐ к балансу GiftStore`,
      payload: `topup_${userid}_${amount}`,
      currency: 'XTR',
      prices: [{ label: `${amount} Stars`, amount: Number(amount) }]
    });
    res.json({ link });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = app;
