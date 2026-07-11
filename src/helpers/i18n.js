import { escapeHtml } from './html.js';

const safeBotUsername = (botUsername) => escapeHtml(botUsername || 'YourBot');

const translations = {
  en: {
    welcomeMessage: (botUsername) => `<b>whisper tank bot</b>

send secret messages that only specific people can read.

<b>how to use:</b>
• type <code>@${safeBotUsername(botUsername)}</code> in any chat
• add recipient: <code>@username</code> or user id
• write your secret message

<b>examples:</b>
<code>@${safeBotUsername(botUsername)} @friend hello!</code> — only @friend can read
<code>@${safeBotUsername(botUsername)} secret text @friend</code> — everyone except @friend

secrets expire after 6 hours.

<code>by @blaar × @club5926</code>`,
    
    langChanged: 'language changed to english',
    startCooldown: (seconds) => `please wait ${seconds}s`,
    
    usageTitle: 'How to send a whisper?',
    usageHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend hello — secret for @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> hello @friend — hidden from @friend',
    tooLongTitle: 'Too long: max 200 characters',
    tooLongHint: 'Secret is too long. Max 200 characters.',
    invalidTargetHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend hello — secret for @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> hello @friend — hidden from @friend',
    targetUnavailableTitle: 'Cannot verify recipient',
    targetUnavailableHint: (target) => `I cannot safely verify ${target}. Ask them to start the bot or use their numeric user ID.`,
    storageUnavailableTitle: 'Cannot create secret',
    storageUnavailableHint: 'Temporary storage is unavailable. Please try again later.',
    
    rateLimitTitle: 'Too many requests',
    rateLimitDescription: (seconds) => `Please wait ${seconds} seconds before sending more whispers`,
    rateLimitMessage: (seconds) => `Rate limit exceeded. Please wait ${seconds} seconds.`,
    
    whisperTo: (target) => `Whisper to ${target}`,
    hiddenFrom: (target) => `Hidden from ${target}`,
    inlineDescriptionFor: (target) => `Only ${target} can read it`,
    inlineDescriptionExcept: (target) => `Everyone except ${target} can read it`,
    secretMessageFor: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Secret message for ${target} – <b>tap to read</b>`,
    secretMessageExcept: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Secret message (everyone except ${target}) – <b>tap to read</b>`,
    userWithIdTitle: (id) => `user (ID ${id})`,
    userWithIdMessage: (id) => `user (ID <code>${id}</code>)`,
    
    secretNotFound: 'Secret not found or expired',
    secretExcludesYou: 'This secret excludes you',
    secretNotForYou: 'This secret is not for you',
    unableToVerify: 'Unable to verify your identity',
    secretSentDM: 'Secret sent to you in a private message',
    secretDeliveryFailed: 'Could not deliver the full secret. Start the bot and try again.',
    secretAlreadyRead: '<s>Secret message already read</s>',
    statsUsage: 'usage: /stats YYYY-MM-DD',
    statsAdminOnly: 'This command is for admins only.',
    statsReport: (d) => {
      const labels = { private: 'DM', group: 'groups', supergroup: 'supergroups', channel: 'channels', unknown: 'other' };
      const trend = d.hasPrev ? (d.delta > 0 ? ` (▲ +${d.delta})` : d.delta < 0 ? ` (▼ ${d.delta})` : ' (▬ 0)') : '';
      const chat = d.chatEntries.length ? d.chatEntries.map(([k, c]) => `${labels[k] || k} ${c}`).join(' · ') : '—';
      return [
        `📊 <b>Whisper — ${d.date}</b>`,
        ``,
        `✉️ Secrets created: <b>${d.total}</b>${trend}`,
        `   • for recipient: ${d.modeFor} · except recipient: ${d.modeExcept}`,
        `👤 Unique authors: ${d.authors} · recipients: ${d.targets}`,
        ``,
        `👀 Reads: <b>${d.delivered}</b> delivered${d.readsTotal ? ` (${d.successPct}% of ${d.readsTotal} attempts)` : ''}`,
        `   • blocked ${d.blocked} · expired ${d.expired}`,
        ``,
        `📝 Length: avg ${d.avgLen} chars · median ~${d.median}`,
        `💬 Chats: ${chat}`,
        `⚠️ Errors: ${d.errTotal} (parse ${d.errParse} · rate limit ${d.errRate} · other ${d.errOther})`,
      ].join('\n');
    },
    
    readButton: 'Read',
  },
  
  ru: {
    welcomeMessage: (botUsername) => `<b>whisper tank bot</b>

отправляй секретные сообщения, которые смогут прочитать только определённые люди.

<b>как использовать:</b>
• напиши <code>@${safeBotUsername(botUsername)}</code> в любом чате
• добавь получателя: <code>@username</code> или id
• напиши своё секретное сообщение

<b>примеры:</b>
<code>@${safeBotUsername(botUsername)} @friend привет!</code> — прочитает только @friend
<code>@${safeBotUsername(botUsername)} секрет @friend</code> — все кроме @friend

секреты исчезают через 6 часов.

<code>by @blaar × @club5926</code>`,
    
    langChanged: 'язык изменён на русский',
    startCooldown: (seconds) => `подожди ${seconds} сек.`,
    
    usageTitle: 'Как отправить секрет?',
    usageHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend привет — секрет для @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> привет @friend — секрет от @friend',
    tooLongTitle: 'Слишком длинный: макс. 200 символов',
    tooLongHint: 'Секрет слишком длинный. Максимум 200 символов.',
    invalidTargetHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend привет — секрет для @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> привет @friend — секрет от @friend',
    targetUnavailableTitle: 'Не могу проверить получателя',
    targetUnavailableHint: (target) => `Не могу безопасно проверить ${target}. Попроси пользователя запустить бота или используй числовой ID.`,
    storageUnavailableTitle: 'Не могу создать секрет',
    storageUnavailableHint: 'Временное хранилище недоступно. Попробуй позже.',
    
    rateLimitTitle: 'Слишком много запросов',
    rateLimitDescription: (seconds) => `Подождите ${seconds} сек. перед отправкой новых секретов`,
    rateLimitMessage: (seconds) => `Превышен лимит запросов. Подождите ${seconds} сек.`,
    
    whisperTo: (target) => `Секрет для ${target}`,
    hiddenFrom: (target) => `Скрыто от ${target}`,
    inlineDescriptionFor: (target) => `прочитает только ${target}`,
    inlineDescriptionExcept: (target) => `прочитают все кроме ${target}`,
    secretMessageFor: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Секретное сообщение для ${target} – <b>нажми чтобы прочитать</b>`,
    secretMessageExcept: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Секретное сообщение (все кроме ${target}) – <b>нажми чтобы прочитать</b>`,
    userWithIdTitle: (id) => `пользователь (ID ${id})`,
    userWithIdMessage: (id) => `пользователь (ID <code>${id}</code>)`,
    
    secretNotFound: 'Секрет не найден или истёк',
    secretExcludesYou: 'Этот секрет скрыт от тебя',
    secretNotForYou: 'Этот секрет не для тебя',
    unableToVerify: 'Не удалось подтвердить личность',
    secretSentDM: 'Секрет отправлен тебе в личные сообщения',
    secretDeliveryFailed: 'Не удалось доставить полный секрет. Запусти бота и попробуй ещё раз.',
    secretAlreadyRead: '<s>Секретное сообщение уже прочитано</s>',
    statsUsage: 'использование: /stats YYYY-MM-DD',
    statsAdminOnly: 'Команда доступна только администраторам.',
    statsReport: (d) => {
      const labels = { private: 'личка', group: 'группы', supergroup: 'супергруппы', channel: 'каналы', unknown: 'прочее' };
      const trend = d.hasPrev ? (d.delta > 0 ? ` (▲ +${d.delta})` : d.delta < 0 ? ` (▼ ${d.delta})` : ' (▬ 0)') : '';
      const chat = d.chatEntries.length ? d.chatEntries.map(([k, c]) => `${labels[k] || k} ${c}`).join(' · ') : '—';
      return [
        `📊 <b>Whisper — ${d.date}</b>`,
        ``,
        `✉️ Секретов создано: <b>${d.total}</b>${trend}`,
        `   • для получателя: ${d.modeFor} · кроме получателя: ${d.modeExcept}`,
        `👤 Уникальных авторов: ${d.authors} · получателей: ${d.targets}`,
        ``,
        `👀 Прочтений: <b>${d.delivered}</b> доставлено${d.readsTotal ? ` (${d.successPct}% из ${d.readsTotal} попыток)` : ''}`,
        `   • заблокировано ${d.blocked} · истекло ${d.expired}`,
        ``,
        `📝 Длина: в среднем ${d.avgLen} симв. · медиана ~${d.median}`,
        `💬 Чаты: ${chat}`,
        `⚠️ Ошибки: ${d.errTotal} (разбор ${d.errParse} · лимит ${d.errRate} · прочие ${d.errOther})`,
      ].join('\n');
    },
    
    readButton: 'Прочитать',
  },
  
  uk: {
    welcomeMessage: (botUsername) => `<b>whisper tank bot</b>

надсилай секретні повідомлення, які зможуть прочитати лише певні люди.

<b>як використовувати:</b>
• напиши <code>@${safeBotUsername(botUsername)}</code> у будь-якому чаті
• додай отримувача: <code>@username</code> або id
• напиши своє секретне повідомлення

<b>приклади:</b>
<code>@${safeBotUsername(botUsername)} @friend привіт!</code> — прочитає лише @friend
<code>@${safeBotUsername(botUsername)} секрет @friend</code> — усі крім @friend

секрети зникають через 6 годин.

<code>by @blaar × @club5926</code>`,
    
    langChanged: 'мову змінено на українську',
    startCooldown: (seconds) => `зачекай ${seconds} сек.`,
    
    usageTitle: 'Як надіслати секрет?',
    usageHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend привіт — секрет для @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> привіт @friend — секрет від @friend',
    tooLongTitle: 'Занадто довгий: макс. 200 символів',
    tooLongHint: 'Секрет занадто довгий. Максимум 200 символів.',
    invalidTargetHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend привіт — секрет для @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> привіт @friend — секрет від @friend',
    targetUnavailableTitle: 'Не можу перевірити отримувача',
    targetUnavailableHint: (target) => `Не можу безпечно перевірити ${target}. Попроси користувача запустити бота або використай числовий ID.`,
    storageUnavailableTitle: 'Не можу створити секрет',
    storageUnavailableHint: 'Тимчасове сховище недоступне. Спробуй пізніше.',
    
    rateLimitTitle: 'Забагато запитів',
    rateLimitDescription: (seconds) => `Зачекайте ${seconds} сек. перед надсиланням нових секретів`,
    rateLimitMessage: (seconds) => `Перевищено ліміт запитів. Зачекайте ${seconds} сек.`,
    
    whisperTo: (target) => `Секрет для ${target}`,
    hiddenFrom: (target) => `Приховано від ${target}`,
    inlineDescriptionFor: (target) => `прочитає лише ${target}`,
    inlineDescriptionExcept: (target) => `прочитають усі крім ${target}`,
    secretMessageFor: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Секретне повідомлення для ${target} – <b>натисни щоб прочитати</b>`,
    secretMessageExcept: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Секретне повідомлення (всі крім ${target}) – <b>натисни щоб прочитати</b>`,
    userWithIdTitle: (id) => `користувач (ID ${id})`,
    userWithIdMessage: (id) => `користувач (ID <code>${id}</code>)`,
    
    secretNotFound: 'Секрет не знайдено або закінчився термін',
    secretExcludesYou: 'Цей секрет приховано від тебе',
    secretNotForYou: 'Цей секрет не для тебе',
    unableToVerify: 'Не вдалося підтвердити особу',
    secretSentDM: 'Секрет надіслано тобі в особисті повідомлення',
    secretDeliveryFailed: 'Не вдалося доставити повний секрет. Запусти бота і спробуй ще раз.',
    secretAlreadyRead: '<s>Секретне повідомлення вже прочитано</s>',
    statsUsage: 'використання: /stats YYYY-MM-DD',
    statsAdminOnly: 'Команда доступна лише адміністраторам.',
    statsReport: (d) => {
      const labels = { private: 'особисті', group: 'групи', supergroup: 'супергрупи', channel: 'канали', unknown: 'інше' };
      const trend = d.hasPrev ? (d.delta > 0 ? ` (▲ +${d.delta})` : d.delta < 0 ? ` (▼ ${d.delta})` : ' (▬ 0)') : '';
      const chat = d.chatEntries.length ? d.chatEntries.map(([k, c]) => `${labels[k] || k} ${c}`).join(' · ') : '—';
      return [
        `📊 <b>Whisper — ${d.date}</b>`,
        ``,
        `✉️ Секретів створено: <b>${d.total}</b>${trend}`,
        `   • для отримувача: ${d.modeFor} · окрім отримувача: ${d.modeExcept}`,
        `👤 Унікальних авторів: ${d.authors} · отримувачів: ${d.targets}`,
        ``,
        `👀 Прочитань: <b>${d.delivered}</b> доставлено${d.readsTotal ? ` (${d.successPct}% з ${d.readsTotal} спроб)` : ''}`,
        `   • заблоковано ${d.blocked} · протерміновано ${d.expired}`,
        ``,
        `📝 Довжина: у середньому ${d.avgLen} симв. · медіана ~${d.median}`,
        `💬 Чати: ${chat}`,
        `⚠️ Помилки: ${d.errTotal} (розбір ${d.errParse} · ліміт ${d.errRate} · інші ${d.errOther})`,
      ].join('\n');
    },
    
    readButton: 'Прочитати',
  },
};

const DEFAULT_LANG = 'en';
const SUPPORTED_LANGS = ['en', 'ru', 'uk'];

export function detectLang(languageCode) {
  if (!languageCode) return DEFAULT_LANG;
  const lang = languageCode.toLowerCase().slice(0, 2);
  return SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

export function t(key, lang = DEFAULT_LANG) {
  const langData = translations[lang] || translations[DEFAULT_LANG];
  const value = langData[key] ?? translations[DEFAULT_LANG][key];
  if (value === undefined) {
    throw new Error(`Missing translation: ${key}`);
  }
  return value;
}

export function validateTranslations() {
  const issues = [];
  const baseEntries = Object.entries(translations[DEFAULT_LANG]);
  const baseKeys = baseEntries.map(([key]) => key);

  for (const lang of SUPPORTED_LANGS) {
    const langData = translations[lang];
    if (!langData) {
      issues.push(`${lang}: missing language`);
      continue;
    }

    for (const [key, baseValue] of baseEntries) {
      if (!(key in langData)) {
        issues.push(`${lang}: missing key ${key}`);
        continue;
      }
      if (typeof langData[key] !== typeof baseValue) {
        issues.push(`${lang}: key ${key} has type ${typeof langData[key]}, expected ${typeof baseValue}`);
      }
    }

    for (const key of Object.keys(langData)) {
      if (!baseKeys.includes(key)) {
        issues.push(`${lang}: extra key ${key}`);
      }
    }
  }

  return issues;
}

export { translations, DEFAULT_LANG, SUPPORTED_LANGS };
