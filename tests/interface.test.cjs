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
    await page.locator('#empty-add').click();
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
    mode='missing';await page.locator('#add-vehicle').click();await page.locator('#form-vin').fill(VIN);
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
    mode='slow';await page.locator('#add-vehicle').click();await page.locator('#form-vin').fill(VIN);
    await page.waitForFunction(()=>document.getElementById('vin-feedback').getAttribute('aria-busy')==='true');
    for (let attempt=0; !releaseOld && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(releaseOld,'old VIN request started');
    await page.locator('#form-vin').fill(OTHER);await page.locator('#decoded-name').getByText('2011 BMW X3').waitFor();
    releaseOld();await page.locator('#save-vehicle').click();await page.locator('#vehicle-title').getByText('2011 BMW X3').waitFor();
    await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles);
    assert.equal(data.at(-1).vin,OTHER);assert.equal(data.at(-1).name,'2011 BMW X3');
    // Escape closes with restored focus; no delayed response leaks into another dialog.
    mode='success';await page.locator('#add-vehicle').click();await page.keyboard.press('Escape');await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
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
  const env=await app({records:[fixture]});const {page}=env;
  try {
    let requests=0;
    await page.route('https://vpic.nhtsa.dot.gov/**',route=>{requests++;return respond(route,result({ModelYear:'2011',Make:'BMW',Model:'X3'}));});
    await page.screenshot({animations:'disabled',path:'/tmp/carbook-desktop-refined.png',fullPage:true});
    const shellWidth=await page.locator('.shell').evaluate(el=>el.getBoundingClientRect().width);assert.ok(shellWidth<=1100&&shellWidth>=1000);
    assert.equal(await page.locator('#expense-list input[type=number]').first().inputValue(),'6500.00');
    const top=await page.locator('#vehicle-view').evaluate(el=>el.getBoundingClientRect().top);
    await page.locator('#estimated-value').fill('8600');
    assert.equal(await page.locator('#vehicle-view').evaluate(el=>el.getBoundingClientRect().top),top);
    await page.locator('#value-form button').click();await page.locator('#status').getByText('Saved',{exact:true}).waitFor();
    assert.equal(await page.locator('#vehicle-view').evaluate(el=>el.getBoundingClientRect().top),top);
    await page.locator('#edit-vehicle').click();assert.equal(requests,0);
    await page.locator('#manual-entry').click();await page.locator('#form-name').fill('2003 Honda Accord EX');await page.locator('#save-vehicle').click();
    await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    let car=await page.evaluate(()=>JSON.parse(localStorage.getItem('test.db')).vehicles[0]);
    assert.deepEqual(car.expenses,fixture.expenses);assert.equal(car.estimated_value,8600);assert.equal(car.vin,VIN);
    for (const width of [760,390,360,320]) {
      await page.setViewportSize({width,height:850});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no overflow at ${width}`);
      const amount=await page.locator('#expense-amount').boundingBox();assert.ok(amount.width>=85);
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
    await env.page.locator('#empty-add').click();await env.page.locator('#form-vin').fill(VIN);
    await env.page.locator('#decoded-name').getByText('2003 HONDA Accord').waitFor({timeout:15000});
    assert.equal(await recordCount(env.page),0);
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});
