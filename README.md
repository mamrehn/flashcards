<h1 align="center">
<a href="https://ghloc.vercel.app/mamrehn/flashcards?branch=main">FlashCards</a>
</h1><br>

Repository statistics:

| Type          | Lines of Code                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 📜 JavaScript | ![JavaScript LOC](https://img.shields.io/endpoint?url=https://ghloc.vercel.app/api/mamrehn/flashcards/badge?filter=.js$&format=human)          |
| 🎨 HTML + CSS | ![HTML/CSS LOC](https://img.shields.io/endpoint?url=https://ghloc.vercel.app/api/mamrehn/flashcards/badge?filter=.html$,.css$&format=human)    |
| 🃏 Deck JSON  | ![Deck JSON LOC](https://img.shields.io/endpoint?url=https://ghloc.vercel.app/api/mamrehn/flashcards/badge?filter=decks/.*.json$&format=human) |

**FlashCards** is a German-language flashcard Progressive Web App with two modes — a solo spaced-repetition study mode and a multiplayer quiz mode with host/player rooms over WebSocket. Built with vanilla JavaScript, HTML, and CSS — no frameworks, no build-time bundler on the client.

**Key Features:**

|                                  |                                                                         |
| -------------------------------- | ----------------------------------------------------------------------- |
| 📚 **Two Modes**                 | Study alone with spaced repetition, or host a live multiplayer quiz     |
| 🗂️ **Bring Your Own Deck**       | Upload `.json` or `.zip` deck files — or pick from the built-in library |
| 🎯 **Study Modes**               | Spaced repetition, incorrect-only, or read-through                      |
| 📝 **Card Types**                | Free-text and single/multiple choice, each with optional explanations   |
| 🌗 **Light / Dark Theme**        | System-aware with manual override                                       |
| 📴 **Offline-first PWA**         | Service worker with stale-while-revalidate and installable app shell    |
| 🛡️ **XSS-safe Rendering**        | Central `sanitize.js` guards all user-supplied deck content             |
| ☁️ **Deployed via GitHub Pages** | CI minifies, inlines CSS/JS into HTML, and pushes to `gh-pages`         |

## Quick Start

### Try it locally

The client is static — serve the repository root over HTTP and open [index.html](index.html):

```bash
# Pick any static server, e.g.:
python -m http.server 8000
# then open http://localhost:8000/
```

From the landing page, choose **Alleine lernen** for solo study or **Wissen testen** for the multiplayer quiz.

### Pick a deck

- Drag-and-drop or upload a `.json` / `.zip` deck file in either mode
- Or open the [library](library.html) for ready-made sample decks from [decks/](decks/)

### Deck format

A deck is JSON with a `meta` block and a `cards` array. Free-text and multiple-choice cards can be mixed in the same deck. See [decks/beispiel-allgemeinwissen.json](decks/beispiel-allgemeinwissen.json) for a complete example:

```jsonc
{
    "meta": {
        "name": "Allgemeinwissen Mini-Quiz",
        "subject": "Allgemeinwissen",
        "gradeLevel": "Alle Klassen",
        "learningUnit": "Kein Fach",
        "description": "Beispiel-Deck.",
        "author": "Flashcards Demo",
    },
    "cards": [
        {
            "categories": ["Geografie"],
            "question": "Was ist die Hauptstadt von Deutschland?",
            "answer": "Berlin",
            "explanation": "Berlin ist seit 1990 die Hauptstadt.",
        },
        {
            "categories": ["Mathematik"],
            "question": "Welche sind Primzahlen?",
            "options": ["2", "4", "7", "9", "11"],
            "correct": [0, 2, 4],
            "explanations": {
                "0": "2 ist die einzige gerade Primzahl.",
                "1": "4 = 2×2, also nicht prim.",
            },
        },
    ],
}
```

A `.zip` deck bundles one or more `.json` files; the library manifest is regenerated on each deploy by [scripts/build-library-manifest.js](scripts/build-library-manifest.js).

## Multiplayer Quiz

The quiz mode uses a tiny WebSocket relay hosted on Fly.io. All quiz logic — scoring, timers, question flow — lives in the host's browser; the server only forwards messages between the host and the joined players.

```
┌──────────┐        ┌───────────────────────┐        ┌──────────┐
│  Host    │  WS    │  qlash-server         │  WS    │  Player  │
│ (browser)│ ─────▶ │  (Fly.io, relay only) │ ◀───── │ (browser)│
└──────────┘        └───────────────────────┘        └──────────┘
```

- Server source and deployment instructions: [server/README.md](server/README.md)
- In-memory rooms, auto-expire after 2 hours, 5 min host-disconnect grace period
- Ping/pong heartbeat every 30 seconds
- The Fly.io machine auto-stops when idle to stay inside the free tier

## Repository Layout

| Path                                                                                 | Purpose                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| [index.html](index.html) / [index.js](index.js)                                      | Landing page — mode chooser                        |
| [cards.html](cards.html) / [cards.js](cards.js) / [cards.css](cards.css)             | Solo study mode                                    |
| [quiz.html](quiz.html) / [quiz.js](quiz.js) / [quiz.css](quiz.css)                   | Multiplayer quiz (host + player)                   |
| [library.html](library.html) / [library.js](library.js) / [library.css](library.css) | Pre-made deck library                              |
| [sanitize.js](sanitize.js)                                                           | Shared XSS-safe HTML rendering                     |
| [theme.js](theme.js) / [theme.css](theme.css)                                        | Light/dark theme handling                          |
| [sw.js](sw.js)                                                                       | Service worker (stale-while-revalidate)            |
| [manifest.json](manifest.json)                                                       | PWA manifest                                       |
| [decks/](decks/)                                                                     | Sample decks and generated `library.json` manifest |
| [server/](server/)                                                                   | WebSocket relay (Node.js, deployed to Fly.io)      |
| [scripts/](scripts/)                                                                 | Build-time helpers (library manifest generator)    |
| [.github/workflows/](.github/workflows/)                                             | CI: minify + inline + deploy, server deploy        |

## Development

```bash
npm install          # installs ESLint, Prettier, husky, lint-staged
npm run lint         # eslint .
npm run lint:fix     # eslint . --fix
npm run format       # prettier --write .
```

Commits on `main` that touch the client trigger [.github/workflows/minify.yml](.github/workflows/minify.yml), which minifies JS/CSS, inlines everything into each HTML file, and force-pushes the result to the `gh-pages` branch. Commits under [server/](server/) trigger [.github/workflows/deploy-server.yml](.github/workflows/deploy-server.yml) to redeploy the Fly.io relay.

## Contributing

Issues and pull requests are very welcome! This project lives at [github.com/mamrehn/flashcards](https://github.com/mamrehn/flashcards).

- 🐛 **Found a bug or have an idea?** Open an issue: https://github.com/mamrehn/flashcards/issues
- 🃏 **New sample deck?** Drop a `.json` or `.zip` into [decks/](decks/) — the library manifest regenerates automatically on deploy.
- 🛠️ **Code change?** Brief how-to:

```bash
git clone https://github.com/mamrehn/flashcards.git
cd flashcards
npm install
# make your change, then:
npm run lint
npm run format
git checkout -b my-change
git commit -am "Describe your change"
git push -u origin my-change
# open a PR against main on GitHub
```

Keep the client framework-free (vanilla JS/CSS/HTML) and route any user-supplied content through [sanitize.js](sanitize.js).

## License

Released into the public domain under the [Unlicense](LICENSE).
