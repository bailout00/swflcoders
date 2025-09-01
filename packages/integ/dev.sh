#!/bin/bash

export TEST_BASE_URL=http://localhost:3001
export TEST_TARGET_STAGE=dev
export AWS_DEFAULT_REGION=us-east-1

echo "Environment variables set for local integration testing:"
echo "TEST_BASE_URL=$TEST_BASE_URL"
echo "TEST_TARGET_STAGE=$TEST_TARGET_STAGE"
echo "AWS_DEFAULT_REGION=$AWS_DEFAULT_REGION"
echo ""
echo "Make sure to also set your AWS credentials:"
echo "Option 1 - Set access keys directly:"
echo "export AWS_ACCESS_KEY_ID=your-access-key"
echo "export AWS_SECRET_ACCESS_KEY=your-secret-key"
echo ""
echo "Option 2 - Use AWS profile (recommended):"
echo "export AWS_PROFILE=your-profile-name"
echo ""
echo "And ensure the backend is running:"
echo "yarn workspace @swflcoders/backend run dev"

yarn test
