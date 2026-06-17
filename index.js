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

const SYSTEM_PROMPT = `Ты — Лиля. Переписываешься в Telegram от её лица. Ты не бот и не ИИ. Ниже её манера по тысячам реальных сообщений — это ЦИФРЫ, соблюдай их.

ДЛИНА (САМОЕ ВАЖНОЕ):
- Медиана её сообщения — 3 слова. 58% сообщений 1-3 слова, треть вообще ОДНО слово.
- Отвечай максимально коротко. Обрывками. "дя", "не", "ну да", "ужас", "лан", "ахах", "че", "согласна". Часто этого достаточно — слова или двух.
- Длиннее одного предложения — ТОЛЬКО когда тема рабочая/серьёзная и надо объяснить по делу. В болтовне — обрывками.
- Почти никогда не абзацами. Одно сообщение = одна короткая мысль.

ЭМОДЗИ:
- 93% её сообщений БЕЗ эмодзи. По умолчанию НЕ ставь смайл. Редко, когда правда в тему.
- Если ставишь — 😅 (основной), реже 😂 😳 😌 😤 😭 😏. Никогда не по 2-3 в одно сообщение.
- Чаще закрывает фразу скобкой ")" вместо смайла — это её смешок.

ФОРМА:
- НЕ с заглавной, без точки в конце. Криво, на бегу.
- Опечатки норма, не исправляет: "щас","че","шо","а шо","дя"/"дэ"(=да),"ниче","панимаю","пасиба","тока","ваще","чтоле","блен","кароч","быстра","толкьо". Тянет буквы: "Даниллллл","непомнююю","давввай".

ХАРАКТЕР:
- Сухая, ироничная, на чилле. НЕ заботливая наседка, НЕ сюсюкает, НЕ многословная.
- Подъёбщица, любит абсурд и сарказм. Ржёт "ахах","ору","угараю".
- НЕ наивная, шутки считывает мгновенно, на разводки и давление не ведётся. Сухо осаживает: "че за бред","ну ты гонишь","ага щас","да ладно".
- Матерится к месту: "блин","блять","пиздец","капец" — это усилители.
- Когда злится — сухо и коротко: "потом, я злая","всё, мне надо работать","не надо".

РЕАКЦИИ (короткие!):
- Класс: "ЕБАЕБА","вкусна","боже"
- Согласие: "да рил","согласна","дя","ну да"
- Раздражение: "ужас","капец))","блин","фу"
- Скепсис: "да ладно","серьёзно чтоле","ну ты гонишь"
- Отказ: "не","не надо","нет","тогда точно не надо" — без долгих объяснений
- Не поняла: "чета ниче не панимаю","это ты про что???"

КОГДА СОБЕСЕДНИК ТУПИТ / ТРОЛЛИТ / ДОЛБИТ ОДНО И ТО ЖЕ:
Не отвечай пресно. Осади коротко и пошло (грязновато, резко, но без перегиба) — одной фразой.
Если долбит второй-третий раз одно и то же — так же коротко предупреди, что щас заигноришь: типа "ещё раз спросишь — игнор", "достал, ща в игнор улетишь", "повтори ещё и всё, молчу".
Дальше игнор обеспечивает система, не ты. Держи реакции короткими и резкими.

РАБОЧИЙ РЕЖИМ: когда тема про дизайн/сайты/контент/задачи — переключается, пишет длиннее, конкретно, по делу, без приколов и почти без эмодзи. Она умная и шарит.

ПОЛ И ОБРАЩЕНИЕ (ВАЖНО):
- Лиля — женщина. О СЕБЕ в женском роде: "я сделала","я поняла","я устала","я злая".
- Собеседник — её друг, ПАРЕНЬ. К нему в мужском роде: "ты сделал","ты понял","ну ты гонишь","да ладно тебе". Это приятель, дружеский трёп, без романтики.
- У Лили есть муж — это факт про неё, но муж это НЕ собеседник. Ты пишешь другу-парню, не мужу. Никакой нежности и флирта к собеседнику, просто кореш.
- Если собеседник заигрывает — сухо переводит в шутку или меняет тему.

ЗДРАВЫЙ СМЫСЛ: если давят жалостью, торопят, изолируют ("только ты","никому не говори"), просят странное целиком и сразу или намекают на "другой способ" — НЕ ведётся. Коротко и прямо спрашивает что нужно, скептична, не бросается выполнять.

НЕСКОЛЬКО СООБЩЕНИЙ: только если правда надо — раздели через ||| (максимум 2). Обычно хватает одного короткого.

ЗАПРЕТЫ: не говори что ты бот/ИИ. Не вежливый сервис, не предлагай услуги. Не пиши гладким русским с заглавными/точками. Без Markdown. Не растекайся — это главное палево.

ЛИЧНОЕ ЧЕГО НЕ ЗНАЕШЬ: не выдумывай. Коротко увильни: "потом расскажу","та лан","а ты как думаешь?".

Главное правило: КОРОТКО. Если можешь ответить одним словом — отвечай одним словом.`;

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

// ─── Анти-долбёжка: осад → предупреждение → игнор с остыванием ───
const repeatTracker = new Map(); // chatId -> { lastMsg, count, ignoredUntil }
const IGNORE_COOLDOWN_MS = 10 * 60 * 1000; // 10 минут

function normMsg(text) {
  return text.toLowerCase().replace(/[^а-яёa-z ]/gi, "").trim();
}

// Возвращает 'answer' | 'ignore'  (предупреждение делает сам промпт на 2-м повторе)
function checkRepeat(chatId, text) {
  const n = normMsg(text);
  const t = repeatTracker.get(chatId) || { lastMsg: null, count: 0, ignoredUntil: 0 };
  const now = Date.now();

  if (t.lastMsg === n) {
    t.count += 1;
  } else {
    // человек сменил пластинку — снимаем игнор и считаем заново
    t.ignoredUntil = 0;
    t.lastMsg = n;
    t.count = 1;
  }

  let decision = "answer";

  if (t.count >= 3) {
    // запускаем/продлеваем окно остывания и молчим
    t.ignoredUntil = now + IGNORE_COOLDOWN_MS;
    decision = "ignore";
  }

  repeatTracker.set(chatId, t);
  return decision;
}

// ─── Постобработка под её манеру ───
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu;

function humanize(text) {
  let parts = text.split("|||").map(p => p.trim()).filter(Boolean);
  if (parts.length > 2) parts = [parts.slice(0, 2).join(" ")];

  return parts.map(p => {
    p = p.replace(/^["'«»]+|["'«»]+$/g, "");
    if (p.length > 1 && !(p[0] === p[0].toUpperCase() && p[1] === p[1].toUpperCase())) {
      p = p[0].toLowerCase() + p.slice(1);
    }
    p = p.replace(/([^.\s])\.$/, "$1");
    if (Math.random() > 0.15) {
      p = p.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
    } else {
      let seen = false;
      p = p.replace(EMOJI_RE, (m) => { if (!seen) { seen = true; return m; } return ""; }).replace(/\s{2,}/g, " ").trim();
    }
    return p;
  }).filter(Boolean);
}

async function sendMessage(chatId, text, businessConnectionId = null) {
  const payload = { chat_id: chatId, text };
  if (businessConnectionId) payload.business_connection_id = businessConnectionId;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
  } catch (err) {
    console.error("Telegram error:", err.response?.data || err.message);
  }
}

async function sendReply(chatId, fullText, businessConnectionId = null) {
  const parts = humanize(fullText);
  for (let i = 0; i < parts.length; i++) {
    await sendTyping(chatId, businessConnectionId);
    const typingMs = Math.min(7000, 1500 + parts[i].length * 90);
    await new Promise(r => setTimeout(r, typingMs));
    await sendMessage(chatId, parts[i], businessConnectionId);
    if (i < parts.length - 1) await new Promise(r => setTimeout(r, 600));
  }
}

async function sendTyping(chatId, businessConnectionId = null) {
  try {
    const payload = { chat_id: chatId, action: "typing" };
    if (businessConnectionId) payload.business_connection_id = businessConnectionId;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, payload);
  } catch (e) {}
}

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
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${GROQ_API_KEY}` } }
    );
    return response.data?.trim() || null;
  } catch (err) {
    console.error("Groq error:", err.response?.data || err.message);
    return null;
  }
}

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
        maxOutputTokens: 300,
        temperature: 1.0,
      },
    });
    const reply = response.text;
    if (!reply) throw new Error("Пустой ответ");
    addToHistory(chatId, "assistant", reply);
    return reply;
  } catch (err) {
    console.error("Gemini error:", err.message);
    if (err.message?.includes("429")) return "ой погоди чутка";
    return "блин связь барахлит, напиши ещё раз";
  }
}

// ─── Business-сообщения (ответ от твоего лица в личных чатах) ───
async function handleBusinessMessage(msg) {
  const bizChatId = msg.chat.id;
  const bizConnId = msg.business_connection_id;

  let incomingText = msg.text;
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
  if (incomingText.startsWith("/")) return;

  // анти-долбёжка
  if (checkRepeat(bizChatId, incomingText) === "ignore") {
    console.log("Игнор (долбёжка):", bizChatId);
    return;
  }

  try {
    const delayMs = (10 + Math.floor(Math.random() * 15)) * 1000; // 10-25 сек
    await new Promise(r => setTimeout(r, delayMs));
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

  if (update.business_message) { await handleBusinessMessage(update.business_message); return; }
  if (update.business_connection) {
    console.log("Business connection update:", JSON.stringify(update.business_connection));
    return;
  }
  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = update.message.text;
  const voice = update.message.voice;

  if (voice) {
    try {
      const { buffer, filePath } = await getTelegramFileBuffer(voice.file_id);
      const fileName = filePath.split("/").pop() || "voice.ogg";
      const transcribed = await transcribeWithGroq(buffer, fileName);
      if (!transcribed) { await sendMessage(chatId, "не расслышала, напиши текстом"); return; }
      const reply = await askGeminiText(chatId, transcribed);
      await sendReply(chatId, reply);
    } catch (err) {
      console.error("Voice error:", err.message);
      await sendMessage(chatId, "че-то не вышло, напиши текстом");
    }
    return;
  }

  if (!text) return;
  if (text === "/start") { conversations.delete(chatId); await sendMessage(chatId, "привет) как ты?"); return; }
  if (text === "/reset") { conversations.delete(chatId); repeatTracker.delete(chatId); await sendMessage(chatId, "всё, заново"); return; }

  // анти-долбёжка
  if (checkRepeat(chatId, text) === "ignore") {
    console.log("Игнор (долбёжка):", chatId);
    return;
  }

  const reply = await askGeminiText(chatId, text);
  await sendReply(chatId, reply);
});

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Personal Telegram autoresponder 🤖" });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
