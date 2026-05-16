require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const path = require('path');
const db = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isAdmin(userId) {
  return String(userId) === ADMIN_ID;
}

// ═══════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════

// Register / update user
app.post('/api/users/register', (req, res) => {
  const { id, username, firstName, referrerId } = req.body;
  if (!id) return res.status(400).json({ error: 'No user id' });

  let user = db.getUser(id);
  const isNew = !user;

  if (isNew) {
    user = db.createUser({ id, username, firstName, referrerId });
    if (referrerId && String(referrerId) !== String(id)) {
      db.addBalance(referrerId, 10);
      db.incrementReferrals(referrerId);
      bot.telegram.sendMessage(referrerId,
        `🎉 По вашей реферальной ссылке пришёл новый пользователь!\n+10 ⭐ зачислено на баланс.`
      ).catch(() => {});
    }
    db.incrementStat('totalUsers');
  } else {
    user = db.updateUser(id, { username, firstName });
  }

  res.json({ user, isNew, isAdmin: isAdmin(id) });
});

// Get user
app.get('/api/users/:id', (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ ...user, isAdmin: isAdmin(req.params.id) });
});

// All users (admin)
app.get('/api/users', (req, res) => {
  const { userid } = req.headers;
  if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
  res.json(db.getAllUsers());
});

// ─── Products ────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  res.json(db.getProducts());
});

app.post('/api/products', (req, res) => {
  const { userid } = req.headers;
  if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
  const { name, emoji, description, price, limit } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const product = db.addProduct({ name, emoji: emoji || '🎁', description, price, limit });
  res.json(product);
});

app.put('/api/products/:id', (req, res) => {
  const { userid } = req.headers;
  if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
  const product = db.updateProduct(req.params.id, req.body);
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(product);
});

app.delete('/api/products/:id', (req, res) => {
  const { userid } = req.headers;
  if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
  db.deleteProduct(req.params.id);
  res.json({ ok: true });
});

// ─── Orders ──────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  const { userid } = req.headers;
  if (isAdmin(userid)) {
    res.json(db.getAllOrders());
  } else {
    res.json(db.getUserOrders(userid));
  }
});

app.post('/api/orders', (req, res) => {
  const { userid } = req.headers;
  const { productId, payMethod } = req.body;

  const user = db.getUser(userid);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const product = db.getProduct(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (product.limit !== null && product.stock <= 0) {
    return res.status(400).json({ error: 'Товар закончился' });
  }

  if (payMethod === 'stars') {
    if (user.balance < product.price) {
      return res.status(400).json({ error: 'Недостаточно звёзд на балансе' });
    }
    db.addBalance(userid, -product.price);
  }

  if (product.limit !== null) {
    db.decrementStock(productId);
  }

  const order = db.createOrder({
    userId: userid,
    username: user.username,
    productId,
    productName: product.name,
    productEmoji: product.emoji,
    price: product.price,
    payMethod
  });

  db.incrementStat('totalOrders');
  db.incrementStat('totalStarsGiven', product.price);

  // Уведомить админа
  bot.telegram.sendMessage(ADMIN_ID,
    `🛒 *Новый заказ* #${order.id}\n\n` +
    `${product.emoji} ${product.name}\n` +
    `👤 @${user.username || userid}\n` +
    `💰 ${product.price} ⭐\n` +
    `💳 ${payMethod}\n` +
    `⏰ ${new Date().toLocaleString('ru')}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Доставить', callback_data: `deliver_${order.id}` },
          { text: '❌ Отменить', callback_data: `cancel_${order.id}` }
        ]]
      }
    }
  ).catch(() => {});

  res.json(order);
});

// Update order status (admin)
app.put('/api/orders/:id/status', (req, res) => {
  const { userid } = req.headers;
  if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
  const { status } = req.body;
  const order = db.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ error: 'Not found' });

  const msg = status === 'delivered'
    ? `✅ Ваш заказ доставлен!\n\n${order.productEmoji} *${order.productName}*\n\nСпасибо за покупку в GiftStore! 🎁`
    : `❌ Ваш заказ #${order.id} был отменён.\n\nЕсли оплата была звёздами — баланс возвращён.`;

  if (status === 'cancelled' && order.payMethod === 'stars') {
    db.addBalance(order.userId, order.price);
  }

  bot.telegram.sendMessage(order.userId, msg, { parse_mode: 'Markdown' }).catch(() => {});
  res.json(order);
});

// ─── Referrals ───────────────────────────────────────────
app.get('/api/referrals', (req, res) => {
  const { userid } = req.headers;
  res.json(db.getReferrals(userid));
});

// ─── Promos ──────────────────────────────────────────────
app.get('/api/promos', (req, res) => {
  const { userid } = req.headers;
  if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
  res.json(db.getPromos());
});

app.post('/api/promos', (req, res) => {
  const { userid } = req.headers;
  if (!isAdmin(userid)) return res.status(403).json({ error: 'Forbidden' });
  const { code, amount, maxUses } = req.body;
  if (!code || !amount) return res.status(400).json({ error: 'code and amount required' });
  res.json(db.addPromo({ code, amount, maxUses }));
});

app.post('/api/promo/apply', (req, res) => {
  const { userid } = req.headers;
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'No code' });
  const result = db.applyPromo(userid, code);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, amount: result.amount });
});

// ─── Stats ───────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

// Balance top-up invoice (Telegram Stars)
app.post('/api/payment/invoice', async (req, res) => {
  const { userid } = req.headers;
  const { amount } = req.body;
  if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid amount' });
  try {
    const link = await bot.telegram.createInvoiceLink({
      title: 'Пополнение баланса',
      description: `+${amount} ⭐ к балансу GiftStore`,
      payload: `topup_${userid}_${amount}`,
      currency: 'XTR',
      prices: [{ label: `${amount} Stars`, amount: Number(amount) }]
    });
    res.json({ link });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════
//  BOT HANDLERS
// ═══════════════════════════════════════════════

bot.start(async (ctx) => {
  const startPayload = ctx.startPayload;
  const referrerId = startPayload?.startsWith('ref_') ? startPayload.replace('ref_', '') : null;
  const user = ctx.from;

  let dbUser = db.getUser(user.id);
  if (!dbUser) {
    dbUser = db.createUser({
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      referrerId: referrerId && String(referrerId) !== String(user.id) ? referrerId : null
    });
    if (referrerId && String(referrerId) !== String(user.id)) {
      db.addBalance(referrerId, 10);
      db.incrementReferrals(referrerId);
      bot.telegram.sendMessage(referrerId,
        `🎉 По вашей ссылке пришёл новый пользователь!\n+10 ⭐ зачислено!`
      ).catch(() => {});
    }
    db.incrementStat('totalUsers');
  } else {
    db.updateUser(user.id, { username: user.username, firstName: user.first_name });
  }

  await ctx.reply(
    `👋 Привет, ${user.first_name}!\n\n🎁 Добро пожаловать в *GiftStore* — магазин Telegram-подарков!\n\n⭐ Покупай подарки за звёзды\n🤝 Приглашай друзей и получай бонусы\n🎰 Участвуй в розыгрышах`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎁 Открыть магазин', web_app: { url: WEBAPP_URL } }
        ]]
      }
    }
  );
});

bot.command('admin', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return ctx.reply('⛔ Нет доступа.');
  const stats = db.getStats();
  await ctx.replyWithMarkdown(
    `⚙️ *Панель администратора*\n\n` +
    `👥 Пользователей: *${stats.totalUsers}*\n` +
    `🛍 Заказов: *${stats.totalOrders}*\n` +
    `⭐ Выдано звёзд: *${stats.totalStarsGiven}*\n` +
    `📦 Ожидают доставки: *${stats.pendingOrders}*\n` +
    `🏷 Товаров: *${stats.totalProducts}*`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '⚙️ Открыть Admin Panel', web_app: { url: WEBAPP_URL } }
        ]]
      }
    }
  );
});

bot.command('balance', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  if (!user) return ctx.reply('Сначала нажми /start');
  ctx.replyWithMarkdown(`💰 Твой баланс: *${user.balance} ⭐*`);
});

bot.command('profile', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  if (!user) return ctx.reply('Сначала нажми /start');
  const orders = db.getUserOrders(ctx.from.id);
  ctx.replyWithMarkdown(
    `👤 *Профиль*\n\n` +
    `Имя: ${user.firstName}\n` +
    `Username: @${user.username || 'не указан'}\n` +
    `💰 Баланс: *${user.balance} ⭐*\n` +
    `👥 Рефералов: *${user.referralCount || 0}*\n` +
    `🛍 Заказов: *${orders.length}*`
  );
});

// Inline-кнопки доставки (только для админа)
bot.action(/^deliver_(.+)$/, async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  const orderId = ctx.match[1];
  const order = db.updateOrderStatus(orderId, 'delivered');
  if (!order) return ctx.answerCbQuery('Заказ не найден');
  bot.telegram.sendMessage(order.userId,
    `✅ Ваш заказ доставлен!\n\n${order.productEmoji} *${order.productName}*\n\nСпасибо за покупку! 🎁`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ Доставлен', callback_data: 'done' }]] });
  ctx.answerCbQuery('✅ Доставлено!');
});

bot.action(/^cancel_(.+)$/, async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  const orderId = ctx.match[1];
  const order = db.updateOrderStatus(orderId, 'cancelled');
  if (!order) return ctx.answerCbQuery('Заказ не найден');
  if (order.payMethod === 'stars') {
    db.addBalance(order.userId, order.price);
    bot.telegram.sendMessage(order.userId,
      `❌ Ваш заказ отменён.\n${order.price} ⭐ возвращены на баланс.`
    ).catch(() => {});
  }
  await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ Отменён', callback_data: 'done' }]] });
  ctx.answerCbQuery('❌ Отменено');
});

// Telegram Stars payment
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
  const { invoice_payload, total_amount } = ctx.message.successful_payment;
  const parts = invoice_payload.split('_'); // topup_userId_amount
  const userId = parts[1];
  const stars = total_amount;
  db.addBalance(userId, stars);
  await ctx.replyWithMarkdown(`✅ Баланс пополнен на *${stars} ⭐*!\n\nОткрой магазин и выбери подарок 🎁`, {
    reply_markup: {
      inline_keyboard: [[{ text: '🎁 В магазин', web_app: { url: WEBAPP_URL } }]]
    }
  });
});

// ═══════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════
async function main() {
  // Default products
  if (db.getProducts().length === 0) {
    db.addProduct({ name: 'Мишка Premium', emoji: '🐻', description: 'Анлимитный подарок — Мишка', price: 15, limit: null });
    db.addProduct({ name: 'Алмаз', emoji: '💎', description: 'Редкий подарок — Алмаз', price: 100, limit: null });
    db.addProduct({ name: 'Роза', emoji: '🌹', description: 'Нежная Роза в подарок', price: 50, limit: null });
    db.addProduct({ name: 'Шампанское', emoji: '🍾', description: 'VIP подарок', price: 200, limit: 5 });
    db.addProduct({ name: 'Трофей', emoji: '🏆', description: 'Легендарный подарок', price: 500, limit: 3 });
    console.log('✅ Default products created');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`🔗 WebApp URL: ${WEBAPP_URL}`);
  });

  await bot.launch();
  console.log('🤖 Bot started!');
}

main().catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
