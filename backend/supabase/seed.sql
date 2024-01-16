-- noinspection SqlNoDataSourceInspectionForFile
/ * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * /
/* 0. database-wide configuration */
/ * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * /
/* allow our backend and CLI users to have a long statement timeout */
alter role postgres
set
  statement_timeout = 0;

alter role service_role
set
  statement_timeout = '1h';

/* multi-column GIN indexes */
create extension if not exists btree_gin;

/* for fancy machine learning stuff */
create extension if not exists vector;

/* GIN trigram indexes */
create extension if not exists pg_trgm;

/* for UUID generation */
create extension if not exists pgcrypto;

/* enable `explain` via the HTTP API for convenience */
alter role authenticator
set
  pgrst.db_plan_enabled to true;

notify pgrst,
'reload config';

/* create a version of to_jsonb marked immutable so that we can index over it.
see https://github.com/PostgREST/postgrest/issues/2594 */
create
or replace function to_jsonb(jsonb) returns jsonb immutable parallel safe strict language sql as $$
select $1
$$;

/******************************************/
/* 1. tables containing firestore content */
/******************************************/
begin;

drop publication if exists supabase_realtime;

create publication supabase_realtime;

alter publication supabase_realtime
add table contracts;

alter publication supabase_realtime
add table contract_bets;

alter publication supabase_realtime
add table contract_comments;

alter publication supabase_realtime
add table group_contracts;

alter publication supabase_realtime
add table group_members;

alter publication supabase_realtime
add table user_notifications;

alter publication supabase_realtime
add table user_follows;

alter publication supabase_realtime
add table private_user_messages;

alter publication supabase_realtime
add table private_user_message_channel_members;

alter publication supabase_realtime
add table chart_annotations;

commit;

/ * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * /
/* 2. internal machinery for making firestore replication work */
/ * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * /
/* records all incoming writes to any logged firestore document */
create table if not exists
  incoming_writes (
    id bigint generated always as identity primary key,
    event_id text null,
    /* can be null for writes generated by manual import */
    table_id text not null,
    write_kind text not null,
    parent_id text null,
    /* null for top-level collections */
    doc_id text not null,
    data jsonb null,
    /* can be null on deletes */
    ts timestamp not null
  );

alter table incoming_writes enable row level security;

/* records all deletions of firestore documents, with the deletion timestamp */
create table if not exists
  tombstones (
    id bigint generated always as identity primary key,
    table_id text not null,
    parent_id text null,
    doc_id text not null,
    fs_deleted_at timestamp not null,
    unique (table_id, parent_id, doc_id)
  );

alter table tombstones enable row level security;

create index if not exists tombstones_table_id_doc_id_fs_deleted_at on tombstones (table_id, doc_id, fs_deleted_at desc);

alter table tombstones
cluster on tombstones_table_id_doc_id_fs_deleted_at;

drop function if exists get_document_table_spec;

drop type if exists table_spec;

create type table_spec as (parent_id_col_name text, id_col_name text);

create
or replace function get_document_table_spec (table_id text) returns table_spec language plpgsql as $$
begin
  return case
    table_id
           when 'users' then cast((null, 'id') as table_spec)
           when 'private_users' then cast((null, 'id') as table_spec)
           when 'user_reactions' then cast(('user_id', 'reaction_id') as table_spec)
           when 'contracts' then cast((null, 'id') as table_spec)
           when 'contract_answers' then cast(('contract_id', 'answer_id') as table_spec)
           when 'answers' then cast((null, 'id') as table_spec)
           when 'contract_bets' then cast(('contract_id', 'bet_id') as table_spec)
           when 'contract_comments' then cast(('contract_id', 'comment_id') as table_spec)
           when 'contract_follows' then cast(('contract_id', 'follow_id') as table_spec)
           when 'contract_liquidity' then cast(('contract_id', 'liquidity_id') as table_spec)
           when 'txns' then cast((null, 'id') as table_spec)
           else null
    end;
end
$$;

/* takes a single new firestore write and replicates it into the database.
the contract of this function is:
- if you have a set of timestamped firestore writes, and you call this function
*at least once* on *every write*, in *any order*, then the database will be
the same and correct at the end.
*/
create
or replace function replicate_writes_process_one (r incoming_writes) returns boolean language plpgsql as $$
declare
  dest_spec table_spec;
begin
  dest_spec = get_document_table_spec(r.table_id);
  if dest_spec is null then
    raise warning 'Invalid table ID: %',
      r.table_id;
    return false;
  end if;
  if r.write_kind = 'create' then
/* possible cases:
 - if this is the most recent write to the document:
 1. common case: the document must not exist and this is a brand new document; insert it
 - if this is not the most recent write to the document:
 2. the document already exists due to other more recent inserts or updates; do nothing
 3. the document has been more recently deleted; do nothing
 */
    if exists(
        select
        from tombstones as t
        where t.table_id = r.table_id
          and t.doc_id = r.doc_id
          and t.fs_deleted_at > r.ts
          and t.parent_id is not distinct from r.parent_id
      /* mind nulls */
      ) then
      return true;
/* case 3 */
    end if;
    if dest_spec.parent_id_col_name is not null then
      execute format(
          'insert into %1$I (%2$I, %3$I, data, fs_updated_time) values (%4$L, %5$L, %6$L, %7$L)
                 on conflict (%2$I, %3$I) do nothing;',
          r.table_id,
          dest_spec.parent_id_col_name,
          dest_spec.id_col_name,
          r.parent_id,
          r.doc_id,
          r.data,
          r.ts
        );
    else
      execute format(
          'insert into %1$I (%2$I, data, fs_updated_time) values (%3$L, %4$L, %5$L)
                 on conflict (%2$I) do nothing;',
          r.table_id,
          dest_spec.id_col_name,
          r.doc_id,
          r.data,
          r.ts
        );
    end if;
  elsif r.write_kind = 'update' then
/* possible cases:
 - if this is the most recent write to the document:
 1. common case: the document exists; update it
 2. less common case: the document doesn't exist yet because there is an insert we haven't got; insert it
 - if this is not the most recent write to the document:
 3. the document exists but has more recent updates; do nothing
 4. the document has been more recently deleted; do nothing
 */
    if exists(
        select
        from tombstones as t
        where t.table_id = r.table_id
          and t.doc_id = r.doc_id
          and t.fs_deleted_at > r.ts
          and t.parent_id is not distinct from r.parent_id
      /* mind nulls */
      ) then
      return true;
/* case 4 */
    end if;
    if dest_spec.parent_id_col_name is not null then
      execute format(
          'insert into %1$I (%2$I, %3$I, data, fs_updated_time) values (%4$L, %5$L, %6$L, %7$L)
                 on conflict (%2$I, %3$I) do update set data = %6$L, fs_updated_time = %7$L
                 where %1$I.fs_updated_time <= %7$L;',
          r.table_id,
          dest_spec.parent_id_col_name,
          dest_spec.id_col_name,
          r.parent_id,
          r.doc_id,
          r.data,
          r.ts
        );
    else
      execute format(
          'insert into %1$I (%2$I, data, fs_updated_time) values (%3$L, %4$L, %5$L)
                 on conflict (%2$I) do update set data = %4$L, fs_updated_time = %5$L
                 where %1$I.fs_updated_time <= %5$L;',
          r.table_id,
          dest_spec.id_col_name,
          r.doc_id,
          r.data,
          r.ts
        );
    end if;
  elsif r.write_kind = 'delete' then
/* possible cases:
 - if this is the most recent write to the document:
 1. common case: the document must exist; delete it
 - if this is not the most recent write to the document:
 2. the document was already deleted; do nothing
 3. the document exists because it has a more recent insert or update; do nothing
 */
    if dest_spec.parent_id_col_name is not null then
      execute format(
          'delete from %1$I where %2$I = %4$L and %3$I = %5$L and fs_updated_time <= %6$L',
          r.table_id,
          dest_spec.parent_id_col_name,
          dest_spec.id_col_name,
          r.parent_id,
          r.doc_id,
          r.ts
        );
    else
      execute format(
          'delete from %1$I where %2$I = %3$L and fs_updated_time <= %4$L',
          r.table_id,
          dest_spec.id_col_name,
          r.doc_id,
          r.ts
        );
    end if;
/* update tombstone so inserts and updates can know when this document was deleted */
    insert into tombstones (table_id, parent_id, doc_id, fs_deleted_at)
    values (r.table_id, r.parent_id, r.doc_id, r.ts)
    on conflict (table_id, parent_id, doc_id) do update
      set fs_deleted_at = r.ts
    where tombstones.fs_deleted_at < r.ts;
  else
    raise warning 'Invalid write kind: %',
      r.write_kind;
    return false;
  end if;
  return true;
end
$$;

create
or replace function replicate_writes_process_new () returns trigger language plpgsql as $$
begin
  perform r.id, replicate_writes_process_one(r) as succeeded
  from new_table as r
  order by r.parent_id,
           r.doc_id;
  return null;
end
$$;

drop trigger if exists replicate_writes on incoming_writes;

create trigger replicate_writes
after insert on incoming_writes referencing new table as new_table for each statement
execute function replicate_writes_process_new ();

create text search dictionary english_stem_nostop (template = snowball, language = english);

create text search dictionary english_prefix (template = simple);

create text search configuration public.english_nostop_with_prefix (
  copy = english
);

alter text search configuration public.english_nostop_with_prefix
alter mapping for asciiword,
asciihword,
hword_asciipart,
hword,
hword_part,
word
with
  english_stem_nostop,
  english_prefix;
