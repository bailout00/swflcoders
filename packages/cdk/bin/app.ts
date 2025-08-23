#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SwflcodersStack } from '../lib/swflcoders-stack';
import { getStageConfig } from '../src/config';

const app = new cdk.App();

// Get stage from context (defaults to 'beta')
const stageName = app.node.tryGetContext('stage') || 'beta';
const stageConfig = getStageConfig(stageName);

new SwflcodersStack(app, `SwflcodersStack-${stageConfig.name}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  stageConfig,
});

app.synth();
