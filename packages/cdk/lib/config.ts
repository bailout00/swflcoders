export interface StageConfig {
  name: string;
  environment: 'beta' | 'gamma' | 'prod';
  domain: string;
  apiGatewayStage: string;
  cognitoUserPoolId?: string;
  cloudfrontDomain?: string;
}

// Root domain configuration
const ROOT_DOMAIN = 'swflcoders.jknott.dev';
const BETA_ACCOUNT = '923880387537';
const GAMMA_ACCOUNT = '923880387537';
const PROD_ACCOUNT = '923880387537';

export const stages: StageConfig[] = [
  {
    name: 'beta',
    environment: 'beta',
    apiGatewayStage: 'beta',
    domain: `beta.${ROOT_DOMAIN}`,
  },
  {
    name: 'gamma',
    environment: 'gamma', 
    apiGatewayStage: 'gamma',
    domain: `gamma.${ROOT_DOMAIN}`,
  },
  {
    name: 'prod',
    environment: 'prod',
    apiGatewayStage: 'prod',
    domain: ROOT_DOMAIN,
  },
];

export function getStageConfig(stageName: string): StageConfig {
  const config = stages.find(s => s.name === stageName);
  if (!config) {
    throw new Error(`Stage configuration not found for: ${stageName}`);
  }
  return config;
}

export { ROOT_DOMAIN };
