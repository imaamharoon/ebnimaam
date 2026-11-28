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

const GAME_TYPES = new Set(['pattern-vault','matrix-master','cipher-breaker','prime-labyrinth','logic-lock']);
function shuffle<T>(values:T[]):T[] {
  const list=[...values];
  for(let i=list.length-1;i>0;i-=1){const j=randomInt(0,i+1);[list[i],list[j]]=[list[j],list[i]]}
  return list;
}
function makeIndexedPuzzle(type:string,puzzle:any,answerLabel:string|number,allChoices:(string|number)[]) {
  const choices=shuffle(Array.from(new Set(allChoices.map(String))));
  const answer=choices.indexOf(String(answerLabel));
  if(answer<0||choices.length!==4)throw new Error('Could not create a valid challenge.');
  const fullPuzzle={...puzzle,choices};
  return {sequence:{type,puzzle:fullPuzzle},options:[0,1,2,3],answer,puzzle:fullPuzzle};
}
function makePuzzle(type='pattern-vault') {
  if(type==='pattern-vault'){
    const start=randomInt(2,12),firstGap=randomInt(3,9),gapGrowth=randomInt(2,5);
    const sequence=[start];let gap=firstGap;
    for(let index=0;index<5;index+=1){sequence.push(sequence[sequence.length-1]+gap);gap+=gapGrowth}
    const answer=sequence[sequence.length-1]+gap;
    const choices=new Set<number>([answer]);
    const offsets=[gapGrowth,gapGrowth*2,firstGap+gapGrowth,firstGap*2];
    while(choices.size<4){const offset=offsets[randomInt(0,offsets.length)];choices.add(Math.max(1,answer+(randomInt(0,2)?offset:-offset)))}
    const options=shuffle(Array.from(choices));
    return {sequence,options,answer,puzzle:{
      type,title:'Pattern Vault',prompt:'Study the progression and identify the next value.',
      instructions:'The gap changes by a constant amount each time. Calculate the differences before choosing.',
      display:sequence.join('   ·   ')+'   ·     ?',choices:options.map(String),
      explanation:'The gap increases by '+gapGrowth+' each step. The final gap is '+gap+'.'
    }};
  }
  if(type==='matrix-master'){
    const base=randomInt(4,16),vertical=randomInt(4,9),verticalGrowth=randomInt(1,3),horizontal=randomInt(2,6),horizontalGrowth=randomInt(1,2);
    const value=(r:number,c:number)=>base+r*vertical+(r*(r-1)/2)*verticalGrowth+c*horizontal+(c*(c-1)/2)*horizontalGrowth;
    const answer=value(2,2);
    const grid=Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>r===2&&c===2?'?':String(value(r,c))));
    return makeIndexedPuzzle(type,{
      type,title:'Matrix Master',prompt:'Complete the missing corner of the number matrix.',
      instructions:'Moving right, the horizontal step increases by '+horizontalGrowth+'. Moving down, the vertical step increases by '+verticalGrowth+'. Work both patterns together.',
      display:'Complete the final square.',grid,
      clues:['Across: first step '+horizontal+', then +'+(horizontal+horizontalGrowth)+'.','Down: first step '+vertical+', then +'+(vertical+verticalGrowth)+'.'],
      explanation:'The missing value is '+answer+'. Both horizontal and vertical increments grow on the second step.'
    },answer,[answer,answer+horizontalGrowth+2,answer-vertical,answer+verticalGrowth+horizontal]);
  }
  if(type==='cipher-breaker'){
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ',start=randomInt(0,26),jumps=[3,5,7,9,11];
    let value=start;const letters=[alphabet[value]];
    for(let i=0;i<4;i+=1){value=(value+jumps[i])%26;letters.push(alphabet[value])}
    const answer=alphabet[(value+jumps[4])%26];
    const distractors=[1,2,4].map(offset=>alphabet[(alphabet.indexOf(answer)+offset)%26]);
    return makeIndexedPuzzle(type,{
      type,title:'Cipher Breaker',prompt:'Decrypt the next character in the sequence.',
      instructions:'Treat A as 0 and Z as 25. Each forward jump is an odd number and grows by two each time. The alphabet wraps after Z.',
      display:letters.join('   ·   ')+'   ·     ?',
      clues:['Decode the shift pattern.','Remember: Z wraps back to A.'],
      explanation:'The shifts are +3, +5, +7, +9 and +11. The next character is '+answer+'.'
    },answer,[answer,...distractors]);
  }
  if(type==='prime-labyrinth'){
    const primes=[2,3,5,7,11,13,17,19,23,29,31,37],offset=randomInt(0,6);
    const pairs=Array.from({length:4},(_,i)=>primes[offset+i]*primes[offset+i+1]);
    const answer=primes[offset+4]*primes[offset+5];
    return makeIndexedPuzzle(type,{
      type,title:'Prime Labyrinth',prompt:'Find the next product in the prime-number chain.',
      instructions:'Each term is the product of two consecutive prime numbers. The second factor of one term becomes the first factor of the next.',
      display:pairs.join('   ·   ')+'   ·     ?',
      clues:['Find the consecutive prime factors.','Each pair overlaps with the next pair.'],
      explanation:'The prime chain continues with '+primes[offset+4]+' × '+primes[offset+5]+' = '+answer+'.'
    },answer,[answer,answer+2,answer-2,answer+primes[offset+4]]);
  }
  if(type==='logic-lock'){
    const tens=randomInt(2,6),hundreds=tens+4,units=tens+1;
    const answer=hundreds*100+tens*10+units,sum=hundreds+tens+units;
    const candidates=[answer,units*100+hundreds*10+tens,hundreds*100+units*10+tens,(hundreds-1)*100+tens*10+(units+1)];
    const unique=Array.from(new Set(candidates.map(String)));
    while(unique.length<4)unique.push(String(answer+unique.length*11));
    return makeIndexedPuzzle(type,{
      type,title:'Logic Lock',prompt:'Crack the three-digit vault code using all four clues.',
      instructions:'The digits are distinct and none is zero. The hundreds digit is four greater than the tens digit. The units digit is one greater than the tens digit. All three digits add up to '+sum+'.',
      display:'?  ?  ?',
      clues:['Three different digits; no zero.','Hundreds = tens + 4.','Units = tens + 1.','Digit sum = '+sum+'.'],
      explanation:'The tens digit is '+tens+', so the code is '+answer+'.'
    },answer,unique);
  }
  throw new Error('Choose one of the five available games.');
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
    const requestedType = new URL(req.url).searchParams.get('type') || 'pattern-vault';
    const gameType = GAME_TYPES.has(requestedType) ? requestedType : 'pattern-vault';
    if (status.rewarded) {
      return NextResponse.json({ rewardedToday: true, gameType, rewardKobo: status.rewardKobo, attemptsLeft: Math.max(0, MAX_ATTEMPTS_PER_DAY - status.attempts) }, { headers: { 'cache-control': 'no-store' } });
    }
    if (status.attempts >= MAX_ATTEMPTS_PER_DAY) {
      return NextResponse.json({ error: 'You have used all three attempts for today. Come back tomorrow.', attemptsLeft: 0 }, { status: 429 });
    }
    const puzzle = makePuzzle(gameType);
    const attemptId = randomUUID();
    await pool.query(
      `INSERT INTO public.ebnimaam_game_attempts(id,user_id,sequence,options,answer,expires_at)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,NOW()+INTERVAL '5 minutes')`,
      [attemptId, user.id, JSON.stringify(puzzle.sequence), JSON.stringify(puzzle.options), puzzle.answer],
    );
    return NextResponse.json({
      attemptId,
      gameType,
      puzzle: puzzle.puzzle,
      sequence: Array.isArray(puzzle.sequence) ? puzzle.sequence : [],
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
      'SELECT id,sequence,options,answer,expires_at,completed_at FROM public.ebnimaam_game_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',
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
          description: 'Daily Ebnimaam Mind Arena reward',
          metadata: { attemptId, game: (attempt.sequence && !Array.isArray(attempt.sequence) ? String(attempt.sequence.type||'pattern-vault') : 'pattern-vault'), storeOnly: true },
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
    const storedPuzzle = attempt.sequence && !Array.isArray(attempt.sequence) ? attempt.sequence.puzzle : null;
    const answerIndex = Number(attempt.answer);
    const answerLabel = Array.isArray(storedPuzzle?.choices) ? storedPuzzle.choices[answerIndex] : answerIndex;
    return NextResponse.json({
      correct,
      answer: answerIndex,
      answerLabel,
      explanation: String(storedPuzzle?.explanation||''),
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
