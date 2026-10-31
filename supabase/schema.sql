-- =====================================================================
-- OBORA — baza w Supabase (synchronizacja laptop ↔ telefon, wielu użytkowników)
-- Wklej CAŁY ten plik w Supabase: SQL Editor → New query → Run.
-- Skrypt można uruchomić ponownie (nie zniszczy danych).
-- =====================================================================

-- Gospodarstwa (jedno konto może należeć do kilku gospodarstw)
create table if not exists public.farms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Członkowie gospodarstwa: właściciel i pracownicy
create table if not exists public.farm_members (
  farm_id    uuid not null references public.farms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'pracownik' check (role in ('właściciel', 'pracownik')),
  joined_at  timestamptz not null default now(),
  primary key (farm_id, user_id)
);

-- Wszystkie dane aplikacji. Jeden wiersz = jeden wpis (krowa, ważenie, leczenie...).
-- Kolumna "store" mówi, jaki to rodzaj wpisu, a "data" zawiera cały wpis (JSON).
-- Dzięki temu dodanie nowego pola w aplikacji NIE wymaga zmian w bazie.
create table if not exists public.records (
  farm_id            uuid not null references public.farms(id) on delete cascade,
  id                 text not null,
  store              text not null,
  data               jsonb not null,
  updated_at         timestamptz not null,          -- kiedy zmieniono wpis (czas urządzenia)
  updated_by         text,                          -- kto zmienił
  deleted            boolean not null default false,-- wpis w koszu
  server_updated_at  timestamptz not null default clock_timestamp(), -- kiedy dotarł na serwer
  primary key (farm_id, id)
);
create index if not exists records_pull_idx on public.records (farm_id, server_updated_at);

-- Znacznik czasu serwera przy każdej zmianie (potrzebny do pobierania nowości)
create or replace function public.touch_record() returns trigger
language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_record();

-- Czy zalogowany użytkownik należy do gospodarstwa?
create or replace function public.is_member(f uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.farm_members where farm_id = f and user_id = auth.uid());
$$;

create or replace function public.is_owner(f uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.farm_members where farm_id = f and user_id = auth.uid() and role = 'właściciel');
$$;

-- ---------------- ZABEZPIECZENIA (Row Level Security) ----------------
-- Każdy widzi i zmienia WYŁĄCZNIE dane gospodarstw, do których należy.
alter table public.farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.records enable row level security;

drop policy if exists farms_select on public.farms;
create policy farms_select on public.farms for select using (public.is_member(id));
drop policy if exists farms_update on public.farms;
create policy farms_update on public.farms for update using (public.is_owner(id));

drop policy if exists members_select on public.farm_members;
create policy members_select on public.farm_members for select using (public.is_member(farm_id));
drop policy if exists members_delete on public.farm_members;
create policy members_delete on public.farm_members for delete
  using (public.is_owner(farm_id) or user_id = auth.uid());

drop policy if exists records_select on public.records;
create policy records_select on public.records for select using (public.is_member(farm_id));
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert with check (public.is_member(farm_id));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update using (public.is_member(farm_id)) with check (public.is_member(farm_id));

-- ---------------- FUNKCJE WYWOŁYWANE PRZEZ APLIKACJĘ ----------------

-- Utworzenie gospodarstwa: zakładający zostaje właścicielem
create or replace function public.create_farm(farm_name text) returns public.farms
language plpgsql security definer set search_path = public as $$
declare f public.farms;
begin
  if auth.uid() is null then raise exception 'Nie zalogowano'; end if;
  insert into public.farms (name, created_by) values (coalesce(nullif(trim(farm_name), ''), 'Moje gospodarstwo'), auth.uid()) returning * into f;
  insert into public.farm_members (farm_id, user_id, email, role) values (f.id, auth.uid(), auth.jwt() ->> 'email', 'właściciel');
  return f;
end $$;

-- Dołączenie do gospodarstwa kodem (np. pracownik)
create or replace function public.join_farm(code text) returns public.farms
language plpgsql security definer set search_path = public as $$
declare f public.farms;
begin
  if auth.uid() is null then raise exception 'Nie zalogowano'; end if;
  select * into f from public.farms where join_code = upper(trim(code));
  if not found then raise exception 'Nieprawidłowy kod gospodarstwa'; end if;
  insert into public.farm_members (farm_id, user_id, email, role) values (f.id, auth.uid(), auth.jwt() ->> 'email', 'pracownik')
    on conflict (farm_id, user_id) do nothing;
  return f;
end $$;

-- Nowy kod zaproszenia (np. gdy pracownik odszedł)
create or replace function public.new_join_code(f uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_owner(f) then raise exception 'Tylko właściciel może zmienić kod'; end if;
  c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  update public.farms set join_code = c where id = f;
  return c;
end $$;

-- Wysłanie zmian z urządzenia. Zasada: „nowsza zmiana wygrywa” —
-- starsza wersja wpisu nie nadpisze nowszej zapisanej przez inne urządzenie.
create or replace function public.push_records(rows jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  insert into public.records (farm_id, id, store, data, updated_at, updated_by, deleted)
  select (r ->> 'farm_id')::uuid, r ->> 'id', r ->> 'store', r -> 'data',
         (r ->> 'updated_at')::timestamptz, r ->> 'updated_by', coalesce((r ->> 'deleted')::boolean, false)
  from jsonb_array_elements(rows) as r
  on conflict (farm_id, id) do update
    set store = excluded.store, data = excluded.data, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by, deleted = excluded.deleted
    where public.records.updated_at <= excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.create_farm(text), public.join_farm(text), public.new_join_code(uuid), public.push_records(jsonb) to authenticated;
