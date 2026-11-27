(function(){
"use strict";
if(window.__ebnimaamWishlistSync)return;window.__ebnimaamWishlistSync=true;
var syncTimer=null,saving=false,ready=false;
function readLocal(){try{var v=JSON.parse(localStorage.getItem("ebnimaam_wishlist")||"[]");return Array.isArray(v)?Array.from(new Set(v.map(String))).slice(0,200):[]}catch{return[]}}
async function push(){
 if(!ready||saving)return;saving=true;
 try{await fetch("/api/wishlist",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({productIds:readLocal()})})}catch{}
 finally{saving=false}
}
function schedule(){if(syncTimer)clearTimeout(syncTimer);syncTimer=setTimeout(push,500)}
async function init(){
 try{
  var response=await fetch("/api/wishlist",{credentials:"same-origin",cache:"no-store"});
  if(response.status===401)return;
  var data=await response.json();if(!response.ok)return;
  var merged=Array.from(new Set(readLocal().concat((data.productIds||[]).map(String)))).slice(0,200);
  ready=true;
  localStorage.setItem("ebnimaam_wishlist",JSON.stringify(merged));
  if(typeof window.updateSavedCount==="function")window.updateSavedCount();
  if(typeof window.renderProducts==="function")window.renderProducts();
  await push();
 }catch{}
}
var original=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){
 var result=original.apply(this,arguments);
 if(key==="ebnimaam_wishlist")schedule();
 return result;
};
window.addEventListener("message",function(event){if(event.origin===location.origin&&event.data&&event.data.type==="ebnimaam-account-authenticated"){ready=false;init()}});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
