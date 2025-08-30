#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CustomImageStack } from '../lib/pipeline/custom-image-stack';
import { PipelineStack } from '../lib/pipeline/pipeline';
import { pipelineConfig, getStageConfig } from '../lib/config';

const app = new cdk.App();

// Get stage configurations
const betaStage = getStageConfig('beta');
const gammaStage = getStageConfig('gamma');

const prodStage = getStageConfig('prod');

// Create custom build image stack
const customImageStack = new CustomImageStack(app, 'SwflcodersCustomImageStack', {
  pipelineConfig,
  env: {
    account: pipelineConfig.account,
    region: pipelineConfig.region,
  },
});

// Create the main pipeline stack
const pipelineStack = new PipelineStack(app, 'SwflcodersPipelineStack', {
  pipelineConfig,
  betaStage,
  gammaStage,
  prodStage,
  customImageStack,
  env: {
    account: pipelineConfig.account,
    region: pipelineConfig.region,
  },
});

// Pipeline stack depends on custom image stack
pipelineStack.addDependency(customImageStack);

app.synth();
