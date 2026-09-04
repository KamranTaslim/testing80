# Interview Prep Kit

Takes a pasted job description and a company website and produces a structured
interview preparation kit: a company brief, the role broken into requirements
with stable ids, a categorised question bank, flashcards, and a study schedule
covering exactly the number of days you have before the interview.

```bash
npm install
npm run evaluate -- --input cases.example.json --output kits.json
```

## Setup

Node 20.11 or newer. No database and no API key are needed to run it.

```bash
npm install
cp .env.example .env     # optional, everything has a default
npm test                 # 41 tests
npm start                # API + UI on http://localhost:4000
```

The repo bundles three small company sites under `fixtures/sites` for testing
the crawler locally:

```bash
npm run fixture:site -- --port 8099
```

* `/acme/` - hiring process written up in a team handbook
* `/quietco/` - no careers or hiring page at all
* `/deeporg/` - hiring process buried three levels deep in a public handbook

## Batch entry point

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Reads `[{ id, jd, company_url, days }]`, runs the same pipeline the web app
uses (`src/pipeline/buildKit.ts`), and writes:

```json
{ "version": "1.0", "generated_at": "...", "kits": [{ "id": "case-01", "status": "ok", "kit": { }, "error": null }] }
```

* each case uses its own `days` value;
* a case that fails is recorded and the run continues;
* cases run two at a time (`--concurrency` to change it);
* loopback and private addresses are allowed by this command, since evaluation
  sites may be served locally - `--no-private` turns the production URL guard
  back on;
* `status` is `failed` only when no kit could be produced at all. An
  unreachable company site still produces a kit from the posting, with the
  gaps recorded in `kit.research`.

## Tech stack

* TypeScript on Node 20, Express for the API.
* No scraping dependency: `fetch` plus a small HTML reader in
  `src/retrieval/html.ts` that pulls out the title, the readable text and the
  links (resolved against the page they were found on).
* LLM behind a provider interface. With `LLM_API_KEY` set it talks to any
  OpenAI-compatible endpoint (Groq's free tier, `llama-3.1-8b-instant`, by
  default). Without one it uses a deterministic offline model that answers the
  same task contract, so the batch command runs from a clean clone with no key
  and the tests are repeatable.
* Persistence behind a `KitStore` interface. The default is a JSON file store
  under `.data`, so nothing has to be installed; setting `MONGODB_URI` selects
  a Mongo implementation of the same interface. I chose this over requiring
  MongoDB because the brief asks the batch command to run with no setup beyond
  `npm install`.
* The interface is a single page of vanilla ES modules served by Express
  rather than a Next.js app. That is a deliberate trade against the preferred
  stack: most of the marks are in the pipeline, and a second build and deploy
  target would not have improved a single kit. It still does inline editing,
  drag-and-keyboard reordering, per-section regeneration, progress and error
  states, and practice mode.

## Architecture

```
src/
  domain/       types and the vocabulary used to read postings
  llm/          provider interface, retry, JSON repair, offline model
  retrieval/    URL guard, fetcher, robots.txt, HTML reader
  research/     link selection, crawler, page classification
  extraction/   posting outline, rule reader, requirement extraction
  generation/   company brief, questions per category, flashcards
  coverage/     coverage check and the gap-filling pass
  schedule/     day allocation
  validation/   kit structure validation
  pipeline/     orchestrator, regeneration, dependency factory
  persistence/  KitStore interface and file store
  api/          Express routes, auth, application service
  evaluation/   batch runner and CLI
```

## Research and generation steps

1. **Extract the posting.** The model reads it; the code then checks that every
   returned requirement is actually grounded in the posting text, re-derives
   `must` vs `nice` from the wording and the section it sits under, adds back
   any requirement line the model missed, and assigns ids `r1..rn` in posting
   order.
2. **Crawl the company site.** Fetch the homepage, keep the links whose anchor
   text or URL looks like an about or careers page, fetch those, and repeat to
   a depth of 3 or 14 pages, whichever comes first.
3. **Classify what came back.** Pages are sorted into hiring / about / other
   based on what they say, not where they live.
4. **Read the hiring page** if one was found, and pull out the stages and
   signals (take-home, system design, pairing, values, recruiter screen).
5. **Write the company brief** from the retrieved pages only. `sources` is set
   in code from the URLs we actually fetched.
6. **Generate questions**, one call per category batch. Technical requirements
   produce technical (and, for senior roles or architecture wording, system
   design) questions; behavioural requirements produce behavioural ones; domain
   requirements produce company-fit ones. A published system design round or
   take-home adds questions the posting alone would not have earned.
7. **Check coverage in code** and run the gap pass (below).
8. **Flashcards**, one per requirement plus a few company facts.
9. **Allocate the schedule in code**.
10. **Validate the kit structure** before saving or writing it out.

Priority, coverage and scheduling are never delegated to the model.

## Coverage and the second pass

`src/coverage/checker.ts` is a set operation: every requirement id, minus every
requirement id referenced by a question, is the gap. That is why requirements
have stable ids and questions carry `requirement_ids`.

The gap pass sends only the uncovered requirements back to the model and checks
again, up to `MAX_COVERAGE_PASSES` (default 3, and two is almost always
enough). `coverage.passes` records how many passes actually ran.

**Known limitation.** The gap pass regenerates technical questions only. A
behavioural or domain requirement that the first draft missed is reported in
`coverage.uncovered_requirement_ids` rather than being filled, so on a posting
with a long list of behavioural requirements a must-have can still ship
uncovered. It is the first thing I would fix with more time.

## Schedule allocation

Arithmetic in `src/schedule/allocator.ts`, not a prompt.

* Minutes come from difficulty (10/15/20), plus 5 for a system-design question
  and 5 for one covering a must-have.
* Questions are ordered must-first, then hardest, then by category.
* With more questions than days, each day takes a share of the total minutes
  from a front-loaded curve, so the hard material lands early.
* With more days than questions, each question gets its own day in priority
  order and the remaining days are marked as rest days. Filling them with
  spaced repetition would be better and is not implemented.
* The schedule always has exactly `days_available` days, `minutes` is always an
  integer, and every question is allocated to a day.

## Generated, edited and pinned state

The kit itself stays exactly as the structure requires. Builder state lives
next to it, in `KitDocument.item_state`, keyed by item id:

```ts
{ origin: 'generated' | 'edited' | 'manual', pinned: boolean, edited_at?, pass? }
```

Regenerating a category replaces only the questions in that category whose
origin is still `generated`; anything the user edited or wrote by hand
survives, and the model is asked only for the requirements the survivors do not
already cover. Other categories, the brief and the flashcards are untouched.
The schedule is recomputed from the new question set, and the whole kit is
re-validated before saving.

`pinned` is recorded by the API and shown in the interface, but the
regeneration path does not consult it yet - a pinned but unedited question can
still be replaced. See the TODO in `src/pipeline/regenerate.ts`.

## Practice mode

Cards are stepped through one at a time, the answer is revealed on demand, and
confidence is recorded on a four-point scale. The next session is ordered by a
simplified SM-2 interval: confidence 1 comes back in ten minutes, 4 in four
days, and the interval grows with consecutive successes. Due cards come first,
least confident first; unseen cards follow.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Invalid URL / 404 / timeout | variants of the URL are tried, then the site is recorded as unreachable and the kit is built from the posting (`status: ok`) |
| No hiring page | the hiring stage is skipped, `research.hiring_page_found: false`, and the brief says so |
| Two-line posting | only what the posting states is extracted, with a note that it is thin; nothing is invented |
| Invalid JSON from the model | tolerant parse (fences, prose, trailing commas), then a retry with a stricter instruction, then a per-stage fallback |
| Rate limit or transient failure | one retry after a fixed pause; see the limitation below |
| 1-day schedule | everything on day one |
| 60-day schedule | 60 days, material first, rest days after |
| Long generation | the API returns a queued document immediately and writes stage progress; the interface polls it |

Not handled as well as it should be: the same posting submitted twice through
the batch command is generated twice (the API deduplicates it by fingerprint,
the batch runner does not), and the retry does not read the `Retry-After`
header a provider sends with a 429.

## Security

* Every URL is validated before it is fetched: scheme allowlist, no
  credentials, blocked service ports, and DNS resolution checked against
  private, loopback and link-local ranges. Redirects are followed manually so
  each hop is re-validated. `ALLOW_PRIVATE_NETWORK` is the evaluation-mode
  switch and is false in production.
* Fetches are time-boxed, content-type checked and byte-capped.
* The posting and every crawled page are wrapped in markers the system prompt
  tells the model to distrust, and instruction-shaped sequences inside them are
  neutralised. The stronger defence is structural: the model only ever returns
  JSON that our code validates, and priorities, coverage and scheduling are
  decided afterwards in code.
* Passwords are hashed with scrypt; sessions are HMAC-signed, expiring,
  httpOnly cookies; every kit route is scoped to the owning user.

## Tests

```bash
npm test
```

41 tests, no network needed:

* `extraction.test.ts` - must vs nice, benefits and duties excluded, stable
  ids, kind classification, thin postings, invented requirements dropped,
  omitted ones recovered.
* `coverage.test.ts` - the gap set, dangling references, the second pass, and
  the behavioural gap it currently reports rather than fills.
* `schedule.test.ts` - exact day counts, everything allocated, integer minutes,
  ordering, 1-day and 60-day cases.
* `validation.test.ts` - the structural rules.
* `builder.test.ts` - regeneration preserving edited and hand-written items.
* `batch.test.ts` - five cases with a failure among them, Appendix B shape,
  partial research staying `ok`, per-case day counts.

## Environment variables

All documented in `.env.example`, all with defaults: `LLM_PROVIDER`,
`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_MAX_CONCURRENCY`,
`LLM_MAX_ATTEMPTS`, `LLM_TIMEOUT_MS`, `FETCH_TIMEOUT_MS`, `FETCH_MAX_BYTES`,
`CRAWL_DELAY_MS`, `CRAWL_MAX_PAGES`, `CRAWL_MAX_DEPTH`,
`ALLOW_PRIVATE_NETWORK`, `MONGODB_URI`, `KIT_STORE_DIR`, `PORT`,
`SESSION_SECRET`, `SESSION_TTL_HOURS`, `MAX_COVERAGE_PASSES`, `LOG_LEVEL`.

## Deployment

One Node process serves the API and the interface, so any free tier that runs
Node 20 works:

```
build:  npm install
start:  npm start
```

Set `SESSION_SECRET`, leave `ALLOW_PRIVATE_NETWORK` false, and set
`LLM_API_KEY` if you want the hosted model. `.env` is gitignored and no secret
is read from anywhere but the environment.

## Trade-offs and known limitations

* **No public-discussion search.** The brief asks for a look at what people say
  publicly about a company's interview process. I did not get to it: the
  research stage reads the company's own site only, so a kit for a company that
  is widely discussed online is thinner than it should be.
* **Link selection is keyword-based, not ranked.** It finds `/careers`,
  `/about` and links whose anchor text mentions hiring, which covers the common
  layouts, but it misses a hiring process filed under a heading it does not
  recognise - the `deeporg` fixture in this repo is exactly that case, and the
  crawler does not find it.
* **The gap pass only fills technical requirements** (see above).
* **Retry is a single fixed pause** and ignores `Retry-After`. Under a real
  free tier this will waste a request occasionally.
* **Validation is a shape check.** It does not verify that a schedule's
  `question_ids` all exist, or that `coverage` agrees with the questions -
  those hold by construction today, but nothing enforces them.
* **Long schedules leave rest days** rather than spaced review.
* The offline model writes competent but templated prose; with a hosted key the
  wording improves and the structure is identical, because the structure is
  code.
* English-language postings only.
