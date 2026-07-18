-- Row-level-security policies for a Supabase deployment of RosterIQ.
--
-- Local/dev mode uses the embedded PGlite database with a single connection,
-- where tenancy is enforced in the service layer (src/server/context.ts).
-- When deploying to Supabase with per-user JWTs, apply these policies so the
-- database enforces organization isolation as a second layer.
--
-- Assumes Supabase Auth: auth.uid() returns the signed-in user's UUID and the
-- application keeps users.id = auth.uid() for Supabase-provisioned accounts.

-- Helper: membership test used by every org-scoped policy.
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.org_role(org uuid)
returns org_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from organization_members m
  where m.organization_id = org and m.user_id = auth.uid();
$$;

-- Enable RLS on all org-scoped tables.
alter table organizations        enable row level security;
alter table organization_members enable row level security;
alter table teams                enable row level security;
alter table players              enable row level security;
alter table contracts            enable row level security;
alter table contract_seasons     enable row level security;
alter table cap_obligations      enable row level security;
alter table scenarios            enable row level security;
alter table scenario_transactions enable row level security;
alter table scenario_contracts   enable row level security;
alter table scenario_rosters     enable row level security;
alter table transactions         enable row level security;
alter table transaction_items    enable row level security;
alter table player_statistics    enable row level security;
alter table player_projections   enable row level security;
alter table player_valuations    enable row level security;
alter table surplus_value_records enable row level security;
alter table audit_logs           enable row level security;
alter table reports              enable row level security;
alter table saved_views          enable row level security;
alter table imports              enable row level security;
alter table import_errors        enable row level security;

-- Organizations: members read; only admins update.
create policy org_read on organizations
  for select using (is_org_member(id));
create policy org_update on organizations
  for update using (org_role(id) in ('org_admin', 'league_admin'));

-- Membership rows: visible to fellow members; managed by admins.
create policy member_read on organization_members
  for select using (is_org_member(organization_id));
create policy member_write on organization_members
  for all using (org_role(organization_id) in ('org_admin', 'league_admin'));

-- Generic org-scoped table policies (repeat pattern).
create policy teams_rw on teams
  for all using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
create policy players_rw on players
  for all using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
create policy contracts_rw on contracts
  for all using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
create policy scenarios_rw on scenarios
  for all using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
create policy transactions_rw on transactions
  for all using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
create policy cap_obligations_rw on cap_obligations
  for all using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
create policy audit_read on audit_logs
  for select using (organization_id is null or is_org_member(organization_id));
create policy reports_rw on reports
  for all using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
create policy saved_views_rw on saved_views
  for all using (user_id = auth.uid());
create policy imports_rw on imports
  for all using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- Child tables inherit isolation through their parent FK.
create policy contract_seasons_rw on contract_seasons
  for all using (exists (
    select 1 from contracts c where c.id = contract_id and is_org_member(c.organization_id)
  ));
create policy scenario_tx_rw on scenario_transactions
  for all using (exists (
    select 1 from scenarios s where s.id = scenario_id and is_org_member(s.organization_id)
  ));
create policy scenario_contracts_rw on scenario_contracts
  for all using (exists (
    select 1 from scenarios s where s.id = scenario_id and is_org_member(s.organization_id)
  ));
create policy scenario_rosters_rw on scenario_rosters
  for all using (exists (
    select 1 from scenarios s where s.id = scenario_id and is_org_member(s.organization_id)
  ));
create policy tx_items_rw on transaction_items
  for all using (exists (
    select 1 from transactions t where t.id = transaction_id and is_org_member(t.organization_id)
  ));
create policy stats_rw on player_statistics
  for all using (exists (
    select 1 from players p where p.id = player_id and is_org_member(p.organization_id)
  ));
create policy projections_rw on player_projections
  for all using (exists (
    select 1 from players p where p.id = player_id and is_org_member(p.organization_id)
  ));
create policy valuations_rw on player_valuations
  for all using (exists (
    select 1 from players p where p.id = player_id and is_org_member(p.organization_id)
  ));
create policy surplus_rw on surplus_value_records
  for all using (exists (
    select 1 from players p where p.id = player_id and is_org_member(p.organization_id)
  ));
create policy import_errors_rw on import_errors
  for all using (exists (
    select 1 from imports i where i.id = import_id and is_org_member(i.organization_id)
  ));

-- League reference data (leagues, seasons, rules, comparable pool) is
-- readable by any authenticated user; writes are restricted to service-role
-- (the app's server) and league administrators.
alter table leagues        enable row level security;
alter table league_seasons enable row level security;
alter table league_rules   enable row level security;
alter table comparable_contracts enable row level security;
create policy leagues_read on leagues for select using (auth.uid() is not null);
create policy seasons_read on league_seasons for select using (auth.uid() is not null);
create policy rules_read on league_rules for select using (auth.uid() is not null);
create policy comparables_read on comparable_contracts
  for select using (organization_id is null or is_org_member(organization_id));
