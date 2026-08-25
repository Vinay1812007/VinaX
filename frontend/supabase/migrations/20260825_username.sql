-- Unique username (handle) for the no-login identity model.
-- Display names collide across listeners; the handle never does.
-- Claimed by POST /api/username at onboarding; shown as @username in admin.
alter table vinax_users add column if not exists username text;
create unique index if not exists vinax_users_username_unique
  on vinax_users (lower(username))
  where username is not null;
