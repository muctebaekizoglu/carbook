/* Shared by the browser and the calculation tests. All sums use integer cents. */
(function (root) {
  'use strict';
  function amount(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const raw = String(value).trim();
    if (!/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) throw Error('Enter an amount with up to two decimal places.');
    const text = raw.replace(/^\$/, '').replace(/,/g, '');
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
  function format(value, symbol = true) {
    if (value === null || value === undefined) return symbol ? '—' : '';
    const cents = Math.round(value * 100);
    return new Intl.NumberFormat('en-US', {style:symbol ? 'currency' : 'decimal', ...(symbol ? {currency:'USD'} : {}), minimumFractionDigits:cents % 100 === 0 ? 0 : 2, maximumFractionDigits:2}).format(cents / 100);
  }
  const api = {amount, totals, format};
  if (typeof module !== 'undefined') module.exports = api;
  else root.CarbookFinance = api;
})(globalThis);
