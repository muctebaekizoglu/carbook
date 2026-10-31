-- Run once in a new Supabase project's SQL Editor.
begin;

create function public.valid_expenses(items jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 10000 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or length(item->>'id') not between 1 and 100
      or jsonb_typeof(item->'description') is distinct from 'string'
      or length(trim(item->>'description')) not between 1 and 100
      or jsonb_typeof(item->'amount') is distinct from 'number'
      then return false; end if;
    if (item->>'amount')::numeric < 0 or (item->>'amount')::numeric > 100000000
      or round((item->>'amount')::numeric,2) <> (item->>'amount')::numeric then return false; end if;
  end loop;
  return (select count(*) = count(distinct value->>'id') from jsonb_array_elements(items));
end;
$$;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(trim(name)) between 1 and 150),
  -- Empty VINs are permitted for lossless import of older browser records.
  vin text not null check (vin = '' or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  expenses jsonb not null default '[]'::jsonb check (public.valid_expenses(expenses)),
  estimated_value numeric(12,2) check (estimated_value between 0 and 100000000),
  valuation_source text check (length(valuation_source) between 1 and 150),
  valuation_updated_at timestamptz,
  sold_price numeric(12,2) check (sold_price between 0 and 100000000),
  legacy_key text check (length(legacy_key) <= 150),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,legacy_key)
);
create index vehicles_owner on public.vehicles(user_id);

create function public.check_vehicle_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at
    or new.legacy_key is distinct from old.legacy_key then
    raise exception 'Vehicle identity cannot be changed';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'Vehicle changed. Reload before saving.';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
create trigger vehicle_updated before update on public.vehicles
for each row execute function public.check_vehicle_update();

create table public.imports (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  source_key text not null check (source_key ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  primary key(user_id, source_key)
);
alter table public.vehicles enable row level security;
alter table public.imports enable row level security;
create policy vehicles_select on public.vehicles for select to authenticated using ((select auth.uid()) = user_id);
create policy vehicles_insert on public.vehicles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy vehicles_update on public.vehicles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy vehicles_delete on public.vehicles for delete to authenticated using ((select auth.uid()) = user_id);
create policy imports_select on public.imports for select to authenticated using ((select auth.uid()) = user_id);
create policy imports_insert on public.imports for insert to authenticated with check ((select auth.uid()) = user_id);
revoke all on public.vehicles, public.imports from anon, authenticated;
grant select,insert,update,delete on public.vehicles to authenticated;
grant select,insert on public.imports to authenticated;

-- One transaction: all vehicles and the receipt succeed together, or neither does.
-- Invoker security preserves RLS. Repeated imports do not overwrite cloud edits.
create function public.import_vehicles(source text, records jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records) not between 1 and 200 then
    raise exception 'Expected 1 to 200 vehicles';
  end if;
  insert into public.imports(user_id,source_key) values(auth.uid(),source)
    on conflict do nothing;
  get diagnostics claimed = row_count;
  if claimed = 0 then return; end if;
  insert into public.vehicles(user_id,name,vin,expenses,estimated_value,valuation_source,valuation_updated_at,sold_price,legacy_key)
  select auth.uid(),v->>'name',v->>'vin',v->'expenses',
    (v->>'estimated_value')::numeric,v->>'valuation_source',(v->>'valuation_updated_at')::timestamptz,
    (v->>'sold_price')::numeric,v->>'legacy_key'
  from jsonb_array_elements(records) v
  on conflict(user_id,legacy_key) do nothing;
end;
$$;
revoke all on function public.import_vehicles(text,jsonb) from public,anon;
grant execute on function public.import_vehicles(text,jsonb) to authenticated;
revoke all on function public.check_vehicle_update() from public;
revoke all on function public.valid_expenses(jsonb) from public;
grant execute on function public.valid_expenses(jsonb) to authenticated;
commit;
