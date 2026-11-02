# Family Study Planner (Ben & Shin)

A calm, private study planner: one board each for Ben (grade 5) and Shin (grade 4), plus a Parent Dashboard. Everything is in English. Times are Vietnam time (Asia/Ho_Chi_Minh); weeks run Monday–Sunday.

## Run it on your computer (about 5 minutes)
1. Install **Node.js 22.13 or newer** from nodejs.org.
2. Open a terminal in this folder and run: `npm start`
3. Open http://localhost:3000. The first time, you get a set-up page: choose your password and a PIN for each child. Tick "demo tasks" to try everything (removable in one click).
4. Sign in as Parent, Ben or Shin. There is nothing to install with npm: the app has **no dependencies**.

To stop: press Ctrl+C. Your data lives in the `data/` folder (database + private uploaded files). Back that folder up.

## What works right now (tested)
- Separate sign-ins, with permissions enforced on the server (a child cannot read the other child's data, change deadlines/instructions or approve work).
- Shared task database shown as Ben's board, Shin's board and the Parent Dashboard.
- Weekly import from pasted text, your weekly template, or typing by hand, with an editable preview, flags for unclear text and duplicates, and parent confirmation before saving ("Both" creates two separate tasks).
- Rule-based scheduler (no AI, no cost) with a preview; respects classes, travel, meals, bedtime, session/break lengths, daily limits; keeps finished and locked sessions; lists unscheduled tasks with reasons; "Reschedule unfinished tasks" keeps original deadlines.
- Children can drag cards, use the Change date/time form, reorder with ▲▼, and lock sessions, with warnings for overlaps, overload and deadline clashes.
- Status (Not started / In progress / Done / Needs help) is separate from review (Not required / Awaiting / Changes requested / Approved); resubmission history is kept.
- Progress by count and by estimated time, on-time rate; no invented actual study time.
- Monthly report + reset with preview, typed confirmation, idempotency and your A/B policy.
- In-app notifications.

## Needs setup from you (not verified here)
| Feature | What to do |
|---|---|
| **Email reminders** | Choose SMTP (e.g. Gmail with an *App password*) or Resend in `.env` (see `.env.example`), then press **Send test email** in Reminders & Settings. Until then, no real email is sent and the app says so. The scheduler runs inside the server, so emails go out even when no browser is open, **as long as the server itself stays running**. |
| **Reading pictures/PDFs** | Set `ANTHROPIC_API_KEY` (pay-per-use, billed by Anthropic; keep the key only on the server). Without it the app says "not connected" and never pretends; pasted text and manual entry still work. |
| **Always-on hosting** | Needs a host that never sleeps and has a persistent disk. Use the included `Dockerfile` and mount a volume at `/data`. Set `SETUP_CODE`, `COOKIE_SECURE=1`, `APP_BASE_URL`, and serve over https. Free tiers that sleep will miss reminders. |
| Push notifications / Zalo | **Not included.** Only in-app notifications and email. |

## Month-end rules
- A task belongs to the month of its original deadline (no deadline: the Thursday of its week), so weeks that span two months are handled consistently.
- Reports are saved and verified **before** anything is cleared. Unfinished work is never marked complete. Done-but-unreviewed work is kept for your review.
- Choose policy A (carry forward, original deadlines kept) or B (close). Automatic reset only runs if you choose a policy and switch it on; it runs at 00:10 on the 1st. **Choose a policy before 1 November.**
- Uploaded files of cleared tasks are deleted from this server only. Files in Google Drive are never touched.

## Privacy
Uploaded work is stored privately and only served to people allowed to see it (no public links). Passwords are hashed. API keys stay on the server.

## Tests
`npm test` runs 77 automated backend tests (permissions, scheduling, workflow, import, reminders, monthly reset).

See `docs/DEFAULTS_TO_CONFIRM.md` for the guesses you should check.
