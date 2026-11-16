# Simple React + backend demo

The frontend and backend live in separate folders:

- `frontend/` — React app powered by Vite
- `backend/` — Express API

## Run it

Open two terminals from the project root.

```sh
cd backend
npm install
npm run dev
```

```sh
cd frontend
npm install
npm run dev
```

Open the frontend URL printed by Vite (usually `http://localhost:5173`). The page fetches its greeting from `http://localhost:3001/api/hello`.
