const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalize, valid, vehicleName, decode} = require('../vin.js');
const VIN = '1HGCM82633A004352';
const response = (overrides = {}) => ({Results:[{ErrorCode:'0',ModelYear:'2003',Make:'HONDA',Model:'Accord',...overrides}]});
test('normalizes whitespace and case, rejects invalid or partial VINs', () => {
  assert.equal(normalize(' 1hgcm82633a004352\n'),VIN);
  assert.equal(valid(VIN),true);
  for (const vin of ['', VIN.slice(1),VIN+'1','IHGCM82633A004352','1HGCM82633A00435Q','1HGCM82633A00435O']) assert.equal(valid(vin),false);
});
test('uses only complete, validated NHTSA details without inventing missing information', () => {
  assert.equal(vehicleName(response()),'2003 HONDA Accord');
  for (const data of [{}, {Results:[]}, response({ErrorCode:'1'}),response({ErrorCode:'0,14'}),response({ErrorCode:''}),response({Model:''}),response({Make:null}),response({ModelYear:''}),response({Model:'Not Applicable'})]) assert.throws(()=>vehicleName(data));
});
test('requests the official endpoint without credentials', async () => {
  const name = await decode(VIN,{fetcher:async (url,options) => {
    assert.equal(url,`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${VIN}?format=json`);
    assert.equal(options.credentials,'omit');
    return {ok:true,json:async()=>response()};
  }});
  assert.equal(name,'2003 HONDA Accord');
  await assert.rejects(decode('bad',{fetcher:()=>{throw Error('must not fetch');}}),/17-character/);
});
test('handles HTTP errors, network failures, malformed JSON, and incomplete results', async () => {
  await assert.rejects(decode(VIN,{fetcher:async()=>({ok:false})}),/unavailable/);
  await assert.rejects(decode(VIN,{fetcher:async()=>{throw new TypeError('network');}}),/connection/);
  await assert.rejects(decode(VIN,{fetcher:async()=>({ok:true,json:async()=>{throw new SyntaxError('bad JSON');}})}),/unreadable/);
  await assert.rejects(decode(VIN,{fetcher:async()=>({ok:true,json:async()=>response({Model:null})})}),/incomplete/);
});
test('times out and cancels stale requests', async () => {
  const pending = (url,{signal}) => new Promise((resolve,reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted','AbortError'));
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });
  await assert.rejects(decode(VIN,{timeout:5,fetcher:pending}),/too long/);
  const controller = new AbortController();
  const request = decode(VIN,{signal:controller.signal,fetcher:pending});
  controller.abort();
  await assert.rejects(request,{name:'AbortError'});
});
