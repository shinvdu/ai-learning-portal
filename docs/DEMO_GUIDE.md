# Demo Guide

A short walkthrough for showing the portal, plus a checklist to verify the "numbers are computed, not hardcoded" claim.

## 5-minute walkthrough

| Time | Page | What to show | What to click |
|---|---|---|---|
| 0:00–0:50 | `#/home` | Five courses, category filters, search; all data comes from one simulated CSV | Filter a category, search "Python", open a course |
| 0:50–1:30 | `#/course/C3` | Sample video, chapter list with reach rates | Play the video; click a chapter |
| 1:30–2:30 | `#/dashboard` | 5 KPIs and 6 charts; students = 24, not 177; completion is computed per enrollment | Point at the KPI formula hints |
| 2:30–3:30 | Data playground | Edit one record and watch every number change | Edit a record → save → compare KPIs → reset |
| 3:30–4:15 | `#/knowledge/C1` | Summary, glossary, FAQ, quiz with sources | Answer the 3 questions, submit, show explanations |
| 4:15–5:00 | `#/insights` | Insights with concrete numbers and actions; common metric mistakes | Show the formula table and pitfalls |

## 10-minute extended walkthrough

Add:

1. CSV export → modify one value → re-import → verify metrics change.
2. Filter the dashboard by a single course and compare its KPIs.
3. Open `#/chapter/C3/4` and explain the inferred chapter reach.
4. Resize to a phone width; charts switch to a compact layout.

## Admin setup and walkthrough

Start with explicit credentials for a predictable demo:

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='change-me-please' npm start
```

1. Open `#/login`, sign in with the admin account.
2. Open `#/account`: enable MFA with an authenticator, save recovery codes, then open `管理后台`.
3. **Users**: create a learner, switch a role, disable an account, reset a password/MFA, unlock a locked account. Show that the last active admin cannot be demoted or disabled.
4. **审计**: scroll to the audit panel and show recent login/admin/data events.
5. **Courses**: edit a course name/color/video, add a chapter, edit its body, then open the public course page and chapter page to see the change.
6. Back on `#/dashboard`, expand the data playground and edit a record.
7. `#/register` creates a normal learner. A learner can browse public pages but cannot see the admin area or edit data.

## Live data playground

1. Open `#/dashboard`.
2. Expand **数据演示（可编辑）** at the bottom.
3. Click **编辑** on any record.
4. Change `chapters_done` (and optionally `quiz_score`).
5. Save. The KPI cards and charts recalculate from SQLite.
6. Click **恢复初始数据** to return to the seed dataset.

Expected example: editing a Python record from `5/8` to `8/8` raises average completion from **74.3%** to **74.9%**.

Other playground actions:

- **新增记录** changes student / enrollment counts.
- **导入 CSV** replaces the whole records table after validation.
- **导出 CSV** downloads a UTF-8 BOM file that opens cleanly in Excel.

## Talking points

- Every KPI has a visible formula; the UI shows `max(chapters_done) / total_chapters`, not a magic number.
- Missing quiz scores are excluded, not treated as zero.
- Chapter reach is explicitly labelled as an inference because the source CSV has no per-chapter records.
- Write endpoints are unauthenticated: this is a demo, not a production LMS.
- Zero dependencies means the demo runs offline; charts are plain SVG.

## Verification checklist

- [ ] `npm run verify` passes.
- [ ] Changing one record changes the KPI and at least one chart.
- [ ] Restoring seed data returns completion to 74.3% and score to 86.4.
- [ ] Course video plays and can be seeked.
- [ ] Chapter page video plays; reach rates match the course detail list.
- [ ] Quiz accepts answers and shows explanations with sources.
- [ ] `#/dashboard?course=Python%20%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90` filters KPIs to 17 learners / 55.9%.
- [ ] Admin login works; anonymous/learner write requests are rejected with 401/403.
- [ ] Course/chapter edits made in the admin UI immediately appear on public pages.
- [ ] Mobile width (≈390px) is readable; charts use the compact layout.
- [ ] No console errors.