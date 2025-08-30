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

    // Determine the domain for the hosted zone
    // For prod, use the root domain (e.g., swflcoders.jknott.dev)
    // For others, use the subdomain (e.g., beta.swflcoders.jknott.dev)
    const hostedZoneDomain = stageConfig.environment === 'prod'
      ? stageConfig.domain
      : stageConfig.domain.split('.').slice(-2).join('.');

    // Create hosted zone
    this.hostedZone = new route53.HostedZone(this, 'HostedZone', {
      zoneName: hostedZoneDomain,
      comment: `Hosted zone for ${stageConfig.name} environment`,
    });

    // Add basic DNS records that don't change frequently
    // Note: We'll add more specific records (like CloudFront aliases) in other stacks

    // Add NS records for subdomain delegation if this is not prod
    if (stageConfig.environment !== 'prod') {
      // This would typically be done manually or through cross-account delegation
      // For now, we'll just create the hosted zone and let other mechanisms handle delegation
    }

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
