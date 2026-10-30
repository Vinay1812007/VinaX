-- =============================================================================
-- VinaX database · remove the AI tables (schema version 2 → 3)
--
-- VinaX no longer has any AI features. Schema version 3 stopped creating the
-- AI usage log and the shared AI chats, but schema.sql never deletes data, so
-- a database that ran version 2 still holds them. This file removes them.
--
-- THIS DELETES DATA: every row of ai_calls (the AI call log) and of
-- shared_chats (AI conversations listeners shared at a link). Nothing else is
-- touched. Run it once, by hand, in the Supabase SQL Editor, after schema.sql
-- version 3 is applied. Safe to re-run.
-- =============================================================================

drop function if exists stats_ai(int);
drop function if exists ai_usage_since(timestamptz);
drop table if exists ai_calls;
drop table if exists shared_chats;

select 'VinaX AI tables removed' as done, (select count(*) from pg_tables where schemaname = 'public') as tables;
