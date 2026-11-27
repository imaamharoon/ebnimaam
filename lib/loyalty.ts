import type { Pool, PoolClient } from 'pg';
import { isCurrentCustomerSession } from './customer-sessions';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const authBase = (process.env.NEON_AUTH_BASE_URL || 'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/, '');

function bankDetailsKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('Bank detail encryption is not configured.');
  return createHmac('sha256', secret).update('ebnimaam-bank-refund-details-v1').digest();
}

export function encryptBankDetails(details: { bankName: string; accountName: string; accountNumber: string }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bankDetailsKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptBankDetails(value: unknown) {
  try {
    const [version, ivPart, tagPart, ciphertextPart] = String(value || '').split('.');
    if (version !== 'v1' || !ivPart || !tagPart || !ciphertextPart) return null;
    const decipher = createDecipheriv('aes-256-gcm', bankDetailsKey(), Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64')), decipher.final()]).toString('utf8');
    const details = JSON.parse(plaintext);
    if (!details || typeof details !== 'object' || typeof details.bankName !== 'string' || typeof details.accountName !== 'string' || typeof details.accountNumber !== 'string') return null;
    return { bankName: details.bankName, accountName: details.accountName, accountNumber: details.accountNumber };
  } catch { return null; }
}


export async function getVerifiedCustomer(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  if (!cookie) return null;
  try {
    const response = await fetch(authBase + '/get-session', {
      headers: { cookie, origin: new URL(req.url).origin },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    const user = data?.user;
    if (!user?.id || !user?.email || user.emailVerified !== true) return null;
    if (!(await isCurrentCustomerSession(req, String(user.id)))) return null;
    return { id: String(user.id), email: String(user.email), name: String(user.name || '') };
  } catch {
    return null;
  }
}

export async function ensureLoyaltySchema(pool: Pool | PoolClient) {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_loyalty_settings(
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
    referred_reward_kobo INTEGER NOT NULL DEFAULT 0 CHECK(referred_reward_kobo>=0),
    referrer_reward_kobo INTEGER NOT NULL DEFAULT 20000 CHECK(referrer_reward_kobo>=0),
    game_reward_kobo INTEGER NOT NULL DEFAULT 5000 CHECK(game_reward_kobo>=0),
    referral_threshold INTEGER NOT NULL DEFAULT 5 CHECK(referral_threshold=5),
    referral_rules_version SMALLINT NOT NULL DEFAULT 1,
    low_stock_threshold INTEGER NOT NULL DEFAULT 3 CHECK(low_stock_threshold>=0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('ALTER TABLE public.ebnimaam_loyalty_settings ADD COLUMN IF NOT EXISTS game_reward_kobo INTEGER NOT NULL DEFAULT 5000 CHECK(game_reward_kobo>=0)');
  await pool.query('ALTER TABLE public.ebnimaam_loyalty_settings ADD COLUMN IF NOT EXISTS referral_rules_version SMALLINT NOT NULL DEFAULT 0');
  await pool.query('INSERT INTO public.ebnimaam_loyalty_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING');
  await pool.query('UPDATE public.ebnimaam_loyalty_settings SET referred_reward_kobo=0,referrer_reward_kobo=20000,referral_threshold=5,referral_rules_version=1,updated_at=NOW() WHERE id=1 AND referral_rules_version<1');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_customer_profiles(user_id TEXT PRIMARY KEY,email TEXT NOT NULL,full_name TEXT,phone TEXT,addresses JSONB NOT NULL DEFAULT '[]'::jsonb,preferences JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_wallet_ledger(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('credit','debit')),
    amount_kobo INTEGER NOT NULL CHECK(amount_kobo>0),
    reference TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_wallet_user_created_idx ON public.ebnimaam_wallet_ledger(user_id,created_at DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_wallet_reservations(
    reference TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL CHECK(amount_kobo>0),
    status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','committed','released')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_wallet_reservations_user_idx ON public.ebnimaam_wallet_reservations(user_id,status)');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_referral_codes(
    user_id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_referral_invites(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_user_id TEXT NOT NULL,
    referred_user_id TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL,
    qualifying_order_reference TEXT UNIQUE,
    referred_rewarded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_referral_owner_idx ON public.ebnimaam_referral_invites(referrer_user_id,created_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_wallet_withdrawals(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL CHECK(amount_kobo>0),
    bank_details JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_wallet_withdrawals_status_idx ON public.ebnimaam_wallet_withdrawals(status,created_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_challenges(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 2 AND 21),
    reward_kobo INTEGER NOT NULL CHECK(reward_kobo>0),
    max_team_size INTEGER NOT NULL DEFAULT 5 CHECK(max_team_size BETWEEN 2 AND 5),
    milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_challenge_teams(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES public.ebnimaam_challenges(id) ON DELETE CASCADE,
    team_name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    creator_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','submitted','completed','rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_challenge_members(
    team_id UUID NOT NULL REFERENCES public.ebnimaam_challenge_teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(team_id,user_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_challenge_members_user_idx ON public.ebnimaam_challenge_members(user_id)');
  await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_challenge_submissions(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES public.ebnimaam_challenge_teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    milestone_key TEXT NOT NULL,
    proof TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    UNIQUE(team_id,user_id,milestone_key)
  )`);
}

export async function walletBalance(pool: Pool | PoolClient, userId: string) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount_kobo ELSE -amount_kobo END),0)::bigint AS balance
     FROM public.ebnimaam_wallet_ledger WHERE user_id=$1`,
    [userId],
  );
  return Math.max(0, Number(result.rows[0]?.balance || 0));
}

export async function walletAvailable(pool: Pool | PoolClient, userId: string) {
  const [balance,reservations,withdrawals] = await Promise.all([
    walletBalance(pool,userId),
    pool.query("SELECT COALESCE(SUM(amount_kobo),0)::bigint AS amount FROM public.ebnimaam_wallet_reservations WHERE user_id=$1 AND status='reserved'",[userId]),
    pool.query("SELECT COALESCE(SUM(amount_kobo),0)::bigint AS amount FROM public.ebnimaam_wallet_withdrawals WHERE user_id=$1 AND status='pending'",[userId]),
  ]);
  return Math.max(0,balance-Number(reservations.rows[0]?.amount||0)-Number(withdrawals.rows[0]?.amount||0));
}

export async function addWalletEntry(
  client: PoolClient,
  input: { userId: string; entryType: string; direction: 'credit' | 'debit'; amountKobo: number; reference: string; description: string; metadata?: Record<string, unknown> },
) {
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0 || input.amountKobo > 100_000_000) {
    throw new Error('Wallet amount must be a positive, safe whole-kobo amount.');
  }
  await client.query(
    `INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,direction,amount_kobo,reference,description,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(reference) DO NOTHING`,
    [input.userId,input.entryType,input.direction,input.amountKobo,input.reference,input.description.slice(0,240),JSON.stringify(input.metadata || {})],
  );
}

export async function awardPaidReferral(client: PoolClient, order: { reference: string; auth_user_id?: string | null; status: string }) {
  if (String(order.status).toLowerCase() !== 'paid' || !order.auth_user_id) return;
  await ensureLoyaltySchema(client);
  const inviteResult = await client.query(
    `SELECT id,referrer_user_id,referred_user_id,qualifying_order_reference,referred_rewarded_at
     FROM public.ebnimaam_referral_invites WHERE referred_user_id=$1 FOR UPDATE`,
    [order.auth_user_id],
  );
  if (!inviteResult.rowCount) return;
  const invite = inviteResult.rows[0];
  const qualifyingReference = String(invite.qualifying_order_reference || order.reference);
  await client.query(
    'UPDATE public.ebnimaam_referral_invites SET qualifying_order_reference=COALESCE(qualifying_order_reference,$1) WHERE id=$2',
    [order.reference,invite.id],
  );
  const settings = await client.query('SELECT referred_reward_kobo,referrer_reward_kobo,referral_threshold FROM public.ebnimaam_loyalty_settings WHERE id=1');
  const config = settings.rows[0] || { referred_reward_kobo:0,referrer_reward_kobo:0,referral_threshold:5 };
  const referredReward = Number(config.referred_reward_kobo || 0);
  if (!invite.referred_rewarded_at && referredReward > 0) {
    await addWalletEntry(client,{
      userId:invite.referred_user_id,entryType:'referral_welcome',direction:'credit',
      amountKobo:referredReward,reference:'referral-welcome-'+qualifyingReference,
      description:'Ebnimaam referral purchase reward',
      metadata:{orderReference:qualifyingReference,referrerUserId:invite.referrer_user_id},
    });
    await client.query('UPDATE public.ebnimaam_referral_invites SET referred_rewarded_at=NOW() WHERE id=$1',[invite.id]);
  }
  const qualified = await client.query(
    'SELECT COUNT(*)::int AS count FROM public.ebnimaam_referral_invites WHERE referrer_user_id=$1 AND qualifying_order_reference IS NOT NULL',
    [invite.referrer_user_id],
  );
  const referrerReward = Number(config.referrer_reward_kobo || 0);
  if (referrerReward > 0) {
    await addWalletEntry(client,{
      userId:invite.referrer_user_id,entryType:'referral_reward',direction:'credit',
      amountKobo:referrerReward,reference:'referral-paid-'+invite.id,
      description:'Reward for a referred customer completing a verified paid purchase',
      metadata:{referredUserId:invite.referred_user_id,qualifyingOrderReference:qualifyingReference,qualifiedReferralCount:Number(qualified.rows[0]?.count || 0),threshold:5},
    });
  }
}
