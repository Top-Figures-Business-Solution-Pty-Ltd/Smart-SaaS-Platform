# Production Deployment Safety Checklist

This checklist keeps Smart Accounting / Smart Grants production updates predictable.
It is intentionally conservative: verify first, then run one step at a time.

## Scope

- Production branch: `main`
- Production app: `smart_accounting`
- Production runtime: Frappe bench / ERPNext
- This document does not replace VM checkpoints or site backups.

## Before Deployment

1. Confirm the release branch and target commit.
   - The production server should deploy from `main`.
   - Avoid deploying uncommitted local files.

2. Confirm the production site name.
   - Example placeholder: `[site-name]`
   - The site should exist under `sites/[site-name]`.

3. Take a VM checkpoint or provider snapshot.
   - This is the fastest full rollback for unexpected production behavior.

4. Take a Frappe backup with files.
   ```bash
   bench --site [site-name] backup --with-files
   ```

5. Run the preflight script from the app repo.
   ```bash
   bash ops/release/production-preflight.sh [site-name]
   ```

6. Review the output before running any deployment command.
   - Stop if the script reports the wrong branch, missing site, or dirty app tree.

## Deployment Steps

Run these manually and one at a time on the production server.

```bash
cd /home/jeffrey/frappe-bench
git -C apps/smart_accounting status --short
git -C apps/smart_accounting pull --ff-only origin main
bench setup requirements
bench --site [site-name] migrate
bench build --app smart_accounting
bench restart
bench --site [site-name] clear-cache
```

## Immediate Smoke Test

After restart, verify the user-facing paths before leaving the deployment.

- Open Smart Accounting.
- Open Smart Grants.
- Open one Project from each board.
- Edit a safe non-critical test field in test data if available.
- Check Last Updated records the change.
- Open Automation panel as an admin.
- Open Health Check and confirm it loads without running automations.
- Check Error Log for new severe errors.

## Automation Safety Check

The deployment should not manually run automations unless that is the explicit purpose of the release.

After deployment:

- Confirm scheduled jobs are running normally.
- Confirm no unexpected large batch of Automation Run Log records was created.
- Check recent Automation Health output for failed or skipped runs.

## Rollback Decision

Rollback if any of these happen:

- Smart Accounting or Smart Grants cannot load.
- Project save fails for normal users.
- Automation starts changing many projects unexpectedly.
- Migration fails and cannot be safely retried.
- Error Log shows repeated critical exceptions from the new release.

Preferred rollback order:

1. Use the VM checkpoint if production behavior is unsafe.
2. If only app code is wrong and database migration is known safe, deploy the previous commit.
3. Restore Frappe backup only when data corruption or failed migration requires it.

## After Deployment

- Record deployed commit SHA.
- Record backup file names.
- Record deployment time and smoke-test result.
- Keep the release notes short and factual.
