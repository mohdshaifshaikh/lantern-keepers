# Lantern Keepers 🏮

A real-time multiplayer party game of **light, words, and deception**. 2–8 players join by room code from their own device and play in real time. The centerpiece isn't a scoreboard — it's a **living flame** that reacts to every decision the whole room makes at once.

> You and your friends are keepers of the Last Lantern, the only light holding back a spreading dark. A Night is five Watches. The flame drops each Watch. Keep it burning until dawn — but one or two of you are secretly **Shadows**, working to snuff it out without being caught.

## What makes it different

- **The flame is the game.** It's a live, shared meter everyone sees change in real time, fed by "sparks" (your answers) and drained by the dark. It shifts color and mood — golden and tall when the Keepers are winning, cold and violet when the dark rises.
- **Asymmetric information.** Keepers see the exact category. Shadows only see a vague hint and must bluff a fitting answer — creating detectable "tells" attentive Keepers can hunt.
- **Two layers of play.** You light sparks you believe are genuine (cooperative), and secretly accuse the spark you think is the Shadow's (social deduction). Both feed the flame.
- **Scales 2–8.** 2 players is a friendly cooperative watch (no Shadow). 3–6 is one Shadow. 7–8 is two Shadows.

## How to play (rules a stranger can follow from the screen)

1. **The Riddle** — a hidden category appears. Keepers see it clearly. Shadows only see a vague hint and must bluff.
2. **Sparks** — everyone secretly types one word that fits the category. Sparks are hidden until the reveal.
3. **The Reveal** — all sparks appear together, anonymously and shuffled.
4. **Lighting** — you have 2 lights. Place them on sparks you think are genuine. Lighting a real spark brightens the flame; lighting a Shadow's dark spark dims it.
5. **Suspicion** — cast one suspicion on the spark you think the Shadow wrote. If enough keepers agree and you're right, that Shadow is **exposed** and the flame surges. Accuse a true Keeper and the flame dips.

**Winning:** if the flame survives all five Watches, dawn breaks — Keepers win. If it hits zero, the dark wins and Shadows triumph. The top scorer is crowned Best Keeper either way.

## Tech

- **Node.js + Express + Socket.IO** for real-time, room-based multiplayer. The server is the single source of truth; all game state is synced to every device.
- A self-contained client (HTML + canvas flame engine + vanilla JS). No build step.
- Canvas particle flame that reacts live to the flame meter and game events.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

Then open the page on any device on the same network (or share the room code / link).

## Deploy (get it live at a public URL)

### Recommended — Render (free, stable, supports WebSockets)
1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Web Service**, connect your repo.
3. Build: `npm install` · Start: `npm start` · Render auto-detects the `Procfile`.
4. You'll get a public `https://your-app.onrender.com`. Share the URL + room codes.

> Works the same on Railway, Fly.io, Heroku, or any host that runs Node and allows WebSockets.

### Instant (no account) — public tunnel for testing right now
```bash
npm install
npm start              # in one terminal, serves on :3000
npx localtunnel --port 3000   # in another, prints a public https URL
```
Anyone with that URL + a room code can join from their device. (The tunnel only works while your machine is running — use Render for a permanent link.)

## Project structure

```
server.js            # game engine + state machine + Socket.IO
data/prompts.json    # categories + the vague hints Shadows see
public/
  index.html         # landing / lobby / game screens
  css/style.css      # atmospheric UI
  js/flame.js        # canvas particle flame + background engine
  js/app.js          # client logic, screens, interactions
test/playthrough.js  # automated N-player end-to-end test
```

## Test

```bash
# fast-mode automated playthrough (simulates 4 players)
LK_FAST=1 PORT=3299 node server.js &    # start server (fast)
node test/playthrough.js                # expects server on http://localhost:3299
```

---

Built for the Handshake AI Skills Studio × OpenAI Multiplayer Game Challenge.
