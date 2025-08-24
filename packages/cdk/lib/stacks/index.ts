import * as cdk from 'aws-cdk-lib';
import { StageConfig } from '../config';
import { ApiStack } from './api-stack';
import { CloudwatchDashboardStack } from './cloudwatch-dashboard-stack';

export function registerAppStacks(app: cdk.App, stageConfig: StageConfig) {
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

  // Add future stacks here (e.g., DynamoDBStack, AuthStack, etc.)
  // new DynamoDbStack(app, `DynamoDbStack-${stageConfig.name}`, { env: {account: stageConfig.account, region: stageConfig.region}, stageConfig });
}
