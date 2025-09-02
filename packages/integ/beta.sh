#!/bin/bash

export TEST_BASE_URL=https://api.beta.swflcoders.jknott.dev
export TEST_TARGET_STAGE=beta
export AWS_DEFAULT_REGION=us-east-1

echo "Environment variables set for beta integration testing:"
echo "TEST_BASE_URL=$TEST_BASE_URL"
echo "TEST_TARGET_STAGE=$TEST_TARGET_STAGE"
echo "AWS_DEFAULT_REGION=$AWS_DEFAULT_REGION"
echo ""
echo "Make sure to also set your AWS credentials for the beta account:"
echo "Option 1 - Set access keys directly:"
echo "export AWS_ACCESS_KEY_ID=your-beta-access-key"
echo "export AWS_SECRET_ACCESS_KEY=your-beta-secret-key"
echo ""
echo "Option 2 - Use AWS profile (recommended):"
echo "export AWS_PROFILE=beta-profile"
echo ""
echo "Option 3 - Use AWS SSO profile:"
echo "aws sso login --profile beta-profile"
echo "export AWS_PROFILE=beta-profile"
echo ""
echo "Running integration tests against beta environment..."

yarn test
