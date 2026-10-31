/* Buildless Carbook. The only external library is the pinned Supabase SDK. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const {amount, totals} = window.CarbookFinance;
  const money = value => value === null ? '—' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
  const config = window.CARBOOK_CONFIG || {};
  const configured = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(config.supabaseUrl || '') && !!config.supabasePublishableKey && !/^(sb_secret_|ey.*service_role)/.test(config.supabasePublishableKey);
  let client, user = null, cars = [], selectedId = null, editingId = null;
  let busy = false, dirty = false, loaded = false, epoch = 0, authMode = 'login', recovery = false;
  let localImport = null, importDismissed = false;
  const current = () => cars.find(c => c.id === selectedId);
  function status(message = '', error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
  function lock(value) {
    busy = value;
    document.querySelectorAll('button,input,select').forEach(el => {el.disabled = value;});
  }
  function unsaved() { return !dirty || confirm('Discard unsaved changes?'); }
  function setDirty() { dirty = true; status('Unsaved changes'); }
  function authView(mode) {
    authMode = mode; $('password').value = '';
    $('auth-title').textContent = {login:'Log in',signup:'Create account',reset:'Reset password',update:'Set new password'}[mode];
    $('auth-submit').textContent = {login:'Log in',signup:'Create account',reset:'Send reset link',update:'Save password'}[mode];
    $('email-field').hidden = mode === 'update'; $('email').required = mode !== 'update';
    $('password-field').hidden = mode === 'reset'; $('password').required = mode !== 'reset';
    $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('password').minLength = mode === 'login' ? 1 : 8;
    $('auth-toggle').textContent = mode === 'login' ? 'Create account' : 'Back to login';
    $('auth-toggle').hidden = mode === 'update'; $('forgot').hidden = mode !== 'login';
    $('auth').hidden = false; $('ledger').hidden = true;
  }
  function renderTotals(c = current()) {
    if (!c) return;
    const t = totals(c);
    $('expense-total').textContent = money(t.invested);
    $('profit-label').textContent = t.sold ? 'Actual profit' : 'Potential profit';
    $('profit').textContent = money(t.profit);
  }
  function render() {
    const select = $('vehicle-select'); select.replaceChildren();
    if (!cars.some(c => c.id === selectedId)) selectedId = cars[0]?.id || null;
    for (const c of cars) {
      const option = document.createElement('option'); option.value = c.id;
      option.textContent = c.name + (c.sold_price !== null ? ' · Sold' : ''); select.append(option);
    }
    select.value = selectedId || ''; select.hidden = !cars.length;
    const c = current(); $('empty-state').hidden = !!c; $('vehicle-view').hidden = !c;
    if (!c) return;
    $('vehicle-title').textContent = c.name; $('vehicle-vin').textContent = c.vin || 'VIN not recorded';
    $('estimated-value').value = c.estimated_value ?? ''; $('sold-price').value = c.sold_price ?? '';
    const date = c.valuation_updated_at ? new Date(c.valuation_updated_at) : null;
    $('value-source').textContent = c.estimated_value === null ? '' : `${c.valuation_source || 'Manual'}${date && Number.isFinite(date.getTime()) ? ' · ' + date.toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) : ''}`;
    $('value-dirty').hidden = true;
    renderExpenses(c); renderTotals(c);
  }
  function renderExpenses(c) {
    const list = $('expense-list'); list.replaceChildren();
    for (const exp of c.expenses) {
      const row = document.createElement('form'); row.className = 'expense-line'; row.dataset.expense = exp.id;
      const description = document.createElement('input'); description.value = exp.description;
      description.maxLength = 100; description.required = true; description.setAttribute('aria-label','Expense description');
      const value = document.createElement('input'); value.type = 'number'; value.inputMode = 'decimal'; value.step = '.01'; value.min = '0'; value.max = '100000000'; value.required = true; value.value = exp.amount; value.setAttribute('aria-label','Expense amount');
      const actions = document.createElement('div'); actions.className = 'expense-actions';
      const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save'; save.setAttribute('aria-label',`Save ${exp.description}`);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label',`Remove ${exp.description}`);
      row.addEventListener('input', setDirty);
      row.addEventListener('submit', e => {
        e.preventDefault();
        const text = description.value.trim(); if (!text) return description.reportValidity();
        try {
          const updated = c.expenses.map(item => item.id === exp.id ? {...item,description:text,amount:amount(value.value)} : item);
          saveCar(c, {expenses:updated}, row);
        } catch (err) { status(err.message, true); }
      });
      remove.addEventListener('click', () => {
        if (confirm(`Remove ${exp.description}?`)) saveCar(c, {expenses:c.expenses.filter(item => item.id !== exp.id)}, row);
      });
      actions.append(save,remove); row.append(description,value,actions); list.append(row);
    }
  }
  function draftsExcept(savedForm) {
    return [...document.querySelectorAll('#ledger form[data-dirty]')].filter(form => form !== savedForm).map(form => ({
      id:form.id, expense:form.dataset.expense,
      values:[...form.querySelectorAll('input')].map(input => input.value)
    }));
  }
  function restoreDrafts(drafts) {
    document.querySelectorAll('#ledger form').forEach(form => delete form.dataset.dirty);
    for (const draft of drafts) {
      const form = draft.id ? $(draft.id) : [...document.querySelectorAll('[data-expense]')].find(el => el.dataset.expense === draft.expense);
      if (!form) continue;
      [...form.querySelectorAll('input')].forEach((input,i) => input.value = draft.values[i]);
      form.dataset.dirty = 'true';
    }
    dirty = !!document.querySelector('#ledger form[data-dirty]');
    if ($('value-form').dataset.dirty) { $('value-dirty').hidden = false; previewValues(); }
  }
  async function operation(action, onSuccess, message = 'Saving…', savedForm = null) {
    if (busy || !user || !loaded) return false;
    const version = epoch;
    const drafts = draftsExcept(savedForm);
    lock(true); status(message);
    try {
      const result = await action(); if (result.error) throw result.error;
      if (version !== epoch) return false;
      onSuccess(result.data); dirty = false; render(); restoreDrafts(drafts); status(dirty ? 'Saved. Other changes are unsaved.' : 'Saved'); return true;
    } catch (err) {
      if (version === epoch) { if (err.code === 'PGRST116') $('retry').hidden = false; status(err.code === 'PGRST116' ? 'This vehicle changed on another device. Reload before saving again; your edits are still visible.' : (err.message || 'Could not save. Your changes are still visible; try again.'), true); }
      return false;
    } finally { if (version === epoch) lock(false); }
  }
  async function saveCar(c, changes, savedForm = null) {
    return operation(() => client.from('vehicles').update({...changes,revision:c.revision + 1}).eq('id',c.id).eq('revision',c.revision).select().single(), data => {
      cars[cars.findIndex(item => item.id === c.id)] = data;
    }, 'Saving…', savedForm);
  }
  async function load(silent = false) {
    if (!user || busy || (silent && (dirty || $('vehicle-dialog').open || document.querySelector('#ledger input:focus')))) return;
    const version = epoch;
    lock(true); if (!silent) status('Loading…');
    try {
      const {data,error} = await client.from('vehicles').select('*').order('created_at');
      if (error) throw error; if (version !== epoch) return;
      cars = data; loaded = true; dirty = false; restoreDrafts([]); $('add-expense-form').reset(); render();
      $('ledger').hidden = recovery; $('retry').hidden = true;
      if (!silent || $('status').className === 'error') status('');
      await offerImport(version);
    } catch (err) { if (version === epoch) {status('Could not load vehicles: ' + err.message, true); $('retry').hidden = false;} }
    finally { if (version === epoch) lock(false); }
  }
  async function sessionChanged(session) {
    if (session?.user?.id === user?.id) return;
    epoch++; user = session?.user || null; cars = []; selectedId = null; loaded = false; dirty = false; importDismissed = false;
    $('vehicle-dialog').close(); $('ledger').hidden = true; $('retry').hidden = true; $('logout').hidden = !user;
    $('import-prompt').hidden = true; restoreDrafts([]); $('add-expense-form').reset(); lock(false);
    if (!user) {recovery = false; authView('login'); status(''); return;}
    $('auth').hidden = true;
    if (recovery) authView('update');
    await load();
  }
  $('auth-toggle').onclick = () => {status(''); $('password').value = ''; authView(authMode === 'login' ? 'signup' : 'login');};
  $('forgot').onclick = () => {status(''); authView('reset');};
  $('auth-form').onsubmit = async e => {
    e.preventDefault(); if (busy || !client) return;
    const mode = authMode; lock(true); status('Please wait…');
    const email = $('email').value.trim(), password = $('password').value;
    const redirectTo = location.origin + location.pathname;
    try {
      let result;
      if (mode === 'login') result = await client.auth.signInWithPassword({email,password});
      if (mode === 'signup') result = await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}});
      if (mode === 'reset') result = await client.auth.resetPasswordForEmail(email,{redirectTo});
      if (mode === 'update') result = await client.auth.updateUser({password});
      if (result.error) throw result.error;
      $('password').value = '';
      if (mode === 'reset') status('If this email has an account, a reset link will arrive shortly.');
      else if (mode === 'signup' && !result.data.session) status('Check your email to confirm your account, then log in.');
      else if (mode === 'update') {recovery = false; $('auth').hidden = true; lock(false); await load(); status('Password updated.');}
      else {lock(false); await sessionChanged(result.data.session);}
    } catch (err) {status(err.message || 'Authentication failed. Try again.', true);}
    finally {lock(false);}
  };
  $('logout').onclick = async () => {
    if (!unsaved()) return;
    lock(true);
    const {error} = await client.auth.signOut({scope:'local'});
    if (error) status(error.message,true); else await sessionChanged(null);
    lock(false);
  };
  $('retry').onclick = () => {if (unsaved()) load();};
  $('vehicle-select').onchange = e => {
    if (!unsaved()) { e.target.value = selectedId; return; }
    selectedId = e.target.value; dirty = false; restoreDrafts([]); $('add-expense-form').reset(); render();
  };
  function openForm(id = null) {
    if (!unsaved()) return;
    dirty = false; restoreDrafts([]); $('add-expense-form').reset(); render(); editingId = id; const c = cars.find(v => v.id === id);
    $('dialog-title').textContent = c ? 'Edit vehicle' : 'Add vehicle';
    $('form-name').value = c?.name || ''; $('form-vin').value = c?.vin || '';
    $('delete-vehicle').hidden = !c; $('form-error').textContent = '';
    $('vehicle-dialog').showModal(); $('form-name').focus();
  }
  $('add-vehicle').onclick = () => openForm(); $('edit-vehicle').onclick = () => openForm(selectedId);
  $('cancel-dialog').onclick = () => $('vehicle-dialog').close();
  $('vehicle-dialog').addEventListener('cancel', e => {if (busy) e.preventDefault();});
  $('vehicle-form').onsubmit = async e => {
    e.preventDefault(); const name = $('form-name').value.trim(), vin = $('form-vin').value.trim().toUpperCase();
    if (!name || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {$('form-error').textContent = 'Enter a vehicle name and a valid 17-character VIN.'; return;}
    const c = cars.find(v => v.id === editingId);
    const ok = c ? await saveCar(c,{name,vin,...(vin !== c.vin ? {estimated_value:null,valuation_source:null,valuation_updated_at:null} : {})}) : await operation(() => client.from('vehicles').insert({user_id:user.id,name,vin}).select().single(), data => {cars.push(data); selectedId = data.id;});
    if (ok) $('vehicle-dialog').close();
  };
  $('delete-vehicle').onclick = async () => {
    const c = cars.find(v => v.id === editingId);
    if (!c || !confirm(`Delete ${c.name} and all its expenses?`)) return;
    const ok = await operation(() => client.from('vehicles').delete().eq('id',c.id).eq('revision',c.revision).select().single(), () => {cars = cars.filter(v => v.id !== c.id);});
    if (ok) $('vehicle-dialog').close();
  };
  $('add-expense-form').addEventListener('input',setDirty);
  $('add-expense-form').onsubmit = async e => {
    e.preventDefault(); const c = current(); if (!c) return;
    try {
      const description = $('expense-description').value.trim(); if (!description) return;
      const value = amount($('expense-amount').value); if (value === null) return;
      if (await saveCar(c,{expenses:[...c.expenses,{id:crypto.randomUUID(),description,amount:value}]}, $('add-expense-form'))) $('add-expense-form').reset();
    } catch (err) {status(err.message,true);}
  };
  function previewValues() {
    try {renderTotals({...current(),estimated_value:amount($('estimated-value').value),sold_price:amount($('sold-price').value)});} catch (_) { /* Native validation reports invalid input on save. */ }
  }
  $('value-form').oninput = () => {setDirty(); $('value-dirty').hidden = false; previewValues();};
  $('ledger').addEventListener('input', e => {const form = e.target.closest('form'); if (form) form.dataset.dirty = 'true';});
  $('value-form').onsubmit = async e => {
    e.preventDefault(); const c = current(); if (!c) return;
    try {
      const estimated_value = amount($('estimated-value').value), sold_price = amount($('sold-price').value);
      const changed = estimated_value !== c.estimated_value;
      await saveCar(c,{estimated_value,sold_price,...(changed ? {valuation_source:estimated_value === null ? null : 'Manual',valuation_updated_at:estimated_value === null ? null : new Date().toISOString()} : {})}, $('value-form'));
    } catch (err) {status(err.message,true);}
  };
  $('check-carfax').onclick = () => {
    const c = current(); if (c?.vin) navigator.clipboard?.writeText(c.vin).then(() => status('VIN copied. Enter it on CARFAX with ZIP 73013.')).catch(() => status(`Use VIN ${c.vin} and ZIP 73013 on CARFAX.`));
  };
  async function offerImport(version) {
    if (importDismissed || !localImport || version !== epoch) return;
    const {data,error} = await client.from('imports').select('source_key').eq('source_key',localImport.key);
    if (version !== epoch) return;
    if (error) {status('Vehicles loaded. Could not check browser import; retry to check again.',true); $('retry').hidden = false; return;}
    $('import-prompt').hidden = data.length > 0;
  }
  $('dismiss-import').onclick = () => { importDismissed = true; $('import-prompt').hidden = true; };
  $('import-local').onclick = async () => {
    if (!unsaved() || !confirm(`Import ${localImport.records.length} browser vehicle(s) into ${user.email}? Existing cloud vehicles will be kept. Browser records will remain as a backup.`)) return;
    restoreDrafts([]);
    const ok = await operation(() => client.rpc('import_vehicles',{source:localImport.key,records:localImport.records}), () => { $('import-prompt').hidden = true; }, 'Importing…');
    if (ok) {await load(); status('Import complete. Browser originals have been kept.');}
  };
  async function readLegacy() {
    const raw = localStorage.getItem('carbook.records.v2'); if (!raw) return;
    const records = JSON.parse(raw); if (!Array.isArray(records) || !records.length) return;
    if (records.length > 200) throw Error('Browser backup exceeds 200 vehicles; originals were kept.');
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
    const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
    const converted = records.map((c,index) => {
      const name = String(c.name || [c.year,c.make,c.model,c.trim].filter(Boolean).join(' ') || 'Untitled vehicle').trim().slice(0,150);
      const expenses = (c.expenses || []).map(e => {
        const value = amount(e.amount); if (value === null || !String(e.description || '').trim()) throw Error('A browser expense is incomplete; originals were kept.');
        return {id:crypto.randomUUID(),description:String(e.description).trim().slice(0,100),amount:value};
      });
      const estimated_value = amount(c.estimatedValue), sold_price = amount(c.soldPrice);
      const date = c.estimatedUpdatedAt && Number.isFinite(Date.parse(c.estimatedUpdatedAt)) ? new Date(c.estimatedUpdatedAt).toISOString() : null;
      return {name,vin:String(c.vin || '').toUpperCase(),expenses,estimated_value,sold_price,valuation_source:estimated_value === null ? null : 'Manual',valuation_updated_at:date,legacy_key:String(c.id || index)};
    });
    localImport = {key,records:converted};
  }
  window.addEventListener('beforeunload', e => {if (dirty || busy) {e.preventDefault(); e.returnValue = '';}});
  window.addEventListener('focus', () => {if (loaded && !recovery) load(true);});
  window.addEventListener('online', () => {if (loaded && !recovery) load(true);});
  setInterval(() => {if (loaded && !recovery && !document.hidden) load(true);},30000);
  async function init() {
    if (!configured) {status('Cloud saving is not configured. Follow the Supabase setup in README.md. Existing browser records have been kept.'); return;}
    if (!window.supabase) {status('The authentication library could not load. Reload to try again.',true); return;}
    // Reject JWT service-role keys as well as modern secret keys.
    try {if (config.supabasePublishableKey.startsWith('ey')) {const payload = JSON.parse(atob(config.supabasePublishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if (payload.role !== 'anon') throw Error('Only an anon or publishable key is allowed.');}}
    catch (err) {status('Invalid public Supabase key. Check config.js.',true); return;}
    let legacyError = '';
    try {await readLegacy();} catch (err) {legacyError = 'Browser import unavailable: ' + err.message;}
    client = window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    client.auth.onAuthStateChange((event,session) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true;
      // Defer database requests until Supabase releases its auth lock.
      setTimeout(async () => {await sessionChanged(session); if (event === 'PASSWORD_RECOVERY') authView('update');},0);
    });
    status('Loading…');
    const {data,error} = await client.auth.getSession();
    if (error) {authView('login'); status(error.message,true); return;}
    if (data.session) await sessionChanged(data.session); else {authView('login'); status('');}
    if (legacyError) status(legacyError,true);
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get('error_description')) status(params.get('error_description'),true);
  }
  init().catch(err => {status(err.message || 'Unable to start Carbook.',true); lock(false);});
})();
