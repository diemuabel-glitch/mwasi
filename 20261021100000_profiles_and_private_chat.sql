create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  constraint chat_requests_distinct_users check (sender_id <> recipient_id)
);

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.chat_requests (id) on delete cascade,
  user_one uuid not null references auth.users (id) on delete cascade,
  user_two uuid not null references auth.users (id) on delete cascade,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint chat_conversations_distinct_users check (user_one <> user_two)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint chat_blocks_distinct_users check (blocker_id <> blocked_id)
);

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.chat_conversations (id) on delete set null,
  reason text not null check (char_length(reason) between 2 and 80),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  constraint chat_reports_distinct_users check (reporter_id <> reported_user_id)
);

create index if not exists chat_requests_recipient_pending_idx
  on public.chat_requests (recipient_id, created_at desc)
  where status = 'pending';
create index if not exists chat_requests_sender_idx
  on public.chat_requests (sender_id, status, created_at desc);
create unique index if not exists chat_requests_one_active_pair_idx
  on public.chat_requests (least(sender_id, recipient_id), greatest(sender_id, recipient_id))
  where status in ('pending', 'accepted');
create index if not exists chat_conversations_user_one_idx
  on public.chat_conversations (user_one, last_activity_at desc);
create index if not exists chat_conversations_user_two_idx
  on public.chat_conversations (user_two, last_activity_at desc);
create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at desc);

create or replace function public.is_chat_blocked(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_blocks as blocks
    where auth.uid() in (first_user, second_user)
      and (
        (blocks.blocker_id = first_user and blocks.blocked_id = second_user)
        or (blocks.blocker_id = second_user and blocks.blocked_id = first_user)
      )
  )
  and auth.uid() is not null;
$$;

revoke all on function public.is_chat_blocked(uuid, uuid) from public;
grant execute on function public.is_chat_blocked(uuid, uuid) to authenticated;

create or replace function public.search_chat_profiles(search_term text)
returns table (profile_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_term text := trim(coalesce(search_term, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;
  if char_length(normalized_term) < 2 or char_length(normalized_term) > 40 then
    raise exception 'Search must contain between 2 and 40 characters.';
  end if;

  return query
    select profiles.user_id, profiles.display_name
    from public.user_profiles as profiles
    where profiles.discoverable
      and profiles.user_id <> auth.uid()
      and profiles.display_name ilike '%' || replace(replace(replace(normalized_term, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
      and not public.is_chat_blocked(auth.uid(), profiles.user_id)
    order by profiles.display_name
    limit 20;
end;
$$;

revoke all on function public.search_chat_profiles(text) from public;
grant execute on function public.search_chat_profiles(text) to authenticated;

create or replace function public.accept_chat_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.chat_requests%rowtype;
  conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  select *
  into request_row
  from public.chat_requests
  where chat_requests.id = p_request_id
  for update;

  if not found or request_row.recipient_id <> auth.uid() then
    raise exception 'Chat request not found.';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Chat request is no longer pending.';
  end if;
  if public.is_chat_blocked(request_row.sender_id, request_row.recipient_id) then
    raise exception 'This chat request can no longer be accepted.';
  end if;

  update public.chat_requests
  set status = 'accepted'
  where id = request_row.id;

  insert into public.chat_conversations (request_id, user_one, user_two)
  values (request_row.id, request_row.sender_id, request_row.recipient_id)
  returning id into conversation_id;

  return conversation_id;
end;
$$;

revoke all on function public.accept_chat_request(uuid) from public;
grant execute on function public.accept_chat_request(uuid) to authenticated;

create or replace function public.decline_chat_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  update public.chat_requests
  set status = 'declined'
  where chat_requests.id = p_request_id
    and recipient_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Chat request not found or no longer pending.';
  end if;
end;
$$;

revoke all on function public.decline_chat_request(uuid) from public;
grant execute on function public.decline_chat_request(uuid) to authenticated;

create or replace function public.touch_chat_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_conversations
  set last_activity_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_touch_conversation on public.chat_messages;
create trigger chat_messages_touch_conversation
after insert on public.chat_messages
for each row execute function public.touch_chat_conversation();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    'Membre Mwasi'
  );

  insert into public.user_profiles (user_id, display_name)
  values (new.id, left(requested_name, 40))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_user_profile_created on auth.users;
create trigger auth_user_profile_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

alter table public.user_profiles enable row level security;
alter table public.chat_requests enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_blocks enable row level security;
alter table public.chat_reports enable row level security;

revoke all on public.user_profiles, public.chat_requests, public.chat_conversations,
  public.chat_messages, public.chat_blocks, public.chat_reports from anon, authenticated;

grant select, insert, update on public.user_profiles to authenticated;
grant select, insert on public.chat_requests to authenticated;
grant select on public.chat_conversations to authenticated;
grant select, insert on public.chat_messages to authenticated;
grant select, insert, delete on public.chat_blocks to authenticated;
grant insert on public.chat_reports to authenticated;

drop policy if exists "Users see their own or discoverable profiles" on public.user_profiles;
create policy "Users see their own or discoverable profiles"
  on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()) or discoverable);

drop policy if exists "Users insert their own profile" on public.user_profiles;
create policy "Users insert their own profile"
  on public.user_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users update their own profile" on public.user_profiles;
create policy "Users update their own profile"
  on public.user_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Participants see their chat requests" on public.chat_requests;
create policy "Participants see their chat requests"
  on public.chat_requests for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

drop policy if exists "Users send requests to discoverable profiles" on public.chat_requests;
create policy "Users send requests to discoverable profiles"
  on public.chat_requests for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1 from public.user_profiles as recipient
      where recipient.user_id = recipient_id and recipient.discoverable
    )
    and not public.is_chat_blocked(sender_id, recipient_id)
  );

drop policy if exists "Conversation participants read their conversations" on public.chat_conversations;
create policy "Conversation participants read their conversations"
  on public.chat_conversations for select to authenticated
  using ((select auth.uid()) in (user_one, user_two));

drop policy if exists "Conversation participants read messages" on public.chat_messages;
create policy "Conversation participants read messages"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.chat_conversations as conversations
      where conversations.id = conversation_id
        and (select auth.uid()) in (conversations.user_one, conversations.user_two)
        and not public.is_chat_blocked(conversations.user_one, conversations.user_two)
    )
  );

drop policy if exists "Conversation participants send messages" on public.chat_messages;
create policy "Conversation participants send messages"
  on public.chat_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.chat_conversations as conversations
      join public.chat_requests as requests on requests.id = conversations.request_id
      where conversations.id = conversation_id
        and requests.status = 'accepted'
        and (select auth.uid()) in (conversations.user_one, conversations.user_two)
        and not public.is_chat_blocked(conversations.user_one, conversations.user_two)
    )
  );

drop policy if exists "Users see their own blocks" on public.chat_blocks;
create policy "Users see their own blocks"
  on public.chat_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists "Users block other accounts" on public.chat_blocks;
create policy "Users block other accounts"
  on public.chat_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()) and blocked_id <> (select auth.uid()));

drop policy if exists "Users unblock their own blocks" on public.chat_blocks;
create policy "Users unblock their own blocks"
  on public.chat_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists "Users submit chat reports" on public.chat_reports;
create policy "Users submit chat reports"
  on public.chat_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and reported_user_id <> (select auth.uid())
    and (
      conversation_id is null
      or exists (
        select 1 from public.chat_conversations as conversations
        where conversations.id = conversation_id
          and (select auth.uid()) in (conversations.user_one, conversations.user_two)
          and reported_user_id in (conversations.user_one, conversations.user_two)
      )
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
