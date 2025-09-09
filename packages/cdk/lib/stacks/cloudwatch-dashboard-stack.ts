import * as cdk from 'aws-cdk-lib'
import { Duration } from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import type { Construct } from 'constructs'
import type { StageConfig } from '../config'

export interface CloudwatchDashboardStackProps extends cdk.StackProps {
    stageConfig: StageConfig
}

export class CloudwatchDashboardStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CloudwatchDashboardStackProps) {
        super(scope, id, props)

        const { stageConfig } = props

        // Metrics are emitted via EMF under this namespace
        const namespace = `SwflcodersChat/${stageConfig.name}`

        const period = Duration.minutes(1)

        const metric = (
            metricName: string,
            dimensions?: Record<string, string>,
            statistic: string = 'Sum'
        ) =>
            new cloudwatch.Metric({
                namespace,
                metricName,
                period,
                statistic,
                dimensionsMap: dimensions,
            })

        // Core metrics
        const messagesPostedTotal = metric('MessagesPosted')
        const messageLengthAvg = metric('MessageLength', undefined, 'Average')

        const connectionsConnect = metric('ConnectionEvents', { EventType: 'connect' })
        const connectionsDisconnect = metric('ConnectionEvents', { EventType: 'disconnect' })
        const activeConnections = metric('ActiveConnections', undefined, 'Average')

        const broadcastAttempts = metric('BroadcastAttempts')
        const broadcastSuccesses = metric('BroadcastSuccesses')
        const broadcastFailures = metric('BroadcastFailures')

        const connectionErrors = metric('ConnectionErrors')
        const disconnectionErrors = metric('DisconnectionErrors')

        // Math: Broadcast failure percentage
        const broadcastFailurePct = new cloudwatch.MathExpression({
            expression: '100 * f / MAX([a,1])', // avoid divide by zero
            usingMetrics: {
                f: broadcastFailures,
                a: broadcastAttempts,
            },
            period,
            label: 'Broadcast Failure %',
        })

        // Dashboard
        const dashboard = new cloudwatch.Dashboard(this, 'ChatDashboard', {
            dashboardName: `ChatMetrics-${stageConfig.name}`,
            start: '-PT6H', // last 6 hours by default
        })

        // Row 1: Traffic
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Messages Posted (Sum)',
                left: [messagesPostedTotal],
                width: 12,
                stacked: false,
            }),
            new cloudwatch.GraphWidget({
                title: 'Message Length (Average)',
                left: [messageLengthAvg],
                width: 12,
            })
        )

        // Row 2: Connections
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Connection Events (connect/disconnect)',
                left: [connectionsConnect, connectionsDisconnect],
                legendPosition: cloudwatch.LegendPosition.RIGHT,
                width: 12,
            }),
            new cloudwatch.GraphWidget({
                title: 'Active Connections (Average)',
                left: [activeConnections],
                width: 12,
            })
        )

        // Row 3: Broadcast delivery
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Broadcast Delivery (Attempts vs Successes vs Failures)',
                left: [broadcastAttempts, broadcastSuccesses, broadcastFailures],
                width: 16,
            }),
            new cloudwatch.GraphWidget({
                title: 'Broadcast Failure %',
                left: [broadcastFailurePct],
                width: 8,
                leftYAxis: { min: 0, max: 100 },
            })
        )

        // Row 4: Errors
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Errors (Connection/Disconnection)',
                left: [connectionErrors, disconnectionErrors],
                width: 24,
                stacked: true,
            })
        )

        new cdk.CfnOutput(this, 'DashboardName', { value: dashboard.dashboardName })
        new cdk.CfnOutput(this, 'DashboardUrl', {
            value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
        })
    }
}
