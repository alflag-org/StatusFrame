# Deployment

Choose **Quick deployment** for evaluation or temporary use. Choose **Long-term deployment** for a GitHub fork that can receive upstream updates.

Both use `pnpm build` and `pnpm run deploy`. Deployment applies D1 migrations before publishing the Worker and stops if a migration fails. StatusFrame publishes read-only service status; no Cloudflare Access setup is required.

## Quick deployment

1. Open [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/viasnake/StatusFrame) and connect your GitHub and Cloudflare accounts.
2. Choose the repository, Worker, and database names. Cloudflare copies the complete repository and provisions the Worker and D1 binding `STATUSFRAME_DB`.
3. Use the repository root as the application path. Set the build command to `pnpm build` and deploy command to `pnpm run deploy`.
4. Start deployment and check that migrations finish before the Worker is published. Confirm that the copied `wrangler.jsonc` contains the provisioned database ID in place of the placeholder.
5. Set the production branch to the copied repository's default branch and disable preview builds. Then configure and verify the installation below.

This creates an independent copy, not a GitHub fork. GitHub **Sync fork** is unavailable; upstream updates must be brought into the copy manually.

## Long-term deployment

1. [Fork StatusFrame](https://github.com/viasnake/StatusFrame/fork) on GitHub, keeping the default branch, `master`.
2. In your Cloudflare account, create a fresh D1 database named `statusframe`. Replace the all-zero `database_id` in the fork's root `wrangler.jsonc` with its ID. If you choose another database name, also update `database_name`; keep the binding `STATUSFRAME_DB`.
3. Configure your public services and monitoring targets in `apps/worker/statusframe.yml` and commit the changes to your fork.
4. In **Workers & Pages**, create an application with GitHub and select your existing fork from the repository list.
5. Configure the build:

   | Field | Value |
   | --- | --- |
   | Project / Worker name | `statusframe`, matching `name` in `wrangler.jsonc` |
   | Root directory / Path | `/` (repository root) |
   | Production branch | `master` (or your fork's default branch) |
   | Build command | `pnpm build` |
   | Deploy command | `pnpm run deploy` |
   | Preview builds | Off |
   | API token | Token offered by the import flow, with Worker deployment and D1 edit access |

6. Deploy. Check the migration result and then verify the installation below.

The database must exist and have its real ID configured before the first build: the deploy command runs remote migrations before Worker publication. Preview builds require a separate database and configuration; `preview_urls: false` alone does not disable build triggers.

Node.js is selected by `.node-version`, and pnpm by `packageManager` in `package.json`. If you override tool versions in [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), use the same versions.

If remote migrations fail with a permission error, check that the build token has **Account → D1 → Edit** for the target account. Keep API tokens in Cloudflare's build settings.

## Configure and verify

Edit `apps/worker/statusframe.yml` in the deployed copy or fork and push to its production branch. YAML is bundled at deployment; each change triggers a build and deployment.

Open the Worker address, `https://<worker>.<account>.workers.dev`, or your custom domain:

- `/` displays the public service status.
- `/api/status`, `/api/incidents`, and `/api/maintenance` return public JSON.
- The initial view is `unknown`; after enough scheduled successes it becomes `operational`.
- Monitoring targets, private monitor IDs, and credentials must not appear in responses.

The default example checks `example.com`. Replace it with your service targets. See [Configuration](configuration.md) for intervals, thresholds, incidents, and maintenance.

### Optional webhooks

Before enabling `notifications.webhook`, add `STATUSFRAME_WEBHOOK_URL` in the Worker's runtime **Variables and Secrets** settings. It must be an HTTPS URL. Add `STATUSFRAME_WEBHOOK_SECRET` if the receiver uses signed events. These runtime secrets are separate from build variables and are never stored in YAML.

The signature is a hex HMAC-SHA256 of the exact JSON body in `x-statusframe-signature`. Failed delivery attempts are not retried. See [Runtime costs](runtime-cost.md).

## Updates

For a long-term deployment, open the fork's production branch and choose **Sync fork → Update branch**. Review conflicts with your configuration changes. The updated branch triggers the same build, migration, and deployment sequence.

For a Quick deployment copy, merge upstream changes manually and push the reviewed result to the production branch. Both paths retain D1 data; use new migrations for schema changes rather than replacing an applied migration. The `0002_status_history.sql` migration adds history storage without deleting existing records. Apply it before publishing the updated Worker; history begins at the first scheduled checkpoint and older dates remain unknown.

## Command-line deployment

From the repository root, install dependencies as described in [Getting started](getting-started.md), then:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create statusframe
```

Put the returned database ID in root `wrangler.jsonc`, configure your services, and run:

```sh
pnpm build
pnpm run deploy
```

Use a new database for this schema; there is no migration from older StatusFrame installations.
