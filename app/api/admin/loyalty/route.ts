import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { recordAdminActivity } from '../../../../lib/admin-audit';
import { addWalletEntry, decryptBankDetails, ensureLoyaltySchema, walletBalance } from '../../../../lib/loyalty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function GET(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({error:'Unauthorized'},{status:401});
  try {
    await ensureLoyaltySchema(pool);
    const [settings, withdrawals, challenges, submissions, referrals, wallets] = await Promise.all([
      pool.query('SELECT referred_reward_kobo,referrer_reward_kobo,game_reward_kobo,referral_threshold,low_stock_threshold FROM public.ebnimaam_loyalty_settings WHERE id=1'),
      pool.query(
        `SELECT w.id,w.user_id,w.amount_kobo,w.bank_details,w.status,w.admin_note,w.created_at,
                p.email,p.full_name FROM public.ebnimaam_wallet_withdrawals w
         LEFT JOIN public.ebnimaam_customer_profiles p ON p.user_id=w.user_id
         ORDER BY CASE WHEN w.status='pending' THEN 0 ELSE 1 END,w.created_at DESC LIMIT 100`),
      pool.query(
        `SELECT c.id,c.title,c.description,c.duration_days,c.reward_kobo,c.max_team_size,c.milestones,c.active,c.created_at,
                COUNT(DISTINCT t.id)::int AS team_count
         FROM public.ebnimaam_challenges c LEFT JOIN public.ebnimaam_challenge_teams t ON t.challenge_id=c.id
         GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`),
      pool.query(
        `SELECT s.id,s.team_id,s.user_id,s.milestone_key,s.proof,s.status,s.admin_note,s.created_at,
                t.team_name,c.title AS challenge_title,p.full_name,p.email
         FROM public.ebnimaam_challenge_submissions s
         JOIN public.ebnimaam_challenge_teams t ON t.id=s.team_id
         JOIN public.ebnimaam_challenges c ON c.id=t.challenge_id
         LEFT JOIN public.ebnimaam_customer_profiles p ON p.user_id=s.user_id
         ORDER BY CASE WHEN s.status='pending' THEN 0 ELSE 1 END,s.created_at DESC LIMIT 150`),
      pool.query(
        `SELECT r.referrer_user_id,p.email,p.full_name,
                COUNT(*)::int AS total_referrals,
                COUNT(*) FILTER(WHERE r.qualifying_order_reference IS NOT NULL)::int AS paid_referrals
         FROM public.ebnimaam_referral_invites r
         LEFT JOIN public.ebnimaam_customer_profiles p ON p.user_id=r.referrer_user_id
         GROUP BY r.referrer_user_id,p.email,p.full_name ORDER BY paid_referrals DESC LIMIT 100`),
      pool.query(
        `SELECT l.user_id,MAX(p.email) AS email,MAX(p.full_name) AS full_name,COALESCE(SUM(CASE WHEN l.direction='credit' THEN l.amount_kobo ELSE -l.amount_kobo END),0)::bigint AS balance_kobo
         FROM public.ebnimaam_wallet_ledger l LEFT JOIN public.ebnimaam_customer_profiles p ON p.user_id=l.user_id GROUP BY l.user_id ORDER BY balance_kobo DESC LIMIT 50`),
    ]);
    const safeWithdrawals=withdrawals.rows.map((row:any)=>({ ...row, bank_details:decryptBankDetails(row.bank_details?.encrypted) }));
    return NextResponse.json({
      settings:settings.rows[0]||{referred_reward_kobo:0,referrer_reward_kobo:20000,game_reward_kobo:5000,referral_threshold:5,low_stock_threshold:3},
      withdrawals:safeWithdrawals,challenges:challenges.rows,submissions:submissions.rows,referrals:referrals.rows,wallets:wallets.rows,
    },{headers:{'cache-control':'no-store'}});
  } catch {
    return NextResponse.json({error:'Loyalty administration is temporarily unavailable.'},{status:503});
  }
}

export async function POST(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const body=await req.json().catch(()=>({}));
  const action=String(body?.action||'');
  try {
    await ensureLoyaltySchema(pool);
    if(action==='settings'){
      const referred=Number(body.referredRewardNaira),referrer=Number(body.referrerRewardNaira),gameReward=Number(body.gameRewardNaira);
      if(!Number.isSafeInteger(referred)||referred<0||referred>100000||!Number.isSafeInteger(referrer)||referrer<0||referrer>100000||!Number.isSafeInteger(gameReward)||gameReward<0||gameReward>100000)
        return NextResponse.json({error:'Referral and game rewards must be whole naira amounts from ₦0 to ₦100,000.'},{status:400});
      await pool.query(
        `UPDATE public.ebnimaam_loyalty_settings SET referred_reward_kobo=$1,referrer_reward_kobo=$2,game_reward_kobo=$3,referral_threshold=5,updated_at=NOW() WHERE id=1`,
        [referred*100,referrer*100,gameReward*100]);
      await recordAdminActivity('loyalty.settings.updated','loyalty_settings','1',{referredRewardNaira:referred,referrerRewardNaira:referrer,gameRewardNaira:gameReward,referralThreshold:5});
      return NextResponse.json({ok:true});
    }
    if(action==='credit-wallet'){
      const userId=String(body.userId||'').trim();
      const amountNaira=Number(body.amountNaira);
      const note=String(body.note||'').trim().slice(0,200);
      const entryType=body.entryType==='refund_credit'?'refund_credit':'admin_reward';
      if(!userId||!Number.isSafeInteger(amountNaira)||amountNaira<1||amountNaira>100000||note.length<5)
        return NextResponse.json({error:'Enter a customer user ID, whole-naira amount and a note.'},{status:400});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await addWalletEntry(client,{userId,entryType,direction:'credit',amountKobo:amountNaira*100,reference:'admin-credit-'+randomUUID(),description:note,metadata:{creditedBy:'admin'}});
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
      await recordAdminActivity('wallet.credit.created','wallet',userId,{amountNaira,entryType,note});
      return NextResponse.json({ok:true});
    }
    if(action==='review-withdrawal'){
      const id=String(body.id||'');
      const decision=String(body.decision||'');
      const note=String(body.note||'').trim().slice(0,200);
      if(!id||!['paid','rejected'].includes(decision)) return NextResponse.json({error:'Choose a valid withdrawal and decision.'},{status:400});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const found=await client.query('SELECT id,user_id,amount_kobo,status FROM public.ebnimaam_wallet_withdrawals WHERE id=$1 FOR UPDATE',[id]);
        if(!found.rowCount||found.rows[0].status!=='pending') throw new Error('This bank refund request is no longer pending.');
        const withdrawal=found.rows[0];
        if(decision==='paid'){
          const balance=await walletBalance(client,String(withdrawal.user_id));
          if(balance<Number(withdrawal.amount_kobo)) throw new Error('The wallet balance no longer covers this request. Do not mark the bank transfer complete.');
          await addWalletEntry(client,{
            userId:String(withdrawal.user_id),entryType:'bank_refund',direction:'debit',
            amountKobo:Number(withdrawal.amount_kobo),reference:'bank-refund-'+id,
            description:'Bank refund transferred by Ebnimaam admin',
            metadata:{withdrawalId:id,adminNote:note},
          });
        }
        await client.query('UPDATE public.ebnimaam_wallet_withdrawals SET status=$1,admin_note=$2,reviewed_at=NOW() WHERE id=$3',[decision,note,id]);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
      await recordAdminActivity('wallet.withdrawal.reviewed','wallet_withdrawal',id,{decision,note});
      return NextResponse.json({ok:true});
    }
    if(action==='create-challenge'){
      const title=String(body.title||'').trim().slice(0,100);
      const description=String(body.description||'').trim().slice(0,1500);
      const duration=Number(body.durationDays),reward=Number(body.rewardNaira);
      const maxTeam=Number(body.maxTeamSize||5);
      const milestones=Array.isArray(body.milestones)?body.milestones.slice(0,10).map((m:any,i)=>({key:String(m.key||'step-'+(i+1)).trim().slice(0,80),title:String(m.title||'').trim().slice(0,100)})):[];
      if(title.length<4||description.length<20||!Number.isSafeInteger(duration)||duration<2||duration>21||!Number.isSafeInteger(reward)||reward<1||reward>100000||!Number.isSafeInteger(maxTeam)||maxTeam<2||maxTeam>5||milestones.length<2||milestones.some((m:any)=>!m.title))
        return NextResponse.json({error:'A challenge needs a title, detailed description, 2–21 days, a reward, 2–5 team members and at least two named milestones.'},{status:400});
      const result=await pool.query(
        `INSERT INTO public.ebnimaam_challenges(title,description,duration_days,reward_kobo,max_team_size,milestones,active)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
        [title,description,duration,reward*100,maxTeam,JSON.stringify(milestones),body.active===true]);
      await recordAdminActivity('challenge.created','challenge',result.rows[0].id,{title,durationDays:duration,rewardNaira:reward});
      return NextResponse.json({ok:true,id:result.rows[0].id});
    }
    if(action==='set-challenge-active'){
      const id=String(body.id||''),active=body.active===true;
      const result=await pool.query('UPDATE public.ebnimaam_challenges SET active=$1 WHERE id=$2 RETURNING id',[active,id]);
      if(!result.rowCount) return NextResponse.json({error:'Challenge not found.'},{status:404});
      await recordAdminActivity('challenge.activation.changed','challenge',id,{active});
      return NextResponse.json({ok:true});
    }
    if(action==='review-submission'){
      const id=String(body.id||''),decision=String(body.decision||''),note=String(body.note||'').trim().slice(0,200);
      if(!id||!['approved','rejected'].includes(decision)) return NextResponse.json({error:'Select a valid challenge submission and decision.'},{status:400});
      const client=await pool.connect();
      let completedTeamId='';
      try{
        await client.query('BEGIN');
        const submission=await client.query(
          `SELECT s.id,s.team_id,s.status,t.challenge_id,c.milestones,c.reward_kobo,t.status AS team_status
           FROM public.ebnimaam_challenge_submissions s
           JOIN public.ebnimaam_challenge_teams t ON t.id=s.team_id
           JOIN public.ebnimaam_challenges c ON c.id=t.challenge_id
           WHERE s.id=$1 FOR UPDATE OF s,t`,[id]);
        if(!submission.rowCount||submission.rows[0].status!=='pending') throw new Error('This submission is no longer awaiting review.');
        const item=submission.rows[0];
        await client.query('UPDATE public.ebnimaam_challenge_submissions SET status=$1,admin_note=$2,reviewed_at=NOW() WHERE id=$3',[decision,note,id]);
        if(decision==='approved'){
          const members=await client.query('SELECT user_id FROM public.ebnimaam_challenge_members WHERE team_id=$1',[item.team_id]);
          const milestoneList=Array.isArray(item.milestones)?item.milestones:[];
          const totals=await client.query(
            `SELECT COUNT(*)::int AS approved FROM public.ebnimaam_challenge_submissions
             WHERE team_id=$1 AND status='approved'`,[item.team_id]);
          const required=members.rowCount*milestoneList.length;
          if(required>0&&Number(totals.rows[0]?.approved)>=required&&item.team_status!=='completed'){
            await client.query("UPDATE public.ebnimaam_challenge_teams SET status='completed',completed_at=NOW() WHERE id=$1",[item.team_id]);
            for(const member of members.rows){
              await addWalletEntry(client,{
                userId:String(member.user_id),entryType:'challenge_reward',direction:'credit',
                amountKobo:Number(item.reward_kobo),reference:'challenge-team-'+item.team_id+'-'+String(member.user_id),
                description:'Verified Ebnimaam team challenge reward',
                metadata:{teamId:item.team_id,challengeId:item.challenge_id},
              });
            }
            completedTeamId=String(item.team_id);
          }
        }
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
      await recordAdminActivity('challenge.submission.reviewed','challenge_submission',id,{decision,note,teamCompleted:Boolean(completedTeamId)});
      return NextResponse.json({ok:true,teamCompleted:Boolean(completedTeamId)});
    }
    return NextResponse.json({error:'Unknown loyalty administration action.'},{status:400});
  }catch(error:any){
    return NextResponse.json({error:error?.message||'Loyalty settings could not be saved.'},{status:400});
  }
}
