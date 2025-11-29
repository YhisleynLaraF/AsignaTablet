// ==========================
// app.js — lógica con Firebase en duro
// ==========================

const $ = sel => document.querySelector(sel);
const nowISO = () => new Date().toISOString();
const fmtDate = iso => new Date(iso).toLocaleString();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const isEmpty = v => !v || String(v).trim()==='';
const onlyDigits = v => String(v||'').replace(/\D+/g,'');

// ===== Autocomplete genérico =====
function toDigits(s){ return String(s||'').replace(/\D+/g,''); }
function toKey(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }

function upgradeToAutocomplete(elementId, placeholder){
  const old = document.getElementById(elementId);
  if(!old) return null;

  // Si ya es <input>, solo lo envuelvo
  let input;
  if(old.tagName.toLowerCase() === 'select'){
    input = document.createElement('input');
    input.id = elementId;
    input.placeholder = placeholder || old.getAttribute('placeholder') || '';
    input.className = old.className || '';
    input.setAttribute('autocomplete', 'off');
    input.style.width = '100%';
    old.parentNode.replaceChild(input, old);
  }else{
    input = old;
    input.setAttribute('autocomplete', 'off');
  }

  // Wrapper + lista
  const wrap = document.createElement('div');
  wrap.className = 'ac-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const list = document.createElement('div');
  list.className = 'ac-list';
  wrap.appendChild(list);

  let items = [], idx = -1, lastQ = '';

  function render(q){ // filtra y dibuja
    list.innerHTML = '';
    if(!items.length){ list.style.display='none'; return; }
    items.forEach((it,i)=>{
      const row = document.createElement('div');
      row.className = 'ac-item' + (i===idx?' active':'');
      row.innerHTML = it.html || `${it.value}${it.extra?` <small>${it.extra}</small>`:''}`;
      row.onclick = ()=>{ input.value = it.value; hide(); if(it.onPick) it.onPick(it); };
      list.appendChild(row);
    });
    list.style.display = 'block';
  }
  function hide(){ list.style.display='none'; idx=-1; }

  function onKey(e){
    if(list.style.display==='none') return;
    if(e.key==='ArrowDown'){ idx = Math.min(idx+1, items.length-1); render(lastQ); e.preventDefault(); }
    else if(e.key==='ArrowUp'){ idx = Math.max(idx-1, 0); render(lastQ); e.preventDefault(); }
    else if(e.key==='Enter'){ if(idx>=0){ const it = items[idx]; input.value = it.value; hide(); if(it.onPick) it.onPick(it); e.preventDefault(); } }
    else if(e.key==='Escape'){ hide(); }
  }

  return {
    input, list,
    setItems(arr, q){ items = arr||[]; idx=-1; lastQ=q||''; render(q); },
    hide
  };
}

// Helpers para construir resultados
const AC = {
  // tablets: match por cualquier subcadena de IMEI (ej: últimos 6)
  async tablets(query){
    const qd = toDigits(query);
    if(qd.length < 3) return []; // evita ruido
    const all = await getAll('tablets');
    return all
      .filter(t => String(t.imei).includes(qd))
      .slice(0, 50)
      .map(t => ({ value: String(t.imei), extra: t.modelo||'' }));
  },
  // conductores: por RUT o por nombre
  async conductores(query){
    const q = toKey(query), qd = toDigits(query);
    if(q.length < 2 && qd.length < 3) return [];
    const all = await getAll('conductores');
    return all
      .filter(c => toKey(c.nombre||'').includes(q) || String(c.rut).toLowerCase().includes(query.toLowerCase()))
      .slice(0, 50)
      .map(c => ({ value: String(c.rut), extra: c.nombre||'' }));
  },
  // sims: por número o ICCID
  async sims(query){
    const q = toDigits(query);
    if(q.length < 3) return [];
    const all = await getAll('sims');
    return all
      .filter(s => String(s.numero||'').includes(q) || String(s.iccid||'').includes(q))
      .slice(0, 50)
      .map(s => ({ value: String(s.numero||''), extra: s.iccid||'' }));
  }
};


(function buildTabs(){
  const sections = [
    { id:'sec-asignar', label:'Asignar' },
    { id:'sec-tablets', label:'Tablets' },
    { id:'sec-conductores', label:'Conductores' },
    { id:'sec-vehiculos', label:'Vehículos' },
    { id:'sec-sims', label:'SIMs' },
    { id:'sec-historico', label:'Histórico' },   // <-- NUEVO
    { id:'sec-ajustes', label:'Ajustes' },
  ];
  const tabsEl = document.getElementById('tabs');
  sections.forEach((s,i)=>{
    const b = document.createElement('button');
    b.className = 'tab' + (i===0?' active':'');
    b.textContent = s.label;
    b.onclick = ()=>{
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.section').forEach(sec=>sec.classList.remove('active'));
      document.getElementById(s.id).classList.add('active');
    };
    tabsEl.appendChild(b);
  });
})();

let DB_NAME = 'asignadorDB_' + currentZone; // una DB local por zona
const DB_VER = 1;
let db;

async function openDBForZone(zone){
  DB_NAME = 'asignadorDB_' + zone;
  if (db && db.close) { try{ db.close(); }catch(_){} }
  db = null;
  await openDB();
}

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (ev)=>{
      const d = ev.target.result;
      if(!d.objectStoreNames.contains('tablets')){
        const s = d.createObjectStore('tablets', { keyPath:'imei' });
        s.createIndex('modelo','modelo',{unique:false});
        s.createIndex('estado','estado',{unique:false});
      }
      if(!d.objectStoreNames.contains('conductores')) d.createObjectStore('conductores', { keyPath:'rut' });
      if(!d.objectStoreNames.contains('vehiculos')) d.createObjectStore('vehiculos', { keyPath:'patente' });
      if(!d.objectStoreNames.contains('sims')) d.createObjectStore('sims', { keyPath:'numero' });
      if(!d.objectStoreNames.contains('asignaciones')){
        const a = d.createObjectStore('asignaciones', { keyPath:'id' });
        a.createIndex('estado','estado',{unique:false});
        a.createIndex('tabletImei','tabletImei',{unique:false});
        a.createIndex('patente','patente',{unique:false});
      }
    };
    req.onsuccess = ()=>{ db = req.result; resolve(db) };
    req.onerror = ()=> reject(req.error);
  });
}
function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }
const getAll = (store)=> new Promise((res,rej)=>{ const r=tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error)});
const get = (store,key)=> new Promise((res,rej)=>{ const r=tx(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error)});
const put = (store,obj)=> new Promise((res,rej)=>{ const r=tx(store,'readwrite').put(obj); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error)});
const del = (store,key)=> new Promise((res,rej)=>{ const r=tx(store,'readwrite').delete(key); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error)});

// Firebase en duro
const FORCE_FIREBASE = true;
// 4 PROYECTOS: RELLENA con tus credenciales reales
const FIREBASE_CONFIGS = {
  consti: {
    apiKey: "AIzaSyANiGFaZSU7gbvAc_Lljlt8JfACAKC7P1M",
    authDomain: "asignatabletconsti.firebaseapp.com",
    projectId: "asignatabletconsti",
    storageBucket: "asignatabletconsti.firebasestorage.app",
    messagingSenderId: "783352339818",
    appId: "1:783352339818:web:c3756b40c90f8032be9913",
  },
  chillan: {
    apiKey: "AIzaSyA9IKdd1NDOw_9CjdpK__wS2gaAGSBCRw8",
    authDomain: "asignatabletchillan.firebaseapp.com",
    projectId: "asignatabletchillan",
    storageBucket: "asignatabletchillan.firebasestorage.app",
    messagingSenderId: "693814715022",
    appId: "1:693814715022:web:318861decde93ae71c5fdf",
  },
  arauco: {
    apiKey: "AIzaSyDLh83W6IGZk97PPPUSkWJTLoPppSMEwGo",
    authDomain: "asignatabletarauco.firebaseapp.com",
    projectId: "asignatabletarauco",
    storageBucket: "asignatabletarauco.firebasestorage.app",
    messagingSenderId: "160594763774",
    appId: "1:160594763774:web:aab3d7a361006c0a85eaaf",
  },
  valdivia: {
    apiKey: "AIzaSyArU_xinVBUwIw6mpsgOIfuMzp9RSgkteY",
    authDomain: "asignatabletvaldivia.firebaseapp.com",
    projectId: "asignatabletvaldivia",
    storageBucket: "asignatabletvaldivia.firebasestorage.app",
    messagingSenderId: "693945062676",
    appId: "1:693945062676:web:86817eba04d96a28bf5e01",
  }
};

// Zona actual (persistida)
let currentZone = localStorage.getItem('fb_zone') || 'chillan';

// Firebase libs/estado
let fbApp=null, auth=null, fs=null, ff=null, fbLib=null, authLib=null;
let fbUnsubs = [];

async function enableFirebaseForZone(zone){
  if(!FORCE_FIREBASE) return;
  const cfg = FIREBASE_CONFIGS[zone];
  if(!cfg) throw new Error('Config Firebase no definida para zona: ' + zone);

  // importa módulos una sola vez
  if(!fbLib)   fbLib   = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  if(!authLib) authLib = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  if(!ff)      ff      = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

  // cierra app previa (si existía)
  if (fbApp && fbLib?.deleteApp) {
    try { await fbLib.deleteApp(fbApp); } catch(_) {}
  }

  fbApp = fbLib.initializeApp(cfg, 'app-'+zone);
  auth  = authLib.getAuth(fbApp);
  fs    = ff.getFirestore(fbApp);

  await authLib.setPersistence(auth, authLib.browserLocalPersistence);
  if(!auth.currentUser) await authLib.signInAnonymously(auth);

  ff.enableIndexedDbPersistence(fs).catch(()=>{});
  window.addEventListener('online', ()=> ff.enableNetwork(fs));
  window.addEventListener('offline', ()=> ff.disableNetwork(fs));

  // UI
  const st = document.getElementById('firebase-status');
  if(st) st.textContent = `Firestore activo · zona: ${zone} · proyecto: ${cfg.projectId}`;
  const cfgBox = document.getElementById('firebase-config');
  if(cfgBox) cfgBox.value = JSON.stringify(cfg, null, 2);
  const zinfo = document.getElementById('zone-info');
  if(zinfo) zinfo.textContent = `· ${zone} (${cfg.projectId})`;
}


function stopRealtime(){
  fbUnsubs.forEach(u=>{ try{ u && u(); }catch(_){} });
  fbUnsubs = [];
}

function startRealtimeSync(){
  if(!fs || !ff) return;
  stopRealtime(); // asegura no duplicar listeners

  const upsert = async (store, keyField, doc) => {
    const current = await get(store, doc[keyField]);
    await put(store, { ...(current||{}), ...doc });
  };

  fbUnsubs.push(
    ff.onSnapshot(ff.collection(fs, 'vehiculos'), snap =>
      snap.docChanges().forEach(async ch => { if(ch.type!=='removed') await upsert('vehiculos','patente', ch.doc.data()); })
    )
  );
  fbUnsubs.push(
    ff.onSnapshot(ff.collection(fs, 'conductores'), snap =>
      snap.docChanges().forEach(async ch => { if(ch.type!=='removed') await upsert('conductores','rut', ch.doc.data()); })
    )
  );
  fbUnsubs.push(
    ff.onSnapshot(ff.collection(fs, 'sims'), snap =>
      snap.docChanges().forEach(async ch => { if(ch.type!=='removed') await upsert('sims','numero', ch.doc.data()); })
    )
  );
  fbUnsubs.push(
    ff.onSnapshot(ff.collection(fs, 'tablets'), snap =>
      snap.docChanges().forEach(async ch => { if(ch.type!=='removed') await upsert('tablets','imei', ch.doc.data()); })
    )
  );
  fbUnsubs.push(
    ff.onSnapshot(ff.collection(fs, 'asignaciones'), snap =>
      snap.docChanges().forEach(async ch => {
        if(ch.type!=='removed'){ await put('asignaciones', ch.doc.data()); renderAsignaciones(); renderHistorico(); }
      })
    )
  );
}

async function switchZone(zone){
  if(zone === currentZone) return;

  // 1) Persisto nueva zona
  currentZone = zone;
  localStorage.setItem('fb_zone', zone);

  // 2) DB local de la zona
  await openDBForZone(zone);

  // 3) Re-render con datos locales (vacío o previos de esa zona)
  await Promise.all([
    renderTablets(), renderConductores(), renderVehiculos(),
    renderSims(), renderAsignaciones(), renderHistorico(), refreshMasterSelects()
  ]);

  // 4) Firebase para la zona y listeners
  await enableFirebaseForZone(zone);
  startRealtimeSync();
}



// Render
async function renderTablets(){
  const tbody = document.querySelector('#tabla-tablets tbody');
  const q = (document.getElementById('filtro-tablets').value||'').toLowerCase();
  const items = (await getAll('tablets')).filter(t=>
    t.imei.toLowerCase().includes(q) || (t.modelo||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = items.map(t=>`
    <tr>
      <td>${t.imei}</td>
      <td>${t.modelo||''}</td>
      <td>${t.estado||'disponible'}</td>
      <td>${t.nota||''}</td>
      <td><button class="btn red" data-del-tablet="${t.imei}">Eliminar</button></td>
    </tr>
  `).join('');
}
async function renderConductores(){
  const tbody = document.querySelector('#tabla-conductores tbody');
  const q = (document.getElementById('filtro-conductores').value||'').toLowerCase();
  const items = (await getAll('conductores')).filter(c=>
    c.rut.toLowerCase().includes(q) || (c.nombre||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = items.map(c=>`
    <tr>
      <td>${c.rut}</td>
      <td>${c.nombre||''}</td>
      <td><button class="btn red" data-del-conductor="${c.rut}">Eliminar</button></td>
    </tr>
  `).join('');
}
async function renderVehiculos(){
  const tbody = document.querySelector('#tabla-vehiculos tbody');
  const q = (document.getElementById('filtro-vehiculos').value||'').toLowerCase();
  const items = (await getAll('vehiculos')).filter(v=>
    v.patente.toLowerCase().includes(q) || (v.sigla||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = items.map(v=>`
    <tr>
      <td>${v.patente}</td>
      <td>${v.sigla||''}</td>
      <td><button class="btn red" data-del-veh="${v.patente}">Eliminar</button></td>
    </tr>
  `).join('');
}
async function renderSims(){
  const tbody = document.querySelector('#tabla-sims tbody');
  const q = (document.getElementById('filtro-sims').value||'').toLowerCase();
  const items = (await getAll('sims')).filter(s=>
    (s.numero||'').toLowerCase().includes(q) || (s.iccid||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = items.map(s=>`
    <tr>
      <td>${s.numero||''}</td>
      <td>${s.iccid||''}</td>
      <td>${s.simImei||''}</td>
      <td><button class="btn red" data-del-sim="${s.numero}">Eliminar</button></td>
    </tr>
  `).join('');
}
async function renderAsignaciones(){
  const tbody = document.querySelector('#tabla-asignaciones tbody');
  const q = (document.getElementById('filtro').value||'').toLowerCase();
  const items = (await getAll('asignaciones')).filter(a=> !a.devueltoEn );
  const filt = items.filter(a=>
    (a.patente||'').toLowerCase().includes(q) || (a.sigla||'').toLowerCase().includes(q) ||
    (a.tabletImei||'').toLowerCase().includes(q) || (a.rut||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = filt.sort((a,b)=> b.entregadoEn.localeCompare(a.entregadoEn)).map(a=>{
    const pill = a.red==='SIM'?'<span class="pill sim">SIM</span>':'<span class="pill wifi">WIFI</span>';
    const estado = `<span class="status entregado">Entregado</span>`;
    const simTxt = a.red==='SIM' ? `${a.simNumero||''}\n${a.simIccid||''}` : '';
    return `
      <tr>
        <td title="${a.entregadoEn}">${fmtDate(a.entregadoEn)}</td>
        <td>${a.sigla||''}</td>
        <td>${a.tabletImei||''}</td>
        <td>${pill}</td>
        <td>${a.rut||''}</td>
        <td>${estado}</td>
        <td>${a.observacion||''}</td>
        <td><button class="btn" data-retirar="${a.id}">Retirar</button></td>
      </tr>
    `;
  }).join('');
}

// --- Histórico diario ---
function isSameDay(iso, day){
  if(!iso) return false;
  const d = new Date(iso);
  return d.getFullYear()===day.getFullYear() && d.getMonth()===day.getMonth() && d.getDate()===day.getDate();
}

async function renderHistorico(){
  const tbody = document.querySelector('#tabla-historico tbody');
  if(!tbody) return;

  const dateEl = document.getElementById('hist-date');
  const statusEl = document.getElementById('hist-status');
  const qEl = document.getElementById('hist-search');

  const day = dateEl?.value ? new Date(dateEl.value+'T00:00:00') : new Date();
  const status = (statusEl?.value || 'todos').toLowerCase();
  const q = (qEl?.value || '').toLowerCase();

  const all = await getAll('asignaciones');

  // Construye "eventos" del día: Entregado (entregadoEn) y Retirado (devueltoEn)
  const rows = [];
  for(const a of all){
    if(isSameDay(a.entregadoEn, day)){
      rows.push({ ev:'Entregado', time:a.entregadoEn, a });
    }
    if(isSameDay(a.devueltoEn, day)){
      rows.push({ ev:'Retirado', time:a.devueltoEn, a });
    }
  }

  // Filtro por estado
  const filtered = rows.filter(r=>{
    if(status==='entregado' && r.ev!=='Entregado') return false;
    if(status==='retirado' && r.ev!=='Retirado') return false;
    return true;
  }).filter(r=>{
    // Búsqueda libre
    const a = r.a;
    const hay = (a.patente||'').toLowerCase().includes(q)
      || (a.sigla||'').toLowerCase().includes(q)
      || (a.tabletImei||'').toLowerCase().includes(q)
      || (a.rut||'').toLowerCase().includes(q)
      || (a.simNumero||'').toLowerCase().includes(q)
      || (a.simIccid||'').toLowerCase().includes(q);
    return q ? hay : true;
  }).sort((x,y)=> y.time.localeCompare(x.time));

  tbody.innerHTML = filtered.map(r=>{
    const a = r.a;
    const simTxt = a.red==='SIM' ? `${a.simNumero||''}${a.simIccid?` / ${a.simIccid}`:''}` : '';
    return `
      <tr>
        <td title="${r.time}">${fmtDate(r.time)}</td>
        <td>${a.patente||''}</td>
        <td>${a.sigla||''}</td>
        <td>${a.tabletImei||''}</td>
        <td>${a.red||''}</td>
        <td>${simTxt}</td>
        <td>${a.rut||''}</td>
        <td><span class="status ${r.ev==='Entregado'?'entregado':'retirado'}">${r.ev}</span></td>
        <td>${a.observacion||''}</td>
      </tr>
    `;
  }).join('');
}

// Exporta lo visible del histórico
document.getElementById('hist-export')?.addEventListener('click', async ()=>{
  const dateEl = document.getElementById('hist-date');
  const statusEl = document.getElementById('hist-status');
  const qEl = document.getElementById('hist-search');

  const day = dateEl?.value || new Date().toISOString().slice(0,10);
  const status = (statusEl?.value || 'todos').toLowerCase();
  const q = (qEl?.value || '').toLowerCase();

  const all = await getAll('asignaciones');
  const targetDay = new Date(day+'T00:00:00');
  const rows = [];

  for(const a of all){
    if(isSameDay(a.entregadoEn, targetDay)) rows.push({ ev:'Entregado', time:a.entregadoEn, a });
    if(isSameDay(a.devueltoEn, targetDay)) rows.push({ ev:'Retirado', time:a.devueltoEn, a });
  }

  const filtered = rows.filter(r=>{
    if(status==='entregado' && r.ev!=='Entregado') return false;
    if(status==='retirado' && r.ev!=='Retirado') return false;
    return true;
  }).filter(r=>{
    const a = r.a; const s = q;
    const hay = (a.patente||'').toLowerCase().includes(s)
      || (a.sigla||'').toLowerCase().includes(s)
      || (a.tabletImei||'').toLowerCase().includes(s)
      || (a.rut||'').toLowerCase().includes(s)
      || (a.simNumero||'').toLowerCase().includes(s)
      || (a.simIccid||'').toLowerCase().includes(s);
    return q ? hay : true;
  }).sort((x,y)=> y.time.localeCompare(x.time));

  const hdr = ['fechaHora','estado','patente','sigla','tabletImei','red','simNumero','simIccid','rut','observacion'];
  const data = filtered.map(r=>{
    const a = r.a;
    return [r.time, r.ev, a.patente||'', a.sigla||'', a.tabletImei||'', a.red||'', a.simNumero||'', a.simIccid||'', a.rut||'', (a.observacion||'').replace(/\n/g,' ')];
  });
  const csv = [hdr, ...data].map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `historico_${day}_${status}.csv`; a.click();
  URL.revokeObjectURL(url);
});


// CRUD & Eventos
document.addEventListener('click', async (e)=>{
  const imei = e.target?.dataset?.delTablet;
  if(imei){ if(!confirm('Eliminar tablet '+imei+'?')) return; await del('tablets', imei); await renderTablets(); await refreshMasterSelects(); return; }
  const rut = e.target?.dataset?.delConductor;
  if(rut){ if(!confirm('Eliminar conductor '+rut+'?')) return; await del('conductores', rut); await renderConductores(); await refreshMasterSelects(); return; }
  const pat = e.target?.dataset?.delVeh;
  if(pat){ if(!confirm('Eliminar vehículo '+pat+'?')) return; await del('vehiculos', pat); await renderVehiculos(); await refreshMasterSelects(); return; }
  const n = e.target?.dataset?.delSim;
  if(n){ if(!confirm('Eliminar SIM '+n+'?')) return; await del('sims', n); await renderSims(); await refreshMasterSelects(); return; }
});

document.getElementById('btn-add-tablet')?.addEventListener('click', async ()=>{
  const imei = onlyDigits(document.getElementById('tab-imei').value);
  const modelo = document.getElementById('tab-modelo').value.trim();
  const nota = document.getElementById('tab-nota').value.trim();
  if(isEmpty(imei)) return alert('IMEI requerido');
  await put('tablets', { imei, modelo, provisional:true, estado:'disponible', nota });
  if(fs && ff) await ff.setDoc(ff.doc(ff.collection(fs, 'tablets'), imei), { imei, modelo, provisional:true, estado:'disponible', nota }, { merge:true });
  document.getElementById('tab-imei').value=''; document.getElementById('tab-modelo').value=''; document.getElementById('tab-nota').value='';
  await renderTablets(); await refreshMasterSelects();
});

document.getElementById('btn-add-conductor')?.addEventListener('click', async ()=>{
  const rut = document.getElementById('con-rut').value.trim();
  const nombre = document.getElementById('con-nombre').value.trim();
  if(isEmpty(rut) || isEmpty(nombre)) return alert('RUT y Nombre son requeridos');
  await put('conductores', { rut, nombre });
  if(fs && ff) await ff.setDoc(ff.doc(ff.collection(fs, 'conductores'), rut), { rut, nombre }, { merge:true });
  document.getElementById('con-rut').value=''; document.getElementById('con-nombre').value='';
  await renderConductores(); await refreshMasterSelects();
});

document.getElementById('btn-add-veh')?.addEventListener('click', async ()=>{
  const patente = (document.getElementById('veh-patente').value||'').trim().toUpperCase();
  const sigla = (document.getElementById('veh-sigla').value||'').trim();
  if(isEmpty(patente)) return alert('Patente requerida');
  await put('vehiculos', { patente, sigla });
  if(fs && ff) await ff.setDoc(ff.doc(ff.collection(fs, 'vehiculos'), patente), { patente, sigla }, { merge:true });
  document.getElementById('veh-patente').value=''; document.getElementById('veh-sigla').value='';
  await renderVehiculos(); await refreshMasterSelects();
});

document.getElementById('btn-add-sim')?.addEventListener('click', async ()=>{
  const numero = onlyDigits(document.getElementById('sim-numero').value);
  const iccid = onlyDigits(document.getElementById('sim-iccid').value);
  const simImei = onlyDigits(document.getElementById('sim-imei').value);
  if(isEmpty(numero)) return alert('Número SIM requerido');
  await put('sims', { numero, iccid, simImei });
  if(fs && ff) await ff.setDoc(ff.doc(ff.collection(fs, 'sims'), numero), { numero, iccid, simImei }, { merge:true });
  document.getElementById('sim-numero').value=''; document.getElementById('sim-iccid').value=''; document.getElementById('sim-imei').value='';
  await renderSims(); await refreshMasterSelects();
});

document.getElementById('asig-red')?.addEventListener('change', ()=>{
  document.getElementById('sim-block').style.display = (document.getElementById('asig-red').value==='SIM') ? 'grid' : 'none';
});

document.getElementById('btn-crear-asig')?.addEventListener('click', async ()=>{
  const patente = document.getElementById('asig-vehiculo').value;
  const conRut = document.getElementById('asig-conductor').value;
  const tabletImei = onlyDigits(document.getElementById('asig-tablet-imei').value);
  const red = document.getElementById('asig-red').value;
  const obs = document.getElementById('asig-obs').value.trim();
  if(isEmpty(patente) || isEmpty(conRut) || isEmpty(tabletImei)) return alert('Patente, Conductor e IMEI son obligatorios');
  const veh = await get('vehiculos', patente);
  if(!veh) return alert('Vehículo no existe');
  const tab = await get('tablets', tabletImei);
  if(!tab) return alert('Tablet IMEI no está registrada en Maestros');

  const asig = {
    id: uid(), tabletImei, patente, sigla: veh.sigla||'', rut: conRut, red,
    simNumero: red==='SIM'? document.getElementById('asig-sim-numero').value : '',
    simIccid: red==='SIM'? onlyDigits(document.getElementById('asig-sim-iccid').value) : '',
    simImei: red==='SIM'? onlyDigits(document.getElementById('asig-sim-imei').value) : '',
    entregadoEn: nowISO(), devueltoEn: null, estado:'Entregado', observacion: obs, creadoPor: 'local'
  };
  await put('asignaciones', asig);
  await put('tablets', { ...tab, estado:'asignada' });
  if(fs && ff){
    await ff.setDoc(ff.doc(ff.collection(fs, 'asignaciones'), asig.id), asig, { merge:true });
    await ff.setDoc(ff.doc(ff.collection(fs, 'tablets'), tab.imei), { ...tab, estado:'asignada' }, { merge:true });
  }
  document.getElementById('asig-tablet-imei').value=''; document.getElementById('asig-obs').value='';
  await renderAsignaciones(); await renderTablets();
});

document.getElementById('tabla-asignaciones')?.addEventListener('click', async (e)=>{
  const id = e.target?.dataset?.retirar; if(!id) return;
  if(!confirm('Marcar como Retirado?')) return;
  const a = await get('asignaciones', id); if(!a) return;
  a.devueltoEn = nowISO(); a.estado='Retirado';
  await put('asignaciones', a);
  const tab = await get('tablets', a.tabletImei);
  if(tab){ await put('tablets', { ...tab, estado:'disponible' }); await renderTablets(); }
  await renderAsignaciones();
  if(fs && ff){
    await ff.setDoc(ff.doc(ff.collection(fs, 'asignaciones'), a.id), a, { merge:true });
    if(tab) await ff.setDoc(ff.doc(ff.collection(fs, 'tablets'), tab.imei), { ...tab, estado:'disponible' }, { merge:true });
  }
});

document.getElementById('filtro')?.addEventListener('input', renderAsignaciones);
document.getElementById('filtro-tablets')?.addEventListener('input', renderTablets);
document.getElementById('filtro-conductores')?.addEventListener('input', renderConductores);
document.getElementById('filtro-vehiculos')?.addEventListener('input', renderVehiculos);
document.getElementById('filtro-sims')?.addEventListener('input', renderSims);

document.getElementById('btn-export')?.addEventListener('click', async ()=>{
  const all = await getAll('asignaciones');
  const rows = [['id','entregadoEn','devueltoEn','estado','patente','sigla','tabletImei','red','simNumero','simIccid','simImei','rut','observacion']];
  all.sort((a,b)=> (b.entregadoEn||'').localeCompare(a.entregadoEn||''));
  for(const a of all){
    rows.push([a.id,a.entregadoEn,a.devueltoEn||'',a.estado,a.patente||'',a.sigla||'',a.tabletImei||'',a.red||'',a.simNumero||'',a.simIccid||'',a.simImei||'',a.rut||'',(a.observacion||'').replace(/\n/g,' ')]);
  }
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'asignaciones.csv'; a.click();
  URL.revokeObjectURL(url);
});

async function refreshMasterSelects(){
  const vehiculos = await getAll('vehiculos');
  const vehSel = document.getElementById('asig-vehiculo');
  if(vehSel){
    vehSel.innerHTML = '';
    vehiculos.sort((a,b)=> a.sigla.localeCompare(b.sigla))
      .forEach(v=>{
        const opt = document.createElement('option');
        opt.value = v.patente;
        opt.textContent = `${v.sigla} — ${v.patente||''}`.trim();
        vehSel.appendChild(opt);
      });
  }
  // NOTA: conductores y sims se resuelven on-demand con getAll() en el autocompletable
}



(async function init(){
  // DB de la zona actual
  await openDBForZone(currentZone);

  // Render inicial (local)
  await Promise.all([renderTablets(), renderConductores(), renderVehiculos(), renderSims(), renderAsignaciones()]);
  await refreshMasterSelects();

  // Autocomplete (igual que ya lo tienes)…
  const acImei = upgradeToAutocomplete('asig-tablet-imei', 'IMEI (puedes escribir últimos 6)');
  const acCon  = upgradeToAutocomplete('asig-conductor', 'RUT o Nombre');
  const acSim  = upgradeToAutocomplete('asig-sim-numero', 'Número SIM o ICCID');
  acImei?.input.addEventListener('input', async (e)=>{ const q=e.target.value; acImei.setItems(await AC.tablets(q), q); });
  acCon?.input.addEventListener('input',  async (e)=>{ const q=e.target.value; acCon.setItems(await AC.conductores(q), q); });
  acSim?.input.addEventListener('input',  async (e)=>{ const q=e.target.value; acSim.setItems(await AC.sims(q), q); });
  [acImei, acCon, acSim].forEach(ac=>{ if(!ac) return; ac.input.addEventListener('blur', ()=> setTimeout(()=>ac.hide(),150)); });

  // SIM visible según red
  document.getElementById('sim-block').style.display = (document.getElementById('asig-red').value==='SIM') ? 'grid' : 'none';

  // Histórico (por defecto hoy)
  const histDate = document.getElementById('hist-date');
  if(histDate){ histDate.value = new Date().toISOString().slice(0,10); }
  document.getElementById('hist-date')?.addEventListener('change', renderHistorico);
  document.getElementById('hist-status')?.addEventListener('change', renderHistorico);
  document.getElementById('hist-search')?.addEventListener('input', renderHistorico);
  await renderHistorico();

  // Selector de zona
  const zoneSelect = document.getElementById('zone-select');
  if(zoneSelect){
    zoneSelect.value = currentZone;
    zoneSelect.addEventListener('change', e=> switchZone(e.target.value));
  }

  // Firebase + listeners para la zona actual
  if(FORCE_FIREBASE){
    try{
      await enableFirebaseForZone(currentZone);
      startRealtimeSync();
    }catch(e){ console.error('Error activando Firebase:', e); }
  }
})();

