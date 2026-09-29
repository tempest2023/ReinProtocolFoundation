begin;

insert into public.dev_rein_mvp_vote_types (vote_type, max_candidates, max_approvals_per_voter)
values ('test_case7_same_day', 1, 1)
on conflict (vote_type) do nothing;

insert into public.dev_rein_mvp_proposals
  (id, proposer_contact_id, title, summary, vote_type, status)
select 'c7a1d0e5-1f2b-4c3d-8e4f-000000000702',
       ci.contact_id,
       '[TEST FIXTURE] Slack MVP case 7 same-day round candidate (synthetic, not a real proposal)',
       'Synthetic dev fixture for the same-day case 7 before/after round. Not a real proposal and not Board business.',
       'test_case7_same_day',
       'submitted'
  from public.dev_contact_identities ci
 where ci.identity_kind = 'email'
   and ci.normalized_value = 'rein-test-lead@rein-protocol.org'
on conflict (id) do nothing;

commit;