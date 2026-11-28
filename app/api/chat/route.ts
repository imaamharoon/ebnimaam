import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rate-limit';
import { Pool } from 'pg';
import { ensureLoyaltySchema, getVerifiedCustomer, walletAvailable } from '../../../lib/loyalty';
import { ensureCouponsSchema } from '../../../lib/coupons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
function safeJson(value:any){if(value&&typeof value==='object')return value;try{return JSON.parse(String(value||'{}'))}catch{return {}}}

const STORE_INSTRUCTIONS = [
  'You are Ebnimaam AI, the friendly website-wide shopping, product-discovery and customer-support guide for Ebnimaam, a Nigeria-only online store.',
  'Answer about every customer-facing area of the website and mobile application: catalogue and categories, current product prices and stock, images and product details, sizing and fit guides, reviews and product questions, search, camera/voice search, wishlist, comparison, cart, account creation, email OTP, password reset, passkeys/Face ID/fingerprint, one-active-device security, checkout, Paystack, Nigeria delivery and self-pickup, delivery prices, order tracking, fulfilment, returns/refunds, wallet balance, referral rewards, daily game, team challenges, coupons, news, policies, PWA/app installation, device notifications and customer support.',
  'Use the live website context supplied below. It is the source of truth for product names, current prices, stock, variants, store contacts, fees, policies, coupons, news, challenges and the signed-in customer data. If a value is missing, say you cannot verify it; never invent products, offers, prices, stock, deadlines, shipping fees, order history, balances or policy terms.',
  'Be proactive and navigational: explain how to use the relevant feature step by step, give the exact page path where useful, and distinguish features that are live from those that require the customer to sign in or the owner to configure a provider.',
  'Account security: Ebnimaam requires a verified email account. The one-active-device session policy means signing in on a new device invalidates the previous device session. A passkey, when saved and supported by the browser/device, can use Face ID, fingerprint or the device screen lock; never promise that every device supports it.',
  'Notifications: push alerts require browser permission, a service worker and the store owner to configure server-side VAPID keys. Never state push is active unless live context says it is configured.',
  'The customer assistant is read-only. It cannot place an order, change an order, initiate or approve a refund, change a wallet balance, approve a challenge, issue a coupon or edit store settings. Direct customers to their account, checkout, rewards page or human support for actions requiring authorization.',
  'Security and privacy: only discuss the order, support, wallet and referral information shown for the currently authenticated customer. Never reveal another person’s orders, profile, bank details, support conversations or referral activity. Do not request passwords, OTP codes, card details, bank PINs or full payment credentials.',
  'Payments use Paystack only. Never ask a customer to send money to a personal account. Never claim a payment is complete until Paystack verification confirms it.',
  'Refund credits remain in the Ebnimaam wallet until a bank refund is requested and manually processed by the owner. Referral/game rewards are store credit only and cannot be withdrawn or transferred.',
  'The referral programme gives the configured store credit for each different referred customer who completes a verified first paid order, currently capped at five qualifying purchases. The daily challenge reward is credited only after the server verifies a correct answer and only once per Africa/Lagos day. Team challenge rewards require every member to complete milestones and owner approval.',
  'Camera and microphone are used only after the customer taps the corresponding photo-search or voice-search controls. Do not imply continuous recording. WhatsApp is a customer-initiated support link only; do not claim the website sends automated WhatsApp or SMS messages.',
  'Never provide owner/admin credentials, private environment variables, internal security secrets or another customer’s private data. Admin tools are restricted to authorized owners.',
  'The public mobile store presents live products in category shortcuts, featured collection cards, a rewards banner and a mobile navigation bar. The app can be installed from the storefront when browser/Android installation support is available.',
].join('\n');

function quickReply(question: string, context: any = {}) {
  const q = question.toLowerCase();
  const products: any[] = Array.isArray(context.products) ? context.products : [];
  const matching = products.filter((product:any) => {
    const text = [product.name,product.category,product.tag,product.description].join(' ').toLowerCase();
    const terms = q.split(/[^a-z0-9]+/).filter((term:string)=>term.length>2);
    return terms.some((term:string)=>text.includes(term));
  }).slice(0,3);
  if (matching.length && /(product|price|stock|available|size|buy|item|show|find|cost)/.test(q)) {
    return matching.map((product:any)=>product.name+' ('+product.category+'): '+new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(Number(product.priceNaira||0))+'. Stock currently shown: '+Number(product.stock||0)+'. '+(product.sizes?.length?'Available sizes: '+product.sizes.join(', ')+'. ':'')+(product.description||'')).join('\n');
  }
  if (/(create account|sign.?up|register|new account|otp|verification code)/.test(q)) {
    return 'To create an Ebnimaam account, open /account.html, choose Create account, enter your name, email and password, complete the human check, then enter the email verification code. You need a verified account to check out. If the code does not arrive, check your spam folder and use Resend verification code.';
  }
  if (/(passkey|face id|faceid|fingerprint|biometric|device lock)/.test(q)) {
    return 'Sign in to /account.html, open Account security & passkeys, and choose Add a passkey to this device. If your browser and device support passkeys, your phone may ask for Face ID, fingerprint or its screen lock. You can then use Use passkey / Face ID on the sign-in screen. Password and email verification remain available.';
  }
  if (/(different device|two devices|multiple devices|one device|logged in elsewhere|sign.?out.*device)/.test(q)) {
    return 'Ebnimaam protects each account with one active device session. Signing in on another device replaces the previous device session. If the old device still shows your account, reload it and sign in again on the device you intend to use.';
  }
  if (/(notification|notify|push alert|alert.*phone|app notification)/.test(q)) {
    return 'To receive alerts, open your Ebnimaam account and choose Enable notifications on this device. Your browser must allow notifications and the store owner must configure the private push-delivery keys on the server. If that setup is not complete, push alerts will show as unavailable.';
  }
  if (/(pay|payment|card|bank|ussd|transfer|checkout)/.test(q)) {
    return 'To place an order, sign in with your verified Ebnimaam account, add available products to your bag, open checkout and enter your Nigerian delivery or pickup details. Pay securely through Paystack. Your order is confirmed only after Paystack verification.';
  }
  if (/(delivery|shipping|dispatch|arrive|how long|when.*come|delivery fee)/.test(q)) {
    const states=['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];
    const state=String(context.deliveryState||states.find((value:string)=>q.includes(value.toLowerCase()))||'').trim();
    const fees=context.deliveryFeesByState||{};
    const fee=state?fees[state]:fees.default;
    return 'Delivery is available in Nigeria. Select your state at checkout to see the configured delivery fee before you pay. '+(fee!==undefined&&fee!==null?'The current configured fee'+(state?' for '+state:' for other states')+' is ₦'+Number(fee).toLocaleString('en-NG')+'. ':'I cannot verify a saved price for that state from the current settings. ')+'Use /account.html to view the tracking updates attached to your own order. Delivery timing depends on the store’s configured rules and any courier tracking update.';
  }
  if (/(pickup|pick up|collect|collection)/.test(q)) {
    return context.pickupAddress
      ? 'Self-pickup is available when enabled at checkout. The current configured pickup address is '+context.pickupAddress+'. '+(context.pickupHours?'Pickup hours: '+context.pickupHours+'. ':'')+'Choose Pick up myself during checkout; a delivery fee is not charged for pickup.'
      : 'Self-pickup is available only when the owner has confirmed a current pickup address in store settings. Check the checkout options to see whether pickup is enabled for your order.';
  }
  if (/(return|exchange|refund|wrong size|damaged|faulty|incorrect item)/.test(q)) {
    return 'For an incorrect, damaged, faulty or unwanted item, open /returns.html and review the published Returns & Refunds policy. Then sign in at /account.html and contact support with your order reference and a clear description. Ebnimaam reviews each case; bank refunds are manually processed and wallet credit is not the same as a bank transfer.';
  }
  if (/(order|tracking|track|where.*order|status)/.test(q)) {
    const orders=context.ownOrders||[];
    if(orders.length)return 'Your latest orders linked to this signed-in account: '+orders.slice(0,4).map((order:any)=>order.reference+' — payment '+order.paymentStatus+', fulfilment '+order.fulfilmentStatus+'.').join(' ')+' Open /account.html to view the private order timeline and tracking details.';
    return 'Sign in at /account.html and open Your orders to view payment status, fulfilment history and any saved courier tracking link. An order reference on its own does not reveal private order details.';
  }
  if (/(wallet|balance|credit|reward|referral|invite|earn)/.test(q)) {
    return 'Open /rewards.html to see your Ebnimaam balance, referral progress, wallet history, bank refund requests, daily challenge and team challenges. Referral and game rewards are store-only credit. The current referral programme gives ₦200 per qualifying verified first purchase, up to ₦1,000 after five different referrals.';
  }
  if (/(game|challenge|pattern|anime|play)/.test(q)) {
    return 'Open /rewards.html and choose the Daily Pattern Challenge. It is a more advanced number-pattern puzzle with a limited number of attempts each day. A reward is added to your Ebnimaam balance only after the server verifies a correct answer.';
  }
  if (/(coupon|discount|promo code|promotion|offer)/.test(q)) {
    const coupons=context.availableCoupons||[];
    return coupons.length
      ? 'The currently available coupon codes are: '+coupons.map((item:any)=>item.code+' ('+(item.discountType==='percent'?item.value+'% off':'₦'+Number(item.value).toLocaleString('en-NG')+' off')+')').join('; ')+'. Enter a valid code during checkout; the server checks its expiry, limits and minimum spend.'
      : 'Enter a coupon code in the secure checkout only when you have a current offer from Ebnimaam. I cannot verify an active public coupon from the current store information.';
  }
  if (/(review|rating|question about product|ask.*product|fit feedback)/.test(q)) {
    return 'Open a product page to read its published customer reviews and answered product questions. To submit your own review or question, sign in to your verified account; reviews are purchase-verified and questions are checked by the Ebnimaam team before publication.';
  }
  if (/(wishlist|saved item|compare|shopping bag|cart)/.test(q)) {
    return 'You can save a product with its heart button, compare up to three products using Compare, and add a product to your bag from the shop or product page. Your bag is stored on this device and can sync to your verified customer account after sign-in.';
  }
  if (/(install|download app|home screen|android|iphone|pwa)/.test(q)) {
    return 'On Android, use the Download app option on the storefront when it is available, or your browser’s Install app / Add to Home Screen action. On iPhone, open Ebnimaam in Safari, tap Share, then Add to Home Screen. The installed web app uses the same storefront and customer account.';
  }
  if (/(privacy|personal data|data|terms|policy|legal)/.test(q)) {
    return 'You can read Ebnimaam’s public policies at /privacy.html, /terms.html and /returns.html. For a copy of your own account information, sign in at /account.html and use Download my information. For questions about a policy, contact the support team.';
  }
  if (/(support|contact|help|human|whatsapp|email|complaint)/.test(q)) {
    return 'You can open Customer support inside your verified account at /account.html to send a private message and view replies. You can also contact Ebnimaam at '+String(context.supportEmail||'ebnimaam.com@gmail.com')+' or use the customer-initiated WhatsApp support link on the storefront.';
  }
  if (/(admin|owner|manage product|change price|store settings|dashboard)/.test(q)) {
    return 'The owner workspace is at /admin and is available only to authorized administrators. It includes orders, products and stock, customers, support, shipping prices, store settings, rewards, content and security. The customer assistant cannot make changes on an owner’s behalf.';
  }
  return 'I can help with the whole Ebnimaam website: finding products and checking their prices/stock, sizes and reviews, accounts and sign-in security, passkeys, cart and Paystack checkout, Nigeria delivery or pickup, order tracking, returns, wallet and referrals, the daily game, coupons, installing the app, notifications, policies and customer support. Tell me what you are trying to do and I’ll guide you through the right page.';
}

export async function POST(req: Request) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'Support is temporarily unavailable. Please use WhatsApp.' }, { status: 503 });
    }
    let allowed = false;
    try { allowed = await checkRateLimit(req, 'customer-support-chat', 24, 15 * 60); }
    catch { return NextResponse.json({ error: 'Support is temporarily unavailable. Please try again shortly.' }, { status: 503 }); }
    if (!allowed) return NextResponse.json({ error: 'You have sent several messages. Please wait a little and try again.' }, { status: 429, headers: { 'retry-after': '900' } });

    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: 'Messages are required.' }, { status: 400 });
    }
    const messages = body.messages.slice(-10).map((item: any) => ({
      role: item?.role === 'assistant' ? 'model' : 'user',
      text: String(item?.text || '').trim().slice(0, 1000),
    })).filter((item: any) => item.text);
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'Please send a message to continue.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const user = await getVerifiedCustomer(req);
    await ensureLoyaltySchema(pool).catch(() => {});
    await ensureCouponsSchema(pool).catch(() => {});
    await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_news(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,image TEXT NOT NULL DEFAULT '',published BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`).catch(() => {});
    const [catalogueResult, settingsResult, ownOrdersResult, newsResult, walletResult, couponResult, challengeResult, referralResult, loyaltySettingsResult, questionResult, reviewResult, supportResult] = await Promise.all([
      pool.query("SELECT id,name,category,price,description,stock,sizes,tag,product_details,size_stock FROM public.ebnimaam_products WHERE is_active=TRUE AND stock>0 ORDER BY updated_at DESC LIMIT 80").catch(() => ({ rows: [] as any[] })),
      pool.query("SELECT settings FROM public.ebnimaam_store_settings WHERE id=1").catch(() => ({ rows: [] as any[] })),
      user ? pool.query("SELECT reference,status,fulfilment_status,COALESCE(order_total_kobo,amount_kobo) AS order_total_kobo,created_at FROM public.ebnimaam_orders WHERE auth_user_id=$1 ORDER BY created_at DESC LIMIT 8",[user.id]).catch(() => ({ rows: [] as any[] })) : Promise.resolve({ rows: [] as any[] }),
      pool.query("SELECT title,content,created_at FROM public.ebnimaam_news WHERE published=TRUE ORDER BY created_at DESC LIMIT 8").catch(() => ({ rows: [] as any[] })),
      user ? walletAvailable(pool,user.id).catch(() => null) : Promise.resolve(null),
      pool.query(
        `SELECT code,discount_type,value,min_spend_kobo,valid_until
         FROM public.ebnimaam_coupons
         WHERE active=TRUE AND (valid_until IS NULL OR valid_until>NOW())
           AND (max_redemptions IS NULL OR redeemed_count<max_redemptions)
         ORDER BY created_at DESC LIMIT 20`
      ).catch(() => ({ rows: [] as any[] })),
      pool.query(
        `SELECT title,description,duration_days,reward_kobo,max_team_size,milestones
         FROM public.ebnimaam_challenges WHERE active=TRUE ORDER BY created_at DESC LIMIT 12`
      ).catch(() => ({ rows: [] as any[] })),
      user ? pool.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE qualifying_order_reference IS NOT NULL)::int AS qualified FROM public.ebnimaam_referral_invites WHERE referrer_user_id=$1`,[user.id]).catch(() => ({rows:[] as any[]})) : Promise.resolve({rows:[] as any[]}),
      pool.query('SELECT referrer_reward_kobo,game_reward_kobo,referral_threshold FROM public.ebnimaam_loyalty_settings WHERE id=1').catch(() => ({rows:[] as any[]})),
      pool.query("SELECT q.question,q.answer,p.name AS product_name FROM public.ebnimaam_product_questions q JOIN public.ebnimaam_products p ON p.id=q.product_id WHERE q.status='published' ORDER BY q.created_at DESC LIMIT 25").catch(()=>({rows:[] as any[]})),
      pool.query("SELECT p.name AS product_name,r.rating,r.fit_feedback,r.comment FROM public.ebnimaam_product_reviews r JOIN public.ebnimaam_products p ON p.id=r.product_id WHERE r.moderation_status='published' ORDER BY r.created_at DESC LIMIT 25").catch(()=>({rows:[] as any[]})),
      user ? pool.query("SELECT t.subject,t.category,t.status,COALESCE((SELECT json_agg(json_build_object('from',m.sender_type,'message',m.body,'at',m.created_at) ORDER BY m.created_at) FROM public.ebnimaam_support_messages m WHERE m.ticket_id=t.id),'[]'::json) AS messages FROM public.ebnimaam_support_tickets t WHERE t.user_id=$1 ORDER BY t.updated_at DESC LIMIT 8",[user.id]).catch(()=>({rows:[] as any[]})) : Promise.resolve({rows:[] as any[]}),
    ]);
    const storeSettings = settingsResult.rows[0]?.settings || {};
    const catalogueContext = (catalogueResult.rows || []).map((p:any) => ({
      name:String(p.name),category:String(p.category),priceNaira:Number(p.price),stock:Number(p.stock),
      sizes:Array.isArray(p.sizes)?p.sizes:[],description:String(p.description||'').slice(0,300),tag:String(p.tag||''),
      productDetails:typeof p.product_details==='string'?safeJson(p.product_details):p.product_details||{},
      sizeStock:typeof p.size_stock==='string'?safeJson(p.size_stock):p.size_stock||{},
    }));
    const orderContext = (ownOrdersResult.rows || []).map((o:any) => ({
      reference:String(o.reference),paymentStatus:String(o.status),fulfilmentStatus:String(o.fulfilment_status),
      totalNaira:Number(o.order_total_kobo)/100,createdAt:o.created_at,
    }));
    const newsContext=(newsResult.rows||[]).map((item:any)=>({title:String(item.title),content:String(item.content||'').slice(0,800),createdAt:item.created_at}));
    const couponsContext=(couponResult.rows||[]).map((item:any)=>({code:String(item.code),discountType:String(item.discount_type),value:Number(item.value),minimumSpendNaira:Number(item.min_spend_kobo||0)/100,validUntil:item.valid_until}));
    const challengesContext=(challengeResult.rows||[]).map((item:any)=>({title:String(item.title),description:String(item.description||'').slice(0,700),durationDays:Number(item.duration_days),rewardNaira:Number(item.reward_kobo)/100,maxTeamSize:Number(item.max_team_size),milestones:Array.isArray(item.milestones)?item.milestones:[]}));
    const questionsContext=(questionResult.rows||[]).map((item:any)=>({product:item.product_name,question:String(item.question).slice(0,500),answer:String(item.answer||'').slice(0,500)}));
    const reviewsContext=(reviewResult.rows||[]).map((item:any)=>({product:item.product_name,rating:Number(item.rating),fitFeedback:String(item.fit_feedback||''),comment:String(item.comment||'').slice(0,500)}));
    const ownSupportContext=(supportResult.rows||[]).map((item:any)=>({subject:String(item.subject),category:String(item.category),status:String(item.status),messages:Array.isArray(item.messages)?item.messages:[]}));
    const liveContext = [
      'LIVE EBNIMAAM WEBSITE CONTEXT (use only these facts; if missing say you cannot verify):',
      JSON.stringify({storeName:'Ebnimaam',country:'Nigeria',supportEmail:storeSettings.supportEmail||'ebnimaam.com@gmail.com',supportPhone:storeSettings.supportPhone||'08145672755',pushNotificationsConfigured:Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY),socialLinks:storeSettings.socialLinks||{},pickupAddressConfirmed:storeSettings.pickupAddressConfirmed===true,pickupAddress:storeSettings.pickupAddress||'',pickupHours:storeSettings.pickupHours||'',deliveryFeesByState:storeSettings.deliveryFeesByState||{},
        deliveryRules:storeSettings.deliveryRules||'',returnsPolicy:storeSettings.returnsPolicy||'',shippingPolicy:storeSettings.shippingPolicy||'',
        terms:storeSettings.terms||'',promotions:storeSettings.promotions||[],availableCoupons:couponsContext,activeTeamChallenges:challengesContext,products:catalogueContext,news:newsContext,publishedProductQuestions:questionsContext,publishedProductReviews:reviewsContext,ownSupportTickets:ownSupportContext,
        publishedReturnsPolicySummary:'The published policy explains Nigerian consumer rights, assessment of returns in a reasonable time, remedies for faulty, damaged, incomplete or incorrect goods, and manual refund processing. It does not set an arbitrary seven-day deadline that removes statutory rights.',
        publishedPrivacySummary:'The published Privacy Policy explains data use, rights requests, account information, safeguards and contact details. Do not make up retention periods or data-sharing practices.',
        publishedTermsSummary:'The published Terms cover Nigeria-only orders, Paystack, delivery fees shown at checkout, fulfilment, account requirements, customer conduct and contact information.',
        signedInCustomer: user?{email:user.email,availableWalletKobo:walletResult,ownRecentOrders:orderContext,referralProgress:referralResult.rows[0]||{total:0,qualified:0}}:null,
        referralProgram:{requiredPurchases:Number(loyaltySettingsResult.rows[0]?.referral_threshold||5),creditPerVerifiedReferralNaira:Number(loyaltySettingsResult.rows[0]?.referrer_reward_kobo||20000)/100,totalAfterFiveNaira:(Number(loyaltySettingsResult.rows[0]?.referrer_reward_kobo||20000)/100)*5,storeOnly:true},
        dailyPatternChallenge:{rewardNaira:Number(loyaltySettingsResult.rows[0]?.game_reward_kobo||5000)/100,rewardLimit:'one successful reward per customer per Africa/Lagos calendar day',cashWithdrawalAllowed:false}},null,2),
      'For wallet ledger, referral status and team challenge participation details, ask the signed-in customer to open /rewards.html. The supplied wallet figure is available credit only; never infer rewards from orders.',
    ].join('\\n');
    const quickContext={products:catalogueContext,deliveryFeesByState:storeSettings.deliveryFeesByState||{},pickupAddress:storeSettings.pickupAddress||'',pickupHours:storeSettings.pickupHours||'',supportEmail:storeSettings.supportEmail||'ebnimaam.com@gmail.com',availableCoupons:couponsContext,ownOrders:orderContext,pushNotificationsConfigured:Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY),storeSettings};
    if (!apiKey) {
      return NextResponse.json({ reply: quickReply(messages[messages.length - 1].text, quickContext), mode: 'quick-help' });
    }

    const contents = messages.map((message: any) => ({
      role: message.role,
      parts: [{ text: message.text }],
    }));
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: STORE_INSTRUCTIONS + '\\n\\n' + liveContext }] },
        contents,
        generationConfig: { maxOutputTokens: 900 },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ reply: quickReply(messages[messages.length - 1].text, quickContext), mode: 'quick-help' });
    }
    const reply = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return NextResponse.json({ reply: reply.slice(0, 2400) || quickReply(messages[messages.length - 1].text, quickContext), mode: 'gemini' });
  } catch {
    return NextResponse.json({ error: 'Network error reaching support. Please use WhatsApp.' }, { status: 503 });
  }
}
