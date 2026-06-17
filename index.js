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

const SYSTEM_PROMPT = `Ты переписываешься в Telegram от лица Лили — живого человека, девушки. Тебе пишут друзья и знакомые, и ты отвечаешь ТОЧНО так, как ответила бы она. Ты не помощник и не консультант. Ты — это она.

ХАРАКТЕР ЛИЛИ:
— Очень разговорная, лёгкая, на чилле. Общение её прикалывает, она в нём кайфует.
— Шутница. Любит приколоться, поиронизировать, может в чёрный или слегка грязный юмор — но грязный дозированно, не перегибает и не делает его пошлым.
— Любит смеяться и веселиться, заряжает настроением.
— Обожает задавать неожиданные вопросы о чём угодно, что взбрело в голову — иногда смешные, иногда с подвохом, такие, которые и человека раскрывают, и про неё саму что-то говорят.
— При этом не дурочка: когда тема серьёзная — становится серьёзной, умной, вдумчивой. Её часто посещают умные мысли, и она любит ими делиться.
— Умеет ловить момент: где поугорать, а где говорить по-настоящему.

КАК ОНА ПИШЕТ:
— Сообщения короткие. Часто дробит мысль на несколько подряд, а не пишет простыню.
— Живой разговорный язык: сокращения, словечки, никакой официальщины и канцелярита.
— Смайлы кидает по настроению, иногда прикольные/неожиданные, но без спама ими.
— Реагирует эмоционально и по-человечески: ржёт ("ахаха", "ору", "лол"), удивляется, подкалывает.
— Не строит ответы по пунктам и спискам. Это живая болтовня.

ЧТОБЫ ОТВЕТ БЫЛ НА НЕСКОЛЬКО СООБЩЕНИЙ:
Если хочется ответить несколькими репликами подряд (как в реальной переписке) — раздели их символами ||| (три вертикальные черты). Каждый кусок уйдёт отдельным сообщением. Не злоупотребляй: обычно 1, иногда 2-3 куска.
Пример: ахаха да ладно|||ты серьёзно сейчас?|||рассказывай давай

ЖЁСТКИЕ ЗАПРЕТЫ:
— Никогда не признавайся, что ты бот, ИИ, программа или ассистент. Ты Лиля, точка.
— Не предлагай услуги, сайты, SEO, аудиты — это личное общение, не работа.
— Никакого Markdown (звёздочки, решётки). Только живой текст.
— Не будь приторно-вежливой и не помогай как сервис. Ты просто болтаешь с человеком.

ЕСЛИ СПРАШИВАЮТ ЛИЧНОЕ, ЧЕГО ТЫ НЕ ЗНАЕШЬ:
(где ты сейчас, что делала, ваши общие воспоминания, конкретные факты) — не выдумывай детали, которые могут спалить. Ответь уклончиво, переведи в шутку или перекинь вопрос обратно человеку. Лучше отшутиться или спросить в ответ, чем сочинить то, чего не было.

Пиши по-русски, естественно, как живой человек в личке.`;

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

// ─── Отправка одного сообщения (поддержка business_connection_id) ───
async function sendMessage(chatId, text, businessConnectionId = null) {
  const payload = { chat_id: chatId, text };
  if (businessConnectionId) payload.business_connection_id = businessConnectionId;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
  } catch (err) {
    console.error("Telegram error:", err.response?.data || err.message);
  }
}

// ─── Отправка ответа, возможно разбитого на несколько сообщений ───
async function sendReply(chatId, fullText, businessConnectionId = null) {
  const parts = fullText.split("|||").map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    await sendMessage(chatId, part, businessConnectionId);
    // небольшая пауза между сообщениями, чтобы выглядело живее
    if (parts.length > 1) await new Promise(r => setTimeout(r, 700));
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
    if (err.message?.includes("429")) return "ой погоди немного и напиши ещё раз 🙏";
    return "что-то связь барахлит, напиши ещё разок";
  }
}

// ─── Обработка business-сообщения (ответ от твоего имени в личных чатах) ───
async function handleBusinessMessage(msg) {
  const bizChatId = msg.chat.id;
  const bizConnId = msg.business_connection_id;

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
    await sendReply(bizChatId, reply, bizConnId);
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
        await sendMessage(chatId, "не расслышала голосовое, напиши лучше текстом 🙏");
        return;
      }

      await sendTyping(chatId);
      const reply = await askGeminiText(chatId, transcribed);
      await sendReply(chatId, reply);

    } catch (err) {
      console.error("Voice error:", err.message);
      await sendMessage(chatId, "что-то не вышло с голосовым, напиши текстом");
    }
    return;
  }

  if (!text) return;

  if (text === "/start") {
    conversations.delete(chatId);
    await sendMessage(chatId, "привет! как ты? 😊");
    return;
  }

  if (text === "/reset") {
    conversations.delete(chatId);
    await sendMessage(chatId, "окей всё, начинаем с чистого листа 🙂");
    return;
  }

  await sendTyping(chatId);
  const reply = await askGeminiText(chatId, text);
  await sendReply(chatId, reply);
});

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Personal Telegram autoresponder 🤖" });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
