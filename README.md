# GiftStore Bot — Инструкция по деплою на Koyeb

## Переменные окружения (прописать в Koyeb)

| Переменная | Значение |
|---|---|
| BOT_TOKEN | токен от @BotFather |
| ADMIN_ID | 6151671553 |
| WEBAPP_URL | https://ВАШ-АПП.koyeb.app |
| PORT | 3000 |

## Шаги деплоя

1. Зайди на github.com → создай новый репозиторий (New repository)
2. Загрузи все файлы из этой папки в репозиторий
3. Зайди на koyeb.com → Create App → GitHub → выбери репозиторий
4. В разделе Environment Variables добавь переменные выше
5. Start command: `npm start`
6. После деплоя скопируй URL (вида https://xxx.koyeb.app)
7. Замени WEBAPP_URL на этот URL и передеплой
8. В @BotFather → /mybots → твой бот → Menu Button → вставь тот же URL

## Команды бота
- /start — запуск
- /admin — панель администратора (только ты)
- /balance — баланс
- /profile — профиль
