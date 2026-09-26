begin;
select plan(174);

-- Authority fixtures: contacts c1/c3/c6 belong to active Contributors and hold
-- a director Person row (c1 and c6 by contact, c3 through contributor_id), c2
-- is an inactive Contributor without a Person row, c4 is a core_contributor
-- rather than a director, and c5 has no Contributor record at all.
insert into public.dev_community_contacts(id,first_source) values
  ('11111111-1111-4111-8111-111111111111','manual'),
  ('22222222-2222-4222-8222-222222222222','manual'),
  ('33333333-3333-4333-8333-333333333333','manual'),
  ('44444444-4444-4444-8444-444444444444','manual'),
  ('55555555-5555-4555-8555-555555555555','manual'),
  ('66666666-6666-4666-8666-666666666666','manual');
insert into public.dev_contributors(id,contact_id,status,became_contributor_at) values
  ('a1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','active',now()-interval '30 days'),
  ('a2000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','inactive',now()-interval '30 days'),
  ('a3000000-0000-4000-8000-000000000003','33333333-3333-4333-8333-333333333333','active',now()-interval '30 days'),
  ('a4000000-0000-4000-8000-000000000004','44444444-4444-4444-8444-444444444444','active',now()-interval '30 days'),
  ('a6000000-0000-4000-8000-000000000006','66666666-6666-4666-8666-666666666666','active',now()-interval '30 days');
insert into public.dev_people(id,contact_id,contributor_id,slug,display_name,person_type,role,nominating_director_id,effective_date) values
  ('b1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','director-by-contact','Director By Contact','director','Secretary',null,null),
  ('b3000000-0000-4000-8000-000000000003',null,'a3000000-0000-4000-8000-000000000003','director-by-contributor','Director By Contributor','director','Treasurer',null,null),
  ('b4000000-0000-4000-8000-000000000004',null,'a4000000-0000-4000-8000-000000000004','core-contributor','Core Contributor','core_contributor','Research Lead','b1000000-0000-4000-8000-000000000001',current_date),
  ('b6000000-0000-4000-8000-000000000006','66666666-6666-4666-8666-666666666666','a6000000-0000-4000-8000-000000000006','director-three','Director Three','director','Director',null,null);

insert into public.prod_community_contacts(id,first_source) values
  ('99999999-9999-4999-8999-999999999999','manual');
insert into public.prod_contributors(id,contact_id,status,became_contributor_at) values
  ('a9000000-0000-4000-8000-000000000009','99999999-9999-4999-8999-999999999999','active',now()-interval '30 days');
insert into public.prod_people(id,contact_id,contributor_id,slug,display_name,person_type,role) values
  ('b9000000-0000-4000-8000-000000000009','99999999-9999-4999-8999-999999999999','a9000000-0000-4000-8000-000000000009','prod-director','Production Director','director','President');

select has_table('public','dev_rein_mvp_vote_types','development vote type rules table exists');
select has_table('public','prod_rein_mvp_vote_types','production vote type rules table exists');
select has_table('public','dev_rein_mvp_proposals','development proposals table exists');
select has_table('public','prod_rein_mvp_proposals','production proposals table exists');
select has_table('public','dev_rein_mvp_polls','development polls table exists');
select has_table('public','prod_rein_mvp_polls','production polls table exists');
select has_table('public','dev_rein_mvp_ballots','development ballots table exists');
select has_table('public','prod_rein_mvp_ballots','production ballots table exists');
select has_table('public','dev_rein_mvp_proposal_revisions','development feedback table exists');
select has_table('public','prod_rein_mvp_proposal_revisions','production feedback table exists');

-- Vote type rules are operator configuration with no implicit default, and a
-- rule that allows no approval at all is not a meaningful vote.
select throws_ok(
  $$insert into public.dev_rein_mvp_vote_types(vote_type,max_candidates,max_approvals_per_voter)
    values ('zero_approvals',2,0)$$,
  '23514',null,'a type rule without an allowed approval is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_vote_types(vote_type,max_candidates,max_approvals_per_voter)
    values ('over_approved',1,2)$$,
  '23514',null,'a type rule that allows more approvals than candidates is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_vote_types(vote_type,max_candidates,max_approvals_per_voter)
    values ('Funding',3,2)$$,
  '23514',null,'a type name that is not lower snake case is rejected'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_vote_types(vote_type,max_candidates,max_approvals_per_voter)
    values ('funding',3,2)$$,
  'an operator can register the funding rule'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_vote_types(vote_type,max_candidates,max_approvals_per_voter)
    values ('routine',1,1)$$,
  'an operator can register a single-candidate routine rule'
);
insert into public.prod_rein_mvp_vote_types(vote_type,max_candidates,max_approvals_per_voter)
  values ('funding',3,2);

-- Proposals: an active Contributor proposes, the amount is optional but
-- complete, and the recorded content is frozen.
select lives_ok(
  $$insert into public.dev_rein_mvp_proposals(id,proposer_contact_id,title,summary,vote_type,requested_minor,currency)
    values ('aaaaaaa1-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','Fund the reading room','Two paragraph summary','funding',250000,'USD')$$,
  'a proposal with a requested amount is accepted'
);
select is(
  (select status from public.dev_rein_mvp_proposals where id='aaaaaaa1-1111-4111-8111-111111111111'),
  'submitted',
  'a new proposal starts in submitted status'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type)
    values ('11111111-1111-4111-8111-111111111111','   ','funding')$$,
  '23514',null,'a blank proposal title is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type,requested_minor,currency)
    values ('11111111-1111-4111-8111-111111111111','Negative','funding',-1,'USD')$$,
  '23514',null,'a negative requested amount is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type,requested_minor)
    values ('11111111-1111-4111-8111-111111111111','No currency','funding',100)$$,
  '23514',null,'a requested amount without a currency is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type,currency)
    values ('11111111-1111-4111-8111-111111111111','No amount','funding','USD')$$,
  '23514',null,'a currency without a requested amount is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type)
    values ('11111111-1111-4111-8111-111111111111','Unregistered type','nonexistent')$$,
  '23503',null,'a proposal cannot name a vote type that has no rule'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type)
    values ('22222222-2222-4222-8222-222222222222','Stale proposer','funding')$$,
  '23514',null,'a proposer without an active Contributor record is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type)
    values ('55555555-5555-4555-8555-555555555555','Contact without Contributor','funding')$$,
  '23514',null,'a proposer contact without a Contributor record is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Unknown proposer','funding')$$,
  '23503',null,'a proposer with no contact record is rejected'
);

insert into public.dev_rein_mvp_proposals(id,proposer_contact_id,title,vote_type) values
  ('aaaaaaa2-1111-4111-8111-111111111112','11111111-1111-4111-8111-111111111111','Second funding request','funding'),
  ('aaaaaaa3-1111-4111-8111-111111111113','11111111-1111-4111-8111-111111111111','Third funding request','funding'),
  ('aaaaaaa4-1111-4111-8111-111111111114','11111111-1111-4111-8111-111111111111','Fourth funding request','funding'),
  ('aaaaaaa5-1111-4111-8111-111111111115','11111111-1111-4111-8111-111111111111','Routine study group','routine');
insert into public.prod_rein_mvp_proposals(id,proposer_contact_id,title,vote_type) values
  ('aaaaaaa6-1111-4111-8111-111111111116','99999999-9999-4999-8999-999999999999','Production request','funding');

-- Version 1 of every proposal is the content it was submitted with, so the
-- chain of prior versions starts complete.
select ok(
  (select changed_fields = array['title', 'summary', 'budget']
     from public.dev_rein_mvp_proposal_revisions
    where proposal_id='aaaaaaa1-1111-4111-8111-111111111111' and version=1),
  'intake records version one of the recorded content'
);
select ok(
  (select changed_fields = array['title'] and approved_by_contact_id is null
     from public.dev_rein_mvp_proposal_revisions
    where proposal_id='aaaaaaa2-1111-4111-8111-111111111112' and version=1),
  'a proposal without a summary or an amount records only its title'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type,status)
    values ('11111111-1111-4111-8111-111111111111','Born selected','funding','selected')$$,
  '23514',null,'a new proposal always starts submitted'
);

select lives_ok(
  $$update public.dev_rein_mvp_proposals set title='Fund the reading room (revised)'
    where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  'proposal text is editable while the proposal is still submitted'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals set version=2
    where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'an unrevised draft cannot claim a later version'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals set status='not_a_status'
    where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'a proposal status outside the recorded set is rejected'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals set status='selected'
    where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'a selection cannot be recorded outside the finalize function'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals set vote_type='routine'
    where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23001',null,'a recorded proposal cannot change its vote type'
);
select throws_ok(
  $$delete from public.dev_rein_mvp_proposals
    where id='aaaaaaa4-1111-4111-8111-111111111114'$$,
  '23001',null,'a proposal is not deleted'
);

-- Polls: a director opens an approval-only poll over named candidates of one
-- vote type, and the poll freezes the rule values in force at creation.
select lives_ok(
  $$insert into public.dev_rein_mvp_polls(id,creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333333','Funding round one','funding',
      array['aaaaaaa1-1111-4111-8111-111111111111','aaaaaaa2-1111-4111-8111-111111111112','aaaaaaa3-1111-4111-8111-111111111113']::uuid[],
      now()-interval '2 hours',now()-interval '1 hour')$$,
  'a director opens a poll over three funding candidates'
);
select ok(
  (select candidate_limit=3 and max_approvals_per_voter=2 from public.dev_rein_mvp_polls
    where id='44444444-4444-4444-8444-444444444441'),
  'the poll freezes the candidate limit and approval limit of the funding rule'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Backwards','routine',array['aaaaaaa5-1111-4111-8111-111111111115']::uuid[],now(),now())$$,
  '23514',null,'a poll that closes when it opens is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','No candidate','routine',array[]::uuid[],now(),now()+interval '1 hour')$$,
  '23514',null,'a poll without a candidate is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Duplicate candidate','funding',
      array['aaaaaaa4-1111-4111-8111-111111111114','aaaaaaa4-1111-4111-8111-111111111114']::uuid[],now(),now()+interval '1 hour')$$,
  '23514',null,'duplicate poll candidates are rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Too many candidates','funding',
      array['aaaaaaa1-1111-4111-8111-111111111111','aaaaaaa2-1111-4111-8111-111111111112','aaaaaaa3-1111-4111-8111-111111111113','aaaaaaa4-1111-4111-8111-111111111114']::uuid[],
      now(),now()+interval '1 hour')$$,
  '23514',null,'more candidates than the rule allows are rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Unknown candidate','funding',
      array['dddddddd-dddd-4ddd-8ddd-dddddddddddd']::uuid[],now(),now()+interval '1 hour')$$,
  '23503',null,'a poll candidate that is not a proposal is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Mixed types','funding',
      array['aaaaaaa5-1111-4111-8111-111111111115']::uuid[],now(),now()+interval '1 hour')$$,
  '23514',null,'a candidate of another vote type is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Overlapping poll','funding',
      array['aaaaaaa1-1111-4111-8111-111111111111']::uuid[],now(),now()+interval '1 hour')$$,
  '23514',null,'a candidate that is already on an open poll is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Unregistered type','nonexistent',
      array['aaaaaaa4-1111-4111-8111-111111111114']::uuid[],now(),now()+interval '1 hour')$$,
  '23503',null,'a poll cannot name a vote type that has no rule'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('22222222-2222-4222-8222-222222222222','Stale creator','funding',
      array['aaaaaaa4-1111-4111-8111-111111111114']::uuid[],now(),now()+interval '1 hour')$$,
  '23514',null,'a poll creator without a director record is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('44444444-4444-4444-8444-444444444444','Core contributor creator','funding',
      array['aaaaaaa4-1111-4111-8111-111111111114']::uuid[],now(),now()+interval '1 hour')$$,
  '23514',null,'a core_contributor who is not a director cannot open a poll'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_polls(id,creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('44444444-4444-4444-8444-444444444442','33333333-3333-4333-8333-333333333333','Routine round','routine',
      array['aaaaaaa5-1111-4111-8111-111111111115']::uuid[],now()-interval '2 hours',now()-interval '1 hour')$$,
  'a single-candidate poll is accepted'
);
select ok(
  (select candidate_limit=1 and max_approvals_per_voter=1 from public.dev_rein_mvp_polls
    where id='44444444-4444-4444-8444-444444444442'),
  'the single-candidate poll freezes its own rule values'
);
select throws_ok(
  $$update public.dev_rein_mvp_polls set candidate_proposal_ids=array['aaaaaaa4-1111-4111-8111-111111111114']::uuid[]
    where id='44444444-4444-4444-8444-444444444441'$$,
  '23001',null,'poll candidates cannot be changed after creation'
);
select throws_ok(
  $$update public.dev_rein_mvp_polls set closes_at=closes_at+interval '1 day'
    where id='44444444-4444-4444-8444-444444444441'$$,
  '23001',null,'a poll deadline cannot be extended after creation'
);
select throws_ok(
  $$delete from public.dev_rein_mvp_polls where id='44444444-4444-4444-8444-444444444441'$$,
  '23001',null,'a poll is not deleted'
);

-- Ballots: one ballot per voter, approved_proposal_ids limited to the poll's
-- candidates and to the frozen approval limit, empty array meaning abstention.
select lives_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444441','11111111-1111-4111-8111-111111111111',
      array['aaaaaaa1-1111-4111-8111-111111111111']::uuid[],now()-interval '90 minutes')$$,
  'a director ballot inside the poll window is accepted'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333333',
      array[]::uuid[],now()-interval '90 minutes')$$,
  'an empty approved array records an abstention'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444441','66666666-6666-4666-8666-666666666666',
      array['aaaaaaa1-1111-4111-8111-111111111111','aaaaaaa2-1111-4111-8111-111111111112']::uuid[],
      now()-interval '90 minutes')$$,
  'a ballot approving up to the frozen approval limit is accepted'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444441','11111111-1111-4111-8111-111111111111',
      array[]::uuid[],now()-interval '90 minutes')$$,
  '23505',null,'a second ballot from the same voter is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids)
    values ('44444444-4444-4444-8444-444444444441','22222222-2222-4222-8222-222222222222',array[]::uuid[])$$,
  '23514',null,'a voter who is not a current director cannot abstain either'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids)
    values ('44444444-4444-4444-8444-444444444441','22222222-2222-4222-8222-222222222222',array['aaaaaaa1-1111-4111-8111-111111111111']::uuid[])$$,
  '23514',null,'a voter without a director record is rejected before the approval list is read'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids)
    values ('44444444-4444-4444-8444-444444444441','66666666-6666-4666-8666-666666666666',array['aaaaaaa4-1111-4111-8111-111111111114']::uuid[])$$,
  '23514',null,'approving a proposal that is not a candidate of the poll is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids)
    values ('44444444-4444-4444-8444-444444444441','66666666-6666-4666-8666-666666666666',
      array['aaaaaaa1-1111-4111-8111-111111111111','aaaaaaa1-1111-4111-8111-111111111111']::uuid[])$$,
  '23514',null,'approving the same proposal twice inside one ballot is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids)
    values ('44444444-4444-4444-8444-444444444441','66666666-6666-4666-8666-666666666666',
      array['aaaaaaa1-1111-4111-8111-111111111111','aaaaaaa2-1111-4111-8111-111111111112','aaaaaaa3-1111-4111-8111-111111111113']::uuid[])$$,
  '23514',null,'approving more proposals than the frozen approval limit is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444441','66666666-6666-4666-8666-666666666666',array[]::uuid[],now()-interval '3 hours')$$,
  '23514',null,'a ballot cast before the poll opens is rejected'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444441','66666666-6666-4666-8666-666666666666',array[]::uuid[],now()+interval '1 hour')$$,
  '23514',null,'a ballot cast after the poll closes is rejected'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444442','11111111-1111-4111-8111-111111111111',
      array['aaaaaaa5-1111-4111-8111-111111111115']::uuid[],now()-interval '90 minutes')$$,
  'a ballot on a single-candidate poll is accepted'
);
select throws_ok(
  $$update public.dev_rein_mvp_ballots set approved_proposal_ids=array[]::uuid[]
    where poll_id='44444444-4444-4444-8444-444444444441'$$,
  '23001',null,'a recorded ballot cannot be replaced'
);
select throws_ok(
  $$delete from public.dev_rein_mvp_ballots where poll_id='44444444-4444-4444-8444-444444444441'$$,
  '23001',null,'a recorded ballot cannot be removed'
);

-- Finalization: one call closes a poll whose window has run out, recounts the
-- ballots, records the director who did it, and refuses to invent a winner.
select throws_ok(
  $$update public.dev_rein_mvp_polls set status='closed'
    where id='44444444-4444-4444-8444-444444444441'$$,
  '23514',null,'a bare status write does not close a poll'
);
select throws_ok(
  $$select public.dev_rein_mvp_finalize_poll('44444444-4444-4444-8444-444444444441','22222222-2222-4222-8222-222222222222')$$,
  '23514',null,'a finalizing contact who is not a current director is refused'
);
select throws_ok(
  $$select public.dev_rein_mvp_finalize_poll('99999999-1111-4111-8111-111111111119','33333333-3333-4333-8333-333333333333')$$,
  '23503',null,'an unknown poll carries no outcome'
);
select lives_ok(
  $$select public.dev_rein_mvp_finalize_poll('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333333')$$,
  'a director finalizes the funding poll'
);
select is(
  (select status from public.dev_rein_mvp_polls where id='44444444-4444-4444-8444-444444444441'),
  'closed','finalizing closes the poll'
);
select is(
  (select status from public.dev_rein_mvp_proposals where id='aaaaaaa1-1111-4111-8111-111111111111'),
  'selected','the candidate with the highest approval count is selected'
);
select is(
  (select status from public.dev_rein_mvp_proposals where id='aaaaaaa2-1111-4111-8111-111111111112'),
  'unselected','a candidate with fewer approvals is unselected'
);
select is(
  (select status from public.dev_rein_mvp_proposals where id='aaaaaaa3-1111-4111-8111-111111111113'),
  'unselected','a candidate nobody approved is unselected'
);
select is(
  (select winning_proposal_id::text from public.dev_rein_mvp_polls
    where id='44444444-4444-4444-8444-444444444441'),
  'aaaaaaa1-1111-4111-8111-111111111111','the poll records the counted winner'
);
select is(
  (select finalized_by_contact_id::text from public.dev_rein_mvp_polls
    where id='44444444-4444-4444-8444-444444444441'),
  '33333333-3333-4333-8333-333333333333','the poll records the director who finalized it'
);
select ok(
  (select (public.dev_rein_mvp_finalize_poll('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333333')->>'repeated')::boolean),
  'finalizing an already finalized poll returns the recorded outcome'
);
select is(
  (select winning_proposal_id::text from public.dev_rein_mvp_polls
    where id='44444444-4444-4444-8444-444444444441'),
  'aaaaaaa1-1111-4111-8111-111111111111','the repeated call does not recount the winner'
);
select throws_ok(
  $$update public.dev_rein_mvp_polls set winning_proposal_id='aaaaaaa2-1111-4111-8111-111111111112'
    where id='44444444-4444-4444-8444-444444444441'$$,
  '23001',null,'a recorded poll outcome is not rewritten'
);
select throws_ok(
  $$update public.dev_rein_mvp_polls set status='open'
    where id='44444444-4444-4444-8444-444444444441'$$,
  '23514',null,'a closed poll cannot be reopened'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals set status='selected'
    where id='aaaaaaa2-1111-4111-8111-111111111112'$$,
  '23514',null,'an unselected proposal cannot be re-marked selected by hand'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals set status='submitted'
    where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'a selected proposal cannot return to submitted'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals set title='Renamed after selection'
    where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23001',null,'recorded proposal text changes only through a revision'
);

-- Cancelling is the separate early exit: a poll inside its window cannot be
-- closed or finalized, and a cancelled poll carries no outcome.
select lives_ok(
  $$update public.dev_rein_mvp_polls set status='cancelled'
    where id='44444444-4444-4444-8444-444444444442'$$,
  'a director cancels the routine poll instead of closing it early'
);
select lives_ok(
  $$update public.dev_rein_mvp_vote_types set max_candidates=2,max_approvals_per_voter=2 where vote_type='routine'$$,
  'an operator can change a vote type rule'
);
select ok(
  (select candidate_limit=1 and max_approvals_per_voter=1 from public.dev_rein_mvp_polls
    where id='44444444-4444-4444-8444-444444444442'),
  'an existing poll keeps the rule values it froze'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_polls(id,creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','Routine round cancelled','routine',
      array['aaaaaaa5-1111-4111-8111-111111111115']::uuid[],now()-interval '1 hour',now()+interval '1 hour')$$,
  'a rule change applies to polls created afterwards'
);
select ok(
  (select candidate_limit=2 and max_approvals_per_voter=2 from public.dev_rein_mvp_polls
    where id='44444444-4444-4444-8444-444444444444'),
  'the later poll freezes the updated rule values'
);
select throws_ok(
  $$update public.dev_rein_mvp_polls set status='closed'
    where id='44444444-4444-4444-8444-444444444444'$$,
  '23514',null,'a poll cannot be closed before its window runs out'
);
select throws_ok(
  $$select public.dev_rein_mvp_finalize_poll('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333')$$,
  '23514',null,'a poll cannot be finalized before its window runs out'
);
select lives_ok(
  $$update public.dev_rein_mvp_polls set status='cancelled' where id='44444444-4444-4444-8444-444444444444'$$,
  'a director cancels the later poll'
);
select throws_ok(
  $$select public.dev_rein_mvp_finalize_poll('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333')$$,
  '23514',null,'a cancelled poll carries no outcome'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids)
    values ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',array[]::uuid[])$$,
  '23514',null,'a cancelled poll takes no ballot'
);
select throws_ok(
  $$update public.dev_rein_mvp_polls set status='open' where id='44444444-4444-4444-8444-444444444444'$$,
  '23514',null,'a cancelled poll cannot be reopened'
);

-- A tie and an all-abstain poll both record no winner, so no proposal is
-- promoted on a coin flip.
select lives_ok(
  $$insert into public.dev_rein_mvp_polls(id,creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('44444444-4444-4444-8444-444444444446','33333333-3333-4333-8333-333333333333','Funding round two','funding',
      array['aaaaaaa2-1111-4111-8111-111111111112','aaaaaaa3-1111-4111-8111-111111111113']::uuid[],
      now()-interval '2 hours',now()-interval '1 hour')$$,
  'a later poll carries the unselected candidates'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444446','11111111-1111-4111-8111-111111111111',
      array['aaaaaaa2-1111-4111-8111-111111111112']::uuid[],now()-interval '90 minutes');
    insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444446','66666666-6666-4666-8666-666666666666',
      array['aaaaaaa3-1111-4111-8111-111111111113']::uuid[],now()-interval '90 minutes')$$,
  'two directors approve one candidate each'
);
select lives_ok(
  $$select public.dev_rein_mvp_finalize_poll('44444444-4444-4444-8444-444444444446','33333333-3333-4333-8333-333333333333')$$,
  'a tied poll is finalized'
);
select ok(
  (select winning_proposal_id is null and finalized_at is not null
     from public.dev_rein_mvp_polls where id='44444444-4444-4444-8444-444444444446'),
  'a tie records no winner'
);
select is(
  (select status from public.dev_rein_mvp_proposals where id='aaaaaaa2-1111-4111-8111-111111111112'),
  'unselected','the first tied candidate is not selected'
);
select is(
  (select status from public.dev_rein_mvp_proposals where id='aaaaaaa3-1111-4111-8111-111111111113'),
  'unselected','the second tied candidate is not selected'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_polls(id,creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('44444444-4444-4444-8444-444444444447','33333333-3333-4333-8333-333333333333','Funding round three','funding',
      array['aaaaaaa3-1111-4111-8111-111111111113']::uuid[],now()-interval '2 hours',now()-interval '1 hour')$$,
  'a candidate with no approvals may enter a later poll'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('44444444-4444-4444-8444-444444444447','11111111-1111-4111-8111-111111111111',array[]::uuid[],now()-interval '90 minutes')$$,
  'the only ballot on the third round abstains'
);
select lives_ok(
  $$select public.dev_rein_mvp_finalize_poll('44444444-4444-4444-8444-444444444447','11111111-1111-4111-8111-111111111111')$$,
  'an all-abstain poll is finalized'
);
select ok(
  (select winning_proposal_id is null from public.dev_rein_mvp_polls
    where id='44444444-4444-4444-8444-444444444447'),
  'an all-abstain poll records no winner'
);
select is(
  (select status from public.dev_rein_mvp_proposals where id='aaaaaaa3-1111-4111-8111-111111111113'),
  'unselected','an all-abstain candidate stays unselected'
);

-- Carryover: a rule change does not move an existing poll, and only submitted
-- or unselected proposals may be named by a later poll.
select lives_ok(
  $$insert into public.dev_rein_mvp_polls(id,creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('44444444-4444-4444-8444-444444444445','33333333-3333-4333-8333-333333333333','Carryover round','funding',
      array['aaaaaaa2-1111-4111-8111-111111111112']::uuid[],now()-interval '1 hour',now()+interval '1 hour')$$,
  'an unselected proposal may be carried into a later poll'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Second selection','funding',
      array['aaaaaaa1-1111-4111-8111-111111111111']::uuid[],now(),now()+interval '1 hour')$$,
  '23514',null,'a selected proposal cannot be carried into a later poll'
);
select lives_ok(
  $$update public.dev_rein_mvp_proposals set status='withdrawn'
    where id='aaaaaaa4-1111-4111-8111-111111111114'$$,
  'a submitted proposal can be withdrawn'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_polls(creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('33333333-3333-4333-8333-333333333333','Withdrawn candidate','funding',
      array['aaaaaaa4-1111-4111-8111-111111111114']::uuid[],now(),now()+interval '1 hour')$$,
  '23514',null,'a withdrawn proposal cannot enter a new poll'
);

-- Feedback and revisions: one append-only table holds comments and suggested
-- revisions, applying a revision moves exactly the fields it named, and only
-- a material change (budget, location, schedule, personnel composition, or
-- major event flow) needs a recorded approval from a current director.
-- Feedback is the post-result path, so it is accepted only on a proposal the
-- poll recorded as the winner; an unselected or withdrawn proposal takes no
-- new comment or revision, and the version-1 row of every proposal is still
-- written by its own intake trigger.
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
    values ('aaaaaaa2-1111-4111-8111-111111111112','44444444-4444-4444-8444-444444444444',
            'Comment on a proposal nobody selected')$$,
  '23514',null,'an unselected proposal takes no comment'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,changed_fields,summary)
    values ('aaaaaaa2-1111-4111-8111-111111111112','44444444-4444-4444-8444-444444444444',
            array['summary'],'Reworded after losing')$$,
  '23514',null,'an unselected proposal takes no suggested revision'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
    values ('aaaaaaa3-1111-4111-8111-111111111113','11111111-1111-4111-8111-111111111111',
            'Director comment on a proposal nobody approved')$$,
  '23514',null,'not even a current director records feedback on an unselected proposal'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
    values ('aaaaaaa4-1111-4111-8111-111111111114','11111111-1111-4111-8111-111111111111',
            'Comment on a proposal still under consideration')$$,
  '23514',null,'a proposal that has not been decided yet takes no feedback'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,changed_fields,summary)
    values ('aaaaaaa4-1111-4111-8111-111111111114','44444444-4444-4444-8444-444444444444',
            array['summary'],'Reworded before the vote')$$,
  '23514',null,'a submitted proposal takes no suggested revision'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
    values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','44444444-4444-4444-8444-444444444444',
            'Comment on a proposal that does not exist')$$,
  '23503',null,'feedback names an existing proposal'
);
-- The intake exemption is trigger depth, not a caller-settable flag, and a
-- caller cannot reach the integer it compares against. Neither a copied local
-- setting nor a hand-written version-1 row puts feedback on a proposal that
-- was never selected; intake itself still records its own version one.
select throws_ok(
  $$do $forge$
    begin
      perform set_config('dev_rein_mvp.revision_origin','aaaaaaa2-1111-4111-8111-111111111112',true);
      insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
        values ('aaaaaaa2-1111-4111-8111-111111111112','44444444-4444-4444-8444-444444444444',
                'Feedback smuggled past the status gate');
    end
    $forge$;$$,
  '23514',null,'a caller cannot exempt itself by copying the intake flag'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,version,author_contact_id,note)
    values ('aaaaaaa2-1111-4111-8111-111111111112',1,'44444444-4444-4444-8444-444444444444',
            'A hand-written version one')$$,
  '23514',null,'a caller cannot claim the intake version for an unselected proposal'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals
       set summary='Applied without any feedback record', effective_revision_id=null
     where id='aaaaaaa2-1111-4111-8111-111111111112'$$,
  '23001',null,'an unselected proposal cannot be changed outside a recorded revision'
);
select is(
  (select count(*) from public.dev_rein_mvp_proposal_revisions
    where proposal_id in ('aaaaaaa2-1111-4111-8111-111111111112','aaaaaaa3-1111-4111-8111-111111111113',
                          'aaaaaaa4-1111-4111-8111-111111111114')),
  3::bigint,
  'the only feedback rows on undecided and losing proposals are their version-one intake rows'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(id,proposal_id,author_contact_id,note)
    values ('e1000000-0000-4000-8000-000000000001','aaaaaaa1-1111-4111-8111-111111111111',
            '44444444-4444-4444-8444-444444444444','Please keep the reading room open later')$$,
  'an active Contributor records a comment'
);
select ok(
  (select changed_fields = array[]::text[] and version is null
     from public.dev_rein_mvp_proposal_revisions where id='e1000000-0000-4000-8000-000000000001'),
  'a comment records no changed fields and no version'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
    values ('aaaaaaa1-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Inactive Contributor')$$,
  '23514',null,'an inactive Contributor cannot record feedback'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
    values ('aaaaaaa1-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','Unknown contact')$$,
  '23514',null,'a contact without a Contributor or director record cannot record feedback'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,version,author_contact_id,note)
    values ('aaaaaaa1-1111-4111-8111-111111111111',2,'44444444-4444-4444-8444-444444444444','Numbered comment')$$,
  '23514',null,'a comment cannot claim a version'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
    values ('aaaaaaa1-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','   ')$$,
  '23514',null,'a comment without a body is rejected'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposal_revisions set note='Rewritten'
      where id='e1000000-0000-4000-8000-000000000001'$$,
  '23001',null,'recorded feedback is append-only'
);
select throws_ok(
  $$delete from public.dev_rein_mvp_proposal_revisions
      where id='e1000000-0000-4000-8000-000000000001'$$,
  '23001',null,'recorded feedback is not deleted'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,changed_fields,title)
    values ('aaaaaaa1-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',array['venue'],'Renamed')$$,
  '23514',null,'a revision cannot name a field the schema does not record'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,changed_fields)
    values ('aaaaaaa1-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',array['summary'])$$,
  '23514',null,'a named field carries the value it records'
);
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,version,author_contact_id,changed_fields,summary)
    values ('aaaaaaa1-1111-4111-8111-111111111111',2,'44444444-4444-4444-8444-444444444444',array['summary'],'Numbered')$$,
  '23514',null,'a revision takes its version when it becomes effective'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(id,proposal_id,author_contact_id,changed_fields,summary,note)
    values ('e2000000-0000-4000-8000-000000000002','aaaaaaa1-1111-4111-8111-111111111111',
            '44444444-4444-4444-8444-444444444444',array['summary'],'Revised summary text','Wording fix')$$,
  'a Contributor suggests a wording revision'
);
select lives_ok(
  $$update public.dev_rein_mvp_proposals
       set summary='Revised summary text', effective_revision_id='e2000000-0000-4000-8000-000000000002'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  'a minor wording revision takes effect without a director approval'
);
select ok(
  (select version=2 and summary='Revised summary text'
     from public.dev_rein_mvp_proposals where id='aaaaaaa1-1111-4111-8111-111111111111'),
  'the applied revision advances the proposal version'
);
select ok(
  (select version=2 from public.dev_rein_mvp_proposal_revisions
    where id='e2000000-0000-4000-8000-000000000002'),
  'the applied revision records the version it produced'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals
       set summary='Comment driven', effective_revision_id='e1000000-0000-4000-8000-000000000001'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'a comment never changes a recorded proposal'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(id,proposal_id,author_contact_id,changed_fields,location,note)
    values ('e3000000-0000-4000-8000-000000000003','aaaaaaa1-1111-4111-8111-111111111111',
            '44444444-4444-4444-8444-444444444444',array['location'],'Online','Move the room online')$$,
  'a Contributor suggests a location change'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals
       set location='Online', effective_revision_id='e3000000-0000-4000-8000-000000000003'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'a location change cannot take effect without a director approval'
);
select throws_ok(
  $$select public.dev_rein_mvp_approve_revision('e3000000-0000-4000-8000-000000000003','44444444-4444-4444-8444-444444444444')$$,
  '23514',null,'a contact without a director record cannot approve'
);
select lives_ok(
  $$select public.dev_rein_mvp_approve_revision('e3000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111')$$,
  'a current director approves the location revision'
);
select throws_ok(
  $$select public.dev_rein_mvp_approve_revision('e3000000-0000-4000-8000-000000000003','66666666-6666-4666-8666-666666666666')$$,
  '23514',null,'a recorded approval is not replaced'
);
select lives_ok(
  $$update public.dev_rein_mvp_proposals
       set location='Online', effective_revision_id='e3000000-0000-4000-8000-000000000003'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  'the approved location change takes effect'
);
select ok(
  (select version=3 and location='Online'
     from public.dev_rein_mvp_proposals where id='aaaaaaa1-1111-4111-8111-111111111111'),
  'the location is persisted on the proposal and the version advances'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals
       set location='Somewhere else', effective_revision_id='e3000000-0000-4000-8000-000000000003'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'an applied revision is not applied twice'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals
       set title='Cross proposal', effective_revision_id='e2000000-0000-4000-8000-000000000002'
     where id='aaaaaaa2-1111-4111-8111-111111111112'$$,
  '23514',null,'a revision of another proposal is refused'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(id,proposal_id,author_contact_id,changed_fields,requested_minor,currency,note)
    values ('e4000000-0000-4000-8000-000000000004','aaaaaaa1-1111-4111-8111-111111111111',
            '44444444-4444-4444-8444-444444444444',array['budget'],300000,'USD','Raise the budget')$$,
  'a Contributor suggests a budget change'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals
       set requested_minor=275000, currency='USD', effective_revision_id='e4000000-0000-4000-8000-000000000004'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'a budget change must match the amount the revision recorded'
);
select lives_ok(
  $$select public.dev_rein_mvp_approve_revision('e4000000-0000-4000-8000-000000000004','66666666-6666-4666-8666-666666666666')$$,
  'a second director approves the budget revision'
);
select lives_ok(
  $$update public.dev_rein_mvp_proposals
       set requested_minor=300000, currency='USD', effective_revision_id='e4000000-0000-4000-8000-000000000004'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  'the approved budget change takes effect'
);
select ok(
  (select version=4 and requested_minor=300000
     from public.dev_rein_mvp_proposals where id='aaaaaaa1-1111-4111-8111-111111111111'),
  'the budget revision advances the proposal to version four'
);
select is(
  (select array_agg(version order by version) from public.dev_rein_mvp_proposal_revisions
    where proposal_id='aaaaaaa1-1111-4111-8111-111111111111' and version is not null),
  array[1, 2, 3, 4],
  'every applied version of the proposal stays recorded'
);
select lives_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(id,proposal_id,author_contact_id,changed_fields,schedule,note)
    values ('e5000000-0000-4000-8000-000000000005','aaaaaaa1-1111-4111-8111-111111111111',
            '44444444-4444-4444-8444-444444444444',array['schedule'],'Sunday 10:00','Move the start time')$$,
  'a Contributor suggests a schedule change'
);
select lives_ok(
  $$select public.dev_rein_mvp_approve_revision('e5000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111')$$,
  'a current director approves the schedule revision'
);
select lives_ok(
  $$update public.dev_people
       set person_type='core_contributor',
           nominating_director_id='b3000000-0000-4000-8000-000000000003',
           effective_date=current_date
     where id='b1000000-0000-4000-8000-000000000001'$$,
  'the approving director steps down from the board'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals
       set schedule='Sunday 10:00', effective_revision_id='e5000000-0000-4000-8000-000000000005'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'a material change is refused once its approver is no longer a director'
);

-- The material gate is the same on the selected path: a selected proposal
-- still stands still until a current director records an approval. Scholar
-- c1 has since stepped down, so the approval must come from a director who
-- holds the seat now.
select lives_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(id,proposal_id,author_contact_id,changed_fields,location,note)
    values ('e6000000-0000-4000-8000-000000000006','aaaaaaa1-1111-4111-8111-111111111111',
            '44444444-4444-4444-8444-444444444444',array['location'],'Community room B','Room changed after the vote')$$,
  'a Contributor records a material revision on the selected proposal'
);
select throws_ok(
  $$update public.dev_rein_mvp_proposals
       set location='Community room B', effective_revision_id='e6000000-0000-4000-8000-000000000006'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  '23514',null,'a material change to the selected proposal still needs a director approval'
);
select throws_ok(
  $$select public.dev_rein_mvp_approve_revision('e6000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111')$$,
  '23514',null,'a director who has since stepped down cannot approve a post-result material change'
);
select lives_ok(
  $$select public.dev_rein_mvp_approve_revision('e6000000-0000-4000-8000-000000000006','33333333-3333-4333-8333-333333333333')$$,
  'a current director approves the post-result material revision'
);
select lives_ok(
  $$update public.dev_rein_mvp_proposals
       set location='Community room B', effective_revision_id='e6000000-0000-4000-8000-000000000006'
     where id='aaaaaaa1-1111-4111-8111-111111111111'$$,
  'the approved post-result material change takes effect on the selected proposal'
);
select ok(
  (select version=5 and location='Community room B' and status='selected'
     from public.dev_rein_mvp_proposals where id='aaaaaaa1-1111-4111-8111-111111111111'),
  'the selected proposal keeps its status and advances to the approved version'
);

-- A withdrawn proposal is a closed record too: it keeps the feedback it
-- already carried and takes no new feedback.
select throws_ok(
  $$insert into public.dev_rein_mvp_proposal_revisions(proposal_id,author_contact_id,note)
    values ('aaaaaaa4-1111-4111-8111-111111111114','44444444-4444-4444-8444-444444444444',
            'Comment on a withdrawn proposal')$$,
  '23514',null,'a withdrawn proposal takes no feedback'
);

-- The guard is defense in depth: even with a table grant in place and RLS
-- switched off for the test, a Data API role is still refused.
alter table public.dev_rein_mvp_proposals disable row level security;
grant insert on table public.dev_rein_mvp_proposals to authenticated;
select lives_ok(
  $test$
  do $guard$
  declare
    rejected boolean := false;
  begin
    set local role authenticated;
    begin
      insert into public.dev_rein_mvp_proposals(proposer_contact_id,title,vote_type)
        values ('11111111-1111-4111-8111-111111111111','Data API writer','funding');
    exception
      when insufficient_privilege then rejected := true;
    end;
    reset role;
    if not rejected then
      raise exception 'the guard accepted a write from the authenticated role';
    end if;
  end;
  $guard$;
  $test$,
  'the database guard refuses a Data API writer even when a grant exists and RLS is off'
);
alter table public.dev_rein_mvp_proposals enable row level security;
revoke insert on table public.dev_rein_mvp_proposals from authenticated;

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where relnamespace='public'::regnamespace
      and relname in ('dev_rein_mvp_vote_types','dev_rein_mvp_proposals','dev_rein_mvp_polls','dev_rein_mvp_ballots',
                      'dev_rein_mvp_proposal_revisions',
                      'prod_rein_mvp_vote_types','prod_rein_mvp_proposals','prod_rein_mvp_polls','prod_rein_mvp_ballots',
                      'prod_rein_mvp_proposal_revisions')),
  'RLS is enabled on every Rein MVP governance table'
);
select is(
  (select count(*) from pg_policies where schemaname='public' and tablename like '%rein\_mvp\_%' escape '\'),
  0::bigint,
  'no Rein MVP governance table carries a Data API policy'
);
select ok(
  not exists(
    select 1 from (values ('anon'),('authenticated')) role_name(role_name),
      unnest(array['dev_rein_mvp_vote_types','dev_rein_mvp_proposals','dev_rein_mvp_polls','dev_rein_mvp_ballots',
                   'dev_rein_mvp_proposal_revisions']) t
    where has_table_privilege(role_name.role_name,'public.'||t,'select,insert,update,delete')
  )
  and (select bool_and(has_table_privilege('service_role','public.'||t,'select,insert,update,delete'))
       from unnest(array['dev_rein_mvp_vote_types','dev_rein_mvp_proposals','dev_rein_mvp_polls','dev_rein_mvp_ballots',
                         'dev_rein_mvp_proposal_revisions']) t),
  'development governance tables are readable by service_role only'
);
select ok(
  not exists(
    select 1 from (values ('anon'),('authenticated')) role_name(role_name),
      unnest(array['prod_rein_mvp_vote_types','prod_rein_mvp_proposals','prod_rein_mvp_polls','prod_rein_mvp_ballots',
                   'prod_rein_mvp_proposal_revisions']) t
    where has_table_privilege(role_name.role_name,'public.'||t,'select,insert,update,delete')
  )
  and (select bool_and(has_table_privilege('service_role','public.'||t,'select,insert,update,delete'))
       from unnest(array['prod_rein_mvp_vote_types','prod_rein_mvp_proposals','prod_rein_mvp_polls','prod_rein_mvp_ballots',
                         'prod_rein_mvp_proposal_revisions']) t),
  'production governance tables are readable by service_role only'
);

-- Production carries the same flow end to end.
select lives_ok(
  $$insert into public.prod_rein_mvp_polls(id,creator_contact_id,title,vote_type,candidate_proposal_ids,opens_at,closes_at)
    values ('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999','Production poll','funding',
      array['aaaaaaa6-1111-4111-8111-111111111116']::uuid[],now()-interval '2 hours',now()-interval '1 hour');
    insert into public.prod_rein_mvp_ballots(poll_id,voter_contact_id,approved_proposal_ids,cast_at)
    values ('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',
      array['aaaaaaa6-1111-4111-8111-111111111116']::uuid[],now()-interval '90 minutes')$$,
  'production poll and ballot are accepted'
);
select throws_ok(
  $$update public.prod_rein_mvp_ballots set approved_proposal_ids=array[]::uuid[]
    where poll_id='77777777-7777-4777-8777-777777777777'$$,
  '23001',null,'a production ballot cannot be replaced'
);
select lives_ok(
  $$select public.prod_rein_mvp_finalize_poll('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999')$$,
  'production finalizes its poll through the same function'
);
select is(
  (select status from public.prod_rein_mvp_proposals where id='aaaaaaa6-1111-4111-8111-111111111116'),
  'selected','the production winner is recorded as selected'
);
select is(
  (select winning_proposal_id::text from public.prod_rein_mvp_polls
    where id='77777777-7777-4777-8777-777777777777'),
  'aaaaaaa6-1111-4111-8111-111111111116','the production poll records its winner'
);

select throws_ok(
  $$delete from public.dev_community_contacts where id='11111111-1111-4111-8111-111111111111'$$,
  '23503',null,'a contact that proposed, opened, and voted in polls is preserved by RESTRICT'
);
select throws_ok(
  $$delete from public.dev_community_contacts where id='33333333-3333-4333-8333-333333333333'$$,
  '23503',null,'a contact that only opened polls and cast a ballot is preserved by RESTRICT'
);
select is(
  (select count(*) from pg_constraint
    where contype='f' and conrelid::regclass::text like '\_%rein\_mvp\_%' escape '\'
      and confrelid::regclass::text like '\_%community\_contacts' escape '\'
      and confdeltype <> 'r'),
  0::bigint,
  'every Rein MVP contact reference deletes by RESTRICT'
);

with dev_columns as (
  select replace(table_name,'dev_','') table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name
  from information_schema.columns
  where table_schema='public' and table_name like 'dev\_rein\_mvp\_%' escape '\'
), prod_columns as (
  select replace(table_name,'prod_','') table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name
  from information_schema.columns
  where table_schema='public' and table_name like 'prod\_rein\_mvp\_%' escape '\'
)
select is(
  (select jsonb_agg(to_jsonb(dev_columns) order by table_name,ordinal_position) from dev_columns),
  (select jsonb_agg(to_jsonb(prod_columns) order by table_name,ordinal_position) from prod_columns),
  'development and production governance columns stay identical'
);

select * from finish();
rollback;
