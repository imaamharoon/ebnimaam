import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORE_INSTRUCTIONS = [
  'You are the friendly, concise customer support assistant for ebnimaam, a Nigerian clothing and accessories brand.',
  'Keep answers short, clear and easy to read on a phone screen. Use no more than 4 short sentences.',
  'Sizing: sizes S, M, L, XL and XXL where a product offers them. Regular fit is generally true to size. Suggest sizing up for a looser look, or use the Size Guide & Fit Finder on the product page.',
  'Delivery: nationwide delivery across Nigeria. Typical estimates are 1-3 working days in Jos, Abuja and Kano, and 2-5 working days to Lagos and other states. Actual delivery estimates can vary by destination.',
  'Payments: secure checkout through Paystack (Card, Bank Transfer and USSD). Delivery is calculated by destination and shown before payment. Do not invent any additional fee.',
  'Returns and exchanges: exchanges are accepted within 7 days of delivery if the item is unworn and original tags are attached.',
  'For a specific existing order, bulk pricing, stock confirmation or a request not covered here, direct the customer to the WhatsApp support link shown in the chat.',
  'Never claim an order was changed, a refund was issued, a payment was received, or stock was reserved unless the application confirms it.',
].join('\n');

function quickReply(question: string) {
  const q = question.toLowerCase();
  if (/(size|fit|measure|sizing|small|large|chest)/.test(q)) {
    return 'Regular fit is generally true to size. For a looser look, consider sizing up, or open the Size Guide & Fit Finder on the product page to compare your height, weight and fit preference.';
  }
  if (/(deliver|shipping|dispatch|arrive|how long|when.*come)/.test(q)) {
    return 'We deliver across Nigeria. Typical delivery is 1–3 working days in Jos, Abuja and Kano, and 2–5 working days to Lagos and other states. Your delivery fee is shown at checkout before you pay.';
  }
  if (/(pay|payment|card|bank|ussd|transfer)/.test(q)) {
    return 'Checkout is handled securely by Paystack. You can pay by card, bank transfer or USSD, and your order is confirmed after the payment is verified.';
  }
  if (/(return|exchange|refund|wrong size)/.test(q)) {
    return 'Exchanges are accepted within 7 days of delivery when the item is unworn and its original tags are attached. For a specific order or refund request, please contact our team through WhatsApp.';
  }
  if (/(order|bulk|wholesale|stock|existing)/.test(q)) {
    return 'For an existing order, bulk pricing or a stock confirmation, please use the WhatsApp support link in this chat so our team can check the details with you.';
  }
  return 'I can help with sizing, delivery, payment methods and exchanges. Tell me which part you would like help with, or use the WhatsApp link in this chat for a team member.';
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
    const messages = body.messages.slice(-6).map((item: any) => ({
      role: item?.role === 'assistant' ? 'model' : 'user',
      text: String(item?.text || '').trim().slice(0, 600),
    })).filter((item: any) => item.text);
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'Please send a message to continue.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ reply: quickReply(messages[messages.length - 1].text), mode: 'quick-help' });
    }

    const contents = messages.map((message: any) => ({
      role: message.role,
      parts: [{ text: message.text }],
    }));
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: STORE_INSTRUCTIONS }] },
        contents,
        generationConfig: { maxOutputTokens: 220, temperature: 0.4 },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ reply: quickReply(messages[messages.length - 1].text), mode: 'quick-help' });
    }
    const reply = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return NextResponse.json({ reply: reply.slice(0, 1200) || quickReply(messages[messages.length - 1].text), mode: 'gemini' });
  } catch {
    return NextResponse.json({ error: 'Network error reaching support. Please use WhatsApp.' }, { status: 503 });
  }
}
