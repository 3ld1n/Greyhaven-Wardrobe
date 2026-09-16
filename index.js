import { COLORS, CATALOG } from './catalog.js';

const GHW_MODULE = 'greyhaven-wardrobe';
const GHW_VERSION = '1.1.0';
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


function itemGlyph(categoryId, item) {
  const text = lc(`${item?.id || ''} ${item?.label || ''}`);

  const has = (...words) => words.some(word => text.includes(word));
  if (categoryId === 'bra') return has('sports') ? '🎽' : has('corset','bustier','longline') ? '🎀' : '👙';
  if (categoryId === 'underwear') return has('boxer','short','long john','thermal') ? '🩳' : '🩲';
  if (categoryId === 'top') {
    if (has('lab coat','chef jacket','scrub')) return '🥼';
    if (has('hoodie','sweater','cardigan','sweatshirt','jacket')) return '🧥';
    if (has('tank','jersey','running','sports','compression')) return '🎽';
    if (has('blouse','camisole','halter','crop','tube','peplum')) return '👚';
    if (has('corset','bustier','bodice')) return '🎀';
    return '👕';
  }
  if (categoryId === 'bottom') {
    if (has('short')) return '🩳';
    if (has('skirt','sarong','kilt')) return '👗';
    return '👖';
  }
  if (categoryId === 'onepiece') {
    if (has('jumpsuit','romper','bodysuit','leotard','unitard')) return '🩱';
    if (has('overall')) return '👖';
    if (has('robe','kimono','kaftan')) return '🥻';
    return '👗';
  }
  if (categoryId === 'outerwear') {
    if (has('blazer','suit')) return '🤵';
    if (has('rain','poncho')) return '🌧️';
    if (has('cardigan','shawl')) return '🧶';
    return '🧥';
  }
  if (categoryId === 'sleepwear') return has('robe') ? '🧖' : has('nightgown','slip') ? '👗' : '🌙';
  if (categoryId === 'swim_top') return '👙';
  if (categoryId === 'swim_bottom') return has('short','trunk','board') ? '🩳' : '👙';
  if (categoryId === 'socks' || categoryId === 'hosiery') return '🧦';
  if (categoryId === 'footwear') {
    if (has('barefoot')) return '🦶';
    if (has('flip-flop','slides')) return '🩴';
    if (has('sandal')) return '👡';
    if (has('slipper','flat','loafer','ballet')) return '🥿';
    if (has('heel','pump','stiletto','platform')) return '👠';
    if (has('boot')) return '👢';
    if (has('oxford','derby','dress shoe','monk')) return '👞';
    if (has('skate')) return '⛸️';
    if (has('ski')) return '🎿';
    return '👟';
  }
  if (categoryId === 'headwear') {
    if (has('cap')) return '🧢';
    if (has('crown','tiara')) return '👑';
    if (has('cowboy')) return '🤠';
    if (has('sun hat','straw','floppy')) return '👒';
    if (has('helmet','hard hat')) return '⛑️';
    if (has('beanie')) return '🧶';
    return '🎩';
  }
  if (categoryId === 'eyewear') return has('sun') ? '🕶️' : has('goggle') ? '🥽' : '👓';
  if (categoryId === 'earrings') return has('pearl') ? '⚪' : '💎';
  if (categoryId === 'necklaces') return has('pearl','bead','rosary') ? '📿' : '💎';
  if (categoryId === 'bracelets') return has('anklet') ? '✨' : '🔗';
  if (categoryId === 'rings') return '💍';
  if (categoryId === 'watches') return has('pocket') ? '🕰️' : '⌚';
  if (categoryId === 'belts') return has('suspender') ? '👔' : '➰';
  if (categoryId === 'bags') {
    if (has('backpack')) return '🎒';
    if (has('briefcase','laptop')) return '💼';
    if (has('suitcase','carry-on','garment bag')) return '🧳';
    if (has('shopping','tote','shopper')) return '🛍️';
    if (has('clutch','wristlet')) return '👝';
    return '👜';
  }
  if (categoryId === 'gloves') return has('boxing') ? '🥊' : '🧤';
  if (categoryId === 'scarves') return '🧣';
  if (categoryId === 'ties') return '👔';
  if (categoryId === 'hair_accessories') return has('bow','ribbon') ? '🎀' : has('crown','tiara') ? '👑' : '✨';
  if (categoryId === 'piercings') return '💎';
  if (categoryId === 'other_accessories') {
    if (has('phone')) return '📱';
    if (has('badge','id','pass')) return '🪪';
    if (has('wallet','card holder')) return '👛';
    if (has('key')) return '🔑';
    if (has('umbrella')) return '☂️';
    if (has('cane','walking stick','crutch')) return '🦯';
    if (has('mask')) return '😷';
    if (has('earbud','headphone','headset')) return '🎧';
    if (has('stethoscope')) return '🩺';
    if (has('camera')) return '📷';
    if (has('binocular')) return '🔭';
    if (has('bead','rosary')) return '📿';
    if (has('fan')) return '🪭';
    if (has('lighter')) return '🔥';
    return '✨';
  }
  return '•';
}

function itemGlyphHtml(categoryId, item) {
  return `<span class="ghw-item-glyph" aria-hidden="true">${esc(itemGlyph(categoryId,item))}</span>`;
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
