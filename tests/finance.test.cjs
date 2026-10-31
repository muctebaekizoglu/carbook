const {test} = require('node:test');
const assert = require('node:assert/strict');
const {amount,totals} = require('../finance.js');
test('money accepts blank, zero, and cents; rejects invalid financial data', () => {
  assert.equal(amount(''),null); assert.equal(amount(null),null); assert.equal(amount(0),0);
  assert.equal(amount('100.05'),100.05);
  for (const value of [-1,'NaN',Infinity,'1.234','1e3',100000001,'abc']) assert.throws(() => amount(value));
});
test('profit is unknown until valued; sale price including zero controls actual profit', () => {
  const c = {expenses:[{amount:10000},{amount:150.25},{amount:.1},{amount:.2}],estimated_value:null,sold_price:null};
  assert.deepEqual(totals(c),{invested:10150.55,sold:false,profit:null});
  assert.equal(totals({...c,estimated_value:12000}).profit,1849.45);
  assert.deepEqual(totals({...c,estimated_value:12000,sold_price:9000}),{invested:10150.55,sold:true,profit:-1150.55});
  assert.equal(totals({...c,sold_price:0}).profit,-10150.55);
  assert.deepEqual(totals({expenses:[],estimated_value:0,sold_price:null}),{invested:0,sold:false,profit:0});
});
test('many fractional expenses retain exact cents', () => {
  assert.equal(totals({expenses:Array.from({length:10000},()=>({amount:.01})),estimated_value:100.01,sold_price:null}).profit,.01);
});
test('currency parsing accepts US paste formats and rejects ambiguous or partial input',()=>{
  for (const value of ['11170','11,170','$11,170','11,170.00',' $11,170.00 ']) assert.equal(amount(value),11170);
  for (const value of ['11,17','1,11,170','11.170,00','$','1.','1 170','$$100','1,000.001','-10','12abc']) assert.throws(()=>amount(value));
  assert.equal(amount('$40.70'),40.7);assert.equal(amount('15.88'),15.88);
});
test('currency formatting preserves cents and omits whole-dollar decimals',()=>{
  const {format}=require('../finance.js');
  for (const [value,result] of [[11170,'$11,170'],[9610,'$9,610'],[40.7,'$40.70'],[15.88,'$15.88'],[0,'$0'],[-40.7,'-$40.70'],[null,'—']]) assert.equal(format(value),result);
  assert.equal(format(11170,false),'11,170');
  for (let cents=0;cents<10000;cents++) assert.equal(amount(format(cents/100)),cents/100);
});
