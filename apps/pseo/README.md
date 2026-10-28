# pSEO workspace

The pSEO workspace is built into FD CODE. Open **pSEO** beside ARTsie in the sidebar, or search for **Open pSEO workspace** in the command palette. The canonical UI and workflow live under `apps/web/src/components/pseo`; this package is a standalone development harness using the same code.

Inside the IDE, choose an existing project and select **Work with agent** to prepare an article prompt in the normal composer. Review the prompt and select your configured provider/model before sending. Responses are not automatically written back into the article. ARTsie is available directly for optional media work on the primary host. SEO data and CMS integrations remain unconnected.

From this directory, with workspace dependencies installed:

```sh
npm run dev
npm test
npm run typecheck
npm run build
```

The development address is `http://127.0.0.1:5740`. The strict port prevents silently moving a saved workspace to a different origin.

Create an article, write and approve its brief, attach research sources, move to writing, then edit the Markdown draft. Run preliminary checks before handing the article to a human editor. Handover is not permission to publish. Changing brief scope revokes approval; editing a reviewed draft invalidates its checks.

Drafts and client details are saved in this browser under `fdcode:pseo:workspace:v1`. They are specific to the browser profile and origin; they do not sync between devices. Export workspace backups before clearing browser data. Article Markdown exports include the brief and research sources. Sources are manually attached and have not been live-verified.

The preliminary checks do not implement the full 34-item Comparison/Alternatives publish gate or the separate 70-point quality audit. Both remain explicit manual-review requirements. No measured SEO verdicts, scores or agent outputs are fabricated.

Reference: https://pseo-v02-agent-notes.vercel.app/
