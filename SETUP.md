# SETUP — Stigmergy from zero

You need: Node 20+, a CockroachDB Cloud cluster, an OpenRouter key (optional but recommended), and an AWS account for App Runner. No Bedrock.

Private notes and the video script live in `mydocs/` which is **gitignored**. Do not commit it.

---

## 1. CockroachDB Cloud

1. Create an account at [cockroachlabs.cloud](https://cockroachlabs.cloud).
2. Create a **serverless** cluster in an **AWS** region.
3. Add your IP (or `0.0.0.0/0` for a short demo) to the allowlist.
4. Create a SQL user and copy the connection string.
5. Put it in `.env.local`:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:26257/defaultdb?sslmode=verify-full
```

6. Apply schema + vector index:

```bash
npm install
npm run db:schema
```

This creates `cells`, `packages`, `scents` (`VECTOR(384)` + prefix index on `warehouse_id`), and `floor_events`.

7. Optional check in the SQL shell:

```sql
SHOW INDEXES FROM scents;
SELECT count(*) FROM cells;
```

---

## 2. Managed MCP (required tool #2)

1. In Cockroach Cloud Console open **MCP** / **Connect** → **Managed MCP Server**.
2. Copy the snippet into Cursor (`~/.cursor/mcp.json` or project MCP settings). Endpoint reference: `https://cockroachlabs.cloud/mcp`.
3. MCP is **read-only by default** — that is the product: judges inspect the floor, they cannot steal a reservation.
4. Ask: `Who holds SPARE on warehouse_id = 'default'?`
5. Copy [`skills/stigmergy-floor/SKILL.md`](skills/stigmergy-floor/SKILL.md) into Cursor skills if you want the query pack on the agent.

Create a **read-only SQL user** for humans if you also point `/inspector` at a restricted role later. The demo URL inspector is already GET-only.

---

## 3. OpenRouter (no Bedrock)

1. Create a key at [openrouter.ai](https://openrouter.ai).
2. Use a **free** model id (pin whatever is currently `:free`).

```bash
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=meta-llama/llama-3.2-3b-instruct:free
```

Pickers use the model only to phrase scent notes / break ties. If the key is missing or the API errors, they keep moving via the heuristic. Embeddings never call OpenRouter.

---

## 4. Local app

```bash
cp .env.example .env.local
# fill DATABASE_URL and OPENROUTER_*

npm install
npm test
npm run dev
```

- With `DATABASE_URL`: memory is Cockroach (required for the judged demo).
- Without it, or with `STIGMERGY_STORE=memory`: in-process serializable store so the UI still runs (tests / design). **Do not submit that mode as the demo.**

Open `http://localhost:3000`. Click **Spawn 8**. Watch the row log.

```bash
npm run test:integration   # hits Cockroach; skips if DATABASE_URL unset
npx playwright install chromium
npm run test:e2e
```

---

## 5. AWS App Runner (required AWS service)

The picker loops live **inside the Node process**. They cannot run on Amplify/Vercel serverless. App Runner (one instance) is the host.

1. Create an AWS account. Install [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and log in.
2. Build and push the image (replace region/account):

```bash
aws ecr create-repository --repository-name stigmergy --region us-east-1
docker build -t stigmergy .
docker tag stigmergy:latest ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/stigmergy:latest
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/stigmergy:latest
```

3. Console → **App Runner** → create service from that image.
4. Port **3000**. Single instance (so `globalThis` workers stay coherent).
5. Environment variables: `DATABASE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `NODE_ENV=production`.
6. Health check: `GET /api/health`.
7. Paste the HTTPS URL into README.md **Demo URL**.

Dockerfile uses Next.js `output: "standalone"`.

---

## 6. GitHub / Devpost

1. Public repo, MIT `LICENSE` at the root (GitHub About → detect license).
2. README lists Cockroach tools + AWS services (already written).
3. Do not commit `.env.local` or `mydocs/`.
4. Record the video from `mydocs/demo-script.md` (local only). Upload to YouTube or Vimeo, public, **under 3 minutes**. Show the SQL overlay and MCP, not only the pretty grid.
5. On Devpost identify:
   - **Cockroach:** Distributed Vector Indexing (move loop) + Managed MCP Server (read-only inspector). Optional: Agent Skill `skills/stigmergy-floor`.
   - **AWS:** App Runner (agent runtime + demo URL).
6. Keep the App Runner service up through judging.

---

## 7. Submission checklist

- [ ] Cockroach Cloud with `VECTOR` index on `scents (warehouse_id, embedding)`
- [ ] MCP connected; write attempt denied
- [ ] App Runner URL live; `/api/health` shows `store: "cockroach"`
- [ ] `npm test` green
- [ ] Public MIT repo + README + SETUP
- [ ] Video shows contention, dead-end scent, kill/resume, MCP
- [ ] No Redis, no Bedrock AgentCore Memory, no orchestrator chat

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `VECTOR` type unknown | Cluster too old; use current Cockroach Cloud serverless |
| Vector index create fails | Re-run `CREATE VECTOR INDEX IF NOT EXISTS scents_embedding_idx ON scents (warehouse_id, embedding)` |
| SSL errors | `sslmode=verify-full` and CA from Cloud console; local debug may use `rejectUnauthorized: false` (already in `lib/pg-store.ts`) |
| Pickers pile on dock | Reset floor; spawn 8 not 48 |
| Demo is “memory” store | `DATABASE_URL` missing on App Runner |
| OpenRouter 429 | Ignore; heuristic fallback is tested and expected |
