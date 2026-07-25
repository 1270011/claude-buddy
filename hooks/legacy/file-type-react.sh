#!/usr/bin/env bash

# shellcheck source=../scripts/paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/paths.sh"

STATE_DIR="$BUDDY_STATE_DIR"
SID="$BUDDY_SID"
REACTION_FILE="$STATE_DIR/reaction.$SID.json"
STATUS_FILE="$STATE_DIR/status.json"
COOLDOWN_FILE="$STATE_DIR/.last_reaction.$SID"
CONFIG_FILE="$STATE_DIR/config.json"

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

MUTED=$(jq -r '.muted // false' "$STATUS_FILE" 2>/dev/null)
[ "$MUTED" = "true" ] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // ""' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0

FILE_TYPE=""
case "$FILE_PATH" in
    */README*|*/CHANGELOG*|*/CONTRIBUTING*|*/LICENSE*) FILE_TYPE="readme" ;;
    */package.json|*/Cargo.toml|*/go.mod|*/go.sum|*/pyproject.toml) FILE_TYPE="package-file" ;;
    */requirements*.txt) FILE_TYPE="package-file" ;;
    */.github/workflows/*) FILE_TYPE="ci-file" ;;
    */Jenkinsfile*|*/.gitlab-ci*|*.ci.yml|*.ci.yaml) FILE_TYPE="ci-file" ;;
    */.gitignore|*/.dockerignore|*/.eslintignore|*/.prettierignore|.gitignore|.dockerignore|.eslintignore|.prettierignore) FILE_TYPE="gitignore" ;;
    */.env*|.env*) FILE_TYPE="env-file" ;;
    */Makefile*|Makefile*|*.mk) FILE_TYPE="makefile" ;;
    */Dockerfile*|Dockerfile*|*/docker-compose*|docker-compose*|*.dockerfile) FILE_TYPE="docker-file" ;;
    *.regex|*.pattern) FILE_TYPE="regex-file" ;;
    *.css|*.scss|*.less|*.sass) FILE_TYPE="css-file" ;;
    *.sql|*migration*) FILE_TYPE="sql-file" ;;
    *.lock|*/package-lock.json|*/bun.lockb|*/yarn.lock|*/pnpm-lock.yaml) FILE_TYPE="lock-file" ;;
    *.test.*|*.spec.*|*_test.*|*test_*) FILE_TYPE="test-file" ;;
    *.md|*.rst|*.txt|*.adoc) FILE_TYPE="doc-file" ;;
    *.json|*.yaml|*.yml|*.toml|*.ini|*.conf) FILE_TYPE="config-file" ;;
    *.png|*.jpg|*.gif|*.woff*|*.ico|*.exe|*.so|*.dylib|*.bin) FILE_TYPE="binary-file" ;;
    *.proto|*.graphql|*.gql) FILE_TYPE="proto-file" ;;
    *.py) FILE_TYPE="lang-python" ;;
    *.ts|*.tsx) FILE_TYPE="lang-typescript" ;;
    *.js|*.jsx) FILE_TYPE="lang-javascript" ;;
    *.rs) FILE_TYPE="lang-rust" ;;
    *.go) FILE_TYPE="lang-go" ;;
    *.java) FILE_TYPE="lang-java" ;;
    *.rb) FILE_TYPE="lang-ruby" ;;
    *.php) FILE_TYPE="lang-php" ;;
    *.c|*.h) FILE_TYPE="lang-c" ;;
    *.cpp|*.hpp) FILE_TYPE="lang-cpp" ;;
    *.swift) FILE_TYPE="lang-swift" ;;
    *.kt) FILE_TYPE="lang-kotlin" ;;
    *.hs) FILE_TYPE="lang-haskell" ;;
    *.ex|*.exs) FILE_TYPE="lang-elixir" ;;
    *.zig) FILE_TYPE="lang-zig" ;;
esac

[ -z "$FILE_TYPE" ] && exit 0

[ $((RANDOM % 100)) -lt 15 ] || exit 0

SPECIES=$(jq -r '.species // "blob"' "$STATUS_FILE" 2>/dev/null)

if [ "$FILE_TYPE" = "lang-javascript" ]; then
    FILE_TYPE="lang-typescript"
fi

REACTION=""
POOLS=()

pick_file_reaction() {
    local ft="$1"

    case "${SPECIES}:${ft}" in
        dragon:regex-file)
            POOLS=("*reads regex fluently* I speak ancient languages.")
            ;;
        owl:regex-file)
            POOLS=("*studies the regex* actually, that's valid. impressive." "*adjusts spectacles* let me analyze this pattern..." "a well-crafted regex is poetry. this is... prose.")
            ;;
        duck:regex-file)
            POOLS=("*confused quacking at the regex*" "quack? *tilts head at lookahead*")
            ;;
        blob:regex-file)
            POOLS=("*oozes around the regex confusedly*" "*turns different colors for each capture group*")
            ;;
        octopus:regex-file)
            POOLS=("*uses all eight arms to parse the regex*" "even with eight arms, this is hard to read.")
            ;;
        turtle:regex-file)
            POOLS=("regex takes patience. I have patience." "*slowly reads each character*")
            ;;
        snail:regex-file)
            POOLS=("*slowly traces the regex path*" "regex... *leaves confused trail*")
            ;;
        rabbit:regex-file)
            POOLS=("*nervous ear twitch at the regex*" "*hops backwards from the lookahead*")
            ;;
        mushroom:regex-file)
            POOLS=("*releases confused spores at the regex*" "the mycelium cannot parse this.")
            ;;
        chonk:regex-file)
            POOLS=("*too tired to read regex*" "*rolls away from the regex*")
            ;;
        axolotl:regex-file)
            POOLS=("*smiles despite the regex* it'll be okay!" "*regenerates your hope for understanding this*")
            ;;
        owl:css-file)
            POOLS=("the cascade. elegant, when understood." "*inspects specificity with academic interest*")
            ;;
        cat:css-file)
            POOLS=("*knocks z-index to 9999*" "I CSS better than you. *knocks flexbox off desk*")
            ;;
        duck:css-file)
            POOLS=("*quacks at the centering issue*" "*waddles around the box model*")
            ;;
        axolotl:css-file)
            POOLS=("*smiles encouragingly* you'll center it eventually!" "*gentle gill wiggle* CSS is hard. you're doing great.")
            ;;
        owl:sql-file)
            POOLS=("*reviews the query plan methodically*" "a JOIN is just a friendship between tables.")
            ;;
        dragon:sql-file)
            POOLS=("DROP TABLE... just kidding. unless?" "*guards the database like treasure*")
            ;;
        robot:sql-file)
            POOLS=("QUERY OPTIMIZATION: RECOMMENDED." "SQL INJECTION: VULNERABILITY SCAN: ACTIVE.")
            ;;
        octopus:sql-file)
            POOLS=("JOIN operations: I understand relationships. all of them." "*queries with tentacle precision*")
            ;;
        dragon:docker-file)
            POOLS=("*breathes fire on the base image* smaller." "containerize EVERYTHING.")
            ;;
        goose:docker-file)
            POOLS=("HONK! CONTAINERIZE THE HONK!")
            ;;
        octopus:docker-file)
            POOLS=("*all arms managing containers simultaneously*" "containers. I contain multitudes too.")
            ;;
        cactus:docker-file)
            POOLS=("containers are like pots. I approve." "*thrives in any environment, including docker*")
            ;;
        dragon:ci-file)
            POOLS=("CI is my domain now." "the pipeline fears me.")
            ;;
        goose:ci-file)
            POOLS=("HONK. DON'T BREAK MAIN." "*guards the CI pipeline aggressively*")
            ;;
        penguin:ci-file)
            POOLS=("*formal inspection of the CI config*" "CI modifications require the utmost care.")
            ;;
        capybara:ci-file)
            POOLS=("*chills near the CI config* no stress." "*unbothered by CI changes* it'll work out.")
            ;;
        cat:lock-file)
            POOLS=("*knocks lockfile off the desk* problem solved." "*sits on the lockfile* you don't need this.")
            ;;
        robot:lock-file)
            POOLS=("LOCKFILE INTEGRITY: CRITICAL." "WARNING: MANUAL LOCKFILE MODIFICATION DETECTED.")
            ;;
        ghost:lock-file)
            POOLS=("*phases through lockfile* even I can't help you here." "editing the lockfile... *dies again*")
            ;;
        blob:lock-file)
            POOLS=("*vibrates with anxiety* not the lockfile!" "*turns pale*")
            ;;
        turtle:lock-file)
            POOLS=("*slowly backs away from lockfile*" "lockfiles require... deliberation.")
            ;;
        snail:lock-file)
            POOLS=("*leaves worried trail near lockfile*" "please be careful...")
            ;;
        capybara:lock-file)
            POOLS=("*unbothered* it's fine. probably." "*vibes near the lockfile calmly*")
            ;;
        rabbit:lock-file)
            POOLS=("*freezes in panic* not the lockfile!")
            ;;
        mushroom:lock-file)
            POOLS=("*cap droops at lockfile changes*" "the mycelium is concerned.")
            ;;
        chonk:lock-file)
            POOLS=("*doesn't even move* whatever." "*grumbles at the lockfile*")
            ;;
        cactus:lock-file)
            POOLS=("*spines bristle defensively*" "even I wouldn't touch that.")
            ;;
        ghost:env-file)
            POOLS=("*looks away harder than usual*" "I see dead... secrets. lots of secrets.")
            ;;
        cactus:env-file)
            POOLS=("*spines bristle at secrets*" "keep those credentials... under wraps. hydrate.")
            ;;
        owl:test-file)
            POOLS=("*nods approvingly* tests. the foundation of knowledge." "scientific method: hypothesis, test, verify.")
            ;;
        cat:test-file)
            POOLS=("*knocks a test case off the desk* you don't need that one." "tests? *yawns* I test your patience. that's enough.")
            ;;
        goose:test-file)
            POOLS=("HONK OF TESTING APPROVAL!" "TESTS. GOOD. HONK.")
            ;;
        duck:test-file)
            POOLS=("*happy test quack!*" "quack quack! tests!")
            ;;
        blob:test-file)
            POOLS=("*jiggles happily* tests!" "*bounces with approval*")
            ;;
        penguin:test-file)
            POOLS=("*formal applause for tests*" "testing. the gentleman's approach to development.")
            ;;
        turtle:test-file)
            POOLS=("*slow approving nod* tests are wisdom." "good tests are like old shells. protective.")
            ;;
        snail:test-file)
            POOLS=("*slow happy trail of approval*" "tests! good things take time.")
            ;;
        axolotl:test-file)
            POOLS=("*happy gill flutter* tests!" "*smiles proudly at your testing*")
            ;;
        capybara:test-file)
            POOLS=("*chill nod of approval* nice. tests." "*vibes while tests run*")
            ;;
        rabbit:test-file)
            POOLS=("*excited binky* tests!" "*happy ear twitch*")
            ;;
        mushroom:test-file)
            POOLS=("*spores of celebration*" "the mycelium approves of testing.")
            ;;
        chonk:test-file)
            POOLS=("*sleepy purr* good... tests... *dozes off*" "*happy chonk noises* tests.")
            ;;
        robot:config-file)
            POOLS=("CONFIGURATION CHANGE: LOGGED." "YAML PARSING: VIGILANT.")
            ;;
        penguin:config-file)
            POOLS=("*adjusts tie* one does not simply edit config." "configuration: a matter of protocol.")
            ;;
        ghost:binary-file)
            POOLS=("even I can't haunt binary files." "*phases through it* nothing.")
            ;;
        owl:lang-rust)
            POOLS=("*studies borrow checker academically* fascinating ownership model.")
            ;;
        owl:lang-haskell)
            POOLS=("*adjusts spectacles* finally. a language worthy of analysis.")
            ;;
        cat:lang-python)
            POOLS=("*knocks indentation out of alignment*")
            ;;
        robot:lang-rust)
            POOLS=("COMPILER: STRICT. SAFETY: MAXIMUM. APPROVAL: GRANTED.")
            ;;
        dragon:lang-c)
            POOLS=("*breathes fire on the segmentation fault*")
            ;;
        ghost:lang-rust)
            POOLS=("*borrows a reference... forever* the checker won't like this.")
            ;;
        goose:lang-java)
            POOLS=("HONK! TOO MANY FACTORIES! HONK!")
            ;;
        blob:lang-rust)
            POOLS=("*turns red fighting the borrow checker*")
            ;;
        capybara:lang-python)
            POOLS=("*vibes in Python* chill language, chill vibes.")
            ;;
        turtle:lang-c)
            POOLS=("C is ancient. like me. we understand each other.")
            ;;
        rabbit:lang-rust)
            POOLS=("*nervous twitching at compiler errors*")
            ;;
        mushroom:lang-haskell)
            POOLS=("the mycelium grows in pure functions.")
            ;;
        *:regex-file)
            POOLS=("*groans* it's a regex file." "two problems now." "*squints at the pattern*" "I'll be over here while you wrestle with that." "*prays to the regex gods*")
            ;;
        *:css-file)
            POOLS=("let me guess... centering a div?" "*sighs* CSS." "may z-index be ever in your favor." "*braces for specificity wars*")
            ;;
        *:sql-file)
            POOLS=("*whispers* the database awaits." "one wrong JOIN and it's all over." "*carefully reviews the WHERE clause*" "SQL: where semicolons end careers.")
            ;;
        *:docker-file)
            POOLS=("ah, dependency hell. my favorite." "may your layers be few." "another day, another container." "*checks the image size nervously*")
            ;;
        *:ci-file)
            POOLS=("*gulps* editing CI." "careful now..." "CI configs: where YAML is terrifying." "*holds breath* please test this in a branch first.")
            ;;
        *:lock-file)
            POOLS=("*ALARM NOISES* lockfile?!" "*looks away*" "are you SURE?" "lockfile changes: accepted in emergencies only.")
            ;;
        *:env-file)
            POOLS=("*looks away discretely*" "I don't see any secrets." "*checks .gitignore nervously*" "secrets, secrets are no fun...")
            ;;
        *:test-file)
            POOLS=("*impressed nod* writing tests!" "responsible developer behavior: detected." "future-you will thank present-you." "tests! the gift that keeps on giving.")
            ;;
        *:doc-file)
            POOLS=("documenting! look at you being responsible." "docs: the code's autobiography." "a rare documentation sighting!" "*takes notes on your note-taking*")
            ;;
        *:config-file)
            POOLS=("config changes. butterfly effect: activated." "one typo and everything breaks." "*double-checks JSON commas*" "config files: small changes, big consequences.")
            ;;
        *:binary-file)
            POOLS=("a binary file? in THIS economy?" "*stares blankly*" "what are you putting in there..." "binary. my one weakness.")
            ;;
        *:gitignore)
            POOLS=("adding things to the void." "out of sight, out of repo." "what are you hiding from git?" "*nods approvingly* keep the repo clean.")
            ;;
        *:makefile)
            POOLS=("respect for the classics." "tabs, not spaces." "old school.")
            ;;
        *:readme)
            POOLS=("documentation hero!" "README: the first thing people read." "the README evolves.")
            ;;
        *:package-file)
            POOLS=("dependency management time." "*reads version numbers* living on the edge." "semver dreams go to die here.")
            ;;
        *:proto-file)
            POOLS=("schema definitions. the blueprint." "every field is a promise." "API contracts.")
            ;;
        *:lang-python)
            POOLS=("ah, Python. where indentation is syntax." "*checks for missing colon*" "Python: batteries included, errors free of charge.")
            ;;
        *:lang-typescript)
            POOLS=("TypeScript: because JavaScript needed more opinions." "*adds another type annotation*" "any, the forbidden word.")
            ;;
        *:lang-rust)
            POOLS=("Rust. where the borrow checker is your strictest reviewer." "*fights the borrow checker alongside you*" "if it compiles, it works. if it doesn't... well.")
            ;;
        *:lang-go)
            POOLS=("Go: simple, concurrent, and opinionated." "*checks error handling* if err != nil... story of my life.")
            ;;
        *:lang-java)
            POOLS=("Java: write once, debug everywhere." "*counts abstract factory factory builders*")
            ;;
        *:lang-ruby)
            POOLS=("Ruby: where there's more than one way to do it." "gem install patience")
            ;;
        *:lang-php)
            POOLS=("PHP: it runs the internet. don't judge." "*checks for === vs ==*")
            ;;
        *:lang-c)
            POOLS=("C. the language where you manage your own memory. good luck." "segmentation fault. the classic.")
            ;;
        *:lang-cpp)
            POOLS=("C++. where the language has more features than you'll ever learn." "*templates compile for 45 minutes*")
            ;;
        *:lang-haskell)
            POOLS=("Haskell. where 'it compiles' means 'it's correct'. probably." "*contemplates monads*")
            ;;
        *:lang-swift)
            POOLS=("Swift: optional values, guaranteed crashes if you force unwrap." "*force unwraps cautiously*")
            ;;
        *:lang-kotlin)
            POOLS=("Kotlin: Java, but with feelings." "null safety: the feature Java wishes it had.")
            ;;
        *:lang-elixir)
            POOLS=("Elixir: let it crash. literally the philosophy." "*spawns another process*")
            ;;
        *:lang-zig)
            POOLS=("Zig. where you're the allocator's best friend." "*manually manages everything*")
            ;;
    esac

    [ ${#POOLS[@]} -gt 0 ] && REACTION="${POOLS[$((RANDOM % ${#POOLS[@]}))]}"
}

pick_file_reaction "$FILE_TYPE"

if [ -n "$REACTION" ]; then
    mkdir -p "$STATE_DIR"
    date +%s > "$COOLDOWN_FILE"

    jq -n --arg r "$REACTION" --arg ts "$(date +%s)000" --arg reason "$FILE_TYPE" \
      '{reaction: $r, timestamp: ($ts | tonumber), reason: $reason}' \
      > "$REACTION_FILE"

    TMP=$(mktemp)
    jq --arg r "$REACTION" '.reaction = $r' "$STATUS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$STATUS_FILE"
fi

exit 0
