'use client';

import {useEffect,useMemo,useState} from 'react';

async function compressNewsImage(file: File): Promise<string> {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.');
  if (file.size > 12 * 1024 * 1024) throw new Error('This photo is too large. Choose an image under 12 MB.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The selected photo could not be opened.'));
      image.src = objectUrl;
    });
    if (!picture.naturalWidth || !picture.naturalHeight) throw new Error('The selected photo is invalid.');
    const scale = Math.min(1, 1600 / Math.max(picture.naturalWidth, picture.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo processing is not supported on this device.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('The photo could not be prepared.')), 'image/jpeg', 0.84);
    });
    if (blob.size > 2_500_000) {
      const reduced = document.createElement('canvas');
      const reducedScale = Math.min(1, 1200 / Math.max(picture.naturalWidth, picture.naturalHeight));
      reduced.width = Math.max(1, Math.round(picture.naturalWidth * reducedScale));
      reduced.height = Math.max(1, Math.round(picture.naturalHeight * reducedScale));
      const reducedContext = reduced.getContext('2d');
      if (!reducedContext) throw new Error('Photo processing is not supported on this device.');
      reducedContext.fillStyle = '#ffffff';
      reducedContext.fillRect(0, 0, reduced.width, reduced.height);
      reducedContext.drawImage(picture, 0, 0, reduced.width, reduced.height);
      blob = await new Promise<Blob>((resolve, reject) => {
        reduced.toBlob((result) => result ? resolve(result) : reject(new Error('The photo could not be compressed.')), 'image/jpeg', 0.72);
      });
    }
    if (blob.size > 2_500_000) throw new Error('This photo is still too large after compression. Please choose another photo.');
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The photo could not be uploaded.'));
      reader.readAsDataURL(blob);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function Admin(){
 const [pass,setPass]=useState(''),[ok,setOk]=useState(false),[err,setErr]=useState(''),[orders,setOrders]=useState<any[]>([]),[customers,setCustomers]=useState<any[]>([]),[activity,setActivity]=useState<any[]>([]),[emailConfigured,setEmailConfigured]=useState(false),[stockMovements,setStockMovements]=useState<any[]>([]),[stockAdjustment,setStockAdjustment]=useState<any>({productId:'',variant:'',delta:'',reason:''}),[supportTickets,setSupportTickets]=useState<any[]>([]),[productQuestions,setProductQuestions]=useState<any[]>([]),[reportedReviews,setReportedReviews]=useState<any[]>([]),[supportReplyDrafts,setSupportReplyDrafts]=useState<Record<string,string>>({}),[questionAnswerDrafts,setQuestionAnswerDrafts]=useState<Record<string,string>>({}),[products,setProducts]=useState<any[]>([]),[news,setNews]=useState<any[]>([]),[newsEditing,setNewsEditing]=useState<any>(null),[editing,setEditing]=useState<any>(null),[search,setSearch]=useState(''),[paymentFilter,setPaymentFilter]=useState('all'),[fulfilFilter,setFulfilFilter]=useState('all'),[settings,setSettings]=useState<any>({pickupAddress:'',pickupAddressConfirmed:false,pickupHours:'',holidayExceptions:'',deliveryRules:'',supportEmail:'',supportPhone:'',socialLinks:{instagram:'',facebook:'',tiktok:'',youtube:'',x:'',whatsappChannel:'https://whatsapp.com/channel/0029Vb7JXDL0VycOVg5oBv0N'},returnsPolicy:'',privacyPolicy:'',terms:'',shippingPolicy:'',lowStockThreshold:3,deliveryFeesByState:{},deliveryFeesConfirmed:false});
 async function loadProducts(){const r=await fetch('/api/products');const d=await r.json();setProducts(d.products||[])}
 async function loadNews(){const r=await fetch('/api/news');const d=await r.json();setNews(d.news||[])}
 async function loadSettings(){const r=await fetch('/api/store-settings');if(r.ok){const d=await r.json();setSettings(d.settings||{})}}
 async function loadSupportTickets(){const r=await fetch('/api/admin/support',{cache:'no-store'});if(r.ok){const d=await r.json();setSupportTickets(d.tickets||[])}}
 async function loadProductQuestions(){const r=await fetch('/api/admin/product-questions',{cache:'no-store'});if(r.ok){const d=await r.json();setProductQuestions(d.questions||[])}}
 async function loadReportedReviews(){const r=await fetch('/api/admin/product-reviews',{cache:'no-store'});if(r.ok){const d=await r.json();setReportedReviews(d.reviews||[])}}
 async function loadStockMovements(){const r=await fetch('/api/admin/stock-movements',{cache:'no-store'});if(r.ok){const d=await r.json();setStockMovements(d.movements||[])}}
 async function updateSupportTicket(ticketId:string,payload:any){const r=await fetch('/api/admin/support',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticketId,...payload})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Support ticket update failed.');await loadSupportTickets()}
 async function moderateReportedReview(reviewId:string,moderation:'published'|'hidden'|'rejected',reportStatus:'reviewed'|'dismissed'|'open'){const r=await fetch('/api/admin/product-reviews',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewId,moderation,reportStatus})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Review moderation failed.');await loadReportedReviews();setErr(moderation==='hidden'?'Review hidden from the storefront.':moderation==='rejected'?'Review rejected.':'Review restored to the storefront.')}
 async function moderateProductQuestion(id:string,status:'published'|'rejected'){const answer=questionAnswerDrafts[id]||'';if(status==='published'&&answer.trim().length<3){setErr('Write an answer before publishing a product question.');return}const r=await fetch('/api/admin/product-questions',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status,answer})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Question moderation failed.');await loadProductQuestions();setErr(status==='published'?'Product question approved and published.':'Product question rejected.')}

 async function saveStockAdjustment(e:any){
  e.preventDefault();
  const delta=Number(stockAdjustment.delta);
  if(!Number.isSafeInteger(delta)||delta===0){setErr('Enter a non-zero whole-number quantity change.');return}
  const response=await fetch('/api/admin/stock-movements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(stockAdjustment)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){setErr(data.error||'Stock adjustment failed.');return}
  setStockAdjustment({productId:stockAdjustment.productId,variant:'',delta:'',reason:''});
  setErr('Stock adjustment saved and recorded in the inventory movement ledger.');
  await Promise.allSettled([loadProducts(),loadStockMovements()]);
 }
 async function saveSettings(e:any){e.preventDefault();const r=await fetch('/api/store-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});if(r.ok)setErr('Store settings saved. Nigeria-only delivery is enforced.');else{const d=await r.json().catch(()=>({}));setErr(d.error||'Could not save store settings.')}}
 async function saveNews(e:any){
  e.preventDefault();
  try{
   setErr('');
   const payload={id:newsEditing.id,title:String(newsEditing.title||''),content:String(newsEditing.content||''),image:String(newsEditing.image||''),published:newsEditing.published!==false};
   const response=await fetch('/api/news',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'News save failed.');
   setNewsEditing(null);
   await loadNews();
   setErr('News item saved successfully.');
  }catch(error:any){
   setErr(error?.message||'News save failed.');
  }
 }
 async function selectNewsPhoto(event:any){
  const file=event.target.files?.[0];
  if(!file)return;
  try{
   setErr('Preparing photo…');
   const image=await compressNewsImage(file);
   setNewsEditing((current:any)=>current?{...current,image,preview:image}:current);
   setErr('Photo ready to save.');
  }catch(error:any){
   setErr(error?.message||'Photo upload failed.');
  }
 }
 function editNewsItem(item:any){
  setNewsEditing({...item,preview:item.image||''});
 }
 async function deleteNewsItem(id:string){
  if(!confirm('Delete this news item?'))return;
  const response=await fetch('/api/news',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
  const data=await response.json().catch(()=>({}));
  if(response.ok)await loadNews();
  else setErr(data.error||'News delete failed.');
 }
 async function load(silent=false){try{const r=await fetch('/api/admin',{cache:'no-store'});if(!r.ok){setOk(false);if(!silent)setErr('Session expired. Sign in again.');return}const d=await r.json();setOrders(d.orders||[]);setCustomers(d.customers||[]);setActivity(d.activity||[]);setEmailConfigured(d.email_configured===true);setOk(true);await Promise.allSettled([loadProducts(),loadNews(),loadSettings(),loadSupportTickets(),loadProductQuestions(),loadReportedReviews(),loadStockMovements()])}catch{setOk(false);if(!silent)setErr('Could not restore the administrator session. Please try signing in again.')}}useEffect(()=>{void load(true);const refresh=window.setInterval(()=>void load(true),60000);return ()=>window.clearInterval(refresh)},[]);
 function exportCustomers(){const columns=['email','name','phone','order_count','paid_order_count','paid_total_kobo','last_order_at'];const cell=(value:any)=>{let text=String(value??'');if(/^[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'};const csv=[columns.join(','),...customers.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='ebnimaam-customers.csv';link.click();URL.revokeObjectURL(url)}
 async function exportWebsitePdf(){try{setErr('');const response=await fetch('/api/admin/export',{cache:'no-store'});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'The website information could not be exported.')}const blob=await response.blob();if(!blob.size)throw new Error('The export is empty.');const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='ebnimaam-website-information.pdf';document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1500);setErr('Full website information downloaded as PDF.')}catch(error:any){setErr(error?.message||'The website information could not be exported.')}}
 async function saveProduct(e:any){e.preventDefault();try{setErr('');let image=editing.image;if(editing.file){image=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(editing.file)})}const gallery=String(editing.galleryText||'').split(/\r?\n/).map((value:string)=>value.trim()).filter(Boolean);const size_stock=JSON.parse(String(editing.sizeStockText||'{}'));const product_details=JSON.parse(String(editing.productDetailsText||'{}'));if(!size_stock||typeof size_stock!=='object'||Array.isArray(size_stock)||!product_details||typeof product_details!=='object'||Array.isArray(product_details))throw new Error('Stock and product details must be valid JSON objects.');const p={...editing,image,gallery,size_stock,product_details,sizes:Array.isArray(editing.sizes)?editing.sizes:[],file:undefined};delete p.file;delete p.galleryText;delete p.sizeStockText;delete p.productDetailsText;const r=await fetch('/api/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Product save failed');setEditing(null);await loadProducts()}catch(e:any){setErr(e.message||'Product save failed')}}
 const filtered=useMemo(()=>orders.filter(o=>{const q=search.toLowerCase();const match=[o.reference,o.customer_name,o.customer_email,o.customer_phone].some(v=>String(v||'').toLowerCase().includes(q));return match&&(paymentFilter==='all'||String(o.status||'').toLowerCase()===paymentFilter)&&(fulfilFilter==='all'||String(o.fulfilment_status||'processing').toLowerCase()===fulfilFilter)}),[orders,search,paymentFilter,fulfilFilter]);
 const paid=orders.filter(o=>['paid','success','successful'].includes(String(o.status||'').toLowerCase()));const revenue=paid.reduce((a,o)=>a+Number(o.amount_kobo||0),0);
 const salesByDay=useMemo(()=>{
  const today=new Date();today.setHours(0,0,0,0);
  return Array.from({length:7},(_,index)=>{
   const date=new Date(today);date.setDate(today.getDate()-(6-index));
   const amount=paid.filter(order=>{const created=new Date(order.paid_at||order.created_at);return !Number.isNaN(created.getTime())&&created.getFullYear()===date.getFullYear()&&created.getMonth()===date.getMonth()&&created.getDate()===date.getDate()}).reduce((sum,order)=>sum+Number(order.amount_kobo||0)/100,0);
   return {key:date.toISOString().slice(0,10),label:date.toLocaleDateString('en-NG',{weekday:'short'}),amount:Math.round(amount)};
  });
 },[orders]);
 const salesMax=Math.max(1,...salesByDay.map(day=>day.amount));

 const lowStockThreshold=Number(settings.lowStockThreshold??3);
 const lowStockProducts=products.filter(p=>p.is_active===true&&Number(p.stock)>0&&Number(p.stock)<=lowStockThreshold);
 const outOfStockProducts=products.filter(p=>p.is_active===true&&Number(p.stock)<=0);
 const selectedStockProduct=products.find(p=>String(p.id)===String(stockAdjustment.productId))||null;
 const selectedStockVariants=selectedStockProduct?.size_stock&&typeof selectedStockProduct.size_stock==='object'&&!Array.isArray(selectedStockProduct.size_stock)?Object.keys(selectedStockProduct.size_stock):[];
 const css=`*{box-sizing:border-box}
:root{--admin-navy:#102544;--admin-ink:#17263c;--admin-muted:#6d7a8b;--admin-line:#e6eaf0;--admin-paper:#fff;--admin-bg:#f3f6fb;--admin-gold:#c99550}
html{scroll-behavior:smooth}
body{margin:0;background:var(--admin-bg);color:var(--admin-ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1560px;margin:0 auto;padding:clamp(14px,2.4vw,34px);font-family:inherit;color:var(--admin-ink)}
main.admin-dashboard{display:grid;grid-template-columns:238px minmax(0,1fr);grid-template-rows:auto 1fr;gap:22px;align-items:start}
main.admin-login{max-width:640px;min-height:100vh;display:block;padding-top:8vh}
.admin-header{grid-column:1/-1;grid-row:1;background:radial-gradient(circle at 85% 12%,#345274 0,transparent 32%),linear-gradient(120deg,#0d1c34,#173555);color:white;border-radius:24px;padding:clamp(22px,3vw,38px);box-shadow:0 18px 48px #10254424;position:relative;overflow:hidden}
.admin-header h1{font-size:clamp(27px,3vw,40px);letter-spacing:-.045em;line-height:1.08;margin:14px 0 8px;color:white}
.admin-eyebrow{font-size:10px;letter-spacing:.18em;font-weight:800;color:#d7b27d}
.admin-secure{font-size:11px;color:#dce8f4;background:#ffffff18;border:1px solid #ffffff28;border-radius:999px;padding:7px 11px}
.admin-brand-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.admin-intro{max-width:680px;color:#d7e1ed;font-size:13px;line-height:1.6}
.admin-header-links{display:flex;gap:9px;flex-wrap:wrap;margin-top:19px}
.admin-header-links a{display:inline-flex;align-items:center;gap:7px;color:white!important;text-decoration:none!important;font-size:12px;font-weight:700;padding:9px 13px;border:1px solid #ffffff35;border-radius:999px;background:#ffffff12}
.admin-header-links a:hover{background:#ffffff24}
.admin-nav{grid-column:1;grid-row:2;position:sticky;top:16px;display:flex;flex-direction:column;gap:5px;background:#fff;border:1px solid var(--admin-line);border-radius:18px;padding:12px;box-shadow:0 8px 28px #1025440a}
.admin-nav .nav-label{font-size:9px;text-transform:uppercase;letter-spacing:.16em;color:#8995a4;font-weight:800;padding:9px 10px 6px}
.admin-nav a{display:flex;align-items:center;min-height:39px;padding:9px 10px;border-radius:10px;color:#34445c;text-decoration:none;font-size:12px;font-weight:650;transition:background .16s,color .16s}
.admin-nav a:hover{background:#f3f6fa;color:var(--admin-navy)}
.admin-nav a.primary{background:#eef3f9;color:var(--admin-navy)}
.admin-content{grid-column:2;grid-row:2;min-width:0}
.admin-content>form:not(.editform){background:#fff;border:1px solid var(--admin-line);border-radius:18px;padding:24px;box-shadow:0 10px 32px #1025440a}
h1{font-size:clamp(26px,4vw,38px);margin:8px 0;letter-spacing:-.04em}
h2{font-size:20px;letter-spacing:-.025em;color:var(--admin-navy);margin:30px 0 13px;padding-bottom:11px;border-bottom:1px solid var(--admin-line);scroll-margin-top:24px}
h3{font-size:15px;color:#243751;margin:18px 0 9px}
button,select,input,textarea{font:inherit}
button{padding:10px 15px;border-radius:10px;border:1px solid #183859;background:var(--admin-navy);color:white;cursor:pointer;margin:4px 5px 4px 0;font-size:12px;font-weight:700;transition:transform .16s,box-shadow .16s,background .16s}
button:hover{background:#1a3a5e;box-shadow:0 5px 14px #10254424;transform:translateY(-1px)}
button:disabled{opacity:.48;cursor:not-allowed;transform:none;box-shadow:none}
button.secondary{background:#fff;color:var(--admin-navy);border-color:var(--admin-line)}
button.secondary:hover{background:#f6f8fb}
input,textarea,select{padding:11px 13px;border:1px solid #dbe1e9;border-radius:10px;width:100%;max-width:100%;background:#fff;color:var(--admin-ink);outline:0;transition:border-color .16s,box-shadow .16s}
input:focus,textarea:focus,select:focus{border-color:#9aafc7;box-shadow:0 0 0 3px #dce7f3}
label{display:block;margin:11px 0;color:#35465d;font-size:12px;font-weight:650}
.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.stat{position:relative;min-width:0;border:1px solid var(--admin-line);border-radius:16px;padding:17px;background:linear-gradient(145deg,#fff,#fafbfd);box-shadow:0 7px 24px #10254408;color:var(--admin-muted);font-size:11px;font-weight:700;letter-spacing:.04em}
.stat strong{font-size:clamp(19px,2vw,27px);letter-spacing:-.04em;color:var(--admin-navy);display:block;margin-top:8px;overflow-wrap:anywhere}
.filters{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin:12px 0}
.orderhead{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
.muted{color:var(--admin-muted);font-size:12px;line-height:1.6}
article{border:1px solid var(--admin-line);border-radius:16px;padding:16px;margin:12px 0;background:var(--admin-paper);overflow-wrap:anywhere;box-shadow:0 7px 22px #10254407}
article b{color:#20334c}
.product{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.product img{width:76px;height:76px;object-fit:cover;border-radius:10px;background:#f2f4f7}
.editform{background:#f9fafc;border:1px solid var(--admin-line);padding:18px;border-radius:16px;margin-top:18px}
.admin-content>div[style*="marginTop"]{display:flex;gap:8px;flex-wrap:wrap}
.admin-content>div[style*="marginTop"] button{margin:0}
.admin-content form button{margin-top:8px}
.admin-content p[role="alert"]{color:#b42318}
@media(max-width:1100px){.stats{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:820px){main.admin-dashboard{display:flex;flex-direction:column}.admin-header{width:100%}.admin-nav{position:relative;top:auto;width:100%;display:flex;flex-direction:row;overflow:auto;white-space:nowrap;max-width:100%;padding:8px}.admin-nav .nav-label{display:none}.admin-nav a{flex:0 0 auto;min-height:35px}.admin-content{width:100%}}
@media(max-width:560px){main{padding:12px}.admin-header{border-radius:18px;padding:20px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.stat{padding:13px}.admin-content h2{font-size:17px;margin-top:25px}.editform{padding:13px}.filters{grid-template-columns:1fr}.admin-header-links a{font-size:11px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}button{transition:none}}
main.admin-dashboard{max-width:none;min-height:100vh;padding:0;grid-template-columns:250px minmax(0,1fr);grid-template-rows:auto 1fr;gap:0;background:#faf8f3}
main.admin-login{max-width:520px;min-height:100vh;display:flex;flex-direction:column;gap:0;padding:7vh 16px 30px}
.admin-header{grid-column:1;grid-row:1;background:linear-gradient(180deg,#06172d 0%,#0b2340 100%);border-right:1px solid #c99550;border-radius:0;padding:24px 19px 18px;min-height:180px;box-shadow:none;position:relative;overflow:hidden}
.admin-brand-lockup{display:flex;align-items:center;gap:11px;text-decoration:none;color:#f0bd65;font:600 26px Georgia,serif;letter-spacing:-.04em;margin-bottom:24px}
.admin-brand-lockup img{width:45px;height:45px;object-fit:contain;border-radius:12px;background:#faf8f2;padding:2px}
.admin-brand-row{display:block;margin:0 0 10px}
.admin-eyebrow{font-size:9px;letter-spacing:.17em;color:#e9bd70}
.admin-secure{display:inline-flex;margin-top:7px;font-size:10px;padding:5px 9px;background:#ffffff12;border-color:#ffffff26}
.admin-header h1{font-size:16px;letter-spacing:-.01em;margin:8px 0 6px;color:#fff}
.admin-intro{font-size:11px;line-height:1.55;color:#bdc9d8;margin:0}
.admin-header-links{display:none}
.admin-nav{grid-column:1;grid-row:2;position:sticky;top:0;height:calc(100vh - 180px);min-height:420px;overflow:auto;align-self:start;background:linear-gradient(180deg,#0b2340,#06172d);border:0;border-right:1px solid #c99550;border-radius:0;padding:10px 12px 24px;box-shadow:none}
.admin-nav .nav-label{color:#c5a46f;padding:15px 10px 7px}
.admin-nav a{color:#ecf1f7;min-height:43px;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:550}
.admin-nav a:hover{background:#ffffff14;color:#f4c36e}
.admin-nav a.primary{background:linear-gradient(115deg,#f3ca77,#cf963f);color:#0c1c32;font-weight:800}
.admin-content{grid-column:2;grid-row:1/span 2;min-width:0;padding:25px clamp(16px,2.2vw,34px) 34px;background:#faf8f3;min-height:100vh}
.admin-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 22px;padding:4px 0 18px;border-bottom:1px solid #e9e2d6}
.admin-topbar h2{border:0;padding:0;margin:0;color:#101e36;font-size:clamp(24px,2.7vw,34px);letter-spacing:-.045em}
.admin-topbar p{margin:5px 0 0;font-size:13px;color:#687386}
.admin-live{display:inline-flex;align-items:center;gap:8px;padding:9px 13px;border-radius:999px;background:#e5f5e7;color:#13783a;font-size:11px;font-weight:800;white-space:nowrap}
.admin-live:before{content:"";width:8px;height:8px;border-radius:50%;background:#169447;box-shadow:0 0 0 4px #16944719}
.stats{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.stat{border-radius:15px;padding:17px 16px;background:linear-gradient(145deg,#fffefa,#fff);border-color:#e8e1d7;box-shadow:0 8px 25px #17263c0a;color:#687386;letter-spacing:0}
.stat strong{font-size:clamp(18px,1.9vw,25px);color:#102544;margin-top:9px}
.admin-overview-panels{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,1fr);gap:16px;margin:20px 0 24px}
.admin-chart-card,.admin-referral-card{border:1px solid #e8e1d7;border-radius:16px;background:#fffefa;box-shadow:0 8px 25px #17263c09;padding:18px;min-width:0}
.admin-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 15px}
.admin-panel-head h3{font-size:17px;margin:0;color:#102544}
.admin-panel-head span{font-size:10px;color:#7a8492}
.admin-chart-total{font-size:25px;font-weight:800;letter-spacing:-.04em;color:#102544;margin:6px 0 2px}
.admin-chart-sub{font-size:10px;color:#87909b}
.admin-chart-bars{height:148px;display:flex;align-items:flex-end;gap:10px;padding:12px 5px 0;border-bottom:1px solid #e5ded2;background:repeating-linear-gradient(to bottom,transparent 0,transparent 35px,#eee9e1 36px)}
.admin-chart-day{flex:1;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center;position:relative}
.admin-chart-bar{width:min(28px,72%);min-height:3px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#e7b95d,#b57a2e);box-shadow:0 3px 9px #c9955030}
.admin-chart-day small{position:absolute;bottom:-19px;left:50%;transform:translateX(-50%);font-size:9px;color:#778293;white-space:nowrap}
.admin-chart-empty{height:148px;display:grid;place-items:center;color:#8993a0;font-size:12px;text-align:center}
.admin-referral-card{background:radial-gradient(circle at 80% 8%,#22456c 0,transparent 32%),linear-gradient(145deg,#071a31,#102b4b);color:white;display:flex;flex-direction:column;justify-content:space-between;min-height:230px;position:relative;overflow:hidden}
.admin-referral-card:after{content:"✦";position:absolute;right:16px;top:8px;font-size:78px;color:#d5a44f20}
.admin-referral-icon{font-size:32px;color:#e8b755}
.admin-referral-card h3{font:600 21px Georgia,serif;color:#fff;margin:10px 0}
.admin-referral-card p{font-size:12px;line-height:1.65;color:#d5dfeb;max-width:290px;margin:0 0 18px}
.admin-referral-card a{display:inline-flex;align-items:center;justify-content:center;align-self:flex-start;border:1px solid #e3b75e;border-radius:999px;background:linear-gradient(120deg,#f2c76d,#c88e37);color:#102544;text-decoration:none;padding:10px 16px;font-size:11px;font-weight:800}
.admin-content>h2{margin-top:27px;padding-bottom:10px;border-bottom:1px solid #e8e1d7}
.admin-content article{border-radius:13px;border-color:#e8e1d7;box-shadow:0 6px 22px #17263c08;background:#fffefa}
.admin-content .editform{background:#fffefa;border-color:#e8e1d7}
main.admin-login .admin-header{grid-column:auto;grid-row:auto;width:100%;min-height:auto;border-radius:18px;border:1px solid #c99550}
main.admin-login .admin-content{grid-column:auto;grid-row:auto;width:100%;min-height:auto;padding:20px 0 0}
main.admin-login .admin-content>form:not(.editform){border-radius:18px;padding:24px}
@media(max-width:1250px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.admin-overview-panels{grid-template-columns:1fr 1fr}}
@media(max-width:900px){main.admin-dashboard{display:grid;grid-template-columns:205px minmax(0,1fr);grid-template-rows:auto 1fr;gap:0}.admin-header{grid-column:1;grid-row:1;min-height:172px;padding:19px 14px}.admin-brand-lockup{font-size:22px;margin-bottom:18px}.admin-nav{grid-column:1;grid-row:2;height:calc(100vh - 172px);min-height:420px}.admin-content{grid-column:2;grid-row:1/span 2;padding:20px 15px}.admin-overview-panels{grid-template-columns:1fr}.admin-header-links{display:none}}
@media(max-width:640px){main.admin-dashboard{display:flex;flex-direction:column;min-height:100vh}.admin-header{position:relative;width:100%;min-height:auto;padding:15px 17px;border-right:0;border-bottom:1px solid #c99550}.admin-brand-lockup{font-size:22px;margin-bottom:10px}.admin-brand-lockup img{width:37px;height:37px}.admin-brand-row{margin-bottom:7px}.admin-secure{display:none}.admin-header h1{font-size:14px;margin:5px 0}.admin-intro{font-size:10px}.admin-nav{position:sticky;top:0;z-index:30;width:100%;height:auto;min-height:0;display:flex;flex-direction:row;overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding:8px 10px;border-right:0;border-bottom:1px solid #c99550}.admin-nav .nav-label{display:none}.admin-nav a{flex:0 0 auto;min-height:36px;padding:8px 10px;font-size:11px}.admin-content{width:100%;min-height:0;padding:16px 12px 24px}.admin-topbar{align-items:flex-start;flex-direction:column;margin-bottom:17px}.admin-topbar h2{font-size:25px}.admin-live{font-size:10px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.stat{padding:13px}.stat strong{font-size:19px}.admin-chart-card,.admin-referral-card{padding:15px}}
@media(prefers-reduced-motion:reduce){.admin-nav a,button{transition:none}}
`;
 return <main className={ok?'admin-dashboard':'admin-login'}><style>{css}</style><header className="admin-header"><a className="admin-brand-lockup" href="/store.html"><img src="/assets/icon-512.png" alt="Ebnimaam logo"/><span>ebnimaam</span></a><div className="admin-brand-row"><span className="admin-eyebrow">OWNER WORKSPACE</span><br/><span className="admin-secure">Secure administration</span></div><h1>Control centre</h1><p className="admin-intro">One workspace for your storefront, orders, stock, customers and store content.</p><div className="admin-header-links"><a href="/store.html">Open storefront ↗</a><a href="/admin/loyalty">Rewards & referrals</a><a href="/admin/coupons">Coupons</a><a href="/privacy.html">Privacy</a><a href="/returns.html">Returns</a><a href="/terms.html">Terms</a></div></header>{ok&&<nav className="admin-nav" aria-label="Admin sections"><span className="nav-label">Workspace</span><a className="primary" href="#overview">Overview</a><a href="#inventory">Inventory alerts</a><a href="#stock-history">Stock movements</a><a href="#orders">Orders</a><a href="#products">Products</a><a href="#customers">Customers</a><a href="#support">Customer support</a><a href="#settings">Store settings</a><a href="#activity">Admin activity</a><a href="#content">Website news</a><span className="nav-label">Store tools</span><a href="/admin/loyalty">Rewards & referrals</a><a href="/admin/coupons">Coupons & promotions</a></nav>}<div className="admin-content">{!ok?<form onSubmit={async e=>{e.preventDefault();setErr('');const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass})});if(r.ok)load();else setErr('Login failed.')}}><h2>Administrator sign in</h2><label>Admin password<input type="password" value={pass} onChange={e=>setPass(e.target.value)} required/></label><button>Sign in</button>{err&&<p role="alert">{err}</p>}</form>:<><div className="admin-topbar"><div><h2>Welcome back</h2><p>Here is what is happening with your store today.</p></div><span className="admin-live">Online store active</span></div><div className="stats" id="overview"><div className="stat">Total sales<strong>₦{(revenue/100).toLocaleString()}</strong></div><div className="stat">Total orders<strong>{orders.length}</strong></div><div className="stat">Customers<strong>{customers.length}</strong></div><div className="stat">Published products<strong>{products.filter(product=>product.is_active===true).length}</strong></div></div><div className="admin-overview-panels">
 <section className="admin-chart-card">
  <div className="admin-panel-head"><h3>Sales overview</h3><span>Last 7 days</span></div>
  <div className="admin-chart-total">₦{salesByDay.reduce((sum,day)=>sum+day.amount,0).toLocaleString('en-NG',{maximumFractionDigits:0})}</div>
  <div className="admin-chart-sub">Verified paid-order value in the selected period</div>
  {salesByDay.some(day=>day.amount>0)?<div className="admin-chart-bars" role="img" aria-label="Paid order value over the last seven days">{salesByDay.map((day,index)=><div className="admin-chart-day" key={day.key}><div className="admin-chart-bar" title={day.label+': ₦'+day.amount.toLocaleString()} style={{height:Math.max(4,day.amount/salesMax*100)+'%'}}></div><small>{day.label}</small></div>)}</div>:<div className="admin-chart-empty">No verified paid orders in the last 7 days yet.</div>}
 </section>
 <aside className="admin-referral-card"><div><div className="admin-referral-icon">✦</div><h3>Rewards & referrals</h3><p>Manage your customer rewards programme, referral activity and store promotions from one place.</p></div><a href="/admin/loyalty">Open rewards workspace →</a></aside>
</div><div style={{marginTop:14}}><button onClick={()=>load()}>Refresh data</button><button className="secondary" onClick={exportWebsitePdf}>Download all website information (PDF)</button><button className="secondary" onClick={async()=>{await fetch('/api/admin',{method:'DELETE'});setOk(false)}}>Logout</button></div><h2 id="inventory">Inventory alerts</h2><article><b>Low-stock threshold: {lowStockThreshold} units</b><p className="muted">Active products at or below this quantity need restocking attention. Products at zero stock are listed separately.</p>{lowStockProducts.length?lowStockProducts.map(p=><p key={p.id}>{p.name} — <b>{p.stock} left</b></p>):<p className="muted">No active products are currently below the low-stock threshold.</p>}{outOfStockProducts.length>0&&<p><b>Out of stock:</b> {outOfStockProducts.map(p=>p.name).join(", ")}</p>}</article><h2 id="stock-history">Stock adjustments & movement history</h2>
<p className="muted">Every adjustment is validated on the server and recorded with the previous quantity, new quantity, reason and variant where applicable. Use a positive number to add stock and a negative number to remove stock.</p>
<form className="editform" onSubmit={saveStockAdjustment}>
 <label>Product<select required value={stockAdjustment.productId} onChange={e=>setStockAdjustment({...stockAdjustment,productId:e.target.value,variant:''})}>
  <option value="">Choose a product</option>
  {products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.stock} total</option>)}
 </select></label>
 {selectedStockVariants.length>0?<label>Variant / size<select required value={stockAdjustment.variant} onChange={e=>setStockAdjustment({...stockAdjustment,variant:e.target.value})}>
  <option value="">Choose a variant</option>
  {selectedStockVariants.map(variant=><option key={variant} value={variant}>{variant} · {selectedStockProduct.size_stock[variant]} units</option>)}
 </select></label>:<p className="muted">This product has no separately tracked variant stock; the adjustment applies to total stock.</p>}
 <label>Quantity change (+ add / − remove)<input type="number" step="1" min="-100000" max="100000" required value={stockAdjustment.delta} onChange={e=>setStockAdjustment({...stockAdjustment,delta:e.target.value})}/></label>
 <label>Reason for adjustment<textarea rows={2} minLength={4} maxLength={300} required value={stockAdjustment.reason} onChange={e=>setStockAdjustment({...stockAdjustment,reason:e.target.value})} placeholder="e.g. New delivery received, damaged items removed, or count correction"/></label>
 <button type="submit">Record stock adjustment</button>
</form>
<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:14}}>
 <b>Stock movement history ({stockMovements.length})</b>
 <button className="secondary" type="button" onClick={()=>void loadStockMovements()}>Refresh movements</button>
</div>
{stockMovements.length?stockMovements.slice(0,100).map(movement=><article key={movement.id}>
 <div className="orderhead"><b>{movement.product_name}{movement.variant?' · '+movement.variant:''}</b><span>{movement.delta>0?'+':''}{movement.delta}</span></div>
 <p className="muted">{movement.old_qty} → {movement.new_qty} units · {new Date(movement.created_at).toLocaleString()}</p>
 <p>{movement.reason}</p>
</article>):<p className="muted">No stock movements have been recorded by this release yet. Product creation, product-editor stock changes and admin adjustments are recorded from this point onward.</p>}
<h2 id="settings">Store settings · Nigeria only</h2>{!emailConfigured&&<article style={{borderColor:'#d97706',background:'#fffbeb'}}><b>Customer and sign-in security emails are not connected yet.</b><p className="muted">Configure Gmail SMTP using encrypted, server-only environment variables: SMTP_USER, SMTP_PASS (Google App Password), SMTP_HOST=smtp.gmail.com, SMTP_PORT=465 or 587, EMAIL_FROM and the existing AUTH_SECRET. Keep credentials out of GitHub and browser code. Customer registration OTP, verification and password-reset mail use the separate Neon Auth SMTP settings.</p></article>}<form className="editform" onSubmit={saveSettings}><label>Pickup / handover address<textarea rows={3} value={settings.pickupAddress||''} onChange={e=>setSettings({...settings,pickupAddress:e.target.value})}/></label><p className="muted">Enter the actual pickup address used by your store. Self-pickup checkout stays unavailable until an address is saved.</p><label style={{display:'flex',gap:9,alignItems:'flex-start'}}><input type="checkbox" style={{width:'auto',minHeight:'auto'}} checked={settings.pickupAddressConfirmed===true} onChange={e=>setSettings({...settings,pickupAddressConfirmed:e.target.checked})}/> I confirm this is the real current customer pickup address. Self-pickup remains disabled unless this is checked.</label><label>Pickup hours<textarea rows={2} value={settings.pickupHours||''} onChange={e=>setSettings({...settings,pickupHours:e.target.value})}/></label><label>Holiday exceptions<textarea rows={2} value={settings.holidayExceptions||''} onChange={e=>setSettings({...settings,holidayExceptions:e.target.value})}/></label><label>Delivery rules and estimates<textarea rows={3} value={settings.deliveryRules||''} onChange={e=>setSettings({...settings,deliveryRules:e.target.value})}/></label><label>Low-stock alert threshold (units)<input type="number" min="0" max="1000" step="1" value={settings.lowStockThreshold??3} onChange={e=>setSettings({...settings,lowStockThreshold:Number(e.target.value)})}/></label><h3>Delivery fees (NGN) · Nigeria only</h3><div className="filters" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>{['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara','default'].map((state:string)=><label key={state}>{state==='default'?'All other Nigerian states':state}<input type="number" min="0" max="50000" step="1" placeholder="Not configured" value={settings.deliveryFeesByState?.[state]??''} onChange={e=>setSettings({...settings,deliveryFeesByState:{...(settings.deliveryFeesByState||{}),[state]:e.target.value===''?'':Number(e.target.value)}})}/></label>)}</div><p className="muted">Enter the actual fee for each state you serve, or set the all-other-states fee. Checkout is blocked where no fee is configured; blank fields are not treated as free delivery.</p><label style={{display:'flex',gap:9,alignItems:'flex-start'}}><input type="checkbox" style={{width:'auto',minHeight:'auto'}} checked={settings.deliveryFeesConfirmed===true} onChange={e=>setSettings({...settings,deliveryFeesConfirmed:e.target.checked})}/> I confirm these are the store's actual current delivery fees. Checkout will remain blocked until this is checked.</label><label>Support email<input value={settings.supportEmail||''} onChange={e=>setSettings({...settings,supportEmail:e.target.value})}/></label><label>Support phone<input value={settings.supportPhone||''} onChange={e=>setSettings({...settings,supportPhone:e.target.value})}/></label><h3>Social profile links</h3><p className="muted">These verified HTTPS links appear on the public storefront and app. Add your current profile URLs and official WhatsApp Channel link.</p>{[['instagram','Instagram'],['facebook','Facebook'],['tiktok','TikTok'],['youtube','YouTube'],['x','X'],['whatsappChannel','WhatsApp Channel']].map(([key,label]:any)=><label key={key}>{label} profile URL<input type="url" inputMode="url" placeholder="https://..." value={settings.socialLinks?.[key]||''} onChange={e=>setSettings({...settings,socialLinks:{...(settings.socialLinks||{}),[key]:e.target.value}})}/></label>)}<label>Returns policy<textarea rows={3} value={settings.returnsPolicy||''} onChange={e=>setSettings({...settings,returnsPolicy:e.target.value})}/></label><label>Privacy policy<textarea rows={3} value={settings.privacyPolicy||''} onChange={e=>setSettings({...settings,privacyPolicy:e.target.value})}/></label><label>Terms<textarea rows={3} value={settings.terms||''} onChange={e=>setSettings({...settings,terms:e.target.value})}/></label><label>Shipping policy<textarea rows={3} value={settings.shippingPolicy||''} onChange={e=>setSettings({...settings,shippingPolicy:e.target.value})}/></label><button>Save store settings</button></form><h2 id="customers">Customers ({customers.length})</h2><button className="secondary" onClick={exportCustomers} disabled={!customers.length}>Export customer list CSV</button>{customers.length?customers.map(c=><article key={c.email}><b>{c.name||'Customer'}</b><p>{c.email} · {c.phone||'No phone on order'}</p><p className="muted">{c.order_count} order(s) · {c.paid_order_count} paid · ₦{(Number(c.paid_total_kobo||0)/100).toLocaleString()} paid total</p><p className="muted">Last order: {c.last_order_at?new Date(c.last_order_at).toLocaleString():'—'}</p></article>):<p className="muted">Customer records will appear here after customers place orders. New sign-ups without orders are not shown in this order-derived list.</p>}<h2 id="support">Customer support ({supportTickets.filter(ticket=>ticket.status!=='resolved').length} active)</h2>
<p className="muted">Private customer conversations. Replies are visible only to the account owner and Ebnimaam administrators.</p>
{supportTickets.length?supportTickets.map(ticket=><article key={ticket.id}>
 <div className="orderhead"><b>{ticket.subject}</b><span>{ticket.status.replace(/_/g,' ')}</span></div>
 <p className="muted">{ticket.customer_email} · {ticket.category} · Updated {new Date(ticket.updated_at).toLocaleString()}</p>
 {(ticket.messages||[]).map((message:any)=><div key={message.id} style={{padding:10,margin:'8px 0',background:message.sender_type==='admin'?'#f1eee7':'#f8fafc',borderRadius:8}}>
  <b>{message.sender_type==='admin'?'Ebnimaam':'Customer'}</b><span className="muted"> · {new Date(message.created_at).toLocaleString()}</span>
  <p style={{whiteSpace:'pre-wrap',margin:'6px 0'}}>{message.body}</p>
 </div>)}
 <label>Update status<select value={ticket.status} onChange={async e=>{try{await updateSupportTicket(ticket.id,{status:e.target.value});setErr('Support ticket status updated.')}catch(error:any){setErr(error.message)}}}>
  {['open','waiting_support','waiting_customer','resolved'].map(status=><option key={status} value={status}>{status.replace(/_/g,' ')}</option>)}
 </select></label>
 <form className="editform" onSubmit={async e=>{e.preventDefault();try{await updateSupportTicket(ticket.id,{reply:supportReplyDrafts[ticket.id]||''});setSupportReplyDrafts(prev=>({...prev,[ticket.id]:''}));setErr("Reply sent to the customer support history.")}catch(error:any){setErr(error.message)}}}>
  <label>Reply to customer<textarea rows={3} minLength={3} maxLength={3000} required value={supportReplyDrafts[ticket.id]||''} onChange={e=>setSupportReplyDrafts(prev=>({...prev,[ticket.id]:e.target.value}))}/></label>
  <button>Send reply</button>
 </form>
</article>):<p className="muted">No customer support tickets have been created.</p>}
<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="secondary" onClick={()=>void loadSupportTickets()}>Refresh support</button></div>
<h2>Product questions ({productQuestions.filter(q=>q.status==='pending').length} awaiting review)</h2>
<p className="muted">Questions are hidden from the storefront until an administrator publishes a checked answer.</p>
{productQuestions.length?productQuestions.map(question=><article key={question.id}>
 <div className="orderhead"><b>{question.product_name}</b><span>{question.status}</span></div>
 <p><b>Customer question:</b> {question.question}</p>
 <p className="muted">Asked by {question.customer_name} · {new Date(question.created_at).toLocaleString()}</p>
 {question.status!=='rejected'&&<label>Answer<textarea rows={3} minLength={3} maxLength={1600} value={questionAnswerDrafts[question.id]??question.answer??''} onChange={e=>setQuestionAnswerDrafts(prev=>({...prev,[question.id]:e.target.value}))}/></label>}
 <button onClick={async()=>{try{await moderateProductQuestion(question.id,'published')}catch(error:any){setErr(error.message)}}} disabled={question.status==='published'}>Approve and publish answer</button>
 <button className="secondary" onClick={async()=>{try{await moderateProductQuestion(question.id,'rejected')}catch(error:any){setErr(error.message)}}} disabled={question.status==='rejected'}>Reject question</button>
</article>):<p className="muted">No product questions have been submitted.</p>}
<h2>Reported reviews ({reportedReviews.length})</h2>
<p className="muted">Review reports are tied to verified purchaser accounts. Hidden or rejected reviews are excluded from public ratings.</p>
{reportedReviews.length?reportedReviews.map(review=><article key={review.review_id}>
 <div className="orderhead"><b>{review.product_name}</b><span>{review.moderation_status}</span></div>
 <p><b>{review.customer_name}</b> · {review.rating}/5 stars · {new Date(review.created_at).toLocaleString()}</p>
 <p style={{whiteSpace:'pre-wrap'}}>{review.comment||'No written comment.'}</p>
 {(review.reports||[]).map((report:any)=><p className="muted" key={report.report_id}>Report: {report.reason.replace(/_/g,' ')} · {report.status} · {new Date(report.created_at).toLocaleString()}</p>)}
 <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
  <button onClick={async()=>{try{await moderateReportedReview(review.review_id,'hidden','reviewed')}catch(error:any){setErr(error.message)}}}>Hide review</button>
  <button className="secondary" onClick={async()=>{try{await moderateReportedReview(review.review_id,'rejected','reviewed')}catch(error:any){setErr(error.message)}}}>Reject review</button>
  <button className="secondary" onClick={async()=>{try{await moderateReportedReview(review.review_id,'published','dismissed')}catch(error:any){setErr(error.message)}}}>Keep / restore review</button>
 </div>
</article>):<p className="muted">No review reports or moderation actions are pending.</p>}
<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="secondary" onClick={()=>void loadReportedReviews()}>Refresh review reports</button></div>
<h2 id="activity">Administrator activity</h2>{activity.length?activity.slice(0,40).map(a=><article key={a.id}><b>{a.action}</b><p className="muted">{a.entity_type||'admin'} · {a.entity_id||'—'} · {new Date(a.created_at).toLocaleString()}</p>{a.details&&Object.keys(a.details).length>0&&<p className="muted">{JSON.stringify(a.details)}</p>}</article>):<p className="muted">Administrator changes will be recorded here.</p>}<h2 id="orders">Orders</h2><div className="filters"><input aria-label="Search orders" placeholder="Search reference, name, email or phone" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Payment status filter" value={paymentFilter} onChange={e=>setPaymentFilter(e.target.value)}><option value="all">All payment statuses</option>{Array.from(new Set(orders.map(o=>String(o.status||'').toLowerCase()))).filter(Boolean).map(s=><option key={s} value={s}>{s}</option>)}</select><select aria-label="Fulfilment filter" value={fulfilFilter} onChange={e=>setFulfilFilter(e.target.value)}><option value="all">All fulfilment statuses</option>{['stock_issue','processing','picked','packed','shipped','delivered','cancelled'].map(s=><option key={s} value={s} disabled={s==='stock_issue'}>{s==='stock_issue'?'stock issue — owner review':s}</option>)}</select></div><p className="muted">Showing {filtered.length} of {orders.length} orders</p>{filtered.map(o=><article key={o.reference}><div className="orderhead"><h3>{o.reference} · ₦{(Number(o.amount_kobo)/100).toLocaleString()}</h3><span>{String(o.status||'').toUpperCase()}</span></div><p>{o.customer_name} · {o.customer_email} · {o.customer_phone}</p><p className="muted">Placed: {new Date(o.created_at).toLocaleString()}</p><p><b>Items:</b> {typeof o.items==='string'?o.items:JSON.stringify(o.items)}</p><p><b>Delivery:</b> {typeof o.address==='string'?o.address:JSON.stringify(o.address)}</p><p><b>Paystack transaction:</b> {o.provider_transaction_id||'Not yet reconciled'}</p>{o.fulfilment_method!=='pickup'&&<form className="editform" onSubmit={async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const response=await fetch('/api/admin',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:o.reference,tracking_update:true,trackingCarrier:data.get('trackingCarrier'),trackingCode:data.get('trackingCode'),trackingUrl:data.get('trackingUrl')})});const result=await response.json().catch(()=>({}));if(response.ok){setErr('Courier tracking details saved. Use Resend current status email to send the updated tracking link.');await load(true)}else setErr(result.error||'Tracking details could not be saved.')}}><b>Delivery tracking details</b><label>Delivery partner<input name="trackingCarrier" defaultValue={o.address&&typeof o.address==='object'?o.address.tracking_carrier||'':''} placeholder="Courier / delivery partner"/></label><label>Tracking number<input name="trackingCode" defaultValue={o.address&&typeof o.address==='object'?o.address.tracking_code||'':''} placeholder="Tracking or waybill number"/></label><label>Courier tracking link<input name="trackingUrl" type="url" defaultValue={o.address&&typeof o.address==='object'?o.address.tracking_url||'':''} placeholder="https://courier.example/track/..." /></label><button className="secondary">Save delivery tracking</button></form>}<p className="muted">{(o.history||[]).map((h:any)=>(h.status+' · '+new Date(h.created_at).toLocaleString()+(h.note?' — '+h.note:''))).join(' | ')}</p><p><b>Fulfilment method:</b> {o.fulfilment_method==='pickup'?'Self-pickup · no delivery fee':'Home delivery · fee ₦'+(Number((o.address&&typeof o.address==='object'?o.address.delivery_fee:0)||0)).toLocaleString()}</p><label>Fulfilment status<select value={o.fulfilment_status||'processing'} onChange={async e=>{const nextStatus=e.target.value;const r=await fetch('/api/admin',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:o.reference,fulfilment_status:nextStatus})});const data=await r.json().catch(()=>({}));if(r.ok){setOrders(prev=>prev.map(x=>x.reference===o.reference?{...x,fulfilment_status:nextStatus}:x));setErr(data.email_delivery_status==='not_configured'?'Order updated. Customer email is waiting for email-provider setup.':data.email_delivery_status==='failed'?'Order updated, but the customer email failed. You can retry it below.':'Order and notification status updated.')}else setErr(data.error||'Status update failed')}}>{(o.fulfilment_method==='pickup'?['processing','picked','packed','ready_for_pickup','collected','cancelled']:['processing','picked','packed','shipped','delivered','cancelled']).map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></label><button className="secondary" onClick={async()=>{const r=await fetch('/api/admin',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:o.reference,resend_notification:true})});const data=await r.json().catch(()=>({}));setErr(r.ok?'Notification retry: '+(data.email_delivery_status||'unknown')+(data.email_reason?' · '+data.email_reason:''):data.error||'Notification retry failed.');await load(true)}}>Resend current status email</button>{Array.isArray(o.email_events)&&o.email_events.length>0&&<p className="muted"><b>Email history:</b> {o.email_events.map((event:any)=>event.status+' — '+event.delivery_status+(event.sent_at?' at '+new Date(event.sent_at).toLocaleString():'')+(event.last_error?' ('+event.last_error+')':'')).join(' · ')}</p>}</article>)}<h2 id="products">Products ({products.length})</h2><button onClick={()=>setEditing({name:'',category:'Apparel',price:'',description:'',image:'',tag:'',sizes:['S','M','L','XL','XXL'],stock:0,is_active:false,galleryText:'',sizeStockText:'{}',productDetailsText:'{}'})}>＋ Add product</button>{products.map(p=><article key={p.id}><div className="product">{p.image&&<img src={p.image} alt={p.name}/>}<div><b>{p.name}</b><p>₦{Number(p.price).toLocaleString()} · Stock {p.stock}</p><p className="muted">{p.category} · {p.tag||''} · {p.is_active?'Published on shop':'Draft / hidden'}</p></div></div><p>{p.description}</p><button onClick={()=>setEditing({...p,file:null,galleryText:Array.isArray(p.gallery)?p.gallery.join('\n'):'',sizeStockText:JSON.stringify(p.size_stock||{},null,2),productDetailsText:JSON.stringify(p.product_details||{},null,2)})}>Edit</button><button className="secondary" onClick={async()=>{if(confirm('Hide this product from the shop?')){const r=await fetch('/api/products',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id})});if(r.ok)loadProducts();else{const d=await r.json();setErr(d.error||'Product archive failed')}}}}>Hide</button></article>)}<h2 id="content">Website news ({news.length})</h2>
<button onClick={()=>setNewsEditing({title:'',content:'',image:'',preview:'',published:true})}>＋ Add news</button>
{news.map((item:any)=><article key={item.id}>
 {item.image ? <img src={item.image} alt="" style={{width:'100%',maxWidth:360,maxHeight:210,objectFit:'cover',borderRadius:8}}/> : null}
 <b>{item.title}</b><p>{item.content}</p><p className="muted">{item.published?'Published':'Draft'}</p>
 <button onClick={()=>editNewsItem(item)}>Edit</button>
 <button className="secondary" onClick={()=>void deleteNewsItem(item.id)}>Delete</button>
</article>)}
{newsEditing ? <form className="editform" onSubmit={saveNews}>
 <h3>{newsEditing.id?'Edit':'Add'} news</h3>
 <label>Headline<input required value={newsEditing.title||''} onChange={e=>setNewsEditing({...newsEditing,title:e.target.value})}/></label>
 <label>News content<textarea required rows={5} value={newsEditing.content||''} onChange={e=>setNewsEditing({...newsEditing,content:e.target.value})}/></label>
 <label>Upload news photo from this device<input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectNewsPhoto}/></label>
 {newsEditing.preview||newsEditing.image ? <div>
  <p className="muted">Photo preview</p>
  <img src={newsEditing.preview||newsEditing.image} alt="News photo preview" style={{width:'100%',maxWidth:420,maxHeight:260,objectFit:'contain',background:'#f1eee7',borderRadius:8}}/>
  <button type="button" className="secondary" onClick={()=>setNewsEditing({...newsEditing,image:'',preview:''})}>Remove photo</button>
 </div> : null}
 <p className="muted">Choose a photo from your phone or tablet. Ebnimaam compresses and uploads the image; no photo link is needed.</p>
 <label><input style={{width:'auto'}} type="checkbox" checked={newsEditing.published!==false} onChange={e=>setNewsEditing({...newsEditing,published:e.target.checked})}/> Publish on website</label>
 <button type="submit">Save news</button><button type="button" className="secondary" onClick={()=>setNewsEditing(null)}>Cancel</button>
</form> : null}{editing&&<form className="editform" onSubmit={saveProduct}><h3>{editing.id?'Edit':'Add'} product</h3>{['name','category','price','description','tag','stock'].map(k=><label key={k}>{k==='price'?'Price (whole naira)':k}<input type={k==='price'||k==='stock'?'number':'text'} min={k==='price'?1:k==='stock'?0:undefined} value={editing[k]??''} onChange={e=>setEditing({...editing,[k]:e.target.value})}/></label>)}<label>Sizes / variants (comma-separated)<input value={Array.isArray(editing.sizes)?editing.sizes.join(', '):'One Size'} onChange={e=>setEditing({...editing,sizes:e.target.value.split(',').map((s:string)=>s.trim()).filter(Boolean)})}/></label><label><input style={{width:'auto'}} type="checkbox" checked={editing.is_active===true} onChange={e=>setEditing({...editing,is_active:e.target.checked})}/> Publish this product on the storefront</label><label>Picture upload (max 5 MB)<input type="file" accept="image/*" onChange={e=>setEditing({...editing,file:e.target.files?.[0]})}/></label><label>Or image URL<input value={editing.image||''} onChange={e=>setEditing({...editing,image:e.target.value})}/></label><label>Additional product photos · one image URL per line<textarea rows={4} placeholder="https://…/back-view.jpg" value={editing.galleryText||''} onChange={e=>setEditing({...editing,galleryText:e.target.value})}/></label><label>Stock by size · JSON object<textarea rows={3} value={editing.sizeStockText||'{}'} onChange={e=>setEditing({...editing,sizeStockText:e.target.value})}/></label><label>Fit details, colour options and size chart · JSON<textarea rows={7} placeholder="JSON object with modelHeight, modelSize, fit, fabric, care, colors and sizeChart fields" value={editing.productDetailsText||'{}'} onChange={e=>setEditing({...editing,productDetailsText:e.target.value})}/></label><button>Save product</button><button type="button" className="secondary" onClick={()=>setEditing(null)}>Cancel</button></form>}{err&&<p role="alert" style={{color:'#b91c1c',marginTop:16}}>{err}</p>}</>}</div></main>}
