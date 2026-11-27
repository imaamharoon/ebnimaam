import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { loyaltyPool, ensureLoyaltyTables, decryptPrivateDetails, processAllQualifiedReferralRewards } from '../../../../lib/loyalty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const secret = process.env.ADMIN_PASSWORD || '';
function unauth() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function responseError(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }

export async function GET(req: Request) {
  if (!isAdminRequest(req, secret)) return unauth();
  try {
    await ensureLoyaltyTables();
    const [settings, requests, submissions, referralStats, coupons] = await Promise.all([
      loyaltyPool.query('SELECT * FROM public.ebnimaam_loyalty_settings WHERE id=1'),
      loyaltyPool.query("SELECT id,user_id,amount_kobo,status,description,private_details,created_at FROM public.ebnimaam_wallet_ledger WHERE entry_type='bank_refund_request' AND status='pending' ORDER BY created_at ASC LIMIT 100"),
      loyaltyPool.query("SELECT s.id,s.team_id,s.day_number,s.submitted_by,s.evidence,s.status,s.admin_note,s.created_at,t.invite_code,t.created_at AS team_started_at,(SELECT COUNT(*)::int FROM public.ebnimaam_challenge_members m WHERE m.team_id=t.id) AS member_count FROM public.ebnimaam_challenge_submissions s JOIN public.ebnimaam_challenge_teams t ON t.id=s.team_id WHERE s.status='pending' ORDER BY s.created_at ASC LIMIT 100"),
      loyaltyPool.query("SELECT COUNT(*) FILTER (WHERE status='qualified')::int AS qualified,COUNT(*) FILTER (WHERE status='pending')::int AS pending,COUNT(DISTINCT referrer_user_id)::int AS referrers FROM public.ebnimaam_referrals"),
      loyaltyPool.query("SELECT c.code,c.discount_type,c.discount_value,c.minimum_subtotal_kobo,c.max_redemptions,c.per_user_limit,c.starts_at,c.ends_at,c.is_active,COUNT(r.id) FILTER (WHERE r.status='paid')::int AS paid_redemptions,COUNT(r.id) FILTER (WHERE r.status='pending')::int AS pending_redemptions FROM public.ebnimaam_coupons c LEFT JOIN public.ebnimaam_coupon_redemptions r ON r.code=c.code GROUP BY c.code ORDER BY c.created_at DESC LIMIT 100")
    ]);
    const bankRequests = requests.rows.map((row: any) => ({
      id: row.id, user_id: row.user_id, amount_kobo: Number(row.amount_kobo),
      description: row.description, created_at: row.created_at,
      bank_details: decryptPrivateDetails(row.private_details)
    }));
    return NextResponse.json({
      settings: settings.rows[0] || {},
      bank_refund_requests: bankRequests,
      challenge_submissions: submissions.rows,
      referrals: referralStats.rows[0] || { qualified: 0, pending: 0, referrers: 0 },
      coupons: coupons.rows
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return responseError('Ebnimaam loyalty admin data is unavailable.', 503);
  }
}

export async function PATCH(req: Request) {
  if (!isAdminRequest(req, secret)) return unauth();
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');
  try {
    await ensureLoyaltyTables();

    if (action === 'save_settings') {
      const toKobo = (value: any, label: string) => {
        const n = Number(value);
        if (!Number.isSafeInteger(n) || n < 0 || n > 10000000) throw new Error(label + ' must be a whole-naira amount between 0 and 10,000,000.');
        return n * 100;
      };
      const referrer = toKobo(body.referrer_reward_naira, 'Referrer reward');
      const referred = toKobo(body.referred_reward_naira, 'New customer reward');
      const challenge = toKobo(body.challenge_reward_naira, 'Team challenge reward');
      const threshold = Number(body.low_stock_threshold);
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 500) return responseError('Low-stock threshold must be from 1 to 500 units.');
      await loyaltyPool.query('UPDATE public.ebnimaam_loyalty_settings SET referrer_reward_kobo=$1,referred_reward_kobo=$2,challenge_reward_kobo=$3,low_stock_threshold=$4,updated_at=NOW() WHERE id=1', [referrer, referred, challenge, threshold]);
      await processAllQualifiedReferralRewards();
      if (challenge > 0) {
        const completedTeams = await loyaltyPool.query("SELECT t.id FROM public.ebnimaam_challenge_teams t WHERE t.challenge_slug='seven-day-team-challenge' AND (SELECT COUNT(DISTINCT day_number) FROM public.ebnimaam_challenge_submissions s WHERE s.team_id=t.id AND s.status='approved')=7");
        for (const team of completedTeams.rows) {
          const members = await loyaltyPool.query('SELECT user_id FROM public.ebnimaam_challenge_members WHERE team_id=$1', [team.id]);
          for (const member of members.rows) {
            await loyaltyPool.query("INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description) VALUES($1,'challenge_reward',$2,'available',$3,$4) ON CONFLICT(source_key) DO NOTHING", [member.user_id, challenge, 'challenge-reward:' + team.id + ':' + member.user_id, 'Reward for completing the seven-day team challenge']);
          }
        }
      }
      return NextResponse.json({ ok: true, message: 'Rewards and low-stock settings saved. Existing balances were not changed.' });
    }

    if (action === 'review_bank_refund') {
      const id = String(body.id || '').trim();
      const decision = String(body.decision || '');
      if (!id || !['paid','reject'].includes(decision)) return responseError('Choose whether this bank refund was paid or rejected.');
      const result = await loyaltyPool.query(
        "UPDATE public.ebnimaam_wallet_ledger SET status=$1,updated_at=NOW() WHERE id=$2 AND entry_type='bank_refund_request' AND status='pending' RETURNING id",
        [decision === 'paid' ? 'completed' : 'rejected', id]
      );
      if (!result.rowCount) return responseError('This bank refund request is no longer pending.', 409);
      return NextResponse.json({ ok: true, message: decision === 'paid' ? 'Request marked paid. Confirm that the bank transfer was completed outside Ebnimaam before using this action.' : 'Request rejected. The reserved balance is available again.' });
    }


    if (action === 'save_coupon') {
      const code = String(body.code || '').trim().toUpperCase();
      if (code.length < 4 || code.length > 24 || !/^[A-Z0-9_-]+$/.test(code)) return responseError('Coupon code must contain 4–24 letters, numbers, hyphens or underscores.');
      const type = String(body.discount_type || '');
      if (!['percent','fixed'].includes(type)) return responseError('Choose a percentage or fixed-naira discount.');
      const valueInput = Number(body.discount_value);
      if (!Number.isSafeInteger(valueInput) || valueInput < 1 || valueInput > (type === 'percent' ? 100 : 10000000)) return responseError(type === 'percent' ? 'Percentage must be from 1 to 100.' : 'Fixed discount must be a whole-naira amount up to 10,000,000.');
      const minimum = Number(body.minimum_subtotal_naira || 0);
      const maximum = Number(body.max_redemptions || 0);
      const perUser = Number(body.per_user_limit || 1);
      if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > 10000000 || !Number.isSafeInteger(maximum) || maximum < 0 || maximum > 1000000 || !Number.isInteger(perUser) || perUser < 1 || perUser > 100) return responseError('Check the minimum order, redemption limit and per-customer limit.');
      const startsAt = body.starts_at ? new Date(String(body.starts_at)) : null;
      const endsAt = body.ends_at ? new Date(String(body.ends_at)) : null;
      if ((startsAt && !Number.isFinite(startsAt.getTime())) || (endsAt && !Number.isFinite(endsAt.getTime())) || (startsAt && endsAt && startsAt >= endsAt)) return responseError('Coupon start and expiry dates are invalid.');
      const discountValue = type === 'fixed' ? valueInput * 100 : valueInput;
      await loyaltyPool.query("INSERT INTO public.ebnimaam_coupons(code,discount_type,discount_value,minimum_subtotal_kobo,max_redemptions,per_user_limit,starts_at,ends_at,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(code) DO UPDATE SET discount_type=EXCLUDED.discount_type,discount_value=EXCLUDED.discount_value,minimum_subtotal_kobo=EXCLUDED.minimum_subtotal_kobo,max_redemptions=EXCLUDED.max_redemptions,per_user_limit=EXCLUDED.per_user_limit,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,is_active=EXCLUDED.is_active,updated_at=NOW()", [code,type,discountValue,minimum*100,maximum || null,perUser,startsAt,endsAt,body.is_active!==false]);
      return NextResponse.json({ ok: true, message: 'Coupon saved. Checkout will validate it on the server.' });
    }
    if (action === 'deactivate_coupon') {
      const code = String(body.code || '').trim().toUpperCase();
      if (!code) return responseError('Coupon code is required.');
      const result = await loyaltyPool.query('UPDATE public.ebnimaam_coupons SET is_active=FALSE,updated_at=NOW() WHERE code=$1 RETURNING code',[code]);
      if (!result.rowCount) return responseError('Coupon was not found.',404);
      return NextResponse.json({ok:true,message:'Coupon deactivated. Paid and pending reservations were kept unchanged.'});
    }
    if (action === 'issue_refund_credit') {
      const reference = String(body.reference || '').trim().slice(0, 160);
      const amountNaira = Number(body.amount_naira);
      if (!reference || !Number.isSafeInteger(amountNaira) || amountNaira < 1) return responseError('Provide a valid paid order reference and refund amount.');
      const amountKobo = amountNaira * 100;
      const client = await loyaltyPool.connect();
      try {
        await client.query('BEGIN');
        const order = await client.query("SELECT auth_user_id,status,amount_kobo FROM public.ebnimaam_orders WHERE reference=$1 FOR UPDATE", [reference]);
        if (!order.rowCount || String(order.rows[0].status) !== 'paid' || !order.rows[0].auth_user_id) {
          await client.query('ROLLBACK');
          return responseError('A paid order linked to a customer account is required.', 409);
        }
        if (amountKobo > Number(order.rows[0].amount_kobo)) { await client.query('ROLLBACK'); return responseError('Refund credit cannot exceed the original paid order total.'); }
        const inserted = await client.query("INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description) VALUES($1,'refund_credit',$2,'available',$3,$4) ON CONFLICT(source_key) DO NOTHING RETURNING id", [String(order.rows[0].auth_user_id), amountKobo, 'refund-credit:' + reference, 'Owner-approved refund credit for order ' + reference]);
        if (!inserted.rowCount) { await client.query('ROLLBACK'); return responseError('A wallet refund credit has already been issued for this order.', 409); }
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, message: 'Refund credit has been added to the customer’s Ebnimaam balance. No bank transfer or Paystack refund was made.' });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }

    if (action === 'review_challenge') {
      const id = String(body.id || '').trim();
      const decision = String(body.decision || '');
      const note = String(body.note || '').trim().slice(0, 500);
      if (!id || !['approve','reject'].includes(decision)) return responseError('Choose an approval decision for this milestone.');
      const client = await loyaltyPool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query("UPDATE public.ebnimaam_challenge_submissions SET status=$1,admin_note=$2,reviewed_at=NOW() WHERE id=$3 AND status='pending' RETURNING team_id", [decision === 'approve' ? 'approved' : 'rejected', note, id]);
        if (!updated.rowCount) { await client.query('ROLLBACK'); return responseError('This submission is no longer pending.', 409); }
        const teamId = String(updated.rows[0].team_id);
        let awardCreated = false;
        const progress = await client.query("SELECT COUNT(*)::int AS approved FROM public.ebnimaam_challenge_submissions WHERE team_id=$1 AND status='approved'", [teamId]);
        if (decision === 'approve' && Number(progress.rows[0]?.approved) === 7) {
          const settings = await client.query('SELECT challenge_reward_kobo FROM public.ebnimaam_loyalty_settings WHERE id=1');
          const reward = Number(settings.rows[0]?.challenge_reward_kobo || 0);
          if (reward > 0) {
            const members = await client.query('SELECT user_id FROM public.ebnimaam_challenge_members WHERE team_id=$1', [teamId]);
            for (const member of members.rows) {
              const inserted = await client.query("INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description) VALUES($1,'challenge_reward',$2,'available',$3,$4) ON CONFLICT(source_key) DO NOTHING RETURNING id", [member.user_id, reward, 'challenge-reward:' + teamId + ':' + member.user_id, 'Reward for completing the seven-day team challenge']);
              if (inserted.rowCount) awardCreated = true;
            }
          }
        }
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, awardCreated, message: awardCreated ? 'Milestone approved and the team reward has been credited to each member.' : 'Milestone review saved. Team reward is released only after all seven milestones are approved and a reward amount is configured.' });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }

    return responseError('Unknown loyalty administration action.');
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('must be a whole-naira')) return responseError(message);
    return responseError('The loyalty administration change could not be saved.', 503);
  }
}
