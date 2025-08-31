#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { stages } from '../lib/config';
import { registerAppStacks } from '../lib/stacks';

const app = new cdk.App();

// Build all stages at once
for (const stageConfig of stages) {
    console.log(`Building stacks for stage: ${stageConfig.name}`);
    registerAppStacks(app, stageConfig);
}

app.synth();
