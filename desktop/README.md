# StayDesk desktop shell

Electron wrapper that starts the existing Docker Compose stack and loads `http://localhost:3000`.

See [docs/DESKTOP_OPERATOR.md](../docs/DESKTOP_OPERATOR.md) for setup, backup/restore, and offline demo notes.

```bat
npm install
npm start
npm run dist
```

`npm run dist` builds a Windows NSIS installer via electron-builder (run only when you are packaging for the client).
