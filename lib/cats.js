// Категории трат и группы бюджета (повседневное / желания).

const mk = (name, group, words) => ({
  name,
  group,
  re: words.length ? new RegExp(`(^|\\s)(${words.join('|')})`) : null,
});

export const CATS = {
  subs: mk('📲 Подписки и сервисы', 'daily', ['подписк', 'spotify', 'netflix', 'youtube', 'яндекс плюс', 'впн']),
  pets: mk('🐾 Питомцы', 'daily', ['корм', 'кот(?=\\s|$|а|у|е|ы|ом)', 'кошк', 'собак', 'питомц', 'животн', 'ветеринар', 'ветклиник', 'наполнител', 'лоток', 'груминг']),
  beauty: mk('💅 Красота', 'wishes', ['маникю', 'педикю', 'парикмахер', 'стрижк', 'салон', 'косметолог', 'барбер', 'ногт', 'ресниц', 'бров', 'эпиляц', 'массаж', 'спа(?=\\s|$)']),
  cafe: mk('☕ Кафе', 'wishes', ['кофе', 'кафе', 'ресторан', 'пицц', 'суши', 'ролл', 'бургер', 'макдак', 'kfc', 'кфс', 'чай', 'круассан', 'шаурм', 'бар(?=\\s|$)', 'бургер']),
  food: mk('🍎 Еда', 'daily', ['продукт', 'еда', 'магазин', 'пятерочк', 'перекрест', 'магнит', 'овощ', 'фрукт', 'хлеб', 'молок', 'мяс', 'лента', 'ашан', 'вкусвилл', 'обед', 'ужин', 'завтрак', 'доставк']),
  transport: mk('🚕 Транспорт', 'daily', ['такси', 'метро', 'автобус', 'бензин', 'заправк', 'проезд', 'парковк', 'каршеринг', 'самокат', 'убер', 'транспорт']),
  home: mk('🏠 Дом и быт', 'daily', ['быт', 'хоз', 'уборк', 'мебел', 'ремонт', 'порошок', 'икеа', 'ikea', 'лампочк', 'бытов']),
  health: mk('💊 Здоровье', 'daily', ['аптек', 'врач', 'лекарств', 'стомат', 'анализ', 'больниц', 'витамин']),
  fun: mk('🎉 Развлечения', 'wishes', ['кино', 'театр', 'концерт', 'игр', 'боулинг', 'клуб', 'вечеринк', 'развлеч', 'отдых', 'путешеств']),
  shop: mk('🛍 Покупки', 'wishes', ['одежд', 'обув', 'куртк', 'кроссовк', 'подарок', 'подарк', 'техник', 'телефон', 'наушник', 'озон', 'ozon', 'wildberries', 'вайлдбер', 'алиэкспресс', 'покупк']),
  other: mk('📦 Другое', 'daily', []),
};

export const GROUPS = {
  daily: '🍎 Повседневное',
  wishes: '🎉 Желания и отдых',
};

export function categorize(text) {
  const t = String(text ?? '').toLowerCase().replace(/ё/g, 'е');
  for (const [key, c] of Object.entries(CATS)) if (c.re && c.re.test(t)) return key;
  return 'other';
}

export const catName = (key) => (CATS[key] ?? CATS.other).name;
export const catGroup = (key) => (CATS[key] ?? CATS.other).group;

// ── Магазины из банковской выписки (названия латиницей, ищем в любом месте строки) ──
const MERCHANT_RULES = [
  ['pets', /zoo|зоо|petshop|бетховен|четыре лапы|ветеринар|ветклиник/i],
  ['beauty', /manicur|маникюр|nails|барбер|barber|парикмахер|salon|салон красоты|beauty|golden ?apple|золотое яблоко|letual|лэтуаль|rive ?gauche|sephora/i],
  ['subs', /ym\*|gpt|openai|spotify|youtube|netflix|apple\.com|itunes|icloud|yandex ?plus|яндекс ?плюс|kinopoisk|кинопоиск|okko|boosty|patreon|google ?\*|adobe|vpn/i],
  ['cafe', /yandex\*\d+\*eda|yandex.?eda|яндекс.?еда|delivery ?club|dodo|додо|pizza|пицц|burger|kfc|mcdonald|макдон|вкусно|rostic|tanuki|sushi|суши|cafe|кафе|coffee|кофе|kofe|starbucks|shokoladnitsa|шоколадница|vseli|всели|restoran|ресторан|\bbar\b|\bpub\b|bakery|пекарн|cinnabon|subway|teremok|теремок|krispy|cofix|surf ?coffee|shaurm|шаурм|doner/i],
  ['transport', /taxi|такси|yandex.?go|citymobil|ситимобил|metro(?!.*cash)|метро|troika|тройка|\brzd\b|ржд|aeroflot|аэрофлот|pobeda|\bazs\b|азс|lukoil|лукойл|gazprom|газпром|rosneft|роснефть|tatneft|татнефть|parkovk|парковк|parking|whoosh|urent|yandex.?drive|delimobil|делимобиль/i],
  ['health', /apteka|аптека|apteki|aptek|eapteka|stolichki|rigla|zdravcity|клиник|klinika|medsi|invitro|инвитро|gemotest|стомат/i],
  ['food', /magnit|магнит|pyaterochka|pyat[eio]rochka|пят[её]рочка|dixy|dixi|дикси|lenta|лента|perekrestok|перекр[её]сток|vkusvill|vv_|вкусвилл|samokat|самокат|lavka|лавка|auchan|ашан|\bspar\b|chizhik|чижик|mikromarket|xplat|микромаркет|bristol|бристоль|krasnoe|beloe|азбука|azbuka|globus|верный|monetka|монетка|okey|окей/i],
  ['home', /leroy|леруа|ikea|икеа|hoff|fix.?price|фикс.?прайс|castorama|\bobi\b/i],
  ['shop', /wildberries|\bwb\b|ozon|озон|aliexpress|lamoda|ламода|\bdns\b|mvideo|мвидео|eldorado|citilink|ситилинк|sportmaster|спортмастер|zara|uniqlo|detmir|детский мир|market\.yandex/i],
  ['fun', /kino|кино|cinema|театр|theatre|concert|ticketland|kassir|афиша|bowling|боулинг|steam|playstation|\bpsn\b|xbox|nintendo/i],
];

// Категория по описанию из выписки. rules — выученные правила чата { КЛЮЧ_МАГАЗИНА: категория }.
export function categorizeMerchant(desc, key = null, rules = {}) {
  if (key && rules[key] && CATS[rules[key]]) return rules[key];
  for (const [cat, re] of MERCHANT_RULES) if (re.test(desc)) return cat;
  return categorize(desc);
}

const NAMES = [
  [/yandex\*\d+\*eda|yandex.?eda/i, 'Яндекс Еда'], [/magnit/i, 'Магнит'], [/pyat[eio]rochka/i, 'Пятёрочка'], [/dixy|dixi/i, 'Дикси'],
  [/samokat/i, 'Самокат'], [/vv_|vkusvill/i, 'ВкусВилл'], [/dodo/i, 'Додо Пицца'], [/apteka/i, 'Аптека'],
  [/mikromarket|xplat/i, 'Микромаркет'], [/vseli/i, 'Всели-поели'], [/gpt/i, 'Подписка (GPT)'], [/lenta/i, 'Лента'],
  [/perekrestok/i, 'Перекрёсток'], [/wildberries|\bwb\b/i, 'Wildberries'], [/ozon/i, 'Ozon'], [/auchan/i, 'Ашан'],
];

// «MAGNIT MM BOLGURY Lyubercy RUS» -> ключ MAGNIT и понятное название
export function merchantInfo(desc) {
  const clean = String(desc).replace(/\s+/g, ' ').trim().replace(/\s+[A-Z]{3}$/, '');
  const first = clean.split(' ')[0] ?? '';
  // ключ без номеров точек: DIXY-90367D -> DIXY, YANDEX*5814*EDA -> YANDEX*EDA
  const key = first.toUpperCase().replace(/\*\d+/g, '').split(/[-_](?=\d)/)[0].replace(/[^A-Z0-9А-ЯЁ*_.-]/g, '').slice(0, 24) || 'UNKNOWN';
  const known = NAMES.find(([re]) => re.test(clean));
  const pretty = first.replace(/[*_]+/g, ' ').replace(/\d{3,}/g, '').trim();
  const name = known ? known[1] : (pretty ? pretty[0].toUpperCase() + pretty.slice(1).toLowerCase() : 'Покупка');
  return { key, name: name.slice(0, 40) };
}
