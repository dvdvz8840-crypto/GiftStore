# GiftStore Bot — Деплой на Vercel

## Структура проекта
```
api/
  handler.js     ← все API маршруты
  webhook.js     ← Telegram webhook
lib/
  db.js          ← MongoDB база данных
  bot.js         ← экземпляр бота
public/
  index.html     ← мини-апка
scripts/
  set-webhook.js ← регистрация webhook (запускается один раз)
vercel.json      ← конфиг роутинга
package.json
```

## ШАГ 1 — MongoDB Atlas (база данных)
1. Зайди на mongodb.com/atlas → Register
2. Создай бесплатный кластер (Free / M0)
3. Database Access → Add user → придумай логин/пароль
4. Network Access → Add IP → 0.0.0.0/0 (разрешить все)
5. Clusters → Connect → Drivers → скопируй строку вида:
   mongodb+srv://USER:PASS@cluster.mongodb.net/giftstore

## ШАГ 2 — GitHub
1. Зайди на github.com → New repository → назови giftstore
2. Загрузи все файлы из этой папки

## ШАГ 3 — Vercel
1. Зайди на vercel.com → Add New Project → импортируй GitHub репо
2. В разделе Environment Variables добавь:

| Переменная    | Значение                              |
|---------------|---------------------------------------|
| BOT_TOKEN     | токен от @BotFather                   |
| ADMIN_ID      | 6151671553                            |
| WEBAPP_URL    | https://твой-проект.vercel.app        |
| MONGODB_URI   | строка из MongoDB Atlas               |

3. Deploy → подожди ~1 минуту
4. Скопируй URL деплоя (напр. https://giftstore-xxx.vercel.app)
5. Замени WEBAPP_URL на этот URL → Redeploy

## ШАГ 4 — Установить Webhook
После деплоя открой в браузере:
https://api.telegram.org/bot<ВАШ_ТОКЕН>/setWebhook?url=https://твой-проект.vercel.app/api/webhook

Должен ответить: {"ok":true}

## ШАГ 5 — @BotFather
1. /mybots → твой бот → Bot Menu Button → Edit Menu Button URL
2. Вставь URL: https://твой-проект.vercel.app

## Готово! Напиши /start своему боту.
