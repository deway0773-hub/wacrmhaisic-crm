alter table public.profiles add column if not exists display_name text;
update public.profiles set display_name = full_name where display_name is null and full_name is not null;