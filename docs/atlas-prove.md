# Atlas prove pack

Build **rail-36-prove**. The done classifica is checked by `backend/src/services/atlasProve.test.js`.

```bash
cd backend && npm run test:atlas
```

That script is `node --test src/services/atlas*.test.js`.

## Result

- Atlas suite: **74 tests, 74 passed, 0 failed** (12 files).
- Prove items: **33/33 (100%)** on the runtime pack and again on the isolated pack (temp trust, session, runs, schedule, decisions).
- `GET /health` includes `prove` (`ok`, `passed`, `total`, `percent`, `deferred`, `items`). The process `ok` flag stays the liveness flag. `prove.ok` is the pack.

Phase Later and X6 are not part of the 33.

## Deferred

- **Phase Later** — not in this pack. No Phase Later listener is armed.
- **X6 wake-word** — `VOICE_ALWAYS_ON` is recorded and does not start a listener. `wakeWord` stays `"deferred"` (`phase: "later"`).

## What the 33 items check

| Id | Check |
| --- | --- |
| identity | Status name Atlas, including `GET /agentq/resident` |
| personality | `completeChat` keeps a single Atlas system message |
| L3 | `zoom-in` is AUTO; unknown / export / delete / password are ASK |
| X1 | `POST /agentq/autonomy/approve` shape; third confirm promotes one id |
| resident-wake | `POST /agentq/resident/wake` calls `wakeResident` |
| L2 | Ingress hooks for updates, news, proactive, and schedule |
| C2 | State answers use only the facts given |
| C3 | Search runs only on an explicit ask; implicit sandbox search is refused |
| C6 | Problem steps; browser-use stays ASK |
| C9 | Session file restores wake, module, and pending ASK |
| C11 | Soft-band spend asks before the paid turn |
| C12 | AUTO / ASK trust tags |
| C7 | Suggestions go through the L3 gate |
| C8 | Self-heal refreshes and clears a transient flag |
| X5 | Urgency speaks at the threshold; a wake always speaks |
| P2 | Morning habit prepares `map` and does not run `export` |
| P3 | One curiosity observation, then cooldown |
| M1 | Recall ranks by keyword and recency |
| M2 | Provider fallback to the alternate model |
| M3 | Fatal failures are not retried |
| M4 | Decision log records why |
| M5 | Startup integrity runs before listen |
| J1 | One specialist per turn; the speaker stays Atlas |
| J2 | A run pauses on ASK and resumes |
| J3 | MCP `initialize` and `tools/list` |
| J5 | Hourly schedule |
| J6 | Cockpit payload |
| X2 | `morning-open` workflow list |
| X4 | Memory graph links a shared tag |
| tts | ElevenLabs Flash is first, then Deepgram Aura, then MAI voice |
| alphabet | A–Z, digits, and symbol pack normalizes before a code is spoken |
| call | Phase Now reducer is `barge-cancel`; X6 stays unarmed |
| build | Stamp `rail-36-prove` on `/health`, `BUILD_ID`, and the public mirror |
