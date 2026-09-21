# Рабочая архитектура RVNW V2

Telegram Mini App — интерфейс; реальные данные хранятся в backend и базе.

## Telegram
Проверка Telegram WebApp initData, привязка Telegram ID к профилю, подписке и заявкам. После заполнения профиль появляется в каталоге и отправляется в рабочий Telegram-чат.

## Luma
Нужны Luma Plus и API key. API получает события, webhooks обновляют события, регистрации и покупки. Счётчик промокода считается по фактическим использованиям coupon code.

## Stripe
Stripe Customer ID связывается с Telegram ID. Webhooks обновляют статус подписки, дату продления и платежи. После покупки приглашённым другом backend начисляет пригласившему +14 дней.

## Трекинг
submitted → reviewing → approved → scheduled → completed. Статус меняется администратором через служебного бота или админ-панель.

## Звания
0–29 дней New Resident; 30–89 RVNW Insider; 90–179 RVNW Core; 180–364 RVNW Circle; 365+ RVNW Legacy.
