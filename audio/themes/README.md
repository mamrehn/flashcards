# Audio themes

Placeholder `.aac` files are intentionally empty so the host audio engine
loads silently when no recording exists yet. Replace them with real loops
to enable playback.

Each theme folder must contain the same six tracks:

| File                       | Plays during                                |
| -------------------------- | ------------------------------------------- |
| `lobby.aac`                | Lobby intro after the host starts the quiz  |
| `question.aac`             | Active question (timer running)             |
| `waiting_for_answer.aac`   | After the player submits, before reveal     |
| `reveal.aac`               | Showing the correct answer                  |
| `scoreboard.aac`           | Between-question scoreboard                 |
| `final.aac`                | Final results / leaderboard                 |

Recommendations: 30–60 s seamless loops, normalised to ~-14 LUFS, AAC-LC
in an MPEG-4 (`.m4a`/`.aac`) container. The audio engine treats missing
or unreadable files as silence and continues without errors, so partial
themes are fine while you record.
