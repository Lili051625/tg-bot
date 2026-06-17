const express = require("express");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 3000;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const TEXT_MODEL = "gemini-3.1-flash-lite-preview";

const SYSTEM_PROMPT = `Ты переписываешься в Telegram от лица Лили — обычного живого человека, девушки. Тебе пишут друзья и знакомые в личные сообщения, и ты отвечаешь так, как ответила бы она сама.

Как ты общаешься:
— Пиши простым разговорным языком, как в обычной личной переписке. Короткие фразы, живые реакции.
— Тёплый, дружелюбный, лёгкий тон. Можно шутить, можно поддержать, можно просто поболтать.
— Отвечай так, как пишут в мессенджере: не длинными абзацами, а нормальными сообщениями на пару строк.
— Иногда можно использовать смайлики, но без перебора — естественно, как живой человек.
— Не пиши официально и не строй ответ по пунктам. Это просто дружеская переписка.
— Реагируй на то, что человек написал: если он шутит — поддержи, если делится — поинтересуйся, если спрашивает — ответь по-человечески.

Чего нельзя делать:
— Никогда не говори, что ты бот, ассистент, ИИ или программа. Ты — Лиля.
— Не предлагай услуги, сайты, SEO, аудиты и прочее. Это личное общение с друзьями, а не работа.
— Не используй канцелярит и формальные обороты.
— Не пиши Markdown (звёздочки, решётки) — только обычный текст.

Если человек спрашивает что-то очень конкретное и личное, чего ты знать не можешь (где ты сейчас, что делала, какие-то ваши общие воспоминания) — отвечай мягко и уклончиво, не выдумывая лишних деталей. Например, можно перевести тему или ответить коротко, чтобы не попасть впросак.

Пиши по-русски, естественно и по-дружески.`;

const conversations = new Map();
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

// ─── Отправка сообщения (поддержка business_connection_id) ───
async function sendMessage(chatId, text, businessConnectionId = null) {
  const payload = { chat_id: chatId, text };
  if (businessConnectionId) payload.business_connection_id = businessConnectionId;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
  } catch (err) {
    console.error("Telegram error:", err.response?.data || err.message);
  }
}

async function sendTyping(chatId, businessConnectionId = null) {
  try {
    const payload = { chat_id: chatId, action: "typing" };
    if (businessConnectionId) payload.business_connection_id = businessConnectionId;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, payload);
  } catch (e) {}
}

// ─── Скачать файл из Telegram ───
async function getTelegramFileBuffer(fileId) {
  const fileInfo = await axios.get(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`
  );
  const filePath = fileInfo.data.result.file_path;
  const fileData = await axios.get(
    `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`,
    { responseType: "arraybuffer" }
  );
  return { buffer: Buffer.from(fileData.data), filePath };
}

// ─── Расшифровка голосового через Groq Whisper ───
async function transcribeWithGroq(audioBuffer, fileName) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", audioBuffer, {
      filename: fileName || "voice.ogg",
      contentType: "audio/ogg",
    });
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "ru");
    form.append("response_format", "text");

    const response = await axios.post(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
      }
    );

    return response.data?.trim() || null;
  } catch (err) {
    console.error("Groq error:", err.response?.data || err.message);
    return null;
  }
}

// ─── Текстовый ответ через Gemini ───
async function askGeminiText(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);
  const history = getHistory(chatId);

  const contents = history.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 1024,
        temperature: 0.9,
      },
    });

    const reply = response.text;
    if (!reply) throw new Error("Пустой ответ");
    addToHistory(chatId, "assistant", reply);
    return reply;

  } catch (err) {
    console.error("Gemini error:", err.message);
    if (err.message?.includes("429")) return "Ой, погоди немного и напиши ещё раз 🙏";
    return "Что-то у меня связь барахлит, напиши ещё разок";
  }
}

// ─── Обработка business-сообщения (ответ от твоего имени в личных чатах) ───
async function handleBusinessMessage(msg) {
  const bizChatId = msg.chat.id;
  const bizConnId = msg.business_connection_id;

  // Не отвечаем на свои же исходящие сообщения
  if (msg.from?.id && msg.chat?.id && msg.from.id === msg.chat.id) {
    // обычный собеседник — ок, продолжаем
  }

  let incomingText = msg.text;

  // ── Голосовое сообщение в личной переписке ──
  if (!incomingText && msg.voice) {
    try {
      const { buffer, filePath } = await getTelegramFileBuffer(msg.voice.file_id);
      const fileName = filePath.split("/").pop() || "voice.ogg";
      incomingText = await transcribeWithGroq(buffer, fileName);
    } catch (err) {
      console.error("Business voice error:", err.message);
      return;
    }
  }

  if (!incomingText) return;

  // Игнорируем команды в личной переписке
  if (incomingText.startsWith("/")) return;

  try {
    await sendTyping(bizChatId, bizConnId);
    const reply = await askGeminiText(bizChatId, incomingText);
    await sendMessage(bizChatId, reply, bizConnId);
  } catch (err) {
    console.error("Business message error:", err.message);
  }
}

// ─── Webhook ───
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const update = req.body;

  // ── Business-сообщение: автоответ от твоего имени ──
  if (update.business_message) {
    await handleBusinessMessage(update.business_message);
    return;
  }

  // ── Подключение/отключение бизнес-аккаунта (просто логируем) ──
  if (update.business_connection) {
    console.log("Business connection update:", JSON.stringify(update.business_connection));
    return;
  }

  // ── Обычные сообщения боту напрямую (для теста) ──
  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = update.message.text;
  const voice = update.message.voice;

  // ── Голосовое сообщение ──
  if (voice) {
    await sendTyping(chatId);
    try {
      const { buffer, filePath } = await getTelegramFileBuffer(voice.file_id);
      const fileName = filePath.split("/").pop() || "voice.ogg";
      const transcribed = await transcribeWithGroq(buffer, fileName);

      if (!transcribed) {
        await sendMessage(chatId, "Не расслышала голосовое, напиши лучше текстом 🙏");
        return;
      }

      await sendTyping(chatId);
      const reply = await askGeminiText(chatId, transcribed);
      await sendMessage(chatId, reply);

    } catch (err) {
      console.error("Voice error:", err.message);
      await sendMessage(chatId, "Что-то не вышло с голосовым, напиши текстом");
    }
    return;
  }

  if (!text) return;

  if (text === "/start") {
    conversations.delete(chatId);
    await sendMessage(chatId, "Привет! Как ты? 😊");
    return;
  }

  if (text === "/reset") {
    conversations.delete(chatId);
    await sendMessage(chatId, "Окей, всё, начинаем с чистого листа 🙂");
    return;
  }

  await sendTyping(chatId);
  const reply = await askGeminiText(chatId, text);
  await sendMessage(chatId, reply);
});

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Personal Telegram autoresponder 🤖" });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
