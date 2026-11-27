import { NextResponse } from 'next/server';
import { randomInt, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { addWalletEntry, ensureLoyaltySchema, getVerifiedCustomer } from '../../../lib/loyalty';
import { checkRateLimit } from '../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const MAX_ATTEMPTS_PER_DAY = 3;
const NIGERIA_DAY_START = "(date_trunc('day', NOW() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos')";
let gameSchemaReady: Promise<void> | null = null;

async function ensureGameSchema() {
  if (!gameSchemaReady) {
    gameSchemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS public.ebnimaam_game_attempts(
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        sequence JSONB NOT NULL,
        options JSONB NOT NULL,
        answer INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        result TEXT CHECK(result IN ('won','miss','expired'))
      )
    `).then(async () => {
      await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_game_user_day_idx ON public.ebnimaam_game_attempts(user_id,created_at DESC)');
    }).then(() => undefined).catch((error) => {
      gameSchemaReady = null;
      throw error;
    });
  }
  await gameSchemaReady;
}

function makePuzzle() {
  const start = randomInt(2, 12);
  const firstGap = randomInt(3, 9);
  const gapGrowth = randomInt(2, 5);
  const sequence = [start];
  let gap = firstGap;
  for (let index = 0; index < 5; index += 1) {
    sequence.push(sequence[sequence.length - 1] + gap);
    gap += gapGrowth;
  }
  const answer = sequence[sequence.length - 1] + gap;
  const choices = new Set<number>([answer]);
  const offsets = [gapGrowth, gapGrowth * 2, firstGap + gapGrowth, firstGap * 2];
  while (choices.size < 4) {
    const offset = offsets[randomInt(0, offsets.length)];
    choices.add(Math.max(1, answer + (randomInt(0, 2) ? offset : -offset)));
  }
  const options = [...choices];
  for (let index = options.length - 1; index > 0; index -= 1) {
    const swap = randomInt(0, index + 1);
    [options[index], options[swap]] = [options[swap], options[index]];
  }
  return { sequence, options, answer };
}

async function getRewardStatus(userId: string) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM public.ebnimaam_game_attempts WHERE user_id=$1 AND created_at >= ${NIGERIA_DAY_START}) AS attempts,
       EXISTS(SELECT 1 FROM public.ebnimaam_wallet_ledger WHERE user_id=$1 AND entry_type='game_reward' AND direction='credit' AND created_at >= ${NIGERIA_DAY_START}) AS rewarded,
       (SELECT game_reward_kobo FROM public.ebnimaam_loyalty_settings WHERE id=1) AS reward_kobo`,
    [userId],
  );
  return {
    attempts: Number(result.rows[0]?.attempts || 0),
    rewarded: result.rows[0]?.rewarded === true,
    rewardKobo: Number(result.rows[0]?.reward_kobo ?? 5000),
  };
}

export async function GET(req: Request) {
  try {
    const user = await getVerifiedCustomer(req);
    if (!user) return NextResponse.json({ error: 'Sign in with your verified account to play and earn rewards.' }, { status: 401 });
    if (!(await checkRateLimit(req, 'daily-pattern-game-start', 20, 900))) {
      return NextResponse.json({ error: 'Too many game requests. Please try again shortly.' }, { status: 429 });
    }
    await ensureLoyaltySchema(pool);
    await ensureGameSchema();
    const status = await getRewardStatus(user.id);
    if (status.rewarded) {
      return NextResponse.json({ rewardedToday: true, rewardKobo: status.rewardKobo, attemptsLeft: Math.max(0, MAX_ATTEMPTS_PER_DAY - status.attempts) }, { headers: { 'cache-control': 'no-store' } });
    }
    if (status.attempts >= MAX_ATTEMPTS_PER_DAY) {
      return NextResponse.json({ error: 'You have used all three attempts for today. Come back tomorrow.', attemptsLeft: 0 }, { status: 429 });
    }
    const puzzle = makePuzzle();
    const attemptId = randomUUID();
    await pool.query(
      `INSERT INTO public.ebnimaam_game_attempts(id,user_id,sequence,options,answer,expires_at)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,NOW()+INTERVAL '5 minutes')`,
      [attemptId, user.id, JSON.stringify(puzzle.sequence), JSON.stringify(puzzle.options), puzzle.answer],
    );
    return NextResponse.json({
      attemptId,
      sequence: puzzle.sequence,
      options: puzzle.options,
      rewardKobo: status.rewardKobo,
      attemptsLeft: MAX_ATTEMPTS_PER_DAY - status.attempts - 1,
      expiresInSeconds: 300,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'The daily challenge is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const user = await getVerifiedCustomer(req);
  if (!user) return NextResponse.json({ error: 'Sign in with your verified account to submit a game answer.' }, { status: 401 });
  if (!(await checkRateLimit(req, 'daily-pattern-game-answer', 20, 900))) {
    return NextResponse.json({ error: 'Too many answer attempts. Please try again shortly.' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const attemptId = String(body?.attemptId || '').trim();
  const answer = Number(body?.answer);
  if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !Number.isSafeInteger(answer)) {
    return NextResponse.json({ error: 'Choose one of the four displayed answers.' }, { status: 400 });
  }
  await ensureLoyaltySchema(pool);
  await ensureGameSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT id,options,answer,expires_at,completed_at FROM public.ebnimaam_game_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [attemptId, user.id],
    );
    if (!found.rowCount) throw new Error('This challenge was not found. Start a new one.');
    const attempt = found.rows[0];
    if (attempt.completed_at) throw new Error('This challenge has already been submitted. Start a new one.');
    if (new Date(attempt.expires_at).getTime() < Date.now()) {
      await client.query("UPDATE public.ebnimaam_game_attempts SET completed_at=NOW(),result='expired' WHERE id=$1", [attemptId]);
      await client.query('COMMIT');
      return NextResponse.json({ error: 'This challenge expired. Start a new one.' }, { status: 410 });
    }
    const options = Array.isArray(attempt.options) ? attempt.options.map(Number) : [];
    if (!options.includes(answer)) throw new Error('Choose one of the four displayed answers.');
    const correct = Number(attempt.answer) === answer;
    let rewardKobo = 0;
    let alreadyRewarded = false;
    if (correct) {
      const settings = await client.query('SELECT game_reward_kobo FROM public.ebnimaam_loyalty_settings WHERE id=1');
      const configuredReward = Number(settings.rows[0]?.game_reward_kobo || 0);
      const priorReward = await client.query(
        `SELECT 1 FROM public.ebnimaam_wallet_ledger
         WHERE user_id=$1 AND entry_type='game_reward' AND direction='credit' AND created_at >= ${NIGERIA_DAY_START} LIMIT 1`,
        [user.id],
      );
      alreadyRewarded = Boolean(priorReward.rowCount);
      if (!alreadyRewarded && configuredReward > 0) {
        const day = await client.query("SELECT to_char((NOW() AT TIME ZONE 'Africa/Lagos')::date,'YYYYMMDD') AS day_key");
        rewardKobo = configuredReward;
        await addWalletEntry(client, {
          userId: user.id,
          entryType: 'game_reward',
          direction: 'credit',
          amountKobo: rewardKobo,
          reference: 'game-reward-' + String(day.rows[0]?.day_key || 'today') + '-' + user.id,
          description: 'Daily Pattern Challenge reward',
          metadata: { attemptId, game: 'daily-pattern-challenge', storeOnly: true },
        });
      } else if (alreadyRewarded) {
        rewardKobo = 0;
      }
    }
    await client.query(
      "UPDATE public.ebnimaam_game_attempts SET completed_at=NOW(),result=$1 WHERE id=$2",
      [correct ? 'won' : 'miss', attemptId],
    );
    await client.query('COMMIT');
    return NextResponse.json({
      correct,
      answer: Number(attempt.answer),
      rewardKobo,
      alreadyRewarded,
      message: correct ? 'Correct answer.' : 'Not quite. Try another challenge.',
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    return NextResponse.json({ error: error?.message || 'The answer could not be checked.' }, { status: 400 });
  } finally {
    client.release();
  }
}
