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
      await pool.query('ALTER TABLE public.ebnimaam_game_attempts ADD COLUMN IF NOT EXISTS stage SMALLINT NOT NULL DEFAULT 1');
      await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_game_user_day_idx ON public.ebnimaam_game_attempts(user_id,created_at DESC)');
    }).then(() => undefined).catch((error) => {
      gameSchemaReady = null;
      throw error;
    });
  }
  await gameSchemaReady;
}

function makePuzzle(stage: number) {
  const start = randomInt(7, 24);
  const sequence = [start];
  let answer = 0;
  let distractors: number[] = [];

  if (stage === 1) {
    // Genin: two interleaved arithmetic progressions of gaps.
    const gapA = randomInt(4, 10);
    const gapB = randomInt(9, 16);
    const growthA = randomInt(3, 6);
    const growthB = randomInt(2, 5);
    for (let step = 0; step < 8; step += 1) {
      const pair = Math.floor(step / 2);
      const gap = step % 2 === 0 ? gapA + growthA * pair : gapB + growthB * pair;
      sequence.push(sequence[sequence.length - 1] + gap);
    }
    const nextGap = gapA + growthA * 4;
    answer = sequence[sequence.length - 1] + nextGap;
    distractors = [
      sequence[sequence.length - 1] + gapB + growthB * 4,
      answer - growthA,
      answer + growthB,
      answer + growthA + growthB,
    ];
  } else if (stage === 2) {
    // Chunin: three interleaved arithmetic progressions of gaps.
    const starts = [randomInt(3, 8),randomInt(8, 14),randomInt(14, 21)];
    const growths = [randomInt(3, 6),randomInt(2, 5),randomInt(4, 7)];
    for (let step = 0; step < 9; step += 1) {
      const lane = step % 3;
      const cycle = Math.floor(step / 3);
      const gap = starts[lane] + growths[lane] * cycle;
      sequence.push(sequence[sequence.length - 1] + gap);
    }
    const nextGap = starts[0] + growths[0] * 3;
    answer = sequence[sequence.length - 1] + nextGap;
    distractors = [
      sequence[sequence.length - 1] + starts[1] + growths[1] * 3,
      sequence[sequence.length - 1] + starts[2] + growths[2] * 3,
      answer - growths[0],
      answer + growths[1] + growths[2],
    ];
  } else {
    // Shadow Boss: Fibonacci-style recurrence with a growing alternating offset.
    const offsetBase = randomInt(2, 6);
    const growth = randomInt(2, 4);
    const evenOffset = randomInt(1, 4);
    const oddOffset = randomInt(4, 8);
    sequence.push(start + randomInt(5, 13));
    const offsetFor = (termIndex:number) => offsetBase + Math.floor((termIndex - 2) / 2) * growth + (termIndex % 2 === 0 ? evenOffset : oddOffset);
    for (let termIndex = 2; termIndex <= 8; termIndex += 1) {
      sequence.push(sequence[termIndex - 1] + sequence[termIndex - 2] + offsetFor(termIndex));
    }
    const nextOffset = offsetFor(9);
    answer = sequence[8] + sequence[7] + nextOffset;
    distractors = [
      sequence[8] + sequence[7] + offsetFor(8),
      sequence[8] + sequence[6] + nextOffset,
      sequence[8] * 2 + nextOffset,
      answer + growth,
    ];
  }

  const choices = new Set<number>([answer]);
  for (const option of distractors) if (Number.isSafeInteger(option) && option > 0 && option !== answer) choices.add(option);
  while (choices.size < 4) {
    const candidate = answer + (randomInt(0, 2) ? 1 : -1) * randomInt(3, 26);
    if (candidate > 0 && candidate !== answer) choices.add(candidate);
  }
  const options = Array.from(choices).slice(0,4);
  for (let index = options.length - 1; index > 0; index -= 1) {
    const swap = randomInt(0, index + 1);
    [options[index], options[swap]] = [options[swap], options[index]];
  }
  const meta = stage === 1
    ? { stageName:'Genin Trial', opponent:'The Academy Gatekeeper', mission:'Read both alternating growth patterns and predict the next seal.' }
    : stage === 2
      ? { stageName:'Chunin Trial', opponent:'The Three-Tail Strategist', mission:'Track three separate gap progressions across the sequence.' }
      : { stageName:'Shadow Boss', opponent:'The Eclipse Master', mission:'Unravel the growing recurrence. Every term carries information from the previous two.' };
  return { sequence, options, answer, stage, ...meta };
}

async function getRewardStatus(userId: string) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM public.ebnimaam_game_attempts WHERE user_id=$1 AND created_at >= ${NIGERIA_DAY_START}) AS attempts,
       (SELECT COUNT(*)::int FROM public.ebnimaam_game_attempts WHERE user_id=$1 AND created_at >= ${NIGERIA_DAY_START} AND result='won') AS stages_cleared,
       EXISTS(SELECT 1 FROM public.ebnimaam_wallet_ledger WHERE user_id=$1 AND entry_type='game_reward' AND direction='credit' AND created_at >= ${NIGERIA_DAY_START}) AS rewarded,
       (SELECT game_reward_kobo FROM public.ebnimaam_loyalty_settings WHERE id=1) AS reward_kobo`,
    [userId],
  );
  return {
    attempts: Number(result.rows[0]?.attempts || 0),
    stagesCleared: Number(result.rows[0]?.stages_cleared || 0),
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
    if (status.stagesCleared >= 3) {
      return NextResponse.json({ completedAll: true, rewardedToday: status.rewarded, attemptsLeft: Math.max(0, MAX_ATTEMPTS_PER_DAY - status.attempts) }, { headers: { 'cache-control': 'no-store' } });
    }
    if (status.attempts >= MAX_ATTEMPTS_PER_DAY) {
      return NextResponse.json({ error: status.stagesCleared ? 'Your daily attempts are complete. Return tomorrow to continue your trials.' : 'You have used all three attempts for today. Come back tomorrow.', attemptsLeft: 0 }, { status: 429 });
    }
    const stage = Math.min(3, status.stagesCleared + 1);
    const puzzle = makePuzzle(stage);
    const attemptId = randomUUID();
    await pool.query(
      `INSERT INTO public.ebnimaam_game_attempts(id,user_id,sequence,options,answer,expires_at,stage)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,NOW()+INTERVAL '5 minutes',$6)`,
      [attemptId, user.id, JSON.stringify(puzzle.sequence), JSON.stringify(puzzle.options), puzzle.answer, stage],
    );
    return NextResponse.json({
      attemptId,
      sequence: puzzle.sequence,
      stage: puzzle.stage,
      stageName: puzzle.stageName,
      opponent: puzzle.opponent,
      mission: puzzle.mission,
      options: puzzle.options,
      rewardKobo: status.rewarded ? 0 : status.rewardKobo,
      alreadyRewardedToday: status.rewarded,
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
      'SELECT id,options,answer,expires_at,completed_at,stage FROM public.ebnimaam_game_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [attemptId, user.id],
    );
    if (!found.rowCount) throw new Error('This challenge was not found. Start a new one.');
    const attempt = found.rows[0];
    if (attempt.completed_at) throw new Error('This challenge has already been submitted. Start a new one.');
    if (new Date(attempt.expires_at).getTime() < Date.now()) {
      await client.query("UPDATE public.ebnimaam_game_attempts SET completed_at=NOW(),result='expired' WHERE id=$1", [attemptId]);
      await client.query('COMMIT');
    const updatedStatus = await getRewardStatus(user.id);
    return NextResponse.json({
      correct,
      stage: Number(attempt.stage||1),
      answer: Number(attempt.answer),
      rewardKobo,
      alreadyRewarded,
      stagesCleared: updatedStatus.stagesCleared,
      attemptsLeft: Math.max(0,MAX_ATTEMPTS_PER_DAY-updatedStatus.attempts),
      completedAll: updatedStatus.stagesCleared >= 3,
      message: correct ? 'Correct answer.' : 'Not quite. Try another challenge.',
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    return NextResponse.json({ error: error?.message || 'The answer could not be checked.' }, { status: 400 });
  } finally {
    client.release();
  }
}
