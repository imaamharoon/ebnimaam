'use client';

import { useCallback, useEffect, useState } from 'react';

type Order = {
  reference: string;
  paymentStatus: string;
  fulfilmentStatus: string;
  fulfilmentMethod: string;
  deliveryFee: number;
  pickupAddress: string;
  pickupHours: string;
  trackingCarrier: string;
  trackingCode: string;
  trackingUrl: string;
  total: number;
  createdAt: string;
  paidAt: string | null;
  history: Array<{ status: string; note?: string; created_at: string }>;
};

const stages = [
  { key: 'pending', label: 'Order received', description: 'We have received your order.' },
  { key: 'picked', label: 'Items picked', description: 'Your items have been prepared.' },
  { key: 'packed', label: 'Packed', description: 'Your order has been packed securely.' },
  { key: 'shipped', label: 'Handed to courier', description: 'Your parcel is on its way.' },
  { key: 'delivered', label: 'Delivered', description: 'Your order has reached its destination.' },
];

function niceStatus(value: string) {
  return String(value || 'processing').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function money(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

export default function Track() {
  const [ref, setRef] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [autoTrack, setAutoTrack] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const refresh = useCallback(async (silent = false) => {
    if (!ref.trim() || signedIn !== true) return;
    if (!silent) setBusy(true);
    if (!silent) setError('');
    try {
      const response = await fetch('/api/track-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref.trim() }),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'We could not find this order in your account.');
      setOrder(data.order);
      setLastUpdated(new Date().toLocaleTimeString());
      setError('');
    } catch (problem: any) {
      if (!silent) setError(problem?.message || 'Order tracking is temporarily unavailable.');
    } finally {
      if (!silent) setBusy(false);
    }
  }, [ref, signedIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const savedReference = params.get('reference') || '';
    if (savedReference) { setRef(savedReference); setAutoTrack(true); }
    let active = true;
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/get-session', { credentials: 'same-origin', cache: 'no-store' });
        const data = response.ok ? await response.json() : null;
        if (active) setSignedIn(Boolean(data?.user?.id && data.user.emailVerified === true));
      } catch {
        if (active) setSignedIn(false);
      }
    };
    void checkSession();
    window.addEventListener('focus', checkSession);
    return () => { active = false; window.removeEventListener('focus', checkSession); };
  }, []);

  useEffect(() => {
    if (signedIn === true && autoTrack && ref.trim()) { setAutoTrack(false); void refresh(false); }
  }, [signedIn, autoTrack, ref, refresh]);

  useEffect(() => {
    if (signedIn !== true || !order?.reference) return;
    const timer = window.setInterval(() => void refresh(true), 30000);
    return () => window.clearInterval(timer);
  }, [signedIn, order?.reference, refresh]);

  const currentStatus = String(order?.fulfilmentStatus || 'processing').toLowerCase();
  const isPickup = order?.fulfilmentMethod === 'pickup';
  const timeline = isPickup
    ? [
        stages[0],
        stages[1],
        { key: 'packed', label: 'Prepared for collection', description: 'Your order is being prepared.' },
        { key: 'ready_for_pickup', label: 'Ready for pickup', description: 'Your order is ready at our collection point.' },
        { key: 'collected', label: 'Collected', description: 'Your order has been collected.' },
      ]
    : stages;
  const terminal = currentStatus === 'cancelled' || currentStatus === 'stock_issue';
  const completedIndex = timeline.findIndex((stage) => stage.key === currentStatus);
  const reachedIndex = completedIndex >= 0 ? completedIndex : currentStatus === 'processing' ? 0 : -1;

  return (
    <main style={{ minHeight: '100vh', background: '#f7f5ef', color: '#243348', padding: '28px 16px', fontFamily: 'Arial,sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '24px auto' }}>
        <a href="/store.html" style={{ color: '#102544', textDecoration: 'none' }}>← Back to Ebnimaam</a>
        <header style={{ textAlign: 'center', padding: '30px 10px 22px' }}>
          <div style={{ color: '#b7894f', letterSpacing: 3, fontSize: 11, textTransform: 'uppercase' }}>Ebnimaam order care</div>
          <h1 style={{ color: '#102544', font: 'normal 38px Georgia,serif', margin: '12px 0' }}>Your order, in view.</h1>
          <p style={{ color: '#697482', lineHeight: 1.7, margin: 0 }}>Follow your order from preparation to delivery or collection.</p>
        </header>

        {signedIn === false && (
          <section style={{ background: '#fffefa', border: '1px solid #e8e2d8', borderRadius: 14, padding: 22, marginBottom: 18 }}>
            <h2 style={{ color: '#102544', font: 'normal 23px Georgia,serif', marginTop: 0 }}>Sign in to track your order</h2>
            <p style={{ color: '#697482', lineHeight: 1.7 }}>Order history and delivery details are only available to the verified customer account that placed the order.</p>
            <a href={'/account.html?next=track' + (ref ? '&reference=' + encodeURIComponent(ref) : '')} style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: 15, marginTop: 18, background: '#102544', color: '#fff', borderRadius: 8, fontWeight: 700 }}>Sign in to your Ebnimaam account</a>
          </section>
        )}
        {signedIn === null && <p style={{ color: '#697482', textAlign: 'center' }}>Checking your secure account session…</p>}
        {signedIn === true && (
          <section style={{ background: '#fffefa', border: '1px solid #e8e2d8', borderRadius: 14, padding: 22, marginBottom: 18 }}>
            <h2 style={{ color: '#102544', font: 'normal 23px Georgia,serif', marginTop: 0 }}>Find an order in your account</h2>
            <form onSubmit={(event) => { event.preventDefault(); void refresh(false); }}>
              <label style={{ display: 'block', fontSize: 12, margin: '12px 0 6px' }}>Order reference</label>
              <input required value={ref} onChange={(event) => setRef(event.target.value)} placeholder="EBN-…" style={{ width: '100%', padding: 14, border: '1px solid #ddd7cd', borderRadius: 8, boxSizing: 'border-box' }} />
              <p style={{ color: '#697482', fontSize: 12, lineHeight: 1.6 }}>Only orders belonging to your signed-in account can be displayed. An email address or order reference alone is not enough.</p>
              <button disabled={busy} style={{ width: '100%', padding: 15, marginTop: 18, background: '#102544', color: '#fff', border: 0, borderRadius: 8, fontWeight: 700 }}>{busy ? 'Checking…' : 'Track my order'}</button>
            </form>
          </section>
        )}

        {error && <p role="alert" style={{ padding: 14, background: '#fff1f0', color: '#a12e27', borderRadius: 9 }}>{error}</p>}

        {order && (
          <>
            <section style={{ background: '#102544', color: '#fff', borderRadius: 14, padding: 22, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div><div style={{ color: '#d8b47c', fontSize: 10, letterSpacing: 2 }}>ORDER REFERENCE</div><strong style={{ display: 'block', marginTop: 8, overflowWrap: 'anywhere' }}>{order.reference}</strong></div>
                <div><div style={{ color: '#d8b47c', fontSize: 10, letterSpacing: 2 }}>ORDER TOTAL</div><strong style={{ display: 'block', marginTop: 8 }}>{money(order.total)}</strong></div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 20 }}>
                <span style={{ borderRadius: 20, padding: '7px 11px', background: '#ffffff1b', fontSize: 12 }}>{niceStatus(order.paymentStatus)}</span>
                <span style={{ borderRadius: 20, padding: '7px 11px', background: '#c99550', color: '#102544', fontSize: 12, fontWeight: 700 }}>{niceStatus(order.fulfilmentStatus)}</span>
                <span style={{ fontSize: 12, color: '#d4dce5' }}>{isPickup ? 'Self-pickup · no delivery fee' : 'Home delivery'}</span>
              </div>
            </section>

            {terminal ? (
              <section style={{ background: '#fffefa', padding: 22, borderRadius: 14, border: '1px solid #e8e2d8' }}>
                <h2 style={{ color: '#a12e27', font: 'normal 24px Georgia,serif' }}>{niceStatus(currentStatus)}</h2>
                <p style={{ lineHeight: 1.7, color: '#697482' }}>{currentStatus === 'cancelled' ? 'This order has been cancelled. Please contact Ebnimaam support if you need assistance.' : 'Our team needs to review an inventory issue before fulfilment can continue.'}</p>
              </section>
            ) : (
              <section style={{ background: '#fffefa', padding: 22, borderRadius: 14, border: '1px solid #e8e2d8' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <h2 style={{ color: '#102544', font: 'normal 24px Georgia,serif', margin: 0 }}>Order progress</h2>
                  <span style={{ fontSize: 11, color: '#87909a' }}>{lastUpdated ? 'Updated ' + lastUpdated : ''} · refreshes every 30 seconds</span>
                </div>
                <ol style={{ listStyle: 'none', padding: 0, margin: '22px 0 0' }}>
                  {timeline.map((stage, index) => {
                    const done = reachedIndex >= index;
                    const historyItem = [...(order.history || [])].reverse().find((item) => item.status === stage.key);
                    const current = stage.key === currentStatus;
                    return <li key={stage.key} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 13, minHeight: 76 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ width: 13, height: 13, borderRadius: '50%', background: done ? '#c99550' : '#e3ded5', border: '3px solid #fffefa', boxShadow: done ? '0 0 0 1px #c99550' : '0 0 0 1px #ded8ce' }} />
                        {index < timeline.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 42, background: done ? '#c99550' : '#e8e2d8' }} />}
                      </div>
                      <div style={{ paddingBottom: 18 }}>
                        <strong style={{ color: done ? '#102544' : '#87909a', fontSize: 14 }}>{stage.label}{current ? ' · Current' : ''}</strong>
                        <p style={{ color: '#697482', fontSize: 12, margin: '5px 0' }}>{stage.description}</p>
                        {historyItem && <small style={{ color: '#87909a' }}>{new Date(historyItem.created_at).toLocaleString()}{historyItem.note ? ' · ' + historyItem.note : ''}</small>}
                      </div>
                    </li>;
                  })}
                </ol>
              </section>
            )}

            <section style={{ background: '#fffefa', padding: 22, borderRadius: 14, border: '1px solid #e8e2d8', marginTop: 16 }}>
              <h2 style={{ color: '#102544', font: 'normal 22px Georgia,serif', marginTop: 0 }}>{isPickup ? 'Pickup details' : 'Delivery details'}</h2>
              {isPickup ? <>
                <p><b>Collection method:</b> Pick up myself</p>
                <p><b>Delivery fee:</b> {money(0)}</p>
                <p><b>Pickup address:</b> {order.pickupAddress || 'Contact Ebnimaam for collection details.'}</p>
                <p><b>Pickup hours:</b> {order.pickupHours || 'Please contact Ebnimaam to confirm collection hours.'}</p>
              </> : <>
                <p><b>Delivery fee:</b> {money(order.deliveryFee)}</p>
                {order.trackingCarrier && <p><b>Delivery partner:</b> {order.trackingCarrier}</p>}
                {order.trackingCode && <p><b>Tracking number:</b> {order.trackingCode}</p>}
                {order.trackingUrl && <p><a href={order.trackingUrl} target="_blank" rel="noreferrer" style={{ color: '#94713d' }}>Open courier tracking ↗</a></p>}
              </>}
              <p style={{ color: '#87909a', fontSize: 12 }}>Placed {new Date(order.createdAt).toLocaleString()}</p>
              <button onClick={() => void refresh(false)} disabled={busy} style={{ marginTop: 8, border: '1px solid #102544', background: 'transparent', color: '#102544', borderRadius: 7, padding: '11px 15px' }}>{busy ? 'Refreshing…' : 'Refresh status'}</button>
            </section>
          </>
        )}
        <footer style={{ textAlign: 'center', color: '#89919a', fontSize: 12, padding: 28 }}>Need assistance? <a href="mailto:ebnimaam.com@gmail.com" style={{ color: '#94713d' }}>Email Ebnimaam</a> · <a href="https://wa.me/2348145672755" style={{ color: '#94713d' }}>WhatsApp support</a></footer>
      </div>
    </main>
  );
}