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
This document outlines the background music (BGM) and sound effects (SFX) strategy for the multiplayer quiz app. The audio design balances cognitive load, engagement, and learning psychology across four distinct themes.

### Structure
* **4 Themed Folders:** `arcade`, `cinematic`, `modern_minimal`, `classical`
* **5 Audio Files per Theme:** 3 seamless loops, 2 short stingers
* **1 Universal Finale File:** Non-musical, pure Foley (CC0)
* **Total Files:** 21

### 🛠️ Technical Implementation Notes
* **Suno Custom Mode:** For all generated tracks, use Custom Mode and include `[Instrumental]` in the lyrics box.
* **Loops:** Add a 1-second crossfade when looping `lobby.aac`, `question.aac`, and `leaderboard.aac` in the game engine to ensure seamless transitions.
* **Signals (Stingers):** `time_up.aac` and `new_question.aac` are short, 2-to-4-second punchy sound effects. You will need to generate a track in Suno, isolate the clean stinger, and crop it using an audio editor.

---

## 🕹️ Theme 1: Arcade
**Vibe:** Playful, high extrinsic motivation, fast-paced trivia.

| File | Type | UX / Psychological Goal | Suno "Style of Music" Prompt |
| :--- | :--- | :--- | :--- |
| `lobby.aac` | Loop | Welcoming, bouncy, signals a fun experience. | `120 bpm, upbeat arcade lobby menu music, playful chiptune synthwave, bright melodies, bouncy bass, 16-bit era, seamless loop, background video game OST` |
| `question.aac` | Loop | Fast-paced focus, mild time-pressure. | `140 bpm, fast-paced arcade quiz background music, pulsing synth bass, ticking hi-hats, tension building, focus, repetitive chiptune arpeggios, video game loop` |
| `leaderboard.aac` | Loop | Triumphant dopamine hit. | `110 bpm, triumphant arcade victory screen music, retro synth fanfare into happy groovy beat, rewarding, high energy, 16-bit video game OST, loopable` |
| `time_up.aac` | Stinger | Clear cessation of activity. | `Fast arcade time over jingle, descending synth glissando, percussive hit, game over sting, 8-bit sound effect, sudden end short` |
| `new_question.aac`| Stinger | Grabs attention, fresh start. | `Quick arcade start level jingle, ascending bright synth arpeggio, power up sound, alert, ready go sting, short 8-bit fanfare` |

---

## 🍿 Theme 2: Cinematic
**Vibe:** High stakes, dramatic, deep focus (ideal for older students/serious trivia).

| File | Type | UX / Psychological Goal | Suno "Style of Music" Prompt |
| :--- | :--- | :--- | :--- |
| `lobby.aac` | Loop | Builds grand anticipation and awe. | `90 bpm, cinematic orchestral lobby music, slowly building tension, staccato strings, deep brass swells, epic movie soundtrack, anticipation, background music loop` |
| `question.aac` | Loop | Drives momentum, repetitive elements for deep focus. | `120 bpm, intense cinematic quiz music, ticking clock percussion, driving string ostinato, high stakes, dark synth pulses, focus, suspenseful movie score, seamless loop` |
| `leaderboard.aac` | Loop | Heroic resolution, conquering a massive challenge. | `100 bpm, heroic cinematic leaderboard music, grand orchestral resolution, soaring brass melody, triumphant choir chords, epic victory soundtrack, loopable` |
| `time_up.aac` | Stinger | Dramatic finality, removes all ambiguity. | `Cinematic time up sting, massive orchestral hit, deep brass braam, dramatic percussion strike, sudden silence, movie trailer sound effect short` |
| `new_question.aac`| Stinger | Sharp auditory reset. | `Cinematic new question sting, fast reverse cymbal swell into sharp staccato string hit, dramatic alert, movie trailer transition sound short` |

---

## 📱 Theme 3: Modern Minimal
**Vibe:** Chill, minimal cognitive load, classic app aesthetic, uncluttered focus.

| File | Type | UX / Psychological Goal | Suno "Style of Music" Prompt |
| :--- | :--- | :--- | :--- |
| `lobby.aac` | Loop | Welcoming, lighthearted, clean. | `100 bpm, modern minimal app background music, bright marimba, light acoustic guitar strumming, finger snaps, cheerful, clean, unobtrusive, seamless loop` |
| `question.aac` | Loop | Steady focus, clear pulse without anxiety. | `110 bpm, minimalist quiz thinking music, repetitive pizzicato strings, subtle wooden block ticking, light upright bass pulse, focused, neutral, seamless loop` |
| `leaderboard.aac` | Loop | Positive reinforcement, bright and rewarding. | `100 bpm, happy minimal victory music, bright glockenspiel melody, warm piano chords, light upbeat acoustic percussion, rewarding app sound, loopable` |
| `time_up.aac` | Stinger | Clear boundary, soft but definitive stop. | `Minimalist time up sting, descending marimba scale ending in a soft wooden percussion thud, clear stop, clean app notification sound effect short` |
| `new_question.aac`| Stinger | Sharp, pleasant auditory reset. | `Minimalist new question alert, ascending bright acoustic guitar pluck, clear bell chime ring, quick positive app notification sound effect short` |

---

## 🎻 Theme 4: Classical
**Vibe:** Academic, sophisticated, elegant, mathematical focus (Mozart Effect).

| File | Type | UX / Psychological Goal | Suno "Style of Music" Prompt |
| :--- | :--- | :--- | :--- |
| `lobby.aac` | Loop | Elegant, sophisticated, welcoming. | `110 bpm, upbeat classical string quartet, allegro, bright violins, elegant, welcoming, classical period, chamber music, seamless loop` |
| `question.aac` | Loop | Mathematical, steady pulse to drive cognitive focus. | `100 bpm, classical baroque harpsichord and cello ostinato, steady driving rhythm, focused, academic, Bach style, unobtrusive, seamless loop` |
| `leaderboard.aac` | Loop | Polite, grand resolution. | `120 bpm, classical symphony fanfare, bright orchestral hit into triumphant elegant major chords, positive reinforcement, loopable` |
| `time_up.aac` | Stinger | Sharp, acoustic cessation. | `Classical staccato string hit, sharp violin pluck, definite ending, elegant, short sound effect` |
| `new_question.aac`| Stinger | Light, airy attention grabber. | `Classical quick flute trill, ascending elegant woodwind run, bright, short alert sting` |

---

## 🏆 Universal Final Result Screen
**Vibe:** Definitive game over, universal positive reinforcement, palate cleanser.

| File | Type | UX / Psychological Goal | Source |
| :--- | :--- | :--- | :--- |
| `final.aac` | SFX | Strips away all genre constraints to provide a pure, human reward. | **CC0 Foley Recording.** [Applause 4.mp3 by FunWithSound (Freesound)](https://freesound.org/people/FunWithSound/sounds/381358/) - Convert to `.aac` and crop/fade if necessary. |