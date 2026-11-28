import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { WebAuthnCredential } from '@simplewebauthn/server';
import { activateCustomerSession } from '../../../lib/customer-sessions';
import { getVerifiedCustomer } from '../../../lib/loyalty';
import { checkRateLimit } from '../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_passkeys(
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    public_key BYTEA NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    transports JSONB NOT NULL DEFAULT '[]'::jsonb,
    device_type TEXT NOT NULL DEFAULT 'singleDevice',
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_passkeys_user_idx ON public.ebnimaam_passkeys(user_id,created_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_passkey_challenges(
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose IN ('registration','authentication')),
    email TEXT NOT NULL,
    challenge TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(user_id,purpose)
  )`);
}

function rpDetails(req: Request) {
  const url = new URL(req.url);
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname.includes(':')) throw new Error('This domain cannot register a passkey.');
  return { rpID: hostname, origin: url.origin };
}

async function saveChallenge(userId: string, email: string, purpose: 'registration'|'authentication', challenge: string) {
  await pool.query(
    `INSERT INTO public.ebnimaam_passkey_challenges(user_id,purpose,email,challenge,expires_at)
     VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')
     ON CONFLICT(user_id,purpose) DO UPDATE SET email=EXCLUDED.email,challenge=EXCLUDED.challenge,expires_at=EXCLUDED.expires_at`,
    [userId,purpose,email.toLowerCase(),challenge],
  );
}

async function readChallenge(userId: string, purpose: 'registration'|'authentication') {
  const result = await pool.query(
    'SELECT email,challenge FROM public.ebnimaam_passkey_challenges WHERE user_id=$1 AND purpose=$2 AND expires_at>NOW()',
    [userId,purpose],
  );
  return result.rows[0] || null;
}

async function consumeChallenge(userId: string, purpose: 'registration'|'authentication', challenge: string) {
  const result = await pool.query(
    'DELETE FROM public.ebnimaam_passkey_challenges WHERE user_id=$1 AND purpose=$2 AND challenge=$3 AND expires_at>NOW() RETURNING user_id',
    [userId,purpose,challenge],
  );
  return Boolean(result.rowCount);
}

export async function POST(req: Request) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim();

    if (action === 'registration-options') {
      const user = await getVerifiedCustomer(req);
      if (!user) return NextResponse.json({ error: 'Sign in with your verified account before adding a passkey.' }, { status: 401 });
      if (!(await checkRateLimit(req,'passkey-registration-options',5,15*60))) return NextResponse.json({error:'Please wait before requesting another passkey setup.'},{status:429});
      const { rpID } = rpDetails(req);
      const existing = await pool.query('SELECT credential_id,transports FROM public.ebnimaam_passkeys WHERE user_id=$1',[user.id]);
      const options = await generateRegistrationOptions({
        rpName: 'Ebnimaam',
        rpID,
        userID: new TextEncoder().encode(user.id),
        userName: user.email,
        userDisplayName: user.name || user.email,
        attestationType: 'none',
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        excludeCredentials: existing.rows.map((row:any)=>({id:String(row.credential_id),transports:Array.isArray(row.transports)?row.transports:[]})),
        supportedAlgorithmIDs: [-7,-257],
      });
      await saveChallenge(user.id,user.email,'registration',options.challenge);
      return NextResponse.json(options,{headers:{'cache-control':'no-store'}});
    }

    if (action === 'registration-verify') {
      const user = await getVerifiedCustomer(req);
      if (!user) return NextResponse.json({ error: 'Your verified account session has expired. Sign in again.' }, { status: 401 });
      if (!(await checkRateLimit(req,'passkey-registration-verify',5,15*60))) return NextResponse.json({error:'Please wait before trying again.'},{status:429});
      const stored = await readChallenge(user.id,'registration');
      if (!stored) return NextResponse.json({error:'Passkey setup expired. Start again.'},{status:410});
      const { rpID, origin } = rpDetails(req);
      const verification = await verifyRegistrationResponse({
        response: body?.credential,
        expectedChallenge: stored.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7,-257],
      });
      if (!verification.verified || !verification.registrationInfo) return NextResponse.json({error:'Your device did not verify the passkey. Please try again.'},{status:400});
      const info:any = verification.registrationInfo;
      const credential = info.credential;
      if (!credential?.id || !credential?.publicKey) return NextResponse.json({error:'The authenticator did not return a usable passkey.'},{status:400});
      const transports = Array.isArray(credential.transports) ? credential.transports : [];
      await pool.query(
        `INSERT INTO public.ebnimaam_passkeys(credential_id,user_id,email,public_key,counter,transports,device_type,backed_up)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         ON CONFLICT(credential_id) DO NOTHING`,
        [credential.id,user.id,user.email,Buffer.from(credential.publicKey),Number(credential.counter||0),JSON.stringify(transports),String(info.credentialDeviceType||'singleDevice'),info.credentialBackedUp===true],
      );
      await consumeChallenge(user.id,'registration',stored.challenge);
      return NextResponse.json({ok:true,message:'Passkey saved. Your device can now verify sign-in with Face ID, fingerprint or its screen lock.'},{headers:{'cache-control':'no-store'}});
    }

    if (action === 'authentication-options') {
      if (!(await checkRateLimit(req,'passkey-auth-options',8,15*60))) return NextResponse.json({error:'Too many passkey attempts. Please wait and try again.'},{status:429});
      const email = String(body?.email||'').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({error:'Enter the email address on your Ebnimaam account.'},{status:400});
      const passkeys = await pool.query('SELECT user_id,credential_id,transports FROM public.ebnimaam_passkeys WHERE LOWER(email)=LOWER($1) ORDER BY created_at DESC',[email]);
      if (!passkeys.rowCount) return NextResponse.json({error:'No passkey is saved for this email yet. Sign in with your password and verification code, then set one up in Account security.'},{status:404});
      const userId = String(passkeys.rows[0].user_id);
      const { rpID } = rpDetails(req);
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification:'required',
        allowCredentials:passkeys.rows.map((row:any)=>({id:String(row.credential_id),transports:Array.isArray(row.transports)?row.transports:[]})),
      });
      await saveChallenge(userId,email,'authentication',options.challenge);
      return NextResponse.json(options,{headers:{'cache-control':'no-store'}});
    }

    if (action === 'authentication-verify') {
      if (!(await checkRateLimit(req,'passkey-auth-verify',10,15*60))) return NextResponse.json({error:'Too many passkey verification attempts. Please wait and try again.'},{status:429});
      const email = String(body?.email||'').trim().toLowerCase();
      const responseCredential = body?.credential;
      const credentialId = String(responseCredential?.id||'');
      if (!email || !credentialId) return NextResponse.json({error:'The passkey response is incomplete.'},{status:400});
      const passkeyResult = await pool.query(
        'SELECT credential_id,user_id,email,public_key,counter,transports FROM public.ebnimaam_passkeys WHERE credential_id=$1 AND LOWER(email)=LOWER($2)',
        [credentialId,email],
      );
      if (!passkeyResult.rowCount) return NextResponse.json({error:'This passkey is not registered to that account.'},{status:401});
      const passkey = passkeyResult.rows[0];
      const userId = String(passkey.user_id);
      const stored = await readChallenge(userId,'authentication');
      if (!stored || stored.email !== email) return NextResponse.json({error:'Passkey sign-in expired. Start again.'},{status:410});
      const { rpID, origin } = rpDetails(req);
      const transports = Array.isArray(passkey.transports)?passkey.transports:[];
      const credential: WebAuthnCredential = {
        id:String(passkey.credential_id),
        publicKey:new Uint8Array(passkey.public_key),
        counter:Number(passkey.counter||0),
        transports,
      };
      const verification = await verifyAuthenticationResponse({
        response:responseCredential,
        expectedChallenge:stored.challenge,
        expectedOrigin:origin,
        expectedRPID:rpID,
        credential,
        requireUserVerification:true,
      });
      if (!verification.verified) return NextResponse.json({error:'The passkey could not be verified. Try again.'},{status:401});
      await pool.query('UPDATE public.ebnimaam_passkeys SET counter=$2,last_used_at=NOW() WHERE credential_id=$1',[credentialId,Number(verification.authenticationInfo.newCounter||0)]);
      await consumeChallenge(userId,'authentication',stored.challenge);
      const sessionResponse = NextResponse.json({ok:true,message:'Passkey verified. You are signed in on this device.'},{headers:{'cache-control':'no-store'}});
      await activateCustomerSession(sessionResponse,req,{id:userId,email:String(passkey.email)});
      return sessionResponse;
    }

    if (action === 'remove') {
      const user = await getVerifiedCustomer(req);
      if (!user) return NextResponse.json({error:'Sign in before changing passkey settings.'},{status:401});
      const credentialId = String(body?.credentialId||'');
      const result = await pool.query('DELETE FROM public.ebnimaam_passkeys WHERE credential_id=$1 AND user_id=$2 RETURNING credential_id',[credentialId,user.id]);
      if (!result.rowCount) return NextResponse.json({error:'Passkey not found.'},{status:404});
      return NextResponse.json({ok:true});
    }

    if (action === 'list') {
      const user = await getVerifiedCustomer(req);
      if (!user) return NextResponse.json({error:'Sign in before viewing saved passkeys.'},{status:401});
      const result = await pool.query('SELECT credential_id,device_type,backed_up,created_at,last_used_at FROM public.ebnimaam_passkeys WHERE user_id=$1 ORDER BY created_at DESC',[user.id]);
      return NextResponse.json({passkeys:result.rows.map((row:any)=>({id:row.credential_id.slice(0,10)+'…',credentialId:row.credential_id,deviceType:row.device_type,backedUp:row.backed_up,createdAt:row.created_at,lastUsedAt:row.last_used_at}))},{headers:{'cache-control':'no-store'}});
    }

    return NextResponse.json({error:'Unsupported passkey action.'},{status:400});
  } catch (error:any) {
    return NextResponse.json({error:String(error?.message||'Passkey request failed.').slice(0,260)},{status:400,headers:{'cache-control':'no-store'}});
  }
}
