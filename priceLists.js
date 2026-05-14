/* priceLists.js – Preislisten-Versionen + Excel(.xls)-Import für Goggicantiere
   Offline, ohne externe Bibliothek. Unterstützt die miniFaktura-Importliste aus dem Blatt "Importdaten".
*/
(function(){
  const PRICE_LISTS_KEY = "goggicantiere_price_lists_v1";
  const BUILTIN_ID = "builtin_articles_json";

  let cache = null;
  let initPromise = null;

  function uuid(){
    return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  }
  function safeStr(v){ return v == null ? "" : String(v); }
  function parseNumber(v){
    let s = safeStr(v).trim();
    if (!s) return 0;
    s = s.replace(/\s+/g, "").replace(/€/g, "");
    if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",")) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function normalizeArticle(a){
    return {
      nr: safeStr(a?.nr ?? a?.Artikelnummer ?? a?.artikelnummer).trim(),
      name: safeStr(a?.name ?? a?.Artikelbeschreibung ?? a?.artikelbeschreibung).trim(),
      cat: safeStr(a?.cat ?? a?.Artikelkategorie ?? a?.artikelkategorie).trim(),
      price: parseNumber(a?.price ?? a?.Preis ?? a?.preis)
    };
  }
  function normalizeArticles(list){
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach(item=>{
      const a = normalizeArticle(item);
      if (!a.nr || !a.name) return;
      const key = a.nr;
      if (seen.has(key)){
        const idx = out.findIndex(x=>x.nr === key);
        if (idx >= 0) out[idx] = a;
        return;
      }
      seen.add(key);
      out.push(a);
    });
    return out;
  }
  function baseState(){ return { version:1, activeId: BUILTIN_ID, lists: [] }; }
  async function gsGet(key){ return window.GStorage?.get ? GStorage.get(key) : Promise.resolve(localStorage.getItem(key)); }
  async function gsSet(key, value){ return window.GStorage?.set ? GStorage.set(key, value) : Promise.resolve(localStorage.setItem(key, value)); }
  async function loadRaw(){
    try{
      const raw = await gsGet(PRICE_LISTS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.lists)) return null;
      parsed.lists.forEach(l=>{ l.articles = normalizeArticles(l.articles); });
      return parsed;
    }catch(e){
      console.warn("Preislisten konnten nicht gelesen werden:", e);
      return null;
    }
  }
  async function saveRaw(state){
    cache = state;
    await gsSet(PRICE_LISTS_KEY, JSON.stringify(state));
  }
  async function fetchBuiltinArticles(){
    const res = await fetch("./articles.json", { cache:"no-store" });
    if (!res.ok) throw new Error("articles.json HTTP " + res.status);
    const data = await res.json();
    return normalizeArticles(data.articles || []);
  }
  async function ensureInitialized(){
    if (cache) return cache;
    if (initPromise) return initPromise;
    initPromise = (async()=>{
      let state = await loadRaw();
      if (!state) state = baseState();
      if (!Array.isArray(state.lists)) state.lists = [];

      let builtin = state.lists.find(l=>l.id === BUILTIN_ID);
      if (!builtin){
        let articles = [];
        try{ articles = await fetchBuiltinArticles(); }catch(e){ console.warn(e); }
        builtin = {
          id: BUILTIN_ID,
          name: "Basisliste (articles.json)",
          fileName: "articles.json",
          importedAt: new Date().toISOString(),
          source: "builtin",
          count: articles.length,
          articles
        };
        state.lists.unshift(builtin);
      }
      if (!state.activeId || !state.lists.some(l=>l.id === state.activeId)) state.activeId = state.lists[0]?.id || BUILTIN_ID;
      await saveRaw(state);
      return state;
    })();
    return initPromise;
  }
  async function getState(){ return ensureInitialized(); }
  function getStateSync(){ return cache; }
  async function getActiveList(){
    const s = await ensureInitialized();
    return s.lists.find(l=>l.id === s.activeId) || s.lists[0] || null;
  }
  function getActiveListIdSync(){ return cache?.activeId || BUILTIN_ID; }
  async function getListById(id){
    const s = await ensureInitialized();
    return s.lists.find(l=>l.id === id) || s.lists.find(l=>l.id === s.activeId) || s.lists[0] || null;
  }
  async function setActiveList(id){
    const s = await ensureInitialized();
    if (!s.lists.some(l=>l.id === id)) throw new Error("Preisliste nicht gefunden");
    s.activeId = id;
    await saveRaw(s);
    return s;
  }

  /* ---------- CSV als Fallback ---------- */
  function parseCsv(text){
    const rows=[]; let row=[]; let cur=""; let q=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i]; const nx=text[i+1];
      if(q){
        if(ch==='"' && nx==='"'){ cur+='"'; i++; }
        else if(ch==='"'){ q=false; }
        else cur+=ch;
      }else{
        if(ch==='"') q=true;
        else if(ch===';' || ch===','){ row.push(cur); cur=""; }
        else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=""; }
        else if(ch==='\r'){}
        else cur+=ch;
      }
    }
    row.push(cur); rows.push(row);
    return rows;
  }

  /* ---------- Minimaler .xls BIFF8 Parser (für miniFaktura Importdaten) ---------- */
  function u16(d,o){ return d[o] | (d[o+1]<<8); }
  function u32(d,o){ return (d[o] | (d[o+1]<<8) | (d[o+2]<<16) | (d[o+3]<<24)) >>> 0; }
  function i32(d,o){ return (d[o] | (d[o+1]<<8) | (d[o+2]<<16) | (d[o+3]<<24)) | 0; }
  function dbl(d,o){ return new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true); }
  function utf16le(d,o,lenBytes){
    let s=""; const end=o+lenBytes;
    for(let p=o;p+1<end;p+=2){ const c=u16(d,p); if(c) s+=String.fromCharCode(c); }
    return s;
  }
  function ansi(d,o,len){
    let s=""; for(let p=o;p<o+len && p<d.length;p++){ if(d[p]) s+=String.fromCharCode(d[p]); }
    try{ return decodeURIComponent(escape(s)); }catch{ return s; }
  }
  function decodeRk(raw){
    const mult100 = raw & 1;
    const isInt = raw & 2;
    let val;
    if (isInt) val = (raw >> 2);
    else {
      const buf = new ArrayBuffer(8);
      const view = new DataView(buf);
      view.setUint32(0, 0, true);
      view.setUint32(4, raw & 0xfffffffc, true);
      val = view.getFloat64(0, true);
    }
    if (mult100) val /= 100;
    return val;
  }
  function readCfbStream(bytes, wantedNames){
    if (u32(bytes,0) !== 0xE011CFD0 || u32(bytes,4) !== 0xE11AB1A1) throw new Error("Keine gültige .xls Datei.");
    const sectorSize = 1 << u16(bytes,30);
    const miniSectorSize = 1 << u16(bytes,32);
    const numFat = u32(bytes,44);
    const dirStart = i32(bytes,48);
    const miniCutoff = u32(bytes,56);
    const miniFatStart = i32(bytes,60);
    const numMiniFat = u32(bytes,64);
    const difat = [];
    for(let i=0;i<109;i++){ const sid=i32(bytes,76+i*4); if(sid>=0) difat.push(sid); }
    function sector(sid){ const start = (sid + 1) * sectorSize; return bytes.subarray(start, start + sectorSize); }
    const fat=[];
    for(let i=0;i<Math.min(numFat,difat.length);i++){
      const sec=sector(difat[i]);
      for(let p=0;p<sec.length;p+=4) fat.push(i32(sec,p));
    }
    function chain(start, maxBytes){
      const parts=[]; let sid=start; let guard=0; let total=0;
      while(sid>=0 && sid < fat.length && sid !== -2 && guard++ < 100000){
        const sec=sector(sid); parts.push(sec); total += sec.length;
        if (maxBytes && total >= maxBytes) break;
        sid=fat[sid];
      }
      let outLen = parts.reduce((s,a)=>s+a.length,0);
      if (maxBytes) outLen = Math.min(outLen, maxBytes);
      const out=new Uint8Array(outLen); let off=0;
      for(const part of parts){ const n=Math.min(part.length,out.length-off); out.set(part.subarray(0,n),off); off+=n; if(off>=out.length) break; }
      return out;
    }
    const dirBytes = chain(dirStart);
    const entries=[];
    for(let o=0;o+128<=dirBytes.length;o+=128){
      const nameLen=u16(dirBytes,o+64);
      if(!nameLen) continue;
      const name=utf16le(dirBytes,o,Math.max(0,nameLen-2));
      entries.push({ name, type:dirBytes[o+66], start:i32(dirBytes,o+116), size:u32(dirBytes,o+120) });
    }
    const root = entries.find(e=>e.type===5);
    const target = entries.find(e=>wantedNames.includes(e.name));
    if(!target) throw new Error("Workbook-Stream nicht gefunden.");
    if(target.size >= miniCutoff || !root) return chain(target.start, target.size).subarray(0,target.size);

    const miniStream = chain(root.start, root.size).subarray(0, root.size);
    const miniFatBytes = numMiniFat > 0 ? chain(miniFatStart, numMiniFat * sectorSize) : new Uint8Array();
    const miniFat=[]; for(let p=0;p<miniFatBytes.length;p+=4) miniFat.push(i32(miniFatBytes,p));
    const parts=[]; let sid=target.start; let guard=0;
    while(sid>=0 && sid<miniFat.length && sid!==-2 && guard++<100000){
      const st=sid*miniSectorSize; parts.push(miniStream.subarray(st, st+miniSectorSize)); sid=miniFat[sid];
    }
    const out=new Uint8Array(target.size); let off=0;
    for(const part of parts){ const n=Math.min(part.length,out.length-off); out.set(part.subarray(0,n),off); off+=n; if(off>=out.length) break; }
    return out;
  }
  class ChunkReader{
    constructor(chunks){ this.chunks=chunks.filter(c=>c && c.length); this.c=0; this.o=0; }
    byte(){
      while(this.c<this.chunks.length && this.o>=this.chunks[this.c].length){ this.c++; this.o=0; }
      if(this.c>=this.chunks.length) return 0;
      return this.chunks[this.c][this.o++];
    }
    u16(){ const a=this.byte(), b=this.byte(); return a | (b<<8); }
    u32(){ const a=this.u16(), b=this.u16(); return (a | (b<<16))>>>0; }
    bytes(n){ const a=[]; for(let i=0;i<n;i++) a.push(this.byte()); return a; }
    skip(n){ for(let i=0;i<n;i++) this.byte(); }
    readString(){
      const len=this.u16();
      let flags=this.byte();
      const rich = flags & 0x08;
      const ext = flags & 0x04;
      const richCount = rich ? this.u16() : 0;
      const extLen = ext ? this.u32() : 0;
      let is16 = !!(flags & 0x01);
      let s="";
      for(let i=0;i<len;i++){
        while(this.c<this.chunks.length && this.o>=this.chunks[this.c].length){ this.c++; this.o=0; if(this.c<this.chunks.length){ flags=this.byte(); is16=!!(flags&1); } }
        if(is16) s += String.fromCharCode(this.u16());
        else s += String.fromCharCode(this.byte());
      }
      if(richCount) this.skip(richCount*4);
      if(extLen) this.skip(extLen);
      return s;
    }
  }
  function parseSst(chunks, totalUnique){
    const r = new ChunkReader(chunks);
    const arr=[];
    for(let i=0;i<totalUnique;i++) arr.push(r.readString());
    return arr;
  }
  function cellRef(row,col){
    const letters = [];
    let c = col;
    do{ letters.unshift(String.fromCharCode(65 + (c % 26))); c = Math.floor(c/26) - 1; }while(c>=0);
    return letters.join("") + String(row+1);
  }
  function parseXls(bytes){
    const wb = readCfbStream(bytes, ["Workbook", "Book"]);
    const sheets=[]; const records=[]; let pos=0;
    let sstChunks=[]; let sstUnique=0;
    while(pos+4<=wb.length){
      const id=u16(wb,pos), len=u16(wb,pos+2), data=wb.subarray(pos+4,pos+4+len);
      records.push({id,pos,data});
      if(id===0x0085){
        const off=u32(data,0); const nlen=data[6]; const flags=data[7];
        const name = (flags & 1) ? utf16le(data,8,nlen*2) : ansi(data,8,nlen);
        sheets.push({name, offset:off});
      }else if(id===0x00FC){
        sstUnique = u32(data,4);
        sstChunks = [data.subarray(8)];
        let p = pos + 4 + len;
        while(p+4<=wb.length && u16(wb,p)===0x003C){
          const l=u16(wb,p+2); sstChunks.push(wb.subarray(p+4,p+4+l)); p += 4 + l;
        }
      }
      pos += 4 + len;
    }
    const sst = sstChunks.length ? parseSst(sstChunks, sstUnique) : [];
    let sheet = sheets.find(s=>String(s.name).toLowerCase()==="importdaten") || sheets[1] || sheets[0];
    if(!sheet) throw new Error("Kein Tabellenblatt gefunden.");
    const cells = {};
    pos = sheet.offset;
    while(pos+4<=wb.length){
      const id=u16(wb,pos), len=u16(wb,pos+2), data=wb.subarray(pos+4,pos+4+len);
      if(id===0x000A) break;
      if(id===0x0006 && data.length>=14){
        const row = u16(data,0), col = u16(data,2);
        const marker = u16(data,12);
        // Normales numerisches Formelergebnis. String-/Bool-/Error-Formeln werden ignoriert.
        if (marker !== 0xFFFF) cells[cellRef(row,col)] = dbl(data,6);
      }
      else if(id===0x0203 && data.length>=14){ cells[cellRef(u16(data,0),u16(data,2))] = dbl(data,6); }
      else if(id===0x027E && data.length>=10){ cells[cellRef(u16(data,0),u16(data,2))] = decodeRk(u32(data,6)); }
      else if(id===0x00BD && data.length>=8){
        const row=u16(data,0), colFirst=u16(data,2), colLast=u16(data,data.length-2);
        let p=4;
        for(let c=colFirst;c<=colLast && p+6<=data.length-2;c++,p+=6) cells[cellRef(row,c)] = decodeRk(u32(data,p+2));
      }
      else if(id===0x00FD && data.length>=10){ cells[cellRef(u16(data,0),u16(data,2))] = sst[u32(data,6)] ?? ""; }
      else if(id===0x0204 && data.length>=8){
        const row=u16(data,0), col=u16(data,2), n=u16(data,6); cells[cellRef(row,col)] = ansi(data,8,n);
      }
      pos += 4 + len;
    }
    const rowMap = new Map();
    Object.entries(cells).forEach(([ref,val])=>{
      const m=ref.match(/^([A-Z]+)(\d+)$/); if(!m) return;
      const colName=m[1]; const row=Number(m[2]);
      if(!rowMap.has(row)) rowMap.set(row,{});
      rowMap.get(row)[colName]=val;
    });
    return [...rowMap.entries()].sort((a,b)=>a[0]-b[0]).map(([row,cells])=>({row,cells}));
  }
  function normalizeHeader(s){ return safeStr(s).toLowerCase().replace(/\s+/g," ").trim(); }
  function rowsToArticles(rows){
    const headerRow = rows.find(r=>Object.values(r.cells).some(v=>normalizeHeader(v).includes("artikelnummer")));
    let startRow = 4;
    let cols = { nr:"A", name:"B", price:"D", cat:"I" };
    if(headerRow){
      startRow = headerRow.row + 1;
      let explicitPriceCol = null;
      let genericPriceCol = null;
      Object.entries(headerRow.cells).forEach(([col,val])=>{
        const h=normalizeHeader(val);
        if(h.includes("artikelnummer")) cols.nr=col;
        else if(h.includes("artikelbeschreibung")) cols.name=col;
        else if(h.includes("vk-preis ab 1") || h.includes("preis ab 1")) explicitPriceCol=col;
        else if(!genericPriceCol && h.includes("preis")) genericPriceCol=col;
        else if(h.includes("artikelkategorie") || h.includes("kategorie")) cols.cat=col;
      });
      cols.price = explicitPriceCol || genericPriceCol || cols.price;
    }
    return normalizeArticles(rows.filter(r=>r.row>=startRow).map(r=>({
      nr: r.cells[cols.nr], name: r.cells[cols.name], price: r.cells[cols.price], cat: r.cells[cols.cat]
    })));
  }
  async function parseFileToArticles(file){
    const name = file?.name || "Preisliste";
    const lower = name.toLowerCase();
    if(lower.endsWith(".json")){
      const txt=await file.text(); const data=JSON.parse(txt);
      return normalizeArticles(data.articles || data);
    }
    if(lower.endsWith(".csv")){
      const rows=parseCsv(await file.text()).map((arr,i)=>({row:i+1,cells:{A:arr[0],B:arr[1],C:arr[2],D:arr[3],E:arr[4],F:arr[5],G:arr[6],H:arr[7],I:arr[8]}}));
      return rowsToArticles(rows);
    }
    if(lower.endsWith(".xls")){
      const bytes = new Uint8Array(await file.arrayBuffer());
      return rowsToArticles(parseXls(bytes));
    }
    throw new Error("Bitte eine .xls, .csv oder .json Datei wählen. .xlsx bitte vorher als .xls speichern.");
  }
  async function importPriceListFile(file){
    const articles = await parseFileToArticles(file);
    if(!articles.length) throw new Error("Keine Artikel gefunden. Erwartet: Blatt Importdaten, ab Zeile 4: A=Artikelnummer, B=Artikelbeschreibung, D=VK-Preis, I=Kategorie.");
    const s = await ensureInitialized();
    const now = new Date();
    const dateLabel = now.toLocaleString("de-DE", { dateStyle:"short", timeStyle:"short" });
    const list = {
      id: "pl_" + uuid(),
      name: `${file.name} – ${dateLabel}`,
      fileName: file.name,
      importedAt: now.toISOString(),
      source: "import",
      count: articles.length,
      articles
    };
    s.lists.unshift(list);
    s.activeId = list.id;
    await saveRaw(s);
    return list;
  }

  window.GPriceLists = {
    key: PRICE_LISTS_KEY,
    builtinId: BUILTIN_ID,
    init: ensureInitialized,
    getState,
    getStateSync,
    getActiveList,
    getActiveListIdSync,
    getListById,
    setActiveList,
    importPriceListFile,
    parseFileToArticles
  };
})();
