/* Buildless Carbook. The only external library is the pinned Supabase SDK. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const {amount, totals, format} = window.CarbookFinance;
  const VIN = window.CarbookVIN;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const authForms = {login:'auth-form', signup:'signup-form', reset:'reset-form', update:'update-form'};
  const money = value => format(value);
  const profitState = value => value === null || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative';
  let expenseEditing = false;
  function formatInput(input) {
    try {const value = amount(input.value); input.value = value === null ? '' : format(value, !input.closest('.money-input'));} catch (_) { /* Leave incomplete input intact. */ }
  }
  const config = window.CARBOOK_CONFIG || {};
  const configured = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(config.supabaseUrl || '') && !!config.supabasePublishableKey && !/^(sb_secret_|ey.*service_role)/.test(config.supabasePublishableKey);
  let client, user = null, cars = [], selectedId = null, editingId = null;
  let busy = false, dirty = false, loaded = false, epoch = 0, authMode = 'login', recovery = false;
  let valueTimer, valueQueued = false, valueSaving = false, valueConflict = false;
  let valueTask = null;
  let notice = {kind:'', scope:''}, noticeTimer, fadeTimer;
  let navigationIndex = Number.isInteger(history.state?.carbookIndex) ? history.state.carbookIndex : 0;
  let restoringHistory = false, renderedPage = null;
  history.replaceState({...history.state, carbookIndex:navigationIndex}, '', location.href);
  let routeUrl = vehicleHref(readRoute());
  let vinState = {vin:'', name:'', status:'idle'}, decodeTimer, decodeController, decodeRequest = 0, dialogToken = 0, vinSubmitting = false;
  let renderedVehicle = null, formReturnFocus = null;
  const current = () => cars.find(c => c.id === selectedId);
  function motion(element, frames, duration = 180) {
    if (reducedMotion.matches || !element?.animate) return null;
    return element.animate(frames, {duration, easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  function clearStatus() {
    clearTimeout(noticeTimer); clearTimeout(fadeTimer);
    $('status-bar').hidden = true; $('status-bar').classList.remove('leaving');
    $('status').textContent = ''; $('status').className = ''; $('status').dataset.state = '';
    $('retry').hidden = true; notice = {kind:'', scope:''};
  }
  function status(message = '', error = false, {scope = 'save', resolve = false, success = false, duration = 0} = {}) {
    // Typing, a background refresh, or an unrelated action must not hide a save error.
    if (notice.kind === 'error' && !error && (!resolve || notice.scope !== scope)) return;
    if (!message) {clearStatus(); return;}
    clearTimeout(noticeTimer); clearTimeout(fadeTimer);
    const changed = $('status').textContent !== message;
    notice = {kind:error ? 'error' : success ? 'success' : /…$/.test(message) ? 'loading' : 'info', scope};
    $('status-bar').hidden = false; $('status-bar').classList.remove('leaving');
    $('status').textContent = message; $('status').className = error ? 'error' : '';
    $('status').dataset.state = notice.kind;
    $('status').setAttribute('role',error ? 'alert' : 'status');
    if (!error) $('retry').hidden = true;
    if (changed) motion($('status'), [{opacity:.3}, {opacity:1}]);
    if (error && $('vehicle-dialog').open) $('form-error').textContent = message;
    if (success || duration) noticeTimer = setTimeout(() => {
      $('status-bar').classList.add('leaving');
      fadeTimer = setTimeout(clearStatus, reducedMotion.matches ? 0 : 200);
    }, success ? 2000 : duration);
  }
  function lock(value) {
    busy = value;
    document.querySelectorAll('button,input').forEach(el => {
      // Keep credentials in native form controls during submission so managers
      // can observe them. Readonly prevents edits without disabling autofill fields.
      if (el.matches('#auth input')) el.readOnly = value || el.id === 'update-email';
      else el.disabled = value && !(valueSaving && el.matches('#ledger input'));
    });
    $('ledger').setAttribute('aria-busy', String(value));
    $('sold-price').disabled = (value && !valueSaving) || !$('sold-toggle').checked;
    updateVinButton();
  }
  function unsaved() { return !dirty || confirm('Discard unsaved changes?'); }
  function setDirty() { dirty = true; if (notice.kind === 'success') clearStatus(); }
  function authView(mode) {
    const previous = $(authForms[authMode]);
    const email = previous.elements.namedItem('email')?.value || user?.email || '';
    if (mode !== authMode) previous.reset();
    authMode = mode;
    for (const [key,id] of Object.entries(authForms)) $(id).hidden = key !== mode;
    const form = $(authForms[mode]);
    // Do not reset a form on initial display: the browser may already have filled it.
    if (!form.elements.namedItem('email').value) form.elements.namedItem('email').value = email;
    if (mode === 'update') $('update-email').value = user?.email || email;
    $('auth-title').textContent = {login:'Log in',signup:'Create account',reset:'Reset password',update:'Set new password'}[mode];
    $('auth-description').textContent = ''; $('auth-description').hidden = true;
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
    $('profit').parentElement.dataset.result = profitState(t.profit);
  }
  // Query-string routing keeps direct links compatible with static hosting and
  // leaves the URL fragment available for Supabase email/recovery callbacks.
  function readRoute() { return new URL(location.href).searchParams.get('vehicle') || null; }
  function vehicleHref(id) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('vehicle',id); else url.searchParams.delete('vehicle');
    return url.pathname + url.search;
  }
  function setRoute(id, replace = false) {
    const url = vehicleHref(id);
    if (url !== routeUrl) {
      if (!replace) navigationIndex++;
      history[replace ? 'replaceState' : 'pushState']({...history.state,carbookIndex:navigationIndex},'',url);
    }
    routeUrl = url; selectedId = id;
  }
  function discardDrafts() {
    clearTimeout(valueTimer); valueQueued = false; valueConflict = false;
    expenseEditing = false;
    dirty = false; restoreDrafts([]); $('add-expense-form').reset();
    cancelDecode(); dialogToken++; vinSubmitting = false;
    $('vehicle-dialog').close(); $('vehicle-dialog').classList.remove('closing');
    if (notice.scope === 'save') clearStatus();
  }
  function focusPage() {
    const target = selectedId ? current() ? $('vehicle-title') : $('vehicle-missing') : $('garage-title');
    target.focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'});
  }
  async function navigate(id) {
    if (valueTask) await valueTask;
    if (busy) return;
    if ($('value-form').dataset.dirty && !await flushValues()) return;
    if (!unsaved()) return;
    discardDrafts(); setRoute(id);
    if (loaded) {render(); focusPage();}
  }
  document.addEventListener('click', e => {
    const link = e.target.closest('a[data-route]');
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); navigate(new URL(link.href).searchParams.get('vehicle'));
  });
  window.addEventListener('popstate', () => {
    const targetIndex = history.state?.carbookIndex;
    if (restoringHistory) {
      if (targetIndex === navigationIndex) restoringHistory = false;
      else if (Number.isInteger(targetIndex)) history.go(navigationIndex - targetIndex);
      return;
    }
    if (busy || !unsaved()) {
      if (Number.isInteger(targetIndex) && targetIndex !== navigationIndex) {
        restoringHistory = true; history.go(navigationIndex - targetIndex);
      } else history.pushState({...history.state,carbookIndex:navigationIndex},'',routeUrl);
      return;
    }
    navigationIndex = Number.isInteger(targetIndex) ? targetIndex : 0;
    routeUrl = vehicleHref(readRoute()); discardDrafts();
    if (loaded) {render(); focusPage();}
  });
  function renderGallery() {
    const activeId = document.activeElement?.closest('.vehicle-card')?.dataset.vehicle;
    const gallery = $('vehicle-gallery'); gallery.replaceChildren();
    for (const c of cars) {
      const item = document.createElement('li');
      const link = document.createElement('a'); link.className = 'vehicle-card';
      link.href = vehicleHref(c.id); link.dataset.route = ''; link.dataset.vehicle = c.id;
      const title = document.createElement('h2'); title.textContent = c.name; link.append(title);
      if (c.vin) {const vin = document.createElement('p'); vin.className = 'vin'; vin.textContent = c.vin; link.append(vin);}
      const total = totals(c);
      if (total.profit !== null) {
        const summary = document.createElement('div'); summary.className = 'card-profit'; summary.dataset.result = profitState(total.profit);
        const label = document.createElement('span'); label.textContent = total.sold ? 'Actual profit' : 'Potential profit';
        const value = document.createElement('strong'); value.textContent = money(total.profit);
        summary.append(label,value); link.append(summary);
      }
      item.append(link); gallery.append(item);
      if (activeId === c.id) link.focus({preventScroll:true});
    }
    $('empty-state').hidden = cars.length > 0;
  }
  function render() {
    selectedId = new URL(routeUrl,location.origin).searchParams.get('vehicle') || null;
    $('home-link').href = vehicleHref(null); $('back-garage').href = vehicleHref(null);
    $('garage').hidden = !!selectedId; $('detail-page').hidden = !selectedId;
    const c = current(); $('vehicle-view').hidden = !c; $('vehicle-missing').hidden = !selectedId || !!c;
    const page = selectedId || 'garage';
    if (!selectedId) {
      renderGallery(); document.title = 'Carbook'; renderedVehicle = null;
    } else if (!c) {
      document.title = 'Vehicle unavailable · Carbook'; renderedVehicle = null;
    } else {
      document.title = c.name + ' · Carbook';
      $('vehicle-title').textContent = c.name; $('vehicle-vin').textContent = c.vin || ''; $('vehicle-vin').hidden = !c.vin;
      $('estimated-value').value = c.estimated_value === null ? '' : money(c.estimated_value); $('sold-price').value = c.sold_price === null ? '' : money(c.sold_price);
      $('sold-toggle').checked = c.sold_price !== null || (renderedVehicle === c.id && $('sold-toggle').checked);
      $('sold-price').disabled = !$('sold-toggle').checked;
      renderExpenses(c); renderTotals(c); renderedVehicle = c.id;
    }
    if (renderedPage !== page) motion(selectedId ? $('detail-page') : $('garage'), [{opacity:.5,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],220);
    renderedPage = page;
  }
  function renderExpenses(c) {
    $('edit-expenses').textContent = expenseEditing ? 'Done' : 'Edit';
    $('cancel-expenses').hidden = !expenseEditing;
    const list = $('expense-list');
    const previous = new Set([...list.children].map(row => row.dataset.expense));
    list.replaceChildren();
    for (const exp of c.expenses) {
      if (!expenseEditing) {
        const row = document.createElement('div'); row.className = 'expense-row'; row.dataset.expense = exp.id;
        const description = document.createElement('span'); description.textContent = exp.description;
        const value = document.createElement('span'); value.className = 'expense-value'; value.textContent = money(exp.amount);
        row.append(description,value); list.append(row);
        if (renderedVehicle === c.id && !previous.has(exp.id)) motion(row,[{opacity:0},{opacity:1}]);
        continue;
      }
      const row = document.createElement('form'); row.className = 'expense-line'; row.dataset.expense = exp.id;
      const description = document.createElement('input'); description.name = 'description'; description.type = 'text'; description.value = exp.description;
      description.maxLength = 100; description.required = true; description.setAttribute('aria-label','Expense description');
      const value = document.createElement('input'); value.name = 'amount'; value.type = 'text'; value.inputMode = 'decimal'; value.step = '.01'; value.min = '0'; value.max = '100000000'; value.required = true; value.value = format(exp.amount,false); value.setAttribute('aria-label','Expense amount');
      const actions = document.createElement('div'); actions.className = 'expense-actions';
      const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save'; save.setAttribute('aria-label',`Save ${exp.description}`);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label',`Remove ${exp.description}`);
      row.addEventListener('input', setDirty);
      row.addEventListener('submit', e => {
        e.preventDefault();
        c = current();
        const text = description.value.trim(); if (!text) return description.reportValidity();
        try {
          if (amount(value.value) === null) throw Error('Enter an expense amount.');
          const updated = c.expenses.map(item => item.id === exp.id ? {...item,description:text,amount:amount(value.value)} : item);
          saveCar(c, {expenses:updated}, row);
        } catch (err) { status(err.message, true); }
      });
      remove.addEventListener('click', () => {
        c = current();
        if (confirm(`Remove ${exp.description}?`)) saveCar(c, {expenses:c.expenses.filter(item => item.id !== exp.id)}, row);
      });
      const field = document.createElement('span'); field.className = 'money-input';
      const prefix = document.createElement('span'); prefix.textContent = '$'; prefix.setAttribute('aria-hidden','true');
      field.append(prefix,value);
      actions.append(save,remove); row.append(description,field,actions); list.append(row);
      if (renderedVehicle === c.id && !previous.has(exp.id)) motion(row, [{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'translateY(0)'}], 220);
    }
  }
  function draftsExcept(savedForm) {
    return [...document.querySelectorAll('#ledger form[data-dirty]')].filter(form => form !== savedForm).map(form => ({
      id:form.id, expense:form.dataset.expense,
      values:[...form.querySelectorAll('input')].map(input => ({value:input.value,checked:input.checked}))
    }));
  }
  function restoreDrafts(drafts) {
    document.querySelectorAll('#ledger form').forEach(form => delete form.dataset.dirty);
    for (const draft of drafts) {
      const form = draft.id ? $(draft.id) : [...document.querySelectorAll('[data-expense]')].find(el => el.dataset.expense === draft.expense);
      if (!form) continue;
      [...form.querySelectorAll('input')].forEach((input,i) => {input.value = draft.values[i].value; input.checked = draft.values[i].checked;});
      form.dataset.dirty = 'true';
    }
    dirty = !!document.querySelector('#ledger form[data-dirty]');
    $('sold-price').disabled = busy || !$('sold-toggle').checked;
    if ($('value-form').dataset.dirty) previewValues();
  }
  async function operation(action, onSuccess, message = 'Saving…', savedForm = null) {
    if (busy || !user || !loaded) return false;
    const version = epoch;
    const drafts = draftsExcept(savedForm);
    const valueSnapshot = valueSaving ? [...$('value-form').querySelectorAll('input')].map(input => [input.value,input.checked]) : null;
    let focusAfterSave = null;
    lock(true); status(message);
    try {
      const result = await action(); if (result.error) throw result.error;
      if (version !== epoch) return false;
      if (savedForm?.dataset.expense && result.data?.expenses && !result.data.expenses.some(item => item.id === savedForm.dataset.expense)) {
        const animation = motion(savedForm, [
          {opacity:1, height:savedForm.getBoundingClientRect().height + 'px', overflow:'hidden'},
          {opacity:0, height:'0px', paddingTop:0, paddingBottom:0, borderTopWidth:0, overflow:'hidden'}
        ], 160);
        if (animation) await animation.finished.catch(() => {});
        if (version !== epoch) return false;
      }
      onSuccess(result.data);
      if (valueSnapshot) {
        const unchanged = [...$('value-form').querySelectorAll('input')].every((input,i) => input.value === valueSnapshot[i][0] && input.checked === valueSnapshot[i][1]);
        if (unchanged) {delete $('value-form').dataset.dirty; for (const id of ['estimated-value','sold-price']) if ($(id) !== document.activeElement) formatInput($(id));}
        dirty = !!document.querySelector('#ledger form[data-dirty]');
        previewValues();
      } else {dirty = false; render(); restoreDrafts(drafts);}
      if (savedForm?.dataset.expense) {
        const row = [...$('expense-list').children].find(item => item.dataset.expense === savedForm.dataset.expense);
        // Restore focus synchronously after unlocking so a delayed frame cannot
        // steal focus from the user's next edit.
        focusAfterSave = row?.querySelector('input') || $('expense-description');
      }
      status('Saved',false,{success:true,resolve:true}); return true;
    } catch (err) {
      if (version === epoch) { if (valueSaving) valueConflict = err.code === 'PGRST116'; if (valueSaving || err.code === 'PGRST116') $('retry').hidden = false; status(err.code === 'PGRST116' ? (valueSaving ? 'This vehicle changed on another device. Retry to review your edits.' : 'This vehicle changed on another device. Reload before saving again; your edits are still visible.') : (err.message || 'Could not save. Your changes are still visible; try again.'), true); }
      return false;
    } finally { if (version === epoch) {lock(false); focusAfterSave?.focus({preventScroll:true}); if (valueQueued && !valueSaving) queueValues();} }
  }
  async function saveCar(c, changes, savedForm = null) {
    return operation(() => client.from('vehicles').update({...changes,revision:c.revision + 1}).eq('id',c.id).eq('revision',c.revision).select().single(), data => {
      cars[cars.findIndex(item => item.id === c.id)] = data;
    }, 'Saving…', savedForm);
  }
  async function load(silent = false, resolveSaveError = false) {
    if (!user || busy || (silent && (dirty || $('vehicle-dialog').open || document.querySelector('#ledger input:focus')))) return;
    const version = epoch;
    lock(true); if (!silent) status('Loading…',false,{scope:'load'});
    try {
      const {data,error} = await client.from('vehicles').select('*').order('created_at');
      if (error) throw error; if (version !== epoch) return;
      cars = data; loaded = true; dirty = false; restoreDrafts([]); $('add-expense-form').reset(); render();
      $('ledger').hidden = recovery;
      if (resolveSaveError) clearStatus();
      else if (!silent || (notice.kind === 'error' && notice.scope === 'load')) status('',false,{scope:'load',resolve:true});
    } catch (err) { if (version === epoch) {status('Could not load vehicles: ' + err.message, true,{scope:'load'}); $('retry').hidden = false;} }
    finally { if (version === epoch) lock(false); }
  }
  async function sessionChanged(session) {
    if (session?.user?.id === user?.id) return;
    clearTimeout(valueTimer); valueQueued = false; valueConflict = false;
    expenseEditing = false; renderedVehicle = null;
    epoch++; user = session?.user || null; cars = []; selectedId = null; loaded = false; dirty = false; renderedPage = null; clearStatus();
    cancelDecode(); dialogToken++; vinSubmitting = false; $('vehicle-dialog').classList.remove('closing'); $('vehicle-dialog').close(); $('ledger').hidden = true; $('retry').hidden = true; $('logout').hidden = !user;
    restoreDrafts([]); $('add-expense-form').reset(); lock(false);
    if (!user) {recovery = false; document.title = 'Carbook'; Object.values(authForms).forEach(id => $(id).reset()); authView('login'); return;}
    $('auth').hidden = true;
    if (recovery) authView('update');
    await load();
  }
  $('auth-toggle').onclick = () => {clearStatus(); authView(authMode === 'login' ? 'signup' : 'login');};
  $('forgot').onclick = () => {clearStatus(); authView('reset');};
  for (const [mode,id] of Object.entries(authForms)) $(id).addEventListener('submit', async e => {
    e.preventDefault(); if (busy || !client) return;
    const form = e.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get('email') || '').trim(), password = String(fields.get('password') || '');
    const redirectTo = location.origin + location.pathname;
    form.setAttribute('aria-busy','true'); lock(true); status('Please wait…',false,{scope:'auth'});
    try {
      let result;
      if (mode === 'login') result = await client.auth.signInWithPassword({email,password});
      if (mode === 'signup') result = await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}});
      if (mode === 'reset') result = await client.auth.resetPasswordForEmail(email,{redirectTo});
      if (mode === 'update') result = await client.auth.updateUser({password});
      if (result.error) throw result.error;
      // Leave submitted values intact for password managers. Forms are reset on
      // mode changes/logout, not in the submission event they observe.
      if (mode === 'reset') status('If this email has an account, a reset link will arrive shortly.',false,{scope:'auth',resolve:true});
      else if (mode === 'signup' && !result.data.session) {form.hidden = true; $('auth-title').textContent = 'Check your email'; $('auth-description').textContent = 'Confirm your email, then log in.'; $('auth-description').hidden = false; status('',false,{scope:'auth',resolve:true});}
      else if (mode === 'update') {recovery = false; $('auth').hidden = true; lock(false); await load(); status('Password updated.',false,{scope:'auth',resolve:true,duration:2000});}
      else {lock(false); await sessionChanged(result.data.session);}
    } catch (err) {status(err.message || 'Authentication failed. Try again.', true,{scope:'auth'});}
    finally {form.removeAttribute('aria-busy'); lock(false);}
  });
  $('logout').onclick = async () => {
    if (!unsaved()) return;
    lock(true);
    const {error} = await client.auth.signOut({scope:'local'});
    if (error) status(error.message,true,{scope:'auth'}); else {setRoute(null,true); await sessionChanged(null);}
    lock(false);
  };
  $('retry').onclick = async () => {
    if (!$('value-form').dataset.dirty) {if (unsaved()) load(false,true); return;}
    if (busy) return;
    if (valueConflict) {
      // Fetch a new revision, retaining edits. Never silently overwrite a conflict.
      const c = current(), version = epoch;
      let changes; try {changes = valueChanges(c);} catch (err) {status(err.message,true); return;}
      lock(true);
      try {
        const {data,error} = await client.from('vehicles').select('*').eq('id',c.id).single();
        if (error) throw error;
        if (version !== epoch) return;
        if (!confirm('This vehicle changed on another device. Apply your value edits to the latest record?')) return;
        const drafts = draftsExcept($('value-form'));
        cars[cars.findIndex(item => item.id === c.id)] = data;
        render(); restoreDrafts(drafts);
        if ('estimated_value' in changes) $('estimated-value').value = changes.estimated_value ?? '';
        if ('sold_price' in changes) {$('sold-price').value = changes.sold_price ?? ''; $('sold-toggle').checked = changes.sold_price !== null;}
        $('value-form').dataset.dirty = 'true'; dirty = true; valueConflict = false;
      } catch (err) {status(err.message,true); return;}
      finally {if (version === epoch) lock(false);}
    }
    await flushValues();
  };
  function cancelDecode() {
    clearTimeout(decodeTimer); decodeController?.abort(); decodeController = null; decodeRequest++;
  }
  function updateVinButton() {
    $('save-vehicle').disabled = busy || vinSubmitting || $('vehicle-dialog').classList.contains('closing') || (vinState.status === 'error' && $('manual-details').hidden);
    $('save-vehicle').textContent = vinSubmitting ? 'Finding vehicle…' : busy && $('vehicle-dialog').open ? 'Saving…' : editingId ? 'Save changes' : 'Add vehicle';
  }
  function vinFeedback(message, state = 'idle', name = '') {
    $('vin-feedback').dataset.state = state;
    $('vin-feedback').setAttribute('aria-busy',String(state === 'loading'));
    $('vin-status').textContent = message;
    $('decoded-name').textContent = name; $('decoded-name').hidden = !name;
    $('form-vin').setAttribute('aria-invalid',String(state === 'invalid'));
  }
  async function decodeVehicle() {
    clearTimeout(decodeTimer);
    const vin = VIN.normalize($('form-vin').value);
    if (!VIN.valid(vin)) {
      vinFeedback('Enter a 17-character VIN without I, O, or Q.', 'invalid');
      return null;
    }
    if (vinState.vin === vin && vinState.status === 'ready') return vinState.name;
    if (vinState.vin === vin && vinState.status === 'loading') return vinState.promise;
    cancelDecode();
    const request = decodeRequest;
    const controller = new AbortController(); decodeController = controller;
    vinState = {vin, name:'', status:'loading'};
    $('manual-entry').hidden = true; $('retry-vin').hidden = true;
    vinFeedback('Finding vehicle details…', 'loading');
    const promise = (async () => {
      try {
        const name = await VIN.decode(vin, {signal:controller.signal});
        if (request !== decodeRequest || !$('vehicle-dialog').open) return null;
        vinState = {vin, name, status:'ready'};
        vinFeedback('NHTSA', 'ready', name);
        motion($('decoded-name'), [{opacity:0,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}]);
        $('manual-entry').hidden = !editingId; updateVinButton();
        return name;
      } catch (err) {
        if (request !== decodeRequest || !$('vehicle-dialog').open) return null;
        vinState = {vin, name:'', status:'error'};
        vinFeedback(err.message || 'Could not find this vehicle. Enter details manually.', 'error');
        $('manual-entry').textContent = 'Enter details manually';
        $('manual-entry').hidden = false; $('retry-vin').hidden = false; updateVinButton();
        return null;
      }
    })();
    vinState.promise = promise;
    return promise;
  }
  function closeForm() {
    if (busy || $('vehicle-dialog').classList.contains('closing')) return;
    cancelDecode(); dialogToken++; vinSubmitting = false;
    const dialog = $('vehicle-dialog');
    const closingToken = dialogToken;
    const finish = () => {
      if (closingToken !== dialogToken) return;
      dialog.close(); dialog.classList.remove('closing'); updateVinButton();
      if (formReturnFocus?.isConnected && !formReturnFocus.closest('[hidden]')) formReturnFocus.focus();
      else if (user && loaded) (selectedId && current() ? $('vehicle-title') : $('add-vehicle')).focus();
    };
    if (reducedMotion.matches) {finish(); return;}
    dialog.classList.add('closing'); updateVinButton();
    // The timeout also handles a preference change or a hidden tab mid-animation.
    let finished = false;
    const done = () => {if (finished) return; finished = true; clearTimeout(timer); dialog.removeEventListener('animationend',end); finish();};
    const end = e => {if (e.target === dialog && e.animationName === 'dialog-out') done();};
    const timer = setTimeout(done,200);
    dialog.addEventListener('animationend',end);
  }
  function openForm(id = null) {
    if (busy || (!id && readRoute()) || !unsaved()) return;
    cancelDecode(); dialogToken++; vinSubmitting = false;
    dirty = false; restoreDrafts([]); $('add-expense-form').reset(); render(); editingId = id;
    const c = cars.find(v => v.id === id);
    $('dialog-title').textContent = c ? 'Edit vehicle' : 'Add vehicle';
    $('form-name').value = c?.name || ''; $('form-name').required = false;
    $('form-vin').value = c?.vin || ''; $('form-vin').required = !c || !!c.vin;
    $('manual-details').hidden = true; $('retry-vin').hidden = true;
    $('manual-entry').hidden = !c; $('manual-entry').textContent = 'Correct details';
    vinState = {vin:c?.vin || '', name:c?.name || '', status:c ? 'ready' : 'idle'};
    vinFeedback(c ? '' : '17-character VIN', c ? 'ready' : 'idle', c?.name || '');
    $('delete-vehicle').hidden = !c; $('form-error').textContent = '';
    formReturnFocus = document.activeElement;
    $('vehicle-dialog').classList.remove('closing'); $('vehicle-dialog').showModal();
    updateVinButton(); $('form-vin').focus();
  }
  $('form-vin').addEventListener('input', () => {
    cancelDecode(); dialogToken++; vinSubmitting = false;
    const input = $('form-vin'); input.value = VIN.normalize(input.value);
    vinState = {vin:input.value, name:'', status:'idle'};
    $('form-name').value = ''; $('form-name').required = false; $('manual-details').hidden = true;
    $('manual-entry').hidden = true; $('retry-vin').hidden = true; $('form-error').textContent = '';
    if (VIN.valid(input.value)) {
      vinFeedback('Finding vehicle details…', 'loading');
      decodeTimer = setTimeout(decodeVehicle,250);
    } else {
      vinFeedback(input.value ? 'Enter a 17-character VIN without I, O, or Q.' : '17-character VIN', input.value ? 'invalid' : 'idle');
    }
    updateVinButton();
  });
  $('manual-entry').onclick = () => {
    cancelDecode();
    $('manual-details').hidden = false; $('form-name').required = true;
    $('form-name').value = vinState.name;
    $('manual-entry').hidden = true; $('retry-vin').hidden = true;
    updateVinButton(); $('form-name').focus();
  };
  $('retry-vin').onclick = () => {vinState.status = 'idle'; decodeVehicle();};
  $('add-vehicle').onclick = () => openForm(); $('edit-vehicle').onclick = () => openForm(selectedId);
  $('cancel-dialog').onclick = closeForm;
  $('vehicle-dialog').addEventListener('cancel', e => {e.preventDefault(); closeForm();});
  $('vehicle-form').onsubmit = async e => {
    e.preventDefault(); if (busy || vinSubmitting) return;
    const vin = VIN.normalize($('form-vin').value);
    const c = cars.find(v => v.id === editingId);
    const retainedEmptyVin = c && c.vin === '' && vin === '';
    if (!retainedEmptyVin && !VIN.valid(vin)) {vinFeedback('Enter a 17-character VIN without I, O, or Q.','invalid'); $('form-vin').focus(); return;}
    const token = dialogToken;
    let name;
    if (!$('manual-details').hidden) name = $('form-name').value.trim();
    else if (c && vin === c.vin && vinState.status === 'ready') name = vinState.name;
    else {
      vinSubmitting = true; updateVinButton();
      name = await decodeVehicle();
      if (token !== dialogToken || !$('vehicle-dialog').open) return;
      vinSubmitting = false; updateVinButton();
    }
    if (!name) {
      if (!$('manual-details').hidden) {$('form-error').textContent = 'Enter the vehicle’s year, make, and model.'; $('form-name').focus();}
      return;
    }
    $('form-error').textContent = '';
    const ok = c ? await saveCar(c,{name,vin,...(vin !== c.vin ? {estimated_value:null,valuation_source:null,valuation_updated_at:null} : {})}) : await operation(() => client.from('vehicles').insert({user_id:user.id,name,vin}).select().single(), data => {cars.push(data); setRoute(data.id);});
    if (ok) closeForm();
  };
  $('delete-vehicle').onclick = async () => {
    const c = cars.find(v => v.id === editingId);
    if (!c || !confirm(`Delete ${c.name} and all its expenses?`)) return;
    const ok = await operation(() => client.from('vehicles').delete().eq('id',c.id).eq('revision',c.revision).select().single(), () => {cars = cars.filter(v => v.id !== c.id); setRoute(null,true);});
    if (ok) closeForm();
  };
  $('edit-expenses').onclick = async () => {
    if (busy || !current()) return;
    if (!expenseEditing) {expenseEditing = true; renderExpenses(current()); $('expense-list').querySelector('input')?.focus(); return;}
    while ($('expense-list').querySelector('form[data-dirty]')) {
      const row = $('expense-list').querySelector('form[data-dirty]');
      const description = row.elements.description.value.trim();
      if (!description) {row.elements.description.reportValidity(); return;}
      try {
        const value = amount(row.elements.amount.value);
        if (value === null) throw Error('Enter an expense amount.');
        const c = current();
        if (!await saveCar(c,{expenses:c.expenses.map(exp => exp.id === row.dataset.expense ? {...exp,description,amount:value} : exp)},row)) return;
      } catch (err) {status(err.message,true); return;}
    }
    expenseEditing = false; renderExpenses(current()); $('edit-expenses').focus();
  };
  $('cancel-expenses').onclick = () => {
    if (busy) return;
    if ($('expense-list').querySelector('form[data-dirty]') && !confirm('Discard unsaved expense edits?')) return;
    const drafts = draftsExcept(null).filter(draft => !draft.expense);
    expenseEditing = false; renderExpenses(current()); restoreDrafts(drafts); $('edit-expenses').focus();
  };
  $('add-expense-form').addEventListener('input',setDirty);
  $('add-expense-form').onsubmit = async e => {
    e.preventDefault(); const c = current(); if (!c) return;
    try {
      const description = $('expense-description').value.trim(); if (!description) return;
      const value = amount($('expense-amount').value); if (value === null) return;
      if (await saveCar(c,{expenses:[...c.expenses,{id:crypto.randomUUID(),description,amount:value}]}, $('add-expense-form'))) { $('add-expense-form').reset(); $('expense-description').focus(); }
    } catch (err) {status(err.message,true);}
  };
  function previewValues() {
    try {renderTotals({...current(),estimated_value:amount($('estimated-value').value),sold_price:$('sold-toggle').checked ? amount($('sold-price').value) : null});} catch (_) { /* Keep the last valid preview while an amount is incomplete. */ }
  }
  function valueChanges(c) {
    const estimated_value = amount($('estimated-value').value);
    const sold_price = $('sold-toggle').checked ? amount($('sold-price').value) : null;

    const changes = {};
    if (estimated_value !== c.estimated_value) Object.assign(changes,{estimated_value,valuation_source:estimated_value === null ? null : 'Manual',valuation_updated_at:estimated_value === null ? null : new Date().toISOString()});
    if ((!$('sold-toggle').checked || sold_price !== null) && sold_price !== c.sold_price) changes.sold_price = sold_price;
    return changes;
  }
  function queueValues() {
    valueQueued = true; clearTimeout(valueTimer);
    valueTimer = setTimeout(() => {if (!busy) flushValues();},0);
  }
  async function flushValues() {
    clearTimeout(valueTimer);
    if (valueTask) return valueTask;
    if (busy || !current()) return false;
    valueQueued = false;
    if (!$('value-form').dataset.dirty) return true;
    if (valueConflict) return false;
    let changes;
    try {changes = valueChanges(current());}
    catch (err) {status(err.message,true); return false;}
    if (!Object.keys(changes).length) {
      delete $('value-form').dataset.dirty;
      dirty = !!document.querySelector('#ledger form[data-dirty]');
      if (notice.scope === 'save') clearStatus();
      return true;
    }
    valueSaving = true;
    valueTask = saveCar(current(),changes,$('value-form'));
    try {return await valueTask;}
    finally {valueTask = null; valueSaving = false; if (valueQueued && !valueConflict) queueValues();}
  }
  $('value-form').oninput = e => {
    if (e.target.id === 'sold-toggle') return;
    clearTimeout(valueTimer); valueQueued = false;
    setDirty(); previewValues();
  };
  $('ledger').addEventListener('focusout', e => {
    if (e.target.matches('input[name=amount], #estimated-value, #sold-price')) formatInput(e.target);
  }, true);
  $('value-form').addEventListener('focusout', e => {
    if (e.target.id !== 'sold-toggle' && (!busy || valueSaving) && $('value-form').dataset.dirty) queueValues();
  });
  $('sold-toggle').onchange = () => {
    const toggle = $('sold-toggle');
    if (!toggle.checked && current()?.sold_price !== null) {
      if (!confirm('Clear the recorded sold price?')) {toggle.checked = true; return;}
      $('sold-price').value = '';
    }
    if (!toggle.checked) $('sold-price').value = '';
    $('sold-price').disabled = !toggle.checked;
    if (!toggle.checked || $('sold-price').value.trim()) {$('value-form').dataset.dirty = 'true'; setDirty();}
    previewValues();
    if (toggle.checked) $('sold-price').focus(); else queueValues();
  };
  $('ledger').addEventListener('input', e => {const form = e.target.closest('form'); if (form && e.target.id !== 'sold-toggle') form.dataset.dirty = 'true';});
  $('value-form').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) {e.preventDefault(); if (busy) valueQueued = true; else {formatInput(e.target); flushValues();}}
  });
  $('value-form').onsubmit = e => {e.preventDefault(); flushValues();};
  $('check-carfax').onclick = () => {
    const c = current(); if (c?.vin) navigator.clipboard?.writeText(c.vin).then(() => status('VIN copied · ZIP 73013',false,{scope:'info',duration:2000})).catch(() => status(`VIN ${c.vin} · ZIP 73013`,false,{scope:'info',duration:4000}));
  };
  window.addEventListener('beforeunload', e => {if (dirty || busy || ($('vehicle-dialog').open && $('form-vin').value)) {e.preventDefault(); e.returnValue = '';}});
  window.addEventListener('focus', () => {if (loaded && !recovery) load(true);});
  window.addEventListener('online', () => {if (loaded && !recovery) load(true);});
  setInterval(() => {if (loaded && !recovery && !document.hidden) load(true);},30000);
  async function init() {
    if (!configured) {status('Cloud saving is not configured.',false,{scope:'init'}); return;}
    if (!window.supabase) {status('The authentication library could not load. Reload to try again.',true); return;}
    // Reject JWT service-role keys as well as modern secret keys.
    try {if (config.supabasePublishableKey.startsWith('ey')) {const payload = JSON.parse(atob(config.supabasePublishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if (payload.role !== 'anon') throw Error('Only an anon or publishable key is allowed.');}}
    catch (err) {status('Invalid public Supabase key. Check config.js.',true); return;}
    client = window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    client.auth.onAuthStateChange((event,session) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true;
      // Defer database requests until Supabase releases its auth lock.
      setTimeout(async () => {await sessionChanged(session); if (event === 'PASSWORD_RECOVERY') authView('update');},0);
    });
    status('Loading…',false,{scope:'auth'});
    const {data,error} = await client.auth.getSession();
    if (error) {authView('login'); status(error.message,true,{scope:'auth'}); return;}
    if (data.session) await sessionChanged(data.session); else {authView('login'); clearStatus();}
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get('error_description')) status(params.get('error_description'),true);
  }
  init().catch(err => {status(err.message || 'Unable to start Carbook.',true); lock(false);});
})();
