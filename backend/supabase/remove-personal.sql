-- =============================================================================
-- VinaX database · remove the personal engine (schema version 20 → 21)
--
-- VinaX Music has no AI features any more, and the personal engine (the
-- server taste model for signed-in listeners, built on AI embeddings and a
-- language model) went with them. Schema version 21 stopped creating its
-- tables and functions, but schema.sql never deletes data, so a database that
-- ran version 7–20 still holds them. This file removes them.
--
-- THIS DELETES DATA: every row of personal_events (listening events reported
-- by signed-in listeners), personal_taste (their taste models), personal_pages,
-- personal_exposure, personal_songs and personal_colisten. Nothing else is
-- touched: accounts, play history, libraries and VinaX AI chats stay. Run it
-- once, by hand, in the Supabase SQL Editor, after schema.sql version 21 is
-- applied. Safe to re-run.
-- =============================================================================

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'personal\_%'
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop table if exists personal_colisten, personal_pages, personal_exposure, personal_taste, personal_events, personal_songs cascade;

-- The `jobs` setting may still name the retired "personal-embed" job, and the
-- settings table the retired engine and music AI switches; the Worker ignores
-- them, so this only tidies up.
delete from settings where key in ('personal-config', 'ai-music');
update settings set value = value - 'personal-embed' where key = 'jobs' and value ? 'personal-embed';

select 'Personal engine removed' as done, (select count(*) from pg_tables where schemaname = 'public') as tables;
