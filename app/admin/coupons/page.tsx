'use client';

import {useEffect,useState} from 'react';

export default function AdminCoupons(){
 const [rows,setRows]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [form,setForm]=useState<any>({code:'',discountType:'percent',value:10,minSpendNaira:0,maxRedemptions:'',validUntil:'',active:true});
 async function load(){try{const r=await fetch('/api/admin/coupons',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Admin sign in required.');setRows(d.coupons||[])}catch(e:any){setError(e.message||'Coupons unavailable.')}}
 useEffect(()=>{void load()},[]);
 async function post(body:any){setBusy(true);setError('');try{const r=await fetch('/api/admin/coupons',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not save coupon.');setError('Coupon saved.');await load()}catch(e:any){setError(e.message||'Could not save coupon.')}finally{setBusy(false)}}
 const input:any={width:'100%',boxSizing:'border-box',padding:12,border:'1px solid #d4dbe4',borderRadius:8,marginTop:6};
 const panel:any={border:'1px solid #e2e8f0',borderRadius:12,padding:18,margin:'16px 0'};
 const button:any={padding:'10px 14px',border:0,borderRadius:8,background:'#102544',color:'#fff',cursor:'pointer'};
 return <main style={{maxWidth:900,margin:'0 auto',padding:20,fontFamily:'Arial,sans-serif',color:'#102544'}}>
  <h1>Ebnimaam coupons</h1><p>Manage promotional codes applied and validated by the server at checkout.</p><p><a href="/admin">← Main admin</a> · <a href="/admin/loyalty">Rewards & wallet</a></p>
  {error&&<p role="status" style={{background:'#f1f5f9',padding:12,borderRadius:8}}>{error}</p>}
  <section style={panel}><h2>Create or update a coupon</h2><form onSubmit={e=>{e.preventDefault();void post({...form,value:Number(form.value),minSpendNaira:Number(form.minSpendNaira),maxRedemptions:form.maxRedemptions===''?null:Number(form.maxRedemptions)})}}>
   <label style={{display:'block',margin:'12px 0'}}>Coupon code<input style={input} required minLength={2} maxLength={40} pattern="[A-Za-z0-9_-]+" value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})}/></label>
   <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
    <label>Discount type<select style={input} value={form.discountType} onChange={e=>setForm({...form,discountType:e.target.value})}><option value="percent">Percentage</option><option value="fixed">Fixed naira discount</option></select></label>
    <label>{form.discountType==='percent'?'Discount percentage':'Discount amount (₦)'}<input style={input} type="number" min="1" max={form.discountType==='percent'?100:100000} step="1" required value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/></label>
    <label>Minimum product subtotal (₦)<input style={input} type="number" min="0" step="1" value={form.minSpendNaira} onChange={e=>setForm({...form,minSpendNaira:e.target.value})}/></label>
    <label>Maximum total redemptions<input style={input} type="number" min="1" step="1" placeholder="Unlimited" value={form.maxRedemptions} onChange={e=>setForm({...form,maxRedemptions:e.target.value})}/></label>
    <label>Expiry date and time (Nigeria time)<input style={input} type="datetime-local" value={form.validUntil} onChange={e=>setForm({...form,validUntil:e.target.value})}/></label>
   </div>
   <label style={{display:'block',margin:'12px 0'}}><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Active at checkout</label>
   <p style={{fontSize:12,color:'#64748b'}}>Existing coupons with redemptions cannot be edited, to protect purchase history. Disable them and create a new code for changed terms.</p>
   <button style={button} disabled={busy}>Save coupon</button>
  </form></section>
  <section style={panel}><h2>Saved coupons</h2>{rows.length?rows.map(row=><article key={row.code} style={{borderTop:'1px solid #e2e8f0',padding:'12px 0'}}>
   <b>{row.code}</b> · {row.discount_type==='percent'?row.value+'% off':'₦'+Number(row.value).toLocaleString()+' off'} · {row.active?'Active':'Inactive'}
   <p style={{fontSize:13,color:'#64748b'}}>Minimum: ₦{(Number(row.min_spend_kobo)/100).toLocaleString()} · Redeemed: {row.redeemed_count}{row.max_redemptions?' / '+row.max_redemptions:''} · {row.valid_until?'Expires '+new Date(row.valid_until).toLocaleString():'No expiry'}</p>
   <button style={button} disabled={busy} onClick={()=>void post({action:'toggle',code:row.code,active:!row.active})}>{row.active?'Deactivate':'Activate'}</button>
  </article>):<p>No coupons have been created yet.</p>}</section>
 </main>
}
