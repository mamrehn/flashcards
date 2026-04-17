# Quiz WebSocket Server

WebSocket relay server for the multiplayer quiz. Handles room management, player connections, and message relay between host and players. All state is held in memory (no database).

## Local Development

```bash
cd server
npm install
node server.js
```

The server starts on port 8080 (or `PORT` env variable). Health check: `GET http://localhost:8080/health`

To connect from the client, set `WS_URL` in your local `quiz-config.js`:

```js
const WS_URL = 'ws://localhost:8080';
```

## Deploy to Fly.io

### First-time setup

1. Install the Fly CLI: https://fly.io/docs/flyctl/install/

2. Sign up / log in:

    ```bash
    fly auth signup   # or: fly auth login
    ```

3. Launch the app (from the `server/` directory):

    ```bash
    cd server
    fly launch
    ```

    This creates the app on Fly.io using the existing `fly.toml` and `Dockerfile`.
    Note: `fly launch` creates 2 machines by default for high availability. Scale down to 1 for the free tier:

    ```bash
    fly scale count 1 --app qlash-server
    ```

4. Add the `FLY_API_TOKEN` secret to your GitHub repository for automated deploys:

    ```bash
    fly tokens create deploy -x 999999h
    ```

    Copy the token and add it as `FLY_API_TOKEN` in GitHub repo Settings > Secrets > Actions.

5. Add the `WS_URL` secret to GitHub (used by the build pipeline to inject into the client):
    - Value: `wss://qlash-server.fly.dev` (or your custom domain)
    - Add as `WS_URL` in GitHub repo Settings > Secrets > Actions.

### Manual deploy

```bash
cd server
fly deploy
```

### Automated deploy

Pushes to `main` that change files in `server/` automatically trigger deployment via `.github/workflows/deploy-server.yml`.

## Architecture

- Single Fly.io machine in `fra` (Frankfurt)
- `auto_stop_machines = "stop"`: machine sleeps when idle (no active connections), saving free-tier hours
- `auto_start_machines = true`: machine wakes on incoming request (~2-3s cold start)
- In-memory state is lost when machine sleeps, but rooms auto-expire after 2 hours anyway
- Rooms are cleaned up when the host terminates the quiz or after 2 hours of inactivity
- Host disconnect grace period: 5 minutes before the room is terminated
- Ping/pong heartbeat every 30 seconds to detect dead connections
