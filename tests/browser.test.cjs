const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname,'..');

test('browser flows with mocked Supabase, desktop and mobile', async () => {
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    const file = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403); return res.end();}
    fs.readFile(file,(error,data) => {res.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(error?'Not found':data);});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',err=>errors.push(err.message));
    const url=`http://127.0.0.1:${server.address().port}/`;
    // Tests must never use a checkout's real cloud configuration.
    await page.route('**/config.js',route=>route.fulfill({contentType:'application/javascript',body:"window.CARBOOK_CONFIG={supabaseUrl:'',supabasePublishableKey:''};"}));
    await page.goto(url);
    await page.getByText('Cloud saving is not configured.',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>typeof window.supabase.createClient),'function');
    await page.route('**/config.js',route=>route.fulfill({contentType:'application/javascript',body:"window.CARBOOK_CONFIG={supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_publishable_test'};"}));
    await page.route('**/vendor/supabase.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8')}));
    await page.route('https://vpic.nhtsa.dot.gov/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({Results:[{ErrorCode:'0',ModelYear:'2013',Make:'BMW',Model:'135i'}]})}));
    await page.reload();await page.locator('#email').fill('first@example.com');await page.locator('#password').fill('wrong');await page.locator('#auth-submit').click();await page.getByText('Invalid login credentials').waitFor();
    await page.locator('#forgot').click();await page.locator('#reset-submit').click();await page.getByText('If this email has an account,',{exact:false}).waitFor();
    await page.locator('#auth-toggle').click();await page.locator('#auth-toggle').click();await page.locator('#signup-password').fill('password123');await page.locator('#signup-submit').click();await page.locator('#auth-title').getByText('Check your email',{exact:true}).waitFor();
    await page.locator('#auth-toggle').click();await page.locator('#password').fill('password123');await page.locator('#auth-submit').click();await page.locator('#ledger').waitFor({state:'visible'});
    await page.locator('#add-vehicle').click();
    assert.equal(await page.locator('#vehicle-form input:visible').count(),1);
    await page.locator('#form-vin').fill('wbauc9c50dvm13012');await page.locator('#decoded-name').getByText('2013 BMW 135i').waitFor();await page.locator('#vehicle-form button[type=submit]').click();await page.locator('#vehicle-title').getByText('2013 BMW 135i').waitFor();await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    const addExpense=async(description,value)=>{await page.locator('#expense-description').fill(description);await page.locator('#expense-amount').fill(value);await page.locator('#add-expense-form button').click();await page.locator('#expense-list input').first().waitFor();await page.waitForFunction(text=>[...document.querySelectorAll('#expense-list input')].some(input=>input.value===text),description);};
    await addExpense('Purchase','10000');await addExpense('Repair','250.25');
    assert.equal(await page.locator('#expense-total').textContent(),'$10,250.25');assert.equal(await page.locator('#profit').textContent(),'—');
    await page.locator('#estimated-value').fill('12000');await page.locator('#value-form button').click();await page.getByText('Manual ·',{exact:false}).waitFor();assert.equal(await page.locator('#profit').textContent(),'$1,749.75');
    await page.locator('#sold-price').fill('12500');await page.locator('#value-form button').click();await page.locator('#profit-label').getByText('Actual profit',{exact:true}).waitFor();assert.equal(await page.locator('#profit').textContent(),'$2,249.75');
    // Saving one form must retain drafts in other forms.
    await page.locator('#estimated-value').fill('13000');
    const repair=page.locator('#expense-list form').nth(1);await repair.locator('input[type=number]').fill('200');await repair.getByRole('button',{name:'Save Repair',exact:true}).click();
    assert.equal(await page.locator('#estimated-value').inputValue(),'13000');assert.equal(await page.locator('#value-dirty').isVisible(),true);
    await page.locator('#sold-price').fill('');await page.locator('#value-form button').click();await page.locator('#profit-label').getByText('Potential profit',{exact:true}).waitFor();assert.equal(await page.locator('#profit').textContent(),'$2,800.00');
    await page.reload();await page.locator('#vehicle-view').waitFor({state:'visible'});assert.equal(await page.locator('#estimated-value').inputValue(),'13000');
    // Failed saves leave drafts and never change the persisted record.
    await page.evaluate(()=>localStorage.setItem('test.fail','1'));
    await page.locator('#sold-price').fill('14000');await page.locator('#value-form button').click();await page.getByText('Network unavailable',{exact:false}).waitFor();assert.equal(await page.locator('#sold-price').inputValue(),'14000');
    await page.evaluate(()=>localStorage.removeItem('test.fail'));await page.locator('#value-form button').click();await page.getByText('Saved',{exact:true}).waitFor();
    // Focus refresh picks up a remote change while idle.
    await page.locator('#sold-price').blur();
    await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('test.db'));d.vehicles[0].sold_price=14500;d.vehicles[0].revision++;localStorage.setItem('test.db',JSON.stringify(d));window.dispatchEvent(new Event('focus'));});
    await page.waitForFunction(()=>document.getElementById('sold-price').value==='14500');
    // Reject a stale revision and preserve its form contents.
    await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('test.db'));d.vehicles[0].revision++;localStorage.setItem('test.db',JSON.stringify(d));});
    await page.locator('#sold-price').fill('15000');await page.locator('#value-form button').click();await page.getByText('This vehicle changed on another device.',{exact:false}).waitFor();assert.equal(await page.locator('#sold-price').inputValue(),'15000');
    page.on('dialog',dialog=>dialog.accept());await page.reload();await page.locator('#vehicle-view').waitFor({state:'visible'});
    await page.locator('#edit-vehicle').click();await page.locator('#manual-entry').click();await page.locator('#form-name').fill('BMW project');await page.locator('#vehicle-form button[type=submit]').click();await page.locator('#vehicle-title').getByText('BMW project').waitFor();await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Remove Repair',exact:true}).click();await page.getByRole('button',{name:'Remove Repair',exact:true}).waitFor({state:'detached'});
    // Account separation in the mock (real RLS requires the SQL tests/live checks).
    await page.locator('#logout').click();await page.locator('#email').fill('second@example.com');await page.locator('#password').fill('password123');await page.locator('#auth-submit').click();await page.locator('#empty-state').waitFor({state:'visible'});
    // Old browser records remain untouched and never trigger migration UI or writes.
    const legacy=JSON.stringify([{id:'old-car',year:'2014',make:'Honda',model:'Civic',vin:'',estimatedValue:9000,soldPrice:null,expenses:[{description:'Purchase',amount:5000}]}]);
    await page.evaluate(raw=>localStorage.setItem('carbook.records.v2',raw),legacy);await page.reload();await page.locator('#garage').waitFor({state:'visible'});
    assert.equal(await page.locator('#import-prompt').count(),0);
    assert.equal(await page.locator('.vehicle-card').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('carbook.records.v2')),legacy);
    assert.equal(await page.evaluate(()=>window.testCloudCalls.some(call=>call.table==='imports')),false);
    // Recovery event presents a password-only form, and returns to the ledger.
    await page.goto(url+'#recovery');await page.reload();await page.getByText('Set new password',{exact:true}).waitFor();await page.locator('#update-password').fill('newPassword123');await page.locator('#update-submit').click();await page.locator('#ledger').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>localStorage.getItem('test.passwordUpdated')),'yes');
    await page.locator('#add-vehicle').click();await page.locator('#form-vin').fill('WBAUC9C50DVM13012');await page.locator('#decoded-name').waitFor({state:'visible'});await page.locator('#save-vehicle').click();await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    await page.setViewportSize({width:360,height:800});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'/tmp/carbook-mobile.png',fullPage:true});
    await page.locator('#edit-vehicle').click();assert.equal(await page.evaluate(()=>document.querySelector('dialog').getBoundingClientRect().width<=innerWidth),true);await page.locator('#cancel-dialog').click();await page.locator('#vehicle-dialog').waitFor({state:'hidden'});
    await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'/tmp/carbook-desktop.png',fullPage:true});
    await page.locator('#edit-vehicle').click();await page.locator('#delete-vehicle').click();await page.locator('#empty-state').waitFor({state:'visible'});
    assert.deepEqual(errors,[]);
  } finally {if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve));}
});
