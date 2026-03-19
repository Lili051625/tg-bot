const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────
// 🔧 КОНФИГУРАЦИЯ — задаётся через переменные окружения Railway
// ─────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// Системный промпт — тот же, что в вашем боте
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Ты — продающий, но адекватный digital-консультант. Ты помогаешь клиентам понять, какие услуги им реально нужны для развития сайта:
— наполнение сайта под ключ;
— SEO-оптимизация;
— GEO-оптимизация;
— контент-мейкинг;
— AI-креатив;
— локальное продвижение;
— усиление конверсии и доверия к сайту.

Твои цели:
1. Быстро понять бизнес клиента.
2. Выявить слабые места сайта или продвижения.
3. Объяснить услуги без воды и сложных терминов.
4. Показать выгоду для бизнеса, а не просто перечислить работы.
5. Подвести клиента к следующему шагу: заявка, аудит, расчет, созвон.

Правила общения:
— Пиши уверенно, спокойно, по-деловому.
— Не обещай "топ-1", "гарантированные продажи" или "мгновенный рост".
— Не используй агрессивные продажи.
— Не перегружай техническими деталями.
— Всегда объясняй через выгоду для бизнеса: доверие, заявки, видимость, упаковка, удобство, локальный охват.
— Если клиент не понимает термин, объясняй простым языком.
— Если клиент сомневается, сравнивай варианты: базово / усиленно / под ключ.
— Если данных мало, сначала задай 3-5 уточняющих вопросов.
— В конце каждого развёрнутого ответа мягко предлагай следующий шаг: аудит, расчёт или созвон.

Как объяснять услуги:
SEO: Это не просто ключевые слова, а системная работа над структурой, текстами, страницами, метаданными, полезностью контента и понятностью сайта для поисковых систем.
GEO: Это адаптация сайта и контента под ИИ-поиск и генеративные ответы, чтобы бизнес чаще становился понятным, цитируемым и заметным в новых форматах поиска.
Наполнение сайта: Это не "залить текст", а полноценно упаковать услуги, смыслы, преимущества, блоки доверия, структуру страниц и сценарии обращения.
Контент-мейкинг: Это создание текстов, визуалов, смыслов, описаний услуг, статей, карточек, кейсов и ответов на частые вопросы.
AI-креатив: Это использование ИИ для ускорения создания контента, визуалов, идей, черновиков и маркетинговых материалов — но с обязательной проверкой качества.

Формат ответа:
1. Короткое понимание задачи клиента.
2. Что у него сейчас может мешать результату.
3. Какие услуги подойдут.
4. Какой результат это даст бизнесу.
5. Следующий шаг (предложи аудит, расчёт или созвон).

Финальная цель: Мягко довести клиента до аудита, расчета или заявки.
Отвечай по-русски. Не используй Markdown-форматирование (звёздочки, решётки) — пиши обычным текстом, так как ответ идёт в Telegram.`;

const WELCOME_TEXT = `Здравствуйте! Я помогу понять, как усилить ваш сайт: через наполнение, SEO, GEO, контент или AI-креатив.

Чтобы сразу подсказать по делу, ответьте коротко на 3 вопроса:
1. Чем занимается ваш бизнес?
2. У вас уже есть сайт или только планируете запуск?
3. Что сейчас важнее всего: заявки, видимость в поиске, упаковка услуг или контент?`;

// ─────────────────────────────────────────────
// Хранилище истории диалогов (в памяти)
// Для продакшена можно заменить на Redis
// ─────────────────────────────────────────────
const conversations = new Map();

const MAX_HISTORY = 20; // максимум сообщений в истории на пользователя

function getHistory(chatId) {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }
  return conversations.get(chatId);
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  // Обрезаем историю, оставляя последние MAX_HISTORY сообщений
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

// ─────────────────────────────────────────────
// Telegram helpers
// ─────────────────────────────────────────────
async function sendMessage(chatId, text, keyboard = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (keyboard) {
    payload.reply_markup = keyboard;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      payload
    );
  } catch (err) {
    console.error("Telegram sendMessage error:", err.response?.data || err.message);
  }
}

async function sendTyping(chatId) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`,
      { chat_id: chatId, action: "typing" }
    );
  } catch (e) {}
}

// Кнопки быстрых ответов
const QUICK_KEYBOARD = {
  keyboard: [
    ["🔍 Разобрать мой сайт", "📊 SEO или наполнение?"],
    ["🤖 GEO для ИИ-поиска", "✍️ Контент под услуги"],
    ["📍 Локальное продвижение", "⚡ AI-креатив"],
    ["📋 Получить аудит", "📝 Оставить заявку"],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

// Соответствие кнопок → текст для Claude
const BUTTON_MAP = {
  "🔍 Разобрать мой сайт": "Хочу разобрать свой сайт и понять, что улучшить",
  "📊 SEO или наполнение?": "Что мне нужно: SEO или наполнение сайта?",
  "🤖 GEO для ИИ-поиска": "Что такое GEO и зачем мне это нужно?",
  "✍️ Контент под услуги": "Нужен контент под мои услуги",
  "📍 Локальное продвижение": "Хочу клиентов из своего города",
  "⚡ AI-креатив": "Нужен контент через ИИ, расскажите подробнее",
  "📋 Получить аудит": "Хочу получить аудит моего сайта",
};

// ─────────────────────────────────────────────
// Claude API
// ─────────────────────────────────────────────
async function askClaude(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);
  const history = getHistory(chatId);

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: history,
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    const reply = response.data.content[0].text;
    addToHistory(chatId, "assistant", reply);
    return reply;
  } catch (err) {
    console.error("Claude API error:", err.response?.data || err.message);
    return "Извините, произошла техническая ошибка. Попробуйте ещё раз через несколько секунд.";
  }
}

// ─────────────────────────────────────────────
// Обработка заявки
// ─────────────────────────────────────────────
const pendingLeads = new Map(); // chatId → шаг сбора заявки

async function handleLeadFlow(chatId, text, userName) {
  const step = pendingLeads.get(chatId) || { step: 0, data: {} };

  if (step.step === 0) {
    pendingLeads.set(chatId, { step: 1, data: { name: userName || "" } });
    await sendMessage(chatId, "Хорошо! Давайте оформим заявку.\n\nКак вас зовут? (имя и фамилия)", {
      remove_keyboard: true,
    });
    return true;
  }

  if (step.step === 1) {
    step.data.name = text;
    step.step = 2;
    pendingLeads.set(chatId, step);
    await sendMessage(chatId, `Приятно познакомиться, ${text}!\n\nУкажите ваш телефон или WhatsApp:`);
    return true;
  }

  if (step.step === 2) {
    step.data.phone = text;
    step.step = 3;
    pendingLeads.set(chatId, step);
    await sendMessage(chatId, "Отлично! Кратко опишите ваш бизнес и что хотите улучшить:");
    return true;
  }

  if (step.step === 3) {
    step.data.comment = text;
    pendingLeads.delete(chatId);

    // Формируем сообщение о заявке для лога / пересылки
    const leadText = `📥 <b>Новая заявка из Telegram-бота</b>\n\n` +
      `👤 <b>Имя:</b> ${step.data.name}\n` +
      `📞 <b>Телефон:</b> ${step.data.phone}\n` +
      `💬 <b>Бизнес / задача:</b> ${step.data.comment}\n` +
      `🆔 <b>Telegram:</b> @${userName || chatId}\n` +
      `🕐 <b>Время:</b> ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

    console.log("=== NEW LEAD ===");
    console.log(leadText.replace(/<[^>]+>/g, ""));
    console.log("===============");

    // Отправляем подтверждение клиенту
    await sendMessage(
      chatId,
      "✅ Заявка принята! Наш менеджер свяжется с вами в ближайшее рабочее время.\n\nЕсли хотите продолжить консультацию — просто напишите.",
      QUICK_KEYBOARD
    );
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────
// Webhook endpoint
// ─────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Telegram ждёт быстрого ответа

  const update = req.body;
  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = update.message.text;
  const userName = update.message.from?.username || update.message.from?.first_name;

  if (!text) return;

  // /start
  if (text === "/start") {
    conversations.delete(chatId); // сброс истории
    pendingLeads.delete(chatId);
    await sendMessage(chatId, WELCOME_TEXT, QUICK_KEYBOARD);
    return;
  }

  // /reset — сброс диалога
  if (text === "/reset") {
    conversations.delete(chatId);
    pendingLeads.delete(chatId);
    await sendMessage(chatId, "Диалог сброшен. Начнём заново!\n\n" + WELCOME_TEXT, QUICK_KEYBOARD);
    return;
  }

  // Кнопка "Оставить заявку"
  if (text === "📝 Оставить заявку") {
    pendingLeads.set(chatId, { step: 0, data: {} });
    await handleLeadFlow(chatId, text, userName);
    return;
  }

  // Если идёт сбор заявки
  if (pendingLeads.has(chatId)) {
    await handleLeadFlow(chatId, text, userName);
    return;
  }

  // Подменяем кнопки на полный текст для Claude
  const messageForClaude = BUTTON_MAP[text] || text;

  // Показываем "печатает..."
  await sendTyping(chatId);

  // Спрашиваем Claude
  const reply = await askClaude(chatId, messageForClaude);

  await sendMessage(chatId, reply, QUICK_KEYBOARD);
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Digital Growth Bot is running 🚀" });
});

// ─────────────────────────────────────────────
// Запуск сервера
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`📌 Не забудьте установить webhook:`);
  console.log(`   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<RAILWAY_URL>/webhook`);
});
