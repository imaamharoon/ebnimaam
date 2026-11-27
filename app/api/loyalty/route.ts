import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { checkRateLimit } from '../../../lib/rate-limit';
import { loyaltyPool, ensureLoyaltyTables, ensureReferralCode, getVerifiedCustomer, encryptPrivateDetails, challengeDefinition } from '../../../lib/loyalty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
}
function onlyDigits(value: string) { return value.split('').every((c) => c >= '0' && c <= '9'); }

export async function GET(req: Request) {
  const user = await getVerifiedCustomer(req);
  if (!user) return fail('Sign in with your verified Ebnimaam account to use rewards.', 401);
  try {
    await ensureLoyaltyTables();
    const code = await ensureReferralCode(user.id);
    const [wallet, referrals, settings, team, rows] = await Promise.all([
      loyaltyPool.query("SELECT COALESCE(SUM(amount_kobo),0)::bigint AS balance_kobo,COUNT(*)::int AS entries FROM public.ebnimaam_wallet_ledger WHERE user_id=$1 AND status<>'rejected'", [user.id]),
      loyaltyPool.query("SELECT COUNT(*) FILTER (WHERE status='qualified')::int AS qualified,COUNT(*) FILTER (WHERE status='pending')::int AS pending FROM public.ebnimaam_referrals WHERE referrer_user_id=$1", [user.id]),
      loyaltyPool.query('SELECT referrer_reward_kobo,referred_reward_kobo,challenge_reward_kobo FROM public.ebnimaam_loyalty_settings WHERE id=1'),
      loyaltyPool.query("SELECT t.id,t.invite_code,t.leader_user_id,t.created_at,COUNT(DISTINCT m.user_id)::int AS member_count,COALESCE((SELECT json_agg(json_build_object('day_number',s.day_number,'status',s.status,'admin_note',s.admin_note,'created_at',s.created_at) ORDER BY s.day_number) FROM public.ebnimaam_challenge_submissions s WHERE s.team_id=t.id),'[]'::json) AS submissions FROM public.ebnimaam_challenge_members mine JOIN public.ebnimaam_challenge_teams t ON t.id=mine.team_id JOIN public.ebnimaam_challenge_members m ON m.team_id=t.id WHERE mine.user_id=$1 AND t.challenge_slug=$2 GROUP BY t.id LIMIT 1", [user.id, challengeDefinition.slug]),
      loyaltyPool.query("SELECT id,entry_type,amount_kobo,status,description,created_at FROM public.ebnimaam_wallet_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30", [user.id])
    ]);
    return NextResponse.json({
      ok: true,
      referral: { code, qualified: Number(referrals.rows[0]?.qualified || 0), pending: Number(referrals.rows[0]?.pending || 0), required: 5 },
      wallet: { balance_kobo: Number(wallet.rows[0]?.balance_kobo || 0), entries: Number(wallet.rows[0]?.entries || 0), rows: rows.rows },
      rewards: { referrer_reward_kobo: Number(settings.rows[0]?.referrer_reward_kobo || 0), referred_reward_kobo: Number(settings.rows[0]?.referred_reward_kobo || 0), challenge_reward_kobo: Number(settings.rows[0]?.challenge_reward_kobo || 0) },
      challenge: { definition: challengeDefinition, team: team.rows[0] || null }
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return fail('Ebnimaam rewards are temporarily unavailable. Please try again shortly.', 503);
  }
}

export async function POST(req: Request) {
  const user = await getVerifiedCustomer(req);
  if (!user) return fail('Sign in with your verified Ebnimaam account to continue.', 401);
  let allowed = false;
  try { allowed = await checkRateLimit(req, 'loyalty-action', 12, 15 * 60); }
  catch { return fail('This service is temporarily unavailable. Please try again shortly.', 503); }
  if (!allowed) return fail('Too many rewards requests. Please wait and try again.', 429);
  const size = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(size) && size > 12000) return fail('This request is too large.', 413);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');

  try {
    await ensureLoyaltyTables();
    if (action === 'apply_referral') {
      const code = String(body?.code || '').trim().toUpperCase().slice(0, 20);
      if (code.length < 6 || !onlyDigitsAndLetters(code)) return fail('Enter a valid referral code.');
      const referrer = await loyaltyPool.query('SELECT user_id FROM public.ebnimaam_referral_codes WHERE code=$1', [code]);
      if (!referrer.rowCount) return fail('That referral code was not found.', 404);
      const referrerId = String(referrer.rows[0].user_id);
      if (referrerId === user.id) return fail('You cannot use your own referral code.');
      const paid = await loyaltyPool.query("SELECT 1 FROM public.ebnimaam_orders WHERE auth_user_id=$1 AND status='paid' LIMIT 1", [user.id]);
      if (paid.rowCount) return fail('Referral codes must be applied before your first successful purchase.');
      const prior = await loyaltyPool.query('SELECT 1 FROM public.ebnimaam_referrals WHERE referred_user_id=$1', [user.id]);
      if (prior.rowCount) return fail('A referral code has already been applied to this account.');
      await loyaltyPool.query('INSERT INTO public.ebnimaam_referrals(referred_user_id,referrer_user_id,referral_code) VALUES($1,$2,$3) ON CONFLICT(referred_user_id) DO NOTHING', [user.id, referrerId, code]);
      const saved = await loyaltyPool.query('SELECT referrer_user_id FROM public.ebnimaam_referrals WHERE referred_user_id=$1', [user.id]);
      if (!saved.rowCount || String(saved.rows[0].referrer_user_id) !== referrerId) return fail('A referral code has already been applied to this account.');
      return NextResponse.json({ ok: true, message: 'Referral saved. Your welcome reward is issued only after your first successful Paystack purchase.' });
    }

    if (action === 'create_team') {
      const prior = await loyaltyPool.query('SELECT 1 FROM public.ebnimaam_challenge_members WHERE user_id=$1 AND challenge_slug=$2', [user.id, challengeDefinition.slug]);
      if (prior.rowCount) return fail('You are already on a team for this challenge.');
      const client = await loyaltyPool.connect();
      try {
        await client.query('BEGIN');
        const inviteCode = randomBytes(5).toString('hex').toUpperCase();
        const created = await client.query('INSERT INTO public.ebnimaam_challenge_teams(challenge_slug,invite_code,leader_user_id) VALUES($1,$2,$3) RETURNING id,invite_code,created_at', [challengeDefinition.slug, inviteCode, user.id]);
        await client.query('INSERT INTO public.ebnimaam_challenge_members(team_id,challenge_slug,user_id) VALUES($1,$2,$3)', [created.rows[0].id, challengeDefinition.slug, user.id]);
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, team: created.rows[0] });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }

    if (action === 'join_team') {
      const inviteCode = String(body?.inviteCode || '').trim().toUpperCase().slice(0, 20);
      if (inviteCode.length < 8 || !onlyHex(inviteCode)) return fail('Enter a valid team invitation code.');
      const client = await loyaltyPool.connect();
      try {
        await client.query('BEGIN');
        const prior = await client.query('SELECT 1 FROM public.ebnimaam_challenge_members WHERE user_id=$1 AND challenge_slug=$2', [user.id, challengeDefinition.slug]);
        if (prior.rowCount) { await client.query('ROLLBACK'); return fail('You are already on a team for this challenge.'); }
        const found = await client.query('SELECT id FROM public.ebnimaam_challenge_teams WHERE invite_code=$1 AND challenge_slug=$2 FOR UPDATE', [inviteCode, challengeDefinition.slug]);
        if (!found.rowCount) { await client.query('ROLLBACK'); return fail('That team invitation code was not found.', 404); }
        const count = await client.query('SELECT COUNT(*)::int AS n FROM public.ebnimaam_challenge_members WHERE team_id=$1', [found.rows[0].id]);
        if (Number(count.rows[0].n) >= challengeDefinition.maxTeamSize) { await client.query('ROLLBACK'); return fail('This team is already full.'); }
        await client.query('INSERT INTO public.ebnimaam_challenge_members(team_id,challenge_slug,user_id) VALUES($1,$2,$3)', [found.rows[0].id, challengeDefinition.slug, user.id]);
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, message: 'You have joined the team.' });
      } catch (error: any) {
        await client.query('ROLLBACK');
        if (error?.code === '23505') return fail('You are already on a team for this challenge.');
        throw error;
      } finally { client.release(); }
    }

    if (action === 'submit_milestone') {
      const day = Number(body?.day);
      const evidence = String(body?.evidence || '').trim().slice(0, 3000);
      if (!Number.isInteger(day) || day < 1 || day > 7 || evidence.length < 40) return fail('Choose a day and provide at least 40 characters describing your team evidence.');
      const team = await loyaltyPool.query('SELECT t.id,t.created_at FROM public.ebnimaam_challenge_teams t JOIN public.ebnimaam_challenge_members m ON m.team_id=t.id WHERE m.user_id=$1 AND t.challenge_slug=$2', [user.id, challengeDefinition.slug]);
      if (!team.rowCount) return fail('Join or create a team before submitting a milestone.');
      const started = new Date(team.rows[0].created_at).getTime();
      if (Date.now() < started + (day - 1) * 24 * 60 * 60 * 1000) return fail('That milestone opens after the previous challenge day has passed.');
      if (day > 1) {
        const priorDay = await loyaltyPool.query("SELECT status FROM public.ebnimaam_challenge_submissions WHERE team_id=$1 AND day_number=$2", [team.rows[0].id, day - 1]);
        if (!priorDay.rowCount || String(priorDay.rows[0].status) !== 'approved') return fail('Your previous challenge day must be approved before you can submit this milestone.');
      }
      const submitted = await loyaltyPool.query("INSERT INTO public.ebnimaam_challenge_submissions(team_id,day_number,submitted_by,evidence) VALUES($1,$2,$3,$4) ON CONFLICT(team_id,day_number) DO UPDATE SET submitted_by=EXCLUDED.submitted_by,evidence=EXCLUDED.evidence,status='pending',admin_note=NULL,reviewed_at=NULL,created_at=NOW() WHERE public.ebnimaam_challenge_submissions.status='rejected' RETURNING id", [team.rows[0].id, day, user.id, evidence]);
      if (!submitted.rowCount) return fail('This milestone has already been submitted by your team.');
      return NextResponse.json({ ok: true, message: 'Milestone submitted for owner review. Rewards are not released until all seven days are approved.' });
    }

    if (action === 'request_bank_refund') {
      const amountNaira = Number(body?.amountNaira);
      const accountName = String(body?.accountName || '').trim().slice(0, 100);
      const accountNumber = String(body?.accountNumber || '').replace(/[^0-9]/g, '').slice(0, 10);
      const bankName = String(body?.bankName || '').trim().slice(0, 100);
      if (!Number.isSafeInteger(amountNaira) || amountNaira < 100 || amountNaira > 100000000 || !Number.isSafeInteger(amountNaira * 100) || accountNumber.length !== 10 || accountName.length < 3 || bankName.length < 2) return fail('Enter an amount of at least ₦100 and valid bank account details.');
      const encrypted = encryptPrivateDetails({ accountName, accountNumber, bankName });
      const client = await loyaltyPool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id]);
        const balance = await client.query("SELECT COALESCE(SUM(amount_kobo),0)::bigint AS amount FROM public.ebnimaam_wallet_ledger WHERE user_id=$1 AND status<>'rejected'", [user.id]);
        const amountKobo = amountNaira * 100;
        if (Number(balance.rows[0]?.amount || 0) < amountKobo) { await client.query('ROLLBACK'); return fail('Your available Ebnimaam balance is not enough for this bank refund request.'); }
        const requestId = randomBytes(16).toString('hex');
        await client.query("INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description,private_details) VALUES($1,'bank_refund_request',$2,'pending',$3,$4,$5::jsonb)", [user.id, -amountKobo, 'bank-refund-request:' + requestId, 'Customer requested a manual bank refund from Ebnimaam balance', JSON.stringify(encrypted)]);
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, message: 'Your bank refund request is pending owner review. No automatic bank transfer has been made.' });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }

    return fail('Unknown Ebnimaam rewards action.');
  } catch {
    return fail('Your request could not be completed. Please try again shortly.', 503);
  }
}
function onlyDigitsAndLetters(value: string) { return value.split('').every((c) => (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z')); }
function onlyHex(value: string) { return value.split('').every((c) => (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F')); }
