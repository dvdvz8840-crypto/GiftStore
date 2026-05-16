const { Telegraf } = require('telegraf');
const db = require('../lib/db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBAPP_URL = process.env.WEBAPP_URL || '';

function isAdmin(id) { return String(id) === ADMIN_ID; }

bot.start(async (ctx) => {
  const startPayload = ctx.startPayload;
  const referrerId = startPayload?.startsWith('ref_') ? startPayload.replace('ref_', '') : null;
  const user = ctx.from;

  let dbUser = await db.getUser(user.id);
  if (!dbUser) {
    dbUser = await db.createUser({ id: user.id, username: user.username, firstName: user.first_name, referrerId });
    if (referrerId && String(referrerId) !== String(user.id)) {
      await db.addBalance(referrerId, 10);
      await db.incrementReferrals(referrerId);
      bot.telegram.sendMessage(referrerId, '🎉 По вашей ссылке пришёл новый пользователь!\n+10 ⭐ зачислено!').catch(() => {});
    }
    await db.seedDefaultProducts();
  } else {
    await db.updateUser(user.id, { username: user.username, firstName: user.first_name });
  }

  await ctx.reply(
    `👋 Привет, ${user.first_name}!\n\n🎁 Добро пожаловать в *GiftStore*!\n\n⭐ Покупай подарки за звёзды\n🤝 Приглашай друзей и получай бонусы`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🎁 Открыть магазин', web_app: { url: WEBAPP_URL } }]] }
    }
  );
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('⛔ Нет доступа.');
  const stats = await db.getStats();
  await ctx.replyWithMarkdown(
    `⚙️ *Панель администратора*\n\n👥 Пользователей: *${stats.totalUsers}*\n🛍 Заказов: *${stats.totalOrders}*\n⭐ Выдано: *${stats.totalStarsGiven}*\n⏳ Ожидают: *${stats.pendingOrders}*`,
    { reply_markup: { inline_keyboard: [[{ text: '⚙️ Открыть Admin Panel', web_app: { url: WEBAPP_URL } }]] } }
  );
});

bot.command('balance', async (ctx) => {
  const user = await db.getUser(ctx.from.id);
  if (!user) return ctx.reply('Сначала нажми /start');
  ctx.replyWithMarkdown(`💰 Твой баланс: *${user.balance} ⭐*`);
});

bot.action(/^deliver_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const orderId = ctx.match[1];
  const order = await db.updateOrderStatus(orderId, 'delivered');
  if (!order) return ctx.answerCbQuery('Заказ не найден');
  bot.telegram.sendMessage(order.userId,
    `✅ Ваш заказ доставлен!\n\n${order.productEmoji} *${order.productName}*\n\nСпасибо за покупку! 🎁`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ Доставлен', callback_data: 'done' }]] });
  ctx.answerCbQuery('✅ Доставлено!');
});

bot.action(/^cancel_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const orderId = ctx.match[1];
  const order = await db.updateOrderStatus(orderId, 'cancelled');
  if (!order) return ctx.answerCbQuery('Заказ не найден');
  if (order.payMethod === 'stars') await db.addBalance(order.userId, order.price);
  bot.telegram.sendMessage(order.userId,
    `❌ Ваш заказ отменён.${order.payMethod === 'stars' ? '\n⭐ Баланс возвращён.' : ''}`
  ).catch(() => {});
  await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ Отменён', callback_data: 'done' }]] });
  ctx.answerCbQuery('❌ Отменено');
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
  const { invoice_payload, total_amount } = ctx.message.successful_payment;
  const parts = invoice_payload.split('_');
  const userId = parts[1];
  await db.addBalance(userId, total_amount);
  await ctx.replyWithMarkdown(`✅ Баланс пополнен на *${total_amount} ⭐*!\n\n🎁 Открой магазин и выбери подарок!`, {
    reply_markup: { inline_keyboard: [[{ text: '🎁 В магазин', web_app: { url: WEBAPP_URL } }]] }
  });
});

// Vercel serverless export
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');
  try {
    await bot.handleUpdate(req.body, res);
  } catch (e) {
    console.error(e);
    res.status(200).send('ok');
  }
};
