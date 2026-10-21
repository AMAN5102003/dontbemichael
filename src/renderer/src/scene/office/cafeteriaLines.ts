// The studio's idle talk, The Office edition (branding/DESIGN.md 8.8).
//
// The cast ARE Dunder Mifflin (see cast.ts), so a quiet team member says a line
// in character. Two kinds:
//   * solo: one line on the speaker's chip. createIdleLines deals the
//     speaker's own lines about 60% of the time, else a break-room line
//     (SHARED_SOLO), never repeating until a pool runs out.
//   * pair: an exchange two quiet people trade as paper planes.
//     createBanter deals EXCHANGES, the "that's what she said" bits and each
//     character's signature opener, and only to a pair who would say them on
//     the show: Michael lands "that's what she said", Andy went to Cornell.
//
// Lines are kept short for the 250 px quote bubble. Character keys match
// OfficeCharacterName.

import type { OfficeCharacterName } from './cast';

// ─── solo lines, by spot ─────────────────────────────────────────────────────

const COFFEE: readonly string[] = [
  'is this… decaf?? who did this',
  "we're out of beans again",
  'World’s Best Boss mug',
  'first cup of the day. and the fifth.',
  'the coffee here is basically a hug',
  'who took my mug?',
];

const VENDING: readonly string[] = [
  'the machine ate my dollar',
  'B4… please be the pretzels',
  'it’s stuck. classic.',
  'shaking it. gently. respectfully.',
  'one (1) emotional-support snack',
  'A1 again. living dangerously.',
];

const SNACK: readonly string[] = [
  'is it Pretzel Day?',
  'who finished the chips??',
  'just a little treat',
  'these are everyone’s? cool cool cool',
  'second breakfast',
];

const TABLE: readonly string[] = [
  'big day. lots of meetings.',
  'just five more minutes',
  'did you see the standup notes?',
  'pretending to read my notes',
  'I needed this break, honestly',
  'do NOT tell Michael I’m in here',
];

// ─── character flavour — overrides the generic pool when present ─────────────

// Every character has lines of their own (owner, 2026-09-27: "add some for
// everyone"), written in each one's voice from what the show established.
// Darryl, Erin, Nick and Sadiq were added to this app later, and Pete, the
// Research member's face, after them: his lines come from his season 9 story
// (Andy's "Plop", "New Jim", Die Hard for Erin, Poor Richard's; owner,
// 2026-10-13, D1), not from his Research job.
const BY_CHARACTER: Record<OfficeCharacterName, readonly string[]> = {
  michael:  ['I DECLARE… BANKRUPTCY!', "that's what she said", "I'm not superstitious. just a little stitious.", 'no meetings before coffee. that’s the rule.', 'it says World’s Best Boss. on the mug. so.', 'who wants to hear an improv bit?'],
  dwight:   ['FALSE.', 'identity theft is not a joke', 'that mug is regulation', 'this fridge needs a beet drawer', 'Schrute Farms has better coffee', 'I am fully trained in break room safety', 'assistant TO the regional coffee'],
  jim:      ["...that's what she said", 'bears. beets. Battlestar Galactica.', 'I moved Dwight’s stapler again', 'just here for the gossip', 'stapler. jello. you know the drill.', 'looks at camera'],
  pam:      ['Dunder Mifflin, this is Pam', 'sketching the vending machine', 'the watercolor of the break room', 'I’d rather be painting right now', 'did Jim hide Dwight’s stuff again?'],
  kevin:    ['the chili is NOT ready', 'why waste time say lot word', 'me want snack', 'cookie? cookie.', 'M&Ms count as a food group', 'I only eat the red ones today'],
  angela:   ['this break room is filthy', 'party planning committee, 3pm', 'I’m judging the fridge', 'my cats have better manners', 'who microwaved fish. who.'],
  oscar:    ['actually, it’s “espresso”', 'well, actually…', 'the budget for snacks is concerning', 'I read the ingredients. all of them.', 'that is not how interest works'],
  stanley:  ['is it Pretzel Day?', 'did I stutter?', 'crossword and coffee. leave me be.', "I'll retire before this brews", 'I do crosswords in meetings. and here.'],
  phyllis:  ['Bob is picking me up at five', 'knitting and a nice cup of tea', 'Bob Vance, Vance Refrigeration', 'Christmas party planning starts now'],
  andy:     ['Cornell, ever heard of it?', 'rit-dit-dit, coffee break!', 'Big Tuna, grab a chair', 'I sang a cappella, you know', 'Nard Dog needs caffeine'],
  kelly:    ['did you HEAR what happened??', 'so. much. to tell you.', 'I am the GOSSIP queen', 'Ryan texted me back!!', 'okay who is dating who'],
  ryan:     ['I’m kind of a big deal', 'the temp needs caffeine', 'starting a coffee startup, actually', 'this could be an app', 'I pitched this idea in business school'],
  pete:     ['Andy still calls me Plop. please don’t.', 'I can do all of Die Hard. every line.', 'customer service. how can I help?', 'everyone keeps calling me New Jim', 'Poor Richard’s after work, anyone?', 'yippee ki yay, coffee machine'],
  toby:     ['I should write that up…', 'HR-wise this break is fine', 'no one ever sits with me', 'please don’t tell Michael I’m in here', 'I miss Costa Rica'],
  creed:    ['which one of you is the new guy?', 'I’ve eaten worse out of that fridge', 'mung beans. under my desk.', 'nobody steals from Creed', 'I sprout my beans on a damp towel'],
  meredith: ['is it 5 o’clock yet?', 'someone spike the coffee?', 'I brought my own mug. don’t ask.', 'my kid says hi'],
  darryl:   ['forklift parked. break is sacred.', 'the warehouse fridge is cleaner', 'working on a new song at home', 'dream job: a cereal shack', 'Michael asked me for slang again', 'upstairs coffee. fancy.'],
  erin:     ['is there cake? I love when there’s cake', 'I made a new friend at the coffee machine', 'everyone here is basically family', 'Kelly was taken, so I’m Erin', 'today feels like a party day', 'is a vending snack a meal?'],
  nick:     ['it’s Nick. the IT guy. hi.', 'tried turning it off and on?', 'I can see your browser history', 'nobody remembers my name', 'stop clicking the free cruise emails'],
  sadiq:    ['your password isn’t “password”, right?', 'removed another virus. kids game site.', 'I set up security, not spying. mostly.', 'the phishing test results… wow', 'every day is patch day'],
};


/** A shuffled deck over `pool`: every item once, then a fresh shuffle that
 *  never opens with the one just drawn. `fits` skips what this draw cannot
 *  use and leaves it in the deck; when nothing left fits, the deck is
 *  reshuffled, and undefined means nothing in the pool fits at all. */
function deck<T>(pool: readonly T[], random: () => number): (fits?: (item: T) => boolean) => T | undefined {
  let bag: T[] = [];
  let last: T | undefined;
  const refill = () => {
    bag = [...pool];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  };
  const find = (fits: (item: T) => boolean) => {
    for (let i = bag.length - 1; i >= 0; i--) if (fits(bag[i])) return i;
    return -1;
  };
  return (fits = () => true) => {
    if (!bag.length) refill();
    let i = find(fits);
    if (i < 0) { refill(); i = find(fits); }
    if (i < 0) return undefined;
    last = bag.splice(i, 1)[0];
    return last;
  };
}

/** Every break-room line, whoever says it. */
const SHARED_SOLO: readonly string[] = [...COFFEE, ...VENDING, ...SNACK, ...TABLE];

/**
 * The studio's idle lines (DESIGN.md 8.8), from this file's Office lines only
 * (owner, 2026-10-01: "dont show made up lines"): the speaker's own about 60%
 * of the time, else a break-room line, and nothing comes back until its pool
 * has run out. One per studio; `random` is there for tests.
 */
export function createIdleLines(random: () => number = Math.random): (character: OfficeCharacterName) => string {
  const own = new Map<string, () => string | undefined>();
  const shared = deck(SHARED_SOLO, random);
  return (character) => {
    const lines = BY_CHARACTER[character];
    // A break-room line never names its own speaker (no "do NOT tell Michael" from Michael).
    if (!lines?.length || random() >= 0.6) return shared((line) => !line.toLowerCase().includes(character))!;
    if (!own.has(character)) own.set(character, deck(lines, random));
    return own.get(character)!()!;
  };
}

// ─── paired exchanges (two agents at one table) ──────────────────────────────
//
// Each exchange is a list of beats that ALTERNATE between the two people:
// beat[0] = the one who opens, beat[1] = the other, beat[2] = the opener again,
// and so on. The studio plays them out one beat at a time.
//
// A plain list can be said by anyone. A Bit says who may say each side
// (a = the opener, b = the other) when the lines belong to someone on the
// show: Michael's "that's what she said", Dwight's beets, Andy's Cornell.

type Exchange = readonly string[];
type Cast = readonly OfficeCharacterName[];
/** `not`: nobody here says either side (a line that names them). */
type Bit = { beats: Exchange; a?: Cast; b?: Cast; not?: Cast };
type Line = Exchange | Bit;

const bit = (beats: Exchange, who: { a?: Cast; b?: Cast; not?: Cast }): Bit => ({ beats, ...who });

// Banter between any two agents (they're all Dunder Mifflin), unless a Bit says who.
const EXCHANGES: readonly Line[] = [
  bit(['world’s best boss.', 'you are. I had the mug made.', 'and I cherish it.'], { a: ['michael'] }),
  bit(['would an idiot do this?', '...if yes, I don’t.', 'that’s my boy.'], { a: ['michael'], b: ['dwight'] }),
  bit(['feared or loved? both.', 'that’s beautiful.', 'I know.'], { a: ['michael'] }),
  ['I edited your wiki page again.', 'I know. thank you.'],
  bit(['question. how many bears?', 'one.', 'that’s too many.'], { a: ['dwight', 'jim'] }),
  bit(['fact: bears eat beets.', 'bears. beets. Galactica.', 'what is happening.'], { a: ['dwight'], b: ['jim'] }),
  bit(['I grew up on a beet farm.', 'shocking.', '...not shocking at all.'], { a: ['dwight'] }),
  bit(['what’s Schrute Farms smell like?', 'victory. and beets.'], { b: ['dwight'] }),
  ['did you just throw your phone?', 'didn’t like what it said.', 'cool.'],
  ['is a hot dog a sandwich?', 'it is.', 'I know, right?'],
  bit(['three-hole-punch Jim returns.', 'never gets old.'], { a: ['jim'] }),
  bit(['why few word when lot word?', '...genuinely profound.', 'I know.'], { a: ['kevin'] }),
  ['I am not a bad person.', '...', 'not a great person either.', 'there it is.'],
  bit(['I love my cats more than people.', 'including us?', 'especially you.'], { a: ['angela'] }),
  bit(['cats are better than dogs.', 'dogs are better.', '...sorry.'], { a: ['angela'] }),
  ['do you love me?', 'I love… being here.', 'that’s a yes.'],
  bit(['I’m kind of a big deal.', 'you are?', 'in my mind. yes.'], { a: ['ryan'] }),
  ['did you miss me?', 'no.', 'a little?', '...there it is.'],
  ['did you just roll your eyes?', 'I did.', 'why?', 'muscle memory.'],
  bit(['I’ve watched that clock since 4.', 'weren’t you working?', 'watching the clock.'], { a: ['stanley'] }),
  bit(['what do we sell again?', 'paper.', 'sure, yeah.'], { a: ['creed'] }),
  bit(['how old are you?', 'yeah.', 'that’s not an answer.', 'sure it is.'], { b: ['creed'] }),
  bit(['that’s not how math works.', 'I know.', 'then why?', 'faster.'], { b: ['kevin'] }),
  bit(['I’m not an alcoholic.', 'you went to a meeting.', 'for the food.'], { a: ['meredith'] }),
  bit(['I went to Cornell.', 'nobody cares.', 'I went to Cornell.', 'still nobody cares.'], { a: ['andy'] }),
  ['I have a lot of feelings.', 'I can tell.', 'is that bad?', 'for us? yes.'],
  bit(['why are you the way you are?', '...', 'honestly.'], { a: ['michael'], b: ['toby'] }),
  bit(['your cat died.', 'I know.', 'I’m sorry.', '...thank you.'], { b: ['angela'] }),
  ['stop looking at me.', 'you stop looking at me.'],
  ['sign this.', 'what is it?', 'doesn’t matter.', '...fine.'],
  ['you can’t say that.', 'I just did.', 'gonna stop me?', '...no.'],
  ['that’s a fire lane.', 'fire hasn’t happened yet.'],
  bit(['I wrapped your stapler in Jello.', 'I’ll eat around it.', 'fair.'], { a: ['jim'], b: ['dwight'] }),
  bit(['zombie attack plan?', 'especially that.', 'of course.'], { b: ['dwight'] }),
  ['just seeing if you’d answer.', 'I hate you.', 'I know.'],
  bit(['a little stitious, not super.', 'that’s not a word.', 'it is now.'], { a: ['michael'] }),
  bit(['funniest person in the office?', 'and other times?', 'other times I know it.'], { a: ['michael'] }),
  bit(['that’s what she said.', '...every time.', 'come on.'], { a: ['michael'] }),
  bit(['I started the fire.', 'no you didn’t.', 'in our hearts, I did.'], { a: ['ryan'] }),
  ['is today a day ending in Y?', 'yes.', 'then no.'],
  bit(['Bob Vance.', 'Phyllis Vance.', 'Vance Refrigeration.'], { b: ['phyllis'] }),
  ['you look beautiful today.', '...I know.'],
  ['I’m better than you in every way.', 'probably.', 'definitely.', 'sure.'],
  ['I’m a nice guy.', 'you’re okay.', 'nicest thing you’ve said.'],
  ['are you okay?', 'I’ve been worse.', 'when?', 'can’t narrow it down.'],
  ['there’s a spider on your desk.', 'where?', '...you ate it.', 'protein.'],
  bit(['soul mates can be bosses.', 'you’re my boss.', 'exactly.'], { a: ['michael'] }),
  ['standup ran 40 minutes.', 'could’ve been an email.'],
  ['is the build green yet?', '...don’t look.'],
  ['who reply-all’d everyone?', 'we don’t talk about it.'],
];

// ─── "that's what she said" ──────────────────────────────────────────────────
//
// The office's favourite bit, and Michael's alone (owner, 2026-10-03: Pam
// never said it). In most, the opener gives the innocent setup (beat 0) and
// Michael lands the punchline (beat 1); TWSS below marks those. The ones where
// the opener says it are Michael opening. Some carry the show's follow-up
// beats, a sheepish clarification and the inevitable "still counts." Setups
// are trimmed to fit the thought cloud.
const TWSS: { b: Cast } = { b: ['michael'] };
const MICHAEL_OPENS: { a: Cast } = { a: ['michael'] };
const TWSS_EXCHANGES: readonly Bit[] = [
  bit(['taking way longer than I expected.', 'that’s what she said.'], TWSS),
  bit(['it’s too big, can’t fit it in my mouth.', 'that’s what she said.'], TWSS),
  bit(['you really need to slow down.', 'that’s what she said.'], TWSS),
  bit(['gonna need a bigger one.', 'that’s what she said.'], TWSS),
  bit(['help, I can’t get it to go in.', 'that’s what she said.'], TWSS),
  bit(['it’s not that hard if you just push.', 'that’s what she said.'], TWSS),
  bit(['I can’t do this all night.', 'that’s what she said.'], TWSS),
  bit(['I need it now, I can’t wait.', 'that’s what she said.'], TWSS),
  bit(['so hot in here, I’m sweating.', 'that’s what she said.'], TWSS),
  bit(['it keeps slipping out of my hands.', 'that’s what she said.'], TWSS),
  bit(['why not just stick it in already?', 'that’s what she said.', '*looks at camera*'], TWSS),
  bit(['I just need a few more inches.', 'that’s what she said.', 'for the shelf!', 'still counts.'], TWSS),
  bit(['make it louder, I can barely feel it.', 'that’s what she said.'], TWSS),
  bit(['can we get this over with quickly?', 'that’s what she said.', 'I meant the meeting.', 'sure.'], TWSS),
  bit(['I just need you to hold it steady.', 'that’s what she said.'], TWSS),
  bit(['can’t believe I did that all morning.', 'that’s what she said.'], TWSS),
  bit(['my hands are cramping.', 'that’s what she said.', 'from typing!', 'that’s what she said.'], TWSS),
  bit(['hours in and barely halfway done.', 'that’s what she said.'], TWSS),
  bit(['surprisingly heavy for its size.', 'that’s what she said.'], TWSS),
  bit(['be more precise. less sloppy.', 'that’s what she said.', 'I meant the spreadsheet.', 'I know.'], TWSS),
  bit(['how long was it?', 'that’s what she said.', '*the whole room goes quiet*', 'I’m sorry, I can’t help it.'], TWSS),
  bit(['too tight, cutting off my circulation.', 'that’s what she said.', '*mouths thank you*'], TWSS),
  bit(['I don’t think it’ll fit.', 'that’s what she said.', '*stands up and applauds*'], TWSS),
  bit(['stop, you’re doing it wrong.', 'that’s what she said.', 'never been prouder.'], TWSS),
  bit(['this just keeps getting harder.', 'that’s what she said.', 'he’s ready.'], TWSS),
  bit(['not wide enough, I need more room.', 'that’s what she said.'], TWSS),
  bit(['I can hold it a really long time.', 'that’s what she said.', 'my breath!', 'still.'], TWSS),
  bit(['why is it taking so long?', 'that’s what she said.', 'I hate you.', 'then why set me up?'], TWSS),
  bit(['I can’t do it with people watching.', 'that’s what she said.', 'the presentation!', 'sure.'], TWSS),
  bit(['it’s deeper than it looks.', 'that’s what she said.', 'the pothole, Michael!', 'doesn’t matter.'], TWSS),
  bit(['so much longer than last time.', 'that’s what she said.', 'the report, Michael.', 'right, right.'], TWSS),
  bit(['oh my god, it went on FOREVER.', 'that’s what she said.', 'the Twilight movie!', 'classic.'], TWSS),
  bit(['can’t believe how thick this is.', 'that’s what she said.', 'the folder. *stares*'], TWSS),
  bit(['I fit all THAT in one day?', 'that’s what she said.', 'that’s actually what I said!', 'meta.'], TWSS),
  bit(['I went at it hard this morning.', 'that’s what she said.', 'at the gym!', 'irrelevant.'], TWSS),
  bit(['someone help me finish this off.', 'that’s what she said.', 'the leftover cake!', 'still works.'], TWSS),
  bit(['get in, do my thing, get out.', 'that’s what she said.', '*doesn’t look up from crossword*'], { a: ['stanley'], b: ['michael'] }),
  bit(['can’t believe it took this long.', 'that’s what she said.', 'the raise. eight years.', 'that one’s on me.'], TWSS),
  bit(['do it slower, it’ll hurt less.', 'that’s what she said.', 'for the quarterly review.', 'sure, Oscar.'], { a: ['oscar'], b: ['michael'] }),
  bit(['didn’t realize how big it’d be.', 'that’s what she said.', 'the calzone, it’s enormous!', 'I love this office.'], TWSS),
  bit(['*to no one* that’s what she said.', 'nobody said anything.', 'just thinking about earlier.'], MICHAEL_OPENS),
  bit(['*on the phone* that’s what she said.', 'who was that?', 'my mother. about a sandwich.'], MICHAEL_OPENS),
  bit(['too hot in here! that’s what she said.', 'you said both parts.', 'I contain multitudes.'], MICHAEL_OPENS),
  bit(['*at the TV* that’s what she said.', 'you’re alone, Michael.', 'she doesn’t know that.'], MICHAEL_OPENS),
  bit(['you need to be more professional.', 'that’s what she said.', 'I am she.', '...that’s what she said.'], TWSS),
  bit(['stop. just stop. every time…', 'that’s what she said.', '*leaves the room*', '*whispers* that’s what she said.'], TWSS),
  bit(['as you can see, it’s going up.', 'that’s what she said.', '*everyone groans*', 'set that one up myself.'], TWSS),
  bit(['I declared bankruptcy once. felt good.', 'what does that have to do with…', 'that’s what she said.', 'it doesn’t.', 'I know.'], MICHAEL_OPENS),
  bit(['you didn’t say it.', 'I know.', 'why not?', 'I’m growing.', 'proud of you.', 'that’s what she said.'], TWSS),
  bit(['impressive you held back today.', 'thank you.', 'I counted zero times.', 'that’s what she said.', 'still counts.'], TWSS),
];

// ─── the show's running gags ─────────────────────────────────────────────────
//
// More short exchanges (owner, 2026-10-03: "lot of short small talk that was
// funny"), written in the cast's voice from each character's running jokes
// and habits on the show: Michael and Toby, Dwight's beets and Schrute Bucks,
// Andy's Cornell and a cappella, Kevin's chili, Angela's cats, Stanley's
// crosswords and Pretzel Day, Creed's past, Bob Vance. Each one says who says
// which side, so every line goes to someone who would say it.
const RUNNING_GAGS: readonly Line[] = [
  // Pete, the new guy of season 9 (owner, 2026-10-13): Plop (the name Andy
  // gave him), the New Jim who shares nothing with Jim, Die Hard recited for
  // Erin and checked against the transcript, Poor Richard’s, the customer
  // service desk Kelly left, the junior Jim of Stanley, Clark the junior of
  // Dwight, and the office sizing up the new guys. Nobody calls him Pete: the
  // owner may rename him (ship 2 D17). No straight quotes in these comments:
  // the tests read every quoted string in this block as a line.
  bit(['morning, Plop!', 'please stop calling me that.', 'morning, Plop.'], { a: ['andy'], b: ['pete'] }),
  bit(['can I get a new nickname?', 'you have one. Plop.', 'that’s the problem.'], { a: ['pete'], b: ['andy'] }),
  bit(['people call me New Jim.', 'we do look alike. pranks?', 'not really.', 'then no.'], { a: ['pete'], b: ['jim'] }),
  bit(['you’ve never seen Die Hard?', 'is it a Christmas movie?', 'I’ll do the whole thing for you.'], { a: ['pete'], b: ['erin'] }),
  bit(['I checked your Die Hard online.', 'and?', 'every single word. wow.', 'yippee ki yay.'], { a: ['erin'], b: ['pete'] }),
  bit(['Poor Richard’s after work?', 'first round’s on me.', 'it’s a date. kind of.'], { a: ['erin'], b: ['pete'] }),
  bit(['you’re at my old desk.', 'customer service, yeah.', 'it was a GOSSIP desk.', 'I’ll keep it warm.'], { a: ['kelly'], b: ['pete'] }),
  bit(['you’re a junior Jim.', 'is that bad?', 'one Jim was plenty.'], { a: ['stanley'], b: ['pete'] }),
  bit(['your junior went on a sales call alone.', 'Clark? without me?', 'he said you’d say that.'], { a: ['pete'], b: ['dwight'] }),
  bit(['are we cool, about Erin?', 'I’m on a boat, emotionally.', '...okay.'], { a: ['pete'], b: ['andy'] }),
  bit(['who are you?', 'the new guy. since fall.', 'welcome. don’t sit there.'], { a: ['creed'], b: ['pete'] }),
  bit(['you’re in Kelly’s old chair.', 'it’s my chair now.', 'technically, yes.'], { a: ['oscar'], b: ['pete'] }),
  bit(['are you the new guy?', 'one of them.', 'which one has snacks?'], { a: ['kevin'], b: ['pete'] }),
  bit(['welcome. any HR questions?', 'not yet.', 'nobody ever has any.'], { a: ['toby'], b: ['pete'] }),
  bit(['are you one of the new guys?', 'that’s me.', 'Bob will want to meet you.'], { a: ['phyllis'], b: ['pete'] }),
  bit(['Toby, why are you here?', 'I work here.', 'still.'], { a: ['michael'], b: ['toby'] }),
  bit(['good morning, Toby.', '...really?', 'no.'], { a: ['michael'], b: ['toby'] }),
  bit(['I moved your desk to the annex.', 'it was already in the annex.', 'deeper in the annex.'], { a: ['michael'], b: ['toby'] }),
  bit(['Costa Rica was nice, you know.', 'nobody asked, Toby.'], { a: ['toby'], b: ['michael'] }),
  bit(['quick HR question, Michael.', 'no.', 'I haven’t asked it.', 'still no.'], { a: ['toby'], b: ['michael'] }),
  bit(['Ryan! my guy.', 'please don’t call me that.', 'my guy Ryan.'], { a: ['michael'], b: ['ryan'] }),
  bit(['want to grab lunch?', 'I have a thing.', 'what thing?', 'a lunch thing.'], { a: ['michael'], b: ['ryan'] }),
  bit(['who wants to be in my movie?', 'what movie?', 'Threat Level Midnight.', 'hard pass.'], { a: ['michael'] }),
  bit(['I’m already planning the Dundies.', 'it’s October.', 'never too early.'], { a: ['michael'] }),
  bit(['improv class tonight. you in?', 'do I have to?', 'yes, and.'], { a: ['michael'] }),
  bit(['what would you do without me?', 'work.', 'boring.'], { a: ['michael'] }),
  bit(['friend first, boss second.', 'comedian third?', 'you get me.'], { a: ['michael'] }),
  bit(['conference room. five minutes.', 'for what?', 'I’ll know in five minutes.'], { a: ['michael'] }),
  bit(['Dwight, I need you.', 'yes, Michael!', 'never mind.'], { a: ['michael'], b: ['dwight'] }),
  bit(['I’d take a bullet for you, Michael.', 'please don’t.', 'two bullets.', 'not necessary.'], { a: ['dwight'], b: ['michael'] }),
  bit(['Stanley, how are we today?', 'leave me alone.', 'great!'], { a: ['michael'], b: ['stanley'] }),
  bit(['did you move my stapler?', 'what stapler?', 'Jim.', 'what Jim?'], { a: ['dwight'], b: ['jim'] }),
  bit(['you owe me Schrute Bucks.', 'what are those worth?', 'respect.'], { a: ['dwight'] }),
  bit(['Mose says hi.', 'who’s Mose?', 'he knows who you are.'], { a: ['dwight'] }),
  bit(['I’m a volunteer sheriff’s deputy.', 'on weekends?', 'on all days.'], { a: ['dwight'] }),
  bit(['bears climb faster than you run.', 'why tell me that?', 'you’ll thank me.'], { a: ['dwight'] }),
  bit(['assistant regional manager, coming through.', 'assistant TO the.', '...coming through.'], { a: ['dwight'], b: ['jim'] }),
  bit(['I have a black belt.', 'in what?', 'karate. obviously.'], { a: ['dwight'] }),
  bit(['the beets are early this year.', 'is that good?', 'for the beets.'], { a: ['dwight'] }),
  bit(['I got a fax from future me.', 'what did it say?', 'watch out for you.'], { a: ['dwight'], b: ['jim'] }),
  bit(['big plans this weekend?', 'Pam has plans for me.', 'so, no.'], { b: ['jim'], not: ['pam'] }),
  bit(['Dwight, phone’s for you.', '...it’s not ringing.', 'it will.'], { a: ['jim'], b: ['dwight'] }),
  bit(['bet you can’t do it in one try.', 'watch me.', '*it takes eleven tries*'], { a: ['jim'], b: ['dwight'] }),
  bit(['*glances at the camera*', 'did you just look at…', 'nope.'], { a: ['jim'] }),
  bit(['tuna or turkey today?', 'surprise me.', 'tuna.', 'shocking.'], { a: ['pam'], b: ['jim'] }),
  bit(['Big Tuna!', 'hey Andy.', 'tuna tuna tuna.'], { a: ['andy'], b: ['jim'] }),
  bit(['Big Tuna, need a ride?', 'I drove.', 'carpool next time.', 'sure, Andy.'], { a: ['andy'], b: ['jim'] }),
  bit(['want to hear my a cappella set?', 'how long is it?', 'forty minutes.', 'no.'], { a: ['andy'] }),
  bit(['the Nard Dog is in the house!', 'he always is.', 'and yet.'], { a: ['andy'] }),
  bit(['I play the banjo, you know.', 'we know.', 'want me to?', 'no.'], { a: ['andy'] }),
  bit(['rit dit dit doo!', '...is he okay?', 'it’s a Cornell thing.'], { a: ['andy'] }),
  bit(['Darryl, jam session later?', 'if you bring the banjo.', 'always.'], { a: ['andy'], b: ['darryl'] }),
  bit(['I brought my famous chili.', 'again?', 'it’s always the chili.'], { a: ['kevin'] }),
  bit(['my band is called Scrantonicity.', 'cool name.', 'it’s a Police thing.'], { a: ['kevin'] }),
  bit(['can I have your fries?', 'you have fries.', 'more fries.'], { a: ['kevin'] }),
  bit(['M&Ms are a vegetable.', 'no they’re not.', 'chocolate is a bean.'], { a: ['kevin'] }),
  bit(['what’s 7 plus 9?', 'sixteen.', 'that’s what I said.', 'you said seventeen.'], { a: ['kevin'], b: ['oscar'] }),
  bit(['Angela, cookie?', 'no.', 'more for me.'], { a: ['kevin'], b: ['angela'] }),
  bit(['Sprinkles would have loved this.', 'the cat?', 'she was a person to me.'], { a: ['angela'] }),
  bit(['party planning, 3pm.', 'who’s on it?', 'not you.'], { a: ['angela'] }),
  bit(['I got a new cat.', 'how many is that?', 'not enough.'], { a: ['angela'] }),
  bit(['is that a cupcake?', 'it’s a muffin.', 'it’s a lie.'], { a: ['angela'] }),
  bit(['Phyllis, your sweater is… loud.', 'thank you, Angela.', 'it wasn’t a compliment.'], { a: ['angela'], b: ['phyllis'] }),
  bit(['Angela, nice cardigan.', 'it’s new.', 'it looks old. nice.'], { a: ['phyllis'], b: ['angela'] }),
  bit(['coffee’s ready, Angela.', 'I brought my own.', 'of course you did.'], { b: ['angela'] }),
  bit(['actually, that’s a common myth.', 'here we go.', 'it’s interesting!'], { a: ['oscar'] }),
  bit(['Kevin, the numbers don’t add up.', 'they add up to something.', 'not the right thing.'], { a: ['oscar'], b: ['kevin'] }),
  bit(['I read the whole contract.', 'all of it?', 'someone has to.'], { a: ['oscar'] }),
  bit(['is it Pretzel Day?', 'tomorrow.', 'then wake me tomorrow.'], { a: ['stanley'] }),
  bit(['Stanley, got a minute?', 'no.'], { b: ['stanley'] }),
  bit(['four down. go away, five letters.', 'scram?', 'you’re getting it.'], { a: ['stanley'] }),
  bit(['I’m counting the days.', 'until what?', 'retirement.'], { a: ['stanley'] }),
  bit(['Bob says hi.', 'Bob Vance?', 'of Vance Refrigeration.'], { a: ['phyllis'] }),
  bit(['I knitted you a scarf.', 'it’s June.', 'you’ll thank me in winter.'], { a: ['phyllis'] }),
  bit(['Michael and I went to high school together.', 'what was he like?', 'the same.'], { a: ['phyllis'], not: ['michael'] }),
  bit(['I’m not one to gossip, but…', 'yes?', 'I’ll tell Kelly first.'], { a: ['phyllis'], not: ['kelly'] }),
  bit(['oh my god, did you hear?', 'hear what?', 'I can’t say. okay, I’ll say.'], { a: ['kelly'] }),
  bit(['Ryan liked my post!', 'that’s good?', 'it’s EVERYTHING.'], { a: ['kelly'], not: ['ryan'] }),
  bit(['you and Ryan back together?', 'it’s complicated.', 'so yes.'], { b: ['kelly'], not: ['ryan'] }),
  bit(['I talk fast so I can say more.', 'I noticed.', 'thank you!'], { a: ['kelly'] }),
  bit(['Erin, matching nails?', 'yes! what color?', 'Ryan’s favorite.'], { a: ['kelly'], b: ['erin'] }),
  bit(['Kelly, I need space.', 'how much space?', 'like... a lot.'], { a: ['ryan'], b: ['kelly'] }),
  bit(['I’m launching an app.', 'what does it do?', 'it disrupts.'], { a: ['ryan'] }),
  bit(['I went to business school.', 'for one semester.', 'it counts.'], { a: ['ryan'] }),
  bit(['I’m not a temp anymore.', 'what are you?', 'a visionary.'], { a: ['ryan'] }),
  bit(['let’s take this offline.', 'we’re at the vending machine.', 'exactly.'], { a: ['ryan'] }),
  bit(['I’m writing a novel.', 'what’s it about?', 'a lonely HR guy.', 'oh, Toby.'], { a: ['toby'] }),
  bit(['can we talk about the incident?', 'which one?', 'all of them.'], { a: ['toby'] }),
  bit(['nobody sits with me at lunch.', 'I’ll sit with you.', 'really?', 'no, I have a call.'], { a: ['toby'] }),
  bit(['Pam, nice drawing.', 'thanks, Toby.', '...okay, bye.'], { a: ['toby'], b: ['pam'] }),
  bit(['I sleep under my desk sometimes.', 'is that allowed?', 'is anything?'], { a: ['creed'] }),
  bit(['I’ve been in prison.', 'for what?', 'which time?'], { a: ['creed'] }),
  bit(['want to buy a watch?', 'where’s it from?', 'don’t ask.'], { a: ['creed'] }),
  bit(['Creed isn’t my real name.', 'what is it?', 'I forget.'], { a: ['creed'] }),
  bit(['I’m in quality assurance.', 'what do you check?', 'great question.'], { a: ['creed'] }),
  bit(['Marybeth, right?', 'Meredith.', 'that’s what I said.'], { a: ['creed'], b: ['meredith'] }),
  bit(['it’s 5 o’clock somewhere.', 'it’s 10am.', 'somewhere.'], { a: ['meredith'] }),
  bit(['who brought the good wine?', 'it’s Tuesday.', 'so who?'], { a: ['meredith'] }),
  bit(['my kid says I’m the fun mom.', 'are you?', 'ask my liver.'], { a: ['meredith'] }),
  bit(['Michael’s in the warehouse.', 'is he near the forklift?', 'he’s ON the forklift.', 'oh no.'], { b: ['darryl'], not: ['michael'] }),
  bit(['working on a new song.', 'what’s it called?', 'still deciding.'], { a: ['darryl'] }),
  bit(['Jada drew me a picture today.', 'that’s sweet.', 'it’s a forklift.'], { a: ['darryl'] }),
  bit(['warehouse rules exist for a reason.', 'which reason?', 'Michael.'], { a: ['darryl'] }),
  bit(['I love this office so much.', 'why?', 'it’s the family I picked.'], { a: ['erin'] }),
  bit(['I named my plant Andy.', 'why?', 'it needs a lot of attention.'], { a: ['erin'], not: ['andy'] }),
  bit(['is today a holiday?', 'no.', 'it feels like one!'], { a: ['erin'] }),
  bit(['I’m painting the building again.', 'the outside?', 'my version of it.'], { a: ['pam'] }),
  bit(['Jim did something.', 'how can you tell?', 'Dwight’s desk is in the vending machine.'], { a: ['pam'], not: ['jim', 'dwight'] }),
  bit(['want to see my sketch?', 'is that me?', 'it’s a duck.'], { a: ['pam'] }),
  bit(['Dunder Mifflin, this is Pam.', 'it’s me.', 'oh, hi Jim.'], { a: ['pam'], b: ['jim'] }),
  bit(['I’ve seen your search history.', 'what?', 'just saying. I’ve seen it.'], { a: ['nick'] }),
  bit(['did you restart it?', 'it’s a stapler.', 'did you restart it?'], { a: ['nick'] }),
  bit(['someone clicked a free cruise link.', 'it said I’d won.', 'you didn’t.'], { a: ['sadiq'] }),
  bit(['your password is your cat’s name.', 'how do you know?', 'it’s on a sticky note.'], { a: ['sadiq'], b: ['angela'] }),
  bit(['please update your computer.', 'later.', 'that’s what the virus said.'], { a: ['sadiq'] }),
  ['who drank my yogurt?', 'yogurt is a food.', 'not the point.'],
  ['is it Friday yet?', 'Tuesday.', 'ugh.'],
  ['the printer is jammed again.', 'kick it.', 'I’m telling IT.'],
  ['the AC is broken.', 'is that why you’re sweating?', 'I’m always sweating.'],
];

// Everything a pair can draw from, each with who may say which side.
const PAIR_POOL: readonly Bit[] = [...EXCHANGES, ...RUNNING_GAGS, ...TWSS_EXCHANGES].map((x) => ('beats' in x ? x : { beats: x }));

// Keyed off the SPEAKER so, when the right character sits down first, they get
// to open with their signature bit.
const KEYED_EXCHANGES: Partial<Record<OfficeCharacterName, Exchange>> = {
  michael:  ['that’s what she said.', '...there it is.'],
  dwight:   ['identity theft is not a joke.', 'nobody touched your stapler, Dwight.'],
  kevin:    ['why few word when lot word?', '...just use the words, Kevin.'],
  kelly:    ['okay don’t freak out, but…', 'I’m already freaking out.'],
  oscar:    ['well, actually…', '...here we go.'],
  angela:   ['this table is filthy.', 'it’s a break room, Angela.'],
  creed:    ['which one are you again?', '...we sit next to each other.'],
  stanley:  ['is it Pretzel Day?', 'no, Stanley.', '...did I stutter?'],
  andy:     ['I went to Cornell.', 'nobody cares.', '...I went to Cornell.'],
  jim:      ['question.', 'yes.', 'nothing. just checking.'],
  darryl:   ['Michael wants slang again.', 'what did you teach him?', 'nothing. he made it all up.'],
  erin:     ['is it someone’s birthday?', 'no, Erin.', 'cake anyway?'],
  nick:     ['hi. Nick. from IT.', 'right. Rick. my printer’s broken.', '...Nick.'],
  sadiq:    ['did you click the cruise link?', 'it said I won!', '…running a scan.'],
  pam:      ['want to see a sketch?', 'is that the vending machine?', 'it’s you, actually.'],
  pete:     ['can I get a nickname that’s not Plop?', 'no.', '...worth asking.'],
};

/**
 * Conversations for the studio (DESIGN.md 8.8): two idle people trade the
 * beats of an exchange as paper planes or envelopes. The full set: EXCHANGES,
 * the "that's what she said" bits (owner, 2026-10-01: "bring full set back")
 * and the signature openers, each played only by a pair who would say it:
 * the reply goes to one of `partners` who fits, and `partner` is their index.
 * No exchange comes back until all have played; null means no partner fits
 * any. `random` is there for tests.
 *
 * `must` (Pete's first day welcome, peteWelcome.ts): only a bit where that
 * person is a named side, with them as the opener or the partner, or their own
 * signature opener if it has not played; picked at random without touching the
 * deck, so the welcome never reshuffles it. Null when none fits.
 */
export function createBanter(random: () => number = Math.random): (
  opener: OfficeCharacterName, partners: readonly OfficeCharacterName[], must?: OfficeCharacterName
) => { beats: Exchange; partner: number } | null {
  const next = deck(PAIR_POOL, random);
  const keyedUsed = new Set<string>();
  const says = (who: Cast | undefined, c: OfficeCharacterName, not?: Cast) => (!who || who.includes(c)) && !not?.includes(c);
  return (opener, partners, must) => {
    if (!partners.length) return null;
    const pickFrom = (b?: Cast, not?: Cast) => {
      const fit = partners.map((c, i) => (says(b, c, not) ? i : -1)).filter((i) => i >= 0);
      return fit[Math.floor(random() * fit.length)];
    };
    const keyed = KEYED_EXCHANGES[opener];
    if (must) {
      const opens = opener === must;
      if (!opens && !partners.includes(must)) return null;
      const own: Bit[] = opens && keyed && !keyedUsed.has(opener) ? [{ beats: keyed }] : [];
      const named = PAIR_POOL.filter((x) => opens
        ? !!x.a?.includes(must) && says(x.a, opener, x.not) && partners.some((c) => says(x.b, c, x.not))
        : !!x.b?.includes(must) && says(x.a, opener, x.not) && says(x.b, must, x.not));
      const all = [...own, ...named];
      if (!all.length) return null;
      const x = all[Math.floor(random() * all.length)];
      if (x.beats === keyed) { keyedUsed.add(opener); return { beats: keyed, partner: pickFrom() }; }
      return { beats: x.beats, partner: opens ? pickFrom(x.b, x.not) : partners.indexOf(must) };
    }
    // A signature bit at most once per person while the studio is open, when they happen to open.
    if (keyed && !keyedUsed.has(opener) && random() < 0.35) { keyedUsed.add(opener); return { beats: keyed, partner: pickFrom() }; }
    const x = next((x) => says(x.a, opener, x.not) && partners.some((c) => says(x.b, c, x.not)));
    return x ? { beats: x.beats, partner: pickFrom(x.b, x.not) } : null;
  };
}
