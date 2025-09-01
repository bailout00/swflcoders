export interface StageConfig {
    name: string
    environment: 'beta' | 'gamma' | 'prod'
    domain: string
    apiGatewayStage: string
    account: string
    region: string
    cognitoUserPoolId?: string
    cloudfrontDomain?: string
    testAssumeRoleArn?: string
    isProd: boolean
    deployOrder: number
}

// Root domain configuration
const ROOT_DOMAIN = 'swflcoders.jknott.dev'
const ROOT_HOSTED_ZONE_ID = 'Z0799725352I5MGRMF90L'
const PIPELINE_ACCOUNT = '716448722050' // CodePipeline account
const BETA_ACCOUNT = '923880387537'
const GAMMA_ACCOUNT = '898683284338' // Separate account for gamma/staging
const PROD_ACCOUNT = '312370645428' // Separate account for production

export const stages: StageConfig[] = [
    {
        name: 'beta',
        environment: 'beta',
        apiGatewayStage: 'beta',
        domain: `beta.${ROOT_DOMAIN}`,
        account: BETA_ACCOUNT,
        region: 'us-east-1',
        isProd: false,
        deployOrder: 1,
    },
    {
        name: 'gamma',
        environment: 'gamma',
        apiGatewayStage: 'gamma',
        domain: `gamma.${ROOT_DOMAIN}`,
        account: GAMMA_ACCOUNT,
        region: 'us-east-1',
        isProd: false,
        deployOrder: 2,
    },
    {
        name: 'prod',
        environment: 'prod',
        apiGatewayStage: 'prod',
        domain: ROOT_DOMAIN,
        account: PROD_ACCOUNT,
        region: 'us-east-1',
        isProd: true,
        deployOrder: 3,
    },
]

export function getStageConfig(stageName: string): StageConfig {
    const config = stages.find((s) => s.name === stageName)
    if (!config) {
        throw new Error(`Stage configuration not found for: ${stageName}`)
    }
    return config
}

// Build specification configuration
export interface BuildSpecConfig {
    nodeVersion: string
    rustVersion: string
}

// Pipeline configuration
export interface PipelineConfig {
    account: string
    region: string
    buildSpec: BuildSpecConfig
    github: {
        owner: string
        repo: string
        branch: string
        connectionArn: string
    }
}

export const pipelineConfig: PipelineConfig = {
    account: PIPELINE_ACCOUNT,
    region: 'us-east-1',
    buildSpec: {
        nodeVersion: '22',
        rustVersion: '1.88.0',
    },
    github: {
        owner: 'bailout00',
        repo: 'swflcoders',
        branch: 'dev',
        connectionArn: `arn:aws:codeconnections:us-east-1:${PIPELINE_ACCOUNT}:connection/0c67b716-153a-40ea-a009-6915f3cf5f7d`,
    },
}

// DynamoDB Table Names
export const DYNAMODB_TABLES = {
    CHAT_ROOMS: 'chat-rooms',
    CHAT_MESSAGES: 'chat-messages',
    CHAT_CONNECTIONS: 'chat-connections',
} as const

export {
    ROOT_DOMAIN,
    ROOT_HOSTED_ZONE_ID,
    PIPELINE_ACCOUNT,
    BETA_ACCOUNT,
    GAMMA_ACCOUNT,
    PROD_ACCOUNT,
}
