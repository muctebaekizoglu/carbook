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
