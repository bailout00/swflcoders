import { Stack, StackProps } from 'aws-cdk-lib';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import { PipelineConfig } from '../config';
import * as path from 'path';

export interface CustomImageStackProps extends StackProps {
  pipelineConfig: PipelineConfig;
}

export class CustomImageStack extends Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: CustomImageStackProps) {
    super(scope, id, props);

    // Build the custom image locally (during synth/deploy) and push to ECR via CDK Assets
    // Use process.cwd() which points to packages/cdk when running with ts-node
    const buildImagePath = path.join(process.cwd(), 'build-image');
      
    const asset = new DockerImageAsset(this, 'PipelineBuildImage', {
      directory: buildImagePath,
      file: 'pipeline.dockerfile',
      platform: Platform.LINUX_ARM64,
    });

    this.imageUri = asset.imageUri;
  }
}