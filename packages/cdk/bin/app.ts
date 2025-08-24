#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {ApiStack} from '../lib/stacks/api-stack';
import {CloudwatchDashboardStack} from '../lib/stacks/cloudwatch-dashboard-stack';
import {getStageConfig} from '../lib/config';

const app = new cdk.App();

// Get stage from context (defaults to 'beta')
const stageName = app.node.tryGetContext('stage') || 'beta';
const stageConfig = getStageConfig(stageName);

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

app.synth();
