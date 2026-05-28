# stocktopus BDD tests

Plain-English browser tests for the stocktopus terminal.

## What this is

This folder holds our behaviour-driven tests. Each scenario is written in
Gherkin (the "Given / When / Then" language) and is run by Playwright,
which drives a real Chrome browser against the app.

The point: anyone on the team (engineer or not) can read a scenario and
understand what the product is supposed to do. If a scenario fails, the
report tells you exactly which sentence broke.

## How to run

You need the stocktopus dev server running first. In another terminal:

```
make dev
```

Then, from the repo root:

```
cd tests/bdd && npm install && npm test
```

Or from the repo root using the Makefile shortcut:

```
make bdd
```

The first run takes a minute while npm pulls Playwright and downloads the
Chrome binary. After that, runs are fast.

To watch the browser drive the app live:

```
npm run test:headed
```

## Where the scenarios live

- `features/` — one `.feature` file per area of the app, written in
  Gherkin. This is the human-readable spec.
- `steps/` — JavaScript glue that teaches Playwright what each Gherkin
  sentence means ("when I press k" -> press the k key).
- `support/` — shared helpers used by the step files.

The `.features-gen/` folder is generated at test time and is gitignored.

## How to add a scenario

1. Open or create a `.feature` file under `features/`.
2. Write a scenario in plain English:

   ```
   Scenario: Add a security to the watchlist
     Given the terminal is open
     When I type "AAPL" and press Enter
     Then "AAPL" appears in the watchlist
   ```

3. Run `npm test`. If a sentence is new, Playwright will print a stub
   you can copy into a `steps/` file and fill in.

That's it. Keep scenarios short, focused on user-visible behaviour, and
written the way a person would describe the feature, not the way the
code is structured.
