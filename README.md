# lab_monitor

Agent + Dashboard to collect and visualize PC health metrics across labs.

Quick start

1. Create `.env` with your MongoDB URI:

```
MONGODB_URI=your-mongodb-uri
PORT=8080
```

2. Install deps and run:

```
npm install
npm run dev
```

3. Open http://localhost:8080, run agents on lab PCs with:

```
node data_getter/agent.js
```
# Lab Metrics Agent & Dashboard

Environment variables in `.env`:

- `PORT` server port (default 3000)
- `MONGODB_URI` MongoDB connection string
- `LAB_ID` lab identifier (e.g., `lab-1`)
- `PC_ID` optional override for hostname
- `SAMPLE_SECONDS` sampling interval (default 1)
- `BATCH_SECONDS` batch/average interval (default 10)

Scripts:

```bash
npm run start
npm run dev
```

API:
- `/api/series?pcId=HOSTNAME&limit=120`
- `/api/lab/series?labId=lab-1&limit=200`


# lab_monitor
