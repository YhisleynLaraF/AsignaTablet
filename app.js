// ==========================
// app.js — lógica con Firebase en duro
// ==========================

let _CONN_STATE = 'offline'; // 'offline' | 'syncing' | 'online'
function setConn(state){
  _CONN_STATE = state;
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if(!dot || !label) return;
  dot.classList.remove('online','offline','syncing');
  dot.classList.add(state);
  label.textContent = state==='online' ? 'Firebase: conectado'
                   : state==='syncing' ? 'Firebase: sincronizando…'
                   : 'Firebase: sin conexión';
  // Habilita/Deshabilita "Guardar asignación" si quieres modo seguro
  const btn = document.getElementById('btn-crear-asig');
  if(btn){ btn.disabled = (state !== 'online'); }
}
// estado inicial
setConn(navigator.onLine ? 'syncing' : 'offline');
window.addEventListener('online',  ()=> setConn('syncing'));
window.addEventListener('offline', ()=> setConn('offline'));


const $ = sel => document.querySelector(sel);
const nowISO = () => new Date().toISOString();
const fmtDate = iso => new Date(iso).toLocaleString();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const isEmpty = v => !v || String(v).trim()==='';
const onlyDigits = v => String(v||'').replace(/\D+/g,'');

(function buildTabs(){
  const sections = [
    { id:'sec-asignar', label:'Asignar' },
    { id:'sec-tablets', label:'Tablets' },
    { id:'sec-conductores', label:'Conductores' },
    { id:'sec-vehiculos', label:'Vehículos' },
    { id:'sec-sims', label:'SIMs' },
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

const DB_NAME = 'asignadorDB';
const DB_VER = 1;
let db;
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
      if(!d.objectStoreNames.contains('outbox')){
        d.createObjectStore('outbox', { keyPath:'id' });
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

async function enqueue(op){ // {collection, key, data}
  const item = { id: uid(), ...op, ts: Date.now() };
  return new Promise((res,rej)=>{
    const r = tx('outbox','readwrite').put(item);
    r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error);
  });
}
async function getAllStore(store){
  return new Promise((res,rej)=>{ const r=tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error) });
}
async function delStore(store,key){
  return new Promise((res,rej)=>{ const r=tx(store,'readwrite').delete(key); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error) });
}

async function flushOutbox(){
  if(!fs || !ff) return;
  const items = await getAllStore('outbox');
  if(!items.length) return;
  setConn('syncing');
  for(const it of items){
    try{
      await ff.setDoc(ff.doc(ff.collection(fs, it.collection), it.key), it.data, { merge:true });
      await delStore('outbox', it.id);
    }catch(e){
      // Si falla el primero, corta; volveremos a intentar cuando haya red
      break;
    }
  }
  // tras intentar, fuerza reevaluar estado
  await new Promise(r=>setTimeout(r, 50));
  setConn(navigator.onLine ? 'syncing' : 'offline');
}

async function upsertRemote(collection, key, data){
  // si estamos online y con Firestore cargado, intentamos directo
  if(fs && ff && navigator.onLine){
    try{
      setConn('syncing');
      await ff.setDoc(ff.doc(ff.collection(fs, collection), key), data, { merge:true });
      setConn('online');
      return;
    }catch(e){
      // cae a outbox
    }
  }
  await enqueue({ collection, key, data });
  setConn('offline');
}
window.addEventListener('online', ()=> flushOutbox());

// Firebase en duro
const FORCE_FIREBASE = true;
const FIREBASE_CONFIG = {
  "apiKey": "AIzaSyBOoHRADT4yOCpytPvcyHcaWSB1pT2ZB8I",
 "authDomain": "asignadortablet.firebaseapp.com",
  "projectId": "asignadortablet",
  "storageBucket": "asignadortablet.firebasestorage.app",
  "messagingSenderId": "261128444351",
  "appId": "1:261128444351:web:996b8a3171da8d20f6e90a"
};
let fbApp = null, auth = null, fs = null, ff = null;

async function enableFirebaseHardcoded(){
  if(!FORCE_FIREBASE) return;
  const appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  ff = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

  fbApp = appMod.initializeApp(FIREBASE_CONFIG);
  auth = authMod.getAuth(fbApp);
  fs = ff.getFirestore(fbApp);

  await authMod.setPersistence(auth, authMod.browserLocalPersistence);
  if(!auth.currentUser) await authMod.signInAnonymously(auth);

  ff.enableIndexedDbPersistence(fs).catch(()=>{});
  window.addEventListener('online', ()=> ff.enableNetwork(fs));
  window.addEventListener('offline', ()=> ff.disableNetwork(fs));

  const st = document.getElementById('firebase-status');
  if(st) st.textContent = 'Firestore activo (config en código)';
}

let healthUnsub = null;
async function watchFirebaseConnectivity(){
  if(!fs || !ff) return;
  // Doc pequeño para “ping” (asegúrate de tener reglas que permitan leer/escribir a usuarios autenticados)
  const healthRef = ff.doc(ff.collection(fs, '_meta'), 'health');
  try { await ff.setDoc(healthRef, { ping: Date.now() }, { merge:true }); } catch(e){ /* ignora */ }

  // includeMetadataChanges => podemos ver fromCache/hasPendingWrites
  healthUnsub = ff.onSnapshot(healthRef, { includeMetadataChanges:true }, (snap)=>{
    if(!snap){ setConn(navigator.onLine ? 'syncing' : 'offline'); return; }
    if(snap.metadata.hasPendingWrites){ setConn('syncing'); return; }
    // fromCache === true => sin respuesta del servidor (offline o red bloqueada)
    const online = !snap.metadata.fromCache;
    setConn(online ? 'online' : (navigator.onLine ? 'syncing' : 'offline'));
  });
}

async function startRealtimeSync(){
  if(!fs || !ff) return;
  const upsert = async (store, keyField, doc) => {
    const current = await get(store, doc[keyField]);
    await put(store, { ...(current||{}), ...doc });
  };
  ff.onSnapshot(ff.collection(fs, 'vehiculos'), snap => snap.docChanges().forEach(async ch => {
    if(ch.type!=='removed') await upsert('vehiculos','patente', ch.doc.data());
  }));
  ff.onSnapshot(ff.collection(fs, 'conductores'), snap => snap.docChanges().forEach(async ch => {
    if(ch.type!=='removed') await upsert('conductores','rut', ch.doc.data());
  }));
  ff.onSnapshot(ff.collection(fs, 'sims'), snap => snap.docChanges().forEach(async ch => {
    if(ch.type!=='removed') await upsert('sims','numero', ch.doc.data());
  }));
  ff.onSnapshot(ff.collection(fs, 'tablets'), snap => snap.docChanges().forEach(async ch => {
    if(ch.type!=='removed') await upsert('tablets','imei', ch.doc.data());
  }));
  ff.onSnapshot(ff.collection(fs, 'asignaciones'), snap => snap.docChanges().forEach(async ch => {
    if(ch.type!=='removed'){ await put('asignaciones', ch.doc.data()); renderAsignaciones(); }
  }));
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
        <td>${a.patente||''}</td>
        <td>${a.sigla||''}</td>
        <td>${a.tabletImei||''}</td>
        <td>${pill}</td>
        <td style="white-space:pre-line">${simTxt}</td>
        <td>${a.rut||''}</td>
        <td>${estado}</td>
        <td>${a.observacion||''}</td>
        <td><button class="btn" data-retirar="${a.id}">Retirar</button></td>
      </tr>
    `;
  }).join('');
}

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
  //if(fs && ff) await ff.setDoc(ff.doc(ff.collection(fs, 'tablets'), imei), { imei, modelo, provisional:true, estado:'disponible', nota }, { merge:true });
  await upsertRemote('tablets', tab.imei, { ...tab, estado:'disponible' });
  document.getElementById('tab-imei').value=''; document.getElementById('tab-modelo').value=''; document.getElementById('tab-nota').value='';
  await renderTablets(); await refreshMasterSelects();
});

document.getElementById('btn-add-conductor')?.addEventListener('click', async ()=>{
  const rut = document.getElementById('con-rut').value.trim();
  const nombre = document.getElementById('con-nombre').value.trim();
  if(isEmpty(rut) || isEmpty(nombre)) return alert('RUT y Nombre son requeridos');
  await put('conductores', { rut, nombre });
  //if(fs && ff) await ff.setDoc(ff.doc(ff.collection(fs, 'conductores'), rut), { rut, nombre }, { merge:true });
  await upsertRemote('conductores', rut, { rut, nombre });
  document.getElementById('con-rut').value=''; document.getElementById('con-nombre').value='';
  await renderConductores(); await refreshMasterSelects();
});

document.getElementById('btn-add-veh')?.addEventListener('click', async ()=>{
  const patente = (document.getElementById('veh-patente').value||'').trim().toUpperCase();
  const sigla = (document.getElementById('veh-sigla').value||'').trim();
  if(isEmpty(patente)) return alert('Patente requerida');
  await put('vehiculos', { patente, sigla });
  //if(fs && ff) await ff.setDoc(ff.doc(ff.collection(fs, 'vehiculos'), patente), { patente, sigla }, { merge:true });
  await upsertRemote('vehiculos', patente, { patente, sigla });
  document.getElementById('veh-patente').value=''; document.getElementById('veh-sigla').value='';
  await renderVehiculos(); await refreshMasterSelects();
});

document.getElementById('btn-add-sim')?.addEventListener('click', async ()=>{
  const numero = onlyDigits(document.getElementById('sim-numero').value);
  const iccid = onlyDigits(document.getElementById('sim-iccid').value);
  const simImei = onlyDigits(document.getElementById('sim-imei').value);
  if(isEmpty(numero)) return alert('Número SIM requerido');
  await put('sims', { numero, iccid, simImei });
  //if(fs && ff) await ff.setDoc(ff.doc(ff.collection(fs, 'sims'), numero), { numero, iccid, simImei }, { merge:true });
  await upsertRemote('sims', numero, { numero, iccid, simImei });
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
  await upsertRemote('asignaciones', asig.id, asig);
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
  const [vehiculos, conductores, sims] = await Promise.all([
    getAll('vehiculos'), getAll('conductores'), getAll('sims')
  ]);
  const vehSel = document.getElementById('asig-vehiculo'); vehSel.innerHTML='';
  vehiculos.sort((a,b)=>a.patente.localeCompare(b.patente)).forEach(v=>{
    const opt = document.createElement('option'); opt.value = v.patente; opt.textContent = `${v.patente} — ${v.sigla||''}`.trim(); vehSel.appendChild(opt);
  });
  const conSel = document.getElementById('asig-conductor'); conSel.innerHTML='';
  conductores.sort((a,b)=>a.rut.localeCompare(b.rut)).forEach(c=>{
    const opt = document.createElement('option'); opt.value = c.rut; opt.textContent = `${c.rut} — ${c.nombre}`; conSel.appendChild(opt);
  });
  const simSel = document.getElementById('asig-sim-numero'); simSel.innerHTML='';
  sims.sort((a,b)=> (a.numero||'').localeCompare(b.numero||'')).forEach(s=>{
    const opt = document.createElement('option'); opt.value = s.numero; opt.textContent = `${s.numero} (${s.iccid||'sin ICCID'})`; simSel.appendChild(opt);
  });
}

(async function init(){
  await openDB();
  await Promise.all([renderTablets(), renderConductores(), renderVehiculos(), renderSims(), renderAsignaciones()]);
  await refreshMasterSelects();
  document.getElementById('sim-block').style.display = (document.getElementById('asig-red').value==='SIM') ? 'grid' : 'none';

  if(FORCE_FIREBASE){
    try{
      await enableFirebaseHardcoded();
      await startRealtimeSync();
      await watchFirebaseConnectivity();
      await flushOutbox();
    }catch(e){
      console.error('Error activando Firebase:', e);
    }
  }
})();
