(function(){
"use strict";
if(window.__ebnimaamCheckoutWallet)return;window.__ebnimaamCheckoutWallet=true;
function money(kobo){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format((Number(kobo)||0)/100)}
async function refresh(){
 var checkbox=document.querySelector('#checkoutForm input[name="useWalletBalance"]'),note=document.getElementById("walletCheckoutInfo");
 if(!checkbox||!note)return;
 checkbox.disabled=true;note.textContent="Checking your Ebnimaam balance…";
 try{
  var response=await fetch("/api/loyalty",{credentials:"same-origin",cache:"no-store"}),data=await response.json().catch(function(){return{}});
  if(response.status===401){note.textContent="Sign in to your verified Ebnimaam account to use your balance.";return}
  if(!response.ok)throw new Error(data.error||"Balance is temporarily unavailable.");
  var available=Number(data.wallet&&data.wallet.balance_kobo||0);
  note.textContent="Available Ebnimaam balance: "+money(available)+". The checkout keeps at least ₦100 for Paystack payment.";
  checkbox.disabled=available<=0;
  if(available<=0)checkbox.checked=false;
 }catch(error){note.textContent=error.message||"Could not load your Ebnimaam balance."}
}
function watch(){
 var overlay=document.getElementById("checkoutOverlay");if(!overlay)return;
 var observer=new MutationObserver(function(){if(overlay.classList.contains("open"))refresh()});
 observer.observe(overlay,{attributes:true,attributeFilter:["class"]});
 if(overlay.classList.contains("open"))refresh();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",watch,{once:true});else watch();
})();
