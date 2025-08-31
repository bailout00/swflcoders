import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { StageConfig } from '../config';

export interface DnsStackProps extends cdk.StackProps {
  stageConfig: StageConfig;
}

export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.HostedZone;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { stageConfig } = props;

    // Use the domain directly from stage config
    // This will be:
    // - beta.swflcoders.jknott.dev for beta
    // - gamma.swflcoders.jknott.dev for gamma
    // - swflcoders.jknott.dev for prod
    const hostedZoneDomain = stageConfig.domain;

    // Create hosted zone
    this.hostedZone = new route53.HostedZone(this, 'HostedZone', {
      zoneName: hostedZoneDomain,
      comment: `Hosted zone for ${stageConfig.name} environment`,
    });

    // Add basic DNS records that don't change frequently
    // Note: We'll add more specific records (like CloudFront aliases) in other stacks

    // Note: If using subdomains (beta., gamma.), you may need to set up NS record delegation
    // from the parent domain. This would typically be done manually in Route53 or through
    // cross-account delegation depending on your AWS account structure.

    // === Outputs ===
    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: this.hostedZone.hostedZoneId,
      description: 'Route53 hosted zone ID',
      exportName: `HostedZoneId-${stageConfig.name}`,
    });

    new cdk.CfnOutput(this, 'HostedZoneName', {
      value: this.hostedZone.zoneName,
      description: 'Route53 hosted zone name',
      exportName: `HostedZoneName-${stageConfig.name}`,
    });
  }
}
