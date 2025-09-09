import * as cdk from 'aws-cdk-lib'
import type * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53targets from 'aws-cdk-lib/aws-route53-targets'
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager'
import type { Construct } from 'constructs'
import type { StageConfig } from '../config'
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'

export interface WebsiteStackProps extends cdk.StackProps {
    stageConfig: StageConfig
    websiteBucket: s3.Bucket
    logsBucket: s3.Bucket
    hostedZone: route53.HostedZone
    originAccessIdentity: cloudfront.OriginAccessIdentity
}

export class WebsiteStack extends cdk.Stack {
    public readonly distribution: cloudfront.Distribution
    public readonly certificate?: certificatemanager.Certificate

    constructor(scope: Construct, id: string, props: WebsiteStackProps) {
        super(scope, id, props)

        const { stageConfig, websiteBucket, logsBucket, hostedZone, originAccessIdentity } = props
        const isProd = stageConfig.environment === 'prod'

        // === SSL Certificate ===
        if (stageConfig.domain) {
            this.certificate = new certificatemanager.Certificate(this, 'Certificate', {
                domainName: stageConfig.domain,
                subjectAlternativeNames: isProd ? [] : [`*.${stageConfig.domain}`],
                validation: certificatemanager.CertificateValidation.fromDns(),
            })
        }

        // OAI and bucket policy are created in BucketStack to avoid cross-stack circular dependencies

        // === CloudFront Distribution ===
        const distributionConfig: cloudfront.DistributionProps = {
            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.minutes(0),
                },
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.minutes(0),
                },
            ],
            defaultBehavior: {
                origin: S3BucketOrigin.withOriginAccessIdentity(websiteBucket, {
                    originAccessIdentity,
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                compress: true,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
            enableLogging: true,
            logBucket: logsBucket,
            logFilePrefix: 'cloudfront-access/',
            logIncludesCookies: false,
            priceClass: isProd
                ? cloudfront.PriceClass.PRICE_CLASS_ALL
                : cloudfront.PriceClass.PRICE_CLASS_100,
            // Add SSL configuration if certificate exists
            ...(this.certificate && stageConfig.domain
                ? {
                      certificate: this.certificate,
                      domainNames: [stageConfig.domain],
                  }
                : {}),
        }

        this.distribution = new cloudfront.Distribution(this, 'Distribution', distributionConfig)

        // === S3 Deployment ===
        // Note: This will deploy the built frontend assets from the dist directory
        // In a real deployment, you might want to build and deploy from a CI/CD pipeline
        new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [
                s3deploy.Source.asset('../../apps/frontend/dist', {
                    exclude: ['*.map'], // Exclude source maps from deployment
                }),
            ],
            destinationBucket: websiteBucket,
            distribution: this.distribution, // Invalidate CloudFront cache on deployment
            distributionPaths: ['/*'], // Invalidate all paths
            prune: true, // Remove files that are no longer in the source
        })

        // === DNS Configuration ===
        if (stageConfig.domain) {
            // Create A record for the domain
            new route53.ARecord(this, 'AliasRecord', {
                zone: hostedZone,
                recordName: stageConfig.domain,
                target: route53.RecordTarget.fromAlias(
                    new route53targets.CloudFrontTarget(this.distribution)
                ),
            })
        }

        // === Outputs ===
        new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
            value: this.distribution.distributionId,
            description: 'CloudFront distribution ID',
            exportName: `CloudFrontDistributionId-${stageConfig.name}`,
        })

        new cdk.CfnOutput(this, 'CloudFrontDomainName', {
            value: this.distribution.distributionDomainName,
            description: 'CloudFront domain name',
            exportName: `CloudFrontDomainName-${stageConfig.name}`,
        })

        if (stageConfig.domain) {
            new cdk.CfnOutput(this, 'WebsiteUrl', {
                value: `https://${stageConfig.domain}`,
                description: 'Website URL',
                exportName: `WebsiteUrl-${stageConfig.name}`,
            })
        }
    }
}
