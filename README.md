# ok-photo

Галерея фото OK.ru: просмотр, общее удаление, импорт по ссылке профиля или HAR.

## Деплой на Vercel

### 1. Создание проекта (экран, который ты видишь)

| Поле | Значение |
|------|----------|
| **Project Name** | `ok-photo` |
| **Framework Preset** | **Other** |
| **Root Directory** | `./` |

Нажми **Deploy** (репозиторий должен быть на GitHub и подключён к Vercel).

### 2. После первого деплоя — Storage (обязательно)

Без Blob фото не сохраняются (на Vercel нет диска).

1. Проект → **Storage** → **Connect Database** → **Blob** → Create  
2. Vercel сам добавит `BLOB_READ_WRITE_TOKEN` в Environment Variables  
3. **Redeploy** проект (Deployments → … → Redeploy)

### 3. Загрузить уже скачанные фото в Blob (если есть папка `data/images`)

Локально:

```bash
npm install
# Скопируй BLOB_READ_WRITE_TOKEN из Vercel в .env.local
npm run seed
```

### 4. Переменные окружения (Settings → Environment Variables)

| Переменная | Нужна? | Описание |
|------------|--------|----------|
| `BLOB_READ_WRITE_TOKEN` | да | Создаётся при подключении Blob |
| `OK_COOKIES` | нет | Cookie-строка из браузера (ok.ru залогинен) для полного импорта |
| `IMPORT_MAX` | нет | Макс. фото за импорт (по умолчанию 80) |

| Действие | Пароль |
|----------|--------|
| Вход (просмотр) | `kirova9898topa` |
| Добавление и удаление | `tinytiny` (кнопка «Редактирование») |

На Vercel можно задать `ADMIN_PASSWORD=tinytiny` в Environment Variables.

### 5. Открыть сайт

`https://ok-photo-xxx.vercel.app` — главная страница галереи.

---

## Локально (без Vercel)

```bash
python3 serve.py
# http://127.0.0.1:8765
```

Фото в `data/images/`, удаления в `deleted.json`.

---

## Структура

```
public/index.html   — интерфейс
api/                — serverless API (Vercel)
lib/                — Blob + импорт OK
data/images/        — локальные фото (для seed)
serve.py            — локальный сервер
```
