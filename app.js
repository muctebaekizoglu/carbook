/* Carbook: intentionally dependency-free. Records stay in this browser. */
(() => {
  'use strict';
  const STORAGE_KEY = 'carbook.records.v2';
  const SELECTED_KEY = 'carbook.selected.v2';
  const DEFAULT_ZIP = '73013';
  const $ = id => document.getElementById(id);
  const formatMoney = n => n === null || n === undefined || !Number.isFinite(n)
    ? '—' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:2,minimumFractionDigits: n % 1 ? 2 : 0}).format(n);
  const digits = n => new Intl.NumberFormat('en-US').format(n);
  const toAmount = s => { const n = Number(s); return s === '' || s === null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100; };
  const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
  const cleanStr = (value, limit=100) => String(value ?? '').trim().slice(0,limit);

  function sanitizeCar(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: cleanStr(raw.id,100) || newId(),
      vin: cleanStr(raw.vin,17).toUpperCase(),
      year: Number.isInteger(Number(raw.year)) && Number(raw.year) >= 1900 && Number(raw.year) <= 2100 ? String(raw.year) : '',
      make: cleanStr(raw.make,50), model: cleanStr(raw.model,70), trim: cleanStr(raw.trim,70),
      mileage: raw.mileage === '' || raw.mileage === null || raw.mileage === undefined ? '' : String(Math.max(0,Math.min(9999999, Math.floor(Number(raw.mileage)||0)))),
      estimatedValue: toAmount(raw.estimatedValue === null || raw.estimatedValue === undefined ? '' : raw.estimatedValue),
      estimatedUpdatedAt: cleanStr(raw.estimatedUpdatedAt,64),
      soldPrice: toAmount(raw.soldPrice === null || raw.soldPrice === undefined ? '' : raw.soldPrice),
      expenses: Array.isArray(raw.expenses) ? raw.expenses.slice(0,10000).map(exp => ({
        id: cleanStr(exp?.id,100) || newId(),
        description: cleanStr(exp?.description,100), amount: toAmount(exp?.amount) ?? 0
      })) : []
    };
  }
  function loadCars() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(0,200).map(sanitizeCar).filter(Boolean) : [];
    } catch (_) { return []; }
  }
  let cars = loadCars();
  let selectedId = null;
  try { selectedId = localStorage.getItem(SELECTED_KEY) || cars[0]?.id || null; } catch (_) { selectedId = cars[0]?.id || null; }
  if (!cars.some(c => c.id === selectedId)) selectedId = cars[0]?.id || null;
  let editingId = null, decodeTimer, decodeRequest = 0, toastTimer;
  const car = () => cars.find(c => c.id === selectedId) || null;
  const invested = c => c.expenses.reduce((sum, ex) => sum + (toAmount(ex.amount) || 0), 0);
  const name = c => [c.year,c.make,c.model].filter(Boolean).join(' ') || (c.vin ? `VIN ${c.vin.slice(-6)}` : 'Untitled vehicle');

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cars));
      if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId); else localStorage.removeItem(SELECTED_KEY);
    } catch (_) { document.querySelector('.private-note').textContent = 'Storage unavailable — export a backup'; }
  }
  function notify(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function nav() {
    const list = $('vehicle-list'); list.replaceChildren();
    cars.forEach(c => {
      const button = document.createElement('button'); button.type='button';
      button.className = 'nav-vehicle' + (c.id === selectedId ? ' active' : '');
      button.setAttribute('aria-current', c.id === selectedId ? 'page' : 'false');
      const labels = document.createElement('span');
      const title = document.createElement('span'); title.className='nav-name'; title.textContent=name(c);
      const note = document.createElement('span'); note.className='nav-note'; note.textContent=c.soldPrice === null ? 'Owned' : 'Sold';
      const chevron = document.createElement('span'); chevron.className='nav-chevron'; chevron.setAttribute('aria-hidden','true'); chevron.textContent='›';
      labels.append(title,note); button.append(labels,chevron);
      button.addEventListener('click', () => {selectedId=c.id;save();render();}); list.append(button);
    });
  }
  function render() {
    nav(); const c=car();
    $('vehicle-view').hidden=!c; $('empty-state').hidden=!!c;
    $('breadcrumb').textContent=c ? 'Vehicles  /  ' + name(c) : 'Vehicles';
    if (!c) return;
    $('vehicle-year').textContent=c.soldPrice !== null ? 'SOLD' : 'IN YOUR GARAGE';
    $('vehicle-title').textContent=name(c) + (c.trim ? ' ' + c.trim : '');
    $('vehicle-vin').textContent=c.vin || 'No VIN added';
    $('vehicle-mileage').textContent=c.mileage !== '' ? digits(Number(c.mileage)) + ' mi' : 'Mileage not set';
    $('estimated-value').value=c.estimatedValue ?? '';
    $('sold-price').value=c.soldPrice ?? '';
    updateValueCaption();
    renderExpenses();updateTotals();
  }
  function updateValueCaption() {
    const c=car(); if (!c) return;
    const d=c.estimatedUpdatedAt ? new Date(c.estimatedUpdatedAt) : null;
    $('value-description').textContent=c.estimatedValue !== null && d && !Number.isNaN(d.getTime())
      ? `Manually entered · Updated ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(d)}`
      : 'Enter your latest vehicle estimate.';
  }
  function updateTotals() {
    const c=car(); if (!c) return;
    const total=invested(c); const sold=c.soldPrice !== null;
    const worth=sold ? c.soldPrice : c.estimatedValue;
    const profit=worth === null ? null : Math.round((worth-total)*100)/100;
    $('metric-invested').textContent=formatMoney(total);
    $('metric-invested-sub').textContent=`${c.expenses.length} recorded ${c.expenses.length === 1 ? 'cost' : 'costs'}`;
    $('metric-value-label').textContent=sold ? 'Sold for' : 'Estimated value';
    $('metric-market').textContent=formatMoney(worth);
    $('metric-profit-label').textContent=sold ? 'Actual profit' : 'Potential profit';
    $('metric-profit').textContent=formatMoney(profit);
    $('metric-profit').className='metric-value'+(profit !== null ? (profit >= 0 ? ' positive' : ' negative') : '');
    $('metric-profit-sub').textContent=profit === null ? 'Add a value to calculate' : sold ? 'Based on recorded costs' : 'If sold at this estimate';
    $('result-title').textContent=sold ? 'Actual profit' : 'Potential profit';
    $('result-amount').textContent=formatMoney(profit);
    $('result-amount').className=profit !== null ? profit >= 0 ? 'positive':'negative' : '';
    $('result-hint').textContent=sold ? 'Sale price minus total invested' : 'Estimated value minus total invested';
    $('expense-total').textContent=formatMoney(total);
  }
  function renderExpenses() {
    const c=car(); if (!c) return;
    const list=$('expense-list'); list.replaceChildren();
    $('expense-count').textContent=`${c.expenses.length} ${c.expenses.length===1?'entry':'entries'}`;
    if (!c.expenses.length) {
      const empty=document.createElement('div');empty.className='expense-empty';empty.textContent='No expenses yet. Add your first cost below.';list.append(empty);return;
    }
    c.expenses.forEach(exp => {
      const line=document.createElement('div');line.className='expense-line';
      const description=document.createElement('input');description.type='text';description.value=exp.description;description.maxLength=100;description.setAttribute('aria-label','Expense description');
      description.addEventListener('input',()=>{exp.description=description.value;save();});
      const amount=document.createElement('input');amount.type='number';amount.inputMode='decimal';amount.step='0.01';amount.min='0';amount.max='100000000';amount.className='line-amount';amount.value=exp.amount;amount.setAttribute('aria-label','Expense amount');
      amount.addEventListener('input',()=>{const n=toAmount(amount.value);if(n!==null){exp.amount=n;save();updateTotals();}});
      amount.addEventListener('blur',()=>{amount.value=exp.amount;});
      const remove=document.createElement('button');remove.type='button';remove.className='remove-expense';remove.textContent='×';remove.title=`Remove ${exp.description||'expense'}`;remove.setAttribute('aria-label',remove.title);
      remove.addEventListener('click',()=>{c.expenses=c.expenses.filter(e=>e.id!==exp.id);save();renderExpenses();updateTotals();});
      line.append(description,amount,remove);list.append(line);
    });
  }
  $('add-expense-form').addEventListener('submit',event=>{
    event.preventDefault();const c=car(); if(!c) return;
    const description=cleanStr($('expense-description').value);const amount=toAmount($('expense-amount').value);
    if(!description||amount===null) return;
    c.expenses.push({id:newId(),description,amount});save();renderExpenses();updateTotals();
    $('expense-description').value='';$('expense-amount').value='';$('expense-description').focus();
  });
  $('estimated-value').addEventListener('input',event=>{
    const c=car();if(!c)return;
    c.estimatedValue=toAmount(event.target.value);
    c.estimatedUpdatedAt=c.estimatedValue === null ? '' : new Date().toISOString();
    save();updateTotals();updateValueCaption();
  });
  $('sold-price').addEventListener('input',event=>{
    const c=car();if(!c)return;c.soldPrice=toAmount(event.target.value);save();updateTotals();nav();
    $('vehicle-year').textContent=c.soldPrice === null ? 'IN YOUR GARAGE' : 'SOLD';
  });
  $('check-carfax').addEventListener('click',async()=>{
    const c=car();if(!c)return;
    window.open('https://www.carfax.com/value/','_blank','noopener,noreferrer');
    if(!c.vin){notify('Add a VIN in Edit details to look up your car.');return;}
    try{await navigator.clipboard.writeText(c.vin);notify(`VIN copied — paste it on CARFAX, with ZIP ${DEFAULT_ZIP}.`);}
    catch(_){notify(`Enter VIN ${c.vin} and ZIP ${DEFAULT_ZIP} on CARFAX.`);}
  });

  function setVinMessage(text,kind=''){$('vin-message').textContent=text;$('vin-message').className='help-text'+(kind?' '+kind:'');}
  async function decodeVin(value) {
    const token=++decodeRequest;
    if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) {
      if(value.length===17)setVinMessage('VIN contains an invalid character.','error');
      else setVinMessage('Enter a VIN to automatically fill the vehicle details.');
      return false;
    }
    setVinMessage('Finding vehicle details…');
    try {
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
      let response;
      try{response=await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(value)}?format=json`,{signal:controller.signal});}
      finally{clearTimeout(timer);}
      if(token!==decodeRequest || $('vehicle-dialog').open===false || $('form-vin').value!==value) return false;
      if(!response.ok)throw Error('Lookup unavailable');
      const data=await response.json();const decoded=data.Results?.[0];
      if(!decoded || !decoded.Make || !decoded.Model)throw Error('No match');
      const values={year:decoded.ModelYear,make:decoded.Make,model:decoded.Model,trim:decoded.Trim};
      for(const [key,val] of Object.entries(values)) {if(val && !$("form-"+key).value)$("form-"+key).value=val;}
      setVinMessage('Vehicle details found using NHTSA VIN data.','success');return true;
    } catch(_) {if(token===decodeRequest)setVinMessage('VIN lookup unavailable. You can enter the details manually.','error');return false;}
  }
  $('form-vin').addEventListener('input',event=>{
    event.target.value=event.target.value.toUpperCase().replace(/\s/g,'');
    clearTimeout(decodeTimer);decodeRequest++;
    const vin=event.target.value;
    if(vin.length===17) decodeTimer=setTimeout(()=>decodeVin(vin),450);
    else setVinMessage(vin.length ? `${vin.length}/17 characters` : 'Enter a VIN to automatically fill the vehicle details.');
  });
  function openForm(id=null) {
    editingId=id;const c=cars.find(item=>item.id===id);
    $('dialog-title').textContent=c?'Edit vehicle':'Add a vehicle';
    $('save-vehicle').textContent=c?'Save changes':'Add vehicle';
    $('delete-vehicle').hidden=!c;$('form-error').hidden=true;
    for(const key of ['vin','year','make','model','trim','mileage'])$('form-'+key).value=c?.[key]??'';
    setVinMessage(c?.vin?'You can update the VIN or vehicle details.':'Enter a VIN to automatically fill the vehicle details.');
    $('vehicle-dialog').showModal();
    setTimeout(()=>$(c?.vin?'form-make':'form-vin').focus(),20);
  }
  function closeForm(){clearTimeout(decodeTimer);decodeRequest++;$('vehicle-dialog').close();editingId=null;}
  $('add-vehicle').addEventListener('click',()=>openForm());
  $('empty-add').addEventListener('click',()=>openForm());
  $('edit-vehicle').addEventListener('click',()=>openForm(selectedId));
  $('close-dialog').addEventListener('click',closeForm);
  $('cancel-dialog').addEventListener('click',closeForm);
  $('vehicle-dialog').addEventListener('cancel',event=>{event.preventDefault();closeForm();});
  $('vehicle-dialog').addEventListener('click',event=>{if(event.target===$('vehicle-dialog'))closeForm();});
  $('vehicle-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const values=Object.fromEntries(['vin','year','make','model','trim','mileage'].map(key=>[key,cleanStr($('form-'+key).value,key==='vin'?17:90)]));
    values.vin=values.vin.toUpperCase();
    const error=message=>{$('form-error').hidden=false;$('form-error').textContent=message;};
    $('form-error').hidden=true;
    if(values.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(values.vin))return error('Please enter a valid 17-character VIN, or leave the VIN blank.');
    if(!values.vin && !(values.make && values.model))return error('Enter a VIN, or at least a make and model.');
    if(values.year && (!/^(19|20)\d\d$/.test(values.year) || +values.year>2100))return error('Enter a valid model year.');
    const existing=cars.find(c=>c.id===editingId);
    if(existing)Object.assign(existing,values);
    else{const created=sanitizeCar({id:newId(),...values,expenses:[],estimatedValue:null,soldPrice:null});cars.push(created);selectedId=created.id;}
    save();closeForm();render();
    notify(existing?'Vehicle updated.':'Vehicle added.');
  });
  $('delete-vehicle').addEventListener('click',()=>{
    const c=cars.find(v=>v.id===editingId);if(!c)return;
    if(!confirm(`Delete ${name(c)} and all its expenses? This cannot be undone.`))return;
    cars=cars.filter(v=>v.id!==c.id);selectedId=cars[0]?.id||null;save();closeForm();render();notify('Vehicle deleted.');
  });
  $('export-data').addEventListener('click',()=>{
    const data={app:'carbook',version:2,exportedAt:new Date().toISOString(),vehicles:cars};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='carbook-backup.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Backup exported.');
  });
  $('import-data').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async(event)=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try{
      if(file.size>5_000_000)throw Error('Backup file is too large.');
      const json=JSON.parse(await file.text());
      if(json.app!=='carbook'||!Array.isArray(json.vehicles))throw Error('Not a Carbook backup.');
      const restored=json.vehicles.slice(0,200).map(sanitizeCar).filter(Boolean);
      if(!confirm('Importing replaces all vehicles currently saved in this browser. Continue?'))return;
      cars=restored;selectedId=cars[0]?.id||null;save();render();notify('Backup imported.');
    }catch(e){notify(e.message||'Could not import backup.');}
  });
  render();
})();
