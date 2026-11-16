import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('', (_request, response) => {
  response.json({ message: 'It works! This message came from the backend.' });
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
