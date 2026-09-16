import { COLORS, CATALOG } from './catalog.js';

const GHW_MODULE = 'greyhaven-wardrobe';
const GHW_VERSION = '1.2.0';
const META_KEY = 'greyhavenWardrobe';
const PROMPT_KEY = 'greyhaven_wardrobe_state';
const PROMPT_POSITION = 1;
const PROMPT_ROLE_SYSTEM = 0;

const PRIMARY_ABSENCE_CATEGORIES = [
  'bra','underwear','top','bottom','onepiece','outerwear',
  'swim_top','swim_bottom','sleepwear','socks','hosiery','footwear','headwear'
];

let ready = false;
let bound = false;
let menuObserver = null;
let activePersonKey = '';
let activeCategory = 'top';
let searchText = '';
let draft = null;
let detectBusy = false;

const ctx = () => {
  try { return globalThis.SillyTavern?.getContext?.() ?? null; }
  catch { return null; }
};
const clone = value => {
  if (value == null) return value;
  try { return structuredClone(value); } catch {}
  return JSON.parse(JSON.stringify(value));
};
const norm = value => String(value ?? '').trim();
const lc = value => norm(value).toLowerCase();
const esc = value => norm(value)
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#039;');
const uid = prefix => {
  try { return `${prefix}:${crypto.randomUUID()}`; }
  catch { return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
};

function hasChat() {
  const c = ctx();
  return !!(c?.chatMetadata && (c?.getCurrentChatId?.() || c?.chatId));
}

function state(create = true) {
  const c = ctx();
  if (!c?.chatMetadata || !hasChat()) return null;
  let s = c.chatMetadata[META_KEY];
  if (!s && create) {
    s = { version: 1, outfits: {}, createdAt: Date.now(), updatedAt: Date.now() };
    c.chatMetadata[META_KEY] = s;
    persist(s);
  }
  if (!s || typeof s !== 'object') return null;
  s.version = 1;
  if (!s.outfits || typeof s.outfits !== 'object' || Array.isArray(s.outfits)) s.outfits = {};
  return s;
}

function persist(s = state(false)) {
  const c = ctx();
  if (!c?.chatMetadata || !s) return;
  s.updatedAt = Date.now();
  c.chatMetadata[META_KEY] = s;
  try {
    c.updateChatMetadata?.({ [META_KEY]: s });
    if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
    else c.saveMetadata?.();
  } catch (error) {
    console.warn(`[${GHW_MODULE}] save failed`, error);
  }
  updatePrompt();
}

function stableCharacterKey(character, index = null) {
  const avatar = norm(character?.avatar || character?.data?.avatar);
  if (avatar) return `character:${encodeURIComponent(avatar)}`;
  const name = norm(character?.name || `Character ${index ?? ''}`);
  return `character-name:${name.toLowerCase()}`;
}

function personaDescriptor() {
  const c = ctx();
  if (!c) return null;
  const name = norm(c.name1 || c.user_name || 'User');
  let avatar = '';
  try {
    const p = c.powerUserSettings?.personas?.[c.powerUserSettings?.persona];
    avatar = norm(p?.avatar || c.powerUserSettings?.persona || '');
  } catch {}
  return { key: `persona:${name.toLowerCase()}`, name, avatar, kind: 'persona' };
}

function avatarUrl(avatar) {
  if (!avatar) return '';
  const c = ctx();
  try { return c?.getThumbnailUrl?.('avatar', avatar) || `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`; }
  catch { return ''; }
}

function allPeople() {
  const c = ctx();
  if (!c) return [];
  const rows = [];
  const persona = personaDescriptor();
  if (persona) rows.push(persona);
  (c.characters || []).forEach((character, index) => {
    if (!character?.name) return;
    rows.push({
      key: stableCharacterKey(character, index),
      name: norm(character.name),
      avatar: norm(character.avatar || character?.data?.avatar),
      kind: 'character',
      characterIndex: index,
    });
  });
  const seen = new Set();
  return rows.filter(row => row.key && !seen.has(row.key) && seen.add(row.key));
}

function personByKey(key) {
  return allPeople().find(person => person.key === key) || null;
}

function currentRelevantPeople() {
  const c = ctx();
  if (!c) return [];
  const people = allPeople();
  const wanted = new Set();
  const persona = personaDescriptor();
  if (persona) wanted.add(persona.key);

  if (Number.isInteger(Number(c.characterId)) && c.characters?.[Number(c.characterId)]) {
    wanted.add(stableCharacterKey(c.characters[Number(c.characterId)], Number(c.characterId)));
  }

  if (c.groupId && Array.isArray(c.groups)) {
    const group = c.groups.find(g => String(g?.id) === String(c.groupId));
    const members = Array.isArray(group?.members) ? group.members : [];
    for (const member of members) {
      const avatar = typeof member === 'string' ? member : norm(member?.avatar || member?.name);
      const match = people.find(p => p.kind === 'character' && (
        p.avatar === avatar || lc(p.name) === lc(member?.name || member)
      ));
      if (match) wanted.add(match.key);
    }
  }

  const recent = Array.isArray(c.chat) ? c.chat.slice(-30) : [];
  for (const message of recent) {
    const name = norm(message?.name || message?.display_name || message?.speaker);
    if (!name) continue;
    const match = people.find(p => lc(p.name) === lc(name));
    if (match) wanted.add(match.key);
  }

  return people.filter(person => wanted.has(person.key));
}

function emptyOutfit(mode = 'unknown', coverage = 'complete') {
  return { mode, coverage, knownAbsent: [], items: {}, updatedAt: Date.now() };
}

function normalizeOutfit(input) {
  const safe = input && typeof input === 'object' ? clone(input) : emptyOutfit();
  safe.mode = ['unknown','set','naked'].includes(safe.mode) ? safe.mode : 'unknown';
  safe.coverage = ['complete','partial'].includes(safe.coverage) ? safe.coverage : 'complete';
  safe.knownAbsent = Array.isArray(safe.knownAbsent)
    ? [...new Set(safe.knownAbsent.map(norm).filter(id => CATALOG[id]))]
    : [];
  if (!safe.items || typeof safe.items !== 'object' || Array.isArray(safe.items)) safe.items = {};

  for (const [categoryId, category] of Object.entries(CATALOG)) {
    const raw = safe.items[categoryId];
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const normalized = rows.map(entry => {
      const id = norm(entry?.id || entry);
      const item = category.items.find(x => x.id === id);
      if (!item) return null;
      const color = COLORS.includes(norm(entry?.color)) ? norm(entry.color) : '';
      return { id: item.id, color };
    }).filter(Boolean);
    safe.items[categoryId] = category.multi ? normalized : normalized.slice(0,1);
  }
  return safe;
}

function getOutfit(personKey) {
  const s = state(false);
  return normalizeOutfit(s?.outfits?.[personKey] || emptyOutfit());
}

function saveOutfit(personKey, outfit) {
  const s = state();
  if (!s || !personKey) return;
  const normalized = normalizeOutfit(outfit);
  const selectedCount = Object.values(normalized.items).reduce((sum, rows) => sum + rows.length, 0);
  if (normalized.mode !== 'unknown') {
    if (normalized.mode === 'naked') {
      normalized.coverage = 'complete';
      normalized.knownAbsent = [];
    } else if (normalized.coverage === 'partial') {
      normalized.mode = (selectedCount || normalized.knownAbsent.length) ? 'set' : 'unknown';
    } else {
      normalized.mode = selectedCount ? 'set' : 'naked';
      normalized.knownAbsent = [];
    }
  }
  normalized.updatedAt = Date.now();
  s.outfits[personKey] = normalized;
  persist(s);
}

function resetUnknown(personKey) {
  const s = state();
  if (!s || !personKey) return;
  s.outfits[personKey] = emptyOutfit('unknown');
  persist(s);
}

function itemLabel(categoryId, itemId) {
  return CATALOG[categoryId]?.items?.find(item => item.id === itemId)?.label || itemId;
}

function describeItem(categoryId, entry) {
  const label = itemLabel(categoryId, entry.id);
  return entry.color ? `${entry.color} ${label}` : label;
}

function selectedIn(outfit, categoryId) {
  return Array.isArray(outfit?.items?.[categoryId]) && outfit.items[categoryId].length > 0;
}

function explicitlyAbsent(outfit, categoryId) {
  if (!outfit || outfit.mode === 'unknown') return false;
  if (outfit.mode === 'naked') return true;
  if (outfit.coverage === 'partial') return (outfit.knownAbsent || []).includes(categoryId);
  return !selectedIn(outfit, categoryId);
}

function selectedLabelContains(outfit, categoryId, token) {
  return (outfit?.items?.[categoryId] || []).some(row => lc(itemLabel(categoryId, row.id)).includes(lc(token)));
}

function wardrobeAwareness(person, outfit) {
  if (!person || !outfit || outfit.mode === 'unknown') return [];

  const notes = [];
  if (outfit.mode === 'naked') {
    notes.push(`${person.name} personally knows they are completely naked.`);
    notes.push(`Their lack of clothing is a major visible fact unless the newest roleplay establishes concealment such as a blanket or towel.`);
    return notes;
  }

  const noBra = explicitlyAbsent(outfit, 'bra');
  const noUnderwear = explicitlyAbsent(outfit, 'underwear');
  const noTop = explicitlyAbsent(outfit, 'top');
  const noBottom = explicitlyAbsent(outfit, 'bottom');
  const noOnepiece = explicitlyAbsent(outfit, 'onepiece');
  const noOuterwear = explicitlyAbsent(outfit, 'outerwear');
  const noSwimTop = explicitlyAbsent(outfit, 'swim_top');
  const noSwimBottom = explicitlyAbsent(outfit, 'swim_bottom');
  const noSleepwear = explicitlyAbsent(outfit, 'sleepwear');
  const noSocks = explicitlyAbsent(outfit, 'socks');
  const noHosiery = explicitlyAbsent(outfit, 'hosiery');
  const noFootwear = explicitlyAbsent(outfit, 'footwear') || selectedLabelContains(outfit, 'footwear', 'barefoot');

  const upperCover = selectedIn(outfit,'top') || selectedIn(outfit,'onepiece') || selectedIn(outfit,'outerwear') ||
    selectedIn(outfit,'swim_top') || selectedIn(outfit,'sleepwear') || selectedIn(outfit,'bra');
  const lowerCover = selectedIn(outfit,'bottom') || selectedIn(outfit,'onepiece') || selectedIn(outfit,'swim_bottom') ||
    selectedIn(outfit,'sleepwear') || selectedIn(outfit,'underwear');

  const selfMissing = [];
  if (noBra) selfMissing.push('no bra');
  if (noUnderwear) selfMissing.push('no underwear');
  if (noTop) selfMissing.push('no top');
  if (noBottom) selfMissing.push('no bottom');
  if (noSocks && noHosiery) selfMissing.push('no socks/hosiery');
  if (noFootwear) selfMissing.push('no footwear');
  if (selfMissing.length) notes.push(`${person.name} is personally aware of these absences: ${selfMissing.join(', ')}.`);

  if (!upperCover && noTop && noBra && noOnepiece && noOuterwear && noSwimTop && noSleepwear) {
    notes.push(`${person.name}'s upper body has no garment covering it; this is visibly exposed and should not be silently treated as ordinary clothing.`);
  }
  if (!lowerCover && noBottom && noUnderwear && noOnepiece && noSwimBottom && noSleepwear) {
    notes.push(`${person.name} has no lower-body garment or underwear; this is a major state the wearer is aware of, with visibility depending on any longer upper garment or other established cover.`);
  }
  if (noFootwear) {
    notes.push(`${person.name} is barefoot / without footwear.`);
  } else if (noSocks && noHosiery) {
    notes.push(`${person.name} is wearing no socks or hosiery; the wearer knows this, while others only know it when the footwear/legs make it visible.`);
  }

  if (noUnderwear && upperCover) {
    notes.push(`No-underwear status is private self-knowledge unless the clothing/pose or roleplay makes it visible or tells another character.`);
  }
  if (noBra && upperCover && !(noTop && !upperCover)) {
    notes.push(`No-bra status is self-knowledge; other characters should only know it from visible evidence or explicit roleplay.`);
  }

  return notes;
}

function describeOutfit(person, outfit) {
  if (!person || !outfit || outfit.mode === 'unknown') return '';
  if (outfit.mode === 'naked') {
    return `${person.name}: explicitly naked; wearing no clothing, underwear, socks/hosiery, footwear, or accessories. ${wardrobeAwareness(person,outfit).join(' ')}`;
  }

  const worn = [];
  for (const [categoryId, category] of Object.entries(CATALOG)) {
    for (const entry of outfit.items[categoryId] || []) {
      const label = describeItem(categoryId, entry);
      if (categoryId === 'footwear' && lc(label).includes('barefoot')) worn.push(`Footwear state: barefoot`);
      else worn.push(`${category.label}: ${label}`);
    }
  }

  const absent = outfit.coverage === 'partial'
    ? (outfit.knownAbsent || []).map(categoryId => CATALOG[categoryId]?.label).filter(Boolean)
    : PRIMARY_ABSENCE_CATEGORIES
        .filter(categoryId => !(outfit.items[categoryId] || []).length)
        .map(categoryId => CATALOG[categoryId]?.label)
        .filter(Boolean);

  const pieces = [`${person.name}: wearing ${worn.length ? worn.join('; ') : 'no selected garments'}.`];
  if (absent.length) pieces.push(`Explicitly not wearing / known absent: ${absent.join(', ')}.`);
  const awareness = wardrobeAwareness(person, outfit);
  if (awareness.length) pieces.push(`Awareness: ${awareness.join(' ')}`);
  return pieces.join(' ');
}

function buildPrompt() {
  if (!hasChat()) return '';
  const rows = [];
  for (const person of currentRelevantPeople()) {
    const outfit = getOutfit(person.key);
    const line = describeOutfit(person, outfit);
    if (line) rows.push(line);
  }
  if (!rows.length) return '';
  return [
    '[Greyhaven Wardrobe — authoritative current outfit state. Use silently for continuity; do not quote this block as metadata.]',
    'Outfit rule: listed clothing is factual. For a manually saved complete outfit, omitted primary garment categories are explicitly absent. A detected partial outfit only treats specifically detected absences as absent. “Naked” means no clothing at all. “Unknown” people are omitted and must not be assumed naked.',
    'Self-awareness rule: each wearer knows what they are wearing AND what major garments they are not wearing, especially bra/underwear, top, bottom, socks/hosiery and footwear.',
    'Salience rule: visible major absences such as a bare upper body, no lower garment, or being barefoot are meaningful physical facts. When socially relevant, characters should naturally register them in attention, body language, dialogue or practical behavior without waiting for the user to ask “what about the top?”. Do not force a reaction every message and do not make it melodramatic; home, beach, bedroom, work and public settings can make the same outfit feel very different.',
    'Privacy rule: hidden absences such as no underwear, no bra under opaque clothing, or no socks inside closed shoes are known to the wearer but are NOT automatically known by other characters unless visible or explicitly established in roleplay.',
    'Perception rule: scene participants may naturally perceive each other’s visible clothing and visible absences. Do not invent extra garments that contradict this state. Newer explicit roleplay can change clothing and overrides stale wardrobe state until the user updates/detects it.',
    ...rows,
  ].join('\\n');
}

function updatePrompt() {
  const c = ctx();
  if (!c?.setExtensionPrompt) return;
  try {
    c.setExtensionPrompt(PROMPT_KEY, buildPrompt(), PROMPT_POSITION, 1, false, PROMPT_ROLE_SYSTEM);
  } catch (error) {
    console.warn(`[${GHW_MODULE}] prompt update failed`, error);
  }
}

function ensureDraft() {
  if (!activePersonKey) activePersonKey = personaDescriptor()?.key || allPeople()[0]?.key || '';
  if (!draft) draft = getOutfit(activePersonKey);
  return draft;
}

function setActivePerson(key) {
  activePersonKey = key;
  draft = getOutfit(key);
  renderDialog();
}

function selectedRows(categoryId) {
  return ensureDraft().items[categoryId] || [];
}

function isSelected(categoryId, itemId) {
  return selectedRows(categoryId).some(row => row.id === itemId);
}

function toggleItem(categoryId, itemId) {
  const category = CATALOG[categoryId];
  if (!category) return;
  const d = ensureDraft();
  d.mode = 'set';
  const rows = d.items[categoryId] || [];
  const index = rows.findIndex(row => row.id === itemId);
  if (index >= 0) rows.splice(index, 1);
  else if (category.multi) rows.push({ id:itemId, color:'' });
  else {
    d.items[categoryId] = [{ id:itemId, color:'' }];
    // A dress/jumpsuit/other one-piece occupies the main upper + lower clothing
    // slots. Selecting a separate top or bottom later replaces that one-piece.
    if (categoryId === 'onepiece') { d.items.top = []; d.items.bottom = []; }
    if (categoryId === 'top' || categoryId === 'bottom') d.items.onepiece = [];
  }
  if (category.multi) d.items[categoryId] = rows;
  renderDialog();
}

function setColor(categoryId, itemId, color) {
  const row = selectedRows(categoryId).find(x => x.id === itemId);
  if (!row) return;
  row.color = COLORS.includes(color) ? color : '';
  renderDialog();
}

function totalSelected(outfit = ensureDraft()) {
  return Object.values(outfit.items || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

function currentPersonOptions() {
  return allPeople().map(person => `<option value="${esc(person.key)}" ${person.key===activePersonKey?'selected':''}>${esc(person.kind==='persona' ? `${person.name} (persona)` : person.name)}</option>`).join('');
}

function personAvatar(person) {
  const src = avatarUrl(person?.avatar);
  if (src) return `<img src="${esc(src)}" alt="">`;
  return `<span class="ghw-avatar-fallback">${esc((person?.name || '?').slice(0,1).toUpperCase())}</span>`;
}

function categoryButtons() {
  return Object.entries(CATALOG).map(([id, category]) => {
    const count = selectedRows(id).length;
    return `<button type="button" class="ghw-category ${activeCategory===id?'active':''}" data-ghw-category="${esc(id)}"><i class="${esc(category.icon)}"></i><span>${esc(category.label)}</span>${count?`<b>${count}</b>`:''}</button>`;
  }).join('');
}


function iconKind(categoryId, item) {
  const text = lc(`${item?.id || ''} ${item?.label || ''}`);
  const has = (...words) => words.some(word => text.includes(word));

  if (categoryId === 'underwear') {
    if (has('g-string','g string')) return 'gstring';
    if (has('thong')) return 'thong';
    if (has('jockstrap')) return 'jockstrap';
    if (has('boxer briefs','boxer brief')) return 'boxerbriefs';
    if (has('boxers')) return 'boxers';
    if (has('boyshort')) return 'boyshort';
    if (has('trunks')) return 'trunks';
    if (has('high-waisted','high waisted')) return 'highbrief';
    if (has('bikini')) return 'bikinibrief';
    if (has('cheeky')) return 'cheeky';
    if (has('long john','thermal')) return 'longjohn';
    if (has('compression')) return 'sportbrief';
    return 'briefs';
  }
  if (categoryId === 'bra') {
    if (has('sports')) return 'sportsbra';
    if (has('strapless','bandeau')) return 'straplessbra';
    if (has('bralette')) return 'bralette';
    if (has('corset','bustier','longline')) return 'corset';
    if (has('plunge')) return 'plungebra';
    return 'bra';
  }
  if (categoryId === 'top') {
    if (has('hoodie')) return 'hoodie';
    if (has('sweater','sweatshirt','cardigan')) return 'sweater';
    if (has('tank','camisole','singlet')) return 'tank';
    if (has('crop')) return 'croptop';
    if (has('tube')) return 'tubetop';
    if (has('polo')) return 'polo';
    if (has('blouse','button','dress shirt','shirt')) return 'shirt';
    if (has('jersey','sports','running','compression')) return 'jersey';
    if (has('corset','bustier')) return 'corset';
    return 'tshirt';
  }
  if (categoryId === 'bottom') {
    if (has('mini skirt')) return 'miniskirt';
    if (has('pleated skirt')) return 'pleatedskirt';
    if (has('pencil skirt')) return 'pencilskirt';
    if (has('maxi skirt','long skirt')) return 'maxiskirt';
    if (has('skirt','sarong','kilt')) return 'skirt';
    if (has('cargo')) return 'cargopants';
    if (has('jogger','sweatpant')) return 'joggers';
    if (has('legging','yoga')) return 'leggings';
    if (has('flare','wide-leg','wide leg','bell-bottom')) return 'flarepants';
    if (has('jean','denim')) return 'jeans';
    if (has('chino','dress pant','trouser','slack')) return 'trousers';
    if (has('short')) return 'shorts';
    return 'pants';
  }
  if (categoryId === 'onepiece') {
    if (has('jumpsuit')) return 'jumpsuit';
    if (has('romper')) return 'romper';
    if (has('bodysuit','leotard','unitard')) return 'bodysuit';
    if (has('robe','kimono','kaftan')) return 'robe';
    if (has('overall')) return 'overalls';
    return 'dress';
  }
  if (categoryId === 'outerwear') {
    if (has('blazer','suit')) return 'blazer';
    if (has('vest','gilet')) return 'vest';
    if (has('poncho','cape')) return 'cape';
    if (has('rain')) return 'raincoat';
    if (has('puffer')) return 'puffer';
    return 'coat';
  }
  if (categoryId === 'sleepwear') return has('robe') ? 'robe' : has('nightgown','slip') ? 'nightgown' : has('short') ? 'pajamashorts' : 'pajamas';
  if (categoryId === 'swim_top') return has('triangle') ? 'trianglebikini' : has('bandeau') ? 'straplessbra' : 'bikinitop';
  if (categoryId === 'swim_bottom') return has('board','trunk','short') ? 'swimshorts' : has('thong') ? 'thong' : has('high-waist') ? 'highbrief' : 'bikinibrief';
  if (categoryId === 'socks') {
    if (has('no-show','no show','liner')) return 'noshow';
    if (has('ankle')) return 'anklesock';
    if (has('knee')) return 'kneesock';
    if (has('thigh')) return 'thighsock';
    return 'crewsock';
  }
  if (categoryId === 'hosiery') {
    if (has('fishnet')) return 'fishnet';
    if (has('garter')) return 'garterstockings';
    if (has('thigh-high','thigh high')) return 'thighstockings';
    if (has('knee-high','knee high')) return 'kneestockings';
    if (has('tights','pantyhose')) return 'tights';
    return 'stockings';
  }
  if (categoryId === 'footwear') {
    if (has('barefoot')) return 'barefoot';
    if (has('flip-flop','flip flop','slide')) return 'slides';
    if (has('sandal')) return 'sandal';
    if (has('heel','stiletto','pump')) return 'heel';
    if (has('ankle boot')) return 'ankleboot';
    if (has('boot')) return 'boot';
    if (has('loafer','oxford','derby','monk','dress shoe')) return 'dressshoe';
    if (has('slipper')) return 'slipper';
    return 'sneaker';
  }
  if (categoryId === 'headwear') {
    if (has('beanie')) return 'beanie';
    if (has('cap')) return 'cap';
    if (has('cowboy')) return 'cowboyhat';
    if (has('sun','floppy','straw')) return 'sunhat';
    if (has('helmet','hard hat')) return 'helmet';
    if (has('crown','tiara')) return 'crown';
    return 'hat';
  }
  if (categoryId === 'eyewear') return has('sun') ? 'sunglasses' : has('goggle') ? 'goggles' : has('monocle') ? 'monocle' : 'glasses';
  if (categoryId === 'necklaces') {
    if (has('cuban')) return 'cubanchain';
    if (has('rope chain','rope necklace')) return 'ropechain';
    if (has('box chain')) return 'boxchain';
    if (has('figaro')) return 'figarochain';
    if (has('pearl','bead')) return 'pearlnecklace';
    if (has('layered')) return 'layerednecklace';
    if (has('locket')) return 'locket';
    if (has('choker') && has('velvet')) return 'velvetchoker';
    if (has('chain choker')) return 'chainchoker';
    if (has('choker')) return 'choker';
    if (has('collar')) return 'collarnecklace';
    if (has('statement')) return 'statementnecklace';
    if (has('cross')) return 'crossnecklace';
    if (has('dog tag')) return 'dogtag';
    return 'pendant';
  }
  if (categoryId === 'earrings') return has('hoop') ? 'hoopearring' : has('stud') ? 'studearring' : has('drop','dangle') ? 'dangleearring' : 'earring';
  if (categoryId === 'bracelets') return has('cuff') ? 'cuffbracelet' : has('bead') ? 'beadbracelet' : has('tennis') ? 'tennisbracelet' : 'chainbracelet';
  if (categoryId === 'rings') return has('signet') ? 'signetring' : has('band','wedding') ? 'bandring' : has('gem','stone','diamond') ? 'gemring' : 'ring';
  if (categoryId === 'watches') return has('smart') ? 'smartwatch' : has('digital') ? 'digitalwatch' : has('pocket') ? 'pocketwatch' : 'watch';
  if (categoryId === 'belts') return has('suspender') ? 'suspenders' : has('chain') ? 'chainbelt' : 'belt';
  if (categoryId === 'bags') {
    if (has('backpack')) return 'backpack';
    if (has('briefcase','laptop')) return 'briefcase';
    if (has('suitcase','carry-on','carry on')) return 'suitcase';
    if (has('duffel','gym bag')) return 'duffel';
    if (has('clutch','wristlet')) return 'clutch';
    if (has('tote','shopper')) return 'tote';
    if (has('crossbody','cross-body')) return 'crossbody';
    return 'handbag';
  }
  if (categoryId === 'gloves') return has('fingerless') ? 'fingerlessglove' : has('boxing') ? 'boxingglove' : has('mitten') ? 'mitten' : 'glove';
  if (categoryId === 'scarves') return has('bandana') ? 'bandana' : has('shawl') ? 'shawl' : 'scarf';
  if (categoryId === 'ties') return has('bow') ? 'bowtie' : 'tie';
  if (categoryId === 'hair_accessories') return has('bow','ribbon') ? 'hairbow' : has('clip','barrette') ? 'hairclip' : has('headband') ? 'headband' : 'hairpin';
  if (categoryId === 'piercings') return has('nose') ? 'nosepiercing' : has('brow') ? 'browpiercing' : has('lip') ? 'lippiercing' : 'piercing';
  if (categoryId === 'other_accessories') {
    if (has('phone')) return 'phone';
    if (has('wallet','card holder')) return 'wallet';
    if (has('key')) return 'keys';
    if (has('umbrella')) return 'umbrella';
    if (has('mask')) return 'mask';
    if (has('headphone','earbud','headset')) return 'headphones';
    if (has('stethoscope')) return 'stethoscope';
    if (has('camera')) return 'camera';
    return 'accessory';
  }
  return 'accessory';
}

function vectorIcon(kind) {
  const common = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const icons = {
    briefs:`<path ${common} d="M7 8h18l-2 8c-1 5-5 8-7 8s-6-3-7-8L7 8Z"/><path ${common} d="M9 12c3 1 5 3 7 6 2-3 4-5 7-6"/>`,
    bikinibrief:`<path ${common} d="M6 11h20l-4 9c-2 3-10 3-12 0l-4-9Z"/><path ${common} d="M8 12l5 5m11-5-5 5"/>`,
    highbrief:`<path ${common} d="M8 5h16v11c0 5-4 8-8 8s-8-3-8-8V5Z"/><path ${common} d="M9 10h14M10 16c3 0 5 2 6 5 1-3 3-5 6-5"/>`,
    cheeky:`<path ${common} d="M7 11h18l-3 8c-2 4-10 4-12 0l-3-8Z"/><path ${common} d="M10 17c4-2 8-2 12 0"/>`,
    thong:`<path ${common} d="M7 9h18l-5 6-4 11-4-11-5-6Z"/><path ${common} d="M16 15v11"/>`,
    gstring:`<path ${common} d="M6 9h20M7 9l8 6 1 11 1-11 8-6"/><path ${common} d="M14 13h4l-2 4-2-4Z"/>`,
    boxers:`<path ${common} d="M7 7h18l1 16-9-1-1-8-1 8-9 1L7 7Z"/><path ${common} d="M7 11h18M16 11v4"/>`,
    boxerbriefs:`<path ${common} d="M7 7h18v15l-8 1-1-9-1 9-8-1V7Z"/><path ${common} d="M7 11h18M16 11v3"/>`,
    trunks:`<path ${common} d="M7 8h18v11l-8 1-1-6-1 6-8-1V8Z"/><path ${common} d="M7 11h18"/>`,
    boyshort:`<path ${common} d="M6 9h20v11l-9 1-1-6-1 6-9-1V9Z"/><path ${common} d="M6 13h20"/>`,
    jockstrap:`<path ${common} d="M7 8h18v5c-2 4-5 6-9 6s-7-2-9-6V8Z"/><path ${common} d="M10 17l-2 8m14-8 2 8m-10-6 2 6 2-6"/>`,
    sportbrief:`<path ${common} d="M7 8h18l-2 9c-1 4-4 7-7 7s-6-3-7-7L7 8Z"/><path ${common} d="M11 8l2 14m8-14-2 14"/>`,
    longjohn:`<path ${common} d="M8 6h16v8l-3 13h-5l-1-12-1 12H9L6 14 8 6Z"/><path ${common} d="M8 10h16"/>`,
    bra:`<path ${common} d="M6 13c3-4 7-5 10 0 3-5 7-4 10 0v7H6v-7Z"/><path ${common} d="M16 13v7M8 13V7m16 6V7"/>`,
    sportsbra:`<path ${common} d="M9 6h4l3 5 3-5h4l3 17H6L9 6Z"/><path ${common} d="M9 16h14"/>`,
    straplessbra:`<path ${common} d="M6 12c3-3 7-3 10 1 3-4 7-4 10-1v8H6v-8Z"/><path ${common} d="M16 13v7"/>`,
    bralette:`<path ${common} d="M8 7l4 2 4 6 4-6 4-2 2 16H6L8 7Z"/><path ${common} d="M12 9l4 6 4-6"/>`,
    plungebra:`<path ${common} d="M6 12c4-4 7-3 10 3 3-6 6-7 10-3v8H6v-8Z"/><path ${common} d="M16 15v5M8 11V6m16 5V6"/>`,
    corset:`<path ${common} d="M10 5h12l2 20-8 3-8-3 2-20Z"/><path ${common} d="M16 7v18M11 10h10m-10 4h10m-10 4h10"/>`,
    tshirt:`<path ${common} d="M10 7l6-2 6 2 5 5-4 4-3-2v13H12V14l-3 2-4-4 5-5Z"/>`,
    shirt:`<path ${common} d="M11 6l5 3 5-3 5 5-4 4-2-2v14H12V13l-2 2-4-4 5-5Z"/><path ${common} d="M16 9v18m0-14 3-4m-3 4-3-4"/>`,
    tank:`<path ${common} d="M11 5h3v5h4V5h3l3 22H8l3-22Z"/><path ${common} d="M14 10h4"/>`,
    croptop:`<path ${common} d="M10 7l6-2 6 2 4 5-4 4-2-2v7H12v-7l-2 2-4-4 4-5Z"/><path ${common} d="M12 18h8"/>`,
    tubetop:`<path ${common} d="M8 10h16v12H8V10Z"/><path ${common} d="M8 13h16"/>`,
    hoodie:`<path ${common} d="M12 8c0-4 8-4 8 0l4 3 3 13-6 2-2-10v11h-6V16l-2 10-6-2 3-13 4-3Z"/><path ${common} d="M13 9c2 2 4 2 6 0"/>`,
    sweater:`<path ${common} d="M11 7h10l5 5-3 4-3-2v13H12V14l-3 2-3-4 5-5Z"/><path ${common} d="M12 22h8"/>`,
    polo:`<path ${common} d="M10 7l6-2 6 2 5 5-4 4-3-2v13H12V14l-3 2-4-4 5-5Z"/><path ${common} d="M13 7l3 4 3-4M16 11v5"/>`,
    jersey:`<path ${common} d="M10 7l6-2 6 2 5 5-4 4-3-2v13H12V14l-3 2-4-4 5-5Z"/><path ${common} d="M14 13h4m-2-2v8"/>`,
    pants:`<path ${common} d="M10 5h12l2 22h-6l-2-13-2 13H8l2-22Z"/><path ${common} d="M10 10h12"/>`,
    jeans:`<path ${common} d="M10 5h12l2 22h-6l-2-13-2 13H8l2-22Z"/><path ${common} d="M10 10h12m-10 0 3 4m5-4-3 4M11 7h2m6 0h2"/>`,
    trousers:`<path ${common} d="M10 5h12l2 22h-6l-2-14-2 14H8l2-22Z"/><path ${common} d="M16 5v8m-5-4h10"/>`,
    cargopants:`<path ${common} d="M10 5h12l2 22h-6l-2-13-2 13H8l2-22Z"/><rect ${common} x="8" y="14" width="5" height="5" rx="1"/><rect ${common} x="19" y="14" width="5" height="5" rx="1"/>`,
    joggers:`<path ${common} d="M10 5h12l2 20-5 2-3-13-3 13-5-2 2-20Z"/><path ${common} d="M11 7c3 2 7 2 10 0M9 24h5m4 0h5"/>`,
    leggings:`<path ${common} d="M11 5h10l2 22h-5l-2-15-2 15H9l2-22Z"/><path ${common} d="M11 9h10"/>`,
    flarepants:`<path ${common} d="M11 5h10l1 11 5 11h-9l-2-14-2 14H5l5-11 1-11Z"/><path ${common} d="M11 9h10"/>`,
    shorts:`<path ${common} d="M8 7h16l2 12-8 2-2-8-2 8-8-2L8 7Z"/><path ${common} d="M8 11h16"/>`,
    skirt:`<path ${common} d="M11 7h10l5 19H6l5-19Z"/><path ${common} d="M11 11h10"/>`,
    miniskirt:`<path ${common} d="M10 8h12l3 11H7l3-11Z"/><path ${common} d="M10 11h12"/>`,
    pleatedskirt:`<path ${common} d="M10 7h12l4 19H6l4-19Z"/><path ${common} d="M10 11h12m-8 1-2 14m6-14 2 14m2-14 3 14"/>`,
    pencilskirt:`<path ${common} d="M11 7h10l2 19H9l2-19Z"/><path ${common} d="M11 11h10"/>`,
    maxiskirt:`<path ${common} d="M12 5h8l7 23H5l7-23Z"/><path ${common} d="M12 9h8"/>`,
    dress:`<path ${common} d="M12 5l4 5 4-5 3 2-2 9 6 12H5l6-12-2-9 3-2Z"/><path ${common} d="M11 16h10"/>`,
    jumpsuit:`<path ${common} d="M11 5h10l3 9-4 2 3 12h-6l-1-11-1 11H9l3-12-4-2 3-9Z"/>`,
    romper:`<path ${common} d="M11 5h10l3 9-4 2 2 8-6 1-1-7-1 7-6-1 2-8-4-2 3-9Z"/>`,
    bodysuit:`<path ${common} d="M11 5h10l3 10-5 3-3 10-3-10-5-3 3-10Z"/>`,
    overalls:`<path ${common} d="M11 5h3v5h4V5h3l2 23h-6l-1-12-1 12H9l2-23Z"/><rect ${common} x="12" y="9" width="8" height="7" rx="1"/>`,
    robe:`<path ${common} d="M11 5h10l5 7-4 3-2-3v16H12V12l-2 3-4-3 5-7Z"/><path ${common} d="M11 17h10m-5-8v19"/>`,
    coat:`<path ${common} d="M11 5h10l5 7-4 3-2-3v16H12V12l-2 3-4-3 5-7Z"/><path ${common} d="M16 5v23m-3-14h6"/>`,
    blazer:`<path ${common} d="M11 5h10l4 7-4 2-2-3v17H13V11l-2 3-4-2 4-7Z"/><path ${common} d="M11 6l5 8 5-8m-5 8v14"/>`,
    vest:`<path ${common} d="M11 5h4l1 5 1-5h4l3 23H8l3-23Z"/><path ${common} d="M16 10v18"/>`,
    cape:`<path ${common} d="M12 5h8l7 23H5l7-23Z"/><path ${common} d="M12 8c2 2 6 2 8 0"/>`,
    raincoat:`<path ${common} d="M12 7c0-4 8-4 8 0l5 5-4 3-2-3v16h-6V12l-2 3-4-3 5-5Z"/><path ${common} d="M12 8h8"/>`,
    puffer:`<path ${common} d="M11 5h10l5 7-4 3-2-3v16H12V12l-2 3-4-3 5-7Z"/><path ${common} d="M12 11h8m-8 5h8m-8 5h8"/>`,
    pajamas:`<path ${common} d="M9 7l7-2 7 2 3 6-4 2-2-4v7l3 10h-6l-1-9-1 9H9l3-10v-7l-2 4-4-2 3-6Z"/>`,
    pajamashorts:`<path ${common} d="M9 7l7-2 7 2 3 6-4 2-2-4v5H12v-5l-2 4-4-2 3-6Z"/><path ${common} d="M10 19h12l2 8-7 1-1-6-1 6-7-1 2-8Z"/>`,
    nightgown:`<path ${common} d="M12 5l4 5 4-5 3 2-2 8 6 13H5l6-13-2-8 3-2Z"/>`,
    bikinitop:`<path ${common} d="M7 16c2-7 7-7 9 0 2-7 7-7 9 0l-2 5H9l-2-5Z"/><path ${common} d="M16 16v5M10 14l-2-7m14 7 2-7"/>`,
    trianglebikini:`<path ${common} d="M7 20l7-10 2 10H7Zm18 0-7-10-2 10h9Z"/><path ${common} d="M14 10l2-5 2 5M7 20h18"/>`,
    swimshorts:`<path ${common} d="M8 7h16l2 14-8 2-2-9-2 9-8-2L8 7Z"/><path ${common} d="M11 10c3 2 7 2 10 0"/>`,
    noshow:`<path ${common} d="M8 20c5 1 8 0 12-5l6 4c-3 5-8 7-18 5v-4Z"/>`,
    anklesock:`<path ${common} d="M10 11h8v7l8 3c-2 5-8 6-16 3V11Z"/><path ${common} d="M10 15h8"/>`,
    crewsock:`<path ${common} d="M10 7h8v11l8 3c-2 5-8 6-16 3V7Z"/><path ${common} d="M10 11h8"/>`,
    kneesock:`<path ${common} d="M10 4h8v14l8 3c-2 5-8 6-16 3V4Z"/><path ${common} d="M10 8h8"/>`,
    thighsock:`<path ${common} d="M10 2h8v16l8 3c-2 5-8 6-16 3V2Z"/><path ${common} d="M10 6h8"/>`,
    stockings:`<path ${common} d="M7 4h7v20l-2 5H8L7 24V4Zm11 0h7v20l-1 5h-4l-2-5V4Z"/><path ${common} d="M7 8h7m4 0h7"/>`,
    fishnet:`<path ${common} d="M7 4h7v20l-2 5H8L7 24V4Zm11 0h7v20l-1 5h-4l-2-5V4Z"/><path ${common} d="M7 8h7m4 0h7M8 11l6 6m-6 1 6 6m11-13-7 7m7 0-6 6M8 7l6 6m11-6-7 7"/>`,
    thighstockings:`<path ${common} d="M7 2h7v22l-2 5H8L7 24V2Zm11 0h7v22l-1 5h-4l-2-5V2Z"/><path ${common} d="M7 6h7m4 0h7"/>`,
    kneestockings:`<path ${common} d="M7 9h7v15l-2 5H8L7 24V9Zm11 0h7v15l-1 5h-4l-2-5V9Z"/><path ${common} d="M7 13h7m4 0h7"/>`,
    garterstockings:`<path ${common} d="M8 4h16l-2 6H10L8 4Zm2 6v5m12-5v5M7 14h7v10l-2 5H8L7 24V14Zm11 0h7v10l-1 5h-4l-2-5V14Z"/>`,
    tights:`<path ${common} d="M9 3h14l-2 26h-5l-1-15-1 15H9L9 3Z"/><path ${common} d="M9 8h14"/>`,
    sneaker:`<path ${common} d="M7 18c5 0 7-4 9-8l4 7 6 3v5H7v-7Z"/><path ${common} d="M8 21h18m-9-7 5 2"/>`,
    dressshoe:`<path ${common} d="M7 18c6 0 8-3 10-7l3 6 6 3v5H7v-7Z"/><path ${common} d="M7 22h19M17 15h5"/>`,
    heel:`<path ${common} d="M7 18c6 0 8-4 10-9l4 8 5 3v4H7v-6Z"/><path ${common} d="M22 24v5m-14-5h14"/>`,
    boot:`<path ${common} d="M10 4h10v14l6 3v5H10V4Z"/><path ${common} d="M10 20h16m-13-4h7"/>`,
    ankleboot:`<path ${common} d="M10 10h10v8l6 3v5H10V10Z"/><path ${common} d="M10 21h16"/>`,
    sandal:`<path ${common} d="M7 22h19v4H7v-4Zm4 0c0-6 5-9 10-10m-8 3 8 7"/>`,
    slides:`<path ${common} d="M7 22h19v4H7v-4Zm4 0 2-7h10l2 7"/>`,
    slipper:`<path ${common} d="M7 20c5 0 8-2 11-6l8 5v6H7v-5Z"/><path ${common} d="M11 20c4 2 8 2 12 0"/>`,
    barefoot:`<path ${common} d="M12 26c-4-4-4-10-2-15 1-3 4-5 6-2l1 5 2-8c1-3 4-2 4 1l-1 8 3-5c2-2 4 0 3 3l-4 9c-2 5-8 7-12 4Z"/><circle ${common} cx="9" cy="7" r="1"/><circle ${common} cx="12" cy="5" r="1"/>`,
    cap:`<path ${common} d="M8 17c0-7 16-7 16 0H8Z"/><path ${common} d="M16 17c5 0 9 1 12 4-5 1-9 0-12-4Z"/>`,
    beanie:`<path ${common} d="M9 19c0-10 14-10 14 0H9Z"/><path ${common} d="M8 19h16v5H8v-5Z"/><path ${common} d="M16 7V4"/>`,
    sunhat:`<path ${common} d="M10 17c1-10 11-10 12 0H10Z"/><path ${common} d="M4 18c6-3 18-3 24 0-5 5-19 5-24 0Z"/>`,
    cowboyhat:`<path ${common} d="M10 17l3-10h6l3 10H10Z"/><path ${common} d="M4 18c6 2 18 2 24 0-3 6-21 6-24 0Z"/>`,
    helmet:`<path ${common} d="M7 17C7 7 25 7 25 17v4H7v-4Z"/><path ${common} d="M16 8v13m0 0h8"/>`,
    crown:`<path ${common} d="M6 10l6 5 4-8 4 8 6-5-3 14H9L6 10Z"/><path ${common} d="M9 20h14"/>`,
    hat:`<path ${common} d="M10 16l2-9h8l2 9H10Z"/><path ${common} d="M5 18h22"/>`,
    glasses:`<circle ${common} cx="11" cy="16" r="5"/><circle ${common} cx="21" cy="16" r="5"/><path ${common} d="M16 16h0m-10-1-3-2m23 2 3-2"/>`,
    sunglasses:`<path ${common} d="M5 12h10l-1 8H8l-3-8Zm12 0h10l-3 8h-6l-1-8Z"/><path ${common} d="M15 14h2M5 12l-2-2m24 2 2-2"/>`,
    goggles:`<rect ${common} x="4" y="11" width="10" height="9" rx="4"/><rect ${common} x="18" y="11" width="10" height="9" rx="4"/><path ${common} d="M14 15h4M4 14l-2-2m26 2 2-2"/>`,
    monocle:`<circle ${common} cx="14" cy="14" r="7"/><path ${common} d="M19 19l5 9"/>`,
    locket:`<path ${common} d="M7 5c2 14 16 14 18 0"/><path ${common} d="M13 17c0-4 6-4 6 0 0 4-3 6-3 6s-3-2-3-6Z"/>`,
    pearlnecklace:`<path ${common} d="M6 6c2 17 18 17 20 0"/><circle ${common} cx="8" cy="10" r="1"/><circle ${common} cx="11" cy="15" r="1"/><circle ${common} cx="16" cy="18" r="1"/><circle ${common} cx="21" cy="15" r="1"/><circle ${common} cx="24" cy="10" r="1"/>`,
    choker:`<path ${common} d="M7 13c5 3 13 3 18 0"/><path ${common} d="M8 16c5 2 11 2 16 0"/>`,
    velvetchoker:`<path ${common} d="M7 12c5 4 13 4 18 0l-1 5c-5 3-11 3-16 0l-1-5Z"/>`,
    chainchoker:`<path ${common} d="M6 14c2 4 18 4 20 0"/><ellipse ${common} cx="9" cy="16" rx="2" ry="1"/><ellipse ${common} cx="14" cy="17" rx="2" ry="1"/><ellipse ${common} cx="19" cy="17" rx="2" ry="1"/><ellipse ${common} cx="24" cy="16" rx="2" ry="1"/>`,
    collarnecklace:`<path ${common} d="M7 9c3 12 15 12 18 0l-4 11H11L7 9Z"/>`,
    statementnecklace:`<path ${common} d="M7 6c2 12 16 12 18 0"/><path ${common} d="M10 14l3 7 3-5 3 5 3-7"/>`,
    layerednecklace:`<path ${common} d="M7 5c2 10 16 10 18 0M9 8c2 13 12 13 14 0M12 13c1 9 7 9 8 0"/>`,
    cubanchain:`<path ${common} d="M6 8c1 12 19 12 20 0"/><g ${common}><ellipse cx="9" cy="13" rx="3" ry="2"/><ellipse cx="14" cy="17" rx="3" ry="2"/><ellipse cx="19" cy="17" rx="3" ry="2"/><ellipse cx="24" cy="13" rx="3" ry="2"/></g>`,
    ropechain:`<path ${common} d="M7 6c2 16 16 16 18 0"/><path ${common} d="M9 10l3 2-2 3 4 2-1 3m10-10-3 2 2 3-4 2 1 3"/>`,
    boxchain:`<path ${common} d="M7 6c2 16 16 16 18 0"/><rect ${common} x="8" y="10" width="3" height="3"/><rect ${common} x="11" y="15" width="3" height="3"/><rect ${common} x="15" y="18" width="3" height="3"/><rect ${common} x="19" y="15" width="3" height="3"/><rect ${common} x="22" y="10" width="3" height="3"/>`,
    figarochain:`<path ${common} d="M7 6c2 16 16 16 18 0"/><ellipse ${common} cx="9" cy="11" rx="3" ry="1.5"/><ellipse ${common} cx="13" cy="16" rx="1.6" ry="1.1"/><ellipse ${common} cx="16" cy="18" rx="1.6" ry="1.1"/><ellipse ${common} cx="21" cy="15" rx="3" ry="1.5"/>`,
    pendant:`<path ${common} d="M7 5c2 15 16 15 18 0"/><circle ${common} cx="16" cy="20" r="3"/>`,
    crossnecklace:`<path ${common} d="M7 5c2 15 16 15 18 0"/><path ${common} d="M16 17v9m-4-6h8"/>`,
    dogtag:`<path ${common} d="M7 5c2 14 16 14 18 0"/><path ${common} d="M13 17h6l2 2-2 7h-6l-2-7 2-2Z"/>`,
    studearring:`<circle ${common} cx="16" cy="16" r="4"/><path ${common} d="M20 16h5"/>`,
    hoopearring:`<circle ${common} cx="16" cy="16" r="8"/><path ${common} d="M16 8v4"/>`,
    dangleearring:`<circle ${common} cx="16" cy="8" r="2"/><path ${common} d="M16 10v6"/><path ${common} d="M12 17l4 8 4-8-4-3-4 3Z"/>`,
    earring:`<circle ${common} cx="16" cy="11" r="3"/><path ${common} d="M16 14v10"/><circle ${common} cx="16" cy="25" r="2"/>`,
    chainbracelet:`<ellipse ${common} cx="16" cy="16" rx="10" ry="6"/><path ${common} d="M7 16h4m2-5 2 4m5-4-2 4m3 1h4"/>`,
    cuffbracelet:`<path ${common} d="M8 10c-5 10 5 17 13 12 4-2 5-8 2-12"/><path ${common} d="M10 11c-2 6 3 11 8 8"/>`,
    beadbracelet:`<circle ${common} cx="16" cy="16" r="9"/><circle ${common} cx="16" cy="7" r="1"/><circle ${common} cx="24" cy="12" r="1"/><circle ${common} cx="23" cy="20" r="1"/><circle ${common} cx="9" cy="20" r="1"/><circle ${common} cx="8" cy="12" r="1"/>`,
    tennisbracelet:`<ellipse ${common} cx="16" cy="16" rx="10" ry="7"/><path ${common} d="M8 13l3 3-2 3m6-10 2 4m5-2-2 4m4 4-4 1"/>`,
    ring:`<circle ${common} cx="16" cy="18" r="8"/><circle ${common} cx="16" cy="18" r="4"/>`,
    bandring:`<circle ${common} cx="16" cy="17" r="9"/><circle ${common} cx="16" cy="17" r="6"/><path ${common} d="M9 13h14"/>`,
    gemring:`<circle ${common} cx="16" cy="19" r="7"/><path ${common} d="M12 10l4-5 4 5-4 4-4-4Z"/>`,
    signetring:`<circle ${common} cx="16" cy="19" r="7"/><rect ${common} x="11" y="6" width="10" height="8" rx="2"/>`,
    watch:`<rect ${common} x="9" y="8" width="14" height="16" rx="4"/><path ${common} d="M12 8V3h8v5m-8 16v5h8v-5"/><circle ${common} cx="16" cy="16" r="4"/><path ${common} d="M16 13v3l2 2"/>`,
    smartwatch:`<rect ${common} x="9" y="8" width="14" height="16" rx="4"/><path ${common} d="M12 8V3h8v5m-8 16v5h8v-5"/><path ${common} d="M13 14h6v4h-6z"/>`,
    digitalwatch:`<rect ${common} x="9" y="8" width="14" height="16" rx="3"/><path ${common} d="M12 8V3h8v5m-8 16v5h8v-5"/><path ${common} d="M12 14h8v5h-8zM14 16h1m2 0h1"/>`,
    pocketwatch:`<circle ${common} cx="16" cy="18" r="9"/><path ${common} d="M16 9V5h4m-4 9v5l3 2M10 4c8-4 14 1 16 6"/>`,
    belt:`<path ${common} d="M5 13h22v7H5v-7Z"/><rect ${common} x="13" y="11" width="8" height="11" rx="1"/>`,
    chainbelt:`<path ${common} d="M5 14c5 6 17 6 22 0"/><ellipse ${common} cx="9" cy="17" rx="2" ry="1"/><ellipse ${common} cx="14" cy="19" rx="2" ry="1"/><ellipse ${common} cx="19" cy="19" rx="2" ry="1"/><ellipse ${common} cx="24" cy="17" rx="2" ry="1"/>`,
    suspenders:`<path ${common} d="M10 5l4 22m8-22-4 22M11 9h10M13 18h6"/>`,
    backpack:`<path ${common} d="M10 9c0-6 12-6 12 0l4 5v13H6V14l4-5Z"/><path ${common} d="M10 15h12v9H10zM12 9h8"/>`,
    briefcase:`<rect ${common} x="5" y="10" width="22" height="15" rx="2"/><path ${common} d="M12 10V6h8v4m-15 7h22m-13 0v3h4v-3"/>`,
    suitcase:`<rect ${common} x="8" y="7" width="16" height="20" rx="3"/><path ${common} d="M12 7V4h8v3m-8 20v2m8-2v2M16 7v20"/>`,
    duffel:`<path ${common} d="M7 12h18l3 12H4l3-12Z"/><path ${common} d="M11 12c0-6 10-6 10 0m-5 0v12"/>`,
    clutch:`<rect ${common} x="6" y="12" width="20" height="12" rx="3"/><path ${common} d="M6 16l10 5 10-5M22 12c0-4 4-4 5-1"/>`,
    tote:`<path ${common} d="M7 11h18l2 16H5l2-16Z"/><path ${common} d="M11 11c0-7 10-7 10 0"/>`,
    crossbody:`<path ${common} d="M4 4l24 24"/><rect ${common} x="9" y="13" width="14" height="11" rx="3"/>`,
    handbag:`<path ${common} d="M7 12h18l2 14H5l2-14Z"/><path ${common} d="M11 12c0-7 10-7 10 0M10 17h12"/>`,
    glove:`<path ${common} d="M10 27V13c0-2 3-2 3 0v-5c0-2 3-2 3 0v5-7c0-2 3-2 3 0v7-5c0-2 3-2 3 0v8l2-3c2-2 5 0 3 3l-6 10c-3 5-11 4-11 1Z"/>`,
    fingerlessglove:`<path ${common} d="M10 27V15h3v-5h3v5h3v-5h3v6l3-2c2-1 4 1 3 3l-6 9c-3 4-9 4-12 1Z"/><path ${common} d="M10 20h12"/>`,
    mitten:`<path ${common} d="M10 27V11c0-7 11-7 11 0v6l3-2c5-2 6 5 2 8l-5 4H10Z"/>`,
    boxingglove:`<path ${common} d="M9 23c-3-7 1-16 8-17 6-1 10 5 8 10l-2 4 4 2-4 6H11l-2-5Z"/><path ${common} d="M11 23h12"/>`,
    scarf:`<path ${common} d="M11 5h10v14H11V5Z"/><path ${common} d="M13 19l-3 10m9-10 3 10m-10-4h3m3 0h3"/>`,
    bandana:`<path ${common} d="M6 8c5 5 15 5 20 0l-10 18L6 8Z"/><path ${common} d="M8 10l-4 5m20-5 4 5"/>`,
    shawl:`<path ${common} d="M5 9c7 7 15 7 22 0l-5 17H10L5 9Z"/><path ${common} d="M12 26l-2 3m6-3v3m6-3 2 3"/>`,
    tie:`<path ${common} d="M13 5h6l2 5-5 5-5-5 2-5Z"/><path ${common} d="M16 15l5 11-5 4-5-4 5-11Z"/>`,
    bowtie:`<path ${common} d="M15 13 7 8v16l8-5h2l8 5V8l-8 5h-2Z"/><rect ${common} x="14" y="12" width="4" height="8" rx="1"/>`,
    hairbow:`<path ${common} d="M15 13 7 8v14l8-4h2l8 4V8l-8 5h-2Z"/><circle ${common} cx="16" cy="16" r="2"/>`,
    hairclip:`<path ${common} d="M7 12c6-4 12-4 18 0l-2 8c-5-3-9-3-14 0l-2-8Z"/><path ${common} d="M10 15h12"/>`,
    headband:`<path ${common} d="M7 22c0-16 18-16 18 0"/><path ${common} d="M10 22c0-12 12-12 12 0"/>`,
    hairpin:`<path ${common} d="M8 8l16 16m-9-16 9 9M8 15l9 9"/>`,
    nosepiercing:`<path ${common} d="M12 7c7 0 10 6 8 11-1 3-4 5-8 4"/><circle ${common} cx="21" cy="17" r="2"/>`,
    browpiercing:`<path ${common} d="M7 15c6-5 12-5 18 0"/><circle ${common} cx="10" cy="12" r="2"/><circle ${common} cx="22" cy="12" r="2"/>`,
    lippiercing:`<path ${common} d="M8 17c5-4 11-4 16 0-5 5-11 5-16 0Z"/><circle ${common} cx="21" cy="21" r="2"/>`,
    piercing:`<circle ${common} cx="16" cy="16" r="8"/><circle ${common} cx="23" cy="10" r="2"/>`,
    phone:`<rect ${common} x="10" y="3" width="12" height="26" rx="3"/><path ${common} d="M14 6h4m-3 20h2"/>`,
    wallet:`<rect ${common} x="5" y="9" width="22" height="15" rx="3"/><path ${common} d="M18 13h9v7h-9c-4 0-4-7 0-7Z"/>`,
    keys:`<circle ${common} cx="11" cy="12" r="5"/><path ${common} d="M15 15l12 12m-5-5 3-3m-7-1 3-3"/>`,
    umbrella:`<path ${common} d="M4 15c4-12 20-12 24 0H4Z"/><path ${common} d="M16 15v10c0 5 7 5 7 0"/>`,
    mask:`<path ${common} d="M6 11c7 3 13 3 20 0v11c-6 6-14 6-20 0V11Z"/><path ${common} d="M6 14 2 11m24 3 4-3m-20 6h12"/>`,
    headphones:`<path ${common} d="M6 17C6 4 26 4 26 17"/><rect ${common} x="4" y="16" width="6" height="10" rx="2"/><rect ${common} x="22" y="16" width="6" height="10" rx="2"/>`,
    stethoscope:`<path ${common} d="M9 4v8c0 8 14 8 14 0V4m-17 0h6m8 0h6M16 20v4c0 5 8 5 8 0"/><circle ${common} cx="24" cy="24" r="3"/>`,
    camera:`<rect ${common} x="4" y="9" width="24" height="17" rx="3"/><circle ${common} cx="16" cy="18" r="5"/><path ${common} d="M10 9l2-4h8l2 4"/>`,
    accessory:`<circle ${common} cx="16" cy="16" r="8"/><path ${common} d="M16 7v18M7 16h18"/>`,
  };
  return icons[kind] || icons.accessory;
}

function itemGlyphHtml(categoryId, item) {
  const kind = iconKind(categoryId, item);
  return `<span class="ghw-item-glyph ghw-icon-${esc(kind)}" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false">${vectorIcon(kind)}</svg></span>`;
}

function itemGrid() {
  const category = CATALOG[activeCategory];
  if (!category) return '';
  const q = lc(searchText);
  const items = category.items.filter(item => !q || lc(item.label).includes(q) || lc(item.id).includes(q));
  return `<div class="ghw-item-grid">${items.map(item => `<button type="button" class="ghw-item ${isSelected(activeCategory,item.id)?'selected':''}" data-ghw-item="${esc(item.id)}">${itemGlyphHtml(activeCategory,item)}<span>${esc(item.label)}</span>${isSelected(activeCategory,item.id)?'<i class="fa-solid fa-check ghw-check"></i>':''}</button>`).join('') || `<div class="ghw-empty">No items match this search.</div>`}</div>`;
}

function selectedSummary() {
  const blocks = [];
  for (const [categoryId, category] of Object.entries(CATALOG)) {
    const rows = selectedRows(categoryId);
    if (!rows.length) continue;
    blocks.push(`<div class="ghw-selected-group"><strong>${esc(category.label)}</strong>${rows.map(row => { const item = CATALOG[categoryId]?.items?.find(x=>x.id===row.id); return `<div class="ghw-selected-row"><span class="ghw-selected-name">${itemGlyphHtml(categoryId,item)}<em>${esc(itemLabel(categoryId,row.id))}</em></span><select data-ghw-color="${esc(categoryId)}|${esc(row.id)}">${COLORS.map(color => `<option value="${esc(color)}" ${row.color===color?'selected':''}>${esc(color || 'Color unspecified')}</option>`).join('')}</select><button type="button" data-ghw-remove="${esc(categoryId)}|${esc(row.id)}"><i class="fa-solid fa-xmark"></i></button></div>`; }).join('')}</div>`);
  }
  return blocks.length ? `<section class="ghw-selected"><h3>Selected outfit <small>${totalSelected()} items</small></h3>${blocks.join('')}</section>` : `<section class="ghw-selected ghw-selected-empty"><i class="fa-solid fa-shirt"></i><div><b>No garments selected</b><span>If you save now, this person will be explicitly naked. Use “Reset to Unknown” if the outfit is simply unknown.</span></div></section>`;
}

function renderDialog() {
  const dialog = document.querySelector('#ghw-dialog');
  if (!dialog?.open && !dialog?.hasAttribute('open')) return;
  ensureDraft();
  const person = personByKey(activePersonKey);
  const category = CATALOG[activeCategory] || Object.values(CATALOG)[0];
  const existing = getOutfit(activePersonKey);

  dialog.innerHTML = `<div class="ghw-shell">
    <header class="ghw-header">
      <div class="ghw-brand"><span class="ghw-logo"><i class="fa-solid fa-shirt"></i></span><div><b>Greyhaven Wardrobe</b><small>Authoritative clothing & accessories</small></div></div>
      <button type="button" data-ghw-close><i class="fa-solid fa-xmark"></i></button>
    </header>
    <div class="ghw-personbar">
      <div class="ghw-person-avatar">${personAvatar(person)}</div>
      <label><span>Editing outfit for</span><select data-ghw-person>${currentPersonOptions()}</select></label>
      <em class="mode-${esc(existing.mode)}">${esc(existing.mode==='unknown'?'Unknown':existing.mode==='naked'?'Naked':'Saved outfit')}</em>
    </div>
    <div class="ghw-tools">
      <button type="button" data-ghw-detect ${detectBusy?'disabled':''}><i class="fa-solid fa-wand-magic-sparkles"></i>${detectBusy?' Detecting…':' Detect from current chat'}</button>
      <button type="button" data-ghw-clear><i class="fa-solid fa-eraser"></i> Clear selections</button>
      <button type="button" data-ghw-unknown><i class="fa-regular fa-circle-question"></i> Reset to Unknown</button>
    </div>
    <div class="ghw-main">
      <aside class="ghw-categories">${categoryButtons()}</aside>
      <section class="ghw-browser">
        <div class="ghw-browser-head"><div><b><i class="${esc(category.icon)}"></i> ${esc(category.label)}</b><small>${category.multi?'Multiple selections allowed':'One selection — choosing another replaces it'}</small></div><label><i class="fa-solid fa-magnifying-glass"></i><input type="search" data-ghw-search value="${esc(searchText)}" placeholder="Search ${esc(category.label.toLowerCase())}…"></label></div>
        ${itemGrid()}
        ${selectedSummary()}
      </section>
    </div>
    <footer class="ghw-footer"><span>${totalSelected()?`${totalSelected()} selected`:'No items selected'}</span><button type="button" data-ghw-save><i class="fa-solid fa-check"></i> Save outfit</button></footer>
  </div>`;
}

function openWardrobe() {
  if (!hasChat()) {
    globalThis.toastr?.warning?.('Open a SillyTavern chat first. Wardrobe state is stored per chat.');
    return;
  }
  document.querySelector('#ghw-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'ghw-dialog';
  document.body.appendChild(dialog);
  activePersonKey = personaDescriptor()?.key || allPeople()[0]?.key || '';
  activeCategory = 'top';
  searchText = '';
  draft = getOutfit(activePersonKey);
  try { dialog.showModal(); } catch { dialog.setAttribute('open',''); }
  renderDialog();
}

function closeWardrobe() {
  const dialog = document.querySelector('#ghw-dialog');
  if (!dialog) return;
  try { dialog.close(); } catch {}
  dialog.remove();
  draft = null;
  searchText = '';
}

function recentChatExcerpt() {
  const c = ctx();
  const messages = Array.isArray(c?.chat) ? c.chat.slice(-36) : [];
  const lines = messages.map(message => {
    const who = norm(message?.name || (message?.is_user ? c?.name1 : 'Character')) || 'Unknown';
    const text = norm(message?.mes || message?.text || message?.content).replace(/\s+/g,' ');
    return text ? `${who}: ${text}` : '';
  }).filter(Boolean);
  let joined = lines.join('\n');
  if (joined.length > 18000) joined = joined.slice(-18000);
  return joined;
}

function normalizeLabel(value) {
  return lc(value).replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function closestCatalogItem(categoryId, candidate) {
  const category = CATALOG[categoryId];
  if (!category) return null;
  const target = normalizeLabel(candidate);
  if (!target) return null;
  const exact = category.items.find(item => normalizeLabel(item.label) === target || normalizeLabel(item.id) === target);
  if (exact) return exact;
  const tokens = new Set(target.split(' ').filter(x => x.length > 2));
  let best = null, bestScore = 0;
  for (const item of category.items) {
    const label = normalizeLabel(item.label);
    if (label.includes(target) || target.includes(label)) return item;
    const its = new Set(label.split(' ').filter(x => x.length > 2));
    const common = [...tokens].filter(x => its.has(x)).length;
    const union = new Set([...tokens,...its]).size || 1;
    const score = common / union;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= 0.34 ? best : null;
}

function parseJsonLoose(raw) {
  let text = norm(raw).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first,last+1);
  return JSON.parse(text);
}

function detectionPrompt() {
  const people = currentRelevantPeople();
  const categories = Object.entries(CATALOG).map(([id,c]) => `${id}=${c.label}`).join(', ');
  const examples = Object.entries(CATALOG).map(([id,c]) => `${id}: ${c.items.slice(0,8).map(x=>x.label).join(' | ')}`).join('\n');
  return {
    systemPrompt: `You analyze fictional roleplay clothing. Return JSON only. Never invent clothing that the recent chat does not establish or strongly imply. Unknown is preferred over guessing. Use mode "naked" only when the text clearly establishes total nudity. For set outfits, list only garments/accessories that are actually established. ALSO list category IDs in "absent" only when the text explicitly establishes that category is not being worn (for example topless => top and bra absent; barefoot => footwear absent; "no underwear" => underwear absent). Do not treat unmentioned categories as absent. Colors are optional and must be a simple common color word or empty string.`,
    prompt: `CURRENT PEOPLE:\n${people.map(p=>`- ${p.name}`).join('\n')}\n\nALLOWED CATEGORY IDS:\n${categories}\n\nEXAMPLES OF CATALOG WORDING (choose the closest existing garment label; you do not need an exact example):\n${examples}\n\nRECENT ROLEPLAY:\n${recentChatExcerpt()}\n\nReturn exactly this shape:\n{"people":[{"name":"Aurora","mode":"unknown|naked|set","items":[{"category":"top","label":"Oversized T-shirt","color":"white"}]}]}\nInclude each current person once. Do not add commentary.`
  };
}

async function detectFromChat() {
  const c = ctx();
  if (!c?.generateRaw || detectBusy) {
    if (!c?.generateRaw) globalThis.toastr?.warning?.('SillyTavern generateRaw is not available with the current connection.');
    return;
  }
  detectBusy = true;
  renderDialog();
  try {
    const { prompt, systemPrompt } = detectionPrompt();
    let raw = '';
    try { raw = await c.generateRaw({ prompt, systemPrompt, responseLength: 1500, trimNames: false }); }
    catch { raw = await c.generateRaw(prompt); }
    const parsed = parseJsonLoose(raw);
    const proposals = [];
    const current = currentRelevantPeople();
    for (const row of Array.isArray(parsed?.people) ? parsed.people : []) {
      const person = current.find(p => lc(p.name) === lc(row?.name));
      if (!person) continue;
      const mode = ['unknown','naked','set'].includes(row?.mode) ? row.mode : 'unknown';
      const outfit = emptyOutfit(mode, mode === 'set' ? 'partial' : 'complete');
      if (mode === 'set') {
        outfit.knownAbsent = [...new Set((Array.isArray(row?.absent) ? row.absent : []).map(norm).filter(id => CATALOG[id]))];
        for (const proposed of Array.isArray(row?.items) ? row.items : []) {
          const categoryId = norm(proposed?.category);
          const category = CATALOG[categoryId];
          const item = closestCatalogItem(categoryId, proposed?.label || proposed?.id);
          if (!category || !item) continue;
          const colorRaw = lc(proposed?.color);
          const color = COLORS.includes(colorRaw) ? colorRaw : '';
          if (category.multi) {
            if (!outfit.items[categoryId].some(x => x.id === item.id)) outfit.items[categoryId].push({ id:item.id, color });
          } else {
            outfit.items[categoryId] = [{ id:item.id, color }];
          }
        }
        if (!totalSelected(outfit) && !outfit.knownAbsent.length) outfit.mode = 'unknown';
      }
      proposals.push({ person, outfit });
    }
    showDetectionReview(proposals);
  } catch (error) {
    console.warn(`[${GHW_MODULE}] detection failed`, error);
    globalThis.toastr?.error?.('Could not detect outfits from the current chat. Nothing was changed.');
  } finally {
    detectBusy = false;
    renderDialog();
  }
}

function showDetectionReview(proposals) {
  document.querySelector('#ghw-detect-review')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'ghw-detect-review';
  const cards = proposals.length ? proposals.map((p,index) => `<label class="ghw-review-card"><input type="checkbox" value="${index}" checked><div><b>${esc(p.person.name)}</b><span>${esc(p.outfit.mode==='unknown'?'Unknown — leave unchanged':p.outfit.mode==='naked'?'Naked':describeOutfit(p.person,p.outfit))}</span></div></label>`).join('') : `<div class="ghw-empty">No confident clothing state was found.</div>`;
  dialog.innerHTML = `<div class="ghw-review-shell"><header><div><b>Review detected outfits</b><small>Nothing changes until you apply it.</small></div><button type="button" data-ghw-review-close><i class="fa-solid fa-xmark"></i></button></header><main>${cards}</main><footer><button type="button" data-ghw-review-close>Cancel</button><button type="button" class="primary" data-ghw-review-apply>Apply selected</button></footer></div>`;
  document.body.appendChild(dialog);
  dialog._proposals = proposals;
  try { dialog.showModal(); } catch { dialog.setAttribute('open',''); }
}

function applyDetectionReview(dialog) {
  const proposals = dialog?._proposals || [];
  const s = state();
  if (!s) return;
  for (const input of dialog.querySelectorAll('input[type="checkbox"]:checked')) {
    const p = proposals[Number(input.value)];
    if (!p || p.outfit.mode === 'unknown') continue;
    const normalized = normalizeOutfit(p.outfit);
    normalized.updatedAt = Date.now();
    s.outfits[p.person.key] = normalized;
  }
  persist(s);
  try { dialog.close(); } catch {}
  dialog.remove();
  draft = getOutfit(activePersonKey);
  renderDialog();
  globalThis.toastr?.success?.('Selected detected outfits applied.');
}

function buildMenuEntry() {
  const menu = document.querySelector('#extensionsMenu');
  if (!menu || document.querySelector('#ghw-menu-entry')) return;
  const entry = document.createElement('div');
  entry.id = 'ghw-menu-entry';
  entry.className = 'list-group-item flex-container flexGap5 interactable';
  entry.tabIndex = 0;
  entry.innerHTML = `<i class="fa-solid fa-shirt"></i><span>Greyhaven Wardrobe</span>`;
  entry.addEventListener('click', openWardrobe);
  entry.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openWardrobe(); }
  });
  menu.appendChild(entry);
}

function observeMenu() {
  if (menuObserver) return;
  const attach = () => {
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) return false;
    buildMenuEntry();
    menuObserver = new MutationObserver(buildMenuEntry);
    menuObserver.observe(menu,{childList:true});
    return true;
  };
  if (attach()) return;
  const boot = new MutationObserver(() => { if (attach()) boot.disconnect(); });
  boot.observe(document.body,{childList:true,subtree:true});
}

function handleClick(event) {
  const button = event.target.closest('button,[data-ghw-person]');
  if (!button) return;
  if (button.matches('[data-ghw-close]')) return closeWardrobe();
  if (button.dataset.ghwCategory) { activeCategory = button.dataset.ghwCategory; searchText=''; return renderDialog(); }
  if (button.dataset.ghwItem) return toggleItem(activeCategory, button.dataset.ghwItem);
  if (button.dataset.ghwRemove) {
    const [categoryId,itemId] = button.dataset.ghwRemove.split('|');
    return toggleItem(categoryId,itemId);
  }
  if (button.matches('[data-ghw-clear]')) { draft = emptyOutfit('set'); return renderDialog(); }
  if (button.matches('[data-ghw-unknown]')) {
    resetUnknown(activePersonKey); draft = getOutfit(activePersonKey); renderDialog();
    return globalThis.toastr?.success?.('Outfit reset to Unknown.');
  }
  if (button.matches('[data-ghw-save]')) {
    const count = totalSelected();
    draft.mode = count ? 'set' : 'naked';
    draft.coverage = 'complete';
    draft.knownAbsent = [];
    saveOutfit(activePersonKey,draft);
    draft = getOutfit(activePersonKey);
    renderDialog();
    return globalThis.toastr?.success?.(count ? 'Outfit saved.' : 'Saved as explicitly naked.');
  }
  if (button.matches('[data-ghw-detect]')) return detectFromChat();
  if (button.matches('[data-ghw-review-close]')) {
    const d = button.closest('dialog'); try { d?.close(); } catch {} d?.remove(); return;
  }
  if (button.matches('[data-ghw-review-apply]')) return applyDetectionReview(button.closest('dialog'));
}

function handleChange(event) {
  const target = event.target;
  if (target.matches('[data-ghw-person]')) return setActivePerson(target.value);
  if (target.matches('[data-ghw-color]')) {
    const [categoryId,itemId] = target.dataset.ghwColor.split('|');
    return setColor(categoryId,itemId,target.value);
  }
}

function handleInput(event) {
  const target = event.target;
  if (!target.matches('[data-ghw-search]')) return;
  searchText = target.value;
  const browser = target.closest('.ghw-browser');
  const old = browser?.querySelector('.ghw-item-grid');
  if (old) old.outerHTML = itemGrid();
}

function bindEvents() {
  if (bound) return;
  const c = ctx();
  if (c?.eventSource && c?.eventTypes) {
    const bind = (key,fn) => { const name=c.eventTypes[key]; if(name)c.eventSource.on(name,fn); };
    for (const key of ['GENERATION_STARTED','CHAT_CHANGED','CHAT_CREATED','PERSONA_CHANGED','GROUP_UPDATED','CHARACTER_EDITED','MESSAGE_EDITED','MESSAGE_UPDATED']) {
      bind(key, () => setTimeout(updatePrompt,20));
    }
  }
  document.addEventListener('click',handleClick);
  document.addEventListener('change',handleChange);
  document.addEventListener('input',handleInput);
  bound = true;
}

function exposeApi() {
  globalThis.GreyhavenWardrobe = {
    version: GHW_VERSION,
    open: openWardrobe,
    getState: () => clone(state(false)),
    getOutfit: personKey => clone(getOutfit(personKey)),
    setOutfit: (personKey,outfit) => saveOutfit(personKey,outfit),
    resetUnknown,
    getPromptSummary: buildPrompt,
    getCatalog: () => clone(CATALOG),
    getColors: () => [...COLORS],
  };
}

async function init() {
  if (ready) return;
  for (let i=0;i<200;i++) {
    if (globalThis.SillyTavern?.getContext && document.body) break;
    await new Promise(resolve => setTimeout(resolve,50));
  }
  observeMenu();
  bindEvents();
  exposeApi();
  updatePrompt();
  ready = true;
  console.info(`[${GHW_MODULE}] v${GHW_VERSION} ready with ${Object.values(CATALOG).reduce((n,c)=>n+c.items.length,0)} catalog items.`);
}

init().catch(error => console.error(`[${GHW_MODULE}] init failed`,error));
