'use strict';

/**
 * Protocol tests for the relay server: input validation (no message may crash
 * the process), one seat per connection, name/avatar sanitizing, host
 * authority, locked rooms with knock/admit/assign, anonymous ballots, host
 * renames, and resuming a question after a server restart.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket, startServer, connect, hostRoom, joinRoom, sleep } = require('./helpers/relay');

const skip = WebSocket ? false : 'server/node_modules/ws not installed';

test('relay server protocol', { skip }, async (t) => {
    const server = await startServer();
    t.after(() => server.proc.kill('SIGKILL'));
    const { url } = server;

    await t.test('malformed messages never crash the process', async () => {
        const { host, roomId } = await hostRoom(url);
        const payloads = [
            'null',
            '1',
            '"x"',
            '[]',
            '{}',
            '{"type":1}',
            '{"type":"__proto__"}',
            '{"type":"constructor"}',
            '{"type":"toString"}',
            '{"type":"join","roomCode":1}',
            '{"type":"join","roomCode":{"a":1}}',
            '{"type":"join","roomCode":null,"sessionId":7}',
            '{"type":"reconnect_host","roomId":1,"sessionId":[]}',
            '{"type":"restore_room","roomId":"ZZZZ","sessionId":"sess-x","players":[null,1,"x",{"id":5}]}',
            '{"type":"submit_answer","answerData":null}',
            '{"type":"resolve_join","requestId":{}}',
            '{"type":"rename_player","sessionId":null,"name":{}}',
        ];
        const attacker = await connect(url);
        for (const p of payloads) attacker.sendRaw(p);
        // Host-only handlers with junk, sent from a real host.
        for (const p of [
            '{"type":"send_results","leaderboard":[null,1,"x"],"playerScores":null,"correct":"x"}',
            '{"type":"send_results","playerScores":"abc","leaderboard":{}}',
            '{"type":"start_question","question":"Q","options":null}',
            '{"type":"collect_ballots"}',
            '{"type":"set_room_lock","locked":"yes"}',
        ]) {
            host.sendRaw(p);
        }
        await sleep(300);
        assert.equal(server.exited(), null, 'server must still be running');
        // And still serving: a fresh join works.
        const { joined } = await joinRoom(url, roomId);
        assert.equal(joined.type, 'joined');
        const err = await attacker.next('error');
        assert.equal(err.code, 'BAD_MESSAGE');
    });

    await t.test('one player seat per connection', async () => {
        const { host, roomId } = await hostRoom(url);
        const p = await connect(url);
        for (let i = 0; i < 5; i++) p.send({ type: 'join', roomCode: roomId, playerName: 'G' });
        await p.next('joined');
        const err = await p.next('error');
        assert.equal(err.code, 'ALREADY_JOINED');
        await sleep(150);
        assert.equal(host.all('player_joined').length, 1);
        p.close();
        const left = await host.next('player_left');
        assert.equal(left.playerCount, 0, 'no ghost stays connected');
    });

    await t.test('names keep any script but drop emoji; avatars are whitelisted', async () => {
        const { roomId } = await hostRoom(url);
        const cases = [
            ['Ayşe 😀', 'Ayşe'],
            ['Łukasz Nguyễn', 'Łukasz Nguyễn'],
            ["D'Angelo-Maria", "D'Angelo-Maria"],
            ['👨\u{200D}👩\u{200D}👧 🇩🇪', 'Spieler'],
            ['<script>x</script>', 'scriptxscript'],
        ];
        for (const [input, expected] of cases) {
            const { joined } = await joinRoom(url, roomId, { playerName: input });
            assert.equal(joined.playerName, expected, `name for ${JSON.stringify(input)}`);
        }
        const bad = await joinRoom(url, roomId, { avatar: 'HITLER' });
        assert.equal(bad.joined.avatar, '');
        const good = await joinRoom(url, roomId, { avatar: '\u{1F9D1}\u{200D}\u{1F680}' });
        assert.equal(good.joined.avatar, '\u{1F9D1}\u{200D}\u{1F680}');
    });

    await t.test('unknown room reports a machine-readable code', async () => {
        const p = await connect(url);
        p.send({ type: 'join', roomCode: 'QQQQ', playerName: 'A' });
        const err = await p.next('error');
        assert.equal(err.code, 'ROOM_NOT_FOUND');
    });

    await t.test('a superseded host socket loses host powers', async () => {
        const { host, roomId, sessionId } = await hostRoom(url);
        const { player } = await joinRoom(url, roomId);
        const host2 = await connect(url);
        host2.send({ type: 'reconnect_host', roomId, sessionId });
        await host2.next('host_reconnected');
        await sleep(100);
        assert.equal(host.closeCode, 4000, 'old host socket is closed as replaced');
        host2.send({ type: 'start_question', question: 'Q', options: ['a', 'b'], duration: 10 });
        const q = await player.next('question');
        assert.equal(q.question, 'Q');
    });

    await t.test('locked room: knock, admit, deny, assign, and reconnect', async () => {
        const { host, roomId } = await hostRoom(url);
        const { player: anna, joined: annaJoined } = await joinRoom(url, roomId, {
            playerName: 'Anna',
        });
        host.send({ type: 'set_room_lock', locked: true });
        assert.equal((await host.next('room_lock')).locked, true);

        // New device knocks → host decides.
        const ben = await connect(url);
        ben.send({ type: 'join', roomCode: roomId, playerName: 'Ben' });
        await ben.next('join_pending');
        const benReq = await host.next('join_request');
        assert.equal(benReq.name, 'Ben');
        host.send({ type: 'resolve_join', requestId: benReq.requestId, decision: 'admit' });
        assert.equal((await ben.next('joined')).playerName, 'Ben');

        const eve = await connect(url);
        eve.send({ type: 'join', roomCode: roomId, playerName: 'Eve' });
        const eveReq = await host.next('join_request');
        host.send({ type: 'resolve_join', requestId: eveReq.requestId, decision: 'deny' });
        assert.equal((await eve.next('error')).code, 'JOIN_DENIED');

        // Anna's laptop restarts with storage intact → plain reconnect, no knock.
        anna.close();
        await host.next('player_left');
        const annaBack = await connect(url);
        annaBack.send({ type: 'join', roomCode: roomId, sessionId: annaJoined.sessionId });
        assert.equal((await annaBack.next('joined')).isReconnect, true);

        // Anna drops again and comes back *without* her session (other
        // browser): the host puts her back on her own seat.
        annaBack.close();
        await host.next('player_left');
        const annaNew = await connect(url);
        annaNew.send({ type: 'join', roomCode: roomId, playerName: 'Anna2' });
        const annaReq = await host.next('join_request');
        host.send({
            type: 'resolve_join',
            requestId: annaReq.requestId,
            decision: 'assign',
            sessionId: annaJoined.sessionId,
        });
        const seat = await annaNew.next('joined');
        assert.equal(seat.sessionId, annaJoined.sessionId);
        assert.equal(seat.playerName, 'Anna', 'seat keeps its name');

        // Assigning onto a connected seat is refused.
        const mallory = await connect(url);
        mallory.send({ type: 'join', roomCode: roomId, playerName: 'M' });
        const mReq = await host.next('join_request');
        host.send({
            type: 'resolve_join',
            requestId: mReq.requestId,
            decision: 'assign',
            sessionId: annaJoined.sessionId,
        });
        assert.equal((await host.next('error')).code, 'SEAT_TAKEN');

        // Unlocking admits whoever is still waiting.
        host.send({ type: 'set_room_lock', locked: false });
        assert.equal((await mallory.next('joined')).playerName, 'M');
    });

    await t.test('anonymous ballots never reach the host with a voter attached', async () => {
        const { host, roomId } = await hostRoom(url);
        const { player: a } = await joinRoom(url, roomId, { playerName: 'A' });
        const { player: b } = await joinRoom(url, roomId, { playerName: 'B' });
        host.send({
            type: 'start_question',
            question: 'Wahl',
            options: ['meta', 'A', 'B'],
            duration: 0,
            anonymous: true,
        });
        const q = await a.next('question');
        assert.equal(q.anonymous, true);
        assert.equal(q.remaining, null, 'duration 0 is untimed');
        await b.next('question');

        a.send({ type: 'submit_answer', answerData: [2] });
        a.send({ type: 'submit_answer', answerData: [1] }); // second ballot ignored
        b.send({ type: 'submit_answer', answerData: [1, 2] });
        const first = await host.next('player_answered');
        assert.equal(first.anonymous, true);
        assert.equal(first.answerData, undefined);
        assert.equal(first.name, undefined);
        await host.next('player_answered');

        host.send({ type: 'collect_ballots' });
        const { ballots } = await host.next('ballots');
        assert.equal(ballots.length, 2);
        assert.deepEqual(
            ballots.map((x) => JSON.stringify(x)).toSorted(),
            ['[1,2]', '[2]'].toSorted()
        );

        // Closed: late ballots are dropped.
        const { player: c } = await joinRoom(url, roomId, { playerName: 'C' });
        c.send({ type: 'submit_answer', answerData: [1] });
        await sleep(150);
        assert.equal(host.all('player_answered').length, 2);
    });

    await t.test('host rename sticks across reconnects', async () => {
        const { host, roomId } = await hostRoom(url);
        const { player, joined } = await joinRoom(url, roomId, { playerName: 'Rude' });
        host.send({ type: 'rename_player', sessionId: joined.sessionId, name: 'Brave Badger' });
        assert.equal((await player.next('name_changed')).name, 'Brave Badger');
        assert.equal((await host.next('player_renamed')).name, 'Brave Badger');

        host.send({ type: 'rename_player', sessionId: joined.sessionId, name: '🙂' });
        assert.equal((await host.next('error')).code, 'NAME_INVALID');

        player.close();
        const back = await connect(url);
        back.send({
            type: 'join',
            roomCode: roomId,
            sessionId: joined.sessionId,
            playerName: 'Rude',
        });
        assert.equal((await back.next('joined')).playerName, 'Brave Badger');

        host.send({ type: 'start_question', question: 'Q', options: ['a', 'b'], duration: 10 });
        await back.next('question');
        host.send({ type: 'rename_player', sessionId: joined.sessionId, name: 'Neu' });
        assert.equal((await host.next('error')).code, 'RENAME_NOT_ALLOWED');
    });

    await t.test('restored room resumes an interrupted question', async () => {
        const host = await connect(url);
        const sessionId = 'sess-restore-test';
        host.send({
            type: 'restore_room',
            roomId: 'RSTR',
            sessionId,
            phase: 'result',
            questionIndex: 3,
            players: [
                { id: 'sess-p1', name: 'Pia', score: 120, hasAnswered: true },
                { id: 'sess-p2', name: 'Paul', score: 80, hasAnswered: false },
            ],
        });
        const restored = await host.next('host_reconnected');
        assert.equal(restored.isRestored, true);
        assert.equal(restored.players.length, 2);

        host.send({
            type: 'start_question',
            question: 'Q4',
            options: ['a', 'b'],
            index: 3,
            total: 5,
            duration: 12,
            resume: true,
        });
        const pia = await connect(url);
        pia.send({ type: 'join', roomCode: restored.roomId, sessionId: 'sess-p1' });
        await pia.next('joined');
        const q = await pia.next('question');
        assert.equal(q.alreadySubmitted, true, 'answered before the restart');
        pia.send({ type: 'submit_answer', answerData: [0] });

        const paul = await connect(url);
        paul.send({ type: 'join', roomCode: restored.roomId, sessionId: 'sess-p2' });
        const q2 = await paul.next('question');
        assert.equal(q2.alreadySubmitted, false);
        paul.send({ type: 'submit_answer', answerData: [1] });
        const answered = await host.next('player_answered');
        assert.equal(answered.sessionId, 'sess-p2');
        await sleep(100);
        assert.equal(host.all('player_answered').length, 1, 'no second answer for Pia');
    });

    await t.test('final results replay to a reloading player', async () => {
        const { host, roomId } = await hostRoom(url);
        const { player, joined } = await joinRoom(url, roomId);
        host.send({ type: 'start_question', question: 'Q', options: ['a', 'b'], index: 4 });
        await player.next('question');
        host.send({
            type: 'send_results',
            correct: [0],
            isFinal: true,
            leaderboard: [{ name: 'Anna', score: 10 }],
        });
        await player.next('result');
        player.close();
        const back = await connect(url);
        back.send({ type: 'join', roomCode: roomId, sessionId: joined.sessionId });
        const replay = await back.next('result');
        assert.equal(replay.isFinal, true);
        assert.equal(replay.isReplay, true);
        assert.equal(replay.questionIndex, 4);
    });
});
