/* Official NHTSA vPIC decoding. This retrieves vehicle identity, never valuation. */
(function (root) {
  'use strict';
  const normalize = value => String(value || '').toUpperCase().replace(/\s/g, '');
  const valid = value => /^[A-HJ-NPR-Z0-9]{17}$/.test(value);
  function vehicleName(data) {
    const result = data?.Results?.[0];
    if (!result || typeof result !== 'object') throw Error('NHTSA returned no vehicle details. Check the VIN or enter details manually.');
    const codes = String(result.ErrorCode ?? '').split(',').map(code => code.trim()).filter(Boolean);
    if (!codes.length || codes.some(code => code !== '0')) {
      throw Error('NHTSA could not fully validate this VIN. Check the VIN or enter details manually.');
    }
    const year = String(result.ModelYear || '').trim();
    const make = String(result.Make || '').trim();
    const model = String(result.Model || '').trim();
    const missing = text => !text || /^(not applicable|unknown|n\/a|null)$/i.test(text);
    if (!/^[12]\d{3}$/.test(year) || missing(make) || missing(model)) {
      throw Error('NHTSA returned incomplete details. Enter the vehicle details manually.');
    }
    const name = [year, make, model].join(' ');
    if (name.length > 150) throw Error('Vehicle details are too long. Enter a shorter name manually.');
    return name;
  }
  async function decode(value, {signal, timeout = 10000, fetcher = globalThis.fetch} = {}) {
    const vin = normalize(value);
    if (!valid(vin)) throw Error('Enter a 17-character VIN without I, O, or Q.');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    let timedOut = false;
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', cancel, {once:true});
    const timer = setTimeout(() => {timedOut = true; controller.abort();}, timeout);
    try {
      const response = await fetcher(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'});
      if (!response.ok) throw Error('NHTSA is unavailable right now. Try again or enter details manually.');
      let data;
      try { data = await response.json(); }
      catch (error) { if (controller.signal.aborted) throw error; throw Error('NHTSA returned an unreadable response. Try again or enter details manually.'); }
      return vehicleName(data);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timedOut) throw Error('NHTSA took too long to respond. Try again or enter details manually.');
      if (error instanceof TypeError) throw Error('Could not reach NHTSA. Check your connection or enter details manually.');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  const api = {normalize, valid, vehicleName, decode};
  if (typeof module !== 'undefined') module.exports = api;
  else root.CarbookVIN = api;
})(globalThis);
