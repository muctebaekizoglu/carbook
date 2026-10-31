/* Shared by the browser and the calculation tests. All sums use integer cents. */
(function (root) {
  'use strict';
  function amount(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const text = String(value).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Error('Enter an amount with up to two decimal places.');
    const n = Number(text);
    if (!Number.isFinite(n) || n > 100000000) throw Error('Amount must be between $0 and $100,000,000.');
    return Math.round(n * 100) / 100;
  }
  function totals(vehicle) {
    const cents = vehicle.expenses.reduce((sum, e) => sum + Math.round(amount(e.amount) * 100), 0);
    const sold = vehicle.sold_price !== null;
    const value = sold ? vehicle.sold_price : vehicle.estimated_value;
    return { invested: cents / 100, sold, profit: value === null ? null : (Math.round(amount(value) * 100) - cents) / 100 };
  }
  const api = {amount, totals};
  if (typeof module !== 'undefined') module.exports = api;
  else root.CarbookFinance = api;
})(globalThis);
