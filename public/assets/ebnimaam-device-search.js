(function () {
  "use strict";
  if (window.__ebnimaamDeviceSearch) return;
  window.__ebnimaamDeviceSearch = true;
  function build() {
    var search = document.getElementById("search");
    if (!search || !search.parentElement || document.getElementById("ebDeviceSearch")) return;
    var bar = document.createElement("div");
    bar.id = "ebDeviceSearch";
    bar.className = "eb-device-search";
    var camera = document.createElement("button");
    camera.type = "button"; camera.textContent = "▣ Take photo"; camera.setAttribute("aria-label", "Search products using a camera photo");
    var voice = document.createElement("button");
    voice.type = "button"; voice.textContent = "🎙 Voice"; voice.setAttribute("aria-label", "Search products using your voice");
    var file = document.createElement("input");
    file.type = "file"; file.accept = "image/jpeg,image/png,image/webp"; file.capture = "environment"; file.hidden = true; file.tabIndex = -1;
    var note = document.createElement("p"); note.className = "eb-device-search-note"; note.setAttribute("role", "status"); note.setAttribute("aria-live", "polite");
    bar.appendChild(camera); bar.appendChild(voice); bar.appendChild(file); bar.appendChild(note);
    search.parentElement.appendChild(bar);
    camera.addEventListener("click", function () { file.click(); });
    file.addEventListener("change", async function () {
      var selected = file.files && file.files[0]; if (!selected) return;
      if (!/^image\/(jpeg|png|webp)$/.test(selected.type)) { note.textContent = "Choose a JPG, PNG or WebP photo."; file.value = ""; return; }
      if (selected.size > 8 * 1024 * 1024) { note.textContent = "Choose a photo smaller than 8 MB."; file.value = ""; return; }
      camera.disabled = true; note.textContent = "Preparing your photo…";
      try {
        var src = await new Promise(function (resolve, reject) {
          var reader = new FileReader(); reader.onload = function () { resolve(String(reader.result)); }; reader.onerror = reject; reader.readAsDataURL(selected);
        });
        var img = await new Promise(function (resolve, reject) {
          var image = new Image(); image.onload = function () { resolve(image); }; image.onerror = reject; image.src = src;
        });
        var scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
        var ctx = canvas.getContext("2d"); if (!ctx) throw new Error("This browser could not prepare the photo.");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var data = canvas.toDataURL("image/jpeg", 0.78);
        if (data.length > 5_500_000) data = canvas.toDataURL("image/jpeg", 0.58);
        note.textContent = "Looking for similar products…";
        var response = await fetch("/api/visual-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: data }) });
        var result = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(result.error || "Image search failed.");
        search.value = result.query || "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        note.textContent = "Showing products matching: " + search.value;
      } catch (error) { note.textContent = error.message || "Image search failed. Try another photo."; }
      finally { camera.disabled = false; file.value = ""; }
    });
    var Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { voice.disabled = true; voice.title = "Voice search is not supported in this browser."; }
    else {
      var recognition = null, listening = false;
      voice.addEventListener("click", function () {
        if (listening && recognition) { recognition.stop(); return; }
        recognition = new Speech(); recognition.lang = "en-NG"; recognition.interimResults = false; recognition.maxAlternatives = 1;
        recognition.onstart = function () { listening = true; voice.textContent = "■ Stop"; note.textContent = "Listening… Speak your product search."; };
        recognition.onresult = function (event) {
          var transcript = event.results && event.results[0] && event.results[0][0] ? String(event.results[0][0].transcript || "").trim() : "";
          if (transcript) { search.value = transcript; search.dispatchEvent(new Event("input", { bubbles: true })); note.textContent = "Voice search: " + transcript; }
        };
        recognition.onerror = function (event) { note.textContent = event.error === "not-allowed" ? "Microphone permission was denied. You can still type to search." : "Voice search could not start. Please type your search."; };
        recognition.onend = function () { listening = false; voice.textContent = "🎙 Voice"; };
        try { recognition.start(); } catch { note.textContent = "Voice search could not start. Please try again."; }
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build, { once: true }); else build();
})();
