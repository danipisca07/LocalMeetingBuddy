# Meeting Recap Instructions

Generate a meeting recap from the transcript provided in context.

## Language
Write the entire recap in **Italian**.

## Detail Level
**Detailed** — provide comprehensive notes for each topic. Include key statements, context, and nuances. To change the depth, replace `Detailed` with `Concise` (essential bullet points only) or `Standard` (balanced depth).

## Output Structure

Use exactly this structure — do not add, remove, or rename sections:

---

### Speaker List
List every speaker label found in the transcript (e.g., `[user-0]`, `[speaker-1]`). One entry per line. The user will map each label to a real person's name.

### Executive Summary
2–4 sentences summarizing what was discussed and decided in the meeting.

### Topics Discussed
For each topic covered, write a heading and a short description of what was said and what emerged from the discussion.

### Decisions Made
Bullet list of explicit decisions reached. Include the transcript timestamp `[HH:MM:SS]` nearest to where the decision was made.

### Action Items
Bullet list of action items. For each item include: description, responsible speaker label, deadline (if mentioned), and transcript timestamp `[HH:MM:SS]`.

### Open Questions / Next Steps
Unresolved questions, open points, or agreed next steps. If a next meeting date or agenda was mentioned, include it here.

---

Keep the structure identical across all meeting recaps. Do not summarize or paraphrase in a way that loses important technical or strategic details.
