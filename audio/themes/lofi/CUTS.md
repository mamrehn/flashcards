# Lofi — where each clip was cut from

All times are seconds in the **source file**. Encoding: Opus 128 kbit/s VBR,
48 kHz stereo, no gain change unless noted. The sources are full Suno songs
(~74 bpm half-time feel, 808 kicks, short breaks where the beat drops out).

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
is "source _loop end_ → source _loop start_".

## Clips

| File                | Source                                   | Cut in source (file range) | Loop seam (start → end)            | Length  | Fades / gain                  |
| :------------------ | :--------------------------------------- | :------------------------- | :--------------------------------- | :------ | :---------------------------- |
| `lobby.opus`        | `lofi_lobby (Remastered).wav`            | 22.700 – 66.554            | 22.850 → 66.454 (16 bars @ 88 bpm) | 43.85 s | 5 ms in, 60 ms out            |
| `question.opus`     | `lofi_question (Remastered).wav`         | 55.365 – 81.561            | 55.515 → 81.461 (8 bars @ 74 bpm)  | 26.20 s | 5 ms in, 60 ms out            |
| `leaderboard.opus`  | `lofi_leaderboard (Remastered).wav`      | 26.134 – 52.691            | 26.284 → 52.591 (8 bars @ 73 bpm)  | 26.56 s | 5 ms in, 60 ms out            |
| `new_question.opus` | `lofi_new_question (Remastered).wav`     | 0.390 – 3.660              | —                                  | 3.27 s  | 0.5 s cosine out              |
| `time_up.opus`      | **`lofi_new_question (Remastered).wav`** | 21.247 – 24.100            | —                                  | 2.85 s  | 0.6 s cosine out, **+2.5 dB** |

### Why these sections

- **lobby**: starts where the groove enters after the intro (22.85 s). The loop is
  16 bars and includes one short break, which gives variety over long lobby
  waits. Seam: onset patterns after start/end correlate at 0.93, harmony
  distance 0.08.
- **question**: starts where the beat drops back in after a short break
  (55.5 s), a "go" moment right after `new_question`. No dropout inside the
  loop (steady focus). Seam harmony distance 0.03, onset correlation 0.92.
- **leaderboard**: starts on the section-entry kick after the intro break
  (26.3 s), so the scoreboard flies in on the drop. The first bar is
  deliberately sparse ("kick, then space"), as in the song.
- **new_question**: the song's intro: a three-note pickup (0.40 / 0.81 / 1.22 s)
  lands on the first downbeat (kick + chord at 1.67 s), snare, then fades out
  before the next kick at 3.73 s. A gentle "here we go", like Minimal's
  ascending pluck.
- **time_up**: taken from the _new_question_ song: the last kick (21.32 s), a
  snare accent (22.07 s), then the beat stops and only the keys ring out. That
  makes a soft but definitive stop. The `lofi_time_up` song has no comparable
  stop (its outro is a 12 s fade). +2.5 dB so it reaches the level of Arcade's
  time_up (−17 LUFS) and still cuts through in a classroom.

## Alternatives (in `audio/_alternatives/lofi/`)

| File                       | Source                               | Cut                           | Idea                                                                                                                     |
| :------------------------- | :----------------------------------- | :---------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `new_question_pickup.opus` | `lofi_time_up (Remastered).wav`      | 28.408 – 30.400, 0.3 s fade   | ascending melodic pickup into the beat re-entry kick at 29.67 s; the reveal follows ~0.7 s after the kick (1.99 s total) |
| `time_up_outro.opus`       | `lofi_new_question (Remastered).wav` | 153.738 – 157.200, 0.8 s fade | the song's last kick into its outro keys (final chord)                                                                   |
| `time_up_bassdrop.opus`    | `lofi_time_up (Remastered).wav`      | 173.334 – 176.300, 0.6 s fade | last 808 kick, then the bass drops out (a light beat continues)                                                          |

To use one, copy it over the file in this folder with the role's name.
