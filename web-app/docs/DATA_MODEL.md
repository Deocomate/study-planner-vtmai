# Data model (current web app)

The live app is one static page (`dist/index.html`) hosted as a claude.ai artifact. It has **no server and no database**.
All data lives in the viewer's browser:

| Where | Key | What |
|---|---|---|
| localStorage | `study-planner-wc-v3` | The whole app state `D` (JSON, below). Older keys `-v1`, `-v2` are deleted on load. |
| localStorage | `sp-lang` / `sp-theme` / `sp-role` | UI language (`en`/`vi`), light/dark, who is using it (`ben`/`shin`/`parent`). The colour follows the role: Ben `red`, Shin `blue`, parent/Mom `brown` (`PERSON_THEME` in `js2.js`; `sp-accent` is no longer used). |
| sessionStorage | `sp-splash` | The welcome screen was already shown in this tab. |
| localStorage | `sp-sent` | Which reminders were already shown. |
| IndexedDB | db `study-planner-files`, store `f` | Attached files kept in this browser (Word files, or when uploads to claude.ai are not allowed). Key = `file.local`. |
| claude.ai asset store | `/_blob/<id>` | Attached PDF/images uploaded through the artifact `assets` capability. Key = `file.asset`. |

`database/schema.sql` is the same model as relational tables, for a real backend.

## State `D`

```jsonc
{
  "tasks": [Task],
  "blocks": [{ "id", "c": "ben|shin", "day": 1-7 /* Mon=1 */, "s": "HH:MM", "e": "HH:MM", "t": "Vinschool | Debate EC | …" }],
  "links": [{ "id", "name", "url", "note" }],            // Resources page
  "rewards": [{ "id", "emoji", "name", "cost", "ipadMin" }],
  "redeems": [{ "id", "child", "name", "emoji", "cost", "ipadMin", "status": "pending|approved|denied", "at", "day" }],
  "adj": [{ "id", "child", "pts", "why", "at" }],          // manual point changes
  "rules": { "per5": 1, "ontime": 5, "approved": 10, "daily": 5, "ipadCap": 60 },
  "names": { "ben": "Ben", "shin": "Shin", "mom"?: "Mẹ" },
  "customSubjects": ["…"], "customTeachers": ["…"],      // added with "+ Add new…" in the task form
  "retimed": 3, "wiped1101": 1                            // one-time migrations already run
}
```

### Task

```jsonc
{
  "id": "k3j9x2a",
  "child": "ben | shin | mom",
  "title": "Workbook Unit 8.1",
  "subject": "Maths", "teacher": "Vinschool", "note": "",
  "date": "2026-11-05",        // the day it is done (Excel "Due date" fills date and due)
  "due": "2026-11-05",         // deadline ('' = none). Mom: due = date
  "start": "", "end": "",      // no longer shown; kept empty
  "order": 1170,               // position inside the day (teacher order, then subject)
  "minutes": 30,               // not shown; used for points and daily load
  "priority": "normal | high", "optional": false,
  "repeat": false, "series": null,   // daily practice: repeat=true, one task per occurrence sharing a series id
  "links": ["https://…"],
  "files": [{ "name": "WS.pdf", "type": "application/pdf", "size": 12345, "asset": "<32 hex>" } /* or "local": "f_xxxx" */],
  "status": "todo | doing | done", "doneAt": "ISO time | null",
  "needReview": false, "review": "none | awaiting | approved | changes", "feedback": "",
  "by": "parent | child"
}
```

## Rules worth knowing

- **Sections on Today:** Overdue = not done and `due` (or `date` if no due) is before today, practice excluded. Due today = homework on today, or from an earlier day still not done. Daily tasks = `repeat: true` on today. Mom's tasks = `child: "mom"`, next 14 days.
- **Order everywhere:** teacher rank (Vinschool, Cô Linh Cindy, Cô Vinh, Cô Mẫn, Cô Giang, EC, custom teachers, empty, Home last), then subject, then `order`.
- **Points** are computed from finished tasks every time (never stored): `minutes/5 × per5`, `+ontime` if done on or before `date`, `+approved` if the parent approved, `+daily` when every task of a day is done; plus `adj`; minus approved `redeems`. Mom earns nothing.
- **Excel import** (`parseSheet` in `src/js4.js`): header names are matched by keywords (English or Vietnamese). Current file: `STT | Tên giáo viên | Tên môn học | Bài tập | Due date | Link`. With no Date column, "Due date" is the work day. An empty "Bài tập" takes the subject name. Still supported: Date, Start, End, Minutes, Note, Priority, Child (Ben/Shin/Both/Mẹ), Repetation (Everyday, "Mon, Wed, Fri", "T2, T4"…). Rows with a Deadline but no Date are auto-planned 1–4 days before it (`planItems`).
- `.xlsx` is read without libraries (`readXlsx`: zip central directory + `DecompressionStream('deflate-raw')`), first sheet only.
