# Squishy Jump

A side-scrolling jumping game starring squishy plush friends (cat, frog, cow,
bunny, axolotl and bear). Built with Expo SDK 57 for iPhone and iPad and runs in
**Expo Go**. No custom native code.

## Play it

```bash
cd SquishyJump
npm install
npx expo start
```

Scan the QR code with the iPhone/iPad Camera app to open it in Expo Go.

## How to play

- **Tap** to jump. **Tap again in the air** to do a spinning double jump.
- **Hold** for a higher jump, or let go early for a short hop.
- Hop over cacti and low bees. Stay on the ground when a bee buzzes by up high.
- Grab candy for +10 points each. The game speeds up the longer you survive.
- Your best score and favorite squishy are saved on the device.

## Code

- `App.js`: character select menu
- `src/Game.js`: game loop, physics, spawning, collisions, HUD
- `src/Squishy.js`: the squishy characters, drawn from Views
- `src/Sprites.js`: cacti, bees, candy, clouds
- `src/storage.js`: saves best score and selected squishy
