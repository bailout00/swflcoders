# CDK Package Code Review — 2025-09-06

Context
- Scope: packages/cdk only (AWS CDK v2 TypeScript). Stacks provision API Gateway (HTTP + WebSocket), Lambda (Rust + Node 22), DynamoDB, CloudFront + S3, Route 53, ACM, and a CDK Pipelines-based multi-account pipeline with a custom ARM64 CodeBuild image. Frontend assets are expected from apps/frontend; Lambda artifacts from packages/backend.
- Goal: solid, talk-ready foundation (not perfection). Node.js 22 preferred across environments.

Must fix
- Website apex record creation: Passing the full domain as recordName likely creates an incorrect FQDN (e.g., beta.swflcoders.jknott.dev.beta.swflcoders.jknott.dev). Use an apex A/AAAA (omit recordName) or only the sublabel as needed. File: lib/stacks/website-stack.ts (AliasRecord).
- CloudFront S3 origin helper: S3BucketOrigin.withOriginAccessIdentity is likely not a valid CDK v2 API (use new S3Origin(bucket, { originAccessIdentity }) or OAC). File: lib/stacks/website-stack.ts (Distribution defaultBehavior.origin).
- CDK feature flags typos: Several keys in cdk.json look misspelled or non-existent (e.g., @aws-cdk/aws-route53-patters, @aws-cdk/aws-norths). These are ignored by CDK; remove or fix to real flags to avoid confusion. File: cdk.json.
- Runtime import not declared: bin/app.ts imports source-map-support/register but the package doesn’t declare source-map-support. Add it as a dependency/devDependency or drop the import. File: bin/app.ts.
- CORS allowed origins: Includes https://${stage}.${domain} which produces beta.beta.swflcoders... for non-prod. Remove the double stage label. File: lib/stacks/api-stack.ts (HTTP API corsPreflight.allowOrigins).

Should fix
- Hosted zone typing: Accept route53.IHostedZone rather than route53.HostedZone to avoid casts. Files: lib/stacks/website-stack.ts props, lib/stacks/index.ts cast.
- Certificate validation: Use CertificateValidation.fromDns(hostedZone) so validation uses the intended zone explicitly. File: lib/stacks/website-stack.ts.
- API Gateway logging/observability: Enable access logs and metrics for HTTP and WebSocket stages (LogGroup with retention). File: lib/stacks/api-stack.ts.
- Lambda log retention and policies: Set logRetention on all Functions and scope IAM to least privilege where possible. Files: lib/stacks/api-stack.ts, lib/stacks/db-stack.ts.
- CodeBuild IAM scope: Pipeline CodeBuild role grants very broad permissions (iam:*, ec2:*, ecs:*, s3:*, cloudfront:*, etc.) on *. Tighten to the minimum set per step and per account. File: lib/pipeline/pipeline.ts (CodeBuildRole and codeBuildDefaults.rolePolicy).
- Prefer CloudFront Origin Access Control (OAC) over OAI for new distributions. Files: lib/stacks/bucket-stack.ts, lib/stacks/website-stack.ts.
- DynamoDB naming: Table names are not stage-scoped; uniqueness currently relies on separate accounts. Consider per-stage suffix for portability and to support same-account multi-stage. File: lib/stacks/db-stack.ts (DYNAMODB_TABLES constants).
- Asset path coupling: Relative paths (../backend/target/lambda, ../../apps/frontend/dist) depend on running CDK from the package dir. Clarify in README or consider CDK bundling (esbuild) for Node Lambdas and cargo build steps for Rust via bundling.
- Remove legacy pipeline artifacts: buildspecs/*.yml and lib/stacks/pipeline-stack.ts.old appear unused after migrating to CDK Pipelines. Keeping them risks drift. Files: buildspecs/, lib/stacks/pipeline-stack.ts.old.
- Don’t commit volatile context: cdk.context.json can become stale and environment-specific. Prefer resolving hosted zones via imports or document regeneration steps. File: cdk.context.json.
- Tooling alignment: Either remove Jest deps or add a config; ts-jest@29 + jest@30 mismatch. Add ts-node as a devDependency if relying on npx ts-node from cdk.json. File: package.json.

Nice to have
- Web security: Attach AWS WAFv2 to CloudFront distribution, add security headers (ResponseHeadersPolicy.SECURITY_HEADERS or custom), and tighten S3 CORS to the website origin only.
- Pipeline: Cache yarn/cargo more aggressively or split build steps for clearer failures; consider test summary uploads and artifacts.
- Resilience: Add DLQs for async Lambda patterns, retry policies for integrations, and alarms on key metrics (API latency/5xx, DynamoDB throttling, Lambda errors).
- Cost hygiene: Review CloudFront price class by stage, DynamoDB TTLs and backups, and Log retention defaults (avoid infinite retention).
- Docs: Add a short README in packages/cdk explaining how to run "cdk synth/diff/deploy" from a fresh clone, and the build order for backend/frontend assets.

References (files reviewed)
- package.json, cdk.json, cdk.context.json, tsconfig.json
- bin/app.ts
- lib/config.ts
- lib/pipeline/custom-image-stack.ts, lib/pipeline/pipeline.ts
- lib/stacks/*.ts (api, bucket, cloudwatch-dashboard, db, dns, index, integ-support, website, zone)
- build-image/* (pipeline.dockerfile, buildspec-pipeline.yml)
- buildspecs/* (build.yml, deploy.yml, e2e.yml)

