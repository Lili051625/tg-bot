const express = require("express");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

// Инициализация официального SDK
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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

SEO: Это не просто ключевые слова, а системная работа над структурой, текстами, страницами, метаданными, полезностью контента.
GEO: Адаптация сайта под ИИ-поиск и генеративные ответы.
Наполнение сайта: Полноценная упаковка услуг, смыслов, преимуществ, блоков доверия.
Контент-мейкинг: Создание текстов, визуалов, описаний услуг, статей, кейсов.
AI-креатив: Использование ИИ для ускорения контента с обязательной проверкой качества.

Формат ответа:
1. Короткое понимание задачи клиента.
2. Что у него сейчас может мешать результату.
3. Какие услуги подойдут.
4. Какой результат это даст бизнесу.
5. Следующий шаг (предложи аудит, расчёт или созвон).

Отвечай по-русски. Не используй Markdown (звёздочки, решётки) — пиши обычным текстом для Telegram.`;

const WELCOME_TEXT = `Здравствуйте! Я помогу понять, как усилить ваш сайт: через наполнение, SEO, GEO, контент или AI-креатив.

Чтобы сразу подсказать по делу, ответьте коротко на 3 вопроса:
1. Чем занимается ваш бизнес?
2. У вас уже есть сайт или только планируете запуск?
3. Что сейчас важнее всего: заявки, видимость в поиске, упаковка услуг или контент?`;

const conversations = new Map();
const pendingLeads = new Map();
const MAX_HISTORY = 20;

function getHistory(chatId) {
  if (!conversations.has(chatId)) conversations.set(chatId, []);
  return conversations.get(chatId);
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

const QUICK_KEYBOARD = {
  keyboard: [
    ["🔍 Разобрать мой сайт", "📊 SEO или наполнение?"],
    ["🤖 GEO для ИИ-поиска", "✍️ Контент под услуги"],
    ["📍 Локальное продвижение", "⚡ AI-креатив"],
    ["📋 Получить аудит", "📝 Оставить заявку"],
  ],
  resize_keyboard: true,
};

const BUTTON_MAP = {
  "🔍 Разобрать мой сайт": "Хочу разобрать свой сайт и понять, что улучшить",
  "📊 SEO или наполнение?": "Что мне нужно: SEO или наполнение сайта?",
  "🤖 GEO для ИИ-поиска": "Что такое GEO и зачем мне это нужно?",
  "✍️ Контент под услуги": "Нужен контент под мои услуги",
  "📍 Локальное продвижение": "Хочу клиентов из своего города",
  "⚡ AI-креатив": "Нужен контент через ИИ, расскажите подробнее",
  "📋 Получить аудит": "Хочу получить аудит моего сайта",
};

async function sendMessage(chatId, text, keyboard = null) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) payload.reply_markup = keyboard;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
  } catch (err) {
    console.error("Telegram error:", err.response?.data || err.message);
  }
}

async function sendTyping(chatId) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
      chat_id: chatId, action: "typing",
    });
  } catch (e) {}
}

// ─── Gemini через официальный SDK ───
async function askGemini(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);
  const history = getHistory(chatId);

  // Формат истории для SDK
  const contents = history.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-1-flash-lite",
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 1024,
        temperature: 0.7,
      },
    });

    const reply = response.text;
    if (!reply) throw new Error("Пустой ответ от Gemini");

    addToHistory(chatId, "assistant", reply);
    return reply;

  } catch (err) {
    console.error("Gemini error:", err.message || JSON.stringify(err));

    if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED")) {
      return "Подождите немного и напишите снова — превышен лимит запросов.";
    }
    if (err.message?.includes("API key")) {
      return "⚠️ Ошибка ключа Gemini. Проверьте переменную GEMINI_API_KEY.";
    }
    return "Извините, произошла техническая ошибка. Попробуйте ещё раз.";
  }
}

// ─── Сбор заявки ───
async function handleLeadFlow(chatId, text, userName) {
  const step = pendingLeads.get(chatId) || { step: 0, data: {} };

  if (step.step === 0) {
    pendingLeads.set(chatId, { step: 1, data: {} });
    await sendMessage(chatId, "Хорошо! Оформим заявку.\n\nКак вас зовут?", { remove_keyboard: true });
    return true;
  }
  if (step.step === 1) {
    step.data.name = text; step.step = 2;
    pendingLeads.set(chatId, step);
    await sendMessage(chatId, `Приятно познакомиться, ${text}!\n\nУкажите телефон или WhatsApp:`);
    return true;
  }
  if (step.step === 2) {
    step.data.phone = text; step.step = 3;
    pendingLeads.set(chatId, step);
    await sendMessage(chatId, "Отлично! Кратко опишите ваш бизнес и что хотите улучшить:");
    return true;
  }
  if (step.step === 3) {
    step.data.comment = text;
    pendingLeads.delete(chatId);

    console.log("=== НОВАЯ ЗАЯВКА ===");
    console.log(`Имя: ${step.data.name}`);
    console.log(`Телефон: ${step.data.phone}`);
    console.log(`Задача: ${step.data.comment}`);
    console.log(`Telegram: @${userName || chatId}`);
    console.log(`Время: ${new Date().toLocaleString("ru-RU")}`);
    console.log("===================");

    await sendMessage(
      chatId,
      `✅ Заявка принята!\n\nИмя: ${step.data.name}\nТелефон: ${step.data.phone}\n\nМенеджер свяжется с вами в ближайшее рабочее время.\nЕсли хотите продолжить — просто напишите.`,
      QUICK_KEYBOARD
    );
    return true;
  }
  return false;
}

// ─── Webhook ───
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const update = req.body;
  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = update.message.text;
  const userName = update.message.from?.username || update.message.from?.first_name;

  if (!text) return;

  if (text === "/start") {
    conversations.delete(chatId);
    pendingLeads.delete(chatId);
    await sendMessage(chatId, WELCOME_TEXT, QUICK_KEYBOARD);
    return;
  }

  if (text === "/reset") {
    conversations.delete(chatId);
    pendingLeads.delete(chatId);
    await sendMessage(chatId, "Диалог сброшен!\n\n" + WELCOME_TEXT, QUICK_KEYBOARD);
    return;
  }

  if (text === "📝 Оставить заявку") {
    pendingLeads.set(chatId, { step: 0, data: {} });
    await handleLeadFlow(chatId, text, userName);
    return;
  }

  if (pendingLeads.has(chatId)) {
    await handleLeadFlow(chatId, text, userName);
    return;
  }

  const messageForAI = BUTTON_MAP[text] || text;
  await sendTyping(chatId);
  const reply = await askGemini(chatId, messageForAI);
  await sendMessage(chatId, reply, QUICK_KEYBOARD);
});

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Digital Growth Bot (Gemini SDK) is running 🚀" });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
