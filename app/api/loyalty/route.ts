import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'crypto';
import { checkRateLimit } from '../../../lib/rate-limit';
import { getVerifiedCustomer, ensureLoyaltySchema, encryptBankDetails, walletBalance, walletAvailable } from '../../../lib/loyalty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

function inviteCode() { return randomBytes(5).toString('hex').toUpperCase(); }

export async function GET(req: Request) {
  try {
    const user = await getVerifiedCustomer(req);
    if (!user) return NextResponse.json({ error: 'Sign in with your verified account to view Ebnimaam Rewards.' }, { status: 401 });
    await ensureLoyaltySchema(pool);
    await pool.query(
      'INSERT INTO public.ebnimaam_referral_codes(user_id,code) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING',
      [user.id,'EBN'+inviteCode()],
    );
    const [code, referrals, ledger, withdrawals, challenges, teams, balance, available, settings] = await Promise.all([
      pool.query('SELECT code FROM public.ebnimaam_referral_codes WHERE user_id=$1',[user.id]),
      pool.query(
        `SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE qualifying_order_reference IS NOT NULL)::int AS qualified
         FROM public.ebnimaam_referral_invites WHERE referrer_user_id=$1`,[user.id]),
      pool.query(
        `SELECT entry_type,direction,amount_kobo,description,created_at FROM public.ebnimaam_wallet_ledger
         WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,[user.id]),
      pool.query(
        `SELECT id,amount_kobo,status,admin_note,created_at,reviewed_at FROM public.ebnimaam_wallet_withdrawals
         WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`,[user.id]),
      pool.query(
        `SELECT id,title,description,duration_days,reward_kobo,max_team_size,milestones,created_at
         FROM public.ebnimaam_challenges WHERE active=TRUE ORDER BY created_at DESC LIMIT 30`),
      pool.query(
        `SELECT t.id,t.challenge_id,t.team_name,t.invite_code,t.status,t.created_at AS team_created_at,c.title,c.duration_days,c.milestones,
                (SELECT COUNT(*)::int FROM public.ebnimaam_challenge_members m WHERE m.team_id=t.id) AS member_count
         FROM public.ebnimaam_challenge_teams t JOIN public.ebnimaam_challenges c ON c.id=t.challenge_id
         JOIN public.ebnimaam_challenge_members mine ON mine.team_id=t.id
         WHERE mine.user_id=$1 ORDER BY t.created_at DESC LIMIT 30`,[user.id]),
      walletBalance(pool,user.id),
      walletAvailable(pool,user.id),
      pool.query('SELECT referred_reward_kobo,referrer_reward_kobo FROM public.ebnimaam_loyalty_settings WHERE id=1'),
    ]);
    const pending = await pool.query(
      "SELECT COALESCE(SUM(amount_kobo),0)::bigint AS amount FROM public.ebnimaam_wallet_withdrawals WHERE user_id=$1 AND status='pending'",
      [user.id],
    );
    return NextResponse.json({
      wallet:{balanceKobo:balance,reservedKobo:Math.max(0,balance-available),availableKobo:available},
      referral:{code:code.rows[0]?.code||'',total:Number(referrals.rows[0]?.total||0),qualified:Number(referrals.rows[0]?.qualified||0),required:5,referredRewardKobo:Number(settings.rows[0]?.referred_reward_kobo||0),referrerRewardKobo:Number(settings.rows[0]?.referrer_reward_kobo||0)},
      ledger:ledger.rows,withdrawals:withdrawals.rows,challenges:challenges.rows,teams:teams.rows,
    },{headers:{'cache-control':'no-store'}});
  } catch {
    return NextResponse.json({error:'Ebnimaam Rewards is temporarily unavailable.'},{status:503});
  }
}

export async function POST(req: Request) {
  let allowed=false;
  try { allowed=await checkRateLimit(req,'customer-loyalty-actions',15,15*60); }
  catch { return NextResponse.json({error:'Rewards are temporarily unavailable.'},{status:503}); }
  if(!allowed) return NextResponse.json({error:'Too many reward actions. Please try again later.'},{status:429,headers:{'retry-after':'900'}});
  const user=await getVerifiedCustomer(req);
  if(!user) return NextResponse.json({error:'Sign in with your verified account first.'},{status:401});
  const body=await req.json().catch(()=>({}));
  const action=String(body?.action||'');
  try {
    await ensureLoyaltySchema(pool);
    if(action==='claim-referral'){
      const code=String(body.code||'').trim().toUpperCase().slice(0,30);
      if(!code) return NextResponse.json({error:'Enter a referral code.'},{status:400});
      const result=await pool.query('SELECT user_id FROM public.ebnimaam_referral_codes WHERE code=$1',[code]);
      if(!result.rowCount) return NextResponse.json({error:'That referral code was not found.'},{status:404});
      const referrer=String(result.rows[0].user_id);
      if(referrer===user.id) return NextResponse.json({error:'You cannot refer your own account.'},{status:400});
      const paid=await pool.query("SELECT 1 FROM public.ebnimaam_orders WHERE auth_user_id=$1 AND status='paid' LIMIT 1",[user.id]);
      if(paid.rowCount) return NextResponse.json({error:'Referral codes must be applied before your first paid order.'},{status:409});
      const inserted=await pool.query(
        `INSERT INTO public.ebnimaam_referral_invites(referrer_user_id,referred_user_id,code)
         VALUES($1,$2,$3) ON CONFLICT(referred_user_id) DO NOTHING RETURNING id`,
        [referrer,user.id,code]);
      if(!inserted.rowCount) return NextResponse.json({error:'A referral code has already been linked to this account.'},{status:409});
      return NextResponse.json({ok:true,message:'Referral linked. Your reward will be credited after your first verified paid order.'});
    }
    if(action==='create-team'){
      const challengeId=String(body.challengeId||'');
      const teamName=String(body.teamName||'').trim().slice(0,60);
      if(!challengeId||teamName.length<3) return NextResponse.json({error:'Enter a team name of at least 3 characters.'},{status:400});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const challenge=await client.query('SELECT id FROM public.ebnimaam_challenges WHERE id=$1 AND active=TRUE FOR UPDATE',[challengeId]);
        if(!challenge.rowCount) throw new Error('This challenge is not currently accepting teams.');
        const team=await client.query(
          `INSERT INTO public.ebnimaam_challenge_teams(challenge_id,team_name,invite_code,creator_user_id)
           VALUES($1,$2,$3,$4) RETURNING id,invite_code`,
          [challengeId,teamName,inviteCode(),user.id]);
        await client.query('INSERT INTO public.ebnimaam_challenge_members(team_id,user_id) VALUES($1,$2)',[team.rows[0].id,user.id]);
        await client.query('UPDATE public.ebnimaam_challenge_teams SET status=\'in_progress\' WHERE id=$1',[team.rows[0].id]);
        await client.query('COMMIT');
        return NextResponse.json({ok:true,team:team.rows[0]});
      }catch(error:any){await client.query('ROLLBACK').catch(()=>{});throw error}
      finally{client.release()}
    }
    if(action==='join-team'){
      const code=String(body.inviteCode||'').trim().toUpperCase();
      if(!code) return NextResponse.json({error:'Enter your team invite code.'},{status:400});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const team=await client.query(
          `SELECT t.id,t.status,t.created_at,c.duration_days,c.max_team_size,c.active
           FROM public.ebnimaam_challenge_teams t JOIN public.ebnimaam_challenges c ON c.id=t.challenge_id
           WHERE t.invite_code=$1 FOR UPDATE OF t`,[code]);
        if(!team.rowCount||!team.rows[0].active||team.rows[0].status!=='open'&&team.rows[0].status!=='in_progress') throw new Error('This team invite is no longer available.');
        if(Date.now()-new Date(team.rows[0].created_at).getTime()>Number(team.rows[0].duration_days)*86400000) throw new Error('This challenge has reached its time limit.');
        const count=await client.query('SELECT COUNT(*)::int AS count FROM public.ebnimaam_challenge_members WHERE team_id=$1',[team.rows[0].id]);
        if(Number(count.rows[0].count)>=Number(team.rows[0].max_team_size)) throw new Error('This team is full.');
        await client.query('INSERT INTO public.ebnimaam_challenge_members(team_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[team.rows[0].id,user.id]);
        await client.query('UPDATE public.ebnimaam_challenge_teams SET status=\'in_progress\' WHERE id=$1',[team.rows[0].id]);
        await client.query('COMMIT');
        return NextResponse.json({ok:true});
      }catch(error:any){await client.query('ROLLBACK').catch(()=>{});throw error}
      finally{client.release()}
    }
    if(action==='submit-milestone'){
      const teamId=String(body.teamId||'');
      const milestoneKey=String(body.milestoneKey||'').trim().slice(0,80);
      const proof=String(body.proof||'').trim().slice(0,2000);
      if(!teamId||!milestoneKey||proof.length<20) return NextResponse.json({error:'Provide a milestone and at least 20 characters describing the work completed.'},{status:400});
      const member=await pool.query(
        `SELECT c.milestones,t.status,t.created_at,c.duration_days,c.active FROM public.ebnimaam_challenge_teams t
         JOIN public.ebnimaam_challenge_members m ON m.team_id=t.id
         JOIN public.ebnimaam_challenges c ON c.id=t.challenge_id
         WHERE t.id=$1 AND m.user_id=$2`,[teamId,user.id]);
      if(!member.rowCount||!member.rows[0].active||!['in_progress','submitted'].includes(member.rows[0].status)) return NextResponse.json({error:'You are not a member of an active team for this challenge.'},{status:403});
      if(Date.now()-new Date(member.rows[0].created_at).getTime()>Number(member.rows[0].duration_days)*86400000) return NextResponse.json({error:'This challenge has reached its time limit and no more submissions are accepted.'},{status:409});
      const milestones=Array.isArray(member.rows[0].milestones)?member.rows[0].milestones:[];
      if(!milestones.some((m:any)=>String(m.key||'')===milestoneKey)) return NextResponse.json({error:'That milestone is not part of this challenge.'},{status:400});
      await pool.query(
        `INSERT INTO public.ebnimaam_challenge_submissions(team_id,user_id,milestone_key,proof)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(team_id,user_id,milestone_key) DO UPDATE SET proof=EXCLUDED.proof,status='pending',admin_note='',created_at=NOW(),reviewed_at=NULL`,
        [teamId,user.id,milestoneKey,proof]);
      await pool.query("UPDATE public.ebnimaam_challenge_teams SET status='submitted' WHERE id=$1 AND status='in_progress'",[teamId]);
      return NextResponse.json({ok:true,message:'Your milestone has been submitted for admin review.'});
    }
    if(action==='request-bank-refund'){
      const amountKobo=Number(body.amountKobo);
      const bankName=String(body.bankName||'').trim().slice(0,80);
      const accountName=String(body.accountName||'').trim().slice(0,100);
      const accountNumber=String(body.accountNumber||'').replace(/\D/g,'').slice(0,10);
      if(!Number.isSafeInteger(amountKobo)||amountKobo<100||amountKobo>100_000_000||!bankName||!accountName||accountNumber.length!==10)
        return NextResponse.json({error:'Enter a valid refund amount and complete Nigerian bank account details.'},{status:400});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[user.id]);
        const balance=await walletBalance(client,user.id);
        const reserved=await client.query("SELECT COALESCE(SUM(amount_kobo),0)::bigint AS amount FROM public.ebnimaam_wallet_withdrawals WHERE user_id=$1 AND status='pending'",[user.id]);
        const available=balance-Number(reserved.rows[0]?.amount||0);
        if(amountKobo>available) throw new Error('The requested amount is higher than your available Ebnimaam balance.');
        await client.query(
          `INSERT INTO public.ebnimaam_wallet_withdrawals(user_id,amount_kobo,bank_details)
           VALUES($1,$2,$3::jsonb)`,
          [user.id,amountKobo,JSON.stringify({encrypted:encryptBankDetails({bankName,accountName,accountNumber})})]);
        await client.query('COMMIT');
        return NextResponse.json({ok:true,message:'Your bank refund request is pending review. The wallet balance remains reserved until Ebnimaam processes it.'});
      }catch(error:any){await client.query('ROLLBACK').catch(()=>{});throw error}
      finally{client.release()}
    }
    return NextResponse.json({error:'Unknown rewards action.'},{status:400});
  }catch(error:any){
    return NextResponse.json({error:error?.message||'The rewards action could not be completed.'},{status:400});
  }
}
