#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { CustomImageStack } from '../lib/pipeline/custom-image-stack'
import { PipelineStack } from '../lib/pipeline/pipeline'
import { pipelineConfig, getStageConfig } from '../lib/config'

const app = new cdk.App()

// Get all stage configurations
const stages = [getStageConfig('beta'), getStageConfig('gamma'), getStageConfig('prod')]

// Create custom build image stack
const customImageStack = new CustomImageStack(app, 'swflcoders-build-image', {
    pipelineConfig,
    env: {
        account: pipelineConfig.account,
        region: pipelineConfig.region,
    },
})

// Create the main pipeline stack
const pipelineStack = new PipelineStack(app, 'swflcoders-pipeline', {
    pipelineConfig,
    stages,
    customImageStack,
    env: {
        account: pipelineConfig.account,
        region: pipelineConfig.region,
    },
})

// Pipeline stack depends on custom image stack
pipelineStack.addDependency(customImageStack)

app.synth()
