do $$ begin
  create type gender as enum ('male','female','other','unknown');
exception when duplicate_object then null; end $$;

create table if not exists teams (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists members (
  id bigserial primary key,
  first_name text not null,
  last_name  text not null,
  username   text,
  email      text unique,
  email2     text,
  birthdate  date,
  gender     gender default 'unknown',
  phone      text,
  mobile     text,
  address1   text,
  zip1       text,
  city1      text,
  address2   text,
  zip2       text,
  city2      text,
  role       text,
  team_id    bigint references teams(id) on delete set null,
  member_number text,
  jersey_number text,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  last_login timestamptz,
  medical_consent boolean default false
);

create table if not exists payments (
  id bigserial primary key,
  member_id bigint not null references members(id) on delete cascade,
  season text not null,
  amount_cents integer not null,
  paid_at timestamptz not null default now(),
  method text,
  note text
);

create table if not exists sessions (
  id bigserial primary key,
  team_id bigint references teams(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists attendance (
  id bigserial primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  member_id  bigint not null references members(id) on delete cascade,
  present boolean not null default false,
  unique (session_id, member_id)
);

create view if not exists v_members_dues as
select
  m.id as member_id,
  m.first_name,
  m.last_name,
  m.email,
  m.member_number,
  t.name as team_name,
  exists(
    select 1 from payments p
    where p.member_id = m.id
      and p.season = to_char(now(), 'YYYY') || '-' || to_char(now() + interval '1 year','YYYY')
  ) as paid_this_season
from members m
left join teams t on t.id = m.team_id
where m.deleted = false;

insert into teams (name)
  values ('Equipe 10-12 ans'), ('Equipe 13-15 ans'), ('Equipe Adultes')
on conflict do nothing;

insert into members (first_name,last_name,email,team_id,gender,member_number)
  values
  ('Ines','Silva','ines@example.com', 1, 'female', 'ATH-001'),
  ('Rui','Pereira','rui@example.com', 2, 'male',   'ATH-002'),
  ('Patrick','Martins','patrick@example.com', 3, 'male', 'ATH-003')
on conflict do nothing;
