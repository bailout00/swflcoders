import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StageConfig } from '../config';
import { ApiStack } from './api-stack';
import { CloudwatchDashboardStack } from './cloudwatch-dashboard-stack';
import { BucketStack } from './bucket-stack';
import { WebsiteStack } from './website-stack';
import { DnsStack } from './dns-stack';
import { DbStack } from './db-stack';

export function registerAppStacks(scope: Construct, stageConfig: StageConfig) {
  // DNS stack should be deployed first as it's referenced by other stacks
  const dnsStack = new DnsStack(scope, `dns-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
  });

  // Bucket stack should be deployed second as it's referenced by other stacks
  const bucketStack = new BucketStack(scope, `bucket-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
  });

  // Database stack should be deployed before API stack
  const dbStack = new DbStack(scope, `db-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
  });

  new ApiStack(scope, `api-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
    dbStack,
  });

  new CloudwatchDashboardStack(scope, `monitoring-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
  });

  // Website stack depends on bucket stack and DNS stack
  new WebsiteStack(scope, `web-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
    websiteBucket: bucketStack.websiteBucket,
    logsBucket: bucketStack.logsBucket,
    hostedZone: dnsStack.hostedZone,
    originAccessIdentity: bucketStack.originAccessIdentity,
  });

  // Add future stacks here (e.g., AuthStack, etc.)
  // new AuthStack(scope, `AuthStack-${stageConfig.name}`, { env: {account: stageConfig.account, region: stageConfig.region}, stageConfig });
}
