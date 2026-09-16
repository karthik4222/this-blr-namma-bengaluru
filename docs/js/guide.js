/* Guide data, rendering, forms */
/* Guide lists live in data/*.json and are fetched on load. */
let CATEGORIES = [];
let DAYTRIP_COLOR = 'var(--leaf-light)';
let LOCATIONS = [];
let KARNATAKA_PLACES = [];
let NOT_THAT = [];
let FESTIVALS = [];
let DISH_TAGS = [];
let DISHES = [];
let PHRASES = [];
let QUIPS = [];

const PICK_MARK = `<svg class="pick-mark" viewBox="0 0 40 26" role="img" aria-label="Personal pick"><title>Personal pick</title><ellipse cx="10.4" cy="7.2" rx="4.4" ry="4"/><ellipse cx="29.6" cy="7.2" rx="4.4" ry="4"/><path d="M6.6 6.2 L2.4 4.6 L7 9.2Z"/><path d="M33.4 6.2 L37.6 4.6 L33 9.2Z"/><path d="M20 10 C13 12 8.2 16.5 7 23 C13.5 20.2 17 22 20 26 C23 22 26.5 20.2 33 23 C31.8 16.5 27 12 20 10Z"/></svg>`;

const DATA_FILES = {
  categories: 'data/categories.json',
  locations: 'data/locations.json',
  karnatakaPlaces: 'data/karnataka-places.json',
  notThat: 'data/not-that.json',
  festivals: 'data/festivals.json',
  dishes: 'data/dishes.json',
  phrases: 'data/phrases.json',
  quips: 'data/did-you-know.json',
};

async function fetchJson(path){
  const res = await fetch(path, { cache: 'no-cache' });
  if(!res.ok) throw new Error(path + ' ' + res.status);
  return res.json();
}

async function loadGuideData(){
  const [categories, locations, karnatakaPlaces, notThat, festivals, dishes, phrases, quips] = await Promise.all([
    fetchJson(DATA_FILES.categories),
    fetchJson(DATA_FILES.locations),
    fetchJson(DATA_FILES.karnatakaPlaces),
    fetchJson(DATA_FILES.notThat),
    fetchJson(DATA_FILES.festivals),
    fetchJson(DATA_FILES.dishes),
    fetchJson(DATA_FILES.phrases),
    fetchJson(DATA_FILES.quips),
  ]);
  CATEGORIES = categories.categories;
  DAYTRIP_COLOR = categories.daytripColor || DAYTRIP_COLOR;
  LOCATIONS = locations;
  KARNATAKA_PLACES = karnatakaPlaces;
  NOT_THAT = notThat;
  FESTIVALS = festivals;
  DISH_TAGS = dishes.tags || [];
  DISHES = dishes.dishes || dishes;
  PHRASES = phrases;
  QUIPS = quips;
}

function hideLoader(ok){
  const el = document.getElementById('guide-loader');
  document.body.classList.remove('is-loading');
  if(!el) return;
  if(!ok){
    el.classList.add('is-error');
    el.setAttribute('aria-busy', 'false');
    return;
  }
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('aria-busy', 'false');
  document.querySelectorAll('[data-reveal]').forEach((node, i) => {
    window.setTimeout(() => node.classList.add('is-in'), 50 * i);
  });
}

/* ---------------- state ---------------- */
let currentView = 'list';
let activeCategory = 'all';
let activeDishTag = 'all';
let agenda = [];
let customLocations = [];

function allLocations(){ return LOCATIONS.concat(customLocations); }
function catMeta(id){
  if(id === 'daytrip') return { id:'daytrip', label:'Day trip', color:DAYTRIP_COLOR };
  if(id === 'picks') return { id:'picks', label:'Personal picks', color:'var(--maroon)' };
  return CATEGORIES.find(c=>c.id===id) || CATEGORIES[0];
}
function exploreItems(){
  return allLocations().filter(l => {
    if(activeCategory === 'all') return true;
    if(activeCategory === 'picks') return !!(l.personalPick || l.approved);
    return l.category === activeCategory;
  });
}

/* ---------------- persistence ---------------- */
function loadState(){
  try{
    const a = localStorage.getItem('blr-agenda-ids');
    if(a) agenda = JSON.parse(a);
  }catch(e){ agenda = []; }
  try{
    const c = localStorage.getItem('blr-custom-locations');
    if(c) customLocations = JSON.parse(c);
  }catch(e){ customLocations = []; }
}
function saveAgenda(){
  try{ localStorage.setItem('blr-agenda-ids', JSON.stringify(agenda)); }catch(e){}
}
function saveCustom(){
  try{ localStorage.setItem('blr-custom-locations', JSON.stringify(customLocations)); }catch(e){}
}

/* ---------------- render: category pills ---------------- */
function renderPills(){
  const row = document.getElementById('categoryPills');
  const all = [{id:'all', label:'All'}, {id:'picks', label:'Personal picks'}].concat(CATEGORIES);
  row.innerHTML = all.map(c =>
    `<button class="pill" data-active="${activeCategory===c.id}" onclick="setCategory('${c.id}')">${c.label}</button>`
  ).join('');
}
function setCategory(id){ activeCategory = id; renderPills(); renderList(); renderMap(); }

/* ---------------- render: list view ---------------- */
function buildLocationCard(l){
  const cat = catMeta(l.category);
  const added = agenda.includes(l.id);
  const photosHtml = (l.photos && l.photos.length)
    ? `<div class="camera-roll">${l.photos.map(src => `<img src="${src}" loading="lazy" alt="${l.name}" tabindex="0" role="button" aria-label="View larger photo of ${l.name}" onclick="openLightbox('${src}', '${l.name}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openLightbox('${src}', '${l.name}')}">`).join('')}</div>`
    : `<div class="camera-roll-empty">No photos yet - <a href="https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(l.name + ' ' + l.area)}&title=Special:MediaSearch&type=image" target="_blank" rel="noopener">search Wikimedia Commons for ${l.name}</a> (openly licensed, free to use) and drop the image URL into this spot's "photos" array.</div>`;
  const pickHtml = (l.personalPick || l.approved) ? PICK_MARK : '';
  const tryHtml = (l.try && l.try.length)
    ? `<div class="try-block"><div class="try-label">Try</div><ul class="try-list">${l.try.map(t => `<li>${t}</li>`).join('')}</ul></div>`
    : '';
  const skipHtml = skipCrowdHtml(l);
  const pronounceHtml = l.kn ? `<div class="card-pronounce"><span class="kn card-kn">${l.kn}</span><span class="card-say">${l.say}</span>${speakBtn(l.kn, 'sm')}</div>` : '';
  const onCityMap = LOCATIONS.some(x => x.id === l.id) || customLocations.some(x => x.id === l.id);
  const mapLinkHtml = onCityMap && (typeof l.lat === 'number' && typeof l.lng === 'number')
    ? `<button class="map-link-btn" onclick="viewOnMap('${l.id}')">📍 View on map</button>` : '';
  return `<div class="card" id="card-${l.id}" style="--cat-color:${cat.color}">
      <div class="card-top">
        <div>
          <div class="card-title-row">${pickHtml}<h3>${l.name}</h3></div>
          <div class="area">${l.area}</div>${pronounceHtml}
        </div>
        <span class="tag">${cat.label}</span>
      </div>
      <p class="blurb">${l.blurb}</p>
      ${tryHtml}
      ${photosHtml}
      ${skipHtml}
      <div class="card-actions">
        <button class="add-btn" data-added="${added}" onclick="toggleAgenda('${l.id}')">${added ? 'Added ✓' : '+ Add to agenda'}</button>
        ${mapLinkHtml}
      </div>
    </div>`;
}
function skipCrowdHtml(l){
  const s = l.skipCrowd;
  if(!s) return '';
  const instead = s.insteadId ? allLocations().find(x => x.id === s.insteadId) : null;
  const name = instead ? instead.name : '';
  const go = instead ? `<button class="map-link-btn" type="button" onclick="focusPlace('${instead.id}')">Open ${instead.name}</button>` : '';
  return `<details class="skip-details">
    <summary>Skip the crowd</summary>
    <p class="why" style="margin-top:8px;color:var(--ink-soft)">${s.why}</p>
    <div class="skip-instead">
      ${name ? `<div class="place">${name}</div>` : ''}
      <div class="why">${s.insteadNote || ''}</div>
      ${go}
    </div>
  </details>`;
}
function focusPlace(id){
  setCategory('all');
  requestAnimationFrame(() => {
    const el = document.getElementById('card-' + id);
    if(el){
      el.scrollIntoView({behavior:'smooth', block:'center'});
      el.style.outline = '2px solid var(--leaf)';
      window.setTimeout(() => { el.style.outline = ''; }, 1600);
    } else {
      viewOnMap(id);
    }
  });
}
function renderList(){
  const wrap = document.getElementById('listView');
  const items = exploreItems();
  wrap.innerHTML = items.map(buildLocationCard).join('') || `<p style="color:var(--ink-soft);">No spots in this filter yet.</p>`;
}
function renderDaytrips(){
  const wrap = document.getElementById('daytripGrid');
  if(!wrap) return;
  wrap.innerHTML = KARNATAKA_PLACES.map(buildLocationCard).join('');
}

/* ---------------- render: map view ---------------- */
/* ---------------- map view (Leaflet + OpenStreetMap, no API key) ---------------- */
let leafletMap = null;
let leafletMarkers = [];
const BLR_CENTER = [12.9716, 77.5946];
function renderMap(){
  if(currentView !== 'map') return;
  if(typeof L === 'undefined'){
    document.getElementById('mapWrap').innerHTML = '<p style="padding:24px;color:var(--ink-soft);font-size:13.5px;">Map couldn\'t load - this needs an internet connection to fetch map tiles from OpenStreetMap. Try the list view instead.</p>';
    return;
  }
  const items = exploreItems().filter(l => typeof l.lat === 'number' && typeof l.lng === 'number');
  if(!leafletMap){
    leafletMap = L.map('mapWrap', {
      scrollWheelZoom: true,
      maxBounds: [[12.72, 77.35], [13.20, 77.85]],
      maxBoundsViscosity: 0.7,
    }).setView(BLR_CENTER, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(leafletMap);
  }
  leafletMarkers.forEach(m => leafletMap.removeLayer(m));
  leafletMarkers = [];
  const bounds = [];
  const cityBounds = [];
  items.forEach(l=>{
    const cat = catMeta(l.category);
    const icon = L.divIcon({
      className: 'map-pin-wrap',
      html: `<span class="map-pin-icon" style="background:${cat.color}"></span>`,
      iconSize:[18,18], iconAnchor:[9,16], popupAnchor:[0,-12],
    });
    const marker = L.marker([l.lat, l.lng], { icon, title: l.name }).addTo(leafletMap);
    marker.bindPopup(`<div class="map-popup-title">${l.name}</div><div class="map-popup-area">${l.area}</div>${l.blurb}`);
    marker.locId = l.id;
    leafletMarkers.push(marker);
    bounds.push([l.lat, l.lng]);
    const dlat = l.lat - BLR_CENTER[0];
    const dlng = (l.lng - BLR_CENTER[1]) * Math.cos(BLR_CENTER[0] * Math.PI/180);
    if((dlat*dlat + dlng*dlng) < 0.12*0.12) cityBounds.push([l.lat, l.lng]);
  });
  const fit = cityBounds.length ? cityBounds : bounds;
  if(fit.length){
    leafletMap.fitBounds(fit, { padding:[36,36], maxZoom:13 });
  } else {
    leafletMap.setView(BLR_CENTER, 12);
  }
  setTimeout(()=>{ if(leafletMap) leafletMap.invalidateSize(); }, 80);
}

/* ---------------- view toggle ---------------- */
function setView(v){
  currentView = v;
  document.getElementById('listView').style.display = v==='list' ? 'grid' : 'none';
  document.getElementById('mapView').style.display = v==='map' ? 'block' : 'none';
  document.querySelectorAll('.view-toggle button').forEach(b=>{
    b.dataset.active = (b.dataset.view === v);
  });
  if(v==='map') renderMap();
}
function viewOnMap(id){
  setView('map');
  document.getElementById('mapWrap').scrollIntoView({behavior:'smooth', block:'center'});
  setTimeout(()=>{
    const marker = leafletMarkers.find(m => m.locId === id);
    if(marker && leafletMap){
      leafletMap.setView(marker.getLatLng(), 15);
      marker.openPopup();
    }
  }, 200);
}

/* ---------------- agenda ---------------- */
function toggleAgenda(id){
  if(agenda.includes(id)) agenda = agenda.filter(x=>x!==id);
  else agenda.push(id);
  saveAgenda();
  renderList();
  renderDaytrips();
  renderAgendaCount();
  renderDrawer();
}
function renderAgendaCount(){
  document.getElementById('agendaCount').textContent = agenda.length;
}
function renderDrawer(){
  const body = document.getElementById('drawerBody');
  if(agenda.length===0){
    body.innerHTML = `<p class="drawer-empty">Nothing added yet. Tap "+ Add to agenda" on any card in Explore.</p>`;
    return;
  }
  body.innerHTML = agenda.map(id=>{
    const l = allLocations().find(x=>x.id===id);
    if(!l) return '';
    return `<div class="drawer-item">
      <div><div style="font-weight:600;font-size:14px;">${l.name}</div><div class="meta">${l.area}</div></div>
      <button onclick="toggleAgenda('${id}')">Remove</button>
    </div>`;
  }).join('');
}
function openDrawer(){
  document.getElementById('drawer').dataset.open = 'true';
  document.getElementById('drawerBackdrop').dataset.open = 'true';
  renderDrawer();
}
function closeDrawer(){
  document.getElementById('drawer').dataset.open = 'false';
  document.getElementById('drawerBackdrop').dataset.open = 'false';
}
function openLightbox(src, alt){
  const box = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  img.src = src;
  img.alt = alt || '';
  box.dataset.open = 'true';
}
function closeLightbox(){
  const box = document.getElementById('lightbox');
  box.dataset.open = 'false';
  const img = document.getElementById('lightboxImg');
  img.src = '';
}
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') closeLightbox();
});
async function copyAgenda(){
  const items = agenda.map(id => allLocations().find(x=>x.id===id)).filter(Boolean);
  const text = 'My Bengaluru agenda\\n\\n' + items.map(l=>`- ${l.name} (${l.area})`).join('\\n');
  try{
    await navigator.clipboard.writeText(text);
    const btn = document.querySelector('.copy-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(()=>{ btn.textContent = original; }, 1500);
  }catch(e){
    alert(text);
  }
}

/* ---------------- this, not that ---------------- */
function renderTNT(){
  const wrap = document.getElementById('tntList');
  wrap.innerHTML = NOT_THAT.map(row => `
    <div class="tnt-row">
      <div class="often">${row.often}</div>
      <div class="tnt-arrow">→</div>
      <div class="also">${row.also}</div>
    </div>
  `).join('');
}

/* ---------------- festivals ---------------- */
function renderFestivals(){
  const wrap = document.getElementById('festivalGrid');
  wrap.innerHTML = FESTIVALS.map(f => `
    <div class="festival-card" style="--fest-color:${f.color}">
      <div class="festival-top">
        <h3>${f.name}</h3>
        <span class="festival-when">${f.when}</span>
      </div>
      <div class="festival-where">${f.where} · <span class="kn" style="color:inherit;font-size:12px;">${f.kn}</span></div>
      <p>${f.blurb}</p>
    </div>
  `).join('');
}

/* ---------------- did you know ---------------- */
function renderQuips(){
  const wrap = document.getElementById('quipGrid');
  if(!wrap) return;
  wrap.innerHTML = QUIPS.map(q => `
    <article class="quip-card${q.featured ? ' featured' : ''}">
      <div>
        <div class="quip-kicker">Did you know</div>
        <h3>${q.q}</h3>
        ${q.kn ? `<span class="kn quip-kn kn-cycle" tabindex="0"><span class="kn-native">${q.kn}</span><span class="kn-en">${q.q}</span></span>` : ''}
      </div>
      <p>${q.a}</p>
    </article>
  `).join('');
}

/* ---------------- dishes ---------------- */
function renderDishPills(){
  const row = document.getElementById('dishPills');
  if(!row) return;
  const all = [{id:'all', label:'All'}].concat(DISH_TAGS);
  row.innerHTML = all.map(t =>
    `<button class="pill" data-active="${activeDishTag===t.id}" onclick="setDishTag('${t.id}')">${t.label}</button>`
  ).join('');
}
function setDishTag(id){ activeDishTag = id; renderDishPills(); renderDishes(); }
function renderDishes(){
  const wrap = document.getElementById('dishGrid');
  const items = DISHES.filter(d => {
    if(activeDishTag === 'all') return true;
    if(activeDishTag === 'picks') return !!d.personalPick;
    return (d.tags || []).includes(activeDishTag);
  });
  wrap.innerHTML = items.map(d => {
    const photoHtml = d.photo ? `<img class="dish-photo" src="${d.photo}" loading="lazy" alt="${d.name}" tabindex="0" role="button" aria-label="View larger photo of ${d.name}" onclick="openLightbox('${d.photo}', '${d.name}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openLightbox('${d.photo}', '${d.name}')}">` : '';
    const tagsHtml = (d.tags || []).map(id => {
      const t = DISH_TAGS.find(x => x.id === id);
      return t ? `<span class="tag">${t.label}</span>` : '';
    }).join('');
    const pickMark = d.personalPick ? PICK_MARK : '';
    return `
    <div class="dish-card">
      ${photoHtml}
      <div class="dish-name-row">${pickMark}<div class="dish-name">${d.name}</div></div>
      <div class="dish-kn-row"><span class="kn dish-kn">${d.kn}</span><span class="dish-say">${d.say}</span>${speakBtn(d.kn, 'sm')}</div>
      <p class="dish-desc">${d.desc}</p>
      <div class="card-actions" style="margin-top:10px;flex-wrap:wrap">${tagsHtml}</div>
    </div>
  `;
  }).join('') || `<p style="color:var(--ink-soft);">No dishes in this tag yet.</p>`;
}

/* ---------------- learn kannada ---------------- */
function renderPhrases(){
  const wrap = document.getElementById('phraseGrid');
  const GROUP_ORDER = ['Greetings & courtesy', 'Getting to know someone', 'Everyday essentials', 'Food & warmth', 'Ordering food & coffee', 'Respect & address'];
  const cardHtml = (p) => {
    const variantHtml = p.variant ? `<div class="p-variant"><span class="p-variant-label">${p.variant.region}</span> "${p.variant.kn}" - ${p.variant.translit}${p.variant.say ? ` (say: ${p.variant.say})` : ''} ${speakBtn(p.variant.kn, 'sm')}</div>` : '';
    const examplesHtml = p.examples ? `<div class="p-examples">${p.examples.map(ex => `
        <div class="p-example"><span class="p-ex-kn">${ex.kn}</span><span class="p-ex-translit">${ex.translit}</span> - ${ex.meaning} ${speakBtn(ex.kn, 'sm')}</div>
      `).join('')}</div>` : '';
    const sayHtml = p.say ? `<div class="p-say">say: ${p.say}</div>` : '';
    return `<div class="phrase-card">
      <div class="p-kn-row"><div class="p-kn">${p.kn}</div>${speakBtn(p.kn)}</div>
      <div class="p-translit">${p.translit}</div>
      ${sayHtml}
      <div class="p-meaning">${p.meaning}</div>
      <div class="p-tip">${p.tip}</div>
      ${examplesHtml}
      ${variantHtml}
    </div>`;
  };
  wrap.innerHTML = GROUP_ORDER.map(group => {
    const items = PHRASES.filter(p => p.group === group);
    if(!items.length) return '';
    return `<div class="phrase-group">
      <h3 class="phrase-group-title">${group}</h3>
      <div class="phrase-group-grid">${items.map(cardHtml).join('')}</div>
    </div>`;
  }).join('');
}
const SPEECH_OK = (typeof window !== 'undefined' && 'speechSynthesis' in window);
/* Either voice needs one of these; kannada-voice.js only needs Web Audio. */
const VOICE_OK = SPEECH_OK || (typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window));
function speakText(text){
  if(!text) return;
  /* A pre-rendered Kannada clip takes it when there is one (see kannada-voice.js). */
  if(window.NammaVoice && window.NammaVoice.speak(text)) return;
  speakWithBrowserVoice(text);
}
/* Whatever Kannada voice the device happens to ship with - usually none. */
function speakWithBrowserVoice(text){
  if(!SPEECH_OK || !text) return;
  try{
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'kn-IN';
    utter.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const knVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('kn'));
    if(knVoice) utter.voice = knVoice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }catch(e){ /* speech not available - silently ignore */ }
}
function speakBtn(text, size){
  if(!VOICE_OK || !text) return '';
  const safe = text.replace(/'/g, "\\'");
  const cls = size==='sm' ? 'speak-btn speak-btn-sm' : 'speak-btn';
  const main = `<button class="${cls}" onclick="speakText('${safe}')" aria-label="Hear pronunciation">\uD83D\uDD0A</button>`;
  if(size === 'sm') return main;
  /* Phrase cards also offer the other voice for that one phrase, without changing
     the choice above the grid. Hidden by CSS until kannada-voice.js confirms there
     is more than one voice to switch to. */
  return main + `<button class="speak-btn speak-alt" onclick="speakOther('${safe}')" aria-label="Hear this in the other voice" title="Hear this in the other voice">\u21C4</button>`;
}
function speakOther(text){
  if(window.NammaVoice && window.NammaVoice.speakOther(text)) return;
  speakWithBrowserVoice(text);
}
function speakPhrase(i){ speakText(PHRASES[i].kn); }

/* ---------------- history: growing map ---------------- */
function setEra(i){
  document.querySelectorAll('.timeline-item').forEach(el=>{
    const on = parseInt(el.dataset.era, 10) === i;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/* ---------------- write-in tabs ---------------- */
function setWriteIn(which){
  const spot = which === 'spot';
  const tabSpot = document.getElementById('tab-spot');
  const tabAsk = document.getElementById('tab-ask');
  const panelSpot = document.getElementById('panel-spot');
  const panelAsk = document.getElementById('panel-ask');
  if(!tabSpot || !tabAsk) return;
  tabSpot.setAttribute('aria-selected', spot ? 'true' : 'false');
  tabAsk.setAttribute('aria-selected', spot ? 'false' : 'true');
  if(panelSpot) panelSpot.hidden = !spot;
  if(panelAsk) panelAsk.hidden = spot;
}

/* ---------------- add-your-own form ---------------- */
const GUIDE_REPO = 'https://github.com/aravindbaskaran/this-blr-namma-bengaluru';
function openGuideIssue(title, body){
  window.open(`${GUIDE_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
}
function renderCategorySelect(){
  const sel = document.getElementById('f-category');
  sel.innerHTML = CATEGORIES.map(c=>`<option value="${c.id}">${c.label}</option>`).join('');
}
document.getElementById('addForm').addEventListener('submit', function(e){
  e.preventDefault();
  const name = document.getElementById('f-name').value.trim();
  const area = document.getElementById('f-area').value.trim();
  const category = document.getElementById('f-category').value;
  const catLabel = (CATEGORIES.find(c => c.id === category) || {}).label || category;
  const blurb = document.getElementById('f-blurb').value.trim();
  if(!name || !area || !blurb) return;
  const title = `Spot: ${name} (${area})`;
  const body = [`**Name:** ${name}`, `**Area:** ${area}`, `**Kind:** ${catLabel}`, '', blurb].join('\n');
  openGuideIssue(title, body);
  this.reset();
});

document.getElementById('issueForm').addEventListener('submit', function(e){
  e.preventDefault();
  const title = document.getElementById('i-title').value.trim();
  const body = document.getElementById('i-body').value.trim();
  if(!title || !body) return;
  openGuideIssue(title, body);
  this.reset();
});

/* ---------------- init ---------------- */
(async function init(){
  const started = performance.now();
  try {
    await loadGuideData();
    const remain = Math.max(0, 700 - (performance.now() - started));
    if(remain) await new Promise(r => setTimeout(r, remain));
    loadState();
    renderPills();
    renderDishPills();
    renderCategorySelect();
    renderList();
    renderDaytrips();
    renderTNT();
    renderFestivals();
    renderQuips();
    renderDishes();
    renderPhrases();
    renderAgendaCount();
    setEra(6);
    hideLoader(true);
  } catch (err) {
    console.error(err);
    hideLoader(false);
  }
})();
