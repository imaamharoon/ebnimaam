import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';

export const loyaltyPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const authBase = (process.env.NEON_AUTH_BASE_URL || 'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/, '');
const challengeSlug = 'seven-day-team-challenge';
export const challengeDefinition = {
  slug: challengeSlug,
  title: 'The Seven-Day Team Quest',
  durationDays: 7,
  maxTeamSize: 5,
  description: 'A demanding seven-day team challenge. Your team must complete one meaningful daily milestone, submit evidence and receive owner approval for every day before a reward can be released.',
  milestones: [
    'Day 1 · Form your team and agree on a measurable goal. Submit the team plan and each member’s role.',
    'Day 2 · Research the goal and document a practical plan with evidence of the work completed.',
    'Day 3 · Complete the first major task and submit evidence of the result.',
    'Day 4 · Review progress as a team, identify a real obstacle and document how you solved it.',
    'Day 5 · Complete a second major task and provide evidence from the work.',
    'Day 6 · Quality-check the work, correct weaknesses and submit the improvements.',
    'Day 7 · Submit the finished team outcome and a short explanation of each member’s contribution.'
  ]
};

export type VerifiedCustomer = { id: string; email: string; name?: string };
export async function getVerifiedCustomer(req: Request): Promise<VerifiedCustomer | null> {
  const cookie = req.headers.get('cookie') || '';
  if (!cookie) return null;
  try {
    const response = await fetch(authBase + '/get-session', {
      headers: { cookie, origin: new URL(req.url).origin },
      cache: 'no-store',
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    const user = data?.user;
    if (!user?.id || !user?.email || user.emailVerified !== true) return null;
    return { id: String(user.id), email: String(user.email), name: String(user.name || '') };
  } catch {
    return null;
  }
}

export async function ensureLoyaltyTables() {
  await loyaltyPool.query(\`
    CREATE TABLE IF NOT EXISTS public.ebnimaam_loyalty_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      referrer_reward_kobo BIGINT NOT NULL DEFAULT 0 CHECK (referrer_reward_kobo >= 0),
      referred_reward_kobo BIGINT NOT NULL DEFAULT 0 CHECK (referred_reward_kobo >= 0),
      challenge_reward_kobo BIGINT NOT NULL DEFAULT 0 CHECK (challenge_reward_kobo >= 0),
      low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold BETWEEN 1 AND 500),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO public.ebnimaam_loyalty_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS public.ebnimaam_wallet_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('referral_reward','challenge_reward','refund_credit','bank_refund_request','wallet_spend')),
      amount_kobo BIGINT NOT NULL CHECK (amount_kobo <> 0),
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','pending','completed','rejected')),
      source_key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      private_details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ebnimaam_wallet_user_created_idx ON public.ebnimaam_wallet_ledger(user_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS public.ebnimaam_referral_codes (
      user_id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.ebnimaam_referrals (
      referred_user_id TEXT PRIMARY KEY,
      referrer_user_id TEXT NOT NULL,
      referral_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified')),
      paid_order_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      qualified_at TIMESTAMPTZ,
      CHECK (referred_user_id <> referrer_user_id)
    );
    CREATE INDEX IF NOT EXISTS ebnimaam_referrals_owner_idx ON public.ebnimaam_referrals(referrer_user_id,status);
    CREATE TABLE IF NOT EXISTS public.ebnimaam_coupons (
      code TEXT PRIMARY KEY,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
      discount_value BIGINT NOT NULL CHECK (discount_value > 0),
      minimum_subtotal_kobo BIGINT NOT NULL DEFAULT 0 CHECK (minimum_subtotal_kobo >= 0),
      max_redemptions INTEGER,
      per_user_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit BETWEEN 1 AND 100),
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.ebnimaam_coupon_redemptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL REFERENCES public.ebnimaam_coupons(code),
      user_id TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      discount_kobo BIGINT NOT NULL CHECK (discount_kobo > 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','released')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ebnimaam_coupon_redemptions_code_idx ON public.ebnimaam_coupon_redemptions(code,status);
    CREATE INDEX IF NOT EXISTS ebnimaam_coupon_redemptions_user_idx ON public.ebnimaam_coupon_redemptions(code,user_id,status);

    DO $
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='public.ebnimaam_wallet_ledger'::regclass
          AND conname='ebnimaam_wallet_ledger_entry_type_check'
          AND pg_get_constraintdef(oid) LIKE '%wallet_spend%'
      ) THEN
        ALTER TABLE public.ebnimaam_wallet_ledger DROP CONSTRAINT IF EXISTS ebnimaam_wallet_ledger_entry_type_check;
        ALTER TABLE public.ebnimaam_wallet_ledger ADD CONSTRAINT ebnimaam_wallet_ledger_entry_type_check
          CHECK (entry_type IN ('referral_reward','challenge_reward','refund_credit','bank_refund_request','wallet_spend'));
      END IF;
    END $;

    CREATE TABLE IF NOT EXISTS public.ebnimaam_challenge_teams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge_slug TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      leader_user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.ebnimaam_challenge_members (
      team_id UUID NOT NULL REFERENCES public.ebnimaam_challenge_teams(id) ON DELETE CASCADE,
      challenge_slug TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(team_id,user_id),
      UNIQUE(challenge_slug,user_id)
    );
    CREATE TABLE IF NOT EXISTS public.ebnimaam_challenge_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id UUID NOT NULL REFERENCES public.ebnimaam_challenge_teams(id) ON DELETE CASCADE,
      day_number INTEGER NOT NULL CHECK(day_number BETWEEN 1 AND 7),
      submitted_by TEXT NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      admin_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      UNIQUE(team_id,day_number)
    );
  \`);
}

function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('Secure bank-request storage is not configured.');
  return createHash('sha256').update('ebnimaam-wallet-bank-details:' + secret).digest();
}
export function encryptPrivateDetails(value: Record<string, string>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}
export function decryptPrivateDetails(value: any): Record<string, string> | null {
  try {
    if (!value || typeof value !== 'object' || !value.iv || !value.tag || !value.data) return null;
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(String(value.iv), 'base64'));
    decipher.setAuthTag(Buffer.from(String(value.tag), 'base64'));
    const decoded = Buffer.concat([decipher.update(Buffer.from(String(value.data), 'base64')), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function ensureReferralCode(userId: string) {
  const existing = await loyaltyPool.query('SELECT code FROM public.ebnimaam_referral_codes WHERE user_id=$1', [userId]);
  if (existing.rowCount) return String(existing.rows[0].code);
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = 'EBN' + randomBytes(4).toString('hex').toUpperCase();
    try {
      await loyaltyPool.query('INSERT INTO public.ebnimaam_referral_codes(user_id,code) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING', [userId, code]);
      const saved = await loyaltyPool.query('SELECT code FROM public.ebnimaam_referral_codes WHERE user_id=$1', [userId]);
      if (saved.rowCount) return String(saved.rows[0].code);
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
    }
  }
  throw new Error('A referral code could not be created. Please try again.');
}

export async function processPaidReferralOrder(reference: string) {
  if (!reference) return;
  await ensureLoyaltyTables();
  const qualified = await loyaltyPool.query(
    \`UPDATE public.ebnimaam_referrals r
     SET status='qualified',paid_order_reference=o.reference,qualified_at=NOW()
     FROM public.ebnimaam_orders o
     WHERE o.reference=$1 AND o.status='paid' AND o.auth_user_id=r.referred_user_id
       AND r.status='pending'
     RETURNING r.referred_user_id,r.referrer_user_id\`,
    [reference]
  );
  const settings = await loyaltyPool.query('SELECT referrer_reward_kobo,referred_reward_kobo FROM public.ebnimaam_loyalty_settings WHERE id=1');
  const inviterReward = Number(settings.rows[0]?.referrer_reward_kobo || 0);
  const inviteeReward = Number(settings.rows[0]?.referred_reward_kobo || 0);
  for (const referral of qualified.rows) {
    if (inviteeReward > 0) {
      await loyaltyPool.query(
        \`INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description)
         VALUES($1,'referral_reward',$2,'available',$3,$4) ON CONFLICT(source_key) DO NOTHING\`,
        [referral.referred_user_id, inviteeReward, 'referral-invitee:' + referral.referred_user_id, 'Welcome reward for a completed referral purchase']
      );
    }
  }
  const owners = await loyaltyPool.query(
    \`SELECT DISTINCT referrer_user_id FROM public.ebnimaam_referrals WHERE status='qualified' AND paid_order_reference=$1\`,
    [reference]
  );
  for (const owner of owners.rows) {
    const totals = await loyaltyPool.query(
      \`SELECT COUNT(*)::int AS qualified FROM public.ebnimaam_referrals WHERE referrer_user_id=$1 AND status='qualified'\`,
      [owner.referrer_user_id]
    );
    const tiers = Math.floor(Number(totals.rows[0]?.qualified || 0) / 5);
    for (let tier = 1; tier <= tiers; tier++) {
      if (inviterReward <= 0) continue;
      await loyaltyPool.query(
        \`INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description)
         VALUES($1,'referral_reward',$2,'available',$3,$4) ON CONFLICT(source_key) DO NOTHING\`,
        [owner.referrer_user_id, inviterReward, 'referral-inviter:' + owner.referrer_user_id + ':tier:' + tier, 'Reward for five referred customers completing paid orders']
      );
    }
  }
}

export async function processAllQualifiedReferralRewards() {
  await ensureLoyaltyTables();
  const rows = await loyaltyPool.query(
    \`SELECT DISTINCT r.paid_order_reference AS reference
     FROM public.ebnimaam_referrals r
     JOIN public.ebnimaam_orders o ON o.reference=r.paid_order_reference
     WHERE r.status='qualified' AND o.status='paid' LIMIT 200\`
  );
  for (const row of rows.rows) await processPaidReferralOrder(String(row.reference || ''));
  const settings = await loyaltyPool.query('SELECT referrer_reward_kobo,referred_reward_kobo FROM public.ebnimaam_loyalty_settings WHERE id=1');
  const inviterReward = Number(settings.rows[0]?.referrer_reward_kobo || 0);
  const inviteeReward = Number(settings.rows[0]?.referred_reward_kobo || 0);
  if (inviteeReward > 0) {
    await loyaltyPool.query(
      \`INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description)
       SELECT r.referred_user_id,'referral_reward',$1,'available','referral-invitee:'||r.referred_user_id,'Welcome reward for a completed referral purchase'
       FROM public.ebnimaam_referrals r WHERE r.status='qualified'
       ON CONFLICT(source_key) DO NOTHING\`,
      [inviteeReward]
    );
  }
  if (inviterReward > 0) {
    const owners = await loyaltyPool.query(
      \`SELECT referrer_user_id,COUNT(*)::int AS qualified FROM public.ebnimaam_referrals WHERE status='qualified' GROUP BY referrer_user_id\`
    );
    for (const owner of owners.rows) {
      const tiers = Math.floor(Number(owner.qualified || 0) / 5);
      for (let tier = 1; tier <= tiers; tier++) {
        await loyaltyPool.query(
          \`INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description)
           VALUES($1,'referral_reward',$2,'available',$3,$4) ON CONFLICT(source_key) DO NOTHING\`,
          [owner.referrer_user_id, inviterReward, 'referral-inviter:' + owner.referrer_user_id + ':tier:' + tier, 'Reward for five referred customers completing paid orders']
        );
      }
    }
  }
}
