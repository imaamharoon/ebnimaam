(function(){
"use strict";
if(window.__ebnimaamRecommendations)return;window.__ebnimaamRecommendations=true;
function el(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n}
function money(v){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(Number(v)||0)}
async function load(){
 var productId=new URLSearchParams(location.search).get("id");var anchor=document.getElementById("fitReviews");if(!productId||!anchor||document.getElementById("ebRecommended"))return;
 try{
  var response=await fetch("/api/recommendations?productId="+encodeURIComponent(productId),{cache:"no-store"});var data=await response.json();if(!response.ok)throw new Error();
  var products=Array.isArray(data.products)?data.products:[];if(!products.length)return;
  var section=el("section",null,"recommend-section");section.id="ebRecommended";
  section.appendChild(el("div","You may also like","eyebrow"));section.appendChild(el("h2","More from Ebnimaam","section-heading"));
  var grid=el("div",null,"recommend-grid");
  products.forEach(function(product){
   var link=el("a",null,"recommend-card");link.href="/product.html?id="+encodeURIComponent(product.id);
   var image=el("img");image.loading="lazy";image.alt=String(product.name||"Ebnimaam product");image.src=String(product.image||"/assets/ebnimaam-logo.webp");
   var info=el("div",null,"recommend-info");info.appendChild(el("small",product.category||"Ebnimaam collection"));
   info.appendChild(el("b",product.name||"Explore product"));info.appendChild(el("span",money(product.price)));
   link.appendChild(image);link.appendChild(info);grid.appendChild(link);
  });
  section.appendChild(grid);anchor.parentNode.insertBefore(section,anchor);
 }catch{}
}
var target=document.getElementById("productApp");
if(target){var observer=new MutationObserver(function(){if(!target.hidden)load()});observer.observe(target,{attributes:true,attributeFilter:["hidden"]});if(!target.hidden)load()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",load,{once:true});else load();
})();
