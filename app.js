(function(){
  const OFFERS_KEY = 'goggicantiere_offers_v1';
  const DRAFT_KEY = 'goggicantiere_current_offer_v1';
  const THEME_KEY = 'goggicantiere_theme_v1';
  let offers = [];
  let current = null;
  let articles = [];
  let deferredInstall = null;
  let articleListOpen = false;
  let selectedCategory = null;
  const $ = (id) => document.getElementById(id);
  const money = (n) => (Number(n)||0).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
  const num = (v) => { let s=String(v??'').trim().replace(/€/g,'').replace(/\s/g,''); if(s.includes('.')&&s.includes(',')) s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(',','.'); const n=Number(s); return Number.isFinite(n)?n:0; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id_'+Date.now()+'_'+Math.random().toString(16).slice(2));
  const today = () => new Date().toISOString().slice(0,10);
  async function getJSON(key, fallback){ try{ const raw = await GStorage.get(key); return raw ? JSON.parse(raw) : fallback; }catch{ return fallback; } }
  async function setJSON(key, value){ await GStorage.set(key, JSON.stringify(value)); }
  async function loadOffers(){ offers = await getJSON(OFFERS_KEY, []); if(!Array.isArray(offers)) offers=[]; }
  async function saveOffers(){ await setJSON(OFFERS_KEY, offers); renderOfferList(); }
  async function persistDraft(){ if(current) await setJSON(DRAFT_KEY, current); }
  function emptyOffer(){ return { id:uid(), date:today(), customer:'', note:'', vat:22, priceListId:GPriceLists.getActiveListIdSync(), items:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }; }
  async function init(){
    initTheme();
    await GPriceLists.init();
    await loadOffers();
    await refreshPriceLists();
    renderOfferList();
    bind();
    if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
    window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredInstall=e; $('installBtn').classList.remove('hidden'); });
    setTimeout(()=>{ const sp=$('splashScreen'); if(sp) sp.classList.add('hide'); }, 2200);
  }

  function initTheme(){
    setTheme(localStorage.getItem(THEME_KEY) || 'light', false);
  }
  function setTheme(theme, save=true){
    const useSite = theme === 'site';
    document.body.classList.toggle('theme-site', useSite);
    const lightBtn = $('themeLightBtn');
    const siteBtn = $('themeSiteBtn');
    if(lightBtn && siteBtn){
      lightBtn.classList.toggle('active', !useSite);
      siteBtn.classList.toggle('active', useSite);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', useSite ? '#111111' : '#111827');
    if(save) localStorage.setItem(THEME_KEY, useSite ? 'site' : 'light');
  }

  function bind(){
    $('newOfferBtn').onclick = () => openOffer(emptyOffer());
    $('themeLightBtn').onclick = () => setTheme('light');
    $('themeSiteBtn').onclick = () => setTheme('site');
    $('backBtn').onclick = () => { saveCurrent(); show('homeView'); };
    $('saveBtn').onclick = () => saveCurrent(true);
    $('printBtn').onclick = () => { saveCurrent(); openPrint(); };
    $('closePrintBtn').onclick = () => show('editView');
    $('doPrintBtn').onclick = () => window.print();
    $('manualRowBtn').onclick = () => addItem({nr:'',name:'Manuelle Position',cat:'',qty:1,price:0,manual:true});
    $('deleteOfferBtn').onclick = deleteCurrent;
    $('exportOfferBtn').onclick = exportCurrent;
    $('importOfferBtn').onclick = () => $('offerImportFile').click();
    $('offerImportFile').onchange = importOfferFile;
    $('exportAllBtn').onclick = exportAll;
    $('installBtn').onclick = async()=>{ if(deferredInstall){ deferredInstall.prompt(); deferredInstall=null; $('installBtn').classList.add('hidden'); } };
    $('importPriceBtn').onclick = () => $('priceFile').click();
    $('priceFile').onchange = importPriceFile;
    $('priceHistoryBtn').onclick = () => $('priceHistory').classList.toggle('hidden');
    $('offerPriceList').onchange = async()=>{ if(current){ current.priceListId=$('offerPriceList').value; await persistDraft(); } };
    $('applyPriceListBtn').onclick = applySelectedPriceList;
    ['customer','note','vat'].forEach(id=> $(id).addEventListener('input',()=>{ pullForm(); recalc(); persistDraft(); }));
    $('articleSearch').addEventListener('input', ()=>{ articleListOpen = false; renderSearch(); });
    $('showAllArticlesBtn').onclick = () => { selectedCategory = null; articleListOpen = !articleListOpen; renderSearch(); };
    $('articleSort').onchange = () => {
      selectedCategory = null;
      articleListOpen = $('articleSort').value === 'category' ? true : articleListOpen;
      renderSearch();
    };
    document.addEventListener('click', e=>{ if(!e.target.closest('.search-wrap')) $('searchResults').innerHTML=''; });
  }
  function show(id){ document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); $(id).classList.add('active'); if(id==='homeView') { refreshPriceLists(); renderOfferList(); } }
  async function refreshPriceLists(){
    const state = await GPriceLists.getState();
    const active = state.lists.find(l=>l.id===state.activeId) || state.lists[0];
    articles = active?.articles || [];
    $('activePriceList').textContent = active ? `${active.fileName || active.name} • ${active.count || articles.length} Artikel` : 'Keine Preisliste';
    renderPriceHistory(state);
    if(current) fillPriceSelect(state);
  }
  function renderPriceHistory(state){
    const box=$('priceHistory'); box.innerHTML='';
    state.lists.forEach(l=>{
      const row=document.createElement('button'); row.type='button'; row.className='drop-row';
      row.innerHTML=`<span><strong>${esc(l.fileName||l.name)}</strong><br><span class="muted">${esc(new Date(l.importedAt).toLocaleString('de-DE'))} • ${l.count||0} Artikel</span></span><span>${l.id===state.activeId?'✓':''}</span>`;
      row.onclick=async()=>{ await GPriceLists.setActiveList(l.id); $('priceHistory').classList.add('hidden'); await refreshPriceLists(); };
      box.appendChild(row);
    });
  }
  function fillPriceSelect(state){
    const sel=$('offerPriceList'); sel.innerHTML='';
    state.lists.forEach(l=>{ const o=document.createElement('option'); o.value=l.id; o.textContent=`${l.fileName||l.name} (${l.count||0})`; sel.appendChild(o); });
    sel.value = current.priceListId || state.activeId;
  }
  async function importPriceFile(){
    const file=$('priceFile').files[0]; if(!file) return;
    try{ const list = await GPriceLists.importPriceListFile(file); alert(`Preisliste importiert: ${list.count} Artikel`); await refreshPriceLists(); }
    catch(e){ alert('Import nicht möglich: '+(e.message||e)); }
    $('priceFile').value='';
  }
  function openOffer(offer){ current = JSON.parse(JSON.stringify(offer)); articleListOpen = false; selectedCategory = null; show('editView'); populateForm(); recalc(); renderItems(); refreshPriceLists(); $('articleSearch').value=''; $('searchResults').innerHTML=''; setTimeout(()=> $('articleSearch').focus(), 150); }
  function pullForm(){ if(!current) return; current.customer=$('customer').value; current.note=$('note').value; current.vat=num($('vat').value); current.priceListId=$('offerPriceList').value || current.priceListId; current.updatedAt=new Date().toISOString(); }
  function populateForm(){ $('customer').value=current.customer||''; $('note').value=current.note||''; $('vat').value=current.vat ?? 22; }
  async function saveCurrent(say){ if(!current) return; pullForm(); current.updatedAt=new Date().toISOString(); const i=offers.findIndex(o=>o.id===current.id); if(i>=0) offers[i]=JSON.parse(JSON.stringify(current)); else offers.unshift(JSON.parse(JSON.stringify(current))); await saveOffers(); await persistDraft(); if(say) toast('Gespeichert'); }
  function toast(msg){ const old=document.querySelector('.toast'); if(old) old.remove(); const t=document.createElement('div'); t.className='toast'; t.textContent=msg; Object.assign(t.style,{position:'fixed',left:'50%',bottom:'28px',transform:'translateX(-50%)',background:'var(--toast)',color:'#fff',padding:'11px 16px',borderRadius:'999px',zIndex:1000}); document.body.appendChild(t); setTimeout(()=>t.remove(),1400); }
  function renderOfferList(){
    const box=$('offerList'); if(!box) return; box.innerHTML='';
    if(!offers.length){ box.innerHTML='<div class="muted">Noch keine Angebote gespeichert.</div>'; return; }
    offers.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).forEach(o=>{
      const totals = calcTotals(o);
      const div=document.createElement('button'); div.type='button'; div.className='offer-card';
      div.innerHTML=`<strong>${esc(o.customer||'Ohne Kunde')}</strong><div class="meta">${esc(o.date||'')} • ${o.items?.length||0} Positionen • ${money(totals.gross)}</div>`;
      div.onclick=()=>openOffer(o); box.appendChild(div);
    });
  }
  function renderSearch(){
    const q=$('articleSearch').value.trim().toLowerCase();
    const box=$('searchResults');
    const mode = $('articleSort')?.value || 'nr';
    box.innerHTML='';

    if(mode === 'category' && !selectedCategory){
      renderCategoryDropdown(box);
      return;
    }

    const showAll = articleListOpen && q.length === 0;
    if(q.length < 2 && !showAll && !selectedCategory) return;
    const terms=q.split(/\s+/).filter(Boolean);
    let found = articles.filter(a=>{
      if(selectedCategory && String(a.cat||'') !== selectedCategory) return false;
      if(showAll || selectedCategory) {
        if(!terms.length) return true;
      }
      const hay=`${a.nr} ${a.name} ${a.cat} ${articleMeasure(a)}`.toLowerCase();
      return terms.every(t=>hay.includes(t));
    });
    found = sortArticles(found, mode);
    const limit = (showAll || selectedCategory) ? 5000 : 80;
    const shown = found.slice(0, limit);
    const count=document.createElement('div');
    count.className='article-count';
    if(selectedCategory){
      count.innerHTML = `<button type="button" class="category-back">‹ Kategorien</button><span><strong>${esc(selectedCategory)}</strong> • ${found.length} Artikel</span>`;
      count.querySelector('.category-back').onclick = () => { selectedCategory = null; renderSearch(); };
    }else{
      count.textContent = showAll ? `${found.length} Artikel angezeigt` : `${found.length} Treffer`;
    }
    box.appendChild(count);
    shown.forEach(a=>{
      const div=document.createElement('button');
      div.type='button';
      div.className='result article-result';
      const measure = articleMeasure(a);
      div.innerHTML=`<div class="result-main"><strong class="result-title">${esc(a.name)}</strong><div class="result-meta"><span class="pill">Nr. ${esc(a.nr)}</span>${measure?`<span class="pill">Maß ${esc(measure)}</span>`:''}${a.cat?`<span class="pill">${esc(a.cat)}</span>`:''}</div></div><div class="result-price">${money(a.price)}</div>`;
      div.onclick=()=>{ addItem({nr:a.nr,name:a.name,cat:a.cat,qty:1,price:a.price,priceListId:current.priceListId}); $('articleSearch').value=''; articleListOpen=false; selectedCategory=null; box.innerHTML=''; };
      box.appendChild(div);
    });
    if(!shown.length) box.innerHTML='<div class="result muted">Kein Artikel gefunden.</div>';
  }
  function renderCategoryDropdown(box){
    const coll = new Intl.Collator('de-DE', {numeric:true, sensitivity:'base'});
    const counts = new Map();
    articles.forEach(a=>{
      const cat = String(a.cat || 'Ohne Kategorie').trim() || 'Ohne Kategorie';
      counts.set(cat, (counts.get(cat)||0)+1);
    });
    const cats = Array.from(counts.keys()).sort(coll.compare);
    const head=document.createElement('div');
    head.className='article-count';
    head.textContent=`${cats.length} Kategorien`;
    box.appendChild(head);
    cats.forEach(cat=>{
      const row=document.createElement('button');
      row.type='button';
      row.className='result category-result';
      row.innerHTML=`<span>${esc(cat)}</span><strong>${counts.get(cat)} Artikel</strong>`;
      row.onclick=()=>{ selectedCategory = cat; articleListOpen = true; renderSearch(); };
      box.appendChild(row);
    });
    if(!cats.length) box.innerHTML='<div class="result muted">Keine Kategorien gefunden.</div>';
  }
  function sortArticles(list, mode){
    const coll = new Intl.Collator('de-DE', {numeric:true, sensitivity:'base'});
    return list.slice().sort((a,b)=>{
      if(mode==='name') return coll.compare(a.name||'', b.name||'') || coll.compare(a.nr||'', b.nr||'');
      if(mode==='measure') return coll.compare(articleMeasure(a), articleMeasure(b)) || coll.compare(a.name||'', b.name||'') || coll.compare(a.nr||'', b.nr||'');
      if(mode==='category') return coll.compare(a.cat||'', b.cat||'') || coll.compare(a.name||'', b.name||'') || coll.compare(a.nr||'', b.nr||'');
      return coll.compare(a.nr||'', b.nr||'') || coll.compare(a.name||'', b.name||'');
    });
  }
  function articleMeasure(a){
    const text = String(a?.name || '');
    const m = text.match(/(?:Ø\s*\d+(?:[,.]\d+)?|\d+\s*\/\s*\d+|\d+\s*(?:mm|cm|m|zoll|"|°)|\b\d+\s*[-xX]\s*\d+\b)/i);
    return m ? m[0].replace(/\s+/g,' ').trim() : '';
  }
  async function addItem(item){ if(!current) return; current.items.push({...item,id:uid()}); renderItems(); recalc(); await saveCurrent(); }
  function renderItems(){
    const box=$('items'); box.innerHTML='';
    if(!current.items.length){ box.innerHTML='<div class="muted">Noch keine Positionen. Suche oben einen Artikel oder füge manuell hinzu.</div>'; return; }
    current.items.forEach((it,idx)=>{
      const div=document.createElement('div'); div.className='item'; div.dataset.id=it.id;
      div.innerHTML=`<div class="item-head"><div><div class="item-title">${esc(it.name||'Position')}</div><div class="item-sub">${esc(it.nr||'manuell')} ${it.cat?'• '+esc(it.cat):''}</div></div><button class="xbtn" type="button">✕</button></div>
      <div class="item-grid"><label>Menge<input class="qty" inputmode="decimal" value="${esc(it.qty ?? 1)}"></label><label>Preis<input class="price" inputmode="decimal" value="${esc(it.price ?? 0)}"></label><label>Name<input class="name" value="${esc(it.name||'')}"></label></div><div class="item-total"></div>`;
      div.querySelector('.xbtn').onclick=()=>{ current.items.splice(idx,1); renderItems(); recalc(); saveCurrent(); };
      ['qty','price','name'].forEach(cls=> div.querySelector('.'+cls).addEventListener('input',()=>{ it.qty=num(div.querySelector('.qty').value); it.price=num(div.querySelector('.price').value); it.name=div.querySelector('.name').value; recalc(); persistDraft(); }));
      box.appendChild(div);
    });
    recalc();
  }
  function calcTotals(o){ const net=(o.items||[]).reduce((s,it)=>s+(num(it.qty)||1)*num(it.price),0); const vatRate=num(o.vat); const vat=net*vatRate/100; return {net,vat,gross:net+vat}; }
  function recalc(){ if(!current) return; pullForm(); document.querySelectorAll('.item').forEach((el,idx)=>{ const it=current.items[idx]; if(!it) return; const line=(num(it.qty)||1)*num(it.price); const t=el.querySelector('.item-total'); if(t) t.textContent=money(line); }); const t=calcTotals(current); $('netTotal').textContent=money(t.net); $('vatTotal').textContent=money(t.vat); $('grossTotal').textContent=money(t.gross); $('stickyTotal').textContent=money(t.gross); }
  async function applySelectedPriceList(){
    if(!current) return; const list=await GPriceLists.getListById($('offerPriceList').value); if(!list) return;
    const map=new Map((list.articles||[]).map(a=>[String(a.nr),a])); let changed=0;
    current.items.forEach(it=>{ if(it.nr && map.has(String(it.nr))){ const a=map.get(String(it.nr)); it.price=a.price; it.name=a.name; it.cat=a.cat; changed++; } });
    current.priceListId=list.id; renderItems(); recalc(); await saveCurrent(); alert(`${changed} Positionen wurden mit der gewählten Preisliste aktualisiert.`);
  }
  async function deleteCurrent(){ if(!current) return; if(!confirm('Dieses Angebot wirklich löschen?')) return; offers=offers.filter(o=>o.id!==current.id); await saveOffers(); current=null; show('homeView'); }
  function openPrint(){
    const t=calcTotals(current); const rows=(current.items||[]).map((it,i)=>`<tr><td>${i+1}</td><td>${esc(it.name||'')}</td><td>${esc(it.qty??1)}</td><td>${money(num(it.price))}</td><td>${money((num(it.qty)||1)*num(it.price))}</td></tr>`).join('');
    $('printDoc').innerHTML=`<h2>Angebot / Reparatur</h2><p><strong>${esc(current.customer||'')}</strong><br>${esc(current.note||'').replace(/\n/g,'<br>')}</p><p>Datum: ${esc(current.date||today())}</p><table class="print-table"><thead><tr><th>#</th><th>Artikel</th><th>Menge</th><th>Preis</th><th>Gesamt</th></tr></thead><tbody>${rows}</tbody></table><div class="print-sum"><div><span>Netto</span><strong>${money(t.net)}</strong></div><div><span>MwSt ${esc(current.vat)}%</span><strong>${money(t.vat)}</strong></div><div class="grand"><span>Brutto</span><strong>${money(t.gross)}</strong></div></div>`;
    show('printView');
  }
  function download(name, data){ const blob=new Blob([data],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }

  async function importOfferFile(){
    const input = $('offerImportFile');
    const file = input?.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      let imported = [];
      if(Array.isArray(data)) imported = data;
      else if(Array.isArray(data.offers)) imported = data.offers;
      else if(data && (Array.isArray(data.items) || data.customer !== undefined || data.id !== undefined)) imported = [data];
      imported = imported.filter(o => o && typeof o === 'object').map(o => {
        const copy = JSON.parse(JSON.stringify(o));
        copy.id = uid();
        copy.importedAt = new Date().toISOString();
        copy.updatedAt = new Date().toISOString();
        copy.createdAt = copy.createdAt || copy.importedAt;
        copy.date = copy.date || today();
        copy.items = Array.isArray(copy.items) ? copy.items.map(it => ({...it, id: it.id || uid()})) : [];
        copy.vat = copy.vat ?? 22;
        copy.priceListId = copy.priceListId || GPriceLists.getActiveListIdSync();
        return copy;
      });
      if(!imported.length) throw new Error('Keine gültigen Angebote in der Datei gefunden.');
      offers = [...imported, ...offers];
      await saveOffers();
      toast(imported.length === 1 ? 'Angebot importiert' : `${imported.length} Angebote importiert`);
      openOffer(imported[0]);
    }catch(e){
      alert('Import nicht möglich: '+(e.message||e));
    }finally{
      if(input) input.value='';
    }
  }

  function exportCurrent(){ if(current) download(`goggicantiere_${current.customer||current.id}.json`, JSON.stringify(current,null,2)); }
  function exportAll(){ download(`goggicantiere_backup_${today()}.json`, JSON.stringify({exportedAt:new Date().toISOString(), offers},null,2)); }
  function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  init().catch(e=>{ console.error(e); alert('Startfehler: '+(e.message||e)); });
})();
