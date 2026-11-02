-- Schema PostgreSQL / Supabase echivalentă cu cea SQLite din db.js.
-- NOTĂ V10: schema reală este creată automat de db-postgres.js (migrarea v1, testată pe PostgreSQL 16). Acest fișier e doar referință istorică.
-- Dacă folosești Supabase Auth, tabelul "accounts" se înlocuiește cu auth.users, iar characters.account_id devine uuid.
create table accounts(
  id bigserial primary key, name text not null, name_lc text not null unique,
  salt text not null, hash text not null, role text not null default 'PLAYER',
  created timestamptz not null default now());
create table sessions(token_hash text primary key, account_id bigint not null references accounts(id) on delete cascade, expires timestamptz not null);
create table characters(
  id bigserial primary key, account_id bigint not null references accounts(id) on delete cascade,
  name text not null, name_lc text not null unique, cls smallint not null check (cls between 1 and 4),
  lv int not null default 1, xp int not null default 0, gold bigint not null default 0,
  hp int not null, mp int not null, zone text not null default 'village', x real not null, y real not null,
  inv jsonb not null default '[]', updated timestamptz not null default now());
create index idx_char_acc on characters(account_id);
create table blocks(char_id bigint not null references characters(id) on delete cascade, blocked_lc text not null, primary key(char_id, blocked_lc));
create table chat_log(id bigserial primary key, ts timestamptz not null default now(), ch text not null, from_name text not null, to_name text, msg text not null);
create table audit(id bigserial primary key, ts timestamptz not null default now(), account_id bigint, kind text not null, detail text);
-- Securitate: clientul (browserul) NU trebuie să aibă acces direct la aceste tabele. Doar serverul de joc (service role).
alter table accounts enable row level security; alter table sessions enable row level security; alter table characters enable row level security;
alter table blocks enable row level security; alter table chat_log enable row level security; alter table audit enable row level security;
-- (fără policy-uri = niciun acces pentru anon/authenticated; service_role ocolește RLS)

-- Structuri pregătite (V8.5-V12), NEFUNCȚIONALE, netestate pe Postgres. Vezi db.js pentru definițiile SQLite.
-- guilds, guild_members(guild_rank separat de accounts.role), parties, party_members, titles, character_titles,
-- character_equipment, skins, character_skins, mounts, character_mounts, bp_seasons, bp_progress, currency_ledger (monedă de TEST).
