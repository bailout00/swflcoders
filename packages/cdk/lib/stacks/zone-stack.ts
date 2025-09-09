import * as cdk from 'aws-cdk-lib'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { ROOT_DOMAIN, BETA_ACCOUNT, GAMMA_ACCOUNT, PIPELINE_ACCOUNT } from '../config'

export class ZoneStack extends cdk.Stack {
    public readonly hostedZone: route53.HostedZone

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        // Create the root hosted zone for swflcoders.jknott.dev
        this.hostedZone = new route53.HostedZone(this, 'RootHostedZone', {
            zoneName: ROOT_DOMAIN,
            comment: `Root hosted zone for ${ROOT_DOMAIN}`,
        })

        // Create cross-account DNS management roles
        this.createCrossAccountDnsRoles()

        // === Outputs ===
        new cdk.CfnOutput(this, 'RootHostedZoneId', {
            value: this.hostedZone.hostedZoneId,
            description: 'Route53 root hosted zone ID',
            exportName: 'RootHostedZoneId',
        })

        new cdk.CfnOutput(this, 'RootHostedZoneName', {
            value: this.hostedZone.zoneName,
            description: 'Route53 root hosted zone name',
            exportName: 'RootHostedZoneName',
        })
    }

    private createCrossAccountDnsRoles() {
        const accounts = [BETA_ACCOUNT, GAMMA_ACCOUNT, PIPELINE_ACCOUNT]

        accounts.forEach((accountId) => {
            const roleName = `DnsManagementRole-${accountId}`

            const dnsRole = new iam.Role(this, roleName, {
                roleName,
                assumedBy: new iam.AccountPrincipal(accountId),
                description: `Allows ${accountId} to manage DNS records in the root hosted zone`,
            })

            // Attach policy for DNS management
            dnsRole.addToPolicy(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'route53:GetChange',
                        'route53:ChangeResourceRecordSets',
                        'route53:ListResourceRecordSets',
                    ],
                    resources: [this.hostedZone.hostedZoneArn],
                })
            )

            // Allow listing hosted zones (needed for CDK)
            dnsRole.addToPolicy(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['route53:ListHostedZones', 'route53:GetHostedZone'],
                    resources: ['*'], // Route53 hosted zone listing requires * resource
                })
            )

            new cdk.CfnOutput(this, `DnsRoleArn-${accountId}`, {
                value: dnsRole.roleArn,
                description: `DNS management role ARN for account ${accountId}`,
                exportName: `DnsRoleArn-${accountId}`,
            })
        })
    }
}
