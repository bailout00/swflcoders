import type * as route53 from 'aws-cdk-lib/aws-route53'
import type { Construct } from 'constructs'
import type { StageConfig } from '../config'
import { ApiStack } from './api-stack'
import { CloudwatchDashboardStack } from './cloudwatch-dashboard-stack'
import { BucketStack } from './bucket-stack'
import { WebsiteStack } from './website-stack'
import { DnsStack } from './dns-stack'
import { DbStack } from './db-stack'

export function registerAppStacks(scope: Construct, stageConfig: StageConfig) {
    // DNS stack should be deployed first as it's referenced by other stacks
    const dnsStack = new DnsStack(scope, `dns`, {
        env: {
            account: stageConfig.account,
            region: stageConfig.region,
        },
        stageConfig,
    })

    // Bucket stack should be deployed second as it's referenced by other stacks
    const bucketStack = new BucketStack(scope, `bucket`, {
        env: {
            account: stageConfig.account,
            region: stageConfig.region,
        },
        stageConfig,
    })

    // Database stack creates tables that API stack references by name
    const dbStack = new DbStack(scope, `db`, {
        env: {
            account: stageConfig.account,
            region: stageConfig.region,
        },
        stageConfig,
    })

    new ApiStack(scope, `api`, {
        env: {
            account: stageConfig.account,
            region: stageConfig.region,
        },
        stageConfig,
        hostedZone: dnsStack.hostedZone,
        dbStack,
    })

    new CloudwatchDashboardStack(scope, `monitoring`, {
        env: {
            account: stageConfig.account,
            region: stageConfig.region,
        },
        stageConfig,
    })

    // Website stack depends on bucket stack and DNS stack
    new WebsiteStack(scope, `web`, {
        env: {
            account: stageConfig.account,
            region: stageConfig.region,
        },
        stageConfig,
        websiteBucket: bucketStack.websiteBucket,
        logsBucket: bucketStack.logsBucket,
        hostedZone: dnsStack.hostedZone as route53.HostedZone,
        originAccessIdentity: bucketStack.originAccessIdentity,
    })

    // Add future stacks here (e.g., AuthStack, etc.)
    // new AuthStack(scope, `AuthStack-${stageConfig.name}`, { env: {account: stageConfig.account, region: stageConfig.region}, stageConfig });
}
