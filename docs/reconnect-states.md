# Connect / Reconnect State Diagrams

These diagrams cover **player** and **host** lifecycle states across page load,
network blips, and full page reloads, for both `quiz.html` and `poll.html`.

The two clients share the same WebSocket protocol with `server/server.js`, so
the states are nearly identical — quiz-specific notes are inline.

## Player lifecycle

```mermaid
stateDiagram-v2
    [*] --> PageLoad : page load / reload

    PageLoad --> AutoReconnecting : saved *player* session in localStorage
    PageLoad --> RoleSelection    : no saved session or saved *host* session

    RoleSelection --> JoinForm : click "Quiz/Umfrage beitreten"
    JoinForm --> Connecting    : submit (roomCode + name)

    Connecting --> Joined : server "joined" (isReconnect=false)
    Connecting --> RoleSelection : server "error" (room not found / full)

    AutoReconnecting --> ReconnectInFlight : send "join" with sessionId
    ReconnectInFlight --> Joined : server "joined" (isReconnect=true)
    ReconnectInFlight --> RoleSelection : server "error" → clearActiveSession()

    state Joined {
        [*] --> InLobby
        InLobby --> InQuestion : "question" arrives
        InQuestion --> Submitted : player presses Submit (or timer auto-submit)
        Submitted --> InResult : "result" arrives
        InResult --> InQuestion : next "question" arrives
        InResult --> InFinal   : "result" with isFinal=true
        InQuestion --> InResult : "result" arrives (timer expired without submit)
        InFinal --> [*]
    }

    Joined --> SocketDown : WS close / heartbeat miss
    SocketDown --> BackoffWait : announceReconnect()
    BackoffWait --> ReconnectInFlight : reconnectBackoffMs delay elapsed
    BackoffWait --> SocketDown : connectWithRetry rejects (re-queue)

    Joined --> Terminated : server "quiz_terminated"
    Terminated --> RoleSelection : clearActiveSession()

    note right of AutoReconnecting
        NEW: page reload with saved session
        no longer requires the user to click
        a "Reconnect" button — the client
        re-issues the join silently.
    end note

    note right of ReconnectInFlight
        join payload uses the stored
        sessionId and the stored name.
        The server ignores any new name
        sent on reconnect, so the client
        also locks the name input.
    end note
```

## Host lifecycle

Unlike the player, the host is *not* auto-reconnected on page reload — they
need an explicit choice between resuming an existing game and starting a
fresh one. A saved host session surfaces the "Reconnect" button on
role-selection (pulsing CTA) instead of jumping straight in.

```mermaid
stateDiagram-v2
    [*] --> PageLoad
    PageLoad --> RoleSelection : always

    RoleSelection --> HostingNew : click "Quiz/Umfrage hosten"
    RoleSelection --> ReconnectInFlightHost : saved session + click "Reconnect"
    HostingNew --> RoomLive : server "host_assigned" (roomId issued)

    ReconnectInFlightHost --> RoomLive : server "host_reconnected"
    ReconnectInFlightHost --> RoomLive_New : server says room missing → recreate
    ReconnectInFlightHost --> RoleSelection : server "error" (other)

    state RoomLive {
        [*] --> Lobby
        Lobby --> ActiveQuestion : host clicks "Start"
        ActiveQuestion --> Results : endQuestion()
        Results --> ActiveQuestion : next question
        Results --> FinalResults : isFinal
        FinalResults --> [*]
    }

    RoomLive --> HostSocketDown : WS close
    HostSocketDown --> HostBackoff : announceReconnect()
    HostBackoff --> ReconnectInFlightHost
    HostBackoff --> HostSocketDown : retry exhausted (within budget)

    note right of HostSocketDown
        Server keeps the room alive for
        5 minutes after host disconnect.
        Players are NOT notified of the
        outage — they just sit in their
        current view until the host comes
        back or the grace timer expires.
    end note
```

## Mid-question disconnect — what the host does

This is the slice that motivated the rework. Before: a player reloading
mid-question caused the host to immediately call `endQuestion()` because the
remaining connected players had all answered. After: a grace timer holds the
auto-end so the reloader can rejoin.

```mermaid
stateDiagram-v2
    direction LR
    QuestionLive --> EvalAutoEnd : server forwards "player_left"

    state EvalAutoEnd <<choice>>
    EvalAutoEnd --> QuestionLive : not all connected have answered
    EvalAutoEnd --> GraceTimer   : all *other* connected have answered

    GraceTimer --> QuestionLive  : "player_reconnected" before timeout (cancel timer)
    GraceTimer --> endQuestion()  : timer fires AND condition still holds
    GraceTimer --> QuestionLive  : timer fires but someone else also disconnected (re-eval)

    note right of GraceTimer
        DISCONNECT_GRACE_MS ≈ 10s.
        Tracked at module scope so a
        subsequent player_reconnected
        can cancelTimeout() it. The
        regular per-question timer
        still ends the question if it
        runs out during the grace window.
    end note
```

## State-coverage checklist

Each row maps to a code path that must keep working after the rework. Cells
filled in with the file/symbol that handles it.

| Scenario | Player handling | Host handling | Server handling |
|---|---|---|---|
| First-ever join | `initPlayerConnection` (quiz) / `submitJoin` (poll) | `player_joined` event | `handleJoin` new-player branch |
| Reload in lobby | NEW: auto `initializePlayerFeatures({reconnectInfo})` on `DOMContentLoaded` | `player_left` then `player_reconnected` | `handleJoin` reconnect branch (phase=lobby) |
| Reload mid-question | Same as above; server re-sends `question` with `remaining` and `alreadySubmitted` | NEW: `player_left` schedules grace timer instead of immediate `endQuestion` | `handleJoin` reconnect branch (phase=question replay) |
| Reload mid-result | Same as above; client parks on "Quiz läuft" until next question | `player_left`/`player_reconnected` | `handleJoin` reconnect branch (phase=result, no replay payload — acceptable) |
| Reload after final | Same as above | n/a (game over) | `handleJoin` reconnect branch (phase=final → replay finalSnapshot) |
| Transient WS drop (no reload) | `close` → `connectPlayerWs` → re-`join` with current `sessionId` | Same as reload-in-lobby for the host | Same as reload paths |
| Server restart (SIGTERM) | Receives `quiz_terminated` → reset | Receives `quiz_terminated` → reset | Broadcasts then exits |
| Room expired while reconnecting | Server replies `error` → `resetPlayerStateAndUI()` clears session, lands on role-selection | n/a | Reply with `error` |
| Player tries to rename on reconnect | NEW: name input locked when reconnect path active; client always sends stored name | n/a | `handleJoin` reconnect branch already ignores `playerName` |

Anything not in this table is a state we are not handling on purpose (e.g. two
players reloading at the same instant — both just take the standard reconnect
path and the grace timer covers either ordering).
