require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEBHOOK_URL = process.env.WEBAPP_URL + '/api/webhook';

(async () => {
  await bot.telegram.setWebhook(WEBHOOK_URL);
  console.log('✅ Webhook set to:', WEBHOOK_URL);
  const info = await bot.telegram.getWebhookInfo();
  console.log('ℹ️  Webhook info:', info);
  process.exit(0);
})();
