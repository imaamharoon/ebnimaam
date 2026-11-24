FRONTEND CONNECTION NOTES

1. Copy your supplied storefront HTML into this folder as public/index.html.
2. Do not put the Paystack Secret Key in the HTML.
3. Replace the old window.placeOrder = (...) => { ...fake Paid order... } function with the secure function shown below.
4. Add the tracking function below in place of the old browser-only trackOrder function.

REPLACE placeOrder WITH:

window.placeOrder = async () => {
  if (!state.checkout.agreed) return alert("Please agree to the Terms and Privacy Policy.");
  if (!state.cart.length) return alert("Your cart is empty.");
  const c = state.checkout;
  if (!c.name.trim() || !c.phone.trim() || !c.email.trim() || !c.city.trim() || !c.street.trim()) {
    return alert("Please complete your name, phone, email and delivery address.");
  }
  const button = document.querySelector('button[onclick^="placeOrder"]');
  if (button) { button.disabled = true; button.textContent = "Connecting to Paystack…"; }
  try {
    const response = await fetch("/api/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: { name: c.name, phone: c.phone, email: c.email },
        address: { country: c.country, state: c.state, city: c.city, street: c.street, postal: c.postal },
        items: state.cart.map(i => ({ productId: i.productId, size: i.size, qty: i.qty })),
        promoCode: c.promoCode
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start payment.");
    location.href = data.authorization_url;
  } catch (error) {
    alert(error.message);
    if (button) { button.disabled = false; button.textContent = "Pay with Paystack"; }
  }
};

REPLACE the checkout button's current onclick with:
onclick="placeOrder()"

REPLACE trackOrder WITH:

window.trackOrder = async () => {
  const reference = (document.getElementById("trackRef")?.value || "").trim();
  const email = (document.getElementById("trackEmail")?.value || "").trim();
  try {
    const response = await fetch("/api/track-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference, email })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Order not found.");
    state.track.result = {
      ref: data.order.reference,
      total: data.order.total,
      status: data.order.paymentStatus + " / " + data.order.fulfilmentStatus
    };
    state.track.error = "";
  } catch (error) {
    state.track.result = null;
    state.track.error = error.message;
  }
  render();
};

Also update the track-order explanatory copy to say "Enter your order reference and email".

IMPORTANT:
- The browser-side total is for display only. The API recalculates prices and delivery charges from its own product catalogue.
- The sample EBN10 promotion is calculated by the server as 10% off the products subtotal.
- The product stock quantities in the original HTML are only a display prototype; real stock reservation and admin management still need a database-backed admin system.
- Do not make the admin preview publicly accessible as a real admin panel. It has no login and must be replaced with authenticated admin access before launch.
- Review shipping/returns/privacy text and delivery estimates before publishing.

BRAND ASSET
- Your supplied brand logo is saved at /assets/ebnimaam-logo.webp.
- Use this asset in the storefront header, footer, favicon/app icon where appropriate.

PAYSTACK KEYS
- Set PAYSTACK_SECRET_KEY as a private Vercel environment variable. The server API uses it to initialize and verify payments.
- PAYSTACK_PUBLIC_KEY is a publishable key. It is not a substitute for the secret key used by the server API.
- Never commit your secret key to GitHub or place it in browser JavaScript.
- Before launch, test the complete payment flow and webhook using Paystack test keys, then switch both keys to live mode.
