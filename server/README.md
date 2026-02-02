# Zombie Game Multiplayer Server

WebSocket server for 2-player co-op in the Zombie Extraction Game.

## Local Development

```bash
npm install
npm start
```

Server runs on `ws://localhost:3000` by default.

## Deployment

### Option 1: Railway (Recommended)

1. Create account at [railway.app](https://railway.app)
2. Install Railway CLI: `npm i -g @railway/cli`
3. From the `server` folder:
   ```bash
   railway login
   railway init
   railway up
   ```
4. Copy the deployment URL (e.g., `zombie-game-server.up.railway.app`)

### Option 2: Render

1. Create account at [render.com](https://render.com)
2. Create "New Web Service"
3. Connect your GitHub repo
4. Set root directory to `server`
5. Deploy

### Option 3: Docker

```bash
docker build -t zombie-server .
docker run -p 3000:3000 zombie-server
```

## Updating the Game Client

After deployment, update `CONFIG.MULTIPLAYER.SERVER_URL` in `game.html`:

```javascript
CONFIG.MULTIPLAYER = {
    SERVER_URL: 'wss://your-deployed-server-url.com',
    // ... rest of config
};
```

**Important**: Use `wss://` (secure WebSocket) for production deployments, not `ws://`.

## API

The server handles these message types:

| Type | Direction | Description |
|------|-----------|-------------|
| `create_room` | Client → Server | Host creates a room |
| `room_created` | Server → Client | Room created with code |
| `join_room` | Client → Server | Guest joins with code |
| `room_joined` | Server → Client | Successfully joined |
| `player_joined` | Server → Host | Guest connected |
| `game_state` | Host → Guest | Game state snapshot |
| `player_input` | Guest → Host | Input commands |
| `player_disconnected` | Server → Client | Peer left |
| `host_disconnected` | Server → Guest | Host left |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port (set automatically by Railway/Render) |
