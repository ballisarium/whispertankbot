const translations = {
  en: {
    welcomeMessage: (botUsername) => `<b>whisper tank bot</b>

send secret messages that only specific people can read.

<b>how to use:</b>
• type <code>@${botUsername}</code> in any chat
• add recipient: <code>@username</code> or user id
• write your secret message

<b>examples:</b>
<code>@${botUsername} @friend hello!</code> — only @friend can read
<code>@${botUsername} secret text @friend</code> — everyone except @friend

secrets expire after 6 hours.

<code>by @blaar × @club5926</code>`,
    
    welcomeChooseLang: 'choose your language:',
    langChanged: 'language changed to english',
    startCooldown: (seconds) => `please wait ${seconds}s`,
    
    usageTitle: 'How to send a whisper?',
    usageHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend hello — secret for @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> hello @friend — hidden from @friend',
    usageText: () => 'Specify username / ID and text',
    tooLongTitle: 'Too long: max 200 characters',
    tooLongHint: 'Secret is too long. Max 200 characters.',
    invalidTargetHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend hello — secret for @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> hello @friend — hidden from @friend',
    
    rateLimitTitle: 'Too many requests',
    rateLimitDescription: (seconds) => `Please wait ${seconds} seconds before sending more whispers`,
    rateLimitMessage: (seconds) => `Rate limit exceeded. Please wait ${seconds} seconds.`,
    
    whisperTo: (target) => `Whisper to ${target}`,
    hiddenFrom: (target) => `Hidden from ${target}`,
    secretMessageFor: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Secret message for ${target} – <b>tap to read</b>`,
    secretMessageExcept: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Secret message (everyone except ${target}) – <b>tap to read</b>`,
    userWithIdTitle: (id) => `user (ID ${id})`,
    userWithIdMessage: (id) => `user (ID <code>${id}</code>)`,
    
    secretNotFound: 'Secret not found or expired',
    secretExcludesYou: 'This secret excludes you',
    secretNotForYou: 'This secret is not for you',
    unableToVerify: 'Unable to verify your identity',
    secretSentDM: 'Secret sent to you in a private message',
    secretAlreadyRead: '<s>Secret message already read</s>',
    
    readButton: 'Read',
  },
  
  ru: {
    welcomeMessage: (botUsername) => `<b>whisper tank bot</b>

отправляй секретные сообщения, которые смогут прочитать только определённые люди.

<b>как использовать:</b>
• напиши <code>@${botUsername}</code> в любом чате
• добавь получателя: <code>@username</code> или id
• напиши своё секретное сообщение

<b>примеры:</b>
<code>@${botUsername} @friend привет!</code> — прочитает только @friend
<code>@${botUsername} секрет @friend</code> — все кроме @friend

секреты исчезают через 6 часов.

<code>by @blaar × @club5926</code>`,
    
    welcomeChooseLang: 'выбери язык:',
    langChanged: 'язык изменён на русский',
    startCooldown: (seconds) => `подожди ${seconds} сек.`,
    
    usageTitle: 'Как отправить секрет?',
    usageHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend привет — секрет для @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> привет @friend — секрет от @friend',
    usageText: () => 'укажи username / ID и текст',
    tooLongTitle: 'Слишком длинный: макс. 200 символов',
    tooLongHint: 'Секрет слишком длинный. Максимум 200 символов.',
    invalidTargetHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend привет — секрет для @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> привет @friend — секрет от @friend',
    
    rateLimitTitle: 'Слишком много запросов',
    rateLimitDescription: (seconds) => `Подождите ${seconds} сек. перед отправкой новых секретов`,
    rateLimitMessage: (seconds) => `Превышен лимит запросов. Подождите ${seconds} сек.`,
    
    whisperTo: (target) => `Секрет для ${target}`,
    hiddenFrom: (target) => `Скрыто от ${target}`,
    secretMessageFor: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Секретное сообщение для ${target} – <b>нажми чтобы прочитать</b>`,
    secretMessageExcept: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Секретное сообщение (все кроме ${target}) – <b>нажми чтобы прочитать</b>`,
    userWithIdTitle: (id) => `пользователь (ID ${id})`,
    userWithIdMessage: (id) => `пользователь (ID <code>${id}</code>)`,
    
    secretNotFound: 'Секрет не найден или истёк',
    secretExcludesYou: 'Этот секрет скрыт от тебя',
    secretNotForYou: 'Этот секрет не для тебя',
    unableToVerify: 'Не удалось подтвердить личность',
    secretSentDM: 'Секрет отправлен тебе в личные сообщения',
    secretAlreadyRead: '<s>Секретное сообщение уже прочитано</s>',
    
    readButton: 'Прочитать',
  },
  
  uk: {
    welcomeMessage: (botUsername) => `<b>whisper tank bot</b>

надсилай секретні повідомлення, які зможуть прочитати лише певні люди.

<b>як використовувати:</b>
• напиши <code>@${botUsername}</code> у будь-якому чаті
• додай отримувача: <code>@username</code> або id
• напиши своє секретне повідомлення

<b>приклади:</b>
<code>@${botUsername} @friend привіт!</code> — прочитає лише @friend
<code>@${botUsername} секрет @friend</code> — усі крім @friend

секрети зникають через 6 годин.

<code>by @blaar × @club5926</code>`,
    
    welcomeChooseLang: 'обери мову:',
    langChanged: 'мову змінено на українську',
    startCooldown: (seconds) => `зачекай ${seconds} сек.`,
    
    usageTitle: 'Як надіслати секрет?',
    usageHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend привіт — секрет для @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> привіт @friend — секрет від @friend',
    usageText: () => 'вкажи username / ID та текст',
    tooLongTitle: 'Занадто довгий: макс. 200 символів',
    tooLongHint: 'Секрет занадто довгий. Максимум 200 символів.',
    invalidTargetHint: () => '<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> @friend привіт — секрет для @friend\n<tg-emoji emoji-id="6032609071373226027">👥</tg-emoji> привіт @friend — секрет від @friend',
    
    rateLimitTitle: 'Забагато запитів',
    rateLimitDescription: (seconds) => `Зачекайте ${seconds} сек. перед надсиланням нових секретів`,
    rateLimitMessage: (seconds) => `Перевищено ліміт запитів. Зачекайте ${seconds} сек.`,
    
    whisperTo: (target) => `Секрет для ${target}`,
    hiddenFrom: (target) => `Приховано від ${target}`,
    secretMessageFor: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Секретне повідомлення для ${target} – <b>натисни щоб прочитати</b>`,
    secretMessageExcept: (target) => `<tg-emoji emoji-id="5884097155341226387">👁</tg-emoji> Секретне повідомлення (всі крім ${target}) – <b>натисни щоб прочитати</b>`,
    userWithIdTitle: (id) => `користувач (ID ${id})`,
    userWithIdMessage: (id) => `користувач (ID <code>${id}</code>)`,
    
    secretNotFound: 'Секрет не знайдено або закінчився термін',
    secretExcludesYou: 'Цей секрет приховано від тебе',
    secretNotForYou: 'Цей секрет не для тебе',
    unableToVerify: 'Не вдалося підтвердити особу',
    secretSentDM: 'Секрет надіслано тобі в особисті повідомлення',
    secretAlreadyRead: '<s>Секретне повідомлення вже прочитано</s>',
    
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
  return langData[key] || translations[DEFAULT_LANG][key] || key;
}

export { translations, DEFAULT_LANG, SUPPORTED_LANGS };
