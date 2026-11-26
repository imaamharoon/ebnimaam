(function(){
"use strict";
if(window.__ebnimaamChatLoaded)return;window.__ebnimaamChatLoaded=true;
function create(tag,attrs,content){var node=document.createElement(tag);Object.keys(attrs||{}).forEach(function(key){if(key==="className")node.className=attrs[key];else node.setAttribute(key,attrs[key])});if(content!==undefined)node.textContent=content;return node}
function boot(){
 if(!document.body||document.getElementById("ebChatBox"))return;
 var launcher=create("button",{type:"button",id:"ebChatOpen",className:"eb-chat-launcher","aria-label":"Open ebnimaam support chat"});
 launcher.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3A7.5 7.5 0 1 1 20 11.5Z"></path><path d="M8.5 11.5h7M8.5 14.5h4"></path></svg><span>Ask ebnimaam</span>';
 var box=create("section",{id:"ebChatBox",className:"eb-chat-box","aria-label":"ebnimaam support chat","aria-live":"polite"});
 box.innerHTML='<div class="eb-chat-header"><div><h3>ebnimaam Support</h3><p>Help with sizing, delivery and orders</p></div><button type="button" class="eb-chat-close" id="ebChatClose" aria-label="Close chat">×</button></div><div class="eb-chat-messages" id="ebChatMessages"><div class="eb-msg bot">Assalamu alaikum. Need help choosing a size, checking delivery or paying? Ask us below.</div></div><div class="eb-chat-quick" id="ebChatQuick"><button type="button" class="eb-chat-chip" data-q="How do I choose my size?">Size help</button><button type="button" class="eb-chat-chip" data-q="How long does delivery take?">Delivery time</button><button type="button" class="eb-chat-chip" data-q="Which payment methods do you accept?">Payment options</button></div><div class="eb-chat-human"><span>Need a team member?</span><a class="eb-chat-wa" id="ebChatWhatsApp" href="#" target="_blank" rel="noopener noreferrer" hidden>Chat on WhatsApp</a></div><div class="eb-chat-status" id="ebChatStatus">Quick answers are available. Share only the details needed for your question.</div><form class="eb-chat-form" id="ebChatForm"><input class="eb-chat-input" id="ebChatInput" maxlength="500" placeholder="Type your question…" autocomplete="off" required><button class="eb-chat-send" id="ebChatSend" type="submit">Send</button></form>';
 document.body.appendChild(launcher);document.body.appendChild(box);
 var open=launcher,close=box.querySelector("#ebChatClose"),messages=box.querySelector("#ebChatMessages"),form=box.querySelector("#ebChatForm"),input=box.querySelector("#ebChatInput"),send=box.querySelector("#ebChatSend"),history=[];
 function append(role,text){var el=create("div",{className:"eb-msg "+(role==="user"?"user":"bot")});el.textContent=text;messages.appendChild(el);messages.scrollTop=messages.scrollHeight;return el}
 function show(){box.classList.add("open");open.hidden=true;input.focus()}
 function hide(){box.classList.remove("open");open.hidden=false;open.focus()}
 open.addEventListener("click",show);close.addEventListener("click",hide);
 document.addEventListener("keydown",function(event){if(event.key==="Escape"&&box.classList.contains("open"))hide()});
 async function ask(value){
  var clean=String(value||"").trim().slice(0,500);if(!clean||send.disabled)return;
  append("user",clean);history.push({role:"user",text:clean});history=history.slice(-6);input.value="";send.disabled=true;
  var pending=append("assistant","One moment…");
  try{
   var response=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:history})});
   var data=await response.json();if(!response.ok)throw new Error(data.error||"Support is temporarily unavailable.");
   pending.textContent=data.reply||"Please use WhatsApp below for help from the team.";history.push({role:"assistant",text:pending.textContent});history=history.slice(-6);
   var status=box.querySelector("#ebChatStatus");if(data.mode==="quick-help")status.textContent="Instant store answers · Detailed AI chat is being connected.";else status.textContent="Ebnimaam support assistant";
  }catch(error){pending.textContent="I couldn't reach support just now. Please use WhatsApp below to speak to the team."}
  finally{send.disabled=false;messages.scrollTop=messages.scrollHeight}
 }
 form.addEventListener("submit",function(event){event.preventDefault();ask(input.value)});
 box.querySelectorAll("[data-q]").forEach(function(chip){chip.addEventListener("click",function(){ask(chip.getAttribute("data-q"))})});
 fetch("/api/store-settings",{cache:"no-store"}).then(function(r){return r.json()}).then(function(data){
  var phone=String(data.settings&&data.settings.supportPhone||"").replace(/\D/g,"");if(!phone)return;
  if(phone.charAt(0)==="0")phone="234"+phone.slice(1);else if(phone.slice(0,3)!=="234")phone="234"+phone;
  var link=box.querySelector("#ebChatWhatsApp");link.href="https://wa.me/"+phone+"?text="+encodeURIComponent("Hello ebnimaam, I need help with a product or order.");link.hidden=false;
 }).catch(function(){});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();