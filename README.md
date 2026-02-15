# Show Me Skins

Browse and view League of Legends champion skins in 3D.

Live site: [showmeskins.lol](https://showmeskins.lol)

## Images

![Show Me Skins Icon](companion/assets/icon.png)

| Blue Side | Red Side |
| --- | --- |
| ![Blue Side](public/blue-side.png) | ![Red Side](public/red-side.png) |

## Features

- Browse all champions and skins
- View skins in an interactive 3D model viewer
- Deep links for champion/skin URLs
- Companion integration for live and post-game views

## Local Development

```bash
npm install
npm run dev
```

App runs locally at `http://localhost:5173`.

## Build

```bash
npm run build
npm run preview
```

## Tech

- React + TypeScript + Vite
- Three.js (`@react-three/fiber`, `@react-three/drei`)
