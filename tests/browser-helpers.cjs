const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
async function app({signedIn = true, records = [], route = '', legacy = null} = {}) {
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    const file = path.resolve(root,'.'+(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403); return res.end();}
    fs.readFile(file,(error,data) => {res.writeHead(error ? 404 : 200,{'Content-Type':file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'});res.end(error ? 'Not found' : data);});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(10000);
  const errors = [];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.route('**/config.js',route=>route.fulfill({contentType:'application/javascript',body:"window.CARBOOK_CONFIG={supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_publishable_test'};"}));
  await page.route('**/vendor/supabase.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8')}));
  await page.addInitScript(({signedIn,records,legacy})=>{
    if (!localStorage.getItem('test.initialized')) {
      localStorage.setItem('test.initialized','yes');
      if (legacy !== null) localStorage.setItem('carbook.records.v2',legacy);
      if (signedIn) localStorage.setItem('test.session',JSON.stringify({user:{id:'test@example.com',email:'test@example.com'}}));
      localStorage.setItem('test.db',JSON.stringify({vehicles:records,imports:[]}));
    }
  },{signedIn,records,legacy});
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url + route);
  await page.locator(signedIn ? '#ledger' : '#auth').waitFor({state:'visible'});
  return {page,errors,url,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));}};
}
const fixture = {
  id:'test-car',user_id:'test@example.com',name:'2003 Honda Accord',vin:'1HGCM82633A004352',revision:1,
  expenses:[{id:'purchase',description:'Purchase',amount:6500},{id:'transport',description:'Transport',amount:185},{id:'service',description:'Oil & filter service',amount:94.50},{id:'tires',description:'Tires',amount:420}],
  estimated_value:8500,valuation_source:'Manual',valuation_updated_at:'2026-10-31T12:00:00Z',sold_price:null
};
module.exports = {app,fixture};
