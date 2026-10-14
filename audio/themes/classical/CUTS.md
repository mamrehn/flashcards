# Classical — where each clip was cut from

All times are seconds in the **source file**. For `.aac` sources the times are as
decoded by ffmpeg; Audacity shows the same moment ~0.02 s earlier (AAC encoder
delay). Encoding: Opus 128 kbit/s VBR, 48 kHz stereo, no gain change unless noted.

## How the engine uses the files (quiz.js `createMusicEngine`)

| File                | Role    | When it plays                                                                    |
| :------------------ | :------ | :------------------------------------------------------------------------------- |
| `lobby.opus`        | loop    | host lobby while players join                                                    |
| `question.opus`     | loop    | while a question is open (starts when `new_question` ends)                       |
| `leaderboard.opus`  | loop    | scoreboard between questions (starts when `time_up` ends; see below)             |
| `new_question.opus` | stinger | before each question; the question is revealed when it ends (min 1.8 s, max 6 s) |
| `time_up.opus`      | stinger | when the timer runs out; the scoreboard flies in when it ends                    |

**Loop layout:** the engine restarts a loop when 250 ms remain and crossfades
(250 ms, linear). So each loop file = pre-roll before the loop's first downbeat
(150 ms) + the loop body + 250 ms of the original
continuation. The musical seam is "source _loop end_ → source _loop start_".

**Leaderboard:** only the first scoreboard starts it from the top; later
scoreboards continue where the previous one stopped (`HOST_AUDIO_RESUME` in
quiz.js). So a long leaderboard loop means each round hears new music, and a
scoreboard that stays up while the class discusses an answer does not repeat.

## Clips

| File                | Source                                   | Cut in source (file range) | Loop seam (start → end)              | Length   | Fades              |
| :------------------ | :--------------------------------------- | :------------------------- | :----------------------------------- | :------- | :----------------- |
| `lobby.opus`        | `classical_lobby (Remastered).wav`       | 62.509 – 102.302           | 62.659 → 102.202 (18 bars @ 109 bpm) | 39.79 s  | 5 ms in, 60 ms out |
| `question.opus`     | `classical_question (Remastered).wav`    | 49.368 – 89.505            | 49.518 → 89.405 (25 bars @ 150 bpm)  | 40.14 s  | 5 ms in, 60 ms out |
| `leaderboard.opus`  | `classical_leaderboard (Remastered).wav` | 0.360 – 102.060            | 0.510 → 101.960                      | 101.71 s | 5 ms in, 60 ms out |
| `new_question.opus` | `new_question.aac` (May original)        | 4.211 – 6.720              | —                                    | 2.51 s   | 0.32 s cosine out  |
| `time_up.opus`      | `classical_time_up (Remastered).wav`     | 68.526 – 70.990            | —                                    | 2.46 s   | 0.3 s cosine out   |

### Why these sections

- **lobby**: the stretch with the best self-match in the piece: the bars after
  102.2 s match the bars after 62.66 s better than most of the piece's own
  repeats (harmony distance 0.06, 2.8 dB spectral difference). Similar length to
  the other lobbies (37–44 s).
- **question**: steady baroque-style motor rhythm; seam harmony distance 0.014
  (near-identical chords), onset pattern after start/end correlates at 0.84.
- **leaderboard**: the first 101 s of the piece, so the scoreboard music does not
  audibly repeat. Starts on the opening swell (0.36 s) into the first tutti chord
  (0.66 s), i.e. the "orchestral hit into triumphant chords" from the README, so
  the scoreboard flies in on the fanfare. The bars after 101.96 s are
  harmonically close to the opening (harmony distance 0.09; the previous 22 s
  loop: 0.22). On a wrap the music dips for ~150 ms (to −27 dB) and swells into
  the fanfare again. The loop starts at the swell rather than in the silence
  before it, so that dip stays short.
- **new_question**: from the May original, not the remaster. A held chord, then
  an **ascending scale run** (5.29 → ~5.9 s, up to C6), then the landing notes,
  faded just before the next phrase at 6.74 s. Matches the README's "ascending
  elegant woodwind run". The remastered new_question is a series of chord stabs
  ending in a cadence (more of an ending than an attention grabber).
- **time_up**: the remaster's final cadence: a pickup at 68.54 s into the
  closing chord at 68.76 s ("ta-DAM"), then the natural decay to silence.

## Alternatives (in `audio/_alternatives/classical/`)

| File                       | Source                           | Cut                        | Idea                                                                                                               |
| :------------------------- | :------------------------------- | :------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| `leaderboard_fanfare.opus` | `leaderboard.aac` (May original) | 0.000 – 13.300, 0.3 s fade | the complete 13 s fanfare (hit → triumphant chords → decay). As a loop it leaves ~1 s of near-silence at each wrap |

To use one, copy it over the file in this folder with the role's name.
