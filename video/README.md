# Brian product films

Two standalone 1600×900, 30fps Remotion compositions for the landing page.

- `SkillCreation` — Slack, Gmail, support tickets, Drive/docs, and database
  evidence become a reviewed production-release skill.
- `SkillExecution` — an agent uses that skill to draft a tone-matched email,
  patch migration code, run safety checks and tests, open a PR, and log the
  execution.

Both films are 660 frames (about 22 seconds) and are designed to work muted.
The landing page pauses them for visitors who prefer reduced motion and exposes
an explicit play/pause control.

## Preview

```bash
cd video
npm install
npm run studio
```

## Render

```bash
cd video
npm run render
npm run still:skill
npm run still:execution
```

The render commands write the MP4 masters and poster PNGs to `public/videos/`,
where the React landing page references them.
