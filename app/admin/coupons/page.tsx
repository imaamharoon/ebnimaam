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
 return <main className="coupons-admin"><style>{`
*{box-sizing:border-box}
body{margin:0;background:#faf8f3;color:#17233a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.coupons-admin{max-width:none!important;min-height:100vh;padding:0 24px 40px!important;color:#17233a!important}
.coupons-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin:0 -24px 24px;padding:22px 28px;background:linear-gradient(120deg,#06172d,#0b2a4b);border-bottom:1px solid #c99550;color:#fff}
.coupons-brand{display:flex;align-items:center;gap:11px;color:#f1c46d;text-decoration:none;font:600 25px Georgia,serif}
.coupons-brand img{width:45px;height:45px;object-fit:contain;border:1px solid #c99550;border-radius:12px;background:#faf8f2;padding:2px}
.coupons-header p{color:#d4deeb;margin:6px 0 0;font-size:12px}
.coupons-header nav{display:flex;gap:10px;flex-wrap:wrap}
.coupons-header nav a{color:#f1c46d;font-size:12px;font-weight:700}
.coupons-admin>section{max-width:1060px;margin:16px auto!important;padding:22px!important;border:1px solid #e8e0d4!important;border-radius:16px!important;background:#fffefa!important;box-shadow:0 9px 26px #071a310c}
.coupons-admin h2{color:#0b2340;font-size:20px;letter-spacing:-.025em;margin:0 0 14px}
.coupons-admin label{display:block;color:#35465d;font-size:12px;font-weight:700;margin:12px 0}
.coupons-admin input,.coupons-admin select{border:1px solid #e2d9cb!important;border-radius:10px!important;background:#fff!important;color:#17233a!important}
.coupons-admin input:focus,.coupons-admin select:focus{outline:2px solid #d5a24940;border-color:#c99550!important}
.coupons-admin button{border:1px solid #c99550!important;border-radius:999px!important;background:linear-gradient(120deg,#eac16e,#c28a38)!important;color:#10213a!important;font-weight:800!important;cursor:pointer}
.coupons-admin button:disabled{opacity:.55}
.coupons-admin article{background:#fffefa;border:1px solid #e8e0d4;border-radius:12px;padding:14px;margin:12px 0}
.coupons-admin [role=status]{padding:12px;border-radius:10px;background:#f2ede3!important;border-left:3px solid #c99550}
@media(max-width:640px){.coupons-admin{padding:0 12px 24px!important}.coupons-header{margin:0 -12px 18px;padding:17px}.coupons-brand{font-size:22px}.coupons-brand img{width:38px;height:38px}.coupons-admin>section{padding:16px!important;border-radius:13px!important}}
`}</style>
<header className="coupons-header"><div><a className="coupons-brand" href="/store.html"><img src="/assets/icon-512.png" alt="Ebnimaam logo"/><span>ebnimaam</span></a><p>Professional store workspace · Promotions and discount rules</p></div><nav><a href="/admin">← Main admin</a><a href="/admin/loyalty">Rewards & wallet</a></nav></header>
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
