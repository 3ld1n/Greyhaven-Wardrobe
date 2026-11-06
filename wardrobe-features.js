/* Greyhaven Wardrobe v1.4 — wearing styles, reusable outfit presets and costume coverage.
 * Adds features without replacing the existing Wardrobe state, detection or saved outfits.
 */
import { CATALOG } from './catalog.js';
import { EXPANDED_TOTAL, EXPANDED_COUNTS } from './wardrobe-catalog-expansion.js';

const MODULE = 'greyhaven-wardrobe-features';
const VERSION = '1.4.1';
const META = 'greyhavenWardrobeExpanded';
const SETTINGS = 'greyhavenWardrobeExpansion';
const PROMPT = 'greyhaven_wardrobe_wearing_details';
const norm = x => String(x ?? '').trim();
const esc = x => String(x ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const clone = value => { try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); } };
const context = () => { try { return globalThis.SillyTavern?.getContext?.() || null; }catch{return null;} };
const api = () => globalThis.GreyhavenWardrobe;
const uid = () => { try{return crypto.randomUUID();}catch{return `ghw-${Date.now()}-${Math.random().toString(36).slice(2)}`;} };
const toast = (kind,message) => {try{globalThis.toastr?.[kind]?.(message);}catch{} };

const COMMON = [
  ['normal','Worn normally'],
  ['loose','Worn loosely'],
  ['adjusted','Adjusted for comfort'],
];
const SELECTORS = {
 bra: [['straps-loose','Straps loosened'],['one-strap','One shoulder strap lowered'],['both-straps','Both straps lowered'],['clasp-open','Back clasp unclasped'],['front-open','Front closure undone'],['shifted','Shifted out of normal position'],['under-top','Worn underneath a top']],
 underwear: [['high-hips','Pulled high on hips'],['low-hips','Worn low on hips'],['waist-rolled','Waistband rolled over'],['side-adjusted','One side pulled aside'],['thighs','Pulled down to thighs'],['knees','Pulled down to knees'],['ankles','Pulled down to ankles'],['inside-out','Worn inside out']],
 top: [['tucked','Fully tucked into waistband'],['half-tuck','Front half tucked in'],['untucked','Loose and untucked'],['hem-knotted','Hem tied into a knot'],['cropped-tuck','Hem tucked upward'],['sleeves-up','Sleeves pushed or rolled up'],['one-sleeve','One sleeve slipped off shoulder'],['one-shoulder','One shoulder exposed'],['off-shoulders','Both shoulders lowered'],['buttons-top','Top buttons undone'],['open','Worn open at the front'],['hood-up','Hood pulled up'],['hood-down','Hood resting down'],['half-zipped','Half zipped'],['unzipped','Unzipped'],['around-waist','Tied around waist']],
 bottom: [['high-waist','Pulled high on waist'],['hips-low','Worn low on hips'],['ultra-low','Waistband pulled very low on hips'],['waist-fold','Waistband folded down'],['cuffed','Cuffs rolled up'],['belt-loose','Belt or drawstring loosened'],['unbuttoned','Waist button undone'],['zip-down','Fly partly unzipped'],['thighs','Lowered to thighs'],['knees','Lowered to knees'],['ankles','Lowered to ankles'],['skirt-hip','Skirt shifted slightly to one hip'],['hem-gathered','Hem gathered or lifted']],
 onepiece: [['belted','Belt tightened'],['belt-loose','Belt loose'],['one-strap','One shoulder strap lowered'],['straps-down','Both shoulder straps lowered'],['one-shoulder','One shoulder exposed'],['open-back','Back closure open'],['front-open','Front partially open'],['unzipped','Zip partly open'],['hem-gathered','Hem gathered upward'],['waist-wrap','Towel wrapped at waist rather than chest'],['over-shoulders','Draped over shoulders'],['tied-side','Side tie adjusted']],
 outerwear: [['open','Worn open'],['unbuttoned','Buttons undone'],['half-zipped','Half zipped'],['unzipped','Fully unzipped'],['sleeves-up','Sleeves pushed or rolled up'],['draped','Draped over shoulders without arms in sleeves'],['one-shoulder','Slipped off one shoulder'],['tied-waist','Tied around waist'],['hood-up','Hood up'],['hood-down','Hood down'],['collar-up','Collar popped'],['front-closed','Buttoned or zipped closed']],
 swim_top: [['straps-loose','Straps loosened'],['one-strap','One strap lowered'],['straps-down','Straps lowered'],['tie-loose','Back or neck tie loosened'],['tie-open','Tie undone'],['shifted','Swim top shifted out of position'],['coverup','Worn under a cover-up']],
 swim_bottom: [['high-hips','Pulled high on hips'],['low-hips','Worn low on hips'],['side-shift','One side shifted'],['tie-loose','Side ties loose'],['thighs','Pulled down to thighs'],['knees','Pulled down to knees'],['covered','Worn under a cover-up']],
 sleepwear: [['collar-open','Collar open'],['buttons-open','Upper buttons undone'],['open','Robe worn open'],['belt-loose','Robe belt loosely tied'],['belt-closed','Robe belt tied closed'],['one-shoulder','Off one shoulder'],['sleeves-up','Sleeves pushed up'],['hood-up','Hood up'],['untucked','Loose and untucked'],['hem-knotted','Hem tied up']],
 socks: [['pulled-up','Pulled all the way up'],['slouch','Scrunched or slouched down'],['rolled','Cuffs folded down'],['one-lowered','One sock pulled lower than the other'],['ankles','Pushed down to ankles']],
 hosiery: [['pulled-up','Pulled up smoothly'],['lowered-thigh','Rolled down to thighs'],['lowered-knee','Rolled down to knees'],['ankles','Gathered at ankles'],['one-down','One side lower than the other'],['visible-band','Top band visible']],
 footwear: [['untied','Laces untied'],['loose-laces','Loosely laced'],['heel-out','Heel partly slipped out'],['unbuckled','Buckles unfastened'],['half-zipped','Boot zippers half open'],['folded-cuff','Boot tops folded down'],['carried','Carried in hand rather than worn']],
 headwear: [['tilted','Tilted to one side'],['backward','Worn backwards'],['loose','Worn loosely'],['pulled-low','Pulled low over forehead'],['above-hair','Resting above hair'],['hood-over','Covered by hood'],['around-neck','Resting around neck instead of head']],
 eyewear: [['on-head','Pushed up onto hair'],['nose-low','Resting low on nose'],['held','Held in hand'],['hanging','Hanging from collar'],['normal','Worn normally']],
 earrings: [['single','Only one earring worn'],['mismatched','Worn as mismatched pair'],['layered','Layered with other ear jewelry']],
 necklaces: [['short','Worn close to neck'],['long','Worn long on chest'],['under-top','Hidden under top'],['outside-top','Visible over top'],['layered','Layered with other necklaces'],['clasp-front','Clasp visible at front']],
 bracelets: [['loose','Loose on wrist'],['high-arm','Pushed higher on forearm'],['stacked','Stacked with other bracelets'],['ankle','Worn around ankle']],
 rings: [['stacked','Stacked with other rings'],['pinky','Worn on pinky'],['index','Worn on index finger'],['middle','Worn on middle finger'],['thumb','Worn on thumb'],['ring-finger','Worn on ring finger']],
 watches: [['left','Worn on left wrist'],['right','Worn on right wrist'],['loose','Loose around wrist'],['over-sleeve','Worn over sleeve']],
 belts: [['high-waist','Fastened at waist'],['low-hips','Slung low on hips'],['loose','Loosely fastened'],['unbuckled','Unbuckled'],['hanging','Hanging through belt loops'],['over-coat','Fastened over outerwear']],
 bags: [['shoulder','Over one shoulder'],['crossbody','Across torso'],['front','Worn across the front'],['back','Worn behind back'],['hand','Carried in hand'],['elbow','Held on crook of elbow'],['waist','Worn around waist'],['open','Bag open']],
 gloves: [['one-off','One glove removed'],['cuffs-folded','Cuffs folded'],['half-on','Partly pulled on'],['carried','Held in hand']],
 scarves: [['loose','Loosely draped around neck'],['double-wrap','Wrapped twice around neck'],['over-head','Draped over head'],['shoulders','Draped over shoulders'],['face','Pulled up over lower face'],['hair-tie','Tied around hair'],['waist','Tied around waist']],
 ties: [['loose','Knot loosened'],['untied','Untied around neck'],['bow-loose','Bow tie slightly loosened'],['short','Tied short'],['under-collar','Tucked beneath collar']],
 hair_accessories: [['top','Placed at crown'],['back','Worn at back of head'],['side','Worn to one side'],['loose','Loosely secured'],['half-up','Securing half-up hairstyle']],
 piercings: [['left','Worn on left side'],['right','Worn on right side'],['double','Paired with second piercing'],['hidden','Concealed under clothing']],
 other_accessories: [['hand','Held in hand'],['wrist','Worn on wrist'],['neck','Hanging from neck'],['pocket','Tucked into pocket'],['shoulder','Carried over shoulder'],['waist','Worn at waist'],['hair','Wrapped around hair'],['folded','Folded or stowed']],
 costumes: [['full','Complete costume worn'],['partial','Only selected costume pieces worn'],['casual','Costume layered over normal clothes'],['hood-up','Costume hood raised'],['mask-up','Costume mask lifted'],['mask-down','Costume mask worn'],['cape-shoulder','Cape draped over one shoulder'],['unfastened','Costume partly unfastened'],['helmet-off','Helmet or headpiece removed'],['gloves-off','Costume gloves removed']],
};

function optionsFor(cat,item){
  const itemLabel=String(CATALOG[cat]?.items?.find(x=>x.id===item)?.label || '').toLowerCase();
  let values=SELECTORS[cat] || COMMON;
  // Only show garment-relevant choices, particularly for towels, dresses, caps and jewelry.
  if(cat==='onepiece' && /towel/.test(itemLabel)) values=[['normal','Wrapped normally'],['waist-wrap','Wrapped around waist'],['chest-wrap','Wrapped around chest'],['shoulders','Draped over shoulders'],['loose','Tied loosely']];
  else if(cat==='top' && /hoodie/.test(itemLabel)) values=values.filter(x=>!['buttons-top','open'].includes(x[0]));
  else if(cat==='top' && /tee|t-shirt|shirt|blouse|sweater|polo|hoodie|cardigan/.test(itemLabel)) values=values.filter(x=>!['hood-up','hood-down','half-zipped','unzipped'].includes(x[0]) || /hoodie|zip|cardigan/.test(itemLabel));
  else if(cat==='bottom' && /skirt|kilt|sarong/.test(itemLabel)) values=values.filter(x=>!['unbuttoned','zip-down','cuffed'].includes(x[0]));
  else if(cat==='headwear' && /towel|turban|bonnet|veil|crown|tiara|hijab/.test(itemLabel)) values=values.filter(x=>!['backward','pulled-low'].includes(x[0]));
  else if(cat==='footwear' && /barefoot/.test(itemLabel)) values=[];
  else if(cat==='bra' && /adhesive|strapless|bandeau/.test(itemLabel)) values=values.filter(x=>!['straps-loose','one-strap','both-straps'].includes(x[0]));
  return [['normal','Worn normally (no extra prompt text)'],...values.filter(x=>x[0]!=='normal')];
}
const optionLabel=(cat,item,key)=>optionsFor(cat,item).find(([value])=>value===key)?.[1] || '';
const styleKey=(cat,id)=>`${cat}|${id}`;
const meta=()=>{const c=context();if(!c?.chatMetadata)return null;const root=c.chatMetadata[META] ||= {version:1,styles:{}};root.styles ||= {};return root;};
function persistMeta(){const c=context(),m=meta();if(!c?.chatMetadata||!m)return;try{c.updateChatMetadata?.({[META]:m});c.saveMetadataDebounced?.();}catch(error){console.warn(`[${MODULE}] metadata saving`,error);} }
function personStyles(key,create=true){const root=meta();if(!root||!key)return {};if(create)root.styles[key] ||= {};return root.styles[key] || {};}
function currentPerson(){return document.querySelector('#ghw-dialog [data-ghw-person]')?.value || '';}
function getSettings(){const c=context();if(!c?.extensionSettings)return null;c.extensionSettings[SETTINGS] ||= {version:1,presets:{}};c.extensionSettings[SETTINGS].presets ||= {};return c.extensionSettings[SETTINGS];}
function persistSettings(){try{context()?.saveSettingsDebounced?.();}catch(e){console.warn(`[${MODULE}] settings saving`,e);}}
function personPresets(key){const root=getSettings();if(!root || !key)return [];if(!Array.isArray(root.presets[key]))root.presets[key]=[];return root.presets[key];}
function colorRowsFromScreen(){const result={mode:'set',coverage:'complete',knownAbsent:[],items:{},updatedAt:Date.now()};for(const row of document.querySelectorAll('#ghw-dialog [data-ghw-color]')){const raw=row.dataset.ghwColor||'';const sep=raw.indexOf('|');if(sep<1)continue;const cat=raw.slice(0,sep),id=raw.slice(sep+1);if(!CATALOG[cat] || !CATALOG[cat].items.some(x=>x.id===id))continue;(result.items[cat] ||= []).push({id,color:row.value||''});}result.mode=Object.values(result.items).some(x=>x.length)?'set':'naked';return result;}
function styleRowsFromScreen(){const result={...personStyles(currentPerson(),false)};for(const el of document.querySelectorAll('#ghw-dialog [data-ghwx-style]')){result[el.dataset.ghwxStyle]=el.value||'normal';}return result;}
function refreshPresetModal(chosen='') {
  const modal=document.querySelector('#ghwx-presets-modal');
  if(!modal)return;
  const name=personName(currentPerson()) || 'this character';
  const presets=personPresets(currentPerson());
  modal.innerHTML=`<div class="ghwx-popup">
    <header><strong><i class="fa-solid fa-bookmark"></i> Saved outfits</strong><button type="button" data-ghwx-close-presets aria-label="Close saved outfits">×</button></header>
    <div class="ghwx-popup-content"><p>Reusable outfit presets for <b>${esc(name)}</b>. Each chat keeps its own current outfit.</p>
    <label>Choose an outfit <select data-ghwx-preset><option value="">Choose a saved outfit…</option>${presets.map(x=>`<option value="${esc(x.id)}" ${chosen===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
    <div class="ghwx-popup-actions">
      <button type="button" data-ghwx-save><i class="fa-solid fa-floppy-disk"></i> Save current</button>
      <button type="button" data-ghwx-apply><i class="fa-solid fa-shirt"></i> Wear selected</button>
      <button type="button" data-ghwx-delete aria-label="Delete selected outfit"><i class="fa-solid fa-trash"></i></button>
    </div></div></div>`;
}
function openPresetsModal(){
  document.querySelector('#ghwx-presets-modal')?.remove();
  const modal=document.createElement('dialog');modal.id='ghwx-presets-modal';document.body.appendChild(modal);
  refreshPresetModal();try{modal.showModal();}catch{modal.setAttribute('open','');}
}
function closePresetsModal(){const modal=document.querySelector('#ghwx-presets-modal');if(!modal)return;try{modal.close();}catch{}modal.remove();}
function storePreset(){
  const key=currentPerson();if(!key){toast('warning','Select a character.');return;}
  const outfit=colorRowsFromScreen(),styles=styleRowsFromScreen();
  const proposed=prompt('Name this outfit preset (saved for this character):','Favorite outfit');
  const name=norm(proposed).slice(0,64);if(!name)return;
  const presets=personPresets(key),existing=presets.find(x=>x.name.toLowerCase()===name.toLowerCase());
  if(existing){if(!confirm(`Replace saved preset “${name}”?`))return;Object.assign(existing,{outfit:clone(outfit),styles:clone(styles),updatedAt:Date.now()});}
  else presets.push({id:uid(),name,outfit:clone(outfit),styles:clone(styles),createdAt:Date.now()});
  persistSettings();refreshPresetModal(existing?.id || presets[presets.length-1]?.id || '');
  toast('success',`Saved preset: ${name}`);
}
function applyPreset(){
  const key=currentPerson(),sel=document.querySelector('#ghwx-presets-modal [data-ghwx-preset]');
  const preset=personPresets(key).find(x=>x.id===sel?.value);
  if(!preset){toast('warning','Choose a preset first.');return;}
  captureScroll();api()?.setOutfit?.(key,clone(preset.outfit));
  const styles=personStyles(key,true);for(const k of Object.keys(styles))delete styles[k];
  Object.assign(styles,clone(preset.styles||{}));persistMeta();syncPrompt();
  const picker=document.querySelector('#ghw-dialog [data-ghw-person]');
  if(picker){picker.value=key;picker.dispatchEvent(new Event('change',{bubbles:true}));}
  closePresetsModal();scheduleDecorate();toast('success',`Applied outfit: ${preset.name}`);
}
function removePreset(){
  const key=currentPerson(),sel=document.querySelector('#ghwx-presets-modal [data-ghwx-preset]');
  const presets=personPresets(key),idx=presets.findIndex(x=>x.id===sel?.value);
  if(idx<0){toast('warning','Select a saved outfit to delete.');return;}
  if(!confirm(`Delete saved preset “${presets[idx].name}”?`))return;
  presets.splice(idx,1);persistSettings();refreshPresetModal();toast('success','Saved outfit preset deleted.');
}
function describeCostume(cat,item,style){const label=CATALOG[cat]?.items?.find(x=>x.id===item)?.label||item;return `${label}${style && style!=='normal'?`, ${optionLabel(cat,item,style).toLowerCase()}`:''}`;}
function relevantOutfitKeys(){const c=context();if(!c)return new Set();const keys=new Set();const user=norm(c.name1||c.user_name||'User').toLowerCase();const alias=aliasInfo();keys.add(alias?.targetKey||`persona:${user}`);const chars=c.characters||[];const keyFor=ch=>ch?.avatar||ch?.data?.avatar?`character:${encodeURIComponent(norm(ch?.avatar||ch?.data?.avatar))}`:`character-name:${norm(ch?.name).toLowerCase()}`;
 if(Number.isInteger(Number(c.characterId))&&chars[Number(c.characterId)])keys.add(keyFor(chars[Number(c.characterId)]));
 if(c.groupId&&Array.isArray(c.groups)){const group=c.groups.find(x=>String(x.id)===String(c.groupId));for(const member of group?.members||[]){const avatar=typeof member==='string'?member:norm(member?.avatar||member?.name);const ch=chars.find(x=>norm(x.avatar)===avatar||norm(x.name).toLowerCase()===norm(member?.name||member).toLowerCase());if(ch)keys.add(keyFor(ch));}}
 for(const msg of (Array.isArray(c.chat)?c.chat.slice(-30):[])){const name=norm(msg?.name||msg?.display_name||msg?.speaker).toLowerCase();const ch=chars.find(x=>norm(x.name).toLowerCase()===name);if(ch)keys.add(keyFor(ch));}return keys;}
function personName(key){const c=context();if(key.startsWith('persona:'))return norm(c?.name1||c?.user_name)||key.slice(8);const chars=c?.characters||[];const ch=chars.find(x=>{const avatar=norm(x?.avatar||x?.data?.avatar);return (avatar&&`character:${encodeURIComponent(avatar)}`===key) || `character-name:${norm(x?.name).toLowerCase()}`===key;});return ch?.name||'';}
function extraPrompt(){const state=api()?.getState?.(),keys=relevantOutfitKeys();if(!state?.outfits)return '';const lines=[];
 const alias=aliasInfo();
 // If the user's persona is also a SillyTavern character not in the current group,
 // the unmodified core would omit their character outfit. Inject it ONCE here instead.
 if(alias){
   const outfit=state.outfits[alias.targetKey],base=api()?.getPromptSummary?.()||'';
   if(outfit?.mode==='set' && !base.split('\n').some(line=>line.startsWith(`${alias.name}: wearing `))){
     const parts=[];
     for(const [cat,items] of Object.entries(outfit.items||{}))for(const row of items||[]){
       const entry=CATALOG[cat]?.items?.find(x=>x.id===row.id);
       if(entry)parts.push(`${CATALOG[cat].label}: ${row.color?row.color+' ':''}${entry.label}`);
     }
     if(parts.length)lines.push(`${alias.name}: wearing ${parts.join('; ')}. This describes the current persona and corresponding character as ONE person, not two.`);
   }
 }
 for(const key of keys){const outfit=state.outfits[key];if(!outfit||outfit.mode!=='set')continue;const styles=personStyles(key,false);const name=personName(key)||'Character';let costume=[];for(const [cat,items]of Object.entries(outfit.items||{})){for(const row of items||[]){const item=CATALOG[cat]?.items?.find(x=>x.id===row.id);if(!item)continue;const style=styles[styleKey(cat,row.id)];if(style&&style!=='normal'&&optionLabel(cat,row.id,style))lines.push(`${name}: ${row.color?row.color+' ':''}${item.label} — ${optionLabel(cat,row.id,style).toLowerCase()}.`);if(cat==='costumes')costume.push(item.label);if(cat==='onepiece'&&/towel/i.test(item.label)){if(style==='waist-wrap')lines.push(`${name}'s ${item.label} is wrapped around the WAIST: it covers the lower body but DOES NOT cover the torso or chest.`);else if(style==='shoulders')lines.push(`${name}'s ${item.label} is draped over shoulders, not secured around the body; do not assume full coverage.`);}}}
 if(costume.length){lines.push(`${name} is wearing selected costume pieces (${costume.join(', ')}). Full-body costumes count as clothing coverage for covered areas; do not assume uncovered torso or legs merely because a separate top/bottom slot is empty. Partial accessories, masks, hats or wings only cover what they physically cover. Do not overwrite other actually worn clothing.`);}}
 if(!lines.length)return '';return ['[Greyhaven Wardrobe — precise garment wearing styles and costume coverage; overrides any generic garment-position assumptions in basic wardrobe state.]','Only the specified item adjustments differ from normal wear. Do not turn these styles into actions the character did not take.',...lines].join('\n');}
function syncPrompt(){migratePersonaAlias();const c=context();if(!c?.setExtensionPrompt)return;try{c.setExtensionPrompt(PROMPT,extraPrompt(),1,1,false,0);}catch(e){console.warn(`[${MODULE}] context injection`,e);}}
function addStyleControls(dialog){const key=currentPerson();if(!key)return;const styles=personStyles(key,false);for(const row of dialog.querySelectorAll('.ghw-selected-row')){const color=row.querySelector('[data-ghw-color]');if(!color)continue;const entry=color.dataset.ghwColor;const i=entry.indexOf('|');if(i<0)continue;const cat=entry.slice(0,i),id=entry.slice(i+1);if(row.querySelector('[data-ghwx-style]'))continue;const choices=optionsFor(cat,id);const sel=document.createElement('select');sel.className='ghwx-style';sel.setAttribute('aria-label','How it is worn');sel.dataset.ghwxStyle=styleKey(cat,id);sel.innerHTML=choices.map(([value,label])=>`<option value="${esc(value)}"${styles[styleKey(cat,id)]===value?' selected':''}>${esc(label)}</option>`).join('');const remove=row.querySelector('[data-ghw-remove]');if(remove)row.insertBefore(sel,remove);else row.appendChild(sel);}}
// The original v1.3 header inserted a wide persistent panel. In v1.4 it becomes a small button.
function addPresetPanel(dialog){
  const bar=dialog.querySelector('.ghw-tools');if(!bar)return;
  // Remove the oversized v1.3 legacy panel if it is still present in a refreshed dialog.
  bar.querySelector('#ghwx-panel')?.remove();
  if(!bar.querySelector('[data-ghwx-choose]')){
    const choose=document.createElement('button');choose.type='button';choose.dataset.ghwxChoose='';
    choose.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Let character choose';
    const detect=bar.querySelector('[data-ghw-detect]');if(detect)detect.after(choose);else bar.prepend(choose);
  }
  if(!bar.querySelector('[data-ghwx-open-presets]')){
    const presets=document.createElement('button');presets.type='button';presets.dataset.ghwxOpenPresets='';
    presets.innerHTML='<i class="fa-solid fa-bookmark"></i> Saved outfits';bar.appendChild(presets);
  }
}
const charKey = ch => {
  const avatar=norm(ch?.avatar || ch?.data?.avatar);
  return avatar?`character:${encodeURIComponent(avatar)}`:`character-name:${norm(ch?.name).toLowerCase()}`;
};
function aliasInfo(){
  const c=context(),name=norm(c?.name1||c?.user_name);
  if(!c||!name)return null;
  const matches=(c.characters||[]).filter(ch=>norm(ch?.name).toLowerCase()===name.toLowerCase());
  if(matches.length!==1)return null; // Never merge two different characters with the same name.
  return {personaKey:`persona:${name.toLowerCase()}`,targetKey:charKey(matches[0]),name};
}
let aliasMerging=false;
function migratePersonaAlias(preferPersona=false){
  const match=aliasInfo(),c=context();if(!match||!c?.chatMetadata||aliasMerging)return false;
  const {personaKey,targetKey}=match;
  if(personaKey===targetKey)return false;
  const raw=c.chatMetadata.greyhavenWardrobe;
  const m=c.chatMetadata[META];const config=c.extensionSettings?.[SETTINGS];
  let changed=false,settingsChanged=false;
  if(raw?.outfits?.[personaKey]){
    const from=raw.outfits[personaKey],to=raw.outfits[targetKey];
    // A saved character outfit wins over an older persona outfit unless detecting just changed the persona.
    const nonUnknown=v=>v&&v.mode&&v.mode!=='unknown';
    const overwrite=nonUnknown(from) && (preferPersona || !nonUnknown(to) || Number(from.updatedAt || 0) > Number(to?.updatedAt || 0));
    raw.outfits[targetKey]=overwrite?clone(from):to||clone(from);
    raw.legacyPersonaOutfits ||= {};
    raw.legacyPersonaOutfits[personaKey]=clone(from); // lossless safety archive
    delete raw.outfits[personaKey];changed=true;
    if(m?.styles?.[personaKey]){
      m.styles[targetKey]=(overwrite||!m.styles[targetKey])?clone(m.styles[personaKey]):m.styles[targetKey];
      delete m.styles[personaKey];
    }
  }
  if(config?.presets?.[personaKey]?.length){
    const target=config.presets[targetKey] ||= [];
    for(const preset of config.presets[personaKey]){
      if(!target.some(row=>row.id===preset.id))target.push(clone(preset));
    }
    delete config.presets[personaKey];settingsChanged=true;
  }
  if(!changed&&!settingsChanged)return false;
  aliasMerging=true;
  try{
    if(changed){
      c.updateChatMetadata?.({greyhavenWardrobe:raw,...(m?{[META]:m}:{})});
      c.saveMetadataDebounced?.();
      if(c.setExtensionPrompt&&api()?.getPromptSummary){
        c.setExtensionPrompt('greyhaven_wardrobe_state',api().getPromptSummary(),1,1,false,0);
      }
    }
    if(settingsChanged)persistSettings();
  }finally{aliasMerging=false;}
  return true;
}
function groupPriority(){
  const c=context(),arr=[];
  if(!c)return arr;
  if(c.groupId&&Array.isArray(c.groups)){
    const group=c.groups.find(g=>String(g.id)===String(c.groupId));
    for(const item of group?.members||[]){
      const candidate=typeof item==='string'?item:norm(item?.avatar||item?.name);
      const ch=(c.characters||[]).find(x=>norm(x.avatar||x.data?.avatar)===candidate||norm(x.name).toLowerCase()===candidate.toLowerCase());
      if(ch)arr.push(charKey(ch));
    }
  }else if(Number.isInteger(Number(c.characterId))&&c.characters?.[Number(c.characterId)])arr.push(charKey(c.characters[Number(c.characterId)]));
  return [...new Set(arr)];
}
function organizePersonOptions(dialog){
  const picker=dialog.querySelector('[data-ghw-person]');if(!picker)return true;
  const alias=aliasInfo();
  if(alias){
    const selected=picker.value;
    [...picker.options].find(o=>o.value===alias.personaKey)?.remove();
    if(selected===alias.personaKey && [...picker.options].some(o=>o.value===alias.targetKey)){
      captureScroll();picker.value=alias.targetKey;
      picker.dispatchEvent(new Event('change',{bubbles:true}));
      return false; // the original extension re-renders; continue on next decorate
    }
  }
  const priority=groupPriority();
  const options=[...picker.options];
  const sorted=options.slice().sort((a,b)=>{
    const pa=priority.indexOf(a.value),pb=priority.indexOf(b.value);
    if(pa!==pb){if(pa<0)return 1;if(pb<0)return -1;return pa-pb;}
    return a.textContent.localeCompare(b.textContent);
  });
  if(sorted.some((o,i)=>o!==options[i]))picker.append(...sorted);
  return true;
}

// Save editor scroll positions BEFORE the original core calls renderDialog() (which replaces innerHTML).
let pendingScroll=null;
function captureScroll(){
  const d=document.querySelector('#ghw-dialog');if(!d)return;
  const read=selector=>{const el=d.querySelector(selector);return el?{top:el.scrollTop,left:el.scrollLeft}:null;};
  pendingScroll={at:Date.now(),browser:read('.ghw-browser'),categories:read('.ghw-categories'),tools:read('.ghw-tools'),dialog:{top:d.scrollTop,left:d.scrollLeft}};
}
function restoreScroll(){
  const s=pendingScroll,d=document.querySelector('#ghw-dialog');
  if(!s||!d)return;
  if(Date.now()-s.at>900){pendingScroll=null;return;}
  for(const [name,selector]of [['browser','.ghw-browser'],['categories','.ghw-categories'],['tools','.ghw-tools']]){
    const el=d.querySelector(selector),v=s[name];if(el&&v){el.scrollTop=v.top;el.scrollLeft=v.left;}
  }
  d.scrollTop=s.dialog.top;d.scrollLeft=s.dialog.left;
  // A second restore handles mobile Safari layout settling after the HTML replacement.
  requestAnimationFrame(()=>{
    const el=d.querySelector('.ghw-browser');if(el&&s.browser){el.scrollTop=s.browser.top;el.scrollLeft=s.browser.left;}
    const cats=d.querySelector('.ghw-categories');if(cats&&s.categories)cats.scrollLeft=s.categories.left;
    pendingScroll=null;
  });
}
const visibleLimits=new Map();
function limitGrid(dialog){
  const grid=dialog.querySelector('.ghw-item-grid'),category=dialog.querySelector('.ghw-category.active')?.dataset.ghwCategory;
  if(!grid||!category)return;
  const items=[...grid.querySelectorAll('[data-ghw-item]')];
  const limit=visibleLimits.get(category)||150;
  for(let i=0;i<items.length;i++){
    const shouldHide=i>=limit;
    if(items[i].hidden!==shouldHide)items[i].hidden=shouldHide;
  }
  let more=grid.querySelector('[data-ghwx-more]');
  if(items.length<=limit){more?.remove();return;}
  if(!more){more=document.createElement('button');more.type='button';more.className='ghwx-more';more.dataset.ghwxMore='';grid.appendChild(more);}
  const label=`Show more (${items.length-limit} remaining)`;
  if(more.textContent!==label)more.textContent=label;
}
let scheduled=false;
function decorate(){
  const d=document.querySelector('#ghw-dialog');if(!d||(!d.open&&!d.hasAttribute('open')))return;
  migratePersonaAlias();
  if(!organizePersonOptions(d))return;
  addStyleControls(d);addPresetPanel(d);limitGrid(d);restoreScroll();
}
function scheduleDecorate(){
  if(scheduled||!document.querySelector('#ghw-dialog'))return;
  scheduled=true;
  // Throttle to one pass per animation frame; never chain observer callbacks through microtasks.
  requestAnimationFrame(()=>{
    scheduled=false;
    if(document.querySelector('#ghw-dialog'))decorate();
  });
}

function onChange(event){const target=event.target;if(!target?.matches?.('[data-ghwx-style]'))return;const key=currentPerson(),raw=target.dataset.ghwxStyle,styles=personStyles(key,true);if(target.value==='normal')delete styles[raw];else styles[raw]=target.value;persistMeta();syncPrompt();}
function onClick(event){
  const button=event.target.closest?.('button');if(!button)return;
  if(button.matches('[data-ghwx-open-presets]'))return openPresetsModal();
  if(button.matches('[data-ghwx-close-presets]'))return closePresetsModal();
  if(button.matches('[data-ghwx-choose]'))return chooseOutfitWithAI();
  if(button.matches('[data-ghwx-choose-close]'))return closeChooseReview();
  if(button.matches('[data-ghwx-choose-apply]'))return applyChosenOutfit();
  if(button.matches('[data-ghwx-save]'))return storePreset();
  if(button.matches('[data-ghwx-apply]'))return applyPreset();
  if(button.matches('[data-ghwx-delete]'))return removePreset();
  if(button.matches('[data-ghwx-more]')){
    const d=document.querySelector('#ghw-dialog'),cat=d?.querySelector('.ghw-category.active')?.dataset.ghwCategory;
    if(cat){visibleLimits.set(cat,(visibleLimits.get(cat)||150)+150);limitGrid(d);}return;
  }
  if(button.matches('[data-ghw-review-apply]')){
    // The original detector may choose a persona by name; merge it into the matching character afterwards.
    queueMicrotask(()=>{migratePersonaAlias(true);syncPrompt();scheduleDecorate();});
  }else if(button.matches('[data-ghw-save],[data-ghw-clear],[data-ghw-unknown]'))queueMicrotask(()=>{migratePersonaAlias();syncPrompt();});
}
function onClickCapture(event){
  const button=event.target.closest?.('button');
  if(!button)return;
  if(button.closest('#ghw-dialog') && button.matches('[data-ghw-item],[data-ghw-remove],[data-ghw-save],[data-ghw-clear],[data-ghw-unknown],[data-ghw-category]'))captureScroll();
  const key=currentPerson();
  if(button.matches('[data-ghw-clear],[data-ghw-unknown]')){
    const styles=personStyles(key,false);
    if(Object.keys(styles).length){for(const k of Object.keys(styles))delete styles[k];persistMeta();setTimeout(syncPrompt,0);}
    return;
  }
  if(button.matches('[data-ghw-review-apply]')){
    const dialog=button.closest('dialog');
    for(const input of dialog?.querySelectorAll('input[type="checkbox"]:checked')||[]){
      const p=dialog?._proposals?.[Number(input.value)];
      if(!p?.person?.key)continue;
      const styles=personStyles(p.person.key,false);
      for(const k of Object.keys(styles))delete styles[k];
    }
    persistMeta();setTimeout(syncPrompt,0);return;
  }
  const styles=personStyles(key,false);
  let changed=false;
  const del=(styleId)=>{if(Object.prototype.hasOwnProperty.call(styles,styleId)){delete styles[styleId];changed=true;}};
  if(button.dataset.ghwRemove){
    const [cat,id]=button.dataset.ghwRemove.split('|');del(styleKey(cat,id));
  }else if(button.dataset.ghwItem){
    const cat=document.querySelector('#ghw-dialog .ghw-category.active')?.dataset.ghwCategory||'';
    const id=button.dataset.ghwItem;
    if(button.classList.contains('selected'))del(styleKey(cat,id));
    else if(cat && !CATALOG[cat]?.multi){
      for(const oldKey of Object.keys(styles))if(oldKey.startsWith(`${cat}|`) && oldKey!==styleKey(cat,id))del(oldKey);
      if(cat==='onepiece')for(const oldKey of Object.keys(styles))if(oldKey.startsWith('top|')||oldKey.startsWith('bottom|'))del(oldKey);
      if(cat==='top'||cat==='bottom')for(const oldKey of Object.keys(styles))if(oldKey.startsWith('onepiece|'))del(oldKey);
    }
  }
  if(changed){persistMeta();setTimeout(syncPrompt,0);}
}

// Explicit, on-demand AI choice, never silently triggered by ordinary RP messages.
let chooserBusy=false;
let proposedChoice=null;
const simplify=v=>String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function chooserContext(){
  const c=context(),key=currentPerson(),name=personName(key);
  const char=(c?.characters||[]).find(x=>charKey(x)===key);
  const life=globalThis.GreyhavenLife;
  let worldTime='';try{worldTime=life?.getTime?.()?.toLocaleString?.('en-GB',{dateStyle:'full',timeStyle:'short'})||'';}catch{}
  const realTime=new Date().toLocaleString('en-GB',{dateStyle:'full',timeStyle:'short'});
  let scene=null,person=null;
  try{scene=life?.getScene?.()||null;person=life?.getPerson?.(name)||null;}catch{}
  const recent=(Array.isArray(c?.chat)?c.chat.slice(-14):[]).map(msg=>{
    const who=simplify(msg?.name||(msg?.is_user?c?.name1:'Character'));
    const words=simplify(msg?.mes||msg?.text||msg?.content).slice(0,330);
    return words?`${who}: ${words}`:'';
  }).filter(Boolean).join('\n').slice(-5200);
  const profile=[char?.description,char?.personality,char?.scenario].filter(Boolean).map(v=>simplify(v).slice(0,1400)).join('\n').slice(0,2400);
  const place=person?.resolved?.location||person?.base?.location||scene?.location||'';
  const activity=person?.resolved?.status||person?.base?.status||'';
  const sceneNotes=simplify(scene?.notes||scene?.description||'').slice(0,400);
  return {key,name,profile,recent,worldTime,realTime,place,activity,sceneNotes};
}
// Every item in the 3,000+ catalog remains selectable manually. For the AI we send a
// compact menu and allow labels outside it, then validate/map the answer locally.
function chooserCatalog(contextText){
  const categoryLimit={bra:7,underwear:8,top:25,bottom:27,onepiece:17,outerwear:14,swim_top:8,swim_bottom:8,sleepwear:13,socks:6,hosiery:6,footwear:16,headwear:8,eyewear:6,earrings:3,necklaces:4,bracelets:3,rings:3,watches:3,belts:4,bags:9,gloves:3,scarves:4,ties:3,hair_accessories:4,piercings:3,other_accessories:6,costumes:14};
  const tokens=new Set((contextText.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(x=>!['that','have','this','with','from','just','about','there','were','what','would','will','been','they'].includes(x)));
  return Object.entries(CATALOG).map(([cat,group])=>{
    const max=categoryLimit[cat]||5;
    const scored=group.items.map((row,i)=>{
      const words=(row.label.toLowerCase().match(/[a-z]{4,}/g)||[]);
      const relevance=words.reduce((sum,w)=>sum+(tokens.has(w)?6:0),0);
      const anchors=/(classic|basic|relaxed|oversized|satin|silk|cotton|straight|casual|plain|towel|hoodie|sneakers|jeans|robe|blazer|uniform|dress|shorts|trousers|slippers|pajama)/i.test(row.label)?2:0;
      // Controlled variation, but never stochastic output that drifts outside this user's catalog.
      return {row,score:relevance+anchors+(i%11===0?1:0),i};
    }).sort((a,b)=>b.score-a.score||a.i-b.i);
    const chosen=scored.slice(0,max).sort((a,b)=>a.i-b.i).map(x=>`${x.row.id}=${x.row.label}`);
    return `${cat}: ${chosen.join(' | ')}`;
  }).join('\n');
}
function parseChoiceText(raw){
  const txt=norm(typeof raw==='string'?raw:raw?.text||raw?.content||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const a=txt.indexOf('{'),b=txt.lastIndexOf('}');
  if(a<0||b<=a)throw new Error('AI did not return a valid outfit JSON object');
  return JSON.parse(txt.slice(a,b+1));
}
function matchingCatalogItem(cat,row){
  const group=CATALOG[cat];if(!group)return null;
  const query=norm(row?.id||row?.label).toLowerCase();if(!query)return null;
  let found=group.items.find(item=>item.id.toLowerCase()===query||item.label.toLowerCase()===query);
  if(!found&&row?.label)found=group.items.find(item=>item.label.toLowerCase()===norm(row.label).toLowerCase());
  if(found)return found;
  const normalized=x=>String(x).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const q=normalized(query);if(!q)return null;
  found=group.items.find(item=>normalized(item.label)===q);if(found)return found;
  const tokens=new Set(q.split(' ').filter(x=>x.length>2));let best=null,bestScore=0;
  for(const item of group.items){
    const words=new Set(normalized(item.label).split(' ').filter(x=>x.length>2));
    const same=[...tokens].filter(x=>words.has(x)).length;
    const score=same/(new Set([...tokens,...words]).size||1);
    if(score>bestScore){bestScore=score;best=item;}
  }
  return bestScore>=.55?best:null;
}
function normalizeProposedChoice(parsed){
  const selected={mode:'set',coverage:'complete',knownAbsent:[],items:{},updatedAt:Date.now()},styles={};
  const choices=Array.isArray(parsed?.items)?parsed.items:[];
  let valid=0;
  for(const proposal of choices.slice(0,36)){
    const cat=norm(proposal?.category),group=CATALOG[cat],item=matchingCatalogItem(cat,proposal);
    if(!group||!item)continue;
    const color=norm(proposal.color).toLowerCase();
    const row={id:item.id,color:(api()?.getColors?.()||[]).includes(color)?color:''};
    if(group.multi){const current=selected.items[cat] ||= [];if(!current.some(x=>x.id===row.id))current.push(row);}
    else selected.items[cat]=[row];
    const style=norm(proposal.style||'normal');
    if(style!=='normal'&&optionsFor(cat,item.id).some(x=>x[0]===style))styles[styleKey(cat,item.id)]=style;
    valid++;
  }
  if(selected.items.onepiece?.length){delete selected.items.top;delete selected.items.bottom;}
  if(!valid||!Object.values(selected.items).some(x=>x.length))throw new Error('No valid catalog garments were chosen');
  return {outfit:selected,styles,reason:simplify(parsed?.reason||parsed?.note).slice(0,340)};
}
async function chooseOutfitWithAI(){
  if(chooserBusy)return;
  const c=context();if(!c?.generateRaw){toast('warning','Connect a text-generation model first.');return;}
  const info=chooserContext();if(!info.key||!info.name){toast('warning','Choose a character first.');return;}
  chooserBusy=true;
  const button=document.querySelector('#ghw-dialog [data-ghwx-choose]');
  if(button){button.disabled=true;button.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Choosing…';}
  try{
    const contextText=[info.name,info.profile,info.recent,info.place,info.activity,info.sceneNotes].join(' ');
    const catalog=chooserCatalog(contextText);
    const systemPrompt='You choose realistic everyday clothing for ONE fictional adult roleplay character. You act as that character when deciding what they would independently wear right now based on personality, current/planned activity, weather or setting, time of day and season. The recent chat may contain no clothing mention: choose clothing anyway. Do not invent known facts. Choose practical context-fitting clothing, not automatically flirtatious or sexual. Return one JSON object only, no commentary or markdown.';
    const prompt=`TARGET CHARACTER: ${info.name}\nCHARACTER DESCRIPTION:\n${info.profile||'(not available)'}\nGREYHAVEN FICTIONAL TIME: ${info.worldTime||'(unavailable)'}\nTIME FALLBACK (use ONLY if fictional time unavailable): ${info.worldTime?'(ignore; use fictional clock)':info.realTime}\nCURRENT PLACE: ${info.place||'not specified'}\nCURRENT ACTIVITY: ${info.activity||'not specified'}\nSCENE: ${info.sceneNotes||'not specified'}\nRECENT RP (context, not a list of required garments):\n${info.recent||'(none)'}\n\nCATALOG CATEGORIES AND SAMPLE EXACT ID=LABEL CHOICES:\n${catalog}\n\nPick 3 to 11 compatible clothing pieces (fewer if appropriate; e.g. sleepwear or swimwear). Colors should suit the character. You may name another real wardrobe item not in these samples; it will be mapped locally only when a confident catalog match exists. Optional wearing style must be from these known codes when useful: normal, tucked, half-tuck, untucked, sleeves-up, high-waist, hips-low, hood-up, hood-down, open, half-zipped. No need to add a style if worn normally. Do not force all 28 categories into the outfit. Honor practical layering and avoid contradictory top/bottom/onepiece garments. Return only valid JSON: {"reason":"brief independent choice rationale","items":[{"category":"top","id":"EXACT_CATALOG_ID","color":"gray","style":"normal"}]}.`;
    const raw=await c.generateRaw({prompt,systemPrompt,responseLength:1400,trimNames:false});
    const choice=normalizeProposedChoice(parseChoiceText(raw));
    proposedChoice={...choice,key:info.key,name:info.name};
    showChooseReview(proposedChoice);
  }catch(error){console.warn(`[${MODULE}] outfit auto choice failed`,error);toast('error',`Could not choose outfit: ${String(error.message||error).slice(0,150)}. Nothing changed.`);}
  finally{chooserBusy=false;const d=document.querySelector('#ghw-dialog');const b=d?.querySelector('[data-ghwx-choose]');if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Let character choose';}}
}
function showChooseReview(p){
  closeChooseReview();
  const dialog=document.createElement('dialog');dialog.id='ghwx-choose-review';
  const lines=Object.entries(p.outfit.items).flatMap(([cat,items])=>items.map(row=>{
    const item=CATALOG[cat]?.items.find(x=>x.id===row.id);return `<li><strong>${esc(item?.label||row.id)}</strong>${row.color?' — '+esc(row.color):''}${p.styles[styleKey(cat,row.id)]?' · '+esc(optionLabel(cat,row.id,p.styles[styleKey(cat,row.id)])):''}</li>`;
  }));
  dialog.innerHTML=`<div class="ghwx-popup"><header><strong><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(p.name)} chose an outfit</strong><button data-ghwx-choose-close type="button" aria-label="Close">×</button></header><div class="ghwx-popup-content"><p>${esc(p.reason||'Chosen for the character’s current situation.')}</p><ul class="ghwx-outfit-review">${lines.join('')}</ul><p class="ghwx-subtle">This is a preview. Nothing changes until you apply it.</p><div class="ghwx-popup-actions"><button type="button" data-ghwx-choose-close>Cancel</button><button type="button" data-ghwx-choose-apply>Wear this outfit</button></div></div></div>`;
  document.body.appendChild(dialog);try{dialog.showModal();}catch{dialog.setAttribute('open','');}
}
function closeChooseReview(){const d=document.querySelector('#ghwx-choose-review');if(d){try{d.close();}catch{}d.remove();}}
function applyChosenOutfit(){
  const p=proposedChoice;if(!p)return;
  const current=currentPerson();if(current!==p.key){toast('warning','Selected character changed. Please try again.');closeChooseReview();proposedChoice=null;return;}
  captureScroll();api()?.setOutfit?.(p.key,clone(p.outfit));
  const styles=personStyles(p.key,true);for(const k of Object.keys(styles))delete styles[k];Object.assign(styles,p.styles);persistMeta();syncPrompt();
  const picker=document.querySelector('#ghw-dialog [data-ghw-person]');if(picker){picker.value=p.key;picker.dispatchEvent(new Event('change',{bubbles:true}));}
  closeChooseReview();proposedChoice=null;scheduleDecorate();toast('success',`${p.name} selected their outfit.`);
}

function bind(){
  document.addEventListener('change',onChange);
  document.addEventListener('change',ev=>{
    const t=ev.target;
    if(t?.matches?.('#ghw-dialog [data-ghw-color],#ghw-dialog [data-ghw-person]')){
      // A core redraw may be triggered by these, and must not reset the browser scroll.
      scheduleDecorate();
    }
  });
  document.addEventListener('change',ev=>{
    if(ev.target?.matches?.('#ghw-dialog [data-ghw-color],#ghw-dialog [data-ghw-person]'))captureScroll();
  },true);
  document.addEventListener('click',onClickCapture,true);
  document.addEventListener('click',onClick);
  // Important: DO NOT observe document.body with subtree:true.
  // That watches our own DOM insertions and every other SillyTavern extension, and
  // can trigger a runaway observer/render loop that freezes the whole page.
  // Instead, observe only a dialog being added/removed and its direct shell replacement.
  let dialogObserved=null;
  let dialogObserver=null;
  const observeDialog=()=>{
    const next=document.querySelector('#ghw-dialog');
    if(next===dialogObserved)return;
    dialogObserver?.disconnect();
    dialogObserver=null;
    dialogObserved=next;
    if(!next)return;
    dialogObserver=new MutationObserver(records=>{
      // The core rebuilds the editor with dialog.innerHTML = ... .
      // Style selects/buttons inserted *inside* the shell do not match this.
      if(records.some(record=>record.target===next && record.type==='childList'))scheduleDecorate();
    });
    dialogObserver.observe(next,{childList:true});
    scheduleDecorate();
  };
  const bodyObserver=new MutationObserver(records=>{
    // Only direct children of <body>; ignore every mutation inside Wardrobe,
    // chat messages, other app views, or third-party extensions.
    if(records.some(record=>[...record.addedNodes,...record.removedNodes]
      .some(node=>node.nodeType===1 && (node.id==='ghw-dialog'||node.querySelector?.('#ghw-dialog'))))){
      observeDialog();
    }
  });
  bodyObserver.observe(document.body,{childList:true});
  observeDialog();
  // Search replaces only the inner grid, not the whole dialog.
  // Refresh the page-length limiter after the core search handler runs.
  document.addEventListener('input',event=>{
    if(event.target?.matches?.('#ghw-dialog [data-ghw-search]'))scheduleDecorate();
  });
  const c=context();if(c?.eventSource&&c?.eventTypes){
    for(const key of ['GENERATION_STARTED','CHAT_CHANGED','CHAT_CREATED','PERSONA_CHANGED','GROUP_UPDATED','MESSAGE_UPDATED']){
      const event=c.eventTypes[key];if(event)c.eventSource.on(event,()=>{syncPrompt();scheduleDecorate();});
    }
  }
}
async function main(){for(let i=0;i<250;i++){if(api()?.getCatalog&&document.body&&context()?.chatMetadata)break;await new Promise(r=>setTimeout(r,40));}bind();syncPrompt();decorate();globalThis.GreyhavenWardrobeExpansion={version:VERSION,counts:clone(EXPANDED_COUNTS),total:EXPANDED_TOTAL,getPresets:key=>clone(personPresets(key)),getStylePrompt:extraPrompt};console.info(`[${MODULE}] v${VERSION}: ${EXPANDED_TOTAL} clothing options in ${Object.keys(CATALOG).length} categories; presets & wearing styles ready.`);}
main().catch(e=>console.error(`[${MODULE}] failed`,e));
