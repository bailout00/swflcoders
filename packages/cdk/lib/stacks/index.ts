import * as cdk from 'aws-cdk-lib';
import { StageConfig } from '../config';
import { ApiStack } from './api-stack';
import { CloudwatchDashboardStack } from './cloudwatch-dashboard-stack';
import { BucketStack } from './bucket-stack';
import { WebsiteStack } from './website-stack';
import { DnsStack } from './dns-stack';

export function registerAppStacks(app: cdk.App, stageConfig: StageConfig) {
  // DNS stack should be deployed first as it's referenced by other stacks
  const dnsStack = new DnsStack(app, `DnsStack-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
  });

  // Bucket stack should be deployed second as it's referenced by other stacks
  const bucketStack = new BucketStack(app, `BucketStack-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
  });

  new ApiStack(app, `ApiStack-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
  });

  new CloudwatchDashboardStack(app, `CloudwatchDashboardStack-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
  });

  // Website stack depends on bucket stack and DNS stack
  new WebsiteStack(app, `WebsiteStack-${stageConfig.name}`, {
    env: {
      account: stageConfig.account,
      region: stageConfig.region,
    },
    stageConfig,
    websiteBucket: bucketStack.websiteBucket,
    logsBucket: bucketStack.logsBucket,
    hostedZone: dnsStack.hostedZone,
  });

  // Add future stacks here (e.g., DynamoDBStack, AuthStack, etc.)
  // new DynamoDbStack(app, `DynamoDbStack-${stageConfig.name}`, { env: {account: stageConfig.account, region: stageConfig.region}, stageConfig });
}
