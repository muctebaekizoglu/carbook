const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
test('PostgreSQL schema: RLS, constraints, revision checks, atomic idempotent import', async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated;
      insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/schema.sql'),'utf8'));
    const login=async uid=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');};
    const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
    await login(owner);
    const {rows:[car]}=await db.query("insert into public.vehicles(name,vin) values ('BMW','WBAUC9C50DVM13012') returning *");
    await assert.rejects(db.query("insert into public.vehicles(user_id,name,vin) values ($1,'Other','')",[other]),/row-level security/);
    await assert.rejects(db.query("update public.vehicles set name='stale' where id=$1",[car.id]),/Reload/);
    await db.query("update public.vehicles set expenses=$1,revision=revision+1 where id=$2",[JSON.stringify([{id:'cost',description:'Purchase',amount:10000.01}]),car.id]);
    assert.equal((await db.query('select revision from public.vehicles')).rows[0].revision,2);
    assert.equal((await db.query("update public.vehicles set name='Old',revision=2 where id=$1 and revision=1 returning id",[car.id])).rows.length,0);
    await assert.rejects(db.query("update public.vehicles set user_id=$1,revision=3 where id=$2",[other,car.id]),/identity/);
    for(const bad of [[{id:'x',description:'x',amount:-1}],[{id:'x',description:'x',amount:1.001}],[{id:'x',description:'x',amount:null}],[{id:'x',description:'x',amount:0},{id:'x',description:'duplicate',amount:1}]]) {
      await assert.rejects(db.query('update public.vehicles set expenses=$1,revision=3 where id=$2',[JSON.stringify(bad),car.id]),/check constraint/);
    }
    await login(other);
    assert.equal((await db.query('select * from public.vehicles')).rows.length,0);
    assert.equal((await db.query("update public.vehicles set name='stolen',revision=3 where id=$1 returning id",[car.id])).rows.length,0);
    assert.equal((await db.query('delete from public.vehicles where id=$1 returning id',[car.id])).rows.length,0);
    const source='a'.repeat(64),badSource='b'.repeat(64);
    const legacy={name:'Legacy',vin:'',expenses:[],estimated_value:9000,sold_price:null,valuation_source:'Manual',valuation_updated_at:null,legacy_key:'local-1'};
    const importRows=(key,records)=>db.query('select public.import_vehicles($1,$2)',[key,JSON.stringify(records)]);
    await assert.rejects(importRows(badSource,[legacy,{...legacy,legacy_key:'bad',expenses:[{id:'x',description:'Bad',amount:-1}]}]),/check constraint/);
    assert.equal((await db.query('select * from public.vehicles')).rows.length,0);
    assert.equal((await db.query('select * from public.imports')).rows.length,0);
    await importRows(source,[legacy]);await importRows(source,[legacy]);
    assert.equal((await db.query('select * from public.vehicles')).rows.length,1);
    assert.equal((await db.query('select * from public.imports')).rows.length,1);
    await db.query('delete from public.vehicles');await importRows(source,[legacy]);
    assert.equal((await db.query('select * from public.vehicles')).rows.length,0);
    await login(owner);assert.equal((await db.query('select * from public.imports')).rows.length,0);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.vehicles'),/permission denied/);
    await assert.rejects(db.query('select public.import_vehicles($1,$2)',[source,JSON.stringify([legacy])]),/permission denied/);
  } finally {await db.close();}
});
