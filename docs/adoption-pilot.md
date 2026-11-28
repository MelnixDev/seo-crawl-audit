# SEO Crawl Audit pilot

Invite five maintainers who regularly deploy a website. Ask each to open the [example](https://melnixdev.github.io/seo-crawl-audit/#regression-demo), run the demo, and try the checker on a site they maintain. Ask them to repeat the check after a later change or deployment within 30 days.

Use one [pilot report](https://github.com/MelnixDev/seo-crawl-audit/issues/new?template=pilot.yml) per project. Keep the earliest report if the same project is submitted twice and merge the checkpoints when tallying results. Projects may use a nickname. Tally the number of unique projects reporting these milestones:

- Opened the example report or ran the local demo.
- Ran the first check on their own project.
- Ran a repeat check on a later change or deployment.

Aim for three external projects reporting repeat checks within 30 days. Record where people stopped and which step they were trying. These counts come from voluntary reports. npm tarball downloads are a separate aggregate, and the CLI sends no telemetry.

## Invitation draft

> Do you maintain a site that deploys regularly? I’m looking for five projects to try a free, open-source check that catches new SEO problems before a release. The demo shows a preview adding `noindex` to the pricing page, then passes once it’s fixed. Try it in your browser or locally, and tell me where you got stuck. If it fits your workflow, run it again on the next deployment and update the same pilot report.
>
> Demo: https://melnixdev.github.io/seo-crawl-audit/#regression-demo
>
> Feedback: https://github.com/MelnixDev/seo-crawl-audit/issues/new?template=pilot.yml
