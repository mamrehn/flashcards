# Cinematic — where each clip was cut from

All times are seconds in the **source file**. For `.aac` sources the times are as
decoded by ffmpeg; Audacity shows the same moment ~0.02 s earlier (AAC encoder
delay). Encoding: Opus 128 kbit/s VBR, 48 kHz stereo, no gain change unless noted.

## How the engine uses the files (quiz.js `createMusicEngine`)

| File                | Role    | When it plays                                                                    |
| :------------------ | :------ | :------------------------------------------------------------------------------- |
| `lobby.opus`        | loop    | host lobby while players join                                                    |
| `question.opus`     | loop    | while a question is open (starts when `new_question` ends)                       |
| `leaderboard.opus`  | loop    | scoreboard between questions (starts when `time_up` ends)                        |
| `new_question.opus` | stinger | before each question; the question is revealed when it ends (min 1.8 s, max 6 s) |
| `time_up.opus`      | stinger | when the timer runs out; the scoreboard flies in when it ends                    |

**Loop layout:** the engine restarts a loop when 250 ms remain and crossfades
(250 ms, linear). So each loop file = 150 ms pre-roll before the loop's first
downbeat + the loop body + 250 ms of the original continuation. The musical seam
is "source _loop end_ → source _loop start_"; both points were chosen so the bars
after them match (harmony, timbre, level, onset pattern).

## Clips

| File                | Source                               | Cut in source (file range) | Loop seam (start → end)              | Length  | Fades                                       |
| :------------------ | :----------------------------------- | :------------------------- | :----------------------------------- | :------ | :------------------------------------------ |
| `lobby.opus`        | `lobby.aac`                          | 48.188 – 86.538            | 48.338 → 86.438 (20 bars @ 126 bpm)  | 38.35 s | 5 ms in, 60 ms out                          |
| `question.opus`     | `question.aac`                       | 3.890 – 28.143             | 4.040 → 28.043 (12 bars @ 120 bpm)   | 24.25 s | 5 ms in, 60 ms out                          |
| `leaderboard.opus`  | `leaderboard.aac`                    | 22.607 – 51.752            | 22.757 → 51.652 (16 bars @ ~134 bpm) | 29.15 s | 5 ms in, 60 ms out                          |
| `new_question.opus` | `new_question.aac`                   | 0.00 – 3.50                | —                                    | 3.51 s  | your own Audacity cut (May), kept unchanged |
| `time_up.opus`      | `time_up_cinematic (Remastered).wav` | 116.007 – 119.190          | —                                    | 3.18 s  | 0.4 s cosine out                            |

### Why these sections

- **lobby**: E-pedal build → three 4-bar phrases (C–Am–E–E, C–Am–E–E, C–Am–B–B)
  → turnaround that resolves to E. The loop ends exactly where that turnaround
  resolves and jumps back into the E section, so every wrap sounds like the
  song's own section change. Skips the 22 s fade-in intro and the quiet
  breakdown at 33–38 s.
- **question**: ticking clock only (4–8 s) → bass joins (8–12) → percussion burst
  (12–14) → break (14–16) → full groove (16–28) → the original's hard stop at
  28.0 s. Tension rises while time runs out; the wrap uses the song's own hard
  stop, then the ticking restarts. The C pedal matches the C drone that ends
  `new_question`.
- **leaderboard**: starts on the "arrival" at 22.76 s, where full orchestra and
  percussion enter after the 22 s build, so the scoreboard flies in on the
  payoff. 16 bars long.
- **new_question**: hit at 0 s, string flurry, low C drone; hands over to the
  C-based question loop. The remastered `new_question` has no comparable sharp
  hit, so your cut stays.
- **time_up**: the remaster ends with a big final hit at 116.02 s and a natural
  ~3 s decay to silence: "time's up" lands on the hit, the scoreboard appears
  as it dies away.

The remastered `question`/`leaderboard` WAVs are different renders (not
sample-identical to the `.aac`) and lack the ticking-clock build and the clear
arrival, so the `.aac` takes were kept for those two loops.

## Alternatives (in `audio/_alternatives/cinematic/`)

| File                      | Source                               | Cut                                                                     | Idea                                                                                                                      |
| :------------------------ | :----------------------------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `new_question_swell.opus` | `time_up_cinematic (Remastered).wav` | 1.388 – 4.700, 0.5 s fade                                               | swell into an impact at 3.86 s ("reverse swell into hit" per README); the reveal follows ~0.85 s after the impact         |
| `time_up_splice.opus`     | `time_up.aac`                        | 0.000 – 1.080 + 0.2 s equal-power crossfade + 5.148 – 7.800, 0.3 s fade | original hit + sustain spliced onto the original's natural decay (spectral difference at the splice 1.1 dB, same D chord) |

To use one, copy it over the file in this folder with the role's name.
