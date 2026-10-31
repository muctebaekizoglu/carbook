// Browser-only test double. No real cloud or authentication is exercised here.
window.supabase = {createClient() {
  const callbacks = [];
  const db = () => JSON.parse(localStorage.getItem('test.db') || '{"vehicles":[],"imports":[]}');
  const store = value => localStorage.setItem('test.db',JSON.stringify(value));
  const session = () => JSON.parse(localStorage.getItem('test.session') || 'null');
  const emit = (event,s) => callbacks.forEach(fn => fn(event,s));
  const auth = {
    onAuthStateChange(fn) {callbacks.push(fn);},
    async getSession() {const s=session(); if (location.hash === '#recovery' && s) emit('PASSWORD_RECOVERY',s); return {data:{session:s}};},
    async signInWithPassword({email,password}) {
      if (password === 'wrong') return {error:{message:'Invalid login credentials'}};
      const s = {user:{id:email,email}}; localStorage.setItem('test.session',JSON.stringify(s)); emit('SIGNED_IN',s); return {data:{session:s}};
    },
    async signUp() {return {data:{session:null}};},
    async resetPasswordForEmail() {return {data:{}};},
    async updateUser() {localStorage.setItem('test.passwordUpdated','yes'); return {data:{}};},
    async signOut() {localStorage.removeItem('test.session'); emit('SIGNED_OUT',null); return {};}
  };
  return {auth,from(table) {
    let type='select', payload, filters=[], single=false;
    const q = {
      select() {return q;}, order() {return q;},
      insert(value) {type='insert';payload=value;return q;},
      update(value) {type='update';payload=value;return q;},
      delete() {type='delete';return q;}, eq(key,value) {filters.push([key,value]);return q;},
      single() {single=true;return q;},
      then(resolve,reject) {return Promise.resolve().then(() => {
        if (localStorage.getItem('test.fail')) return {error:{message:'Network unavailable'}};
        const data = db(), uid = session()?.user.id;
        const matches = item => item.user_id === uid && filters.every(([k,v]) => item[k] === v);
        let rows = data[table].filter(matches);
        if (type==='insert') {
          const row = {id:crypto.randomUUID(),expenses:[],estimated_value:null,sold_price:null,revision:1,valuation_source:null,valuation_updated_at:null,...payload};
          data[table].push(row); rows=[row];
        }
        if (type==='update') {rows.forEach(row => Object.assign(row,payload));}
        if (type==='delete') data[table]=data[table].filter(item => !matches(item));
        store(data);
        if (single && rows.length!==1) return {error:{code:'PGRST116',message:'No row'}};
        return {data:single?rows[0]:rows};
      }).then(resolve,reject);}
    }; return q;
  },async rpc(name,{source,records}) {
    if (localStorage.getItem('test.fail')) return {error:{message:'Network unavailable'}};
    const data=db(),uid=session().user.id;
    if (!data.imports.some(item=>item.user_id===uid&&item.source_key===source)) {
      for (const row of records) if (!data.vehicles.some(v=>v.user_id===uid&&v.legacy_key===row.legacy_key)) data.vehicles.push({id:crypto.randomUUID(),user_id:uid,revision:1,...row});
      data.imports.push({user_id:uid,source_key:source});store(data);
    }
    return {data:null};
  }};
}};
