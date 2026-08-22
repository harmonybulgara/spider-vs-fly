# Spider vs Fly

This repo is a dependency-free grid game: an AI-controlled spider chases a player-controlled fly on a cartoony web.

Gameplay tweaks included: the spider grows over time, and it can shoot temporary web traps that the fly must avoid.
Every ~30 seconds, spiderlings (offspring) appear briefly as extra hazards.
After ~120 seconds of survival, the spider AI starts learning your fly movement transitions and predicting your next turns.

## Run

- Open `index.html` in your browser.

## Warning

- This game includes flashing red screens and motion effects (photosensitivity risk).

If you prefer a local server, use any static server you already have (for example VS Code “Live Server”).

## Controls

- Move the fly: Arrow keys / WASD (or the on-screen D-pad)
- Difficulty: Easy / Normal / Hard
- Start: **Start** (or first movement key)
- Pause/Resume: Space (or **Pause/Resume** button)
- Restart: Enter / R (or **Restart** button)
- Sound: **Sound: On/Off** (defaults to On; audio starts after your first interaction due to browser autoplay rules)
- Share: **Share** (adds `?seed=...&difficulty=...` so others get the same run setup)

## Scoring

- **Survival** shows the current run time.
- **Best** is your longest survival time (stored in `localStorage`).

## Audio notes

- Background music + SFX are generated with the Web Audio API (procedural synth/noise), with tempo increasing as the spider gets closer.
- Music tempo also increases the longer you survive.
- This does **not** use (or recreate) any copyrighted soundtrack.

## Logic tests

- Open `tests/spider-logic.test.html` in your browser.

## Export

- Use `export.html` to share/play as a single file (everything inlined: HTML/CSS/JS).
