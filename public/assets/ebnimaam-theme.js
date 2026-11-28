(function(){
"use strict";
if(window.__ebnimaamThemeLoaded)return;
window.__ebnimaamThemeLoaded=true;
fetch('/api/store-settings',{cache:'no-store',credentials:'same-origin'})
.then(function(response){if(!response.ok)throw new Error('Theme settings unavailable');return response.json()})
.then(function(data){
 var theme=data&&data.settings&&data.settings.theme||{};
 var root=document.documentElement;
 var variables={navy:'--navy',navy2:'--navy2',gold:'--gold',cream:'--cream',paper:'--paper',ink:'--ink'};
 Object.keys(variables).forEach(function(key){
  var value=String(theme[key]||'');
  if(/^#[0-9a-f]{6}$/i.test(value))root.style.setProperty(variables[key],value);
 });
 if(theme.cream)root.style.setProperty('--soft',theme.cream);
 var meta=document.querySelector('meta[name="theme-color"]');
 if(meta&&/^#[0-9a-f]{6}$/i.test(String(theme.navy||'')))meta.setAttribute('content',theme.navy);
})
.catch(function(){});
})();