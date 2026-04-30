# Audio themes

Placeholder `.aac` files are intentionally empty so the host audio engine
loads silently when no recording exists yet. Replace them with real loops
to enable playback.

Recommendations: 30–60 s seamless loops, normalised to ~-14 LUFS, AAC-LC
in an MPEG-4 (`.m4a`/`.aac`) container. The audio engine treats missing
or unreadable files as silence and continues without errors, so partial
themes are fine while you record.

Each theme folder must contain the same six tracks:

# 🎵 Quiz App Audio Implementation Plan & Specifications

## 📌 Overview
This document outlines the background music (BGM) and sound effects (SFX) strategy for the multiplayer quiz app. The audio design balances cognitive load, engagement, and learning psychology.

### Structure
* **3 Themed Folders** (`arcade`, `cinematic`, `lofi`)
* **5 Audio Files per Theme** (3 seamless loops, 2 short stingers)
* **1 Universal Finale File** (Non-musical, pure Foley)
* **Total Files:** 16

### 🛠️ Technical Implementation Notes
* **Loops:** Add a 1-second crossfade when looping `lobby.aac`, `question.aac`, and `leaderboard.aac` to ensure seamless transitions.
* **Signals (Stingers):** `time_up.aac` and `new_question.aac` are short, 2-to-4-second punchy sound effects designed to cut through chatter and command attention.

---

## 🕹️ Theme 1: Arcade
**Vibe:** Playful, high extrinsic motivation, fast-paced trivia.

| File | Type | UX / Psychological Goal | Suno "Style of Music" Prompt / Source |
| :--- | :--- | :--- | :--- |
| `lobby.aac` | Loop | Welcoming, bouncy, signals a fun experience. | `120 bpm, upbeat arcade lobby menu music, playful chiptune synthwave, bright melodies, bouncy bass, 16-bit era, seamless loop, background video game OST` |
| `question.aac` | Loop | Fast-paced focus, mild time-pressure. | `140 bpm, fast-paced arcade quiz background music, pulsing synth bass, ticking hi-hats, tension building, focus, repetitive chiptune arpeggios, video game loop` |
| `leaderboard.aac` | Loop | Triumphant dopamine hit. | `110 bpm, triumphant arcade victory screen music, retro synth fanfare into happy groovy beat, rewarding, high energy, 16-bit video game OST, loopable` |
| `time_up.aac` | Stinger | Clear cessation of activity. | `Fast arcade time over jingle, descending synth glissando, percussive hit, game over sting, 8-bit sound effect, sudden end short` |
| `new_question.aac`| Stinger | Grabs attention, fresh start. | `Quick arcade start level jingle, ascending bright synth arpeggio, power up sound, alert, ready go sting, short 8-bit fanfare` |

---

## 🍿 Theme 2: Cinematic
**Vibe:** High stakes, dramatic, deep focus (ideal for older students/serious trivia).

| File | Type | UX / Psychological Goal | Suno "Style of Music" Prompt / Source |
| :--- | :--- | :--- | :--- |
| `lobby.aac` | Loop | Builds grand anticipation and awe. | `90 bpm, cinematic orchestral lobby music, slowly building tension, staccato strings, deep brass swells, epic movie soundtrack, anticipation, background music loop` |
| `question.aac` | Loop | Drives momentum, repetitive elements for deep focus. | `120 bpm, intense cinematic quiz music, ticking clock percussion, driving string ostinato, high stakes, dark synth pulses, focus, suspenseful movie score, seamless loop` |
| `leaderboard.aac` | Loop | Heroic resolution, conquering a massive challenge. | `100 bpm, heroic cinematic leaderboard music, grand orchestral resolution, soaring brass melody, triumphant choir chords, epic victory soundtrack, loopable` |
| `time_up.aac` | Stinger | Dramatic finality, removes all ambiguity. | `Cinematic time up sting, massive orchestral hit, deep brass braam, dramatic percussion strike, sudden silence, movie trailer sound effect short` |
| `new_question.aac`| Stinger | Sharp auditory reset. | `Cinematic new question sting, fast reverse cymbal swell into sharp staccato string hit, dramatic alert, movie trailer transition sound short` |

---

## 📚 Theme 3: Lo-Fi
**Vibe:** Chill, minimal cognitive load, studying, long-form reading.

| File | Type | UX / Psychological Goal | Suno "Style of Music" Prompt / Source |
| :--- | :--- | :--- | :--- |
| `lobby.aac` | Loop | Warm, inviting, safe space for learning. | `80 bpm, chill lofi hip hop lobby music, warm rhodes piano chords, dusty vinyl crackle, relaxed boom bap beat, cozy background music, studying, loopable` |
| `question.aac` | Loop | Highly unobtrusive. Steady rhythm to anchor attention. | `85 bpm, lofi beats for studying, repetitive deep bass, muted guitar melody, soft percussion, high focus, unobtrusive background music, minimal, seamless loop` |
| `leaderboard.aac` | Loop | Smooth, relaxed positive reinforcement. | `90 bpm, positive lofi victory music, upbeat chillhop, smooth jazz saxophone lick, warm bassline, rewarding but relaxed, study break, loopable` |
| `time_up.aac` | Stinger | Gentle boundary setting. | `Lofi tape stop sound effect, gentle vinyl scratch, soft muted electric piano chord fading out, relaxed ending sting, short chillout` |
| `new_question.aac`| Stinger | Soft auditory nudge to look back at the screen. | `Lofi new question alert, gentle rhodes piano upward glissando, soft vinyl needle drop sound, subtle chime sting, quick warm notification` |

---

## 🏆 Universal Final Result Screen
**Vibe:** Definitive game over, universal positive reinforcement, palate cleanser.

| File | Type | UX / Psychological Goal | Source |
| :--- | :--- | :--- | :--- |
| `final.aac` | SFX (Play Once) | Strips away all genre constraints to provide a pure, human reward for completing the game. | **Do not use Suno.** Source a 10-15 second real audio clip of "polite medium-room applause" or "gentle ovation" from a CC0 SFX library. |