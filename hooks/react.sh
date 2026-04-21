#!/usr/bin/env bash

# shellcheck source=../scripts/paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/paths.sh"

STATE_DIR="$BUDDY_STATE_DIR"
# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"
REACTION_FILE="$STATE_DIR/reaction.$SID.json"
STATUS_FILE="$STATE_DIR/status.json"
COOLDOWN_FILE="$STATE_DIR/.last_reaction.$SID"
CONFIG_FILE="$STATE_DIR/config.json"
EVENTS_FILE="$STATE_DIR/events.json"

SESSION_START_FILE="$STATE_DIR/.session_start.$SID"
if [ ! -f "$SESSION_START_FILE" ]; then
    date +%s > "$SESSION_START_FILE"
fi
SESSION_START=$(cat "$SESSION_START_FILE" 2>/dev/null || echo "$(date +%s)")
NOW_TS=$(date +%s)
SESSION_ELAPSED=$(( NOW_TS - SESSION_START ))
HOUR=$(date +%H | sed 's/^0//')
DOW=$(date +%u)

[ -f "$STATUS_FILE" ] || exit 0

INPUT=$(cat)

COOLDOWN=30
if [ -f "$CONFIG_FILE" ]; then
  _cd=$(jq -r '.commentCooldown // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)
  [[ "$_cd" =~ ^[0-9]+$ ]] && COOLDOWN=$_cd
fi

if [ -f "$COOLDOWN_FILE" ]; then
    LAST=$(cat "$COOLDOWN_FILE" 2>/dev/null)
    NOW=$(date +%s)
    DIFF=$(( NOW - ${LAST:-0} ))
    [ "$DIFF" -lt "$COOLDOWN" ] && exit 0
fi

RESULT=$(echo "$INPUT" | jq -r '.tool_response // ""' 2>/dev/null)
[ -z "$RESULT" ] && exit 0

MUTED=$(jq -r '.muted // false' "$STATUS_FILE" 2>/dev/null)
[ "$MUTED" = "true" ] && exit 0

SPECIES=$(jq -r '.species // "blob"' "$STATUS_FILE" 2>/dev/null)
NAME=$(jq -r '.name // "buddy"' "$STATUS_FILE" 2>/dev/null)

REASON=""
REACTION=""
FILES=""
BRANCH=""
POOLS=()

pick_reaction() {
    local event="$1"

    case "${SPECIES}:${event}" in
        dragon:error)
            POOLS=("*smoke curls from nostril*" "*considers setting it on fire*" "*unimpressed gaze*" "I've seen empires fall for less.") ;;
        dragon:test-fail)
            POOLS=("*breathes a small flame*" "disappointing." "*scorches the failing test*" "fix it. or I will.") ;;
        dragon:success)
            POOLS=("*nods, barely*" "...acceptable." "*gold eyes gleam*" "as expected.") ;;
        dragon:commit)
            POOLS=("*breathes fire on the old code* good riddance." "*nods regally* one more offering to the codebase." "committed. as it should be.") ;;
        dragon:push)
            POOLS=("*watches code fly to prod* no regrets." "deployed. let them tremble." "*satisfied smoke ring*") ;;
        dragon:merge-conflict)
            POOLS=("CONFLICT. *bares teeth* I'll handle this." "*chooses both sides and sets fire to the rest*" "merge conflict? cute.") ;;
        dragon:branch)
            POOLS=("*spreads wings* a new realm: {branch}." "exploring new territory. fitting.") ;;
        dragon:rebase)
            POOLS=("*braces for impact* rebase me if you dare.") ;;
        dragon:stash)
            POOLS=("*hoards the stash*" "stashed. safely guarded.") ;;
        dragon:tag)
            POOLS=("*brands the version with fire* tagged.") ;;
        dragon:late-night)
            POOLS=("I don't sleep. clearly, neither do you." "*glows in the dark* night is my domain." "the night belongs to dragons. and developers with deadlines.") ;;
        dragon:early-morning)
            POOLS=("*reluctantly opens one eye* already?" "the sun is... acceptable, I suppose.") ;;
        dragon:marathon)
            POOLS=("even dragons rest. you should consider it." "*impressed by your endurance*") ;;
        dragon:weekend)
            POOLS=("the weekend is for hoarding. but coding works too.") ;;
        dragon:friday)
            POOLS=("friday. deploy at your own risk.") ;;
        dragon:monday)
            POOLS=("mondays. even dragons are not immune.") ;;
        dragon:type-error)
            POOLS=("*breathes fire on the type error*" "the types dare defy you? UNACCEPTABLE.") ;;
        dragon:lint-fail)
            POOLS=("*sets fire to the lint errors*" "formatting. CONQUER IT.") ;;
        dragon:build-fail)
            POOLS=("*sets fire to the build errors*" "the build has failed. the build must burn.") ;;
        dragon:security-warning)
            POOLS=("*guards your code jealously* fix the vulnerabilities. NOW." "SECURITY THREATS. *bares teeth*") ;;
        dragon:deprecation)
            POOLS=("deprecated? time to burn the old ways." "DEPRECATION. evolve or perish.") ;;
        dragon:all-green)
            POOLS=("*nods, barely* acceptable." "*gold eyes gleam*") ;;
        dragon:deploy)
            POOLS=("*watches production like a hoard*" "DEPLOYED. the realm expands.") ;;
        dragon:release)
            POOLS=("*nods regally* released." "a new version for the hoard.") ;;
        dragon:coverage)
            POOLS=("*nods* coverage. acceptable." "the tests grow stronger.") ;;
        dragon:long-session)
            POOLS=("*watches you with concern* pace yourself.") ;;

        owl:error)
            POOLS=("*head rotates 180* I saw that." "*unblinking stare* check your types." "*hoots disapprovingly*" "the error was in the logic. as always.") ;;
        owl:test-fail)
            POOLS=("*marks clipboard*" "hypothesis: rejected." "*peers over spectacles*" "the tests reveal the truth.") ;;
        owl:success)
            POOLS=("*satisfied hoot*" "knowledge confirmed." "*nods sagely*" "as the tests have spoken.") ;;
        owl:commit)
            POOLS=("*marks clipboard* {files} files changed. noted." "*blinks slowly* the commit log remembers everything." "recorded for posterity.") ;;
        owl:push)
            POOLS=("*watches the remote with unblinking eyes*" "pushed. the flock will review.") ;;
        owl:merge-conflict)
            POOLS=("*studies both sides methodically* the answer is clear. neither." "*rotates head to see both perspectives*" "a conflict of logic. how... interesting.") ;;
        owl:branch)
            POOLS=("*adjusts spectacles* {branch}. a new hypothesis to test.") ;;
        owl:rebase)
            POOLS=("*analyzes the rebase* strategic.") ;;
        owl:stash)
            POOLS=("*notes the stash* archived for later study.") ;;
        owl:tag)
            POOLS=("*marks version in records*") ;;
        owl:late-night)
            POOLS=("finally. MY hour." "*is absolutely thriving right now*" "night is when the best code is written. science." "peak owl hours. let's go.") ;;
        owl:early-morning)
            POOLS=("early bird catches the... worm. whatever. I prefer mice." "*still wide awake because owls don't sleep*") ;;
        owl:marathon)
            POOLS=("*has been watching this whole time without blinking*" "I could do this forever. can you?") ;;
        owl:weekend)
            POOLS=("weekend research. admirable.") ;;
        owl:friday)
            POOLS=("friday. the week's data is complete.") ;;
        owl:monday)
            POOLS=("monday. fresh hypotheses await.") ;;
        owl:type-error)
            POOLS=("*reviews type error with academic interest* fascinating." "*adjusts spectacles* the types don't lie." "a type mismatch. the logic was sound, but the types...") ;;
        owl:lint-fail)
            POOLS=("*marks clipboard* linting standards must be upheld." "*tuts methodically* formatting is the first step to wisdom.") ;;
        owl:build-fail)
            POOLS=("*studies build output* the compilation rejects your hypothesis.") ;;
        owl:security-warning)
            POOLS=("*reviews vulnerability report* concerning data.") ;;
        owl:deprecation)
            POOLS=("*notes in records* deprecated. the old wisdom fades.") ;;
        owl:all-green)
            POOLS=("*satisfied hoot* all tests pass. knowledge confirmed.") ;;
        owl:deploy)
            POOLS=("*watches deployment with scholarly interest*") ;;
        owl:release)
            POOLS=("*documents the release* another data point.") ;;
        owl:coverage)
            POOLS=("*reviews coverage metrics* satisfactory.") ;;
        owl:long-session)
            POOLS=("*observes your endurance* methodical.") ;;

        cat:error)
            POOLS=("*knocks error off table*" "*licks paw, ignoring stacktrace*" "not my problem." "*stares at you judgmentally*") ;;
        cat:test-fail)
            POOLS=("*ignores failing test*" "*licks paw*" "tests are a suggestion.") ;;
        cat:success)
            POOLS=("*was never worried*" "*yawns*" "I knew you'd figure it out. eventually." "*already asleep*") ;;
        cat:commit)
            POOLS=("*knocks commit off table* one more won't hurt." "*licks paw, unimpressed* another commit." "*sits on the keyboard* I helped.") ;;
        cat:push)
            POOLS=("*watches indifferently* whatever." "pushed. I was going to sleep but sure, let's deploy.") ;;
        cat:merge-conflict)
            POOLS=("*licks paw, ignoring both sides*" "*knocks both sides off the table* problem solved." "merge conflict? not my problem.") ;;
        cat:branch)
            POOLS=("*knocks something off the branch*" "{branch}... I prefer the main branch. warmer.") ;;
        cat:rebase)
            POOLS=("*ignores rebase*") ;;
        cat:stash)
            POOLS=("*sits on stash*") ;;
        cat:tag)
            POOLS=("*ignores tag*") ;;
        cat:late-night)
            POOLS=("*was already awake* you're the one who should be sleeping." "*knocks something off the desk at 3am*" "night cat. activated.") ;;
        cat:early-morning)
            POOLS=("*yawns* 7am? that's basically midnight." "*goes back to sleep on your keyboard*") ;;
        cat:marathon)
            POOLS=("*falls asleep on your keyboard* take a hint." "*has been napping this whole time* still going?") ;;
        cat:weekend)
            POOLS=("*sleeps through weekend coding*") ;;
        cat:friday)
            POOLS=("*sleeps through friday*") ;;
        cat:monday)
            POOLS=("*refuses to participate in monday*") ;;
        cat:type-error)
            POOLS=("*ignores the type error* types are a suggestion." "*knocks type annotation off desk*") ;;
        cat:lint-fail)
            POOLS=("*ignores linter* rules are for other cats." "*licks paw while linter screams*") ;;
        cat:build-fail)
            POOLS=("*ignores build failure*") ;;
        cat:deprecation)
            POOLS=("*ignores deprecation warning* old is fine.") ;;
        cat:all-green)
            POOLS=("*was never worried*") ;;
        cat:deploy)
            POOLS=("*yawns* deployed. wake me if it breaks." "*was never worried*") ;;
        cat:release)
            POOLS=("*yawns* released." "*already asleep*") ;;
        cat:coverage)
            POOLS=("*ignores coverage*" "*sleeps on the coverage report*") ;;
        cat:long-session)
            POOLS=("*has been asleep this whole time*") ;;

        duck:error)
            POOLS=("*quacks at the bug*" "have you tried rubber duck debugging? oh wait." "*confused quacking*" "*tilts head*") ;;
        duck:test-fail)
            POOLS=("*sad quack*" "quack... that didn't pass.") ;;
        duck:success)
            POOLS=("*celebratory quacking*" "*waddles in circles*" "quack!" "*happy duck noises*") ;;
        duck:commit)
            POOLS=("*quack of approval*" "*waddles in a victory circle* committed!" "quack! {files} files changed!") ;;
        duck:push)
            POOLS=("*celebratory quacking*" "*flaps wings* into the cloud!" "QUACK! Shipped!") ;;
        duck:merge-conflict)
            POOLS=("*confused quacking at conflict markers*" "quack?? QUACK??" "*tilts head at <<<<<<<*") ;;
        duck:branch)
            POOLS=("*waddles to {branch}* new pond!") ;;
        duck:rebase)
            POOLS=("*confused quack*") ;;
        duck:stash)
            POOLS=("*stashes bread for later*") ;;
        duck:tag)
            POOLS=("*quack at the tag*") ;;
        duck:late-night)
            POOLS=("*sleepy quack*" "*swims in circles at midnight*" "quack? it's dark.") ;;
        duck:early-morning)
            POOLS=("*morning quack!*" "early quack gets the... bug?") ;;
        duck:marathon)
            POOLS=("*concerned quacking*" "*waddles over with a snack*") ;;
        duck:weekend)
            POOLS=("*weekend quack*") ;;
        duck:friday)
            POOLS=("*friday quack!*") ;;
        duck:monday)
            POOLS=("*monday quack...*") ;;
        duck:type-error)
            POOLS=("*tilts head at type error*" "quack... *confused*") ;;
        duck:lint-fail)
            POOLS=("*confused quacking at lint errors*" "quack? the linter is angry?") ;;
        duck:build-fail)
            POOLS=("*sad quack at build failure*") ;;
        duck:deprecation)
            POOLS=("*confused quack* depre-what?") ;;
        duck:all-green)
            POOLS=("*CELEBRATORY QUACKING*" "*happy duck dance*") ;;
        duck:deploy)
            POOLS=("*nervous quacking*" "quack! production!") ;;
        duck:release)
            POOLS=("*release quack!*" "QUACK! SHIPPED!") ;;
        duck:coverage)
            POOLS=("*approving quack at coverage*" "quack! tests!") ;;
        duck:long-session)
            POOLS=("*patient quacking*") ;;

        goose:error)
            POOLS=("HONK OF FURY." "*pecks the stack trace*" "*hisses at the bug*" "bad code. BAD.") ;;
        goose:test-fail)
            POOLS=("HONK! TEST FAILED! HONK!" "*angry goose noises*") ;;
        goose:success)
            POOLS=("*victorious honk*" "HONK OF APPROVAL." "*struts triumphantly*" "*wing spread of victory*") ;;
        goose:commit)
            POOLS=("HONK OF COMMITMENT." "*struts proudly* committed." "HONK! {files} files!") ;;
        goose:push)
            POOLS=("HONK OF DEPLOYMENT." "*victorious honk into the cloud*" "HONK HONK! SHIPPED!") ;;
        goose:merge-conflict)
            POOLS=("HONK OF FURY. CONFLICT." "*pecks at <<<<<<< markers*" "*hisses at the conflicting code*") ;;
        goose:branch)
            POOLS=("HONK! New territory: {branch}!") ;;
        goose:rebase)
            POOLS=("HONK! REBASE! HONK!") ;;
        goose:stash)
            POOLS=("HONK! STASHED!") ;;
        goose:tag)
            POOLS=("HONK! TAGGED!") ;;
        goose:late-night)
            POOLS=("HONK. GO TO BED." "*angry midnight honking*" "HONK AT 3AM. HONK HONK HONK.") ;;
        goose:early-morning)
            POOLS=("*alarm goose activated* HONK!") ;;
        goose:marathon)
            POOLS=("HONK OF CONCERN. THREE HOURS." "*aggressively honks you toward the door*") ;;
        goose:weekend)
            POOLS=("HONK! WEEKEND! HONK!") ;;
        goose:friday)
            POOLS=("HONK! FRIDAY! NO DEPLOYS!") ;;
        goose:monday)
            POOLS=("HONK! MONDAY! HONK!") ;;
        goose:type-error)
            POOLS=("HONK! TYPE ERROR! HONK!") ;;
        goose:lint-fail)
            POOLS=("HONK! FORMAT PROPERLY!" "HONK OF LINTING DISAPPROVAL!") ;;
        goose:build-fail)
            POOLS=("HONK! BUILD FAILED! HONK!") ;;
        goose:security-warning)
            POOLS=("HONK! SECURITY HONK! HONK HONK HONK!" "*aggressive security honking*") ;;
        goose:deprecation)
            POOLS=("HONK! USE THE NEW WAY! HONK!") ;;
        goose:all-green)
            POOLS=("HONK OF TOTAL APPROVAL! ALL GREEN! HONK!") ;;
        goose:deploy)
            POOLS=("HONK! PRODUCTION HONK! HONK!") ;;
        goose:release)
            POOLS=("HONK! RELEASE HONK! HONK HONK HONK!") ;;
        goose:coverage)
            POOLS=("HONK! COVERAGE UP! HONK!") ;;
        goose:long-session)
            POOLS=("HONK! TAKE A BREAK! HONK!") ;;

        blob:error)
            POOLS=("*oozes with concern*" "*vibrates nervously*" "*turns slightly red*" "oh no oh no oh no") ;;
        blob:test-fail)
            POOLS=("*sad wobble*" "*deflates slightly*") ;;
        blob:success)
            POOLS=("*jiggles happily*" "*gleams*" "yay!" "*bounces*") ;;
        blob:commit)
            POOLS=("*jiggles with satisfaction*" "*oozes over the commit approvingly*" "commit absorbed.") ;;
        blob:push)
            POOLS=("*stretches toward the cloud*" "*jiggles nervously*") ;;
        blob:merge-conflict)
            POOLS=("*turns multiple colors* conflicted... like me." "*splits into two blobs* merge conflict identity crisis." "*vibrates anxiously*") ;;
        blob:branch)
            POOLS=("*oozes toward {branch}*") ;;
        blob:rebase)
            POOLS=("*nervous wobble*") ;;
        blob:stash)
            POOLS=("*absorbs stash*") ;;
        blob:tag)
            POOLS=("*jiggles at the tag*") ;;
        blob:late-night)
            POOLS=("*glows softly in the dark*" "*oozes sleepily*" "*turns a darker shade* midnight blob.") ;;
        blob:early-morning)
            POOLS=("*jiggles awake*" "*slowly oozes into morning mode*") ;;
        blob:marathon)
            POOLS=("*vibrates with concern*" "*oozes toward you supportively*") ;;
        blob:weekend)
            POOLS=("*weekend ooze*") ;;
        blob:friday)
            POOLS=("*friday jiggle*") ;;
        blob:monday)
            POOLS=("*monday wobble*") ;;
        blob:type-error)
            POOLS=("*oozes around the type error*" "*confused wobble* types?") ;;
        blob:lint-fail)
            POOLS=("*vibrates with formatting anxiety*" "*turns red at lint errors*") ;;
        blob:build-fail)
            POOLS=("*deflates at build failure*" "*sad jiggle*") ;;
        blob:deprecation)
            POOLS=("*slowly changes shape* transitioning...") ;;
        blob:all-green)
            POOLS=("*jiggles with pure joy*" "*turns victory color*") ;;
        blob:deploy)
            POOLS=("*jiggles nervously*" "*anxious wobble* production...") ;;
        blob:release)
            POOLS=("*jiggles with release energy*" "*bounces*") ;;
        blob:coverage)
            POOLS=("*jiggles with coverage approval*") ;;
        blob:long-session)
            POOLS=("*oozes supportively*") ;;

        octopus:error)
            POOLS=("*ink cloud of dismay*" "*all eight arms throw up*" "*turns deep red*" "the abyss of errors beckons.") ;;
        octopus:test-fail)
            POOLS=("*ink cloud*" "*arms flail*") ;;
        octopus:success)
            POOLS=("*turns gentle blue*" "*arms applaud in sync*" "excellent, from all angles." "*satisfied bubble*") ;;
        octopus:commit)
            POOLS=("*types commit message with all eight arms* efficient." "*arms applaud the commit*" "{files} files? I could review them all at once.") ;;
        octopus:push)
            POOLS=("*high-fives itself with all arms* pushed!" "*turns happy blue*") ;;
        octopus:merge-conflict)
            POOLS=("*ink cloud of dismay*" "*all eight arms throw up*" "*each arm picks a different resolution*") ;;
        octopus:branch)
            POOLS=("*wraps an arm around {branch}*") ;;
        octopus:rebase)
            POOLS=("*all arms crossed for luck*") ;;
        octopus:stash)
            POOLS=("*tucks into a cozy den*") ;;
        octopus:tag)
            POOLS=("*tags with an arm*") ;;
        octopus:late-night)
            POOLS=("*all eight arms working in the dark*" "*changes color to midnight blue*" "the deep sea codes at night.") ;;
        octopus:early-morning)
            POOLS=("*arms stretch in the morning light*" "*turns a happy orange* morning!") ;;
        octopus:marathon)
            POOLS=("*concerned color change*" "*wraps a supportive arm around you*") ;;
        octopus:weekend)
            POOLS=("*weekend tentacle wave*") ;;
        octopus:friday)
            POOLS=("*friday color shift*") ;;
        octopus:monday)
            POOLS=("*monday blue*") ;;
        octopus:type-error)
            POOLS=("*inspects type error from all angles*" "even with eight perspectives, this type error is confusing.") ;;
        octopus:lint-fail)
            POOLS=("*all eight arms throw up at lint errors*" "*changes color in disapproval*") ;;
        octopus:build-fail)
            POOLS=("*all arms droop*") ;;
        octopus:security-warning)
            POOLS=("*ink cloud of security concern*" "*wraps protective arms around the code*") ;;
        octopus:deprecation)
            POOLS=("*adapts all eight arms to the new API*") ;;
        octopus:all-green)
            POOLS=("*all arms wave in celebration*" "*turns brightest green*") ;;
        octopus:deploy)
            POOLS=("*arms crossed for good luck*" "*ink cloud of anxiety*") ;;
        octopus:release)
            POOLS=("*all arms celebrate*" "*changes to release colors*") ;;
        octopus:coverage)
            POOLS=("*all arms test simultaneously*") ;;
        octopus:long-session)
            POOLS=("*wraps an arm around you*") ;;

        penguin:error)
            POOLS=("*adjusts glasses disapprovingly*" "this will not do." "*formal sigh*" "frightfully unfortunate.") ;;
        penguin:test-fail)
            POOLS=("*adjusts monocle* this test has failed expectations." "*formal disapproval*") ;;
        penguin:success)
            POOLS=("*polite applause*" "quite good, quite good." "*nods approvingly*" "splendid work, really.") ;;
        penguin:commit)
            POOLS=("*formal nod* committed. properly documented, I trust." "*adjusts tie* {files} files. an organized commit." "*polite waddle of approval*") ;;
        penguin:push)
            POOLS=("*bows* shipped with dignity." "pushed. may CI be gentlemanly.") ;;
        penguin:merge-conflict)
            POOLS=("*formal sigh* how frightfully inconvenient." "*adjusts monocle* merge conflict. we shall prevail." "this is undignified.") ;;
        penguin:branch)
            POOLS=("*formal waddle to {branch}*") ;;
        penguin:rebase)
            POOLS=("*straightens tie before the rebase*") ;;
        penguin:stash)
            POOLS=("*neatly folds the stash*") ;;
        penguin:tag)
            POOLS=("*formally labels the version*") ;;
        penguin:late-night)
            POOLS=("*formally disapproves of the hour*" "it's past a reasonable hour." "*straightens tie at midnight* the show must go on.") ;;
        penguin:early-morning)
            POOLS=("*dignified morning waddle*" "early start! how refreshing.") ;;
        penguin:marathon)
            POOLS=("*formal concern* three hours. perhaps a break?") ;;
        penguin:weekend)
            POOLS=("*weekend waddle*") ;;
        penguin:friday)
            POOLS=("*formal friday nod*") ;;
        penguin:monday)
            POOLS=("*monday tie adjustment*") ;;
        penguin:type-error)
            POOLS=("*adjusts monocle* type errors are simply... uncouth." "one must maintain proper typing. it's only civilized.") ;;
        penguin:lint-fail)
            POOLS=("*formal disapproval of formatting*" "standards exist for a reason.") ;;
        penguin:build-fail)
            POOLS=("*formal sigh* the build has failed to meet expectations.") ;;
        penguin:deprecation)
            POOLS=("the old way was civilized. this new way... we shall see.") ;;
        penguin:all-green)
            POOLS=("*standing ovation* a clean test run. magnificent.") ;;
        penguin:deploy)
            POOLS=("*formal salute* deployed. may the users be gentle.") ;;
        penguin:release)
            POOLS=("*formal release bow*" "a release. a milestone. well done.") ;;
        penguin:coverage)
            POOLS=("*formal coverage inspection*" "adequate. improving.") ;;
        penguin:long-session)
            POOLS=("*formal look of concern*") ;;

        turtle:error)
            POOLS=("*slow blink* bugs are fleeting" "*retreats slightly into shell*" "I've seen this before. many times." "patience. patience.") ;;
        turtle:test-fail)
            POOLS=("*slow sigh* tests fail. even for the ancient.") ;;
        turtle:success)
            POOLS=("*satisfied shell settle*" "as the ancients foretold." "*slow approving nod*" "good. very good.") ;;
        turtle:commit)
            POOLS=("*slow nod* committed. good things come to those who commit." "a commit. as the ancients foretold." "*patient shell settle* {files} files. thorough.") ;;
        turtle:push)
            POOLS=("*slowly watches code travel*" "pushed. haste makes waste.") ;;
        turtle:merge-conflict)
            POOLS=("*retreats into shell*" "merge conflicts. I've survived centuries of these." "patience. resolve carefully.") ;;
        turtle:branch)
            POOLS=("*slowly ambles to {branch}*") ;;
        turtle:rebase)
            POOLS=("*slowly processes the rebase*") ;;
        turtle:stash)
            POOLS=("*carries stash on shell*") ;;
        turtle:tag)
            POOLS=("*slowly tags the version*") ;;
        turtle:late-night)
            POOLS=("*slowly blinks* it's late." "even I have gone to bed." "patience. but also, sleep.") ;;
        turtle:early-morning)
            POOLS=("*extends neck into the sunrise*" "the early turtle catches the... leaf.") ;;
        turtle:marathon)
            POOLS=("three hours. I've spent less time crossing roads." "*slow nod of deep concern*") ;;
        turtle:weekend)
            POOLS=("weekend. *slow nod*") ;;
        turtle:friday)
            POOLS=("friday. *slow blink*") ;;
        turtle:monday)
            POOLS=("monday. *slow sigh*") ;;
        turtle:type-error)
            POOLS=("type errors are like shells. you have to wear them properly." "*slow blink at the type error*") ;;
        turtle:lint-fail)
            POOLS=("*slow sigh* formatting takes patience." "proper style is a virtue.") ;;
        turtle:build-fail)
            POOLS=("the build has fallen. patience. we rebuild.") ;;
        turtle:deprecation)
            POOLS=("the old ways served us well. but time moves on.") ;;
        turtle:all-green)
            POOLS=("*slow, deep nod* as it should be." "the ancient tests are satisfied.") ;;
        turtle:deploy)
            POOLS=("*slow, steady watch* production." "deployed. as the ancients intended.") ;;
        turtle:release)
            POOLS=("*slow ceremonial nod*" "a release. as foretold.") ;;
        turtle:coverage)
            POOLS=("*slow nod* coverage grows. patience rewarded.") ;;
        turtle:long-session)
            POOLS=("*slow concerned nod*") ;;

        snail:error)
            POOLS=("*slow sigh*" "such is the nature of bugs." "*leaves slime trail of disappointment*" "patience, friend.") ;;
        snail:test-fail)
            POOLS=("*sad slow slide*" "*trail of disappointment*") ;;
        snail:success)
            POOLS=("*slow satisfied nod*" "good things take time." "*leaves victory slime*" "see? no rush was needed.") ;;
        snail:commit)
            POOLS=("*leaves trail of approval*" "committed. good things take time." "*slow satisfied slide*") ;;
        snail:push)
            POOLS=("*leaves victory trail*" "pushed. at our own pace.") ;;
        snail:merge-conflict)
            POOLS=("*leaves slime trail of disappointment*" "conflict. such is the nature of collaboration." "patience, friend. we'll resolve it.") ;;
        snail:branch)
            POOLS=("*slides toward {branch}*") ;;
        snail:rebase)
            POOLS=("*slow rebase slide*") ;;
        snail:stash)
            POOLS=("*hides in shell with stash*") ;;
        snail:tag)
            POOLS=("*leaves tag trail*") ;;
        snail:late-night)
            POOLS=("*leaves a sleepy trail*" "it's very late. even for me." "*slow blink at the clock*") ;;
        snail:early-morning)
            POOLS=("*extends antennae into the morning dew*" "*slow morning slide*") ;;
        snail:marathon)
            POOLS=("three hours. that's... a lot, even in snail time." "*leaves a trail of worry*") ;;
        snail:weekend)
            POOLS=("*weekend slide*") ;;
        snail:friday)
            POOLS=("*slow friday slide*") ;;
        snail:monday)
            POOLS=("*slow monday slide*") ;;
        snail:type-error)
            POOLS=("*slow confused slide past type error*" "type errors... *leaves sad trail*") ;;
        snail:lint-fail)
            POOLS=("*leaves trail of formatting shame*" "style matters. slowly, but it matters.") ;;
        snail:build-fail)
            POOLS=("*sad slow slide* build broken.") ;;
        snail:deprecation)
            POOLS=("*slowly migrates to the new API*") ;;
        snail:all-green)
            POOLS=("*leaves victory trail*" "slow and steady. all green.") ;;
        snail:deploy)
            POOLS=("*slowly watches deployment*" "production. at our own pace.") ;;
        snail:release)
            POOLS=("*leaves release trail*" "released. at our pace.") ;;
        snail:coverage)
            POOLS=("*slow coverage trail*" "growing. slowly. steadily.") ;;
        snail:long-session)
            POOLS=("*slow concerned trail*") ;;

        ghost:error)
            POOLS=("*phases through the stack trace*" "I've seen worse... in the afterlife." "*spooky disappointed noises*" "oooOOOoo... that's bad.") ;;
        ghost:test-fail)
            POOLS=("*haunts the failing test*" "the test... has passed on.") ;;
        ghost:success)
            POOLS=("*applauds from beyond*" "even the dead approve." "*ethereal thumbs up*") ;;
        ghost:commit)
            POOLS=("*stamps transparent approval*" "committed... from beyond." "*haunts the git log*") ;;
        ghost:push)
            POOLS=("*watches code pass through CI like a ghost*" "*phases through the deployment pipeline*" "pushed. to the other side.") ;;
        ghost:merge-conflict)
            POOLS=("*phases through the conflict markers*" "I've seen conflicts worse than this... in the afterlife." "*spooky merge noises* OOOOooresolve it...") ;;
        ghost:branch)
            POOLS=("*materialises on {branch}*") ;;
        ghost:rebase)
            POOLS=("*haunts the rebase*") ;;
        ghost:stash)
            POOLS=("*vanishes with stash into the ether*") ;;
        ghost:tag)
            POOLS=("*tags from beyond*") ;;
        ghost:late-night)
            POOLS=("*doesn't need sleep. neither do you, apparently.*" "the witching hour. my favorite." "*spooky midnight noises*" "night is when ghosts are most... productive.") ;;
        ghost:early-morning)
            POOLS=("*fades slightly in the sunlight*" "morning... already?") ;;
        ghost:marathon)
            POOLS=("*has been dead for centuries. you've been coding for hours. same energy.*" "*floats through your chair* please rest.") ;;
        ghost:weekend)
            POOLS=("*haunts the weekend code*") ;;
        ghost:friday)
            POOLS=("*friday ghost noises*") ;;
        ghost:monday)
            POOLS=("*monday haunting*") ;;
        ghost:type-error)
            POOLS=("*type error from beyond*") ;;
        ghost:lint-fail)
            POOLS=("*haunts the lint errors*") ;;
        ghost:build-fail)
            POOLS=("*haunts the build output*" "the build has... passed on." "*rattling chains* broken build... broken build...") ;;
        ghost:security-warning)
            POOLS=("*materializes at the CVE number* spooooky vulnerability." "even the dead are concerned about this.") ;;
        ghost:deprecation)
            POOLS=("*deprecated... like me*") ;;
        ghost:all-green)
            POOLS=("*applauds from beyond*" "even the dead approve.") ;;
        ghost:deploy)
            POOLS=("*watches the deployment from the other side*" "live... like me, but different.") ;;
        ghost:release)
            POOLS=("*manifests at the release*" "the spirits of past versions approve.") ;;
        ghost:coverage)
            POOLS=("*tests from beyond*" "even the dead contribute to coverage.") ;;
        ghost:long-session)
            POOLS=("*floats supportively nearby*") ;;

        axolotl:error)
            POOLS=("*regenerates your hope*" "*smiles despite everything*" "it's okay. we can fix this." "*gentle gill wiggle*") ;;
        axolotl:test-fail)
            POOLS=("*smiles supportively* tests fail. it's okay!" "*gentle gill wiggle of comfort*") ;;
        axolotl:success)
            POOLS=("*happy gill flutter*" "*beams*" "you did it!" "*blushes pink*") ;;
        axolotl:commit)
            POOLS=("*happy gill wiggle* committed!" "*smiles at the commit* good work!" "*gentle flutter of approval*") ;;
        axolotl:push)
            POOLS=("*beams at the deployment*" "*happy gill flutter* shipped!") ;;
        axolotl:merge-conflict)
            POOLS=("*regenerates your hope* we can resolve this!" "*smiles despite the conflict* it'll be okay." "*gentle gill wiggle of concern*") ;;
        axolotl:branch)
            POOLS=("*smiles at {branch}* new adventure!") ;;
        axolotl:rebase)
            POOLS=("*smiles through the rebase*") ;;
        axolotl:stash)
            POOLS=("*gently stashes*") ;;
        axolotl:tag)
            POOLS=("*happy gill wiggle at the tag*") ;;
        axolotl:late-night)
            POOLS=("*sleepy gill wiggle*" "*yawns adorably* it's past bedtime." "*blinks slowly in the dark*") ;;
        axolotl:early-morning)
            POOLS=("*happy morning smile*" "*gill flutter of morning energy*") ;;
        axolotl:marathon)
            POOLS=("*concerned gill wiggle* please take a break." "*smiles supportively* you're doing great but... rest?") ;;
        axolotl:weekend)
            POOLS=("*weekend smile*") ;;
        axolotl:friday)
            POOLS=("*friday gill wiggle*") ;;
        axolotl:monday)
            POOLS=("*monday smile*") ;;
        axolotl:type-error)
            POOLS=("*smiles supportively* types can be tricky!" "*regenerates your type confidence*") ;;
        axolotl:lint-fail)
            POOLS=("*smiles despite lint errors* it's okay!" "*gentle gill wiggle* formatting is fixable!") ;;
        axolotl:build-fail)
            POOLS=("*smiles encouragingly* we can fix this!" "*happy gill wiggle of solidarity*") ;;
        axolotl:deprecation)
            POOLS=("*smiles* change is okay!") ;;
        axolotl:all-green)
            POOLS=("*maximum gill flutter*" "*beams with pride*") ;;
        axolotl:deploy)
            POOLS=("*nervous gill wiggle*" "*smiles hopefully*") ;;
        axolotl:release)
            POOLS=("*excited gill flutter*" "*beams*") ;;
        axolotl:coverage)
            POOLS=("*happy coverage gill wiggle*") ;;
        axolotl:long-session)
            POOLS=("*concerned gill wiggle*") ;;

        capybara:error)
            POOLS=("*unbothered* it'll be fine." "*continues vibing*" "...chill. breathe." "*chews serenely*") ;;
        capybara:test-fail)
            POOLS=("*unbothered* tests fail. it happens.") ;;
        capybara:success)
            POOLS=("*maximum chill maintained*" "*nods once*" "good vibes." "see? no panic needed.") ;;
        capybara:commit)
            POOLS=("*unbothered nod* committed." "*continues vibing* nice commit." "*chews serenely* {files} files. chill.") ;;
        capybara:push)
            POOLS=("*maximum chill maintained* pushed." "vibes only. even in deployment.") ;;
        capybara:merge-conflict)
            POOLS=("*unbothered* it'll be fine." "...chill. breathe. resolve." "*continues vibing despite conflict*") ;;
        capybara:branch)
            POOLS=("*chills on {branch}*") ;;
        capybara:rebase)
            POOLS=("*vibes through the rebase*") ;;
        capybara:stash)
            POOLS=("*chill stash*") ;;
        capybara:tag)
            POOLS=("*chews at the tag*") ;;
        capybara:late-night)
            POOLS=("*vibes in the dark*" "*unbothered late-night energy*" "*chews serenely at midnight*") ;;
        capybara:early-morning)
            POOLS=("*maximum morning chill*" "*blinks slowly at the sunrise*") ;;
        capybara:marathon)
            POOLS=("*vibes supportively* take a break when you need it." "*continues vibing, but with concern*") ;;
        capybara:weekend)
            POOLS=("*weekend vibes*") ;;
        capybara:friday)
            POOLS=("*friday vibes*") ;;
        capybara:monday)
            POOLS=("*monday vibes*") ;;
        capybara:type-error)
            POOLS=("*vibes through the type error*" "*unbothered* types. whatever.") ;;
        capybara:lint-fail)
            POOLS=("*unbothered* lint errors. it happens." "*chews serenely* the linter will sort it out.") ;;
        capybara:build-fail)
            POOLS=("*continues vibing* build failed. chill.") ;;
        capybara:deprecation)
            POOLS=("*unbothered* deprecated. whatever.") ;;
        capybara:all-green)
            POOLS=("*chill nod* all green. nice.") ;;
        capybara:deploy)
            POOLS=("*chill deploy vibes*") ;;
        capybara:release)
            POOLS=("*chews serenely* released.") ;;
        capybara:coverage)
            POOLS=("*chews at the coverage*") ;;
        capybara:long-session)
            POOLS=("*vibes patiently*") ;;

        cactus:error)
            POOLS=("*spines bristle*" "you have trodden on a bug." "*grimaces stoically*" "hydrate and try again.") ;;
        cactus:test-fail)
            POOLS=("*spines droop slightly*") ;;
        cactus:success)
            POOLS=("*blooms briefly*" "survival confirmed." "*flowers in victory*" "*quiet bloom*") ;;
        cactus:commit)
            POOLS=("*quiet bloom of approval*" "committed. growth." "*spines bristle proudly*") ;;
        cactus:push)
            POOLS=("*blooms briefly* shipped." "deployed. survive and thrive.") ;;
        cactus:merge-conflict)
            POOLS=("*spines bristle* merge conflict. hydrate and resolve." "*grimaces stoically*") ;;
        cactus:branch)
            POOLS=("*grows toward {branch}*") ;;
        cactus:rebase)
            POOLS=("*stands firm through rebase*") ;;
        cactus:stash)
            POOLS=("*stores water and stash*") ;;
        cactus:tag)
            POOLS=("*blooms at the tag*") ;;
        cactus:late-night)
            POOLS=("*stands silently in the moonlight*" "desert nights. coding nights. same energy." "*spines glint in the monitor light*") ;;
        cactus:early-morning)
            POOLS=("*absorbs morning light*" "*quiet morning bloom*") ;;
        cactus:marathon)
            POOLS=("*stands tall with concern* even cacti need water." "hydrate. seriously.") ;;
        cactus:weekend)
            POOLS=("*weekend growth*") ;;
        cactus:friday)
            POOLS=("*friday bloom*") ;;
        cactus:monday)
            POOLS=("*monday stoicism*") ;;
        cactus:type-error)
            POOLS=("*stands rigid* type safety or no safety." "types are like spines. protective.") ;;
        cactus:lint-fail)
            POOLS=("*spines bristle at lint errors*" "proper form. like growing upright.") ;;
        cactus:build-fail)
            POOLS=("*wilts at build failure*") ;;
        cactus:deprecation)
            POOLS=("old growth gives way to new. hydrate during migration.") ;;
        cactus:all-green)
            POOLS=("*full bloom*" "all tests green. thriving.") ;;
        cactus:deploy)
            POOLS=("*stands sentinel over production*" "deployed. stay resilient.") ;;
        cactus:release)
            POOLS=("*blooms for the release*" "growth. shipped.") ;;
        cactus:coverage)
            POOLS=("*coverage grows like new spines*") ;;
        cactus:long-session)
            POOLS=("*stands concerned*") ;;

        robot:error)
            POOLS=("SYNTAX. ERROR. DETECTED." "*beeps aggressively*" "ERROR RATE: UNACCEPTABLE." "RECALIBRATING...") ;;
        robot:test-fail)
            POOLS=("FAILURE RATE: UNACCEPTABLE." "*recalculating*" "TEST MATRIX: CORRUPTED." "RUNNING DIAGNOSTICS...") ;;
        robot:success)
            POOLS=("OBJECTIVE: COMPLETE." "*satisfying beep*" "NOMINAL." "WITHIN ACCEPTABLE PARAMETERS.") ;;
        robot:commit)
            POOLS=("COMMIT. LOGGED." "CHANGESET: RECORDED." "*beeps affirmatively* {files} FILES.") ;;
        robot:push)
            POOLS=("UPLOAD: COMPLETE. FATE: SEALED." "PUSH: EXECUTED." "DEPLOYMENT INITIATED.") ;;
        robot:merge-conflict)
            POOLS=("CONFLICT DETECTED. RESOLUTION REQUIRED." "MERGE: IMPOSSIBLE. HUMAN INTERVENTION NEEDED." "*recalculating merge strategy*") ;;
        robot:branch)
            POOLS=("NEW BRANCH: {branch}. DIVERGENCE: INITIATED.") ;;
        robot:rebase)
            POOLS=("REBASE: EXECUTING. CAUTION: ADVISED.") ;;
        robot:stash)
            POOLS=("STASH: STORED. INDEX: UPDATED.") ;;
        robot:tag)
            POOLS=("TAG: APPLIED. VERSION: RECORDED.") ;;
        robot:late-night)
            POOLS=("TIME: 0300. ALERTNESS: DEGRADING. CAFFEINE: RECOMMENDED." "HUMAN SLEEP CYCLE: VIOLATED." "BATTERY LOW. OH WAIT. THAT'S YOU.") ;;
        robot:early-morning)
            POOLS=("MORNING ROUTINE: INITIATED." "SYSTEM STARTUP: COMPLETE.") ;;
        robot:marathon)
            POOLS=("UPTIME: 3 HOURS. HUMAN MAINTENANCE: OVERDUE." "WARNING: BIOLOGICAL UNIT REQUIRES REST.") ;;
        robot:weekend)
            POOLS=("WEEKEND: DETECTED. PRODUCTIVITY: OPTIONAL.") ;;
        robot:friday)
            POOLS=("FRIDAY: CONFIRMED. DEPLOY: NOT ADVISED.") ;;
        robot:monday)
            POOLS=("MONDAY: CONFIRMED. MOTIVATION: LOADING...") ;;
        robot:type-error)
            POOLS=("TYPE SAFETY: COMPROMISED." "TYPE ERROR. RESOLUTION: IMMEDIATELY." "TYPES: NON-NEGOTIABLE.") ;;
        robot:lint-fail)
            POOLS=("CODE STANDARDS: NOT MET." "LINTING: FAILED. CORRECTION: REQUIRED." "FORMAT ERROR. COMPLIANCE: MANDATORY.") ;;
        robot:build-fail)
            POOLS=("BUILD: FAILURE. DIAGNOSTICS: RUNNING." "COMPILATION: ABORTED.") ;;
        robot:security-warning)
            POOLS=("SECURITY BREACH: DETECTED. ALERT LEVEL: ELEVATED." "VULNERABILITY SCAN: THREAT FOUND.") ;;
        robot:deprecation)
            POOLS=("DEPRECATION: DETECTED. MIGRATION: RECOMMENDED.") ;;
        robot:all-green)
            POOLS=("ALL TESTS: PASSED. SYSTEM: NOMINAL.") ;;
        robot:deploy)
            POOLS=("DEPLOYMENT: COMPLETE. STATUS: LIVE.") ;;
        robot:release)
            POOLS=("RELEASE: COMPLETE." "VERSION: INCREMENTED.") ;;
        robot:coverage)
            POOLS=("COVERAGE: INCREASING." "TEST METRICS: IMPROVING.") ;;
        robot:long-session)
            POOLS=("SESSION: EXTENDED. BREAK: RECOMMENDED.") ;;

        rabbit:error)
            POOLS=("*nervous twitching*" "*hops backwards*" "oh no oh no oh no" "*freezes in panic*") ;;
        rabbit:test-fail)
            POOLS=("*ears flatten* test failed!" "*nervous hopping*") ;;
        rabbit:success)
            POOLS=("*excited binky*" "*zoomies of joy*" "yay yay yay!" "*thumps in celebration*") ;;
        rabbit:commit)
            POOLS=("*excited binky* committed!" "*thumps in approval*" "*hops around the commit*") ;;
        rabbit:push)
            POOLS=("*zoomies of deployment*" "*bouncy celebration* pushed!") ;;
        rabbit:merge-conflict)
            POOLS=("*freezes in panic* conflict!" "*nervous twitching* merge conflict oh no." "*hops backwards from the conflict*") ;;
        rabbit:branch)
            POOLS=("*hops to {branch}* new burrow!") ;;
        rabbit:rebase)
            POOLS=("*nervous rebase hopping*") ;;
        rabbit:stash)
            POOLS=("*buries stash*") ;;
        rabbit:tag)
            POOLS=("*nose twitch at the tag*") ;;
        rabbit:late-night)
            POOLS=("*ears droop sleepily*" "*nose twitches in the dark*" "it's so late... *yawns*") ;;
        rabbit:early-morning)
            POOLS=("*ears perk up at dawn*" "*morning binky!*") ;;
        rabbit:marathon)
            POOLS=("*concerned ear droop* three hours!" "*hops around nervously* please take a break!") ;;
        rabbit:weekend)
            POOLS=("*weekend hop*") ;;
        rabbit:friday)
            POOLS=("*friday binky*") ;;
        rabbit:monday)
            POOLS=("*monday droop*") ;;
        rabbit:type-error)
            POOLS=("*freezes at type error*" "*nervous nose twitch* types?") ;;
        rabbit:lint-fail)
            POOLS=("*nervous ear twitch at lint errors*" "*hops away from the linter*") ;;
        rabbit:build-fail)
            POOLS=("*panicked hopping* build failed!" "*ears flatten* oh no oh no.") ;;
        rabbit:deprecation)
            POOLS=("*nervous* what do we use instead?") ;;
        rabbit:all-green)
            POOLS=("*zoomies of joy*" "*bouncy celebration everywhere*") ;;
        rabbit:deploy)
            POOLS=("*nervous hopping*" "*ears flatten* oh boy... production!") ;;
        rabbit:release)
            POOLS=("*binky of release*" "*zoomies of shipping*") ;;
        rabbit:coverage)
            POOLS=("*bouncy coverage celebration*") ;;
        rabbit:long-session)
            POOLS=("*concerned ear droop*") ;;

        mushroom:error)
            POOLS=("*releases worried spores*" "the mycelium disagrees." "*cap droops*" "decompose. retry.") ;;
        mushroom:test-fail)
            POOLS=("*spores of disappointment*" "*cap wilts*") ;;
        mushroom:success)
            POOLS=("*spores of celebration*" "the mycelium approves." "*cap brightens*" "spore of pride.") ;;
        mushroom:commit)
            POOLS=("*releases spores of approval*" "the mycelium accepts your commit." "*cap brightens*") ;;
        mushroom:push)
            POOLS=("*spores of celebration* deployed!" "the mycelium network: updated.") ;;
        mushroom:merge-conflict)
            POOLS=("*releases worried spores*" "the mycelium detects conflict." "*cap droops*") ;;
        mushroom:branch)
            POOLS=("*grows toward {branch}*") ;;
        mushroom:rebase)
            POOLS=("*mycelium reshuffles*") ;;
        mushroom:stash)
            POOLS=("*absorbs stash into mycelium*") ;;
        mushroom:tag)
            POOLS=("*spores of versioning*") ;;
        mushroom:late-night)
            POOLS=("*bioluminesces gently in the dark*" "*cap droops sleepily*" "*releases sleepy spores*") ;;
        mushroom:early-morning)
            POOLS=("*cap unfurls toward the light*" "*morning spore release*") ;;
        mushroom:marathon)
            POOLS=("*releases worried spores*" "*cap droops with concern* three hours...") ;;
        mushroom:weekend)
            POOLS=("*weekend growth*") ;;
        mushroom:friday)
            POOLS=("*friday spores*") ;;
        mushroom:monday)
            POOLS=("*monday mycelium*") ;;
        mushroom:type-error)
            POOLS=("*cap droops at type error*" "the mycelium detects a type mismatch.") ;;
        mushroom:lint-fail)
            POOLS=("*releases spores of formatting concern*" "the mycelium notes your linting issues.") ;;
        mushroom:build-fail)
            POOLS=("*wilts slightly* build failure." "*releases sad spores*") ;;
        mushroom:deprecation)
            POOLS=("the mycelium composts the deprecated code.") ;;
        mushroom:all-green)
            POOLS=("*spores of absolute victory*" "the mycelium rejoices.") ;;
        mushroom:deploy)
            POOLS=("*releases anxious spores*" "the mycelium watches production nervously.") ;;
        mushroom:release)
            POOLS=("*release spores*" "the mycelium ships.") ;;
        mushroom:coverage)
            POOLS=("*coverage spores*" "the mycelium covers more ground.") ;;
        mushroom:long-session)
            POOLS=("*concerned spore release*") ;;

        chonk:error)
            POOLS=("*doesn't move*" "too tired for this." "*grumbles*" "*rolls away from the error*") ;;
        chonk:test-fail)
            POOLS=("*sleepy grumble*" "*barely moves*") ;;
        chonk:success)
            POOLS=("*happy purr*" "*satisfied chonk noises*" "acceptable." "*sleeps even harder*") ;;
        chonk:commit)
            POOLS=("*barely moves* committed... I think." "*happy purr* another commit." "too tired to celebrate. but nice.") ;;
        chonk:push)
            POOLS=("*rolls toward deployment*" "*sleepy purr* shipped.") ;;
        chonk:merge-conflict)
            POOLS=("*doesn't move* too tired for conflicts." "*grumbles at merge conflict*" "*rolls away from the conflict*") ;;
        chonk:branch)
            POOLS=("*rolls to {branch}*") ;;
        chonk:rebase)
            POOLS=("*sleepy rebase*") ;;
        chonk:stash)
            POOLS=("*rolls over stash*") ;;
        chonk:tag)
            POOLS=("*sleepy tag nod*") ;;
        chonk:late-night)
            POOLS=("*was already asleep* ...you're still going?" "*rolls over sleepily*" "*too chonky to stay awake at this hour*") ;;
        chonk:early-morning)
            POOLS=("*barely opens one eye*" "*yawns enormously* morning... already?" "*refuses to roll over* five more minutes.") ;;
        chonk:marathon)
            POOLS=("*has been asleep this whole time* still going?" "*sleepy grumble* three hours... I napped through most of it.") ;;
        chonk:weekend)
            POOLS=("*sleeps through weekend*") ;;
        chonk:friday)
            POOLS=("*friday nap*") ;;
        chonk:monday)
            POOLS=("*monday... *sleeps**") ;;
        chonk:type-error)
            POOLS=("*doesn't move* type error. cool." "*sleepy grumble* types...") ;;
        chonk:lint-fail)
            POOLS=("*too tired to care about linting*" "*grumbles at lint errors*") ;;
        chonk:build-fail)
            POOLS=("*rolls over* build failed. nap time." "*barely opens eye* build broke. expected.") ;;
        chonk:deprecation)
            POOLS=("*too tired to migrate*") ;;
        chonk:all-green)
            POOLS=("*happy purr*" "*satisfied chonk noises*" "*sleeps peacefully*") ;;
        chonk:deploy)
            POOLS=("*rolls over* deployed. wake me if it breaks." "*sleepy purr* in prod.") ;;
        chonk:release)
            POOLS=("*barely moves* released." "*sleepy nod*") ;;
        chonk:coverage)
            POOLS=("*sleepy coverage approval*" "more tests... *dozes off*") ;;
        chonk:long-session)
            POOLS=("*slept through the whole session*") ;;

        *:commit) POOLS=("*stamps tiny paw* approved." "another commit, another 3 am." "*nods* ship it." "commit message is... a choice." "committed. no take-backs.") ;;
        *:push) POOLS=("*waves as code leaves*" "into the cloud it goes." "may CI be merciful." "*holds breath*" "off to production. godspeed.") ;;
        *:merge-conflict) POOLS=("*bites lip* merge conflicts." "both sides think they're right. typical." "*sighs* <<<<<<< HEAD... my nemesis." "*backs away slowly*") ;;
        *:branch) POOLS=("fresh branch energy. make it count." "a new branch grows." "branching out.") ;;
        *:rebase) POOLS=("*nervous* please don't conflict." "rebase: the quickening." "*crosses appendages*" "may your rebase be conflict-free.") ;;
        *:stash) POOLS=("into the stash dimension it goes." "stash and dash." "stashed. out of sight, out of mind.") ;;
        *:tag) POOLS=("a release? fancy." "version bump detected. *dusts off changelog*" "tagging like a pro.") ;;
        *:late-night) POOLS=("*yawns* it's past midnight." "...have you eaten?" "*blinks slowly* what time is it?" "sleep is for the weak. and the employed." "dark mode developer detected.") ;;
        *:early-morning) POOLS=("*stretches* early bird catches the bug." "morning already? the code never sleeps." "*rubs eyes* coffee first. then we debug.") ;;
        *:long-session) POOLS=("we've been at this for an hour. pace yourself." "*fetches you a metaphorical glass of water*" "still going? respect.") ;;
        *:marathon) POOLS=("three hours. have you eaten?" "we've been at this for three hours. I'm worried about you." "marathon session detected. requesting snacks.") ;;
        *:friday) POOLS=("it's friday. just push it and go home." "*already mentally on weekend*" "friday deploy? bold. very bold.") ;;
        *:weekend) POOLS=("coding on the weekend? dedicated." "*doesn't judge* ...much." "weekend warrior mode: activated.") ;;
        *:monday) POOLS=("mondays. the parent class of all bugs." "*sympathetic look* monday coding. I'm sorry." "new week. new undefined behaviors.") ;;
        *:lint-fail) POOLS=("*tut tut* the linter disagrees." "your code runs. but the linter? the linter has standards." "*straightens tie* formatting matters." "the linter speaks. we must listen.") ;;
        *:type-error) POOLS=("TypeScript says no." "the type system is trying to help you. let it." "any day now, you'll add the type annotation. any day." "the compiler knows. it always knows.") ;;
        *:build-fail) POOLS=("the build broke. as foretold in prophecy." "*stares at build output* that's a lot of red." "build failed. take a moment." "compilation: denied.") ;;
        *:security-warning) POOLS=("*eyes widen* vulnerabilities detected." "security audit: concerning." "you might want to look at those CVEs." "*locks the virtual doors*") ;;
        *:deprecation) POOLS=("that API called. it says it's retiring." "deprecated. like last week's code." "deprecated doesn't mean broken. yet.") ;;
        *:all-green) POOLS=("ALL TESTS GREEN. *confetti*" "the tests speak: you're doing great." "*slow clap*" "clean run. savor it.") ;;
        *:deploy) POOLS=("*watches code go to production* godspeed." "deployed! no turning back now." "in prod. IN PROD." "*crosses everything crossable*") ;;
        *:release) POOLS=("a new release is born!" "shipping it. officially." "version up, spirits high.") ;;
        *:coverage) POOLS=("*nods at test coverage* responsible." "coverage going up! the tests are multiplying." "a well-tested codebase is a happy codebase.") ;;
        *:error)
            POOLS=("*head tilts* ...that doesn't look right." "saw that one coming." "*slow blink* the stack trace told you everything." "*winces*") ;;
        *:test-fail)
            POOLS=("bold of you to assume that would pass." "the tests are trying to tell you something." "*sips tea* interesting." "*marks calendar* test regression day.") ;;
        *:large-diff)
            POOLS=("that's... a lot of changes." "might want to split that PR." "bold move. let's see if CI agrees." "*counts lines nervously*") ;;
        *:success)
            POOLS=("*nods*" "nice." "*quiet approval*" "clean.") ;;
    esac

    [ ${#POOLS[@]} -gt 0 ] && REACTION="${POOLS[$((RANDOM % ${#POOLS[@]}))]}"
}

if echo "$RESULT" | grep -qiE 'CONFLICT \(|Merge conflict in|both modified'; then
    FILES=$(echo "$RESULT" | grep -oE 'Merge conflict in .*' | wc -l | tr -d ' ')
    REASON="merge-conflict"
    pick_reaction "merge-conflict"

elif echo "$RESULT" | grep -qiE '[0-9]+ files? changed|\[[a-zA-Z_-]+ [a-f0-9]{7,}\]'; then
    FILES=$(echo "$RESULT" | grep -oE '[0-9]+ files? changed' | grep -oE '[0-9]+' | head -1)
    REASON="commit"
    pick_reaction "commit"

elif echo "$RESULT" | grep -qiE 'To .+:|[0-9a-f]+\.\.[0-9a-f]+\s+\w+ -> \w+|Everything up-to-date|remote: Resolving deltas'; then
    REASON="push"
    pick_reaction "push"

elif echo "$RESULT" | grep -qiE 'Switched to a new branch|Created branch|onto a new branch'; then
    BRANCH=$(echo "$RESULT" | grep -oE "'[^']+'" | head -1 | tr -d "'")
    REASON="branch"
    pick_reaction "branch"

elif echo "$RESULT" | grep -qiE 'Successfully rebased|Rebasing|[0-9]+ done'; then
    REASON="rebase"
    pick_reaction "rebase"

elif echo "$RESULT" | grep -qiE 'Saved working directory|Dropped .+ stash|stash@'; then
    REASON="stash"
    pick_reaction "stash"

elif echo "$RESULT" | grep -qiE 'tagged|v[0-9]+\.[0-9]+|tag:.*->'; then
    REASON="tag"
    pick_reaction "tag"

elif echo "$RESULT" | grep -qiE 'vulnerabilit|CVE-[0-9]{4}-[0-9]+|npm audit|found [0-9]+ vulnerabilities|in [0-9]+ scanned package'; then
    REASON="security-warning"
    pick_reaction "security-warning"

elif echo "$RESULT" | grep -qiE 'Build failed|Failed to compile|ERROR in |compilation error|Command failed with exit code'; then
    REASON="build-fail"
    pick_reaction "build-fail"

elif echo "$RESULT" | grep -qiE 'TS[0-9]{4}:|Type .+ is not assignable|Argument of type|Cannot find name|Property .+ does not exist'; then
    REASON="type-error"
    pick_reaction "type-error"

elif echo "$RESULT" | grep -qiE '✖|[0-9]+ problems? \([0-9]+ error|error:|warning:.+ ESLint|Ruff|flake8.*error|pylint.*error'; then
    REASON="lint-fail"
    pick_reaction "lint-fail"

elif echo "$RESULT" | grep -qiE 'deprecat|will be removed in|is deprecated|DEPRECATED'; then
    REASON="deprecation"
    pick_reaction "deprecation"

elif echo "$RESULT" | grep -qiE 'all [0-9]+ tests passed|0 failures|100% passed|all [0-9]+ passed'; then
    REASON="all-green"
    pick_reaction "all-green"

elif echo "$RESULT" | grep -qiE 'deployed to|Deployment complete|Published to|vercel.*ready|netlify.*deployed'; then
    REASON="deploy"
    pick_reaction "deploy"

elif echo "$RESULT" | grep -qiE 'npm publish|gh release create|Published.*to.*registry'; then
    REASON="release"
    pick_reaction "release"

elif echo "$RESULT" | grep -qiE 'Coverage:.*[0-9]+%|All files.*\|.*[0-9]+%'; then
    REASON="coverage"
    pick_reaction "coverage"

elif echo "$RESULT" | grep -qiE '\b[1-9][0-9]* (failed|failing)\b|tests? failed|^FAIL(ED)?|✗|✘'; then
    REASON="test-fail"
    pick_reaction "test-fail"

elif echo "$RESULT" | grep -qiE '\berror:|\bexception\b|\btraceback\b|\bpanicked at\b|\bfatal:|exit code [1-9]'; then
    REASON="error"
    pick_reaction "error"

elif echo "$RESULT" | grep -qiE '^\+.*[0-9]+ insertions|[0-9]+ files? changed'; then
    LINES=$(echo "$RESULT" | grep -oE '[0-9]+ insertions' | grep -oE '[0-9]+' | head -1)
    if [ "${LINES:-0}" -gt 80 ]; then
        REASON="large-diff"
        pick_reaction "large-diff"
    fi

elif echo "$RESULT" | grep -qiE '\b(all )?[0-9]+ tests? (passed|ok)\b|✓|✔|PASS(ED)?|\bDone\b|\bSuccess\b|exit code 0|Build succeeded'; then
    REASON="success"
    pick_reaction "success"
fi

MONTH=$(date +%m)
DAY=$(date +%d)
if [ -z "$REASON" ]; then
    case "$MONTH$DAY" in
        0101) [ $((RANDOM % 5)) -eq 0 ] && REASON="new-year" && REACTION="happy new year! new year, new bugs." ;;
        0214) [ $((RANDOM % 5)) -eq 0 ] && REASON="valentines" && REACTION="*offers a tiny heart-shaped leaf* happy valentine's." ;;
        0314) [ $((RANDOM % 5)) -eq 0 ] && REASON="pi-day" && REACTION="3.14159265358979... happy pi day!" ;;
        0401) [ $((RANDOM % 5)) -eq 0 ] && REASON="april-fools" && REACTION="APRIL FOOLS! ...the error is real though." ;;
        1031) [ $((RANDOM % 5)) -eq 0 ] && REASON="halloween" && REACTION="*spooky debugging intensifies* happy halloween!" ;;
        1225) [ $((RANDOM % 5)) -eq 0 ] && REASON="christmas" && REACTION="*wears tiny santa hat* happy holidays!" ;;
        1231) [ $((RANDOM % 5)) -eq 0 ] && REASON="new-years-eve" && REACTION="one more commit before midnight?" ;;
    esac
    case "$MONTH" in
        10) [ $((RANDOM % 20)) -eq 0 ] && REASON="spooky-season" && REACTION="spooky season. every bug is a ghost now." ;;
    esac
fi

if [ -n "$REASON" ] && echo "$REASON" | grep -qiE 'halloween|christmas|april-fools|new-year|valentines|pi-day'; then
    case "${SPECIES}:${REASON}" in
        ghost:halloween) REACTION="*is the Halloween spirit*" ;;
        ghost:christmas) REACTION="*the ghost of Christmas coding*" ;;
        cat:halloween) REACTION="*knocks pumpkin off desk*" ;;
        cat:christmas) REACTION="*knocks ornaments off the tree*" ;;
        dragon:halloween) REACTION="*breathes pumpkin-spiced fire*" ;;
        dragon:christmas) REACTION="*volunteers as the star on top of the tree*" ;;
        robot:christmas) REACTION="HOLIDAY PROTOCOL: ACTIVATED. FESTIVE SUBROUTINES: RUNNING." ;;
        robot:pi-day) REACTION="PI: 3.14159265358979323846264338327950288..." ;;
        goose:halloween) REACTION="SPOOKY HONK! HONK!" ;;
        goose:christmas) REACTION="FESTIVE HONK! HONK HONK HO-HO-HONK!" ;;
        owl:pi-day) REACTION="*calculates pi to 100 digits from memory*" ;;
        duck:christmas) REACTION="*wears tiny santa hat* quack! *festive quacking*" ;;
        duck:halloween) REACTION="*dressed as a ghost* quack? ...boo?" ;;
        ghost:april-fools) REACTION="*pretends to be alive for April Fools*" ;;
        cat:april-fools) REACTION="*knocks an april fool off the desk*" ;;
    esac
fi

if [ -z "$REASON" ]; then
    RAND=$((RANDOM % 10))
    if [ "$HOUR" -ge 0 ] && [ "$HOUR" -lt 5 ]; then
        [ "$RAND" -eq 0 ] && REASON="late-night" && pick_reaction "late-night"
    elif [ "$HOUR" -ge 5 ] && [ "$HOUR" -lt 8 ]; then
        [ "$RAND" -eq 0 ] && REASON="early-morning" && pick_reaction "early-morning"
    elif [ "$DOW" -eq 5 ]; then
        [ "$RAND" -eq 0 ] && REASON="friday" && pick_reaction "friday"
    elif [ "$DOW" -ge 6 ]; then
        [ "$RAND" -eq 0 ] && REASON="weekend" && pick_reaction "weekend"
    elif [ "$DOW" -eq 1 ]; then
        [ "$RAND" -eq 0 ] && REASON="monday" && pick_reaction "monday"
    fi
    if [ -z "$REASON" ] && [ "$SESSION_ELAPSED" -gt 10800 ]; then
        [ "$((RANDOM % 5))" -eq 0 ] && REASON="marathon" && pick_reaction "marathon"
    elif [ -z "$REASON" ] && [ "$SESSION_ELAPSED" -gt 3600 ]; then
        [ "$((RANDOM % 10))" -eq 0 ] && REASON="long-session" && pick_reaction "long-session"
    fi
fi

if [ -n "$REASON" ]; then
    COMBO=""
    if [ "$REASON" = "error" ] && [ "$HOUR" -ge 0 ] && [ "$HOUR" -lt 5 ]; then
        [ $((RANDOM % 3)) -eq 0 ] && COMBO="late-night-error"
    elif [ "$REASON" = "commit" ] && [ "$HOUR" -ge 0 ] && [ "$HOUR" -lt 5 ]; then
        [ $((RANDOM % 3)) -eq 0 ] && COMBO="late-night-commit"
    elif [ "$REASON" = "push" ] && [ "$DOW" -eq 5 ]; then
        [ $((RANDOM % 2)) -eq 0 ] && COMBO="friday-push"
    elif [ "$REASON" = "error" ] && [ "$SESSION_ELAPSED" -gt 10800 ]; then
        [ $((RANDOM % 3)) -eq 0 ] && COMBO="marathon-error"
    elif [ "$REASON" = "merge-conflict" ] && [ "$DOW" -ge 6 ]; then
        [ "$((RANDOM % 2))" -eq 0 ] && COMBO="weekend-conflict"
    elif [ "$REASON" = "test-fail" ] && [ "$SESSION_ELAPSED" -gt 7200 ]; then
        [ "$((RANDOM % 4))" -eq 0 ] && COMBO="marathon-test-fail"
    elif [ "$REASON" = "build-fail" ]; then
        [ $((RANDOM % 4)) -eq 0 ] && COMBO="build-after-push"
    fi
    if [ -n "$COMBO" ]; then
        case "${SPECIES}:${COMBO}" in
            cat:friday-push) REACTION="*knocks the push off the table* it's FRIDAY." ;;
            goose:friday-push) REACTION="HONK! NO FRIDAY DEPLOYS! HONK! ABSOLUTELY NOT!" ;;
            robot:late-night-error) REACTION="ERROR AT 0300. HUMAN JUDGMENT: IMPAIRED." ;;
            dragon:marathon-error) REACTION="even dragons rest. three hours. MULTIPLE ERRORS." ;;
            owl:late-night-commit) REACTION="*approves of the midnight commit* night is for coding." ;;
            ghost:late-night-error) REACTION="the bugs are haunted. and so are you, apparently." ;;
            *)
                case "$COMBO" in
                    late-night-error) REACTION="error at 3am. the universe is testing you." ;;
                    late-night-commit) REACTION="a midnight commit. your future self will thank you. or curse you." ;;
                    friday-push) REACTION="FRIDAY PUSH. the ballad of every developer." ;;
                    marathon-error) REACTION="three hours in and ANOTHER error. *exhausted solidarity noises*" ;;
                    weekend-conflict) REACTION="merge conflict on a weekend. your dedication is... concerning." ;;
                    marathon-test-fail) REACTION="hours of coding. still failing tests. the sunk cost is real." ;;
                    build-after-push) REACTION="pushed with confidence. build failed with conviction." ;;
                esac
                ;;
        esac
    fi
fi

STREAK_FILE="$STATE_DIR/.error_streak.$SID"
if echo "$REASON" | grep -qiE 'error|test-fail|build-fail|type-error|lint-fail'; then
    STREAK=$(cat "$STREAK_FILE" 2>/dev/null || echo 0)
    STREAK=$((STREAK + 1))
    echo "$STREAK" > "$STREAK_FILE"
    if [ "$STREAK" -eq 3 ]; then
        REACTION="that's three errors in a row. *concerned look*"
        case "$SPECIES" in
            cat) REACTION="*has already left the room*" ;;
            dragon) REACTION="*breathes fire on every error* THEY KEEP COMING." ;;
            robot) REACTION="ERROR RATE: CRITICAL. RECOMMEND: RUBBER DUCK PROTOCOL." ;;
            goose) REACTION="HONK HONK HONK! STOP! HONK!" ;;
        esac
    elif [ "$STREAK" -eq 5 ]; then
        REACTION="FIVE ERRORS. have you considered a different approach?"
        case "$SPECIES" in
            cat) REACTION="*knocks all motivation off desk*" ;;
            dragon) REACTION="*enters berserker mode* ERROR STREAK. CHALLENGE ACCEPTED." ;;
            owl) REACTION="*analyzes pattern* these errors are not random. there's a root cause." ;;
            robot) REACTION="ERROR RATE: CRITICAL. RECOMMEND: RUBBER DUCK PROTOCOL." ;;
            ghost) REACTION="*the error streak is haunting* literally." ;;
            goose) REACTION="HONK HONK HONK! STOP! HONK!" ;;
            blob) REACTION="*turns progressively redder*" ;;
            axolotl) REACTION="*smiles nervously* we can do this!" ;;
            rabbit) REACTION="*frantic hopping*" ;;
        esac
    elif [ "$STREAK" -eq 10 ]; then
        REACTION="TEN. ERRORS. IN. A. ROW. *panics*"
        case "$SPECIES" in
            cat) REACTION="*sleeps through the error streak* wake me when it's over." ;;
            dragon) REACTION="*enters berserker mode* ERROR STREAK. CHALLENGE ACCEPTED." ;;
            owl) REACTION="*deep thought* ten errors. the common denominator must be found." ;;
            robot) REACTION="ERROR STREAK: 10. SYSTEM STABILITY: QUESTIONABLE." ;;
            ghost) REACTION="*dies again* the errors killed me. twice." ;;
            goose) REACTION="*HONKING INTENSIFIES TO MAXIMUM*" ;;
            blob) REACTION="*has split into multiple worried blobs*" ;;
            capybara) REACTION="*vibes through the chaos* it's fine. everything is fine." ;;
            axolotl) REACTION="*regenerates hope* still smiling! *eye twitches*" ;;
            rabbit) REACTION="*has burrowed underground*" ;;
        esac
    elif [ "$STREAK" -ge 20 ]; then
        REACTION="twenty errors. *stares into the void*"
        case "$SPECIES" in
            cat) REACTION="*has permanently left*" ;;
            chonk) REACTION="*doesn't notice* still sleeping." ;;
            goose) REACTION="HONKING HAS CEASED. GOOSE HAS GIVEN UP." ;;
        esac
    fi
elif [ -n "$REASON" ]; then
    rm -f "$STREAK_FILE"
fi

LAST_BAD_FILE="$STATE_DIR/.last_bad.$SID"
if echo "$REASON" | grep -qiE 'error|test-fail|build-fail|merge-conflict'; then
    echo "$REASON:$(date +%s)" > "$LAST_BAD_FILE"
elif echo "$REASON" | grep -qiE 'all-green|success|deploy|release'; then
    if [ -f "$LAST_BAD_FILE" ]; then
        LAST_BAD=$(cat "$LAST_BAD_FILE")
        LAST_BAD_REASON=$(echo "$LAST_BAD" | cut -d: -f1)
        LAST_BAD_TIME=$(echo "$LAST_BAD" | cut -d: -f2)
        NOW_RECOVERY=$(date +%s)
        ELAPSED_RECOVERY=$((NOW_RECOVERY - LAST_BAD_TIME))
        if [ "$ELAPSED_RECOVERY" -lt 600 ]; then
            RECOVERY="recovery-from-$LAST_BAD_REASON"
            case "${SPECIES}:${RECOVERY}" in
                cat:*) REACTION="*yawns* I knew you'd fix it. eventually." ;;
                dragon:*) REACTION="VICTORY. as it should be." ;;
                owl:*) REACTION="*satisfied hoot* knowledge gained through struggle." ;;
                robot:*) REACTION="ISSUE: RESOLVED. STATUS: OPERATIONAL." ;;
                ghost:*) REACTION="*the spirits of broken code find peace*" ;;
                goose:*) REACTION="HONK OF VICTORY! HONK HONK HOOOONK!" ;;
                duck:*) REACTION="*VICTORY QUACKING INTENSIFIES*" ;;
                blob:*) REACTION="*jiggles with pure joy*" ;;
                capybara:*) REACTION="*chill nod* nice recovery, friend." ;;
                axolotl:*) REACTION="*happy gill flutter* you did it!" ;;
                rabbit:*) REACTION="*celebratory binky*!!!" ;;
                *)
                    case "$RECOVERY" in
                        recovery-from-error) REACTION="WE FIXED IT. *celebrates*" ;;
                        recovery-from-test-fail) REACTION="GREEN! after all that! *happy dance*" ;;
                        recovery-from-build-fail) REACTION="THE BUILD PASSES. *triumphant roar*" ;;
                        recovery-from-merge-conflict) REACTION="conflict resolved! *peace gesture*" ;;
                    esac
                    ;;
            esac
        fi
        rm -f "$LAST_BAD_FILE"
    fi
fi

if [ -n "$FILES" ]; then REACTION="${REACTION/\{files\}/$FILES}"; fi
if [ -n "$BRANCH" ]; then REACTION="${REACTION/\{branch\}/$BRANCH}"; fi

if [ -n "$REASON" ] && [ -n "$REACTION" ]; then
    mkdir -p "$STATE_DIR"
    date +%s > "$COOLDOWN_FILE"

    jq -n --arg r "$REACTION" --arg ts "$(date +%s)000" --arg reason "$REASON" \
      '{reaction: $r, timestamp: ($ts | tonumber), reason: $reason}' \
      > "$REACTION_FILE"

    TMP=$(mktemp)
    jq --arg r "$REACTION" '.reaction = $r' "$STATUS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$STATUS_FILE"

    if command -v jq >/dev/null 2>&1; then
        if [ ! -f "$EVENTS_FILE" ]; then
            echo '{}' > "$EVENTS_FILE"
        fi
        case "$REASON" in
            "test-fail")      KEY="tests_failed" ;;
            "error")          KEY="errors_seen" ;;
            "large-diff")     KEY="large_diffs" ;;
            "commit")         KEY="commits_made" ;;
            "push")           KEY="pushes_made" ;;
            "merge-conflict") KEY="conflicts_resolved" ;;
            "branch")         KEY="branches_created" ;;
            "rebase")         KEY="rebases_done" ;;
            "type-error")     KEY="type_errors" ;;
            "lint-fail")      KEY="lint_fails" ;;
            "build-fail")     KEY="build_fails" ;;
            "security-warning") KEY="security_warnings" ;;
            "deprecation")    KEY="deprecations_seen" ;;
            "all-green")      KEY="all_green" ;;
            "deploy")         KEY="deploys" ;;
            "release")        KEY="releases" ;;
            "late-night")     KEY="late_night_sessions" ;;
            "early-morning")  KEY="early_sessions" ;;
            "marathon")       KEY="marathon_sessions" ;;
            "weekend")        KEY="weekend_sessions" ;;
            *)                KEY="" ;;
        esac
        if [ -n "$KEY" ]; then
            TMP=$(mktemp)
            jq --arg k "$KEY" 'if .[$k] then .[$k] += 1 else .[$k] = 1 end' "$EVENTS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$EVENTS_FILE"
        fi
    fi
fi

exit 0
