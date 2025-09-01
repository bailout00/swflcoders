import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import type { StageConfig } from '../config'

export interface BucketStackProps extends cdk.StackProps {
    stageConfig: StageConfig
}

export class BucketStack extends cdk.Stack {
    public readonly websiteBucket: s3.Bucket
    public readonly logsBucket: s3.Bucket
    public readonly originAccessIdentity: cloudfront.OriginAccessIdentity

    constructor(scope: Construct, id: string, props: BucketStackProps) {
        super(scope, id, props)

        const { stageConfig } = props
        const isProd = stageConfig.environment === 'prod'

        // === S3 Buckets ===

        // Logs bucket for storing access logs
        const logsBucketName = isProd
            ? `swflcoders-logs-${stageConfig.name}`
            : `swflcoders-logs-${stageConfig.name}-cf` // force replacement to enable ACLs in non-prod
        this.logsBucket = new s3.Bucket(this, 'LogsBucket', {
            bucketName: logsBucketName,
            removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: !isProd,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            // CloudFront standard logging requires ACLs; enable ACLs and grant log delivery group
            objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
            accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
            versioned: true,
            lifecycleRules: [
                {
                    id: 'DeleteOldLogs',
                    enabled: true,
                    expiration: cdk.Duration.days(365),
                    noncurrentVersionExpiration: cdk.Duration.days(30),
                },
            ],
        })

        // Website bucket for static assets
        this.websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
            bucketName: `swflcoders-website-${stageConfig.name}`,
            removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: !isProd,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // CloudFront will access via OAI
            versioned: true,
            serverAccessLogsBucket: this.logsBucket,
            serverAccessLogsPrefix: 'website-access/',
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.GET],
                    allowedOrigins: ['*'],
                    allowedHeaders: ['*'],
                    maxAge: 3000,
                },
            ],
            lifecycleRules: [
                {
                    id: 'DeleteOldVersions',
                    enabled: true,
                    noncurrentVersionExpiration: cdk.Duration.days(30),
                },
            ],
        })

        // === CloudFront Origin Access Identity ===
        this.originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
            comment: `OAI for ${stageConfig.name} website`,
        })

        // Grant CloudFront access to the website bucket via OAI
        this.websiteBucket.addToResourcePolicy(
            new iam.PolicyStatement({
                actions: ['s3:GetObject'],
                resources: [this.websiteBucket.arnForObjects('*')],
                principals: [
                    new iam.CanonicalUserPrincipal(
                        this.originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId
                    ),
                ],
            })
        )

        // === Outputs ===
        new cdk.CfnOutput(this, 'WebsiteBucketName', {
            value: this.websiteBucket.bucketName,
            description: 'Website S3 bucket name',
            exportName: `WebsiteBucketName-${stageConfig.name}`,
        })

        new cdk.CfnOutput(this, 'LogsBucketName', {
            value: this.logsBucket.bucketName,
            description: 'Logs S3 bucket name',
            exportName: `LogsBucketName-${stageConfig.name}`,
        })
    }
}
