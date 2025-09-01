import * as cdk from 'aws-cdk-lib'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as iam from 'aws-cdk-lib/aws-iam'
import 'aws-cdk-lib/aws-route53'
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
            // For beta/gamma, create a separate hosted zone for the subdomain
            this.hostedZone = new route53.HostedZone(this, 'SubdomainHostedZone', {
                zoneName: stageConfig.domain,
            })

            // Delegate subdomain to this hosted zone in the root account using built-in CDK construct
            const delegationRoleArn = `arn:aws:iam::${PROD_ACCOUNT}:role/DnsManagementRole-${stageConfig.account}`
            const delegationRole = iam.Role.fromRoleArn(this, 'DelegationRole', delegationRoleArn)

            new route53.CrossAccountZoneDelegationRecord(this, 'SubdomainDelegation', {
                delegatedZone: this.hostedZone,
                parentHostedZoneId: ROOT_HOSTED_ZONE_ID,
                delegationRole,
            })
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
