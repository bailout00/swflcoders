import * as cdk from 'aws-cdk-lib'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { type StageConfig, ROOT_DOMAIN, ROOT_HOSTED_ZONE_ID, PROD_ACCOUNT } from '../config'

export interface DnsStackProps extends cdk.StackProps {
    stageConfig: StageConfig
}

export class DnsStack extends cdk.Stack {
    public readonly hostedZone: route53.IHostedZone

    constructor(scope: Construct, id: string, props: DnsStackProps) {
        super(scope, id, props)

        const { stageConfig } = props

        // For production, use the root hosted zone directly
        if (stageConfig.isProd) {
            // Import the root hosted zone from the ZoneStack
            this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'RootHostedZone', {
                hostedZoneId: ROOT_HOSTED_ZONE_ID,
                zoneName: ROOT_DOMAIN,
            })
        } else {
            // For beta/gamma, we'll create subdomain records in the root hosted zone
            // Assume the cross-account DNS role to access the root hosted zone
            const dnsRoleArn = `arn:aws:iam::${PROD_ACCOUNT}:role/DnsManagementRole-${stageConfig.account}`

            // Create a role to assume the cross-account DNS role
            const dnsAccessRole = new iam.Role(this, 'DnsAccessRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'), // Or ec2.amazonaws.com based on your needs
                description: 'Role to access DNS management in production account',
            })

            // Add policy to assume the cross-account DNS role
            dnsAccessRole.addToPolicy(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['sts:AssumeRole'],
                    resources: [dnsRoleArn],
                })
            )

            // Import the root hosted zone from the ZoneStack
            this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'RootHostedZone', {
                hostedZoneId: ROOT_HOSTED_ZONE_ID,
                zoneName: ROOT_DOMAIN,
            })

            // For non-prod environments, we don't create a separate hosted zone
            // Instead, we'll create records in the root hosted zone when needed
            // The actual record creation happens in other stacks (like WebsiteStack)
        }

        // === Outputs ===
        new cdk.CfnOutput(this, 'HostedZoneId', {
            value: this.hostedZone.hostedZoneId,
            description: 'Route53 hosted zone ID',
            exportName: `HostedZoneId-${stageConfig.name}`,
        })

        new cdk.CfnOutput(this, 'HostedZoneName', {
            value: this.hostedZone.zoneName,
            description: 'Route53 hosted zone name',
            exportName: `HostedZoneName-${stageConfig.name}`,
        })
    }
}
