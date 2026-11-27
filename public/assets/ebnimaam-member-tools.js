(function () {
  "use strict";
  if (window.__ebnimaamMemberTools) return;
  window.__ebnimaamMemberTools = true;
  var root = null, loaded = false, state = null;
  function node(tag, text, cls) {
    var el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = String(text);
    if (cls) el.className = cls;
    return el;
  }
  function money(kobo) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format((Number(kobo) || 0) / 100);
  }
  async function request(action, extra) {
    var response = await fetch("/api/loyalty", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, extra || {}))
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }
  function status(text, parent) {
    var el = node("p", text, "eb-member-status");
    parent.appendChild(el);
    return el;
  }
  function field(labelText, placeholder, type, parent, name) {
    var wrap = node("label", null, "eb-member-field");
    wrap.appendChild(node("span", labelText));
    var input = node("input");
    input.type = type || "text";
    input.placeholder = placeholder || "";
    input.name = name || "";
    input.required = true;
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }
  function button(text, parent, callback) {
    var b = node("button", text, "eb-member-button");
    b.type = "button";
    b.addEventListener("click", callback);
    parent.appendChild(b);
    return b;
  }
  async function refresh() {
    var response = await fetch("/api/loyalty", { credentials: "same-origin", cache: "no-store" });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      if (response.status === 401) { loaded = false; if (root) root.remove(); root = null; return; }
      throw new Error(data.error || "Rewards are temporarily unavailable.");
    }
    state = data;
    render();
  }
  function card(title, description) {
    var section = node("section", null, "eb-member-card");
    section.appendChild(node("h3", title));
    if (description) section.appendChild(node("p", description, "eb-member-muted"));
    root.appendChild(section);
    return section;
  }
  function render() {
    if (!root || !state) return;
    root.replaceChildren();
    root.appendChild(node("h2", "Ebnimaam Balance & Rewards"));
    var wallet = state.wallet || {};
    var walletCard = card("Your Ebnimaam balance", "Credits and approved refund balances are stored securely in your account. Bank refunds require owner review.");
    walletCard.appendChild(node("strong", money(wallet.balance_kobo), "eb-member-balance"));
    if (Array.isArray(wallet.rows) && wallet.rows.length) {
      var ledger = node("div", null, "eb-member-ledger");
      wallet.rows.slice(0, 8).forEach(function (item) {
        var row = node("div", null, "eb-member-ledger-row");
        row.appendChild(node("span", (item.description || item.entry_type) + " · " + (item.status || "")));
        row.appendChild(node("b", (Number(item.amount_kobo) < 0 ? "−" : "+") + money(Math.abs(Number(item.amount_kobo || 0)))));
        ledger.appendChild(row);
      });
      walletCard.appendChild(ledger);
    }
    var refund = card("Request a bank refund", "This reserves the amount from your Ebnimaam balance. The store team must review the request and manually make the bank transfer.");
    var refundForm = node("form", null, "eb-member-form");
    var amount = field("Amount in naira", "e.g. 5000", "number", refundForm, "amountNaira"); amount.min = "100"; amount.step = "1";
    var bank = field("Bank name", "Your bank", "text", refundForm, "bankName");
    var accName = field("Account name", "Name on bank account", "text", refundForm, "accountName");
    var accNo = field("10-digit account number", "0123456789", "text", refundForm, "accountNumber"); accNo.inputMode = "numeric"; accNo.maxLength = 10;
    var submitRefund = node("button", "Request bank refund", "eb-member-button"); submitRefund.type = "submit"; refundForm.appendChild(submitRefund);
    var refundStatus = status("", refund);
    refundForm.addEventListener("submit", async function (event) {
      event.preventDefault(); submitRefund.disabled = true; refundStatus.textContent = "Submitting request…";
      try {
        var result = await request("request_bank_refund", { amountNaira: Number(amount.value), bankName: bank.value, accountName: accName.value, accountNumber: accNo.value });
        refundStatus.textContent = result.message; refundForm.reset(); await refresh();
      } catch (error) { refundStatus.textContent = error.message; }
      finally { submitRefund.disabled = false; }
    });
    refund.appendChild(refundForm);

    var referral = state.referral || {};
    var refCard = card("Invite five friends", "Your referred friends must each make a successful paid purchase before the referral rewards are released.");
    refCard.appendChild(node("p", "Your referral code: " + (referral.code || "Loading"), "eb-member-code"));
    button("Copy referral code", refCard, async function () {
      try { await navigator.clipboard.writeText(String(referral.code || "")); this.textContent = "Copied"; }
      catch { status("Your code is " + referral.code + ". Copy it from the text above.", refCard); }
    });
    refCard.appendChild(node("p", "Completed purchases: " + Number(referral.qualified || 0) + " / 5 · Waiting: " + Number(referral.pending || 0), "eb-member-muted"));
    refCard.appendChild(node("p", "Reward amounts are set by the Ebnimaam owner. No reward is credited before a real Paystack payment is confirmed.", "eb-member-muted"));
    var apply = node("form", null, "eb-member-form");
    var codeInput = field("Have a referral code?", "Enter code before your first paid order", "text", apply, "code");
    var applyBtn = node("button", "Apply referral code", "eb-member-button"); applyBtn.type = "submit"; apply.appendChild(applyBtn);
    var applyStatus = status("", refCard);
    apply.addEventListener("submit", async function (event) {
      event.preventDefault(); applyBtn.disabled = true; applyStatus.textContent = "Applying code…";
      try { var result = await request("apply_referral", { code: codeInput.value }); applyStatus.textContent = result.message; await refresh(); }
      catch (error) { applyStatus.textContent = error.message; }
      finally { applyBtn.disabled = false; }
    });
    refCard.appendChild(apply);

    var challenge = state.challenge || {}, def = challenge.definition || {}, team = challenge.team;
    var chCard = card(def.title || "Team challenge", def.description || "Complete the challenge milestones with your team.");
    if (!team) {
      var createBtn = button("Create a team", chCard, async function () {
        createBtn.disabled = true;
        try { await request("create_team"); await refresh(); }
        catch (error) { status(error.message, chCard); createBtn.disabled = false; }
      });
      var joinForm = node("form", null, "eb-member-form");
      var invite = field("Join a team", "Enter the team invitation code", "text", joinForm, "inviteCode");
      var joinBtn = node("button", "Join team", "eb-member-button"); joinBtn.type = "submit"; joinForm.appendChild(joinBtn);
      var joinStatus = status("", chCard);
      joinForm.addEventListener("submit", async function (event) {
        event.preventDefault(); joinBtn.disabled = true; joinStatus.textContent = "Joining…";
        try { var result = await request("join_team", { inviteCode: invite.value }); joinStatus.textContent = result.message; await refresh(); }
        catch (error) { joinStatus.textContent = error.message; }
        finally { joinBtn.disabled = false; }
      });
      chCard.appendChild(joinForm);
    } else {
      chCard.appendChild(node("p", "Team invitation code: " + team.invite_code, "eb-member-code"));
      chCard.appendChild(node("p", "Team members: " + Number(team.member_count || 0) + " / " + Number(def.maxTeamSize || 5) + " · Started: " + new Date(team.created_at).toLocaleDateString(), "eb-member-muted"));
      var submissions = Array.isArray(team.submissions) ? team.submissions : [];
      var milestones = node("ol", null, "eb-member-milestones");
      (def.milestones || []).forEach(function (milestone, index) {
        var day = index + 1;
        var found = submissions.find(function (s) { return Number(s.day_number) === day; });
        milestones.appendChild(node("li", milestone + (found ? " — " + found.status : " — Not submitted")));
        if (found && found.admin_note) milestones.appendChild(node("p", "Owner note: " + found.admin_note, "eb-member-muted"));
      });
      chCard.appendChild(milestones);
      button("Add challenge milestones to calendar", chCard, function () {
        function icalEscape(value) { return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
        function stamp(date) { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
        var events = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Ebnimaam//Seven Day Team Quest//EN","CALSCALE:GREGORIAN"];
        var base = new Date(team.created_at);
        (def.milestones || []).forEach(function (milestone, index) {
          var start = new Date(base.getTime()); start.setUTCDate(start.getUTCDate() + index); start.setUTCHours(8,0,0,0);
          var finish = new Date(start.getTime() + 60 * 60 * 1000);
          events.push("BEGIN:VEVENT","UID:ebnimaam-" + String(team.id) + "-day-" + (index + 1) + "@ebnimaam","DTSTAMP:" + stamp(new Date()),"DTSTART:" + stamp(start),"DTEND:" + stamp(finish),"SUMMARY:" + icalEscape("Ebnimaam team challenge · Day " + (index + 1)),"DESCRIPTION:" + icalEscape(milestone),"END:VEVENT");
        });
        events.push("END:VCALENDAR");
        var blob = new Blob([events.join("\r\n")], { type: "text/calendar;charset=utf-8" });
        var url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = "ebnimaam-seven-day-team-quest.ics"; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
      });

      var evidenceForm = node("form", null, "eb-member-form");
      var dayWrap = node("label", null, "eb-member-field"); dayWrap.appendChild(node("span", "Milestone day"));
      var daySelect = node("select"); daySelect.required = true;
      for (var i = 1; i <= 7; i++) { var opt = node("option", "Day " + i); opt.value = String(i); daySelect.appendChild(opt); }
      dayWrap.appendChild(daySelect); evidenceForm.appendChild(dayWrap);
      var evidence = node("label", null, "eb-member-field"); evidence.appendChild(node("span", "Team evidence / work summary (minimum 40 characters)"));
      var textarea = node("textarea"); textarea.required = true; textarea.minLength = 40; textarea.maxLength = 3000; textarea.rows = 4; textarea.placeholder = "Describe the work completed and evidence for this milestone…"; evidence.appendChild(textarea); evidenceForm.appendChild(evidence);
      var evidenceBtn = node("button", "Submit milestone for review", "eb-member-button"); evidenceBtn.type = "submit"; evidenceForm.appendChild(evidenceBtn);
      var evidenceStatus = status("", chCard);
      evidenceForm.addEventListener("submit", async function (event) {
        event.preventDefault(); evidenceBtn.disabled = true; evidenceStatus.textContent = "Submitting…";
        try { var result = await request("submit_milestone", { day: Number(daySelect.value), evidence: textarea.value }); evidenceStatus.textContent = result.message; await refresh(); }
        catch (error) { evidenceStatus.textContent = error.message; }
        finally { evidenceBtn.disabled = false; }
      });
      chCard.appendChild(evidenceForm);
    }
    chCard.appendChild(node("p", "Rewards are credited only after the owner approves all seven milestone submissions and configures the challenge reward. No reward is guaranteed before verification.", "eb-member-muted"));
  }
  async function init() {
    var account = document.getElementById("accountCard");
    if (!account || account.classList.contains("hide") || !document.body.contains(account)) return;
    if (!root) {
      root = node("div", null, "eb-member-tools");
      account.appendChild(root);
    }
    try { await refresh(); loaded = true; }
    catch (error) { root.replaceChildren(node("h2", "Ebnimaam Balance & Rewards"), node("p", error.message, "eb-member-muted")); }
  }
  function watch() {
    var account = document.getElementById("accountCard");
    if (!account) return;
    var observer = new MutationObserver(function () {
      if (account.classList.contains("hide")) { loaded = false; if (root) { root.remove(); root = null; } return; }
      if (!loaded) init();
    });
    observer.observe(account, { attributes: true, attributeFilter: ["class"] });
    if (!account.classList.contains("hide")) init();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch, { once: true });
  else watch();
})();
