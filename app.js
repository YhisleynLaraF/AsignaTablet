// ==========================
// app.js — lógica de la app
// ==========================

// ---------- Utilidades ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const nowISO = () => new Date().toISOString();
const fmtDate = iso => new Date(iso).toLocaleString();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Validaciones simples
const isEmpty = v => !v || String(v).trim()==='';
const onlyDigits = v => String(v||'').replace(/\D+/g,'');

// ---------- Construir Tabs ----------
function buildTabs(){
  const sections = [
    { id:'sec-asignar', label:'Asignar' },
    { id:'sec-tablets', label:'Tablets' },
    { id:'sec-conductores', label:'Conductores' },
    { id:'sec-vehiculos', label:'Vehículos' },
    { id:'sec-sims', label:'SIMs' },
    { id:'sec-ajustes', label:'Ajustes' },
  ];
  const tabsEl = $('#tabs');
  tabsEl.innerHTML='';
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
}

// ---------- IndexedDB (local-first) ----------
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
      if(!d.objectStoreNames.contains('conductores')){
        d.createObjectStore('conductores', { keyPath:'rut' });
      }
      if(!d.objectStoreNames.contains('vehiculos')){
        d.createObjectStore('vehiculos', { keyPath:'patente' });
      }
      if(!d.objectStoreNames.contains('sims')){
        d.createObjectStore('sims', { keyPath:'numero' });
      }
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

// ---------- (Opcional) Firestore Sync ----------
let USE_FIREBASE = false; // cambia a true tras activar
let firebaseCfg = null;
let fb = null, auth=null, fs=null;

async function tryEnableFirebase(){
  try{
    const cfgRaw = localStorage.getItem('firebaseConfig');
    if(!cfgRaw){ $('#firebase-status').textContent='Sin configuración'; return; }
    firebaseCfg = JSON.parse(cfgRaw);
    // Carga SDK desde CDN solo si hace falta
    const appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    fb = appMod.initializeApp(firebaseCfg);
    auth = authMod.getAuth(fb);
    fs = fsMod.getFirestore(fb);
    await fsMod.enableIndexedDbPersistence(fs).catch(()=>{});

    // Login anónimo por simplicidad
    await authMod.signInAnonymously(auth);

    USE_FIREBASE = true;
    $('#firebase-status').textContent='Firestore activo (login anónimo)';
  }catch(e){
    console.error(e);
    $('#firebase-status').textContent='Error activando Firestore';
    USE_FIREBASE = false;
  }
}

// Helper para sincronizar una escritura local hacia Firestore (demo)
async function syncWrite(collection, key, data){
  if(!USE_FIREBASE) return;
  const { doc, setDoc, collection: coll } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  await setDoc(doc(coll(fs, collection), key), data, { merge:true });
}

// ---------- UI POBLADO SELECTS ----------
async function refreshMasterSelects(){
  const [vehiculos, conductores, sims] = await Promise.all([
    getAll('vehiculos'), getAll('conductores'), getAll('sims')
  ]);
  const vehSel = $('#asig-vehiculo'); vehSel.innerHTML='';
  vehiculos.sort((a,b)=>a.patente.localeCompare(b.patente)).forEach(v=>{
    const opt = document.createElement('option');
    opt.value = v.patente; opt.textContent = `${v.patente} — ${v.sigla||''}`.trim();
    vehSel.appendChild(opt);
  });
  const conSel = $('#asig-conductor'); conSel.innerHTML='';
  conductores.sort((a,b)=>a.rut.localeCompare(b.rut)).forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c.rut; opt.textContent = `${c.rut} — ${c.nombre}`;
    conSel.appendChild(opt);
  });
  const simSel = $('#asig-sim-numero'); simSel.innerHTML='';
  sims.sort((a,b)=> (a.numero||'').localeCompare(b.numero||'')).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s.numero; opt.textContent = `${s.numero} (${s.iccid||'sin ICCID'})`;
    simSel.appendChild(opt);
  });
}

// ---------- RENDER TABLAS ----------
async function renderTablets(){
  const tbody = $('#tabla-tablets tbody');
  const q = ($('#filtro-tablets').value||'').toLowerCase();
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
  const tbody = $('#tabla-conductores tbody');
  const q = ($('#filtro-conductores').value||'').toLowerCase();
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
  const tbody = $('#tabla-vehiculos tbody');
  const q = ($('#filtro-vehiculos').value||'').toLowerCase();
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
  const tbody = $('#tabla-sims tbody');
  const q = ($('#filtro-sims').value||'').toLowerCase();
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
  const tbody = $('#tabla-asignaciones tbody');
  const q = ($('#filtro').value||'').toLowerCase();
  const items = (await getAll('asignaciones')).filter(a=> !a.devueltoEn ); // activas
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
        <td>
          <button class="btn" data-retirar="${a.id}">Retirar</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------- Eventos: CRUD maestros ----------
document.addEventListener('click', async (e)=>{
  // Deletes delegados
  const imei = e.target?.dataset?.delTablet;
  if(imei){
    if(!confirm('Eliminar tablet '+imei+'?')) return;
    await del('tablets', imei); await renderTablets(); await refreshMasterSelects();
    return;
  }
  const rut = e.target?.dataset?.delConductor;
  if(rut){
    if(!confirm('Eliminar conductor '+rut+'?')) return;
    await del('conductores', rut); await renderConductores(); await refreshMasterSelects();
    return;
  }
  const pat = e.target?.dataset?.delVeh;
  if(pat){
    if(!confirm('Eliminar vehículo '+pat+'?')) return;
    await del('vehiculos', pat); await renderVehiculos(); await refreshMasterSelects();
    return;
  }
  const n = e.target?.dataset?.delSim;
  if(n){
    if(!confirm('Eliminar SIM '+n+'?')) return;
    await del('sims', n); await renderSims(); await refreshMasterSelects();
    return;
  }
});

$('#btn-add-tablet')?.addEventListener('click', async ()=>{
  const imei = onlyDigits($('#tab-imei').value);
  const modelo = $('#tab-modelo').value.trim();
  const nota = $('#tab-nota').value.trim();
  if(isEmpty(imei)) return alert('IMEI requerido');
  await put('tablets', { imei, modelo, provisional:true, estado:'disponible', nota });
  await syncWrite('tablets', imei, { imei, modelo, provisional:true, estado:'disponible', nota });
  $('#tab-imei').value=''; $('#tab-modelo').value=''; $('#tab-nota').value='';
  await renderTablets(); await refreshMasterSelects();
});

$('#btn-add-conductor')?.addEventListener('click', async ()=>{
  const rut = $('#con-rut').value.trim();
  const nombre = $('#con-nombre').value.trim();
  if(isEmpty(rut) || isEmpty(nombre)) return alert('RUT y Nombre son requeridos');
  await put('conductores', { rut, nombre });
  await syncWrite('conductores', rut, { rut, nombre });
  $('#con-rut').value=''; $('#con-nombre').value='';
  await renderConductores(); await refreshMasterSelects();
});

$('#btn-add-veh')?.addEventListener('click', async ()=>{
  const patente = ($('#veh-patente').value||'').trim().toUpperCase();
  const sigla = ($('#veh-sigla').value||'').trim();
  if(isEmpty(patente)) return alert('Patente requerida');
  await put('vehiculos', { patente, sigla });
  await syncWrite('vehiculos', patente, { patente, sigla });
  $('#veh-patente').value=''; $('#veh-sigla').value='';
  await renderVehiculos(); await refreshMasterSelects();
});

$('#btn-add-sim')?.addEventListener('click', async ()=>{
  const numero = onlyDigits($('#sim-numero').value);
  const iccid = onlyDigits($('#sim-iccid').value);
  const simImei = onlyDigits($('#sim-imei').value);
  if(isEmpty(numero)) return alert('Número SIM requerido');
  await put('sims', { numero, iccid, simImei });
  await syncWrite('sims', numero, { numero, iccid, simImei });
  $('#sim-numero').value=''; $('#sim-iccid').value=''; $('#sim-imei').value='';
  await renderSims(); await refreshMasterSelects();
});

// ---------- Crear/retirar asignación ----------
$('#asig-red')?.addEventListener('change', ()=>{
  $('#sim-block').style.display = ($('#asig-red').value==='SIM') ? 'grid' : 'none';
});

$('#btn-crear-asig')?.addEventListener('click', async ()=>{
  const patente = $('#asig-vehiculo').value;
  const conRut = $('#asig-conductor').value;
  const tabletImei = onlyDigits($('#asig-tablet-imei').value);
  const red = $('#asig-red').value;
  const obs = $('#asig-obs').value.trim();
  if(isEmpty(patente) || isEmpty(conRut) || isEmpty(tabletImei)) return alert('Patente, Conductor e IMEI son obligatorios');
  const veh = await get('vehiculos', patente);
  if(!veh) return alert('Vehículo no existe');
  const tab = await get('tablets', tabletImei);
  if(!tab) return alert('Tablet IMEI no está registrada en Maestros');

  const asig = {
    id: uid(), tabletImei, patente, sigla: veh.sigla||'', rut: conRut, red,
    simNumero: red==='SIM'? $('#asig-sim-numero').value : '',
    simIccid: red==='SIM'? onlyDigits($('#asig-sim-iccid').value) : '',
    simImei: red==='SIM'? onlyDigits($('#asig-sim-imei').value) : '',
    entregadoEn: nowISO(), devueltoEn: null, estado:'Entregado', observacion: obs, creadoPor: 'local'
  };
  await put('asignaciones', asig);
  await put('tablets', { ...tab, estado:'asignada' });
  await syncWrite('asignaciones', asig.id, asig);
  await syncWrite('tablets', tab.imei, { ...tab, estado:'asignada' });

  // limpiar
  $('#asig-tablet-imei').value=''; $('#asig-obs').value='';
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
  await syncWrite('asignaciones', a.id, a);
  if(tab) await syncWrite('tablets', tab.imei, { ...tab, estado:'disponible' });
});

// ---------- Filtros y export ----------
$('#filtro')?.addEventListener('input', renderAsignaciones);
$('#filtro-tablets')?.addEventListener('input', renderTablets);
$('#filtro-conductores')?.addEventListener('input', renderConductores);
$('#filtro-vehiculos')?.addEventListener('input', renderVehiculos);
$('#filtro-sims')?.addEventListener('input', renderSims);

document.getElementById('btn-export')?.addEventListener('click', async ()=>{
  const all = await getAll('asignaciones');
  const rows = [
    ['id','entregadoEn','devueltoEn','estado','patente','sigla','tabletImei','red','simNumero','simIccid','simImei','rut','observacion']
  ];
  all.sort((a,b)=> (b.entregadoEn||'').localeCompare(a.entregadoEn||''));
  for(const a of all){
    rows.push([
      a.id,a.entregadoEn,a.devueltoEn||'',a.estado,a.patente||'',a.sigla||'',a.tabletImei||'',a.red||'',a.simNumero||'',a.simIccid||'',a.simImei||'',a.rut||'',(a.observacion||'').replace(/\n/g,' ')
    ]);
  }
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'asignaciones.csv'; a.click();
  URL.revokeObjectURL(url);
});

// ---------- Escáner (opcional con https) ----------
async function scanOnce(){
  try{
    // Carga ZXing dinámicamente
    const { BrowserMultiFormatReader } = await import('https://unpkg.com/@zxing/library@0.20.0/esm/index.js');
    const codeReader = new BrowserMultiFormatReader();
    const devices = await codeReader.listVideoInputDevices();
    const deviceId = devices?.[0]?.deviceId;
    const result = await codeReader.decodeOnceFromVideoDevice(deviceId, 'video-preview');
    codeReader.reset();
    return result?.text || '';
  }catch(e){
    alert('Escáner no disponible (requiere https/permiso de cámara).');
    return '';
  }
}

function ensurePreview(){
  if(document.getElementById('video-preview')) return;
  const v = document.createElement('video');
  v.id='video-preview'; v.setAttribute('playsinline',''); v.style.width='1px'; v.style.height='1px'; v.style.opacity='0';
  document.body.appendChild(v);
}

document.getElementById('scan-tablet')?.addEventListener('click', async ()=>{
  ensurePreview(); const t = await scanOnce(); if(t) $('#asig-tablet-imei').value = onlyDigits(t);
});
document.getElementById('scan-sim')?.addEventListener('click', async ()=>{
  ensurePreview(); const t = await scanOnce(); if(t) $('#asig-sim-iccid').value = onlyDigits(t);
});
document.getElementById('scan-tab-master')?.addEventListener('click', async ()=>{
  ensurePreview(); const t = await scanOnce(); if(t) $('#tab-imei').value = onlyDigits(t);
});
document.getElementById('scan-sim-master')?.addEventListener('click', async ()=>{
  ensurePreview(); const t = await scanOnce(); if(t) $('#sim-iccid').value = onlyDigits(t);
});

// ---------- Ajustes Firebase ----------
document.getElementById('btn-guardar-config')?.addEventListener('click', ()=>{
  const txt = $('#firebase-config').value.trim();
  try{ JSON.parse(txt); localStorage.setItem('firebaseConfig', txt); alert('Config guardada'); }
  catch{ alert('JSON inválido'); }
});
document.getElementById('btn-activar-firebase')?.addEventListener('click', ()=>{ tryEnableFirebase(); });

// ---------- Init ----------
(async function init(){
  buildTabs();
  await openDB();
  await Promise.all([renderTablets(), renderConductores(), renderVehiculos(), renderSims(), renderAsignaciones()]);
  await refreshMasterSelects();
  $('#sim-block').style.display = ($('#asig-red').value==='SIM') ? 'grid' : 'none';
  if(localStorage.getItem('firebaseConfig')) $('#firebase-status').textContent='Config presente (no activo)';
})();
