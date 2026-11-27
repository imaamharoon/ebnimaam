'use client';

import {useEffect,useState} from 'react';
import type { CSSProperties } from 'react';

export default function LoyaltyAdmin(){
 const [data,setData]=useState<any>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [referredReward,setReferredReward]=useState('0');
 const [referrerReward,setReferrerReward]=useState('200');
 const [gameReward,setGameReward]=useState('50');
 const [wallet,setWallet]=useState<any>({userId:'',amountNaira:'',entryType:'refund_credit',note:''});
 const [challenge,setChallenge]=useState<any>({title:'',description:'',durationDays:7,rewardNaira:1000,maxTeamSize:5,milestones:'Plan and agree the team strategy\nComplete the main challenge objective\nSubmit final evidence and team reflection',active:false});
 async function load(){
  setError('');
  try{
   const response=await fetch('/api/admin/loyalty',{cache:'no-store'});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(result.error||'Admin access is required. Sign in at the main Admin page first.');
   setData(result);
   setReferredReward(String(Number(result.settings?.referred_reward_kobo||0)/100));
   setReferrerReward(String(Number(result.settings?.referrer_reward_kobo||0)/100));
   setGameReward(String(Number(result.settings?.game_reward_kobo??5000)/100));
  }catch(e:any){setError(e.message||'Could not load rewards administration.')}
 }
 useEffect(()=>{void load()},[]);
 async function post(payload:any){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/admin/loyalty',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(result.error||'The update could not be saved.');
   await load();setError('Saved successfully.');
  }catch(e:any){setError(e.message||'The update could not be saved.')}
  finally{setBusy(false)}
 }
 const panel:CSSProperties={border:'1px solid #e2e8f0',borderRadius:12,padding:16,margin:'14px 0',background:'#fff'};
 const field:CSSProperties={display:'block',width:'100%',padding:11,border:'1px solid #cbd5e1',borderRadius:8,margin:'6px 0 12px',boxSizing:'border-box'};
 const button:React.CSSProperties={padding:'10px 14px',border:0,borderRadius:8,background:'#102544',color:'#fff',margin:'4px 8px 4px 0'};
 return <main className="loyalty-admin"><style>{`*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#17263c;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.loyalty-admin{max-width:1360px;margin:auto;padding:clamp(14px,2.4vw,32px);display:grid;grid-template-columns:1fr;gap:18px}.loyalty-admin header{background:linear-gradient(120deg,#0d1c34,#193b5f);color:#fff;padding:28px;border-radius:22px;box-shadow:0 18px 40px #10254422}.loyalty-admin header h1{color:#fff;letter-spacing:-.04em;margin:0 0 8px}.loyalty-admin header p{color:#d7e1ed}.loyalty-admin header a{color:#fff;font-weight:700}.loyalty-admin section{background:#fff;border:1px solid #e5eaf1;border-radius:18px;padding:22px;box-shadow:0 8px 28px #10254409}.loyalty-admin h2{font-size:20px;letter-spacing:-.025em;margin:0 0 12px;color:#102544}.loyalty-admin h3{font-size:15px;color:#243751;margin:18px 0 10px}.loyalty-admin label{display:block;color:#40516a;font-size:12px;font-weight:650;margin:11px 0}.loyalty-admin input,.loyalty-admin textarea,.loyalty-admin select{display:block;width:100%;padding:11px 13px;border:1px solid #dbe1e9;border-radius:10px;margin:6px 0 12px;font:inherit;color:#17263c;background:#fff}.loyalty-admin button{padding:10px 15px;background:#102544;color:#fff;border:0;border-radius:10px;font-weight:700;cursor:pointer}.loyalty-admin article{border:1px solid #e5eaf1;border-radius:12px;padding:14px;margin:10px 0}.loyalty-admin [role=status]{border:1px solid #d6e1ee;color:#173554;background:#edf3f9!important}@media(max-width:640px){.loyalty-admin{padding:12px}.loyalty-admin header,.loyalty-admin section{padding:17px;border-radius:16px}}`}</style>
  <header><h1>Ebnimaam rewards control centre</h1><p>Wallet credits, bank refund requests, referral rewards and team challenges.</p><p><a href="/admin">← Main admin dashboard</a> · <a href="/rewards.html">Customer rewards page</a></p></header>
  {error&&<p role="status" style={{padding:12,background:'#f1f5f9',borderRadius:8}}>{error}</p>}
  {!data?<p>Loading rewards administration…</p>:<>
   <section style={panel}>
    <h2>Referral rewards</h2>
    <p>Each of five different invited customers must complete a verified first paid purchase. The referrer earns ₦200 for each qualifying purchase, accumulating to ₦1,000 after five. These rewards are store credit, not cash payouts.</p>
    <form onSubmit={e=>{e.preventDefault();void post({action:'settings',referredRewardNaira:Number(referredReward),referrerRewardNaira:Number(referrerReward),gameRewardNaira:Number(gameReward)})}}>
     <label>Reward for each referred customer (₦)<input style={field} type="number" min="0" max="100000" step="1" value={referredReward} onChange={e=>setReferredReward(e.target.value)}/></label>
     <label>Credit per verified referral purchase (₦)<input style={field} type="number" min="0" max="100000" step="1" value={referrerReward} onChange={e=>setReferrerReward(e.target.value)}/></label>
     <label>Daily Pattern Challenge reward (₦)<input style={field} type="number" min="0" max="100000" step="1" value={gameReward} onChange={e=>setGameReward(e.target.value)}/></label>
     <button style={button} disabled={busy}>Save reward settings</button>
    </form>
    <p style={{fontSize:13,color:'#64748b'}}>The referral threshold is fixed at five. A zero referral amount disables referral credits; a zero game amount pauses game credits. Referral and game rewards can only be redeemed at Ebnimaam checkout and cannot be transferred or withdrawn.</p>
    <h3>Referral progress</h3>
    {(data.referrals||[]).length?(data.referrals||[]).map((r:any)=><article key={r.referrer_user_id} style={{borderTop:'1px solid #e2e8f0',padding:'8px 0'}}><b>{r.full_name||r.email||r.referrer_user_id}</b><p>{r.paid_referrals} verified paid referrals of 5 required · {r.total_referrals} total referral signups</p><small>User ID: {r.referrer_user_id}</small></article>):<p>No referrals have been linked yet.</p>}
   </section>
   <section style={panel}>
    <h2>Wallet credits and customer refunds</h2>
    <p>Credits are recorded in the Ebnimaam wallet ledger. A refund credit does not automatically send money to a bank account.</p>
    <form onSubmit={e=>{e.preventDefault();void post({action:'credit-wallet',...wallet,amountNaira:Number(wallet.amountNaira)})}}>
     <label>Customer user ID<input style={field} required value={wallet.userId} onChange={e=>setWallet({...wallet,userId:e.target.value})}/></label>
     <label>Amount in naira<input style={field} required type="number" min="1" max="100000" step="1" value={wallet.amountNaira} onChange={e=>setWallet({...wallet,amountNaira:e.target.value})}/></label>
     <label>Credit type<select style={field} value={wallet.entryType} onChange={e=>setWallet({...wallet,entryType:e.target.value})}><option value="refund_credit">Approved refund to Ebnimaam balance</option><option value="admin_reward">Manual reward</option></select></label>
     <label>Reason / order reference<input style={field} required minLength={5} value={wallet.note} onChange={e=>setWallet({...wallet,note:e.target.value})}/></label>
     <button style={button} disabled={busy}>Credit customer wallet</button>
    </form>
    <h3>Customer wallet balances</h3>{(data.wallets||[]).map((entry:any)=><article key={entry.user_id} style={{borderTop:'1px solid #e2e8f0',padding:'8px 0'}}><b>{entry.full_name||entry.email||entry.user_id}</b> · ₦{(Number(entry.balance_kobo)/100).toLocaleString()}<p><small>User ID: {entry.user_id}</small> <button type="button" style={{marginLeft:8}} onClick={()=>setWallet({...wallet,userId:entry.user_id})}>Use customer ID</button></p></article>)}{(data.wallets||[]).length===0?<p>No wallet balances yet.</p>:null}<h3>Bank refund requests</h3>
    {(data.withdrawals||[]).length?(data.withdrawals||[]).map((w:any)=><article key={w.id} style={{border:'1px solid #e2e8f0',padding:12,borderRadius:8,margin:'10px 0'}}>
     <b>{w.full_name||w.email||w.user_id}</b> · ₦{(Number(w.amount_kobo)/100).toLocaleString()} · {w.status}
     <p>Bank: {w.bank_details?.bankName} · Account name: {w.bank_details?.accountName} · Account number: {w.bank_details?.accountNumber}</p>
     <small>Request: {w.id} · {new Date(w.created_at).toLocaleString()}</small>
     {w.status==='pending'&&<div><button style={button} disabled={busy} onClick={()=>{if(confirm('Only confirm Paid after you have manually transferred this refund to the customer bank account. Have you completed the transfer?'))void post({action:'review-withdrawal',id:w.id,decision:'paid',note:'Bank transfer manually completed by admin.'})}}>Confirm bank transfer completed</button><button style={{...button,background:'#fff',color:'#102544',border:'1px solid #cbd5e1'}} disabled={busy} onClick={()=>void post({action:'review-withdrawal',id:w.id,decision:'rejected',note:'Request declined by admin.'})}>Reject request</button></div>}
     {w.admin_note&&<p>{w.admin_note}</p>}
    </article>):<p>No bank refund requests yet.</p>}
   </section>
   <section style={panel}>
    <h2>Create a difficult team challenge</h2>
    <p>Set a multi-day challenge with milestones. Teams can have 2–5 members. Every member must submit evidence for every milestone, and an admin must approve every submission before the reward is credited.</p>
    <form onSubmit={e=>{e.preventDefault();const milestones=String(challenge.milestones).split(/\r?\n/).map((title:string,i:number)=>({key:'milestone-'+(i+1),title:title.trim()})).filter((m:any)=>m.title);void post({action:'create-challenge',...challenge,durationDays:Number(challenge.durationDays),rewardNaira:Number(challenge.rewardNaira),maxTeamSize:Number(challenge.maxTeamSize),milestones})}}>
     <label>Challenge title<input style={field} required minLength={4} value={challenge.title} onChange={e=>setChallenge({...challenge,title:e.target.value})}/></label>
     <label>Instructions and rules<textarea style={field} required minLength={20} rows={4} value={challenge.description} onChange={e=>setChallenge({...challenge,description:e.target.value})}/></label>
     <label>Duration in days<input style={field} type="number" min="2" max="21" value={challenge.durationDays} onChange={e=>setChallenge({...challenge,durationDays:e.target.value})}/></label>
     <label>Reward per team member (₦)<input style={field} type="number" min="1" max="100000" value={challenge.rewardNaira} onChange={e=>setChallenge({...challenge,rewardNaira:e.target.value})}/></label>
     <label>Maximum team size<select style={field} value={challenge.maxTeamSize} onChange={e=>setChallenge({...challenge,maxTeamSize:e.target.value})}><option value="2">2 people</option><option value="3">3 people</option><option value="4">4 people</option><option value="5">5 people</option></select></label>
     <label>Milestones (one per line)<textarea style={field} rows={5} required value={challenge.milestones} onChange={e=>setChallenge({...challenge,milestones:e.target.value})}/></label>
     <label><input type="checkbox" checked={challenge.active} onChange={e=>setChallenge({...challenge,active:e.target.checked})}/> Make challenge visible to customers immediately</label>
     <button style={button} disabled={busy}>Create challenge</button>
    </form>
    <h3>Existing challenges</h3>
    {(data.challenges||[]).map((item:any)=><article key={item.id}><b>{item.title}</b><p>{item.duration_days} days · ₦{(Number(item.reward_kobo)/100).toLocaleString()} each · {item.team_count} team(s) · {item.active?'Active':'Hidden'}</p><button style={button} onClick={()=>void post({action:'set-challenge-active',id:item.id,active:!item.active})}>{item.active?'Hide':'Activate'}</button></article>)}
    <h3>Challenge submissions awaiting / completed review</h3>
    {(data.submissions||[]).map((item:any)=><article key={item.id} style={{borderTop:'1px solid #e2e8f0',padding:'10px 0'}}>
     <b>{item.challenge_title} · {item.team_name}</b><p>{item.full_name||item.email||item.user_id} · {item.milestone_key} · {item.status}</p><p>{item.proof}</p>
     {item.status==='pending'&&<><button style={button} disabled={busy} onClick={()=>void post({action:'review-submission',id:item.id,decision:'approved',note:'Evidence reviewed and approved.'})}>Approve evidence</button><button style={{...button,background:'#fff',color:'#102544',border:'1px solid #cbd5e1'}} disabled={busy} onClick={()=>void post({action:'review-submission',id:item.id,decision:'rejected',note:'Evidence needs improvement. Please resubmit.'})}>Request resubmission</button></>}
    </article>)}
   </section>
   <button style={button} onClick={()=>void load()}>Refresh rewards data</button>
  </>}
 </main>;
}
