const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app,fixture} = require('./browser-helpers.cjs');
const VIN = '1HGCM82633A004352', OTHER = '5UXWX7C5XBA000000';
const result = (overrides={}) => ({Results:[{ErrorCode:'0',ModelYear:'2003',Make:'HONDA',Model:'Accord',...overrides}]});
const respond = (route,data,status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const recordCount = page => page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles.length);

test('VIN-only entry: preview, validation, failure fallback, stale response cancellation', async () => {
  const env = await app();const {page}=env;
  try {
    let mode='success',requests=0,releaseOld;
    await page.route('https://vpic.nhtsa.dot.gov/**',async route=>{
      requests++;
      if (mode==='http-error') return respond(route,{},503);
      if (mode==='missing') return respond(route,result({Model:''}));
      if (mode==='slow' && route.request().url().includes(VIN)) {await new Promise(resolve=>releaseOld=resolve);return respond(route,result()).catch(()=>{});}
      return respond(route,route.request().url().includes(OTHER) ? result({ModelYear:'2011',Make:'BMW',Model:'X3'}) : result());
    });
    await page.screenshot({animations:'disabled',path:'/tmp/carbook-empty-refined.png'});
    await page.locator('#add-vehicle').click();
    assert.equal(await page.locator('#vehicle-form input:visible').count(),1);
    assert.equal(await page.locator('#form-vin').getAttribute('placeholder'),null);
    await page.locator('#form-vin').fill('invalid');
    await page.locator('#save-vehicle').click();
    assert.equal(await page.locator('#form-vin').evaluate(input=>input.checkValidity()),false);
    assert.equal(requests,0);assert.equal(await recordCount(page),0);
    await page.locator('#form-vin').fill(' 1hgcm82633a004352 ');
    await page.locator('#decoded-name').getByText('2003 HONDA Accord').waitFor();
    assert.equal(await page.locator('#form-vin').inputValue(),VIN);
    assert.equal(await recordCount(page),0); // Decoding never saves a vehicle by itself.
    await page.screenshot({animations:'disabled',path:'/tmp/carbook-vin-refined.png'});
    await page.locator('#form-vin').press('Enter');
    await page.locator('#vehicle-title').getByText('2003 HONDA Accord').waitFor();
    await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    assert.equal(await recordCount(page),1);
    // Incomplete details never become an invented display name.
    mode='missing';await page.locator('#back-garage').click();await page.locator('#add-vehicle').click();await page.locator('#form-vin').fill(VIN);
    await page.locator('#vin-status').getByText('NHTSA returned incomplete details.',{exact:false}).waitFor();
    assert.equal(await page.locator('#decoded-name').isVisible(),false);
    assert.equal(await page.locator('#save-vehicle').isDisabled(),true);
    await page.locator('#cancel-dialog').click();await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    // Network/provider failure exposes a discreet manual correction, never fake data.
    mode='http-error';await page.locator('#add-vehicle').click();await page.locator('#form-vin').fill(VIN);
    await page.locator('#manual-entry').waitFor({state:'visible'});
    await page.locator('#manual-entry').click();await page.locator('#form-name').fill('2003 Honda Accord EX');
    await page.locator('#save-vehicle').click();await page.locator('#vehicle-title').getByText('2003 Honda Accord EX',{exact:true}).waitFor();
    await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    // A delayed result for an old VIN cannot replace the current one.
    mode='slow';await page.locator('#back-garage').click();await page.locator('#add-vehicle').click();await page.locator('#form-vin').fill(VIN);
    await page.waitForFunction(()=>document.getElementById('vin-feedback').getAttribute('aria-busy')==='true');
    for (let attempt=0; !releaseOld && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(releaseOld,'old VIN request started');
    await page.locator('#form-vin').fill(OTHER);await page.locator('#decoded-name').getByText('2011 BMW X3').waitFor();
    releaseOld();await page.locator('#save-vehicle').click();await page.locator('#vehicle-title').getByText('2011 BMW X3').waitFor();
    await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles);
    assert.equal(data.at(-1).vin,OTHER);assert.equal(data.at(-1).name,'2011 BMW X3');
    // Escape closes with restored focus; no delayed response leaks into another dialog.
    mode='success';await page.locator('#back-garage').click();await page.locator('#add-vehicle').click();await page.keyboard.press('Escape');await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#add-vehicle').evaluate(el=>el===document.activeElement),true);
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('authentication fields expose native password-manager semantics and submit autofilled values', async()=>{
  const env=await app({signedIn:false});const {page}=env;
  try {
    const fields=await page.locator('#auth input').evaluateAll(inputs=>inputs.map(el=>({id:el.id,name:el.name,type:el.type,autocomplete:el.autocomplete,form:el.form.id,labels:el.labels.length,disabled:el.disabled})));
    for (const field of fields) {assert.ok(field.name);assert.ok(field.labels);assert.equal(field.disabled,false);}
    for (const id of ['email','signup-email','reset-email','update-email']) assert.equal(fields.find(f=>f.id===id).autocomplete,'username');
    assert.equal(fields.find(f=>f.id==='password').autocomplete,'current-password');
    for (const id of ['signup-password','update-password']) assert.equal(fields.find(f=>f.id===id).autocomplete,'new-password');
    assert.equal(await page.locator('#auth-form').getAttribute('method'),'post');
    await page.screenshot({animations:'disabled',path:'/tmp/carbook-login-refined.png'});
    await page.locator('#auth-toggle').click();await page.locator('#signup-form').waitFor({state:'visible'});
    await page.locator('#signup-email').fill('new@example.com');await page.locator('#signup-password').fill('generated-Strong-Password-123');
    assert.equal(await page.locator('#signup-password').getAttribute('pattern'),null);
    await page.locator('#signup-password').press('Enter');await page.locator('#auth-title').getByText('Check your email').waitFor();
    assert.equal(await page.locator('#signup-password').inputValue(),'generated-Strong-Password-123');
    await page.locator('#auth-toggle').click();
    // Value assignment without input/change events models password-manager autofill.
    await page.evaluate(()=>{document.getElementById('email').value='autofilled@example.com';document.getElementById('password').value='autofilled-password';});
    await page.locator('#password').press('Enter');await page.locator('#ledger').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test.session')).user.email),'autofilled@example.com');
    assert.equal(await page.locator('#password').inputValue(),'autofilled-password');
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('refined layouts, reduced motion, stable saving status, and safe vehicle editing', async()=>{
  const env=await app({records:[fixture],route:'?vehicle=test-car'});const {page}=env;
  try {
    let requests=0;
    await page.route('https://vpic.nhtsa.dot.gov/**',route=>{requests++;return respond(route,result({ModelYear:'2011',Make:'BMW',Model:'X3'}));});
    await page.screenshot({animations:'disabled',path:'/tmp/carbook-desktop-refined.png',fullPage:true});
    const shellWidth=await page.locator('.shell').evaluate(el=>el.getBoundingClientRect().width);assert.ok(shellWidth<=1100&&shellWidth>=1000);
    assert.equal(await page.locator('#expense-list input[type=number]').first().inputValue(),'6500.00');
    const top=await page.locator('#vehicle-view').evaluate(el=>el.getBoundingClientRect().top);
    await page.locator('#estimated-value').fill('8600');
    assert.equal(await page.locator('#vehicle-view').evaluate(el=>el.getBoundingClientRect().top),top);
    await page.locator('#estimated-value').blur();await page.locator('#status').getByText('Saved',{exact:true}).waitFor();
    assert.equal(await page.locator('#vehicle-view').evaluate(el=>el.getBoundingClientRect().top),top);
    await page.locator('#edit-vehicle').click();assert.equal(requests,0);
    await page.locator('#manual-entry').click();await page.locator('#form-name').fill('2003 Honda Accord EX');await page.locator('#save-vehicle').click();
    await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    let car=await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0]);
    assert.deepEqual(car.expenses,fixture.expenses);assert.equal(car.estimated_value,8600);assert.equal(car.vin,VIN);
    for (const width of [760,390,360,320]) {
      await page.setViewportSize({width,height:850});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no overflow at ${width}`);
      const amount=await page.locator('#add-expense-form .money-input').boundingBox();assert.ok(amount.width>=85);
      await page.locator('#edit-vehicle').click();
      assert.equal(await page.locator('#vehicle-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`modal does not overflow at ${width}`);
      await page.locator('#cancel-dialog').click();await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
      if (width===390) await page.screenshot({animations:'disabled',path:'/tmp/carbook-mobile-refined.png',fullPage:true});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#edit-vehicle').click();
    assert.equal(await page.locator('#vehicle-dialog').evaluate(el=>el.getAnimations().length),0);
    await page.locator('#form-vin').fill(OTHER);await page.locator('#decoded-name').getByText('2011 BMW X3').waitFor();
    // A failed cloud save keeps the decoded result and an error inside the modal.
    await page.evaluate(()=>localStorage.setItem('test.fail','1'));await page.locator('#save-vehicle').click();await page.locator('#form-error').getByText('Network unavailable',{exact:false}).waitFor();
    assert.equal(await page.locator('#form-vin').inputValue(),OTHER);
    await page.evaluate(()=>localStorage.removeItem('test.fail'));await page.locator('#save-vehicle').click();await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    car=await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0]);
    assert.equal(car.estimated_value,null);assert.equal(car.valuation_source,null);assert.deepEqual(car.expenses,fixture.expenses);
    assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('official NHTSA VIN decode in a browser (opt-in network check)', {skip:!process.env.CARBOOK_LIVE_VIN}, async()=>{
  const env=await app();
  try {
    await env.page.locator('#add-vehicle').click();await env.page.locator('#form-vin').fill(VIN);
    await env.page.locator('#decoded-name').getByText('2003 HONDA Accord').waitFor({timeout:15000});
    assert.equal(await recordCount(env.page),0);
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('garage cards, direct links, refresh, browser history, and no migration experience', async()=>{
  const records=[fixture,
    {...fixture,id:'sold-car',name:'2013 BMW 135i',expenses:[{id:'buy',description:'Purchase',amount:10000}],sold_price:12500},
    {...fixture,id:'unvalued-car',name:'2018 Volvo V60',vin:'',expenses:[],estimated_value:null},
    {...fixture,id:'zero-car',name:'2008 Honda Fit',expenses:[],estimated_value:0}
  ];
  const legacy='An untouched legacy browser backup';
  const env=await app({records,legacy});const {page,url}=env;
  try {
    assert.equal(await page.locator('.vehicle-card').count(),4);
    assert.equal(await page.locator('#vehicle-select').count(),0);
    assert.equal(await page.locator('#import-prompt, #import-local, #dismiss-import').count(),0);
    assert.equal(await page.locator('#status-bar').isVisible(),false);
    assert.equal(await page.locator('[data-vehicle="test-car"] .card-profit strong').textContent(),'$1,300.50');
    assert.equal(await page.locator('[data-vehicle="sold-car"] .card-profit span').textContent(),'Actual profit');
    assert.equal(await page.locator('[data-vehicle="sold-car"] .card-profit strong').textContent(),'$2,500.00');
    assert.equal(await page.locator('[data-vehicle="unvalued-car"] .card-profit').count(),0);
    assert.equal(await page.locator('[data-vehicle="zero-car"] .card-profit strong').textContent(),'$0.00');
    await page.screenshot({animations:'disabled',path:'/tmp/carbook-garage-desktop.png',fullPage:true});
    for (const width of [760,390,320]) {
      await page.setViewportSize({width,height:850});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(width===390) await page.screenshot({animations:'disabled',path:'/tmp/carbook-garage-mobile.png',fullPage:true});
    }
    await page.setViewportSize({width:1280,height:900});
    await page.locator('[data-vehicle="test-car"]').focus();await page.keyboard.press('Enter');
    await page.locator('#vehicle-title').getByText(fixture.name,{exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('vehicle'),fixture.id);
    assert.equal(await page.locator('#add-vehicle').isVisible(),false);
    assert.equal(await page.locator('.expense-head, #expenses-empty').count(),0);
    assert.equal(await page.locator('#vehicle-title').evaluate(el=>el===document.activeElement),true);
    await page.reload();await page.locator('#vehicle-view').waitFor({state:'visible'});
    assert.equal(await page.locator('#vehicle-title').textContent(),fixture.name);
    assert.equal(await page.locator('#status-bar').isVisible(),false);
    await page.goBack();await page.locator('#garage').waitFor({state:'visible'});
    await page.goForward();await page.locator('#vehicle-view').waitFor({state:'visible'});
    await page.locator('#back-garage').click();await page.locator('[data-vehicle="sold-car"]').click();
    await page.locator('#vehicle-title').getByText('2013 BMW 135i',{exact:true}).waitFor();
    assert.equal(await page.locator('#profit-label').textContent(),'Actual profit');
    await page.goto(url+'?vehicle=unvalued-car');await page.locator('#vehicle-view').waitFor({state:'visible'});
    assert.equal(await page.locator('#vehicle-title').textContent(),'2018 Volvo V60');
    assert.equal(await page.locator('#profit').textContent(),'—');
    await page.goto(url+'?vehicle=missing');await page.locator('#vehicle-missing').waitFor({state:'visible'});
    assert.equal(await page.locator('#add-vehicle').isVisible(),false);
    await page.locator('#back-garage').click();await page.locator('#garage').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>localStorage.getItem('carbook.records.v2')),legacy);
    assert.equal(await page.evaluate(()=>window.testCloudCalls.every(call=>call.table==='vehicles'&&call.type==='select')),true);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles),records);
    await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-vehicle="test-car"]').click();
    assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('unsaved browser navigation is reversible and active saves retain the correct vehicle', async()=>{
  const env=await app({records:[fixture]});const {page}=env;
  try {
    await page.locator('.vehicle-card').click();await page.locator('#vehicle-view').waitFor({state:'visible'});
    await page.locator('#estimated-value').fill('9999');
    const historyLength=await page.evaluate(()=>history.length);
    page.removeAllListeners('dialog');
    const rejected=page.waitForEvent('dialog');await page.evaluate(()=>history.back());await (await rejected).dismiss();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('vehicle')==='test-car'&&history.state.carbookIndex===1);
    assert.equal(await page.locator('#estimated-value').inputValue(),'9999');
    assert.equal(await page.evaluate(()=>history.length),historyLength);
    const accepted=page.waitForEvent('dialog');await page.evaluate(()=>history.back());await (await accepted).accept();
    await page.locator('#garage').waitFor({state:'visible'});
    await page.goForward();await page.locator('#vehicle-view').waitFor({state:'visible'});
    assert.equal(await page.locator('#estimated-value').inputValue(),'8500');
    await page.evaluate(()=>localStorage.setItem('test.saveDelay','450'));
    await page.locator('#estimated-value').fill('8600');await page.locator('#estimated-value').blur();
    await page.locator('#status').getByText('Saving…',{exact:true}).waitFor();
    await page.evaluate(()=>history.back());
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('vehicle')==='test-car'&&history.state.carbookIndex===1);
    await page.locator('#status').getByText('Saved',{exact:true}).waitFor();
    assert.equal(await page.locator('#vehicle-view').isVisible(),true);
    assert.equal(await page.locator('#estimated-value').inputValue(),'8600');
    await page.goBack();await page.locator('#garage').waitFor({state:'visible'});
    assert.equal(await page.locator('.card-profit strong').textContent(),'$1,400.50');
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('save feedback waits for confirmation, expires without layout space, and preserves errors', async()=>{
  const env=await app({records:[fixture],route:'?vehicle=test-car'});const {page}=env;
  try {
    await page.screenshot({animations:'disabled',path:'/tmp/carbook-detail-desktop.png',fullPage:true});
    const top=await page.locator('#vehicle-view').evaluate(el=>el.getBoundingClientRect().top);
    assert.equal(await page.locator('#status-bar').isVisible(),false);
    await page.evaluate(()=>localStorage.setItem('test.saveDelay','350'));
    await page.locator('#estimated-value').fill('8600');await page.locator('#estimated-value').blur();
    await page.locator('#status').getByText('Saving…',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].estimated_value),8500);
    await page.locator('#status').getByText('Saved',{exact:true}).waitFor();
    const confirmed=Date.now();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].estimated_value),8600);
    await page.waitForTimeout(1400);assert.equal(await page.locator('#status').textContent(),'Saved');
    await page.locator('#status-bar').waitFor({state:'hidden',timeout:2000});
    assert.ok(Date.now()-confirmed>=1800);assert.ok(Date.now()-confirmed<3500);
    assert.equal(await page.locator('#vehicle-view').evaluate(el=>el.getBoundingClientRect().top),top);
    assert.equal(await page.locator('#status-bar').evaluate(el=>el.getBoundingClientRect().height),0);
    await page.evaluate(()=>{localStorage.removeItem('test.saveDelay');localStorage.setItem('test.failSave','1');});
    await page.locator('#estimated-value').fill('9000');await page.locator('#estimated-value').blur();
    await page.locator('#status').getByText('Network unavailable',{exact:true}).waitFor();
    await page.locator('#estimated-value').fill('9100');await page.locator('#estimated-value').blur();
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(2400);
    assert.equal(await page.locator('#status').textContent(),'Network unavailable');
    assert.equal(await page.locator('#estimated-value').inputValue(),'9100');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].estimated_value),8600);
    await page.evaluate(()=>localStorage.removeItem('test.failSave'));await page.locator('#retry').click();
    await page.locator('#status').getByText('Saved',{exact:true}).waitFor();
    await page.reload();await page.locator('#vehicle-view').waitFor({state:'visible'});
    assert.equal(await page.locator('#status-bar').isVisible(),false);
    await page.setViewportSize({width:390,height:850});await page.screenshot({animations:'disabled',path:'/tmp/carbook-detail-mobile.png',fullPage:true});
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('a direct vehicle link survives login without touching browser-local records', async()=>{
  const legacy=JSON.stringify([{id:'old-record',name:'Local only',expenses:[]}]);
  const env=await app({signedIn:false,records:[fixture],route:'?vehicle=test-car',legacy});const {page}=env;
  try {
    await page.locator('#email').fill('test@example.com');await page.locator('#password').fill('password123');await page.locator('#password').press('Enter');
    await page.locator('#vehicle-title').getByText(fixture.name,{exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('vehicle'),'test-car');
    assert.equal(await page.locator('#import-prompt').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('carbook.records.v2')),legacy);
    assert.equal(await page.evaluate(()=>window.testCloudCalls.every(call=>call.type==='select'&&call.table==='vehicles')),true);
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('value autosaving validates complete amounts, retries safely, and preserves sold information', async()=>{
  const env=await app({records:[fixture],route:'?vehicle=test-car'});const {page}=env;
  const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0]);
  const settled=()=>page.waitForFunction(()=>document.getElementById('ledger').getAttribute('aria-busy')==='false');
  try {
    assert.equal(await page.locator('#value-form button, #value-source, #value-dirty').count(),0);
    assert.equal(await page.locator('#check-carfax').textContent(),'CARFAX Value');
    assert.equal(await page.locator('#sold-price').isDisabled(),true);
    assert.equal(await page.locator('#expense-description').getAttribute('placeholder'),null);
    assert.equal(await page.locator('#expense-amount').evaluate(el=>getComputedStyle(el).textAlign),'left');
    for (const value of ['12.','.','-','1.234']) {
      await page.locator('#estimated-value').fill(value);await page.locator('#estimated-value').blur();
      await page.locator('#status.error').waitFor();assert.equal((await stored()).estimated_value,8500);
    }
    await page.locator('#estimated-value').fill('9200');await page.waitForTimeout(400);
    assert.equal((await stored()).estimated_value,8500,'typing does not save before blur');
    await page.locator('#estimated-value').blur();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].estimated_value===9200);await settled();
    assert.equal((await stored()).valuation_source,'Manual');assert.notEqual((await stored()).valuation_updated_at,fixture.valuation_updated_at);
    await page.locator('#sold-toggle').check();await page.locator('#sold-price').blur();
    await page.locator('#status').getByText('Enter a sold price or turn Sold off.').waitFor();
    assert.equal((await stored()).sold_price,null);
    await page.locator('#sold-price').fill('0');await page.locator('#sold-price').blur();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].sold_price===0);await settled();
    await page.reload();await page.locator('#vehicle-view').waitFor();
    assert.equal(await page.locator('#sold-toggle').isChecked(),true);assert.equal(await page.locator('#profit-label').textContent(),'Actual profit');
    page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.dismiss());
    await page.locator('#sold-toggle').click();assert.equal(await page.locator('#sold-toggle').isChecked(),true);assert.equal((await stored()).sold_price,0);
    page.on('dialog',dialog=>dialog.accept());await page.locator('#sold-toggle').uncheck();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].sold_price===null);await settled();
    assert.equal(await page.locator('#sold-price').isDisabled(),true);
    // Conflicts retain the edited value and merge only that field after explicit approval.
    await page.evaluate(()=>{const db=JSON.parse(localStorage.getItem('test.db'));db.vehicles[0].revision++;db.vehicles[0].sold_price=10000;db.vehicles[0].expenses.push({id:'remote',description:'Remote repair',amount:50});localStorage.setItem('test.db',JSON.stringify(db));});
    await page.locator('#estimated-value').fill('9400');await page.locator('#estimated-value').blur();
    await page.locator('#status').getByText('This vehicle changed',{exact:false}).waitFor();
    assert.equal(await page.locator('#estimated-value').inputValue(),'9400');
    await page.locator('#retry').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].estimated_value===9400);await settled();
    assert.equal((await stored()).sold_price,10000);assert.equal((await stored()).expenses.at(-1).description,'Remote repair');
    // A completed pending value saves before internal navigation, then survives reload.
    await page.locator('#estimated-value').fill('9450');await page.locator('#estimated-value').press('Enter');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].estimated_value===9450);await settled();
    await page.locator('#estimated-value').fill('9500');await page.locator('#back-garage').click();await page.locator('#garage').waitFor();
    assert.equal((await stored()).estimated_value,9500);
    await page.locator('.vehicle-card').click();await page.reload();await page.locator('#vehicle-view').waitFor();
    assert.equal(await page.locator('#estimated-value').inputValue(),'9500');assert.equal(await page.locator('#sold-price').inputValue(),'10000');
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

test('in-flight value saves preserve newer typing and expense drafts', async()=>{
  const env=await app({records:[fixture],route:'?vehicle=test-car'});const {page}=env;
  try {
    await page.evaluate(()=>localStorage.setItem('test.saveDelay','450'));
    await page.locator('#estimated-value').fill('9000');await page.locator('#estimated-value').blur();
    await page.locator('#status').getByText('Saving…',{exact:true}).waitFor();
    await page.locator('#estimated-value').fill('9100');await page.locator('#estimated-value').blur();
    await page.locator('#expense-description').fill('New repair');await page.locator('#expense-amount').fill('24.50');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].estimated_value===9100);
    await page.waitForFunction(()=>document.getElementById('ledger').getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('#expense-description').inputValue(),'New repair');
    assert.equal(await page.locator('#expense-amount').inputValue(),'24.50');
    await page.locator('#add-expense-form button').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0].expenses.length===5);
    await page.reload();await page.locator('#vehicle-view').waitFor();
    assert.equal(await page.locator('#estimated-value').inputValue(),'9100');
    assert.equal(await page.locator('#expense-total').textContent(),'$7,224.00');
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});
